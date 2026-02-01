# Phase 2: Items Needing Clarification

This document tracks items that need clarification or decision before implementing in a future phase.

## Token Tracking

**Question:** How to capture token usage from subagent responses?

**Context:** The JSONL schema includes `cost_tokens` with input/output/total fields, but Task tool doesn't directly expose token usage from subagent runs.

**Options to explore:**
1. Parse agent output for token info if Claude Code exposes it
2. Add token tracking to the Task tool API (upstream change)
3. Estimate based on message lengths (approximate)
4. Omit token tracking initially, add when API supports it

**Status:** Needs investigation into Task tool output format

---

## Baseline Comparison Logic

**Question:** How should baseline comparison work?

**Options:**
1. **Compare to last run** - Simple, shows immediate regression/improvement
2. **Compare to best ever** - Shows progress toward peak performance
3. **Compare to same version** - Isolates code changes from agent behavior changes
4. **Compare to pinned baseline** - Manual control over comparison point

**Considerations:**
- Multiple baselines may be useful (version-specific + overall best)
- Agent behavior can vary even with same skill version
- Need to handle missing baselines gracefully

**Status:** Needs decision on primary comparison strategy

---

## Parallelism Limit

**Question:** How many background agents should run concurrently?

**Factors:**
- Chrome can handle multiple tabs but has resource limits
- Too many parallel agents may cause contention
- Sequential runs are slower but more predictable
- Agent cost/quota considerations

**Options:**
1. Fixed limit (e.g., 3-5 concurrent)
2. User-configurable via flag
3. Auto-detect based on system resources
4. Sequential by default, parallel opt-in

**Status:** Needs benchmarking and user preference input

---

## Test Generation Skill

**Question:** What interface should `/eval-build` have?

**Proposed features:**
- Generate .eval.md from URL or site description
- AI-powered milestone extraction
- Interactive refinement of generated tests
- Bulk generation from site list

**Open questions:**
1. Should it visit the site to generate the test?
2. How much human review is needed?
3. Template-based vs fully generated?
4. Integration with existing test discovery?

**Status:** Needs design spec

---

## Retry vs Recovery Semantics

**Question:** How to distinguish retries from recoveries in metrics?

**Current understanding:**
- **Retry**: Same action repeated after transient failure
- **Recovery**: Alternative approach after failure (e.g., different selector)

**Clarification needed:**
- Is recovery agent-initiated or skill-initiated?
- How to count partial successes?
- Does recovery reset the step count?

**Status:** Needs semantic definition

---

## Site Availability

**Question:** How to handle sites that are down or changed?

**Scenarios:**
1. Site temporarily unavailable
2. Site layout changed (selectors broken)
3. Site requires authentication now
4. Site blocked automation (CAPTCHAs)

**Options:**
1. Skip test with "site_unavailable" status
2. Automatic fallback to alternative sites
3. Cached site state for comparison
4. Separate "site health" check before running tests

**Status:** Needs error handling strategy

---

## Multi-Tab Test Support

**Question:** Should tests support multi-tab scenarios?

**Examples:**
- OAuth flows that open popups
- "Open in new tab" interactions
- Comparing two pages side-by-side

**Considerations:**
- cdp-skill supports tab management
- Adds complexity to test definitions
- May need cross-tab milestone tracking

**Status:** Needs decision on scope

---

## Next Steps

1. Prioritize these items based on user needs
2. Make decisions for high-priority items
3. Document decisions and rationale
4. Implement in Phase 2 iteration
