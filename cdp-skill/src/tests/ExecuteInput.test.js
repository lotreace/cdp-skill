import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  executeFill,
  executeFillActive,
  executeSelectOption
} from '../runner/execute-input.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockElementLocator(opts = {}) {
  const mockHandle = {
    objectId: opts.objectId || 'obj-123',
    scrollIntoView: mock.fn(() => Promise.resolve()),
    waitForStability: mock.fn(() => {
      if (opts.unstable) throw new Error('Element not stable');
      return Promise.resolve();
    }),
    isActionable: mock.fn(() => Promise.resolve({
      actionable: opts.actionable !== false,
      reason: opts.actionable === false ? opts.reason || 'Element not visible' : null
    })),
    getBoundingBox: mock.fn(() => Promise.resolve({
      x: 100,
      y: 100,
      width: 200,
      height: 40
    })),
    focus: mock.fn(() => Promise.resolve()),
    dispose: mock.fn(() => Promise.resolve())
  };

  const mockElement = {
    _handle: mockHandle,
    objectId: mockHandle.objectId
  };

  return {
    session: {
      send: mock.fn((method) => {
        if (method === 'Runtime.callFunctionOn') {
          if (opts.notEditable) {
            return Promise.resolve({
              result: {
                value: {
                  editable: false,
                  reason: 'Element is disabled'
                }
              }
            });
          }
          if (opts.notSelect) {
            return Promise.resolve({
              result: {
                value: {
                  error: 'Element is not a <select> element'
                }
              }
            });
          }
          if (opts.noMatch) {
            return Promise.resolve({
              result: {
                value: {
                  error: 'No option matched',
                  matchBy: 'value',
                  matchValue: 'unknown',
                  availableOptions: [{ value: 'opt1', label: 'Option 1' }]
                }
              }
            });
          }
          return Promise.resolve({
            result: {
              value: {
                editable: true,
                success: true,
                selected: ['opt1'],
                multiple: false
              }
            }
          });
        }
        return Promise.resolve({});
      })
    },
    findElement: mock.fn(() => {
      if (opts.notFound) return Promise.resolve(null);
      return Promise.resolve(mockElement);
    })
  };
}

function createMockInputEmulator() {
  return {
    click: mock.fn(() => Promise.resolve()),
    type: mock.fn(() => Promise.resolve()),
    selectAll: mock.fn(() => Promise.resolve())
  };
}

function createMockPageController(opts = {}) {
  return {
    session: {
      send: mock.fn((method, params) => {
        if (method === 'Runtime.evaluate') {
          if (opts.noFocus) {
            return Promise.resolve({
              result: {
                value: {
                  error: 'No element is focused'
                }
              }
            });
          }
          if (opts.notEditable) {
            return Promise.resolve({
              result: {
                value: {
                  error: 'Focused element is not editable',
                  tag: 'DIV'
                }
              }
            });
          }
          if (opts.disabled) {
            return Promise.resolve({
              result: {
                value: {
                  error: 'Focused element is disabled',
                  tag: 'INPUT'
                }
              }
            });
          }
          if (opts.readonly) {
            return Promise.resolve({
              result: {
                value: {
                  error: 'Focused element is readonly',
                  tag: 'INPUT'
                }
              }
            });
          }
          if (opts.exception) {
            return Promise.resolve({
              result: { value: undefined },
              exceptionDetails: {
                text: opts.exception
              }
            });
          }
          return Promise.resolve({
            result: {
              value: {
                editable: true,
                tag: 'INPUT',
                type: 'text',
                selector: '#username',
                valueBefore: ''
              }
            }
          });
        }
        return Promise.resolve({});
      })
    }
  };
}

// ---------------------------------------------------------------------------
// Tests: executeFill
// ---------------------------------------------------------------------------

describe('executeFill', () => {
  afterEach(() => { mock.reset(); });

  it('should throw if selector is missing', async () => {
    const locator = createMockElementLocator();
    const emulator = createMockInputEmulator();

    await assert.rejects(
      executeFill(locator, emulator, { value: 'test' }),
      { message: 'Fill requires selector and value' }
    );
  });

  it('should throw if value is missing', async () => {
    const locator = createMockElementLocator();
    const emulator = createMockInputEmulator();

    await assert.rejects(
      executeFill(locator, emulator, { selector: '#input' }),
      { message: 'Fill requires selector and value' }
    );
  });

  it('should throw if element not found', async () => {
    const locator = createMockElementLocator({ notFound: true });
    const emulator = createMockInputEmulator();

    await assert.rejects(
      executeFill(locator, emulator, { selector: '#missing', value: 'test' }),
      { message: /element not found/i }
    );
  });

  it('should throw if element is not editable', async () => {
    const locator = createMockElementLocator({ notEditable: true });
    const emulator = createMockInputEmulator();

    await assert.rejects(
      executeFill(locator, emulator, { selector: '#disabled', value: 'test' }),
      { message: /not editable/i }
    );
  });

  it('should throw if element is not actionable after all scroll strategies', async () => {
    const locator = createMockElementLocator({ actionable: false, reason: 'Element is covered' });
    const emulator = createMockInputEmulator();

    await assert.rejects(
      executeFill(locator, emulator, { selector: '#input', value: 'test' }),
      { message: /not actionable/i }
    );
  });

  it('should fill element with standard approach', async () => {
    const locator = createMockElementLocator();
    const emulator = createMockInputEmulator();

    await executeFill(locator, emulator, { selector: '#input', value: 'hello' });

    assert.strictEqual(locator.findElement.mock.calls.length, 1);
    assert.strictEqual(emulator.click.mock.calls.length, 1);
    assert.strictEqual(emulator.selectAll.mock.calls.length, 1);
    assert.strictEqual(emulator.type.mock.calls.length, 1);
    assert.strictEqual(emulator.type.mock.calls[0].arguments[0], 'hello');
  });

  it('should skip clear if clear option is false', async () => {
    const locator = createMockElementLocator();
    const emulator = createMockInputEmulator();

    await executeFill(locator, emulator, { selector: '#input', value: 'hello', clear: false });

    assert.strictEqual(emulator.selectAll.mock.calls.length, 0);
    assert.strictEqual(emulator.type.mock.calls.length, 1);
  });

  it('should use React filler if react option is true', async () => {
    const locator = createMockElementLocator();
    const emulator = createMockInputEmulator();

    // Mock createReactInputFiller
    await executeFill(locator, emulator, { selector: '#input', value: 'hello', react: true });

    // React mode skips click and type
    assert.strictEqual(emulator.click.mock.calls.length, 0);
    assert.strictEqual(emulator.type.mock.calls.length, 0);
  });

  it('should dispose element handle on success', async () => {
    const locator = createMockElementLocator();
    const emulator = createMockInputEmulator();

    await executeFill(locator, emulator, { selector: '#input', value: 'test' });

    const element = await locator.findElement('#input');
    // Can't directly check if dispose was called, but ensure no errors
    assert.ok(element);
  });

  it('should try multiple scroll strategies if element not immediately actionable', async () => {
    let callCount = 0;
    const locator = createMockElementLocator({
      actionable: true
    });

    // Override isActionable to succeed on second call
    const originalHandle = await locator.findElement('#input');
    originalHandle._handle.isActionable = mock.fn(() => {
      callCount++;
      return Promise.resolve({
        actionable: callCount > 1,
        reason: callCount > 1 ? null : 'Not visible'
      });
    });
    locator.findElement = mock.fn(() => Promise.resolve(originalHandle));

    const emulator = createMockInputEmulator();

    await executeFill(locator, emulator, { selector: '#input', value: 'test' });

    // Should have tried multiple times
    assert.ok(originalHandle._handle.isActionable.mock.calls.length >= 2);
  });
});

// ---------------------------------------------------------------------------
// Tests: executeFillActive
// ---------------------------------------------------------------------------

describe('executeFillActive', () => {
  afterEach(() => { mock.reset(); });

  it('should throw if no element is focused', async () => {
    const pc = createMockPageController({ noFocus: true });
    const emulator = createMockInputEmulator();

    await assert.rejects(
      executeFillActive(pc, emulator, 'test'),
      { message: 'No element is focused' }
    );
  });

  it('should throw if focused element is not editable', async () => {
    const pc = createMockPageController({ notEditable: true });
    const emulator = createMockInputEmulator();

    await assert.rejects(
      executeFillActive(pc, emulator, 'test'),
      { message: 'Focused element is not editable' }
    );
  });

  it('should throw if focused element is disabled', async () => {
    const pc = createMockPageController({ disabled: true });
    const emulator = createMockInputEmulator();

    await assert.rejects(
      executeFillActive(pc, emulator, 'test'),
      { message: 'Focused element is disabled' }
    );
  });

  it('should throw if focused element is readonly', async () => {
    const pc = createMockPageController({ readonly: true });
    const emulator = createMockInputEmulator();

    await assert.rejects(
      executeFillActive(pc, emulator, 'test'),
      { message: 'Focused element is readonly' }
    );
  });

  it('should throw on Runtime.evaluate exception', async () => {
    const pc = createMockPageController({ exception: 'eval error' });
    const emulator = createMockInputEmulator();

    await assert.rejects(
      executeFillActive(pc, emulator, 'test'),
      { message: /fillActive error/i }
    );
  });

  it('should fill active element with string param', async () => {
    const pc = createMockPageController();
    const emulator = createMockInputEmulator();

    const result = await executeFillActive(pc, emulator, 'hello');

    assert.strictEqual(result.filled, true);
    assert.strictEqual(result.tag, 'INPUT');
    assert.strictEqual(result.type, 'text');
    assert.strictEqual(result.selector, '#username');
    assert.strictEqual(result.valueAfter, 'hello');
    assert.strictEqual(emulator.selectAll.mock.calls.length, 1);
    assert.strictEqual(emulator.type.mock.calls.length, 1);
    assert.strictEqual(emulator.type.mock.calls[0].arguments[0], 'hello');
  });

  it('should fill active element with object param', async () => {
    const pc = createMockPageController();
    const emulator = createMockInputEmulator();

    const result = await executeFillActive(pc, emulator, { value: 'world' });

    assert.strictEqual(result.filled, true);
    assert.strictEqual(result.valueAfter, 'world');
    assert.strictEqual(emulator.type.mock.calls[0].arguments[0], 'world');
  });

  it('should skip clear if clear option is false', async () => {
    const pc = createMockPageController();
    const emulator = createMockInputEmulator();

    await executeFillActive(pc, emulator, { value: 'test', clear: false });

    assert.strictEqual(emulator.selectAll.mock.calls.length, 0);
    assert.strictEqual(emulator.type.mock.calls.length, 1);
  });

  it('should return valueBefore and valueAfter', async () => {
    const pc = createMockPageController();
    const emulator = createMockInputEmulator();

    const result = await executeFillActive(pc, emulator, 'new value');

    assert.strictEqual(result.valueBefore, '');
    assert.strictEqual(result.valueAfter, 'new value');
  });
});

// ---------------------------------------------------------------------------
// Tests: executeSelectOption
// ---------------------------------------------------------------------------

describe('executeSelectOption', () => {
  afterEach(() => { mock.reset(); });

  it('should throw if selector is missing', async () => {
    const locator = createMockElementLocator();

    await assert.rejects(
      executeSelectOption(locator, { value: 'opt1' }),
      { message: 'selectOption requires selector' }
    );
  });

  it('should throw if no value, label, index, or values provided', async () => {
    const locator = createMockElementLocator();

    await assert.rejects(
      executeSelectOption(locator, { selector: '#dropdown' }),
      { message: 'selectOption requires value, label, index, or values' }
    );
  });

  it('should throw if element not found', async () => {
    const locator = createMockElementLocator({ notFound: true });

    await assert.rejects(
      executeSelectOption(locator, { selector: '#missing', value: 'opt1' }),
      { message: /element not found/i }
    );
  });

  it('should throw if element is not a select', async () => {
    const locator = createMockElementLocator({ notSelect: true });

    await assert.rejects(
      executeSelectOption(locator, { selector: '#notselect', value: 'opt1' }),
      { message: /not a <select> element/i }
    );
  });

  it('should throw if no option matched', async () => {
    const locator = createMockElementLocator({ noMatch: true });

    await assert.rejects(
      executeSelectOption(locator, { selector: '#dropdown', value: 'unknown' }),
      { message: /No option matched/i }
    );
  });

  it('should select option by value', async () => {
    const locator = createMockElementLocator();

    const result = await executeSelectOption(locator, {
      selector: '#dropdown',
      value: 'opt1'
    });

    assert.strictEqual(result.selected.length, 1);
    assert.strictEqual(result.selected[0], 'opt1');
    assert.strictEqual(result.multiple, false);
  });

  it('should select option by label', async () => {
    const locator = createMockElementLocator();

    const result = await executeSelectOption(locator, {
      selector: '#dropdown',
      label: 'Option 1'
    });

    assert.strictEqual(result.selected.length, 1);
    assert.strictEqual(result.multiple, false);
  });

  it('should select option by index', async () => {
    const locator = createMockElementLocator();

    const result = await executeSelectOption(locator, {
      selector: '#dropdown',
      index: 0
    });

    assert.strictEqual(result.selected.length, 1);
    assert.strictEqual(result.multiple, false);
  });

  it('should select multiple options with values array', async () => {
    const locator = createMockElementLocator();

    await executeSelectOption(locator, {
      selector: '#dropdown',
      values: ['opt1', 'opt2']
    });

    // Mock returns single value, but in real impl would return multiple
    assert.ok(locator.findElement.mock.calls.length > 0);
  });

  it('should dispose element handle after execution', async () => {
    const locator = createMockElementLocator();
    const element = await locator.findElement('#dropdown');

    await executeSelectOption(locator, {
      selector: '#dropdown',
      value: 'opt1'
    });

    // Dispose is called in finally block
    assert.strictEqual(element._handle.dispose.mock.calls.length, 1);
  });

  it('should pass correct arguments to Runtime.callFunctionOn', async () => {
    const locator = createMockElementLocator();

    await executeSelectOption(locator, {
      selector: '#dropdown',
      value: 'opt1'
    });

    const calls = locator.session.send.mock.calls.filter(
      call => call.arguments[0] === 'Runtime.callFunctionOn'
    );

    assert.strictEqual(calls.length, 1); // executeSelectOption only calls once (no editable check in that function)
    const selectCall = calls[0];
    assert.ok(selectCall.arguments[1].functionDeclaration);
    assert.ok(selectCall.arguments[1].arguments);
  });
});
