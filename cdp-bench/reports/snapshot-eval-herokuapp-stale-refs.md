# Snapshot System Eval: the-internet.herokuapp.com - Stale Refs & ID Stability

**Date**: 2026-02-03
**Target**: https://the-internet.herokuapp.com/
**Features Tested**: Ref re-resolution, Snapshot ID stability, Navigation detection delay

---

## Test 1: Snapshot ID Stability

**Result: PASS**

| Step | Action | Ref IDs | Snapshot ID |
|------|--------|---------|-------------|
| 1 | `openTab` to main page | s1e1..s1e38 | s1 (auto) |
| 2 | `click` link to /checkboxes (navigation) | s1e1..s1e3 | s1 (auto-snapshot, no increment) |
| 3 | Explicit `{"snapshot": true}` | s1e1..s1e3 | s2 (explicit, incremented) |
| 4 | `goto` /dropdown (navigation) | s1e1..s1e2 | s1 (auto-snapshot, no increment) |

**Evidence**: After clicking a link that caused page navigation, the auto-snapshot assigned refs with the `s1` prefix, not `s2`. Only an explicit `{"snapshot": true}` incremented to `s2`. Subsequent `goto` navigation reset auto-snapshot numbering back to s1 (new page context).

**Conclusion**: Auto-snapshots from internal operations (click, goto, scroll, eval) do not inflate the snapshot ID. Only explicit snapshot requests increment it.

---

## Test 2: Ref Re-Resolution on Dynamic Loading Page

**Result: PASS (with nuance)**

| Step | Action | Observation |
|------|--------|-------------|
| 1 | Navigate to /dynamic_loading/1 | Button "Start" = s1e1 |
| 2 | Click s1e1 (Start) | Loading animation triggered, button removed from changes |
| 3 | Wait 6s, snapshot | "Hello World!" appeared. s1e1 no longer in snapshot |
| 4 | Click stale s1e1 | Warning: "exists but is not visible" |

**Key finding**: On this specific page, the Start button is CSS-hidden (display:none) rather than removed from the DOM. The ref still resolved to the original element, but the system correctly detected it was not visible and issued a warning. This is correct behavior -- the element exists in the DOM, it's just hidden.

**Conclusion**: For CSS-hidden elements, the system correctly warns about invisibility rather than reporting stale. The re-resolution path was not triggered because the original element reference was still connected.

---

## Test 3: Ref Re-Resolution on Checkboxes (Clone & Replace)

**Result: FAIL -- Re-resolution blocked by implicit role map bug**

| Step | Action | Observation |
|------|--------|-------------|
| 1 | Navigate to /checkboxes, snapshot | s1e1 = checkbox (unchecked), s1e2 = checkbox (checked) |
| 2 | Click s1e1 to toggle | Toggled correctly, s1e1 now checked |
| 3 | Clone and replace checkbox via eval | System detected: s1e1 removed, s1e4 added |
| 4 | Click stale s1e1 | **STALE** -- re-resolution failed |

**Root cause**: The `getRole()` helper in the re-resolution logic maps `INPUT` to `"textbox"` without considering the `type` attribute. The stored metadata has `role: "checkbox"` (from the ARIA snapshot generator), but the re-resolution's `getRole(candidate)` returns `"textbox"` for `<input type="checkbox">`. The role check `"textbox" === "checkbox"` fails, preventing re-resolution.

**Stored metadata for s1e1**:
```json
{"selector": "#checkboxes > input:nth-of-type(1)", "role": "checkbox", "name": ""}
```

**Bug location**: `aria.js` line ~1598, the `implicitMap` in `getRole()`:
```javascript
'INPUT': 'textbox'  // Should consider type="checkbox" -> "checkbox", type="radio" -> "radio", etc.
```

---

## Test 4: Navigation Between Sub-Pages

**Result: PASS (3/3 navigations detected)**

| Step | From | To | Navigation Detected |
|------|------|----|-------------------|
| 1 | Main page | /hovers (click link) | `navigated: true`, `newUrl` reported |
| 2 | /hovers | Main page (history.back()) | `navigated: true` |
| 3 | Main page | /tables (click link) | `navigated: true`, `newUrl` reported |

**Conclusion**: Navigation detection works reliably for both click-based navigation and history.back() traversal.

---

## Test 5: Ref Re-Resolution Role Verification (Safety Guard)

**Result: PASS**

### Sub-test 5a: Replace link with div (selector no longer matches)
| Step | Action | Observation |
|------|--------|-------------|
| 1 | On main page, note s1e1 = link "A/B Testing" | Selector: `#content > ul > li:nth-of-type(1) > a` |
| 2 | Replace `<a>` with `<div>` | s1e1 removed from snapshot |
| 3 | Click stale s1e1 | **STALE** -- querySelector returned null (no `<a>` at that position) |

### Sub-test 5b: Replace link with `<a role="button">` (selector matches, role mismatch)
| Step | Action | Observation |
|------|--------|-------------|
| 1 | Fresh main page, s1e1 = link "A/B Testing" | Stored role: "link" |
| 2 | Replace with `<a role="button">A/B Testing</a>` | s1e1 removed, s1e46 added as button |
| 3 | Click stale s1e1 | **STALE** -- role mismatch ("button" != "link") prevented re-resolution |

### Sub-test 5c: Clone link (same tag, same role, same name) -- POSITIVE case
| Step | Action | Observation |
|------|--------|-------------|
| 1 | Fresh main page, s1e1 = link "A/B Testing" | Stored: selector, role="link", name="A/B Testing" |
| 2 | Clone and replace the link | Original element disconnected |
| 3 | Click stale s1e1 | **RE-RESOLVED** -- navigated to /abtest successfully |

**Conclusion**: The role verification safety guard works correctly for elements where the implicit role map has proper coverage (links, buttons, headings). It correctly blocks re-resolution when the role changes (5b) and correctly allows it when the role matches (5c). The guard has a gap for `<input>` elements due to the implicit role map bug documented in Test 3.

---

## Test 6: Multiple Operations Without ID Inflation

**Result: PASS**

| Operation | Ref IDs in Viewport |
|-----------|-------------------|
| goto /checkboxes | -- (new page) |
| explicit snapshot | s1e1, s1e2, s1e3 (snapshotId: s1) |
| eval `document.title` | s1e1, s1e2, s1e3 |
| scroll down | s1e1, s1e2, s1e3 |
| eval `h3.textContent` | s1e1, s1e2, s1e3 |
| click s1e1 | s1e1, s1e2, s1e3 |
| eval checkbox count | s1e1, s1e2, s1e3 |

All 7 operations completed. All auto-snapshots maintained the s1 prefix throughout. No ID inflation observed.

---

## Summary of the 3 Changes Tested

### 1. Ref Re-Resolution (CSS selector + role/name verification)
- **Status**: Partially working
- **Working**: Re-resolution succeeds for link elements when cloned (same selector, role, name). Role mismatch correctly blocks re-resolution for explicit `role` attributes on elements with correct implicit role map entries.
- **Bug found**: The `getRole()` helper in the re-resolution fallback maps all `INPUT` elements to `"textbox"`, ignoring the `type` attribute. This means `<input type="checkbox">`, `<input type="radio">`, and other input types cannot be re-resolved because the role check always fails. The stored metadata correctly records `"checkbox"` but the re-resolution candidate evaluation returns `"textbox"`.
- **Fix needed**: The implicit role map should check `input.type` to return accurate roles (`checkbox`, `radio`, `spinbutton`, `slider`, etc.).

### 2. Snapshot ID Stability (auto-snapshots don't increment)
- **Status**: Working correctly
- Auto-snapshots from click, goto, scroll, and eval operations all use the current snapshot ID without incrementing.
- Only explicit `{"snapshot": true}` requests increment the snapshot ID.
- This prevents ID inflation during multi-step operations.

### 3. Navigation Detection Delay (50ms delay before navigation check)
- **Status**: Working correctly
- Navigation was detected in all 3 test scenarios: click-based navigation (2 tests) and history.back() (1 test).
- All navigation events reported `navigated: true` with correct `newUrl` values.
- No false negatives observed.

---

## Bugs Found

| # | Severity | Description | Location |
|---|----------|-------------|----------|
| 1 | **Medium** | Implicit role map in `getRole()` maps all `INPUT` to `"textbox"`, breaking re-resolution for checkboxes, radios, and other input types | `aria.js` ~line 1598 |

## Recommendations

1. Fix the `getRole()` implicit role map to handle input types:
   ```javascript
   if (tag === 'INPUT') {
     const type = element.type || 'text';
     const inputTypeMap = {
       'checkbox': 'checkbox', 'radio': 'radio',
       'range': 'slider', 'number': 'spinbutton',
       'search': 'searchbox', 'email': 'textbox',
       'tel': 'textbox', 'url': 'textbox', 'text': 'textbox',
       'password': 'textbox'
     };
     return inputTypeMap[type] || 'textbox';
   }
   ```
2. Consider adding `SELECT` -> check for `multiple` attribute (listbox vs combobox).
