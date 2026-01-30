---
name: cdp-skill
description: Automate Chrome browser interactions via JSON passed to a Node.js CLI. Use when you need to navigate websites, fill forms, click elements, take screenshots, extract data, or run end-to-end browser tests. Supports accessibility snapshots for resilient element targeting.
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
  "status": "passed",
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

**Step 2: Execute automation steps**
```bash
node src/cdp-skill.js '{"steps":[{"goto":"https://google.com"}]}'
```

Stdin pipe also works:
```bash
echo '{"steps":[{"goto":"https://google.com"}]}' | node src/cdp-skill.js
```

### Tab Reuse (Critical)

Use a `targetId` from `chromeStatus` response or previous step output. **Include targetId in ALL subsequent calls** to reuse the same tab:

```bash
# Get available tabs from chromeStatus
RESULT=$(node src/cdp-skill.js '{"steps":[{"chromeStatus":true}]}')
TARGET_ID=$(echo "$RESULT" | jq -r '.chrome.tabs[0].targetId')

# Use targetId for all subsequent calls
node src/cdp-skill.js "{\"config\":{\"targetId\":\"$TARGET_ID\"},\"steps\":[{\"goto\":\"https://google.com\"}]}"
node src/cdp-skill.js "{\"config\":{\"targetId\":\"$TARGET_ID\"},\"steps\":[{\"click\":\"#btn\"}]}"
```

Omitting `targetId` creates orphan tabs that accumulate until Chrome restarts.


## Input Schema

```json
{
  "config": {
    "host": "localhost",
    "port": 9222,
    "targetId": "ABC123...",
    "timeout": 30000
  },
  "steps": [...]
}
```

Config is optional on first call. `targetId` required on subsequent calls.

## Output Schema

```json
{
  "status": "passed|failed|error",
  "tab": { "targetId": "ABC123...", "url": "...", "title": "..." },
  "steps": [{ "action": "goto", "status": "passed", "duration": 1234 }],
  "outputs": [{ "step": 2, "action": "query", "output": {...} }],
  "errors": [{ "step": 3, "action": "click", "error": "Element not found" }]
}
```

Exit code: `0` = passed, `1` = failed/error.

Error types: `PARSE`, `VALIDATION`, `CONNECTION`, `EXECUTION`


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

{"config":{"targetId":"..."},"steps":[{"click":{"ref":"e4"}}]}
```

Refs work with: `click`, `fill`, `hover`.


## Step Reference

### Chrome Management

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

**Note:** This step is lightweight - it doesn't create a session. Use it as your first call to ensure Chrome is ready, then use a `targetId` from the tabs list for subsequent calls.

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

**wait** / **delay** - Fixed time (ms)
```json
{"wait": 2000}
{"delay": 500}
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
Options: `selector`, `ref`, `x`/`y`, `verify`, `force`, `debug`, `timeout`

Returns: `{clicked: true}`. With `verify`: adds `{targetReceived: true/false}`. With navigation: adds `{navigated: true, newUrl: "..."}`.

**fill** - Fill input (clears first)
```json
{"fill": {"selector": "#email", "value": "user@example.com"}}
{"fill": {"ref": "e3", "value": "text"}}
```
Options: `selector`, `ref`, `value`, `clear` (default: true), `react`, `force`, `timeout`

**fillForm** - Fill multiple fields
```json
{"fillForm": {"#firstName": "John", "#lastName": "Doe"}}
```
Returns: `{total, filled, failed, results: [{selector, status, value}]}`

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

**drag** - Drag element from source to target
```json
{"drag": {"source": "#draggable", "target": "#dropzone"}}
{"drag": {"source": {"x": 100, "y": 100}, "target": {"x": 300, "y": 200}}}
{"drag": {"source": "#item", "target": "#container", "steps": 20, "delay": 10}}
```
Options: `source` (selector or {x,y}), `target` (selector or {x,y}), `steps` (default: 10), `delay` (ms, default: 0)

Returns: `{dragged: true, source: {x, y}, target: {x, y}, steps}`


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

**screenshot**
```json
{"screenshot": "result.png"}
{"screenshot": {"path": "full.png", "fullPage": true}}
{"screenshot": {"path": "/absolute/path/element.png", "selector": "#header"}}
```
Options: `path`, `fullPage`, `selector`, `format` (png|jpeg|webp), `quality`, `omitBackground`, `clip`

Returns: `{path, viewport: {width, height}, format, fullPage, selector}`

**pdf**
```json
{"pdf": "report.pdf"}
{"pdf": {"path": "/absolute/path/report.pdf", "landscape": true, "printBackground": true}}
```
Options: `path`, `selector`, `landscape`, `printBackground`, `scale`, `paperWidth`, `paperHeight`, margins, `pageRanges`, `validate`

Returns: `{path, fileSize, fileSizeFormatted, pageCount, dimensions, validation?}`

**Note:** Relative paths are saved to the platform temp directory (`$TMPDIR/cdp-skill/` on macOS/Linux, `%TEMP%\cdp-skill\` on Windows). Use absolute paths to save elsewhere.


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
```
Options: `mode` (ai|full), `root` (CSS selector or "role=X"), `maxDepth`, `maxElements`, `includeText`, `includeFrames`

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

**cookies** - Get/set/clear cookies
```json
{"cookies": {"get": true}}
{"cookies": {"get": ["https://google.com"], "name": "session_id"}}
{"cookies": {"set": [{"name": "token", "value": "abc", "domain": "example.com", "expires": "7d"}]}}
{"cookies": {"delete": "session_id"}}
{"cookies": {"clear": true}}
```

Set options: `name`, `value`, `url` or `domain`, `path`, `secure`, `httpOnly`, `sameSite`, `expires`

Expiration formats: `30m`, `1h`, `7d`, `1w`, `1y`, or Unix timestamp.

Returns: get → `{cookies: [...]}`, set → `{set: N}`, delete/clear → `{count: N}`


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


### Optional Steps

Add `"optional": true` to continue on failure:
```json
{"click": "#maybe-exists", "optional": true}
```


## Debug Mode

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
| Tabs accumulating | Include `targetId` in config |
| CONNECTION error | Use `chromeStatus` first - it auto-launches Chrome |
| Chrome not found | Set `CHROME_PATH` environment variable |
| Element not found | Add `wait` step first |
| Clicks not working | Scroll element into view first |

## Best Practices

1. **Start with chromeStatus** - Ensures Chrome is running and gives you available tabs
2. **Reuse only your own tabs** - Always pass `targetId` from your previous response; other agents may be using the same browser
3. **Discover before interacting** - Use `inspect` and `snapshot` to understand page structure
4. **Use website navigation** - Click links and submit forms; don't guess URLs
5. **Be persistent** - Try alternative selectors, add waits, scroll first
6. **Prefer refs** - Use `snapshot` + refs over brittle CSS selectors

## Feedback

If you encounter limitations, bugs, or feature requests that would significantly improve automation capabilities, please report them to the skill maintainer.
If you spot opportunities for speeding things up raise this in your results as well.
