/**
 * Actionability Checker
 * Playwright-style auto-waiting for element actionability
 *
 * EXPORTS:
 * - createActionabilityChecker(session) → ActionabilityChecker
 *   Methods: waitForActionable, getClickablePoint, checkHitTarget, checkPointerEvents,
 *            checkCovered, checkVisible, checkEnabled, checkEditable, checkStable,
 *            getRequiredStates, scrollUntilVisible
 *
 * DEPENDENCIES:
 * - ../constants.js: TIMEOUTS
 * - ../utils.js: sleep, releaseObject
 */

import { TIMEOUTS } from '../constants.js';
import { sleep, releaseObject } from '../utils.js';

// Configurable stability check frame count
const stableFrameCount = 3;

/**
 * Create an actionability checker for Playwright-style auto-waiting
 * @param {Object} session - CDP session
 * @param {Object} [options] - Options
 * @param {function(): number|null} [options.getFrameContext] - Returns contextId for current frame
 * @returns {Object} Actionability checker interface
 */
export function createActionabilityChecker(session, options = {}) {
  const { getFrameContext } = options;

  /** Build Runtime.evaluate params with frame context when in an iframe. */
  function evalParams(expression, returnByValue = true) {
    const params = { expression, returnByValue };
    if (getFrameContext) {
      const contextId = getFrameContext();
      if (contextId) params.contextId = contextId;
    }
    return params;
  }
  // Simplified: removed stability check, shorter retry delays
  const retryDelays = [0, 50, 100, 200];

  function getRequiredStates(actionType) {
    // Removed 'stable' requirement - it caused timeouts on elements with CSS transitions
    // Zero-size elements are handled separately with JS click fallback
    switch (actionType) {
      case 'click':
        return ['attached'];  // Just check element exists and is connected
      case 'hover':
        return ['attached'];
      case 'fill':
      case 'type':
        return ['attached', 'editable'];
      case 'select':
        return ['attached'];
      default:
        return ['attached'];
    }
  }

  async function findElementInternal(selector) {
    try {
      const result = await session.send('Runtime.evaluate',
        evalParams(`document.querySelector(${JSON.stringify(selector)})`, false)
      );

      // Check for selector syntax errors (e.g., invalid CSS selectors)
      if (result.exceptionDetails) {
        const msg = result.exceptionDetails.exception?.description ||
                    result.exceptionDetails.exception?.value ||
                    result.exceptionDetails.text ||
                    'Unknown selector error';
        return { success: false, error: `Selector error: ${msg}`, immediate: true };
      }

      if (result.result.subtype === 'null' || !result.result.objectId) {
        return { success: false, error: `Element not found: ${selector}` };
      }

      return { success: true, objectId: result.result.objectId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function checkVisible(objectId) {
    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          const el = this;
          if (!el.isConnected) {
            return { matches: false, received: 'detached' };
          }
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden') {
            return { matches: false, received: 'visibility:hidden' };
          }
          if (style.display === 'none') {
            return { matches: false, received: 'display:none' };
          }
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            return { matches: false, received: 'zero-size' };
          }
          if (parseFloat(style.opacity) === 0) {
            return { matches: false, received: 'opacity:0' };
          }
          return { matches: true, received: 'visible' };
        }`,
        returnByValue: true
      });
      return result.result.value;
    } catch (error) {
      return { matches: false, received: 'error', error: error.message };
    }
  }

  async function checkEnabled(objectId) {
    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          const el = this;
          if (el.disabled === true) {
            return { matches: false, received: 'disabled' };
          }
          if (el.getAttribute('aria-disabled') === 'true') {
            return { matches: false, received: 'aria-disabled' };
          }
          const fieldset = el.closest('fieldset');
          if (fieldset && fieldset.disabled) {
            const legend = fieldset.querySelector('legend');
            if (!legend || !legend.contains(el)) {
              return { matches: false, received: 'fieldset-disabled' };
            }
          }
          return { matches: true, received: 'enabled' };
        }`,
        returnByValue: true
      });
      return result.result.value;
    } catch (error) {
      return { matches: false, received: 'error', error: error.message };
    }
  }

  async function checkEditable(objectId) {
    const enabledCheck = await checkEnabled(objectId);
    if (!enabledCheck.matches) {
      return enabledCheck;
    }

    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          const el = this;
          const tagName = el.tagName.toLowerCase();
          if (el.readOnly === true) {
            return { matches: false, received: 'readonly' };
          }
          if (el.getAttribute('aria-readonly') === 'true') {
            return { matches: false, received: 'aria-readonly' };
          }
          const isFormElement = ['input', 'textarea', 'select'].includes(tagName);
          const isContentEditable = el.isContentEditable;
          if (!isFormElement && !isContentEditable) {
            return { matches: false, received: 'not-editable-element' };
          }
          if (tagName === 'input') {
            const type = el.type.toLowerCase();
            const textInputTypes = ['text', 'password', 'email', 'number', 'search', 'tel', 'url', 'date', 'datetime-local', 'month', 'time', 'week'];
            if (!textInputTypes.includes(type)) {
              return { matches: false, received: 'non-text-input' };
            }
          }
          return { matches: true, received: 'editable' };
        }`,
        returnByValue: true
      });
      return result.result.value;
    } catch (error) {
      return { matches: false, received: 'error', error: error.message };
    }
  }

  async function checkStable(objectId) {
    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `async function() {
          const el = this;
          const frameCount = ${stableFrameCount};
          if (!el.isConnected) {
            return { matches: false, received: 'detached' };
          }
          let lastRect = null;
          let stableCount = 0;
          const getRect = () => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          const checkFrame = () => new Promise(resolve => {
            requestAnimationFrame(() => {
              if (!el.isConnected) {
                resolve({ matches: false, received: 'detached' });
                return;
              }
              const rect = getRect();
              if (lastRect) {
                const same = rect.x === lastRect.x &&
                             rect.y === lastRect.y &&
                             rect.width === lastRect.width &&
                             rect.height === lastRect.height;
                if (same) {
                  stableCount++;
                  if (stableCount >= frameCount) {
                    resolve({ matches: true, received: 'stable' });
                    return;
                  }
                } else {
                  stableCount = 0;
                }
              }
              lastRect = rect;
              resolve(null);
            });
          });
          for (let i = 0; i < 10; i++) {
            const result = await checkFrame();
            if (result !== null) {
              return result;
            }
          }
          return { matches: false, received: 'unstable' };
        }`,
        returnByValue: true,
        awaitPromise: true
      });
      return result.result.value;
    } catch (error) {
      return { matches: false, received: 'error', error: error.message };
    }
  }

  async function checkAttached(objectId) {
    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          return { matches: this.isConnected, received: this.isConnected ? 'attached' : 'detached' };
        }`,
        returnByValue: true
      });
      return result.result.value;
    } catch (error) {
      return { matches: false, received: 'error', error: error.message };
    }
  }

  async function checkState(objectId, state) {
    switch (state) {
      case 'attached':
        return checkAttached(objectId);
      case 'visible':
        return checkVisible(objectId);
      case 'enabled':
        return checkEnabled(objectId);
      case 'editable':
        return checkEditable(objectId);
      case 'stable':
        return checkStable(objectId);
      default:
        return { matches: true };
    }
  }

  async function checkStates(objectId, states) {
    for (const state of states) {
      const check = await checkState(objectId, state);
      if (!check.matches) {
        return { success: false, missingState: state, received: check.received };
      }
    }
    return { success: true };
  }

  async function waitForActionable(selector, actionType, opts = {}) {
    // Simplified: shorter default timeout (5s), simpler retry logic
    const { timeout = 5000, force = false } = opts;
    const startTime = Date.now();

    const requiredStates = getRequiredStates(actionType);

    // Force mode: just find the element, skip all checks
    if (force) {
      const element = await findElementInternal(selector);
      if (!element.success) {
        return element;
      }
      return { success: true, objectId: element.objectId, forced: true };
    }

    let retry = 0;
    let lastError = null;
    let lastObjectId = null;

    while (Date.now() - startTime < timeout) {
      if (retry > 0) {
        const delay = retryDelays[Math.min(retry - 1, retryDelays.length - 1)];
        if (delay > 0) {
          await sleep(delay);
        }
      }

      if (lastObjectId) {
        await releaseObject(session, lastObjectId);
        lastObjectId = null;
      }

      const element = await findElementInternal(selector);
      if (!element.success) {
        lastError = element.error;
        // Immediate failures (syntax errors) should not retry
        if (element.immediate) {
          return { success: false, error: element.error };
        }
        retry++;
        continue;
      }

      lastObjectId = element.objectId;

      const stateCheck = await checkStates(element.objectId, requiredStates);

      if (stateCheck.success) {
        return { success: true, objectId: element.objectId };
      }

      lastError = `Element is not ${stateCheck.missingState}: ${stateCheck.received}`;
      retry++;
    }

    if (lastObjectId) {
      await releaseObject(session, lastObjectId);
    }

    return {
      success: false,
      error: lastError || `Element not found: ${selector} (timeout: ${timeout}ms)`
    };
  }

  async function getClickablePoint(objectId) {
    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          const el = this;
          const rect = el.getBoundingClientRect();
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            }
          };
        }`,
        returnByValue: true
      });
      return result.result.value;
    } catch {
      return null;
    }
  }

  async function checkHitTarget(objectId, point) {
    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function(point) {
          const el = this;
          const hitEl = document.elementFromPoint(point.x, point.y);
          if (!hitEl) {
            return { matches: false, received: 'no-element-at-point' };
          }
          if (hitEl === el || el.contains(hitEl)) {
            return { matches: true, received: 'hit' };
          }
          let desc = hitEl.tagName.toLowerCase();
          if (hitEl.id) desc += '#' + hitEl.id;
          if (hitEl.className && typeof hitEl.className === 'string') {
            desc += '.' + hitEl.className.split(' ').filter(c => c).join('.');
          }
          return {
            matches: false,
            received: 'blocked',
            blockedBy: desc
          };
        }`,
        arguments: [{ value: point }],
        returnByValue: true
      });
      return result.result.value;
    } catch (error) {
      return { matches: false, received: 'error', error: error.message };
    }
  }

  /**
   * Check if pointer-events CSS allows clicking
   * Elements with pointer-events: none cannot receive click events
   * @param {string} objectId - Element object ID
   * @returns {Promise<{clickable: boolean, pointerEvents: string}>}
   */
  async function checkPointerEvents(objectId) {
    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          const el = this;
          const style = window.getComputedStyle(el);
          const pointerEvents = style.pointerEvents;

          // Check if element or any ancestor has pointer-events: none
          let current = el;
          while (current) {
            const currentStyle = window.getComputedStyle(current);
            if (currentStyle.pointerEvents === 'none') {
              return {
                clickable: false,
                pointerEvents: 'none',
                blockedBy: current === el ? 'self' : current.tagName.toLowerCase()
              };
            }
            current = current.parentElement;
          }

          return { clickable: true, pointerEvents: pointerEvents || 'auto' };
        }`,
        returnByValue: true
      });
      return result.result.value;
    } catch (error) {
      return { clickable: true, pointerEvents: 'unknown', error: error.message };
    }
  }

  /**
   * Detect covered elements using CDP DOM.getNodeForLocation
   * Inspired by Rod's Interactable() method
   * @param {string} objectId - Element object ID
   * @param {{x: number, y: number}} point - Click coordinates
   * @returns {Promise<{covered: boolean, coveringElement?: string}>}
   */
  async function checkCovered(objectId, point) {
    try {
      // Get the backend node ID for the target element
      const nodeResult = await session.send('DOM.describeNode', { objectId });
      const targetBackendNodeId = nodeResult.node.backendNodeId;

      // Use DOM.getNodeForLocation to see what element is actually at the click point
      const locationResult = await session.send('DOM.getNodeForLocation', {
        x: Math.floor(point.x),
        y: Math.floor(point.y),
        includeUserAgentShadowDOM: false
      });

      const hitBackendNodeId = locationResult.backendNodeId;

      // If the hit element matches our target, it's not covered
      if (hitBackendNodeId === targetBackendNodeId) {
        return { covered: false };
      }

      // Check if the hit element is a child of our target (also valid)
      const isChild = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function(hitNodeId) {
          // We need to find if the hit element is inside this element
          // This is tricky because we only have backend node IDs
          // Use elementFromPoint as a fallback check
          const rect = this.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const hitEl = document.elementFromPoint(centerX, centerY);

          if (!hitEl) return { isChild: false, coverInfo: 'no-element' };

          if (hitEl === this || this.contains(hitEl)) {
            return { isChild: true };
          }

          // Get info about the covering element
          let desc = hitEl.tagName.toLowerCase();
          if (hitEl.id) desc += '#' + hitEl.id;
          if (hitEl.className && typeof hitEl.className === 'string') {
            const classes = hitEl.className.split(' ').filter(c => c).slice(0, 3);
            if (classes.length > 0) desc += '.' + classes.join('.');
          }

          return { isChild: false, coverInfo: desc };
        }`,
        returnByValue: true
      });

      const childResult = isChild.result.value;

      if (childResult.isChild) {
        return { covered: false };
      }

      return {
        covered: true,
        coveringElement: childResult.coverInfo || 'unknown'
      };
    } catch (error) {
      // If DOM methods fail, fall back to elementFromPoint check
      try {
        const fallbackResult = await session.send('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: `function() {
            const rect = this.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const hitEl = document.elementFromPoint(centerX, centerY);

            if (!hitEl) return { covered: true, coverInfo: 'no-element-at-center' };
            if (hitEl === this || this.contains(hitEl)) return { covered: false };

            let desc = hitEl.tagName.toLowerCase();
            if (hitEl.id) desc += '#' + hitEl.id;
            return { covered: true, coverInfo: desc };
          }`,
          returnByValue: true
        });
        return {
          covered: fallbackResult.result.value.covered,
          coveringElement: fallbackResult.result.value.coverInfo
        };
      } catch {
        return { covered: false, error: error.message };
      }
    }
  }

  /**
   * Scroll incrementally until an element becomes visible
   * Useful for lazy-loaded content or infinite scroll pages
   * @param {string} selector - CSS selector for the element
   * @param {Object} [options] - Scroll options
   * @param {number} [options.maxScrolls=10] - Maximum number of scroll attempts
   * @param {number} [options.scrollAmount=500] - Pixels to scroll each attempt
   * @param {number} [options.timeout=30000] - Total timeout in ms
   * @param {string} [options.direction='down'] - Scroll direction ('down' or 'up')
   * @returns {Promise<{found: boolean, objectId?: string, scrollCount: number}>}
   */
  async function scrollUntilVisible(selector, options = {}) {
    const {
      maxScrolls = 10,
      scrollAmount = 500,
      timeout = 30000,
      direction = 'down'
    } = options;

    const startTime = Date.now();
    let scrollCount = 0;

    while (scrollCount < maxScrolls && (Date.now() - startTime) < timeout) {
      // Try to find the element
      const findResult = await findElementInternal(selector);

      if (findResult.success) {
        // Check if visible
        const visibleResult = await checkVisible(findResult.objectId);
        if (visibleResult.matches) {
          return {
            found: true,
            objectId: findResult.objectId,
            scrollCount,
            visibleAfterScrolls: scrollCount
          };
        }

        // Element exists but not visible, try scrolling it into view
        try {
          await session.send('Runtime.callFunctionOn', {
            objectId: findResult.objectId,
            functionDeclaration: `function() {
              this.scrollIntoView({ block: 'center', behavior: 'instant' });
            }`
          });
          await sleep(100);

          // Check visibility again
          const visibleAfterScroll = await checkVisible(findResult.objectId);
          if (visibleAfterScroll.matches) {
            return {
              found: true,
              objectId: findResult.objectId,
              scrollCount,
              scrolledIntoView: true
            };
          }
        } catch {
          // Failed to scroll into view, continue with page scrolling
        }

        // Release the object as we'll search again
        await releaseObject(session, findResult.objectId);
      }

      // Scroll the page
      const scrollDir = direction === 'up' ? -scrollAmount : scrollAmount;
      await session.send('Runtime.evaluate', evalParams(`window.scrollBy(0, ${scrollDir})`));

      scrollCount++;
      await sleep(200); // Wait for content to load/render
    }

    // Final attempt to find the element
    const finalResult = await findElementInternal(selector);
    if (finalResult.success) {
      const visibleResult = await checkVisible(finalResult.objectId);
      if (visibleResult.matches) {
        return {
          found: true,
          objectId: finalResult.objectId,
          scrollCount,
          foundOnFinalCheck: true
        };
      }
      await releaseObject(session, finalResult.objectId);
    }

    return {
      found: false,
      scrollCount,
      reason: scrollCount >= maxScrolls ? 'maxScrollsReached' : 'timeout'
    };
  }

  return {
    waitForActionable,
    getClickablePoint,
    checkHitTarget,
    checkPointerEvents,
    checkCovered,
    checkVisible,
    checkEnabled,
    checkEditable,
    checkStable,
    getRequiredStates,
    scrollUntilVisible
  };
}
