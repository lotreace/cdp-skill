---
name: cdp-bench-eval-skill
description: Run the CDP-Skill improvement flywheel — deterministic browser automation evaluation with automated diagnosis and fix cycles.
user_invocable: true
---

# CDP-Bench Flywheel

Deterministic evaluation system for cdp-skill. Each "crank turn" measures test performance, validates against live browser state, diagnoses failures, and optionally applies fixes with regression protection.

## Usage

```
/cdp-bench-eval-skill                     # Full crank: measure + validate + diagnose + fix + verify
/cdp-bench-eval-skill --measure           # Measure + validate + diagnose only (no code changes)
/cdp-bench-eval-skill --fix-only          # Fix top diagnosis from last run (no re-measure)
/cdp-bench-eval-skill --test 001          # Single test with validation (prefix match)
/cdp-bench-eval-skill --test 001 --debug  # Single test with debug logging
```

## Test Format (v2)

Tests are `.test.json` files in `cdp-bench/tests/` with programmatic milestones:

```json
{
  "id": "001-saucedemo-checkout",
  "url": "https://www.saucedemo.com",
  "category": "create",
  "task": "Login, add item to cart, complete checkout.",
  "milestones": [
    { "id": "login", "weight": 0.2, "verify": { "url_contains": "/inventory" } },
    { "id": "order_confirmed", "weight": 0.4, "verify": {
      "all": [
        { "url_contains": "/checkout-complete" },
        { "eval_truthy": "document.body.innerText.includes('Thank you')" }
      ]
    }}
  ],
  "budget": { "maxSteps": 25, "maxTimeMs": 90000 }
}
```

**Validator types:** `url_contains`, `url_matches`, `eval_truthy`, `dom_exists`, `dom_text`, `all` (AND), `any` (OR).

## Scoring

### Per-Test Composite (0.0-1.0)

| Dimension | Weight | Formula |
|-----------|--------|---------|
| Completion | 60% | Sum of achieved milestone weights |
| Efficiency | 15% | `max(0, 1 - max(0, stepsUsed - budget) / budget)` |
| Resilience | 10% | `errors == 0 ? 1.0 : 0.5 + 0.5 * (recovered / errors)` |
| Response quality | 15% | Fraction of response_checks passed (1.0 if none) |

### Skill Health Score (SHS, 0-100)

```
SHS = 40 * passRate + 25 * avgCompletion + 15 * perfectRate + 10 * avgEfficiency + 10 * categoryCoverage
```

## Implementation

<eval-implementation>

### Phase 1: MEASURE (~20-25 min)

#### Step 1: Setup

**Kill existing Chrome and create run directory:**

```bash
pkill -f "chrome.*remote-debugging-port" 2>/dev/null || true
```

```bash
node -e "const id=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);require('fs').mkdirSync('cdp-bench/runs/'+id,{recursive:true});console.log(id)"
```

Use the exact output as `runId`. Set `runDir` = `cdp-bench/runs/${runId}`.

Create a metrics file path: `metricsFile` = `${runDir}/metrics.jsonl`

#### Step 2: Discover Tests

Glob for `.test.json` files in `cdp-bench/tests/`:
- No flag: all `*.test.json` files
- `--test NNN`: prefix match `NNN*.test.json`
- Category filter: match `category` field in JSON

If no `.test.json` files match, fall back to legacy `*.json` files (v1 format — no milestones, self-assessed).

#### Step 3: Read Baseline

Read the current baseline:
```
cdp-bench/baselines/latest.json
```

If it exists, note the SHS and per-test scores for comparison. If not, this is the first run.

#### Step 4: Launch Runner Subagents

For each test file, spawn a background Task agent with `run_in_background: true`.

**Batch in groups of 5-8** to avoid overwhelming Chrome.

**Subagent prompt** — read and adapt from `cdp-bench/flywheel/prompts/runner.md`, substituting:
- `{{test_file_path}}` = path to the `.test.json` file
- `{{run_id}}` = the run ID
- `{{run_dir}}` = the run directory
- `{{metrics_file}}` = the metrics file path
- `{{url}}` = the test's URL
- `{{test_id}}` = the test's ID

**Environment for runners:**
```bash
export CDP_METRICS_FILE="${metricsFile}"
```

#### Step 5: Collect Traces

Wait for all runner subagents to complete. Each writes a `.trace.json` to the run directory.

Collect one-line summaries:
```
TRACE: 001-saucedemo-checkout | wallClock=25000ms | steps=10 | errors=0 | tab=t42
```

### Phase 2: VALIDATE (~5 min)

#### Step 6: Run Validator Harness

The validator harness is a Node.js script (NOT an agent) that connects to each runner's tab via CDP and executes milestone verify blocks.

```bash
node cdp-bench/flywheel/validator-harness.js --run-dir ${runDir} --tests-dir cdp-bench/tests --port 9222
```

This produces:
- `${runDir}/${test_id}.result.json` for each test
- `${runDir}/validation-summary.json` with SHS and aggregate metrics

Read the validation summary to get the current SHS.

### Phase 3: DIAGNOSE (~5 min)

#### Step 7: Run Diagnosis

Spawn ONE diagnostician agent using the prompt from `cdp-bench/flywheel/prompts/diagnostician.md`, substituting:
- `{{run_dir}}` = the run directory
- `{{baselines_dir}}` = `cdp-bench/baselines`
- `{{improvements_path}}` = `improvements.json`
- `{{tests_dir}}` = `cdp-bench/tests`

Alternatively, run the diagnosis engine programmatically:
```javascript
import { diagnose } from './cdp-bench/flywheel/diagnosis-engine.js';
const diagnosis = diagnose(runDir, 'cdp-bench/tests', 'improvements.json', baseline);
// diagnosis.recommendations now include attemptHistory from DecisionEngine
```

The diagnosis produces `${runDir}/diagnosis.json` with:
- Failure patterns detected
- Regressions vs baseline
- Top-3 fix recommendations with priority scores

#### Step 7b: History-Aware Ranking

The diagnosis engine automatically re-ranks recommendations using the DecisionEngine:
- Reads `improvements.json` for fix attempt history per issue
- Reads `cdp-bench/baselines/flywheel-history.jsonl` for crank pattern persistence
- Applies penalty (0.3x) for issues that failed in the last 2 cranks
- Applies boost (1.5x) for patterns detected in 3+ consecutive cranks
- Skips issues with 3+ consecutive failures (flags as "needs design review")
- Each recommendation in `diagnosis.json` includes an `attemptHistory` field

#### Step 8: Report Measure Results

Print summary to user:
```
=== CDP-Bench Flywheel: Measure Complete ===
SHS: {shs}/100 (delta: {delta} vs baseline)
Tests: {passed}/{total} passed ({passRate}%)
Perfect: {perfect}/{total} ({perfectRate}%)
Categories: {passedCats}/{totalCats} covered

Top Failures:
  - {test_id}: {completion} (milestones: {failed_milestones})
  ...

Top Fix Recommendation:
  #{rank}: {pattern_name} ({affected_tests} tests, est. +{shs_gain} SHS)
  Files: {files}
```

**If `--measure` flag was set, STOP HERE.** Do not proceed to fix/verify.

### Phase 4: FIX (~10-15 min, autonomous)

#### Step 9: Apply Top Fix

Read `${runDir}/diagnosis.json` and get the rank-1 recommendation.

Spawn a fixer agent using the prompt from `cdp-bench/flywheel/prompts/fixer.md`, substituting:
- `{{run_dir}}` = the run directory
- `{{rank}}` = 1 (top recommendation)

The fixer:
1. Reads the recommendation
2. Reads relevant source files
3. Implements the fix
4. Runs `npm run test:run` in `cdp-skill/`
5. Commits if tests pass

### Phase 5: VERIFY (~10 min, autonomous)

#### Step 10: Re-run Affected Tests

Spawn a verifier agent using the prompt from `cdp-bench/flywheel/prompts/verifier.md`.

The verifier:
1. Identifies affected tests from the diagnosis
2. Re-runs only those tests + ratcheted tests
3. Runs the validator harness
4. Checks regression gate

#### Step 11: Regression Gate

Check regression gate:
- `SHS(new) >= SHS(baseline) - 1` (1-point margin for flakiness)
- No ratcheted test (passed 3+ consecutive) drops below 0.7

If gate passes:
- Accept the fix commit
- Update baseline: write `cdp-bench/baselines/latest.json`
- Append to trend: `cdp-bench/baselines/trend.jsonl`

If gate fails:
- Revert the fix commit: `git revert HEAD --no-edit`
- Report which tests regressed
- Try next recommendation (rank 2) or stop

### Phase 6: REPORT (~1 min)

#### Step 12: Generate Summary

Write `${runDir}/summary.md` with:

```markdown
# CDP-Bench Run: {runId}

## Skill Health Score: {shs}/100 (delta: {delta})

| Metric | Value |
|--------|-------|
| Pass rate | {passRate}% |
| Perfect rate | {perfectRate}% |
| Avg completion | {avgCompletion} |
| Avg efficiency | {avgEfficiency} |
| Category coverage | {categoryCoverage} |

## Results by Category

| Category | Pass | Fail | Avg Score |
|----------|------|------|-----------|
| create | 3/4 | 1 | 0.82 |
| read | 4/5 | 1 | 0.91 |
| ... | | | |

## Improvements vs Baseline
- {test_id}: {from} -> {to} (+{delta})

## Regressions vs Baseline
- {test_id}: {from} -> {to} ({delta})

## Fix Applied
- Pattern: {pattern_name}
- Files: {files}
- Result: {accepted/reverted}

## Top Remaining Issues
1. {pattern} ({N} tests, {votes} votes)
2. ...
3. ...
```

#### Step 12b: Record Fix Outcome

If a fix was applied and verified, record the outcome using FlywheelRecorder:

```javascript
import { createFlywheelRecorder } from './cdp-bench/flywheel/FlywheelRecorder.js';
const recorder = createFlywheelRecorder('improvements.json', 'cdp-bench/baselines/flywheel-history.jsonl');

// Read fix-outcome.json written by the verifier
const outcome = JSON.parse(fs.readFileSync(`${runDir}/fix-outcome.json`, 'utf8'));
recorder.recordFixOutcome(outcome.issueId, outcome.outcome, {
  crank: crankNumber,
  version: outcome.version,
  details: outcome.details,
  filesChanged: outcome.filesChanged,
  shsDelta: outcome.shsDelta
});

// If fix was accepted, also record crank summary
recorder.recordCrankSummary({
  crank: crankNumber,
  shs: newShs,
  shsDelta: newShs - baselineShs,
  testsRun: totalTests,
  passRate: passRate,
  patternsDetected: Object.keys(diagnosis.failurePatterns)
});
```

#### Step 13: Cleanup

```bash
pkill -f "chrome.*remote-debugging-port" 2>/dev/null || true
```

Print final summary and path to full report.

</eval-implementation>

## `--fix-only` Mode

When `--fix-only` is passed:
1. Skip phases 1-3 (measure/validate/diagnose)
2. Read the most recent `diagnosis.json` from the latest run directory
3. Proceed directly to Phase 4 (Fix) → Phase 5 (Verify) → Phase 6 (Report)

Find the latest run:
```bash
ls -1d cdp-bench/runs/*/ | sort | tail -1
```

## Single Test Mode (`--test NNN`)

When `--test NNN` is passed:
1. Find matching `.test.json` file
2. Launch ONE runner agent (no batching)
3. Run validator harness for just that test
4. Print result with milestone details
5. No diagnosis/fix/verify phases

## Directory Structure

```
cdp-bench/
  cdp-bench-eval-skill/
    SKILL.md                         # This file
  flywheel/
    validator-harness.js             # Deterministic milestone verification via CDP
    metrics-collector.js             # I/O byte aggregation and SHS computation
    baseline-manager.js              # Baseline read/write/compare/regression gate
    diagnosis-engine.js              # Result analysis + improvements.json cross-reference
    DecisionEngine.js                # History-aware recommendation re-ranking
    FlywheelRecorder.js              # Fix outcome + crank summary persistence
    prompts/
      runner.md                      # Runner agent prompt template
      diagnostician.md               # Diagnostician prompt template
      fixer.md                       # Fixer prompt template
      verifier.md                    # Verifier prompt template
  tests/
    *.test.json                      # v2 test definitions with milestones
    *.json                           # v1 test definitions (legacy, self-assessed)
    coverage-matrix.json             # Capability coverage tracker
  baselines/
    latest.json                      # Current accepted baseline
    flakiness.json                   # Flakiness data (variance across runs)
    trend.jsonl                      # Historical SHS trend
    flywheel-history.jsonl           # Fix outcome + crank history timeline
    v{version}-{timestamp}.json      # Archived baselines
  runs/
    {timestamp}/
      {test_id}.trace.json           # Raw execution trace (from runner)
      {test_id}.result.json          # Validated result (from harness)
      metrics.jsonl                  # I/O byte metrics from CDP_METRICS_FILE
      validation-summary.json        # Aggregate SHS and scores
      diagnosis.json                 # Failure analysis and recommendations
      summary.md                     # Human-readable report
```

## Agent Team

| Role | Count | Purpose |
|------|-------|---------|
| Conductor | 1 (you) | Orchestrate phases, enforce gates, report |
| Runner | 5-8 (parallel) | Execute tests, write traces |
| Validator | 0 (Node.js script) | Deterministic scoring via CDP |
| Diagnostician | 1 | Analyze failures, recommend fixes |
| Fixer | 0-1 | Implement top fix |
| Verifier | 0-1 | Re-run affected tests, check regression gate |
