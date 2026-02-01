/**
 * Wait Executor
 * Wait operations for selectors, text, visibility, and timing
 *
 * EXPORTS:
 * - createWaitExecutor(session, elementLocator) → WaitExecutor
 *   Methods: execute, waitForSelector, waitForHidden, waitForCount,
 *            waitForText, waitForTextRegex, waitForUrlContains, waitForTime
 *
 * DEPENDENCIES:
 * - ../constants.js: TIMEOUTS, POLL_INTERVALS
 * - ../utils.js: sleep, timeoutError
 */

import { TIMEOUTS, POLL_INTERVALS } from '../constants.js';
import { sleep, timeoutError } from '../utils.js';

const DEFAULT_TIMEOUT = TIMEOUTS.DEFAULT;
const MAX_TIMEOUT = TIMEOUTS.MAX;
const POLL_INTERVAL = POLL_INTERVALS.DEFAULT;

/**
 * Create a wait executor for handling wait operations
 * @param {Object} session - CDP session
 * @param {Object} elementLocator - Element locator instance
 * @returns {Object} Wait executor interface
 */
export function createWaitExecutor(session, elementLocator) {
  if (!session) throw new Error('CDP session is required');
  if (!elementLocator) throw new Error('Element locator is required');

  function validateTimeout(timeout) {
    if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
      return DEFAULT_TIMEOUT;
    }
    if (timeout < 0) return 0;
    if (timeout > MAX_TIMEOUT) return MAX_TIMEOUT;
    return timeout;
  }

  /**
   * Wait for selector using browser-side MutationObserver
   * Much faster than Node.js polling as it avoids network round-trips
   */
  async function waitForSelector(selector, timeout = DEFAULT_TIMEOUT) {
    const validatedTimeout = validateTimeout(timeout);

    try {
      // Use browser-side polling with MutationObserver for better performance
      const result = await session.send('Runtime.evaluate', {
        expression: `
          new Promise((resolve, reject) => {
            const selector = ${JSON.stringify(selector)};
            const timeout = ${validatedTimeout};

            // Check if element already exists
            const existing = document.querySelector(selector);
            if (existing) {
              resolve({ found: true, immediate: true });
              return;
            }

            let resolved = false;
            const timeoutId = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                observer.disconnect();
                reject(new Error('Timeout waiting for selector: ' + selector));
              }
            }, timeout);

            const observer = new MutationObserver((mutations, obs) => {
              const el = document.querySelector(selector);
              if (el && !resolved) {
                resolved = true;
                obs.disconnect();
                clearTimeout(timeoutId);
                resolve({ found: true, mutations: mutations.length });
              }
            });

            observer.observe(document.documentElement || document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['class', 'id', 'style', 'hidden']
            });

            // Also check with RAF as a fallback
            const checkWithRAF = () => {
              if (resolved) return;
              const el = document.querySelector(selector);
              if (el) {
                resolved = true;
                observer.disconnect();
                clearTimeout(timeoutId);
                resolve({ found: true, raf: true });
                return;
              }
              requestAnimationFrame(checkWithRAF);
            };
            requestAnimationFrame(checkWithRAF);
          })
        `,
        awaitPromise: true,
        returnByValue: true
      });

      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }

      return result.result.value;
    } catch (error) {
      // Fall back to original Node.js polling if browser-side fails
      const element = await elementLocator.waitForSelector(selector, {
        timeout: validatedTimeout
      });
      if (element) await element.dispose();
    }
  }

  async function checkElementHidden(selector) {
    try {
      const result = await session.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return true;
            const style = window.getComputedStyle(el);
            if (style.display === 'none') return true;
            if (style.visibility === 'hidden') return true;
            if (style.opacity === '0') return true;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return true;
            return false;
          })()
        `,
        returnByValue: true
      });
      return result.result.value === true;
    } catch {
      return true;
    }
  }

  async function waitForHidden(selector, timeout = DEFAULT_TIMEOUT) {
    const validatedTimeout = validateTimeout(timeout);
    const startTime = Date.now();

    while (Date.now() - startTime < validatedTimeout) {
      const isHidden = await checkElementHidden(selector);
      if (isHidden) return;
      await sleep(POLL_INTERVAL);
    }

    throw timeoutError(
      `Timeout (${validatedTimeout}ms) waiting for element to disappear: "${selector}"`
    );
  }

  async function getElementCount(selector) {
    try {
      const result = await session.send('Runtime.evaluate', {
        expression: `document.querySelectorAll(${JSON.stringify(selector)}).length`,
        returnByValue: true
      });
      return result.result.value || 0;
    } catch {
      return 0;
    }
  }

  async function waitForCount(selector, minCount, timeout = DEFAULT_TIMEOUT) {
    if (typeof minCount !== 'number' || minCount < 0) {
      throw new Error('minCount must be a non-negative number');
    }

    const validatedTimeout = validateTimeout(timeout);
    const startTime = Date.now();

    while (Date.now() - startTime < validatedTimeout) {
      const count = await getElementCount(selector);
      if (count >= minCount) return;
      await sleep(POLL_INTERVAL);
    }

    const finalCount = await getElementCount(selector);
    throw timeoutError(
      `Timeout (${validatedTimeout}ms) waiting for ${minCount} elements matching "${selector}" (found ${finalCount})`
    );
  }

  /**
   * Wait for text using browser-side MutationObserver
   */
  async function waitForText(text, opts = {}) {
    const { timeout = DEFAULT_TIMEOUT, caseSensitive = false } = opts;
    const validatedTimeout = validateTimeout(timeout);

    try {
      // Use browser-side polling with MutationObserver
      const result = await session.send('Runtime.evaluate', {
        expression: `
          new Promise((resolve, reject) => {
            const searchText = ${JSON.stringify(text)};
            const caseSensitive = ${caseSensitive};
            const timeout = ${validatedTimeout};

            const checkText = () => {
              const bodyText = document.body ? document.body.innerText : '';
              if (caseSensitive) {
                return bodyText.includes(searchText);
              }
              return bodyText.toLowerCase().includes(searchText.toLowerCase());
            };

            // Check if text already exists
            if (checkText()) {
              resolve({ found: true, immediate: true });
              return;
            }

            let resolved = false;
            const timeoutId = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                observer.disconnect();
                reject(new Error('Timeout waiting for text: ' + searchText));
              }
            }, timeout);

            const observer = new MutationObserver((mutations, obs) => {
              if (!resolved && checkText()) {
                resolved = true;
                obs.disconnect();
                clearTimeout(timeoutId);
                resolve({ found: true, mutations: mutations.length });
              }
            });

            observer.observe(document.documentElement || document.body, {
              childList: true,
              subtree: true,
              characterData: true
            });

            // Also check with RAF as a fallback
            const checkWithRAF = () => {
              if (resolved) return;
              if (checkText()) {
                resolved = true;
                observer.disconnect();
                clearTimeout(timeoutId);
                resolve({ found: true, raf: true });
                return;
              }
              requestAnimationFrame(checkWithRAF);
            };
            requestAnimationFrame(checkWithRAF);
          })
        `,
        awaitPromise: true,
        returnByValue: true
      });

      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }

      return result.result.value;
    } catch (error) {
      // Fall back to original Node.js polling
      const startTime = Date.now();
      const checkExpr = caseSensitive
        ? `document.body.innerText.includes(${JSON.stringify(text)})`
        : `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`;

      while (Date.now() - startTime < validatedTimeout) {
        try {
          const result = await session.send('Runtime.evaluate', {
            expression: checkExpr,
            returnByValue: true
          });
          if (result.result.value === true) return;
        } catch {
          // Continue polling
        }
        await sleep(POLL_INTERVAL);
      }

      throw timeoutError(
        `Timeout (${validatedTimeout}ms) waiting for text: "${text}"${caseSensitive ? ' (case-sensitive)' : ''}`
      );
    }
  }

  async function waitForTextRegex(pattern, timeout = DEFAULT_TIMEOUT) {
    const validatedTimeout = validateTimeout(timeout);
    const startTime = Date.now();

    try {
      new RegExp(pattern);
    } catch (e) {
      throw new Error(`Invalid regex pattern: ${pattern} - ${e.message}`);
    }

    while (Date.now() - startTime < validatedTimeout) {
      try {
        const result = await session.send('Runtime.evaluate', {
          expression: `
            (function() {
              try {
                const regex = new RegExp(${JSON.stringify(pattern)});
                return regex.test(document.body.innerText);
              } catch {
                return false;
              }
            })()
          `,
          returnByValue: true
        });
        if (result.result.value === true) return;
      } catch {
        // Continue polling
      }
      await sleep(POLL_INTERVAL);
    }

    throw timeoutError(
      `Timeout (${validatedTimeout}ms) waiting for text matching pattern: /${pattern}/`
    );
  }

  async function waitForUrlContains(substring, timeout = DEFAULT_TIMEOUT) {
    const validatedTimeout = validateTimeout(timeout);
    const startTime = Date.now();

    while (Date.now() - startTime < validatedTimeout) {
      try {
        const result = await session.send('Runtime.evaluate', {
          expression: 'window.location.href',
          returnByValue: true
        });
        const currentUrl = result.result.value;
        if (currentUrl && currentUrl.includes(substring)) return;
      } catch {
        // Continue polling
      }
      await sleep(POLL_INTERVAL);
    }

    let finalUrl = 'unknown';
    try {
      const result = await session.send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true
      });
      finalUrl = result.result.value || 'unknown';
    } catch {
      // Ignore
    }

    throw timeoutError(
      `Timeout (${validatedTimeout}ms) waiting for URL to contain "${substring}" (current: ${finalUrl})`
    );
  }

  async function waitForTime(ms) {
    if (typeof ms !== 'number' || ms < 0) {
      throw new Error('wait time must be a non-negative number');
    }
    await sleep(ms);
  }

  async function execute(params) {
    if (typeof params === 'string') {
      return waitForSelector(params);
    }

    if (params.time !== undefined) {
      return waitForTime(params.time);
    }

    if (params.selector !== undefined) {
      if (params.hidden === true) {
        return waitForHidden(params.selector, params.timeout);
      }
      if (params.minCount !== undefined) {
        return waitForCount(params.selector, params.minCount, params.timeout);
      }
      return waitForSelector(params.selector, params.timeout);
    }

    if (params.text !== undefined) {
      return waitForText(params.text, {
        timeout: params.timeout,
        caseSensitive: params.caseSensitive
      });
    }

    if (params.textRegex !== undefined) {
      return waitForTextRegex(params.textRegex, params.timeout);
    }

    if (params.urlContains !== undefined) {
      return waitForUrlContains(params.urlContains, params.timeout);
    }

    throw new Error(`Invalid wait params: ${JSON.stringify(params)}`);
  }

  return {
    execute,
    waitForSelector,
    waitForHidden,
    waitForCount,
    waitForText,
    waitForTextRegex,
    waitForUrlContains,
    waitForTime
  };
}
