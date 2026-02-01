/**
 * Wait Utilities Module
 * Polling-based wait functions for various page conditions
 *
 * PUBLIC EXPORTS:
 * - waitForCondition(checkFn, options?) - Wait for arbitrary condition
 * - waitForFunction(session, expression, options?) - Wait for JS expression
 * - waitForNetworkIdle(session, options?) - Wait for network quiet
 * - waitForDocumentReady(session, targetState?, options?) - Wait for readyState
 * - waitForSelector(session, selector, options?) - Wait for element
 * - waitForText(session, text, options?) - Wait for text in page
 *
 * @module cdp-skill/page/wait-utilities
 */

import {
  timeoutError,
  contextDestroyedError,
  isContextDestroyed,
  sleep
} from '../utils.js';

/**
 * Wait for a condition by polling
 * @param {function(): Promise<boolean>} checkFn - Async function returning boolean
 * @param {import('../types.js').WaitOptions} [options] - Wait options
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
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {string} expression - JavaScript expression
 * @param {import('../types.js').WaitOptions} [options] - Wait options
 * @returns {Promise<*>} The truthy result value
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
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {Object} [options] - Wait options
 * @param {number} [options.timeout=30000] - Timeout in ms
 * @param {number} [options.idleTime=500] - Time with no requests to be idle
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
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {string} [targetState='complete'] - Target state: 'loading', 'interactive', 'complete'
 * @param {import('../types.js').WaitOptions} [options] - Wait options
 * @returns {Promise<string>} The reached state
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
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {string} selector - CSS selector
 * @param {Object} [options] - Wait options
 * @param {number} [options.timeout=30000] - Timeout in ms
 * @param {number} [options.pollInterval=100] - Poll interval in ms
 * @param {boolean} [options.visible=false] - Wait for element to be visible
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
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {string} text - Text to find
 * @param {Object} [options] - Wait options
 * @param {number} [options.timeout=30000] - Timeout in ms
 * @param {number} [options.pollInterval=100] - Poll interval in ms
 * @param {boolean} [options.exact=false] - Case-sensitive match
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
