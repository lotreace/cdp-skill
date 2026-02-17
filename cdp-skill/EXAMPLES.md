# CDP Skill — Examples

Worked examples and JSON code blocks for every step type. See SKILL.md for the compact reference.

---

## Quick Start

### Open a Tab (Chrome auto-launches)
```json
{"steps":[{"newTab":"https://google.com"}]}
```

Non-default Chrome (rare):
```json
{"steps":[{"newTab":{"url":"https://google.com","port":9333,"headless":true}}]}
```

Separate open and navigate:
```json
{"steps":[{"newTab":true},{"goto":"https://google.com"}]}
```

Stdin pipe:
```bash
echo '{"steps":[{"newTab":"https://google.com"}]}' | node scripts/cdp-skill.js
```

### Tab Lifecycle
```json
{"steps":[{"newTab":"https://google.com"}]}
```
Response: `{"tab": "t1", "steps": [{"action": "newTab", "status": "ok", ...}]}`

Subsequent calls:
```json
{"tab":"t1","steps":[{"click":"#btn"}]}
```
```json
{"tab":"t1","steps":[{"snapshot":true}]}
```

Optional timeout:
```json
{"tab":"t1","timeout":60000,"steps":[{"goto":"https://slow-site.com"}]}
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
  "viewportSnapshot": "/tmp/cdp-skill/t1.viewport.yaml",
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
        {"text": "Submit", "selector": "#submit-btn", "ref": "f0s1e4"},
        {"text": "Cancel", "selector": "button.cancel", "ref": "f0s1e5"}
      ],
      "visibleLinks": [{"text": "Home", "href": "..."}],
      "visibleErrors": ["Please fill in all required fields"],
      "nearMatches": [
        {"text": "Submit Form", "selector": "button.submit-form", "ref": "f0s1e12", "score": 70},
        {"text": "Submit Feedback", "selector": "#feedback-submit", "ref": "f0s1e15", "score": 50}
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
  "viewportSnapshot": "/tmp/cdp-skill/t1.viewport.yaml",
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
    "summary": "Clicked. 3 added (f0s1e120, f0s1e121, f0s1e122), 1 removed (f0s1e1).",
    "added": ["- link \"New Link\" [ref=f0s1e120]"],
    "removed": ["- link \"Old Link\" [ref=f0s1e1]"],
    "changed": [{"ref": "f0s1e5", "field": "expanded", "from": false, "to": true}]
  },
  "steps": [{"action": "click", "status": "ok"}]
}
```

---

## Navigation

### goto
```json
{"goto": "https://google.com"}
{"goto": {"url": "https://google.com", "waitUntil": "networkidle"}}
```

### back / forward
```json
{"back": true}
{"forward": true}
```
Response:
```json
{"url": "https://example.com/previous", "title": "Previous Page"}
```
Or when no history:
```json
{"noHistory": true}
```

### reload
```json
{"reload": true}
{"reload": {"waitUntil": "networkidle"}}
```

### waitForNavigation
```json
{"waitForNavigation": true}
{"waitForNavigation": {"timeout": 5000, "waitUntil": "networkidle"}}
```

### switchTab — Connect to Existing Tab
By alias:
```json
{"steps":[{"switchTab":"t2"},{"snapshot":true}]}
```

By URL regex:
```json
{"steps":[{"switchTab":{"url":"github\\.com"}},{"snapshot":true}]}
```

By targetId:
```json
{"steps":[{"switchTab":{"targetId":"ABC123..."}},{"snapshot":true}]}
```

### New Tab Handling — click -> detect -> switchTab
When a click opens a new tab (e.g. `target="_blank"`), the response includes `newTabs`:
```json
{
  "steps": [{"action": "click", "status": "ok", "output": {
    "method": "cdp",
    "newTabs": [{"targetId": "DEF456", "url": "https://other.com", "title": "Other"}]
  }}]
}
```

Then connect to the new tab:
```json
{"steps":[{"switchTab":{"url":"other\\.com"}},{"snapshot":true}]}
```

---

## Interaction

### click — Basic
```json
{"click": "#submit"}
{"click": {"ref": "f0s1e4"}}
{"click": {"x": 450, "y": 200}}
```

### click — By visible text
```json
{"click": {"text": "Submit"}}
{"click": {"text": "Learn more", "exact": true}}
```

### click — Force (bypass actionability checks)
```json
{"click": {"selector": "#submit", "force": true}}
{"click": {"ref": "f0s1e4", "force": true}}
```

### click — Multi-selector fallback
```json
{"click": {"selectors": ["#submit", "button.primary", "[type=submit]"]}}
```
Response: `{clicked: true, matchedSelector: "#submit"}`

### click — Diagnostics (element covered)
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

### fill — Targeted
```json
{"fill": {"selector": "#email", "value": "user@example.com"}}
{"fill": {"ref": "f0s1e3", "value": "text"}}
{"fill": {"label": "Email address", "value": "test@example.com"}}
```

### fill — Currently focused element
```json
{"fill": "search query"}
{"fill": {"value": "text", "clear": false}}
```
Response:
```json
{"filled": true, "tag": "INPUT", "type": "text", "selector": "#search", "valueBefore": "", "valueAfter": "search query", "mode": "focused"}
```

### fill — Batch (multiple fields)
```json
{"fill": {"#firstName": "John", "#lastName": "Doe"}}
{"fill": {"fields": {"#firstName": "John"}, "react": true}}
```
Response:
```json
{"total": 2, "filled": 2, "failed": 0, "results": [{"selector": "#firstName", "status": "ok", "value": "John"}], "mode": "batch"}
```

### fill — Autocomplete pattern
```json
{"steps": [
  {"fill": {"selector": "#city", "value": "San Fra"}},
  {"wait": ".autocomplete-dropdown"},
  {"click": {"text": "San Francisco"}}
]}
```

### press
```json
{"press": "Enter"}
{"press": "Control+a"}
{"press": "Meta+Shift+Enter"}
```

### hover — Basic
```json
{"hover": "#menu"}
{"hover": {"selector": "#tooltip", "duration": 500}}
```

### hover — With result capture
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
      {"selector": ".dropdown-menu", "text": "Menu items", "visible": true}
    ]
  }
}
```

### drag
```json
{"drag": {"source": "#draggable", "target": "#dropzone"}}
{"drag": {"source": {"ref": "f0s1e1"}, "target": {"ref": "f0s1e5"}}}
{"drag": {"source": {"ref": "f0s1e1", "offsetX": 20}, "target": {"ref": "f0s1e5", "offsetY": -10}}}
{"drag": {"source": {"x": 100, "y": 100}, "target": {"x": 300, "y": 200}}}
{"drag": {"source": "#item", "target": "#container", "steps": 20, "delay": 10}}
```

### drag — With method
```json
{"drag": {"source": "#item", "target": "#zone", "method": "mouse"}}
{"drag": {"source": "#item", "target": "#zone", "method": "html5"}}
```
Response:
```json
{"dragged": true, "method": "mouse-events", "source": {"x": 100, "y": 100}, "target": {"x": 300, "y": 200}, "steps": 10}
```

### selectOption
```json
{"selectOption": {"selector": "#country", "value": "US"}}
{"selectOption": {"selector": "#country", "label": "United States"}}
{"selectOption": {"selector": "#country", "index": 2}}
{"selectOption": {"selector": "#colors", "values": ["red", "blue"]}}
```

### selectText
```json
{"selectText": "#input"}
{"selectText": {"selector": "#input", "start": 0, "end": 5}}
```
Response:
```json
{"selected": true, "selector": "#input"}
```

### upload
```json
{"upload": "/path/to/file.pdf"}
{"upload": ["/path/to/a.txt", "/path/to/b.png"]}
{"upload": {"selector": "#file-input", "file": "/path/to/doc.pdf"}}
{"upload": {"selector": "#file-input", "files": ["/path/to/a.txt", "/path/to/b.png"]}}
{"upload": {"ref": "f0s1e3", "files": ["/path/to/photo.jpg"]}}
```
Response:
```json
{"uploaded": true, "files": ["/path/to/file.pdf"], "accept": ".pdf,.doc", "multiple": false, "target": "input[type=\"file\"]"}
```

### submit
```json
{"submit": "form"}
{"submit": {"selector": "#login-form", "reportValidity": true}}
```
Response:
```json
{"submitted": true, "valid": true, "errors": []}
```

---

## Query & Extraction

### snapshot
```json
{"snapshot": true}
{"snapshot": {"root": "#container", "maxElements": 500}}
{"snapshot": {"root": "role=main", "includeText": true}}
{"snapshot": {"includeFrames": true}}
{"snapshot": {"pierceShadow": true}}
{"snapshot": {"detail": "interactive"}}
{"snapshot": {"inlineLimit": 28000}}
{"snapshot": {"since": "f0s1"}}
```

YAML output example:
```yaml
- navigation:
  - link "Home" [ref=f0s1e1]
- main:
  - heading "Welcome" [level=1]
  - textbox "Email" [required] [invalid] [name=email] [ref=f0s1e3]
  - button "Submit" [ref=f0s1e4]
```

### Snapshot Caching (since)
```json
{"snapshot": {"since": "f0s1"}}
```

Unchanged:
```json
{"unchanged": true, "snapshotId": "f0s1", "message": "Page unchanged since f0s1"}
```

Changed:
```json
{"snapshotId": "f0s2", "yaml": "- button \"Login\" [ref=f0s2e1]\n...", "refs": {}}
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
    {"path": "main > form > button", "ref": "f0s1e47", "name": "Submit Form", "role": "button"},
    {"path": "dialog > button", "ref": "f0s1e89", "name": "Submit Feedback", "role": "button"}
  ],
  "matchCount": 2,
  "searchedElements": 1847
}
```

### query — By CSS
```json
{"query": "h1"}
{"query": {"selector": "a", "limit": 5, "output": "href"}}
{"query": {"selector": "div", "output": ["text", "href"]}}
{"query": {"selector": "button", "output": {"attribute": "data-id"}}}
```

### query — By ARIA role
```json
{"query": {"role": "button"}}
{"query": {"role": "button", "name": "Submit"}}
{"query": {"role": "heading", "level": 2}}
{"query": {"role": ["button", "link"]}}
```

### query — Count only
```json
{"query": {"selector": "li.item", "count": true}}
```
Response:
```json
{"selector": "li.item", "total": 42}
```

### queryAll
```json
{"queryAll": {"title": "h1", "links": "a", "buttons": {"role": "button"}}}
```

### get — Text extraction (default)
```json
{"get": "#content"}
{"get": {"selector": "#content"}}
{"get": {"selector": "#content", "mode": "text"}}
```
Response:
```json
{"text": "Extracted content text", "mode": "text"}
```

### get — HTML extraction
```json
{"get": {"selector": "#content", "mode": "html"}}
```
Response:
```json
{"html": "<div>...</div>", "tagName": "DIV", "length": 1245, "mode": "html"}
```

### get — Form value extraction
```json
{"get": {"selector": "#form", "mode": "value"}}
```
Response:
```json
{
  "selector": "#checkout-form",
  "action": "/api/checkout",
  "method": "POST",
  "fields": [
    {"name": "email", "type": "email", "value": "user@example.com", "label": "Email Address", "required": true, "valid": true}
  ],
  "valid": true,
  "fieldCount": 3,
  "mode": "value"
}
```

### get — Bounding box extraction
```json
{"get": {"selector": "#element", "mode": "box"}}
{"get": {"ref": "f0s1e1", "mode": "box"}}
```
Response:
```json
{"x": 100, "y": 200, "width": 150, "height": 40, "center": {"x": 175, "y": 220}, "mode": "box"}
```

### get — Attributes extraction
```json
{"get": {"selector": "#link", "mode": "attributes"}}
```
Response:
```json
{"attributes": {"href": "/page", "class": "link", "id": "main-link"}, "mode": "attributes"}
```

### get — Table extraction (auto-detected)
```json
{"get": "table.results"}
{"get": {"selector": "#data-grid", "type": "table"}}
```
Response:
```json
{
  "type": "table",
  "headers": ["Name", "Email", "Status"],
  "rows": [
    ["John Doe", "john@example.com", "Active"],
    ["Jane Smith", "jane@example.com", "Pending"]
  ],
  "rowCount": 2,
  "mode": "text"
}
```

### get — List extraction (auto-detected)
```json
{"get": "ul.items"}
{"get": {"selector": "#nav-links", "type": "list"}}
```
Response:
```json
{
  "type": "list",
  "items": ["Home", "About", "Contact"],
  "itemCount": 3,
  "mode": "text"
}
```

### getUrl
```json
{"getUrl": true}
```
Response:
```json
{"url": "https://example.com/page"}
```

### getTitle
```json
{"getTitle": true}
```
Response:
```json
{"title": "Page Title"}
```

### inspect
```json
{"inspect": true}
{"inspect": {"selectors": [".item"], "limit": 3}}
```
Response:
```json
{
  "title": "Page Title",
  "url": "https://example.com",
  "elements": {
    "a": 12,
    "button": 5,
    "input": 3,
    "textarea": 1,
    "select": 0,
    "h1": 1,
    "h2": 3,
    "h3": 0,
    "img": 8,
    "form": 1
  }
}
```

### elementsAt — Single point
```json
{"elementsAt": {"x": 600, "y": 200}}
```
Response:
```json
{
  "ref": "f0s1e5",
  "existing": false,
  "tag": "BUTTON",
  "selector": "#submit-btn",
  "clickable": true,
  "role": "button",
  "name": "Submit",
  "box": {"x": 580, "y": 190, "width": 100, "height": 40}
}
```

### elementsAt — Batch
```json
{"elementsAt": [{"x": 100, "y": 200}, {"x": 300, "y": 400}, {"x": 500, "y": 150}]}
```
Response:
```json
{
  "count": 3,
  "elements": [
    {"x": 100, "y": 200, "ref": "f0s1e1", "tag": "BUTTON", "selector": "#btn1", "clickable": true},
    {"x": 300, "y": 400, "ref": "f0s1e2", "tag": "DIV", "selector": "div.card", "clickable": false},
    {"x": 500, "y": 150, "error": "No element at this coordinate"}
  ]
}
```

### elementsAt — Nearby search
```json
{"elementsAt": {"x": 400, "y": 300, "radius": 100}}
{"elementsAt": {"x": 400, "y": 300, "radius": 75, "limit": 10}}
```
Response:
```json
{
  "center": {"x": 400, "y": 300},
  "radius": 100,
  "count": 5,
  "elements": [
    {"ref": "f0s1e1", "tag": "BUTTON", "selector": "#nearby-btn", "clickable": true, "distance": 12},
    {"ref": "f0s1e2", "tag": "SPAN", "selector": "span.label", "clickable": false, "distance": 28}
  ]
}
```

---

## Waiting & Polling

### wait — Element
```json
{"wait": "#content"}
{"wait": {"selector": "#loading", "hidden": true}}
{"wait": {"selector": ".item", "minCount": 10}}
```

### wait — Text
```json
{"wait": {"text": "Welcome"}}
{"wait": {"text": "welcome", "caseSensitive": false}}
{"wait": {"textRegex": "Order #[A-Z0-9]+"}}
```

### wait — URL
```json
{"wait": {"urlContains": "/success"}}
```

### sleep
```json
{"sleep": 2000}
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
Response:
```json
{"resolved": true, "value": true, "elapsed": 2340}
```

---

## Scripting

### pageFunction
```json
{"pageFunction": "() => document.title"}
{"pageFunction": "document.title"}
{"pageFunction": "(document) => [...document.querySelectorAll('.item')].map(i => ({text: i.textContent, href: i.href}))"}
```

Object form:
```json
{"pageFunction": {"fn": "(refs) => refs.size", "refs": true}}
{"pageFunction": {"fn": "() => document.querySelectorAll('button').length", "timeout": 5000}}
{"pageFunction": {"expression": "fetch('/api').then(r=>r.json())"}}
```

### Typed Return Values
- Numbers: `{type: "number", repr: "Infinity|NaN|-Infinity"}`
- Date: `{type: "Date", value: "ISO string", timestamp: N}`
- Map: `{type: "Map", size: N, entries: [...]}`
- Set: `{type: "Set", size: N, values: [...]}`
- Element: `{type: "Element", tagName, id, className, textContent, isConnected}`
- NodeList: `{type: "NodeList", length: N, items: [...]}`

### assert
```json
{"assert": {"url": {"contains": "/success"}}}
{"assert": {"url": {"equals": "https://example.com/done"}}}
{"assert": {"url": {"startsWith": "https://"}}}
{"assert": {"url": {"matches": "^https://.*\\.example\\.com"}}}
{"assert": {"text": "Welcome"}}
{"assert": {"selector": "h1", "text": "Title", "caseSensitive": false}}
```
Response:
```json
{
  "passed": true,
  "assertions": [
    {"type": "url", "actual": "https://example.com/success", "expected": {"contains": "/success"}, "passed": true}
  ]
}
```

---

## Page Control

### scroll
```json
{"scroll": "top"}
{"scroll": "bottom"}
{"scroll": "up"}
{"scroll": "down"}
{"scroll": "#element"}
{"scroll": "f0s1e4"}
{"scroll": {"deltaY": 500}}
{"scroll": {"x": 0, "y": 1000}}
```
Response:
```json
{"scrollX": 0, "scrollY": 1000}
```

### frame — List frames
```json
{"frame": {"list": true}}
```

### frame — Switch to frame
```json
{"frame": "iframe#content"}
{"frame": 0}
{"frame": {"name": "myFrame"}}
```

### frame — Return to main frame
```json
{"frame": "top"}
```

### frame — Workflow (switch -> interact -> return)
```json
{"steps": [
  {"frame": "iframe#editor"},
  {"fill": {"selector": "#input", "value": "Hello"}},
  {"click": "#save"},
  {"frame": "top"}
]}
```

### viewport
```json
{"viewport": "iphone-14"}
{"viewport": "pixel-7"}
{"viewport": "macbook-pro-14"}
{"viewport": "desktop-hd"}
{"viewport": {"width": 1280, "height": 720}}
{"viewport": {"width": 375, "height": 667, "mobile": true, "hasTouch": true, "isLandscape": true}}
```
Response:
```json
{"width": 390, "height": 844, "deviceScaleFactor": 3}
```

---

## Browser & Tabs

### chromeStatus
```json
{"steps":[{"chromeStatus":true}]}
{"steps":[{"chromeStatus":{"port":9333,"headless":true}}]}
{"steps":[{"chromeStatus":{"autoLaunch":false}}]}
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

### listTabs
```json
{"steps":[{"listTabs":true}]}
```
Response:
```json
{"count": 2, "tabs": [{"targetId": "ABC123", "url": "https://google.com", "title": "Google", "alias": "t1"}]}
```

### closeTab
```json
{"closeTab": "t1"}
```

### cookies
```json
{"cookies": {"get": true}}
{"cookies": {"get": ["https://other-domain.com"], "name": "session_id"}}
{"cookies": {"set": [{"name": "token", "value": "abc", "domain": "example.com", "expires": "7d"}]}}
{"cookies": {"delete": "session_id"}}
{"cookies": {"delete": "session_id", "domain": "example.com"}}
{"cookies": {"clear": true}}
{"cookies": {"clear": true, "domain": "example.com"}}
```

### console
```json
{"console": true}
{"console": {"level": "error", "limit": 20, "stackTrace": true}}
{"console": {"type": "exception", "limit": 10}}
{"console": {"clear": true}}
```
Response:
```json
{
  "total": 5,
  "showing": 5,
  "messages": [
    {"level": "error", "text": "TypeError: x is undefined", "type": "console", "url": "app.js", "line": 42, "timestamp": 1700000000}
  ]
}
```

### pdf
```json
{"pdf": "report.pdf"}
{"pdf": {"path": "/absolute/path/report.pdf", "landscape": true, "printBackground": true}}
{"pdf": {"path": "element.pdf", "selector": "#chart"}}
```

---

## Action Hooks

### readyWhen
```json
{"click": {"ref": "f0s1e5", "readyWhen": "() => !document.querySelector('.loading')"}}
{"fill": {"selector": "#email", "value": "test@test.com", "readyWhen": "() => document.querySelector('#email').offsetHeight > 0"}}
```

### settledWhen
```json
{"click": {"ref": "f0s1e5", "settledWhen": "() => document.querySelector('.results')?.children.length > 0"}}
{"click": {"selector": "#nav-link", "settledWhen": "() => location.href.includes('/results')"}}
```

### observe
```json
{"click": {"ref": "f0s1e5", "observe": "() => ({url: location.href, count: document.querySelectorAll('.item').length})"}}
```

### Combined hooks
```json
{"click": {
  "ref": "f0s1e5",
  "readyWhen": "() => !document.querySelector('.loading')",
  "settledWhen": "() => document.querySelectorAll('.result').length > 0",
  "observe": "() => document.querySelectorAll('.result').length"
}}
```

---

## Site Profiles

### writeSiteProfile
```json
{"writeSiteProfile": {"domain": "github.com", "content": "# github.com\nUpdated: 2025-01-15\n\n## Environment\n- React SPA\n..."}}
```

### readSiteProfile
```json
{"readSiteProfile": "github.com"}
{"readSiteProfile": {"domain": "github.com"}}
```
Response (found):
```json
{"found": true, "domain": "github.com", "content": "# github.com\n..."}
```
Response (not found):
```json
{"found": false, "domain": "github.com"}
```

### Full Profile Template
```markdown
# example.com
Updated: 2025-01-15  |  Fingerprint: React 18, Next.js

## Environment
- React 18.x, Next.js (SSR)
- SPA with pushState navigation
- Has <main> element: #__next > main

## Quirks
- Turbo intercepts link clicks — use settledWhen with URL check
- File tree uses virtualization — only visible rows in DOM

## Strategies
### fill (React controlled inputs)
Use `react: true` option or settledWhen to verify input accepted.

## Regions
- mainContent: `main, [role="main"]`
- navigation: `.nav-bar`

## Recipes
### Login
{"steps": [
  {"fill": {"selector": "#username", "value": "{{user}}"}},
  {"fill": {"selector": "#password", "value": "{{pass}}"}},
  {"click": "#login"},
  {"wait": {"urlContains": "/dashboard"}}
]}
```

---

## Optional Steps

```json
{"click": "#maybe-exists", "optional": true}
```
Response when element not found:
```json
{"action": "click", "status": "skipped", "error": "Element not found"}
```

---

## Shell Tips

### Heredoc (avoids quote escaping)
```bash
node scripts/cdp-skill.js <<'EOF'
{"steps":[{"pageFunction":"document.querySelectorAll('button').length"}]}
EOF
```

### Pipe from file
```bash
cat steps.json | node scripts/cdp-skill.js
```

### Debug logging
```bash
node scripts/cdp-skill.js --debug '{"steps":[{"goto":"https://google.com"}]}'
```
