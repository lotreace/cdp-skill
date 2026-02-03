# Snapshot Fix Plan — Round 1

Results and implementation plan from the snapshot evaluation run (2026-02-03, 6 agents across HN, Wikipedia, GitHub, Amazon, Herokuapp, ECMAScript spec).

Full reports: `cdp-bench/reports/snapshot-eval-*.md`
Testing guide: `SNAPSHOT-TESTING.md`

---

## Findings Summary

### Universal (all 6 agents)

- `viewportSnapshot` is the correct default — small, fast, actionable
- `snapshotSearch` is the best element discovery tool
- Auto-snapshot on navigation saves a roundtrip every time
- Response payload size is the dominant problem, not roundtrip count

### By the numbers

| Site | Full snapshot | Viewport | Useful content % | Footer/chrome % |
|------|-------------|----------|-------------------|-----------------|
| Hacker News | 16KB | 12KB | ~35% | ~35% table noise |
| Wikipedia | 34KB | 5KB | ~35% | ~65% site chrome |
| GitHub | 57KB | 19KB | ~20% | commit msg bloat |
| Amazon (home) | 9KB | 3KB | ~43% | ~57% footer |
| Amazon (search) | 38KB | 8KB | ~26% | ~65% footer+sidebar |
| Herokuapp | 1-2KB | 1KB | ~90% | minimal |
| ECMAScript spec | 2,529KB | 3KB | viewport: ~40% | ~60% fixed TOC |

---

## P0 Fixes — Blocking

### Fix 1: Stop inlining refs map in snapshot responses

**Problem:** Every snapshot response includes a JSON map of `{refId: cssSelector}` for ALL refs. On HN (228 refs) this is ~20KB. On the ECMAScript spec (28,329 refs) it exceeds 1MB. Agents never use CSS selectors — they use ref IDs from the YAML. This doubles or triples response size for zero benefit.

**Evidence:** HN agent measured 32KB response for a 16KB snapshot. ECMAScript agent got a 1MB+ response for a 100-byte summary.

**Where:** `src/runner/execute-query.js` lines 59-79, 97

**Fix:** Remove refs from the inline JSON response entirely. The refs are already stored browser-side in `window.__ariaRefs` (aria.js line 1273). When an agent uses a ref like `s1e4` in a click, the click executor resolves it browser-side. The CSS selector map in the JSON is never consumed by agents.

```javascript
// execute-query.js — in executeSnapshot()
// BEFORE: always return refs
return { snapshotId, yaml, refs, ... };

// AFTER: never return refs inline — they're browser-side only
return { snapshotId, yaml, ... };
```

If backward compatibility is needed (it shouldn't be per CLAUDE.md), offer `includeRefs: true` as an opt-in parameter.

**Impact:** 50-70% reduction in response size across all snapshot operations. On ECMAScript spec, summary goes from 1MB+ to ~200 bytes.

---

### Fix 2: Assign refs to headings in snapshotSearch

**Problem:** `snapshotSearch` returns `ref=None` for all heading matches. On Wikipedia, ALL 11 section headings are unfindable-then-clickable. On the ECMAScript spec, the primary navigation targets (section headings) have no refs. This breaks the core `search → click` workflow on content pages.

**Evidence:** Wikipedia agent — 11/11 headings returned ref=None. ECMAScript agent — "Array.prototype.map" heading found but no ref to navigate to it.

**Where:** `src/aria.js` lines 910-932, 1033-1037 — `generateRef()` only assigns refs to elements where `isInteractable` is true.

**Fix:** In the snapshot search code path, also assign refs to headings. Headings are navigation targets even though they're not traditionally "interactive". Two options:

**Option A (preferred):** In `generateRef()`, expand the ref-eligible set to include headings:
```javascript
// aria.js — generateRef()
// BEFORE: only interactable
if (mode === 'ai' && visible && isInteractable) {
  node.ref = nextRef();
}

// AFTER: also headings
if (mode === 'ai' && visible && (isInteractable || role === 'heading')) {
  node.ref = nextRef();
}
```

This makes headings clickable via ref. The click executor would need to handle heading clicks by scrolling to them (headings typically have anchor IDs).

**Option B:** Return the element's CSS selector or anchor ID in snapshotSearch results when ref=None:
```javascript
// execute-query.js — searchNode match construction
match.selector = node.selector || `#${node.id}`;
match.anchor = node.id; // for hash navigation
```

Option A is simpler and keeps the ref-based workflow consistent. The click executor already handles scrolling to elements.

**Impact:** Unblocks section navigation on all content-heavy pages. Wikipedia, ECMAScript spec, and any documentation site become navigable.

---

### Fix 3: Detect SPA client-side navigation

**Problem:** Clicks on GitHub's Turbo links always report `navigated: false` because `history.pushState` URL changes happen asynchronously after the CDP click event resolves. The diff system never fires. Every SPA click requires an extra `wait` roundtrip.

**Evidence:** GitHub agent — every tab click (Issues, PRs, Code) reports navigated:false. Even `waitAfter: {networkidle: true}` doesn't help.

**Where:** `src/runner/step-executors.js` lines 408-426 (post-step snapshot logic), `src/runner/execute-interaction.js` (click execution)

**Fix:** Before executing a click, install a `pushState`/`replaceState` listener. After the click, poll briefly (200-500ms) for URL changes.

```javascript
// Before click: inject pushState monitor
await session.send('Runtime.evaluate', {
  expression: `
    window.__cdpNavDetected = false;
    window.__cdpNewUrl = null;
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = function(...args) {
      origPush(...args);
      window.__cdpNavDetected = true;
      window.__cdpNewUrl = location.href;
    };
    history.replaceState = function(...args) {
      origReplace(...args);
      window.__cdpNavDetected = true;
      window.__cdpNewUrl = location.href;
    };
    window.addEventListener('popstate', () => {
      window.__cdpNavDetected = true;
      window.__cdpNewUrl = location.href;
    });
  `
});

// After click: check for SPA navigation
await sleep(300);
const navCheck = await session.send('Runtime.evaluate', {
  expression: 'JSON.stringify({detected: window.__cdpNavDetected, url: window.__cdpNewUrl})',
  returnByValue: true
});
const nav = JSON.parse(navCheck.result.value);
if (nav.detected) {
  result.navigated = true;
  result.newUrl = nav.url;
  // Trigger diff with new page state
}
```

Also restore the original `pushState`/`replaceState` after detection to avoid leaking the monkey-patch.

**Impact:** Eliminates 1 extra roundtrip per SPA navigation. Fixes diff reporting on GitHub, Next.js, Nuxt, React Router, Vue Router, and all SPAs using History API.

---

## P1 Fixes — High Impact

### Fix 4: Fix "Viewport elements: 0" in summary mode

**Problem:** Summary detail level reports `Viewport elements: 0` on every tested site. This is a clear bug — elements are visible in the viewport.

**Evidence:** Confirmed by 5 of 6 agents across HN, Wikipedia, Amazon, Herokuapp, ECMAScript spec.

**Where:** `src/aria.js` lines 1364-1464 — `generateSummaryView()`. The viewport element counting logic likely has a detection failure.

**Fix:** Debug the viewport detection in summary mode. The viewport-only snapshot mode works correctly (it produces correct viewport content), so the counting code in summary mode is using a different or broken viewport check. Likely the IntersectionObserver or bounding rect check isn't being set up for the summary code path.

**Impact:** Makes summary mode trustworthy for page orientation. Low effort, high signal.

---

### Fix 5: Omit viewportSnapshot from non-action responses

**Problem:** Every response includes viewportSnapshot (10-12KB) even when it's redundant: caching `unchanged` responses, snapshotSearch results, explicit full snapshots.

**Evidence:** HN agent — caching "unchanged" response still carried 5.8KB viewport. ECMAScript agent — viewport repeated in every response.

**Where:** `src/runner/step-executors.js` lines 408-426

**Fix:** Only attach viewportSnapshot for action steps (click, fill, goto, scroll, hover, press, type, drag, selectOption). Skip it for query steps (snapshot, snapshotSearch, query, inspect, extract, formState, console, getBox, refAt) and for caching responses where `unchanged: true`.

```javascript
// step-executors.js — after steps complete
const isActionStep = ['click', 'fill', 'goto', 'scroll', 'hover',
  'press', 'type', 'drag', 'selectOption', 'openTab', 'reload',
  'back', 'forward'].some(a => steps.find(s => s[a]));

if (isActionStep && !result.unchanged) {
  result.viewportSnapshot = afterViewport.yaml;
}
```

**Impact:** 10-12KB saved per query operation. On a typical agent workflow with 50% query steps, this halves total data transfer.

---

### Fix 6: Don't include refs in summary mode

**Problem:** Summary mode is for orientation (~100-200 bytes) but the response includes all refs. On the ECMAScript spec, this means 28,329 refs inflating a 100-byte summary to 1MB+.

**Evidence:** ECMAScript agent, HN agent.

**Where:** `src/runner/execute-query.js` — the summary code path still calls the full snapshot generator which populates refs.

**Fix:** When `detail === 'summary'`, skip ref generation entirely or strip refs from the response before returning.

```javascript
// execute-query.js — in executeSnapshot()
if (detail === 'summary') {
  return { snapshotId, yaml: summaryYaml, detail: 'summary' };
  // No refs, no artifacts — summary is always inline
}
```

**Impact:** Summary responses go from potentially 1MB+ to <1KB. Makes summary a genuinely lightweight orientation tool.

---

### Fix 7: Truncate accessible names

**Problem:** GitHub commit message links have 500-2000 character names. Amazon product names are duplicated in parent link + child heading. These inflate snapshots 5-10x beyond useful size.

**Evidence:** GitHub agent — 57KB full snapshot, would be ~8KB with truncation. Amazon agent — ~2400 chars wasted on name duplication per page.

**Where:** `src/aria.js` lines 689-744 — `getAccessibleName()`

**Fix:** Add a `maxNameLength` parameter (default: 150) that truncates names. Also suppress duplicate child text when a link contains a heading with the same name.

```javascript
// aria.js — getAccessibleName()
function getAccessibleName(el, maxLength = 150) {
  let name = /* existing logic */;
  if (name && name.length > maxLength) {
    name = name.substring(0, maxLength) + '...';
  }
  return name;
}

// In tree building: skip child heading if name matches parent link
if (parentRole === 'link' && role === 'heading' && name === parentName) {
  // Omit or mark as [same as parent]
}
```

**Impact:** GitHub full snapshot: 57KB → ~8-10KB (inlineable). Amazon search results: ~2400 chars saved. snapshotSearch results become compact.

---

### Fix 8: Reduce footer/boilerplate noise

**Problem:** Footer and site chrome dominate snapshots on most sites: Amazon 57% footer, Wikipedia 65% chrome, HN 35% table noise.

**Evidence:** Amazon, Wikipedia, HN agents.

**Where:** `src/aria.js` (tree building), `src/runner/execute-query.js` (snapshot parameters)

**Fix:** Add an `exclude` parameter that strips named landmarks or roles from the snapshot tree before serialization:

```javascript
// New parameter: exclude landmarks by role
{"snapshot": {"exclude": ["contentinfo"]}}  // strip footer
{"snapshot": {"exclude": ["contentinfo", "complementary"]}}  // strip footer + sidebars

// In aria.js tree building:
if (options.exclude && options.exclude.includes(node.role)) {
  return null; // skip this subtree
}
```

Also consider auto-scoping: if `role=main` exists and no `root` is specified, default viewport snapshots to main content only. This would increase signal-to-noise from ~35% to ~90% on most content pages.

**Impact:** 40-65% size reduction on most real-world sites.

---

### Fix 9: Fix `since` hash to include element states

**Problem:** The `since` caching hash only checks URL, scroll position, DOM size, and interactive element count. It misses attribute-only changes like checkbox toggles, dropdown selections, and visibility changes. An agent trusting "unchanged" will miss real changes.

**Evidence:** Herokuapp agent — `since` always reports "unchanged" after toggling checkboxes, because DOM size and interactive count don't change.

**Where:** `src/aria.js` lines 493-501 — `computePageHash()`

**Fix:** Add a lightweight state checksum to the hash. Iterate known interactive elements and hash their state bits:

```javascript
function computePageHash() {
  const url = location.href;
  const scroll = `${window.scrollX},${window.scrollY}`;
  const domSize = document.body?.children.length || 0;
  const interactiveCount = /* existing count */;

  // NEW: hash interactive element states
  let stateHash = 0;
  const refs = window.__ariaRefs;
  if (refs) {
    for (const [refId, el] of refs) {
      if (el.checked) stateHash ^= hashStr(refId + ':checked');
      if (el.disabled) stateHash ^= hashStr(refId + ':disabled');
      if (el.value) stateHash ^= hashStr(refId + ':' + el.value.slice(0, 20));
      if (el.getAttribute('aria-expanded')) stateHash ^= hashStr(refId + ':expanded');
    }
  }

  return `${url}|${scroll}|${domSize}|${interactiveCount}|${stateHash}`;
}
```

Keep it lightweight — only check states of already-known refs, don't traverse the full DOM. Use XOR hashing for speed.

**Impact:** Makes `since` caching reliable for form interactions and state changes. Eliminates false "unchanged" responses.

---

### Fix 10: Show combobox selected value

**Problem:** `<select>` elements render as bare `combobox [ref=s1e1]` with no indication of the selected option.

**Evidence:** Herokuapp agent — dropdown page shows just `combobox` after selecting "Option 2".

**Where:** `src/aria.js` lines 689-744 — `getAccessibleName()`

**Fix:** For `<select>` elements, use the selected option's text as the accessible name:

```javascript
// In getAccessibleName or buildAriaNode
if (el.tagName === 'SELECT' && el.selectedIndex >= 0) {
  const selectedOption = el.options[el.selectedIndex];
  name = selectedOption?.text || name;
}
```

Output: `combobox "Option 2" [ref=s1e1]`

**Impact:** Eliminates need for `eval` or `formState` roundtrip to verify dropdown state.

---

### Fix 11: Show table cell text by default

**Problem:** `<td>` and `<th>` text content is hidden unless `includeText: true` is explicitly requested. Default snapshots show empty `cell` and `columnheader` nodes.

**Evidence:** Herokuapp agent — tables page shows completely empty cells.

**Where:** `src/aria.js` — tree building, text inclusion logic

**Fix:** Table cells (`cell`, `columnheader`, `rowheader`) should include their text content by default. The text content IS the accessible content for table cells.

```javascript
// In buildAriaNode or serialization
const alwaysIncludeText = ['cell', 'columnheader', 'rowheader', 'gridcell'];
if (alwaysIncludeText.includes(role) && textContent) {
  node.name = textContent.trim().substring(0, 150);
}
```

**Impact:** Makes table snapshots immediately useful without `includeText`.

---

### Fix 12: Fast same-page anchor navigation

**Problem:** `goto` with a `#hash` fragment on the same page causes a full page reload. On the ECMAScript spec (2.5MB page), anchor navigation takes 32 seconds instead of <1 second.

**Evidence:** ECMAScript agent — navigating to `#sec-promise.all` took 32.4s.

**Where:** `src/runner/execute-navigation.js` / `src/page/page-controller.js` — the navigate function

**Fix:** Detect same-origin URLs that differ only in hash and use `location.hash` instead of `Page.navigate`:

```javascript
// In pageController.navigate() or execute-navigation.js
const currentUrl = new URL(currentPageUrl);
const targetUrl = new URL(url);

const sameOriginHashOnly =
  currentUrl.origin === targetUrl.origin &&
  currentUrl.pathname === targetUrl.pathname &&
  currentUrl.search === targetUrl.search &&
  targetUrl.hash;

if (sameOriginHashOnly) {
  await session.send('Runtime.evaluate', {
    expression: `location.hash = ${JSON.stringify(targetUrl.hash)}`,
    awaitPromise: false
  });
  await sleep(100); // let scroll settle
  // Take snapshot of new viewport position
} else {
  // existing Page.navigate logic
}
```

**Impact:** ECMAScript spec anchor navigation: 32s → <1s. Benefits all single-page documentation sites.

---

### Fix 13: Fallback text for unnamed buttons

**Problem:** Buttons with no ARIA accessible name show as `button [ref=s1e13]` — agents can't tell what they do.

**Evidence:** Amazon agent — international shopping dialog has two unnamed buttons, no way to distinguish "Stay" from "Redirect".

**Where:** `src/aria.js` lines 689-744 — `getAccessibleName()`

**Fix:** Add fallback chain when ARIA name is empty:

```javascript
function getAccessibleName(el) {
  let name = /* existing ARIA logic */;

  if (!name || !name.trim()) {
    // Fallback chain
    name = el.innerText?.trim()?.substring(0, 100)
      || el.value
      || el.getAttribute('title')
      || el.getAttribute('data-label')
      || '';
  }

  return name;
}
```

**Impact:** Makes modals and dialogs actionable on sites with poor accessibility.

---

## P2 Fixes — Medium Impact

### Fix 14: Improve snapshotSearch fuzzy matching

**Problem:** "star" matches "start"/"started". No word-boundary awareness.

**Where:** `src/runner/execute-query.js` lines 880-957

**Fix:** Default to word-boundary matching. Add a `matchMode` parameter:
- `"word"` (default): match whole words only
- `"substring"`: current behavior (contains)
- `"exact"`: exact match (already exists)

```javascript
function matchesText(name, query, matchMode = 'word') {
  if (matchMode === 'exact') return name === query;
  if (matchMode === 'substring') return name.toLowerCase().includes(query.toLowerCase());
  // word boundary: match "star" but not "start"
  const regex = new RegExp(`\\b${escapeRegex(query)}\\b`, 'i');
  return regex.test(name);
}
```

---

### Fix 15: Include state attributes in snapshotSearch results

**Problem:** Search results don't include `[checked]`, `[selected]`, `[disabled]` states.

**Where:** `src/runner/execute-query.js` lines 936-947

**Fix:** Add states to the match object:

```javascript
// In searchNode match construction
match.states = {};
if (node.checked !== undefined) match.states.checked = node.checked;
if (node.disabled) match.states.disabled = true;
if (node.expanded !== undefined) match.states.expanded = node.expanded;
if (node.selected) match.states.selected = true;
if (node.value) match.states.value = node.value;
```

---

### Fix 16: Better path context in snapshotSearch

**Problem:** All matches share identical generic paths like `table > rowgroup > row > cell`.

**Where:** `src/runner/execute-query.js` — path building in search results

**Fix:** Include the nearest named ancestor in the path. Walk up the tree looking for an element with a name or heading:

```javascript
function buildContextPath(node, maxDepth = 3) {
  const parts = [];
  let current = node.parent;
  let depth = 0;
  while (current && depth < maxDepth) {
    if (current.name) {
      parts.unshift(`${current.role} "${current.name.substring(0, 40)}"`);
      break;
    }
    if (current.role !== 'generic') {
      parts.unshift(current.role);
    }
    current = current.parent;
    depth++;
  }
  return parts.join(' > ');
}
```

---

### Fix 17: Fix selectOption diff generation

**Problem:** selectOption produces no `changes` field unlike click and fill.

**Where:** `src/runner/step-executors.js`

**Fix:** Ensure auto-snapshot runs after selectOption and diff is computed, same as for click/fill.

---

### Fix 18: Strip HTML from accessible names

**Problem:** Raw HTML tags leak into accessible names on some sites.

**Where:** `src/aria.js` — `getAccessibleName()`

**Fix:** Strip HTML tags from the final name string:

```javascript
name = name.replace(/<[^>]*>/g, '').trim();
```

---

### Fix 19: Fix false modal detection

**Problem:** GitHub's search placeholder text is misidentified as a modal.

**Where:** `src/runner/step-executors.js` — modal detection logic

**Fix:** Only report `context.modal` when a visible element with `role="dialog"` or `role="alertdialog"` exists. Check visibility (not just DOM presence).

---

### Fix 20: Exclude fixed/sticky elements from viewport snapshots

**Problem:** Fixed navigation (like the ECMAScript spec TOC) repeats in every viewport snapshot, wasting ~60%.

**Where:** `src/aria.js` — viewport detection

**Fix:** Add `excludeFixed: true` option (or make it default for viewport-only snapshots). Check `position: fixed` or `position: sticky` via `getComputedStyle()` and exclude those subtrees after the first snapshot.

---

## Implementation Order

Recommended sequence based on impact and independence:

| Phase | Fixes | Rationale |
|-------|-------|-----------|
| **Phase 1** | Fix 1 (refs map), Fix 6 (summary refs) | Biggest payload reduction, zero risk, pure removal |
| **Phase 2** | Fix 4 (viewport count), Fix 5 (viewportSnapshot conditional) | Bug fix + simple conditional, immediate improvement |
| **Phase 3** | Fix 7 (name truncation), Fix 8 (footer exclude) | Major noise reduction, moderate complexity |
| **Phase 4** | Fix 2 (heading refs), Fix 12 (anchor nav) | Unblocks document navigation workflows |
| **Phase 5** | Fix 3 (SPA nav), Fix 9 (since hash) | Core detection improvements |
| **Phase 6** | Fixes 10-13 (combobox, tables, unnamed buttons) | Form state improvements |
| **Phase 7** | Fixes 14-20 (P2 items) | Polish and edge cases |

Phase 1 alone would cut response sizes by 50-70% across all operations with zero behavior change.
