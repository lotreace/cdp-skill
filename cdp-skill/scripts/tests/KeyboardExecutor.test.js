import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createKeyboardExecutor } from '../dom/keyboard-executor.js';

describe('KeyboardExecutor', () => {
  let mockSession;
  let mockElementLocator;
  let mockInputEmulator;
  let executor;

  beforeEach(() => {
    mockSession = {
      send: mock.fn(async () => ({}))
    };

    const createMockElement = () => ({
      _handle: {
        objectId: 'obj-123',
        scrollIntoView: mock.fn(async () => {}),
        waitForStability: mock.fn(async () => {}),
        focus: mock.fn(async () => {}),
        dispose: mock.fn(async () => {})
      },
      objectId: 'obj-123'
    });

    mockElementLocator = {
      findElement: mock.fn(async () => createMockElement())
    };

    mockInputEmulator = {
      type: mock.fn(async () => {})
    };

    executor = createKeyboardExecutor(mockSession, mockElementLocator, mockInputEmulator);
  });

  afterEach(() => {
    mock.reset();
  });

  describe('createKeyboardExecutor', () => {
    it('should return an object with expected methods', () => {
      assert.ok(typeof executor.executeType === 'function');
      assert.ok(typeof executor.executeSelect === 'function');
    });
  });

  describe('executeType', () => {
    it('should throw if selector is not provided', async () => {
      await assert.rejects(
        () => executor.executeType({ text: 'hello' }),
        { message: 'Type requires selector and text' }
      );
    });

    it('should throw if text is not provided', async () => {
      await assert.rejects(
        () => executor.executeType({ selector: '#input' }),
        { message: 'Type requires selector and text' }
      );
    });

    it('should throw when element not found', async () => {
      mockElementLocator.findElement = mock.fn(async () => null);

      await assert.rejects(
        () => executor.executeType({ selector: '#missing', text: 'hello' }),
        (err) => {
          assert.ok(err.message.includes('not found'));
          return true;
        }
      );
    });

    it('should type text into element', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.callFunctionOn') {
          return { result: { value: { editable: true } } };
        }
        return {};
      });

      const result = await executor.executeType({ selector: '#input', text: 'hello world' });

      assert.strictEqual(result.selector, '#input');
      assert.strictEqual(result.typed, 'hello world');
      assert.strictEqual(result.length, 11);
      assert.strictEqual(mockInputEmulator.type.mock.calls.length, 1);
    });

    it('should pass delay option to input emulator', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.callFunctionOn') {
          return { result: { value: { editable: true } } };
        }
        return {};
      });

      await executor.executeType({ selector: '#input', text: 'test', delay: 50 });

      const typeCall = mockInputEmulator.type.mock.calls[0];
      assert.deepStrictEqual(typeCall.arguments, ['test', { delay: 50 }]);
    });

    it('should throw when element is not editable', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { editable: false, reason: 'readonly' } }
      }));

      await assert.rejects(
        () => executor.executeType({ selector: '#readonly', text: 'test' }),
        (err) => {
          assert.ok(err.message.includes('not editable'));
          return true;
        }
      );
    });

    it('should scroll element into view before typing', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { editable: true } }
      }));

      const mockElement = {
        _handle: {
          objectId: 'obj-123',
          scrollIntoView: mock.fn(async () => {}),
          waitForStability: mock.fn(async () => {}),
          focus: mock.fn(async () => {}),
          dispose: mock.fn(async () => {})
        },
        objectId: 'obj-123'
      };
      mockElementLocator.findElement = mock.fn(async () => mockElement);

      await executor.executeType({ selector: '#input', text: 'test' });

      assert.strictEqual(mockElement._handle.scrollIntoView.mock.calls.length, 1);
    });

    it('should focus element before typing', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { editable: true } }
      }));

      const mockElement = {
        _handle: {
          objectId: 'obj-123',
          scrollIntoView: mock.fn(async () => {}),
          waitForStability: mock.fn(async () => {}),
          focus: mock.fn(async () => {}),
          dispose: mock.fn(async () => {})
        },
        objectId: 'obj-123'
      };
      mockElementLocator.findElement = mock.fn(async () => mockElement);

      await executor.executeType({ selector: '#input', text: 'test' });

      assert.strictEqual(mockElement._handle.focus.mock.calls.length, 1);
    });

    it('should dispose element handle after typing', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { editable: true } }
      }));

      const mockElement = {
        _handle: {
          objectId: 'obj-123',
          scrollIntoView: mock.fn(async () => {}),
          waitForStability: mock.fn(async () => {}),
          focus: mock.fn(async () => {}),
          dispose: mock.fn(async () => {})
        },
        objectId: 'obj-123'
      };
      mockElementLocator.findElement = mock.fn(async () => mockElement);

      await executor.executeType({ selector: '#input', text: 'test' });

      assert.strictEqual(mockElement._handle.dispose.mock.calls.length, 1);
    });

    it('should convert non-string text to string', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { editable: true } }
      }));

      const result = await executor.executeType({ selector: '#input', text: 12345 });

      assert.strictEqual(result.typed, '12345');
      assert.strictEqual(result.length, 5);
    });
  });

  describe('executeSelect', () => {
    it('should throw if selector is not provided as string', async () => {
      await assert.rejects(
        () => executor.executeSelect(null),
        { message: 'Select requires a selector string or params object' }
      );
    });

    it('should throw if params object has no selector', async () => {
      await assert.rejects(
        () => executor.executeSelect({ start: 0, end: 5 }),
        { message: 'Select requires selector' }
      );
    });

    it('should throw when element not found', async () => {
      mockElementLocator.findElement = mock.fn(async () => null);

      await assert.rejects(
        () => executor.executeSelect('#missing'),
        (err) => {
          assert.ok(err.message.includes('not found'));
          return true;
        }
      );
    });

    it('should select all text with string selector', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: {
            success: true,
            start: 0,
            end: 10,
            selectedText: 'hello test',
            totalLength: 10
          }
        }
      }));

      const result = await executor.executeSelect('#input');

      assert.strictEqual(result.selector, '#input');
      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.end, 10);
      assert.strictEqual(result.selectedText, 'hello test');
      assert.strictEqual(result.totalLength, 10);
    });

    it('should select text range with start and end', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: {
            success: true,
            start: 2,
            end: 7,
            selectedText: 'llo t',
            totalLength: 10
          }
        }
      }));

      const result = await executor.executeSelect({ selector: '#input', start: 2, end: 7 });

      assert.strictEqual(result.start, 2);
      assert.strictEqual(result.end, 7);
      assert.strictEqual(result.selectedText, 'llo t');
    });

    it('should throw when selection fails', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: {
            success: false,
            reason: 'Element does not support text selection'
          }
        }
      }));

      await assert.rejects(
        () => executor.executeSelect('#div'),
        { message: 'Element does not support text selection' }
      );
    });

    it('should scroll element into view before selecting', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: {
            success: true,
            start: 0,
            end: 5,
            selectedText: 'hello',
            totalLength: 5
          }
        }
      }));

      const mockElement = {
        _handle: {
          objectId: 'obj-123',
          scrollIntoView: mock.fn(async () => {}),
          waitForStability: mock.fn(async () => {}),
          focus: mock.fn(async () => {}),
          dispose: mock.fn(async () => {})
        },
        objectId: 'obj-123'
      };
      mockElementLocator.findElement = mock.fn(async () => mockElement);

      await executor.executeSelect('#input');

      assert.strictEqual(mockElement._handle.scrollIntoView.mock.calls.length, 1);
    });

    it('should focus element before selecting', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: {
            success: true,
            start: 0,
            end: 5,
            selectedText: 'hello',
            totalLength: 5
          }
        }
      }));

      const mockElement = {
        _handle: {
          objectId: 'obj-123',
          scrollIntoView: mock.fn(async () => {}),
          waitForStability: mock.fn(async () => {}),
          focus: mock.fn(async () => {}),
          dispose: mock.fn(async () => {})
        },
        objectId: 'obj-123'
      };
      mockElementLocator.findElement = mock.fn(async () => mockElement);

      await executor.executeSelect('#input');

      assert.strictEqual(mockElement._handle.focus.mock.calls.length, 1);
    });

    it('should dispose element handle after selection', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: {
            success: true,
            start: 0,
            end: 5,
            selectedText: 'hello',
            totalLength: 5
          }
        }
      }));

      const mockElement = {
        _handle: {
          objectId: 'obj-123',
          scrollIntoView: mock.fn(async () => {}),
          waitForStability: mock.fn(async () => {}),
          focus: mock.fn(async () => {}),
          dispose: mock.fn(async () => {})
        },
        objectId: 'obj-123'
      };
      mockElementLocator.findElement = mock.fn(async () => mockElement);

      await executor.executeSelect('#input');

      assert.strictEqual(mockElement._handle.dispose.mock.calls.length, 1);
    });

    it('should handle contenteditable elements', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: {
            success: true,
            start: 0,
            end: 15,
            selectedText: 'editable text!',
            totalLength: 15
          }
        }
      }));

      const result = await executor.executeSelect('#contenteditable');

      assert.strictEqual(result.success, undefined); // Only success is not passed to result
      assert.strictEqual(result.selectedText, 'editable text!');
    });

    it('should handle selection with only start index', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: {
            success: true,
            start: 5,
            end: 10,
            selectedText: ' test',
            totalLength: 10
          }
        }
      }));

      const result = await executor.executeSelect({ selector: '#input', start: 5 });

      assert.strictEqual(result.start, 5);
      assert.strictEqual(result.end, 10);
    });

    it('should handle selection with only end index', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: {
            success: true,
            start: 0,
            end: 5,
            selectedText: 'hello',
            totalLength: 10
          }
        }
      }));

      const result = await executor.executeSelect({ selector: '#input', end: 5 });

      assert.strictEqual(result.start, 0);
      assert.strictEqual(result.end, 5);
    });
  });
});
