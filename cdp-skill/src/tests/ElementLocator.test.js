import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createElementLocator } from '../dom.js';
import { ErrorTypes } from '../utils.js';

describe('ElementLocator', () => {
  let mockCdp;
  let locator;

  beforeEach(() => {
    mockCdp = {
      send: mock.fn(async () => ({}))
    };
    locator = createElementLocator(mockCdp);
  });

  describe('createElementLocator', () => {
    it('should throw if session is not provided', () => {
      assert.throws(() => createElementLocator(null), {
        message: 'CDP session is required'
      });
    });

    it('should use default timeout of 30000ms', () => {
      assert.strictEqual(locator.getDefaultTimeout(), 30000);
    });

    it('should accept custom timeout option', () => {
      const customLocator = createElementLocator(mockCdp, { timeout: 5000 });
      assert.strictEqual(customLocator.getDefaultTimeout(), 5000);
    });
  });

  describe('querySelector', () => {
    it('should call Runtime.evaluate with correct expression', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { objectId: 'obj-123' }
      }));

      await locator.querySelector('.my-class');

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
      const [method, params] = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(method, 'Runtime.evaluate');
      assert.strictEqual(params.expression, 'document.querySelector(".my-class")');
      assert.strictEqual(params.returnByValue, false);
    });

    it('should return ElementHandle when element found', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { objectId: 'obj-456' }
      }));

      const handle = await locator.querySelector('#my-id');

      assert.ok(handle);
      assert.strictEqual(handle.objectId, 'obj-456');
    });

    it('should return null when element not found (subtype null)', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { subtype: 'null' }
      }));

      const handle = await locator.querySelector('.not-found');

      assert.strictEqual(handle, null);
    });

    it('should return null when result type is undefined', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { type: 'undefined' }
      }));

      const handle = await locator.querySelector('.undefined');

      assert.strictEqual(handle, null);
    });

    it('should throw on selector error', async () => {
      mockCdp.send = mock.fn(async () => ({
        exceptionDetails: { text: 'Invalid selector' }
      }));

      await assert.rejects(() => locator.querySelector('[invalid'), {
        message: 'Selector error: Invalid selector'
      });
    });

    it('should escape selector properly', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { subtype: 'null' }
      }));

      await locator.querySelector('[data-attr="value"]');

      const [, params] = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(params.expression, 'document.querySelector("[data-attr=\\"value\\"]")');
    });

    it('should pass selector to ElementHandle', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { objectId: 'obj-123' }
      }));

      const handle = await locator.querySelector('#my-button');

      assert.strictEqual(handle.selector, '#my-button');
    });
  });

  describe('querySelectorAll', () => {
    it('should call Runtime.evaluate with Array.from wrapper', async () => {
      mockCdp.send = mock.fn(async (method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'array-obj' } };
        }
        if (method === 'Runtime.getProperties') {
          return { result: [] };
        }
        return {};
      });

      await locator.querySelectorAll('div');

      const evalCall = mockCdp.send.mock.calls[0];
      assert.strictEqual(evalCall.arguments[0], 'Runtime.evaluate');
      assert.ok(evalCall.arguments[1].expression.includes('Array.from'));
    });

    it('should return empty array when no elements found', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: {}  // No objectId means empty result
      }));

      const handles = await locator.querySelectorAll('.not-found');

      assert.deepStrictEqual(handles, []);
    });

    it('should return ElementHandles for each element', async () => {
      mockCdp.send = mock.fn(async (method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'array-obj' } };
        }
        if (method === 'Runtime.getProperties') {
          return {
            result: [
              { name: '0', value: { objectId: 'elem-0' } },
              { name: '1', value: { objectId: 'elem-1' } },
              { name: '2', value: { objectId: 'elem-2' } },
              { name: 'length', value: { value: 3 } }
            ]
          };
        }
        return {};
      });

      const handles = await locator.querySelectorAll('p');

      assert.strictEqual(handles.length, 3);
      assert.strictEqual(handles[0].objectId, 'elem-0');
      assert.strictEqual(handles[1].objectId, 'elem-1');
      assert.strictEqual(handles[2].objectId, 'elem-2');
    });

    it('should filter out non-numeric properties', async () => {
      mockCdp.send = mock.fn(async (method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'array-obj' } };
        }
        if (method === 'Runtime.getProperties') {
          return {
            result: [
              { name: '0', value: { objectId: 'elem-0' } },
              { name: 'length', value: { value: 1 } },
              { name: '__proto__', value: {} }
            ]
          };
        }
        return {};
      });

      const handles = await locator.querySelectorAll('span');

      assert.strictEqual(handles.length, 1);
    });

    it('should release temporary array object after extraction', async () => {
      let releaseObjectCalled = false;
      let releasedObjectId = null;
      mockCdp.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'array-obj-123' } };
        }
        if (method === 'Runtime.getProperties') {
          return {
            result: [
              { name: '0', value: { objectId: 'elem-0' } },
              { name: 'length', value: { value: 1 } }
            ]
          };
        }
        if (method === 'Runtime.releaseObject') {
          releaseObjectCalled = true;
          releasedObjectId = params.objectId;
          return {};
        }
        return {};
      });

      await locator.querySelectorAll('div');

      assert.strictEqual(releaseObjectCalled, true, 'Should release array object');
      assert.strictEqual(releasedObjectId, 'array-obj-123', 'Should release the correct object');
    });

    it('should release array object even when getProperties fails', async () => {
      let releaseObjectCalled = false;
      mockCdp.send = mock.fn(async (method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'array-obj-456' } };
        }
        if (method === 'Runtime.getProperties') {
          throw new Error('Connection lost');
        }
        if (method === 'Runtime.releaseObject') {
          releaseObjectCalled = true;
          return {};
        }
        return {};
      });

      await assert.rejects(() => locator.querySelectorAll('div'));
      assert.strictEqual(releaseObjectCalled, true, 'Should release array object on error');
    });

    it('should throw on selector error', async () => {
      mockCdp.send = mock.fn(async () => ({
        exceptionDetails: { text: 'Syntax error' }
      }));

      await assert.rejects(() => locator.querySelectorAll(':::invalid'), {
        message: 'Selector error: Syntax error'
      });
    });
  });

  describe('waitForSelector', () => {
    it('should return element immediately if found', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { objectId: 'found-obj' }
      }));

      const handle = await locator.waitForSelector('#exists');

      assert.ok(handle);
      assert.strictEqual(handle.objectId, 'found-obj');
    });

    it('should poll until element appears', async () => {
      let callCount = 0;
      mockCdp.send = mock.fn(async () => {
        callCount++;
        if (callCount < 3) {
          return { result: { subtype: 'null' } };
        }
        return { result: { objectId: 'appeared-obj' } };
      });

      const handle = await locator.waitForSelector('#appearing', { timeout: 1000 });

      assert.ok(handle);
      assert.ok(callCount >= 3);
    });

    it('should throw ElementNotFoundError on timeout', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { subtype: 'null' }
      }));

      await assert.rejects(
        () => locator.waitForSelector('#never', { timeout: 200 }),
        (err) => {
          assert.strictEqual(err.name, ErrorTypes.ELEMENT_NOT_FOUND);
          assert.strictEqual(err.selector, '#never');
          assert.strictEqual(err.timeout, 200);
          return true;
        }
      );
    });

    it('should wait for visibility when visible option is true', async () => {
      let callCount = 0;
      mockCdp.send = mock.fn(async (method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'obj-' + callCount++ } };
        }
        if (method === 'Runtime.callFunctionOn') {
          // Return not visible for first 2 calls, then visible
          return { result: { value: callCount > 3 } };
        }
        if (method === 'Runtime.releaseObject') {
          return {};
        }
        return {};
      });

      const handle = await locator.waitForSelector('.visible', { visible: true, timeout: 2000 });

      assert.ok(handle);
    });

    it('should dispose non-visible elements during polling', async () => {
      let releaseCount = 0;
      mockCdp.send = mock.fn(async (method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          // Always invisible to trigger dispose
          return { result: { value: false } };
        }
        if (method === 'Runtime.releaseObject') {
          releaseCount++;
          return {};
        }
        return {};
      });

      await assert.rejects(
        () => locator.waitForSelector('.invisible', { visible: true, timeout: 300 })
      );

      assert.ok(releaseCount > 0, 'Should have released at least one object');
    });
  });

  describe('waitForText', () => {
    it('should return true when text found', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: true }
      }));

      const result = await locator.waitForText('Hello');

      assert.strictEqual(result, true);
    });

    it('should use case-insensitive search by default', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await locator.waitForText('HELLO');

      const [, params] = mockCdp.send.mock.calls[0].arguments;
      assert.ok(params.expression.includes('toLowerCase()'));
    });

    it('should use exact match when exact option is true', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await locator.waitForText('Exact Text', { exact: true });

      const [, params] = mockCdp.send.mock.calls[0].arguments;
      assert.ok(!params.expression.includes('toLowerCase'));
    });

    it('should throw TimeoutError on timeout', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: false }
      }));

      await assert.rejects(
        () => locator.waitForText('missing text', { timeout: 200 }),
        (err) => {
          assert.strictEqual(err.name, ErrorTypes.TIMEOUT);
          assert.ok(err.message.includes('missing text'));
          return true;
        }
      );
    });

    it('should poll until text appears', async () => {
      let callCount = 0;
      mockCdp.send = mock.fn(async () => {
        callCount++;
        return { result: { value: callCount >= 3 } };
      });

      await locator.waitForText('appearing text', { timeout: 1000 });

      assert.ok(callCount >= 3);
    });
  });

  describe('setDefaultTimeout', () => {
    it('should update the default timeout', () => {
      locator.setDefaultTimeout(10000);
      assert.strictEqual(locator.getDefaultTimeout(), 10000);
    });

    it('should clamp very long timeouts to max', () => {
      locator.setDefaultTimeout(999999999);
      assert.strictEqual(locator.getDefaultTimeout(), 300000);
    });

    it('should handle negative timeout', () => {
      locator.setDefaultTimeout(-100);
      assert.strictEqual(locator.getDefaultTimeout(), 0);
    });
  });

  describe('edge cases', () => {
    describe('querySelector edge cases', () => {
      it('should throw on empty selector', async () => {
        await assert.rejects(
          () => locator.querySelector(''),
          { message: 'Selector must be a non-empty string' }
        );
      });

      it('should throw on null selector', async () => {
        await assert.rejects(
          () => locator.querySelector(null),
          { message: 'Selector must be a non-empty string' }
        );
      });

      it('should throw error when connection drops', async () => {
        mockCdp.send = mock.fn(async () => {
          throw new Error('WebSocket closed');
        });

        await assert.rejects(
          () => locator.querySelector('.test'),
          (err) => {
            assert.ok(err.message.includes('WebSocket closed'));
            return true;
          }
        );
      });
    });

    describe('querySelectorAll edge cases', () => {
      it('should throw on empty selector', async () => {
        await assert.rejects(
          () => locator.querySelectorAll(''),
          { message: 'Selector must be a non-empty string' }
        );
      });

      it('should throw error when getProperties fails', async () => {
        mockCdp.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return { result: { objectId: 'array-obj' } };
          }
          if (method === 'Runtime.getProperties') {
            throw new Error('Connection lost');
          }
          return {};
        });

        await assert.rejects(
          () => locator.querySelectorAll('.test'),
          (err) => {
            assert.ok(err.message.includes('Connection lost'));
            return true;
          }
        );
      });
    });

    describe('waitForSelector edge cases', () => {
      it('should throw on empty selector', async () => {
        await assert.rejects(
          () => locator.waitForSelector(''),
          { message: 'Selector must be a non-empty string' }
        );
      });

      it('should handle element removed during visibility check', async () => {
        let callCount = 0;
        mockCdp.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return { result: { objectId: 'obj-' + callCount++ } };
          }
          if (method === 'Runtime.callFunctionOn') {
            // Simulate element being removed
            throw new Error('Object reference not found');
          }
          if (method === 'Runtime.releaseObject') {
            return {};
          }
          return {};
        });

        await assert.rejects(
          () => locator.waitForSelector('.removed', { visible: true, timeout: 300 }),
          (err) => err.name === ErrorTypes.ELEMENT_NOT_FOUND
        );
      });

      it('should handle very long timeout by clamping', async () => {
        mockCdp.send = mock.fn(async () => ({
          result: { objectId: 'found-obj' }
        }));

        const handle = await locator.waitForSelector('#exists', { timeout: 999999999 });
        assert.ok(handle);
      });
    });

    describe('waitForText edge cases', () => {
      it('should throw on null text', async () => {
        await assert.rejects(
          () => locator.waitForText(null),
          { message: 'Text must be provided' }
        );
      });

      it('should throw on undefined text', async () => {
        await assert.rejects(
          () => locator.waitForText(undefined),
          { message: 'Text must be provided' }
        );
      });

      it('should handle number text by converting to string', async () => {
        mockCdp.send = mock.fn(async () => ({
          result: { value: true }
        }));

        const result = await locator.waitForText(123);
        assert.strictEqual(result, true);
      });

      it('should throw error when connection drops', async () => {
        mockCdp.send = mock.fn(async () => {
          throw new Error('Connection reset');
        });

        await assert.rejects(
          () => locator.waitForText('test'),
          (err) => {
            assert.ok(err.message.includes('Connection reset'));
            return true;
          }
        );
      });
    });

    describe('getBoundingBox edge cases', () => {
      it('should return null for null nodeId', async () => {
        const result = await locator.getBoundingBox(null);
        assert.strictEqual(result, null);
      });

      it('should return null for undefined nodeId', async () => {
        const result = await locator.getBoundingBox(undefined);
        assert.strictEqual(result, null);
      });

      it('should return null when element is removed', async () => {
        mockCdp.send = mock.fn(async () => {
          throw new Error('Object not found');
        });

        const result = await locator.getBoundingBox('removed-obj');
        assert.strictEqual(result, null);
      });

      it('should return null when result has exception', async () => {
        mockCdp.send = mock.fn(async () => ({
          exceptionDetails: { text: 'Element detached' }
        }));

        const result = await locator.getBoundingBox('detached-obj');
        assert.strictEqual(result, null);
      });
    });
  });
});
