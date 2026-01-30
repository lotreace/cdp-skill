import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createConsoleCapture } from '../capture.js';

describe('ConsoleCapture', () => {
  let consoleCapture;
  let mockCdp;
  let eventHandlers;

  beforeEach(() => {
    eventHandlers = {};
    mockCdp = {
      send: mock.fn(() => Promise.resolve()),
      on: mock.fn((event, handler) => {
        eventHandlers[event] = handler;
      }),
      off: mock.fn((event, handler) => {
        if (eventHandlers[event] === handler) {
          delete eventHandlers[event];
        }
      })
    };
    consoleCapture = createConsoleCapture(mockCdp);
  });

  afterEach(() => {
    mock.reset();
  });

  describe('factory function', () => {
    it('should create instance via factory function', () => {
      const capture = createConsoleCapture(mockCdp);
      assert.ok(capture);
      assert.strictEqual(typeof capture.startCapture, 'function');
      assert.strictEqual(typeof capture.stopCapture, 'function');
      assert.strictEqual(typeof capture.getMessages, 'function');
    });
  });

  describe('startCapture', () => {
    it('should enable Runtime domain only (not Console)', async () => {
      await consoleCapture.startCapture();

      const sendCalls = mockCdp.send.mock.calls.map(c => c.arguments[0]);
      assert.ok(sendCalls.includes('Runtime.enable'));
      assert.ok(!sendCalls.includes('Console.enable'), 'Console.enable should not be called');
    });

    it('should register only Runtime event handlers', async () => {
      await consoleCapture.startCapture();

      assert.strictEqual(mockCdp.on.mock.calls.length, 2);
      assert.ok(!eventHandlers['Console.messageAdded'], 'Console.messageAdded should not be registered');
      assert.ok(eventHandlers['Runtime.consoleAPICalled']);
      assert.ok(eventHandlers['Runtime.exceptionThrown']);
    });

    it('should not start capturing twice', async () => {
      await consoleCapture.startCapture();
      await consoleCapture.startCapture();

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
    });
  });

  describe('stopCapture', () => {
    it('should disable Runtime domain only (not Console)', async () => {
      await consoleCapture.startCapture();
      await consoleCapture.stopCapture();

      const sendCalls = mockCdp.send.mock.calls.map(c => c.arguments[0]);
      assert.ok(sendCalls.includes('Runtime.disable'));
      assert.ok(!sendCalls.includes('Console.disable'), 'Console.disable should not be called');
    });

    it('should unregister event handlers', async () => {
      await consoleCapture.startCapture();
      await consoleCapture.stopCapture();

      assert.strictEqual(mockCdp.off.mock.calls.length, 2);
    });

    it('should do nothing if not capturing', async () => {
      await consoleCapture.stopCapture();

      assert.strictEqual(mockCdp.send.mock.calls.length, 0);
    });
  });

  describe('message capture', () => {
    it('should capture Runtime.consoleAPICalled events with type "console"', async () => {
      await consoleCapture.startCapture();

      eventHandlers['Runtime.consoleAPICalled']({
        type: 'log',
        args: [{ value: 'Hello' }, { value: 'World' }],
        timestamp: 12345
      });

      const messages = consoleCapture.getMessages();
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].type, 'console');
      assert.strictEqual(messages[0].level, 'log');
      assert.strictEqual(messages[0].text, 'Hello World');
    });

    it('should not produce duplicate messages (only one per console call)', async () => {
      await consoleCapture.startCapture();

      // Only consoleAPICalled should be registered - no Console.messageAdded
      eventHandlers['Runtime.consoleAPICalled']({
        type: 'log',
        args: [{ value: 'Test message' }],
        timestamp: 12345
      });

      const messages = consoleCapture.getMessages();
      assert.strictEqual(messages.length, 1, 'Should have exactly one message per console call');
    });

    it('should capture Runtime.exceptionThrown events', async () => {
      await consoleCapture.startCapture();

      eventHandlers['Runtime.exceptionThrown']({
        timestamp: 12345,
        exceptionDetails: {
          text: 'Uncaught ReferenceError: foo is not defined',
          url: 'http://test.com/app.js',
          lineNumber: 100,
          columnNumber: 5,
          exception: {
            description: 'ReferenceError: foo is not defined'
          }
        }
      });

      const messages = consoleCapture.getMessages();
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].type, 'exception');
      assert.strictEqual(messages[0].level, 'error');
    });
  });

  describe('getMessagesByLevel', () => {
    it('should filter messages by single level', async () => {
      await consoleCapture.startCapture();

      eventHandlers['Runtime.consoleAPICalled']({ type: 'log', args: [{ value: 'Log' }], timestamp: 1 });
      eventHandlers['Runtime.consoleAPICalled']({ type: 'error', args: [{ value: 'Error' }], timestamp: 2 });
      eventHandlers['Runtime.consoleAPICalled']({ type: 'warn', args: [{ value: 'Warning' }], timestamp: 3 });

      const errors = consoleCapture.getMessagesByLevel('error');
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].text, 'Error');
    });

    it('should filter messages by multiple levels', async () => {
      await consoleCapture.startCapture();

      eventHandlers['Runtime.consoleAPICalled']({ type: 'log', args: [{ value: 'Log' }], timestamp: 1 });
      eventHandlers['Runtime.consoleAPICalled']({ type: 'error', args: [{ value: 'Error' }], timestamp: 2 });
      eventHandlers['Runtime.consoleAPICalled']({ type: 'warn', args: [{ value: 'Warning' }], timestamp: 3 });

      const filtered = consoleCapture.getMessagesByLevel(['error', 'warning']);
      assert.strictEqual(filtered.length, 2);
    });
  });

  describe('getErrors', () => {
    it('should return only errors and exceptions', async () => {
      await consoleCapture.startCapture();

      eventHandlers['Runtime.consoleAPICalled']({ type: 'log', args: [{ value: 'Log' }], timestamp: 1 });
      eventHandlers['Runtime.consoleAPICalled']({ type: 'error', args: [{ value: 'Error' }], timestamp: 2 });
      eventHandlers['Runtime.exceptionThrown']({
        timestamp: 3,
        exceptionDetails: { text: 'Exception' }
      });

      const errors = consoleCapture.getErrors();
      assert.strictEqual(errors.length, 2);
    });
  });

  describe('getWarnings', () => {
    it('should return only warnings', async () => {
      await consoleCapture.startCapture();

      eventHandlers['Runtime.consoleAPICalled']({ type: 'warn', args: [{ value: 'Warning 1' }], timestamp: 1 });
      eventHandlers['Runtime.consoleAPICalled']({ type: 'log', args: [{ value: 'Log' }], timestamp: 2 });
      eventHandlers['Runtime.consoleAPICalled']({ type: 'warning', args: [{ value: 'Warning 2' }], timestamp: 3 });

      const warnings = consoleCapture.getWarnings();
      assert.strictEqual(warnings.length, 2);
    });
  });

  describe('hasErrors', () => {
    it('should return false when no errors', async () => {
      await consoleCapture.startCapture();

      eventHandlers['Runtime.consoleAPICalled']({ type: 'log', args: [{ value: 'Log' }], timestamp: 1 });

      assert.strictEqual(consoleCapture.hasErrors(), false);
    });

    it('should return true when errors exist', async () => {
      await consoleCapture.startCapture();

      eventHandlers['Runtime.consoleAPICalled']({ type: 'error', args: [{ value: 'Error' }], timestamp: 1 });

      assert.strictEqual(consoleCapture.hasErrors(), true);
    });
  });

  describe('clear', () => {
    it('should clear all messages', async () => {
      await consoleCapture.startCapture();

      eventHandlers['Runtime.consoleAPICalled']({ type: 'log', args: [{ value: 'Log' }], timestamp: 1 });
      assert.strictEqual(consoleCapture.getMessages().length, 1);

      consoleCapture.clear();
      assert.strictEqual(consoleCapture.getMessages().length, 0);
    });
  });

  describe('clearBrowserConsole', () => {
    it('should send Console.clearMessages', async () => {
      await consoleCapture.clearBrowserConsole();

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[0], 'Console.clearMessages');
    });
  });

  describe('arg formatting', () => {
    it('should format different arg types', async () => {
      await consoleCapture.startCapture();

      eventHandlers['Runtime.consoleAPICalled']({
        type: 'log',
        args: [
          { value: 'string' },
          { description: '[Object]' },
          { unserializableValue: 'Infinity' },
          { type: 'function' }
        ],
        timestamp: 1
      });

      const messages = consoleCapture.getMessages();
      assert.strictEqual(messages[0].text, 'string [Object] Infinity [function]');
    });
  });

  describe('console type mapping', () => {
    it('should map console types to levels', async () => {
      await consoleCapture.startCapture();

      const types = ['log', 'debug', 'info', 'error', 'warn', 'dir', 'table', 'trace', 'assert'];

      for (const type of types) {
        eventHandlers['Runtime.consoleAPICalled']({
          type,
          args: [{ value: type }],
          timestamp: Date.now()
        });
      }

      const messages = consoleCapture.getMessages();
      // log: log, dir, table, trace = 4
      assert.strictEqual(messages.filter(m => m.level === 'log').length, 4);
      assert.strictEqual(messages.filter(m => m.level === 'debug').length, 1);
      assert.strictEqual(messages.filter(m => m.level === 'info').length, 1);
      // error: error, assert = 2
      assert.strictEqual(messages.filter(m => m.level === 'error').length, 2);
      // warning: warn = 1
      assert.strictEqual(messages.filter(m => m.level === 'warning').length, 1);
    });
  });

  describe('maxMessages limit', () => {
    it('should respect maxMessages option', async () => {
      const limitedCapture = createConsoleCapture(mockCdp, { maxMessages: 3 });
      await limitedCapture.startCapture();

      for (let i = 0; i < 5; i++) {
        eventHandlers['Runtime.consoleAPICalled']({
          type: 'log',
          args: [{ value: `Message ${i}` }],
          timestamp: i
        });
      }

      const messages = limitedCapture.getMessages();
      assert.strictEqual(messages.length, 3);
      assert.strictEqual(messages[0].text, 'Message 2');
      assert.strictEqual(messages[2].text, 'Message 4');
    });
  });
});
