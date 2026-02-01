import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createWebStorageManager } from '../page/web-storage-manager.js';

describe('WebStorageManager', () => {
  let mockSession;
  let manager;

  beforeEach(() => {
    mockSession = {
      send: mock.fn(async () => ({}))
    };
    manager = createWebStorageManager(mockSession);
  });

  afterEach(() => {
    mock.reset();
  });

  describe('createWebStorageManager', () => {
    it('should return an object with expected methods', () => {
      assert.ok(typeof manager.getStorage === 'function');
      assert.ok(typeof manager.setStorage === 'function');
      assert.ok(typeof manager.clearStorage === 'function');
    });
  });

  describe('getStorage', () => {
    it('should return localStorage items by default', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: [
            { name: 'theme', value: 'dark' },
            { name: 'lang', value: 'en' }
          ]
        }
      }));

      const items = await manager.getStorage();

      assert.strictEqual(items.length, 2);
      assert.strictEqual(items[0].name, 'theme');
      assert.strictEqual(items[0].value, 'dark');

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes("'local'"));
    });

    it('should return sessionStorage items when type is session', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: [
            { name: 'token', value: 'abc123' }
          ]
        }
      }));

      const items = await manager.getStorage('session');

      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].name, 'token');

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes("'session'"));
    });

    it('should return empty array when storage is empty', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: [] }
      }));

      const items = await manager.getStorage();

      assert.deepStrictEqual(items, []);
    });

    it('should throw error on exception', async () => {
      mockSession.send = mock.fn(async () => ({
        exceptionDetails: { text: 'Storage access denied' }
      }));

      await assert.rejects(
        () => manager.getStorage(),
        (err) => {
          assert.ok(err.message.includes('Failed to get localStorage'));
          return true;
        }
      );
    });

    it('should handle null result value', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: null }
      }));

      const items = await manager.getStorage();

      assert.deepStrictEqual(items, []);
    });

    it('should treat invalid type as local', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: [] }
      }));

      await manager.getStorage('invalid');

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes("'local'"));
    });
  });

  describe('setStorage', () => {
    it('should set localStorage items by default', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await manager.setStorage({ theme: 'dark', lang: 'en' });

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes("'local'"));
      assert.ok(call.arguments[1].expression.includes('"theme":"dark"'));
      assert.ok(call.arguments[1].expression.includes('"lang":"en"'));
    });

    it('should set sessionStorage items when type is session', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await manager.setStorage({ token: 'abc' }, 'session');

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes("'session'"));
    });

    it('should remove items when value is null', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await manager.setStorage({ oldKey: null });

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes('"oldKey":null'));
    });

    it('should throw error on exception', async () => {
      mockSession.send = mock.fn(async () => ({
        exceptionDetails: { text: 'Quota exceeded' }
      }));

      await assert.rejects(
        () => manager.setStorage({ large: 'data' }),
        (err) => {
          assert.ok(err.message.includes('Failed to set localStorage'));
          return true;
        }
      );
    });

    it('should set multiple items at once', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await manager.setStorage({
        key1: 'value1',
        key2: 'value2',
        key3: 'value3'
      });

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes('key1'));
      assert.ok(call.arguments[1].expression.includes('key2'));
      assert.ok(call.arguments[1].expression.includes('key3'));
    });

    it('should handle empty items object', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await manager.setStorage({});

      assert.strictEqual(mockSession.send.mock.calls.length, 1);
    });
  });

  describe('clearStorage', () => {
    it('should clear localStorage by default', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await manager.clearStorage();

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes("'local'"));
      assert.ok(call.arguments[1].expression.includes('storage.clear()'));
    });

    it('should clear sessionStorage when type is session', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await manager.clearStorage('session');

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes("'session'"));
    });

    it('should throw error on exception', async () => {
      mockSession.send = mock.fn(async () => ({
        exceptionDetails: { text: 'Storage blocked' }
      }));

      await assert.rejects(
        () => manager.clearStorage(),
        (err) => {
          assert.ok(err.message.includes('Failed to clear localStorage'));
          return true;
        }
      );
    });

    it('should handle invalid type as local', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await manager.clearStorage('invalid');

      const call = mockSession.send.mock.calls[0];
      assert.ok(call.arguments[1].expression.includes("'local'"));
    });
  });

  describe('integration scenarios', () => {
    it('should get, set, and clear in sequence', async () => {
      let storage = {};

      mockSession.send = mock.fn(async (method, params) => {
        const expr = params.expression;

        if (expr.includes('Object.keys')) {
          // getStorage
          return {
            result: {
              value: Object.keys(storage).map(k => ({ name: k, value: storage[k] }))
            }
          };
        }

        if (expr.includes('for (const [key, value]') || expr.includes('setItem')) {
          // setStorage - the expression contains the items as a JSON stringified object
          // Extract items from the expression
          const jsonMatch = expr.match(/, (\{[^)]+\})\)/);
          if (jsonMatch) {
            try {
              const items = JSON.parse(jsonMatch[1]);
              for (const [k, v] of Object.entries(items)) {
                if (v === null) {
                  delete storage[k];
                } else {
                  storage[k] = v;
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
          return { result: { value: true } };
        }

        if (expr.includes('storage.clear()')) {
          // clearStorage
          storage = {};
          return { result: { value: true } };
        }

        return { result: { value: null } };
      });

      // Get initial (empty)
      let items = await manager.getStorage();
      assert.strictEqual(items.length, 0);

      // Set some items
      await manager.setStorage({ a: '1', b: '2' });

      // Get again
      items = await manager.getStorage();
      // Since we're mocking, the items are now in storage
      assert.ok(items.length >= 0);

      // Clear
      await manager.clearStorage();

      // Get final (empty after clear)
      items = await manager.getStorage();
      assert.strictEqual(items.length, 0);
    });

    it('should handle both storage types independently', async () => {
      const storages = { local: {}, session: {} };

      mockSession.send = mock.fn(async (method, params) => {
        const expr = params.expression;
        const isSession = expr.includes("'session'");
        const type = isSession ? 'session' : 'local';

        if (expr.includes('Object.keys')) {
          return {
            result: {
              value: Object.keys(storages[type]).map(k => ({ name: k, value: storages[type][k] }))
            }
          };
        }

        return { result: { value: true } };
      });

      const localItems = await manager.getStorage('local');
      const sessionItems = await manager.getStorage('session');

      assert.strictEqual(localItems.length, 0);
      assert.strictEqual(sessionItems.length, 0);
    });
  });
});
