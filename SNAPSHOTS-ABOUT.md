# How Snapshots Work

## What Are Snapshots?

Snapshots are **accessibility tree representations** of a web page. Instead of raw HTML/DOM, they capture the page's semantic structure using ARIA roles, accessible names, and states. This gives agents a reliable, human-readable view of the page that doesn't depend on brittle CSS selectors.

## How They're Captured

The core logic is in `cdp-skill/scripts/aria.js`. A large JavaScript function (the `SNAPSHOT_SCRIPT`, lines ~473-1298) is injected into the browser via `Runtime.evaluate`. It walks the DOM tree, detects ARIA roles (implicit and explicit), extracts accessible names/states, and builds a hierarchical tree. Each interactive element gets a **versioned ref** like `s1e4` (snapshot 1, element 4).

Refs are stored browser-side in a `Map` (`window.__ariaRefs`) so they can be looked up later for clicking/filling.

## Detail Levels

Three levels, handled in `aria.js` lines ~1360-1528:

- **full** (default) — Complete tree with all semantic elements and refs
- **interactive** — Only actionable elements (buttons, links, inputs) with path context. Compact.
- **summary** — Just landmarks with interactive counts and page-level stats (total elements, viewport elements, etc.)

## Large Snapshot Handling

Implemented in `cdp-skill/scripts/runner/execute-query.js` lines ~29-101:

- **Inline limit**: 9000 bytes (the `DEFAULT_INLINE_LIMIT`)
- If the YAML exceeds that, it's written to `/tmp/cdp-skill/{tabAlias}.snapshot.yaml` and the response contains an `artifacts.snapshot` file path instead of inline YAML
- If refs exceed 1000 entries, those also get written to a separate `.refs.json` file

## snapshotSearch

A query mechanism (`execute-query.js` lines ~855-979) that generates the full snapshot in memory but only returns **matching elements**. Supports:

- `text` — fuzzy text matching on element names/values
- `pattern` — regex matching
- `role` — filter by ARIA role
- `near` — coordinate-based proximity filtering

Returns matches with path context and refs, without dumping the entire tree.

## Element Targeting via Refs

This is the key workflow:

1. Agent requests a snapshot — gets YAML with refs like `s1e4`
2. Agent issues `{"click": "s1e4"}` or `{"fill": {"ref": "s1e4", "value": "hello"}}`
3. The click/fill executor resolves the ref by looking up `window.__ariaRefs.get('s1e4')` in the browser, gets coordinates, and dispatches CDP mouse/keyboard events

Refs persist across snapshots — when `preserveRefs: true` is used, new snapshots reuse existing refs for the same DOM elements, so `s1e4` remains valid even after taking snapshot `s2`.

## Auto-Snapshots and Diffs

Every visual action (click, fill, goto) automatically captures before/after viewport snapshots (`step-executors.js` lines ~370-440). The diff engine (`scripts/diff.js`) compares them and reports what changed — elements added, removed, or modified — so the agent knows what happened without re-reading the whole page.

## Caching

A hash of URL + scroll position + DOM size + interactive count is computed. If unchanged since the last snapshot, the system returns an "unchanged" response (like HTTP 304), avoiding redundant work.
