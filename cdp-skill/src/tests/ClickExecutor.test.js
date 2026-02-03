import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createClickExecutor } from '../dom/click-executor.js';

describe('ClickExecutor', () => {
  let mockSession;
  let mockElementLocator;
  let mockInputEmulator;
  let mockAriaSnapshot;
  let executor;

  beforeEach(() => {
    mockSession = {
      send: mock.fn(async () => ({}))
    };

    mockElementLocator = {
      findElement: mock.fn(async () => ({
        _handle: {
          objectId: 'obj-123',
          dispose: mock.fn(async () => {})
        },
        objectId: 'obj-123',
        isActionable: mock.fn(async () => ({ actionable: true })),
        getClickPoint: mock.fn(async () => ({ x: 100, y: 100 })),
        dispose: mock.fn(async () => {})
      })),
      findElementByText: mock.fn(async () => ({
        objectId: 'obj-123',
        _handle: {
          objectId: 'obj-123',
          dispose: mock.fn(async () => {})
        },
        isActionable: mock.fn(async () => ({ actionable: true })),
        getClickPoint: mock.fn(async () => ({ x: 100, y: 100 })),
        dispose: mock.fn(async () => {})
      })),
      queryByRole: mock.fn(async () => [])
    };

    mockInputEmulator = {
      click: mock.fn(async () => {})
    };

    mockAriaSnapshot = {
      getElementByRef: mock.fn(async () => ({
        box: { x: 50, y: 50, width: 100, height: 40 },
        isVisible: true,
        stale: false
      }))
    };

    executor = createClickExecutor(mockSession, mockElementLocator, mockInputEmulator, mockAriaSnapshot);
  });

  afterEach(() => {
    mock.reset();
  });

  describe('createClickExecutor', () => {
    it('should throw if session is not provided', () => {
      assert.throws(() => createClickExecutor(null, mockElementLocator, mockInputEmulator), {
        message: 'CDP session is required'
      });
    });

    it('should throw if elementLocator is not provided', () => {
      assert.throws(() => createClickExecutor(mockSession, null, mockInputEmulator), {
        message: 'Element locator is required'
      });
    });

    it('should throw if inputEmulator is not provided', () => {
      assert.throws(() => createClickExecutor(mockSession, mockElementLocator, null), {
        message: 'Input emulator is required'
      });
    });

    it('should return an object with expected methods', () => {
      assert.ok(typeof executor.execute === 'function');
      assert.ok(typeof executor.clickByText === 'function');
      assert.ok(typeof executor.clickWithMultiSelector === 'function');
    });
  });

  describe('execute', () => {
    it('should handle string selector', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          if (params?.expression?.includes('innerWidth')) {
            return { result: { value: { width: 1200, height: 800 } } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          if (params?.functionDeclaration?.includes('isConnected')) {
            return { result: { value: { matches: true, received: 'attached' } } };
          }
          if (params?.functionDeclaration?.includes('getBoundingClientRect')) {
            return { result: { value: { x: 100, y: 100, rect: { x: 50, y: 50, width: 100, height: 40 } } } };
          }
          if (params?.functionDeclaration?.includes('__clickReceived')) {
            return { result: { value: true } };
          }
          return { result: { value: { success: true, targetReceived: true } } };
        }
        return {};
      });

      const result = await executor.execute('#button');
      assert.strictEqual(result.clicked, true);
    });

    it('should handle ref-based click', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          if (params?.expression?.includes('__ariaRefs')) {
            return { result: { value: { targetReceived: true } } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        return {};
      });

      const result = await executor.execute({ ref: 's1e1' });
      assert.strictEqual(result.clicked, true);
      assert.strictEqual(result.ref, 's1e1');
    });

    it('should detect ref from string selector pattern', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          if (params?.expression?.includes('__ariaRefs')) {
            return { result: { value: { targetReceived: true } } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        return {};
      });

      const result = await executor.execute('s1e12');
      assert.strictEqual(result.clicked, true);
      assert.strictEqual(result.ref, 's1e12');
    });

    it('should handle text-based click', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          if (params?.functionDeclaration?.includes('__clickReceived')) {
            return { result: { value: true } };
          }
          return { result: { value: { success: true } } };
        }
        return {};
      });

      const result = await executor.execute({ text: 'Submit' });
      assert.strictEqual(result.clicked, true);
      assert.strictEqual(result.text, 'Submit');
    });

    it('should handle coordinate-based click', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        return {};
      });

      const result = await executor.execute({ x: 150, y: 200 });
      assert.strictEqual(result.clicked, true);
      assert.deepStrictEqual(result.coordinates, { x: 150, y: 200 });
      assert.strictEqual(mockInputEmulator.click.mock.calls.length, 1);
    });

    it('should handle jsClick option', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          if (params?.functionDeclaration?.includes('isConnected')) {
            return { result: { value: { matches: true, received: 'attached' } } };
          }
          if (params?.functionDeclaration?.includes('this.click()')) {
            return { result: { value: { success: true, targetReceived: true } } };
          }
          return { result: { value: {} } };
        }
        return {};
      });

      const result = await executor.execute({ selector: '#button', jsClick: true });
      assert.strictEqual(result.clicked, true);
      assert.strictEqual(result.method, 'jsClick');
    });
  });

  describe('clickByText', () => {
    it('should click element by visible text', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          if (params?.functionDeclaration?.includes('__clickReceived')) {
            return { result: { value: true } };
          }
          return { result: { value: { success: true } } };
        }
        return {};
      });

      const result = await executor.clickByText('Click Me');
      assert.strictEqual(result.clicked, true);
      assert.strictEqual(result.text, 'Click Me');
    });

    it('should throw when element not found', async () => {
      mockElementLocator.findElementByText = mock.fn(async () => null);

      await assert.rejects(
        () => executor.clickByText('Missing Text'),
        (err) => {
          assert.ok(err.message.includes('not found'));
          return true;
        }
      );
    });

    it('should use jsClick for non-actionable element', async () => {
      const mockElement = {
        objectId: 'obj-123',
        _handle: { objectId: 'obj-123', dispose: mock.fn(async () => {}) },
        isActionable: mock.fn(async () => ({ actionable: false, reason: 'zero-size' })),
        getClickPoint: mock.fn(async () => null),
        dispose: mock.fn(async () => {})
      };
      mockElementLocator.findElementByText = mock.fn(async () => mockElement);

      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          if (params?.functionDeclaration?.includes('this.click()')) {
            return { result: { value: { success: true, targetReceived: true } } };
          }
          return { result: { value: {} } };
        }
        return {};
      });

      const result = await executor.clickByText('Submit');
      assert.strictEqual(result.clicked, true);
      assert.strictEqual(result.method, 'jsClick-fallback');
    });
  });

  describe('clickWithMultiSelector', () => {
    it('should try selectors in order until one succeeds', async () => {
      // Track which selector is being queried
      let currentSelector = '';
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          if (params?.expression?.includes('innerWidth')) {
            return { result: { value: { width: 1200, height: 800 } } };
          }
          // Track selector from expression
          if (params?.expression?.includes('querySelector')) {
            if (params.expression.includes('#missing')) {
              currentSelector = '#missing';
              return { result: { subtype: 'null' } };
            }
            if (params.expression.includes('#button')) {
              currentSelector = '#button';
              return { result: { objectId: 'obj-123' } };
            }
          }
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          if (params?.functionDeclaration?.includes('isConnected')) {
            return { result: { value: { matches: true, received: 'attached' } } };
          }
          if (params?.functionDeclaration?.includes('getBoundingClientRect')) {
            return { result: { value: { x: 100, y: 100, rect: { x: 50, y: 50, width: 100, height: 40 } } } };
          }
          if (params?.functionDeclaration?.includes('__clickReceived')) {
            return { result: { value: true } };
          }
          return { result: { value: { success: true } } };
        }
        return {};
      });

      const result = await executor.clickWithMultiSelector(['#missing', '#button', '#other']);
      assert.strictEqual(result.clicked, true);
      // The result should contain the used selector, but the actual selector depends on implementation
      assert.ok(result.usedSelector !== undefined);
    });

    it('should throw when all selectors fail', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          return { result: { subtype: 'null' } };
        }
        return {};
      });

      await assert.rejects(
        () => executor.clickWithMultiSelector(['#a', '#b'], { timeout: 100 }),
        (err) => {
          assert.ok(err.message.includes('All 2 selectors failed'));
          return true;
        }
      );
    });

    it('should handle role-based selector objects', async () => {
      mockElementLocator.queryByRole = mock.fn(async () => [
        { selector: '[role="button"]' }
      ]);

      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          if (params?.expression?.includes('innerWidth')) {
            return { result: { value: { width: 1200, height: 800 } } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          if (params?.functionDeclaration?.includes('isConnected')) {
            return { result: { value: { matches: true, received: 'attached' } } };
          }
          if (params?.functionDeclaration?.includes('getBoundingClientRect')) {
            return { result: { value: { x: 100, y: 100, rect: { x: 50, y: 50, width: 100, height: 40 } } } };
          }
          if (params?.functionDeclaration?.includes('__clickReceived')) {
            return { result: { value: true } };
          }
          return { result: { value: { success: true } } };
        }
        return {};
      });

      const result = await executor.clickWithMultiSelector([
        { role: 'button', name: 'Submit' }
      ]);
      assert.strictEqual(result.clicked, true);
    });
  });

  describe('ref-based click edge cases', () => {
    it('should not try ref click when ariaSnapshot not provided', async () => {
      const noAriaExecutor = createClickExecutor(mockSession, mockElementLocator, mockInputEmulator);

      // Without ariaSnapshot, the executor falls back to selector-based click
      // which will fail to find the element "s1e1" (since it's not a valid CSS selector)
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          return { result: { subtype: 'null' } };
        }
        return {};
      });

      await assert.rejects(
        () => noAriaExecutor.execute({ ref: 's1e1' }),
        (err) => {
          // Without ariaSnapshot, the ref 's1e1' is treated as selector, failing to find
          return err.message.includes('not found') || err.message.includes('ariaSnapshot');
        }
      );
    });

    it('should return stale warning when ref element is stale', async () => {
      mockAriaSnapshot.getElementByRef = mock.fn(async () => ({
        box: { x: 50, y: 50, width: 100, height: 40 },
        isVisible: true,
        stale: true
      }));

      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression?.includes('location.href')) {
          return { result: { value: 'https://example.com' } };
        }
        return {};
      });

      const result = await executor.execute({ ref: 's1e1' });
      assert.strictEqual(result.clicked, false);
      assert.strictEqual(result.stale, true);
      assert.ok(result.warning.includes('no longer attached'));
    });

    it('should return warning when ref element is not visible', async () => {
      mockAriaSnapshot.getElementByRef = mock.fn(async () => ({
        box: { x: 50, y: 50, width: 100, height: 40 },
        isVisible: false,
        stale: false
      }));

      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression?.includes('location.href')) {
          return { result: { value: 'https://example.com' } };
        }
        return {};
      });

      const result = await executor.execute({ ref: 's1e1' });
      assert.strictEqual(result.clicked, false);
      assert.ok(result.warning.includes('not visible'));
    });

    it('should succeed when ref element is re-resolved via metadata', async () => {
      mockAriaSnapshot.getElementByRef = mock.fn(async () => ({
        box: { x: 50, y: 50, width: 100, height: 40 },
        isVisible: true,
        stale: false,
        reResolved: true
      }));

      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          if (params?.expression?.includes('__ariaRefs')) {
            return { result: { value: { targetReceived: true } } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        return {};
      });

      const result = await executor.execute({ ref: 's1e1' });
      assert.strictEqual(result.clicked, true);
      assert.strictEqual(result.ref, 's1e1');
    });

    it('should click non-visible element with force option', async () => {
      mockAriaSnapshot.getElementByRef = mock.fn(async () => ({
        box: { x: 50, y: 50, width: 100, height: 40 },
        isVisible: false,
        stale: false
      }));

      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          if (params?.expression?.includes('__ariaRefs')) {
            return { result: { value: { targetReceived: true } } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        return {};
      });

      const result = await executor.execute({ ref: 's1e1', force: true });
      assert.strictEqual(result.clicked, true);
    });
  });

  describe('navigation detection', () => {
    it('should detect navigation after click', async () => {
      let urlCallCount = 0;
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            urlCallCount++;
            if (urlCallCount === 1) {
              return { result: { value: 'https://example.com/page1' } };
            }
            return { result: { value: 'https://example.com/page2' } };
          }
          if (params?.expression?.includes('innerWidth')) {
            return { result: { value: { width: 1200, height: 800 } } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          if (params?.functionDeclaration?.includes('isConnected')) {
            return { result: { value: { matches: true, received: 'attached' } } };
          }
          if (params?.functionDeclaration?.includes('getBoundingClientRect')) {
            return { result: { value: { x: 100, y: 100, rect: { x: 50, y: 50, width: 100, height: 40 } } } };
          }
          if (params?.functionDeclaration?.includes('__clickReceived')) {
            return { result: { value: true } };
          }
          return { result: { value: { success: true } } };
        }
        return {};
      });

      const result = await executor.execute({ selector: '#link', waitForNavigation: true });
      assert.strictEqual(result.clicked, true);
      assert.strictEqual(result.navigated, true);
      assert.strictEqual(result.newUrl, 'https://example.com/page2');
    });
  });

  describe('debug mode', () => {
    it('should include debug info when debug option is true', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (params?.expression?.includes('location.href')) {
            return { result: { value: 'https://example.com' } };
          }
          if (params?.expression?.includes('innerWidth')) {
            return { result: { value: { width: 1200, height: 800 } } };
          }
          if (params?.expression?.includes('elementFromPoint')) {
            return { result: { value: { tagName: 'button', id: 'btn' } } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          if (params?.functionDeclaration?.includes('isConnected')) {
            return { result: { value: { matches: true, received: 'attached' } } };
          }
          if (params?.functionDeclaration?.includes('getBoundingClientRect')) {
            return { result: { value: { x: 100, y: 100, rect: { x: 50, y: 50, width: 100, height: 40 } } } };
          }
          if (params?.functionDeclaration?.includes('__clickReceived')) {
            return { result: { value: true } };
          }
          return { result: { value: { success: true } } };
        }
        return {};
      });

      const result = await executor.execute({ selector: '#button', debug: true });
      assert.strictEqual(result.clicked, true);
      assert.ok(result.debug);
      assert.ok(result.debug.clickedAt);
    });
  });
});
