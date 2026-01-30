/**
 * Page Operations and Waiting Utilities
 * Navigation, lifecycle management, wait strategies, and storage management
 *
 * Consolidated: storage.js (cookie and web storage managers)
 */

import {
  navigationError,
  navigationAbortedError,
  timeoutError,
  connectionError,
  pageCrashedError,
  contextDestroyedError,
  isContextDestroyed,
  resolveViewport,
  sleep
} from './utils.js';

const MAX_TIMEOUT = 300000; // 5 minutes max timeout

// ============================================================================
// LCS DOM Stability (improvement #9)
// ============================================================================

/**
 * Calculate Longest Common Subsequence length between two arrays
 * Used for comparing DOM structure changes
 * @param {Array} a - First array
 * @param {Array} b - Second array
 * @returns {number} Length of LCS
 */
function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;

  // Use space-optimized version for large arrays
  if (m > 1000 || n > 1000) {
    // For very large arrays, use a simpler similarity metric
    const setA = new Set(a);
    const setB = new Set(b);
    let common = 0;
    for (const item of setA) {
      if (setB.has(item)) common++;
    }
    return common;
  }

  // Standard DP solution
  const dp = Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1;
      } else {
        dp[j] = Math.max(dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }

  return dp[n];
}

/**
 * Calculate similarity ratio between two arrays using LCS
 * @param {Array} a - First array
 * @param {Array} b - Second array
 * @returns {number} Similarity ratio between 0 and 1
 */
function lcsSimilarity(a, b) {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const lcs = lcsLength(a, b);
  return (2 * lcs) / (a.length + b.length);
}

/**
 * Get DOM structure signature for stability comparison
 * @param {Object} session - CDP session
 * @param {string} [selector='body'] - Root element selector
 * @returns {Promise<string[]>} Array of element signatures
 */
async function getDOMSignature(session, selector = 'body') {
  const result = await session.send('Runtime.evaluate', {
    expression: `
      (function() {
        const root = document.querySelector(${JSON.stringify(selector)}) || document.body;
        if (!root) return [];

        const signatures = [];
        const walker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_ELEMENT,
          {
            acceptNode: (node) => {
              // Skip script, style, and hidden elements
              if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.tagName)) {
                return NodeFilter.FILTER_REJECT;
              }
              const style = window.getComputedStyle(node);
              if (style.display === 'none' || style.visibility === 'hidden') {
                return NodeFilter.FILTER_SKIP;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );

        let node;
        let count = 0;
        const maxNodes = 500; // Limit to prevent huge arrays

        while ((node = walker.nextNode()) && count < maxNodes) {
          // Create signature: tagName + key attributes
          let sig = node.tagName.toLowerCase();
          if (node.id) sig += '#' + node.id;
          if (node.className && typeof node.className === 'string') {
            // Only include first 2 class names to reduce noise
            const classes = node.className.split(' ').filter(c => c).slice(0, 2);
            if (classes.length > 0) sig += '.' + classes.join('.');
          }
          // Include text content hash for leaf nodes
          if (!node.firstElementChild && node.textContent) {
            const text = node.textContent.trim().slice(0, 50);
            if (text) sig += ':' + text.length;
          }
          signatures.push(sig);
          count++;
        }

        return signatures;
      })()
    `,
    returnByValue: true
  });

  return result.result.value || [];
}

/**
 * Check if DOM has stabilized by comparing structure over time
 * Uses LCS to distinguish meaningful changes from cosmetic ones
 * @param {Object} session - CDP session
 * @param {Object} [options] - Options
 * @param {string} [options.selector='body'] - Root element to check
 * @param {number} [options.threshold=0.95] - Similarity threshold (0-1)
 * @param {number} [options.checks=3] - Number of consecutive stable checks
 * @param {number} [options.interval=100] - Ms between checks
 * @param {number} [options.timeout=10000] - Total timeout
 * @returns {Promise<{stable: boolean, similarity: number, checks: number}>}
 */
async function waitForDOMStability(session, options = {}) {
  const {
    selector = 'body',
    threshold = 0.95,
    checks = 3,
    interval = 100,
    timeout = 10000
  } = options;

  const startTime = Date.now();
  let lastSignature = await getDOMSignature(session, selector);
  let stableCount = 0;
  let lastSimilarity = 1;

  while (Date.now() - startTime < timeout) {
    await sleep(interval);

    const currentSignature = await getDOMSignature(session, selector);
    const similarity = lcsSimilarity(lastSignature, currentSignature);
    lastSimilarity = similarity;

    if (similarity >= threshold) {
      stableCount++;
      if (stableCount >= checks) {
        return { stable: true, similarity, checks: stableCount };
      }
    } else {
      stableCount = 0;
    }

    lastSignature = currentSignature;
  }

  return { stable: false, similarity: lastSimilarity, checks: stableCount };
}

// ============================================================================
// Wait Conditions
// ============================================================================

// Export LCS utilities for DOM stability checking
export { lcsLength, lcsSimilarity, getDOMSignature, waitForDOMStability };

/**
 * Wait conditions for page navigation
 */
export const WaitCondition = Object.freeze({
  LOAD: 'load',
  DOM_CONTENT_LOADED: 'domcontentloaded',
  NETWORK_IDLE: 'networkidle',
  COMMIT: 'commit'
});

// ============================================================================
// Page Controller
// ============================================================================

/**
 * Create a page controller for navigation and lifecycle events
 * @param {Object} cdpClient - CDP client with send/on/off methods
 * @returns {Object} Page controller interface
 */
export function createPageController(cdpClient) {
  let mainFrameId = null;
  let currentFrameId = null;
  let currentExecutionContextId = null;
  const frameExecutionContexts = new Map(); // frameId -> executionContextId
  const lifecycleEvents = new Map();
  const lifecycleWaiters = new Set();
  const pendingRequests = new Set();
  let networkIdleTimer = null;
  const eventListeners = [];
  const networkIdleDelay = 500;
  let navigationInProgress = false;
  let currentNavigationAbort = null;
  let currentNavigationUrl = null;
  let pageCrashed = false;
  const crashWaiters = new Set();
  const abortWaiters = new Set();

  // Network idle counter (improvement #10)
  // Tracks request counts for precise network quiet detection
  let networkRequestCount = 0;
  let networkIdleWaiters = new Set();
  let lastNetworkActivity = Date.now();

  function validateTimeout(timeout) {
    if (typeof timeout !== 'number' || !Number.isFinite(timeout)) return 30000;
    if (timeout < 0) return 0;
    if (timeout > MAX_TIMEOUT) return MAX_TIMEOUT;
    return timeout;
  }

  function resetNetworkIdleTimer() {
    if (networkIdleTimer) {
      clearTimeout(networkIdleTimer);
      networkIdleTimer = null;
    }
  }

  function addLifecycleWaiter(callback) {
    lifecycleWaiters.add(callback);
  }

  function removeLifecycleWaiter(callback) {
    lifecycleWaiters.delete(callback);
  }

  function notifyWaiters(frameId, eventName) {
    for (const waiter of lifecycleWaiters) {
      waiter(frameId, eventName);
    }
  }

  function addCrashWaiter(rejectFn) {
    crashWaiters.add(rejectFn);
  }

  function removeCrashWaiter(rejectFn) {
    crashWaiters.delete(rejectFn);
  }

  function addAbortWaiter(rejectFn) {
    abortWaiters.add(rejectFn);
  }

  function removeAbortWaiter(rejectFn) {
    abortWaiters.delete(rejectFn);
  }

  function notifyAbortWaiters(error) {
    for (const rejectFn of abortWaiters) {
      rejectFn(error);
    }
    abortWaiters.clear();
  }

  function addListener(event, handler) {
    cdpClient.on(event, handler);
    eventListeners.push({ event, handler });
  }

  function onLifecycleEvent({ frameId, name }) {
    if (!lifecycleEvents.has(frameId)) {
      lifecycleEvents.set(frameId, new Set());
    }
    lifecycleEvents.get(frameId).add(name);
    notifyWaiters(frameId, name);
  }

  function onFrameNavigated({ frame }) {
    if (!frame.parentId) {
      mainFrameId = frame.id;
    }
  }

  function onRequestStarted({ requestId, frameId }) {
    if (frameId && frameId !== mainFrameId) return;
    pendingRequests.add(requestId);
    networkRequestCount++;
    lastNetworkActivity = Date.now();
    resetNetworkIdleTimer();
  }

  function checkNetworkIdle() {
    if (pendingRequests.size === 0) {
      resetNetworkIdleTimer();
      networkIdleTimer = setTimeout(() => {
        notifyWaiters(mainFrameId, 'networkIdle');
        // Notify any direct network idle waiters
        for (const waiter of networkIdleWaiters) {
          waiter({ idle: true, pendingCount: 0, totalRequests: networkRequestCount });
        }
      }, networkIdleDelay);
    }
  }

  function onRequestFinished({ requestId }) {
    if (!pendingRequests.has(requestId)) return;
    pendingRequests.delete(requestId);
    lastNetworkActivity = Date.now();
    checkNetworkIdle();
  }

  /**
   * Wait for network to be idle (improvement #10)
   * Uses add/done counter for precise network quiet detection
   * @param {Object} [options] - Wait options
   * @param {number} [options.timeout=30000] - Timeout in ms
   * @param {number} [options.idleTime=500] - Time with no requests to consider idle
   * @returns {Promise<{idle: boolean, pendingCount: number, totalRequests: number}>}
   */
  function waitForNetworkQuiet(options = {}) {
    const { timeout = 30000, idleTime = networkIdleDelay } = options;

    return new Promise((resolve, reject) => {
      // Already idle?
      if (pendingRequests.size === 0) {
        const timeSinceActivity = Date.now() - lastNetworkActivity;
        if (timeSinceActivity >= idleTime) {
          resolve({ idle: true, pendingCount: 0, totalRequests: networkRequestCount });
          return;
        }
      }

      let resolved = false;
      let timeoutId = null;

      const waiter = (result) => {
        if (!resolved) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          networkIdleWaiters.delete(waiter);
          resolve(result);
        }
      };

      networkIdleWaiters.add(waiter);

      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          networkIdleWaiters.delete(waiter);
          reject(timeoutError(`Network did not become idle within ${timeout}ms (${pendingRequests.size} requests pending)`));
        }
      }, timeout);

      // Check periodically if we missed the idle event
      const checkInterval = setInterval(() => {
        if (resolved) {
          clearInterval(checkInterval);
          return;
        }
        if (pendingRequests.size === 0) {
          const timeSinceActivity = Date.now() - lastNetworkActivity;
          if (timeSinceActivity >= idleTime) {
            clearInterval(checkInterval);
            waiter({ idle: true, pendingCount: 0, totalRequests: networkRequestCount });
          }
        }
      }, 100);
    });
  }

  /**
   * Get current network status
   * @returns {{pendingCount: number, totalRequests: number, lastActivity: number}}
   */
  function getNetworkStatus() {
    return {
      pendingCount: pendingRequests.size,
      totalRequests: networkRequestCount,
      lastActivity: lastNetworkActivity,
      isIdle: pendingRequests.size === 0
    };
  }

  function onTargetCrashed() {
    pageCrashed = true;
    const error = pageCrashedError('Page crashed during operation');
    for (const rejectFn of crashWaiters) {
      rejectFn(error);
    }
    crashWaiters.clear();
  }

  function waitForLifecycleState(frameId, waitUntil, timeout) {
    return new Promise((resolve, reject) => {
      if (pageCrashed) {
        reject(pageCrashedError('Page crashed before navigation'));
        return;
      }

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(timeoutError(`Navigation timeout after ${timeout}ms waiting for '${waitUntil}'`));
      }, timeout);

      const crashReject = (error) => {
        cleanup();
        reject(error);
      };

      const abortReject = (error) => {
        cleanup();
        reject(error);
      };

      const checkCondition = () => {
        const events = lifecycleEvents.get(frameId) || new Set();

        switch (waitUntil) {
          case WaitCondition.COMMIT:
          case 'commit':
            return true;
          case WaitCondition.DOM_CONTENT_LOADED:
          case 'domcontentloaded':
            return events.has('DOMContentLoaded');
          case WaitCondition.LOAD:
          case 'load':
            return events.has('load');
          case WaitCondition.NETWORK_IDLE:
          case 'networkidle':
            return events.has('networkIdle') ||
                   (events.has('load') && pendingRequests.size === 0);
          default:
            return events.has('load');
        }
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        removeLifecycleWaiter(onUpdate);
        removeCrashWaiter(crashReject);
        removeAbortWaiter(abortReject);
      };

      const onUpdate = (updatedFrameId) => {
        if (updatedFrameId === frameId && checkCondition()) {
          cleanup();
          resolve();
        }
      };

      if (checkCondition()) {
        cleanup();
        resolve();
        return;
      }

      addLifecycleWaiter(onUpdate);
      addCrashWaiter(crashReject);
      addAbortWaiter(abortReject);
    });
  }

  async function navigateHistory(delta, waitUntil, timeout) {
    let history;
    try {
      history = await cdpClient.send('Page.getNavigationHistory');
    } catch (error) {
      throw connectionError(error.message, 'Page.getNavigationHistory');
    }

    const { currentIndex, entries } = history;
    const targetIndex = currentIndex + delta;

    if (targetIndex < 0 || targetIndex >= entries.length) {
      return null;
    }

    lifecycleEvents.set(mainFrameId, new Set());
    pendingRequests.clear();
    resetNetworkIdleTimer();

    const waitPromise = waitForLifecycleState(mainFrameId, waitUntil, timeout);

    try {
      await cdpClient.send('Page.navigateToHistoryEntry', {
        entryId: entries[targetIndex].id
      });
    } catch (error) {
      throw connectionError(error.message, 'Page.navigateToHistoryEntry');
    }

    await waitPromise;
    return entries[targetIndex];
  }

  async function initialize() {
    await Promise.all([
      cdpClient.send('Page.enable'),
      cdpClient.send('Page.setLifecycleEventsEnabled', { enabled: true }),
      cdpClient.send('Network.enable'),
      cdpClient.send('Runtime.enable'),
      cdpClient.send('Inspector.enable')
    ]);

    const { frameTree } = await cdpClient.send('Page.getFrameTree');
    mainFrameId = frameTree.frame.id;
    currentFrameId = mainFrameId;

    // Enable Runtime to track execution contexts for frames
    await cdpClient.send('Runtime.enable');

    // Track execution contexts for each frame
    addListener('Runtime.executionContextCreated', ({ context }) => {
      if (context.auxData && context.auxData.frameId) {
        frameExecutionContexts.set(context.auxData.frameId, context.id);
        if (context.auxData.frameId === mainFrameId) {
          currentExecutionContextId = context.id;
        }
      }
    });

    addListener('Runtime.executionContextDestroyed', ({ executionContextId }) => {
      for (const [frameId, contextId] of frameExecutionContexts) {
        if (contextId === executionContextId) {
          frameExecutionContexts.delete(frameId);
          break;
        }
      }
    });

    addListener('Page.lifecycleEvent', onLifecycleEvent);
    addListener('Page.frameNavigated', onFrameNavigated);
    addListener('Network.requestWillBeSent', onRequestStarted);
    addListener('Network.loadingFinished', onRequestFinished);
    addListener('Network.loadingFailed', onRequestFinished);
    addListener('Inspector.targetCrashed', onTargetCrashed);
  }

  async function navigate(url, options = {}) {
    if (!url || typeof url !== 'string') {
      throw navigationError('URL must be a non-empty string', url || '');
    }

    const {
      waitUntil = WaitCondition.LOAD,
      timeout = 30000,
      referrer
    } = options;

    const validatedTimeout = validateTimeout(timeout);

    if (navigationInProgress && currentNavigationAbort) {
      currentNavigationAbort('superseded by another navigation');
    }

    navigationInProgress = true;
    currentNavigationUrl = url;

    let abortReason = null;
    const abortController = {
      abort: (reason) => {
        abortReason = reason;
        notifyAbortWaiters(navigationAbortedError(reason, url));
      }
    };
    currentNavigationAbort = abortController.abort;

    try {
      lifecycleEvents.set(mainFrameId, new Set());
      pendingRequests.clear();
      resetNetworkIdleTimer();

      const waitPromise = waitForLifecycleState(mainFrameId, waitUntil, validatedTimeout);

      let response;
      try {
        response = await cdpClient.send('Page.navigate', { url, referrer });
      } catch (error) {
        throw navigationError(error.message, url);
      }

      if (response.errorText) {
        throw navigationError(response.errorText, url);
      }

      await waitPromise;

      if (abortReason) {
        throw navigationAbortedError(abortReason, url);
      }

      return {
        frameId: response.frameId,
        loaderId: response.loaderId,
        url
      };
    } finally {
      navigationInProgress = false;
      currentNavigationAbort = null;
      currentNavigationUrl = null;
    }
  }

  async function reload(options = {}) {
    const {
      ignoreCache = false,
      waitUntil = WaitCondition.LOAD,
      timeout = 30000
    } = options;

    const validatedTimeout = validateTimeout(timeout);

    lifecycleEvents.set(mainFrameId, new Set());
    pendingRequests.clear();
    resetNetworkIdleTimer();

    const waitPromise = waitForLifecycleState(mainFrameId, waitUntil, validatedTimeout);

    try {
      await cdpClient.send('Page.reload', { ignoreCache });
    } catch (error) {
      throw connectionError(error.message, 'Page.reload');
    }

    await waitPromise;
  }

  async function goBack(options = {}) {
    const { waitUntil = WaitCondition.LOAD, timeout = 30000 } = options;
    const validatedTimeout = validateTimeout(timeout);
    return navigateHistory(-1, waitUntil, validatedTimeout);
  }

  async function goForward(options = {}) {
    const { waitUntil = WaitCondition.LOAD, timeout = 30000 } = options;
    const validatedTimeout = validateTimeout(timeout);
    return navigateHistory(1, waitUntil, validatedTimeout);
  }

  async function stopLoading() {
    if (navigationInProgress && currentNavigationAbort) {
      currentNavigationAbort('loading was stopped');
    }

    try {
      await cdpClient.send('Page.stopLoading');
    } catch (error) {
      throw connectionError(error.message, 'Page.stopLoading');
    }
  }

  async function getUrl() {
    try {
      const result = await cdpClient.send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true
      });
      return result.result.value;
    } catch (error) {
      throw connectionError(error.message, 'Runtime.evaluate (getUrl)');
    }
  }

  async function getTitle() {
    try {
      const result = await cdpClient.send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true
      });
      return result.result.value;
    } catch (error) {
      throw connectionError(error.message, 'Runtime.evaluate (getTitle)');
    }
  }

  function dispose() {
    resetNetworkIdleTimer();

    for (const { event, handler } of eventListeners) {
      cdpClient.off(event, handler);
    }

    eventListeners.length = 0;
    lifecycleWaiters.clear();
    lifecycleEvents.clear();
    pendingRequests.clear();
    crashWaiters.clear();
    abortWaiters.clear();
  }

  /**
   * Set viewport size and device metrics
   * @param {string|Object} options - Device preset name or viewport options object
   * @param {number} [options.width] - Viewport width
   * @param {number} [options.height] - Viewport height
   * @param {number} [options.deviceScaleFactor=1] - Device scale factor (DPR)
   * @param {boolean} [options.mobile=false] - Mobile device emulation
   * @param {boolean} [options.hasTouch=false] - Touch events enabled
   * @param {boolean} [options.isLandscape=false] - Landscape orientation
   * @returns {Object} The resolved viewport configuration
   */
  async function setViewport(options) {
    // Resolve device preset if string provided
    const resolvedOptions = resolveViewport(options);

    const {
      width,
      height,
      deviceScaleFactor = 1,
      mobile = false,
      hasTouch = false,
      isLandscape = false
    } = resolvedOptions;

    if (!width || !height || width <= 0 || height <= 0) {
      throw new Error('Viewport requires positive width and height');
    }

    const screenOrientation = isLandscape
      ? { angle: 90, type: 'landscapePrimary' }
      : { angle: 0, type: 'portraitPrimary' };

    await cdpClient.send('Emulation.setDeviceMetricsOverride', {
      width: Math.floor(width),
      height: Math.floor(height),
      deviceScaleFactor,
      mobile,
      screenOrientation
    });

    if (hasTouch) {
      await cdpClient.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 5
      });
    }

    // Return the resolved viewport config for output
    return { width, height, deviceScaleFactor, mobile, hasTouch, isLandscape };
  }

  /**
   * Reset viewport to default (clears emulation overrides)
   */
  async function resetViewport() {
    await cdpClient.send('Emulation.clearDeviceMetricsOverride');
    await cdpClient.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }

  /**
   * Set geolocation
   * @param {Object} options - Geolocation options
   * @param {number} options.latitude - Latitude
   * @param {number} options.longitude - Longitude
   * @param {number} [options.accuracy=1] - Accuracy in meters
   */
  async function setGeolocation(options) {
    const { latitude, longitude, accuracy = 1 } = options;

    if (latitude < -90 || latitude > 90) {
      throw new Error('Latitude must be between -90 and 90');
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error('Longitude must be between -180 and 180');
    }

    await cdpClient.send('Emulation.setGeolocationOverride', {
      latitude,
      longitude,
      accuracy
    });
  }

  /**
   * Clear geolocation override
   */
  async function clearGeolocation() {
    await cdpClient.send('Emulation.clearGeolocationOverride');
  }

  /**
   * Get frame tree with all iframes
   * @returns {Promise<Object>} Frame tree
   */
  async function getFrameTree() {
    const { frameTree } = await cdpClient.send('Page.getFrameTree');

    function flattenFrames(node, depth = 0) {
      const frames = [{
        frameId: node.frame.id,
        url: node.frame.url,
        name: node.frame.name || null,
        parentId: node.frame.parentId || null,
        depth
      }];

      if (node.childFrames) {
        for (const child of node.childFrames) {
          frames.push(...flattenFrames(child, depth + 1));
        }
      }

      return frames;
    }

    return {
      mainFrameId,
      currentFrameId,
      frames: flattenFrames(frameTree)
    };
  }

  /**
   * Switch to an iframe by selector, index, or name
   * @param {Object|string|number} params - Frame identifier
   * @returns {Promise<Object>} Frame info
   */
  async function switchToFrame(params) {
    const { frameTree } = await cdpClient.send('Page.getFrameTree');

    function findAllFrames(node) {
      const frames = [node];
      if (node.childFrames) {
        for (const child of node.childFrames) {
          frames.push(...findAllFrames(child));
        }
      }
      return frames;
    }

    const allFrames = findAllFrames(frameTree);
    let targetFrame = null;

    if (typeof params === 'number') {
      // Switch by index (0-based, excluding main frame)
      const childFrames = allFrames.filter(f => f.frame.parentId);
      if (params >= 0 && params < childFrames.length) {
        targetFrame = childFrames[params];
      }
    } else if (typeof params === 'string') {
      // Switch by name or selector
      // First try to find by name
      targetFrame = allFrames.find(f => f.frame.name === params);

      // If not found by name, try as CSS selector
      if (!targetFrame) {
        const result = await cdpClient.send('Runtime.evaluate', {
          expression: `
            (function() {
              const iframe = document.querySelector(${JSON.stringify(params)});
              if (!iframe || iframe.tagName !== 'IFRAME') return null;
              return iframe.contentWindow ? 'found' : null;
            })()
          `,
          returnByValue: true
        });

        if (result.result.value === 'found') {
          // Get the frame ID by finding the iframe element and matching its src
          const srcResult = await cdpClient.send('Runtime.evaluate', {
            expression: `
              (function() {
                const iframe = document.querySelector(${JSON.stringify(params)});
                if (!iframe) return null;
                return {
                  src: iframe.src || iframe.getAttribute('src') || '',
                  name: iframe.name || iframe.id || ''
                };
              })()
            `,
            returnByValue: true
          });

          if (srcResult.result.value) {
            const { src, name } = srcResult.result.value;
            // Try to match by src or name
            targetFrame = allFrames.find(f =>
              (src && f.frame.url === src) ||
              (src && f.frame.url.endsWith(src)) ||
              (name && f.frame.name === name) ||
              f.frame.parentId // Fallback to first child frame if only one
            );

            // If still not found and there's only one child frame, use it
            if (!targetFrame) {
              const childFrames = allFrames.filter(f => f.frame.parentId);
              if (childFrames.length === 1) {
                targetFrame = childFrames[0];
              }
            }
          }
        }
      }
    } else if (typeof params === 'object') {
      // Object with selector, index, or name
      if (params.selector) {
        return switchToFrame(params.selector);
      } else if (typeof params.index === 'number') {
        return switchToFrame(params.index);
      } else if (params.name) {
        return switchToFrame(params.name);
      } else if (params.frameId) {
        targetFrame = allFrames.find(f => f.frame.id === params.frameId);
      }
    }

    if (!targetFrame) {
      throw new Error(`Frame not found: ${JSON.stringify(params)}`);
    }

    currentFrameId = targetFrame.frame.id;
    currentExecutionContextId = frameExecutionContexts.get(currentFrameId) || null;

    // If we don't have an execution context yet, create an isolated world
    if (!currentExecutionContextId) {
      const { executionContextId } = await cdpClient.send('Page.createIsolatedWorld', {
        frameId: currentFrameId,
        worldName: 'cdp-automation'
      });
      currentExecutionContextId = executionContextId;
      frameExecutionContexts.set(currentFrameId, executionContextId);
    }

    return {
      frameId: currentFrameId,
      url: targetFrame.frame.url,
      name: targetFrame.frame.name || null
    };
  }

  /**
   * Switch back to the main frame
   * @returns {Promise<Object>} Main frame info
   */
  async function switchToMainFrame() {
    currentFrameId = mainFrameId;
    currentExecutionContextId = frameExecutionContexts.get(mainFrameId) || null;

    const { frameTree } = await cdpClient.send('Page.getFrameTree');

    return {
      frameId: mainFrameId,
      url: frameTree.frame.url,
      name: frameTree.frame.name || null
    };
  }

  /**
   * Execute code in the current frame context
   * @param {string} expression - JavaScript expression
   * @param {Object} [options] - Options
   * @returns {Promise<any>} Result
   */
  async function evaluateInFrame(expression, options = {}) {
    const params = {
      expression,
      returnByValue: options.returnByValue !== false,
      awaitPromise: options.awaitPromise || false
    };

    // If we have an execution context for a non-main frame, use it
    if (currentFrameId !== mainFrameId && currentExecutionContextId) {
      params.contextId = currentExecutionContextId;
    }

    return cdpClient.send('Runtime.evaluate', params);
  }

  /**
   * Get current viewport dimensions
   * @returns {Promise<{width: number, height: number}>}
   */
  async function getViewport() {
    try {
      const result = await cdpClient.send('Runtime.evaluate', {
        expression: '({ width: window.innerWidth, height: window.innerHeight })',
        returnByValue: true
      });
      return result.result.value;
    } catch (error) {
      throw connectionError(error.message, 'Runtime.evaluate (getViewport)');
    }
  }

  /**
   * Two-step WaitEvent pattern (improvement #4)
   * Subscribe to navigation BEFORE triggering action to prevent race conditions
   * Inspired by Rod's event handling pattern
   *
   * Usage:
   *   const navPromise = controller.waitForNavigationEvent();
   *   await click(selector);
   *   await navPromise;
   *
   * @param {Object} [options] - Wait options
   * @param {string} [options.waitUntil='load'] - Lifecycle event to wait for
   * @param {number} [options.timeout=30000] - Timeout in ms
   * @returns {Promise<{url: string, navigated: boolean}>}
   */
  function waitForNavigationEvent(options = {}) {
    const { waitUntil = 'load', timeout = 30000 } = options;
    const validatedTimeout = validateTimeout(timeout);

    return new Promise((resolve, reject) => {
      let resolved = false;
      let frameNavigatedHandler = null;
      let lifecycleHandler = null;
      let timeoutId = null;
      let navigationStarted = false;
      let targetUrl = null;
      let targetFrameId = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (frameNavigatedHandler) {
          cdpClient.off('Page.frameNavigated', frameNavigatedHandler);
        }
        if (lifecycleHandler) {
          removeLifecycleWaiter(lifecycleHandler);
        }
      };

      const finish = (result) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(result);
        }
      };

      const fail = (error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(error);
        }
      };

      // Set up timeout
      timeoutId = setTimeout(() => {
        if (!navigationStarted) {
          // No navigation happened within timeout - this is OK, not an error
          finish({ navigated: false });
        } else {
          fail(timeoutError(`Navigation timed out after ${validatedTimeout}ms waiting for '${waitUntil}'`));
        }
      }, validatedTimeout);

      // Listen for frame navigation start
      frameNavigatedHandler = ({ frame }) => {
        if (!frame.parentId) {
          // Main frame navigation
          navigationStarted = true;
          targetUrl = frame.url;
          targetFrameId = frame.id;

          // For 'commit' wait condition, resolve immediately
          if (waitUntil === 'commit') {
            finish({ url: targetUrl, navigated: true });
          }
        }
      };
      cdpClient.on('Page.frameNavigated', frameNavigatedHandler);

      // Listen for lifecycle events
      lifecycleHandler = (frameId, eventName) => {
        if (!navigationStarted) return;
        if (frameId !== (targetFrameId || mainFrameId)) return;

        const events = lifecycleEvents.get(frameId) || new Set();

        if (waitUntil === 'domcontentloaded' && eventName === 'DOMContentLoaded') {
          finish({ url: targetUrl, navigated: true });
        } else if (waitUntil === 'load' && eventName === 'load') {
          finish({ url: targetUrl, navigated: true });
        } else if (waitUntil === 'networkidle' &&
                   (eventName === 'networkIdle' || (events.has('load') && pendingRequests.size === 0))) {
          finish({ url: targetUrl, navigated: true });
        }
      };
      addLifecycleWaiter(lifecycleHandler);

      // Also add crash handler
      addCrashWaiter(fail);
    });
  }

  /**
   * Convenience method: perform action and wait for navigation
   * Uses two-step pattern internally
   * @param {Function} action - Async action to perform (e.g., click)
   * @param {Object} [options] - Wait options
   * @returns {Promise<{actionResult: any, navigation: Object}>}
   */
  async function withNavigation(action, options = {}) {
    const navPromise = waitForNavigationEvent(options);
    const actionResult = await action();
    const navigation = await navPromise;
    return { actionResult, navigation };
  }

  return {
    initialize,
    navigate,
    reload,
    goBack,
    goForward,
    stopLoading,
    getUrl,
    getTitle,
    setViewport,
    resetViewport,
    getViewport,
    setGeolocation,
    clearGeolocation,
    getFrameTree,
    switchToFrame,
    switchToMainFrame,
    evaluateInFrame,
    waitForNavigationEvent,
    withNavigation,
    waitForNetworkQuiet,
    getNetworkStatus,
    dispose,
    get mainFrameId() { return mainFrameId; },
    get currentFrameId() { return currentFrameId; },
    get currentExecutionContextId() { return currentExecutionContextId; },
    get session() { return cdpClient; }
  };
}

// ============================================================================
// Wait Utilities
// ============================================================================

/**
 * Wait for a condition by polling
 * @param {Function} checkFn - Async function returning boolean
 * @param {Object} [options] - Wait options
 * @param {number} [options.timeout=30000] - Timeout in ms
 * @param {number} [options.pollInterval=100] - Poll interval in ms
 * @param {string} [options.message] - Custom timeout message
 * @returns {Promise<void>}
 */
export async function waitForCondition(checkFn, options = {}) {
  const {
    timeout = 30000,
    pollInterval = 100,
    message = 'Condition not met within timeout'
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await checkFn();
    if (result) return;
    await sleep(pollInterval);
  }

  throw timeoutError(`${message} (${timeout}ms)`);
}

/**
 * Wait for a JavaScript expression to be truthy
 * @param {Object} session - CDP session
 * @param {string} expression - JavaScript expression
 * @param {Object} [options] - Wait options
 * @returns {Promise<any>}
 */
export async function waitForFunction(session, expression, options = {}) {
  const {
    timeout = 30000,
    pollInterval = 100
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    let result;
    try {
      result = await session.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
    } catch (error) {
      if (isContextDestroyed(null, error)) {
        throw contextDestroyedError('Page navigated during waitForFunction');
      }
      throw error;
    }

    if (result.exceptionDetails) {
      if (isContextDestroyed(result.exceptionDetails)) {
        throw contextDestroyedError('Page navigated during waitForFunction');
      }
      await sleep(pollInterval);
      continue;
    }

    const value = result.result.value;
    if (value) return value;

    await sleep(pollInterval);
  }

  throw timeoutError(`Function did not return truthy within ${timeout}ms: ${expression}`);
}

/**
 * Wait for network to be idle
 * @param {Object} session - CDP session
 * @param {Object} [options] - Wait options
 * @returns {Promise<void>}
 */
export async function waitForNetworkIdle(session, options = {}) {
  const {
    timeout = 30000,
    idleTime = 500
  } = options;

  const pendingRequests = new Set();
  let idleTimer = null;
  let resolveIdle = null;
  let cleanupDone = false;

  const onRequestStarted = ({ requestId }) => {
    pendingRequests.add(requestId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const onRequestFinished = ({ requestId }) => {
    pendingRequests.delete(requestId);
    checkIdle();
  };

  const checkIdle = () => {
    if (pendingRequests.size === 0 && !idleTimer) {
      idleTimer = setTimeout(() => {
        if (resolveIdle) resolveIdle();
      }, idleTime);
    }
  };

  const cleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    session.off('Network.requestWillBeSent', onRequestStarted);
    session.off('Network.loadingFinished', onRequestFinished);
    session.off('Network.loadingFailed', onRequestFinished);
    if (idleTimer) clearTimeout(idleTimer);
  };

  session.on('Network.requestWillBeSent', onRequestStarted);
  session.on('Network.loadingFinished', onRequestFinished);
  session.on('Network.loadingFailed', onRequestFinished);

  return new Promise((resolve, reject) => {
    resolveIdle = () => {
      cleanup();
      resolve();
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(timeoutError(`Network did not become idle within ${timeout}ms`));
    }, timeout);

    checkIdle();

    const originalResolve = resolveIdle;
    resolveIdle = () => {
      clearTimeout(timeoutId);
      originalResolve();
    };
  });
}

/**
 * Wait for document.readyState to reach target state
 * @param {Object} session - CDP session
 * @param {string} [targetState='complete'] - Target state
 * @param {Object} [options] - Wait options
 * @returns {Promise<string>}
 */
export async function waitForDocumentReady(session, targetState = 'complete', options = {}) {
  const {
    timeout = 30000,
    pollInterval = 100
  } = options;

  const states = ['loading', 'interactive', 'complete'];
  const targetIndex = states.indexOf(targetState);

  if (targetIndex === -1) {
    throw new Error(`Invalid target state: ${targetState}`);
  }

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    let result;
    try {
      result = await session.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true
      });
    } catch (error) {
      if (isContextDestroyed(null, error)) {
        throw contextDestroyedError('Page navigated during waitForDocumentReady');
      }
      throw error;
    }

    if (result.exceptionDetails) {
      if (isContextDestroyed(result.exceptionDetails)) {
        throw contextDestroyedError('Page navigated during waitForDocumentReady');
      }
    }

    const currentState = result.result?.value;
    if (currentState) {
      const currentIndex = states.indexOf(currentState);
      if (currentIndex >= targetIndex) return currentState;
    }

    await sleep(pollInterval);
  }

  throw timeoutError(`Document did not reach '${targetState}' state within ${timeout}ms`);
}

/**
 * Wait for a selector to appear in the DOM
 * @param {Object} session - CDP session
 * @param {string} selector - CSS selector
 * @param {Object} [options] - Wait options
 * @returns {Promise<void>}
 */
export async function waitForSelector(session, selector, options = {}) {
  const {
    timeout = 30000,
    pollInterval = 100,
    visible = false
  } = options;

  const escapedSelector = selector.replace(/'/g, "\\'");

  let expression;
  if (visible) {
    expression = `(() => {
      const el = document.querySelector('${escapedSelector}');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' &&
             style.visibility !== 'hidden' &&
             style.opacity !== '0';
    })()`;
  } else {
    expression = `!!document.querySelector('${escapedSelector}')`;
  }

  await waitForFunction(session, expression, { timeout, pollInterval });
}

/**
 * Wait for text to appear in the page body
 * @param {Object} session - CDP session
 * @param {string} text - Text to find
 * @param {Object} [options] - Wait options
 * @returns {Promise<boolean>}
 */
export async function waitForText(session, text, options = {}) {
  const {
    timeout = 30000,
    pollInterval = 100,
    exact = false
  } = options;

  const textStr = String(text);
  const checkExpr = exact
    ? `document.body.innerText.includes(${JSON.stringify(textStr)})`
    : `document.body.innerText.toLowerCase().includes(${JSON.stringify(textStr.toLowerCase())})`;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    let result;
    try {
      result = await session.send('Runtime.evaluate', {
        expression: checkExpr,
        returnByValue: true
      });
    } catch (error) {
      if (isContextDestroyed(null, error)) {
        throw contextDestroyedError('Page navigated during waitForText');
      }
      throw error;
    }

    if (result.result.value === true) return true;

    await sleep(pollInterval);
  }

  throw timeoutError(`Timeout (${timeout}ms) waiting for text: "${textStr}"`);
}

// ============================================================================
// Cookie Management (from storage.js)
// ============================================================================

/**
 * Creates a cookie manager for getting, setting, and clearing cookies
 * @param {Object} session - CDP session
 * @returns {Object} Cookie manager interface
 */
export function createCookieManager(session) {
  /**
   * Get all cookies, optionally filtered by URLs
   * @param {string[]} urls - Optional URLs to filter cookies
   * @returns {Promise<Array>} Array of cookie objects
   */
  async function getCookies(urls = []) {
    const result = await session.send('Storage.getCookies', {});
    let cookies = result.cookies || [];

    // Filter by URLs if provided
    if (urls.length > 0) {
      cookies = cookies.filter(cookie => {
        return urls.some(url => {
          try {
            const parsed = new URL(url);
            // Domain matching
            const domainMatch = cookie.domain.startsWith('.')
              ? parsed.hostname.endsWith(cookie.domain.slice(1))
              : parsed.hostname === cookie.domain;
            // Path matching
            const pathMatch = parsed.pathname.startsWith(cookie.path);
            // Secure matching
            const secureMatch = !cookie.secure || parsed.protocol === 'https:';
            return domainMatch && pathMatch && secureMatch;
          } catch {
            return false;
          }
        });
      });
    }

    return cookies.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite || 'Lax'
    }));
  }

  /**
   * Set one or more cookies
   * @param {Array} cookies - Array of cookie objects to set
   */
  async function setCookies(cookies) {
    const processedCookies = cookies.map(cookie => {
      const processed = {
        name: cookie.name,
        value: cookie.value
      };

      // If URL provided, derive domain/path/secure from it
      if (cookie.url) {
        try {
          const parsed = new URL(cookie.url);
          processed.domain = cookie.domain || parsed.hostname;
          processed.path = cookie.path || '/';
          processed.secure = cookie.secure !== undefined ? cookie.secure : parsed.protocol === 'https:';
        } catch {
          throw new Error(`Invalid cookie URL: ${cookie.url}`);
        }
      } else {
        // Require domain and path if no URL
        if (!cookie.domain) {
          throw new Error('Cookie requires either url or domain');
        }
        processed.domain = cookie.domain;
        processed.path = cookie.path || '/';
        processed.secure = cookie.secure || false;
      }

      // Optional properties
      if (cookie.expires !== undefined) {
        processed.expires = cookie.expires;
      }
      if (cookie.httpOnly !== undefined) {
        processed.httpOnly = cookie.httpOnly;
      }
      if (cookie.sameSite) {
        processed.sameSite = cookie.sameSite;
      }

      return processed;
    });

    await session.send('Storage.setCookies', { cookies: processedCookies });
  }

  /**
   * Clear all cookies or cookies matching specific domains
   * @param {string[]} [urls] - Optional URLs to filter cookies by domain
   * @returns {Promise<{count: number}>} Number of cookies deleted
   */
  async function clearCookies(urls = []) {
    if (urls.length === 0) {
      // Clear all cookies
      const allCookies = await getCookies();
      const count = allCookies.length;
      await session.send('Storage.clearCookies', {});
      return { count };
    }

    // Get cookies matching the domains
    const cookiesToDelete = await getCookies(urls);
    let deletedCount = 0;

    for (const cookie of cookiesToDelete) {
      try {
        await session.send('Network.deleteCookies', {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path
        });
        deletedCount++;
      } catch {
        // Ignore individual deletion failures
      }
    }

    return { count: deletedCount };
  }

  /**
   * Delete specific cookies by name
   * @param {string|string[]} names - Cookie name(s) to delete
   * @param {Object} [options] - Optional filters
   * @param {string} [options.domain] - Limit deletion to specific domain
   * @param {string} [options.path] - Limit deletion to specific path
   * @returns {Promise<{count: number}>} Number of cookies deleted
   */
  async function deleteCookies(names, options = {}) {
    const nameList = Array.isArray(names) ? names : [names];
    const { domain, path } = options;
    let deletedCount = 0;

    // Get all cookies to find matching ones
    const allCookies = await getCookies();

    for (const cookie of allCookies) {
      if (!nameList.includes(cookie.name)) continue;
      if (domain && cookie.domain !== domain && !cookie.domain.endsWith(`.${domain}`)) continue;
      if (path && cookie.path !== path) continue;

      try {
        await session.send('Network.deleteCookies', {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path
        });
        deletedCount++;
      } catch {
        // Ignore individual deletion failures
      }
    }

    return { count: deletedCount };
  }

  return {
    getCookies,
    setCookies,
    clearCookies,
    deleteCookies
  };
}

// ============================================================================
// Web Storage Management (from storage.js)
// ============================================================================

/**
 * Creates a web storage manager for localStorage and sessionStorage
 * @param {Object} session - CDP session
 * @returns {Object} Web storage manager interface
 */
export function createWebStorageManager(session) {
  const STORAGE_SCRIPT = `
(function(storageType) {
  const storage = storageType === 'session' ? sessionStorage : localStorage;
  return Object.keys(storage).map(key => ({
    name: key,
    value: storage.getItem(key)
  }));
})
`;

  const SET_STORAGE_SCRIPT = `
(function(storageType, items) {
  const storage = storageType === 'session' ? sessionStorage : localStorage;
  for (const [key, value] of Object.entries(items)) {
    if (value === null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, value);
    }
  }
  return true;
})
`;

  const CLEAR_STORAGE_SCRIPT = `
(function(storageType) {
  const storage = storageType === 'session' ? sessionStorage : localStorage;
  storage.clear();
  return true;
})
`;

  /**
   * Get all items from localStorage or sessionStorage
   * @param {string} type - 'local' or 'session'
   * @returns {Promise<Array>} Array of {name, value} objects
   */
  async function getStorage(type = 'local') {
    const storageType = type === 'session' ? 'session' : 'local';
    const result = await session.send('Runtime.evaluate', {
      expression: `(${STORAGE_SCRIPT})('${storageType}')`,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      throw new Error(`Failed to get ${storageType}Storage: ${result.exceptionDetails.text}`);
    }

    return result.result.value || [];
  }

  /**
   * Set items in localStorage or sessionStorage
   * @param {Object} items - Object with key-value pairs (null value removes item)
   * @param {string} type - 'local' or 'session'
   */
  async function setStorage(items, type = 'local') {
    const storageType = type === 'session' ? 'session' : 'local';
    const result = await session.send('Runtime.evaluate', {
      expression: `(${SET_STORAGE_SCRIPT})('${storageType}', ${JSON.stringify(items)})`,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      throw new Error(`Failed to set ${storageType}Storage: ${result.exceptionDetails.text}`);
    }
  }

  /**
   * Clear all items from localStorage or sessionStorage
   * @param {string} type - 'local' or 'session'
   */
  async function clearStorage(type = 'local') {
    const storageType = type === 'session' ? 'session' : 'local';
    const result = await session.send('Runtime.evaluate', {
      expression: `(${CLEAR_STORAGE_SCRIPT})('${storageType}')`,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      throw new Error(`Failed to clear ${storageType}Storage: ${result.exceptionDetails.text}`);
    }
  }

  return {
    getStorage,
    setStorage,
    clearStorage
  };
}
