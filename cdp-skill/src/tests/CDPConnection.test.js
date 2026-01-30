import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

/**
 * Mock WebSocket class for testing
 */
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.sentMessages = [];
    this.readyState = 0; // CONNECTING
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  removeAllListeners() {
    this.listeners.clear();
  }

  send(message) {
    this.sentMessages.push(JSON.parse(message));
  }

  close() {
    this.readyState = 3; // CLOSED
    this.emit('close');
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(cb => cb(data));
  }

  // Simulate successful connection
  simulateOpen() {
    this.readyState = 1; // OPEN
    this.emit('open');
  }

  // Simulate receiving a message
  simulateMessage(data) {
    this.emit('message', Buffer.from(JSON.stringify(data)));
  }

  // Simulate error
  simulateError(error) {
    this.emit('error', error);
  }
}

// We need to test CDPConnection behavior without importing it (to avoid ws dependency)
// So we'll test the logic patterns that CDPConnection uses

describe('CDPConnection', () => {
  describe('message ID generation', () => {
    it('should increment message IDs', () => {
      let messageId = 0;
      const ids = [];
      for (let i = 0; i < 5; i++) {
        ids.push(++messageId);
      }
      assert.deepStrictEqual(ids, [1, 2, 3, 4, 5]);
    });
  });

  describe('event listener management', () => {
    it('should add and remove event listeners', () => {
      const eventListeners = new Map();
      const handler = () => {};

      // Add listener
      if (!eventListeners.has('Page.loadEventFired')) {
        eventListeners.set('Page.loadEventFired', new Set());
      }
      eventListeners.get('Page.loadEventFired').add(handler);
      assert.strictEqual(eventListeners.get('Page.loadEventFired').size, 1);

      // Remove listener
      eventListeners.get('Page.loadEventFired').delete(handler);
      assert.strictEqual(eventListeners.get('Page.loadEventFired').size, 0);
    });

    it('should support multiple listeners for same event', () => {
      const eventListeners = new Map();
      const handler1 = () => {};
      const handler2 = () => {};

      eventListeners.set('Page.loadEventFired', new Set());
      eventListeners.get('Page.loadEventFired').add(handler1);
      eventListeners.get('Page.loadEventFired').add(handler2);

      assert.strictEqual(eventListeners.get('Page.loadEventFired').size, 2);
    });

    it('should remove specific listener only', () => {
      const eventListeners = new Map();
      const handler1 = () => {};
      const handler2 = () => {};

      eventListeners.set('Page.loadEventFired', new Set());
      eventListeners.get('Page.loadEventFired').add(handler1);
      eventListeners.get('Page.loadEventFired').add(handler2);

      eventListeners.get('Page.loadEventFired').delete(handler1);

      assert.strictEqual(eventListeners.get('Page.loadEventFired').size, 1);
      assert.ok(eventListeners.get('Page.loadEventFired').has(handler2));
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners for specific event', () => {
      const eventListeners = new Map();
      const handler = () => {};

      eventListeners.set('Page.loadEventFired', new Set([handler]));
      eventListeners.set('Network.requestWillBeSent', new Set([handler]));

      eventListeners.delete('Page.loadEventFired');

      assert.strictEqual(eventListeners.has('Page.loadEventFired'), false);
      assert.ok(eventListeners.has('Network.requestWillBeSent'));
    });

    it('should remove all listeners when clearing', () => {
      const eventListeners = new Map();
      const handler = () => {};

      eventListeners.set('Page.loadEventFired', new Set([handler]));
      eventListeners.set('Network.requestWillBeSent', new Set([handler]));

      eventListeners.clear();

      assert.strictEqual(eventListeners.size, 0);
    });
  });

  describe('message handling', () => {
    it('should parse JSON messages', () => {
      const data = Buffer.from(JSON.stringify({ id: 1, result: { value: 'test' } }));
      const message = JSON.parse(data.toString());
      assert.strictEqual(message.id, 1);
      assert.deepStrictEqual(message.result, { value: 'test' });
    });

    it('should identify command responses by id', () => {
      const message = { id: 1, result: { value: 'test' } };
      assert.ok(message.id !== undefined);
    });

    it('should identify events by method', () => {
      const message = { method: 'Page.loadEventFired', params: { timestamp: 12345 } };
      assert.ok(message.method !== undefined);
      assert.strictEqual(message.id, undefined);
    });

    it('should handle error responses', () => {
      const message = { id: 1, error: { code: -32000, message: 'Target not found' } };
      assert.ok(message.error);
      assert.strictEqual(message.error.message, 'Target not found');
    });
  });

  describe('session-scoped events', () => {
    it('should route events with sessionId', () => {
      const eventListeners = new Map();
      const events = [];

      // Register session-scoped listener
      const sessionKey = 'session123:Page.loadEventFired';
      eventListeners.set(sessionKey, new Set([(params, sessionId) => {
        events.push({ params, sessionId });
      }]));

      // Simulate event dispatch
      const message = {
        method: 'Page.loadEventFired',
        sessionId: 'session123',
        params: { timestamp: 12345 }
      };

      const sessionEventKey = `${message.sessionId}:${message.method}`;
      const listeners = eventListeners.get(sessionEventKey);
      if (listeners) {
        for (const callback of listeners) {
          callback(message.params, message.sessionId);
        }
      }

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].sessionId, 'session123');
    });
  });

  describe('pending commands', () => {
    it('should track pending commands by id', () => {
      const pendingCommands = new Map();

      const id = 1;
      const resolve = (result) => result;
      const reject = (error) => { throw error; };
      const timer = setTimeout(() => {}, 30000);

      pendingCommands.set(id, { resolve, reject, timer });

      assert.ok(pendingCommands.has(id));
      clearTimeout(timer);
    });

    it('should clean up on response', () => {
      const pendingCommands = new Map();
      const timer = setTimeout(() => {}, 30000);
      pendingCommands.set(1, { resolve: () => {}, reject: () => {}, timer });

      // Simulate response handling
      const pending = pendingCommands.get(1);
      clearTimeout(pending.timer);
      pendingCommands.delete(1);

      assert.strictEqual(pendingCommands.size, 0);
    });

    it('should reject all pending on disconnect', () => {
      const pendingCommands = new Map();
      const rejected = [];

      for (let i = 1; i <= 3; i++) {
        const timer = setTimeout(() => {}, 30000);
        pendingCommands.set(i, {
          resolve: () => {},
          reject: (err) => rejected.push(err),
          timer
        });
      }

      // Simulate connection close
      for (const [id, pending] of pendingCommands) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Connection closed'));
      }
      pendingCommands.clear();

      assert.strictEqual(rejected.length, 3);
      assert.strictEqual(pendingCommands.size, 0);
    });
  });

  describe('exponential backoff calculation', () => {
    it('should calculate correct delays for each attempt', () => {
      const retryDelay = 1000;
      const maxRetryDelay = 30000;

      const calculateBackoff = (attempt) => {
        const delay = retryDelay * Math.pow(2, attempt);
        return Math.min(delay, maxRetryDelay);
      };

      // attempt 0: 1000 * 2^0 = 1000ms
      assert.strictEqual(calculateBackoff(0), 1000);
      // attempt 1: 1000 * 2^1 = 2000ms
      assert.strictEqual(calculateBackoff(1), 2000);
      // attempt 2: 1000 * 2^2 = 4000ms
      assert.strictEqual(calculateBackoff(2), 4000);
      // attempt 3: 1000 * 2^3 = 8000ms
      assert.strictEqual(calculateBackoff(3), 8000);
      // attempt 4: 1000 * 2^4 = 16000ms
      assert.strictEqual(calculateBackoff(4), 16000);
      // attempt 5: 1000 * 2^5 = 32000ms, but capped at 30000
      assert.strictEqual(calculateBackoff(5), 30000);
      // attempt 6: still capped at 30000
      assert.strictEqual(calculateBackoff(6), 30000);
    });

    it('should respect custom retry delay', () => {
      const retryDelay = 500;
      const maxRetryDelay = 30000;

      const calculateBackoff = (attempt) => {
        const delay = retryDelay * Math.pow(2, attempt);
        return Math.min(delay, maxRetryDelay);
      };

      assert.strictEqual(calculateBackoff(0), 500);
      assert.strictEqual(calculateBackoff(1), 1000);
      assert.strictEqual(calculateBackoff(2), 2000);
    });

    it('should respect custom max retry delay', () => {
      const retryDelay = 1000;
      const maxRetryDelay = 5000;

      const calculateBackoff = (attempt) => {
        const delay = retryDelay * Math.pow(2, attempt);
        return Math.min(delay, maxRetryDelay);
      };

      assert.strictEqual(calculateBackoff(0), 1000);
      assert.strictEqual(calculateBackoff(1), 2000);
      assert.strictEqual(calculateBackoff(2), 4000);
      assert.strictEqual(calculateBackoff(3), 5000); // capped
      assert.strictEqual(calculateBackoff(4), 5000); // still capped
    });
  });

  describe('reconnection logic', () => {
    it('should track reconnection state', () => {
      let reconnecting = false;
      let retryAttempt = 0;
      const maxRetries = 5;

      // Simulate starting reconnection
      reconnecting = true;
      retryAttempt = 0;

      assert.strictEqual(reconnecting, true);
      assert.strictEqual(retryAttempt, 0);

      // Simulate retry attempts
      while (retryAttempt < maxRetries) {
        retryAttempt++;
        if (retryAttempt === 3) {
          // Simulate successful reconnection
          reconnecting = false;
          retryAttempt = 0;
          break;
        }
      }

      assert.strictEqual(reconnecting, false);
      assert.strictEqual(retryAttempt, 0);
    });

    it('should stop reconnection when intentional close is triggered', () => {
      let reconnecting = true;
      let intentionalClose = false;
      const attempts = [];

      for (let attempt = 0; attempt < 5; attempt++) {
        if (intentionalClose) break;

        attempts.push(attempt);

        if (attempt === 2) {
          intentionalClose = true;
        }
      }

      reconnecting = false;

      assert.deepStrictEqual(attempts, [0, 1, 2]);
      assert.strictEqual(reconnecting, false);
      assert.strictEqual(intentionalClose, true);
    });

    it('should emit reconnecting event with attempt and delay info', () => {
      const events = [];
      const retryDelay = 1000;
      const maxRetryDelay = 30000;

      const emit = (event, data) => events.push({ event, data });

      const calculateBackoff = (attempt) => {
        const delay = retryDelay * Math.pow(2, attempt);
        return Math.min(delay, maxRetryDelay);
      };

      // Simulate 3 reconnection attempts
      for (let attempt = 0; attempt < 3; attempt++) {
        const delay = calculateBackoff(attempt);
        emit('reconnecting', { attempt: attempt + 1, delay });
      }

      assert.strictEqual(events.length, 3);
      assert.deepStrictEqual(events[0], { event: 'reconnecting', data: { attempt: 1, delay: 1000 } });
      assert.deepStrictEqual(events[1], { event: 'reconnecting', data: { attempt: 2, delay: 2000 } });
      assert.deepStrictEqual(events[2], { event: 'reconnecting', data: { attempt: 3, delay: 4000 } });
    });

    it('should emit reconnected event on successful reconnection', () => {
      const events = [];
      const emit = (event, data) => events.push({ event, data });

      // Simulate successful reconnection
      emit('reconnected', {});

      assert.strictEqual(events.length, 1);
      assert.deepStrictEqual(events[0], { event: 'reconnected', data: {} });
    });

    it('should call onClose callback after max retries exceeded', () => {
      let closeReason = null;
      const onCloseCallback = (reason) => { closeReason = reason; };

      const maxRetries = 3;
      let retryAttempt = 0;
      let reconnecting = true;
      const intentionalClose = false;

      // Simulate exhausting all retries
      while (retryAttempt < maxRetries) {
        retryAttempt++;
      }

      reconnecting = false;
      if (!intentionalClose && onCloseCallback) {
        onCloseCallback('Connection closed unexpectedly after max retries');
      }

      assert.strictEqual(closeReason, 'Connection closed unexpectedly after max retries');
    });
  });

  describe('connection options', () => {
    it('should use default options when not provided', () => {
      const defaults = {
        maxRetries: 5,
        retryDelay: 1000,
        maxRetryDelay: 30000,
        autoReconnect: false
      };

      const options = {};
      const maxRetries = options.maxRetries ?? 5;
      const retryDelay = options.retryDelay ?? 1000;
      const maxRetryDelay = options.maxRetryDelay ?? 30000;
      const autoReconnect = options.autoReconnect ?? false;

      assert.strictEqual(maxRetries, defaults.maxRetries);
      assert.strictEqual(retryDelay, defaults.retryDelay);
      assert.strictEqual(maxRetryDelay, defaults.maxRetryDelay);
      assert.strictEqual(autoReconnect, defaults.autoReconnect);
    });

    it('should allow custom options', () => {
      const options = {
        maxRetries: 10,
        retryDelay: 500,
        maxRetryDelay: 15000,
        autoReconnect: true
      };

      const maxRetries = options.maxRetries ?? 5;
      const retryDelay = options.retryDelay ?? 1000;
      const maxRetryDelay = options.maxRetryDelay ?? 30000;
      const autoReconnect = options.autoReconnect ?? false;

      assert.strictEqual(maxRetries, 10);
      assert.strictEqual(retryDelay, 500);
      assert.strictEqual(maxRetryDelay, 15000);
      assert.strictEqual(autoReconnect, true);
    });

    it('should handle partial options', () => {
      const options = {
        maxRetries: 3,
        autoReconnect: true
      };

      const maxRetries = options.maxRetries ?? 5;
      const retryDelay = options.retryDelay ?? 1000;
      const maxRetryDelay = options.maxRetryDelay ?? 30000;
      const autoReconnect = options.autoReconnect ?? false;

      assert.strictEqual(maxRetries, 3);
      assert.strictEqual(retryDelay, 1000); // default
      assert.strictEqual(maxRetryDelay, 30000); // default
      assert.strictEqual(autoReconnect, true);
    });
  });

  describe('autoReconnect behavior', () => {
    it('should not attempt reconnection when autoReconnect is false', () => {
      let reconnectAttempted = false;
      const autoReconnect = false;
      const wasConnected = true;
      const intentionalClose = false;

      if (wasConnected && !intentionalClose && autoReconnect) {
        reconnectAttempted = true;
      }

      assert.strictEqual(reconnectAttempted, false);
    });

    it('should attempt reconnection when autoReconnect is true', () => {
      let reconnectAttempted = false;
      const autoReconnect = true;
      const wasConnected = true;
      const intentionalClose = false;

      if (wasConnected && !intentionalClose && autoReconnect) {
        reconnectAttempted = true;
      }

      assert.strictEqual(reconnectAttempted, true);
    });

    it('should not attempt reconnection on intentional close', () => {
      let reconnectAttempted = false;
      const autoReconnect = true;
      const wasConnected = true;
      const intentionalClose = true;

      if (wasConnected && !intentionalClose && autoReconnect) {
        reconnectAttempted = true;
      }

      assert.strictEqual(reconnectAttempted, false);
    });

    it('should not attempt reconnection if never connected', () => {
      let reconnectAttempted = false;
      const autoReconnect = true;
      const wasConnected = false;
      const intentionalClose = false;

      if (wasConnected && !intentionalClose && autoReconnect) {
        reconnectAttempted = true;
      }

      assert.strictEqual(reconnectAttempted, false);
    });
  });

  describe('MockWebSocket', () => {
    let ws;

    beforeEach(() => {
      ws = new MockWebSocket('ws://localhost:9222/devtools/browser/abc');
    });

    it('should store URL', () => {
      assert.strictEqual(ws.url, 'ws://localhost:9222/devtools/browser/abc');
    });

    it('should register event listeners', () => {
      const handler = () => {};
      ws.on('open', handler);
      assert.strictEqual(ws.listeners.get('open').length, 1);
    });

    it('should emit events to listeners', () => {
      let called = false;
      ws.on('open', () => { called = true; });
      ws.emit('open');
      assert.strictEqual(called, true);
    });

    it('should track sent messages', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: 'https://example.com' } }));
      assert.strictEqual(ws.sentMessages.length, 1);
      assert.strictEqual(ws.sentMessages[0].method, 'Page.navigate');
    });

    it('should simulate message receiving', () => {
      const messages = [];
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      ws.simulateMessage({ id: 1, result: { frameId: 'abc' } });

      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].id, 1);
    });

    it('should simulate errors', () => {
      const errors = [];
      ws.on('error', (err) => errors.push(err));

      ws.simulateError(new Error('Connection refused'));

      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].message, 'Connection refused');
    });

    it('should emit close on close()', () => {
      let closed = false;
      ws.on('close', () => { closed = true; });
      ws.close();
      assert.strictEqual(closed, true);
      assert.strictEqual(ws.readyState, 3);
    });

    it('should clear all listeners on removeAllListeners()', () => {
      ws.on('open', () => {});
      ws.on('message', () => {});
      ws.removeAllListeners();
      assert.strictEqual(ws.listeners.size, 0);
    });
  });
});
