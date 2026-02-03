# Snapshot System Evaluation: Wikipedia Stale Refs & ID Stability

**Date:** 2026-02-03
**Target:** https://en.wikipedia.org/wiki/Web_browser, https://en.wikipedia.org/wiki/HTTP
**Tab:** t766

## Changes Under Test

1. **Ref re-resolution**: When a ref's DOM element is stale (disconnected), the system attempts to re-find it using stored CSS selector + role/name verification
2. **Snapshot ID stability**: Internal auto-snapshots (diff before/after, scroll context) no longer increment the snapshot ID
3. **Navigation detection delay**: 50ms `sleep()` before navigation check after CDP click verification fails

---

## Test 1: Snapshot ID Stability Across Multiple Actions

**Result: PASS**

| Step | Action | Ref Prefix in Viewport | Snapshot ID |
|------|--------|----------------------|-------------|
| 1 | `openTab` (Web_browser) | s1 | s1 (auto) |
| 2 | `scroll: "bottom"` | s1 (e.g., s1e420..s1e486) | s1 (internal, no increment) |
| 3 | `scroll: "top"` | s1 (e.g., s1e1..s1e100) | s1 (internal, no increment) |
| 4 | `snapshot: true` (explicit) | s1 (existing elements keep s1 prefix) | **s2** |
| 5 | Click link -> navigate -> back | s1 (DOM restored via bfcache) | s1 (retained from bfcache) |

**Evidence:**
- After scroll to bottom: all new refs were `s1e420`, `s1e421`, etc. (NOT s2eXX)
- After scroll back to top: original refs `s1e1` through `s1e100` reappeared unchanged
- Explicit snapshot correctly incremented to `s2`
- Navigation to Google Chrome and back preserved the s1 refs on the original page

**Conclusion:** Internal auto-snapshots (used for diff computation) correctly reuse the current snapshot ID. Only explicit `snapshot` steps and navigation events increment the ID.

---

## Test 2: Ref Re-Resolution on Content-Heavy Page

**Result: FAIL (bug found in name matching)**

### Setup
- Took snapshot on Web_browser article (refs at s1/s2/s3)
- Used `eval` to clone-and-replace the `#toc-History > a` element (simulating a DOM re-render)
- The original element for ref `s1e20` became disconnected (stale)

### What Happened
1. **Metadata was stored correctly:**
   - `selector: "#toc-History > a"`
   - `role: "link"`
   - `name: "2 History"`

2. **CSS selector found the replacement element:**
   - `document.querySelector("#toc-History > a")` returned the clone
   - Clone was connected to DOM (`isConnected: true`)
   - Role matched: both `"link"`

3. **Name matching FAILED:**
   - Stored name: `"2 History"` (whitespace-normalized by `normalizeWhitespace()`)
   - Candidate `textContent.trim()`: `"2\n\t\t\t\tHistory"` (raw whitespace with newlines/tabs)
   - The `includes()` check: `"2\n\t\t\t\thistory".includes("2 history")` -> **false**

4. **Click reported stale:**
   ```json
   {"action":"click","status":"ok","warning":"Element ref:s1e20 is no longer attached to the DOM...","output":{"stale":true}}
   ```

### Root Cause
The `getAccessibleName()` helper in `getElementByRef()` uses `element.textContent.trim().substring(0, 200)` which only trims leading/trailing whitespace but does NOT normalize internal whitespace (newlines, tabs, multiple spaces). The stored `meta.name` was normalized by the snapshot's `normalizeWhitespace()` function which replaces all `\s+` with single spaces. This mismatch causes the `includes()` comparison to fail.

### Fix Needed
In `getElementByRef()`, the `getAccessibleName()` helper should normalize whitespace before comparison:
```javascript
// Current (broken):
element.textContent ? element.textContent.trim().substring(0, 200) : ''

// Should be:
element.textContent ? element.textContent.replace(/\s+/g, ' ').trim().substring(0, 200) : ''
```

---

## Test 3: Navigation Detection

**Result: PASS**

### Forward Navigation
- Clicked `s1e68` ("Google Chrome" link) on Web_browser article
- Response: `{"method":"cdp","navigated":true,"newUrl":"https://en.wikipedia.org/wiki/Google_Chrome"}`
- Navigation was detected correctly
- The 50ms delay before navigation check (in `clickByRef`) gave Wikipedia's page transition time to commit the URL change

### Back Navigation
- Executed `{"back": true}`
- Response: `{"url":"https://en.wikipedia.org/wiki/Web_browser","title":"Web browser - Wikipedia"}`
- Successfully navigated back

### Anchor Navigation
- Clicked `s1e19` ("1 Function" ToC link) which navigates to `#Function`
- Response: `{"method":"cdp","navigated":true,"newUrl":"https://en.wikipedia.org/wiki/Web_browser#Function"}`
- Hash-based navigation correctly detected

---

## Test 4: Ref Stability Across Navigation

**Result: PASS**

| Step | URL | Ref s1e19 Status |
|------|-----|-----------------|
| Initial snapshot | /wiki/Web_browser | Valid, clickable |
| Navigate to /wiki/Google_Chrome | /wiki/Google_Chrome | N/A (different page) |
| Back to /wiki/Web_browser | /wiki/Web_browser | Still valid |
| Click s1e19 | /wiki/Web_browser#Function | Clicked successfully |

**Evidence:**
- After navigating to Google Chrome and back, the Web_browser page's DOM was restored via bfcache
- Ref `s1e19` ("1 Function") was still connected and clickable
- The page scrolled to the Function section as expected
- All other refs (`s1e17`, `s1e21`, etc.) were also intact

---

## Test 5: Rapid Sequential Operations Without ID Inflation

**Result: PASS (with nuance)**

Navigated to /wiki/HTTP for clean slate. The `goto` step created the initial s1 auto-snapshot.

| Step | Action | Snapshot ID | Notes |
|------|--------|-------------|-------|
| 0 | `goto` (HTTP article) | s1 | Initial navigation auto-snapshot |
| 1 | `snapshot: true` | **s2** | Explicit snapshot increments |
| 2 | `scroll: "down"` | s1 (internal) | Internal auto-snapshot, no increment |
| 3 | `eval: "document.title"` | s1 (internal) | Internal auto-snapshot, no increment |
| 4 | `scroll: "up"` | s1 (internal) | Internal auto-snapshot, no increment |
| 5 | `snapshot: true` | **s3** | Explicit snapshot increments |

**Evidence:**
- Step 1 output: `"snapshotId": "s2"`
- Step 5 output: `"snapshotId": "s3"`
- Steps 2-4 viewport snapshots still show `s1eXX` refs (e.g., `s1e1`, `s1e89`, `s1e112`)
- Without the fix, steps 2-4 would each have incremented the ID, resulting in the final snapshot being s6 instead of s3

**Expected vs Actual:**
- Expected: s1 (goto), s2 (snapshot), s1 (scroll-internal), s1 (eval-internal), s1 (scroll-internal), s3 (snapshot)
- Actual: Matches expected. The ID jumped from s2 to s3, not s2 to s6.

---

## Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Snapshot ID stability | PASS | Internal auto-snapshots correctly reuse current ID |
| Ref re-resolution | FAIL | Whitespace normalization mismatch in name comparison |
| Navigation detection delay | PASS | 50ms sleep helps with Wikipedia's async page transitions |

### Key Finding: Re-Resolution Bug

The ref re-resolution mechanism has the correct architecture (metadata storage, CSS selector lookup, role/name verification) but fails on Wikipedia due to a whitespace normalization mismatch. The stored name uses `normalizeWhitespace()` (collapses `\s+` to single space) while the re-resolution `getAccessibleName()` helper only does `.trim()`. This causes the `includes()` check to fail when element `textContent` contains internal newlines or tabs, which is extremely common in Wikipedia's DOM.

This is a one-line fix in `aria.js` within the `getElementByRef()` function's `getAccessibleName()` helper.
