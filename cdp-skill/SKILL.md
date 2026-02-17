---
name: cdp-skill
description: Automate Chrome browser interactions via JSON passed to a Node.js CLI. Use when you need to navigate websites, fill forms, click elements, extract data, or run end-to-end browser tests. Automatic screenshots on every action. Supports accessibility snapshots for resilient element targeting.
license: MIT
compatibility: Requires Chrome/Chromium (auto-launched if not running) and Node.js.
---

# CDP Browser Automation Skill

Automate Chrome browser interactions via JSON step definitions passed to a Node.js CLI.

> **See EXAMPLES.md** for full JSON examples, response shapes, and worked patterns for every step type.
>
> **For implementation details**, read the source in `cdp-skill/scripts/`. The step registry (`runner/step-registry.js`) defines all step types and their validation. The executor files (`runner/execute-*.js`) contain the implementation for each step.

## Quick Start

```bash
echo '{"steps":[{"newTab":"https://google.com"}]}' | node scripts/cdp-skill.js
echo '{"tab":"t1","steps":[{"click":"#btn"}]}' | node scripts/cdp-skill.js
echo '{"tab":"t1","steps":[{"snapshot":true}]}' | node scripts/cdp-skill.js
```

Tab IDs (t1, t2, ...) persist across CLI invocations. Chrome auto-launches if not running. Steps execute sequentially — each step completes before the next begins.

## Input / Output Schema

**Input fields:**
- `tab`: tab alias (e.g. "t1") — required after first call
- `timeout`: step timeout in ms (default 30000)
- `steps`: array of step objects (one action per step)

**Output fields:**
- `status`: "ok" or "error"
- `tab`: short tab ID (e.g. "t1")
- `siteProfile`: path to site profile file (after goto/newTab to known site)
- `actionRequired`: `{action, domain, message}` — **MUST be handled immediately** before continuing (see Site Profiles)
- `context`: `{url, title, scroll: {y, percent}, viewport: {width, height}, activeElement?, modal?}`
- `screenshot`: path to after-screenshot (auto-captured on every visual action)
- `fullSnapshot`: path to full-page accessibility snapshot file
- `viewportSnapshot`: path to viewport-only accessibility snapshot file
- `changes`: `{summary, added[], removed[], changed[]}` — viewport diff on same-page interactions
- `navigated`: true when URL pathname changed
- `console`: `{errors, warnings, messages[]}` — captured errors/warnings
- `steps[]`: `{action, status}` on success; adds `{params, error, context}` on failure
- `errors[]`: only present when steps failed

**Failure diagnostics**: failed steps include `context` with `visibleButtons`, `visibleLinks`, `visibleErrors`, `nearMatches` (fuzzy matches with scores), and scroll position.

**Error types**: PARSE, VALIDATION, CONNECTION, EXECUTION. Exit code: 0 = ok, 1 = error.

## Element References

Snapshots return versioned refs like `[ref=f0s1e4]` — format: `f{frameId}s{snapshotId}e{elementNumber}`.
- `f0` = main frame (default)
- `f1`, `f2`, ... = iframe by index
- `f[name]` = iframe by name (e.g., `f[frame-top]`)

Each frame maintains its own snapshot counter. Use refs with `click`, `fill`, `hover`, `scroll`, `drag`, `upload`, `get`. Refs remain valid while the element is in DOM.

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

Hooks can be combined on any visual action step: click, fill, press, hover, drag, selectOption, scroll, goto, reload, newTab, switchTab, snapshot, snapshotSearch, query, queryAll, inspect, get, submit, assert, wait, upload, pageFunction, selectText.

## Optional Steps

Add `"optional": true` to any step to continue on failure (status becomes "skipped"). Useful for dismissing optional modals or clicking elements that may not exist.

---

## Steps

### Navigation

#### goto
`"url"` | `{url, waitUntil}`
- **waitUntil**: `"commit"` | `"domcontentloaded"` | `"load"` | `"networkidle"`
- **Returns**: navigation result with snapshot
- Response includes top-level `siteProfile` or `actionRequired` (see Site Profiles)

#### newTab
`true` | `"url"` | `{url, host, port, headless, timeout}`
- Opens a new browser tab. **Required as first step** when no tab exists. Chrome auto-launches if not running.
- **Returns**: `{opened, tab, url, navigated, viewportSnapshot, fullSnapshot, context}`
- Response includes top-level `siteProfile` or `actionRequired` when URL provided

#### switchTab
`"alias"` | `{targetId}` | `{url: "regex"}` | `{host, port}`
- Connects to an existing tab by alias (`"t2"`), targetId, or URL regex pattern.
- **Returns**: tab context with snapshot

#### back
`true` | `{timeout}`
- **Returns**: `{url, title}` or `{noHistory: true}`

#### forward
`true` | `{timeout}`
- **Returns**: `{url, title}` or `{noHistory: true}`

#### reload
`true` | `{waitUntil}`
- **waitUntil**: `"commit"` | `"domcontentloaded"` | `"load"` | `"networkidle"`

#### waitForNavigation
`true` | `{timeout, waitUntil}`
- Waits for an in-progress navigation to reach the specified readyState.
- **waitUntil**: `"commit"` | `"domcontentloaded"` | `"load"` (default) | `"networkidle"`

### Interaction

#### click
`"selector"` | `{ref, selector, text, selectors[], x/y}`
- **Options**: `force`, `timeout` (default 10000), `button` (left/middle/right), `clickCount`
- **Hooks**: readyWhen, settledWhen, observe
- **Returns**: `{clicked, method: "cdp"|"jsClick-auto", navigated?, newUrl?, newTabs?}`
- `newTabs` reports any tabs opened by the click (e.g., `target="_blank"` links)

#### fill
Multiple shapes for flexibility:
- **Focused**: `"text"` or `{value, clear}` — types into the currently focused element
- **Targeted**: `{selector|ref|label, value}` — targets a specific field
- **Batch**: `{"#a":"x", "#b":"y"}` — fills multiple fields by selector
- **Batch with options**: `{fields: {"#a":"x"}, react: true, clear: true}`

**Options**: `clear` (default true), `react`, `force`, `exact`, `timeout`
**Returns**: `{filled, navigated?, newUrl?}` (targeted) or `{total, filled, failed, results[], mode: "batch"}` (batch)

#### press
`"Enter"` | `"Control+a"` | `"Meta+Shift+Enter"`
- Keyboard shortcuts and key presses. Key names follow the [KeyboardEvent.key](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values) spec.

#### hover
`"selector"` | `{selector, ref, text, x/y}`
- **Options**: `duration` (ms), `force`, `timeout`, `captureResult`
- **Returns**: `{hovered}` — with `captureResult: true`: adds `capturedResult: {visibleElements[]}`

#### drag
`{source, target}` — drag and drop between elements or coordinates.
- **source/target**: `"selector"` | `{ref}` | `{x, y}` | `{ref, offsetX, offsetY}`
- **Options**: `steps` (default 10), `delay` (default 0), `method: "auto"|"mouse"|"html5"`
- **Returns**: `{dragged, method, source: {x,y}, target: {x,y}}`

#### selectOption
`{selector, value|label|index|values}`
- Select from `<select>` dropdown by value, label text, or index. `values` for multi-select.
- **Returns**: `{selected: [string], multiple: boolean}`

#### selectText
`"selector"` | `{selector, start, end}`
- Selects text in an input/textarea. Omit start/end to select all.
- **Returns**: `{selected: true, selector}`

#### upload
`"/path/to/file"` | `["/a.txt", "/b.png"]` | `{selector|ref, file|files}`
- Auto-finds `input[type="file"]` if no selector given.
- **Returns**: `{uploaded, files[], accept, multiple, target}`

#### submit
`"selector"` | `{selector, reportValidity}`
- Submits a form. With `reportValidity: true`, triggers HTML5 validation.
- **Returns**: `{submitted, valid, errors[]}`

### Query & Extraction

#### snapshot
`true` | `{detail, mode, root, maxDepth, maxElements, maxNameLength, includeText, includeFrames, pierceShadow, viewportOnly, inlineLimit, preserveRefs, since}`
- **detail**: `"summary"` | `"interactive"` | `"full"` (default) — controls output verbosity
- **mode**: `"ai"` (default) | `"full"` — ai mode filters to relevant content
- **root**: CSS selector or `"role=main"` to scope the snapshot
- **maxNameLength**: truncate accessible names to N chars (default 150, 0 to disable)
- **inlineLimit**: bytes before saving to file (default 9000)
- **since**: `"f0s1"` — returns `{unchanged: true}` if page hasn't changed since that snapshot
- **Returns**: YAML with role, "name", states, `[ref=f{F}s{N}e{M}]`, snapshotId
- Snapshots over `inlineLimit` bytes are saved to a file (path in `artifacts.snapshot`)

#### snapshotSearch
`{text, pattern, role, exact, limit, context, near: {x, y, radius}}`
- Search the snapshot for matching elements by text, regex pattern, or ARIA role.
- **limit**: max results (default 10)
- **context**: lines of surrounding context to include
- **near**: spatial filter — only elements within `radius` px of `{x, y}`
- **Returns**: `{matches[], matchCount, searchedElements}`

#### query
`"selector"` | `{selector, role, name, nameExact, nameRegex, level, limit, output, count}`
- Query by CSS selector or ARIA role with optional name/level filters.
- **output**: `"text"` (default) | `"html"` | `"value"` | `"attributes"` | `["attr1", "attr2"]` | `{attribute: "data-id"}`
- **limit**: max results (default 10)
- **count**: `true` for count-only mode
- **Returns**: `{selector, total, showing, results[]}`

#### queryAll
`{"label": "selector", ...}` — batch multiple queries in one step.
- Each key is a friendly name, each value is a selector string or `{role, name}` object.
- **Returns**: `{queries: {label: result, ...}}`

#### get
`"selector"` | `{selector|ref, mode}`
- **Modes**: `"text"` (default), `"html"`, `"value"`, `"box"`, `"attributes"`
- Auto-detects tables and lists when mode is `"text"`, returning structured data
- `"value"` mode on a form returns all field values, validation state, and labels
- See EXAMPLES.md for response shapes per mode

#### inspect
`true` | `{selectors[], limit}`
- Page overview: returns element counts by tag type (a, button, input, form, etc.)
- **selectors**: additional CSS selectors to count; **limit**: sample values per selector
- **Returns**: `{title, url, elements: {a, button, input, ...}, custom?: {}}`

#### elementsAt
`{x, y}` | `[{x,y}, ...]` | `{x, y, radius, limit}`
- Find elements at specific coordinates or within a radius.
- **Returns**: element info with ref, tag, selector, clickable, box, distance (for radius)

#### getUrl
`true` — returns `{url}`

#### getTitle
`true` — returns `{title}`

### Waiting & Polling

#### wait
`"selector"` | `{selector, hidden, minCount}` | `{text, caseSensitive}` | `{textRegex}` | `{urlContains}`
- Waits for element presence/absence, text appearance, or URL change.
- **hidden**: `true` to wait for element to disappear
- **minCount**: wait until at least N elements match (default 1)
- **caseSensitive**: `true` (default) for text matching
- **timeout**: ms to wait (default 30000)

#### sleep
`number` (ms, 0–60000) — fixed time delay.

#### poll
`"() => expr"` | `{fn, interval, timeout}`
- Polls a function in the browser until it returns truthy.
- **interval**: poll frequency in ms (default 100)
- **timeout**: max wait in ms (default 30000)
- **Returns**: `{resolved: true, value, elapsed}` or `{resolved: false, elapsed, lastValue}`

### Scripting

#### pageFunction
`"() => expr"` | `"document.title"` | `{fn, expression, refs, timeout}`
- Runs custom JavaScript in the browser in the current frame context.
- Bare expressions auto-wrapped. Return values auto-serialized (Dates, Maps, Sets, Elements, NodeLists).
- **refs**: `true` to pass `window.__ariaRefs` as first argument
- **timeout**: execution timeout in ms
- **Returns**: `{type, value}` — see EXAMPLES.md for typed return values

#### assert
`{url: {contains|equals|startsWith|endsWith|matches}}` | `{text}` | `{selector, text, caseSensitive}`
- Assert URL conditions or text presence. Throws on failure.
- **Returns**: `{passed, assertions[]}`

### Page Control

#### scroll
`"top"` | `"bottom"` | `"up"` | `"down"` | `"selector"` | `"ref"` | `{deltaY}` | `{x, y}`
- Scroll page or scroll an element into view. Direction strings (`"up"`, `"down"`) scroll by 300px.
- **Returns**: `{scrollX, scrollY}`

#### frame
`"selector"` | `0` | `"top"` | `{name: "frameName"}` | `{list: true}`
- Switch to an iframe by selector, index, or name. `"top"` returns to main frame.
- `{list: true}` returns the frame tree without switching.

#### viewport
`"iphone-14"` | `{width, height, mobile, hasTouch, isLandscape, deviceScaleFactor}`
- Set viewport size. Accepts device preset strings (e.g., `"pixel-7"`, `"ipad-pro-11"`, `"macbook-pro-14"`, `"desktop-hd"`) or explicit dimensions.
- **Returns**: `{width, height, deviceScaleFactor}`

### Browser & Tabs

#### chromeStatus
`true` | `{host, port, headless, autoLaunch}`
- Diagnostics step — checks if Chrome is running and reachable.
- **Returns**: `{running, launched, version, port, tabs[]}`
- You rarely need this — `newTab` auto-launches Chrome.

#### listTabs
`true` — returns `{count, tabs[]}` with targetId, url, title, alias per tab.

#### closeTab
`"tabId"` — closes the specified tab. Use your tab alias (e.g., `"t1"`).

#### cookies
- `{get: true}` | `{get: ["url"], name: "session_id"}` — get cookies for current page or specific URLs
- `{set: [{name, value, domain, path, expires, httpOnly, secure, sameSite}]}` — set cookies (`expires` accepts `"1h"`, `"7d"`, `"30m"`, `"1w"`, `"1y"` or Unix timestamp)
- `{delete: "name", domain}` — delete specific cookie(s)
- `{clear: true, domain}` — clear all cookies, optionally filtered by domain

#### console
`true` | `{level, type, since, limit, clear, stackTrace}`
- **level**: filter by `"error"`, `"warning"`, `"log"`, etc.
- **type**: `"console"` or `"exception"`
- **limit**: max messages (default 50)
- **clear**: clear buffer after returning
- **stackTrace**: include call stacks
- **Returns**: `{total, showing, messages[]}`

#### pdf
`"filename"` | `{path, landscape, printBackground, scale, pageRanges, selector}`
- Generate PDF. Relative paths resolve to platform temp directory.
- **selector**: capture a specific element instead of full page

### Site Profiles

#### readSiteProfile
`"domain"` | `{domain}` — returns `{found, domain, content}` or `{found: false, domain}`

#### writeSiteProfile
`{domain, content}` — returns `{written, path, domain}`

**How navigation uses profiles:**

Every `goto`, `newTab` (with URL), and `switchTab` checks for a profile. The result appears as a **top-level field** in the response:

- **`siteProfile`** present — read it before doing anything else. It contains strategies, quirks, and recipes. Apply its `settledWhen`/`readyWhen` hooks, use its selectors, and respect its quirks.
- **`actionRequired`** present — **STOP. Create the profile NOW** before continuing your task:
  1. `snapshot` — map page structure and landmarks
  2. `pageFunction` — detect framework (e.g. `() => { return { react: !!window.__REACT, next: !!window.__NEXT_DATA__, vue: !!window.__VUE__ } }`)
  3. `writeSiteProfile` — save domain and markdown content

After completing your goal, update the site profile with anything you learned. Call `writeSiteProfile` again with the improved content before closing your tab.

**Profile format:**
```
# domain.com
Updated: YYYY-MM-DD  |  Fingerprint: <tech-stack>

## Environment / Quirks / Strategies / Regions / Recipes
```

### Legacy Steps

- `getDom` — use `get` with `mode: "html"` instead
- `getBox` — use `get` with `mode: "box"` instead

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tabs accumulating | Include `tab` at top level to reuse existing tabs |
| CONNECTION error | Check Chrome is reachable; use `chromeStatus` to diagnose |
| Chrome not found | Set `CHROME_PATH` env var |
| Element not found | Add `wait` step first, or check snapshot for correct ref |
| Clicks not working | Scroll into view first, or use `force: true` |
| `back` returns noHistory | New tabs start at about:blank; navigate first |
| Select dropdown not working | Use click+click pattern or press arrow keys |
| Type not appearing | Click input first to focus, then type |
| Elements missing from snapshot | Custom widgets may lack ARIA roles; use `pageFunction` or `get` with `mode: "html"` |
| macOS: Chrome running but no CDP | `chromeStatus` launches new instance with CDP enabled |
| Shell escaping issues | Use heredoc or pipe from file (see EXAMPLES.md) |

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
- **Be persistent** — try alternative selectors, add waits, scroll first
