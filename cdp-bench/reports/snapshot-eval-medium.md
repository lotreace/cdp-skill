# Snapshot Evaluation: Medium Complexity (Wikipedia Article)

**Test target:** `en.wikipedia.org/wiki/Web_browser`
**Date:** 2026-02-03
**Evaluator:** Claude Opus 4.5 (automated critical eval)

---

## Test Results

### 1. chromeStatus

**Result:** Passed. Chrome was already running with CDP enabled. Response was instant and included the full tab list (38 tabs visible). No issues.

**Observation:** The tab list in chromeStatus output is enormous when many tabs are open. For an agent that just wants to confirm Chrome is alive, the full tab listing is noise. Consider a `brief: true` option or truncating the list.

---

### 2. openTab + goto (auto-snapshot)

**Result:** Passed. Tab `t757` created, navigated to the article.

**Viewport snapshot:** 5,804 bytes inline. Breakdown of what it contained:
- Wikipedia site banner (logo, search, personal tools, appearance button, donate/login links) -- ~40% of the snapshot
- A promotional banner ("Wiki Loves Folklore") with images -- ~15% of the snapshot
- Navigation chrome (Namespaces, Views, Page tools) -- ~10% of the snapshot
- **Actual article content** (heading, intro paragraph, first links) -- ~35% of the snapshot

**Signal-to-noise ratio: ~35%.** On a content-heavy page like Wikipedia, over half the viewport snapshot is consumed by site chrome that an agent rarely needs. The promotional banner alone takes up significant space with a very long accessible name.

**Issue:** The link `"You are encouraged to create an account and log in; however, it is not mandatory"` is a 90-character accessible name for a simple "Create account" link. Wikipedia's verbose ARIA labels inflate the snapshot.

---

### 3. Full Snapshot

**Result:** File-routed correctly. The 9KB inline limit triggered.

| Metric | Value |
|--------|-------|
| Full snapshot file size | 29,756 bytes (~30KB) |
| Full snapshot line count | 445 lines |
| Total elements | 831 |
| Interactive elements | 446 |
| File path | `/tmp/cdp-skill/t757.snapshot.yaml` |

**Analysis:** The full snapshot is 3.3x the inline limit, so file routing was correct. The file path is usable -- an agent can read it with the Read tool. However, 30KB of YAML is a lot of context to consume. An agent reading the full file to find a specific element wastes tokens on hundreds of irrelevant links (footnotes, navigation, footer, etc.).

**Key concern:** 446 interactive elements on a Wikipedia article is dominated by inline citation links (`[1]`, `[2]`, etc.) and internal wiki links. The ratio of "actionable for an agent's task" to "total interactive elements" is likely under 10% for most use cases.

---

### 4. Interactive Detail Level

**Result:** File-routed at 29,750 bytes. The interactive-only snapshot is nearly the same size as the full snapshot (29,733 vs 33,973 bytes).

**Why it's barely smaller:** Wikipedia articles are link-dense. The article body is mostly links (every internal wiki reference is a link). So filtering to "interactive only" on Wikipedia removes very little -- mainly static text nodes and structural containers.

**Content breakdown (435 links, 11 buttons, 0 headings, 0 images):**
- Site chrome links: ~20 (banner, footer, namespaces, etc.)
- Article body links: ~350+ (internal wiki links, citation footnotes)
- Navigation box links: ~50 (sidebar navboxes)
- Footer links: ~15

**Problem:** The interactive snapshot loses ALL headings (because headings are not interactive). This means an agent cannot orient itself by section. The `path` context shows `main > paragraph` for almost every link, which is not enough to distinguish "which section am I in?"

**Verdict:** Interactive detail level is almost useless on content-heavy pages like Wikipedia. It's the worst of both worlds -- too big to inline, but missing the structural context (headings) needed to navigate.

---

### 5. Summary Detail Level

**Result:** Inlined at 1,557 bytes. This is compact and useful.

**Content:**
```
Total elements: 831
Interactive elements: 446
Viewport elements: 0

Landmarks: banner, navigation (Site, Personal tools, Appearance, Contents,
           Namespaces, Views, Page tools, Portals, Web browsers,
           Timeline of web browsers, Authority control databases),
           main, contentinfo
```

**What works:** Gives a good high-level orientation. You can see the page has navboxes ("Web browsers", "Timeline of web browsers") and a footer. The interactive count (446) correctly signals this is a link-dense page.

**Problem:** `Viewport elements: 0` is surprising and likely wrong -- there are clearly elements in the viewport. This may be a bug in viewport detection at the summary level.

**Missing:** No section headings are listed. For a content page, knowing the article sections (Function, History, Features, Browser market, Security, Privacy, See also, References, External links) would be far more valuable than knowing landmark roles.

---

### 6. snapshotSearch

**Results by query:**

| Query | Matches | Quality |
|-------|---------|---------|
| `text:"History", role:heading` | 1 | Found "History" heading, but **ref=None** |
| `text:"Google Chrome", role:link` | 3 | All found with valid refs |
| `text:"table of contents"` | 1 | Found button with valid ref |
| `role:heading` (all) | 11 | All 11 section headings found, **ALL ref=None** |
| `role:navigation` | 11 | All landmarks found, all ref=None (expected) |
| `text:"Security", role:link` | 2 | Found relevant links with refs |
| `text:"[1]", role:link` | 1 | Found footnote link with ref |
| `pattern:"^(See also\|References\|External)", role:heading` | 3 | Regex works, but **all ref=None** |
| `pattern:"^\\[\\d+\\]$", role:link` | 0 | **Failed** -- regex escaping issue? |
| `text:"Features"` (no role filter) | 5 | Mixed results: heading + staticText fragments |

**What works well:**
- Text search with role filter is effective for finding specific links
- Fuzzy matching works (partial matches found)
- Path context helps distinguish matches
- Regex patterns work for headings
- Fast: searches 831 elements and returns quickly

**Critical problem: Headings have no refs.** Every heading search returns `ref=None`. This means an agent cannot click to navigate to a section heading using snapshotSearch. Since headings are not "interactive" elements in the accessibility tree, they don't get refs. But on Wikipedia, section headings are critical navigation targets -- they have anchor IDs and are the primary way to navigate long articles.

**Regex escaping issue:** The pattern `^\[\d+\]$` returned 0 matches for footnote links like `[1]`, `[35]`, etc. This may be a regex escaping issue in the JSON -> JS chain, or the accessible names may not include the brackets.

---

### 7. Click a Link / Navigate

**Test 1: Click ref s2e97 ("History of the web browser" link)**
- Result: Navigated to `/wiki/History_of_the_web_browser` -- correct.
- Method was not reported (possibly jsClick-auto).

**Test 2: Click by text "History"**
- Result: **Unintended navigation.** Clicked the "Past revisions of this page" link (which contains "history" in its accessible name) and navigated to `?action=history` (the revision history page, not the article section).
- Then got `"CDP error: Cannot find context with specified id"` errors because the execution context was invalidated by the navigation.
- This demonstrates a significant problem with text-based clicking: ambiguous text matches the wrong element when multiple elements contain the same word.

**Test 3: Click ref s1e38 ("Google Chrome" link)**
- Result: Navigated to `/wiki/Google_Chrome` -- correct, clean.

**Test 4: Click "Browser security" ref s2e227**
- Result: Navigated to `/wiki/Browser_security` -- correct.
- Method: `jsClick-auto` (CDP click failed, auto-fallback succeeded).

**Verdict:** Ref-based clicks are reliable. Text-based clicks are dangerous on content-heavy pages due to ambiguity. The "Cannot find context" error after navigation-inducing text clicks is confusing -- it should be caught and reported as "navigation occurred, context was reset."

---

### 8. Scroll + Snapshot / Cache Detection

**Scroll test:**
- Scrolled down with `deltaY: 1500` from scroll position y=892 to y=2392 (47%).
- Viewport snapshot after scroll: 4,697 bytes, showing content from the "Browser market" section area.
- Snapshot correctly reflects new viewport content.

**Cache test:**
- `{"snapshot": {"since": "s16"}}` returned `{"unchanged": true, "snapshotId": "s46"}` with `"Page unchanged since s16"`.
- Cache detection works correctly -- same URL + same scroll position = unchanged.
- Note: The snapshotId jumped from s16 to s46, indicating many intermediate snapshots were taken (auto-snapshots from other actions). This is expected but means snapshot IDs are not contiguous from the agent's perspective.

**Observation:** After `back` navigation, the page restores to scroll position y=892 (17%) rather than y=0. This is correct browser behavior (bfcache restoring scroll position), and the system accurately reports it.

---

### 9. Viewport-Only vs Full Snapshot Comparison

| Metric | Viewport-Only | Full |
|--------|--------------|------|
| Size | 4,697 bytes | 33,886 bytes |
| Inline? | Yes | No (file-routed) |
| Ratio | 1x | 7.2x larger |

**Analysis:** Viewport-only snapshots are ~7x smaller than full snapshots on this page. They fit comfortably under the 9KB inline limit. This is the right default for auto-snapshots after actions.

**However:** The viewport snapshot still includes the site banner and navigation chrome every time (they're always in the viewport). On Wikipedia, this means ~60-65% of every viewport snapshot is the same site chrome repeated. An agent doing 5 actions gets the same banner 5 times.

---

### 10. Multi-Roundtrip Workflow

**Scenario:** Find the "Browser security" section, navigate to it, verify arrival.

| Roundtrip | Action | Purpose |
|-----------|--------|---------|
| 1 | `snapshotSearch` | Find "Security" links -- found 2 matches |
| 2 | `click` ref | Navigate to Browser security article |
| Total | **2 roundtrips** | |

**This is optimal.** snapshotSearch + click is the ideal 2-roundtrip pattern. Without snapshotSearch, the workflow would be: (1) full snapshot, (2) read file, (3) find element, (4) click -- 3+ roundtrips plus a large file read.

**Alternative scenario (failed): Find "History" section heading and scroll to it.**
This would require: (1) snapshotSearch for heading -- gets ref=None, (2) no ref to click, (3) must use text-based click (unreliable) or scroll manually. This is a broken workflow for section navigation on Wikipedia.

---

## What Worked Well

1. **File routing for large snapshots.** The 9KB limit correctly triggers on Wikipedia's 30KB+ snapshots, preventing massive inline responses.

2. **snapshotSearch for links.** Finding specific links by text + role filter is fast and accurate. The path context helps disambiguate.

3. **Ref-based clicking.** Reliable across navigations. The ref persistence between snapshot operations works.

4. **Cache detection (since parameter).** Correctly identifies unchanged pages, saving unnecessary re-snapshots.

5. **Viewport-only snapshots.** Good size at ~5KB inline, appropriate for post-action context.

6. **Summary detail level.** Extremely compact (1.5KB) and gives useful landmark overview.

7. **Auto-snapshot diffs on actions.** The viewport snapshot after clicks/navigation gives immediate context without manual snapshot requests.

---

## What Was Problematic

### P0: Headings have no refs (blocks section navigation)

ALL 11 section headings on the Wikipedia article return `ref=None` in snapshotSearch. Headings are not "interactive" elements, so they don't get refs. But section headings are the primary navigation target on content pages. An agent cannot:
- Click to scroll to a heading
- Use a heading ref to orient a scoped snapshot
- Navigate the article's structure programmatically

**Impact:** Forces agents to use text-based clicking (ambiguous and unreliable) or manual scrolling with viewport snapshots to find sections.

### P1: Interactive detail level is nearly useless on link-dense pages

At 29,750 bytes (vs 33,973 for full), the interactive snapshot saves only 12% on Wikipedia. It removes headings (needed for orientation) while keeping hundreds of irrelevant citation links. Worst of both worlds.

### P1: Text-based click ambiguity causes silent wrong-target clicks

Clicking `{"text": "History"}` matched the "Past revisions" navigation link instead of the article section heading. No disambiguation warning was given. The subsequent "Cannot find context" error was confusing and didn't indicate that a navigation had occurred.

### P2: Viewport snapshot has low signal-to-noise from repeated site chrome

~60-65% of every viewport snapshot is Wikipedia's banner, navigation bars, and promotional banner. On a 5-action workflow, the agent processes the same banner content 5 times.

### P2: Summary detail level reports "Viewport elements: 0"

This is clearly wrong -- the viewport has content. Likely a bug in how viewport elements are counted at the summary detail level.

### P2: snapshotSearch regex escaping for brackets

The pattern `^\[\d+\]$` returned 0 matches for footnote links like `[1]`. Either the escaping chain (JSON -> JS regex) drops the backslashes, or the accessible names differ from expected.

### P3: chromeStatus returns enormous tab lists

With 38 tabs, the chromeStatus response is bloated with tab details the agent doesn't need.

---

## Specific Improvement Suggestions

### 1. Assign refs to headings (or add a heading-click mechanism)

Headings are not interactive but they ARE navigation targets. Options:
- Assign refs to headings even though they're non-interactive (preferred -- simple, consistent)
- Add a `scrollToHeading` step that takes heading text
- Make snapshotSearch return a `selector` field alongside `ref` so agents can use CSS selectors for non-interactive elements

**Rationale:** On content-heavy pages, section navigation is the #1 task. Without heading refs, agents cannot efficiently navigate articles.

### 2. Add "exclude chrome" or "content only" snapshot mode

A snapshot mode that excludes site-level navigation (banner, contentinfo, repeated navbars) and focuses on `role=main` content. This could be:
- `{"snapshot": {"root": "role=main"}}` -- already supported! But agents need to know to use it.
- Auto-detection: if `role=main` exists, default viewport snapshots to main-only content.

**Rationale:** Would increase signal-to-noise from ~35% to ~90% on most content pages.

### 3. Add a "structured" interactive snapshot with section grouping

Instead of a flat list of 435 links, group interactive elements by their containing section heading:

```yaml
sections:
  - heading: "Web browser" [level=1]
    interactive: 15
    links: [Application software, Website, ...]
  - heading: "Function" [level=2]
    interactive: 23
    links: [URL, Address bar, ...]
  - heading: "History" [level=2]
    interactive: 8
    ...
```

**Rationale:** This would make the interactive snapshot actually useful on content pages by providing orientation + actionable refs in a compact format.

### 4. Improve snapshotSearch to return selectors for ref=None matches

When a match has no ref (headings, landmarks), return a CSS selector or XPath so the agent can still target the element:

```json
{"matches": [{"role": "heading", "name": "History", "ref": null, "selector": "#History"}]}
```

**Rationale:** Wikipedia headings have `id` attributes. Even without refs, a selector would enable targeting.

### 5. Add "cite-free" or "no-footnotes" filtering for article pages

A filter to exclude citation links (`[1]`, `[2]`, etc.) from snapshots, which are rarely the agent's target.

**Rationale:** On this article, footnote links make up ~20% of all interactive elements. Removing them would significantly reduce noise.

### 6. Detect and handle "wrong target" text clicks

When `click(text)` finds multiple matches, either:
- Return an error listing all matches (let agent disambiguate)
- Prefer the match closest to viewport center or with highest relevance

**Rationale:** The silent wrong-target click on "History" wasted an entire roundtrip and confused the context.

---

## Votes

### Existing issues I would vote for:

| Issue | Reason |
|-------|--------|
| **6.5** Refs stale between snapshot/click | Observed ref numbering inconsistencies across snapshots on same page |
| **8.5** Innermost text matching | "History" text click matched wrong element -- innermost matching would help |
| **8.6** Frame-scoped snapshots | `root: "role=main"` exists but a more focused snapshot would reduce noise significantly |
| **8.2** Lazy selector resolution | Would help with ref=None headings if selectors were returned as fallback |

### New issues to add:

**NEW: Headings and non-interactive elements have no refs in snapshotSearch**
`[votes: 1]` `[priority: P1]`
Section headings return `ref=None`, making section-based navigation impossible via refs. Agents must fall back to unreliable text-based clicking or manual scrolling.

**NEW: Interactive detail level nearly same size as full on link-dense pages**
`[votes: 1]` `[priority: P2]`
On Wikipedia (435 links), interactive mode saves only 12% vs full. It removes headings (needed for orientation) while keeping hundreds of low-value citation links. Consider section-grouped interactive format.

**NEW: Summary detail level reports "Viewport elements: 0" incorrectly**
`[votes: 1]` `[priority: P2]`
Summary snapshot shows `Viewport elements: 0` when elements are clearly visible in the viewport.

**NEW: Viewport snapshots include repeated site chrome on every action**
`[votes: 1]` `[priority: P2]`
~60-65% of each viewport snapshot is the same banner/navigation. On multi-action workflows, this wastes significant context tokens. Consider auto-scoping to `role=main` when it exists.

**NEW: Text-based click silently matches wrong element with no disambiguation**
`[votes: 1]` `[priority: P2]`
`click(text: "History")` matched a navigation link instead of the article heading. No warning about multiple matches. Should either return matches for disambiguation or prefer innermost/most-specific match.

---

## Summary

The snapshot system works well for **targeted operations** (snapshotSearch + ref-click is a clean 2-roundtrip pattern) but struggles with **content-heavy pages** where the signal-to-noise ratio is low. The biggest gap is the inability to target section headings (ref=None), which breaks the primary navigation pattern for articles. The interactive detail level needs rethinking for link-dense pages -- it's currently too big and too flat to be useful. The summary level is compact and valuable but has a viewport counting bug and lacks section heading information.

The 9KB inline limit and file routing work correctly. Viewport-only snapshots are well-sized. Cache detection is solid. The main improvements needed are around **reducing noise** (site chrome, footnotes, repeated elements) and **enabling section navigation** (heading refs or selectors).
