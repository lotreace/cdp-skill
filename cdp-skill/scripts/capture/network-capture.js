/**
 * Network Capture Module
 * Captures network failures and HTTP errors during page interaction
 *
 * PUBLIC EXPORTS:
 * - createNetworkCapture(session, config?) - Factory for network capture
 *
 * @module cdp-skill/capture/network-capture
 */

const DEFAULT_MAX_PENDING_REQUESTS = 10000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Create a network error capture utility
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {Object} [config] - Configuration options
 * @param {number} [config.maxPendingRequests=10000] - Maximum pending requests to track
 * @param {number} [config.requestTimeoutMs=300000] - Stale request timeout
 * @returns {Object} Network capture interface
 */
export function createNetworkCapture(session, config = {}) {
  const maxPendingRequests = config.maxPendingRequests || DEFAULT_MAX_PENDING_REQUESTS;
  const requestTimeoutMs = config.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;

  const requests = new Map();
  let errors = [];
  let httpErrors = [];
  let capturing = false;
  const handlers = {};
  let captureOptions = {};
  let cleanupIntervalId = null;

  function cleanupStaleRequests() {
    const now = Date.now() / 1000;
    const timeoutSec = requestTimeoutMs / 1000;

    for (const [requestId, request] of requests) {
      if (now - request.timestamp > timeoutSec) {
        requests.delete(requestId);
      }
    }
  }

  /**
   * Start capturing network errors
   * @param {Object} [startOptions] - Capture options
   * @param {boolean} [startOptions.captureHttpErrors=true] - Capture HTTP 4xx/5xx errors
   * @param {number[]} [startOptions.ignoreStatusCodes=[]] - Status codes to ignore
   * @returns {Promise<void>}
   */
  async function startCapture(startOptions = {}) {
    if (capturing) return;

    captureOptions = {
      captureHttpErrors: startOptions.captureHttpErrors !== false,
      ignoreStatusCodes: new Set(startOptions.ignoreStatusCodes || [])
    };

    await session.send('Network.enable');

    handlers.requestWillBeSent = (params) => {
      if (requests.size >= maxPendingRequests) {
        const oldestKey = requests.keys().next().value;
        requests.delete(oldestKey);
      }
      requests.set(params.requestId, {
        url: params.request.url,
        method: params.request.method,
        timestamp: params.timestamp,
        type: params.type
      });
    };

    handlers.loadingFailed = (params) => {
      const request = requests.get(params.requestId);
      errors.push({
        type: 'network-failure',
        requestId: params.requestId,
        url: request?.url || 'unknown',
        method: request?.method || 'unknown',
        resourceType: params.type,
        errorText: params.errorText,
        canceled: params.canceled || false,
        blockedReason: params.blockedReason,
        timestamp: params.timestamp
      });
      requests.delete(params.requestId);
    };

    handlers.responseReceived = (params) => {
      const status = params.response.status;

      if (captureOptions.captureHttpErrors && status >= 400 &&
          !captureOptions.ignoreStatusCodes.has(status)) {
        const request = requests.get(params.requestId);
        httpErrors.push({
          type: 'http-error',
          requestId: params.requestId,
          url: params.response.url,
          method: request?.method || 'unknown',
          status,
          statusText: params.response.statusText,
          resourceType: params.type,
          mimeType: params.response.mimeType,
          timestamp: params.timestamp
        });
      }
    };

    handlers.loadingFinished = (params) => {
      requests.delete(params.requestId);
    };

    session.on('Network.requestWillBeSent', handlers.requestWillBeSent);
    session.on('Network.loadingFailed', handlers.loadingFailed);
    session.on('Network.responseReceived', handlers.responseReceived);
    session.on('Network.loadingFinished', handlers.loadingFinished);

    cleanupIntervalId = setInterval(
      cleanupStaleRequests,
      Math.min(requestTimeoutMs / 2, 60000)
    );

    capturing = true;
  }

  /**
   * Stop capturing network errors
   * @returns {Promise<void>}
   */
  async function stopCapture() {
    if (!capturing) return;

    session.off('Network.requestWillBeSent', handlers.requestWillBeSent);
    session.off('Network.loadingFailed', handlers.loadingFailed);
    session.off('Network.responseReceived', handlers.responseReceived);
    session.off('Network.loadingFinished', handlers.loadingFinished);

    if (cleanupIntervalId) {
      clearInterval(cleanupIntervalId);
      cleanupIntervalId = null;
    }

    requests.clear();
    await session.send('Network.disable');
    capturing = false;
  }

  /**
   * Get network failures (connection errors, blocked requests, etc.)
   * @returns {import('../types.js').NetworkError[]}
   */
  function getNetworkFailures() {
    return [...errors];
  }

  /**
   * Get HTTP errors (4xx and 5xx responses)
   * @returns {import('../types.js').NetworkError[]}
   */
  function getHttpErrors() {
    return [...httpErrors];
  }

  /**
   * Get all errors sorted by timestamp
   * @returns {import('../types.js').NetworkError[]}
   */
  function getAllErrors() {
    return [...errors, ...httpErrors].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Check if any errors were captured
   * @returns {boolean}
   */
  function hasErrors() {
    return errors.length > 0 || httpErrors.length > 0;
  }

  /**
   * Get errors by resource type
   * @param {string|string[]} types - Resource type(s) to filter
   * @returns {import('../types.js').NetworkError[]}
   */
  function getErrorsByType(types) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    return getAllErrors().filter(e => typeSet.has(e.resourceType));
  }

  /**
   * Clear captured errors
   */
  function clear() {
    errors = [];
    httpErrors = [];
    requests.clear();
  }

  return {
    startCapture,
    stopCapture,
    getNetworkFailures,
    getHttpErrors,
    getAllErrors,
    hasErrors,
    getErrorsByType,
    clear
  };
}
