# Snapshot Evaluation: Large SPA (GitHub)

**Date:** 2026-02-03
**Target:** github.com/facebook/react (GitHub repo page, Turbo-powered SPA)
**Evaluator:** Claude Opus 4.5

---

## Test Results

### 1. chromeStatus

**Result: PASS**

Chrome was already running. chromeStatus returned version info and a full tab listing. The response is clean and lightweight. No issues.

### 2. openTab + goto to GitHub

**Result: MIXED**

- Opened `https://github.com/facebook/react` successfully via `openTab`
- Auto-snapshot returned inline viewport snapshot (not file-routed) with 116 refs (`s1e1` through `s1e116`)
- The viewport snapshot is comprehensive: nav header, repo tabs, file table (partially), sidebar with topics/stars/forks
- **Problem: Modal detection false positive** -- response includes `"modal": "Search code, repositories, users, issues, pull requests..."` even though no modal is open. GitHub's search input has placeholder text that is being misidentified as a modal/dialog.
- **Problem: Commit messages as accessible names** -- File table links include full PR description text as their accessible name. A single link like `s1e39` has a ~1500-character name containing the full `.claude` config PR description with markdown tables, image tags, etc. This massively inflates snapshot size.

**Metrics:**
- Viewport snapshot inline size: ~10KB (just under or around the 9KB limit due to the massive commit names)
- Full snapshot file: 57,818 bytes / 613 lines
- Tab ID returned: `t758`

### 3. Full Snapshot

**Result: PROBLEMATIC**

- Full snapshot: **57.8KB / 613 lines** -- file-routed to `/tmp/cdp-skill/t758.after.yaml`
- This is extremely large for a single repo page
- The artifact path uses the macOS `$TMPDIR` directory (long path with hashes), which works but is not user-friendly to type
- **Root cause of bloat:** GitHub renders commit message summaries as link accessible names. Each file row in the table can have 3-5 links, each with the full commit message as name text. One commit message can be 500-2000 characters. With ~36 file rows x ~3 links x ~500 chars average, that's ~54KB of commit messages alone.

### 4. Interactive Detail Level

**Result: PROBLEMATIC**

- Interactive snapshot with `root: "role=main"`: **55,116 bytes** -- still file-routed
- The `interactive` detail level reduces structure but keeps all interactive element names at full length
- For the GitHub file table, this means the same massive commit messages are preserved
- With 275 interactive elements on the page (per summary), the interactive view is supposed to be compact but is nearly as large as full

### 5. snapshotSearch

**Result: MIXED -- useful but noisy**

**Search for "Issues" (role: link):**
- Found 9 matches, searched 620 elements
- First match: correctly `"Issues 835"` with ref `s1e16`
- Remaining 8 matches: false positives from commit messages containing the word "issues" (case-insensitive fuzzy match)
- **Problem:** Fuzzy matching is too aggressive. The word "issues" in a 1500-char commit message description triggers a match.

**Search for "star":**
- Found 10 matches, 0 of which were the actual "243k stars" link
- All matches were commit messages containing "start", "started", etc.
- **Problem:** Fuzzy "star" matches "start" -- substring matching without word boundary awareness

**Search for "Code" (role: button):**
- Correctly found the "Code" dropdown button

**Search with regex pattern `^\[`:**
- Correctly found PR title links on the pulls page (5 matches)
- Pattern search works well when you know the format

**Search for "New issue":**
- Correctly found exactly 1 match on the Issues page with only 85 elements searched
- This demonstrates that snapshotSearch works well on simpler pages

### 6. Click Refs

**Result: PASS with SPA caveats**

- Clicking `s1e16` (Issues tab): click succeeded with CDP method
- Clicking `s1e15` (Code tab): click succeeded
- Clicking PR link `s76e695`: click succeeded
- **Problem:** All SPA navigations report `navigated: false` because GitHub's Turbo navigation changes the URL asynchronously after the click resolves. The agent must add a `wait` step to detect the URL change.

### 7. Auto-Snapshot Diff After SPA Navigation

**Result: FAIL**

- After clicking the Issues tab, the response shows `navigated: false` and `changes: undefined`
- The URL change from `/react` to `/react/issues` happened after the auto-snapshot was captured
- The diff system completely misses SPA transitions on GitHub
- Even with `waitAfter: true` and `waitAfter: {networkidle: true}`, the system returns before GitHub's Turbo navigation completes
- The only reliable way to detect the change is an explicit `wait` step followed by a new `snapshot`

### 8. Ref Persistence Across SPA Transitions

**Result: MOSTLY PASS**

- `s1e15` (Code tab) and `s1e16` (Issues tab) survived navigation from repo -> issues -> pulls -> back -> code
- These are persistent DOM elements in GitHub's navigation bar that are not replaced during Turbo transitions
- `s1e22` (branch dropdown button) survived from the original snapshot through multiple navigations
- **Caveat:** Refs for content area elements (file table rows, PR list items) would not survive transitions since those DOM nodes are replaced by Turbo

### 9. Snapshot After Dynamic Content Load

**Result: INCONCLUSIVE**

- Clicking the branch dropdown button (`s1e22`) returned `changes: undefined` -- no diff detected
- The dropdown may have opened but the auto-snapshot didn't capture the change
- This ties into the same issue as test 7: GitHub's React/Turbo rendering happens asynchronously and the snapshot is taken too early

### 10. Large Page Handling

**Result: FUNCTIONAL but NOISY**

- File routing works seamlessly -- snapshots over 9KB are automatically saved to `/tmp/cdp-skill/t758.snapshot.yaml`
- The `inlineLimit` parameter works: setting it to 25000 brought the 19KB viewport snapshot inline
- **Problem:** Even `viewportOnly` snapshots are 19KB due to commit message bloat
- Summary detail level is compact and useful: shows landmarks, interactive counts, total elements
- `since` caching correctly returns `unchanged: true` when page hasn't changed

---

## What Worked Well

1. **snapshotSearch with regex patterns** -- `pattern: "^\\["` correctly found PR links. Regex is far more useful than fuzzy text for targeted searches.
2. **Ref persistence for nav elements** -- GitHub's persistent header/nav elements keep their refs across SPA transitions, enabling multi-step workflows without re-snapping.
3. **Summary detail level** -- Returns a compact landmark overview (620 elements, 275 interactive) that helps agents decide whether to request full snapshots.
4. **`since` caching** -- Correctly avoids redundant snapshots. Returns `unchanged: true` with the existing snapshot ID.
5. **snapshotSearch on simpler pages** -- On the Issues page (85 elements), searching for "New issue" returned exactly 1 precise match.
6. **File routing** -- Transparent and seamless. Snapshots over 9KB automatically go to files without agent intervention.
7. **`back` navigation** -- Correctly detects page-level navigation events and reports `navigated: true`.

---

## What Was Problematic

### Critical Issues

1. **SPA navigation detection is broken for Turbo/client-side routing** -- Clicks on GitHub links always report `navigated: false` because URL changes happen asynchronously after CDP click events resolve. Even `waitAfter: {networkidle: true}` doesn't help. This means:
   - The agent gets no diff after SPA navigation
   - The agent must always add explicit `wait` steps after clicking links
   - The agent doesn't know whether a click triggered navigation or just a same-page interaction

2. **Commit messages as accessible names cause massive snapshot bloat** -- GitHub renders `title` attributes / full PR descriptions as link accessible names. A single file row can add 3-5KB of text to the snapshot. This makes:
   - Full snapshots: 57KB (should be ~5-10KB for meaningful structure)
   - Interactive snapshots: 55KB (should be ~3-5KB)
   - Viewport snapshots: 19KB (should be ~2-3KB)
   - snapshotSearch results: each match includes the full 1500-char name

3. **Fuzzy text search is too aggressive** -- "star" matches "start"/"started", "issues" matches commit messages containing "issues". The fuzzy matching has no word-boundary awareness and no way to control match strictness beyond `exact: true`.

### Moderate Issues

4. **False positive modal detection** -- GitHub's search placeholder text `"Search code, repositories, users, issues, pull requests..."` is reported as `context.modal` even when no modal/dialog is open.

5. **No diff after dropdown/popup expansion** -- Clicking the branch dropdown (`s1e22`) showed no changes in the auto-snapshot. Dynamic UI state changes from React re-renders are not captured by the diff system.

6. **Snapshot ID numbering jumps unpredictably** -- Started at `s1`, then jumped to `s2`, `s42`, `s56`, `s76`, `s77`. Each CLI invocation seems to increment multiple times due to auto-snapshots. This makes `since` parameters hard to predict.

---

## Specific Improvement Suggestions

### 1. Truncate accessible names in snapshots (HIGH IMPACT)

**Rationale:** A single link name of 1500 characters provides no value to an agent. The first 80-100 characters are sufficient to identify the element.

**Suggestion:** Add a `maxNameLength` parameter (default: 150) that truncates accessible names. For the file table, `"[repo] init claude config (#35617) ## Overview..."` is enough context.

**Expected impact:** Would reduce GitHub full snapshots from 57KB to ~8-10KB, making them inlineable. Would reduce snapshotSearch result payload by 10x.

### 2. SPA-aware navigation detection (HIGH IMPACT)

**Rationale:** GitHub, Next.js apps, and other SPAs use `history.pushState` for client-side routing. The current system only detects full page navigations.

**Suggestion:** Subscribe to `popstate` and `pushstate` events (monkey-patch `history.pushState/replaceState`) before click actions. After the click, wait briefly (200-500ms) for URL changes, then report `navigated: true` with the new URL.

**Expected impact:** Would make diffs work after SPA navigation. Would eliminate the need for manual `wait` steps after every link click.

### 3. Improve snapshotSearch fuzzy matching (MEDIUM IMPACT)

**Rationale:** Fuzzy matching "star" should not match "start" or "started". The current approach seems to do simple substring containment.

**Suggestions:**
- Add word-boundary matching by default (match "star" only as a whole word)
- Add a `fuzzy` parameter to control matching strictness: `"exact"`, `"word"` (default), `"substring"` (current behavior)
- Boost exact matches over partial matches in result ordering
- Consider adding a relevance score to results

### 4. Fix false modal detection (LOW-MEDIUM IMPACT)

**Rationale:** The `context.modal` field should only be populated when an actual modal/dialog element is present with `role="dialog"` or similar. GitHub's search input placeholder text is not a modal.

### 5. Add name truncation to snapshotSearch results (MEDIUM IMPACT)

**Rationale:** When a snapshotSearch match has a 1500-character name, the result payload is enormous. The agent only needs enough of the name to confirm it's the right element.

**Suggestion:** Truncate match names to ~200 characters in snapshotSearch results.

### 6. Consider a "navigation settled" wait mode (MEDIUM IMPACT)

**Rationale:** For SPAs, "network idle" doesn't mean navigation is complete. GitHub may have no pending requests while Turbo is still updating the DOM.

**Suggestion:** Add a `waitAfter: {urlChange: true}` option that waits specifically for URL changes via `pushState`/`popstate`, with a configurable timeout.

---

## Roundtrip Analysis

**Task: "Find the star count for facebook/react"**
- Ideal: 1 roundtrip (openTab + snapshotSearch for "stars")
- Actual: 1 roundtrip -- snapshotSearch for "243k stars" would work IF fuzzy matching didn't prioritize noise. With exact search it takes 1 roundtrip.
- **Verdict: OK but fragile**

**Task: "Navigate to the Issues tab and find the New Issue button"**
- Ideal: 2 roundtrips (click Issues tab, snapshotSearch for New Issue)
- Actual: 3 roundtrips (click Issues tab, wait 2-3s for SPA navigation, snapshotSearch)
- **Verdict: Extra roundtrip due to SPA detection gap**

**Task: "Open the first PR and check its title"**
- Ideal: 3 roundtrips (click PR tab, click first PR, read title)
- Actual: 5 roundtrips (click PR tab, wait, snapshotSearch for PR links, click PR, wait for SPA nav)
- **Verdict: 40% overhead from SPA navigation waits**

---

## Votes (from VOTING.md issues)

### Existing Issues I'd Vote For

| Issue | Reason | Extra Votes |
|-------|--------|-------------|
| 6.5 Refs stale between snapshot/click | Confirmed: refs from content areas break after SPA re-renders (though nav refs persist) | +1 |
| 8.1 Network quiet detection | GitHub's Turbo navigation makes network idle unreliable for detecting "page ready" state | +1 |
| 4.4 Keyboard shortcuts w/ modifiers | GitHub's Cmd+K command palette likely affected by this | +1 |

### New Issues to Add

#### N1. SPA client-side navigation not detected by diff system
`[votes: 1]` `[priority: P0]`

**Symptoms:**
- Click on GitHub tab (Issues, PRs, Code) reports `navigated: false`
- URL changes via `history.pushState` after click resolves
- `changes` field is always `undefined` after SPA transitions
- `waitAfter: true` and `waitAfter: {networkidle: true}` don't help
- Agent must add explicit `wait` steps after every link click on SPAs

**Expected:** System should detect `pushState`/`replaceState` URL changes and report them as navigation events with proper diffs.

**Impact:** HIGH -- affects every SPA (GitHub, Next.js, Nuxt, React Router, Vue Router, etc.)

#### N2. Accessible names not truncated, causing massive snapshot bloat
`[votes: 1]` `[priority: P1]`

**Symptoms:**
- GitHub commit message links have 500-2000 character accessible names
- Full snapshot: 57KB (should be ~8KB with truncation)
- Interactive snapshot: 55KB
- Viewport-only snapshot: 19KB
- snapshotSearch results include full names, making each match 1-2KB

**Expected:** Names should be truncated to ~150 characters by default, with a `maxNameLength` option.

**Impact:** HIGH -- would reduce snapshot sizes by 5-10x on content-heavy pages

#### N3. snapshotSearch fuzzy matching too aggressive
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- Search for "star" matches "start", "started", etc.
- Search for "Issues" matches commit messages containing the word "issues"
- No word-boundary awareness
- No relevance scoring -- commit message links rank equally with navigation links

**Expected:** Default matching should use word boundaries. Add `fuzzy` parameter for control.

#### N4. False modal detection from input placeholders
`[votes: 1]` `[priority: P2]`

**Symptoms:**
- `context.modal` reports `"Search code, repositories, users, issues, pull requests..."` on every GitHub page
- This is the search input's placeholder/aria-label, not an actual modal
- Misleads agents into thinking a dialog is blocking interaction

**Expected:** `context.modal` should only be populated when a `role="dialog"` or `role="alertdialog"` element is present and visible.

---

## Summary

The CDP snapshot system provides a solid foundation for browser automation. The accessibility tree approach, ref system, and snapshotSearch are architecturally sound. However, when applied to a large, dynamic SPA like GitHub, three issues dominate:

1. **SPA navigation blindness** -- the system cannot detect client-side routing, making every SPA click require an extra roundtrip for explicit waiting
2. **Name bloat** -- unbounded accessible names from content-heavy pages inflate snapshots 5-10x beyond useful size
3. **Fuzzy search noise** -- substring matching without word boundaries makes snapshotSearch unreliable on pages with verbose content

Fixing these three issues would dramatically improve the agent experience on real-world SPAs.
