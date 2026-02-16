import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  waitForCondition,
  waitForFunction,
  waitForNetworkIdle,
  waitForDocumentReady,
  waitForSelector
} from '../page/index.js';
import { ErrorTypes } from '../utils.js';

describe('WaitStrategy (functional)', () => {
  let mockClient;
  let eventHandlers;

  beforeEach(() => {
    eventHandlers = {};
    mockClient = {
      send: mock.fn(),
      on: mock.fn((event, handler) => {
        if (!eventHandlers[event]) {
          eventHandlers[event] = [];
        }
        eventHandlers[event].push(handler);
      }),
      off: mock.fn((event, handler) => {
        if (eventHandlers[event]) {
          eventHandlers[event] = eventHandlers[event].filter(h => h !== handler);
        }
      })
    };
  });

  const emitEvent = (event, data) => {
    if (eventHandlers[event]) {
      eventHandlers[event].forEach(handler => handler(data));
    }
  };

  describe('waitForCondition', () => {
    it('should resolve immediately if condition is true', async () => {
      let callCount = 0;
      const checkFn = async () => {
        callCount++;
        return true;
      };

      await waitForCondition(checkFn);
      assert.strictEqual(callCount, 1);
    });

    it('should poll until condition is true', async () => {
      let callCount = 0;
      const checkFn = async () => {
        callCount++;
        return callCount >= 3;
      };

      await waitForCondition(checkFn, { pollInterval: 10 });
      assert.strictEqual(callCount, 3);
    });

    it('should throw TimeoutError when condition not met', async () => {
      const checkFn = async () => false;

      await assert.rejects(
        waitForCondition(checkFn, {
          timeout: 50,
          pollInterval: 10,
          message: 'Custom message'
        }),
        (err) => {
          assert.strictEqual(err.name, ErrorTypes.TIMEOUT);
          assert.ok(err.message.includes('Custom message'));
          return true;
        }
      );
    });

    it('should respect custom timeout', async () => {
      const start = Date.now();
      const checkFn = async () => false;

      await assert.rejects(
        waitForCondition(checkFn, { timeout: 100, pollInterval: 10 }),
        (err) => err.name === ErrorTypes.TIMEOUT
      );

      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 100 && elapsed < 200);
    });
  });

  describe('waitForFunction', () => {
    it('should resolve when expression returns truthy', async () => {
      mockClient.send.mock.mockImplementation(async () => ({
        result: { value: 'truthy-value' }
      }));

      const result = await waitForFunction(mockClient, 'someExpression()');
      assert.strictEqual(result, 'truthy-value');
    });

    it('should poll until expression is truthy', async () => {
      let callCount = 0;
      mockClient.send.mock.mockImplementation(async () => {
        callCount++;
        return {
          result: { value: callCount >= 3 ? 'found' : null }
        };
      });

      const result = await waitForFunction(mockClient, 'someExpression()', {
        pollInterval: 10
      });

      assert.strictEqual(result, 'found');
      assert.strictEqual(callCount, 3);
    });

    it('should continue polling when expression throws', async () => {
      let callCount = 0;
      mockClient.send.mock.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return { exceptionDetails: { text: 'Error' } };
        }
        return { result: { value: 'success' } };
      });

      const result = await waitForFunction(mockClient, 'someExpression()', {
        pollInterval: 10
      });

      assert.strictEqual(result, 'success');
    });

    it('should throw TimeoutError when expression never truthy', async () => {
      mockClient.send.mock.mockImplementation(async () => ({
        result: { value: null }
      }));

      await assert.rejects(
        waitForFunction(mockClient, 'falsyExpression()', {
          timeout: 50,
          pollInterval: 10
        }),
        (err) => {
          assert.strictEqual(err.name, ErrorTypes.TIMEOUT);
          assert.ok(err.message.includes('falsyExpression()'));
          return true;
        }
      );
    });

    it('should use awaitPromise for async expressions', async () => {
      mockClient.send.mock.mockImplementation(async (method, params) => {
        assert.strictEqual(params.awaitPromise, true);
        return { result: { value: true } };
      });

      await waitForFunction(mockClient, 'asyncFn()');
    });
  });

  describe('waitForNetworkIdle', () => {
    it('should resolve when no requests are pending', async () => {
      const idlePromise = waitForNetworkIdle(mockClient, { idleTime: 50 });

      // Simulate immediate idle (no requests)
      await idlePromise;
    });

    it('should wait for pending requests to finish', async () => {
      const idlePromise = waitForNetworkIdle(mockClient, {
        idleTime: 50,
        timeout: 2000
      });

      // Simulate a request
      setTimeout(() => {
        emitEvent('Network.requestWillBeSent', { requestId: 'req-1' });
      }, 10);

      setTimeout(() => {
        emitEvent('Network.loadingFinished', { requestId: 'req-1' });
      }, 30);

      await idlePromise;
    });

    it('should reset idle timer when new request starts', async () => {
      const startTime = Date.now();
      const idlePromise = waitForNetworkIdle(mockClient, {
        idleTime: 100,
        timeout: 2000
      });

      // Start first request
      setTimeout(() => {
        emitEvent('Network.requestWillBeSent', { requestId: 'req-1' });
      }, 10);

      // Finish first request
      setTimeout(() => {
        emitEvent('Network.loadingFinished', { requestId: 'req-1' });
      }, 30);

      // Start second request just before idle would fire
      setTimeout(() => {
        emitEvent('Network.requestWillBeSent', { requestId: 'req-2' });
      }, 80);

      // Finish second request
      setTimeout(() => {
        emitEvent('Network.loadingFinished', { requestId: 'req-2' });
      }, 100);

      await idlePromise;
      const elapsed = Date.now() - startTime;
      // Should take longer due to second request resetting idle timer
      assert.ok(elapsed >= 200);
    });

    it('should handle loadingFailed as request finished', async () => {
      const idlePromise = waitForNetworkIdle(mockClient, {
        idleTime: 50,
        timeout: 2000
      });

      setTimeout(() => {
        emitEvent('Network.requestWillBeSent', { requestId: 'req-1' });
      }, 10);

      setTimeout(() => {
        emitEvent('Network.loadingFailed', { requestId: 'req-1' });
      }, 30);

      await idlePromise;
    });

    it('should throw TimeoutError if network never idle', async () => {
      const idlePromise = waitForNetworkIdle(mockClient, {
        idleTime: 50,
        timeout: 100
      });

      // Keep making requests
      let reqCount = 0;
      const interval = setInterval(() => {
        emitEvent('Network.requestWillBeSent', { requestId: `req-${reqCount++}` });
      }, 20);

      await assert.rejects(idlePromise, (err) => err.name === ErrorTypes.TIMEOUT);
      clearInterval(interval);
    });

    it('should cleanup event listeners on resolve', async () => {
      const initialOffCount = mockClient.off.mock.calls.length;

      await waitForNetworkIdle(mockClient, { idleTime: 10 });

      const finalOffCount = mockClient.off.mock.calls.length;
      assert.ok(finalOffCount > initialOffCount);
    });

    it('should cleanup event listeners on timeout', async () => {
      const initialOffCount = mockClient.off.mock.calls.length;

      // Keep making requests to trigger timeout
      const interval = setInterval(() => {
        emitEvent('Network.requestWillBeSent', { requestId: `req-${Date.now()}` });
      }, 10);

      await assert.rejects(
        waitForNetworkIdle(mockClient, { idleTime: 50, timeout: 50 }),
        (err) => err.name === ErrorTypes.TIMEOUT
      );

      clearInterval(interval);

      const finalOffCount = mockClient.off.mock.calls.length;
      assert.ok(finalOffCount > initialOffCount);
    });
  });

  describe('waitForDocumentReady', () => {
    it('should resolve when document is complete', async () => {
      mockClient.send.mock.mockImplementation(async () => ({
        result: { value: 'complete' }
      }));

      const state = await waitForDocumentReady(mockClient, 'complete');
      assert.strictEqual(state, 'complete');
    });

    it('should resolve when document reaches target state', async () => {
      mockClient.send.mock.mockImplementation(async () => ({
        result: { value: 'interactive' }
      }));

      const state = await waitForDocumentReady(mockClient, 'interactive');
      assert.strictEqual(state, 'interactive');
    });

    it('should resolve when document exceeds target state', async () => {
      mockClient.send.mock.mockImplementation(async () => ({
        result: { value: 'complete' }
      }));

      const state = await waitForDocumentReady(mockClient, 'loading');
      assert.strictEqual(state, 'complete');
    });

    it('should poll until target state reached', async () => {
      let callCount = 0;
      const states = ['loading', 'loading', 'interactive', 'complete'];

      mockClient.send.mock.mockImplementation(async () => ({
        result: { value: states[Math.min(callCount++, states.length - 1)] }
      }));

      const state = await waitForDocumentReady(mockClient, 'complete', {
        pollInterval: 10
      });

      assert.strictEqual(state, 'complete');
    });

    it('should throw on invalid target state', async () => {
      await assert.rejects(
        waitForDocumentReady(mockClient, 'invalid'),
        /Invalid target state/
      );
    });

    it('should throw TimeoutError when state not reached', async () => {
      mockClient.send.mock.mockImplementation(async () => ({
        result: { value: 'loading' }
      }));

      await assert.rejects(
        waitForDocumentReady(mockClient, 'complete', { timeout: 50, pollInterval: 10 }),
        (err) => err.name === ErrorTypes.TIMEOUT
      );
    });
  });

  describe('waitForSelector', () => {
    it('should resolve when selector found', async () => {
      mockClient.send.mock.mockImplementation(async () => ({
        result: { value: true }
      }));

      await waitForSelector(mockClient, '#my-element');
    });

    it('should poll until selector found', async () => {
      let callCount = 0;
      mockClient.send.mock.mockImplementation(async () => ({
        result: { value: callCount++ >= 2 }
      }));

      await waitForSelector(mockClient, '.my-class', { pollInterval: 10 });
      assert.ok(callCount >= 3);
    });

    it('should check visibility when visible option is true', async () => {
      let expression = '';
      mockClient.send.mock.mockImplementation(async (method, params) => {
        expression = params.expression;
        return { result: { value: true } };
      });

      await waitForSelector(mockClient, '#visible-el', { visible: true });

      assert.ok(expression.includes('getComputedStyle'));
      assert.ok(expression.includes('display'));
      assert.ok(expression.includes('visibility'));
      assert.ok(expression.includes('opacity'));
    });

    it('should escape single quotes in selector', async () => {
      let expression = '';
      mockClient.send.mock.mockImplementation(async (method, params) => {
        expression = params.expression;
        return { result: { value: true } };
      });

      await waitForSelector(mockClient, "[data-test='value']");

      assert.ok(expression.includes("\\'"));
    });

    it('should throw TimeoutError when selector not found', async () => {
      mockClient.send.mock.mockImplementation(async () => ({
        result: { value: false }
      }));

      await assert.rejects(
        waitForSelector(mockClient, '#nonexistent', { timeout: 50, pollInterval: 10 }),
        (err) => err.name === ErrorTypes.TIMEOUT
      );
    });
  });
});
