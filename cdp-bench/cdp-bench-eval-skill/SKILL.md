---
name: cdp-bench-eval-skill
description: Run browser automation evaluation tests against live sites. Tests are self-assessed by agents for quantitative improvement tracking.
user_invocable: true
---

# CDP-Bench Eval Skill

Run evaluation tests for cdp-skill browser automation. Tests execute against live websites and agents self-assess their performance.

## Usage

```
/cdp-bench-eval-skill                     # Run all tests
/cdp-bench-eval-skill read                # Run tests by category
/cdp-bench-eval-skill 000-acehardware     # Run a single test by ID prefix
/cdp-bench-eval-skill --baseline          # Save results as baseline for current version
```

## Test File Format

Tests are JSON files in `cdp-bench/tests/`:

```json
{
  "id": 0,
  "url": "https://www.acehardware.com",
  "category": "read",
  "task": "Search for 'LED light bulbs' and list titles and prices of the first 5 products."
}
```

**Categories:** `read`, `create`, `update`, `delete`, `file_manipulation`

**Source:** Tests extracted from [WebBench](https://huggingface.co/datasets/Halluminate/WebBench) (5,293 tasks across 449 sites). Raw data in `cdp-bench/webbench-raw.csv`.

## Result File Schema

Each subagent writes its result to `cdp-bench/runs/{timestamp}/{test_id}.json`:

```json
{
  "test_id": "000-acehardware-read",
  "run_id": "2026-02-01T12-30-00",
  "skill_version": "1.0.2",
  "timestamp": "2026-02-01T12:30:45.123Z",
  "outcome": {
    "success": true,
    "score": 0.85,
    "failure_reason": null
  },
  "metrics": {
    "steps": 8,
    "time_ms": 12500
  },
  "observations": ["Site uses React"],
  "improvements": [
    {"category": "waits", "description": "Need longer wait for dynamic content", "severity": "low"}
  ],
  "bugs": [
    {"component": "fill", "description": "Input not accepting text", "reproducible": true}
  ]
}
```

## Improvement Categories

- `selectors` - CSS/ARIA selector robustness
- `waits` - Wait timing, network idle, DOM stability
- `observations` - Snapshot usage, page state understanding
- `actions` - Click/fill/type execution reliability
- `error_handling` - Recovery from failures
- `navigation` - URL changes, redirects
- `extraction` - Data extraction, parsing
- `other` - Agent-proposed new categories

## Implementation

<eval-implementation>

### Main Agent Steps

#### Step 1: Setup

**Kill any existing Chrome instances** to ensure fresh headless mode:

```bash
pkill -f "chrome.*remote-debugging-port" 2>/dev/null || true
```

**Generate timestamp and create folder atomically**:

```bash
node -e "const id=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);require('fs').mkdirSync('cdp-bench/runs/'+id,{recursive:true});console.log(id)"
```

Use the exact output as `runId`.

#### Step 2: Discover Tests

Glob for matching `.json` files in `cdp-bench/tests/`:
- No argument: `cdp-bench/tests/*.json` (all tests)
- Category: filter by `category` field matching argument
- Test ID: `cdp-bench/tests/{arg}*.json` (prefix match)
- `--baseline`: note flag for finalizer

#### Step 3: Launch Test Subagents

For each test file, spawn a background Task agent with `run_in_background: true`.

**Subagent prompt template:**
```
You are a cdp-bench test runner. Execute ONE test and write results.

## Your Test
- File: {test_file_path}
- Run ID: {runId}
- Run Dir: {runDir}

## Instructions

1. **Read the test file** at {test_file_path}
2. **Read cdp-skill docs** at cdp-skill/SKILL.md
3. **Execute the test** using cdp-skill with headless mode:

```json
{"config": {"headless": true}, "steps": [{"goto": "{url}"}]}
```

4. **Self-assess**: Did you complete the task? Score 0.0-1.0
5. **Write result** to `{runDir}/{test_filename_without_ext}.json`
6. **Update VOTING.md** if you found bugs (increment votes or add new issue)
7. **Return summary**:

   RESULT: {test_id} | {PASS or FAIL} | score={0.00-1.00}
```

#### Step 4: Collect Responses

As subagents complete, collect one-line summaries:
```
RESULT: 000-acehardware-read | PASS | score=1.00
RESULT: 003-agoda-create | FAIL | score=0.20
```

#### Step 5: Launch Finalizer Subagent

Once all test subagents complete, spawn ONE finalizer agent:

```
You are the cdp-bench finalizer. Generate summary from result files.

## Run Info
- Run ID: {runId}
- Run Dir: {runDir}
- Baseline flag: {true/false}

## Instructions

1. **Read all result files** from {runDir}/*.json
2. **Generate summary.md** with:
   - Overview (total, passed, failed, pass rate)
   - Results table by category
   - Aggregated improvements and bugs
3. **Write summary** to {runDir}/summary.md
4. **If baseline flag**: copy results to cdp-bench/baselines/v{version}.jsonl
5. **Return summary stats**
```

#### Step 6: Report to User

Print final summary from finalizer response.

#### Step 7: Cleanup

**Stop Chrome when finished**:

```bash
pkill -f "chrome.*remote-debugging-port" 2>/dev/null || true
```

</eval-implementation>

## Example Workflow

```bash
# Run all evaluation tests
/cdp-bench-eval-skill

# Output:
# Creating run: 2026-02-01T12-30-00
# Discovering tests... found 25 tests
#
# Launching 25 test agents...
# ✓ 000-acehardware-read | PASS | 1.00
# ✓ 001-acehardware-read | PASS | 0.90
# ✗ 003-agoda-create | FAIL | 0.20
# ...
#
# Launching finalizer...
# Summary written to: cdp-bench/runs/2026-02-01T12-30-00/summary.md
#
# Results: 18/25 passed (72.0%)
```

## Directory Structure

```
cdp-bench/
├── cdp-bench-eval-skill/
│   └── SKILL.md
├── tests/
│   ├── 000-acehardware-read.json
│   ├── 001-acehardware-read.json
│   ├── ...
│   └── v1/                        # Legacy .eval.md tests
├── runs/
│   └── {timestamp}/
│       ├── 000-acehardware-read.json
│       └── summary.md
├── baselines/
│   └── v{version}.jsonl
├── webbench-raw.csv               # Source: 5,293 tasks
├── VOTING.md
└── VISION.md
```
