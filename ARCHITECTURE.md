# CDP-Skill Architecture

**Version:** 1.0.11
**Last Updated:** 2026-02-10

## Overview

CDP-Skill is a browser automation tool built on Chrome DevTools Protocol (CDP). It follows a **functional programming** architecture using factory functions, dependency injection, and composition over inheritance.

## Core Principles

### 1. Functional Style
- **No classes** - Use factory functions that return objects with methods
- **Closures for state** - Encapsulate state within factory function scope
- **Pure functions** - Prefer stateless, testable functions
- **Dependency injection** - Pass dependencies as function parameters

**Example Pattern:**
```javascript
export function createPageController(session, options = {}) {
  const timeout = options.timeout || 30000;

  async function navigate(url) {
    // implementation using session
  }

  return { navigate, session, timeout };
}
```

### 2. Dependency Injection
All modules receive their dependencies as parameters, enabling:
- Easy testing with mocks
- Clear dependency graphs
- Runtime composition
- No global state

### 3. Resource Cleanup
Always release CDP objectIds when done:
```javascript
try {
  const objectId = await findElement(selector);
  // use objectId
} finally {
  await releaseObject(session, objectId);
}
```

## Module Structure

```
src/
├── cdp-skill.js           # CLI entry point
├── index.js               # Public API exports
├── types.js               # TypeScript-style JSDoc types
├── constants.js           # Shared constants
├── utils.js               # Shared utilities
├── aria.js                # ARIA snapshot and role queries
├── diff.js                # DOM diffing utilities
│
├── cdp/                   # CDP Protocol Layer
│   ├── connection.js      # WebSocket connection management
│   ├── browser.js         # Browser client (connect, pages, sessions)
│   ├── discovery.js       # Chrome instance discovery
│   ├── target-and-session.js  # Target/session management
│   └── index.js           # CDP public exports
│
├── page/                  # Page-level Operations
│   ├── page-controller.js # Main page orchestrator
│   ├── cookie-manager.js  # Cookie operations
│   ├── web-storage-manager.js  # localStorage/sessionStorage
│   ├── wait-utilities.js  # Wait helpers
│   ├── dom-stability.js   # DOM stability detection
│   └── index.js           # Page public exports
│
├── dom/                   # DOM Interaction Layer
│   ├── element-locator.js # CSS/XPath element finding
│   ├── element-handle.js  # DOM element wrapper
│   ├── element-validator.js  # Element state validation
│   ├── actionability.js   # Actionability checks (visible, enabled, etc.)
│   ├── click-executor.js  # Click operations
│   ├── fill-executor.js   # Fill/type operations
│   ├── input-emulator.js  # Low-level input simulation
│   ├── keyboard-executor.js  # Keyboard operations
│   ├── wait-executor.js   # Wait strategies
│   ├── react-filler.js    # React-specific fill handling
│   ├── quad-helpers.js    # Coordinate/quad utilities
│   └── index.js           # DOM public exports
│
├── capture/               # Debugging & Monitoring
│   ├── screenshot-capture.js  # Screenshot generation
│   ├── pdf-capture.js     # PDF generation
│   ├── console-capture.js # Console message capture
│   ├── network-capture.js # Network event capture
│   ├── error-aggregator.js  # Error collection
│   ├── debug-capture.js   # Debug output generation
│   ├── eval-serializer.js # Runtime.evaluate result serialization
│   └── index.js           # Capture public exports
│
├── runner/                # Test Runner & Step Execution
│   ├── step-registry.js   # Step type registry (NEW in v1.0.10)
│   ├── step-validator.js  # Step validation (simplified)
│   ├── step-executors.js  # Step execution dispatcher
│   ├── context-helpers.js # Step context building
│   ├── execute-browser.js # Browser-level steps (pdf, console, etc.)
│   ├── execute-navigation.js  # Navigation steps (goto, reload, etc.)
│   ├── execute-interaction.js  # Interaction steps (click, hover, etc.)
│   ├── execute-form.js    # Form steps (fill, submit, etc.)
│   ├── execute-input.js   # Input steps (fillActive, press, etc.)
│   ├── execute-query.js   # Query steps (query, queryAll, etc.)
│   ├── execute-dynamic.js # Dynamic steps (pageFunction, poll, etc.)
│   └── index.js           # Runner public exports
│
└── tests/                 # Unit Tests (1,185+ tests)
    ├── Aria.test.js       # ARIA module tests (55 tests)
    ├── StepValidator.test.js  # Step validation tests
    ├── *.test.js          # Component-specific tests
    └── integration.test.js  # Integration tests
```

## Step Protocol

The step protocol is the core abstraction for browser automation. Each step goes through:

**1. Validation** → **2. Execution** → **3. Documentation**

### Adding a New Step

When adding a new step (e.g., `dragAndDrop`), update these files:

1. **`runner/step-registry.js`** — Add to step registry with metadata
2. **`runner/context-helpers.js`** — Add to `STEP_TYPES` array
3. **`runner/step-validator.js`** — Add validation case
4. **`runner/step-executors.js`** — Add execution branch
5. **`types.js`** — Add `StepConfig` typedef
6. **`cdp-skill.js`** — Add to `actionKeys` in `generateDebugFilename`
7. **Tests** — Add test cases to `StepValidator.test.js`
8. **Docs** — Update `SKILL.md`, `EXAMPLES.md`, `README.md`

### Step Validation Rules

- **Union types** (string | number | object) must have catch-all `else` clause
- **Null safety**: Always check `typeof params === 'object' && params !== null`
- **Shape detection**: Check most-specific shapes first, generic fallback last
- **Option filtering**: Filter out option keys before validating data mappings

**Example:**
```javascript
case 'newStep':
  if (typeof params === 'string') {
    // Handle string variant
  } else if (typeof params === 'object' && params !== null) {
    // Handle object variant
    if (!params.required) {
      errors.push('newStep requires required field');
    }
  } else {
    errors.push('newStep requires string or params object');
  }
  break;
```

## Key Design Patterns

### Factory Functions

Every module exports factory functions, not classes:

```javascript
// ✅ Correct
export function createElementLocator(session, options) {
  async function querySelector(selector) { /*...*/ }
  async function querySelectorAll(selector) { /*...*/ }
  return { querySelector, querySelectorAll };
}

// ❌ Avoid
export class ElementLocator {
  constructor(session, options) { /*...*/ }
}
```

### Dependency Injection

Dependencies flow from outer layers to inner layers:

```
CLI (cdp-skill.js)
  ↓ injects
PageController
  ↓ injects
ElementLocator, ClickExecutor, FillExecutor
  ↓ use
CDP Session
```

### Context Helpers

The `context-helpers.js` module builds execution context for each step:

- **Visual actions** (click, hover, scroll) → Capture screenshot + snapshot
- **Form actions** (fill, submit) → Capture form state
- **Navigation actions** (goto, reload) → Capture URL + title
- **Query actions** (query, snapshot) → Capture results

### Error Handling

- **Graceful degradation** - Try native operations first, fallback to JavaScript
- **Detailed errors** - Include selector, action, and context in error messages
- **Resource cleanup** - Always release CDP objects even on error
- **Timeout management** - Configurable timeouts with sensible defaults

## Frame Context Support

All CDP operations support iframe context via `getFrameContext()`:

```javascript
const contextId = getFrameContext ? getFrameContext() : null;
await session.send('Runtime.evaluate', {
  expression: 'document.querySelector("button")',
  ...(contextId && { contextId })  // Inject contextId if in iframe
});
```

**Files with frame context support:**
- `page-controller.js` - Provides `getFrameContext()` and `evaluateInFrame()`
- `element-locator.js` - Injects contextId into Runtime.evaluate
- `aria.js` - Supports ARIA snapshots within iframes
- `click-executor.js` - Clicks within iframe context
- All `execute-*.js` modules - Use pageController's frame-aware methods

## Testing Strategy

### Unit Tests
- **1,185+ tests** across 29 test files
- Mock CDP `session.send()` calls
- Test both success and error paths
- Verify resource cleanup

### Test Patterns
```javascript
import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('MyModule', () => {
  let mockSession;

  beforeEach(() => {
    mockSession = {
      send: mock.fn(async () => ({ result: {} }))
    };
  });

  it('should handle success', async () => {
    mockSession.send = mock.fn(async () => ({
      result: { objectId: 'obj-123' }
    }));

    const result = await myFunction(mockSession);
    assert.ok(result);
  });
});
```

### Integration Tests
- Test runner with mock dependencies
- Error aggregation pipeline
- Complete step execution flows

## Performance Considerations

### Actionability Checks
Progressive retry delays: `[0, 20, 100, 100, 500]ms`
- Fast initial check (0ms)
- Quick retry (20ms)
- Standard retries (100ms)
- Final attempt (500ms)

### Resource Management
- Release CDP objectIds immediately after use
- Reuse sessions across steps
- Batch operations when possible
- Limit snapshot depth/elements

### Network Optimization
- Connection pooling via WebSocket
- Minimize protocol round-trips
- Parallel CDP commands where safe

## Reliability Improvements (v1.0.9-v1.0.11)

### Null Pointer Fixes (v1.0.11)
- Fixed 3 critical crashes in `step-validator.js` (lines 71, 282, 391)
- Added null checks in `execute-input.js` and `execute-dynamic.js`
- Pattern: Always use `typeof params === 'object' && params !== null`

### Iframe Context Support (v1.0.9)
- Added `getFrameContext()` to pageController
- Injected `contextId` into all Runtime.evaluate calls
- Fixed 15 iframe-related test failures

### Step Simplification (v1.0.10)
- Reduced from 47 steps to 41 steps
- Merged: fill/fillActive/fillForm → fill
- Merged: switchToFrame/switchToMainFrame/listFrames → frame
- Merged: refAt/elementsAt/elementsNear → elementsAt
- Extracted: sleep from wait

### Test Coverage (v1.0.11)
- Added comprehensive Aria.test.js (55 tests)
- 1,185+ unit tests, all passing
- >80% code coverage across modules

## Configuration

### Environment Variables
- `CDP_METRICS_FILE` - Path for I/O metrics tracking (used by flywheel)
- `TMPDIR` - Temporary directory for tab registry and traces

### Options
Most factory functions accept an `options` object:
```javascript
createPageController(session, {
  timeout: 30000,           // Default operation timeout
  getFrameContext: () => null,  // Frame context provider
  headless: true            // Headless mode flag
})
```

## Security Considerations

- **No remote code execution** - All JavaScript is agent-generated, not user input
- **Sandbox isolation** - Each browser session is isolated
- **Resource limits** - Timeouts prevent infinite waits
- **Input validation** - All step parameters are validated before execution

## Future Architecture

See `cdp-bench/VISION.md` and `cdp-bench/PHASE-*.md` for planned improvements:
- Flywheel-driven reliability improvements
- Automated regression detection
- Performance benchmarking
- Enhanced error diagnostics

## Contributing

When modifying code:
1. ✅ Follow functional style (factory functions, DI)
2. ✅ Add null checks for all `typeof === 'object'`
3. ✅ Update step protocol files if adding/changing steps
4. ✅ Add test coverage for new functionality
5. ✅ Update documentation (SKILL.md, this file)
6. ✅ Run `npm run test:run` to verify all tests pass

## References

- **SKILL.md** - Agent-facing skill documentation
- **CLAUDE.md** - Project-level coding guidelines
- **types.js** - Type definitions and JSDoc
- **EXAMPLES.md** - Usage examples
- **cdp-bench/** - Evaluation and benchmarking system
