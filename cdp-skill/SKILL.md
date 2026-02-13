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
> **For implementation details**, read the source in `cdp-skill/src/`.

## Quick Start

```bash
echo '{"steps":[{"newTab":"https://google.com"}]}' | node src/cdp-skill.js
echo '{"tab":"t1","steps":[{"click":"#btn"}]}' | node src/cdp-skill.js
echo '{"tab":"t1","steps":[{"snapshot":true}]}' | node src/cdp-skill.js
```

Tab IDs (t1, t2, ...) persist across CLI invocations. Chrome auto-launches if not running.

## Input / Output Schema

**Input fields:**
- `tab`: tab alias (e.g. "t1") — required after first call
- `timeout`: step timeout in ms (default 30000)
- `steps`: array of step objects (one action per step)

**Output fields:**
- `status`: "ok" or "error"
- `tab`: short tab ID (e.g. "t1")
- `siteProfile`: full markdown content of existing profile (after goto/newTab to known site)
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

Snapshots return versioned refs like `[ref=f0s1e4]` — format: `f{frameId}s{snapshotId}e{elementNumber}`.
- `f0` = main frame (default)
- `f1`, `f2`, ... = iframe by index
- `f[name]` = iframe by name (e.g., `f[frame-top]`)

Each frame maintains its own snapshot counter. Use refs with `click`, `fill`, `hover`. Refs remain valid while the element is in DOM.

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

Hooks can be combined on any action step. Applies to: click, fill, press, hover, drag, selectOption, scroll, goto, reload, newTab, switchTab, snapshot, snapshotSearch, query, queryAll, inspect, get, submit, assert, wait, upload, pageFunction, selectText.

## Steps

### Navigation

#### goto
`"url"` | `{url, waitUntil}` — navigate to URL.
- Options: `waitUntil` — commit | domcontentloaded | load | networkidle
- Returns: navigation result with snapshot
- Response includes top-level `siteProfile` or `actionRequired` (see Site Profiles)

#### newTab
`true` | `"url"` | `{url, host, port, headless, timeout}` — create a new tab.
- Returns: `{opened, tab, url, navigated, viewportSnapshot, fullSnapshot, context}`
- Response includes top-level `siteProfile` or `actionRequired` when URL provided
- **REQUIRED as first step** when no tab specified. Chrome auto-launches if not running.

#### switchTab
`"alias"` | `{targetId}` | `{url: "regex"}` | `{host, port}` — switch to existing tab.
- Returns: tab context with snapshot

#### back
`true` — navigate back in history.
- Returns: `{url, title}` or `{noHistory: true}`

#### forward
`true` — navigate forward in history.
- Returns: `{url, title}` or `{noHistory: true}`

#### reload
`true` | `{waitUntil}` — reload current page.
- Options: `waitUntil` — commit | domcontentloaded | load | networkidle

#### waitForNavigation
`true` | `{timeout, waitUntil}` — wait for in-progress navigation to complete.

### Interaction

#### click
`"selector"` | `"ref"` | `{ref, selector, text, x/y, selectors[]}`
- Options: `force`, `jsClick`, `nativeOnly`, `scrollUntilVisible`, `exact`, `tag`, `withinSelector`, `waitAfter`, `waitAfterOptions: {timeout, stableTime}`, `timeout`
- Hooks: readyWhen, settledWhen, observe
- Returns: `{clicked, method: "cdp"|"jsClick"|"jsClick-auto", navigated?, newUrl?, newTabs?: [{targetId, url, title}]}`

#### fill
Multiple shapes for flexibility:
- **Focused**: `"text"` or `{value, clear}` — types into the currently focused element
- **Targeted**: `{selector|ref|label, value}` — targets a specific field
- **Batch**: `{"#a":"x", "#b":"y"}` — fills multiple fields by selector
- **Batch with options**: `{fields: {"#a":"x"}, react: true, clear: true}`

Options: `clear`(true by default), `react`, `force`, `exact`, `timeout`
Hooks: readyWhen, settledWhen, observe
Returns: `{filled, navigated?, newUrl?}` (targeted) or `{total, filled, failed, results[], mode: "batch"}` (batch)

#### press
`"Enter"` | `"Control+a"` | `"Meta+Shift+Enter"` — keyboard shortcuts and key presses.

#### hover
`"selector"` | `{selector, ref, text, x/y}`
- Options: `duration`, `force`, `timeout`, `captureResult`
- Hooks: readyWhen, settledWhen, observe
- Returns: `{hovered}` or with `captureResult: true`: `{hovered, capturedResult: {visibleElements[]}}`

#### drag
`{source, target}` — drag and drop between elements or coordinates.
- Source/target: `"selector"` | `{ref}` | `{x, y}` | `{ref, offsetX, offsetY}`
- Options: `steps`(10), `delay`(0), `method: "auto"|"mouse"|"html5"`
- Returns: `{dragged, method, source: {x,y}, target: {x,y}}`

#### selectOption
`{selector, value|label|index|values}` — select from dropdown.

#### selectText
`"selector"` | `{selector, start, end}` — select text in an element.

#### upload
Upload files to a file input.
- **Auto-find**: `"/path/to/file"` or `["/a.txt", "/b.png"]` — finds `input[type="file"]` automatically
- **Targeted**: `{selector|ref, file: "path"}` or `{selector|ref, files: ["a.txt", "b.png"]}`
- Returns: `{uploaded, files[], accept, multiple, target}`

#### submit
`"selector"` | `{selector, reportValidity}` — submit a form.
- Returns: `{submitted, valid, errors[]}`

### Query & Extraction

#### snapshot
`true` | `{root, detail, mode, maxDepth, maxElements, maxNameLength, includeText, includeFrames, pierceShadow, viewportOnly, inlineLimit, since}`
- Detail: summary | interactive | full (default)
- maxNameLength: truncate accessible names to N chars (default: 150, 0 to disable)
- Since: `"f0s1"` — returns `{unchanged: true}` if page hasn't changed
- Returns: YAML with role, "name", states, `[ref=f{F}s{N}e{M}]`, snapshotId
- Snapshots over 9KB saved to file (configurable via `inlineLimit`)

#### snapshotSearch
`{text, pattern, role, exact, limit(10), context, near: {x, y, radius}}`
- Returns: `{matches[], matchCount, searchedElements}`
- Refs from snapshotSearch persist across subsequent commands

#### query
`"selector"` | `{selector, role, name, nameExact, nameRegex, level, limit, output, refs}`
- CSS or ARIA role query
- Returns: `{total, results[]}`

#### queryAll
`{"label": "selector", ...}` — batch multiple queries in one step.

#### get
`"selector"` | `{selector|ref, mode}`
- Modes: `text` (default), `html`, `value`, `box`, `attributes`
- Auto-detects tables and lists when mode is text
- Returns vary by mode (see EXAMPLES.md)

#### inspect
`true` | `{selectors[], limit}` — page overview with element counts.
- Returns: `{title, url, counts}`

#### elementsAt
`{x, y}` | `[{x,y}, ...]` | `{x, y, radius, limit}` — find elements at coordinates.
- Returns: element info with ref, tag, selector, clickable, box

#### getUrl
`true` — returns `{url}`

#### getTitle
`true` — returns `{title}`

### Page Control

#### wait
`"selector"` | `{selector, hidden, minCount}` | `{text, caseSensitive}` | `{textRegex}` | `{urlContains}`
- Waits for element, text, or URL condition

#### sleep
`number` (ms, 0-60000) — fixed time delay.

#### scroll
`"top"` | `"bottom"` | `"up"` | `"down"` | `"selector"` | `{deltaY}` | `{x, y}`
- Returns: `{scrollX, scrollY}`

#### frame
Unified frame operations:
- `"selector"` — switch to frame by CSS selector
- `0` — switch to frame by index
- `"top"` — return to main frame
- `{name: "frameName"}` — switch by name
- `{list: true}` — list all frames

#### viewport
`"iphone-14"` | `{width, height, mobile, hasTouch, isLandscape}` — set viewport size.

#### pageFunction
`"() => expr"` | `"document.title"` | `{fn, expression, refs(bool), timeout}`
- Runs custom JavaScript in the browser
- Auto-wrapped as IIFE, return value auto-serialized, runs in current frame context
- `refs: true` passes `window.__ariaRefs` to the function

#### poll
`"() => expr"` | `{fn, interval, timeout}` — poll predicate until truthy.

#### assert
`{url: {contains|equals|startsWith|endsWith|matches}}` | `{text}` | `{selector, text, caseSensitive}`
- Returns: `{passed, assertions[]}`

### Browser & Tabs

#### chromeStatus (not a step — top-level)
`true` | `{host, port, headless, autoLaunch}` — returns `{running, launched, version, port, tabs[]}`
> You rarely need this — `newTab` auto-launches Chrome. Use only for diagnostics or non-default ports.

#### listTabs
`true` — returns `{count, tabs[]}`

#### closeTab
`"tabId"` — returns `{closed}`

#### cookies
`{get: true}` | `{get: ["url"], name}` | `{set: [{name, value, domain, expires}]}` | `{delete: "name", domain}` | `{clear: true, domain}`

#### console
`true` | `{level, limit, clear, stackTrace}` — returns `{messages[]}`

#### pdf
`"filename"` | `{path, landscape, printBackground, scale, pageRanges}` — generate PDF.

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

## Optional Steps

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
