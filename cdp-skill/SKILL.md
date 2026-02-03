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

Every `goto` and `openTab` (with URL) checks for a profile. The result appears as a **top-level field** in the response:

- **`siteProfile`** present → read it before doing anything else. It contains strategies, quirks, and recipes. Apply its `settledWhen`/`readyWhen` hooks, use its selectors, and respect its quirks.
- **`actionRequired`** present → **STOP. Create the profile NOW** before continuing your task:
  1. `snapshot` — map page structure and landmarks
  2. `pageFunction` — detect framework (e.g. `() => { return { react: !!window.__REACT, next: !!window.__NEXT_DATA__, vue: !!window.__VUE__ } }`)
  3. `writeSiteProfile` — save domain and markdown content

The profile only needs to capture what's useful: environment, quirks, stable selectors, strategies for fill/click/wait, and recipes for common flows. A minimal profile is fine — even just the environment and one quirk is valuable.

### Updating profiles after your task

After completing your goal, update the site profile with anything you learned. Discovered a quirk? Found a reliable selector? Worked out a multi-step flow? Call `writeSiteProfile` again with the improved content before closing your tab. If you didn't learn anything new, skip the update.

### readSiteProfile

`"domain"` | `{domain}` — returns `{found, domain, content}` or `{found: false, domain}`

Read a site profile without navigating. Use this to check or update a profile ad-hoc.

### writeSiteProfile

`{domain, content}` — returns `{written, path, domain}`

### Profile format

```
# example.com
Updated: 2026-02-03  |  Fingerprint: react18-next-spa

## Environment
- React 18.x, Next.js (SSR)
- SPA with pushState navigation

## Quirks
- Turbo intercepts link clicks — use settledWhen with URL check
- Search results load async — poll for .results-count before extracting

## Strategies
### fill (React controlled inputs)
Use nativeSetter.call(el, value) then dispatch input event with bubbles.

### Navigation readiness
settledWhen: () => !document.querySelector('.loading-bar')

## Regions
- mainContent: main, [role="main"]
- navigation: .nav-bar
- searchResults: #search-results

## Recipes
### Login
pipeline: find #username fill {{user}}, find #password fill {{pass}}, find #login click, waitFor () => location.pathname !== '/login'
```

Sections are optional — include what's useful. The key sections agents rely on:
- **Quirks**: pitfalls that cause failures without foreknowledge
- **Strategies**: how to fill, click, or wait on this specific site
- **Recipes**: pre-built step sequences for common flows

## Quick Start

**1. Check Chrome status** (auto-launches if needed):
`node src/cdp-skill.js '{"steps":[{"chromeStatus":true}]}'`

**2. Open a tab and navigate:**
`node src/cdp-skill.js '{"steps":[{"openTab":"https://google.com"}]}'`

**3. Use the returned tab ID for subsequent calls:**
`node src/cdp-skill.js '{"config":{"tab":"t1"},"steps":[{"click":"#btn"}]}'`

Tab IDs (t1, t2, ...) persist across CLI invocations. Stdin pipe also works: `echo '{"steps":[...]}' | node src/cdp-skill.js`

## Input / Output Schema

**Input fields:**
- `config`: `{host, port, tab, timeout, headless}` — tab is required after first call
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
| `fill`, `type` | visible, enabled, editable |
| `hover` | visible, stable |

Use `force: true` to bypass all checks. **Auto-force**: when actionability times out but element exists, automatically retries with force (outputs `autoForced: true`).

## Action Hooks

Optional parameters on action steps to customize the step lifecycle:

- **readyWhen**: `"() => condition"` — polled until truthy **before** the action executes
- **settledWhen**: `"() => condition"` — polled until truthy **after** the action completes
- **observe**: `"() => data"` — runs after settlement, return value appears in `result.observation`

Hooks can be combined on any action step. Applies to: click, fill, press, hover, drag, selectOption, scroll.

## Step Reference

### Chrome Management

> **IMPORTANT**: Never launch Chrome manually via shell commands. Always use `chromeStatus`.

**chromeStatus**: true | {autoLaunch, headless}
  returns: {running, launched, version, port, tabs[]}

### Navigation

**goto**: "url" | {url, waitUntil}
  waitUntil: commit | domcontentloaded | load | networkidle
  response: top-level `siteProfile` or `actionRequired` (see Site Profiles)

**reload**: true | {waitUntil}

**back** / **forward**: true
  returns: {url, title} or {noHistory: true}

**waitForNavigation**: true | {timeout, waitUntil}

### Frames

**listFrames**: true
  returns: {mainFrameId, currentFrameId, frames[]}

**switchToFrame**: "selector" | index | {selector, index, name, frameId}
  returns: {frameId, url, name}

**switchToMainFrame**: true

### Waiting

**wait**: "selector" | number(ms) | {selector, hidden, minCount} | {text} | {textRegex} | {urlContains}

### Interaction

**click**: "selector" | "ref" | {ref, selector, text, x/y, selectors[]}
  options: force, jsClick, nativeOnly, doubleClick, scrollUntilVisible, searchFrames, exact, timeout, waitAfter
  hooks: readyWhen, settledWhen, observe
  returns: {clicked, method: "cdp"|"jsClick"|"jsClick-auto", navigated?, newUrl?}

**fill**: {selector|ref|label, value}
  options: clear(true), react, force, exact, timeout
  hooks: readyWhen, settledWhen, observe
  returns: {filled, navigated?, newUrl?}

**fillForm**: {"#sel": "value", ...}
  returns: {total, filled, failed, results[]}

**fillActive**: "value" | {value, clear}
  returns: {filled, tag, type, selector, valueBefore, valueAfter}

**type**: {selector, text, delay}
  returns: {selector, typed, length}

**press**: "Enter" | "Control+a" | "Meta+Shift+Enter"

**select**: "selector" | {selector, start, end}
  returns: {selector, start, end, selectedText, totalLength}

**hover**: "selector" | {selector, ref, duration, captureResult}
  hooks: readyWhen, settledWhen, observe

**drag**: {source, target}
  source/target: "selector" | "ref" | {ref, offsetX, offsetY} | {x, y}
  options: steps(10), delay(0)
  hooks: readyWhen, settledWhen, observe
  returns: {dragged, method: "html5-dnd"|"range-input"|"mouse-events", source, target}

**selectOption**: {selector, value|label|index|values}
  returns: {selected[], multiple}
  notes: uses JS to set option.selected (native dropdowns can't be clicked via CDP)

### Scrolling

**scroll**: "top" | "bottom" | "selector" | {deltaY} | {x, y}
  returns: {scrollX, scrollY}

### Data Extraction

**extract**: "selector" | {selector, type: auto|table|list|text, includeHeaders}
  returns: table → {type, headers, rows, rowCount, columnCount}; list → {type, items, itemCount}

**getDom**: true | "selector" | {selector, outer(true)}
  returns: {html, tagName, selector, length}

**getBox**: "ref" | ["ref1", "ref2"] | {refs: [...]}
  returns: {x, y, width, height, center} per ref

**refAt**: {x, y}
  returns: {ref, existing, tag, selector, clickable, role, name, box}

**elementsAt**: [{x, y}, ...]
  returns: {count, elements[]}

**elementsNear**: {x, y, radius(50), limit(20)}
  returns: {center, radius, count, elements[]}

**formState**: "selector" | {selector, includeHidden}
  returns: {selector, action, method, fields[], valid, fieldCount}

**query**: "selector" | {selector, limit(10), output} | {role, name, nameExact, nameRegex, checked, disabled, level, countOnly, refs}
  output: text | html | href | value | tag | {attribute: "data-id"}
  returns: {selector, total, showing, results[]}

**queryAll**: {"label": "selector", ...}

**inspect**: true | {selectors[], limit}
  returns: {title, url, counts, custom}

**console**: true | {level, type, since, limit, clear, stackTrace}
  returns: {total, showing, messages[]}
  notes: logs don't persist across CLI invocations

### Accessibility Snapshot

**snapshot**: true | {root, detail, mode, maxDepth, maxElements, includeText, includeFrames, pierceShadow, viewportOnly, inlineLimit, since}
  detail: summary | interactive | full(default)
  since: "s1" — returns {unchanged: true} if page hasn't changed
  returns: YAML with role, "name", states, [ref=s{N}e{M}], snapshotId
  notes: snapshots over 9KB saved to file (configurable via inlineLimit)

**snapshotSearch**: {text, pattern, role, exact, limit(10), context, near: {x, y, radius}}
  returns: {matches[], matchCount, searchedElements}
  notes: refs from snapshotSearch persist across subsequent commands

### Screenshots & PDF

Screenshots auto-captured on every visual action to `/tmp/cdp-skill/<tab>.before.png` and `.after.png`.

**pdf**: "filename" | {path, selector, landscape, printBackground, scale, paperWidth, paperHeight, margins, pageRanges, validate}
  returns: {path, fileSize, fileSizeFormatted, pageCount, dimensions}

### Dynamic Browser Execution

**pageFunction**: "() => expr" | {fn, refs(bool), timeout}
  notes: auto-wrapped as IIFE, refs passes window.__ariaRefs, return value auto-serialized, runs in current frame context

**poll**: "() => predicate" | {fn, interval(100), timeout(30000)}
  returns: {resolved, value|lastValue, elapsed}

**pipeline**: [{find+fill|click|type|check|select}, {waitFor}, {sleep}, {return}] | {steps[], timeout(30000)}
  returns: {completed, steps, results[]} or {completed: false, failedAt, error, results[]}
  notes: compiles to single async JS function, zero roundtrips between micro-ops

### Form Validation

**validate**: "selector"
  returns: {valid, message, validity}

**submit**: "selector" | {selector, reportValidity}
  returns: {submitted, valid, errors[]}

### Assertions

**assert**: {url: {contains|equals|startsWith|endsWith|matches}} | {text} | {selector, text, caseSensitive}

### Tab Management

**listTabs**: true
  returns: {count, tabs[]}

**closeTab**: "tabId"
  returns: {closed}

**openTab**: true | "url" | {url}
  returns: {opened, tab, url, navigated, viewportSnapshot, fullSnapshot, context}
  response: top-level `siteProfile` or `actionRequired` when URL provided (see Site Profiles)
  notes: REQUIRED as first step when no tab specified

### Viewport

**viewport**: "preset" | {width, height, deviceScaleFactor, mobile, hasTouch, isLandscape}
  presets: iphone-se, iphone-14, iphone-15-pro, ipad, ipad-pro-11, pixel-7, samsung-galaxy-s23, desktop, desktop-hd, macbook-pro-14
  returns: {width, height, deviceScaleFactor, mobile, hasTouch}

### Cookies

**cookies**: {get: true|[urls], name?} | {set: [{name, value, domain, expires}]} | {delete: "name", domain?} | {clear: true, domain?}
  expires formats: 30m, 1h, 7d, 1w, 1y, or Unix timestamp
  returns: get → {cookies[]}; set → {action, count}; delete/clear → {action, count}
  notes: get without URLs returns only current tab's domain cookies

### JavaScript Execution

**eval**: "expression" | {expression, await, timeout, serialize}
  returns: typed results (Number, Date, Map, Set, Element, NodeList, etc.)

### Optional Steps

Add `"optional": true` to any step to continue on failure (status becomes "skipped").

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tabs accumulating | Include `tab` in config |
| CONNECTION error | Use `chromeStatus` first |
| Chrome not found | Set `CHROME_PATH` env var |
| Element not found | Add `wait` step first |
| Clicks not working | Scroll into view first, or `force: true` |
| `back` returns noHistory | New tabs start at about:blank; navigate first |
| Select dropdown not working | Use click+click or press arrow keys |
| Type not appearing | Click input first to focus, then type |
| macOS: Chrome running but no CDP | `chromeStatus` launches new instance with CDP enabled |

## Best Practices

- **Handle `actionRequired` immediately** — when a response contains this field, complete it before doing anything else
- **Never launch Chrome directly** — always use `chromeStatus`
- **Use openTab** as your first step to create a tab; use the returned tab ID for all subsequent calls
- **Reuse only your own tabs** — other agents may share the browser
- **Update the site profile before closing** — add any quirks, selectors, or recipes you discovered
- **Close your tab when done** — `closeTab` with your tab ID
- **Discover before interacting** — use `snapshot` and `inspect` to understand the page
- **Use website navigation** — click links and submit forms; don't guess URLs
- **Prefer refs** over CSS selectors — use `snapshot` + refs for resilient targeting
- **Be persistent** — try alternative selectors, add waits, scroll first
