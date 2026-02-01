# Phase 3: Future Enhancements

This document tracks potential enhancements for future development after core functionality is stable.

## Auto-Scaling Test Generation

**Description:** Automatically generate evaluation tests from site lists or categories.

**Features:**
- Input: List of URLs or site categories
- AI visits each site and proposes test scenarios
- Generates .eval.md files with appropriate milestones
- Validates generated tests can run successfully

**Benefits:**
- Rapid expansion of test coverage
- Discover edge cases automatically
- Keep tests current with site changes

**Dependencies:** Phase 2 test generation skill

---

## Trend Visualization Dashboard

**Description:** Web-based dashboard for viewing eval results over time.

**Features:**
- Chart pass rates over time by category
- Drill down into individual test histories
- Compare skill versions side-by-side
- Highlight regression points
- Export data for external analysis

**Implementation options:**
- Static HTML generation from JSONL
- Simple local web server
- Integration with existing dashboarding tools

**Benefits:**
- Visual understanding of progress
- Quick regression identification
- Stakeholder-friendly reporting

---

## Regression Detection Alerts

**Description:** Automated alerts when performance degrades.

**Features:**
- Define thresholds (e.g., >10% drop in pass rate)
- Alert via terminal, webhook, or email
- Suggest potential causes (site changed, skill bug, etc.)
- Integration with CI/CD pipelines

**Trigger conditions:**
- Pass rate drops below threshold
- New failures in previously passing tests
- Significant increase in execution time
- New bug categories appearing

---

## A/B Skill Version Comparison

**Description:** Run the same tests against different skill versions.

**Features:**
- Specify two versions to compare
- Run identical tests against both
- Generate diff report showing:
  - Pass rate delta
  - New passes/failures
  - Timing differences
  - Cost differences

**Use cases:**
- Validate skill updates before release
- Compare implementation approaches
- Benchmark improvements

---

## Cross-Model Comparison

**Description:** Compare performance across different Claude models.

**Features:**
- Run same tests with different models (Sonnet, Opus, Haiku)
- Compare:
  - Pass rates
  - Execution patterns
  - Cost efficiency
  - Time to completion

**Goals:**
- Find optimal model for eval tasks
- Understand model-specific strengths
- Cost optimization guidance

---

## CI/CD Integration

**Description:** Run evals as part of continuous integration.

**Features:**
- GitHub Actions workflow
- Pre-merge eval gates
- Nightly full eval runs
- PR comments with results
- Badge for README

**Implementation:**
```yaml
# Example GitHub Action
on: [push, pull_request]
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run eval
        run: npx claude-code /eval --ci
      - name: Check thresholds
        run: node scripts/check-eval-thresholds.js
```

---

## Weighted Formula Tuning

**Description:** Optimize milestone weights based on actual results.

**Features:**
- Analyze correlation between milestones and overall success
- Suggest weight adjustments
- A/B test different weight configurations
- Auto-tune based on historical data

**Approach:**
- Collect data on milestone achievements vs overall success
- Use regression to find optimal weights
- Validate with holdout test set

---

## Flaky Test Detection

**Description:** Identify and handle tests with inconsistent results.

**Features:**
- Track pass/fail history per test
- Calculate flakiness score (variance in results)
- Quarantine highly flaky tests
- Suggest stabilization improvements

**Metrics:**
- Flakiness = % of runs that differ from majority
- Stability score = consecutive identical results
- Root cause hints from failure patterns

---

## Site Change Detection

**Description:** Detect when sites have changed in ways that affect tests.

**Features:**
- Compare page structure before/after
- Identify broken selectors
- Suggest test updates
- Track site evolution over time

**Implementation:**
- Store accessibility snapshots per test
- Diff against latest run
- Highlight significant structural changes
- Generate update suggestions

---

## Priority Order

Suggested implementation order based on value/effort:

1. **CI/CD Integration** - High value, medium effort
2. **Regression Detection Alerts** - High value, low effort
3. **Trend Visualization Dashboard** - Medium value, medium effort
4. **A/B Skill Version Comparison** - High value, medium effort
5. **Flaky Test Detection** - Medium value, low effort
6. **Auto-Scaling Test Generation** - High value, high effort
7. **Cross-Model Comparison** - Medium value, medium effort
8. **Weighted Formula Tuning** - Low value, high effort
9. **Site Change Detection** - Medium value, high effort

---

## Contributing

To propose additional enhancements:
1. Add a section to this document with description
2. Include benefits, implementation notes, and dependencies
3. Suggest priority level
4. Submit PR for review
