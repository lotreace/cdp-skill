/**
 * DOM Operations and Input Emulation
 * Element location, handling, state checking, input simulation, and step executors
 *
 * EXPORTS:
 * Factory Functions:
 * - createElementHandle(session, objectId, options?) → ElementHandle
 * - createElementLocator(session, options?) → ElementLocator
 * - createInputEmulator(session) → InputEmulator
 * - createActionabilityChecker(session) → ActionabilityChecker
 * - createElementValidator(session) → ElementValidator
 * - createReactInputFiller(session) → ReactInputFiller
 * - createClickExecutor(session, locator, input, aria?) → ClickExecutor
 * - createFillExecutor(session, locator, input, aria?) → FillExecutor
 * - createKeyboardExecutor(session, locator, input) → KeyboardExecutor
 * - createWaitExecutor(session, locator) → WaitExecutor
 *
 * Convenience Functions:
 * - querySelector, querySelectorAll, findElement, getBoundingBox
 * - isVisible, isActionable, scrollIntoView
 * - click, type, fill, press, scroll
 *
 * DEPENDENCIES:
 * - ./quad-helpers.js
 * - ./element-handle.js
 * - ./element-locator.js
 * - ./input-emulator.js
 * - ./actionability.js
 * - ./element-validator.js
 * - ./react-filler.js
 * - ./click-executor.js
 * - ./fill-executor.js
 * - ./keyboard-executor.js
 * - ./wait-executor.js
 */

// ============================================================================
// Re-exports from submodules
// ============================================================================

// Quad helpers (geometry calculations)
export {
  calculateQuadCenter,
  calculateQuadArea,
  isPointInQuad,
  getLargestQuad
} from './quad-helpers.js';

// Element handle (remote object wrapper)
export { createElementHandle } from './element-handle.js';

// Element locator (finding elements)
export { createElementLocator } from './element-locator.js';

// Input emulator (mouse/keyboard)
export { createInputEmulator } from './input-emulator.js';

// Actionability checker (Playwright-style waiting)
export { createActionabilityChecker } from './actionability.js';

// Element validator (editability/clickability checks)
export { createElementValidator } from './element-validator.js';

// React input filler (controlled components)
export { createReactInputFiller } from './react-filler.js';

// Click executor (high-level click operations)
export { createClickExecutor } from './click-executor.js';

// Fill executor (high-level fill operations)
export { createFillExecutor } from './fill-executor.js';

// Keyboard executor (type/select operations)
export { createKeyboardExecutor } from './keyboard-executor.js';

// Wait executor (waiting operations)
export { createWaitExecutor } from './wait-executor.js';

// Lazy resolver (stateless element resolution)
export { createLazyResolver } from './LazyResolver.js';

// ============================================================================
// Convenience Functions
// ============================================================================

import { createElementHandle } from './element-handle.js';
import { createElementLocator } from './element-locator.js';
import { createInputEmulator } from './input-emulator.js';

/**
 * Find a single element by selector
 * @param {Object} session - CDP session
 * @param {string} selector - CSS selector
 * @returns {Promise<Object|null>}
 */
export async function querySelector(session, selector) {
  const locator = createElementLocator(session);
  return locator.querySelector(selector);
}

/**
 * Find all elements matching a selector
 * @param {Object} session - CDP session
 * @param {string} selector - CSS selector
 * @returns {Promise<Object[]>}
 */
export async function querySelectorAll(session, selector) {
  const locator = createElementLocator(session);
  return locator.querySelectorAll(selector);
}

/**
 * Find an element with nodeId for compatibility
 * @param {Object} session - CDP session
 * @param {string} selector - CSS selector
 * @param {Object} [options] - Options
 * @returns {Promise<{nodeId: string, box: Object, dispose: Function}|null>}
 */
export async function findElement(session, selector, options = {}) {
  const locator = createElementLocator(session, options);
  const element = await locator.querySelector(selector);
  if (!element) return null;

  const box = await element.getBoundingBox();
  return {
    nodeId: element.objectId,
    box,
    dispose: () => element.dispose()
  };
}

/**
 * Get bounding box for an element by objectId
 * @param {Object} session - CDP session
 * @param {string} objectId - Object ID
 * @returns {Promise<{x: number, y: number, width: number, height: number}|null>}
 */
export async function getBoundingBox(session, objectId) {
  const locator = createElementLocator(session);
  return locator.getBoundingBox(objectId);
}

/**
 * Check if an element is visible
 * @param {Object} session - CDP session
 * @param {string} objectId - Object ID
 * @returns {Promise<boolean>}
 */
export async function isVisible(session, objectId) {
  const handle = createElementHandle(session, objectId);
  try {
    return await handle.isVisible();
  } finally {
    await handle.dispose();
  }
}

/**
 * Check if an element is actionable
 * @param {Object} session - CDP session
 * @param {string} objectId - Object ID
 * @returns {Promise<{actionable: boolean, reason: string|null}>}
 */
export async function isActionable(session, objectId) {
  const handle = createElementHandle(session, objectId);
  try {
    return await handle.isActionable();
  } finally {
    await handle.dispose();
  }
}

/**
 * Scroll element into view
 * @param {Object} session - CDP session
 * @param {string} objectId - Object ID
 * @returns {Promise<void>}
 */
export async function scrollIntoView(session, objectId) {
  const handle = createElementHandle(session, objectId);
  try {
    await handle.scrollIntoView();
  } finally {
    await handle.dispose();
  }
}

/**
 * Click at coordinates
 * @param {Object} session - CDP session
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} [options] - Click options
 * @returns {Promise<void>}
 */
export async function click(session, x, y, options = {}) {
  const input = createInputEmulator(session);
  return input.click(x, y, options);
}

/**
 * Type text
 * @param {Object} session - CDP session
 * @param {string} text - Text to type
 * @param {Object} [options] - Type options
 * @returns {Promise<void>}
 */
export async function type(session, text, options = {}) {
  const input = createInputEmulator(session);
  return input.type(text, options);
}

/**
 * Fill input at coordinates
 * @param {Object} session - CDP session
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {string} text - Text to fill
 * @param {Object} [options] - Fill options
 * @returns {Promise<void>}
 */
export async function fill(session, x, y, text, options = {}) {
  const input = createInputEmulator(session);
  return input.fill(x, y, text, options);
}

/**
 * Press a key
 * @param {Object} session - CDP session
 * @param {string} key - Key to press
 * @param {Object} [options] - Press options
 * @returns {Promise<void>}
 */
export async function press(session, key, options = {}) {
  const input = createInputEmulator(session);
  return input.press(key, options);
}

/**
 * Scroll the page
 * @param {Object} session - CDP session
 * @param {number} deltaX - Horizontal scroll
 * @param {number} deltaY - Vertical scroll
 * @param {number} [x=100] - X origin
 * @param {number} [y=100] - Y origin
 * @returns {Promise<void>}
 */
export async function scroll(session, deltaX, deltaY, x = 100, y = 100) {
  const input = createInputEmulator(session);
  return input.scroll(deltaX, deltaY, x, y);
}
