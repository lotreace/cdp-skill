# Snapshot Eval: GitHub (Turbo SPA) - Stale Refs & Navigation Detection

**Date**: 2026-02-03
**Target**: github.com/facebook/react
**SPA Framework**: GitHub Turbo (async `history.pushState`)

## Changes Under Test

1. **Ref re-resolution**: When a ref's DOM element is stale, the system re-finds it using stored CSS selector + role/name verification
2. **Snapshot ID stability**: Internal auto-snapshots no longer increment the snapshot ID
3. **Navigation detection delay**: 50ms delay before navigation check for SPA frameworks

---

## Test 1: SPA Navigation Detection

| Click Target | Navigation Detected | URL Changed | Page Content Changed |
|---|---|---|---|
| Issues tab (s1e16) | NO | YES (delayed) | YES (delayed) |
| Pull Requests tab (s1e17) | NO | YES (delayed) | YES (delayed) |
| Code tab (s1e15) | NO | YES (delayed) | YES (delayed) |

**Success Rate: 0/3 (0%)**

### Details

GitHub's Turbo framework performs `history.pushState` asynchronously after the click. The 50ms delay is not sufficient to catch it. In every case:

- The click itself succeeded (correct element targeted, `method: cdp`)
- The URL did change, but only visible in the NEXT request (snapshot or click)
- The auto-snapshot taken immediately after the click still showed the old page content

The `navigated: true` flag was never set on any Turbo SPA navigation. However, `navigated: true` was correctly set on full page navigations (via `goto`).

### Implication

For GitHub Turbo specifically, the 50ms delay is insufficient. The Turbo fetch-and-swap cycle typically takes 200-500ms. An agent using cdp-skill on GitHub must take an explicit snapshot after clicking navigation elements to see the new page content.

---

## Test 2: Snapshot ID Stability

| Operation | Snapshot ID | Correct? |
|---|---|---|
| `goto` github.com/facebook/react | s1 (auto) | YES |
| `click` Issues tab | s1 (auto, no increment) | YES |
| `click` Pull Requests tab | s1 (auto, no increment) | YES |
| `snapshot` (explicit) | s2 | YES |
| `goto` (fresh navigation) | s1 (reset) | YES |
| 4x `eval` operations | no increment | YES |
| `snapshot` (explicit) | s1 | YES |

**Result: PASS - Snapshot IDs are perfectly stable**

### Details

- Auto-snapshots from `click` and `eval` never increment the snapshot ID
- Only explicit `{"snapshot": true}` increments the counter
- Full page navigation (`goto`) resets the counter to s1
- After goto + 4 evals + 1 explicit snapshot, the ID was correctly s1
- Previously these operations would have inflated the counter to s5 or higher

### Ref ID Behavior

- Header/navigation elements that persist across SPA transitions keep their original `s1eXX` refs
- New content elements introduced by explicit snapshots get new `sNeXX` refs where N is the current snapshot counter
- This means agents can reliably reference persistent elements (like nav tabs) using refs from the initial snapshot

---

## Test 3: Ref Re-Resolution After SPA Transition

**Scenario**: Navigate Issues -> Code (via Turbo SPA), then click `.claude` directory ref from original snapshot.

| Step | Result |
|---|---|
| Initial: `.claude` dir = s1e28 | Ref stored |
| Click Issues (SPA nav) | OK, page transitioned |
| Wait 1500ms | -- |
| Click Code (SPA nav) | OK, page transitioned |
| Wait 1500ms | -- |
| Click s1e28 (`.claude` dir) | SUCCESS - active element shows `.claude, (Directory)` |

**Result: PASS - Refs survived SPA transitions**

### Why It Worked

GitHub's Turbo framework replaces only the `#repo-content-turbo-frame` turbo-frame element during tab navigation. The file list elements are within this frame, but when returning to the Code tab, the same DOM structure is recreated. The original ref `s1e28` pointed to a specific CSS selector path which matched the recreated element.

This is not true re-resolution (the element may have been the same DOM node or a newly created one that matched the same selector). The key insight is that GitHub's Turbo preserves enough DOM structure that CSS selector-based refs remain valid across same-page navigations.

---

## Test 4: Ref Re-Resolution with Eval Clone Simulation

**Scenario**: Clone-replace the Issues tab link (making the original DOM node stale), then click the stale ref.

| Step | Result |
|---|---|
| Clone-replace `#issues-tab` | Replaced successfully |
| Debug: check refsMap | Element exists, `isConnected: false` |
| Debug: check metaMap | `{selector: "#issues-tab", role: "link", name: "Issues 835"}` |
| Debug: querySelector candidate | EXISTS, connected, tag=A, text="Issues\n          835" |
| Click s1e16 | FAIL - returned `stale: true` |

**Result: FAIL - Re-resolution metadata exists but name matching fails**

### Root Cause: Whitespace Mismatch Bug

The re-resolution logic finds the candidate element via `document.querySelector('#issues-tab')` and verifies:
1. Role match: `link` === `link` -- PASS
2. Name match: checks if `candidateName.toLowerCase().includes(meta.name.toLowerCase())`
   - `candidateName` = `"issues\n          835"` (from `textContent.trim()`)
   - `meta.name` = `"issues 835"`
   - `"issues\n          835".includes("issues 835")` = **FALSE**

The `textContent` of the cloned element contains a newline + spaces between "Issues" and "835" (reflecting the HTML structure), while the stored metadata name has a normalized single space. The `includes()` check does not normalize whitespace, causing the name verification to fail even though it is semantically the same element.

### Suggested Fix

Normalize whitespace in both the candidate name and meta name before comparison:
```javascript
const normalize = s => s.replace(/\s+/g, ' ').trim().toLowerCase();
nameMatch = normalize(candidateName).includes(normalize(meta.name).substring(0, 100));
```

---

## Test 5: Multiple Rapid Operations

| Operations | Final Snapshot ID |
|---|---|
| goto + 4 evals + 1 explicit snapshot | s1 |

**Result: PASS - No inflation**

The 4 eval operations did not increment the snapshot counter. Only the explicit snapshot caused s1.

---

## Summary

| Change | Impact on GitHub | Rating |
|---|---|---|
| **Snapshot ID stability** | Excellent. IDs stayed at s1 through multiple clicks and evals. Only explicit snapshots increment. Biggest practical improvement. | HIGH IMPACT |
| **Ref re-resolution** | Metadata is stored correctly. CSS selector fallback finds candidates. But whitespace normalization bug in name matching prevents successful re-resolution. After fix, this will be valuable. | MEDIUM IMPACT (blocked by bug) |
| **Navigation detection delay (50ms)** | Insufficient for GitHub Turbo. All 3 SPA navigations returned `navigated: false`. Would need 200-500ms to catch Turbo's async pushState. | LOW IMPACT (needs increase) |

### Biggest Difference Maker

**Snapshot ID stability** is the clear winner for GitHub. Previously, every click/eval would inflate snapshot IDs, making refs like `s5e16` or `s8e16` instead of a stable `s1e16`. Now agents can reference persistent elements (nav tabs, header links) with their original refs throughout an entire session without worrying about ID drift.

### Bugs Found

1. **Ref re-resolution whitespace mismatch**: `textContent` whitespace is not normalized before name comparison. The `includes()` check fails when the DOM element's text has newlines/extra spaces vs. the stored name with normalized spaces.

2. **50ms navigation delay too short for GitHub Turbo**: GitHub's Turbo framework dispatches fetch + DOM swap asynchronously. The pushState call happens well after 50ms. Consider either:
   - Increasing the delay to 200-300ms
   - Listening for `turbo:load` events
   - Comparing URL before/after with a longer polling window
