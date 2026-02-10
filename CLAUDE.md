# CDP Browser Automation - Project Instructions

## Project Goal

**Make this project amazingly effective** - the CDP skill should be the most reliable, efficient, and intuitive browser automation tool for Claude Code agents. Every feature should reduce round trips, provide clear feedback, and just work.

## CDP-Bench Eval System

The `cdp-bench/` directory contains a **quantitative evaluation system** for measuring and improving cdp-skill reliability.

- **`/cdp-bench-eval-skill` skill**: Run tests via `/cdp-bench-eval-skill`, `/cdp-bench-eval-skill <category>`, or `/cdp-bench-eval-skill <test-id>`
- **Test files**: `cdp-bench/tests/**/*.eval.md` - YAML frontmatter + markdown prose
- **Results**: `cdp-bench/runs/{timestamp}/results.jsonl` - structured test outcomes
- **Baselines**: `cdp-bench/baselines/v{version}.jsonl` - known-good states per version

The eval flywheel: Run tests → Identify weaknesses → Fix skill → Measure improvement → Repeat.

See `cdp-bench/VISION.md` for goals and `cdp-bench/PHASE-2.md` / `cdp-bench/PHASE-3.md` for roadmap.

## Code Style

**This repository uses a FUNCTIONAL programming style, not OOP.**

- Prefer pure functions over classes
- Use factory functions that return objects with methods when state is needed
- Avoid `class` keyword - use closures and function composition instead
- Keep functions small and focused
- Use dependency injection via function parameters

Example pattern (preferred):
```javascript
export function createActionabilityChecker(session) {
  const retryDelays = [0, 20, 100, 100, 500];

  async function waitForActionable(selector, actionType, options) {
    // implementation
  }

  return { waitForActionable };
}
```

NOT:
```javascript
export class ActionabilityChecker {
  constructor(session) { ... }
  async waitForActionable() { ... }
}
```

## Shared Utilities

Common utilities should be in `src/utils.js`:
- `sleep(ms)` - Promise-based delay
- `releaseObject(session, objectId)` - CDP object cleanup
- `resetInputState(session)` - Reset mouse/keyboard state

## Testing Notes

**Do not use example.com for testing** - it doesn't route anywhere useful. Use real websites like google.com, wikipedia.org, or dedicated test sites.

## Quality Mindset

Whenever you are testing the skill text or skill code for this project, be extra vigilant for things that should not be the case and investigate them. We are building and polishing the best CDP skill in the galaxy and that means we need to be extra perceptive, critical, and awake.

## No Backwards Compatibility

When implementing new or updating existing code in this project, do not maintain any backwards compatibility or legacy formats. The usage of the skill and code do not rely on persisting formats over time. If you think support for something should be kept, raise it as a question.

## Documentation

After any code change affecting how agents use the JS code, make sure that `SKILL.md` is up to date. This can be done at the end of the implementation.

## Step Protocol

The step protocol (validate → execute → document) touches many files. When adding, renaming, or merging steps:

**Files checklist:**
1. `context-helpers.js` — STEP_TYPES, VISUAL_ACTIONS, buildActionContext
2. `step-validator.js` — validation case
3. `step-executors.js` — execution branch
4. `types.js` — StepConfig typedef
5. `cdp-skill.js` — actionKeys in generateDebugFilename
6. `diagnosis-engine.js` — hardcoded step name patterns
7. `coverage-matrix.json` — step name keys
8. Tests: StepValidator.test.js, ContextHelpers.test.js, TestRunner.test.js
9. Docs: SKILL.md, EXAMPLES.md, SPEC.md, README.md

**Validation rules:**
- Validators for union types (string | number | object) must end with a catch-all `else` clause. Never enumerate only specific rejection cases like `null || undefined` — unexpected types like `boolean` slip through silently.
- When a step accepts both `{selector: value}` data mappings and option keys (`clear`, `react`, `force`), filter out option keys before validating that at least one real mapping exists.

**Shape detection for unified steps:**
- Check most-specific shapes first (presence of targeting keys like `selector`/`ref`, special keys like `fields`), generic fallback last.
- Keep internal executor functions intact when merging steps — only the step-level routing changes. This minimizes diff and avoids retesting proven code.

## String Classification

When detecting whether a string is a JS keyword vs an identifier (e.g., distinguishing `async () =>` from `asyncStorage.getItem()`), always require a word boundary after the keyword:
```javascript
// WRONG: matches identifiers like asyncStorage, functionName
str.startsWith('async')

// RIGHT: keyword must be followed by whitespace or punctuation
/^async[\s(]/.test(str)
```

## Memory Management

Always release CDP objectIds when done:
```javascript
try {
  const objectId = await findElement(selector);
  // use objectId
} finally {
  await releaseObject(session, objectId);
}
```
