# Snapshot System Evaluation Guide

Run parallel subagents to critically evaluate the CDP snapshot system against real websites. Each agent reads the docs, exercises snapshot operations, and reports findings with votes for VOTING.md.

## Prerequisites

- Chrome installed (auto-launched by the skill)
- Node.js available
- CLI at: `node cdp-skill/scripts/cdp-skill.js`

## Pre-Flight

Before launching agents, verify these files are current:

1. **`cdp-skill/SKILL.md`** — CLI API reference (agents read this to understand available steps)
2. **`VOTING.md`** — Known issues and vote counts (agents review and vote)
3. **`SNAPSHOTS-ABOUT.md`** — Internal snapshot architecture (agents read this to understand how it works)

Read all three and confirm they reflect the current codebase before starting.

## Agent Design

Each agent is a `general-purpose` subagent launched via the Task tool with `run_in_background: true`. All agents run in parallel.

### What every agent must do

1. Read `SNAPSHOTS.md`, `cdp-skill/SKILL.md`, and `cdp-bench/VOTING.md`
2. Run `chromeStatus` to ensure Chrome is available
3. Open a tab with `openTab` and navigate to their assigned site
4. Execute the test matrix below
5. Write a report to `cdp-bench/reports/snapshot-eval-{name}.md`
6. Close their tab with `closeTab`

### Test Matrix

Every agent runs these operations and critically evaluates each result:

| # | Operation | What to evaluate |
|---|-----------|-----------------|
| 1 | `openTab` + `goto` | Is the auto-snapshot useful? Signal-to-noise ratio? |
| 2 | `{"snapshot": true}` | How large? Does file routing trigger? Is the YAML usable? |
| 3 | `{"snapshot": {"detail": "interactive"}}` | Smaller than full? Does it lose needed context (headings)? |
| 4 | `{"snapshot": {"detail": "summary"}}` | Useful for orientation? Viewport element count correct? |
| 5 | `{"snapshotSearch": {"text": "...", "role": "..."}}` | Precise results? Actionable refs? Fuzzy matching quality? |
| 6 | Click a ref from snapshot | Does ref work? CDP or jsClick fallback? |
| 7 | `{"snapshot": {"since": "s1"}}` | Correctly detects unchanged? Detects state changes? |
| 8 | Scroll + snapshot | Diff accurate? Viewport snapshot reflects new position? |
| 9 | `{"snapshot": {"viewportOnly": true}}` | Size vs full? Signal-to-noise? |
| 10 | Multi-step workflow | Count total roundtrips for a realistic task |

### Critical Analysis Questions

Agents must answer these for each operation:

- How many roundtrips would a real agent need for this task?
- How much of the returned data is useful vs noise?
- What information is MISSING that would save roundtrips?
- Are refs reliable enough to use without fallbacks?
- Is the inline vs file routing making good decisions?
- What is the response payload size vs the useful content size?

## Site Assignments

Assign one agent per site. Cover a range of complexity:

### Small — Hacker News (`news.ycombinator.com`)
- Static, table-based layout, minimal JS
- Tests: table structure noise, ref reliability on static pages, snapshotSearch on flat lists
- Report: `cdp-bench/reports/snapshot-eval-simple.md`

### Medium — Wikipedia article (`en.wikipedia.org/wiki/Web_browser`)
- Content-heavy, hundreds of internal links, section headings, footnotes
- Tests: heading refs, signal-to-noise on content pages, interactive vs full on link-dense pages
- Report: `cdp-bench/reports/snapshot-eval-medium.md`

### Large SPA — GitHub repo (`github.com/facebook/react`)
- Turbo/React SPA, dynamic content, client-side routing
- Tests: SPA navigation detection, ref persistence across transitions, accessible name bloat from commit messages
- Report: `cdp-bench/reports/snapshot-eval-large-spa.md`

### Ecommerce — Amazon (`amazon.com`)
- Heavy dynamic content, modals, cookie banners, product listings
- Tests: footer noise ratio, unnamed buttons, price data availability, modal handling
- Report: `cdp-bench/reports/snapshot-eval-ecommerce.md`

### Complex Web App — Herokuapp (`the-internet.herokuapp.com`)
- Multiple sub-pages: `/checkboxes`, `/dropdown`, `/dynamic_loading/1`, `/tables`, `/hovers`
- Tests: state tracking (checked/selected), `since` reliability, table cell text, selectOption diff
- Report: `cdp-bench/reports/snapshot-eval-webapp.md`

### Stress Test — ECMAScript spec (`tc39.es/ecma262/`)
- 74,000+ elements, 28,000+ interactive, 2.5MB full snapshot
- Tests: extreme page size handling, snapshot generation time, snapshotSearch at scale, anchor navigation performance
- Report: `cdp-bench/reports/snapshot-eval-ecmascript-spec.md`

## Adding More Sites

Pick sites that stress different aspects:

| Category | Good candidates | What they stress |
|----------|----------------|-----------------|
| Forms | `demoqa.com/automation-practice-form` | Fill workflows, validation, date pickers |
| SPA (Vue) | `vuejs.org/examples/` | Cross-origin iframes, srcdoc frames |
| SPA (Next.js) | `vercel.com` | Hydration, client-side routing |
| Dashboard | `grafana.com/play` | Dense interactive elements, charts |
| News | `bbc.com` | GDPR consent modals, cross-origin iframes |
| Maps | `google.com/maps` | Canvas elements, custom controls |
| Email | `mail.google.com` | Auth-gated, deeply nested DOM |

## Report Format

Each agent writes a markdown report with these sections:

```markdown
# Snapshot Evaluation: {Site Name}

**Date:** YYYY-MM-DD
**Target:** {URL}

## Test Results
### 1. chromeStatus
### 2. openTab + goto (auto-snapshot)
### 3. Full snapshot
... (one subsection per test matrix item)

## What Worked Well
(Bulleted list with specific evidence)

## What Was Problematic
(Grouped by P0/P1/P2/P3 with symptoms and impact)

## Specific Improvement Suggestions
(Numbered, with rationale and expected impact)

## Votes
### Existing issues I'd vote for
(Table: issue number, reason)

### New issues to add
(Using VOTING.md template format with votes, priority, symptoms, expected behavior)

## Roundtrip Analysis
(Table: task, roundtrip count, notes)
```

## Consolidation

After all agents complete:

1. Read all reports from `cdp-bench/reports/snapshot-eval-*.md`
2. Count votes: each agent that flags an issue = 1 vote
3. Update existing issue vote counts in `cdp-bench/VOTING.md`
4. Add new issues with consolidated vote counts
5. Update the vote tally table and total

## Prompt Template

Use this as the base prompt for each agent, substituting the site-specific sections:

```
You are a critical evaluator of the CDP snapshot system. Your job is to test
snapshots on {SITE_DESCRIPTION} and report what works, what's broken, and what
could be improved — especially around minimizing roundtrips and reducing
irrelevant inline context returned to the using-agent.

## Setup

1. First, read these three files thoroughly:
   - `/path/to/SNAPSHOTS.md` — understand how snapshots work internally
   - `/path/to/cdp-skill/SKILL.md` — understand the CLI API
   - `/path/to/cdp-bench/VOTING.md` — understand known issues

2. The CLI is at: `node /path/to/cdp-skill/scripts/cdp-skill.js`

## Your Test Target

Test on **{URL}** — {site characteristics}.

## What to Test

Run these snapshot operations and be CRITICAL about each result:

1. **chromeStatus** — make sure Chrome is running
2. **openTab + goto** — examine auto-snapshot. Signal vs noise?
3. **Full snapshot** — size? File routing? Usability?
4. **Interactive detail level** — useful? Smaller than full?
5. **Summary detail level** — useful for orientation?
6. **snapshotSearch** — {site-specific search targets}
7. **Click a ref** — reliable? Persists?
8. **Snapshot caching** — `since` parameter accurate?
9. **Auto-snapshot diff** — after interaction, is diff useful?
10. {SITE-SPECIFIC TESTS}

## Critical Analysis Focus

For each operation, ask yourself:
- How many roundtrips would a real agent need?
- How much returned data is useful vs noise?
- What information is MISSING that would save roundtrips?
- Are refs reliable enough without fallbacks?
- Is inline vs file routing making good decisions?

## Output

Write your report to `/path/to/cdp-bench/reports/snapshot-eval-{name}.md`
following the report format.

Be concise but thorough. Think like an agent that needs to automate tasks
efficiently.

IMPORTANT: Close your tab when done with `closeTab`.
```

## Historical Results

### 2026-02-03 Run (6 agents)

| Site | Key Finding | Top Issue |
|------|------------|-----------|
| Hacker News | Refs map bloats response 2-3x | 9.1 Refs map inline (P0) |
| Wikipedia | All section headings have ref=None | 10.2 Headings no refs (P0) |
| GitHub | SPA navigation always reports navigated:false | 11.1 SPA nav broken (P0) |
| Amazon | 57% of interactive elements are footer noise | 9.5 Footer noise (P1) |
| Herokuapp | `since` misses checkbox state changes | 10.4 Since hash broken (P1) |
| ECMAScript | 32s anchor navigation (full reload on 2.5MB page) | 11.2 Anchor nav reload (P1) |

Universal findings across all 6 agents:
- `viewportSnapshot` is the right default mode
- `snapshotSearch` is the most efficient element discovery tool
- Summary "Viewport elements: 0" bug confirmed on all sites
- Interactive detail level is broken on link-dense pages
- Auto-snapshot on navigation saves a roundtrip every time
