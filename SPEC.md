# CDP-Skill Specification

> **Living Document** — This specification describes _what_ cdp-skill does and _why_, not how it is implemented. It should be updated whenever capabilities are added, behaviors change, or lessons are learned. It serves as the authoritative reference for ongoing refactoring and future development.
>
> Last updated: 2026-02-08

---

## Table of Contents

1. [Purpose & Goals](#1-purpose--goals)
2. [Architecture Overview](#2-architecture-overview)
3. [CLI Interface & I/O Schema](#3-cli-interface--io-schema)
4. [Chrome Management](#4-chrome-management)
5. [Tab & Session Lifecycle](#5-tab--session-lifecycle)
6. [Element Discovery & Targeting](#6-element-discovery--targeting)
7. [ARIA Snapshots](#7-aria-snapshots)
8. [Actionability & Auto-Waiting](#8-actionability--auto-waiting)
9. [Interaction Actions](#9-interaction-actions)
10. [Action Lifecycle & Hooks](#10-action-lifecycle--hooks)
11. [Observation & Data Extraction](#11-observation--data-extraction)
12. [Dynamic Execution](#12-dynamic-execution)
13. [Frames & Shadow DOM](#13-frames--shadow-dom)
14. [Viewport Diffing & Change Detection](#14-viewport-diffing--change-detection)
15. [Site Profiles](#15-site-profiles)
16. [Failure Diagnostics](#16-failure-diagnostics)
17. [Capture & Output](#17-capture--output)
18. [Configuration & Environment](#18-configuration--environment)
19. [Known Limitations & Edge Cases](#19-known-limitations--edge-cases)

---

## 1. Purpose & Goals

CDP-Skill is a command-line tool that accepts JSON step definitions and executes browser automation actions via the Chrome DevTools Protocol (CDP). It communicates directly with Chrome over CDP WebSocket connections without depending on any intermediary libraries such as Puppeteer, Playwright, or Selenium.

### Target Users

The primary consumers of cdp-skill are AI agents -- specifically Claude Code and OpenAI Codex -- not human users. Every design decision prioritizes the needs of a language model interacting with a browser: structured JSON input and output, minimal round trips, rich diagnostic feedback on failure, and deterministic behavior.

### Design Goals

- **Reliability**: Actions wait for actionability conditions before executing (visibility, enabled state, stability, pointer-events). When actionability checks time out but the element exists, actions automatically retry with force. Failures include diagnostic context (visible buttons, links, error messages, near-matches with similarity scores) so the agent can self-correct.

- **Minimal round trips**: Multiple steps can be batched in a single CLI invocation. After every visual action, the system automatically captures a screenshot, viewport-scoped accessibility snapshot, and page context (URL, title, scroll position, viewport dimensions, active element, modal detection). A viewport diff shows what changed. This gives agents the information they need to decide their next action without additional calls.

- **Clear feedback**: Output is compact JSON with null/empty fields stripped. Error types are classified (PARSE, VALIDATION, CONNECTION, EXECUTION) so agents can distinguish between their own mistakes and environmental failures. Failed steps include failure context with visible page elements and fuzzy-matched near-misses.

- **Zero external dependencies**: The package has no runtime dependencies beyond Node.js (v22+) and a Chrome/Chromium installation. All CDP communication, WebSocket handling, and HTTP discovery use Node.js built-in APIs.

### Relationship to Chrome DevTools Protocol

CDP-Skill communicates with Chrome through two channels:

1. **HTTP endpoints** (`/json/version`, `/json/list`, `/json/new`, `/json/close`) for discovery, tab creation, and tab closure.
2. **WebSocket connections** for session-level CDP commands (Page, Network, Runtime, Emulation, Input, DOM, Inspector domains).

There is no abstraction layer or browser automation library between cdp-skill and Chrome. This means cdp-skill has full control over the protocol but must handle all CDP domain management, event subscriptions, lifecycle tracking, and error recovery directly.

### Why This Exists

AI agents need browser automation to test web applications, extract information, and perform end-to-end workflows. Existing tools (Puppeteer, Playwright) are designed as programmatic libraries for human developers writing test scripts. They require importing modules, constructing objects, and writing imperative code -- an awkward fit for agents that operate by generating shell commands. CDP-Skill provides a stateless CLI interface: the agent constructs a JSON payload describing what to do, passes it as a command-line argument, and receives structured JSON back. No library imports, no persistent process, no state management.

### Installation Model

CDP-Skill installs itself as a skill into the agent's skill directories:

- `~/.claude/skills/cdp-skill/` for Claude Code
- `~/.codex/skills/cdp-skill/` for Codex

In development mode (when the package root is not inside `node_modules`), installation creates a symlink to the source directory. In production mode (installed via npm), installation copies the necessary files (SKILL.md, EXAMPLES.md, and the src/ directory) into the skill directories. The SKILL.md file serves as the entry point that agents read to understand how to use the tool.


## 2. Architecture Overview

CDP-Skill is organized into distinct layers, each responsible for a specific concern. Modules receive their dependencies as function parameters rather than importing and constructing them directly, enabling testability and loose coupling.

### CDP Layer

Responsible for connecting to Chrome and managing low-level protocol communication.

- **Discovery**: Locates Chrome's debugging endpoint via HTTP, retrieves version information and available targets. Determines whether Chrome is reachable on a given host and port.
- **Connection**: Manages the WebSocket connection to Chrome's browser-level debugging endpoint. Handles message serialization, command/response correlation via message IDs, event dispatching to listeners, and connection lifecycle (connect, close, reconnect with exponential backoff).
- **Target & Session Management**: Creates and closes browser targets (tabs), attaches debugging sessions to targets, and maintains a session registry. Provides per-target locking to prevent concurrent session conflicts when multiple operations target the same tab.

### Page Layer

Responsible for page-level browser state and navigation.

- **Navigation**: URL navigation with configurable wait conditions (commit, DOMContentLoaded, load, networkidle). History navigation (back/forward). Page reload. Navigation abort handling when one navigation supersedes another.
- **Lifecycle tracking**: Monitors CDP lifecycle events (DOMContentLoaded, load) and network activity to determine when a page has settled. Provides both strict network idle waiting (throws on timeout) and best-effort network settle waiting (never throws, used after navigation and before snapshots).
- **Viewport**: Device metrics emulation (width, height, scale factor, mobile mode, touch emulation, orientation). Supports named device presets (e.g., "iphone-14"). Viewport reset to clear emulation.
- **Frames**: Frame tree enumeration including cross-origin iframes discovered via DOM queries. Frame switching by selector, index, name, or frameId. Execution context management per frame. Cross-origin frame detection with warnings. Main frame restoration.
- **Geolocation**: Override and clear browser geolocation.
- **Network monitoring**: Tracks in-flight requests to determine network idle state. Exposes network status (pending count, total requests, last activity timestamp).

### DOM Layer

Responsible for finding, validating, and interacting with page elements.

- **Element finding**: Locates elements by CSS selector, ARIA ref, text content, coordinate position, or multi-selector fallback lists. Searches across frames when configured.
- **Actionability checking**: Before performing actions, validates that elements meet required conditions (visible, enabled, stable position, not covered by other elements, pointer-events not disabled). Retries with configurable delays. Auto-forces when actionability times out but element exists.
- **Click execution**: CDP-level dispatch of mouse events (mousePressed, mouseReleased) at element center coordinates. Falls back to JavaScript click when CDP click fails. Supports double-click. Detects and reports newly opened tabs after click.
- **Fill execution**: Input value setting via CDP Input.dispatchKeyEvent with proper event simulation (focus, clear existing value, type new value character by character). React-aware mode that triggers React's synthetic event system. Label-based element resolution.
- **Keyboard**: Key press simulation including modifier combinations (Control+a, Meta+Shift+Enter). Key name normalization and validation.
- **Input emulation**: Low-level mouse and keyboard event dispatch via CDP Input domain.

### ARIA Layer

Responsible for accessibility tree representation and element referencing.

- **Accessibility snapshots**: Generates a semantic tree of the page based on ARIA roles, accessible names, and states (checked, disabled, expanded, pressed, selected, required, invalid). Renders as YAML for compact, readable output. Supports multiple detail levels (summary, interactive, full). Auto-scopes to the `<main>` landmark when no root is specified. Supports viewport-only mode, shadow DOM piercing, iframe content inclusion, and max depth/element limits.
- **Ref system**: Assigns versioned references (e.g., `s1e4` meaning snapshot 1, element 4) to interactable elements. Refs persist across CLI invocations via browser-side global state (`window.__ariaRefs`). When elements go stale (removed from DOM by re-renders), the system attempts re-resolution using stored metadata (CSS selector, role, accessible name, shadow host path).
- **Change detection**: Computes a page content hash (URL + scroll position + DOM size + interactive element count) to detect whether the page has changed since a given snapshot, enabling HTTP 304-like caching.
- **Role queries**: Queries elements by ARIA role with filters for accessible name (exact, contains, regex), checked/disabled state, and heading level.

### Capture Layer

Responsible for capturing browser state for agent consumption.

- **Screenshots**: Viewport and full-page screenshot capture to PNG files in the OS temp directory. Automatically captured after every visual action.
- **Console**: Captures browser console errors and warnings during step execution. Filters by severity level.
- **Network**: Tracks network requests and responses for debugging.
- **PDFs**: Page-to-PDF generation with layout options (landscape, scale, page ranges).
- **Debug logging**: When `--debug` flag is set, writes request/response pairs to sequenced log files with descriptive filenames.

### Runner Layer

Responsible for step validation, execution orchestration, and result assembly.

- **Step validation**: Validates each step definition before execution. Checks for exactly one action key per step, validates parameter types and required fields, and validates action hooks (readyWhen, settledWhen, observe).
- **Step execution**: Dispatches each step to the appropriate domain executor. Applies action hooks (readyWhen before action, settledWhen after action, observe for data extraction). Handles optional steps (continue on failure with "skipped" status).
- **Orchestration**: Runs steps sequentially with stop-on-error behavior. Captures viewport snapshot diffs (before/after) for visual actions. Assembles the final result with context, console output, errors, and per-step results.
- **Failure context**: On step failure, gathers diagnostic information from the page: visible buttons and links (with refs if available), visible error messages, scroll position, and fuzzy-matched near-misses for the failed selector or text.

### Diff Layer

Responsible for detecting what changed in the viewport between actions.

- **Viewport snapshot comparison**: Takes accessibility snapshots before and after each action, then diffs them to produce a summary of added, removed, and changed elements. This tells the agent what effect their action had without requiring a separate snapshot call.

### Data Flow

1. JSON input arrives via CLI argument (preferred) or stdin (fallback)
2. Input is parsed, validated for structure (must have non-empty `steps` array, no legacy `config`), and top-level fields (`tab`, `timeout`) are extracted
3. Special steps (`chromeStatus`, `closeTab`) that do not require a tab session are handled directly (they resolve their own connection params)
4. For all other steps: connect to Chrome (auto-launch if needed), resolve or create a tab, attach a session
5. Module dependencies are created (page controller, element locator, input emulator, screenshot/console/PDF capture, ARIA snapshot, cookie manager) and the page controller is initialized (enabling CDP domains, resetting viewport)
6. Steps are validated and executed sequentially
7. After execution: auto-capture screenshot, build output JSON with context/snapshot/changes/console, strip empty fields, write to stdout
8. Cleanup: stop console capture, dispose page controller, disconnect from browser, exit with appropriate code

### Statelessness

Each CLI invocation is a fully independent process. No in-memory state persists between invocations. Cross-invocation continuity relies on two file-based mechanisms:

- **Tab registry**: A JSON file in the OS temp directory that maps tab aliases (t1, t2, ...) to CDP target IDs.
- **Site profiles**: Per-domain markdown files stored at `~/.cdp-skill/sites/{domain}.md` that record what agents have learned about specific websites (framework quirks, stable selectors, automation recipes).

Browser-side state (the `window.__ariaRefs` map for element refs, snapshot IDs, page hash for change detection) persists within a tab's JavaScript context across invocations but is scoped to that tab.


## 3. CLI Interface & I/O Schema

### Input Format

The CLI accepts a single JSON object containing:

- **`tab`** (optional string): Tab alias (e.g., "t1") or CDP targetId to work with. Required for all invocations after the initial tab creation.

- **`timeout`** (optional number, default 30000): Step timeout in milliseconds.

- **`steps`** (required array): One or more step objects. Each step must contain exactly one action key (e.g., `goto`, `click`, `fill`, `snapshot`). The array must be non-empty.

Connection parameters (host, port, headless) are specified via the `openTab` object form when non-default values are needed: `{"steps":[{"openTab":{"url":"...","port":9333,"headless":true}}]}`. The tab registry stores connection info per alias so subsequent commands just use `tab` and it works.

The `config` object is no longer supported. Passing `config` returns a validation error with migration instructions.

Input is accepted via two channels:
1. **CLI argument** (preferred): `node src/cdp-skill.js '{"steps":[...]}'`
2. **Stdin** (fallback): `echo '{"steps":[...]}' | node src/cdp-skill.js`

The CLI argument method is preferred for cross-platform compatibility. When reading from stdin, a 100ms timeout detects the absence of piped input to avoid hanging on TTY.

The `--debug` flag can be included as a CLI argument to enable debug logging (request/response pairs written to a `log/` directory).

### Output Format

On success, the CLI writes a single JSON object to stdout:

- **`status`** (string): "ok" when all steps succeeded, "error" when any step failed.
- **`tab`** (string): The tab alias (e.g., "t1") for the session used.
- **`siteProfile`** (string): Full markdown content of an existing site profile for the navigated domain. Present only after `goto` or `openTab` when a profile exists.
- **`actionRequired`** (object): A mandatory instruction the agent must handle immediately before continuing. Contains `action` (what to do), `domain` (which site), and `message` (detailed instructions). Present only after navigating to a domain with no site profile.
- **`navigated`** (boolean): True when the URL pathname changed during execution. Omitted when false/undefined.
- **`fullSnapshot`** (string): File path to a full-page accessibility snapshot saved to disk. Present after visual actions.
- **`screenshot`** (string): File path to the auto-captured viewport screenshot (PNG). Present after visual actions.
- **`context`** (object): Current page state after execution.
  - `url` (string): Current page URL.
  - `title` (string): Current page title.
  - `scroll` (object): `{y, percent}` -- vertical scroll offset and percentage. Horizontal scroll is omitted.
  - `viewport` (object): `{width, height}` -- current viewport dimensions.
  - `activeElement` (string or null): Description of the focused element. Omitted when null.
  - `modal` (object or null): Information about any detected modal/dialog. Omitted when null.
- **`viewportSnapshot`** (string): Inline viewport-only accessibility snapshot in YAML format. Can be large; placed at the end of the output object.
- **`changes`** (object): Viewport diff showing what changed between before and after states. Contains `summary`, `added[]`, `removed[]`, and `changed[]`.
- **`console`** (object): Browser console output captured during execution. Contains only errors and warnings.
- **`steps`** (array): Per-step results. Each entry has `action` (string) and `status` (string, "ok" or "error"). Failed steps additionally include `params`, `error`, and `context` (failure diagnostics).
- **`errors`** (array): Error details for failed steps. Only present when steps failed.
- **`truncated`** (boolean): Whether the viewport snapshot was truncated to fit inline size limits. Omitted when false/undefined.

Fields with null, undefined, or empty values are stripped from the output to keep it compact.

### Error Response Format

When an error prevents step execution (parse failure, validation failure, connection failure), the output is:

```
{
  "status": "error",
  "error": {
    "type": "<ERROR_TYPE>",
    "message": "<description>"
  }
}
```

### Error Types

- **PARSE**: Input is not valid JSON or is empty.
- **VALIDATION**: Input structure is invalid (missing `steps`, empty steps array, unknown step type, ambiguous step with multiple action keys).
- **CONNECTION**: Cannot connect to Chrome, tab not found, session attachment failed, Chrome not running and auto-launch failed.
- **EXECUTION**: A step failed during execution (element not found, navigation error, timeout, JavaScript evaluation error, page crash).

### Exit Codes

- **0**: All steps completed successfully (`status: "ok"`).
- **1**: Any error occurred (`status: "error"`).

### Metrics

When the `CDP_METRICS_FILE` environment variable is set, each invocation appends a JSON line to that file recording: timestamp, input byte count, output byte count, step count, and execution time in milliseconds.


## 4. Chrome Management

### Chrome Discovery

CDP-Skill locates the Chrome executable through a two-step process:

1. Check the `CHROME_PATH` environment variable. If set and the path exists, use it.
2. Search platform-specific default paths:
   - **macOS**: Google Chrome, Chromium, and Chrome Canary in `/Applications/`.
   - **Linux**: `google-chrome`, `chromium-browser`, `chromium` via PATH lookup and common installation directories (`/usr/bin/`, `/snap/bin/`).
   - **Windows**: Chrome and Chromium in `LOCALAPPDATA`, `PROGRAMFILES`, and `PROGRAMFILES(X86)`.

If no Chrome executable is found, an error is returned with a download link.

### Auto-Launch

When Chrome is not running with CDP enabled on the expected port, cdp-skill can automatically launch a new instance. This behavior is triggered in two scenarios:

1. **Normal step execution**: If the initial WebSocket connection fails, cdp-skill calls `getChromeStatus` with `autoLaunch: true`, then retries the connection.
2. **Explicit `chromeStatus` step**: The agent can check and launch Chrome via the `chromeStatus` action.

Chrome is launched with:
- `--remote-debugging-port=<port>` to enable CDP.
- `--no-first-run` and `--no-default-browser-check` to suppress setup dialogs.
- `--user-data-dir=<temp-dir>` pointing to an isolated profile directory. The profile directory is scoped by port number (and headless mode) to allow multiple independent Chrome instances.
- `--headless=new` when headless mode is requested.

The launched Chrome process is detached and unreferenced so it does not keep the Node.js process alive. CDP-Skill waits up to 10 seconds for the new Chrome instance to become reachable, polling the discovery endpoint every 100ms.

CDP-Skill never kills or interferes with existing Chrome processes. If Chrome is already running (e.g., the user's personal browser), a new CDP-enabled instance is launched alongside it with a separate user data directory.

### macOS Special Case

On macOS, Chrome can be running as a background process without any visible windows and without a CDP port. This happens when the user closes all Chrome windows but the application remains active. CDP-Skill detects this by checking for Chrome processes (`pgrep`) and inspecting whether any have the `--remote-debugging-port` flag. When Chrome is running without CDP, cdp-skill launches a new CDP-enabled instance alongside it rather than attempting to reuse or restart the existing one.

### `chromeStatus` Step

The `chromeStatus` step is an optional diagnostic for checking Chrome's state. In normal usage, agents do not need to call `chromeStatus` — `openTab` auto-launches Chrome if needed. Use `chromeStatus` when targeting a non-default port, debugging connection issues, or checking which tabs are open. Agents must never launch Chrome manually via shell commands.

The step accepts `true` (uses defaults) or an object with optional `host`, `port`, `headless`, and `autoLaunch` fields. It is self-contained — all connection parameters come from the step itself, not from any top-level field.

The step is lightweight: it does not require a tab session and is handled before any WebSocket connection is established. It returns:

- `running` (boolean): Whether Chrome is reachable via CDP.
- `launched` (boolean): Whether a new Chrome instance was launched.
- `version` (string): Chrome version string.
- `port` (number): The debugging port in use.
- `tabs` (array): List of open tabs with targetId, URL, and title.
- `createdTab` (boolean): Whether a new blank tab was created (when Chrome was running but had no tabs).
- `note` (string): Explanatory message about any special actions taken (e.g., "Chrome had no tabs open. Created new tab.").
- `error` (string): Error message if Chrome could not be reached or launched.

The step handles four scenarios:
1. Chrome not running: Launch new instance with CDP.
2. Chrome running without CDP port: Launch new CDP-enabled instance alongside.
3. Chrome running with CDP but no tabs: Create a new blank tab.
4. Chrome running with CDP and tabs: Return the tab list.

### Connection

CDP-Skill connects to Chrome via two protocols:

1. **HTTP** (`/json/version`): Discovers the browser-level WebSocket debugger URL.
2. **WebSocket**: Connects to the browser-level endpoint for target management and session communication.

Connection has a configurable timeout (default 30 seconds). If the initial connection fails, cdp-skill attempts auto-launch and retries once.

### Remote Debugging Port

The default port is 9222, overridable via the `openTab` object form (e.g., `{"openTab":{"url":"...","port":9333}}`). Each port uses its own user data directory, allowing multiple independent Chrome instances for parallel agent workloads.


## 5. Tab & Session Lifecycle

### Tab Aliases

Tab aliases are short, human-readable identifiers (t1, t2, t3, ...) that map to CDP target IDs (32-character hex strings). They serve as stable references that agents can use across CLI invocations without tracking raw target IDs.

The alias-to-targetId mapping is stored in a JSON registry file at `$TMPDIR/cdp-skill-tabs.json`. This file persists across CLI invocations since each invocation is a separate process. The registry tracks the mapping and a monotonically increasing counter for the next alias.

When a tab is registered, the system first checks if the target ID already has an alias (returning the existing one) before assigning a new one. Aliases are never reused -- if t1 is closed and a new tab is opened, it becomes t2 (or whatever the next number is).

Each registry entry stores `{ targetId, host, port }` so that subsequent commands using `tab: "t1"` automatically resolve the correct host and port without the agent needing to repeat them.

### Tab Creation

The `openTab` step creates a new browser tab and registers an alias for it. It accepts:
- `true`: Open a blank tab.
- A URL string: Open a tab and navigate to that URL.
- An object: Open a tab with optional `url`, `host`, `port`, and `headless` fields for non-default Chrome connections.

`openTab` must be the first step in an invocation when no tab is specified. The step is handled during session setup (before the normal step execution loop) because a tab must exist before any other actions can run. When the object form includes `host`, `port`, or `headless`, those values are used for the browser connection and stored in the tab registry so subsequent commands just use the alias. The URL navigation (if provided) and site profile lookup are handled as part of the step result.

### Tab Reuse

The `tab` field (top-level) specifies an existing tab to work with. The alias is resolved to a full registry entry `{ targetId, host, port }` via the registry, and a debugging session is attached to the target using the stored connection parameters.

Agents are expected to reuse their own tabs across invocations. In shared-browser scenarios (multiple agents using the same Chrome instance), each agent should only interact with tabs it created. There is no enforcement mechanism for this -- it is a convention documented in the agent-facing SKILL.md.

### Tab Connection

The `connectTab` step connects to an existing tab without creating a new one. It supports three resolution modes:

1. **Alias** (string, e.g., "t1"): Resolved via the tab registry.
2. **Target ID** (object with `targetId`): Used directly.
3. **URL regex** (object with `url`): Finds the first open tab whose URL matches the provided regex pattern.

The object form also accepts optional `host` and `port` fields for connecting to a non-default Chrome instance. Like `openTab`, `connectTab` must be the first step when no tab is specified. It attaches a session to the found tab and registers an alias if one does not already exist.

### Tab Closure

The `closeTab` step closes a tab by alias or target ID. It is handled specially -- it does not require an active session because it uses Chrome's HTTP close endpoint (`/json/close/<targetId>`) directly. After closure, the tab's alias is removed from the registry.

`closeTab` can be the sole step in an invocation (no session needed). It resolves the host and port from the tab registry to make the HTTP close request, so the agent does not need to specify connection parameters. When agents finish their work, they are expected to close their tabs to avoid tab accumulation.

### Tab Listing

The `listTabs` step returns all open tabs with their aliases, target IDs, URLs, and titles. This helps agents discover tabs in the shared browser environment.

### New Tab Detection

After click actions, the system checks for newly opened tabs (e.g., from `target="_blank"` links or `window.open()` calls). If new tabs are detected, they are reported in the click step's result as a `newTabs` array containing each new tab's target ID, URL, and title. The agent can then use `connectTab` to switch to one of these tabs.

### Session Initialization

When a tab is attached (either by creation, reuse, or connection), the following CDP domains are enabled:

- **Page**: Navigation, lifecycle events, frame tree.
- **Network**: Request tracking for network idle detection.
- **Runtime**: JavaScript evaluation, execution context management.
- **Inspector**: Target crash detection.

After domain initialization, the viewport is reset to default (clearing any previous device emulation from prior sessions on the same tab) and console capture is started to collect browser errors and warnings during execution.

Per-target locking ensures that if two concurrent processes try to attach to the same target, they are serialized rather than conflicting.


## 6. Element Discovery & Targeting

Element discovery is the foundation for all page interaction. Agents must locate DOM elements before clicking, filling, hovering, or extracting data. The system provides multiple targeting mechanisms, each suited to different situations.

### 6.1 CSS Selectors

Standard CSS selectors (`#id`, `.class`, `tag`, `[attribute]`, compound selectors) serve as the lowest-level targeting mechanism. Any valid `document.querySelector` expression can be used to identify elements. CSS selectors are passed as strings directly to action steps.

### 6.2 Refs (Primary Targeting Mechanism)

Refs are the recommended targeting mechanism for AI agents. They provide stable, short identifiers for interactive elements discovered through ARIA snapshots.

**Format**: `s{snapshotId}e{elementNumber}` (e.g., `s1e4`, `s3e12`)

- Each ARIA snapshot assigns refs to interactive elements (buttons, links, inputs, checkboxes, etc.) and elements with pointer-cursor or onclick handlers.
- The snapshot ID component (`s{N}`) increments with each agent-facing snapshot. Internal snapshots (used for diffing or search) do not increment the ID.
- The element number component (`e{M}`) increments monotonically across the session. An element that already has a ref from a previous snapshot retains the same ref.
- Refs can be used anywhere a selector is accepted: `click`, `fill`, `hover`, `drag`, `getBox`, and others. The system automatically detects the `s{N}e{M}` pattern and routes to ref-based resolution.

**Why refs over selectors**: CSS selectors can break across page redesigns, framework re-renders, and dynamic content. Refs are tied to the accessibility tree, which is more stable. They also spare the agent from constructing fragile selector paths.

### 6.3 Ref Resolution

When a ref is used in an action, the system resolves it to a live DOM element through a multi-stage process:

1. **Direct lookup** (fast path): The element stored in the refs map is checked. If it exists and `isConnected` is true, it is used immediately. No re-resolution overhead.

2. **Re-resolution** (when the element is stale or missing): If the original element has left the DOM (e.g., React re-render, lazy loading, route change), the system attempts recovery using metadata stored at ref creation time:
   - **CSS selector fallback**: The stored CSS selector is queried against the document. If a match is found and it has the same role and accessible name, it is accepted as the replacement.
   - **Role + name search**: All elements matching the stored ARIA role are scanned, and the first one whose accessible name matches (case-insensitive substring) is accepted.
   - **Shadow DOM search**: If the element was originally inside a shadow DOM, the stored shadow host path is traversed to reach the correct shadow root, and the selector/role search is repeated within it. As a last resort, all shadow roots in the document are searched.

3. **Failure**: If all re-resolution attempts fail, the action fails with an element-not-found error. For click actions specifically, a stale ref returns a structured warning advising the agent to take a fresh snapshot.

When re-resolution succeeds, the response includes `reResolved: true` so the agent is aware that the underlying element has changed.

### 6.4 Text-Based Finding

Actions that target by text (using the `text` parameter on `click` or label-based `fill`) search visible elements by their accessible name or text content.

**Priority order for click-by-text**:
1. Buttons (`button`, `input[type="button"]`, `input[type="submit"]`, `input[type="reset"]`)
2. Links (`a[href]`)
3. Role-based buttons (`[role="button"]`)
4. Other clickable elements (`[onclick]`, `[tabindex]`, `label`, `summary`)

For `fill`, label resolution follows a separate priority chain:
1. `<label for="id">` pointing to an input
2. Nested input inside a `<label>`
3. `aria-label` attribute
4. `aria-labelledby` reference
5. `placeholder` attribute

Both text-based finding mechanisms support `exact` mode (full string match) and loose mode (case-insensitive substring). Only visible elements are considered.

### 6.5 Role-Based Queries

The `query` step allows agents to find elements by ARIA role with optional filtering by accessible name, checked state, disabled state, and heading level. Known roles (button, textbox, checkbox, link, heading, etc.) are mapped to their corresponding HTML elements and explicit `[role]` attributes. Unknown roles fall back to `[role="..."]` attribute matching.

Role queries support:
- **Single or compound roles**: query one or multiple roles at once
- **Name filtering**: substring match (default) or exact match
- **Regex name matching**: filter by regular expression pattern
- **State filtering**: `checked`, `disabled`, `level` (for headings)
- **Count-only mode**: return just the count without fetching element details
- **Output modes**: text, html, href, value, tag, or attribute extraction

### 6.6 Multi-Selector

The `click` step accepts an array of selectors via the `selectors` parameter. Each selector is tried in order until one succeeds. This is useful when an element might match different selectors depending on page state (e.g., A/B tests, responsive layouts). The result reports which selector was used and at which index.

### 6.7 Coordinate-Based Targeting

Some actions support direct `(x, y)` coordinate targeting. This applies to:
- `click`: `{x: 100, y: 200}` clicks at the specified viewport coordinates
- `drag`: source and target can each be specified as coordinates
- `elementsAt`: `{x, y}` returns element at a point, `[{x,y}, ...]` returns batch, `{x, y, radius}` returns nearby elements

Coordinate-based targeting is a fallback for cases where no selector or ref can identify the target (e.g., canvas elements, SVG paths).

### 6.8 Near-Match Suggestions

When element finding fails (element-not-found errors), the failure context includes diagnostics to help the agent recover:
- **Visible buttons and links**: lists currently visible interactive elements
- **Visible errors**: any error messages displayed on the page
- **Near matches**: fuzzy-matched alternatives with similarity scores, helping the agent identify typos or close matches
- **Scroll position**: current scroll state, in case the element is off-screen


## 7. ARIA Snapshots

The accessibility tree snapshot is the primary observation mechanism for AI agents. Rather than parsing raw HTML, agents work with a semantic view of the page that captures roles, names, states, and interactive refs.

### 7.1 What Snapshots Capture

Each node in the snapshot tree includes:
- **Role**: the ARIA role (explicit `role` attribute or implicit from HTML element type). Elements without a semantic role are either flattened into their parent or omitted.
- **Name**: the computed accessible name, resolved through the standard chain: `aria-labelledby` > `aria-label` > associated `<label>` > `title` > `placeholder` > `alt` > text content.
- **States** (when applicable):
  - `checked` (true, false, mixed) -- for checkboxes, radios, switches
  - `disabled` -- for form controls and interactive elements
  - `expanded` / `collapsed` -- for expandable widgets (buttons, comboboxes, tree items)
  - `pressed` (true, false, mixed) -- for toggle buttons
  - `selected` -- for tabs, options, grid cells
  - `required` -- for required form fields
  - `invalid` (true, grammar, spelling) -- for validation state
- **Heading level**: `[level=1]` through `[level=6]`
- **Form element name attribute**: the HTML `name` attribute for form fields
- **Input value**: current value for text inputs, search boxes, spinbuttons
- **Link URL**: the `href` for links
- **Ref**: `[ref=s{N}e{M}]` for interactive elements (AI mode only)

### 7.2 Output Format

Snapshots render as YAML-like trees where indentation reflects DOM hierarchy:

```
- navigation "Main Menu":
  - link "Home" [ref=s1e1]
  - link "Products" [ref=s1e2]
- main:
  - heading "Welcome" [level=1] [ref=s1e3]
  - textbox "Email" [required] [ref=s1e4]: ""
  - button "Sign Up" [ref=s1e5]
```

- Roles appear first, followed by the quoted accessible name
- State attributes appear in brackets: `[checked]`, `[disabled]`, `[expanded]`
- Single text children are inlined after a colon: `button "Submit": "Click here"`
- Input values appear after a colon: `textbox "Email": "user@example.com"`
- Generic wrapper elements (divs, spans without roles) are flattened -- their children are promoted to the parent level

### 7.3 Detail Levels

- **`full`** (default): complete accessibility tree with all semantic elements
- **`interactive`**: only interactive/form elements (buttons, inputs, links, etc.) with their structural path for context
- **`summary`**: landmark-level overview showing navigation, main, form regions with interactive element counts and child role summaries

### 7.4 Auto-Scoping

When no `root` element is specified, the snapshot automatically scopes to the `<main>` element (or `[role="main"]`) if one exists. This reduces noise from persistent navigation, headers, footers, and sidebars that are typically not the agent's focus.

When auto-scoped, a header comment lists the other landmarks present on the page (navigation, banner, contentinfo, complementary, search) with their aria-labels where available. The agent can switch to `{root: "body"}` for the full page or target a specific landmark with `{root: "role=navigation"}`.

### 7.5 Change Detection (since)

Snapshots include a content hash computed from the URL, scroll position, DOM size, and interactive element count. The `since` parameter allows an agent to request a snapshot only if the page has meaningfully changed since a given snapshot ID:

- If the hash matches, the response is `{unchanged: true, snapshotId: "s3"}` -- avoiding redundant processing.
- If the hash differs, a full new snapshot is generated.

This is analogous to HTTP 304 Not Modified and helps agents avoid re-processing unchanged pages.

### 7.6 Large Snapshot Handling

Snapshots exceeding a configurable size threshold (default 9KB) are saved to a temporary file. The response contains:
- The file path in `artifacts.snapshot`
- A `truncatedInline: true` flag
- A message explaining where the full snapshot was saved

The viewport-only snapshot (elements currently visible in the viewport) is still provided inline in the `viewportSnapshot` field of the command response, giving the agent immediate context without requiring a file read.

If the number of refs exceeds a separate threshold (1000), the refs map is also saved to a file.

### 7.7 Shadow DOM Traversal

When `pierceShadow` is enabled, the snapshot traverses open shadow DOM boundaries, including shadow tree content in the YAML output. Shadow host paths are stored in ref metadata so that re-resolution (Section 6.3) can navigate back through the shadow DOM chain when elements go stale.

### 7.8 Frame Inclusion

When `includeFrames` is enabled, same-origin iframe content is incorporated into the snapshot tree. Each iframe appears as a `document` node with the iframe's title or name. Cross-origin iframes are noted but cannot be traversed due to browser security restrictions.

### 7.9 Ref Persistence

Refs created by any snapshot operation -- whether a regular `snapshot` step, a `snapshotSearch`, or an internal diff snapshot -- persist across subsequent commands. The system manages this through several mechanisms:

- The `preserveRefs` option (default true for agent-facing snapshots) merges new refs into the existing map rather than replacing it.
- The ref counter is global within the session, so new refs never collide with old ones.
- Internal snapshots (used for before/after diffing) use the `internal` flag to avoid incrementing the snapshot generation ID, preventing confusion about which snapshot is "current."

### 7.10 Snapshot Search

The `snapshotSearch` step searches the accessibility tree without producing full YAML output. It accepts:
- `text`: substring match against element names and values
- `pattern`: regex match
- `role`: filter to a specific ARIA role
- `near`: `{x, y, radius}` for coordinate-based proximity filtering
- `exact`: require exact text match
- `limit`: maximum results (default 10)

Results include each matching element's role, name, ref (if interactive), value, and structural path. This is faster and more targeted than taking a full snapshot when the agent knows what it is looking for.

### 7.11 Configurable Limits

- **maxDepth** (default 50): prevents infinite recursion in deeply nested DOMs
- **maxElements** (default unlimited): caps the number of elements processed. When the limit is reached, the snapshot reports `truncated: true`.


## 8. Actionability & Auto-Waiting

Before performing interactions, the system automatically waits for target elements to be in an actionable state. This prevents timing-related failures without requiring agents to insert explicit wait steps.

### 8.1 Required States by Action Type

Different actions require different preconditions:

| Action | Required States |
|--------|----------------|
| `click` | attached (element exists in DOM) |
| `fill` / `type` | attached + editable (not readonly, is a form element or contenteditable, correct input type) |
| `hover` | attached |
| `select` | attached |

The "attached" check verifies that the element's `isConnected` property is true -- meaning it is part of the live DOM tree.

### 8.2 Editable Check

The editable check (for `fill` and `type`) verifies:
- The element is enabled (not `disabled`, not `aria-disabled="true"`, not inside a disabled `<fieldset>` unless within its `<legend>`)
- The element is not readonly (`readOnly` property or `aria-readonly="true"`)
- The element is a form element (`input`, `textarea`, `select`) or has `contentEditable`
- For `<input>` elements, the type must be a text-accepting type (text, password, email, number, search, tel, url, date, datetime-local, month, time, week)

### 8.3 Visibility Checks

Visibility is verified during click execution (as part of determining the click point and detecting interception) rather than as a formal actionability precondition. The checks include:
- `isConnected` is true
- `display` is not `none`
- `visibility` is not `hidden`
- `opacity` is greater than 0
- Width and height are both greater than 0
- `aria-hidden` is not `"true"`
- `hidden` attribute is not present

### 8.4 Hit-Target Verification

After computing the click coordinates (element center), the system checks whether `document.elementFromPoint` at those coordinates returns the target element or one of its descendants. If a different element is at the click point, the click would miss its target. This detects:
- Overlays (modals, cookie banners, consent dialogs)
- Z-index stacking issues
- Fixed-position elements covering the target

The interceptor is identified by type (cookie-banner, consent-dialog, modal, overlay, popup, notification) when possible, providing actionable diagnostics.

### 8.5 Pointer-Events Check

The system verifies that CSS `pointer-events: none` is not set on the target element or any of its ancestors. Elements with this property cannot receive click events regardless of other conditions.

### 8.6 Stability Check

An optional stability check verifies that the element's position has not changed across consecutive animation frames. This catches elements that are still animating or being laid out. The check requires the position to remain constant for a configurable number of frames (default 3). This check is not part of the default required states for any action due to performance concerns, but is available when needed.

### 8.7 Auto-Force

When actionability checks time out but the element exists in the DOM, the system automatically retries the action with `force: true`, bypassing all checks. The response includes `autoForced: true` so the agent knows that normal checks were skipped. This prevents hard failures on elements that are technically interactable but fail a strict check (e.g., elements with CSS transitions that never fully stabilize).

### 8.8 Manual Force

Agents can set `force: true` on any interaction step to skip all actionability checks entirely. The system will find the element and perform the action immediately. This is useful when the agent has prior knowledge that the element is ready, or when auto-waiting is counterproductive.

### 8.9 Timeout and Retry

- **Default timeout**: 5 seconds for actionability (intentionally shorter than Playwright's 30-second default to provide faster feedback to agents)
- **Retry delays**: progressively increasing: 0ms, 50ms, 100ms, 200ms
- **Overall step timeout**: 30 seconds (configurable), wrapping the entire step including hooks

The short default timeout, combined with auto-force, means agents get rapid feedback rather than waiting for unlikely state changes.

### 8.10 Scroll Until Visible

For elements that may be off-screen or in lazy-loaded content, the `scrollUntilVisible` option on click performs incremental page scrolling (configurable direction, distance, and max attempts) until the element appears in the viewport. If the element exists but is not visible, `scrollIntoView` is tried first. If the element does not exist yet (lazy loading), the page is scrolled progressively.


## 9. Interaction Actions

All the ways agents can interact with page elements. Each action is specified as a step in the steps array.

### 9.1 Click

Click is the most complex interaction, supporting multiple input formats and a multi-strategy execution pipeline.

**Input formats** (any one of):
- CSS selector: `{"click": "#submit-btn"}`
- Ref: `{"click": "s1e4"}` or `{"click": {"ref": "s1e4"}}`
- Text: `{"click": {"text": "Sign In"}}` with optional `exact` and `withinSelector`
- Coordinates: `{"click": {"x": 100, "y": 200}}`
- Multi-selector: `{"click": {"selectors": ["#btn-v1", "#btn-v2", "[data-action=submit]"]}}`

**Click strategies** (tried in order by default):

1. **CDP native click**: Dispatches real mouse events (mousemove, mousedown, mouseup, click) at the element's center point via the Chrome DevTools Protocol. This is the most realistic simulation, triggering hover states, focus changes, and event listeners exactly as a real user click would. After the click, a `pointerdown` verification listener checks whether the event reached the intended target.

2. **JS click fallback**: If the verification listener reports that the CDP click did not reach the target (due to overlays, z-index issues, or event interception), `element.click()` is called directly via JavaScript. The response reports `method: "jsClick-auto"` and `cdpAttempted: true` so the agent knows what happened.

3. **The agent can force a specific strategy**: `jsClick: true` skips CDP entirely and uses JavaScript click. `nativeOnly: true` prevents the JS fallback, only attempting CDP.

**Navigation detection**: After click, the system checks whether the page URL changed. If so, `navigated: true` and `newUrl` are included in the response. Navigation detection uses a short delay to accommodate asynchronous SPA routers that commit URL changes via state updates.

**New tab detection**: After click, the system checks for newly opened browser tabs (e.g., links with `target="_blank"`). New tabs are reported as `newTabs: [{targetId, url, title}]`.

**Additional options**:
- `force`: skip all actionability checks
- `doubleClick`: dispatch with click count 2
- `scrollUntilVisible`: incrementally scroll to find the element before clicking
- `exact`: require exact text match (for text-based clicks)
- `timeout`: actionability timeout (default 5 seconds)
- `waitAfter`: wait for DOM mutations to settle after click, with configurable timeout and stable time

**Output**: `{clicked, method, navigated, newUrl, newTabs, reResolved, autoForced, targetReceived}`

### 9.2 Fill

Fill is the primary way to input text into form fields.

**Input formats**:
- By selector: `{"fill": {"selector": "#email", "value": "user@example.com"}}`
- By ref: `{"fill": {"ref": "s1e4", "value": "user@example.com"}}`
- By label: `{"fill": {"label": "Email Address", "value": "user@example.com"}}`

**Label resolution** searches in priority order: `<label for>` association, nested input inside `<label>`, `aria-label`, `aria-labelledby`, then `placeholder`. This allows agents to target fields by their human-visible label without needing CSS selectors.

**Fill process**: The element is scrolled into view, clicked to focus, existing content is selected (if `clear` is true, which is the default), and the new value is inserted using CDP's `Input.insertText`. Synthetic `input` and `change` events are dispatched to trigger framework bindings.

**React compatibility**: Setting `react: true` uses a specialized fill strategy that works with React's synthetic event system. React intercepts native input events and may not update component state when `Input.insertText` is used. The React fill strategy uses the native property setter on the input's prototype to trigger React's internal event handling.

**Batch fill**: The `fill` step also accepts a map of selectors (or refs) to values, filling multiple fields in one step:
```json
{"fill": {"#firstName": "John", "#lastName": "Doe", "s1e4": "user@example.com"}}
```
The result reports the count of successful and failed fills with per-field details. An extended batch form uses `{fields: {...}, react: true}` for options.

**Fill focused**: A string value fills the currently focused element without needing a selector: `{"fill": "hello"}`. This is useful after tabbing into a field or when the focus state is known. An object form with `value` (but no targeting keys) also works: `{"fill": {"value": "hello", "clear": true}}`.

**Navigation detection**: Fill checks for URL changes after input, as filling can trigger form submission.

**Output**: `{filled, navigated, newUrl, method}`

### 9.3 Type

Type simulates character-by-character keyboard input with realistic key events (`char` events dispatched per character) and configurable inter-keystroke delay.

**Different from fill**: `type` sends individual keystroke events, while `fill` sets the value in bulk using `Input.insertText`. Type is appropriate for:
- Rich text editors that respond to individual keystrokes
- Autocomplete/typeahead inputs that trigger search on each character
- Inputs that apply formatting or validation per keystroke

**Options**: `selector` (element to focus first), `text` (characters to type), `delay` (milliseconds between keystrokes)

### 9.4 Press

Press dispatches keyboard events for special keys and modifier combinations.

**Single keys**: `"Enter"`, `"Tab"`, `"Escape"`, `"Backspace"`, `"Delete"`, `"ArrowDown"`, `"Home"`, `"End"`, `"PageUp"`, `"PageDown"`, `"F1"` through `"F12"`

**Modifier combinations**: `"Control+a"`, `"Meta+c"`, `"Meta+Shift+Enter"`, `"Alt+F4"`. Modifier names accepted: `Control`/`Ctrl`, `Alt`, `Meta`/`Cmd`/`Command`, `Shift`.

Each press dispatches the full sequence: `rawKeyDown`, optionally `char` (for printable keys), then `keyUp`. Modifier flags are set appropriately.

**Key validation**: Unrecognized key names produce a warning in the step result, helping agents catch typos.

### 9.5 Hover

Hover moves the mouse over an element to trigger hover effects (tooltips, dropdown menus, hover states).

**Input formats**:
- By selector: `{"hover": "#menu-trigger"}`
- By ref: `{"hover": "s1e4"}`
- With options: `{"hover": {"ref": "s1e4", "duration": 500}}`

**Options**:
- `duration`: milliseconds to hold the hover position (default 0 -- instantaneous)
- `captureResult`: after hovering, detect newly-appeared elements (menus, tooltips, popovers) and return them in `capturedResult.visibleElements`
- `force`, `timeout`: same as click

The `captureResult` feature compares visible overlay-type elements (menus, tooltips, dropdowns, popups) before and after the hover, reporting only those that appeared as a result of the hover action.

**Output**: `{hovered, autoForced, capturedResult}`

### 9.6 Drag

Drag performs drag-and-drop operations between a source and target.

**Source and target** can each be specified as:
- A CSS selector: `{"selector": "#draggable"}`
- A ref: `{"ref": "s1e4"}` or just `"s1e4"`
- Coordinates: `{"x": 100, "y": 200}`
- With offsets: `{"ref": "s1e4", "offsetX": 10, "offsetY": -5}`

**Methods**:
- `auto` (default): tries mouse-event-based drag first (works for jQuery UI, sortable lists), then falls back to HTML5 drag-and-drop events
- `mouse`: dispatches mousedown, a series of mousemove events along the drag path, then mouseup
- `html5`: dispatches the full HTML5 DnD sequence (dragstart, drag, dragenter, dragover, drop, dragend) with a DataTransfer object

**Special handling**: Range inputs (`<input type="range">`) are detected automatically. Instead of drag events, the value is set directly based on the target x-coordinate relative to the slider track, and `input`/`change` events are dispatched.

**Options**: `steps` (number of intermediate move points, default 10), `delay` (milliseconds between moves)

**Output**: `{dragged, method, source, target, steps, value}`

### 9.7 Scroll

Scroll changes the page or element scroll position.

**Input formats**:
- `"top"`: scroll to page top
- `"bottom"`: scroll to page bottom
- `"selector"`: scroll the element into the viewport center
- `{deltaY: 500}`: relative scroll by pixel amount
- `{x: 0, y: 1000}`: absolute scroll position

**Output**: `{scrollX, scrollY}` -- the final scroll position after the action.

### 9.8 Select Option

Select Option interacts with `<select>` dropdown elements.

**Input**: `{selector, value}` or `{selector, label}` or `{selector, index}` for single-select; `{selector, values: [...]}` for multi-select.

The step validates that the target is a `<select>` element, selects the matching option(s), deselects others (for single-select), and dispatches `input` and `change` events.

When no option matches, the error includes the first 10 available options (value and label) to help the agent correct its input.

**Output**: `{selected: [...], multiple: boolean}`


## 10. Action Lifecycle & Hooks

Steps follow a consistent lifecycle with optional hooks that give agents fine-grained control over timing and observation.

### 10.1 Step Lifecycle

Every step proceeds through these phases in order:

1. **Validation**: The step structure is validated before any execution. Each step must contain exactly one action key (e.g., `click`, `fill`, `snapshot`). Multiple action keys in a single step are rejected. Invalid step structures produce a validation error.

2. **readyWhen hook** (optional): If the action parameters include `readyWhen`, the system polls the provided JavaScript predicate until it returns a truthy value. This runs *before* the action executes, ensuring the page is in the expected state. If the predicate does not resolve within the step timeout, the step fails.

3. **Action execution**: The primary action runs (click, fill, navigate, etc.).

4. **settledWhen hook** (optional): If the action parameters include `settledWhen`, the system polls the provided JavaScript predicate until it returns a truthy value. This runs *after* the action completes, waiting for side effects (animations, API calls, DOM updates) to finish. If the predicate times out, a warning is added to the step result -- but the step does not fail. The warning includes the last value returned by the predicate and the elapsed time.

5. **observe hook** (optional): If the action parameters include `observe`, the provided JavaScript function is executed after settlement. Its return value appears as `observation` in the step result. This is useful for capturing transient data (e.g., a tooltip that appears on hover, or a computed value that changes after interaction).

6. **Post-action capture**: After all steps in a command complete, the system captures a screenshot, viewport snapshot, full-page snapshot, context (URL, title, scroll position, viewport dimensions), and a diff of changes (if the page was not navigated).

### 10.2 Hooks

Hooks are JavaScript function strings evaluated in the browser context.

- **readyWhen**: `"() => document.querySelector('.modal')?.classList.contains('open')"` -- polled until truthy before the action. Use when dynamic content must be present before interacting.

- **settledWhen**: `"() => !document.querySelector('.spinner')"` -- polled until truthy after the action. Use when you need to wait for loading indicators to disappear, animations to complete, or async operations to finish. Timeout produces a warning, not a failure.

- **observe**: `"() => document.querySelector('.tooltip')?.textContent"` -- runs once after settlement. The return value is serialized and attached to the step result as `observation`.

Hooks can be combined on any single action step. All three can appear together.

**Applicable to**: click, fill, press, hover, drag, selectOption, scroll -- any action step that accepts an object parameter.

### 10.3 Optional Steps

Any step can include `"optional": true` to make it non-fatal:

```json
{"click": "#dismiss-banner", "optional": true}
```

If an optional step fails (element not found, timeout, etc.), it reports `status: "skipped"` with the error message. Execution continues with the next step. This is useful for dismissing elements that may or may not be present (cookie banners, promotional modals) without stopping the workflow.

### 10.4 Step Timeout

Each step has a configurable timeout (default 30 seconds, set via top-level `timeout` or per-step). The timeout wraps the entire step execution including all hooks (readyWhen, the action itself, settledWhen, observe).

On timeout:
- Non-optional steps fail with a timeout error, and the step result includes failure context (visible elements, near matches, scroll position).
- Optional steps report `status: "skipped"` with the timeout noted in the error message.

### 10.5 Step Result Structure

Every executed step produces a result with:
- `action`: the action type that was executed (e.g., "click", "fill")
- `status`: `"ok"`, `"error"`, or `"skipped"` (for failed optional steps)
- `output`: action-specific output data (when applicable)
- `warning`: non-fatal issues (auto-force, intercepted clicks, settledWhen timeout)
- `error`: error message (when status is "error" or "skipped")
- `context`: failure diagnostics (when status is "error") including visible elements, near matches, and scroll position
- `observation`: return value from the observe hook (when present)

The command-level response aggregates step results and adds global context: screenshot path, viewport snapshot, full snapshot path, navigation status, and console output.


## 11. Observation & Data Extraction

The system provides a rich set of read-only operations that let agents understand page structure, locate elements, and extract data without modifying the page. These operations are designed to minimize round trips: agents can gather what they need in one or two calls rather than issuing many individual queries.

### 11.1 Snapshot (as a Step Action)

While section 7 covers the ARIA snapshot subsystem in depth, `snapshot` is also available as a step action within a command. When invoked as a step, it accepts the following options:

- **root**: A CSS selector that scopes the snapshot to a DOM subtree. When omitted, the system auto-scopes to the `<main>` landmark (if present) and includes a header listing other landmarks on the page.
- **detail**: Controls the level of detail. `summary` includes only landmarks and headings. `interactive` includes only interactive elements (buttons, links, inputs, etc.). `full` (the default) includes all elements.
- **mode**: When set to `ai`, elements are annotated with refs in the format `[ref=s{snapshotId}e{elementNumber}]`. These refs can be used with subsequent `click`, `fill`, `hover`, and other targeting operations.
- **maxDepth** and **maxElements**: Limits to prevent excessively large snapshots on complex pages. When the element limit is reached, the snapshot is truncated with a note.
- **includeText**: Whether to include text content nodes in the output.
- **includeFrames**: Whether to traverse and include content from same-origin iframes.
- **pierceShadow**: Whether to traverse shadow DOM boundaries and include shadow tree content.
- **viewportOnly**: Restricts the snapshot to elements currently visible in the viewport.
- **inlineLimit**: A byte threshold (default 9000 bytes) that determines whether the snapshot YAML is returned inline in the response or written to a file. When the snapshot exceeds this limit, it is saved to a temporary file and the response includes the file path instead. The refs map is similarly offloaded to a file when it exceeds 1000 entries.
- **preserveRefs**: When true (the default), new refs are merged into the existing ref map rather than replacing it. This ensures that refs from previous snapshots remain valid as long as their elements are still in the DOM.
- **since**: Accepts a snapshot ID string (e.g., `"s1"`). The system compares a hash of the current page content against the stored hash from the referenced snapshot. If the page has not changed, the response is `{unchanged: true, snapshotId, message}`, avoiding redundant snapshot generation.

The snapshot step increments the global snapshot ID counter, so each snapshot generation produces refs in a new `s{N}e{M}` namespace. Internal snapshots used for diffing or searching do not increment this counter.

### 11.2 Snapshot Search

The `snapshotSearch` step searches the accessibility tree without requiring the agent to take a full new snapshot. It generates a snapshot internally (without incrementing the snapshot ID) and walks the tree to find matching nodes.

**Query parameters:**

- **text**: A case-insensitive substring match against element names and values. Combined text of the name and value is searched.
- **pattern**: A regular expression (case-insensitive) matched against element names and values. Provides more precise matching than `text`.
- **role**: Filters results to elements with a specific ARIA role (e.g., `button`, `link`, `heading`).
- **exact**: When true, `text` must exactly match the element's name (rather than being a substring).
- **limit**: Maximum number of results to return (default 10).
- **context**: Number of parent levels to include for context (default 2). Each match includes the path of ancestor roles that led to it.
- **near**: A proximity filter object `{x, y, radius}` that restricts results to elements whose center is within `radius` pixels of the point `(x, y)`. Requires bounding box data in the snapshot tree.

**Return value:** `{matches[], matchCount, searchedElements, criteria}` where each match includes `path` (ancestor chain), `role`, `name`, and optionally `ref`, `value`, and `box`.

Refs returned from snapshot search are stored in the global ref map and persist across subsequent commands. This allows an agent to search for an element and immediately use its ref to interact with it.

### 11.3 Query

The `query` step finds elements using CSS selectors or ARIA role queries and returns information about them.

**CSS selector mode:** When passed a string or an object with a `selector` field, the step runs `querySelectorAll` and returns structured information about matching elements. Parameters:

- **selector**: CSS selector string (auto-trimmed to avoid whitespace issues).
- **limit**: Maximum number of results (default 10).
- **output**: Controls what data is returned per element. Modes include `text` (textContent, default), `html` (outerHTML), `href`, `value`, and `tag`. Can also be an array to return multiple outputs, or an object to request specific attributes.
- **clean**: When true, applies whitespace trimming to output values.
- **metadata**: When true, includes element metadata (tag, attributes, bounding box) alongside the output value.

**Return value:** `{selector, total, showing, results[]}` where `total` is the full match count and `showing` is the number returned (capped by `limit`). Each result has an `index` and `value`.

**Role query mode:** When the params object contains a `role` field, the step delegates to the role query executor. This finds elements by their ARIA role and accessible name. Supported roles include button, textbox, checkbox, link, heading, listitem, option, and combobox. Additional options:

- **name**: Filter by accessible name (substring match by default).
- **nameExact**: Use exact name matching instead of substring.
- **nameRegex**: Use a regular expression to match names.
- **level**: For headings, filter by heading level (1-6).
- **roles**: An array of roles for compound queries (find elements matching any of the listed roles).
- **countOnly**: When true, returns only the count without element details.

Role query results include refs that can be used for subsequent interactions.

### 11.4 Query All

The `queryAll` step executes multiple queries in a single operation. It accepts a map of labels to selectors (or query config objects) and returns results keyed by label. Each entry is executed as an independent `query` operation. This avoids the round-trip cost of issuing multiple separate query steps.

**Input:** `{"label1": "selector1", "label2": {selector: "...", limit: 5}, ...}`

**Return value:** `{"label1": {selector, total, showing, results[]}, "label2": {...}, ...}`

### 11.5 Inspect

The `inspect` step provides a lightweight page overview without generating a full accessibility snapshot. It returns:

- **title**: The page's document title.
- **url**: The current URL.
- **elements**: Counts of common element types -- `a`, `button`, `input`, `textarea`, `select`, `h1`, `h2`, `h3`, `img`, `form`.
- **custom** (optional): When the params include a `selectors` array, the step counts elements matching each custom selector. When a `limit` is also provided, it includes the text content of up to that many matched elements per selector.

This step is useful for quick orientation on a page before deciding whether to take a full snapshot.

### 11.6 Extract

The `extract` step pulls structured data from tables and lists on the page.

**Input:** A CSS selector (string) or an object with `selector`, `type`, and `limit` fields.

**Type detection:** When `type` is not specified, the system auto-detects the data structure by examining the matched element:
1. If the element is a `<table>`, or contains one, it extracts table data.
2. If the element is a `<ul>`, `<ol>`, or has `role="list"`, or contains such an element, it extracts list data.
3. If the element contains elements with `role="row"` or `<tr>`, it treats it as a table.
4. If the element contains `role="listitem"` or `<li>` elements, it treats it as a list.
5. If no structure is detected, an error is returned suggesting the agent specify a type explicitly.

**Table extraction** returns `{type: "table", headers[], rows[][], rowCount}`. Headers are extracted from `<thead>` or the first `<tr>`. Data rows are extracted from `<tbody>` or subsequent `<tr>` elements, up to the `limit` (default 100).

**List extraction** returns `{type: "list", items[], itemCount}`. Items are the trimmed text content of direct `<li>` or `[role="listitem"]` children.

The extraction runs in the current frame context, respecting any active `frame` switch.

### 11.7 getDom

The `getDom` step retrieves raw HTML from the page. It operates in two modes:

- **Full page:** When passed `true`, returns the entire `document.documentElement.outerHTML`.
- **Scoped:** When passed a CSS selector string, returns the HTML of the first matching element. An object form `{selector, outer}` is also accepted, where setting `outer: false` returns `innerHTML` instead of `outerHTML`.

**Return value:** `{html, tagName, selector, length}` where `length` is the character count of the returned HTML.

This step is a fallback for when the ARIA snapshot does not capture the information an agent needs (e.g., custom widgets without ARIA roles, or when raw markup inspection is required).

### 11.8 getBox

The `getBox` step retrieves bounding box information for elements identified by their snapshot refs.

**Input:** A single ref string, an array of ref strings, or an object `{ref}` or `{refs: [...]}`.

**Return value per ref:** `{x, y, width, height, center: {x, y}}` where coordinates are in viewport pixels and `center` is the computed midpoint.

**Error cases per ref:**
- `{error: "not found"}` -- the ref does not exist in the ref map.
- `{error: "stale", message}` -- the element has left the DOM.
- `{error: "hidden", box}` -- the element exists but is not visible (box is still provided).

When a single ref is provided, the result is returned directly (not wrapped in an object). When multiple refs are provided, results are keyed by ref string.

### 11.9 elementsAt

The unified `elementsAt` step provides coordinate-based element discovery with three shapes:

**Single point** (`{x, y}`): Identifies the element at a specific viewport coordinate and returns (or creates) a ref for it.

**Input:** `{x, y}` in viewport pixel coordinates.

**Return value:** `{ref, existing, tag, selector, clickable, role, name, box}` where:
- `existing` indicates whether the element already had a ref from a previous snapshot (true) or a new ref was created (false).
- `clickable` is a heuristic check based on tag name, ARIA role, `onclick` handler, or `cursor: pointer` style.
- `selector` is a generated CSS selector for the element.
- `box` contains `{x, y, width, height}`.

New refs are created in the current snapshot namespace and registered in the global ref map, making them immediately usable with `click`, `fill`, etc.

**Batch** (`[{x, y}, ...]`): Identifies elements at multiple viewport coordinates in a single round trip.

**Input:** An array of `{x, y}` coordinate objects.

**Return value:** `{count, elements[]}` where `count` is the number of coordinates that resolved to an element. Each element entry includes `x`, `y` (the queried coordinates), `ref`, `existing`, `tag`, `selector`, `clickable`, `role`, `name`, and `box`. Coordinates where no element was found include an `error` field instead.

**Nearby search** (`{x, y, radius}`): Finds all visible elements within a radius of a point, sorted by distance.

**Input:** `{x, y, radius, limit}` where `radius` defaults to 50 pixels and `limit` defaults to 20 elements.

**Return value:** `{center: {x, y}, radius, count, elements[]}` where each element includes `ref`, `existing`, `tag`, `selector`, `clickable`, `role`, `name`, `distance` (in pixels from the query point), and `box`.

Elements with `display: none`, `visibility: hidden`, or zero dimensions are excluded. Distance is calculated between the query point and the element's center. Results are sorted closest-first.

This step is valuable for spatial reasoning -- for example, finding what is near a known landmark, or discovering interactive elements in a region of the page.

### 11.10 Form State

The `formState` step inspects form fields without modifying them.

**Input:** A CSS selector targeting a `<form>` element (string or `{selector}`).

**Return value:** `{fields[], valid, fieldCount}` where each field includes:
- `name`, `type`, `label`, `value` (password values are masked), `required`, `valid`, `disabled`.

The `valid` top-level field indicates whether all fields pass HTML5 constraint validation.

### 11.11 Validate

The `validate` step checks the HTML5 validation state of a specific form element.

**Input:** A CSS selector string targeting the element to validate.

**Return value:** `{valid, message, validity}` where `message` is the browser's validation message (if any) and `validity` contains the individual validity state flags (valueMissing, typeMismatch, patternMismatch, etc.).

### 11.12 Submit

The `submit` step programmatically submits a form.

**Input:** A CSS selector string or `{selector}` targeting the form or a submit button within it.

**Return value:** `{submitted, valid, errors[]}` where `errors` contains validation error details if the form is invalid. When `valid` is false, the form is not submitted and the errors are reported so the agent can address them.

### 11.13 Assert

The `assert` step verifies conditions about the page and throws an error if any assertion fails, causing the step to report as failed.

**URL assertions:** `{url: {contains, equals, startsWith, endsWith, matches}}` where `matches` accepts a regular expression string. The actual URL is compared against the specified condition.

**Text assertions:** `{text: "expected", selector: "optional"}` checks that the text content of the targeted element (default `body`) includes the expected string. The `caseSensitive` option (default true) controls matching behavior.

**Return value on success:** `{passed: true, assertions[]}` where each assertion includes its type, expected/actual values, and pass status.

**Behavior on failure:** The step throws an error with descriptive messages for each failed assertion, including the actual values for debugging.

### 11.14 Console

The `console` step retrieves browser console messages captured during the session.

**Input:** `true` (for defaults) or an options object:
- **limit**: Maximum messages to return (default 50, returns the most recent).
- **level**: Filter by log level (e.g., `error`, `warning`, `info`).
- **type**: Filter by message type (`console` for API calls, `exception` for uncaught errors).
- **since**: A timestamp to filter messages -- only messages after this time are included.
- **stackTrace**: When true, includes call stack information for each message.
- **clear**: When true, clears the message buffer after retrieval.

**Return value:** `{total, showing, messages[]}` where each message has `level`, `text` (truncated to 500 characters), `type`, `url`, `line`, and `timestamp`. Stack traces, when requested, include function names, source URLs, and line/column numbers.

Console capture begins when the CDP session starts and does not persist across CLI invocations. Each invocation starts with an empty buffer.

**Automatic console reporting:** After every command (batch of steps), errors and warnings that occurred during step execution are automatically included in the response's `console` field. These are deduplicated and limited to new messages from the command's execution window.


## 12. Dynamic Execution

Standard steps cover most browser automation scenarios, but some situations require custom JavaScript execution in the browser. The dynamic execution steps provide three tiers of capability, from simple expression evaluation to zero-roundtrip operation pipelines.

### 12.1 pageFunction

The `pageFunction` step executes JavaScript in the browser context. It supports two modes: function expressions and bare expressions.

**Function mode** (primary): A function string or `{fn, refs, timeout}`.

- **fn**: A JavaScript function string. It is automatically wrapped as an IIFE for execution. Detected by strings starting with `(`, `function`, `async` keyword, or matching arrow function patterns (e.g., `x =>`).
- **refs**: When true, the function receives `window.__ariaRefs` as its argument, giving access to DOM elements identified by snapshot refs. This bridges the gap between the structured ref system and custom JavaScript logic.
- **timeout**: An optional millisecond timeout. If exceeded, the evaluation is aborted.

**Bare expression mode**: When the input string does not look like a function expression, it is treated as a bare JavaScript expression and evaluated directly. This also accepts `{expression, await, serialize, timeout}` where `expression` is an alias for `fn`.

- **await**: When true, the expression is expected to return a Promise and the result is awaited.
- **serialize**: When true (the default), the return value is processed through a serializer that handles special types.

Before evaluation, bare expressions are checked for common malformation patterns (unbalanced quotes, braces, parentheses) that typically indicate shell escaping problems. If detected, the error message includes a diagnostic tip.

**Return value serialization:** The return value is automatically serialized to handle types that are not natively JSON-safe. Special handling is applied for Date, Map, Set, DOM elements, NodeList, RegExp, Error, Infinity, NaN, undefined, and null. The serialized result includes a `type` discriminator and a `value`.

**Frame context:** The function or expression executes in the current frame context. If the agent has switched to an iframe via `frame`, it runs within that iframe.

**Error reporting:** When execution throws, the error message includes the exception description and a preview of the source string to aid debugging.

**Use cases:** Framework detection, complex DOM traversal, reading framework-specific state (e.g., React component props), custom data extraction patterns, and interactions with web APIs not covered by standard steps.

### 12.2 poll

The `poll` step repeatedly evaluates a predicate function until it returns a truthy value or a timeout is reached.

**Input:** A predicate function string or `{fn, interval, timeout}`.

- **fn**: A JavaScript function string that returns a value. Truthiness is checked using standard JavaScript semantics (excluding null, undefined, false, 0, and empty string).
- **interval**: Milliseconds between evaluations (default 100ms).
- **timeout**: Maximum time to poll (default 30000ms / 30 seconds).

**Return value:**
- On success: `{resolved: true, value, elapsed}` where `value` is the serialized truthy return value and `elapsed` is the time taken in milliseconds.
- On timeout: `{resolved: false, lastValue, elapsed}` where `lastValue` is the serialized result of the last evaluation.

The predicate is evaluated through the serializer, so its return value benefits from the same special-type handling as `pageFunction`.

**Use cases:** Waiting for dynamic content to load, animations to complete, API responses to populate the DOM, or any asynchronous condition that standard `wait` cannot express.

### 12.3 pipeline

The `pipeline` step compiles multiple micro-operations into a single JavaScript function that executes in one browser evaluation. This eliminates the per-step round-trip overhead for sequences of simple operations.

**Input:** An array of micro-operation objects, or `{steps: [...], timeout}`.

**Available micro-operations:**

- **`{find, fill}`**: Locates an element by CSS selector and sets its value. Uses the native property setter on the element's prototype (HTMLInputElement or HTMLTextAreaElement) to ensure React-compatible value setting, then dispatches `input` and `change` events.
- **`{find, click}`**: Locates an element by CSS selector and calls `.click()` on it.
- **`{find, type}`**: Locates an element by CSS selector, focuses it, and types text character-by-character, dispatching `keydown`, `keypress`, `input`, and `keyup` events for each character.
- **`{find, check}`**: Locates an element by CSS selector and sets its `checked` property, dispatching `input` and `change` events.
- **`{find, select}`**: Locates an element by CSS selector and sets its `value` property (for `<select>` elements), dispatching `input` and `change` events.
- **`{waitFor}`**: Polls a predicate function string (inline) at 100ms intervals with a configurable timeout (default 10 seconds). Blocks subsequent operations until the predicate returns truthy.
- **`{sleep}`**: Pauses execution for a specified number of milliseconds.
- **`{return}`**: Evaluates an expression function string and captures its return value in the results array.

**Execution:** All micro-operations are compiled into a single async IIFE and executed in one `Runtime.evaluate` call. Operations run sequentially within the function. A pipeline-level timeout (default 30 seconds) guards against infinite hangs.

**Return value:** `{completed: true, steps, results[]}` on success, or `{completed: false, failedAt, error, results[]}` on failure. The `failedAt` field identifies the zero-indexed step number that failed, and `results` contains the outcomes of steps that completed before the failure.

**Error specificity:** When an element is not found or a `waitFor` times out, the error message identifies the exact step index that failed.

**Use cases:** Filling and submitting a multi-field form in one shot, performing a sequence of clicks and waits without round trips, or any batch of simple DOM operations where latency matters.

### 12.4 Site Profiles

Site profiles are per-domain knowledge files stored at `~/.cdp-skill/sites/{domain}.md`. They capture what the agent has learned about a site -- framework, quirks, stable selectors, and interaction recipes.

**readSiteProfile:** Accepts a domain string or `{domain}`. Returns `{found: true, domain, content}` when a profile exists, or `{found: false, domain}` when it does not.

**writeSiteProfile:** Accepts `{domain, content}` where content is markdown text. The domain is sanitized for filesystem safety (stripping `www.` prefix and replacing special characters). Returns `{written: true, path, domain}`.

**Automatic profile loading:** Whenever a navigation occurs (via `goto`, `openTab` with a URL, or `connectTab`), the system checks for a profile matching the destination domain. If found, it is included in the response as `siteProfile`. If not found, the response includes `actionRequired` prompting the agent to create one.

The rationale for site profiles is to accumulate domain-specific knowledge across sessions, reducing repeated discovery work and avoiding known pitfalls.


## 13. Frames & Shadow DOM

Modern web applications frequently use iframes for embedded content and shadow DOM for encapsulated components. The system provides dedicated capabilities for both, ensuring that agents can interact with elements regardless of where they live in the document hierarchy.

### 13.1 Frame Discovery

The `frame` step with `{list: true}` returns the complete frame hierarchy of the page.

**Return value:** `{mainFrameId, currentFrameId, frames[]}` where each frame has:
- `frameId`: Unique identifier for the frame.
- `url`: The frame's current URL.
- `name`: The frame's name attribute (if set).
- `parentId`: The parent frame's ID (null for the main frame).
- `depth`: Nesting level (0 for main frame, 1 for direct children, etc.).
- `crossOrigin`: A flag indicating whether the frame is from a different origin than the main page.

**Cross-origin iframe discovery:** The standard CDP frame tree API (`Page.getFrameTree`) only returns same-origin frames because cross-origin iframes live in separate renderer processes. To provide a complete picture, the system supplements the CDP tree by querying the main frame's DOM for all `<iframe>` elements and testing whether their `contentDocument` is accessible. Inaccessible iframes are marked as `crossOrigin: true` and appended to the frame list with synthetic frame IDs.

`currentFrameId` indicates which frame is currently active (i.e., where subsequent commands will execute).

### 13.2 Frame Switching

**`frame: "selector"`** or **`frame: {selector}` / `{index}` / `{name}` / `{frameId}`**: Enters an iframe context. Accepts multiple identifier formats:
- **CSS selector string** (e.g., `"iframe.embed"`): Finds the iframe element in the DOM, then locates its corresponding frame in the CDP frame tree.
- **Index number** (e.g., `frame: 0`): Selects the Nth child frame (zero-indexed).
- **Object**: `{selector}`, `{index}`, `{name}`, or `{frameId}` for explicit identification.

Once switched, all subsequent operations -- click, fill, snapshot, pageFunction, extract, and all other steps that evaluate JavaScript -- execute within the iframe's execution context. This is achieved by including the frame's `contextId` in every `Runtime.evaluate` call.

**Cross-origin frame warning:** When switching to a cross-origin iframe, the system detects the origin mismatch and emits a warning in the response. Due to browser security restrictions, JavaScript cannot directly access the cross-origin iframe's DOM. The system creates an isolated world in the frame to enable limited interaction, but not all operations may work reliably.

**Isolated world creation:** If no execution context exists for the target frame (which happens with cross-origin frames or frames that have recently navigated), the system creates an isolated world via `Page.createIsolatedWorld`. This context is cached for reuse.

**`frame: "top"`**: Returns to the top-level frame, resetting the execution context to the main frame. All subsequent operations execute in the main document.

**Frame context propagation:** The current frame's execution context ID is propagated via dependency injection to all modules that perform `Runtime.evaluate` calls. A `getFrameContext()` function returns the context ID when in a non-main frame, or null when in the main frame. This ensures consistent frame-aware behavior across the element locator, ARIA snapshot generator, click executor, and other subsystems.

### 13.3 Cross-Frame Element Search

When an agent needs to find an element but does not know which frame it is in, the system provides a cross-frame search capability. The `click` step supports this when explicitly requested. The search:

1. First checks the current frame (typically the main frame).
2. If not found, iterates through all child frames in the CDP frame tree.
3. For each frame, obtains or creates an execution context and evaluates a `querySelector` call.
4. Returns the first frame where the element is found, along with the element's object ID and the frame's URL.
5. Restores the original frame context after the search, regardless of the outcome.

### 13.4 Shadow DOM

Shadow DOM creates encapsulated subtrees that are invisible to standard DOM queries from the light DOM. The system handles shadow DOM at multiple levels:

**Snapshot piercing:** When the `pierceShadow` option is enabled on a snapshot, the ARIA tree generator traverses shadow root boundaries and includes shadow DOM content in the output. Elements inside shadow DOM receive refs just like light DOM elements.

**Shadow host path tracking:** When a ref is assigned to an element inside shadow DOM, the system records the chain of shadow host selectors that must be traversed to reach that element from the document root. For example, if an element is inside `custom-component > inner-widget`, the stored path would be the CSS selectors for each shadow host in order.

**Ref re-resolution for shadow DOM elements:** When a ref's element becomes stale (disconnected from the DOM, typically due to re-rendering), the system attempts to re-find it using the stored metadata:

1. **Selector + shadow path:** If a shadow host path was stored, it walks the chain -- querying each shadow host's selector, entering its shadow root, and finally querying for the target element's selector within the deepest shadow root. The candidate is verified against the stored role and accessible name.
2. **Role-based search in shadow path:** If the exact selector fails, the system queries all elements matching the stored role's tag selector(s) within the known shadow root and checks each candidate's role and name.
3. **Broad shadow root search:** As a last resort (when no shadow host path was stored), the system collects all shadow roots in the entire document and searches each one for matching elements.

**Design rationale:** Shadow DOM is increasingly common in web component-based applications. Without explicit shadow DOM support, agents would be unable to interact with elements inside frameworks like Lit, Shoelace, or Salesforce Lightning. The shadow host path approach balances reliability with performance -- it avoids expensive full-document scans in the common case while still providing fallback options.


## 14. Viewport Diffing & Change Detection

After executing a batch of steps, the system automatically compares the page state before and after to detect what changed. This gives agents immediate feedback about the effects of their actions without requiring them to take a new snapshot.

### 14.1 Diff Mechanism

The diff operates on viewport-scoped ARIA snapshots:

1. **Before capture:** Immediately before step execution begins, the system captures a viewport-only ARIA snapshot. This snapshot is internal -- it does not increment the snapshot ID counter and does not overwrite the agent's refs. It preserves existing refs to avoid invalidating previously assigned references.

2. **After capture:** After all steps in the command complete, the system captures another viewport-only snapshot with the same constraints (internal, preserving refs).

3. **Comparison:** The two snapshots are compared by parsing each YAML line that contains a ref. Each ref-bearing line is indexed into a map keyed by the ref string, with the element's role, name, and state attributes (checked, expanded, disabled, selected, pressed, required, readonly, focused) extracted.

4. **Change categorization:**
   - **Added:** Refs present in the after-snapshot but absent from the before-snapshot. These represent new elements that appeared in the viewport.
   - **Removed:** Refs present in the before-snapshot but absent from the after-snapshot. These represent elements that left the viewport (scrolled away, hidden, or removed from the DOM).
   - **Changed:** Refs present in both snapshots but with different state attributes. Each change records the specific field, its previous value, and its new value. Common state changes include expanded/collapsed toggles, checkbox checked/unchecked, and focus shifts.

### 14.2 Output Format

When significant changes are detected, the response includes a `changes` field:

- **summary**: A human-readable sentence describing the changes, prefixed with an action context (e.g., "Clicked. 3 added (s1e5, s1e6, s1e7). 1 removed (s1e2). 2 expanded/collapsed (s1e3, s1e4)."). The action context is derived from the step types in the command (e.g., "Scrolled", "Clicked", "Typed").
- **added[]**: Up to 10 YAML lines representing new elements.
- **removed[]**: Up to 10 YAML lines representing removed elements.
- **changed[]**: Up to 10 change records, each with `ref`, `field`, `from`, and `to` values.

Changes include refs, allowing agents to immediately reference newly appeared elements in subsequent commands.

The `changes` field is omitted entirely when there are no significant changes (no additions, removals, or state changes). Minor content updates that do not affect the element structure are not reported.

### 14.3 Navigation Detection

The system tracks whether the URL changed during step execution to determine if the page navigated:

- **Comparison:** The URL's origin, pathname, and search parameters from before and after are compared.
- **Hash-only changes** (e.g., navigating to `#section`) are NOT considered navigation, since the page content typically remains the same.
- **When navigation is detected:** The response includes `navigated: true` and the viewport diff is skipped entirely, since comparing snapshots across different pages is not meaningful.
- **When navigation is not detected:** The diff is computed and included if significant changes exist.

If either the before or after URL is unavailable (e.g., during page crashes), navigation is assumed.

### 14.4 Context Capture

After steps complete, the system captures comprehensive page context that appears in the response's `context` field:

- **url**: The current page URL.
- **title**: The document title.
- **scroll**: `{y, percent}` where `y` is the vertical scroll offset in pixels and `percent` is the scroll position as a percentage of the maximum scrollable height (0 at top, 100 at bottom).
- **viewport**: `{width, height}` in pixels.
- **activeElement** (present only when a non-body element has focus): Includes `tag`, `selector` (auto-generated CSS selector), `box` (bounding rectangle), `editable` (whether the element accepts text input), and for input elements: `type`, `value`, and `placeholder`.
- **modal** (present only when a dialog is detected): The dialog's title, derived from `aria-label`, a heading element within the dialog, or the fallback string "Dialog". Detection covers `<dialog open>`, `[role="dialog"][aria-modal="true"]`, and `[role="alertdialog"]` elements that are visible.

This context is captured on every command, providing agents with a consistent picture of the page state without requiring explicit observation steps. The combination of context, viewport snapshot, and changes gives agents enough information to decide their next action in most cases.

### 14.5 Post-Command Artifacts

In addition to the diff and context, the system produces two snapshot artifacts after every command:

- **fullSnapshot**: A full-page (not viewport-limited) ARIA snapshot saved to a temporary file. The file path is included in the response. This allows agents to inspect the complete page structure when needed, without the inline size constraint.
- **viewportSnapshot**: An inline YAML string of the viewport-only snapshot. This is always included in the response, providing immediate visibility into what the agent would see on screen.

Both snapshots are generated with `preserveRefs: true` and as internal snapshots (no snapshot ID increment), ensuring they do not interfere with the agent's ref management.


## 15. Site Profiles

Site profiles are per-domain knowledge bases that agents build over time to improve automation reliability on previously-visited websites.

### 15.1 Purpose and Rationale

Every website has unique characteristics that affect automation reliability: cookie consent banners that block clicks, SPA routing that breaks traditional navigation detection, React-controlled inputs that ignore native DOM events, custom form widgets with non-standard behavior, and overlay dialogs that intercept interactions. An agent encountering these quirks for the first time will waste multiple round trips discovering them through trial and error.

Site profiles solve this by capturing domain-specific knowledge in a persistent, human-readable format. Once an agent learns that a site uses React with synthetic events, or that a cookie banner must be dismissed before any interaction, that knowledge is stored and automatically surfaced to any future agent visiting the same domain. This turns first-visit failures into first-visit successes.

### 15.2 Storage and Domain Resolution

Profiles are stored as markdown files at `~/.cdp-skill/sites/{domain}.md`. The directory is created on demand when the first profile is written.

Domain normalization rules:
- The `www.` prefix is stripped before matching or storing (e.g., `www.github.com` and `github.com` resolve to the same profile)
- Non-alphanumeric characters (other than `.` and `-`) are replaced with underscores for filesystem safety
- Domain matching is case-insensitive in practice due to URL normalization

### 15.3 Profile Lifecycle

#### Automatic Profile Lookup on Navigation

Every navigation action that targets a URL -- `goto`, `openTab` with a URL, and `connectTab` -- triggers an automatic profile lookup for the target domain. The outcome appears as a top-level field in the command response:

- **`siteProfile` present**: The full markdown content of an existing profile is returned. The agent should read it before interacting with the page, applying any documented strategies, quirks, and hooks.
- **`actionRequired` present**: No profile exists for this domain. The response includes an `actionRequired` object with:
  - `action`: `"createSiteProfile"`
  - `domain`: the normalized domain name
  - `message`: a mandatory instruction to stop and create a profile

#### Mandatory Profile Creation

When `actionRequired` is present, the agent **must** stop its current task and create a profile before doing anything else. This is enforced at the prompt level -- SKILL.md instructs agents that `actionRequired` responses are mandatory and must be handled immediately. The system does not programmatically block further actions, but agents that skip profile creation will experience degraded reliability.

The recommended profile creation flow:
1. `snapshot` -- understand the page structure, landmarks, and interactive elements
2. `pageFunction` -- detect the site's technology stack (React, Next.js, Vue, Angular, etc.) by probing for framework-specific globals
3. `writeSiteProfile` -- save the gathered knowledge as markdown

#### Profile Updates

After completing a task on a site, agents should update the profile with any new discoveries: quirks encountered, reliable selectors found, multi-step recipes that worked, or timing strategies that resolved flakiness. The `writeSiteProfile` step overwrites the entire profile, so agents must read the existing content first and merge their additions.

### 15.4 Profile Content Structure

Profiles are freeform markdown, but follow a recommended structure with five sections (all optional -- include only what is useful):

- **Environment**: Technology stack (framework, version), SPA behavior, main content area selectors, significant third-party integrations
- **Quirks**: Pitfalls that cause automation failures without foreknowledge. Examples: "cookie banner blocks all clicks until dismissed", "search results load asynchronously after 500ms delay", "form submission uses fetch, not traditional navigation"
- **Strategies**: Site-specific approaches for fill, click, or wait operations. Includes `settledWhen` and `readyWhen` hook expressions that agents should use when interacting with the site
- **Regions**: Stable landmark selectors for major page areas (navigation, main content, sidebar, footer) that survive across page updates
- **Recipes**: Pre-built step sequences for common flows such as login, search, add-to-cart, or checkout. These spare future agents from re-discovering multi-step workflows

### 15.5 Profile Operations

#### readSiteProfile

Reads a profile without requiring navigation or a browser session.

Input: `"domain"` (string) or `{domain: "domain"}`

Output on success:
```json
{"found": true, "domain": "github.com", "content": "# github.com\nUpdated: ..."}
```

Output when no profile exists:
```json
{"found": false, "domain": "github.com"}
```

#### writeSiteProfile

Creates or overwrites a profile for a domain.

Input: `{domain: "github.com", content: "# github.com\n..."}`

Output:
```json
{"written": true, "path": "/Users/name/.cdp-skill/sites/github.com.md", "domain": "github.com"}
```

Both `domain` and `content` are required. An error is returned if either is missing.

#### loadSiteProfile (internal)

Used internally during navigation to check for an existing profile. Returns the markdown content as a string, or `null` if no profile exists. This is not exposed as a step -- it runs automatically as part of `goto`, `openTab`, and `connectTab` handling.


## 16. Failure Diagnostics

When steps fail, the system captures rich diagnostic information to help agents self-correct without additional round trips. The diagnostics are designed to answer the questions an agent would ask after a failure: "What page am I on?", "What can I interact with?", and "Did I target the wrong element?"

### 16.1 Error Classification

Errors are classified into four top-level types, reported in the `error.type` field of error responses:

| Type | Meaning | When It Occurs |
|------|---------|----------------|
| **PARSE** | Invalid JSON input | Input is empty, not valid JSON, or not a JSON object |
| **VALIDATION** | Structural errors in the command | Missing `steps` array, empty steps, multiple actions per step, invalid parameter combinations |
| **CONNECTION** | Cannot communicate with Chrome | Chrome not running, cannot attach to specified tab, session lost during execution |
| **EXECUTION** | A step failed during execution | Element not found, timeout, page crash, navigation failure, or any runtime error |

The process exit code reflects the overall status: `0` for success, `1` for any error.

### 16.2 Specific Error Subtypes

Within the EXECUTION category, errors carry specific names that identify the exact failure mode:

| Subtype | Meaning |
|---------|---------|
| **NavigationError** | URL navigation failed (DNS resolution, connection refused, invalid URL scheme) |
| **NavigationAbortedError** | Navigation was superseded by another navigation before completing |
| **TimeoutError** | Operation exceeded its time limit (step timeout or actionability timeout) |
| **ElementNotFoundError** | Could not locate an element by the given selector, ref, or text |
| **ElementNotEditableError** | Element was found but cannot receive input (readonly attribute, wrong input type such as checkbox or file, disabled state) |
| **StaleElementError** | An element reference is no longer valid because the element was removed from the DOM, and automatic re-resolution failed |
| **PageCrashedError** | The browser tab crashed during the operation |
| **ContextDestroyedError** | The JavaScript execution context was destroyed, typically because the frame navigated away or an iframe was removed |
| **StepValidationError** | Step-level parameter validation failed (distinct from command-level VALIDATION errors) |

Context destruction is detected by matching against known CDP error message patterns, including "Cannot find context with specified id", "Execution context was destroyed", and "Inspected target navigated or closed".

Stale element detection uses a similar pattern-matching approach against CDP error messages such as "Could not find object with given id", "Node with given id does not belong to the document", and related variants.

### 16.3 Failure Context

When a step fails, the response includes a `context` object attached to the failed step with diagnostic information gathered from the live page state. All context gathering is best-effort -- if any individual piece fails to collect (e.g., because the page crashed), it is omitted or set to an empty value rather than causing a secondary error.

The failure context includes:

**Page state:**
- `title`: current document title
- `url`: current page URL
- `scrollPosition`: current scroll coordinates (`x`, `y`), maximum scrollable height (`maxY`), and scroll percentage (`percentY`)

**Visible interactive elements:**
- `visibleButtons`: up to 8 visible buttons on the page, each with `text` (truncated to 50 characters), `selector` (best available CSS selector), and `ref` (if the element has an aria ref from a previous snapshot). This helps agents find alternative click targets.
- `visibleLinks`: up to 5 visible links with `text` (truncated to 50 characters) and `href` (truncated to 100 characters)

**Error indicators:**
- `visibleErrors`: up to 3 visible error or alert messages found by searching for elements matching `.error`, `.alert`, `.warning`, `.message`, `[role="alert"]`, `[role="status"]`, `.toast`, and `.notification`. Only visible elements with non-empty text content are included.

**Near matches (conditional):**
When the failure involves a selector or text that was not found, the system searches for elements that approximately match the search term and returns them as `nearMatches` (up to 5). Each near match includes:
- `text`: the element's text content (truncated to 50 characters)
- `selector`: best available CSS selector
- `ref`: aria ref if available
- `score`: similarity score on a 0-100 scale:
  - **100**: exact match (case-insensitive)
  - **80**: search term is contained within the element's text
  - **70**: element's text is contained within the search term (and element text is longer than 2 characters)
  - **50**: at least one word from the search term appears in the element's text (word must be longer than 2 characters)

Near match search covers buttons, links, inputs, and elements with interactive ARIA roles (`button`, `link`, `tab`, `menuitem`). Only visible elements are considered.

### 16.4 Step-Level Error Reporting

Failed steps in the `steps[]` array include additional fields beyond the usual `action` and `status`:
- `params`: the original parameters passed to the step, enabling the agent to see exactly what was attempted
- `error`: the error message describing what went wrong

At the command level, the `errors[]` array (present only when errors occurred) provides a summary of all failures with `step` (1-indexed step number), `action` (the step type), and `error` (the error message).

When `stopOnError` is `true` (the default), execution halts at the first failed step unless that step is marked `optional: true`. Optional steps that fail receive a status of `"skipped"` and do not trigger the stop-on-error behavior.


## 17. Capture and Output

The system captures several categories of output during command execution: screenshots, console messages, PDF documents, network activity, debug logs, and I/O metrics. Each serves a distinct purpose in the agent feedback loop.

### 17.1 Screenshots

#### Automatic Capture

A screenshot is automatically taken after every command completes (after all steps have executed), regardless of success or failure. This provides the agent with visual confirmation of the page state after its actions.

The screenshot is saved to the OS temp directory at `$TMPDIR/cdp-skill/{tabAlias}.after.png`, where `tabAlias` is the tab's short identifier (e.g., `t1`). The path is returned in the `screenshot` field of the command output.

Screenshot capture is non-fatal: if the capture fails for any reason (page crashed, tab closed, filesystem error), the `screenshot` field is omitted from the output and the command's overall status is unaffected.

#### Capture Modes

- **Viewport** (default for automatic screenshots): captures only the visible browser viewport
- **Full page**: captures the entire scrollable page content by measuring the full content dimensions and using a clip region that extends beyond the viewport
- **Region**: captures a specific rectangular area defined by `x`, `y`, `width`, `height` coordinates
- **Element**: captures a specific element by its bounding box, with optional padding around the element

#### Format and Quality

- **Formats**: PNG (default), JPEG, WebP
- **Quality**: configurable for JPEG and WebP (0-100 scale); not applicable to PNG
- **Transparent background**: supported via the `omitBackground` option, which temporarily overrides the page background to transparent
- **Dimension limits**: maximum 16,384 pixels per dimension for full-page captures; pages exceeding this limit produce an error suggesting viewport or region capture instead

### 17.2 Console Capture

Browser console messages are captured throughout command execution by listening to CDP `Runtime.consoleAPICalled` and `Runtime.exceptionThrown` events.

**Message types captured:**
- Console API calls: `log`, `debug`, `info`, `error`, `warning`, `dir`, `table`, `trace`, `assert`, `count`, `timeEnd`
- Uncaught exceptions with stack traces

**Output behavior:**
- Only errors and warnings are included in the command-level `console` field of the output, keeping the response compact
- The `console` step allows agents to explicitly read all captured messages, with filtering by level and a configurable limit
- The `console` step also supports clearing the message buffer
- Maximum buffer size: 10,000 messages (oldest messages are dropped when the limit is reached)

**Message format:**
Each captured message includes: type (`console` or `exception`), level (`log`, `debug`, `info`, `error`, `warning`), text content (formatted from CDP remote object arguments), optional stack trace, and CDP timestamp.

### 17.3 PDF Generation

The `pdf` step generates a PDF document from the current page content using Chrome's built-in print-to-PDF capability.

**Configurable options:**
- Orientation: portrait (default) or landscape
- Scale: 0 to 1+ (default 1)
- Page ranges: specific pages to include (e.g., `"1-3"`)
- Margins: top, bottom, left, right (default 0.4 inches each)
- Paper size: width and height in inches (default 8.5 x 11, US Letter)
- Header/footer: custom HTML templates with display toggle
- Background printing: enabled by default
- CSS page size preference: honor `@page` CSS rules

**Output:**
The generated PDF is saved to the specified path (or temp directory if only a filename is given). The response includes:
- `path`: absolute path to the saved PDF file
- `pages`: page count (extracted from PDF structure)
- File size information
- Optional structural validation (checks PDF header, EOF marker, cross-reference table)

### 17.4 Network Capture

Network activity is tracked during command execution by listening to CDP `Network.requestWillBeSent`, `Network.loadingFailed`, `Network.responseReceived`, and `Network.loadingFinished` events.

**Primary uses:**
- **Network idle detection**: navigation wait conditions (`networkidle`) use pending request counts to determine when the page has finished loading
- **Network settle**: a best-effort post-action wait that monitors for network quiet periods (300ms idle window, 2s maximum wait)
- **Failed request tracking**: network failures (DNS errors, connection refused, CORS blocks) and HTTP errors (4xx/5xx responses) are recorded

**Capacity limits:**
- Maximum 10,000 pending requests tracked simultaneously (oldest dropped when exceeded)
- Stale request cleanup runs periodically (requests older than 5 minutes are purged)

Network errors are not directly exposed as a step output, but surface indirectly through console error messages and page failure context.

### 17.5 Debug Logging

Debug logging is an opt-in diagnostic mode activated by the `--debug` CLI flag. When enabled:

- A `log/` directory is created in the current working directory
- Each command execution writes a JSON file containing the full request and response
- Filenames follow the pattern `{sequence}-{tabAlias}-{actions}.{status}.json`
  - `sequence`: zero-padded 3-digit number, auto-incrementing based on existing files
  - `tabAlias`: the tab ID (e.g., `t1`), if available
  - `actions`: up to 3 action names from the steps, with a `plusN` suffix if more steps exist
  - `status`: `ok` or `error`
- Example: `001-t1-goto-click-fill.ok.json`

Debug logs include a timestamp and the complete request/response pair, providing a full audit trail for troubleshooting. Debug logging failures are silently ignored to avoid disrupting the primary operation.

### 17.6 I/O Metrics

When the `CDP_METRICS_FILE` environment variable is set to a file path, the system appends a JSONL (one JSON object per line) metrics entry after each command execution.

Each metrics line contains:
- `ts`: ISO 8601 timestamp
- `input_bytes`: byte size of the JSON input
- `output_bytes`: byte size of the JSON output
- `steps`: number of steps in the command
- `time_ms`: total execution time in milliseconds

This is used by the cdp-bench evaluation system to measure I/O efficiency and track performance trends. The metrics directory is created on demand if it does not exist. Metrics write failures are silently ignored -- they never affect command execution or output.

### 17.7 Value Serialization

When agents execute custom JavaScript in the browser via `pageFunction` or `poll`, the return values must be serialized to cross the browser-to-Node.js boundary. The system provides automatic serialization that handles types beyond what JSON natively supports:

**Primitive types**: `null`, `undefined`, `boolean`, `number` (including `NaN`, `Infinity`, `-Infinity`), `string`, `bigint`, `symbol`, and `function` (with truncated source representation).

**Built-in objects**: `Date` (ISO string + timestamp), `Map` (entries, limited to 50), `Set` (values, limited to 50), `RegExp` (string representation), `Error` (name, message, truncated stack).

**DOM types**: `Element` (tag, id, class, attributes, text content, connection state, child count), `NodeList`/`HTMLCollection` (items limited to 20), `Document` (title, URL, ready state), `Window` (location, dimensions).

**Compound types**: Arrays (recursively serialized, limited to 100 items) and plain objects (recursively serialized, limited to 50 keys). Both include a `truncated` flag when limits are exceeded.

Each serialized value includes a `type` field identifying the JavaScript type, enabling agents to interpret results correctly even for non-JSON-native types.


## 18. Configuration and Environment

### 18.1 Command Configuration

Each command accepts these top-level fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tab` | string | (none) | Tab alias or target ID to connect to. Required after the initial `openTab` call |
| `timeout` | number | `30000` | Step timeout in milliseconds |
| `steps` | array | (required) | Array of step objects to execute |

Connection parameters (host, port, headless) are no longer top-level fields. They are specified via `openTab` object form for non-default Chrome connections: `{"steps":[{"openTab":{"url":"...","port":9333,"headless":true}}]}`. The tab registry stores `{ targetId, host, port }` per alias, so subsequent commands just use `tab` and the correct connection is resolved automatically.

The legacy `config` object is no longer supported. Passing it returns a validation error with migration instructions.

### 18.2 Environment Variables

| Variable | Purpose |
|----------|---------|
| `CHROME_PATH` | Override the Chrome/Chromium executable path for auto-launch. Used when Chrome is installed in a non-standard location. |
| `CDP_METRICS_FILE` | Path for appending I/O metrics in JSONL format. When set, each command appends one line of metrics data. Used by the evaluation system. |

### 18.3 Timeout Architecture

The system uses multiple timeout levels, each serving a different purpose:

| Timeout | Default | Configurable | Purpose |
|---------|---------|-------------|---------|
| **Step timeout** | 30s | Yes, via top-level `timeout` | Maximum time for any single step to complete |
| **Actionability timeout** | 5s | No (hardcoded) | Maximum time to wait for an element to become actionable (visible, enabled, stable). Intentionally shorter than step timeout for faster feedback -- when actionability times out, auto-force may retry |
| **Navigation timeout** | (step timeout) | Indirectly | Uses the step-level timeout for page load waits |
| **Network idle** | 500ms | No | Idle window duration for `networkidle` wait condition |
| **Network settle** | 2s max, 300ms idle | No | Best-effort post-action network quiet detection. Never throws -- it is a courtesy wait that accepts incomplete quieting |
| **Maximum timeout** | 300s (5 min) | No | Absolute upper bound. Any configured timeout exceeding this is clamped |

### 18.4 File System Paths

The system uses several well-known file paths for persistent and transient data:

| Path | Purpose | Persistence |
|------|---------|-------------|
| `$TMPDIR/cdp-skill-tabs.json` | Tab registry mapping aliases to CDP target IDs | Transient (survives across commands, cleared on OS reboot) |
| `$TMPDIR/cdp-skill/{tabAlias}.after.png` | Auto-captured screenshot after each command | Overwritten each command |
| `$TMPDIR/cdp-skill/{tabAlias}.after.yaml` | Full accessibility snapshot (when too large for inline) | Overwritten each command |
| `~/.cdp-skill/sites/{domain}.md` | Site profiles | Persistent across sessions |
| `./log/{seq}-{tab}-{actions}.{status}.json` | Debug logs (only when `--debug` is active) | Persistent in working directory |
| `$TMPDIR/chrome-cdp-profile-{port}/` | Chrome user data directory for auto-launched instances | Transient |
| `$TMPDIR/cdp-skill/debug-captures/` | Debug capture screenshots and DOM dumps | Transient |

### 18.5 Device Presets

The system includes 40+ preconfigured device presets for responsive testing via the `viewport` step. Presets can be specified by name (case-insensitive, underscores converted to hyphens).

**Categories:**

- **iPhones** (SE through 15 Pro Max): 375-430px width, 3x scale factor, mobile + touch
- **iPads** (mini, Air, Pro 11", Pro 12.9"): 768-1024px width, 2x scale factor, mobile + touch
- **Android phones** (Pixel 5-7, Galaxy S21-S23): 360-412px width, varying scale factors, mobile + touch
- **Android tablets** (Galaxy Tab S7): 800px width, 2x scale factor, mobile + touch
- **Desktops** (generic, HD, 4K, laptop, MacBook variants): 1366-3840px width, 1-2x scale factor, no mobile/touch
- **Landscape variants**: available for select phone and tablet presets, with width and height swapped

Each preset defines: `width`, `height`, `deviceScaleFactor`, `mobile` (boolean), `hasTouch` (boolean), and optionally `isLandscape` (boolean).

Custom viewports can also be specified as objects with `width` and `height` (required) plus optional `deviceScaleFactor`, `mobile`, `hasTouch`, and `isLandscape` fields.

### 18.6 Input Handling

The CLI accepts input in two ways, with argument-based input preferred for cross-platform compatibility:

1. **Command-line argument** (preferred): `node src/cdp-skill.js '{"steps":[...]}'`
2. **Standard input** (fallback): `echo '{"steps":[...]}' | node src/cdp-skill.js`

When stdin is a TTY (interactive terminal) with no piped data, the system immediately proceeds without waiting for input. A 100ms timeout guards against edge cases where stdin availability is ambiguous.

The `--debug` flag can appear anywhere in the arguments and is stripped before JSON parsing.

### 18.7 Tab Registry

Tab aliases (e.g., `t1`, `t2`) provide stable, short identifiers for browser tabs that persist across CLI invocations. The registry is stored as JSON at `$TMPDIR/cdp-skill-tabs.json`.

**Registry format:**
Each entry maps an alias to `{ targetId, host, port }`. This allows subsequent commands to resolve the correct Chrome instance from just the alias. For backward compatibility, the system handles stale registry files that contain plain string entries (targetId only) by defaulting to `localhost:9222`.

**Alias assignment:**
- New tabs created via `openTab` are automatically registered with `{ targetId, host, port }` and assigned the next available alias (`t{nextId}`)
- Tabs connected via `connectTab` are registered if not already aliased
- Existing tabs attached via top-level `tab` are registered on first use

**Alias resolution:**
- Short aliases (e.g., `t1`) are resolved to full `{ targetId, host, port }` entries via the registry
- Full 32-character hex target IDs are used as-is with default host/port
- Unrecognized aliases are passed through as-is (allowing direct target ID use)

**Lifecycle:**
- Aliases are removed when a tab is closed via `closeTab`
- The registry is not automatically cleaned of stale entries pointing to tabs that were closed outside the system
- The `nextId` counter only increments, never reuses IDs


## 19. Known Limitations and Edge Cases

This section documents known limitations, important edge cases, and areas where the system's behavior diverges from ideal. It is informed by real-world testing, the cdp-bench evaluation system, and the project's issue tracker.

### 19.1 Cross-Origin Iframes

JavaScript cannot access the DOM content of cross-origin iframes due to browser same-origin policy enforcement. The system detects cross-origin iframes (via `frame: {list: true}`) and tags them with `crossOrigin: true`, but actions targeting elements inside these iframes will fail via normal selectors and refs. While `frame` can switch to a cross-origin frame's execution context for JavaScript evaluation, DOM queries from the parent frame cannot cross the origin boundary.

### 19.2 Alert, Confirm, and Prompt Dialogs

JavaScript `alert()`, `confirm()`, and `prompt()` dialogs block the browser's JavaScript execution thread. While CDP provides `Page.javascriptDialogOpening` events for handling these dialogs, the current handling has known gaps. Evaluation testing (test 033-alerts) has shown dialog interactions to be a weakness area.

### 19.3 Shadow DOM Re-Resolution

Element references store a `shadowHostPath` to enable re-resolution through shadow DOM boundaries. However, deeply nested shadow DOM (3+ levels) may have unreliable ref re-resolution because intermediate shadow roots can be reconstructed by framework re-renders, invalidating the stored host path. When shadow path traversal fails, the system falls back to a document-wide search across all shadow roots, which is less precise and may match the wrong element if multiple elements share the same role and name.

### 19.4 Network Settle vs. Network Idle

The system provides two distinct network waiting strategies:

- **Network idle** (used by `goto` with `waitUntil: "networkidle"`): waits for a 500ms window with zero pending requests. Blocks until achieved or timeout.
- **Network settle** (used automatically after navigation and before snapshots): best-effort wait with a 2s maximum and 300ms idle window. Never throws an error.

Sites with persistent connections (WebSockets, Server-Sent Events, long-polling, analytics heartbeats) will never truly reach "network idle". The settle approach is intentionally lenient -- agents should not be blocked by background network activity that is unrelated to page rendering.

### 19.5 Framework-Specific Input Handling

React's synthetic event system intercepts native DOM events, which means standard CDP input dispatch may not trigger React state updates. The `fill` action includes React-specific handling that uses native property setters followed by synthetic event dispatch.

Other frameworks (Angular, Vue, Svelte) may have similar event system quirks. The system does not have built-in handling for all frameworks. Site profiles are the primary mechanism for capturing framework-specific strategies per site -- agents should document what works and what does not.

Additionally, keyboard shortcuts with modifiers (`Meta+k`, `Control+Shift+P`) may not trigger SPA event handlers that listen at the document level. CDP dispatches key events to the focused element, but some SPAs use global event listeners that expect events to originate from specific targets.

### 19.6 Snapshot Size on Large Pages

Very large pages (thousands of DOM elements) can produce accessibility snapshots that exceed useful sizes. Several mechanisms control this:

- `maxElements` and `maxDepth` parameters limit tree traversal
- Auto-scoping to the `<main>` element (when present) filters out persistent chrome (headers, footers, navigation) that adds noise without useful information. Agents can opt out with `{root: "body"}`
- Snapshots exceeding a configurable inline limit (default 9KB) are automatically saved to a file, with the file path returned instead of inline content

Open issues in this area include: viewport snapshots that include fixed/sticky navigation in every response (issue 9.6), accessible names not truncated for elements with very long text content (issue 9.4), and summary mode including all refs inline (issue 9.3). These contribute to unnecessarily large response payloads.

### 19.7 Tab Accumulation

If agents do not close their tabs when finished, tabs accumulate in the browser instance. The tab registry (`$TMPDIR/cdp-skill-tabs.json`) grows with stale entries that may point to tabs already closed by other means. There is no automatic garbage collection of stale tab entries or orphaned browser tabs.

Best practice: agents should always close their tabs via `closeTab` when done, and include `tab` at the top level to reuse existing tabs rather than creating new ones each invocation.

### 19.8 Concurrent Multi-Agent Access

Multiple agents can share the same Chrome instance by connecting to the same debugging port. Tab aliases prevent naming conflicts -- each agent uses its own tab alias and should not interact with tabs belonging to other agents.

However, there is no locking mechanism beyond CDP's target-level attachment. If two agents attempt to control the same tab simultaneously, behavior is undefined. The tab registry file is read and written without file-level locking, so concurrent writes could theoretically corrupt it (though the window is very small due to atomic write patterns).

### 19.9 Screenshot Timing

Screenshots are captured once after all steps in a command complete, not between individual steps. For multi-step commands, the screenshot shows only the final state. Intermediate states are not captured visually, though the `changes` field in the output provides a diff-based summary of what changed.

The viewport snapshot (accessibility YAML) similarly captures the state after all steps. Agents that need to observe intermediate states must split their actions across multiple commands.

### 19.10 Date/Time Pickers and Complex Widgets

Custom date pickers, color pickers, sliders, and other complex composite widgets often lack proper ARIA roles or have non-standard interaction patterns. These elements may:

- Not appear in accessibility snapshots, or appear with unhelpful generic roles
- Require scrolling within internal containers (not the page viewport) to reach options
- Use custom event handling that does not respond to standard CDP input dispatch

Evaluation testing has shown specific weaknesses: date pickers (test 037) scored 0.71 due to time list items requiring force-clicks, and progress bars (test 039) scored 0.64 due to timing sensitivity. Workarounds include `pageFunction` for direct DOM manipulation, `getDom` for HTML inspection, and `pipeline` for coordinated multi-step DOM operations within a single evaluation context.

### 19.11 Stale Element References

Elements can become stale between the time a snapshot assigns a ref and the time an agent uses that ref for an action. Common causes:

- **React re-renders**: Component state changes cause the entire subtree to be replaced with new DOM nodes
- **Lazy loading**: Placeholder elements are replaced with real content
- **AJAX updates**: Server responses trigger DOM mutations that replace elements
- **SPA navigation**: Client-side routing replaces page content

The system mitigates this with automatic re-resolution: when a stale ref is detected, the system searches the document for an element matching the ref's stored role and name. This handles most cases, but fails when the element's role or name also changed during the re-render, or when multiple elements share the same role and name.

Stale element references were historically the top-reported issue (14 votes in the improvements tracker). The current re-resolution approach, including shadow DOM path traversal and document-wide fallback search, resolves the majority of cases but is not infallible.

### 19.12 Frame Context Persistence

Frame context established via `frame` does not persist across CLI invocations. Each new command execution starts in the main frame context. Agents working with iframes must use `frame` at the beginning of each command that targets iframe content.

### 19.13 File Upload

The system does not natively support file uploads. The `fill` step rejects file inputs as "not editable" because file input values cannot be set via standard DOM manipulation for security reasons. CDP provides `DOM.setFileInputFiles` for this purpose, but it is not currently exposed as a step. Agents must use `pageFunction` with direct API calls (e.g., to Dropzone or similar libraries) as a workaround.

### 19.14 Invalid CSS Selector Handling

Invalid CSS selectors (e.g., `[[[invalid`) currently cause a timeout rather than an immediate parse error. The system attempts to find the element until the actionability timeout expires, rather than detecting and reporting the syntax error upfront. This wastes time and produces a confusing error message.

### 19.15 SPA Client-Side Navigation Detection

Single-page applications that use `history.pushState()` or `history.replaceState()` for client-side routing may not be detected as navigation events. When a click triggers a pushState-based route change, the response may report `navigated: false` even though the URL and page content have changed. This affects all major SPA frameworks (React Router, Vue Router, Next.js, Nuxt, GitHub Turbo).

Workaround: agents should add explicit `wait` steps after clicking navigation links on SPAs, or use the `assert` step with `urlContains` to verify the expected URL change occurred.

### 19.16 Hidden Input Click-Through

Clicking hidden radio buttons and checkboxes via refs reports success with a warning about visibility, but does not actually toggle the input state. Many modern CSS frameworks (Bootstrap, Material UI, DemoQA) use this pattern: a hidden native input with a visible styled label. The click reaches the hidden input but has no visible or state effect. Agents should click the associated label element instead, or use `pageFunction` to toggle the checked state directly.

### 19.17 Same-Page Anchor Navigation

Navigating to a URL that differs from the current URL only in the hash fragment (`#section`) causes a full page reload via CDP's `Page.navigate`. On large pages (e.g., the ECMAScript specification at 2.5MB), this can take 30+ seconds instead of the sub-second scroll that a hash change should produce. Agents should use `scroll` to a selector or `pageFunction` with `location.hash = '#target'` as a workaround for same-page anchor navigation.
