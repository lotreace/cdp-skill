import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createDiscovery } from '../cdp/index.js';

describe('ChromeDiscovery', () => {
  let originalFetch;
  let mockFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = mock.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('createDiscovery', () => {
    it('should create discovery with default host and port', () => {
      const discovery = createDiscovery();
      assert.ok(discovery);
      assert.ok(typeof discovery.getVersion === 'function');
    });

    it('should accept custom host and port', () => {
      const discovery = createDiscovery('192.168.1.100', 9333);
      assert.ok(discovery);
    });
  });

  describe('getVersion', () => {
    it('should return browser version info', async () => {
      const mockResponse = {
        Browser: 'Chrome/120.0.0.0',
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/abc'
      };

      mockFetch.mock.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      }));

      const discovery = createDiscovery();
      const result = await discovery.getVersion();

      assert.strictEqual(result.browser, 'Chrome/120.0.0.0');
      assert.strictEqual(result.protocolVersion, '1.3');
      assert.strictEqual(result.webSocketDebuggerUrl, 'ws://localhost:9222/devtools/browser/abc');
    });

    it('should throw when Chrome not reachable', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({
        ok: false,
        status: 404
      }));

      const discovery = createDiscovery();

      await assert.rejects(
        () => discovery.getVersion(),
        /Chrome not reachable/
      );
    });
  });

  describe('getTargets', () => {
    it('should return all targets', async () => {
      const mockTargets = [
        { id: '1', type: 'page', title: 'Tab 1', url: 'https://example.com' },
        { id: '2', type: 'service_worker', title: 'SW', url: 'https://example.com/sw.js' }
      ];

      mockFetch.mock.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockTargets)
      }));

      const discovery = createDiscovery();
      const result = await discovery.getTargets();

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, '1');
      assert.strictEqual(result[1].type, 'service_worker');
    });

    it('should throw on failure', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({
        ok: false,
        status: 500
      }));

      const discovery = createDiscovery();

      await assert.rejects(
        () => discovery.getTargets(),
        /Failed to get targets: 500/
      );
    });
  });

  describe('getPages', () => {
    it('should return only page targets', async () => {
      const mockTargets = [
        { id: '1', type: 'page', title: 'Tab 1', url: 'https://example.com' },
        { id: '2', type: 'service_worker', title: 'SW', url: 'https://example.com/sw.js' },
        { id: '3', type: 'page', title: 'Tab 2', url: 'https://test.com' }
      ];

      mockFetch.mock.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockTargets)
      }));

      const discovery = createDiscovery();
      const result = await discovery.getPages();

      assert.strictEqual(result.length, 2);
      assert.ok(result.every(t => t.type === 'page'));
    });
  });

  describe('findPageByUrl', () => {
    const mockTargets = [
      { id: '1', type: 'page', title: 'Example', url: 'https://example.com/path' },
      { id: '2', type: 'page', title: 'Test', url: 'https://test.com' }
    ];

    beforeEach(() => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockTargets)
      }));
    });

    it('should find page by string pattern', async () => {
      const discovery = createDiscovery();
      const result = await discovery.findPageByUrl('example.com');

      assert.strictEqual(result.id, '1');
    });

    it('should find page by regex pattern', async () => {
      const discovery = createDiscovery();
      const result = await discovery.findPageByUrl(/test\.com$/);

      assert.strictEqual(result.id, '2');
    });

    it('should return null when no match', async () => {
      const discovery = createDiscovery();
      const result = await discovery.findPageByUrl('nonexistent.com');

      assert.strictEqual(result, null);
    });
  });

  describe('isAvailable', () => {
    it('should return true when Chrome is running', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ Browser: 'Chrome' })
      }));

      const discovery = createDiscovery();
      const result = await discovery.isAvailable();

      assert.strictEqual(result, true);
    });

    it('should return false when Chrome is not running', async () => {
      mockFetch.mock.mockImplementation(() => Promise.reject(new Error('Connection refused')));

      const discovery = createDiscovery();
      const result = await discovery.isAvailable();

      assert.strictEqual(result, false);
    });
  });
});
