/**
 * Page Controller Module
 * Navigation, lifecycle events, viewport, geolocation, and frame management
 *
 * PUBLIC EXPORTS:
 * - WaitCondition - Enum of wait conditions (LOAD, DOM_CONTENT_LOADED, etc.)
 * - createPageController(cdpClient) - Factory for page controller
 *
 * @module cdp-skill/page/page-controller
 */

import {
  navigationError,
  navigationAbortedError,
  timeoutError,
  connectionError,
  pageCrashedError,
  contextDestroyedError,
  resolveViewport,
  sleep
} from '../utils.js';

import { TIMEOUTS } from '../constants.js';
import { createDialogHandler } from './dialog-handler.js';

const MAX_TIMEOUT = TIMEOUTS.MAX;

/**
 * Wait conditions for page navigation
 * @readonly
 * @enum {string}
 */
export const WaitCondition = Object.freeze({
  LOAD: 'load',
  DOM_CONTENT_LOADED: 'domcontentloaded',
  NETWORK_IDLE: 'networkidle',
  COMMIT: 'commit'
});

/**
 * Create a page controller for navigation and lifecycle events
 * @param {import('../types.js').CDPSession} cdpClient - CDP client with send/on/off methods
 * @param {Object} [options] - Options
 * @param {function(Object): void} [options.onFrameChanged] - Called when frame context changes (for persistence)
 * @param {function(): Object|null} [options.getSavedFrameState] - Returns saved frame state (for restoration)
 * @returns {Object} Page controller interface
 */
export function createPageController(cdpClient, options = {}) {
  const { onFrameChanged, getSavedFrameState } = options;
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
  const dialogHandler = createDialogHandler(cdpClient);
  let currentNavigationUrl = null;
  let pageCrashed = false;
  const crashWaiters = new Set();
  const abortWaiters = new Set();

  // Network idle counter (improvement #10)
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

  function onRequestStarted({ requestId }) {
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
   * Wait for network to be idle
   * @param {Object} [options] - Wait options
   * @param {number} [options.timeout=30000] - Timeout in ms
   * @param {number} [options.idleTime=500] - Time with no requests to consider idle
   * @returns {Promise<{idle: boolean, pendingCount: number, totalRequests: number}>}
   */
  function waitForNetworkQuiet(options = {}) {
    const { timeout = 30000, idleTime = networkIdleDelay } = options;

    return new Promise((resolve, reject) => {
      if (pendingRequests.size === 0) {
        const timeSinceActivity = Date.now() - lastNetworkActivity;
        if (timeSinceActivity >= idleTime) {
          resolve({ idle: true, pendingCount: 0, totalRequests: networkRequestCount });
          return;
        }
      }

      let resolved = false;
      let timeoutId = null;
      let checkInterval = null;

      const waiter = (result) => {
        if (!resolved) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          if (checkInterval) clearInterval(checkInterval);
          networkIdleWaiters.delete(waiter);
          resolve(result);
        }
      };

      networkIdleWaiters.add(waiter);

      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (checkInterval) clearInterval(checkInterval);
          networkIdleWaiters.delete(waiter);
          reject(timeoutError(`Network did not become idle within ${timeout}ms (${pendingRequests.size} requests pending)`));
        }
      }, timeout);

      checkInterval = setInterval(() => {
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
   * Best-effort network settle — waits briefly for network to quiet down.
   * Unlike waitForNetworkQuiet, this NEVER throws on timeout. It resolves
   * silently so callers (snapshot, post-navigation) don't fail on sites
   * with persistent connections or long-polling.
   *
   * @param {Object} [options]
   * @param {number} [options.timeout=2000] - Max time to wait
   * @param {number} [options.idleTime=300] - Idle window to consider settled
   * @returns {Promise<{settled: boolean, pendingCount: number}>}
   */
  function waitForNetworkSettle(options = {}) {
    const { timeout = 2000, idleTime = 300 } = options;

    return new Promise((resolve) => {
      // Already idle long enough?
      if (pendingRequests.size === 0 && (Date.now() - lastNetworkActivity) >= idleTime) {
        resolve({ settled: true, pendingCount: 0 });
        return;
      }

      let resolved = false;
      let timeoutId = null;
      let checkInterval = null;

      const finish = (settled) => {
        if (resolved) return;
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (checkInterval) clearInterval(checkInterval);
        networkIdleWaiters.delete(waiter);
        resolve({ settled, pendingCount: pendingRequests.size });
      };

      const waiter = () => finish(true);
      networkIdleWaiters.add(waiter);

      timeoutId = setTimeout(() => finish(false), timeout);

      checkInterval = setInterval(() => {
        if (resolved) { clearInterval(checkInterval); return; }
        if (pendingRequests.size === 0 && (Date.now() - lastNetworkActivity) >= idleTime) {
          finish(true);
        }
      }, 50);
    });
  }

  /**
   * Get current network status
   * @returns {{pendingCount: number, totalRequests: number, lastActivity: number, isIdle: boolean}}
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

  /**
   * Initialize the page controller
   * Enables required CDP domains and sets up event listeners
   * @returns {Promise<void>}
   */
  async function initialize() {
    await Promise.all([
      cdpClient.send('Page.enable'),
      cdpClient.send('Page.setLifecycleEventsEnabled', { enabled: true }),
      cdpClient.send('Network.enable'),
      cdpClient.send('Runtime.enable'),
      cdpClient.send('Inspector.enable')
    ]);

    // Enable dialog handling for JavaScript alerts, confirms, and prompts
    await dialogHandler.enable();

    const { frameTree } = await cdpClient.send('Page.getFrameTree');
    mainFrameId = frameTree.frame.id;
    currentFrameId = mainFrameId;

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

    addListener('Runtime.executionContextsCleared', () => {
      frameExecutionContexts.clear();
      currentExecutionContextId = null;
    });

    addListener('Page.lifecycleEvent', onLifecycleEvent);
    addListener('Page.frameNavigated', onFrameNavigated);
    addListener('Network.requestWillBeSent', onRequestStarted);
    addListener('Network.loadingFinished', onRequestFinished);
    addListener('Network.loadingFailed', onRequestFinished);
    addListener('Inspector.targetCrashed', onTargetCrashed);

    // Restore persisted frame context from a previous CLI invocation
    if (getSavedFrameState) {
      const saved = getSavedFrameState();
      if (saved && saved.frameId && saved.frameId !== mainFrameId) {
        // Verify the saved frame still exists in the frame tree
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
        const savedFrame = allFrames.find(f => f.frame.id === saved.frameId);

        if (savedFrame) {
          currentFrameId = saved.frameId;
          // Try to use the saved contextId if it's still in our context map
          const knownContextId = frameExecutionContexts.get(saved.frameId);
          if (knownContextId) {
            currentExecutionContextId = knownContextId;
          } else {
            // Create a fresh isolated world for this frame
            try {
              const { executionContextId } = await cdpClient.send('Page.createIsolatedWorld', {
                frameId: saved.frameId,
                worldName: 'cdp-automation'
              });
              currentExecutionContextId = executionContextId;
              frameExecutionContexts.set(saved.frameId, executionContextId);
            } catch {
              // Frame context restoration failed — fall back to main frame
              currentFrameId = mainFrameId;
              currentExecutionContextId = frameExecutionContexts.get(mainFrameId) || null;
              if (onFrameChanged) {
                onFrameChanged({ frameId: null, contextId: null });
              }
            }
          }
        } else {
          // Frame no longer exists — clear stale state
          if (onFrameChanged) {
            onFrameChanged({ frameId: null, contextId: null });
          }
        }
      }
    }
  }

  /**
   * Navigate to a URL
   * @param {string} url - URL to navigate to
   * @param {import('../types.js').NavigationOptions} [options] - Navigation options
   * @returns {Promise<import('../types.js').NavigationResult>}
   */
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

      // Note: if abort happened during waitPromise, abortWaiters already rejected it.
      // We don't re-check abortReason here to avoid rejecting a successfully completed navigation.

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

  /**
   * Reload the current page
   * @param {Object} [options] - Reload options
   * @param {boolean} [options.ignoreCache=false] - Bypass cache
   * @param {string} [options.waitUntil='load'] - Wait condition
   * @param {number} [options.timeout=30000] - Timeout in ms
   * @returns {Promise<void>}
   */
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

  /**
   * Go back in history
   * @param {Object} [options] - Navigation options
   * @returns {Promise<Object|null>} History entry or null if at start
   */
  async function goBack(options = {}) {
    // Use 'commit' by default for history navigation - cached pages may not fire 'load' event
    const { waitUntil = WaitCondition.COMMIT, timeout = 5000 } = options;
    const validatedTimeout = validateTimeout(timeout);
    return navigateHistory(-1, waitUntil, validatedTimeout);
  }

  /**
   * Go forward in history
   * @param {Object} [options] - Navigation options
   * @returns {Promise<Object|null>} History entry or null if at end
   */
  async function goForward(options = {}) {
    // Use 'commit' by default for history navigation - cached pages may not fire 'load' event
    const { waitUntil = WaitCondition.COMMIT, timeout = 5000 } = options;
    const validatedTimeout = validateTimeout(timeout);
    return navigateHistory(1, waitUntil, validatedTimeout);
  }

  /**
   * Stop loading the page
   * @returns {Promise<void>}
   */
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

  /**
   * Get the current URL
   * @returns {Promise<string>}
   */
  async function getUrl() {
    try {
      const result = await evaluateInFrame('window.location.href');
      return result.result.value;
    } catch (error) {
      throw connectionError(error.message, 'Runtime.evaluate (getUrl)');
    }
  }

  /**
   * Get the page title
   * @returns {Promise<string>}
   */
  async function getTitle() {
    try {
      const result = await evaluateInFrame('document.title');
      return result.result.value;
    } catch (error) {
      throw connectionError(error.message, 'Runtime.evaluate (getTitle)');
    }
  }

  /**
   * Dispose the page controller
   * Removes all event listeners and clears state
   */
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
    networkIdleWaiters.clear();
  }

  /**
   * Set viewport size and device metrics
   * @param {string|import('../types.js').ViewportConfig} options - Device preset name or viewport options
   * @returns {Promise<import('../types.js').ViewportConfig>} Resolved viewport config
   */
  async function setViewport(options) {
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

    return { width, height, deviceScaleFactor, mobile, hasTouch, isLandscape };
  }

  /**
   * Reset viewport to default (clears emulation overrides)
   * @returns {Promise<void>}
   */
  async function resetViewport() {
    await cdpClient.send('Emulation.clearDeviceMetricsOverride');
    await cdpClient.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }

  /**
   * Set geolocation
   * @param {Object} options - Geolocation options
   * @param {number} options.latitude - Latitude (-90 to 90)
   * @param {number} options.longitude - Longitude (-180 to 180)
   * @param {number} [options.accuracy=1] - Accuracy in meters
   * @returns {Promise<void>}
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
   * @returns {Promise<void>}
   */
  async function clearGeolocation() {
    await cdpClient.send('Emulation.clearGeolocationOverride');
  }

  /**
   * Get frame tree with all iframes, including cross-origin ones.
   *
   * Page.getFrameTree only returns same-origin frames. Cross-origin iframes
   * live in separate renderer processes and are invisible to that API.
   * We supplement the CDP tree by querying the DOM for all <iframe> elements
   * and merging any that aren't already represented.
   *
   * @returns {Promise<{mainFrameId: string, currentFrameId: string, frames: Array}>}
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

    const frames = flattenFrames(frameTree);

    // Discover cross-origin iframes via DOM query
    try {
      const domResult = await cdpClient.send('Runtime.evaluate', {
        expression: `
          (function() {
            const iframes = document.querySelectorAll('iframe');
            return Array.from(iframes).map(function(el, i) {
              var src = el.src || el.getAttribute('src') || '';
              var name = el.name || el.id || '';
              var crossOrigin = false;
              try { var _d = el.contentDocument; } catch(e) { crossOrigin = true; }
              if (!el.contentDocument) crossOrigin = true;
              return { index: i, src: src, name: name, crossOrigin: crossOrigin };
            });
          })()
        `,
        returnByValue: true
      });

      const domIframes = domResult.result?.value;
      if (Array.isArray(domIframes)) {
        for (const iframe of domIframes) {
          if (!iframe.crossOrigin) continue;

          // Check if this iframe is already in the CDP frame tree
          const alreadyListed = frames.some(f =>
            f.parentId && (
              (iframe.src && f.url === iframe.src) ||
              (iframe.name && f.name === iframe.name)
            )
          );

          if (!alreadyListed) {
            frames.push({
              frameId: `cross-origin-${iframe.index}`,
              url: iframe.src || 'about:blank',
              name: iframe.name || null,
              parentId: mainFrameId,
              depth: 1,
              crossOrigin: true
            });
          }
        }
      }
    } catch {
      // DOM query failed — return CDP-only tree
    }

    return {
      mainFrameId,
      currentFrameId,
      frames
    };
  }

  /**
   * Switch to an iframe by selector, index, or name
   * @param {Object|string|number} params - Frame identifier
   * @returns {Promise<{frameId: string, url: string, name: string|null, crossOrigin?: boolean, warning?: string}>}
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
      const childFrames = allFrames.filter(f => f.frame.parentId);
      if (params >= 0 && params < childFrames.length) {
        targetFrame = childFrames[params];
      }
    } else if (typeof params === 'string') {
      targetFrame = allFrames.find(f => f.frame.name === params);

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
            targetFrame = allFrames.find(f =>
              f.frame.parentId && (
                (src && f.frame.url === src) ||
                (src && f.frame.url.endsWith(src)) ||
                (name && f.frame.name === name)
              )
            );

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

    if (!currentExecutionContextId) {
      const { executionContextId } = await cdpClient.send('Page.createIsolatedWorld', {
        frameId: currentFrameId,
        worldName: 'cdp-automation'
      });
      currentExecutionContextId = executionContextId;
      frameExecutionContexts.set(currentFrameId, executionContextId);
    }

    const mainFrameUrl = allFrames[0].frame.url;
    const frameUrl = targetFrame.frame.url;

    let crossOrigin = false;
    let warning = null;
    try {
      const mainOrigin = new URL(mainFrameUrl).origin;
      const frameOrigin = new URL(frameUrl).origin;
      if (mainOrigin !== frameOrigin) {
        crossOrigin = true;
        warning = `Cross-origin iframe detected (${frameOrigin}). Due to browser security restrictions, JavaScript cannot access the iframe's DOM. Actions targeting elements inside this frame will not work.`;
      }
    } catch {
      // URL parsing failed, assume same origin
    }

    const result = {
      frameId: currentFrameId,
      url: targetFrame.frame.url,
      name: targetFrame.frame.name || null
    };

    if (crossOrigin) {
      result.crossOrigin = true;
      result.warning = warning;
    }

    // Persist frame state across CLI invocations
    if (onFrameChanged) {
      onFrameChanged({ frameId: currentFrameId, contextId: currentExecutionContextId });
    }

    return result;
  }

  /**
   * Switch back to the main frame
   * @returns {Promise<{frameId: string, url: string, name: string|null}>}
   */
  async function switchToMainFrame() {
    currentFrameId = mainFrameId;
    currentExecutionContextId = frameExecutionContexts.get(mainFrameId) || null;

    // Clear persisted frame state (back to main)
    if (onFrameChanged) {
      onFrameChanged({ frameId: null, contextId: null });
    }

    const { frameTree } = await cdpClient.send('Page.getFrameTree');

    return {
      frameId: mainFrameId,
      url: frameTree.frame.url,
      name: frameTree.frame.name || null
    };
  }

  /**
   * Get the current frame execution context ID (if in a non-main frame).
   * Used for dependency injection into modules that need frame-aware evaluation.
   * @returns {number|null} contextId for current frame, or null if in main frame
   */
  function getFrameContext() {
    if (currentFrameId !== mainFrameId && currentExecutionContextId) {
      return currentExecutionContextId;
    }
    return null;
  }

  /**
   * Get the current frame identifier for ref generation.
   * Returns 'f0' for main frame, 'f1', 'f2', etc. for iframes by index.
   * Uses frame name if available for better stability.
   * @returns {Promise<string>} Frame identifier (e.g., 'f0', 'f1', 'f[frame-name]')
   */
  async function getFrameIdentifier() {
    // Main frame is always f0
    if (currentFrameId === mainFrameId || !currentFrameId) {
      return 'f0';
    }

    // Get frame tree to find index or name
    const { frameTree } = await cdpClient.send('Page.getFrameTree');

    function findAllChildFrames(node) {
      const frames = [];
      if (node.childFrames) {
        for (const child of node.childFrames) {
          frames.push(child);
          frames.push(...findAllChildFrames(child));
        }
      }
      return frames;
    }

    const childFrames = findAllChildFrames(frameTree);

    // Find current frame
    for (let i = 0; i < childFrames.length; i++) {
      if (childFrames[i].frame.id === currentFrameId) {
        // Prefer name if available (more stable than index)
        const frameName = childFrames[i].frame.name;
        if (frameName) {
          return `f[${frameName}]`;
        }
        // Fall back to index (1-based for iframes)
        return `f${i + 1}`;
      }
    }

    // Fallback: unknown frame, use hash of frameId
    return `f[${currentFrameId.substring(0, 8)}]`;
  }

  /**
   * Execute code in the current frame context
   * @param {string} expression - JavaScript expression
   * @param {Object} [options] - Evaluation options
   * @param {boolean} [options.returnByValue=true] - Return value by value
   * @param {boolean} [options.awaitPromise=false] - Await promise results
   * @returns {Promise<Object>} CDP evaluation result
   */
  async function evaluateInFrame(expression, options = {}) {
    const params = {
      expression,
      returnByValue: options.returnByValue !== false,
      awaitPromise: options.awaitPromise || false
    };

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
      const result = await evaluateInFrame('({ width: window.innerWidth, height: window.innerHeight })');
      return result.result.value;
    } catch (error) {
      throw connectionError(error.message, 'Runtime.evaluate (getViewport)');
    }
  }

  /**
   * Two-step WaitEvent pattern
   * Subscribe to navigation BEFORE triggering action to prevent race conditions
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
        removeCrashWaiter(fail);
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

      timeoutId = setTimeout(() => {
        if (!navigationStarted) {
          finish({ navigated: false });
        } else {
          fail(timeoutError(`Navigation timed out after ${validatedTimeout}ms waiting for '${waitUntil}'`));
        }
      }, validatedTimeout);

      frameNavigatedHandler = ({ frame }) => {
        if (!frame.parentId) {
          navigationStarted = true;
          targetUrl = frame.url;
          targetFrameId = frame.id;

          if (waitUntil === 'commit') {
            finish({ url: targetUrl, navigated: true });
          }
        }
      };
      cdpClient.on('Page.frameNavigated', frameNavigatedHandler);

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

      addCrashWaiter(fail);
    });
  }

  /**
   * Perform action and wait for navigation
   * @param {function(): Promise<*>} action - Async action to perform
   * @param {Object} [options] - Wait options
   * @returns {Promise<{actionResult: *, navigation: Object}>}
   */
  async function withNavigation(action, options = {}) {
    const navPromise = waitForNavigationEvent(options);
    const actionResult = await action();
    const navigation = await navPromise;
    return { actionResult, navigation };
  }

  /**
   * Search for an element across all frames
   * @param {string} selector - CSS selector
   * @param {Object} elementLocator - Element locator instance
   * @returns {Promise<{found: boolean, frameId: string|null, objectId: string|null, frameUrl: string|null, handle: Object|null}>}
   */
  async function searchAllFrames(selector, elementLocator) {
    const originalFrameId = currentFrameId;
    const originalContextId = currentExecutionContextId;

    try {
      try {
        const result = await elementLocator.findElement(selector);
        if (result && result._handle) {
          return {
            found: true,
            frameId: currentFrameId,
            objectId: result._handle.objectId,
            frameUrl: null,
            handle: result._handle
          };
        }
      } catch {
        // Element not found in main frame
      }

      const { frameTree } = await cdpClient.send('Page.getFrameTree');

      function collectFrames(node, frames = []) {
        if (node.childFrames) {
          for (const child of node.childFrames) {
            frames.push(child);
            collectFrames(child, frames);
          }
        }
        return frames;
      }

      const childFrames = collectFrames(frameTree);

      for (const frameNode of childFrames) {
        const frameId = frameNode.frame.id;

        try {
          let contextId = frameExecutionContexts.get(frameId);

          if (!contextId) {
            try {
              const { executionContextId } = await cdpClient.send('Page.createIsolatedWorld', {
                frameId,
                worldName: 'cdp-automation'
              });
              contextId = executionContextId;
              frameExecutionContexts.set(frameId, contextId);
            } catch {
              continue;
            }
          }

          const evalResult = await cdpClient.send('Runtime.evaluate', {
            expression: `document.querySelector(${JSON.stringify(selector)})`,
            contextId,
            returnByValue: false
          });

          if (evalResult.result && evalResult.result.objectId && evalResult.result.subtype !== 'null') {
            return {
              found: true,
              frameId,
              objectId: evalResult.result.objectId,
              frameUrl: frameNode.frame.url,
              handle: null
            };
          }
        } catch (err) {
          if (err && err.message && err.message.includes('context')) {
            frameExecutionContexts.delete(frameId);
          }
        }
      }

      return {
        found: false,
        frameId: null,
        objectId: null,
        frameUrl: null,
        handle: null
      };
    } finally {
      currentFrameId = originalFrameId;
      currentExecutionContextId = originalContextId;
    }
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
    waitForNetworkSettle,
    getNetworkStatus,
    searchAllFrames,
    getFrameContext,
    getFrameIdentifier,
    dispose,
    get mainFrameId() { return mainFrameId; },
    get currentFrameId() { return currentFrameId; },
    get currentExecutionContextId() { return currentExecutionContextId; },
    get session() { return cdpClient; }
  };
}
