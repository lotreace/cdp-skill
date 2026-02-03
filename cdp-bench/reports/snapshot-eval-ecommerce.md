# Snapshot Evaluation: Amazon.com (Large Ecommerce Site)

**Date:** 2026-02-03
**Evaluator:** Claude Opus 4.5 (automated critical eval)
**Target:** amazon.com homepage + search results page
**CDP Skill Version:** 1.0.5

---

## Test Results

### 1. chromeStatus

**Result:** PASS. Chrome detected instantly, returned version info and tab list. No issues.

### 2. openTab + goto amazon.com (auto-snapshot)

**Result:** PASS with observations.

- Navigation completed. Auto-snapshot returned inline viewport snapshot (within 9KB limit).
- The viewport snapshot was clean and well-structured: nav bar, search box, main content cards, footer headings.
- An `alertdialog "International Shopping Transition Alert"` appeared (geo-detection modal). It was correctly represented in the snapshot with two buttons (`s1e13`, `s1e14`), but the **buttons have no accessible name** -- they show as `button [ref=s1e13]` with no label. An agent would not know which one to click (e.g., "Stay on Amazon.com" vs "Go to local site"). This is not a cdp-skill bug -- it is Amazon's poor accessibility -- but the skill could surface button text via `innerText` fallback when ARIA name is empty.
- `context.modal: "Dialog"` was correctly reported, alerting the agent to the modal presence.
- The full snapshot file was 9.2KB / 225 lines -- manageable for the homepage.

**Signal-to-noise:** Good. The viewport snapshot contained ~31 interactive refs across nav, search, and content sections. About 5 lines were "Shortcuts menu" accessibility helpers (skip links, keyboard shortcuts) which are noise for an automation agent.

### 3. Full snapshot (homepage)

**Result:** 9,203 bytes, 225 lines. This is surprisingly compact for Amazon.

**Content breakdown:**
- Lines 1-21: Skip links, keyboard shortcuts navigation (NOISE for agents, ~10%)
- Lines 22-37: Header nav bar, search, account, cart (USEFUL, ~7%)
- Lines 39-68: Main content cards -- hero carousel, product categories (USEFUL, ~13%)
- Lines 69-130: Footer -- "Get to Know Us", "Make Money with Us", etc. (NOISE, ~27%)
- Lines 131-225: "More on Amazon" mega-footer with 25+ subsidiary links (NOISE, ~42%)

**Verdict:** Roughly 50-55% of the full homepage snapshot is footer content that is irrelevant to virtually all automation tasks. The footer alone contains 52 interactive elements (out of 92 total), meaning **57% of interactive refs are footer noise**.

### 4. Interactive detail level

**Result:** Returned all 92 interactive elements with path context. The YAML was large enough to be routed to file (over 9KB with the refs JSON included).

**Observations:**
- The `path=` annotations are helpful (e.g., `path=banner > navigation > search`).
- Footer links still dominate. 56 of 92 interactive elements are in the footer.
- No structural grouping makes it hard to scan -- all elements are flat with only path context.
- The interactive level does NOT filter out keyboard shortcut/skip links -- these are interactive but useless for automation.

**Verdict:** Interactive detail level is not much more useful than full for this page because the page has little non-interactive noise. The real noise is in the footer interactives.

### 5. Summary detail level

**Result:** Excellent. 808 bytes. Clean landmark overview with interactive counts.

```yaml
landmarks:
  - role: navigation, name: "Shortcuts menu", interactiveCount: 6
  - role: banner, interactiveCount: 14
  - role: search, interactiveCount: 3
  - role: main, interactiveCount: 11
  - role: complementary, name: "Your recently viewed items...", interactiveCount: 0
  - role: navigation, name: "More on Amazon", interactiveCount: 26
```

**Verdict:** Summary gives clear orientation. An agent immediately knows: search is in banner (3 elements), main content has 11 interactives, and "More on Amazon" footer has 26 (can be ignored). This is the right first step for page discovery on large pages.

### 6. snapshotSearch

**Search box** (`text: "Search", role: "searchbox"`): 1 match, exact hit with ref `s1e4`. Path: `banner > navigation > search`. PASS.

**Cart** (`text: "cart", role: "link"`): 2 matches -- keyboard shortcut link + actual cart link `s1e12`. Acceptable, agent can distinguish via path context. PASS.

**Electronics category** (`text: "Electronics"`): 0 matches. The category navigation is hidden behind the hamburger menu (`"Open All Categories Menu" [collapsed]`). The snapshot correctly reflects only visible/accessible elements, but this means agents cannot search for categories without first expanding the menu. This is correct behavior, not a bug.

**Verdict:** snapshotSearch is precise and fast. The combination of text + role filtering is effective. Results include path context and refs, enabling immediate action.

### 7. Search + fill workflow

**Roundtrip count: 2** (one chromeStatus, one fill+press)

The workflow was:
1. `openTab` to amazon.com (got snapshot with search ref `s1e4`)
2. `fill ref=s1e4` + `press Enter` in a single CLI call

This is impressively efficient. The auto-snapshot from `openTab` already provided the search box ref, so no separate snapshot call was needed. The fill+press combined in one step prevented an extra roundtrip.

**Verdict:** Minimum possible roundtrips for this workflow. The system works well.

### 8. Product listing page (search results)

**Full snapshot:** 38,009 bytes, 797 lines, 315 interactive elements.

**Content breakdown (approximate):**
- Lines 1-37: Skip links + header nav (NOISE+USEFUL, ~5%)
- Lines 38-41: Results count heading + sort (USEFUL, ~1%)
- Lines 42-247: Product listings -- 16 products (USEFUL, ~26%)
- Lines 248-261: Related searches (USEFUL, ~2%)
- Lines 262-276: Pagination (USEFUL, ~2%)
- Lines 277-280: Help links (MARGINAL)
- Lines 281-680: Filter sidebar -- 25+ filter groups (NOISE for most tasks, ~50%)
- Lines 681-797: Footer (NOISE, ~15%)

**Critical finding: PRICES ARE MISSING.** The accessibility snapshot contains product names, ratings, and "See options" links, but no price information. On this Amazon page, products show "See options" instead of inline prices (possibly due to geo/international context). This means an agent trying to "find the cheapest headphones" cannot do so from the snapshot alone -- it would need to click into each product page.

**Product card structure (per product):**
```
- listitem:
  - link "[full product name]" [ref=...]
    - heading "[full product name]" [level=2]
  - button "4.5 out of 5 stars, rating details" [ref=...]
  - link "93,100 ratings" [ref=...]
  - link "See options" [ref=...]
  - link "(5 used & new offers)" [ref=...]
  - group "colors available": list of empty listitems
```

Product names are duplicated in both the link and its child heading -- wastes tokens. Color swatches show as empty listitems with no names. The "See options" link is actually the "Add to Cart"/"View" action.

### 9. Snapshot size comparison (search results page)

| Detail Level | Size | Lines | Interactive Refs |
|-------------|------|-------|-----------------|
| Full | 38,009 bytes | 797 | 315 |
| Interactive | >9,000 bytes (file-routed) | ~315 | 315 |
| ViewportOnly | 8,331 bytes | 194 | ~40 viewport |
| Summary | 808 bytes | 21 | 0 (counts only) |

**Overhead ratios:**
- Full-to-ViewportOnly: 4.6x overhead (full is 4.6x larger)
- Full-to-Summary: 47x overhead
- ViewportOnly sits right at the 9KB inline limit, barely fitting inline

**Observations:**
- The 9KB inline limit is well-calibrated for the viewport-only snapshot. It fits the visible portion of most pages.
- The full snapshot at 38KB would consume significant agent context. For a task like "click the first product", only the viewport is needed.
- The sidebar filters account for ~50% of the full snapshot but are rarely needed for product interaction tasks.
- **Interactive detail level provides zero benefit on search results** because Amazon marks nearly everything as interactive (links, buttons). It just removes the tree structure.

### 10. Cookie/modal handling

**International Shopping Alert:** Correctly detected as `alertdialog "International Shopping Transition Alert"` with `context.modal: "Dialog"`. Two buttons are present but have **no accessible names**. An agent would need to use `eval` or coordinate-based clicking to dismiss, or try both buttons.

**No cookie consent banner appeared** on this session (likely due to existing cookies or US-based Chrome instance).

**Dialog on search results page:** A `dialog` element appeared in the nav bar area with no name, no children, and no ref. This appears to be an empty/hidden dialog container in Amazon's DOM that the snapshot picked up. It is noise.

---

## What Worked Well

1. **Auto-snapshot on navigation is excellent.** The `openTab` response included enough information (viewport snapshot + full snapshot file path) to immediately act on the page. Zero extra roundtrips needed.

2. **snapshotSearch is precise.** Searching for "Search" + role "searchbox" returned exactly 1 match with a usable ref. This is the ideal workflow: search, get ref, act.

3. **Summary detail level is highly useful for large pages.** At 808 bytes vs 38KB (47x reduction), summary gives an agent exactly what it needs to decide its next move on a complex page.

4. **Fill + press in one CLI call** is the right pattern. The 2-roundtrip search workflow is hard to beat.

5. **Viewport snapshot stays within inline limit.** For Amazon search results, the viewport snapshot (8.3KB) just barely fits inline, giving the agent immediate context without reading a file.

6. **Product listings are identifiable.** Each product is a `listitem` with a clear heading, rating, and action links. An agent can reliably click the first product result.

7. **Filter sidebar is well-structured.** Brands, Noise Control, Wireless Technology -- all properly grouped with clear names. If an agent needs to filter by "Sony", it can `snapshotSearch` for "Apply Sony filter" and click.

---

## What Was Problematic

### P0: Prices missing from snapshot

Product prices are completely absent from the accessibility tree on Amazon search results. This is partly Amazon's fault (prices rendered via `aria-hidden` spans or CSS tricks), but it means the snapshot alone is insufficient for price-comparison tasks. An agent would need `eval` or `extract` to get prices, adding roundtrips.

**Impact:** Any ecommerce task involving price comparison requires workarounds.

### P1: Footer noise dominates full snapshots

On the homepage, 57% of interactive elements (52/92) are in the footer. On search results, the footer + filter sidebar account for ~65% of the full snapshot. This wastes agent context tokens on content that is irrelevant to 95% of tasks.

**Impact:** Agents reading full snapshots burn context on footer links to Amazon Music, AbeBooks, PillPack, etc.

### P1: Unnamed buttons in modals

The international shopping alert dialog has two buttons with no accessible names. The snapshot shows `button [ref=s1e13]` and `button [ref=s1e14]` with no indication of what they do. An agent would need a screenshot or `eval` to determine which button dismisses the modal.

**Impact:** Modal dismissal requires extra roundtrips. Common on many sites with poor accessibility.

### P2: Product name duplication

Each product listing duplicates the full name in both the `link` element and its child `heading`. For long Amazon product names (150+ chars), this doubles the token cost per product.

**Impact:** 16 products x ~150 chars extra = ~2400 wasted characters in the search results snapshot.

### P2: Empty color swatches

Color option listitems render as empty `listitem` elements with no names:
```
- group "colors available":
  - list:
    - listitem
    - listitem
    - listitem
```

No information about what colors are available. An agent cannot select a specific color from the snapshot.

### P2: HTML leaking into snapshot

The results count heading contains raw HTML:
```
heading "1-16 of over 1,000 results... <span class=\"a-button a-button-base\">..."
```

HTML markup is leaking into the accessible name. This is messy and wastes tokens.

### P3: Keyboard shortcut links are noise

The "Shortcuts menu" navigation (skip links, keyboard shortcuts) appears in every snapshot. These 6-8 elements are useful for screen reader users but useless for automation agents.

### P3: Empty dialog containers

Amazon's DOM contains `dialog` elements that are empty containers (no name, no children, no ref). These are noise in the snapshot.

### P3: Inconsistent viewportElements count

The summary reported `viewportElements: 0` even though the viewport clearly contains many elements. This appears to be a bug in the viewport element counting logic when dealing with Amazon's layout.

---

## Specific Improvement Suggestions

### 1. Footer exclusion option (HIGH IMPACT)

Add a parameter like `excludeFooter: true` or `exclude: ["complementary", "contentinfo"]` to strip footer content from snapshots. On Amazon, this would cut the full snapshot by 40-65%.

**Rationale:** Footers are structural chrome, not task-relevant content. On every page, the footer is the same. Agents never need it.

### 2. Button text fallback when ARIA name is empty (HIGH IMPACT)

When a button has no accessible name, fall back to `innerText`, `value` attribute, or child text content. This would make the international shopping dialog buttons actionable from the snapshot.

**Rationale:** Many real-world sites have buttons with no ARIA labels. The snapshot should surface whatever text exists.

### 3. Dedup child heading from parent link name (MEDIUM IMPACT)

When a `link` contains a `heading` with the same name, omit the heading text or mark it as `[same as parent]`. This would save ~2400 chars on the Amazon search results page.

**Rationale:** The duplication is pure waste. The link name already contains the full product title.

### 4. Price extraction hint in ecommerce contexts (MEDIUM IMPACT)

When the snapshot detects a list of product cards but no price information, include a hint like:
```yaml
# Note: Prices not in accessibility tree. Use extract or eval for pricing data.
```

**Rationale:** Saves agents from fruitlessly searching for prices in the snapshot and immediately directs them to the right tool.

### 5. Strip raw HTML from accessible names (LOW-MEDIUM IMPACT)

The snapshot script should strip HTML tags from `accessibleName` values. The results heading with embedded `<span>` tags is a rendering artifact.

### 6. Named landmark exclusion (LOW IMPACT)

Allow excluding specific named landmarks: `exclude: ["Shortcuts menu", "More on Amazon"]`. This would strip the skip-to links and the mega-footer subsidiary listing.

---

## Roundtrip Analysis: "Search for a Product and Check Its Price"

**Optimal flow with current system:**
1. `chromeStatus` -- ensure Chrome is running (1 roundtrip)
2. `openTab "https://amazon.com"` -- get homepage with auto-snapshot (1 roundtrip)
3. `fill ref=s1e4 "headphones" + press Enter` -- search and navigate (1 roundtrip)
4. Read viewport snapshot from step 3 response -- identify first product link
5. `click ref=s3e15` -- click first product (1 roundtrip)
6. Read viewport snapshot -- look for price... but price may not be in snapshot
7. `eval "document.querySelector('.a-price .a-offscreen')?.textContent"` -- extract price (1 roundtrip)

**Total: 5 roundtrips** (could be 4 if chromeStatus is cached).
**Ideal: 3-4 roundtrips** if prices were in the snapshot (steps 6-7 could be eliminated).

---

## 9KB Inline Limit Assessment

The 9KB limit is well-calibrated for viewport-only snapshots:
- Amazon homepage viewport: ~2.5KB (fits easily)
- Amazon search results viewport: 8.3KB (barely fits)
- Amazon full page: 38KB (correctly routed to file)

**Recommendation:** The limit is appropriate. On content-heavy pages like Amazon search results, the viewport snapshot just barely fits, which is the right trade-off. Increasing to 12KB would handle slightly larger pages without requiring file reads. Decreasing below 8KB would force too many file reads on common pages.

---

## Votes for VOTING.md Issues

### Existing issues I'd vote for:

| Issue | Reason |
|-------|--------|
| **6.5** Refs stale between snapshot/click (+1) | On Amazon's dynamic DOM, refs could easily go stale between snapshot and click as products lazy-load |
| **8.1** Network quiet detection (+1) | Amazon loads content asynchronously; snapshotting before network settles could miss products |
| **8.6** Frame-scoped snapshots (+1) | Would allow snapshotting only the product grid, skipping header/footer/sidebar |

### New issues I'd add:

**NEW: Footer/boilerplate exclusion from snapshots**
`[votes: 1]` `[priority: P1]`

On ecommerce sites, 40-65% of full snapshot content is footer, subsidiary links, and structural chrome that is identical across pages and irrelevant to tasks. Add an option to exclude named landmarks or roles from snapshots (e.g., `exclude: ["contentinfo"]` or `excludeFooter: true`).

**NEW: Fallback text for unnamed interactive elements**
`[votes: 1]` `[priority: P1]`

Buttons and links with no ARIA accessible name show as `button [ref=s1e13]` with no indication of function. Fall back to `innerText`, `value`, `title`, or `aria-label` attributes. Critical for modal dismissal on sites with poor accessibility.

**NEW: HTML tag stripping in accessible names**
`[votes: 1]` `[priority: P2]`

Raw HTML (e.g., `<span class="a-button">`) sometimes leaks into accessible names in the snapshot. Strip HTML tags from names to keep output clean.

**NEW: Dedup identical child text from parent elements**
`[votes: 1]` `[priority: P3]`

When a link contains a heading with the same text, the full product name appears twice in the snapshot, wasting tokens. Suppress or abbreviate the duplicate.

**NEW: viewportElements count reports 0 incorrectly**
`[votes: 1]` `[priority: P2]`

Summary detail level reported `viewportElements: 0` on Amazon pages despite clearly having visible elements in the viewport. The viewport element counting logic may have a bug.

---

## Summary

The CDP snapshot system handles Amazon.com surprisingly well for a site of its complexity. The auto-snapshot workflow, snapshotSearch precision, and summary detail level are standout features. The main issues are:

1. **Footer noise** is the biggest practical problem -- it wastes 40-65% of snapshot content on irrelevant elements.
2. **Missing price data** is an inherent limitation of the accessibility tree on ecommerce sites, not a bug, but agents need guidance.
3. **Unnamed buttons** in modals are a real obstacle for automation.
4. **The 9KB inline limit** is well-calibrated and should not change significantly.
5. **Roundtrip efficiency** is already excellent for search workflows (2 roundtrips for search + navigate).
