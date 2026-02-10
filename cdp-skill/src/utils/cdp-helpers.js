/**
 * CDP Helper Utilities
 * Common CDP operations and constants
 */

import { sleep } from './backoff.js';

/**
 * Release a CDP object reference to prevent memory leaks
 * @param {Object} session - CDP session
 * @param {string} objectId - Object ID to release
 */
export async function releaseObject(session, objectId) {
  if (!objectId) return;
  try {
    await session.send('Runtime.releaseObject', { objectId });
  } catch {
    // Ignore errors during cleanup - object may already be released
  }
}

/**
 * Reset input state to ensure no pending mouse/keyboard events
 * Helps prevent timeouts on subsequent operations after failures
 * @param {Object} session - CDP session
 */
export async function resetInputState(session) {
  try {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 0,
      y: 0,
      button: 'left',
      buttons: 0
    });
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Scroll alignment strategies for bringing elements into view
 */
export const SCROLL_STRATEGIES = ['center', 'end', 'start', 'nearest'];

/**
 * Action types for actionability checking
 */
export const ActionTypes = {
  CLICK: 'click',
  HOVER: 'hover',
  FILL: 'fill',
  TYPE: 'type',
  SELECT: 'select'
};

/**
 * Get current page URL
 * @param {Object} session - CDP session
 * @returns {Promise<string|null>}
 */
export async function getCurrentUrl(session) {
  try {
    const result = await session.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true
    });
    return result.result.value;
  } catch {
    return null;
  }
}

/**
 * Get element info at a specific point (for debug mode)
 * @param {Object} session - CDP session
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {Promise<Object|null>}
 */
export async function getElementAtPoint(session, x, y) {
  // Validate coordinates are numbers to prevent injection
  const safeX = Number(x);
  const safeY = Number(y);
  if (!Number.isFinite(safeX) || !Number.isFinite(safeY)) {
    return null;
  }
  try {
    const result = await session.send('Runtime.evaluate', {
      expression: `
        (function() {
          const el = document.elementFromPoint(${safeX}, ${safeY});
          if (!el) return null;
          return {
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
            className: el.className || null,
            textContent: el.textContent ? el.textContent.trim().substring(0, 50) : null
          };
        })()
      `,
      returnByValue: true
    });
    return result.result.value;
  } catch {
    return null;
  }
}

/**
 * Detect navigation by comparing URLs before and after an action
 * @param {Object} session - CDP session
 * @param {string} urlBeforeAction - URL before the action
 * @param {number} timeout - Timeout to wait for navigation
 * @returns {Promise<{navigated: boolean, newUrl?: string}>}
 */
export async function detectNavigation(session, urlBeforeAction, timeout = 100) {
  await sleep(timeout);
  try {
    const urlAfterAction = await getCurrentUrl(session);
    const navigated = urlAfterAction !== urlBeforeAction;
    return {
      navigated,
      newUrl: navigated ? urlAfterAction : undefined
    };
  } catch {
    // If we can't get URL, page likely navigated
    return { navigated: true };
  }
}
