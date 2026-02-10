---
name: cdp-bench-eval-skill
description: Run the CDP-Skill improvement flywheel — deterministic browser automation evaluation with automated diagnosis and fix cycles.
user_invocable: true
---

# CDP-Bench Flywheel

Improvement-first evaluation system for cdp-skill. Each "crank turn" selects the highest-impact improvement from `improvements.json`, implements it, then measures and validates the result with regression protection.

## Context Window Safety

**The conductor agent MUST protect its context window.** Previous crashes occurred because runner agent outputs (containing verbose CLI responses with screenshots and snapshots) were read back into the conductor's context via `TaskOutput` or `Read`.

Rules:
1. **Never call `TaskOutput`** on runner agents — their output is irrelevant to the conductor. Runners write trace files to disk.
2. **Never `Read` trace files** unless debugging a specific single-test failure. The validator harness reads them.
3. **Never `Read` validation result files individually.** Use `validation-summary.json` which the harness writes.
4. **Use `head_limit` on Grep/Read** when you must inspect run artifacts — cap at 20-30 lines.
5. **Runner agents are fire-and-forget.** Launch them in background, wait for completion notifications.

## Usage

```
/cdp-bench-eval-skill                     # Full crank: select + fix + measure + validate + record
/cdp-bench-eval-skill --measure           # Measure only (no fix, just score current state)
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

### Phase 1: SELECT (~1 min)

Pick the highest-impact improvement to implement this crank.

#### Step 1: Rank Improvements

Run the DecisionEngine against `improvements.json`:

```bash
node --input-type=module -e '
import { createDecisionEngine } from "./cdp-bench/flywheel/DecisionEngine.js";
import fs from "fs";

const engine = createDecisionEngine("improvements.json", "cdp-bench/baselines/flywheel-history.jsonl");
const data = JSON.parse(fs.readFileSync("improvements.json", "utf8"));

const recs = data.issues
  .filter(i => i.status === "open")
  .map(i => ({
    patternId: i.id,
    name: i.title,
    priority: i.votes,
    votingIds: [i.id],
    count: 1,
    affectedTests: [],
    files: i.files,
    section: i.section,
    symptoms: i.symptoms,
    expected: i.expected,
    workaround: i.workaround
  }));

const ranked = engine.rank(recs);
console.log(JSON.stringify(ranked.slice(0, 5), null, 2));
'
```

#### Step 2: Present Selection

Print the top-ranked improvement to the user:

```
=== CDP-Bench Flywheel: Crank {N} ===
Target: #{id} {title} ({votes} votes, {prior_attempts} prior attempts)
Files: {files}
Symptoms: {symptoms}
```

**If `--measure` flag was set, SKIP to Phase 3 (MEASURE).** No fix phase.

### Phase 2: FIX (~10-15 min)

#### Step 3: Read Improvement Details

Read the full issue entry from `improvements.json` including:
- `symptoms`: What's broken
- `expected`: What should happen
- `workaround`: Known workarounds (indicates the gap)
- `files`: Where to look
- `fixAttempts`: What was tried before (if any — choose a DIFFERENT approach)

If the issue has 3+ consecutive failed attempts (`needsDesignReview: true`), skip it and take the next-ranked improvement.

#### Step 4: Implement the Fix

Read the relevant source files in `cdp-skill/src/`. Understand the current behavior, then implement a targeted, minimal fix following the project's functional style.

#### Step 5: Run Unit Tests

```bash
cd cdp-skill && npm run test:run
```

All existing tests must pass. If any fail due to your change, fix them. If pre-existing, note but don't block.

#### Step 6: Commit the Fix

```bash
git add <specific_files>
git commit -m "fix: <description>

Addresses improvements.json #{id}: {title}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Phase 3: MEASURE (~20-25 min)

#### Step 7: Setup

**Kill existing Chrome and create run directory:**

```bash
pkill -f "chrome.*remote-debugging-port" 2>/dev/null || true
```

```bash
node -e "const id=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);require('fs').mkdirSync('cdp-bench/runs/'+id,{recursive:true});console.log(id)"
```

Use the exact output as `runId`. Set `runDir` = `cdp-bench/runs/${runId}`.

Create a metrics file path: `metricsFile` = `${runDir}/metrics.jsonl`

#### Step 8: Discover Tests

Glob for `.test.json` files in `cdp-bench/tests/`:
- No flag: all `*.test.json` files
- `--test NNN`: prefix match `NNN*.test.json`

#### Step 9: Read Baseline

Read the current baseline:
```
cdp-bench/baselines/latest.json
```

If it exists, note the SHS and per-test scores for comparison. If not, this is the first run.

#### Step 10: Launch Runner Subagents (Waves)

Divide tests into waves of 5 to avoid overwhelming Chrome. **Run only one wave at a time — wait for a wave to complete before launching the next.**

For each wave:

1. Spawn all 5 background Task agents for this wave (`run_in_background: true`). **Discard the output_file path** — you will NOT read it. Read and adapt the prompt from `cdp-bench/flywheel/prompts/runner.md`, substituting:
   - `{{test_file_path}}` = path to the `.test.json` file
   - `{{run_id}}` = the run ID
   - `{{run_dir}}` = the run directory
   - `{{metrics_file}}` = `${runDir}/metrics.jsonl`
   - `{{url}}` = the test's URL
   - `{{test_id}}` = the test's ID

2. **Wait for all 5 agents to complete.** You will receive automatic completion notifications for each agent. Do NOT launch the next wave until all 5 notifications arrive.

3. After all waves, check for missing traces:
```bash
ls ${runDir}/*.trace.json | wc -l
```
If any tests are missing, note them for a retry wave.

**IMPORTANT: Do NOT read runner agent outputs via TaskOutput.** Runner conversations contain verbose CLI output that will overflow the conductor's context window.

**Runner environment:**
```bash
export CDP_METRICS_FILE="${runDir}/metrics.jsonl"
```

### Phase 4: VALIDATE + SCORE + EXTRACT (~2 min)

#### Step 11: Validate + Score + Extract Feedback

The CrankOrchestrator handles all validation, scoring, regression gate, and feedback extraction in a single command:

```bash
node cdp-bench/flywheel/CrankOrchestrator.js --phase validate \
  --run-dir ${runDir} --tests-dir cdp-bench/tests \
  --improvements improvements.json --baselines-dir cdp-bench/baselines \
  --port 9222 --version ${version} --crank ${crankNumber}
```

This:
- Validates each test (snapshot-first from trace data, live CDP fallback)
- Computes SHS and per-test scores
- Runs regression gate against baseline
- Extracts and deduplicates runner feedback
- Writes `validate-result.json`, `validation-summary.json`, per-test `.result.json`, `extracted-feedback.json`

Read stdout JSON — check `gate` field (`"passed"` or `"failed"`) and `feedbackExtracted` count.

If gate **fails** and a fix was applied in Phase 2:
- Revert the fix commit: `git revert HEAD --no-edit`
- Use `--fix-outcome reverted` in Step 13

### Phase 5: FEEDBACK MATCHING + RECORD (~3 min)

#### Step 12: LLM Feedback Matching

Spawn ONE **background** Task agent (subagent_type: `general-purpose`) with the `cdp-bench/flywheel/prompts/feedback-matcher.md` prompt, substituting:
- `{{run_dir}}` = the run directory path
- `{{improvements_path}}` = `improvements.json`

**Do NOT read the subagent's output** — poll for the file on disk instead:
```bash
ls ${runDir}/match-decisions.json
```

The subagent reads `extracted-feedback.json` + `improvements.json` and writes `${runDir}/match-decisions.json`.

#### Step 13: Record + Apply + Baseline

After `match-decisions.json` exists, run the record phase:

```bash
node cdp-bench/flywheel/CrankOrchestrator.js --phase record \
  --run-dir ${runDir} --tests-dir cdp-bench/tests \
  --improvements improvements.json --baselines-dir cdp-bench/baselines \
  --version ${version} --crank ${crankNumber} \
  --fix-issue ${issueId} --fix-outcome ${outcome}
```

Omit `--fix-issue` and `--fix-outcome` if this is a `--measure` run with no fix.

This:
- Applies feedback (upvotes matched issues, creates new ones from unmatched)
- Records fix outcome + crank summary to `flywheel-history.jsonl`
- Updates baseline + trend (if gate passed)
- Rebuilds dashboard dataset
- Writes `crank-summary.json`

Read stdout JSON for the final crank result.

### Phase 6: REPORT

#### Step 17: Print Summary

```
=== CDP-Bench Flywheel: Crank {N} Complete ===
Fix: #{id} {title} → {outcome}
SHS: {old} → {new} (delta: {delta})
Tests: {passed}/{total} passed
Regression gate: {pass/fail}

--- Runner Feedback ---
{total} feedback entries from {trace_count} traces ({deduped} unique)
Matched to existing issues: {matched_count} (upvoted: {upvoted_list})
New feedback: {unmatched_count} ({created_count} auto-created as issues)
```

If no feedback was collected, note: "No feedback collected — runners should populate the feedback array in traces."

#### Step 18: Cleanup

```bash
pkill -f "chrome.*remote-debugging-port" 2>/dev/null || true
```

</eval-implementation>

## `--measure` Mode

When `--measure` is passed:
1. Skip Phase 1-2 (SELECT/FIX) — no code changes
2. Go directly to Phase 3 (MEASURE) → Phase 4 (VALIDATE) → Phase 6 (REPORT)
3. Run diagnosis engine to detect patterns and produce recommendations for reference

## Single Test Mode (`--test NNN`)

When `--test NNN` is passed:
1. Find matching `.test.json` file
2. Launch ONE runner agent (no batching)
3. Run validator harness for just that test
4. Print result with milestone details
5. No fix/record phases

## Directory Structure

```
cdp-bench/
  cdp-bench-eval-skill/
    SKILL.md                         # This file
  flywheel/
    CrankOrchestrator.js             # Two-phase orchestrator (validate + record)
    VerificationSnapshot.js          # Offline snapshot capture + evaluation
    CaptureVerification.js           # CLI: runner captures snapshot before trace
    validator-harness.js             # Deterministic milestone verification (snapshot-first + live CDP)
    metrics-collector.js             # I/O byte aggregation and SHS computation
    baseline-manager.js              # Baseline read/write/compare/regression gate
    diagnosis-engine.js              # Result analysis + improvements.json cross-reference
    DecisionEngine.js                # History-aware recommendation re-ranking
    FlywheelRecorder.js              # Fix outcome + crank summary persistence
    feedback-constants.js            # Shared constants (area mappings, normalization helpers)
    FeedbackExtractor.js             # Extract + normalize + dedup feedback from traces
    FeedbackApplier.js               # Apply match decisions to improvements.json
    prompts/
      runner.md                      # Runner agent prompt template
      diagnostician.md               # Diagnostician prompt template
      fixer.md                       # Fixer prompt template
      verifier.md                    # Verifier prompt template
      feedback-matcher.md            # LLM feedback matching prompt template
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
      {test_id}.trace.json           # Raw execution trace (from runner, includes verificationSnapshot)
      {test_id}.result.json          # Validated result (from CrankOrchestrator validate)
      metrics.jsonl                  # I/O byte metrics from CDP_METRICS_FILE
      validate-result.json           # Phase 1 output: SHS, gate, feedback count
      validation-summary.json        # Aggregate SHS and scores (detailed)
      extracted-feedback.json        # Normalized feedback (from FeedbackExtractor)
      match-decisions.json           # LLM match decisions (from matching subagent)
      feedback-summary.json          # Applied feedback report (from FeedbackApplier)
      crank-summary.json             # Phase 2 output: final crank results
```

## Agent Team

| Role | Count | Purpose |
|------|-------|---------|
| Conductor | 1 (you) | Select improvement, implement fix, orchestrate measure/validate, enforce gates, record outcome |
| Runner | 5-8 (parallel) | Execute tests, write traces |
| Validator | 0 (Node.js script) | Deterministic scoring via CDP |
