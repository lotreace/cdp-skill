# CDP Skill — Examples

Worked examples and JSON code blocks for every step type. See SKILL.md for the compact reference.

---

## Quick Start

### Check Chrome Status
```json
{"steps":[{"chromeStatus":true}]}
```

Response:
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

### Open a Tab
```json
{"steps":[{"openTab":"https://google.com"}]}
```

Separate open and navigate:
```json
{"steps":[{"openTab":true},{"goto":"https://google.com"}]}
```

Stdin pipe:
```bash
echo '{"steps":[{"openTab":"https://google.com"}]}' | node src/cdp-skill.js
```

### Tab Lifecycle
```json
{"steps":[{"openTab":"https://google.com"}]}
```
Response: `{"tab": {"id": "t1", ...}, "steps": [{"output": {"tab": "t1", ...}}]}`

Subsequent calls:
```json
{"config":{"tab":"t1"},"steps":[{"click":"#btn"}]}
```
```json
{"config":{"tab":"t1"},"steps":[{"snapshot":true}]}
```

Close when done:
```json
{"steps":[{"closeTab":"t1"}]}
```

---

## Input / Output Schema

### Full Output Example
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
  "viewportSnapshot": "- heading \"Title\" [level=1]\n- button \"Submit\" [ref=s1e1]\n...",
  "steps": [{"action": "goto", "status": "ok"}]
}
```

### Console Output
```json
{
  "console": {
    "errors": 1,
    "warnings": 2,
    "messages": [{"level": "error", "text": "TypeError: x is undefined", "source": "app.js:142"}]
  }
}
```

### Failure Diagnostics
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
      "scrollPosition": {"x": 0, "y": 1200, "maxY": 5000, "percentY": 24},
      "visibleButtons": [
        {"text": "Submit", "selector": "#submit-btn", "ref": "s1e4"},
        {"text": "Cancel", "selector": "button.cancel", "ref": "s1e5"}
      ],
      "visibleLinks": [{"text": "Home", "href": "..."}],
      "visibleErrors": ["Please fill in all required fields"],
      "nearMatches": [
        {"text": "Submit Form", "selector": "button.submit-form", "ref": "s1e12", "score": 70},
        {"text": "Submit Feedback", "selector": "#feedback-submit", "ref": "s1e15", "score": 50}
      ]
    }
  }],
  "errors": [{"step": 1, "action": "click", "error": "Element not found"}]
}
```

---

## Auto-Snapshot Diff

### Navigation (URL changed)
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
  "viewportSnapshot": "- heading \"New Page\" [level=1]\n- button \"Submit\" [ref=s1e1]\n...",
  "steps": [{"action": "click", "status": "ok"}]
}
```

### Same-Page Interaction (scroll, expand, toggle)
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
    "summary": "Clicked. 3 added (s1e120, s1e121, s1e122), 1 removed (s1e1).",
    "added": ["- link \"New Link\" [ref=s1e120]"],
    "removed": ["- link \"Old Link\" [ref=s1e1]"],
    "changed": [{"ref": "s1e5", "field": "expanded", "from": false, "to": true}]
  },
  "steps": [{"action": "click", "status": "ok"}]
}
```

### Active Element Context
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

---

## Chrome Management

### chromeStatus Variants
```json
{"chromeStatus": true}
{"chromeStatus": {"autoLaunch": false}}
{"chromeStatus": {"headless": true}}
```

Response:
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

Chrome not found:
```json
{"running": false, "launched": false, "error": "Chrome not found..."}
```

### macOS Chrome Behavior

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

---

## Navigation

### goto
```json
{"goto": "https://google.com"}
{"goto": {"url": "https://google.com", "waitUntil": "networkidle"}}
```

### reload
```json
{"reload": true}
{"reload": {"waitUntil": "networkidle"}}
```

### back / forward
```json
{"back": true}
{"forward": true}
```

### waitForNavigation
```json
{"waitForNavigation": true}
{"waitForNavigation": {"timeout": 5000, "waitUntil": "networkidle"}}
```

---

## Frames

### listFrames
```json
{"listFrames": true}
```

### switchToFrame
```json
{"switchToFrame": "iframe#content"}
{"switchToFrame": 0}
{"switchToFrame": {"selector": "iframe.editor"}}
{"switchToFrame": {"index": 1}}
{"switchToFrame": {"name": "myFrame"}}
```

### switchToMainFrame
```json
{"switchToMainFrame": true}
```

---

## Waiting

### wait — Element
```json
{"wait": "#content"}
{"wait": {"selector": "#loading", "hidden": true}}
{"wait": {"selector": ".item", "minCount": 10}}
```

### wait — Text
```json
{"wait": {"text": "Welcome"}}
{"wait": {"textRegex": "Order #[A-Z0-9]+"}}
```

### wait — URL
```json
{"wait": {"urlContains": "/success"}}
```

### wait — Fixed time
```json
{"wait": 2000}
```

---

## Click

### Basic
```json
{"click": "#submit"}
{"click": {"selector": "#btn", "verify": true}}
{"click": {"ref": "s1e4"}}
{"click": {"x": 450, "y": 200}}
```

### Force JavaScript click
```json
{"click": {"selector": "#submit", "jsClick": true}}
{"click": {"ref": "s1e4", "jsClick": true}}
```

### Disable auto-fallback
```json
{"click": {"selector": "#btn", "nativeOnly": true}}
```

### Multi-selector fallback
```json
{"click": {"selectors": ["[ref=s1e4]", "#submit", {"role": "button", "name": "Submit"}]}}
```
Response: `{clicked: true, matchedSelector: "#submit"}`

### Click by visible text
```json
{"click": {"text": "Submit"}}
{"click": {"text": "Learn more", "exact": true}}
```

### Frame auto-detection
```json
{"click": {"selector": "#editor", "searchFrames": true}}
```

### Scroll until visible
```json
{"click": {"selector": "#btn", "scrollUntilVisible": true}}
```

### Auto-wait after click
```json
{"click": "#submit", "waitAfter": true}
{"click": {"selector": "#nav-link", "waitAfter": {"networkidle": true}}}
{"click": {"selector": "#tab", "waitAfter": {"delay": 500}}}
```

### Click diagnostics (element covered)
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

---

## Fill

### Basic
```json
{"fill": {"selector": "#email", "value": "user@example.com"}}
{"fill": {"ref": "s1e3", "value": "text"}}
```

### Fill by label
```json
{"fill": {"label": "Email address", "value": "test@example.com"}}
{"fill": {"label": "Password", "value": "secret123", "exact": true}}
```

### fillForm — Multiple fields
```json
{"fillForm": {"#firstName": "John", "#lastName": "Doe"}}
```
Response: `{total, filled, failed, results: [{selector, status, value}]}`

### fillActive — Currently focused element
```json
{"fillActive": "search query"}
{"fillActive": {"value": "text", "clear": false}}
```
Response:
```json
{"filled": true, "tag": "INPUT", "type": "text", "selector": "#search", "valueBefore": "", "valueAfter": "search query"}
```

---

## Type / Press / Select

### type
```json
{"type": {"selector": "#search", "text": "query", "delay": 50}}
```

### press
```json
{"press": "Enter"}
{"press": "Control+a"}
{"press": "Meta+Shift+Enter"}
```

### select
```json
{"select": "#input"}
{"select": {"selector": "#input", "start": 0, "end": 5}}
```

---

## Hover

### Basic
```json
{"hover": "#menu"}
{"hover": {"selector": "#tooltip", "duration": 500}}
```

### With result capture
```json
{"hover": {"selector": "#menu", "captureResult": true}}
```
Response:
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

---

## Drag

```json
{"drag": {"source": "#draggable", "target": "#dropzone"}}
{"drag": {"source": {"ref": "s1e1"}, "target": {"ref": "s1e5"}}}
{"drag": {"source": {"ref": "s1e1", "offsetX": 20}, "target": {"ref": "s1e5", "offsetY": -10}}}
{"drag": {"source": {"x": 100, "y": 100}, "target": {"x": 300, "y": 200}}}
{"drag": {"source": "#item", "target": "#container", "steps": 20, "delay": 10}}
```

---

## selectOption

```json
{"selectOption": {"selector": "#country", "value": "US"}}
{"selectOption": {"selector": "#country", "label": "United States"}}
{"selectOption": {"selector": "#country", "index": 2}}
{"selectOption": {"selector": "#colors", "values": ["red", "blue"]}}
```

---

## Scrolling

```json
{"scroll": "top"}
{"scroll": "bottom"}
{"scroll": "#element"}
{"scroll": {"deltaY": 500}}
{"scroll": {"x": 0, "y": 1000}}
```

---

## Data Extraction

### extract
```json
{"extract": "table.results"}
{"extract": {"selector": "table.results"}}
{"extract": {"selector": "ul.items", "type": "list"}}
{"extract": {"selector": "#data-grid", "type": "table", "includeHeaders": true}}
```

Table response:
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

List response:
```json
{
  "type": "list",
  "items": ["Item 1", "Item 2", "Item 3"],
  "itemCount": 3
}
```

### getDom
```json
{"getDom": true}
{"getDom": "#content"}
{"getDom": {"selector": "#content", "outer": false}}
```

### getBox
```json
{"getBox": "s1e1"}
{"getBox": ["s1e1", "s1e2", "s2e3"]}
{"getBox": {"refs": ["s1e1", "s1e5"]}}
```

Single ref:
```json
{"x": 100, "y": 200, "width": 150, "height": 40, "center": {"x": 175, "y": 220}}
```

Multiple refs:
```json
{
  "s1e1": {"x": 100, "y": 200, "width": 150, "height": 40, "center": {"x": 175, "y": 220}},
  "s1e2": {"error": "stale", "message": "Element no longer in DOM"},
  "s2e3": {"error": "hidden", "box": {"x": 0, "y": 0, "width": 100, "height": 50}}
}
```

### refAt
```json
{"refAt": {"x": 600, "y": 200}}
```
Response:
```json
{
  "ref": "s1e5",
  "existing": false,
  "tag": "BUTTON",
  "selector": "#submit-btn",
  "clickable": true,
  "role": "button",
  "name": "Submit",
  "box": {"x": 580, "y": 190, "width": 100, "height": 40}
}
```

### elementsAt
```json
{"elementsAt": [{"x": 100, "y": 200}, {"x": 300, "y": 400}, {"x": 500, "y": 150}]}
```
Response:
```json
{
  "count": 3,
  "elements": [
    {"x": 100, "y": 200, "ref": "s1e1", "tag": "BUTTON", "selector": "#btn1", "clickable": true},
    {"x": 300, "y": 400, "ref": "s1e2", "tag": "DIV", "selector": "div.card", "clickable": false},
    {"x": 500, "y": 150, "error": "No element at this coordinate"}
  ]
}
```

### elementsNear
```json
{"elementsNear": {"x": 400, "y": 300}}
{"elementsNear": {"x": 400, "y": 300, "radius": 100}}
{"elementsNear": {"x": 400, "y": 300, "radius": 75, "limit": 10}}
```
Response:
```json
{
  "center": {"x": 400, "y": 300},
  "radius": 50,
  "count": 5,
  "elements": [
    {"ref": "s1e1", "tag": "BUTTON", "selector": "#nearby-btn", "clickable": true, "distance": 12},
    {"ref": "s1e2", "tag": "SPAN", "selector": "span.label", "clickable": false, "distance": 28}
  ]
}
```

### formState
```json
{"formState": "#checkout-form"}
{"formState": {"selector": "form.registration", "includeHidden": true}}
```
Response:
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

---

## Query

### By CSS
```json
{"query": "h1"}
{"query": {"selector": "a", "limit": 5, "output": "href"}}
{"query": {"selector": "div", "output": ["text", "href"]}}
{"query": {"selector": "button", "output": {"attribute": "data-id"}}}
```

### By ARIA role
```json
{"query": {"role": "button"}}
{"query": {"role": "button", "name": "Submit"}}
{"query": {"role": "heading", "level": 2}}
{"query": {"role": ["button", "link"], "refs": true}}
```

### queryAll
```json
{"queryAll": {"title": "h1", "links": "a", "buttons": {"role": "button"}}}
```

### inspect
```json
{"inspect": true}
{"inspect": {"selectors": [".item"], "limit": 3}}
```

### console
```json
{"console": true}
{"console": {"level": "error", "limit": 20, "stackTrace": true}}
```

---

## Accessibility Snapshot

### snapshot
```json
{"snapshot": true}
{"snapshot": {"root": "#container", "maxElements": 500}}
{"snapshot": {"root": "role=main", "includeText": true}}
{"snapshot": {"includeFrames": true}}
{"snapshot": {"pierceShadow": true}}
{"snapshot": {"detail": "interactive"}}
{"snapshot": {"inlineLimit": 28000}}
{"snapshot": {"since": "s1"}}
```

YAML output example:
```yaml
- navigation:
  - link "Home" [ref=s1e1]
- main:
  - heading "Welcome" [level=1]
  - textbox "Email" [required] [invalid] [name=email] [ref=s1e3]
  - button "Submit" [ref=s1e4]
```

### Snapshot Caching (since)
```json
{"snapshot": {"since": "s1"}}
```

Unchanged:
```json
{
  "unchanged": true,
  "snapshotId": "s1",
  "message": "Page unchanged since s1"
}
```

Changed:
```json
{
  "snapshotId": "s2",
  "yaml": "- button \"Login\" [ref=s2e1]\n...",
  "refs": {}
}
```

### Detail: summary
```json
{"snapshot": {"detail": "summary"}}
```
```yaml
# Snapshot Summary
# Total elements: 1847
# Interactive elements: 67
# Viewport elements: 23

landmarks:
  - role: main
    interactiveCount: 47
    children: [form, navigation, article]
```

### Large snapshot (auto-file)
```json
{
  "yaml": null,
  "artifacts": {"snapshot": "/tmp/cdp-skill/t1.snapshot.yaml"},
  "snapshotSize": 125000,
  "truncatedInline": true
}
```

### snapshotSearch
```json
{"snapshotSearch": {"text": "Submit"}}
{"snapshotSearch": {"text": "Submit", "role": "button"}}
{"snapshotSearch": {"pattern": "^Save.*draft$", "role": "button"}}
{"snapshotSearch": {"role": "button", "limit": 20}}
{"snapshotSearch": {"text": "Edit", "near": {"x": 500, "y": 300, "radius": 100}}}
```
Response:
```json
{
  "matches": [
    {"path": "main > form > button", "ref": "s1e47", "name": "Submit Form", "role": "button"},
    {"path": "dialog > button", "ref": "s1e89", "name": "Submit Feedback", "role": "button"}
  ],
  "matchCount": 2,
  "searchedElements": 1847
}
```

---

## Screenshots & PDF

### Automatic Screenshots
Every visual action captures before/after screenshots:
```json
{
  "summary": "OK | 1 step | after: /tmp/cdp-skill/t1.after.png | ...",
  "screenshotBefore": "/tmp/cdp-skill/t1.before.png",
  "screenshotAfter": "/tmp/cdp-skill/t1.after.png",
  "hint": "Use Read tool to view screenshotAfter (current state) and screenshotBefore (previous state)"
}
```

### pdf
```json
{"pdf": "report.pdf"}
{"pdf": {"path": "/absolute/path/report.pdf", "landscape": true, "printBackground": true}}
```

---

## Dynamic Browser Execution

### pageFunction
```json
{"pageFunction": "() => document.title"}
{"pageFunction": "(document) => [...document.querySelectorAll('.item')].map(i => ({text: i.textContent, href: i.href}))"}
```

Object form:
```json
{"pageFunction": {"fn": "(refs) => refs.size", "refs": true}}
{"pageFunction": {"fn": "() => document.querySelectorAll('button').length", "timeout": 5000}}
```

### poll
```json
{"poll": "() => document.querySelector('.loaded') !== null"}
{"poll": "() => document.readyState === 'complete'"}
```

Object form:
```json
{"poll": {"fn": "() => !document.querySelector('.spinner') && document.querySelector('.results')?.children.length > 0", "interval": 100, "timeout": 10000}}
```

### pipeline
```json
{"pipeline": [
  {"find": "#username", "fill": "admin"},
  {"find": "#password", "fill": "secret_sauce"},
  {"find": "#login-button", "click": true},
  {"waitFor": "() => location.pathname.includes('/inventory')"},
  {"sleep": 500},
  {"return": "() => document.querySelector('.title')?.textContent"}
]}
```

Object form with timeout:
```json
{"pipeline": {"steps": [{"find": "#btn", "click": true}], "timeout": 15000}}
```

---

## Action Hooks

### readyWhen
```json
{"click": {"ref": "s1e5", "readyWhen": "() => !document.querySelector('.loading')"}}
{"fill": {"selector": "#email", "value": "test@test.com", "readyWhen": "() => document.querySelector('#email').offsetHeight > 0"}}
```

### settledWhen
```json
{"click": {"ref": "s1e5", "settledWhen": "() => document.querySelector('.results')?.children.length > 0"}}
{"click": {"selector": "#nav-link", "settledWhen": "() => location.href.includes('/results')"}}
```

### observe
```json
{"click": {"ref": "s1e5", "observe": "() => ({url: location.href, count: document.querySelectorAll('.item').length})"}}
```

### Combined hooks
```json
{"click": {
  "ref": "s1e5",
  "readyWhen": "() => !document.querySelector('.loading')",
  "settledWhen": "() => document.querySelectorAll('.result').length > 0",
  "observe": "() => document.querySelectorAll('.result').length"
}}
```

---

## Site Profiles

### writeSiteProfile
```json
{"writeSiteProfile": {"domain": "github.com", "content": "# github.com\nFitted: 2024-02-03 (full)\n\n## Environment\n..."}}
```

### Full Profile Template
```markdown
# example.com
Updated: 2024-02-03  |  Fingerprint: <hash>

## Environment
- React 18.x, Next.js (SSR)
- SPA with pushState navigation
- Has <main> element: #__next > main

## Quirks
- Turbo intercepts link clicks — use settledWhen with URL check
- File tree uses virtualization — only visible rows in DOM

## Strategies
### fill (React controlled inputs)
\`\`\`js
(el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', {bubbles: true}));
}
\`\`\`

## Regions
- mainContent: `main, [role="main"]`
- navigation: `.nav-bar`

## Recipes
### Login
\`\`\`json
{"pipeline": [
  {"find": "#username", "fill": "{{user}}"},
  {"find": "#password", "fill": "{{pass}}"},
  {"find": "#login", "click": true},
  {"waitFor": "() => location.pathname !== '/login'"}
]}
\`\`\`
```

---

## JavaScript Execution

### eval
```json
{"eval": "document.title"}
{"eval": {"expression": "fetch('/api').then(r=>r.json())", "await": true}}
```

### Shell Escaping Tips
```bash
# Heredoc approach (Unix)
node src/cdp-skill.js <<'EOF'
{"steps":[{"eval":"document.querySelectorAll('button').length"}]}
EOF

# Or save to file and pipe
cat steps.json | node src/cdp-skill.js
```

### Typed Return Values
- Numbers: `{type: "number", repr: "Infinity|NaN|-Infinity"}`
- Date: `{type: "Date", value: "ISO string", timestamp: N}`
- Map: `{type: "Map", size: N, entries: [...]}`
- Set: `{type: "Set", size: N, values: [...]}`
- Element: `{type: "Element", tagName, id, className, textContent, isConnected}`
- NodeList: `{type: "NodeList", length: N, items: [...]}`

---

## Viewport

```json
{"viewport": "iphone-14"}
{"viewport": {"width": 1280, "height": 720}}
{"viewport": {"width": 375, "height": 667, "mobile": true, "hasTouch": true, "isLandscape": true}}
```

---

## Cookies

```json
{"cookies": {"get": true}}
{"cookies": {"get": ["https://other-domain.com"], "name": "session_id"}}
{"cookies": {"set": [{"name": "token", "value": "abc", "domain": "example.com", "expires": "7d"}]}}
{"cookies": {"delete": "session_id"}}
{"cookies": {"delete": "session_id", "domain": "example.com"}}
{"cookies": {"clear": true}}
{"cookies": {"clear": true, "domain": "example.com"}}
```

---

## Form Validation

### validate
```json
{"validate": "#email"}
```

### submit
```json
{"submit": "form"}
{"submit": {"selector": "#login-form", "reportValidity": true}}
```

---

## Assertions

```json
{"assert": {"url": {"contains": "/success"}}}
{"assert": {"url": {"matches": "^https://.*\\.example\\.com"}}}
{"assert": {"text": "Welcome"}}
{"assert": {"selector": "h1", "text": "Title", "caseSensitive": false}}
```

---

## Optional Steps

```json
{"click": "#maybe-exists", "optional": true}
```

---

## Debug Mode

### CLI Debug Logging
```bash
node src/cdp-skill.js --debug '{"steps":[{"goto":"https://google.com"}]}'
```

Creates files like:
- `log/001-chromeStatus.ok.json`
- `log/002-t1-openTab.ok.json`
- `log/003-t1-click-fill.ok.json`
- `log/004-t1-scroll.error.json`

### Config-Based Debug
```json
{
  "config": {
    "debug": true,
    "debugOptions": {"captureScreenshots": true, "captureDom": true}
  },
  "steps": []
}
```
