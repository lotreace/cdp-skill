# CDP Browser Automation - Project Instructions

## Project Goal

**Make this project amazingly effective** - the CDP skill should be the most reliable, efficient, and intuitive browser automation tool for Claude Code agents. Every feature should reduce round trips, provide clear feedback, and just work.

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

## Documentation

After any code change affecting how agents use the JS code, make sure that `SKILL.md` is up to date. This can be done at the end of the implementation.

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
