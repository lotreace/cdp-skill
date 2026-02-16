---
name: cdp-bench-eval-skill
description: Run the CDP-Skill improvement flywheel — deterministic browser automation evaluation with automated diagnosis and fix cycles.
user_invocable: true
---

# CDP-Bench Flywheel

Each crank turn: select improvement, fix it, measure, validate, record.

## Usage

```
/cdp-bench-eval-skill                     # Full crank: select + fix + measure + validate + feedback + report
/cdp-bench-eval-skill --measure           # Measure-only: measure + validate + feedback + report (no fix)
/cdp-bench-eval-skill --test 001          # Single test: measure one test + report (no fix/record)
/cdp-bench-eval-skill --test 001 --debug  # Single test with debug logging
```

## Bootstrap Variables

Set these once at the start of every invocation. **All commands run from ROOT.**

```bash
ROOT="/Users/lotreace/projects/cdp-skill"
cd $ROOT
```

Derive these values (run as separate commands, capture output):

| Variable | Command |
|----------|---------|
| `version` | `node -p "require('./cdp-skill/package.json').version"` |
| `crankNumber` | `node -e "const fs=require('fs');const p='cdp-bench/baselines/flywheel-history.jsonl';const s=fs.existsSync(p)?fs.readFileSync(p,'utf8').trim():'';const l=s?s.split('\n').filter(Boolean):[];const c=l.map(x=>JSON.parse(x)).filter(e=>e.crank!=null);console.log(c.length?Math.max(...c.map(x=>x.crank))+1:1)"` |
| `runId` | `node -e "console.log(new Date().toISOString().replace(/[:.]/g,'-').slice(0,19))"` |
| `runDir` | `cdp-bench/runs/${runId}` — then `mkdir -p ${runDir}` |

## Mode → Phase Mapping

| Mode | SELECT | FIX | MEASURE | VALIDATE | FEEDBACK | REPORT |
|------|--------|-----|---------|----------|----------|--------|
| (default) | yes | yes | yes | yes | yes | yes |
| `--measure` | no | no | yes | yes | yes | yes |
| `--test NNN` | no | no | yes (1 test) | yes | no | yes |

Determine mode from flags **before** entering any phase. Skip phases marked "no".

<eval-implementation>

## Phase 1: SELECT

Pick the highest-impact open improvement.

### Step 1: Rank Improvements

Run from `$ROOT`:

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

const { recommendations, needsDesignReview } = engine.rank(recs);
console.log(JSON.stringify({ top5: recommendations.slice(0, 5), needsDesignReview: needsDesignReview.slice(0, 3) }, null, 2));
'
```

**Note:** `engine.rank()` returns `{ recommendations, needsDesignReview }`. `recommendations` is sorted by priority (highest first). `needsDesignReview` contains issues with 3+ consecutive failed attempts.

### Step 2: Present Selection

Pick the first viable recommendation. Print:

```
=== CDP-Bench Flywheel: Crank ${crankNumber} ===
Target: #${id} ${title} (${votes} votes, ${prior_attempts} prior attempts)
Files: ${files}
Symptoms: ${symptoms}
```

Save `issueId` for use in Phase 5.

## Phase 2: FIX

### Step 3: Read Improvement Details

Read the full issue from `improvements.json`:
- `symptoms`, `expected`, `workaround`, `files`
- `fixAttempts` — if any exist, choose a DIFFERENT approach

### Step 4: Implement the Fix

Read relevant source files in `cdp-skill/scripts/`. Implement a targeted, minimal fix following the project's functional style.

### Step 5: Run Unit Tests

```bash
cd cdp-skill && npm run test:run
```

All tests must pass. Fix any failures caused by your change. Pre-existing failures: note but don't block.

### Step 6: Commit

```bash
git add <specific_files>
git commit -m "fix: <description>

Addresses improvements.json #${issueId}: ${title}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

## Phase 3: MEASURE

### Step 7: Kill Chrome

```bash
pkill -f "chrome.*remote-debugging-port" 2>/dev/null || true
```

### Step 8: Discover Tests

Use the Glob tool to find test files in `cdp-bench/tests/`:
- No flag: all `*.test.json` files
- `--test NNN`: only files matching `NNN*.test.json`

### Step 9: Read Baseline

Read `cdp-bench/baselines/latest.json`. Note current SHS and per-test scores for comparison. If missing, this is the first run.

### Step 10: Launch Runner Agents

Read the prompt template from `cdp-bench/flywheel/prompts/runner.md`. For each test, substitute:

| Variable | Value |
|----------|-------|
| `{{test_file_path}}` | Absolute path to `.test.json` file |
| `{{run_dir}}` | Absolute path: `${ROOT}/${runDir}` |
| `{{test_id}}` | The test's `id` field |

Spawn ALL runners in a single message with multiple Task tool calls (`subagent_type: "general-purpose"`, `run_in_background: true`). **Discard `output_file` paths — never read them.**

Wait for all completion notifications. Then check for missing traces:

```bash
ls ${runDir}/*.trace.json | wc -l
```

If any tests are missing, spawn retry agents for those only.

> **CONTEXT WINDOW SAFETY**: Never call `TaskOutput` on runner agents. Never `Read` trace files. Runner output contains verbose CLI screenshots/snapshots that will overflow the conductor's context.

> **RUNNERS ARE READ-ONLY**: Do not weaken the restrictions in `runner.md`. Runners must not modify code or run git commands.

## Phase 4: VALIDATE

### Step 11: Run CrankOrchestrator Validate

```bash
node cdp-bench/flywheel/CrankOrchestrator.js --phase validate \
  --run-dir ${runDir} --tests-dir cdp-bench/tests \
  --improvements improvements.json --baselines-dir cdp-bench/baselines \
  --version ${version} --crank ${crankNumber}
```

This validates traces, computes SHS, extracts feedback. Read stdout JSON — note `shs`, `shsDelta`, `feedbackExtracted`.

## Phase 5: FEEDBACK

### Step 12: LLM Feedback Matching

Spawn ONE background Task agent (`subagent_type: "general-purpose"`) with the prompt from `cdp-bench/flywheel/prompts/feedback-matcher.md`, substituting:

| Variable | Value |
|----------|-------|
| `{{run_dir}}` | Absolute path: `${ROOT}/${runDir}` |
| `{{improvements_path}}` | `${ROOT}/improvements.json` |

**Do NOT read subagent output.** Poll for the output file:

```bash
ls ${runDir}/match-decisions.json 2>/dev/null
```

### Step 13: Run CrankOrchestrator Record

After `match-decisions.json` exists:

**Full crank** (has a fix):
```bash
node cdp-bench/flywheel/CrankOrchestrator.js --phase record \
  --run-dir ${runDir} --tests-dir cdp-bench/tests \
  --improvements improvements.json --baselines-dir cdp-bench/baselines \
  --version ${version} --crank ${crankNumber} \
  --fix-issue ${issueId} --fix-outcome ${outcome}
```

Where `outcome` is `fixed` (SHS stable or improved) or `failed` (SHS dropped).

**Measure-only** (no fix):
```bash
node cdp-bench/flywheel/CrankOrchestrator.js --phase record \
  --run-dir ${runDir} --tests-dir cdp-bench/tests \
  --improvements improvements.json --baselines-dir cdp-bench/baselines \
  --version ${version} --crank ${crankNumber}
```

Read stdout JSON for crank result.

## Phase 6: REPORT

### Step 14: Print Summary

```
=== CDP-Bench Flywheel: Crank ${crankNumber} Complete ===
Fix: #${issueId} ${title} → ${outcome}    (omit line for --measure)
SHS: ${oldShs} → ${newShs} (delta: ${delta})
Tests: ${passed}/${total} passed

--- Runner Feedback ---
${feedbackExtracted} entries from ${traceCount} traces
Matched: ${matched} | New issues: ${newIssues} | Upvoted: ${upvoted}
```

If no feedback: "No runner feedback collected."

### Step 15: Cleanup

```bash
pkill -f "chrome.*remote-debugging-port" 2>/dev/null || true
```

</eval-implementation>

## Single Test Mode (`--test NNN`)

Simplified flow — no fix, no feedback matching, no recording:

1. Bootstrap variables (above, but `crankNumber` not needed)
2. Kill Chrome (Step 7)
3. Find matching test: Glob for `cdp-bench/tests/${NNN}*.test.json`
4. Launch ONE runner agent (`run_in_background: true`, wait for completion notification)
5. Run CrankOrchestrator validate (Step 11)
6. Print per-milestone results and score
7. Cleanup (Step 15)
