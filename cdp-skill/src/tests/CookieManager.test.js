import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createCookieManager } from '../page/cookie-manager.js';

describe('CookieManager', () => {
  let mockSession;
  let manager;

  beforeEach(() => {
    mockSession = {
      send: mock.fn(async () => ({}))
    };
    manager = createCookieManager(mockSession);
  });

  afterEach(() => {
    mock.reset();
  });

  describe('createCookieManager', () => {
    it('should return an object with expected methods', () => {
      assert.ok(typeof manager.getCookies === 'function');
      assert.ok(typeof manager.setCookies === 'function');
      assert.ok(typeof manager.clearCookies === 'function');
      assert.ok(typeof manager.deleteCookies === 'function');
    });
  });

  describe('getCookies', () => {
    it('should return all cookies when no URLs provided', async () => {
      mockSession.send = mock.fn(async () => ({
        cookies: [
          { name: 'session', value: 'abc123', domain: '.example.com', path: '/', httpOnly: true, secure: true },
          { name: 'prefs', value: 'dark', domain: 'example.com', path: '/', httpOnly: false, secure: false }
        ]
      }));

      const cookies = await manager.getCookies();

      assert.strictEqual(cookies.length, 2);
      assert.strictEqual(cookies[0].name, 'session');
      assert.strictEqual(cookies[0].value, 'abc123');
      assert.strictEqual(cookies[0].domain, '.example.com');
      assert.strictEqual(cookies[0].httpOnly, true);
      assert.strictEqual(cookies[0].sameSite, 'Lax');
    });

    it('should filter cookies by URL', async () => {
      mockSession.send = mock.fn(async () => ({
        cookies: [
          { name: 'session', value: 'abc', domain: '.example.com', path: '/', secure: true },
          { name: 'other', value: 'xyz', domain: 'other.com', path: '/', secure: false }
        ]
      }));

      const cookies = await manager.getCookies(['https://example.com/page']);

      assert.strictEqual(cookies.length, 1);
      assert.strictEqual(cookies[0].name, 'session');
    });

    it('should match subdomain cookies', async () => {
      mockSession.send = mock.fn(async () => ({
        cookies: [
          { name: 'session', value: 'abc', domain: '.example.com', path: '/', secure: false }
        ]
      }));

      const cookies = await manager.getCookies(['https://sub.example.com']);

      assert.strictEqual(cookies.length, 1);
    });

    it('should match path-specific cookies', async () => {
      mockSession.send = mock.fn(async () => ({
        cookies: [
          { name: 'api_token', value: 'tok', domain: 'example.com', path: '/api', secure: false },
          { name: 'session', value: 'abc', domain: 'example.com', path: '/', secure: false }
        ]
      }));

      const cookies = await manager.getCookies(['https://example.com/api/users']);

      assert.strictEqual(cookies.length, 2);
    });

    it('should filter secure cookies for non-HTTPS URLs', async () => {
      mockSession.send = mock.fn(async () => ({
        cookies: [
          { name: 'secure', value: 'sec', domain: 'example.com', path: '/', secure: true },
          { name: 'normal', value: 'nor', domain: 'example.com', path: '/', secure: false }
        ]
      }));

      const cookies = await manager.getCookies(['http://example.com']);

      assert.strictEqual(cookies.length, 1);
      assert.strictEqual(cookies[0].name, 'normal');
    });

    it('should handle empty cookie list', async () => {
      mockSession.send = mock.fn(async () => ({
        cookies: []
      }));

      const cookies = await manager.getCookies();

      assert.deepStrictEqual(cookies, []);
    });

    it('should handle invalid URL in filter', async () => {
      mockSession.send = mock.fn(async () => ({
        cookies: [
          { name: 'session', value: 'abc', domain: 'example.com', path: '/', secure: false }
        ]
      }));

      const cookies = await manager.getCookies(['not-a-url']);

      assert.strictEqual(cookies.length, 0);
    });

    it('should preserve sameSite value if present', async () => {
      mockSession.send = mock.fn(async () => ({
        cookies: [
          { name: 'strict', value: 'abc', domain: 'example.com', path: '/', sameSite: 'Strict' }
        ]
      }));

      const cookies = await manager.getCookies();

      assert.strictEqual(cookies[0].sameSite, 'Strict');
    });
  });

  describe('setCookies', () => {
    it('should set cookies with URL', async () => {
      mockSession.send = mock.fn(async () => ({}));

      await manager.setCookies([
        { name: 'session', value: 'abc', url: 'https://example.com' }
      ]);

      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[0], 'Storage.setCookies');
      assert.strictEqual(call.arguments[1].cookies[0].name, 'session');
      assert.strictEqual(call.arguments[1].cookies[0].domain, 'example.com');
      assert.strictEqual(call.arguments[1].cookies[0].secure, true);
    });

    it('should set cookies with explicit domain', async () => {
      mockSession.send = mock.fn(async () => ({}));

      await manager.setCookies([
        { name: 'session', value: 'abc', domain: '.example.com', path: '/app' }
      ]);

      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[1].cookies[0].domain, '.example.com');
      assert.strictEqual(call.arguments[1].cookies[0].path, '/app');
    });

    it('should throw for cookie without url or domain', async () => {
      await assert.rejects(
        () => manager.setCookies([{ name: 'session', value: 'abc' }]),
        { message: 'Cookie requires either url or domain' }
      );
    });

    it('should throw for invalid URL', async () => {
      await assert.rejects(
        () => manager.setCookies([{ name: 'session', value: 'abc', url: 'not-a-url' }]),
        (err) => {
          assert.ok(err.message.includes('Invalid cookie URL'));
          return true;
        }
      );
    });

    it('should set optional cookie properties', async () => {
      mockSession.send = mock.fn(async () => ({}));

      await manager.setCookies([
        {
          name: 'session',
          value: 'abc',
          domain: 'example.com',
          expires: 1234567890,
          httpOnly: true,
          sameSite: 'Strict'
        }
      ]);

      const cookie = mockSession.send.mock.calls[0].arguments[1].cookies[0];
      assert.strictEqual(cookie.expires, 1234567890);
      assert.strictEqual(cookie.httpOnly, true);
      assert.strictEqual(cookie.sameSite, 'Strict');
    });

    it('should derive secure from HTTPS URL', async () => {
      mockSession.send = mock.fn(async () => ({}));

      await manager.setCookies([
        { name: 'session', value: 'abc', url: 'https://example.com' }
      ]);

      const cookie = mockSession.send.mock.calls[0].arguments[1].cookies[0];
      assert.strictEqual(cookie.secure, true);
    });

    it('should derive non-secure from HTTP URL', async () => {
      mockSession.send = mock.fn(async () => ({}));

      await manager.setCookies([
        { name: 'session', value: 'abc', url: 'http://example.com' }
      ]);

      const cookie = mockSession.send.mock.calls[0].arguments[1].cookies[0];
      assert.strictEqual(cookie.secure, false);
    });

    it('should use default path when not specified', async () => {
      mockSession.send = mock.fn(async () => ({}));

      await manager.setCookies([
        { name: 'session', value: 'abc', domain: 'example.com' }
      ]);

      const cookie = mockSession.send.mock.calls[0].arguments[1].cookies[0];
      assert.strictEqual(cookie.path, '/');
    });

    it('should set multiple cookies at once', async () => {
      mockSession.send = mock.fn(async () => ({}));

      await manager.setCookies([
        { name: 'a', value: '1', domain: 'example.com' },
        { name: 'b', value: '2', domain: 'example.com' }
      ]);

      const cookies = mockSession.send.mock.calls[0].arguments[1].cookies;
      assert.strictEqual(cookies.length, 2);
    });
  });

  describe('clearCookies', () => {
    it('should clear all cookies when no filters provided', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Storage.getCookies') {
          return { cookies: [{ name: 'a' }, { name: 'b' }] };
        }
        return {};
      });

      const result = await manager.clearCookies();

      assert.strictEqual(result.count, 2);
      const clearCall = mockSession.send.mock.calls.find(c => c.arguments[0] === 'Storage.clearCookies');
      assert.ok(clearCall);
    });

    it('should clear cookies by URL', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Storage.getCookies') {
          return {
            cookies: [
              { name: 'a', domain: 'example.com', path: '/', secure: false },
              { name: 'b', domain: 'other.com', path: '/', secure: false }
            ]
          };
        }
        return {};
      });

      const result = await manager.clearCookies(['https://example.com']);

      assert.strictEqual(result.count, 1);
    });

    it('should clear cookies by domain option', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Storage.getCookies') {
          return {
            cookies: [
              { name: 'a', domain: 'example.com', path: '/' },
              { name: 'b', domain: '.example.com', path: '/' },
              { name: 'c', domain: 'other.com', path: '/' }
            ]
          };
        }
        return {};
      });

      const result = await manager.clearCookies([], { domain: 'example.com' });

      assert.strictEqual(result.count, 2);
    });

    it('should handle deletion failures gracefully', async () => {
      let deleteAttempts = 0;
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Storage.getCookies') {
          return {
            cookies: [
              { name: 'a', domain: 'example.com', path: '/' },
              { name: 'b', domain: 'example.com', path: '/' }
            ]
          };
        }
        if (method === 'Network.deleteCookies') {
          deleteAttempts++;
          if (deleteAttempts === 1) {
            throw new Error('Delete failed');
          }
          return {};
        }
        return {};
      });

      const result = await manager.clearCookies(['https://example.com']);

      assert.strictEqual(result.count, 1);
    });
  });

  describe('deleteCookies', () => {
    it('should delete cookie by name', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Storage.getCookies') {
          return {
            cookies: [
              { name: 'session', domain: 'example.com', path: '/' },
              { name: 'prefs', domain: 'example.com', path: '/' }
            ]
          };
        }
        return {};
      });

      const result = await manager.deleteCookies('session');

      assert.strictEqual(result.count, 1);
      const deleteCall = mockSession.send.mock.calls.find(c => c.arguments[0] === 'Network.deleteCookies');
      assert.strictEqual(deleteCall.arguments[1].name, 'session');
    });

    it('should delete multiple cookies by name array', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Storage.getCookies') {
          return {
            cookies: [
              { name: 'a', domain: 'example.com', path: '/' },
              { name: 'b', domain: 'example.com', path: '/' },
              { name: 'c', domain: 'example.com', path: '/' }
            ]
          };
        }
        return {};
      });

      const result = await manager.deleteCookies(['a', 'c']);

      assert.strictEqual(result.count, 2);
    });

    it('should filter by domain', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Storage.getCookies') {
          return {
            cookies: [
              { name: 'session', domain: 'example.com', path: '/' },
              { name: 'session', domain: 'other.com', path: '/' }
            ]
          };
        }
        return {};
      });

      const result = await manager.deleteCookies('session', { domain: 'example.com' });

      assert.strictEqual(result.count, 1);
    });

    it('should filter by path', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Storage.getCookies') {
          return {
            cookies: [
              { name: 'token', domain: 'example.com', path: '/api' },
              { name: 'token', domain: 'example.com', path: '/' }
            ]
          };
        }
        return {};
      });

      const result = await manager.deleteCookies('token', { path: '/api' });

      assert.strictEqual(result.count, 1);
    });

    it('should return zero count when no matching cookies', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Storage.getCookies') {
          return { cookies: [] };
        }
        return {};
      });

      const result = await manager.deleteCookies('nonexistent');

      assert.strictEqual(result.count, 0);
    });

    it('should handle deletion failures gracefully', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Storage.getCookies') {
          return {
            cookies: [{ name: 'session', domain: 'example.com', path: '/' }]
          };
        }
        if (method === 'Network.deleteCookies') {
          throw new Error('Delete failed');
        }
        return {};
      });

      const result = await manager.deleteCookies('session');

      assert.strictEqual(result.count, 0);
    });

    it('should match subdomain cookies', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Storage.getCookies') {
          return {
            cookies: [
              { name: 'session', domain: '.example.com', path: '/' }
            ]
          };
        }
        return {};
      });

      const result = await manager.deleteCookies('session', { domain: 'example.com' });

      assert.strictEqual(result.count, 1);
    });
  });
});
