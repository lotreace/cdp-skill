# CDP Skill - Issue Voting & Improvements

**Purpose:** The main goal of this voting system is to **improve eval performance**. Issues that cause eval failures or require workarounds get votes, helping prioritize fixes that will have the greatest impact on cdp-skill reliability scores.

This file tracks known issues and improvement requests. After each eval run, the main orchestrating agent collects feedback from subagents and updates votes here. Each subagent mention of an issue counts as one vote.

**Have an idea?** If you have suggestions for new features or improvements that would make the CLI easier to use, add them here! We want to hear what would improve your experience.

**Format:** Each issue has votes in brackets like `[votes: 5]`. Higher votes = more frequent pain point in evals.

---

## 1. Timeout / Actionability Issues

### 1.2 Step-level timeout parameter is ignored
`[votes: 2]`
**Symptoms:**
- `{"click": {"selector": "...", "timeout": 5000}}` still waits default timeout
- Step-level timeout doesn't override global timeout

**Expected:** Step timeout should be honored

**Files:** `src/runner.js`

---


## 2. Frame / Context Issues

### 2.1 Frame context doesn't persist across CLI invocations
`[votes: 3]`
**Symptoms:**
- Call `{"switchToFrame": "iframe#editor"}`
- Next CLI call reverts to main frame
- `listFrames` shows `currentFrameId` back to `mainFrameId`

**Expected:** Frame context should persist with tab session

**Files:** `src/cdp-skill.js`, `src/page.js`

---

### 2.2 switchToFrame doesn't change action context
`[votes: 6]`
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
`[votes: 9]`
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
`[votes: 4]`
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
`[votes: 1]`
**Symptoms:**
- `{"hover": {"x": 100, "y": 200}}` not supported
- Cannot trigger hover on shadow DOM elements without selector

**Workaround:** None for shadow DOM hover

**Files:** `src/runner.js` (executeHover)

---

## 4. Input / Typing Issues

### 4.1 Key presses in dialogs don't reach input fields
`[votes: 1]`
**Symptoms:**
- Open Monaco "Go to Line" dialog with Ctrl+G
- Press number keys - they don't appear in input
- Keys may be going to wrong element

**Files:** `src/runner.js`

---

### 4.2 Selection lost when clicking toolbar buttons
`[votes: 1]`
**Symptoms:**
- Select text in WYSIWYG editor with Shift+Arrow
- Click Bold button
- Selection is lost before formatting applies
- Focus shift removes selection from contenteditable

**Suggested fix:** Add option to preserve selection during click

**Files:** `src/dom.js`

---

### 4.3 Fill with empty string does not clear input
`[votes: 3]`
**Symptoms:**
- `{"fill": {"selector": "#search", "value": ""}}` doesn't clear the input
- Input retains previous value
- Need JavaScript eval workaround to properly clear
- DataTables test (2026-02-01): fill with empty string on search box did not clear "London" filter, required multiple Backspace keypresses

**Workaround:** Use eval with `input.value = ""; input.dispatchEvent(new Event("input", {bubbles: true}))` or click input and use keyboard Backspace/Delete

**Files:** `src/runner.js` (executeFill)

---

### 4.4 Keyboard shortcuts with modifiers don't trigger SPA event handlers
`[votes: 3]`
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
`[votes: 2]`
**Symptoms:**
- `{"click": "[[[invalid"}` times out instead of immediate error
- No indication that selector syntax is invalid

**Expected:** Immediate error like "Invalid CSS selector"

**Files:** `src/dom.js`

---

### 5.2 Silent exit code 1 without JSON output
`[votes: 1]`
**Symptoms:**
- Some failures return exit code 1 with no stdout/stderr
- Hard to debug what went wrong

**Expected:** Always return JSON with error details

**Files:** `src/cdp-skill.js`

---

### 5.3 Error messages show duplicate information
`[votes: 0]`
**Symptoms:**
- Error shows `"(timeout: 0ms) (timeout: 30000ms)"` - timeout reported twice

**Files:** `src/dom.js`

---

## 6. Snapshot / Query Issues

### 6.1 Snapshot returns limited content on some React SPAs
`[votes: 1]`
**Symptoms:**
- Airbnb page snapshot returns only 2 elements ("Skip to content", "alert")
- Complex React SPAs with custom components have sparse accessibility trees

**Files:** `src/aria.js`

---

### 6.2 captureResult delay too short for tooltips
`[votes: 1]`
**Symptoms:**
- `{"hover": {"selector": "...", "captureResult": true}}` returns `visibleElements: []`
- 100ms delay not enough for JS tooltips to render

**Suggested fix:** Make delay configurable or increase default

**Files:** `src/runner.js`

---

### 6.3 Snapshot shows tooltip role but no text content
`[votes: 0]`
**Symptoms:**
- Snapshot shows `- tooltip` but not the tooltip text
- Would be helpful to include tooltip content

**Files:** `src/aria.js`

---

### 6.4 Text selectors like button:has-text(...) timeout
`[votes: 1]`
**Symptoms:**
- `{"click": "button:has-text('Submit')"}` times out
- Button is visible in screenshot
- Playwright-style `:has-text()` pseudo-selector not supported

**Files:** `src/dom.js`

---

### 6.5 Element refs go stale between snapshot and subsequent actions
`[votes: 14]`
**Symptoms:**
- Full snapshot returns refs like `[ref=s1e26]` for article links
- Immediate click on `{"ref": "s1e26"}` fails with "Element not found"
- viewportSnapshot refs differ from full snapshot refs returned in same response
- Occurs on dynamic React sites like Reuters where DOM may update between operations
- Google Search test (2026-02-01): Click on ref that triggers navigation reports "ref not found in __ariaRefs" error even though navigation succeeded - refs from pre-navigation page become stale after URL change
- Wikipedia Search test (2026-02-01): Click on internal wiki link reports "JS click on ref failed: ref not found in __ariaRefs" even though navigation to new article succeeded - error is cosmetic but confusing
- Google Search test (2026-02-01T19-45-18): Click on Wikipedia search result reported error status with "ref not found in __ariaRefs" but navigated:true and URL changed to Wikipedia correctly - false positive error
- DemoQA Forms test (2026-02-01): React date picker calendar causes refs to become stale after year dropdown selection triggers re-render - clicking stale ref fails with "element is no longer attached to DOM"
- BBC Article test (2026-02-01): Full snapshot file returned refs like s1e42 for articles but clicking s1e42 failed with "Element not found"; scrolling between snapshot and click caused refs to change
- Heroku Hovers test (2026-02-01): Click on View profile link ref returns "JS click on ref failed: ref not found in __ariaRefs" error with status "error", but navigation actually succeeds (navigated:true, URL shows /users/1). This is a false-positive error - the click worked but error is returned.

**Workaround:** Use `click` with `text` property or CSS selector instead of refs

**Expected:** Refs should remain valid for at least the duration of the agent turn, or ref lifetime should be clearly documented

**Files:** `src/aria.js`, `src/dom.js`

---

## 7. Other Issues

### 7.0 Drag doesn't work on HTML5 range input sliders
`[votes: 1]`
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
`[votes: 2]`
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
`[votes: 1]`
**Symptoms:**
- `{"eval": "el.getBoundingClientRect()"}` returns `{}`
- DOMRect objects not automatically serialized
- Must use `JSON.stringify()` explicitly

**Files:** `src/runner.js`

---

### 7.2 Scroll reports incorrect position
`[votes: 0]`
**Symptoms:**
- `{"scroll": {"direction": "down", "amount": 500}}` returns `scrollY: 0`
- Page appears to scroll but reported position is wrong

**Files:** `src/runner.js` (executeScroll)

---

### 7.3 Session state accumulation causes issues after extended use
`[votes: 0]`
**Symptoms:**
- After many operations on same tab, click starts timing out
- Closing and reopening tab resolves it
- Suggests CDP session state accumulates

**Workaround:** Periodically close and reopen tabs

**Files:** `src/cdp.js`, `src/page.js`

---

### 7.4 Framework detection on page load
`[votes: 1]`
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
`[votes: 7]`
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
`[votes: 2]`
**Problem:**
Cached element handles (objectIds) can become stale, creating a category of "stale element" errors.

**Proposed:**
Never cache element references. Re-resolve selector from scratch for every action. Store selector string, not objectId.

**Impact:** MEDIUM-HIGH - Eliminates stale element errors entirely, simplifies state management

**Files:** `src/dom.js`, `src/aria.js`

---

### 8.3 MutationObserver-based waiting
`[votes: 0]`
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
`[votes: 0]`
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
`[votes: 1]`
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
`[votes: 3]`
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
`[votes: 0]`
**Problem:**
Cannot access closed shadow roots via normal DOM APIs.

**Proposed:**
Install piercer script at document evaluation that monkey-patches `Element.attachShadow()` to maintain a WeakMap of closed shadow roots.

**Impact:** LOW - Edge case for components using closed shadow DOM

**Files:** `src/dom.js`, new `src/piercer.js`

---

### 8.8 Frame-aware element identification
`[votes: 0]`
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
`[votes: 0]`
**Problem:**
Hard depth limits truncate DOM capture. No automatic recovery.

**Proposed:**
Progressive depth reduction on encoder errors (256 → 128 → 64 → 1). Re-hydrate missing branches via `DOM.describeNode`.

**Impact:** LOW - Better handling of extremely deep DOMs

**Files:** `src/aria.js`

---

## 9. Snapshot Response Payload Issues

Issues identified by the snapshot evaluation run (2026-02-03) across 6 agents testing HN, Wikipedia, GitHub, Amazon, Herokuapp, and ECMAScript spec.

### 9.1 Refs map inlined in every snapshot response
`[votes: 2]`
**Symptoms:**
- Every snapshot, snapshotSearch, and auto-snapshot response includes the full refs map as inline JSON (CSS selectors keyed by ref ID)
- On HN (228 refs) this is ~20KB of CSS selectors. On the ECMAScript spec (28,329 refs) it exceeds 1MB
- Agents never use CSS selectors directly -- they use ref IDs from the YAML
- Response size is 2-3x larger than the actual snapshot content
- Snapshot eval (2026-02-03): HN agent measured 32KB response for a 16KB snapshot; ECMAScript summary mode returned 1MB+ due to 28K refs

**Expected:** Refs should be written to file (alongside YAML) or omitted from JSON entirely. Only include refs inline when explicitly requested.

**Files:** `src/runner/execute-query.js`, `src/runner/step-executors.js`

---

### 9.2 viewportSnapshot always included regardless of relevance
`[votes: 2]`
**Symptoms:**
- `{"snapshot": {"since": "s1"}}` with `unchanged: true` still sends 5-10KB viewportSnapshot
- `{"snapshotSearch": ...}` sends full viewportSnapshot alongside targeted search results
- Explicit `{"snapshot": true}` sends viewportSnapshot AND full snapshot (redundant)
- 10-12KB of YAML per response on typical pages
- Snapshot eval (2026-02-03): HN caching response included redundant 5.8KB viewport; ECMAScript viewport repeated in every response

**Expected:** viewportSnapshot should only be included on action responses (click, goto, scroll, fill). Query operations and caching responses should not include it.

**Files:** `src/runner/step-executors.js`

---

### 9.3 Summary mode includes all refs inline
`[votes: 2]`
**Symptoms:**
- Summary detail level is meant for orientation (~100-200 bytes of YAML)
- But the response includes ALL refs inline in JSON
- On ECMAScript spec: summary YAML is ~100 bytes but response is 1MB+ due to 28,329 refs
- On HN: summary YAML is 5 lines but response is 32KB due to 228 refs
- Snapshot eval (2026-02-03): ECMAScript agent, HN agent

**Expected:** Summary mode should return zero refs. It's for orientation, not interaction.

**Files:** `src/runner/execute-query.js`

---

### 9.4 Accessible names not truncated causing snapshot bloat
`[votes: 2]`
**Symptoms:**
- GitHub commit message links have 500-2000 character accessible names
- Amazon product names duplicated in parent link + child heading (~150 chars x2 per product)
- Full snapshot on GitHub: 57KB (would be ~8KB with name truncation)
- snapshotSearch results include full multi-KB names per match
- Snapshot eval (2026-02-03): GitHub agent measured 57KB full / 55KB interactive / 19KB viewport-only; Amazon agent found product name duplication

**Expected:** Names should be truncated to ~150 characters by default, with a `maxNameLength` option. Duplicate child text should be suppressed.

**Files:** `src/aria.js`

---

### 9.5 Footer/boilerplate noise dominates snapshots
`[votes: 3]`
**Symptoms:**
- Amazon homepage: 57% of interactive elements (52/92) are footer links
- Amazon search results: footer + sidebar = ~65% of full snapshot
- Wikipedia: ~60-65% of viewport snapshot is site chrome (banner, nav, promo)
- HN: table structure noise (`row`, `cell`, `rowgroup`) = ~35% of YAML
- Snapshot eval (2026-02-03): Amazon, Wikipedia, HN agents all independently flagged this

**Expected:** Option to exclude landmark roles from snapshots (e.g., `exclude: ["contentinfo"]` or `excludeFooter: true`). Auto-scope to `role=main` when it exists.

**Workaround:** Use `{"snapshot": {"root": "role=main"}}` to scope to main content (already supported but agents need to know to use it).

**Files:** `src/aria.js`, `src/runner/execute-query.js`

---

### 9.6 Viewport snapshot includes fixed/sticky navigation in every response
`[votes: 2]`
**Symptoms:**
- ECMAScript spec: fixed TOC sidebar is ~60% of every viewport snapshot
- Wikipedia: banner + nav bars repeat in every viewport snapshot (~60-65%)
- On a 5-action workflow, the agent processes the same banner content 5 times
- Snapshot eval (2026-02-03): ECMAScript, Wikipedia agents

**Expected:** Option to exclude fixed/sticky positioned elements from viewport snapshots, or auto-detect and omit them after the first snapshot.

**Files:** `src/aria.js`

---

## 10. Snapshot Content/Accuracy Issues

### 10.1 Summary reports "Viewport elements: 0" incorrectly
`[votes: 5]`
**Symptoms:**
- Summary detail level shows `Viewport elements: 0` when elements are clearly visible
- Confirmed on: HN, Wikipedia, Amazon, Herokuapp (tables page), ECMAScript spec
- All 5 agents independently flagged this as a bug
- Snapshot eval (2026-02-03): universal across all tested sites

**Expected:** Viewport element count should be accurate.

**Files:** `src/aria.js` (viewport detection in summary mode)

---

### 10.2 Headings and non-interactive elements have no refs in snapshotSearch
`[votes: 3]`
**Symptoms:**
- snapshotSearch returns `ref=None` for all heading matches
- On Wikipedia: ALL 11 section headings return `ref=None`, making section navigation impossible via refs
- On ECMAScript spec: section headings (the primary navigation targets) have no refs
- Agents must fall back to unreliable text-based clicking or manual scrolling
- Snapshot eval (2026-02-03): Wikipedia agent (all 11 headings ref=None), ECMAScript agent (Array.prototype.map heading ref=None), Herokuapp agent (hover headings not tracked)

**Expected:** Headings should get refs (they ARE navigation targets even if not traditionally "interactive"), or snapshotSearch should return a CSS selector/anchor ID for ref=None matches.

**Files:** `src/aria.js`, `src/runner/execute-query.js`

---

### 10.3 Interactive detail level broken on link-dense pages
`[votes: 4]`
**Symptoms:**
- HN: interactive (23,147 bytes) is LARGER than full (15,879 bytes) -- 46% bigger
- Wikipedia: interactive (29,750 bytes) saves only 12% vs full (33,973 bytes)
- GitHub: interactive (55KB) vs full (57KB) -- negligible difference
- ECMAScript spec: interactive (1.7MB) vs full (2.5MB) -- still unusable
- Interactive removes headings (needed for orientation) while keeping hundreds of low-value links
- Snapshot eval (2026-02-03): HN, Wikipedia, GitHub, ECMAScript agents all flagged this

**Expected:** Interactive should always be strictly smaller than full. Consider section-grouped format or name truncation specific to interactive mode.

**Files:** `src/aria.js`

---

### 10.4 `since` hash ignores element state changes
`[votes: 1]`
**Symptoms:**
- Checkbox toggles don't change the hash (URL, scroll, DOM size, interactive count all unchanged)
- `{"snapshot": {"since": "s1"}}` falsely reports "unchanged" after toggling checkboxes
- Dynamic loading page: hidden content becomes visible but hash doesn't change (same DOM size)
- Dropdown selection: no hash change after selectOption
- Snapshot eval (2026-02-03): Herokuapp agent -- `since` always reports "unchanged" on checkboxes page after toggle

**Expected:** Hash should include a lightweight checksum of interactive element states (checked, selected, expanded, disabled, visibility).

**Files:** `src/aria.js`

---

### 10.5 Combobox/select shows no value in snapshot
`[votes: 1]`
**Symptoms:**
- `<select>` elements render as bare `combobox [ref=s1e1]` with no selected value
- After selecting "Option 2", snapshot still shows just `combobox [ref=s1e1]`
- Even with `includeText: true`, no value is shown
- Agents cannot verify dropdown state via snapshot
- Snapshot eval (2026-02-03): Herokuapp agent

**Expected:** Display like `combobox "Option 2" [ref=s1e1]` showing the accessible name of the selected option.

**Files:** `src/aria.js`

---

### 10.6 Table cell text missing in default snapshot
`[votes: 1]`
**Symptoms:**
- `<td>` and `<th>` elements show as empty `cell` and `columnheader` nodes without `includeText: true`
- Default snapshot is nearly useless for any page with tabular data
- Column headers have no visible names
- Snapshot eval (2026-02-03): Herokuapp agent -- tables page shows completely empty cells

**Expected:** Table cells should show text content by default. The text content IS the accessible name for table cells.

**Workaround:** Use `extract` step for structured table data, or `{"snapshot": {"includeText": true}}`.

**Files:** `src/aria.js`

---

### 10.7 snapshotSearch fuzzy matching too aggressive
`[votes: 1]`
**Symptoms:**
- "star" matches "start", "started" etc. (no word-boundary awareness)
- "Issues" matches commit messages containing the word "issues" in 1500-char names
- On GitHub: searching "star" returned 10 matches, none of which were the actual "243k stars" link
- No relevance scoring -- long commit message matches rank equally with navigation links
- Snapshot eval (2026-02-03): GitHub agent

**Expected:** Default matching should use word boundaries. Add `fuzzy` parameter for control: `"exact"`, `"word"` (default), `"substring"` (current behavior).

**Files:** `src/runner/execute-query.js`

---

### 10.8 snapshotSearch results lack state attributes
`[votes: 1]`
**Symptoms:**
- Checkbox search returns refs but doesn't indicate `[checked]` status
- Combobox search doesn't show selected value
- Search matches don't include `[disabled]`, `[expanded]`, or `[name=...]` attributes
- Agent must request a full snapshot just to check element states
- Snapshot eval (2026-02-03): Herokuapp agent

**Expected:** Add a `states` field to search results: `{"ref": "s1e1", "role": "checkbox", "states": {"checked": true}}`.

**Files:** `src/runner/execute-query.js`

---

### 10.9 snapshotSearch path context unhelpful on large pages
`[votes: 2]`
**Symptoms:**
- HN: all matches share identical path `table > rowgroup > row > cell > table > rowgroup > row > cell` -- no disambiguation
- ECMAScript spec: all headings show `path: "generic"` -- no section hierarchy
- Path should include nearest named ancestor or section heading for context
- Snapshot eval (2026-02-03): HN agent, ECMAScript agent

**Expected:** Include article/section context in path: e.g., `article #3 (Floppinux) > cell > link "42 comments"` or `Indexed Collections > Array > heading "Array.prototype.map"`.

**Files:** `src/runner/execute-query.js`

---

### 10.10 Unnamed buttons have no fallback text
`[votes: 1]`
**Symptoms:**
- Amazon international shopping dialog has buttons with no ARIA accessible name: `button [ref=s1e13]`
- Agent cannot tell which button dismisses the modal vs. redirects
- Many real-world sites have buttons with no ARIA labels but DO have visible text via innerText
- Snapshot eval (2026-02-03): Amazon agent

**Expected:** Fall back to `innerText`, `value`, `title`, or child text content when ARIA accessible name is empty.

**Files:** `src/aria.js`

---

## 11. Navigation/Detection Issues

### 11.1 SPA client-side navigation not detected
`[votes: 1]`
**Symptoms:**
- Click on GitHub tab (Issues, PRs, Code) reports `navigated: false`
- URL changes via `history.pushState` happen asynchronously after click resolves
- `changes` field is always `undefined` after SPA transitions
- `waitAfter: true` and `waitAfter: {networkidle: true}` don't help
- Agent must add explicit `wait` steps after every link click on SPAs
- Affects all SPAs: GitHub (Turbo), Next.js, Nuxt, React Router, Vue Router, etc.
- Snapshot eval (2026-02-03): GitHub agent -- every click on Turbo links reports navigated:false

**Expected:** System should monkey-patch `history.pushState`/`replaceState` before clicks and detect URL changes within ~500ms. Report as navigation events with proper diffs.

**Files:** `src/runner/execute-interaction.js`, `src/runner/step-executors.js`

---

### 11.2 Same-page anchor navigation causes full page reload
`[votes: 1]`
**Symptoms:**
- `goto` with a `#hash` fragment on the same page causes a full page reload
- On ECMAScript spec (2.5MB page): anchor navigation takes 32 seconds instead of <1 second
- Same-origin hash changes should use `location.hash` for near-instant navigation
- Snapshot eval (2026-02-03): ECMAScript agent -- navigating to `#sec-promise.all` took 32.4s

**Expected:** Detect same-origin URL with only hash difference and use `location.hash` + scroll instead of full `Page.navigate`.

**Files:** `src/runner/execute-navigation.js`

---

### 11.3 False modal detection from input placeholders
`[votes: 1]`
**Symptoms:**
- GitHub's search input placeholder `"Search code, repositories, users, issues, pull requests..."` is reported as `context.modal` on every page load
- Misleads agents into thinking a dialog is blocking interaction
- Snapshot eval (2026-02-03): GitHub agent

**Expected:** `context.modal` should only be populated when a `role="dialog"` or `role="alertdialog"` element is present and visible.

**Files:** `src/runner/step-executors.js`

---

### 11.4 selectOption produces no diff/changes
`[votes: 1]`
**Symptoms:**
- After `selectOption`, the response has no `changes` field
- Unlike click and fill, selectOption generates no diff
- Agent can't verify the change through the standard diff mechanism
- Snapshot eval (2026-02-03): Herokuapp agent

**Expected:** selectOption should produce diff like: `{"changed": [{"ref": "s1e1", "field": "value", "from": "", "to": "Option 2"}]}`.

**Files:** `src/runner/step-executors.js`

---

### 11.5 Text-based click silently matches wrong element
`[votes: 1]`
**Symptoms:**
- `{"click": {"text": "History"}}` matched the "Past revisions of this page" navigation link instead of the article section heading
- No disambiguation warning given despite multiple matches
- Subsequent "Cannot find context" error was confusing and didn't indicate navigation occurred
- Snapshot eval (2026-02-03): Wikipedia agent

**Expected:** When `click(text)` finds multiple matches, either return an error listing all matches (let agent disambiguate) or prefer the match closest to viewport center.

**Files:** `src/dom/click-executor.js`

---

### 11.6 HTML markup leaking into accessible names
`[votes: 1]`
**Symptoms:**
- Amazon results heading contains raw HTML: `heading "1-16 of over 1,000 results... <span class=\"a-button a-button-base\">..."`
- HTML tags should be stripped from accessible name strings
- Snapshot eval (2026-02-03): Amazon agent

**Expected:** Strip HTML tags from accessible names during snapshot generation.

**Files:** `src/aria.js`

---

## Adding New Issues

To add a new issue, use this template:

```markdown
### X.X [Short title]
`[votes: 1]`

**Symptoms:**
- What you observed
- Error messages if any

**Expected:** What should happen

**Workaround:** Any known workarounds

**Files:** Suspected files involved
```

---

## Vote Tally

| Issue | Votes |
|-------|-------|
| **6.5 Refs stale between snapshot/click** | **14** |
| 2.3 Cross-origin iframes | 9 |
| **8.1 Network quiet detection** | **7** |
| 2.2 switchToFrame action context | 6 |
| **10.1 Summary "Viewport elements: 0" bug** | **5** |
| **10.3 Interactive detail level broken (link-dense)** | **4** |
| 3.1 Shadow DOM selectors | 4 |
| **9.5 Footer/boilerplate noise dominates** | **3** |
| **10.2 Headings have no refs** | **3** |
| **8.6 Frame-scoped snapshots** | **3** |
| 2.1 Frame context persistence | 3 |
| 4.3 Fill empty string doesn't clear | 3 |
| **4.4 Keyboard shortcuts w/ modifiers** | **3** |
| **9.1 Refs map inlined (20KB+ bloat)** | **2** |
| **9.2 viewportSnapshot always included** | **2** |
| **9.3 Summary includes all refs inline** | **2** |
| **9.4 Accessible names not truncated** | **2** |
| **9.6 Viewport includes fixed/sticky nav** | **2** |
| **10.9 snapshotSearch path unhelpful** | **2** |
| **8.2 Lazy selector resolution** | **2** |
| 1.2 Step-level timeout ignored | 2 |
| 5.1 Invalid selector error | 2 |
| 7.1 New tab detection/tracking | 2 |
| **11.1 SPA navigation not detected** | **1** |
| **10.4 `since` ignores state changes** | **1** |
| **10.5 Combobox shows no value** | **1** |
| **10.6 Table cells empty by default** | **1** |
| **10.10 Unnamed buttons no fallback** | **1** |
| **11.2 Anchor nav causes full reload** | **1** |
| **10.7 snapshotSearch fuzzy too aggressive** | **1** |
| **10.8 snapshotSearch lacks state attrs** | **1** |
| **11.3 False modal detection** | **1** |
| **11.4 selectOption no diff** | **1** |
| **11.5 Text click wrong element** | **1** |
| **11.6 HTML in accessible names** | **1** |
| 7.0 Drag on range input sliders | 1 |
| **8.5 Innermost text matching** | **1** |
| 6.2 captureResult delay too short | 1 |
| 7.4 Framework detection on page load | 1 |
| 8.3 MutationObserver waiting | 0 |
| 8.4 XPath support | 0 |
| 8.7 Closed shadow DOM piercing | 0 |
| 8.8 Frame-aware element IDs | 0 |
| 8.9 Adaptive depth handling | 0 |

**Total votes allocated: 90** (includes snapshot eval run 2026-02-03: +51 votes across 6 agents)

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
