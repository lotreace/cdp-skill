# CDP Skill - Issue Voting & Improvements

**Purpose:** The main goal of this voting system is to **improve eval performance**. Issues that cause eval failures or require workarounds get votes, helping prioritize fixes that will have the greatest impact on cdp-skill reliability scores.

This file tracks known issues and improvement requests. After each eval run, the main orchestrating agent collects feedback from subagents and updates votes here. Each subagent mention of an issue counts as one vote.

**Have an idea?** If you have suggestions for new features or improvements that would make the CLI easier to use, add them here! We want to hear what would improve your experience.

**Format:** Each issue has votes in brackets like `[votes: 5]`. Higher votes = more frequent pain point in evals.

---

## Priority Legend
- **P0** - Blocking, causes failures
- **P1** - High impact, common issue
- **P2** - Medium impact
- **P3** - Nice to have

---

## 1. Timeout / Actionability Issues

### 1.2 Step-level timeout parameter is ignored
`[votes: 2]` `[priority: P2]`

**Symptoms:**
- `{"click": {"selector": "...", "timeout": 5000}}` still waits default timeout
- Step-level timeout doesn't override global timeout

**Expected:** Step timeout should be honored

**Files:** `src/runner.js`

---


## 2. Frame / Context Issues

### 2.1 Frame context doesn't persist across CLI invocations
`[votes: 3]` `[priority: P1]`

**Symptoms:**
- Call `{"switchToFrame": "iframe#editor"}`
- Next CLI call reverts to main frame
- `listFrames` shows `currentFrameId` back to `mainFrameId`

**Expected:** Frame context should persist with tab session

**Files:** `src/cdp-skill.js`, `src/page.js`

---

### 2.2 switchToFrame doesn't change action context
`[votes: 6]` `[priority: P1]`

**Symptoms:**
- After `switchToFrame`, `snapshot` still returns main frame content
- Cannot get accessibility tree of iframe content
- After `switchToFrame`, `click` and `getDom` also still execute in main frame context
- heroku-iframe test (2026-02-01): switchToFrame to mce_0_ifr succeeded but subsequent click on "#tinymce" and getDom on "body" both returned main frame elements, not iframe content
- heroku-iframe test (2026-02-01T19-45-18): switchToFrame to mce_0_ifr succeeded, but query for "body" returned main frame body content, not iframe body; only snapshot with includeFrames:true captured iframe content; fill/type actions cannot target contenteditable elements inside iframe

**Expected:** All actions (snapshot, click, getDom, fill, etc.) should respect current frame context after switchToFrame

**Workaround:** Use `eval` to access iframe content: `document.querySelector('iframe').contentDocument.body.innerHTML = '...'`

**Files:** `src/aria.js`, `src/runner.js`, `src/dom.js`

---

### 2.3 listFrames doesn't detect cross-origin iframes
`[votes: 9]` `[priority: P2]`

**Symptoms:**
- Page has iframes from different origins (e.g., codesandbox.io embeds)
- `listFrames` only returns main frame
- `document.querySelectorAll("iframe").length` shows iframes exist
- Vue.js examples page uses `about:srcdoc` iframes for preview pane that are treated as cross-origin
- CDP cannot interact with form elements inside srcdoc iframes even via coordinate-based clicking
- BBC News uses Sourcepoint consent management in a cross-origin iframe - CDP cannot click consent buttons
- Vue.js examples test (2026-02-01): snapshot with includeFrames discovers iframe elements but clicking refs fails; coordinate-based clicking works for some elements but keyboard input doesn't reach inputs inside iframe; switchToFrame + eval workaround works for JavaScript-triggered actions
- BBC Article test (2026-02-01): GDPR consent modal in sp_message_iframe blocks all interaction; listFrames returns TCF/GPP locator frames but not the actual consent iframe; coordinate-based clicking doesn't work; workaround is JavaScript eval to remove iframe elements
- Vue.js examples test (2026-02-01T14-59-42): Counter example worked with coordinate-based clicking but Form Bindings inputs inside srcdoc iframe could not be interacted with - checkboxes and text inputs did not respond to coordinate-based clicks
- Vue.js examples test (2026-02-01T19-45-18): Counter button click worked via coordinate (765,110), checkbox toggle also worked via coordinate-based clicking showing srcdoc iframes CAN be interacted with; `snapshot` with `includeFrames:true` discovers iframe content but refs are transient and cannot be used for subsequent actions

**Files:** `src/cdp-skill.js`

---

## 3. Shadow DOM Issues

### 3.1 Selectors don't pierce shadow DOM boundaries
`[votes: 4]` `[priority: P1]`

**Symptoms:**
- Snapshot shows elements inside shadow DOM with refs
- Clicking refs times out because CSS selectors can't reach shadow content
- `document.querySelector()` can't find elements in shadow roots

**Workaround:** Use `eval` with manual shadow root traversal:
```javascript
el.shadowRoot.querySelector('button').click()
```

**Suggested fix:** Add `piercesShadow: true` option or support `>>>` combinator

**Files:** `src/dom.js`, `src/aria.js`

---

### 3.2 Hover doesn't support coordinates
`[votes: 1]` `[priority: P3]`

**Symptoms:**
- `{"hover": {"x": 100, "y": 200}}` not supported
- Cannot trigger hover on shadow DOM elements without selector

**Workaround:** None for shadow DOM hover

**Files:** `src/runner.js` (executeHover)

---

## 4. Input / Typing Issues

### 4.1 Key presses in dialogs don't reach input fields
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- Open Monaco "Go to Line" dialog with Ctrl+G
- Press number keys - they don't appear in input
- Keys may be going to wrong element

**Files:** `src/runner.js`

---

### 4.2 Selection lost when clicking toolbar buttons
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- Select text in WYSIWYG editor with Shift+Arrow
- Click Bold button
- Selection is lost before formatting applies
- Focus shift removes selection from contenteditable

**Suggested fix:** Add option to preserve selection during click

**Files:** `src/dom.js`

---

### 4.3 Fill with empty string does not clear input
`[votes: 3]` `[priority: P2]`

**Symptoms:**
- `{"fill": {"selector": "#search", "value": ""}}` doesn't clear the input
- Input retains previous value
- Need JavaScript eval workaround to properly clear
- DataTables test (2026-02-01): fill with empty string on search box did not clear "London" filter, required multiple Backspace keypresses

**Workaround:** Use eval with `input.value = ""; input.dispatchEvent(new Event("input", {bubbles: true}))` or click input and use keyboard Backspace/Delete

**Files:** `src/runner.js` (executeFill)

---

### 4.4 Keyboard shortcuts with modifiers don't trigger SPA event handlers
`[votes: 2]` `[priority: P2]`

**Symptoms:**
- `{"press": "Meta+k"}` dispatches keydown event but does not trigger GitHub's command palette
- The shortcut works when pressed manually in Chrome
- SPA applications listen for keyboard shortcuts at the document level
- CDP keyboard events may not properly trigger event listeners attached via `addEventListener`
- GitHub Command Palette test (2026-02-01): Cmd+K did not open the palette, had to use fallback click on search button
- GitHub Command Palette test (2026-02-01 run 2): Same issue confirmed - Meta+k press did not open command palette for anonymous user

**Expected:** Keyboard shortcuts with modifiers should trigger the same handlers as physical key presses

**Workaround:** Click the button/element that triggers the same action as the keyboard shortcut

**Files:** `src/runner.js` (executePress)

---

## 5. Error Handling Issues

### 5.1 Invalid CSS selector doesn't show parsing error
`[votes: 2]` `[priority: P2]`

**Symptoms:**
- `{"click": "[[[invalid"}` times out instead of immediate error
- No indication that selector syntax is invalid

**Expected:** Immediate error like "Invalid CSS selector"

**Files:** `src/dom.js`

---

### 5.2 Silent exit code 1 without JSON output
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- Some failures return exit code 1 with no stdout/stderr
- Hard to debug what went wrong

**Expected:** Always return JSON with error details

**Files:** `src/cdp-skill.js`

---

### 5.3 Error messages show duplicate information
`[votes: 0]` `[priority: P3]`

**Symptoms:**
- Error shows `"(timeout: 0ms) (timeout: 30000ms)"` - timeout reported twice

**Files:** `src/dom.js`

---

## 6. Snapshot / Query Issues

### 6.1 Snapshot returns limited content on some React SPAs
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- Airbnb page snapshot returns only 2 elements ("Skip to content", "alert")
- Complex React SPAs with custom components have sparse accessibility trees

**Files:** `src/aria.js`

---

### 6.2 captureResult delay too short for tooltips
`[votes: 0]` `[priority: P3]`

**Symptoms:**
- `{"hover": {"selector": "...", "captureResult": true}}` returns `visibleElements: []`
- 100ms delay not enough for JS tooltips to render

**Suggested fix:** Make delay configurable or increase default

**Files:** `src/runner.js`

---

### 6.3 Snapshot shows tooltip role but no text content
`[votes: 0]` `[priority: P3]`

**Symptoms:**
- Snapshot shows `- tooltip` but not the tooltip text
- Would be helpful to include tooltip content

**Files:** `src/aria.js`

---

### 6.4 Text selectors like button:has-text(...) timeout
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- `{"click": "button:has-text('Submit')"}` times out
- Button is visible in screenshot
- Playwright-style `:has-text()` pseudo-selector not supported

**Files:** `src/dom.js`

---

### 6.5 Element refs go stale between snapshot and subsequent actions
`[votes: 8]` `[priority: P2]`

**Symptoms:**
- Full snapshot returns refs like `[ref=e26]` for article links
- Immediate click on `{"ref": "e26"}` fails with "Element not found"
- viewportSnapshot refs differ from full snapshot refs returned in same response
- Occurs on dynamic React sites like Reuters where DOM may update between operations
- Google Search test (2026-02-01): Click on ref that triggers navigation reports "ref not found in __ariaRefs" error even though navigation succeeded - refs from pre-navigation page become stale after URL change
- Wikipedia Search test (2026-02-01): Click on internal wiki link reports "JS click on ref failed: ref not found in __ariaRefs" even though navigation to new article succeeded - error is cosmetic but confusing
- Google Search test (2026-02-01T19-45-18): Click on Wikipedia search result reported error status with "ref not found in __ariaRefs" but navigated:true and URL changed to Wikipedia correctly - false positive error
- DemoQA Forms test (2026-02-01): React date picker calendar causes refs to become stale after year dropdown selection triggers re-render - clicking stale ref fails with "element is no longer attached to DOM"
- BBC Article test (2026-02-01): Full snapshot file returned refs like e42 for articles but clicking e42 failed with "Element not found"; scrolling between snapshot and click caused refs to change
- Heroku Hovers test (2026-02-01): Click on View profile link ref returns "JS click on ref failed: ref not found in __ariaRefs" error with status "error", but navigation actually succeeds (navigated:true, URL shows /users/1). This is a false-positive error - the click worked but error is returned.

**Workaround:** Use `click` with `text` property or CSS selector instead of refs

**Expected:** Refs should remain valid for at least the duration of the agent turn, or ref lifetime should be clearly documented

**Files:** `src/aria.js`, `src/dom.js`

---

## 7. Other Issues

### 7.0 Drag doesn't work on HTML5 range input sliders
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- `{"drag": {"source": {"x": 109, "y": 173}, "target": {"x": 174, "y": 173}}}` returns `{"dragged": true}` but slider value doesn't change
- heroku-slider test (2026-02-01): Drag from left to center of range slider reported success but value stayed at 0
- Click-at-position on slider track works correctly as workaround

**Expected:** Drag should move the slider thumb and update the value

**Workaround:** Use click-at-position on slider track or keyboard arrow keys to set value:
- `{"click": {"x": target_x, "y": slider_y}}` - click at desired position
- Focus slider then `{"press": "ArrowRight"}` / `{"press": "ArrowLeft"}` for step-by-step adjustment

**Files:** `src/runner.js` (executeDrag)

---

### 7.1 New tab detection/tracking when links open in new tabs
`[votes: 2]` `[priority: P2]`

**Symptoms:**
- Click a link that opens in a new tab (e.g., eBay product listing)
- `navigated: false` returned, no indication that new tab opened
- Agent must call `chromeStatus` to discover the new tab
- New tab is not automatically tracked with `tN` alias

**Expected:**
- Detect when click opens new tab
- Return info about new tab in response (e.g., `{"newTab": "t440", "url": "..."}`)
- Or: option like `{"click": {..., "followNewTab": true}}` to auto-switch to new tab

**Workaround:** Use `chromeStatus` after clicks that may open new tabs, find new tab by URL

**Files:** `src/runner.js` (executeClick), `src/cdp-skill.js`

---

### 7.2 getBoundingClientRect() returns empty object in eval
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- `{"eval": "el.getBoundingClientRect()"}` returns `{}`
- DOMRect objects not automatically serialized
- Must use `JSON.stringify()` explicitly

**Files:** `src/runner.js`

---

### 7.2 Scroll reports incorrect position
`[votes: 0]` `[priority: P3]`

**Symptoms:**
- `{"scroll": {"direction": "down", "amount": 500}}` returns `scrollY: 0`
- Page appears to scroll but reported position is wrong

**Files:** `src/runner.js` (executeScroll)

---

### 7.3 Session state accumulation causes issues after extended use
`[votes: 0]` `[priority: P3]`

**Symptoms:**
- After many operations on same tab, click starts timing out
- Closing and reopening tab resolves it
- Suggests CDP session state accumulates

**Workaround:** Periodically close and reopen tabs

**Files:** `src/cdp.js`, `src/page.js`

---

### 7.4 Framework detection on page load
`[votes: 1]` `[priority: P3]`

**Problem:**
Agents don't know what frameworks a page uses until they encounter issues (e.g., React clicks failing, Vue reactivity quirks). Early detection would allow agents to adjust strategies proactively.
- SauceDemo checkout test (2026-02-01): Knowing upfront that SauceDemo is React would help agents use react:true for fill and anticipate jsClick fallback needs

**Proposed:**
Add framework detection to `goto` and `openTab` responses:
```json
{
  "navigated": true,
  "frameworks": {
    "react": { "version": "18.2.0", "detected": true },
    "nextjs": { "version": "14.x", "detected": true },
    "vue": false,
    "angular": false,
    "svelte": false,
    "jquery": { "version": "3.6.0", "detected": true }
  }
}
```

**Detection methods:**
- `window.React`, `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`
- `window.__NEXT_DATA__`, `window.next`
- `window.Vue`, `window.__VUE__`
- `window.ng`, `window.angular`
- `window.__svelte`
- `window.jQuery`, `window.$`

**Use cases:**
- Agent can preemptively use `jsClick: true` on React/Vue sites
- Agent knows to wait for hydration on Next.js/Nuxt
- Helps diagnose why actions fail on specific sites

**Files:** `src/runner.js` (executeGoto), new `src/frameworks.js`

---

## 8. Stagehand-Inspired Improvements

These improvements are inspired by capabilities in the Stagehand browser automation library. See `dev/stagehand-gap/` for detailed analysis.

### 8.1 Network quiet detection
`[votes: 3]` `[priority: P1]`

**Problem:**
Modern web apps load content dynamically via API calls, lazy-loaded images, and third-party scripts. Acting or snapshotting before these complete leads to incomplete data or failed actions.
- BBC Article test (2026-02-01): GDPR consent modal re-appears after navigation due to async scripts loading; network quiet detection would help wait for consent state to settle

**Proposed:**
Implement `waitForNetworkQuiet` that:
- Tracks in-flight requests via `Network.requestWillBeSent`, `loadingFinished`, `loadingFailed`
- Excludes WebSocket and EventSource (long-lived connections)
- Force-completes requests stalled >2 seconds
- Waits 500ms idle period after all requests complete
- Has overall timeout guard

**Impact:** HIGH - Critical for SPAs and sites with heavy async loading

**Files:** New `src/network.js`

---

### 8.2 Lazy selector resolution (eliminate stale refs)
`[votes: 0]` `[priority: P1]`

**Problem:**
Cached element handles (objectIds) can become stale, creating a category of "stale element" errors.

**Proposed:**
Never cache element references. Re-resolve selector from scratch for every action. Store selector string, not objectId.

**Impact:** MEDIUM-HIGH - Eliminates stale element errors entirely, simplifies state management

**Files:** `src/dom.js`, `src/aria.js`

---

### 8.3 MutationObserver-based waiting
`[votes: 0]` `[priority: P2]`

**Problem:**
Polling at 100ms intervals for element existence/state is slower and uses more CPU than event-driven detection.

**Proposed:**
Use MutationObserver for real-time DOM change detection:
- Set up observers on all shadow roots (open and closed)
- Observe subtree mutations with attributeFilter for performance
- Event-driven rather than time-driven

**Note:** Combine with existing LCS-based stability metric for animation detection.

**Impact:** MEDIUM - Faster detection, lower CPU on long waits

**Files:** `src/dom.js`

---

### 8.4 XPath support
`[votes: 0]` `[priority: P2]`

**Problem:**
Some DOM traversal patterns are awkward with CSS selectors (ancestor navigation, text predicates).

**Proposed:**
Add XPath selector support alongside CSS:
- `{"click": {"xpath": "//button[contains(text(), 'Submit')]"}}`
- Support `>>` hop notation for iframe traversal

**Impact:** MEDIUM - Alternative when CSS selectors are brittle

**Files:** `src/dom.js`, new `src/xpath.js`

---

### 8.5 Innermost text matching
`[votes: 0]` `[priority: P2]`

**Problem:**
Text matching can match parent elements that contain the same text as their target child, leading to wrong element clicks.

**Proposed:**
Filter text matches to return only innermost matching elements:
- Use `innerText` (rendered) with fallback to `textContent`
- Skip irrelevant tags (SCRIPT, STYLE, TEMPLATE, NOSCRIPT)
- Case-insensitive substring matching

**Impact:** MEDIUM - Reduces false positives in text-based targeting

**Files:** `src/dom.js`

---

### 8.6 Frame-scoped snapshots
`[votes: 0]` `[priority: P2]`

**Problem:**
Large pages produce verbose snapshots. When target area is known, capturing only that portion improves efficiency.

**Proposed:**
Support scoped snapshots via `focusSelector`:
- Resolve selector across iframe boundaries
- Build DOM + accessibility data only for owning frame
- Return early when subtree satisfies request

**Impact:** LOW-MEDIUM - Faster observations, reduced context for agents

**Files:** `src/aria.js`

---

### 8.7 Closed shadow DOM piercing
`[votes: 0]` `[priority: P3]`

**Problem:**
Cannot access closed shadow roots via normal DOM APIs.

**Proposed:**
Install piercer script at document evaluation that monkey-patches `Element.attachShadow()` to maintain a WeakMap of closed shadow roots.

**Impact:** LOW - Edge case for components using closed shadow DOM

**Files:** `src/dom.js`, new `src/piercer.js`

---

### 8.8 Frame-aware element identification
`[votes: 0]` `[priority: P3]`

**Problem:**
Element refs are scoped to single frame context, requiring manual frame switching.

**Proposed:**
- Compute absolute XPath prefixes for nested iframes
- Encode element IDs as `frameOrdinal-backendNodeId` pairs
- Support `>>` hop notation for cross-frame selectors

**Impact:** LOW - Simplifies multi-frame automation

**Files:** `src/aria.js`, `src/dom.js`

---

### 8.9 Adaptive depth handling
`[votes: 0]` `[priority: P3]`

**Problem:**
Hard depth limits truncate DOM capture. No automatic recovery.

**Proposed:**
Progressive depth reduction on encoder errors (256 → 128 → 64 → 1). Re-hydrate missing branches via `DOM.describeNode`.

**Impact:** LOW - Better handling of extremely deep DOMs

**Files:** `src/aria.js`

---

## Adding New Issues

To add a new issue, use this template:

```markdown
### X.X [Short title]
`[votes: 1]` `[priority: PX]`

**Symptoms:**
- What you observed
- Error messages if any

**Expected:** What should happen

**Workaround:** Any known workarounds

**Files:** Suspected files involved
```

---

## Vote Tally

| Issue | Votes | Priority |
|-------|-------|----------|
| 2.3 Cross-origin iframes | 9 | P2 |
| 6.5 Refs stale between snapshot/click | 8 | P2 |
| 2.2 switchToFrame action context | 6 | P1 |
| 3.1 Shadow DOM selectors | 4 | P1 |
| 2.1 Frame context persistence | 3 | P1 |
| 8.1 Network quiet detection | 3 | P1 |
| 1.2 Step-level timeout ignored | 2 | P2 |
| 5.1 Invalid selector error | 2 | P2 |
| 7.1 New tab detection/tracking | 2 | P2 |
| 4.3 Fill empty string doesn't clear | 3 | P2 |
| 4.4 Keyboard shortcuts w/ modifiers | 2 | P2 |
| 7.0 Drag on range input sliders | 1 | P2 |
| 7.4 Framework detection on page load | 1 | P3 |
| 8.2 Lazy selector resolution | 0 | P1 |
| 8.3 MutationObserver waiting | 0 | P2 |
| 8.4 XPath support | 0 | P2 |
| 8.5 Innermost text matching | 0 | P2 |
| 8.6 Frame-scoped snapshots | 0 | P2 |
| 8.7 Closed shadow DOM piercing | 0 | P3 |
| 8.8 Frame-aware element IDs | 0 | P3 |
| 8.9 Adaptive depth handling | 0 | P3 |

**Total votes allocated: 39** (Stagehand items now receiving votes)

---

## Recently Implemented

These issues were resolved and removed from voting:

| Issue | Votes | Implemented As |
|-------|-------|----------------|
| 1.1 Drag action timeout | 11 | JavaScript drag simulation (html5-dnd, range-input, mouse-events) |
| 7.1 CDP clicks fail on React/links | 9 | Auto-verify + jsClick fallback (method: "jsClick-auto") |
| 1.3 Scroll deltaY timeout | 8 | JavaScript `window.scrollBy()` instead of CDP mouse wheel |
| 8.1 Auto-snapshot with diff | 5 | `viewportSnapshot`, `fullSnapshot`, `changes` in output |
| 4.1 Type to focused element | 4 | `fillActive` action |
| 8.2 Screenshot timing | 4 | Command-level screenshots only |
