/**
 * CDP Connection Module
 * WebSocket-based Chrome DevTools Protocol connection handling
 *
 * PUBLIC EXPORTS:
 * - createConnection(wsUrl, options?) - Factory for CDP WebSocket connection
 *
 * @module cdp-skill/cdp/connection
 */

/**
 * Create a CDP WebSocket connection
 * @param {string} wsUrl - WebSocket URL for CDP endpoint
 * @param {Object} [options] - Connection options
 * @param {number} [options.maxRetries=5] - Max reconnection attempts
 * @param {number} [options.retryDelay=1000] - Base delay between retries
 * @param {number} [options.maxRetryDelay=30000] - Maximum retry delay cap
 * @param {boolean} [options.autoReconnect=false] - Enable auto reconnection
 * @returns {import('../types.js').CDPConnection} Connection interface
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
      emit('__connection_closed');

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
      // Close old WebSocket if still open to prevent stale event handlers
      if (ws) {
        try { ws.close(); } catch { /* already closed */ }
        ws = null;
      }

      const newWs = new WebSocket(wsUrl);

      newWs.addEventListener('open', () => {
        ws = newWs;
        connected = true;
        setupWebSocketListeners();
        resolve();
      });

      newWs.addEventListener('error', (event) => {
        // Don't assign to ws if connection failed
        try { newWs.close(); } catch { /* already closing */ }
        reject(new Error(`CDP reconnection error: ${event.message || 'Connection failed'}`));
      });
    });
  }

  /**
   * Establish WebSocket connection
   * @returns {Promise<void>}
   */
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
        emit('__connection_closed');

        if (wasConnected && !intentionalClose && autoReconnect) {
          attemptReconnect();
        } else if (wasConnected && onCloseCallback && !intentionalClose) {
          onCloseCallback('Connection closed unexpectedly');
        }
      });

      ws.addEventListener('message', (event) => handleMessage(event.data));
    });
  }

  /**
   * Send CDP command
   * @param {string} method - CDP method name
   * @param {Object} [params={}] - Command parameters
   * @param {number} [timeout=30000] - Command timeout in ms
   * @returns {Promise<Object>} Command result
   */
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

  /**
   * Send CDP command to specific session
   * @param {string} sessionId - Target session ID
   * @param {string} method - CDP method name
   * @param {Object} [params={}] - Command parameters
   * @param {number} [timeout=30000] - Command timeout in ms
   * @returns {Promise<Object>} Command result
   */
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

  /**
   * Subscribe to CDP event
   * @param {string} event - Event name
   * @param {function} callback - Event handler
   */
  function on(event, callback) {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, new Set());
    }
    eventListeners.get(event).add(callback);
  }

  /**
   * Unsubscribe from CDP event
   * @param {string} event - Event name
   * @param {function} callback - Event handler
   */
  function off(event, callback) {
    const listeners = eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Wait for specific event
   * @param {string} event - Event name
   * @param {function} [predicate=()=>true] - Filter predicate
   * @param {number} [timeout=30000] - Timeout in ms
   * @returns {Promise<Object>} Event parameters
   */
  function waitForEvent(event, predicate = () => true, timeout = 30000) {
    return new Promise((resolve, reject) => {
      function cleanup() {
        clearTimeout(timer);
        off(event, handler);
        off('__connection_closed', closeHandler);
      }

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for event: ${event}`));
      }, timeout);

      const handler = (params) => {
        if (predicate(params)) {
          cleanup();
          resolve(params);
        }
      };

      const closeHandler = () => {
        cleanup();
        reject(new Error(`Connection closed while waiting for event: ${event}`));
      };

      on(event, handler);
      on('__connection_closed', closeHandler);
    });
  }

  /**
   * Close the connection
   * @returns {Promise<void>}
   */
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

  /**
   * Remove all event listeners
   * @param {string} [event] - Specific event, or all if omitted
   */
  function removeAllListeners(event) {
    if (event) {
      eventListeners.delete(event);
    } else {
      eventListeners.clear();
    }
  }

  /**
   * Set close callback
   * @param {function} callback - Callback for unexpected close
   */
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
