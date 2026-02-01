# Eval System Vision

## Purpose

Create a **quantitative flywheel for continuous improvement** of cdp-skill browser automation. By measuring agent performance against real websites, we can systematically identify weaknesses, track progress, and ensure the skill becomes increasingly reliable over time.

## Core Goals

### 1. Measure What Matters

Run agents against live websites performing real tasks (not mocked or simplified scenarios). Track success rates, failure modes, and improvement opportunities in structured data.

### 2. Self-Assessment

Agents evaluate their own performance against defined milestones. This captures nuanced understanding that binary pass/fail cannot - partial successes, workarounds used, and observations about site behavior.

### 3. Improvement Flywheel

```
Run tests → Identify weaknesses → Fix skill → Run tests → Measure improvement → Repeat
```

Each eval run feeds back into development priorities. Improvement suggestions from agents highlight where the skill falls short.

### 4. Regression Prevention

Baselines per version ensure changes don't break existing functionality. Compare new runs against known-good states to catch regressions early.

### 5. Real-World Coverage

Test against diverse site categories:
- **E-commerce**: Shopping carts, checkouts, dynamic pricing
- **News**: Article navigation, paywalls, media content
- **Search**: Query input, results parsing, filters
- **Forms**: Validation, multi-step flows, date pickers
- **Tables**: Sorting, filtering, pagination
- **SPAs**: React/Vue/Angular apps, client-side routing

## Success Metrics

| Metric | Target | Why |
|--------|--------|-----|
| Pass rate | >90% | Skill should reliably complete common tasks |
| Category coverage | All 6 | No blind spots in capability |
| Regression rate | <5% | Changes shouldn't break things |
| Avg steps per test | Decreasing | More efficient execution over time |
| Bug reports | Decreasing | Fewer skill issues found |

## Design Principles

### Lightweight

- No external dependencies beyond Claude Code
- JSONL for results (simple, appendable, grep-friendly)
- Markdown for summaries (human-readable)

### Parallel Execution

- Run multiple tests concurrently via background agents
- Each test is independent - no shared state
- Aggregate results after all complete

### Version Tracking

- Tag results with skill version
- Maintain baselines per version
- Enable A/B comparison between versions

### Agent-Centric

- Tests are prompts, not scripts
- Agents interpret intent and adapt to page changes
- Self-assessment captures agent perspective

## Non-Goals (Phase 1)

- Visual regression testing (screenshots as source of truth)
- Performance benchmarking (speed as primary metric)
- Cross-browser testing (Chrome only)
- Headless-only execution (headed for debugging)

## Future Vision

Once the foundation is solid:

1. **Auto-generate tests** from site URLs
2. **Trend dashboards** showing improvement over time
3. **CI integration** blocking merges on regressions
4. **Model comparison** across Claude versions
5. **Community test library** shared across projects

## The Flywheel in Action

```
Week 1: Run eval → 70% pass rate → Identify form fill issues
Week 2: Fix form handling → Run eval → 78% pass rate
Week 3: Add better waits → Run eval → 85% pass rate
Week 4: Handle popups → Run eval → 91% pass rate
...
```

Each iteration makes the skill more robust, building confidence that cdp-skill can handle whatever the web throws at it.
