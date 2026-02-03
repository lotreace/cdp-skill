# Snapshot Evaluation: ECMAScript Language Specification (tc39.es/ecma262)

**Date:** 2026-02-03
**Target:** https://tc39.es/ecma262/ -- the full ECMAScript 2026 Language Specification
**Page characteristics:** Single-page document, ~74,625 total elements, ~28,329 interactive elements, deeply nested TOC, thousands of sections with cross-references, anchor-based navigation.

---

## Test Results

### 1. chromeStatus

**Result:** OK. Chrome detected immediately, no issues. Response in <1s.

---

### 2. openTab + goto to tc39.es/ecma262/

**Time:** 3.1 seconds total (page load + initial snapshot).
**Result:** The viewport snapshot correctly shows the TOC (30 top-level links with refs) and the beginning of the document ("About this Specification"). The fullSnapshot file was auto-generated at 2.5MB.

**Assessment:** Good. The initial load is fast. The viewport snapshot gives a clear orientation showing the TOC structure. The 2.5MB full snapshot file is generated but not inlined -- this is correct behavior.

---

### 3. Full Snapshot

| Metric | Value |
|--------|-------|
| Full snapshot file size | 2,529,012 bytes (2.5MB) |
| Full snapshot lines | 73,768 |
| Refs count | 28,329 |
| Generation time | ~4 seconds |
| Inline? | No (exceeds 9KB limit, saved to file) |
| Refs file | Separate .refs.json file (correct) |

**Assessment:** The full snapshot is completely unusable for direct consumption. At 2.5MB / 73K lines, no agent could process it meaningfully. The system correctly routes it to a file and reports the size. The 4-second generation time is acceptable given the page size.

**Problem:** Even as a file, no agent should ever read this. The 2.5MB file would consume most of a context window. There should be a warning or recommendation in the output suggesting snapshotSearch or viewport-only instead.

---

### 4. Interactive Detail Level

| Metric | Value |
|--------|-------|
| Size | 1,708,163 bytes (1.7MB) |
| Lines | 28,328 |
| Interactive count | 28,329 |
| Inline? | No (saved to file) |

**Assessment:** On this page, "interactive" is essentially every cross-reference link, every TOC entry, every grammar production link. The spec has thousands of internal links, making the interactive snapshot only ~32% smaller than full. Still completely unusable for an agent.

**Key insight:** On a specification document, nearly everything is a link. The interactive filter provides minimal reduction. A better heuristic for document-like pages would recognize that internal cross-reference links (e.g., `#_ref_12345`) are not "actions" an agent would take and filter them out.

---

### 5. Summary Detail Level

| Metric | Value |
|--------|-------|
| YAML content | "# Snapshot Summary\n# Total elements: 74625\n# Interactive elements: 28329\n# Viewport elements: 0\n\nlandmarks:" |
| Stats useful? | Partially |

**Critical bug:** The summary YAML itself is tiny (~100 bytes), but the response includes ALL 28,329 refs inline in the JSON response. This caused the total response to exceed 1MB, which is absurd for a "summary" mode. The summary detail level should NOT return refs at all -- it's meant for orientation, not interaction.

**Bug: Viewport elements: 0.** The summary reports 0 viewport elements even though the viewport clearly has content (TOC + headings visible). This counter appears broken.

**Missing:** The summary shows no landmarks because the spec page doesn't use standard ARIA landmark roles. The summary could benefit from detecting document structure through headings instead.

---

### 6. snapshotSearch

#### 6a. Text search: "Array.prototype.map"

| Metric | Value |
|--------|-------|
| Matches | 2 (1 paragraph text, 1 heading) |
| Time | 3.9 seconds |
| Elements searched | 74,625 |

**Results:**
```
heading: "23.1.3.21 Array.prototype.map ( callback [ , thisArg ] )"
staticText: (descriptive paragraph mentioning the term)
```

**Critical bug: No refs on headings.** The heading match has NO ref, making it impossible to click/navigate to it. Only interactive elements (links, buttons, inputs) get refs, but headings are often the navigation target on document pages.

#### 6b. Heading search: "Iteration"

| Metric | Value |
|--------|-------|
| Matches | 7 headings |
| Time | 3.9 seconds |

**Results:** Found relevant headings like "14.7 Iteration Statements" and "27.1 Iteration". Again, no refs on any heading matches.

#### 6c. Link search: "Promise.all"

| Metric | Value |
|--------|-------|
| Matches | 2 links |
| Time | 3.8 seconds |

**Results:** Found TOC links with refs (`s49e28385`, `s49e28388`). Links DO get refs. This is the only way to get actionable results from snapshotSearch on this page.

#### 6d. Link search: "Array.prototype.map" (role=link)

| Metric | Value |
|--------|-------|
| Matches | 0 |

**Critical problem:** Zero results when searching for "Array.prototype.map" with role=link, even though the TOC clearly contains this link. The TOC link text includes the full signature "Array.prototype.map ( callback [ , thisArg ] )" which the fuzzy matcher should find. This appears to be a matching issue -- the search may not be finding TOC links that are scrolled far out of view, or the fuzzy match threshold is too strict.

#### Overall snapshotSearch Assessment

- **Speed:** 3.8-3.9 seconds consistently across all searches. This includes the time to generate the full accessibility tree in memory. Acceptable but not fast.
- **Accuracy:** Heading matches work well. Link matches are inconsistent (Promise.all found, Array.prototype.map not found).
- **Actionability:** Heading matches are NOT actionable (no refs). This is the single biggest gap for document navigation. An agent that finds a section heading via search cannot navigate to it without additional steps.
- **Path context:** The `path` field shows "generic" for most elements, which is unhelpful. On a spec document, knowing "section 23 > subsection 1 > heading" would be far more useful.

---

### 7. Viewport-Only Snapshot

| Metric | Value |
|--------|-------|
| Size | 3,138 bytes (3KB) |
| Refs count | 36 |
| Time | 2.3 seconds |

**Comparison to full:** 3KB vs 2,529KB = **~800x smaller**.

**Assessment:** Viewport-only is the sweet spot for this page. It returns exactly what's visible: the TOC (with expanded sections when navigated) and the current content. Fast, small, actionable.

**Problem:** The viewport snapshot includes the fixed sidebar TOC in every response. On this page the TOC is ~60% of the viewport snapshot. For repeated interactions, this is redundant context. A "content-only" mode that excludes fixed/sticky navigation would save significant tokens.

---

### 8. Anchor Navigation (#sec-array.prototype.map)

| Metric | Value |
|--------|-------|
| Time | 32.4 seconds |
| Correct position? | Yes (scroll y=1,020,331, percent=72) |
| Viewport content correct? | Yes |

**Critical problem:** 32 seconds to navigate to an anchor on the same page. This is because `goto` treats it as a full page navigation even though it's the same URL with a different hash. The page must reload entirely. On a 2.5MB single-page spec, this is devastating.

**The viewport snapshot after navigation is excellent:** It shows the TOC expanded to the correct section (Array > Array.prototype methods) and the actual heading + content for Array.prototype.map.

**Suggested fix:** For same-origin anchor navigation, use `window.location.hash = '#section'` via eval instead of a full page reload. This would be near-instant.

---

### 9. Scroll Behavior + since

**Scroll down 2000px:**
- Time: 2.2 seconds
- Changes summary: "Scrolled. 10 added, 6 removed." (correct)
- Diff correctly shows elements entering/leaving viewport

**since parameter (no change):**
- Time: 2.3 seconds
- Returns `unchanged: true` with message "Page unchanged since s40"
- Correctly avoids re-generating the massive snapshot

**Assessment:** Both work well. The `since` caching is particularly valuable on this page where regenerating a snapshot takes ~4 seconds.

---

### 10. Multi-Step "Understand Promise.all" Workflow

Simulating an agent that needs to find and read the Promise.all spec section:

| Step | Action | Time | Roundtrip |
|------|--------|------|-----------|
| 1 | `openTab` + goto tc39.es/ecma262 | 3.1s | 1 |
| 2 | `snapshotSearch` for "Promise.all" | 3.9s | 2 |
| 3 | Navigate to #sec-promise.all via goto | 32.4s | 3 |
| 4 | Read viewport snapshot (auto-included) | 0s | -- |

**Total: 3 roundtrips, ~39 seconds.**

**Optimal workflow (if improvements implemented):**

| Step | Action | Time | Roundtrip |
|------|--------|------|-----------|
| 1 | `openTab` + goto tc39.es/ecma262 | 3.1s | 1 |
| 2 | `snapshotSearch` for "Promise.all" heading (returns ref + anchor) | 3.9s | 2 |
| 3 | Click heading ref or fast-scroll to anchor | ~0.5s | 3 |
| 4 | Read viewport | 0s | -- |

**Optimal total: 3 roundtrips, ~7.5 seconds** (saving 31 seconds by avoiding full page reload for anchor nav).

An even better workflow: combine step 2+3 into a single "search and navigate" pattern.

---

## What Worked Well

1. **Viewport-only snapshots are excellent.** 3KB vs 2.5MB. Fast, relevant, actionable.
2. **The auto-snapshot on navigation.** After goto with anchor, the viewport correctly shows the target section with expanded TOC context -- no additional snapshot step needed.
3. **snapshotSearch finds headings accurately.** Fuzzy matching against 74,625 elements and finding relevant spec sections is impressive.
4. **The `since` caching mechanism.** Avoids regenerating 2.5MB snapshots when nothing changed. Fast 2.3s response.
5. **Scroll diffs work correctly.** Meaningful added/removed summaries even on this massive page.
6. **Inline limit (9KB) correctly routes massive snapshots to files.** The agent is told about the file without being flooded with 2.5MB of YAML.
7. **TOC expansion in viewport.** After anchor navigation, the viewport snapshot shows the TOC expanded to the relevant section, giving excellent hierarchical context.

---

## What Was Problematic

### P0 - Blocking Issues

1. **snapshotSearch returns NO refs for headings.** On a document-heavy page, headings are the primary navigation targets. Without refs, an agent cannot interact with search results for headings. This makes snapshotSearch partially useless for document navigation.

2. **Anchor navigation takes 32 seconds.** `goto` with a hash fragment on the same page causes a full page reload. For a 2.5MB single-page spec, this makes navigation painfully slow. Same-origin hash changes should use `location.hash` instead.

### P1 - High Impact

3. **Summary mode returns all 28,329 refs inline.** The summary YAML is ~100 bytes, but the response is 1MB+ because every ref is included. Summary should return zero refs -- it's for orientation, not interaction.

4. **Summary reports 0 viewport elements.** Clearly a bug -- the viewport has visible content.

5. **snapshotSearch for "Array.prototype.map" (role=link) returns 0 results.** The TOC link exists but is not found. Inconsistent with "Promise.all" (role=link) which works. The fuzzy matching or element traversal has a gap.

6. **Interactive detail level is useless on spec documents.** 1.7MB / 28,328 elements -- nearly every element is a link. The "interactive" filter provides minimal benefit on link-heavy documents.

### P2 - Medium Impact

7. **viewportSnapshot repeated identically in every response.** Even when the viewport hasn't changed (same scroll position, same page), the full viewport snapshot is included. Combined with the `since` mechanism for full snapshots, viewport snapshots should also support conditional inclusion.

8. **Root selector (`#sec-promise.all`) fails.** The spec uses custom element types (`emu-clause`) with IDs. CSS selectors work differently on these. The root option should handle ID-based lookups more robustly (e.g., `document.getElementById()` instead of `querySelector()`).

9. **Path context in snapshotSearch is unhelpful.** All headings show `path: "generic"`. On a spec document, showing the section hierarchy (e.g., "Indexed Collections > Array Objects > Properties of the Array Prototype Object") would be far more useful for agents to decide which match is relevant.

10. **Fixed sidebar TOC is ~60% of every viewport snapshot.** On pages with sticky navigation, the same TOC links appear in every viewport snapshot. A mechanism to exclude fixed/sticky elements from viewport snapshots would save significant tokens.

---

## Specific Improvement Suggestions

### 1. Heading refs for snapshotSearch (NEW)
**Rationale:** On documents, headings are the primary navigation targets. snapshotSearch should assign refs to heading elements, or at minimum return the heading's associated anchor ID so agents can navigate to it.

### 2. Fast anchor navigation (NEW)
**Rationale:** `goto` with a same-origin hash fragment should use `location.hash` + scroll instead of full page reload. On the ECMAScript spec, this would reduce navigation from 32s to <1s.

### 3. Summary mode should NOT include refs (NEW)
**Rationale:** Summary is for orientation. Including 28K refs in a summary response defeats the purpose and creates a 1MB+ response for what should be a ~200 byte payload.

### 4. "Content-only" viewport mode (NEW)
**Rationale:** Exclude fixed/sticky positioned elements (like the TOC sidebar) from viewport snapshots. On the spec page, this would cut viewport snapshot size by ~60%.

### 5. Better path context in snapshotSearch (NEW)
**Rationale:** Show document section hierarchy instead of generic DOM path. This helps agents pick the right match when multiple sections contain similar terms.

### 6. snapshotSearch should support `scrollTo` option (NEW)
**Rationale:** Combine search + navigate in one step. `snapshotSearch` with `scrollTo: true` would find the first match and scroll to it, returning the viewport snapshot at that location. Would save one roundtrip.

### 7. Internal cross-reference link filtering for interactive mode (NEW)
**Rationale:** On spec documents, thousands of internal `#_ref_XXXX` links inflate the interactive snapshot without providing value. Detecting and filtering these "spec infrastructure" links would make interactive mode actually useful on these pages.

---

## Votes

### Existing Issues I'd Vote For

| Issue | Reason |
|-------|--------|
| **6.5 Refs stale between snapshot/click** | On this page, ref numbers go up to s49e28402. With 28K refs, stale ref issues are amplified. |
| **8.6 Frame-scoped snapshots** | Root-scoped snapshots failed on this page. Better scoping is critical for large documents. |
| **8.2 Lazy selector resolution** | With 28K elements and navigation taking 32s, avoiding stale refs is essential. |

### New Issues to Add

| ID | Title | Priority | Description |
|----|-------|----------|-------------|
| **NEW-1** | snapshotSearch missing refs on non-interactive elements (headings) | P0 | Headings found via snapshotSearch have no ref, making results unactionable for document navigation |
| **NEW-2** | Same-page anchor navigation causes full page reload | P0 | `goto` with `#hash` on same origin reloads the entire page. Should use `location.hash` for near-instant navigation |
| **NEW-3** | Summary mode returns all refs inline (massive response) | P1 | Summary detail level includes all 28K refs in the response, creating a 1MB+ payload for what should be a ~200 byte summary |
| **NEW-4** | Summary reports 0 viewport elements | P1 | `Viewport elements: 0` even when content is visible in viewport |
| **NEW-5** | snapshotSearch inconsistent link matching on large pages | P2 | "Array.prototype.map" (role=link) returns 0 matches even though the TOC contains this link. "Promise.all" (role=link) works fine. |
| **NEW-6** | Viewport snapshot includes fixed/sticky sidebar in every response | P2 | Fixed navigation elements repeat in every viewport snapshot, wasting ~60% of the payload on documents with sticky sidebars |
| **NEW-7** | snapshotSearch path context shows "generic" for all elements | P2 | Path should show document section hierarchy, not generic DOM ancestry |

---

## Conclusions

The snapshot system works, but it is not optimized for large, document-heavy pages. The key insight from this evaluation:

**On the ECMAScript spec (74K elements, 28K interactive), the only viable snapshot strategy is: viewport-only + snapshotSearch.** Full, interactive, and summary snapshots are all too large to be useful. However, snapshotSearch is crippled by the lack of refs on headings, which are the primary navigation targets on document pages.

The ideal agent workflow for specification documents should be:
1. **Load page** (viewport snapshot auto-included) -- understand TOC structure
2. **snapshotSearch** for the topic of interest -- find the right section heading (needs refs!)
3. **Navigate to section** via anchor (needs fast hash navigation, not full reload)
4. **Read viewport snapshot** -- get the content

Currently, step 2 is partially broken (no refs on headings) and step 3 is painfully slow (32s full page reload). Fixing these two issues would transform the spec-reading experience from ~40 seconds to ~8 seconds with the same number of roundtrips.
