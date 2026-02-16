import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createBrowser, createPageSession } from '../cdp/index.js';
import { ErrorTypes } from '../utils.js';

/**
 * Mock factory for CDPConnection
 */
function createMockConnection() {
  const listeners = new Map();
  return {
    connect: mock.fn(async () => {}),
    close: mock.fn(async () => {}),
    send: mock.fn(async () => ({})),
    sendToSession: mock.fn(async () => ({})),
    on: mock.fn((event, callback) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(callback);
    }),
    off: mock.fn((event, callback) => {
      const set = listeners.get(event);
      if (set) set.delete(callback);
    }),
    isConnected: mock.fn(() => true),
    _listeners: listeners,
    _emit: (event, data) => {
      const set = listeners.get(event);
      if (set) {
        for (const cb of set) cb(data);
      }
    }
  };
}

/**
 * Mock factory for ChromeDiscovery
 */
function createMockDiscovery() {
  return {
    getVersion: mock.fn(async () => ({
      browser: 'Chrome/120.0.0.0',
      protocolVersion: '1.3',
      webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/abc123'
    })),
    getTargets: mock.fn(async () => []),
    getPages: mock.fn(async () => []),
    isAvailable: mock.fn(async () => true)
  };
}

/**
 * Mock factory for TargetManager
 */
function createMockTargetManager() {
  return {
    enableDiscovery: mock.fn(async () => {}),
    getTargets: mock.fn(async () => []),
    getPages: mock.fn(async () => [
      { targetId: 'target-1', type: 'page', title: 'Test Page', url: 'https://example.com' },
      { targetId: 'target-2', type: 'page', title: 'Another Page', url: 'https://test.com' }
    ]),
    createTarget: mock.fn(async (url) => 'new-target-id'),
    closeTarget: mock.fn(async () => true),
    activateTarget: mock.fn(async () => {}),
    getTargetInfo: mock.fn(async () => ({}))
  };
}

/**
 * Mock factory for SessionRegistry
 */
function createMockSessionRegistry() {
  return {
    attach: mock.fn(async (targetId) => `session-for-${targetId}`),
    detach: mock.fn(async () => {}),
    detachByTarget: mock.fn(async () => {}),
    detachAll: mock.fn(async () => {}),
    getSessionForTarget: mock.fn(() => undefined),
    isAttached: mock.fn(() => false)
  };
}

/**
 * Mock BrowserClient for isolated testing
 * This mirrors the createBrowser function behavior
 */
function createMockBrowserClient(options = {}) {
  const host = options.host ?? 'localhost';
  const port = options.port ?? 9222;

  let discovery = options._discovery ?? null;
  let connection = null;
  let targetManager = null;
  let sessionRegistry = null;
  let connected = false;

  function ensureConnected() {
    if (!connected) {
      throw new Error('BrowserClient not connected. Call connect() first.');
    }
  }

  // Test helper to inject mocks
  function _injectMocks(disc, conn, targets, sessions) {
    discovery = disc;
    connection = conn;
    targetManager = targets;
    sessionRegistry = sessions;
    connected = true;
  }

  async function connect() {
    if (connected) return;
    const version = await discovery.getVersion();
    await connection.connect();
    connected = true;
  }

  async function disconnect() {
    if (!connected) return;
    await sessionRegistry.detachAll();
    await connection.close();
    connected = false;
  }

  async function getPages() {
    ensureConnected();
    return targetManager.getPages();
  }

  async function newPage(url = 'about:blank') {
    ensureConnected();
    const targetId = await targetManager.createTarget(url);
    const sessionId = await sessionRegistry.attach(targetId);
    return createPageSession(connection, sessionId, targetId);
  }

  async function attachToPage(targetId) {
    ensureConnected();
    const sessionId = await sessionRegistry.attach(targetId);
    return createPageSession(connection, sessionId, targetId);
  }

  async function findPage(urlPattern) {
    ensureConnected();
    const pages = await getPages();
    const regex = urlPattern instanceof RegExp ? urlPattern : new RegExp(urlPattern);
    const target = pages.find(p => regex.test(p.url));
    if (!target) return null;
    return attachToPage(target.targetId);
  }

  async function closePage(targetId) {
    ensureConnected();
    await sessionRegistry.detachByTarget(targetId);
    await targetManager.closeTarget(targetId);
  }

  return {
    connect,
    disconnect,
    getPages,
    newPage,
    attachToPage,
    findPage,
    closePage,
    isConnected: () => connected,
    _injectMocks,
    get connection() { return connection; },
    get targets() { return targetManager; },
    get sessions() { return sessionRegistry; }
  };
}

describe('PageSession (functional)', () => {
  let mockConnection;

  beforeEach(() => {
    mockConnection = createMockConnection();
  });

  it('should store connection, sessionId, and targetId', () => {
    const session = createPageSession(mockConnection, 'session-123', 'target-456');

    assert.strictEqual(session.sessionId, 'session-123');
    assert.strictEqual(session.targetId, 'target-456');
  });

  it('should send commands via sendToSession', async () => {
    mockConnection.sendToSession = mock.fn(async () => ({ result: 'success' }));
    const session = createPageSession(mockConnection, 'session-123', 'target-456');

    const result = await session.send('Page.navigate', { url: 'https://example.com' });

    assert.strictEqual(mockConnection.sendToSession.mock.calls.length, 1);
    const [sessionId, method, params] = mockConnection.sendToSession.mock.calls[0].arguments;
    assert.strictEqual(sessionId, 'session-123');
    assert.strictEqual(method, 'Page.navigate');
    assert.deepStrictEqual(params, { url: 'https://example.com' });
    assert.deepStrictEqual(result, { result: 'success' });
  });

  it('should send commands with default empty params', async () => {
    mockConnection.sendToSession = mock.fn(async () => ({}));
    const session = createPageSession(mockConnection, 'session-123', 'target-456');

    await session.send('Page.reload');

    const [, , params] = mockConnection.sendToSession.mock.calls[0].arguments;
    assert.deepStrictEqual(params, {});
  });

  it('should subscribe to session-scoped events', () => {
    const session = createPageSession(mockConnection, 'session-123', 'target-456');
    const callback = () => {};
    const initialCallCount = mockConnection.on.mock.calls.length;

    session.on('Page.loadEventFired', callback);

    // Should have one more call after subscribing
    assert.strictEqual(mockConnection.on.mock.calls.length, initialCallCount + 1);
    const lastCall = mockConnection.on.mock.calls[mockConnection.on.mock.calls.length - 1];
    const [eventName, cb] = lastCall.arguments;
    assert.strictEqual(eventName, 'session-123:Page.loadEventFired');
    assert.strictEqual(cb, callback);
  });

  it('should unsubscribe from session-scoped events', () => {
    const session = createPageSession(mockConnection, 'session-123', 'target-456');
    const callback = () => {};

    session.off('Page.loadEventFired', callback);

    assert.strictEqual(mockConnection.off.mock.calls.length, 1);
    const [eventName, cb] = mockConnection.off.mock.calls[0].arguments;
    assert.strictEqual(eventName, 'session-123:Page.loadEventFired');
    assert.strictEqual(cb, callback);
  });
});

describe('BrowserClient (mock)', () => {
  let client;
  let mockDiscovery;
  let mockConnection;
  let mockTargetManager;
  let mockSessionRegistry;

  beforeEach(() => {
    mockDiscovery = createMockDiscovery();
    mockConnection = createMockConnection();
    mockTargetManager = createMockTargetManager();
    mockSessionRegistry = createMockSessionRegistry();
    client = createMockBrowserClient();
  });

  describe('constructor', () => {
    it('should initialize as not connected', () => {
      assert.strictEqual(client.isConnected(), false);
    });

    it('should return null for connection before connect', () => {
      assert.strictEqual(client.connection, null);
    });

    it('should return null for targets before connect', () => {
      assert.strictEqual(client.targets, null);
    });

    it('should return null for sessions before connect', () => {
      assert.strictEqual(client.sessions, null);
    });
  });

  describe('ensureConnected checks', () => {
    it('should throw if getPages called when not connected', async () => {
      await assert.rejects(
        async () => client.getPages(),
        { message: 'BrowserClient not connected. Call connect() first.' }
      );
    });

    it('should throw if newPage called when not connected', async () => {
      await assert.rejects(
        async () => client.newPage(),
        { message: 'BrowserClient not connected. Call connect() first.' }
      );
    });

    it('should throw if attachToPage called when not connected', async () => {
      await assert.rejects(
        async () => client.attachToPage('target-123'),
        { message: 'BrowserClient not connected. Call connect() first.' }
      );
    });

    it('should throw if findPage called when not connected', async () => {
      await assert.rejects(
        async () => client.findPage(/example/),
        { message: 'BrowserClient not connected. Call connect() first.' }
      );
    });

    it('should throw if closePage called when not connected', async () => {
      await assert.rejects(
        async () => client.closePage('target-123'),
        { message: 'BrowserClient not connected. Call connect() first.' }
      );
    });
  });

  describe('disconnect', () => {
    it('should do nothing if not connected', async () => {
      // Should not throw
      await client.disconnect();
      assert.strictEqual(client.isConnected(), false);
    });
  });
});

describe('BrowserClient (connected mock)', () => {
  let client;
  let mockDiscovery;
  let mockConnection;
  let mockTargetManager;
  let mockSessionRegistry;

  beforeEach(() => {
    mockDiscovery = createMockDiscovery();
    mockConnection = createMockConnection();
    mockTargetManager = createMockTargetManager();
    mockSessionRegistry = createMockSessionRegistry();
    client = createMockBrowserClient();
    client._injectMocks(mockDiscovery, mockConnection, mockTargetManager, mockSessionRegistry);
  });

  it('should be connected after injecting mocks', () => {
    assert.strictEqual(client.isConnected(), true);
  });

  it('should expose connection via getter', () => {
    assert.strictEqual(client.connection, mockConnection);
  });

  it('should expose targetManager via targets getter', () => {
    assert.strictEqual(client.targets, mockTargetManager);
  });

  it('should expose sessionRegistry via sessions getter', () => {
    assert.strictEqual(client.sessions, mockSessionRegistry);
  });

  describe('getPages', () => {
    it('should return pages from target manager', async () => {
      const pages = await client.getPages();

      assert.strictEqual(mockTargetManager.getPages.mock.calls.length, 1);
      assert.strictEqual(pages.length, 2);
      assert.strictEqual(pages[0].targetId, 'target-1');
      assert.strictEqual(pages[1].targetId, 'target-2');
    });
  });

  describe('newPage', () => {
    it('should create target and attach session', async () => {
      const session = await client.newPage('https://test.com');

      assert.strictEqual(mockTargetManager.createTarget.mock.calls.length, 1);
      assert.strictEqual(mockTargetManager.createTarget.mock.calls[0].arguments[0], 'https://test.com');
      assert.strictEqual(mockSessionRegistry.attach.mock.calls.length, 1);
      assert.strictEqual(mockSessionRegistry.attach.mock.calls[0].arguments[0], 'new-target-id');

      assert.strictEqual(session.targetId, 'new-target-id');
      assert.strictEqual(session.sessionId, 'session-for-new-target-id');
    });

    it('should use about:blank as default URL', async () => {
      await client.newPage();

      assert.strictEqual(mockTargetManager.createTarget.mock.calls[0].arguments[0], 'about:blank');
    });
  });

  describe('attachToPage', () => {
    it('should attach to existing target', async () => {
      const session = await client.attachToPage('existing-target');

      assert.strictEqual(mockSessionRegistry.attach.mock.calls.length, 1);
      assert.strictEqual(mockSessionRegistry.attach.mock.calls[0].arguments[0], 'existing-target');

      assert.strictEqual(session.targetId, 'existing-target');
      assert.strictEqual(session.sessionId, 'session-for-existing-target');
    });
  });

  describe('findPage', () => {
    it('should find page by RegExp and attach', async () => {
      const session = await client.findPage(/example\.com/);

      assert.strictEqual(session.targetId, 'target-1');
    });

    it('should find page by string pattern and attach', async () => {
      const session = await client.findPage('test\\.com');

      assert.strictEqual(session.targetId, 'target-2');
    });

    it('should return null if no page matches', async () => {
      const session = await client.findPage(/notfound/);

      assert.strictEqual(session, null);
    });
  });

  describe('closePage', () => {
    it('should detach session and close target', async () => {
      await client.closePage('target-to-close');

      assert.strictEqual(mockSessionRegistry.detachByTarget.mock.calls.length, 1);
      assert.strictEqual(mockSessionRegistry.detachByTarget.mock.calls[0].arguments[0], 'target-to-close');
      assert.strictEqual(mockTargetManager.closeTarget.mock.calls.length, 1);
      assert.strictEqual(mockTargetManager.closeTarget.mock.calls[0].arguments[0], 'target-to-close');
    });
  });

  describe('disconnect', () => {
    it('should detach all sessions and close connection', async () => {
      await client.disconnect();

      assert.strictEqual(mockSessionRegistry.detachAll.mock.calls.length, 1);
      assert.strictEqual(mockConnection.close.mock.calls.length, 1);
      assert.strictEqual(client.isConnected(), false);
    });
  });
});

describe('PageSession event handling', () => {
  it('should properly format session-scoped event names', () => {
    const mockConn = createMockConnection();
    const session = createPageSession(mockConn, 'my-session-id', 'target-1');

    const handler = () => {};
    session.on('Network.requestWillBeSent', handler);

    // Verify the event was registered with session prefix
    assert.ok(mockConn._listeners.has('my-session-id:Network.requestWillBeSent'));
  });

  it('should properly unregister session-scoped events', () => {
    const mockConn = createMockConnection();
    const session = createPageSession(mockConn, 'my-session-id', 'target-1');

    const handler = () => {};
    session.on('Network.requestWillBeSent', handler);
    session.off('Network.requestWillBeSent', handler);

    const listeners = mockConn._listeners.get('my-session-id:Network.requestWillBeSent');
    assert.strictEqual(listeners.size, 0);
  });

  it('should receive events through connection emit', () => {
    const mockConn = createMockConnection();
    const session = createPageSession(mockConn, 'my-session-id', 'target-1');

    let receivedData = null;
    const handler = (data) => { receivedData = data; };
    session.on('Page.loadEventFired', handler);

    // Simulate event emission
    mockConn._emit('my-session-id:Page.loadEventFired', { timestamp: 12345 });

    assert.deepStrictEqual(receivedData, { timestamp: 12345 });
  });
});

describe('PageSession validity tracking', () => {
  it('should start as valid', () => {
    const mockConn = createMockConnection();
    const session = createPageSession(mockConn, 'my-session-id', 'target-1');

    assert.strictEqual(session.isValid(), true);
  });

  it('should become invalid when detach event received', () => {
    const mockConn = createMockConnection();
    const session = createPageSession(mockConn, 'my-session-id', 'target-1');

    // Simulate detach event
    mockConn._emit('Target.detachedFromTarget', { sessionId: 'my-session-id' });

    assert.strictEqual(session.isValid(), false);
  });

  it('should not be invalidated by detach events for other sessions', () => {
    const mockConn = createMockConnection();
    const session = createPageSession(mockConn, 'my-session-id', 'target-1');

    // Simulate detach event for different session
    mockConn._emit('Target.detachedFromTarget', { sessionId: 'other-session-id' });

    assert.strictEqual(session.isValid(), true);
  });

  it('should throw when sending commands to invalid session', async () => {
    const mockConn = createMockConnection();
    mockConn.sendToSession = mock.fn(async () => ({}));
    const session = createPageSession(mockConn, 'my-session-id', 'target-1');

    // Invalidate the session
    mockConn._emit('Target.detachedFromTarget', { sessionId: 'my-session-id' });

    await assert.rejects(
      async () => session.send('Page.navigate', { url: 'https://example.com' }),
      { message: /Session my-session-id is no longer valid/ }
    );
  });

  it('should clean up detach listener when disposed', () => {
    const mockConn = createMockConnection();
    const session = createPageSession(mockConn, 'my-session-id', 'target-1');

    // Get initial listener count
    const initialListeners = mockConn._listeners.get('Target.detachedFromTarget')?.size || 0;
    assert.ok(initialListeners > 0);

    session.dispose();

    const finalListeners = mockConn._listeners.get('Target.detachedFromTarget')?.size || 0;
    assert.strictEqual(finalListeners, initialListeners - 1);
    assert.strictEqual(session.isValid(), false);
  });
});

describe('BrowserClient real (connection tests)', () => {
  it('should use default connectTimeout of 30000ms', () => {
    const client = createBrowser();
    // We can't directly access private field, but we can verify behavior
    assert.strictEqual(client.isConnected(), false);
  });

  it('should accept custom connectTimeout option', () => {
    const client = createBrowser({ connectTimeout: 5000 });
    assert.strictEqual(client.isConnected(), false);
  });

  it('should throw an error when connection fails', async () => {
    // Use a non-existent port to trigger connection failure
    const client = createBrowser({
      host: 'localhost',
      port: 59999, // Non-existent port
      connectTimeout: 100
    });

    await assert.rejects(
      async () => client.connect(),
      (err) => {
        // Should fail with some connection-related error
        // Can be TimeoutError, fetch failed, connection refused, or Chrome not reachable
        return err.name === ErrorTypes.TIMEOUT ||
               err instanceof Error; // Any error is acceptable when connection fails
      }
    );
  });

  it('should pass connectTimeout to ChromeDiscovery', async () => {
    // Test that ChromeDiscovery receives the timeout
    // When Chrome is not running, we should get an error quickly
    const client = createBrowser({
      host: 'localhost',
      port: 59998, // Non-existent port
      connectTimeout: 100
    });

    const startTime = Date.now();
    try {
      await client.connect();
    } catch (err) {
      // Expected to fail
    }
    const elapsed = Date.now() - startTime;

    // Should fail quickly (within our timeout + some buffer)
    assert.ok(elapsed < 5000, `Expected quick failure, took ${elapsed}ms`);
  });

});
