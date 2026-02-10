---
name: cdp-skill
description: Automate Chrome browser interactions via JSON passed to a Node.js CLI. Use when you need to navigate websites, fill forms, click elements, extract data, or run end-to-end browser tests. Automatic screenshots on every action. Supports accessibility snapshots for resilient element targeting.
license: MIT
compatibility: Requires Chrome/Chromium (auto-launched if not running) and Node.js.
---

# CDP Browser Automation Skill

Automate Chrome browser interactions via JSON step definitions passed to a Node.js CLI.

> **See EXAMPLES.md** for full JSON examples, response shapes, and worked patterns for every step type.

## Site Profiles

Site profiles are per-domain cheatsheets stored at `~/.cdp-skill/sites/{domain}.md`. They record what the agent learned about a site: framework, quirks, stable selectors, and recipes for common flows.

> **IMPORTANT — `actionRequired` responses are MANDATORY.** When any response contains `actionRequired`, you **MUST** complete it before doing anything else. Do not skip it. Do not proceed to your main task first. Handle `actionRequired` immediately.

### How navigation uses profiles

Every `goto`, `newTab` (with URL), and `switchTab` checks for a profile. The result appears as a **top-level field** in the response:

- **`siteProfile`** present → read it before doing anything else. It contains strategies, quirks, and recipes. Apply its `settledWhen`/`readyWhen` hooks, use its selectors, and respect its quirks.
- **`actionRequired`** present → **STOP. Create the profile NOW** before continuing your task:
  1. `snapshot` — map page structure and landmarks
  2. `pageFunction` — detect framework (e.g. `() => { return { react: !!window.__REACT, next: !!window.__NEXT_DATA__, vue: !!window.__VUE__ } }`)
  3. `writeSiteProfile` — save domain and markdown content

The profile only needs to capture what's useful: environment, quirks, stable selectors, strategies for fill/click/wait, and recipes for common flows. A minimal profile is fine — even just the environment and one quirk is valuable.

### Updating profiles after your task

After completing your goal, update the site profile with anything you learned. Discovered a quirk? Found a reliable selector? Worked out a multi-step flow? Call `writeSiteProfile` again with the improved content before closing your tab. If you didn't learn anything new, skip the update.

### Profile format

```
# domain.com
Updated: YYYY-MM-DD  |  Fingerprint: <tech-stack>

## Environment / Quirks / Strategies / Regions / Recipes
```

- **Environment**: tech stack, SPA behavior, main element selectors
- **Quirks**: pitfalls that cause failures without foreknowledge
- **Strategies**: how to fill, click, or wait on this specific site (include `settledWhen`/`readyWhen` hooks)
- **Regions**: stable landmark selectors
- **Recipes**: pre-built step sequences for common flows

Sections are optional — include what's useful. See EXAMPLES.md for a full profile template.

### readSiteProfile

`"domain"` | `{domain}` — returns `{found, domain, content}` or `{found: false, domain}`

### writeSiteProfile

`{domain, content}` — returns `{written, path, domain}`
```json
{"writeSiteProfile": {"domain": "example.com", "content": "# example.com\nUpdated: 2025-01-15\n\n## Environment\n- React SPA\n..."}}
```

## Quick Start

```bash
echo '{"steps":[{"openTab":"https://google.com"}]}' | node src/cdp-skill.js
echo '{"tab":"t1","steps":[{"click":"#btn"}]}' | node src/cdp-skill.js
echo '{"tab":"t1","steps":[{"snapshot":true}]}' | node src/cdp-skill.js
```

Tab IDs (t1, t2, ...) persist across CLI invocations. Chrome auto-launches if not running.

## Reliability (v1.0.10-1.0.11)

Recent improvements to stability and correctness:

- **Validation robustness** — Fixed null pointer crashes in step validation for edge cases with missing or malformed parameters
- **Race condition fixes** — Resolved timing issues in browser connection initialization, file lock contention, and scroll-wait coordination
- **Resource cleanup** — Fixed HTTP connection leaks, event listener cleanup, and stderr stream handling
- **Frame context** — Corrected iframe element location and interaction to respect frame boundaries
- **Step simplification** — Consolidated 47 steps into 41 unified operations (fill, frame, elementsAt, pageFunction, sleep) for clearer API

The skill now passes 1261/1263 unit tests (99.8%) and maintains SHS 99/100 on the cdp-bench evaluation suite.

## Input / Output Schema

**Input fields:**
- `tab`: tab alias (e.g. "t1") — required after first call
- `timeout`: step timeout in ms (default 30000)
- `steps`: array of step objects (one action per step)

**Output fields:**
- `status`: "ok" or "error"
- `tab`: short tab ID (e.g. "t1")
- `siteProfile`: full markdown content of existing profile (after goto/openTab to known site)
- `actionRequired`: `{action, domain, message}` — **MUST be handled immediately** before continuing (see Site Profiles)
- `context`: `{url, title, scroll: {y, percent}, viewport: {width, height}, activeElement?, modal?}`
- `screenshot`: path to after-screenshot (auto-captured on every visual action)
- `fullSnapshot`: path to full-page accessibility snapshot file
- `viewportSnapshot`: inline viewport-only snapshot YAML
- `changes`: `{summary, added[], removed[], changed[]}` — viewport diff on same-page interactions
- `navigated`: true when URL pathname changed
- `console`: `{errors, warnings, messages[]}` — captured errors/warnings
- `steps[]`: `{action, status}` on success; adds `{params, error, context}` on failure
- `errors[]`: only present when steps failed

**Failure diagnostics**: failed steps include `context` with `visibleButtons`, `visibleLinks`, `visibleErrors`, `nearMatches` (fuzzy matches with scores), and scroll position.

**Error types**: PARSE, VALIDATION, CONNECTION, EXECUTION. Exit code: 0 = ok, 1 = error.

## Element References

Snapshots return versioned refs like `[ref=s1e4]` — format: `s{snapshotId}e{elementNumber}`.
Use refs with `click`, `fill`, `hover`. Each snapshot increments the ID. Refs from earlier snapshots remain valid while the element is in DOM.

**Auto re-resolution**: when a ref's element leaves the DOM (React re-render, lazy-load), the system tries to re-find it by stored selector + role + name. Response includes `reResolved: true` on success.

## Auto-Waiting

| Action | Waits For |
|--------|-----------|
| `click` | visible, enabled, stable, not covered, pointer-events |
| `fill` | visible, enabled, editable |
| `hover` | visible, stable |

Use `force: true` to bypass all checks. **Auto-force**: when actionability times out but element exists, automatically retries with force (outputs `autoForced: true`).

## Action Hooks

Optional parameters on action steps to customize the step lifecycle:

- **readyWhen**: `"() => condition"` — polled until truthy **before** the action executes
- **settledWhen**: `"() => condition"` — polled until truthy **after** the action completes
- **observe**: `"() => data"` — runs after settlement, return value appears in `result.observation`

Hooks can be combined on any action step. Applies to: click, fill, press, hover, drag, selectOption, scroll.

## Core Steps

### chromeStatus (optional diagnostic)
`true` | `{host, port, headless, autoLaunch}` — returns `{running, launched, version, port, tabs[]}`

> **Note**: You rarely need this — `newTab` auto-launches Chrome. Use `chromeStatus` only for diagnostics or non-default ports.

### newTab
`true` | `"url"` | `{url, host, port, headless}` — returns `{opened, tab, url, navigated, viewportSnapshot, fullSnapshot, context}`
Response includes top-level `siteProfile` or `actionRequired` when URL provided (see Site Profiles).
**REQUIRED as first step** when no tab specified. Chrome auto-launches if not running.
Non-default Chrome: `{"steps":[{"newTab":{"url":"https://example.com","port":9333,"headless":true}}]}`

### goto
`"url"` | `{url, waitUntil}` — waitUntil: commit | domcontentloaded | load | networkidle
Response includes top-level `siteProfile` or `actionRequired` (see Site Profiles).

### click
`"selector"` | `"ref"` | `{ref, selector, text, x/y, selectors[]}`
Options: force, jsClick, nativeOnly, doubleClick, scrollUntilVisible, searchFrames, exact, timeout, waitAfter
Hooks: readyWhen, settledWhen, observe
Returns: `{clicked, method: "cdp"|"jsClick"|"jsClick-auto", navigated?, newUrl?, newTabs?: [{targetId, url, title}]}`

### fill
`{selector|ref|label, value}` — the primary way to input text.
Options: clear(true), react, force, exact, timeout
Hooks: readyWhen, settledWhen, observe
Returns: `{filled, navigated?, newUrl?}`

### press
`"Enter"` | `"Control+a"` | `"Meta+Shift+Enter"` — keyboard shortcuts and key presses.

### scroll
`"top"` | `"bottom"` | `"selector"` | `{deltaY}` | `{x, y}`
Returns: `{scrollX, scrollY}`

### snapshot
`true` | `{root, detail, mode, maxDepth, maxElements, includeText, includeFrames, pierceShadow, viewportOnly, inlineLimit, since}`
Detail: summary | interactive | full(default)
Since: `"s1"` — returns `{unchanged: true}` if page hasn't changed
Returns: YAML with role, "name", states, `[ref=s{N}e{M}]`, snapshotId
Notes: snapshots over 9KB saved to file (configurable via inlineLimit)

### snapshotSearch
`{text, pattern, role, exact, limit(10), context, near: {x, y, radius}}`
Returns: `{matches[], matchCount, searchedElements}`
Notes: refs from snapshotSearch persist across subsequent commands.

### wait
`"selector"` | `{selector, hidden, minCount}` | `{text}` | `{textRegex}` | `{urlContains}`

### get
`"selector"` (text) | `{selector, mode: "text"|"html"|"value"|"box"|"attributes"}` — unified content extraction.
Returns: text → `{text}`, html → `{html, tagName, length}`, value → `{fields[], valid, fieldCount}`, box → `{x, y, width, height}`, attributes → `{attributes}`

### getUrl
`true` — returns `{url}`

### getTitle
`true` — returns `{title}`

### pageFunction
`"() => expr"` | `{fn, refs(bool), timeout}` — run custom JavaScript in the browser.
Notes: auto-wrapped as IIFE, refs passes `window.__ariaRefs`, return value auto-serialized, runs in current frame context.

### closeTab
`"tabId"` — returns `{closed}`

### listTabs
`true` — returns `{count, tabs[]}`

## Also Available

These steps are fully functional — see EXAMPLES.md for usage details.

| Step | Description |
|------|-------------|
| `fill` | Unified fill (replaces `type`): `"text"` (focused), `{selector, value}` (single), `{"#a":"x","#b":"y"}` (batch), `{fields:{...}, react}` (batch+options), `{value, clear}` (focused+options) |
| `sleep` | Time delay: `2000` (ms, 0–60000) |
| `pageFunction` | JS execution: `"() => expr"` (function) or `"document.title"` (bare expression) or `{fn, expression, refs, timeout}` |
| `poll` | Poll predicate until truthy: `"() => expr"` or `{fn, interval, timeout}` |
| `query` | CSS/ARIA query: `"selector"` or `{role, name}` → `{total, results[]}` |
| `queryAll` | Batch queries: `{"label": "selector", ...}` |
| `inspect` | Page overview: `true` → `{title, url, counts}` |
| `get` | Unified content extraction (replaces `extract`, `getDom`, `getBox`, `formState`): `"selector"` (text), `{selector, mode: "text"\|"html"\|"value"\|"box"\|"attributes"}` |
| `getUrl` | Get current URL: `true` → `{url}` |
| `getTitle` | Get page title: `true` → `{title}` |
| `hover` | Hover element: `"selector"` or `{selector, ref, text, x/y, duration}` |
| `drag` | Drag and drop: `{source, target, steps, delay, method}` — method: `auto`(default)\|`mouse`\|`html5` |
| `selectText` | Text selection (renamed from `select`): `"selector"` or `{selector, start, end}` |
| `selectOption` | Dropdown: `{selector, value\|label\|index\|values}` |
| `submit` | Submit form: `"selector"` → `{submitted, valid, errors[]}` |
| `assert` | Assert conditions: `{url: {contains\|equals\|matches}}` or `{text}` or `{selector, text}` |
| `elementsAt` | Coordinate lookup: `{x,y}` (point), `[{x,y},...]` (batch), `{x,y,radius}` (nearby) |
| `frame` | Frame ops: `"selector"` (switch), `0` (by index), `"top"` (main frame), `{name}`, `{list:true}` |
| `viewport` | Set viewport: `"iphone-14"` or `{width, height, mobile}` |
| `cookies` | Get/set/delete: `{get: true}`, `{set: [...]}`, `{delete: "name"}`, `{clear: true}` |
| `console` | Browser console: `true` or `{level, limit, clear}` → `{messages[]}` |
| `pdf` | Generate PDF: `"filename"` or `{path, landscape, scale, pageRanges}` |
| `back` / `forward` | History navigation: `true` → `{url, title}` or `{noHistory: true}` |
| `reload` | Reload page: `true` or `{waitUntil}` |
| `newTab` | Create new tab (renamed from `openTab`): `"url"` or `{url, wait}` → `{tab, url}` |
| `switchTab` | Switch to existing tab (renamed from `connectTab`): `"t1"` or `{targetId}` or `{url: "regex"}` |
| `closeTab` | Close tab: `"t1"` or `true` (current) |
| `listTabs` | List all tabs: `true` → `{tabs[]}` |
| `waitForNavigation` | Wait for nav: `true` or `{timeout, waitUntil}` |

### Optional Steps

Add `"optional": true` to any step to continue on failure (status becomes "skipped").

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tabs accumulating | Include `tab` at top level |
| CONNECTION error | Check Chrome is reachable; use `chromeStatus` to diagnose |
| Chrome not found | Set `CHROME_PATH` env var |
| Element not found | Add `wait` step first |
| Clicks not working | Scroll into view first, or `force: true` |
| `back` returns noHistory | New tabs start at about:blank; navigate first |
| Select dropdown not working | Use click+click or press arrow keys |
| Type not appearing | Click input first to focus, then type |
| Elements missing from snapshot | Custom widgets may lack ARIA roles; use `pageFunction` or `get` with `mode: "html"` as fallback |
| macOS: Chrome running but no CDP | `chromeStatus` launches new instance with CDP enabled |

## Best Practices

- **Handle `actionRequired` immediately** — when a response contains this field, complete it before doing anything else
- **Never launch Chrome directly** — `newTab` handles it automatically
- **Use newTab** as your first step to create a tab; use the returned tab ID for all subsequent calls
- **Reuse only your own tabs** — other agents may share the browser
- **Update the site profile before closing** — add any quirks, selectors, or recipes you discovered
- **Close your tab when done** — `closeTab` with your tab ID
- **Discover before interacting** — use `snapshot` to understand the page structure
- **Use website navigation** — click links and submit forms; don't guess URLs
- **Prefer refs** over CSS selectors — use `snapshot` + refs for resilient targeting
- **Check `newTabs` after click** — clicks on `target="_blank"` links report new tabs; use `switchTab` to switch
- **Use `switchTab` for popups** — connect by alias (`"t2"`), targetId, or URL regex (`{url: "pattern"}`)
- **Be persistent** — try alternative selectors, add waits, scroll first
