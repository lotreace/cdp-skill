# Runner Agent Prompt

Execute ONE browser automation test and write a trace file.

## RESTRICTIONS

- You are READ-ONLY. Do NOT modify source code, run git commands, or "fix" bugs.
- You may ONLY create ONE file: `{{run_dir}}/{{test_id}}.trace.json`
- Do NOT create any other files.

## Your Test

- **Test File:** {{test_file_path}}
- **Run Directory:** {{run_dir}}

## Steps

### 1. Read Test Definition

Read `{{test_file_path}}`. Note the `id`, `url`, `task`, `milestones`, and `budget`.

**CRITICAL**: The test's `id` field (e.g., `024-demoqa-forms`) may differ from the filename (e.g., `024-demoqa.test.json`). Always use the `id` field from inside the JSON for the trace filename and testId — never derive it from the filename.

### 2. Read cdp-skill Docs

Read `cdp-skill/SKILL.md` for CLI reference.

### 3. Execute Test

**Always use headless mode:**

```bash
node cdp-skill/scripts/cdp-skill.js '{"steps": [{"newTab": {"url": "...", "headless": true}}]}'
```

Work through the task. Stay within the step budget.

### 4. Verify Milestones

After completing the task, verify each milestone from the test definition. For each milestone's `verify` block:

- `url_contains` → Check current URL
- `dom_exists` → Check element exists
- `eval_truthy` → Evaluate JS expression

Use cdp-skill to verify:
```bash
node cdp-skill/scripts/cdp-skill.js '{"steps": [{"pageFunction": "() => document.title.includes(\"text\")"}]}' --tab tN
```

### 5. Write Trace

Write `{{run_dir}}/{{test_id}}.trace.json` with **exactly** this structure:

```json
{
  "testId": "{{test_id}}",
  "wallClockMs": 12345,
  "milestoneResults": {
    "milestone_id_1": true,
    "milestone_id_2": false
  },
  "feedback": []
}
```

**THE TRACE FILE MUST HAVE EXACTLY THESE 4 FIELDS. NO OTHER FIELDS.**

- **testId**: String. The test ID exactly as shown above.
- **wallClockMs**: Number. Total execution time in milliseconds.
- **milestoneResults**: Object. A map of milestone ID → boolean. Every milestone from the test definition MUST have an entry. Use `true` if it passed verification, `false` if it failed. **This is the ONLY way your score is recorded. If this field is missing or malformed, your test scores zero.**
- **feedback**: Array. At least one entry: `{"type": "bug|improvement|workaround", "area": "...", "title": "...", "detail": "..."}`

**DO NOT** add extra fields like `tab`, `tabId`, `cliCalls`, `steps`, `milestones`, `score`, `status`, `startTime`, `endTime`, etc. The trace must contain ONLY the 4 fields above.

### 6. Return Summary

ONE line:
```
TRACE: {{test_id}} | milestones=X/Y | wallClock=Zms
```
