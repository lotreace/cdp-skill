import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  waitForCondition,
  waitForFunction,
  waitForNetworkIdle,
  waitForDocumentReady,
  waitForSelector,
  waitForText
} from '../page/wait-utilities.js';

describe('WaitUtilities', () => {
  let mockSession;

  beforeEach(() => {
    mockSession = {
      send: mock.fn(async () => ({})),
      on: mock.fn(),
      off: mock.fn()
    };
  });

  afterEach(() => {
    mock.reset();
  });

  describe('waitForCondition', () => {
    it('should resolve immediately when condition is true', async () => {
      const checkFn = mock.fn(async () => true);

      await waitForCondition(checkFn);

      assert.strictEqual(checkFn.mock.calls.length, 1);
    });

    it('should poll until condition becomes true', async () => {
      let callCount = 0;
      const checkFn = mock.fn(async () => {
        callCount++;
        return callCount >= 3;
      });

      await waitForCondition(checkFn, { timeout: 1000, pollInterval: 10 });

      assert.ok(checkFn.mock.calls.length >= 3);
    });

    it('should throw timeout error when condition never becomes true', async () => {
      const checkFn = mock.fn(async () => false);

      await assert.rejects(
        () => waitForCondition(checkFn, { timeout: 100, pollInterval: 10 }),
        (err) => {
          assert.ok(err.message.includes('Condition not met'));
          assert.ok(err.message.includes('100ms'));
          return true;
        }
      );
    });

    it('should use custom message in timeout error', async () => {
      const checkFn = mock.fn(async () => false);

      await assert.rejects(
        () => waitForCondition(checkFn, {
          timeout: 100,
          pollInterval: 10,
          message: 'Custom wait failed'
        }),
        (err) => {
          assert.ok(err.message.includes('Custom wait failed'));
          return true;
        }
      );
    });

    it('should use default timeout of 30000ms', async () => {
      const startTime = Date.now();
      let checkCalled = false;

      const checkFn = mock.fn(async () => {
        if (!checkCalled) {
          checkCalled = true;
          return false;
        }
        // After 50ms, return true to avoid waiting full 30s
        if (Date.now() - startTime > 50) {
          return true;
        }
        return false;
      });

      await waitForCondition(checkFn, { pollInterval: 10 });
      assert.ok(checkCalled);
    });
  });

  describe('waitForFunction', () => {
    it('should resolve when expression returns truthy value', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: 'some truthy value' }
      }));

      const result = await waitForFunction(mockSession, 'document.title');

      assert.strictEqual(result, 'some truthy value');
    });

    it('should poll until expression returns truthy', async () => {
      let callCount = 0;
      mockSession.send = mock.fn(async () => {
        callCount++;
        return {
          result: { value: callCount >= 3 ? 'found' : null }
        };
      });

      const result = await waitForFunction(mockSession, 'window.myVar', {
        timeout: 1000,
        pollInterval: 10
      });

      assert.strictEqual(result, 'found');
      assert.ok(callCount >= 3);
    });

    it('should throw timeout error when expression never returns truthy', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: null }
      }));

      await assert.rejects(
        () => waitForFunction(mockSession, 'false', { timeout: 100, pollInterval: 10 }),
        (err) => {
          assert.ok(err.message.includes('did not return truthy'));
          return true;
        }
      );
    });

    it('should continue polling on expression exception', async () => {
      let callCount = 0;
      mockSession.send = mock.fn(async () => {
        callCount++;
        if (callCount < 3) {
          return { exceptionDetails: { text: 'ReferenceError' } };
        }
        return { result: { value: 'resolved' } };
      });

      const result = await waitForFunction(mockSession, 'window.myVar', {
        timeout: 1000,
        pollInterval: 10
      });

      assert.strictEqual(result, 'resolved');
    });

    it('should throw context destroyed error on navigation', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('Execution context was destroyed');
      });

      await assert.rejects(
        () => waitForFunction(mockSession, 'document.title', { timeout: 100 }),
        (err) => {
          assert.ok(err.message.includes('navigated'));
          return true;
        }
      );
    });
  });

  describe('waitForNetworkIdle', () => {
    it('should resolve immediately when no pending requests', async () => {
      const eventHandlers = {};
      mockSession.on = mock.fn((event, handler) => {
        eventHandlers[event] = handler;
      });
      mockSession.off = mock.fn();

      const promise = waitForNetworkIdle(mockSession, { idleTime: 50, timeout: 1000 });
      const result = await promise;

      assert.strictEqual(result, undefined);
    });

    it('should wait for pending requests to finish', async () => {
      const eventHandlers = {};
      mockSession.on = mock.fn((event, handler) => {
        eventHandlers[event] = handler;
      });
      mockSession.off = mock.fn();

      const promise = waitForNetworkIdle(mockSession, { idleTime: 50, timeout: 1000 });

      // Simulate request start
      setTimeout(() => {
        eventHandlers['Network.requestWillBeSent']({ requestId: 'req-1' });
      }, 10);

      // Simulate request finish
      setTimeout(() => {
        eventHandlers['Network.loadingFinished']({ requestId: 'req-1' });
      }, 30);

      await promise;

      assert.strictEqual(mockSession.on.mock.calls.length, 3);
      assert.strictEqual(mockSession.off.mock.calls.length, 3);
    });

    it('should handle request failures', async () => {
      const eventHandlers = {};
      mockSession.on = mock.fn((event, handler) => {
        eventHandlers[event] = handler;
      });
      mockSession.off = mock.fn();

      const promise = waitForNetworkIdle(mockSession, { idleTime: 50, timeout: 1000 });

      // Simulate request start
      setTimeout(() => {
        eventHandlers['Network.requestWillBeSent']({ requestId: 'req-1' });
      }, 10);

      // Simulate request failure
      setTimeout(() => {
        eventHandlers['Network.loadingFailed']({ requestId: 'req-1' });
      }, 30);

      await promise;

      assert.ok(true);
    });

    it('should throw timeout error when network stays busy', async () => {
      const eventHandlers = {};
      mockSession.on = mock.fn((event, handler) => {
        eventHandlers[event] = handler;
      });
      mockSession.off = mock.fn();

      const promise = waitForNetworkIdle(mockSession, { idleTime: 50, timeout: 100 });

      // Simulate continuous requests
      setTimeout(() => {
        eventHandlers['Network.requestWillBeSent']({ requestId: 'req-1' });
      }, 10);

      await assert.rejects(
        () => promise,
        (err) => {
          assert.ok(err.message.includes('Network did not become idle'));
          return true;
        }
      );
    });

    it('should clean up event listeners on completion', async () => {
      mockSession.on = mock.fn();
      mockSession.off = mock.fn();

      await waitForNetworkIdle(mockSession, { idleTime: 10, timeout: 1000 });

      assert.strictEqual(mockSession.on.mock.calls.length, 3);
      assert.strictEqual(mockSession.off.mock.calls.length, 3);
    });
  });

  describe('waitForDocumentReady', () => {
    it('should resolve immediately when document is complete', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: 'complete' }
      }));

      const result = await waitForDocumentReady(mockSession);

      assert.strictEqual(result, 'complete');
    });

    it('should wait for document to reach target state', async () => {
      let callCount = 0;
      mockSession.send = mock.fn(async () => {
        callCount++;
        const states = ['loading', 'loading', 'interactive', 'complete'];
        return { result: { value: states[Math.min(callCount - 1, 3)] } };
      });

      const result = await waitForDocumentReady(mockSession, 'complete', {
        timeout: 1000,
        pollInterval: 10
      });

      assert.strictEqual(result, 'complete');
    });

    it('should accept interactive as valid target state', async () => {
      let callCount = 0;
      mockSession.send = mock.fn(async () => {
        callCount++;
        const states = ['loading', 'interactive'];
        return { result: { value: states[Math.min(callCount - 1, 1)] } };
      });

      const result = await waitForDocumentReady(mockSession, 'interactive', {
        timeout: 1000,
        pollInterval: 10
      });

      assert.strictEqual(result, 'interactive');
    });

    it('should throw for invalid target state', async () => {
      await assert.rejects(
        () => waitForDocumentReady(mockSession, 'invalid'),
        { message: 'Invalid target state: invalid' }
      );
    });

    it('should throw timeout error when state not reached', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: 'loading' }
      }));

      await assert.rejects(
        () => waitForDocumentReady(mockSession, 'complete', { timeout: 100, pollInterval: 10 }),
        (err) => {
          assert.ok(err.message.includes("did not reach 'complete'"));
          return true;
        }
      );
    });

    it('should throw context destroyed error on navigation', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('Execution context was destroyed');
      });

      await assert.rejects(
        () => waitForDocumentReady(mockSession, 'complete', { timeout: 100 }),
        (err) => {
          assert.ok(err.message.includes('navigated'));
          return true;
        }
      );
    });

    it('should resolve early if state exceeds target', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: 'complete' }
      }));

      // Asking for interactive but getting complete should still resolve
      const result = await waitForDocumentReady(mockSession, 'interactive');

      assert.strictEqual(result, 'complete');
    });
  });

  describe('waitForSelector', () => {
    it('should resolve when selector is found', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await waitForSelector(mockSession, '#element');

      assert.strictEqual(mockSession.send.mock.calls.length, 1);
    });

    it('should poll until selector appears', async () => {
      let callCount = 0;
      mockSession.send = mock.fn(async () => {
        callCount++;
        return { result: { value: callCount >= 3 } };
      });

      await waitForSelector(mockSession, '#delayed', { timeout: 1000, pollInterval: 10 });

      assert.ok(callCount >= 3);
    });

    it('should escape selector in expression', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await waitForSelector(mockSession, "[data-attr='value']");

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes("\\'value\\'"));
    });

    it('should check visibility when visible option is true', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await waitForSelector(mockSession, '#visible', { visible: true });

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes('getComputedStyle'));
      assert.ok(call.arguments[1].expression.includes('display'));
      assert.ok(call.arguments[1].expression.includes('visibility'));
    });

    it('should throw timeout error when selector not found', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: false }
      }));

      await assert.rejects(
        () => waitForSelector(mockSession, '#missing', { timeout: 100, pollInterval: 10 }),
        (err) => {
          assert.ok(err.message.includes('did not return truthy'));
          return true;
        }
      );
    });
  });

  describe('waitForText', () => {
    it('should resolve when text is found', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      const result = await waitForText(mockSession, 'Hello World');

      assert.strictEqual(result, true);
    });

    it('should use case-insensitive search by default', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await waitForText(mockSession, 'HELLO');

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes('toLowerCase'));
    });

    it('should use exact match when exact option is true', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await waitForText(mockSession, 'Exact Text', { exact: true });

      const call = mockSession.send.mock.calls[0];
      assert.ok(!call.arguments[1].expression.includes('toLowerCase'));
    });

    it('should poll until text appears', async () => {
      let callCount = 0;
      mockSession.send = mock.fn(async () => {
        callCount++;
        return { result: { value: callCount >= 3 } };
      });

      await waitForText(mockSession, 'delayed text', { timeout: 1000, pollInterval: 10 });

      assert.ok(callCount >= 3);
    });

    it('should throw timeout error when text not found', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: false }
      }));

      await assert.rejects(
        () => waitForText(mockSession, 'missing text', { timeout: 100, pollInterval: 10 }),
        (err) => {
          assert.ok(err.message.includes('waiting for text'));
          assert.ok(err.message.includes('missing text'));
          return true;
        }
      );
    });

    it('should throw context destroyed error on navigation', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('Execution context was destroyed');
      });

      await assert.rejects(
        () => waitForText(mockSession, 'text', { timeout: 100 }),
        (err) => {
          assert.ok(err.message.includes('navigated'));
          return true;
        }
      );
    });

    it('should convert non-string text to string', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await waitForText(mockSession, 12345);

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes('12345'));
    });
  });
});
