/**
 * Target and Session Management Module
 * CDP target management and session registry for browser tabs
 *
 * PUBLIC EXPORTS:
 * - createTargetManager(connection) - Factory for target manager
 * - createSessionRegistry(connection) - Factory for session registry
 * - createPageSession(connection, sessionId, targetId) - Factory for page session
 *
 * @module cdp-skill/cdp/target-and-session
 */

/**
 * Create a target manager for browser targets
 * @param {import('../types.js').CDPConnection} connection - CDP connection
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

  /**
   * Enable automatic target discovery
   * @returns {Promise<void>}
   */
  async function enableDiscovery() {
    if (discoveryEnabled) return;

    boundHandlers = { onTargetCreated, onTargetDestroyed, onTargetInfoChanged };
    connection.on('Target.targetCreated', boundHandlers.onTargetCreated);
    connection.on('Target.targetDestroyed', boundHandlers.onTargetDestroyed);
    connection.on('Target.targetInfoChanged', boundHandlers.onTargetInfoChanged);

    await connection.send('Target.setDiscoverTargets', { discover: true });
    discoveryEnabled = true;
  }

  /**
   * Disable automatic target discovery
   * @returns {Promise<void>}
   */
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

  /**
   * Get all targets, optionally filtered
   * @param {Object} [filter] - Optional target filter
   * @returns {Promise<Array>} Array of target info objects
   */
  async function getTargets(filter = null) {
    const result = await connection.send('Target.getTargets', {
      filter: filter ? [filter] : undefined
    });

    for (const info of result.targetInfos) {
      targets.set(info.targetId, info);
    }

    return result.targetInfos;
  }

  /**
   * Get page targets only
   * @returns {Promise<Array>} Array of page target info objects
   */
  async function getPages() {
    const allTargets = await getTargets();
    return allTargets.filter(t => t.type === 'page');
  }

  /**
   * Create a new browser target (tab)
   * @param {string} [url='about:blank'] - Initial URL
   * @param {Object} [options] - Creation options
   * @param {number} [options.width] - Viewport width
   * @param {number} [options.height] - Viewport height
   * @param {boolean} [options.background=false] - Create in background
   * @param {boolean} [options.newWindow=false] - Create in new window
   * @returns {Promise<string>} Target ID
   */
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

  /**
   * Close a target
   * @param {string} targetId - Target to close
   * @returns {Promise<boolean>} Success
   */
  async function closeTarget(targetId) {
    const result = await connection.send('Target.closeTarget', { targetId });
    targets.delete(targetId);
    return result.success ?? true;
  }

  /**
   * Activate (bring to front) a target
   * @param {string} targetId - Target to activate
   * @returns {Promise<void>}
   */
  async function activateTarget(targetId) {
    await connection.send('Target.activateTarget', { targetId });
  }

  /**
   * Get detailed info for a target
   * @param {string} targetId - Target ID
   * @returns {Promise<Object>} Target info
   */
  async function getTargetInfo(targetId) {
    const result = await connection.send('Target.getTargetInfo', { targetId });
    targets.set(targetId, result.targetInfo);
    return result.targetInfo;
  }

  /**
   * Get cached target info
   * @param {string} targetId - Target ID
   * @returns {Object|undefined} Cached target info
   */
  function getCachedTarget(targetId) {
    return targets.get(targetId);
  }

  /**
   * Get all cached targets
   * @returns {Map} Cached targets map
   */
  function getCachedTargets() {
    return new Map(targets);
  }

  /**
   * Clean up target manager
   * @returns {Promise<void>}
   */
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

/**
 * Create a session registry for managing CDP sessions
 * @param {import('../types.js').CDPConnection} connection - CDP connection
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

  /**
   * Attach to a target
   * @param {string} targetId - Target to attach to
   * @returns {Promise<string>} Session ID
   */
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

  /**
   * Detach from a session
   * @param {string} sessionId - Session to detach
   * @returns {Promise<void>}
   */
  async function detach(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    await connection.send('Target.detachFromTarget', { sessionId });
    sessions.delete(sessionId);
    targetToSession.delete(session.targetId);
  }

  /**
   * Detach from a target by target ID
   * @param {string} targetId - Target to detach from
   * @returns {Promise<void>}
   */
  async function detachByTarget(targetId) {
    const sessionId = targetToSession.get(targetId);
    if (sessionId) {
      await detach(sessionId);
    }
  }

  /**
   * Get session ID for a target
   * @param {string} targetId - Target ID
   * @returns {string|undefined} Session ID
   */
  function getSessionForTarget(targetId) {
    return targetToSession.get(targetId);
  }

  /**
   * Get target ID for a session
   * @param {string} sessionId - Session ID
   * @returns {string|undefined} Target ID
   */
  function getTargetForSession(sessionId) {
    return sessions.get(sessionId)?.targetId;
  }

  /**
   * Check if attached to a target
   * @param {string} targetId - Target ID
   * @returns {boolean}
   */
  function isAttached(targetId) {
    return targetToSession.has(targetId);
  }

  /**
   * Get all sessions
   * @returns {Array<{sessionId: string, targetId: string}>}
   */
  function getAllSessions() {
    return Array.from(sessions.entries()).map(([sessionId, data]) => ({
      sessionId,
      targetId: data.targetId
    }));
  }

  /**
   * Detach from all sessions
   * @returns {Promise<void>}
   */
  async function detachAll() {
    const sessionIds = Array.from(sessions.keys());
    await Promise.all(sessionIds.map(s => detach(s)));
  }

  /**
   * Clean up session registry
   * @returns {Promise<void>}
   */
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

/**
 * Create a page session for CDP communication with a specific page
 * @param {import('../types.js').CDPConnection} connection - CDP connection
 * @param {string} sessionId - Session ID
 * @param {string} targetId - Target ID
 * @returns {import('../types.js').CDPSession} Page session interface
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

  /**
   * Send CDP command via this session
   * @param {string} method - CDP method name
   * @param {Object} [params={}] - Command parameters
   * @returns {Promise<Object>} Command result
   */
  async function send(method, params = {}) {
    if (!valid) {
      throw new Error(`Session ${sessionId} is no longer valid (target was closed or detached)`);
    }
    return connection.sendToSession(sessionId, method, params);
  }

  /**
   * Subscribe to session-scoped event
   * @param {string} event - Event name
   * @param {function} callback - Event handler
   */
  function on(event, callback) {
    connection.on(`${sessionId}:${event}`, callback);
  }

  /**
   * Unsubscribe from session-scoped event
   * @param {string} event - Event name
   * @param {function} callback - Event handler
   */
  function off(event, callback) {
    connection.off(`${sessionId}:${event}`, callback);
  }

  /**
   * Dispose the session
   */
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
