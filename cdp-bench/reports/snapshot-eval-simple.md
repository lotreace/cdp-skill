# Snapshot Evaluation Report: Hacker News (Simple Site)

**Date:** 2026-02-03
**Target:** news.ycombinator.com
**Evaluator:** Claude Opus 4.5

---

## Test Results

### 1. chromeStatus

**What happened:** Returned Chrome status with version, port, and a list of 35+ open tabs. Status: ok.

**Verdict:** Works correctly. No issues. The tab list is useful for debugging but could be overwhelming if Chrome has many open tabs. For the purpose of simply verifying Chrome is running, the full tab list is noise.

**Roundtrips:** 1 (as expected)

---

### 2. openTab + goto (Auto-Snapshot)

**What happened:** Opened a new tab (t755) and navigated to `https://news.ycombinator.com`. Response included:
- `viewportSnapshot` inline (11,658 bytes of YAML)
- `fullSnapshot` routed to file (15,883 bytes)
- Total JSON response: 12,780 bytes

**Assessment:**
- The `viewportSnapshot` is very verbose for HN. Each story generates ~7 lines of YAML (title link, domain link, upvote link, author link, time link, hide link, comments link), plus empty `row` and `cell` nodes for table structure.
- The table structure noise (`- row`, `- cell`, `- rowgroup`) accounts for roughly 30-40% of the viewport snapshot content and conveys almost no useful information to an agent.
- Refs like `link [ref=s1e12]` (upvote arrows with no accessible name) are noise -- an agent cannot tell what they do.
- **The viewport snapshot is nearly identical in size to the full snapshot** on this page because HN fits most of its content in the viewport at 824px height. This defeats the purpose of viewport-only snapshots as a "lighter" option.

**What is useful:** Article titles with refs, comment links with refs, nav links. An agent could immediately click any article or comment thread.

**What is missing:** No score/points information is captured. HN shows point counts as plain text (not links/buttons), so they are invisible in the accessibility tree. An agent tasked with "find the highest-scoring article" would fail.

**Roundtrips to accomplish a task (e.g., "click the first article"):** 1 -- the auto-snapshot from openTab provides enough info. This is good.

---

### 3. Full Snapshot (`{"snapshot": true}`)

**What happened:** Full snapshot was 15,879 bytes, exceeding the 9KB inline limit. Routed to file at `/tmp/cdp-skill/t755.snapshot.yaml`. Response JSON was 32,211 bytes total (due to the refs map being inlined).

**Critical issue: The refs map dominates the response.** The step output contains all 228 refs as a JSON object of CSS selectors. This alone is ~20KB. An agent does not need CSS selectors -- it only needs the ref IDs (which are already in the YAML). The refs map is completely wasted context.

**Assessment:**
- 228 interactive elements on a 30-story HN page is reasonable.
- The full snapshot file itself (15,879 bytes) is useful and well-structured.
- But the JSON response with inline refs is 2x larger than the snapshot itself, which is backwards.
- `yaml: null` plus `artifacts.snapshot` file path is the correct routing decision.

**Roundtrips:** 1 CLI call, but agent must then read the file (2 roundtrips total). Acceptable for full snapshot.

---

### 4. Interactive Detail Level (`{"snapshot": {"detail": "interactive"}}`)

**What happened:** Response was 32,245 bytes. The interactive snapshot was routed to file at 23,147 bytes.

**Critical problem: Interactive mode is LARGER than full mode (23,147 bytes vs 15,879 bytes).** This is completely backwards. The interactive snapshot is supposed to be a compact view of only actionable elements, but it produced 46% more data than the full snapshot.

**Assessment:** On a link-heavy page like HN, "interactive" includes every link and their path context, which produces more output than the full tree (which can use nesting to avoid repeating paths). The interactive detail level fails its design goal on link-dense pages.

---

### 5. Summary Detail Level (`{"snapshot": {"detail": "summary"}}`)

**What happened:** The summary YAML was only 5 lines:
```yaml
# Snapshot Summary
# Total elements: 494
# Interactive elements: 227
# Viewport elements: 0
# landmarks:
```

The `landmarks` section is empty because HN uses no ARIA landmark roles.

**Problems:**
1. **Viewport elements: 0** -- This is a bug. HN clearly has visible elements in the viewport, but the summary reports zero. This makes the summary misleading.
2. **No landmarks detected** -- HN has no semantic landmarks, so the summary returns essentially nothing useful. There is no fallback for pages without landmarks.
3. Despite the tiny summary YAML, the response JSON was still 32,091 bytes because the full refs map (228 entries) was still included. A summary should not include refs at all.

**Verdict:** Summary is nearly useless on this page. An agent gets no structural orientation from it.

---

### 6. snapshotSearch

**What happened:** Searched for `{"text": "comments", "role": "link", "limit": 5}`. Returned 5 matches with refs and paths in 844 bytes of actual match data.

**Assessment:** This worked well. The matches are compact and actionable:
```json
{"path": "table > rowgroup > row > cell > table > rowgroup > row > cell", "role": "link", "name": "42 comments", "ref": "s1e18"}
```

**Problems:**
1. The path `table > rowgroup > row > cell > table > rowgroup > row > cell` is repeated identically for all 5 matches. It provides no disambiguation value. A better path would include item-specific context (e.g., the article title or position number).
2. Total response was still 13,543 bytes because the viewportSnapshot was included in the response. For a targeted search, the full viewportSnapshot is redundant noise.

**Roundtrips:** 1 to find + 1 to click = 2. Good for targeted element finding.

---

### 7. Click a Ref

**What happened:** Clicked `s1e18` ("42 comments"). Navigation succeeded, arriving at the HN comment thread. Response showed `navigated: true` with the new URL and a viewport snapshot of the comment page.

**Assessment:** Refs worked perfectly. The click used CDP method (not jsClick fallback). The auto-snapshot after navigation showed the comment thread content including usernames, timestamps, comment text, and reply links. This is a smooth 1-roundtrip operation.

**Comment page viewportSnapshot quality:** Excellent. The comment text is included in paragraph nodes because HN comments are rendered as text content. This means an agent can read comments without additional roundtrips. The comment thread structure (nested tables) is visible but not confusing.

---

### 8. Snapshot Caching (`since` parameter)

**What happened:**
- `{"snapshot": {"since": "s1"}}` -- Returned a new snapshot (page had changed since navigating to comment thread). This is correct.
- `{"snapshot": {"since": "s18"}}` -- Returned `{"unchanged": true, "snapshotId": "s6", "message": "Page unchanged since s18"}`. This is correct behavior.

**Problem:** The `snapshotId` in the "unchanged" response is `s6`, not `s18`. The `since` parameter uses `s18` but the returned snapshotId is `s6`. This is confusing -- an agent would expect the snapshotId to match or logically relate to the `since` value. The internal snapshotId counter appears to be incrementing independently of the `since` parameter.

**Also problematic:** Even the "unchanged" response still includes the full `viewportSnapshot` inline (5,805 bytes). If the page is confirmed unchanged, why send the viewport snapshot again? This defeats the purpose of caching.

---

### 9. Auto-Snapshot Diff (Scroll)

**What happened:** After scrolling to bottom, the response included:
```json
{
  "summary": "Scrolled. 63 added (...). 80 removed (...).",
  "added": ["- link \"indigodaddy\" [ref=s2e166]", ...],
  "removed": [...]
}
```

**Assessment:** The diff is informative and tells the agent what changed in the viewport. The summary counts are useful. However:
1. The summary lists individual ref IDs (`s2e166, s2e167, ...`) which are not meaningful without the YAML. The added/removed arrays already have the names.
2. After `back` navigation (URL change), there were NO changes reported despite the entire page content being different. This is because `navigated: true` pages skip the diff. This makes sense for full page navigations but means the agent gets no diff context after `back`/`forward`.

---

## What Worked Well

1. **Ref-based clicking is reliable.** Clicked `s1e18` successfully on a static page with no issues. CDP method worked directly.
2. **snapshotSearch is the best tool for targeted element finding.** Compact results, actionable refs, low noise.
3. **Auto-snapshot after navigation** provides immediate orientation on the new page.
4. **Caching correctly detects unchanged pages** and returns a lightweight response (conceptually, though the viewportSnapshot is still included).
5. **Comment page viewport snapshot includes text content** -- very useful for reading without extra roundtrips.
6. **openTab auto-snapshot eliminates a separate snapshot call** -- one roundtrip for navigate + orient.

---

## What Was Problematic

### P0 -- Blocking Issues

1. **Refs map bloats every response by ~20KB.** The refs map (CSS selectors keyed by ref ID) is included inline in every snapshot response. On HN, 228 refs = ~20KB of CSS selector strings that an agent NEVER needs. Agents interact via ref IDs, not CSS selectors. This is pure waste that doubles or triples response size.

2. **viewportSnapshot is always included, even when redundant.** The viewportSnapshot appears in caching responses (where it is pointless), snapshotSearch responses (where it is noise), and every other response. On HN it is 10-12KB per response. This is the single largest source of unnecessary context.

### P1 -- High Impact

3. **Interactive snapshot is larger than full snapshot.** On link-heavy pages, `detail: "interactive"` produces more data than `detail: "full"`. This breaks the assumption that interactive is a lighter alternative.

4. **Summary snapshot is useless on pages without ARIA landmarks.** Returns "Viewport elements: 0" (bug) and no structural information. Most traditional websites (HN, Reddit, Wikipedia) have minimal/no ARIA landmarks.

5. **Table structure noise in viewportSnapshot.** Lines like `- row`, `- cell`, `- rowgroup` add ~35% bloat with no value to an agent. On HN, every story is wrapped in 3-4 levels of table nesting.

### P2 -- Medium Impact

6. **snapshotSearch paths are not disambiguating.** All matches share the same generic path like `table > rowgroup > row > cell > ...` which provides no context about which article the match belongs to.

7. **No point/score data captured.** HN point counts are plain text outside of interactive elements, so they are invisible in snapshots. An agent cannot make score-based decisions.

8. **Caching "unchanged" response still sends viewportSnapshot.** The entire point of caching is to reduce data transfer. Sending the viewport snapshot on an unchanged page wastes ~5-10KB.

9. **snapshotId counter is confusing.** It increments across all operations (snapshots, auto-snapshots, searches) making it hard to predict or track. The `since` parameter accepts any past ID but the returned ID is unpredictable.

---

## Specific Improvement Suggestions

### 1. Stop inlining the refs map (HIGH IMPACT)
**Rationale:** The refs map is 20KB+ of CSS selectors that agents never use directly. Agents use ref IDs from the YAML. Write refs to the file alongside the YAML or omit from JSON entirely. This would cut response size by 50-70%.

### 2. Make viewportSnapshot opt-in, not always-on (HIGH IMPACT)
**Rationale:** Every response includes 10-12KB of viewportSnapshot YAML. For caching checks, searches, and explicit full snapshots, this is redundant. Only include it when: (a) it is the primary output (e.g., after click/goto), or (b) explicitly requested. This alone would halve response sizes for query operations.

### 3. Collapse table structure noise
**Rationale:** Empty `- row`, `- cell`, `- rowgroup` nodes with no accessible name or content are pure noise. A table-aware formatter could flatten these: instead of 4 levels of `table > rowgroup > row > cell > link "Title"`, output `link "Title"` with optional table position context.

### 4. Fix interactive snapshot to be strictly smaller than full
**Rationale:** Interactive mode should only list interactive elements with minimal path context. Currently it seems to include full path context that inflates it beyond the full tree. The path rendering needs to be more compact.

### 5. Fix summary to work without ARIA landmarks
**Rationale:** Summary should fall back to a useful heuristic when no landmarks exist: list the top-level sections, count of different element types by area, or at minimum list the first N interactive elements. Also fix the "Viewport elements: 0" bug.

### 6. Omit viewportSnapshot from caching "unchanged" responses
**Rationale:** If the page is unchanged, the agent already has the previous viewport snapshot. Sending it again wastes context.

### 7. Add article/position context to snapshotSearch paths
**Rationale:** Instead of `table > rowgroup > row > cell`, include the nearest named ancestor: `article #3 (Floppinux) > cell > link "42 comments"`. This helps agents understand which match corresponds to which page section.

---

## Votes

### Existing Issues I Would Vote For

| Issue | Reason |
|-------|--------|
| **6.5** Refs stale between snapshot/click | Not observed on HN (static site), but the refs map inflation problem is related to how refs are managed |
| **8.1** Network quiet detection | Would help on dynamic pages; HN was fine but real-world sites need this |

### New Issues to Add

#### NEW: Refs map inlined in every snapshot response bloats JSON by 20KB+
`[votes: 1]` `[priority: P0]`

**Symptoms:**
- Every snapshot, snapshotSearch, and auto-snapshot response includes the full refs map as inline JSON
- On HN (228 interactive elements), this is ~20KB of CSS selector strings
- Agents never use CSS selectors directly; they use ref IDs from the YAML
- Response size is 2-3x larger than the actual snapshot content

**Expected:** Refs should be written to file (alongside YAML) or omitted from JSON. Only include refs inline when explicitly requested.

**Files:** `src/runner/execute-query.js`, `src/runner/step-executors.js`

---

#### NEW: viewportSnapshot included in all responses regardless of relevance
`[votes: 1]` `[priority: P1]`

**Symptoms:**
- `{"snapshot": {"since": "s1"}}` with `unchanged: true` still sends 5-10KB viewportSnapshot
- `{"snapshotSearch": ...}` sends full viewportSnapshot alongside targeted search results
- Explicit `{"snapshot": true}` sends viewportSnapshot AND full snapshot (redundant)
- 10-12KB of YAML per response on a typical page

**Expected:** viewportSnapshot should only be included on action responses (click, goto, scroll, fill) where it serves as the "what just happened" context. Query operations should not include it by default.

**Files:** `src/runner/step-executors.js`

---

#### NEW: Interactive detail level produces larger output than full detail
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- `{"snapshot": {"detail": "interactive"}}` returned 23,147 bytes on HN
- `{"snapshot": true}` (full detail) returned 15,879 bytes on the same page
- Interactive is supposed to be lighter but is 46% larger

**Expected:** Interactive should always be strictly smaller than full.

**Files:** `src/aria.js`

---

#### NEW: Summary detail level reports "Viewport elements: 0" incorrectly
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- HN has 200+ visible elements but summary reports `Viewport elements: 0`
- Summary returns empty `landmarks:` on sites without ARIA landmarks
- Effectively useless on traditional HTML sites

**Expected:** Viewport element count should be accurate. Summary should provide useful orientation even without landmarks.

**Files:** `src/aria.js`

---

#### NEW: Table structure noise in snapshot YAML (~35% bloat)
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- Empty `- row`, `- cell`, `- rowgroup` nodes with no names or content
- On HN, each story is wrapped in 3-4 levels of meaningless table structure
- Accounts for ~35% of YAML size

**Expected:** Collapse or skip empty structural nodes that carry no semantic information. A link nested in `table > rowgroup > row > cell` should render as just the link unless the table structure itself is meaningful.

**Files:** `src/aria.js`

---

## Roundtrip Analysis Summary

| Task | Roundtrips | Notes |
|------|-----------|-------|
| Navigate + orient | 1 | openTab auto-snapshot is excellent |
| Click a known link | 1 | Ref from auto-snapshot works |
| Find specific element | 2 | snapshotSearch + click |
| Read full page content | 2 | snapshot (file) + read file |
| Check if page changed | 1 | Caching works but response is still large |
| Navigate + read comments | 1 | Comment text in viewport snapshot |

The roundtrip counts are good. The primary issue is not roundtrip count but **response payload size** -- every roundtrip sends 2-3x more data than the agent actually needs.
