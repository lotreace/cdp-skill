# Snapshot Evaluation: the-internet.herokuapp.com

**Date:** 2026-02-03
**Target:** https://the-internet.herokuapp.com (Heroku test automation playground)
**Pages tested:** Main page, /checkboxes, /dropdown, /dynamic_loading/1, /tables, /hovers, /login

---

## Test Results

### 1. chromeStatus

**Result:** PASS. Chrome was already running. Response was fast and included full tab listing. No issues.

### 2. Main Page (openTab + goto)

**Result:** PASS. The auto-snapshot on `openTab` returned a clean, readable list of all 44 example links with refs. Every link had a descriptive accessible name (e.g., `link "Checkboxes" [ref=s1e6]`). An agent can immediately identify and navigate to any sub-page by clicking a ref.

**Observation:** The viewport was tall enough to show ~25 links inline. The rest were in the full snapshot file. This is a good split -- the most important content was inline.

### 3. Checkboxes Page

**Snapshot quality:** Excellent. Clean output:
```
- checkbox [ref=s1e1]
- checkbox [checked] [ref=s1e2]
```
The `[checked]` state annotation is immediately useful. Refs are assigned to both checkboxes.

**Toggle + diff:** Clicking `s1e1` produced:
```json
{"summary": "Clicked. 1 toggled (s1e1).", "changed": [{"ref":"s1e1","field":"checked","from":null,"to":true}]}
```
This is exactly what an agent needs -- the summary tells you what happened, and the `changed` array gives machine-readable detail.

**Multi-step toggle:** Both checkboxes toggled in a single CLI call with two click steps. The diff correctly reported both:
```json
{"summary": "Clicked. 2 toggled (s1e1, s1e2).", "changed": [...both changes...]}
```

**Issue found:** The `from` value for unchecked is `null` rather than `false`. While functional, `false` would be more semantically correct and consistent.

### 4. Dropdown Page

**Snapshot quality:** POOR. The combobox/select element shows no value information:
```
- combobox [ref=s1e1]
```
After selecting "Option 2", the snapshot still shows just `- combobox [ref=s1e1]` with no indication of the selected value. Even with `includeText: true`, no value is shown.

**selectOption action:** Works correctly (`selected: ["2"]`), but the response includes NO `changes` field at all. The diff is completely absent for selectOption actions.

**Impact:** An agent cannot verify which option is selected without using `eval` or `formState`. This forces an extra roundtrip for any dropdown verification workflow.

### 5. Dynamic Loading Page

**Initial snapshot:** Clean -- shows Start button with ref.

**After clicking Start:** The auto-snapshot captured the loading state (spinner as `- img`) and correctly reported the Start button as removed. The agent needs to understand this is a transient state.

**Waiting for content:** Using `wait: {"text": "Hello World!"}` then `snapshot` works perfectly. The full workflow (goto + click + wait + snapshot) completed in a single CLI call.

**`since` parameter bug:** After the page finished loading, `{"snapshot": {"since": "s1"}}` falsely reported `unchanged: true` even though the content changed from a button + loading spinner to "Hello World!" text. The hash-based caching only checks URL, scroll position, DOM size, and interactive element count. In this case, the "hidden element becomes visible" pattern doesn't change DOM size or URL, so the cache incorrectly reports no change.

**Caveat:** When interactive count DOES change (button removed), `since` correctly detects the change. It fails specifically for visibility/state-only changes.

### 6. Tables Page

**Snapshot quality (default):** POOR for data extraction. Table structure is preserved (rows, cells, columnheaders) but all text content is missing:
```
- table:
  - rowgroup:
    - row:
      - columnheader
      - columnheader
      - cell
      - cell
```
Only interactive elements (edit/delete links) have names. Headers and data cells are empty.

**Snapshot quality (includeText: true):** GOOD. Full cell content appears:
```
- cell: "Smith"
- cell: "John"
- cell: "jsmith@gmail.com"
```
However, this must be explicitly requested and is NOT applied to the auto-snapshot (`viewportSnapshot`).

**extract vs snapshot:** The `extract` step returns perfectly structured table data with headers and rows. For pure data extraction, `extract` is clearly superior to `snapshot`. Snapshots are only useful for tables when you need to interact with specific cells (e.g., clicking edit/delete links).

**Detail level comparison:**
- `full`: Shows complete tree structure but empty cells (without includeText)
- `interactive`: Flat list of 17 links (edit/delete) with path context. Very compact but loses all data context. Path shows `table > rowgroup > row > cell` but doesn't disambiguate WHICH row.
- `summary`: Shows "104 total elements, 17 interactive, 0 viewport elements, 0 landmarks." The 0 viewport elements is suspicious (bug?). The 0 landmarks is correct but not useful for this page.

### 7. Hovers Page

**Initial snapshot:** Shows 3 user avatar images but no interactive elements on them (no refs). The hidden profile links are not in the snapshot since they're hidden by CSS.

**After hovering:** The diff correctly reports the added elements:
```json
{"summary": "Hovered. 1 added (s4e2).", "added": ["- link \"View profile\" [ref=s4e2]"]}
```
The viewportSnapshot shows both the heading `"name: user1"` and the `"View profile"` link.

**captureResult:** Returns `visibleElements: []` even though elements appeared. This confirms the known issue 6.2 -- the capture delay is too short for CSS transition-based reveals.

**Observation:** The diff only tracks interactive elements (links), not the heading that appeared. An agent would know a link appeared but not the associated user name unless they read the full snapshot.

### 8. snapshotSearch

**Role filtering:** Works well across all tested roles:
- `link`: Found all 45 links on main page
- `checkbox`: Found both checkboxes with refs
- `button`: Correctly returned 0 on main page
- `combobox`: Found the dropdown select
- `textbox`: Found username/password fields on login page

**Text search:** Fuzzy matching works. Searching "Dynamic" found 3 matching links.

**Gap:** Search results don't include element states. Checkbox search returns refs but doesn't indicate `[checked]` status. Combobox search doesn't show selected value. The viewportSnapshot has this info, but the search results don't.

**Gap:** Search results don't include HTML field names (`[name=username]`), only accessible names. The viewportSnapshot includes `[name=username]` but the search result only has `name: "Username"`.

### 9. Detail Level Comparison (Tables)

| Level | Output Size | Usefulness for Tables |
|-------|------------|----------------------|
| `full` (default) | ~1.5KB | Structure visible but cells empty. Need `includeText` for data. |
| `interactive` | ~0.9KB | Just edit/delete links. Path doesn't identify which row. Useless for data reading. |
| `summary` | ~0.1KB | Counts only. Reports 0 viewport elements (bug?). No table-specific info. |

For tables specifically, `extract` at ~0.4KB provides the most useful output with headers and rows.

### 10. Workflow Efficiency

**Task: "Toggle both checkboxes and verify"**
- **Minimum roundtrips: 2**
  1. `openTab + goto` -> get initial snapshot with refs and checkbox states
  2. `click s1e1, click s1e2` -> get diff showing both toggled + final viewportSnapshot
- **Could it be fewer?** No. You need refs from the first call to click in the second.

**Task: "Select dropdown option and verify"**
- **Minimum roundtrips: 3** (should be 2)
  1. `openTab + goto` -> get snapshot with combobox ref
  2. `selectOption` -> selects option but NO diff/changes returned, snapshot still shows bare `combobox`
  3. Must use `eval` or `formState` to verify the selection
- **Improvement:** If snapshot showed selected value and selectOption returned changes, this would be 2 roundtrips.

**Task: "Click button, wait for dynamic content, verify"**
- **Minimum roundtrips: 2**
  1. `openTab + goto` -> get snapshot with button ref
  2. `click ref, wait text, snapshot` -> all in one call
- This is already optimal.

---

## What Worked Well

1. **Checkbox state tracking:** The `[checked]` annotation and diff with `from`/`to` is excellent. Agents immediately understand what happened.
2. **Auto-snapshot on navigation:** Eliminates the need for a separate snapshot call after goto. Saves a roundtrip.
3. **Multi-step in single call:** Combining click+click or goto+click+wait+snapshot in one CLI invocation is powerful for reducing roundtrips.
4. **Diff summaries:** Human-readable summaries like "Clicked. 2 toggled (s1e1, s1e2)." are perfect for agent reasoning.
5. **snapshotSearch with role filtering:** Fast, targeted element discovery without full tree overhead.
6. **Ref stability on simple pages:** Refs survived across multiple operations on the same page without going stale (checkboxes, dropdown).
7. **extract for tables:** Structured table extraction is far superior to snapshots for data reading.

## What Was Problematic

### Critical Issues

1. **`since` parameter unreliable for state changes (BUG):** The caching hash doesn't account for element attribute changes (checked, value, visibility). It only checks URL, scroll, DOM size, and interactive count. On the checkboxes page, `since` always reports "unchanged" after toggling. On the dynamic loading page, it falsely reports "unchanged" when hidden content becomes visible (same DOM size). This makes `since` a dangerous optimization -- an agent trusting `since: "unchanged"` would miss real changes.

2. **Combobox/select shows no value in snapshot:** The accessibility tree for `<select>` elements shows only `combobox` with no selected value, options list, or label. This is a fundamental gap -- select elements are one of the most common form controls and agents cannot verify their state via snapshot.

3. **Table cells empty in default snapshot:** Without `includeText: true`, table data is invisible. Column headers and data cells are all bare. The default behavior makes snapshots nearly useless for any page with tabular data.

4. **selectOption produces no diff/changes:** After selectOption, the response has no `changes` field. The agent gets `selected: ["2"]` from the step output but the auto-diff reports nothing. Agents can't verify the change through the standard diff mechanism.

### Moderate Issues

5. **viewportSnapshot ignores includeText:** Even when `snapshot` step uses `includeText: true`, the `viewportSnapshot` auto-snapshot still omits text content. The explicit snapshot output has full text, but the viewport one doesn't. Inconsistent behavior.

6. **snapshotSearch results lack state info:** Search results don't include `[checked]`, `[selected]`, `[disabled]`, or `[name=...]` attributes that the full snapshot has. An agent searching for checkboxes can't tell which are checked without a full snapshot.

7. **Summary detail level reports 0 viewport elements:** On the tables page with 104 elements, the summary says 0 viewport elements. This seems incorrect given the page content is clearly in the viewport.

8. **captureResult on hover returns empty:** Known issue 6.2 but confirmed -- CSS-transitioned content isn't captured because the delay is too short.

9. **checked state uses null instead of false:** `"from": null` for unchecked is semantically awkward. `false` would be clearer.

### Minor Issues

10. **Interactive detail level doesn't disambiguate rows:** The path `table > rowgroup > row > cell` is identical for every edit/delete link in every row. Adding row index would help: `table > rowgroup > row[2] > cell`.

11. **Heading changes not tracked in diff:** On the hovers page, a heading appeared ("name: user1") but only the link was reported in the diff. Non-interactive element additions could be useful for text-content-aware agents.

---

## Specific Improvement Suggestions

### 1. Fix `since` hash to include element states
**Rationale:** The current hash (URL + scroll + DOM size + interactive count) misses attribute-only changes. Add a lightweight checksum of interactive element states (checked, selected, expanded, disabled) to the hash. This doesn't require full tree comparison -- just iterate the known refs and hash their state bits.

### 2. Show selected value on combobox elements
**Rationale:** Display like `combobox "Option 2" [ref=s1e1]` -- the accessible name of the selected option. Most accessibility APIs expose this. The ARIA spec says combobox should have an accessible value.

### 3. Include text content in cells/headers by default
**Rationale:** Table cells with only `- cell` are useless. The text content of `<td>` and `<th>` elements IS their accessible name according to ARIA. These should show as `cell "Smith"` and `columnheader "Last Name"` without needing `includeText`.

### 4. Generate diff for selectOption
**Rationale:** Every other interaction (click, fill, hover) produces a changes diff. selectOption should too: `{"changed": [{"ref": "s1e1", "field": "value", "from": "", "to": "Option 2"}]}`.

### 5. Include states in snapshotSearch results
**Rationale:** Add a `states` field to search results: `{"ref": "s1e1", "role": "checkbox", "states": {"checked": true}}`. This eliminates the need for a full snapshot just to check which checkboxes are checked.

### 6. Propagate includeText to viewportSnapshot
**Rationale:** When an explicit snapshot step requests `includeText`, the viewportSnapshot returned in the same response should also include text. Currently they diverge, forcing agents to parse two different formats.

---

## Votes

### Existing Issues I'd Vote For

| Issue | Reason |
|-------|--------|
| **6.5** Refs stale between snapshot/click | Did not reproduce on simple pages, but fundamental to reliability |
| **8.1** Network quiet detection | Would help with dynamic loading page -- instead of `wait` for text, could wait for network idle |
| **6.2** captureResult delay too short | Confirmed on hovers page -- `visibleElements: []` despite elements appearing |

### New Issues to Add

| Proposed Issue | Priority | Description |
|---------------|----------|-------------|
| **`since` parameter ignores element state changes** | P1 | Hash only checks URL/scroll/DOM-size/interactive-count. Checkbox toggles, dropdown selections, and visibility changes go undetected. Agent trusting "unchanged" will miss real changes. |
| **Combobox/select shows no value in snapshot** | P1 | `<select>` elements render as bare `combobox` with no selected value, option list, or accessible name. Agents cannot verify dropdown state via snapshot. |
| **Table cell text missing in default snapshot** | P1 | `<td>` and `<th>` text content not shown without `includeText: true`. Default snapshot shows empty `cell` and `columnheader` nodes. |
| **selectOption produces no diff/changes** | P2 | Unlike click and fill, selectOption does not generate a changes object. Agent cannot verify selection through standard diff. |
| **snapshotSearch results lack state attributes** | P2 | Search matches don't include checked/selected/disabled states or HTML name attributes. Forces full snapshot for state verification. |
| **Summary detail level reports 0 viewport elements** | P3 | On tables page with visible content, summary reports `viewportElements: 0`. Likely a counting bug. |
| **viewportSnapshot ignores includeText** | P2 | Auto-snapshot doesn't propagate `includeText: true` from explicit snapshot step, creating inconsistent output in same response. |

---

## Summary

The snapshot system works well for **interactive element discovery and click/fill workflows**. The ref system, auto-diff, and multi-step batching are solid. Simple pages like checkboxes demonstrate near-optimal roundtrip efficiency.

However, the system has significant gaps for **form state verification** (dropdowns show no value), **data reading** (table cells empty by default), and **change detection** (`since` misses state-only changes). These gaps force agents into extra roundtrips or fallback to `eval`/`extract`, undermining the snapshot's goal of being the primary page understanding mechanism.

The highest-impact fixes would be: (1) showing select element values, (2) including table cell text by default, and (3) fixing the `since` hash. Together these would reduce roundtrips and eliminate the most common cases where agents need to fall back to non-snapshot tools.
