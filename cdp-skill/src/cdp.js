/**
 * CDP Protocol and Browser Management
 * Core CDP connection, discovery, target management, and browser client
 */

import { timeoutError } from './utils.js';

// ============================================================================
// Connection
// ============================================================================

/**
 * Create a CDP WebSocket connection
 * @param {string} wsUrl - WebSocket URL for CDP endpoint
 * @param {Object} [options] - Connection options
 * @param {number} [options.maxRetries=5] - Max reconnection attempts
 * @param {number} [options.retryDelay=1000] - Base delay between retries
 * @param {number} [options.maxRetryDelay=30000] - Maximum retry delay cap
 * @param {boolean} [options.autoReconnect=false] - Enable auto reconnection
 * @returns {Object} Connection interface
 */
export function createConnection(wsUrl, options = {}) {
  const maxRetries = options.maxRetries ?? 5;
  const retryDelay = options.retryDelay ?? 1000;
  const maxRetryDelay = options.maxRetryDelay ?? 30000;
  const autoReconnect = options.autoReconnect ?? false;

  let ws = null;
  let messageId = 0;
  const pendingCommands = new Map();
  const eventListeners = new Map();
  let connected = false;
  let connecting = false;
  let onCloseCallback = null;
  let reconnecting = false;
  let retryAttempt = 0;
  let intentionalClose = false;

  function emit(event, data = {}) {
    const listeners = eventListeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data);
        } catch (err) {
          console.error(`Event handler error for ${event}:`, err);
        }
      }
    }
  }

  function calculateBackoff(attempt) {
    const delay = retryDelay * Math.pow(2, attempt);
    return Math.min(delay, maxRetryDelay);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function rejectPendingCommands(reason) {
    for (const [id, pending] of pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    pendingCommands.clear();
  }

  function handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (message.id !== undefined) {
      const pending = pendingCommands.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingCommands.delete(message.id);
        if (message.error) {
          pending.reject(new Error(`CDP error: ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    if (message.method) {
      if (message.sessionId) {
        const sessionEventKey = `${message.sessionId}:${message.method}`;
        const sessionListeners = eventListeners.get(sessionEventKey);
        if (sessionListeners) {
          for (const callback of sessionListeners) {
            try {
              callback(message.params, message.sessionId);
            } catch (err) {
              console.error(`Event handler error for ${sessionEventKey}:`, err);
            }
          }
        }
      }

      const globalListeners = eventListeners.get(message.method);
      if (globalListeners) {
        for (const callback of globalListeners) {
          try {
            callback(message.params, message.sessionId);
          } catch (err) {
            console.error(`Event handler error for ${message.method}:`, err);
          }
        }
      }
    }
  }

  function setupWebSocketListeners() {
    ws.addEventListener('close', () => {
      const wasConnected = connected;
      connected = false;
      connecting = false;
      rejectPendingCommands('Connection closed');

      if (wasConnected && !intentionalClose && autoReconnect) {
        attemptReconnect();
      } else if (wasConnected && onCloseCallback && !intentionalClose) {
        onCloseCallback('Connection closed unexpectedly');
      }
    });

    ws.addEventListener('message', (event) => handleMessage(event.data));
  }

  async function attemptReconnect() {
    if (reconnecting || intentionalClose) return;

    reconnecting = true;
    retryAttempt = 0;

    while (retryAttempt < maxRetries && !intentionalClose) {
      const delay = calculateBackoff(retryAttempt);
      emit('reconnecting', { attempt: retryAttempt + 1, delay });

      await sleep(delay);
      if (intentionalClose) break;

      try {
        await doReconnect();
        reconnecting = false;
        retryAttempt = 0;
        emit('reconnected', {});
        return;
      } catch {
        retryAttempt++;
      }
    }

    reconnecting = false;
    if (!intentionalClose && onCloseCallback) {
      onCloseCallback('Connection closed unexpectedly after max retries');
    }
  }

  function doReconnect() {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(wsUrl);
      ws.addEventListener('open', () => {
        connected = true;
        setupWebSocketListeners();
        resolve();
      });
      ws.addEventListener('error', (event) => {
        reject(new Error(`CDP reconnection error: ${event.message || 'Connection failed'}`));
      });
    });
  }

  async function connect() {
    if (connected) return;
    if (connecting) throw new Error('Connection already in progress');

    connecting = true;
    intentionalClose = false;

    return new Promise((resolve, reject) => {
      ws = new WebSocket(wsUrl);

      ws.addEventListener('open', () => {
        connected = true;
        connecting = false;
        resolve();
      });

      ws.addEventListener('error', (event) => {
        connecting = false;
        reject(new Error(`CDP connection error: ${event.message || 'Connection failed'}`));
      });

      ws.addEventListener('close', () => {
        const wasConnected = connected;
        connected = false;
        connecting = false;
        rejectPendingCommands('Connection closed');

        if (wasConnected && !intentionalClose && autoReconnect) {
          attemptReconnect();
        } else if (wasConnected && onCloseCallback && !intentionalClose) {
          onCloseCallback('Connection closed unexpectedly');
        }
      });

      ws.addEventListener('message', (event) => handleMessage(event.data));
    });
  }

  async function send(method, params = {}, timeout = 30000) {
    if (!connected) throw new Error('Not connected to CDP');

    const id = ++messageId;
    const message = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCommands.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, timeout);

      pendingCommands.set(id, { resolve, reject, timer });
      ws.send(message);
    });
  }

  async function sendToSession(sessionId, method, params = {}, timeout = 30000) {
    if (!connected) throw new Error('Not connected to CDP');

    const id = ++messageId;
    const message = JSON.stringify({ id, sessionId, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCommands.delete(id);
        reject(new Error(`CDP command timeout: ${method} (session: ${sessionId})`));
      }, timeout);

      pendingCommands.set(id, { resolve, reject, timer });
      ws.send(message);
    });
  }

  function on(event, callback) {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, new Set());
    }
    eventListeners.get(event).add(callback);
  }

  function off(event, callback) {
    const listeners = eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  function waitForEvent(event, predicate = () => true, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off(event, handler);
        reject(new Error(`Timeout waiting for event: ${event}`));
      }, timeout);

      const handler = (params) => {
        if (predicate(params)) {
          clearTimeout(timer);
          off(event, handler);
          resolve(params);
        }
      };

      on(event, handler);
    });
  }

  async function close() {
    intentionalClose = true;
    reconnecting = false;
    if (ws) {
      rejectPendingCommands('Connection closed');
      ws.close();
      ws = null;
      connected = false;
      eventListeners.clear();
    }
  }

  function removeAllListeners(event) {
    if (event) {
      eventListeners.delete(event);
    } else {
      eventListeners.clear();
    }
  }

  function onClose(callback) {
    onCloseCallback = callback;
  }

  return {
    connect,
    send,
    sendToSession,
    on,
    off,
    waitForEvent,
    close,
    removeAllListeners,
    onClose,
    isConnected: () => connected,
    getWsUrl: () => wsUrl
  };
}

// ============================================================================
// Discovery
// ============================================================================

/**
 * Discover Chrome CDP endpoints via HTTP
 * @param {string} [host='localhost'] - Chrome debugging host
 * @param {number} [port=9222] - Chrome debugging port
 * @param {number} [timeout=5000] - Request timeout in ms
 * @returns {Object} Discovery interface
 */
export function createDiscovery(host = 'localhost', port = 9222, timeout = 5000) {
  const baseUrl = `http://${host}:${port}`;

  function createTimeoutController() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    return {
      signal: controller.signal,
      clear: () => clearTimeout(timeoutId)
    };
  }

  async function getVersion() {
    const timeoutCtrl = createTimeoutController();
    try {
      const response = await fetch(`${baseUrl}/json/version`, { signal: timeoutCtrl.signal });
      if (!response.ok) {
        throw new Error(`Chrome not reachable at ${baseUrl}: ${response.status}`);
      }
      const data = await response.json();
      return {
        browser: data.Browser,
        protocolVersion: data['Protocol-Version'],
        webSocketDebuggerUrl: data.webSocketDebuggerUrl
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Chrome discovery timeout at ${baseUrl}`);
      }
      throw err;
    } finally {
      timeoutCtrl.clear();
    }
  }

  async function getTargets() {
    const timeoutCtrl = createTimeoutController();
    try {
      const response = await fetch(`${baseUrl}/json/list`, { signal: timeoutCtrl.signal });
      if (!response.ok) {
        throw new Error(`Failed to get targets: ${response.status}`);
      }
      return response.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Chrome discovery timeout getting targets');
      }
      throw err;
    } finally {
      timeoutCtrl.clear();
    }
  }

  async function getPages() {
    const targets = await getTargets();
    return targets.filter(t => t.type === 'page');
  }

  async function findPageByUrl(urlPattern) {
    const pages = await getPages();
    const regex = urlPattern instanceof RegExp ? urlPattern : new RegExp(urlPattern);
    return pages.find(p => regex.test(p.url)) || null;
  }

  async function isAvailable() {
    try {
      await getVersion();
      return true;
    } catch {
      return false;
    }
  }

  return {
    getVersion,
    getTargets,
    getPages,
    findPageByUrl,
    isAvailable
  };
}

/**
 * Convenience function to discover Chrome
 * @param {string} [host='localhost'] - Chrome debugging host
 * @param {number} [port=9222] - Chrome debugging port
 * @param {number} [timeout=5000] - Request timeout in ms
 * @returns {Promise<{wsUrl: string, version: Object, targets: Array}>}
 */
export async function discoverChrome(host = 'localhost', port = 9222, timeout = 5000) {
  const discovery = createDiscovery(host, port, timeout);
  const version = await discovery.getVersion();
  const targets = await discovery.getTargets();
  return {
    wsUrl: version.webSocketDebuggerUrl,
    version,
    targets
  };
}

// ============================================================================
// Target Manager
// ============================================================================

/**
 * Create a target manager for browser targets
 * @param {Object} connection - CDP connection
 * @returns {Object} Target manager interface
 */
export function createTargetManager(connection) {
  const targets = new Map();
  let discoveryEnabled = false;
  let boundHandlers = null;

  function onTargetCreated(params) {
    targets.set(params.targetInfo.targetId, params.targetInfo);
  }

  function onTargetDestroyed(params) {
    targets.delete(params.targetId);
  }

  function onTargetInfoChanged(params) {
    targets.set(params.targetInfo.targetId, params.targetInfo);
  }

  async function enableDiscovery() {
    if (discoveryEnabled) return;

    boundHandlers = { onTargetCreated, onTargetDestroyed, onTargetInfoChanged };
    connection.on('Target.targetCreated', boundHandlers.onTargetCreated);
    connection.on('Target.targetDestroyed', boundHandlers.onTargetDestroyed);
    connection.on('Target.targetInfoChanged', boundHandlers.onTargetInfoChanged);

    await connection.send('Target.setDiscoverTargets', { discover: true });
    discoveryEnabled = true;
  }

  async function disableDiscovery() {
    if (!discoveryEnabled) return;

    await connection.send('Target.setDiscoverTargets', { discover: false });

    if (boundHandlers) {
      connection.off('Target.targetCreated', boundHandlers.onTargetCreated);
      connection.off('Target.targetDestroyed', boundHandlers.onTargetDestroyed);
      connection.off('Target.targetInfoChanged', boundHandlers.onTargetInfoChanged);
    }

    discoveryEnabled = false;
  }

  async function getTargets(filter = null) {
    const result = await connection.send('Target.getTargets', {
      filter: filter ? [filter] : undefined
    });

    for (const info of result.targetInfos) {
      targets.set(info.targetId, info);
    }

    return result.targetInfos;
  }

  async function getPages() {
    const allTargets = await getTargets();
    return allTargets.filter(t => t.type === 'page');
  }

  async function createTarget(url = 'about:blank', options = {}) {
    const result = await connection.send('Target.createTarget', {
      url,
      width: options.width,
      height: options.height,
      background: options.background ?? false,
      newWindow: options.newWindow ?? false
    });
    return result.targetId;
  }

  async function closeTarget(targetId) {
    const result = await connection.send('Target.closeTarget', { targetId });
    targets.delete(targetId);
    return result.success ?? true;
  }

  async function activateTarget(targetId) {
    await connection.send('Target.activateTarget', { targetId });
  }

  async function getTargetInfo(targetId) {
    const result = await connection.send('Target.getTargetInfo', { targetId });
    targets.set(targetId, result.targetInfo);
    return result.targetInfo;
  }

  function getCachedTarget(targetId) {
    return targets.get(targetId);
  }

  function getCachedTargets() {
    return new Map(targets);
  }

  async function cleanup() {
    await disableDiscovery();
    targets.clear();
  }

  return {
    enableDiscovery,
    disableDiscovery,
    getTargets,
    getPages,
    createTarget,
    closeTarget,
    activateTarget,
    getTargetInfo,
    getCachedTarget,
    getCachedTargets,
    cleanup
  };
}

// ============================================================================
// Session Registry
// ============================================================================

/**
 * Create a session registry for managing CDP sessions
 * @param {Object} connection - CDP connection
 * @returns {Object} Session registry interface
 */
export function createSessionRegistry(connection) {
  const sessions = new Map();
  const targetToSession = new Map();
  const pendingAttach = new Map();
  let boundHandlers = null;

  function onAttached(params) {
    const { sessionId, targetInfo } = params;
    sessions.set(sessionId, { targetId: targetInfo.targetId, attached: true });
    targetToSession.set(targetInfo.targetId, sessionId);
  }

  function onDetached(params) {
    const { sessionId } = params;
    const session = sessions.get(sessionId);
    if (session) {
      targetToSession.delete(session.targetId);
      sessions.delete(sessionId);
    }
  }

  function onTargetDestroyed(params) {
    const { targetId } = params;
    const sessionId = targetToSession.get(targetId);
    if (sessionId) {
      sessions.delete(sessionId);
      targetToSession.delete(targetId);
    }
  }

  // Setup handlers on creation
  boundHandlers = { onAttached, onDetached, onTargetDestroyed };
  connection.on('Target.attachedToTarget', boundHandlers.onAttached);
  connection.on('Target.detachedFromTarget', boundHandlers.onDetached);
  connection.on('Target.targetDestroyed', boundHandlers.onTargetDestroyed);

  async function doAttach(targetId) {
    const result = await connection.send('Target.attachToTarget', {
      targetId,
      flatten: true
    });

    const sessionId = result.sessionId;
    sessions.set(sessionId, { targetId, attached: true });
    targetToSession.set(targetId, sessionId);

    return sessionId;
  }

  async function attach(targetId) {
    const existing = targetToSession.get(targetId);
    if (existing) return existing;

    const pending = pendingAttach.get(targetId);
    if (pending) return pending;

    const attachPromise = doAttach(targetId);
    pendingAttach.set(targetId, attachPromise);

    try {
      return await attachPromise;
    } finally {
      pendingAttach.delete(targetId);
    }
  }

  async function detach(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    await connection.send('Target.detachFromTarget', { sessionId });
    sessions.delete(sessionId);
    targetToSession.delete(session.targetId);
  }

  async function detachByTarget(targetId) {
    const sessionId = targetToSession.get(targetId);
    if (sessionId) {
      await detach(sessionId);
    }
  }

  function getSessionForTarget(targetId) {
    return targetToSession.get(targetId);
  }

  function getTargetForSession(sessionId) {
    return sessions.get(sessionId)?.targetId;
  }

  function isAttached(targetId) {
    return targetToSession.has(targetId);
  }

  function getAllSessions() {
    return Array.from(sessions.entries()).map(([sessionId, data]) => ({
      sessionId,
      targetId: data.targetId
    }));
  }

  async function detachAll() {
    const sessionIds = Array.from(sessions.keys());
    await Promise.all(sessionIds.map(s => detach(s)));
  }

  async function cleanup() {
    await detachAll();
    if (boundHandlers) {
      connection.off('Target.attachedToTarget', boundHandlers.onAttached);
      connection.off('Target.detachedFromTarget', boundHandlers.onDetached);
      connection.off('Target.targetDestroyed', boundHandlers.onTargetDestroyed);
    }
    sessions.clear();
    targetToSession.clear();
    pendingAttach.clear();
  }

  return {
    attach,
    detach,
    detachByTarget,
    getSessionForTarget,
    getTargetForSession,
    isAttached,
    getAllSessions,
    detachAll,
    cleanup
  };
}

// ============================================================================
// Page Session
// ============================================================================

/**
 * Create a page session for CDP communication with a specific page
 * @param {Object} connection - CDP connection
 * @param {string} sessionId - Session ID
 * @param {string} targetId - Target ID
 * @returns {Object} Page session interface
 */
export function createPageSession(connection, sessionId, targetId) {
  let valid = true;
  let detachHandler = null;

  function onDetached(params) {
    if (params.sessionId === sessionId) {
      valid = false;
      if (detachHandler) {
        connection.off('Target.detachedFromTarget', detachHandler);
      }
    }
  }

  detachHandler = onDetached;
  connection.on('Target.detachedFromTarget', detachHandler);

  async function send(method, params = {}) {
    if (!valid) {
      throw new Error(`Session ${sessionId} is no longer valid (target was closed or detached)`);
    }
    return connection.sendToSession(sessionId, method, params);
  }

  function on(event, callback) {
    connection.on(`${sessionId}:${event}`, callback);
  }

  function off(event, callback) {
    connection.off(`${sessionId}:${event}`, callback);
  }

  function dispose() {
    valid = false;
    if (detachHandler) {
      connection.off('Target.detachedFromTarget', detachHandler);
    }
  }

  return {
    send,
    on,
    off,
    dispose,
    isValid: () => valid,
    get sessionId() { return sessionId; },
    get targetId() { return targetId; }
  };
}

// ============================================================================
// Browser Client
// ============================================================================

/**
 * Create a high-level browser client
 * @param {Object} [options] - Configuration options
 * @param {string} [options.host='localhost'] - Chrome host
 * @param {number} [options.port=9222] - Chrome debugging port
 * @param {number} [options.connectTimeout=30000] - Connection timeout in ms
 * @returns {Object} Browser client interface
 */
export function createBrowser(options = {}) {
  const host = options.host ?? 'localhost';
  const port = options.port ?? 9222;
  const connectTimeout = options.connectTimeout ?? 30000;

  let discovery = createDiscovery(host, port, connectTimeout);
  let connection = null;
  let targetManager = null;
  let sessionRegistry = null;
  let connected = false;
  const targetLocks = new Map();

  async function acquireLock(targetId) {
    // Wait for any existing lock to be released
    while (targetLocks.has(targetId)) {
      await targetLocks.get(targetId);
    }
    // Create a new lock - this Promise will resolve when releaseLock is called
    let releaseFn;
    const lockPromise = new Promise(resolve => {
      releaseFn = resolve;
    });
    targetLocks.set(targetId, lockPromise);
    // Return a lock handle that can be used to release
    return { promise: lockPromise, release: releaseFn };
  }

  function releaseLock(targetId, lock) {
    if (targetLocks.get(targetId) === lock.promise) {
      targetLocks.delete(targetId);
    }
    lock.release();
  }

  function ensureConnected() {
    if (!connected) {
      throw new Error('BrowserClient not connected. Call connect() first.');
    }
  }

  async function doConnect() {
    const version = await discovery.getVersion();
    connection = createConnection(version.webSocketDebuggerUrl);
    await connection.connect();

    targetManager = createTargetManager(connection);
    sessionRegistry = createSessionRegistry(connection);

    await targetManager.enableDiscovery();
    connected = true;
  }

  async function connect() {
    if (connected) return;

    const connectPromise = doConnect();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(timeoutError(`Connection to Chrome timed out after ${connectTimeout}ms`));
      }, connectTimeout);
    });

    await Promise.race([connectPromise, timeoutPromise]);
  }

  async function disconnect() {
    if (!connected) return;

    await sessionRegistry.cleanup();
    await targetManager.cleanup();
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
    const lock = await acquireLock(targetId);
    try {
      const sessionId = await sessionRegistry.attach(targetId);
      return createPageSession(connection, sessionId, targetId);
    } finally {
      releaseLock(targetId, lock);
    }
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
    const lock = await acquireLock(targetId);
    try {
      await sessionRegistry.detachByTarget(targetId);
      await targetManager.closeTarget(targetId);
    } finally {
      releaseLock(targetId, lock);
    }
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
    get connection() { return connection; },
    get targets() { return targetManager; },
    get sessions() { return sessionRegistry; }
  };
}
