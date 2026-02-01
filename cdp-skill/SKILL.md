---
name: cdp-skill
description: Automate Chrome browser interactions via JSON passed to a Node.js CLI. Use when you need to navigate websites, fill forms, click elements, extract data, or run end-to-end browser tests. Automatic screenshots on every action. Supports accessibility snapshots for resilient element targeting.
license: MIT
compatibility: Requires Chrome/Chromium (auto-launched if not running) and Node.js.
---

# CDP Browser Automation Skill

Automate Chrome browser interactions via JSON passed to a Node.js CLI. Produce JSON step definitions, not JavaScript code.

## Purpose

This skill enables **AI-powered browser automation**. The intended workflow:

1. **Test definitions** are written as markdown files describing what to test
2. **An agent** reads the definition, discovers page elements dynamically, and executes using this skill
3. The agent interprets intent and adapts to page changes - making automation resilient without brittle hardcoded selectors

## Quick Start

**Step 1: Check Chrome status (auto-launches if needed)**
```bash
node src/cdp-skill.js '{"steps":[{"chromeStatus":true}]}'
```

Returns:
```json
{
  "status": "ok",
  "chrome": {
    "running": true,
    "launched": true,
    "version": "Chrome/120.0.6099.109",
    "port": 9222,
    "tabs": [{"targetId": "ABC123", "url": "about:blank", "title": ""}]
  }
}
```

The skill auto-detects Chrome location on macOS, Linux, and Windows. Set `CHROME_PATH` environment variable for custom installations.

**Step 2: Open a tab and execute steps**
```bash
# Use openTab to create a new tab - REQUIRED for first call without targetId
node src/cdp-skill.js '{"steps":[{"openTab":"https://google.com"}]}'

# Or separate the open and navigate steps:
node src/cdp-skill.js '{"steps":[{"openTab":true},{"goto":"https://google.com"}]}'
```

Stdin pipe also works:
```bash
echo '{"steps":[{"openTab":"https://google.com"}]}' | node src/cdp-skill.js
```

### Tab Management (Critical)

**To create a new tab:** Use `{"openTab": "URL"}` or `{"openTab": true}` as your first step. This is REQUIRED when no tab id is provided.

**Tab IDs:** Each tab gets a short alias like `t1`, `t2`, etc. Use this in subsequent calls:

```bash
# First call creates tab "t1"
node src/cdp-skill.js '{"steps":[{"openTab":"https://google.com"}]}'
# Response: {"tab": {"id": "t1", ...}, "steps": [{"output": {"tab": "t1", ...}}]}

# Use tab id in subsequent calls
node src/cdp-skill.js '{"config":{"tab":"t1"},"steps":[{"click":"#btn"}]}'
node src/cdp-skill.js '{"config":{"tab":"t1"},"steps":[{"snapshot":true}]}'

# Close by id when done
node src/cdp-skill.js '{"steps":[{"closeTab":"t1"}]}'
```

**Important:**
- Calls **without** `tab` or `openTab` will **fail** with a helpful error message
- Tab IDs persist across CLI invocations (stored in temp file)
- Use `openTab` to explicitly create new tabs - prevents accidental tab accumulation


## Input Schema

```json
{
  "config": {
    "host": "localhost",
    "port": 9222,
    "tab": "t1",
    "timeout": 10000,
    "headless": false
  },
  "steps": [...]
}
```

Config options:
- `host`, `port` - CDP connection (default: localhost:9222)
- `tab` - Tab ID to use (required on subsequent calls)
- `timeout` - Command timeout in ms (default: 30000)
- `headless` - Run Chrome in headless mode (default: false). Prevents Chrome from stealing focus. Chrome auto-launches if not running.

## Output Schema

**Streamlined response format** - minimal payload with only actionable information:

```json
{
  "status": "ok",
  "tab": "t1",
  "navigated": true,
  "context": {
    "url": "https://example.com/page",
    "title": "Page Title",
    "scroll": {"y": 0, "percent": 0},
    "viewport": {"width": 1189, "height": 739}
  },
  "screenshot": "/tmp/cdp-skill/t1.after.png",
  "fullSnapshot": "/tmp/cdp-skill/t1.after.yaml",
  "viewportSnapshot": "- heading \"Title\" [level=1]\n- button \"Submit\" [ref=e1]\n...",
  "steps": [{"action": "goto", "status": "ok"}]
}
```

**Key fields:**
- `tab` - Short tab ID (e.g., "t1") for subsequent calls
- `context.scroll.y/percent` - Current scroll position (horizontal scroll omitted)
- `context.activeElement` - Detailed info about focused element (only when present)
- `context.modal` - Only present when a dialog is open
- `screenshot` - Path to current page screenshot
- `steps[]` - Minimal: `{action, status}` for success, adds `{params, error}` on failure
- `errors` - Only present when steps failed

**Console messages** - Errors and warnings captured at command-level (not per-step):
```json
{
  "console": {
    "errors": 1,
    "warnings": 2,
    "messages": [{"level": "error", "text": "TypeError: x is undefined", "source": "app.js:142"}]
  }
}
```

Exit code: `0` = ok, `1` = error.

Error types: `PARSE`, `VALIDATION`, `CONNECTION`, `EXECUTION`

**Failure context** - When a step fails, the step result includes page state to aid debugging:
```json
{
  "steps": [{
    "action": "click",
    "status": "error",
    "params": {"text": "Nonexistent"},
    "error": "Element not found",
    "context": {
      "url": "https://example.com/page",
      "title": "Example Page",
      "visibleButtons": ["Submit", "Cancel"],
      "visibleLinks": [{"text": "Home", "href": "..."}]
    }
  }],
  "errors": [{"step": 1, "action": "click", "error": "Element not found"}]
}
```

### Auto-Snapshot with Diff

Commands automatically capture page context and accessibility snapshot at the end of execution. This helps agents understand what changed:

**Navigation (URL changed):**
```json
{
  "status": "ok",
  "tab": "t1",
  "navigated": true,
  "context": {
    "url": "https://example.com/new-page",
    "title": "New Page Title",
    "scroll": {"y": 0, "percent": 0},
    "viewport": {"width": 1189, "height": 739}
  },
  "screenshot": "/tmp/cdp-skill/t1.after.png",
  "fullSnapshot": "/tmp/cdp-skill/t1.after.yaml",
  "viewportSnapshot": "- heading \"New Page\" [level=1]\n- button \"Submit\" [ref=e1]\n...",
  "steps": [{"action": "click", "status": "ok"}]
}
```

**Same-page interaction (scroll, expand, toggle):**
```json
{
  "status": "ok",
  "tab": "t1",
  "navigated": false,
  "context": {
    "url": "https://example.com/page",
    "scroll": {"y": 2400, "percent": 65},
    "activeElement": {"tag": "INPUT", "type": "text", "selector": "#search", "value": "", "editable": true, "box": {"x": 100, "y": 50, "width": 200, "height": 32}}
  },
  "screenshot": "/tmp/cdp-skill/t1.after.png",
  "fullSnapshot": "/tmp/cdp-skill/t1.after.yaml",
  "changes": {
    "summary": "Clicked. 3 added (e120, e121, e122), 1 removed (e1).",
    "added": ["- link \"New Link\" [ref=e120]"],
    "removed": ["- link \"Old Link\" [ref=e1]"],
    "changed": [{"ref": "e5", "field": "expanded", "from": false, "to": true}]
  },
  "steps": [{"action": "click", "status": "ok"}]
}
```

- `navigated: true` = URL pathname changed
- `navigated: false` = Same page, viewport diff shows what changed
- `viewportSnapshot` = Inline viewport-only snapshot (always included)
- `fullSnapshot` = Path to full page snapshot file (for detailed inspection)
- `changes.summary` = Human-readable one-liner with action context
- `changes.added` = Elements now visible in viewport that weren't before
- `changes.removed` = Elements that scrolled out of viewport
- `changes.changed` = Elements whose state changed (e.g., `[checked]`, `[expanded]`)
- `context.scroll.percent` = Current scroll position as percentage (0-100)
- `context.activeElement` = Focused element details (only when present):
  ```json
  {
    "tag": "INPUT",
    "type": "text",
    "selector": "#search-input",
    "value": "query",
    "placeholder": "Search...",
    "editable": true,
    "box": {"x": 100, "y": 50, "width": 200, "height": 32}
  }
  ```
- `context.modal` = Open dialog/modal title (only when present)


## Auto-Waiting

All interaction actions (`click`, `fill`, `hover`, `type`) automatically wait for elements to be actionable before proceeding. Retries use exponential backoff with jitter (1.9-2.1x random factor) to avoid thundering herd issues.

| Action | Waits For |
|--------|-----------|
| `click` | visible, enabled, stable, not covered, pointer-events |
| `fill`, `type` | visible, enabled, editable |
| `hover` | visible, stable |

**State definitions:**
- **visible**: In DOM, not `display:none`, not `visibility:hidden`, has dimensions
- **enabled**: Not disabled, not `aria-disabled="true"`
- **editable**: Enabled + not readonly + is input/textarea/select/contenteditable
- **stable**: Position unchanged for 3 consecutive animation frames
- **not covered**: Element at click coordinates matches target (detects overlays/modals)
- **pointer-events**: CSS `pointer-events` is not `none`

**Force options:**
- Use `force: true` to bypass all checks immediately
- **Auto-force**: When actionability times out but element exists, automatically retries with `force: true`. This helps with overlays, cookie banners, and loading spinners that may obscure elements. Outputs include `autoForced: true` when this occurs.

**Performance optimizations:**
- Browser-side polling using MutationObserver (reduces network round-trips)
- Content quads for accurate click positioning with CSS transforms
- InsertText API for fast form fills (like paste)
- IntersectionObserver for efficient viewport detection


## Element References

The `snapshot` step returns an accessibility tree with refs like `[ref=e4]`. Use refs in subsequent actions:

```json
{"steps":[{"snapshot": true}]}
// Response includes: - button "Submit" [ref=e4]

{"config":{"tab":"t1"},"steps":[{"click":{"ref":"e4"}}]}
```

Refs work with: `click`, `fill`, `hover`.


## Step Reference

### Chrome Management

> **IMPORTANT**: Never launch Chrome manually via shell commands (`open`, `start`, `google-chrome`, etc.). Always use `chromeStatus` to manage Chrome. The skill handles launching Chrome with the correct CDP debugging flags, detecting existing instances, and managing tabs. Manual Chrome launches will not have CDP enabled and will cause connection errors.

**chromeStatus** - Check if Chrome is running, auto-launch if not
```json
{"chromeStatus": true}
{"chromeStatus": {"autoLaunch": false}}
{"chromeStatus": {"headless": true}}
```
Options: `autoLaunch` (default: true), `headless` (default: false)

Returns:
```json
{
  "running": true,
  "launched": false,
  "version": "Chrome/120.0.6099.109",
  "port": 9222,
  "tabs": [
    {"targetId": "ABC123...", "url": "https://google.com", "title": "Google"}
  ]
}
```

If Chrome cannot be found: `{running: false, launched: false, error: "Chrome not found..."}`

**Note:** This step is lightweight - it doesn't create a session. Use it as your first call to ensure Chrome is ready, then use `openTab` to create a new tab.

### Navigation

**goto** - Navigate to URL
```json
{"goto": "https://google.com"}
```

**back** / **forward** - History navigation
```json
{"back": true}
{"forward": true}
```
Returns: `{url, title}` or `{noHistory: true}` if no history entry exists.

**waitForNavigation** - Wait for navigation to complete
```json
{"waitForNavigation": true}
{"waitForNavigation": {"timeout": 5000, "waitUntil": "networkidle"}}
```
Options: `timeout`, `waitUntil` (commit|domcontentloaded|load|networkidle)

**Note:** For click-then-wait patterns, the system uses a two-step event pattern to prevent race conditions - it subscribes to navigation events BEFORE clicking to ensure fast navigations aren't missed.


### Frame/iFrame Navigation

**listFrames** - List all frames in the page
```json
{"listFrames": true}
```
Returns: `{mainFrameId, currentFrameId, frames: [{frameId, url, name, parentId, depth}]}`

**switchToFrame** - Switch to an iframe
```json
{"switchToFrame": "iframe#content"}
{"switchToFrame": 0}
{"switchToFrame": {"selector": "iframe.editor"}}
{"switchToFrame": {"index": 1}}
{"switchToFrame": {"name": "myFrame"}}
```
Options: CSS selector (string), index (number), or object with `selector`, `index`, `name`, or `frameId`

Returns: `{frameId, url, name}`

**switchToMainFrame** - Switch back to main frame
```json
{"switchToMainFrame": true}
```
Returns: `{frameId, url, name}`

**Note:** After switching to a frame, all subsequent actions execute in that frame context until you switch to another frame or back to main.


### Waiting

**wait** - Wait for element
```json
{"wait": "#content"}
{"wait": {"selector": "#loading", "hidden": true}}
{"wait": {"selector": ".item", "minCount": 10}}
```

**wait** - Wait for text
```json
{"wait": {"text": "Welcome"}}
{"wait": {"textRegex": "Order #[A-Z0-9]+"}}
```

**wait** - Wait for URL
```json
{"wait": {"urlContains": "/success"}}
```

**wait** - Fixed time (ms)
```json
{"wait": 2000}
```

**Network idle detection:** The `networkidle` wait condition uses a precise counter-based tracker that monitors all network requests. It considers the network "idle" when no requests have been pending for 500ms.


### Interaction

**click** - Click element
```json
{"click": "#submit"}
{"click": {"selector": "#btn", "verify": true}}
{"click": {"ref": "e4"}}
{"click": {"x": 450, "y": 200}}
```
Options: `selector`, `ref`, `x`/`y`, `force`, `debug`, `timeout`, `jsClick`, `nativeOnly`

Returns: `{clicked: true, method: "cdp"|"jsClick"|"jsClick-auto"}`. With navigation: adds `{navigated: true, newUrl: "..."}`.

**Automatic Click Verification**
Clicks are automatically verified - if CDP mouse events don't reach the target element (common on React, Vue, Next.js sites), the system automatically falls back to JavaScript click. The `method` field shows what was used:
- `"cdp"` - CDP mouse events worked
- `"jsClick"` - User requested `jsClick: true`
- `"jsClick-auto"` - CDP failed, automatic fallback to JavaScript click

**click** - Force JavaScript click
```json
{"click": {"selector": "#submit", "jsClick": true}}
{"click": {"ref": "e4", "jsClick": true}}
```
Use `jsClick: true` to skip CDP and use JavaScript `element.click()` directly.

**click** - Disable auto-fallback
```json
{"click": {"selector": "#btn", "nativeOnly": true}}
```
Use `nativeOnly: true` to disable the automatic jsClick fallback. The click will use CDP only and report `targetReceived: false` if the click didn't reach the element.

**click** - Multi-selector fallback
```json
{"click": {"selectors": ["[ref=e4]", "#submit", {"role": "button", "name": "Submit"}]}}
```
Tries each selector in order until one succeeds. Accepts CSS selectors, refs, or role-based objects.

Returns: `{clicked: true, matchedSelector: "#submit"}` indicating which selector succeeded.

**click** - Click by visible text
```json
{"click": {"text": "Submit"}}
{"click": {"text": "Learn more", "exact": true}}
```
Finds and clicks an element containing the specified visible text. Use `exact: true` for exact match.

**click** - Frame auto-detection
```json
{"click": {"selector": "#editor", "searchFrames": true}}
```
When `searchFrames: true`, searches for the element in all frames (main and iframes) and automatically switches to the correct frame before clicking.

**click** - Scroll until visible
```json
{"click": {"selector": "#btn", "scrollUntilVisible": true}}
```
Automatically scrolls the page to bring the element into view before clicking. Useful for elements that are off-screen.

**click** - Auto-wait after click
```json
{"click": "#submit", "waitAfter": true}
{"click": {"selector": "#nav-link", "waitAfter": {"networkidle": true}}}
{"click": {"selector": "#tab", "waitAfter": {"delay": 500}}}
```
Waits for the page to settle after clicking. With `true`, waits for network idle. Can also specify `{delay: ms}` for fixed wait.

**click diagnostics** - When a click fails due to element interception (covered by another element), the error response includes diagnostic information:
```json
{
  "error": "Element is covered by another element",
  "interceptedBy": {
    "tagName": "div",
    "id": "modal-overlay",
    "className": "overlay active",
    "textContent": "Loading..."
  }
}
```
This helps identify overlays, modals, or loading spinners blocking the target element.

**fill** - Fill input (clears first)
```json
{"fill": {"selector": "#email", "value": "user@example.com"}}
{"fill": {"ref": "e3", "value": "text"}}
```
Options: `selector`, `ref`, `value`, `clear` (default: true), `react`, `force`, `timeout`

Returns: `{filled: true}`. If the page navigates during fill (e.g., SPA auto-complete): `{filled: true, navigated: true, newUrl: "..."}`

**fill** - Fill by label
```json
{"fill": {"label": "Email address", "value": "test@example.com"}}
{"fill": {"label": "Password", "value": "secret123", "exact": true}}
```
Finds an input by its associated label text and fills it. Uses `<label for="...">` associations or labels wrapping inputs. Use `exact: true` for exact label match.

**fillForm** - Fill multiple fields
```json
{"fillForm": {"#firstName": "John", "#lastName": "Doe"}}
```
Returns: `{total, filled, failed, results: [{selector, status, value}]}`

**fillActive** - Fill the currently focused element (no selector needed)
```json
{"fillActive": "search query"}
{"fillActive": {"value": "text", "clear": false}}
```
Options: `value`, `clear` (default: true)

Returns: `{filled: true, tag: "INPUT", type: "text", selector: "#search", valueBefore: "", valueAfter: "search query"}`

Useful when refs go stale or when you just clicked an element and want to type into it.

**type** - Type text (no clear)
```json
{"type": {"selector": "#search", "text": "query", "delay": 50}}
```
Returns: `{selector, typed, length}`

**press** - Keyboard key/combo
```json
{"press": "Enter"}
{"press": "Control+a"}
{"press": "Meta+Shift+Enter"}
```

**select** - Select text in input
```json
{"select": "#input"}
{"select": {"selector": "#input", "start": 0, "end": 5}}
```
Returns: `{selector, start, end, selectedText, totalLength}`

**hover** - Mouse over element
```json
{"hover": "#menu"}
{"hover": {"selector": "#tooltip", "duration": 500}}
```

**hover** - With result capture
```json
{"hover": {"selector": "#menu", "captureResult": true}}
```
When `captureResult: true`, captures information about elements that appear after hovering (tooltips, dropdowns, etc.).

Returns:
```json
{
  "hovered": true,
  "capturedResult": {
    "visibleElements": [
      {"selector": ".tooltip", "text": "Click to edit", "visible": true},
      {"selector": ".dropdown-menu", "itemCount": 5}
    ]
  }
}
```

**drag** - Drag element from source to target
```json
{"drag": {"source": "#draggable", "target": "#dropzone"}}
{"drag": {"source": {"ref": "e1"}, "target": {"ref": "e5"}}}
{"drag": {"source": {"ref": "e1", "offsetX": 20}, "target": {"ref": "e5", "offsetY": -10}}}
{"drag": {"source": {"x": 100, "y": 100}, "target": {"x": 300, "y": 200}}}
{"drag": {"source": "#item", "target": "#container", "steps": 20, "delay": 10}}
```
Options:
- `source`/`target`: selector string, ref string (`"e1"`), ref object with offsets (`{"ref": "e1", "offsetX": 10, "offsetY": -5}`), or coordinates (`{x, y}`)
- `offsetX`/`offsetY`: offset from element center (default: 0)
- `steps` (default: 10), `delay` (ms, default: 0)

Returns: `{dragged: true, method: "html5-dnd"|"range-input"|"mouse-events", source: {x, y}, target: {x, y}, steps}`

The `method` field indicates which drag strategy was used:
- `"html5-dnd"` - HTML5 Drag and Drop API (for draggable elements)
- `"range-input"` - Direct value manipulation (for `<input type="range">` sliders)
- `"mouse-events"` - JavaScript mouse event simulation (for custom drag implementations)

**selectOption** - Select option(s) in a native `<select>` dropdown
```json
{"selectOption": {"selector": "#country", "value": "US"}}
{"selectOption": {"selector": "#country", "label": "United States"}}
{"selectOption": {"selector": "#country", "index": 2}}
{"selectOption": {"selector": "#colors", "values": ["red", "blue"]}}
```
Options: `selector`, `value` (option value), `label` (option text), `index` (0-based), `values` (array for multi-select)

Returns: `{selected: ["US"], multiple: false}`

Note: This uses JavaScript to set `option.selected` and dispatch change events (same approach as Puppeteer/Playwright). Native dropdowns cannot be clicked via CDP.


### Scrolling

```json
{"scroll": "top"}
{"scroll": "bottom"}
{"scroll": "#element"}
{"scroll": {"deltaY": 500}}
{"scroll": {"x": 0, "y": 1000}}
```
Returns: `{scrollX, scrollY}`


### Data Extraction

**extract** - Extract structured data from page
```json
{"extract": "table.results"}
{"extract": {"selector": "table.results"}}
{"extract": {"selector": "ul.items", "type": "list"}}
{"extract": {"selector": "#data-grid", "type": "table", "includeHeaders": true}}
```
Options: `selector`, `type` (auto|table|list|text), `includeHeaders`

Automatically detects data structure (tables, lists, etc.) and returns structured output:

Table extraction:
```json
{
  "type": "table",
  "headers": ["Name", "Email", "Status"],
  "rows": [
    ["John Doe", "john@example.com", "Active"],
    ["Jane Smith", "jane@example.com", "Pending"]
  ],
  "rowCount": 2,
  "columnCount": 3
}
```

List extraction:
```json
{
  "type": "list",
  "items": ["Item 1", "Item 2", "Item 3"],
  "itemCount": 3
}
```

**getDom** - Get raw HTML of page or element
```json
{"getDom": true}
{"getDom": "#content"}
{"getDom": {"selector": "#content", "outer": false}}
```
Options: `selector` (CSS selector, omit for full page), `outer` (default: true, include element's own tag)

Returns: `{html, tagName, selector, length}`

**getBox** - Get bounding box and position of refs
```json
{"getBox": "e1"}
{"getBox": ["e1", "e2", "e3"]}
{"getBox": {"refs": ["e1", "e5"]}}
```

Single ref returns:
```json
{"x": 100, "y": 200, "width": 150, "height": 40, "center": {"x": 175, "y": 220}}
```

Multiple refs return object keyed by ref:
```json
{
  "e1": {"x": 100, "y": 200, "width": 150, "height": 40, "center": {"x": 175, "y": 220}},
  "e2": {"error": "stale", "message": "Element no longer in DOM"},
  "e3": {"error": "hidden", "box": {"x": 0, "y": 0, "width": 100, "height": 50}}
}
```

**refAt** - Get or create ref for element at coordinates
```json
{"refAt": {"x": 600, "y": 200}}
```

Finds the element at the given viewport coordinates and returns/creates a ref for it. Useful when you need to interact with an element found visually (e.g., from a screenshot) rather than by selector.

Returns:
```json
{
  "ref": "e5",
  "existing": false,
  "tag": "BUTTON",
  "selector": "#submit-btn",
  "clickable": true,
  "role": "button",
  "name": "Submit",
  "box": {"x": 580, "y": 190, "width": 100, "height": 40}
}
```

**elementsAt** - Get refs for elements at multiple coordinates
```json
{"elementsAt": [{"x": 100, "y": 200}, {"x": 300, "y": 400}, {"x": 500, "y": 150}]}
```

Batch version of `refAt` for checking multiple points at once.

Returns:
```json
{
  "count": 3,
  "elements": [
    {"x": 100, "y": 200, "ref": "e1", "tag": "BUTTON", "selector": "#btn1", "clickable": true, ...},
    {"x": 300, "y": 400, "ref": "e2", "tag": "DIV", "selector": "div.card", "clickable": false, ...},
    {"x": 500, "y": 150, "error": "No element at this coordinate"}
  ]
}
```

**elementsNear** - Get refs for elements near a coordinate
```json
{"elementsNear": {"x": 400, "y": 300}}
{"elementsNear": {"x": 400, "y": 300, "radius": 100}}
{"elementsNear": {"x": 400, "y": 300, "radius": 75, "limit": 10}}
```

Finds all visible elements within a radius (default 50px) of the given point, sorted by distance.

Options: `x`, `y`, `radius` (default: 50), `limit` (default: 20)

Returns:
```json
{
  "center": {"x": 400, "y": 300},
  "radius": 50,
  "count": 5,
  "elements": [
    {"ref": "e1", "tag": "BUTTON", "selector": "#nearby-btn", "clickable": true, "distance": 12, ...},
    {"ref": "e2", "tag": "SPAN", "selector": "span.label", "clickable": false, "distance": 28, ...}
  ]
}
```

Each element includes: `ref`, `tag`, `selector`, `clickable`, `role`, `name`, `distance`, `box`

**formState** - Dump current form state
```json
{"formState": "#checkout-form"}
{"formState": {"selector": "form.registration", "includeHidden": true}}
```
Options: `selector`, `includeHidden` (default: false)

Returns complete form state including all field values, validation states, and field types:
```json
{
  "selector": "#checkout-form",
  "action": "/api/checkout",
  "method": "POST",
  "fields": [
    {
      "name": "email",
      "type": "email",
      "value": "user@example.com",
      "label": "Email Address",
      "required": true,
      "valid": true
    },
    {
      "name": "quantity",
      "type": "number",
      "value": "2",
      "label": "Quantity",
      "required": true,
      "valid": true,
      "min": 1,
      "max": 100
    },
    {
      "name": "country",
      "type": "select",
      "value": "US",
      "label": "Country",
      "options": [
        {"value": "US", "text": "United States", "selected": true},
        {"value": "CA", "text": "Canada", "selected": false}
      ]
    }
  ],
  "valid": true,
  "fieldCount": 3
}
```

**query** - Find elements by CSS
```json
{"query": "h1"}
{"query": {"selector": "a", "limit": 5, "output": "href"}}
{"query": {"selector": "div", "output": ["text", "href"]}}
{"query": {"selector": "button", "output": {"attribute": "data-id"}}}
```
Options: `selector`, `limit` (default: 10), `output` (text|html|href|value|tag|array|attribute object), `clean`, `metadata`

Returns: `{selector, total, showing, results: [{index, value}]}`

**query** - Find by ARIA role
```json
{"query": {"role": "button"}}
{"query": {"role": "button", "name": "Submit"}}
{"query": {"role": "heading", "level": 2}}
{"query": {"role": ["button", "link"], "refs": true}}
```
Options: `role`, `name`, `nameExact`, `nameRegex`, `checked`, `disabled`, `level`, `countOnly`, `refs`

Supported roles: `button`, `textbox`, `checkbox`, `link`, `heading`, `listitem`, `option`, `combobox`, `radio`, `img`, `tab`, `tabpanel`, `menu`, `menuitem`, `dialog`, `alert`, `navigation`, `main`, `search`, `form`

**queryAll** - Multiple queries at once
```json
{"queryAll": {"title": "h1", "links": "a", "buttons": {"role": "button"}}}
```

**inspect** - Page overview
```json
{"inspect": true}
{"inspect": {"selectors": [".item"], "limit": 3}}
```
Returns: `{title, url, counts: {links, buttons, inputs, images, headings}, custom: {...}}`

**console** - Browser console logs
```json
{"console": true}
{"console": {"level": "error", "limit": 20, "stackTrace": true}}
```
Options: `level`, `type`, `since`, `limit`, `clear`, `stackTrace`

Returns: `{total, showing, messages: [{level, text, type, url, line, timestamp, stackTrace?}]}`

Note: Console logs don't persist across CLI invocations.


### Screenshots & PDF

**Automatic Screenshots** - Every visual action captures before/after screenshots automatically.

Visual actions: `goto`, `openTab`, `click`, `fill`, `type`, `hover`, `press`, `scroll`, `wait`, `snapshot`, `query`, `queryAll`, `inspect`, `eval`, `extract`, `formState`, `drag`, `select`, `validate`, `submit`, `assert`

Screenshots are saved to: `/tmp/cdp-skill/<tab>.before.png` and `/tmp/cdp-skill/<tab>.after.png`

```json
{
  "summary": "OK | 1 step | after: /tmp/cdp-skill/t1.after.png | ...",
  "screenshotBefore": "/tmp/cdp-skill/t1.before.png",
  "screenshotAfter": "/tmp/cdp-skill/t1.after.png",
  "hint": "Use Read tool to view screenshotAfter (current state) and screenshotBefore (previous state)"
}
```

**pdf** - Generate PDF of page
```json
{"pdf": "report.pdf"}
{"pdf": {"path": "/absolute/path/report.pdf", "landscape": true, "printBackground": true}}
```
Options: `path`, `selector`, `landscape`, `printBackground`, `scale`, `paperWidth`, `paperHeight`, margins, `pageRanges`, `validate`

Returns: `{path, fileSize, fileSizeFormatted, pageCount, dimensions, validation?}`

**Note:** Relative paths are saved to the platform temp directory (`$TMPDIR/cdp-skill/` on macOS/Linux, `%TEMP%\cdp-skill\` on Windows).


### JavaScript Execution

**eval** - Execute JS in page context
```json
{"eval": "document.title"}
{"eval": {"expression": "fetch('/api').then(r=>r.json())", "await": true}}
```
Options: `expression`, `await`, `timeout`, `serialize`

**Shell escaping tip:** For complex expressions with quotes or special characters, use a heredoc or JSON file:
```bash
# Heredoc approach (Unix)
node src/cdp-skill.js <<'EOF'
{"steps":[{"eval":"document.querySelectorAll('button').length"}]}
EOF

# Or save to file and pipe
cat steps.json | node src/cdp-skill.js
```

Returns typed results:
- Numbers: `{type: "number", repr: "Infinity|NaN|-Infinity"}`
- Date: `{type: "Date", value: "ISO string", timestamp: N}`
- Map: `{type: "Map", size: N, entries: [...]}`
- Set: `{type: "Set", size: N, values: [...]}`
- Element: `{type: "Element", tagName, id, className, textContent, isConnected}`
- NodeList: `{type: "NodeList", length: N, items: [...]}`


### Accessibility Snapshot

**snapshot** - Get accessibility tree
```json
{"snapshot": true}
{"snapshot": {"root": "#container", "maxElements": 500}}
{"snapshot": {"root": "role=main", "includeText": true}}
{"snapshot": {"includeFrames": true}}
{"snapshot": {"pierceShadow": true}}
```
Options: `mode` (ai|full), `root` (CSS selector or "role=X"), `maxDepth`, `maxElements`, `includeText`, `includeFrames`, `pierceShadow`

Returns YAML with: role, "name", states (`[checked]`, `[disabled]`, `[expanded]`, `[required]`, `[invalid]`, `[level=N]`), `[name=fieldName]` for form inputs, `[ref=eN]` for clicking.

```yaml
- navigation:
  - link "Home" [ref=e1]
- main:
  - heading "Welcome" [level=1]
  - textbox "Email" [required] [invalid] [name=email] [ref=e3]
  - button "Submit" [ref=e4]
```

Use `includeText: true` to capture static text (error messages, etc.). Elements with `role="alert"` or `role="status"` always include text.

Use `includeFrames: true` to include same-origin iframe content in the snapshot. Cross-origin iframes are marked with `crossOrigin: true`.

Use `pierceShadow: true` to traverse into open Shadow DOM trees. This is useful for web components that use Shadow DOM to encapsulate their internal structure.


### Viewport & Device Emulation

**viewport** - Set viewport size
```json
{"viewport": "iphone-14"}
{"viewport": {"width": 1280, "height": 720}}
{"viewport": {"width": 375, "height": 667, "mobile": true, "hasTouch": true, "isLandscape": true}}
```
Options: `width`, `height`, `deviceScaleFactor`, `mobile`, `hasTouch`, `isLandscape`

Returns: `{width, height, deviceScaleFactor, mobile, hasTouch}`

Presets: `iphone-se`, `iphone-14`, `iphone-15-pro`, `ipad`, `ipad-pro-11`, `pixel-7`, `samsung-galaxy-s23`, `desktop`, `desktop-hd`, `macbook-pro-14`, etc.


### Cookie Management

**cookies** - Get/set/clear cookies (defaults to current tab's domain)
```json
{"cookies": {"get": true}}
{"cookies": {"get": ["https://other-domain.com"], "name": "session_id"}}
{"cookies": {"set": [{"name": "token", "value": "abc", "domain": "example.com", "expires": "7d"}]}}
{"cookies": {"delete": "session_id"}}
{"cookies": {"delete": "session_id", "domain": "example.com"}}
{"cookies": {"clear": true}}
{"cookies": {"clear": true, "domain": "example.com"}}
```

**Note:** `get` without URLs returns only cookies for the current tab's domain. Specify explicit URLs to get cookies from other domains.

Set options: `name`, `value`, `url` or `domain`, `path`, `secure`, `httpOnly`, `sameSite`, `expires`

Clear/delete options: `domain` to limit to a specific domain (e.g., "example.com" matches ".example.com" and subdomains)

Expiration formats: `30m`, `1h`, `7d`, `1w`, `1y`, or Unix timestamp.

Returns: get → `{cookies: [...]}`, set → `{action: "set", count: N}`, delete/clear → `{action: "delete|clear", count: N}`


### Form Validation

**validate** - Check field validation state
```json
{"validate": "#email"}
```
Returns: `{valid, message, validity: {valueMissing, typeMismatch, ...}}`

**submit** - Submit form with validation
```json
{"submit": "form"}
{"submit": {"selector": "#login-form", "reportValidity": true}}
```
Returns: `{submitted, valid, errors: [{name, type, message, value}]}`


### Assertions

**assert** - Validate conditions
```json
{"assert": {"url": {"contains": "/success"}}}
{"assert": {"url": {"matches": "^https://.*\\.example\\.com"}}}
{"assert": {"text": "Welcome"}}
{"assert": {"selector": "h1", "text": "Title", "caseSensitive": false}}
```

URL options: `contains`, `equals`, `startsWith`, `endsWith`, `matches`


### Tab Management

**listTabs** - List open tabs
```json
{"listTabs": true}
```
Returns: `{count, tabs: [{targetId, url, title}]}`

**closeTab** - Close a tab
```json
{"closeTab": "ABC123..."}
```
Returns: `{closed: "<targetId>"}`

**openTab** - Create a new browser tab (REQUIRED as first step when no tab specified)
```json
{"openTab": true}                           // Open blank tab
{"openTab": "https://example.com"}          // Open and navigate to URL
{"openTab": {"url": "https://example.com"}} // Object format (allows future options)
```
Returns: `{opened: true, tab: "t1", url: "...", navigated: true, viewportSnapshot: "...", fullSnapshot: "...", context: {...}}`

Like other navigation actions, `openTab` returns an inline accessibility snapshot when a URL is provided. This establishes the baseline for diff comparison on subsequent actions.

Use `openTab` when starting a new automation session. Use the returned `tab` id (e.g., "t1") in subsequent calls via `config.tab`.


### Optional Steps

Add `"optional": true` to continue on failure:
```json
{"click": "#maybe-exists", "optional": true}
```


## Debug Mode

### CLI Debug Logging

Use the `--debug` flag to log all requests and responses to a `log/` directory:
```bash
node src/cdp-skill.js --debug '{"steps":[{"goto":"https://google.com"}]}'
```

Creates files like:
- `log/001-chromeStatus.ok.json` - No tab (chromeStatus doesn't use tabs)
- `log/002-t1-openTab.ok.json` - Tab ID included when available
- `log/003-t1-click-fill.ok.json` - Multiple actions shown
- `log/004-t1-scroll.error.json` - Error cases include `.error` suffix

Files are numbered sequentially and include tab ID + action names for easy identification.

### Config-Based Debug

Capture screenshots/DOM before and after each action:
```json
{
  "config": {
    "debug": true,
    "debugOptions": {"captureScreenshots": true, "captureDom": true}
  },
  "steps": [...]
}
```

Debug output goes to the platform temp directory by default. Set `"outputDir": "/path/to/dir"` to override.


## Not Supported

Handle via multiple invocations:
- Conditional logic / loops
- Variables / templating
- File uploads
- Dialog handling (alert, confirm)


## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tabs accumulating | Include `tab` in config |
| CONNECTION error | Use `chromeStatus` first - it auto-launches Chrome |
| Chrome not found | Set `CHROME_PATH` environment variable |
| Element not found | Add `wait` step first |
| Clicks not working | Scroll element into view first, or use `force: true` |
| Click/hover timeout on animations | Use `force: true` - auto-force triggers after 10s timeout |
| `back` returns `noHistory: true` | New tabs start at `about:blank` with no history. Navigate first, then use `back` |
| Select dropdown not working | Use `click` + `click` (open then select), or `press` arrow keys |
| Type not appearing | Ensure input is focused with `click` first, then use `type` |
| "Chrome has no tabs" | Use `chromeStatus` - it auto-creates a tab |
| macOS: Chrome running but no CDP | `chromeStatus` launches a new instance with CDP enabled |

### macOS Chrome Behavior

On macOS, Chrome continues running as a background process even after closing all windows. This can cause issues:

1. **Chrome running without CDP port**: If Chrome was started normally (not via this skill), it won't have the CDP debugging port enabled. The skill detects this and launches a **new** Chrome instance with CDP enabled (it never closes your existing Chrome).

2. **Chrome running with CDP but no tabs**: After closing all Chrome windows, the process may still be listening on the CDP port but have no tabs. The skill automatically creates a new tab in this case.

The `chromeStatus` step handles both scenarios automatically:
```json
{"chromeStatus": true}
```

Response when Chrome needed intervention:
```json
{
  "running": true,
  "launched": true,
  "createdTab": true,
  "note": "Chrome was running without CDP port. Launched new instance with debugging enabled. Created new tab.",
  "tabs": [{"targetId": "ABC123", "url": "about:blank", "title": ""}]
}
```

**Important**: The skill never closes Chrome windows or processes without explicit user action. It only launches new instances or creates new tabs as needed.

## Best Practices

1. **NEVER launch Chrome directly** - Always use `chromeStatus` to manage Chrome. Do NOT run shell commands like `open -a "Google Chrome"` or spawn Chrome processes yourself. The skill handles all Chrome lifecycle management including:
   - Launching Chrome with the correct debugging flags
   - Detecting existing Chrome instances
   - Creating tabs when needed
   - Handling macOS background process issues

2. **Use openTab to create your tab** - Your first call must include `{"openTab":"url"}` as the first step to create a new tab. Use the returned `tab` id (e.g., "t1") for subsequent calls.

3. **Reuse only your own tabs** - Always pass `tab` from your previous response; other agents may be using the same browser

4. **Clean up your tab when done** - After completing your test (pass or fail), close your tab unless instructed otherwise:
   ```json
   {"closeTab": "YOUR_TARGET_ID"}
   ```

5. **Discover before interacting** - Use `inspect` and `snapshot` to understand page structure

6. **Use website navigation** - Click links and submit forms; don't guess URLs

7. **Be persistent** - Try alternative selectors, add waits, scroll first

8. **Prefer refs** - Use `snapshot` + refs over brittle CSS selectors

## Feedback

If you encounter limitations, bugs, or feature requests that would significantly improve automation capabilities, please report them to the skill maintainer.
If you spot opportunities for speeding things up raise this in your results as well.
