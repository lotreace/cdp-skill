/**
 * DOM Operations and Input Emulation
 * Element location, handling, state checking, input simulation, and step executors
 *
 * Consolidated: ActionabilityChecker, ElementValidator, ClickExecutor, FillExecutor,
 * ReactInputFiller, KeyboardStepExecutor, WaitExecutor
 */

import {
  timeoutError,
  elementNotFoundError,
  elementNotEditableError,
  staleElementError,
  connectionError,
  isStaleElementError,
  sleep,
  sleepWithBackoff,
  createBackoffSleeper,
  releaseObject,
  resetInputState,
  getCurrentUrl,
  getElementAtPoint,
  detectNavigation
} from './utils.js';

const MAX_TIMEOUT = 300000; // 5 minutes max timeout
const DEFAULT_TIMEOUT = 10000; // 10 seconds - auto-force kicks in if element exists but not actionable
const POLL_INTERVAL = 100;

// ============================================================================
// Key Definitions
// ============================================================================

const KEY_DEFINITIONS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  Control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  Alt: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  Meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  F1: { key: 'F1', code: 'F1', keyCode: 112 },
  F2: { key: 'F2', code: 'F2', keyCode: 113 },
  F3: { key: 'F3', code: 'F3', keyCode: 114 },
  F4: { key: 'F4', code: 'F4', keyCode: 115 },
  F5: { key: 'F5', code: 'F5', keyCode: 116 },
  F6: { key: 'F6', code: 'F6', keyCode: 117 },
  F7: { key: 'F7', code: 'F7', keyCode: 118 },
  F8: { key: 'F8', code: 'F8', keyCode: 119 },
  F9: { key: 'F9', code: 'F9', keyCode: 120 },
  F10: { key: 'F10', code: 'F10', keyCode: 121 },
  F11: { key: 'F11', code: 'F11', keyCode: 122 },
  F12: { key: 'F12', code: 'F12', keyCode: 123 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Insert: { key: 'Insert', code: 'Insert', keyCode: 45 }
};

/**
 * Non-editable input types
 */
const NON_EDITABLE_INPUT_TYPES = [
  'button', 'checkbox', 'color', 'file', 'hidden',
  'image', 'radio', 'range', 'reset', 'submit'
];

// ============================================================================
// Content Quads Helpers (inspired by Chromedp)
// ============================================================================

/**
 * Calculate center point of a quad
 * Quads are arrays of 8 numbers: [x1,y1, x2,y2, x3,y3, x4,y4]
 * @param {number[]} quad - Quad coordinates
 * @returns {{x: number, y: number}}
 */
function calculateQuadCenter(quad) {
  let x = 0, y = 0;
  for (let i = 0; i < 8; i += 2) {
    x += quad[i];
    y += quad[i + 1];
  }
  return { x: x / 4, y: y / 4 };
}

/**
 * Calculate area of a quad
 * @param {number[]} quad - Quad coordinates
 * @returns {number}
 */
function calculateQuadArea(quad) {
  // Shoelace formula for polygon area
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += quad[i * 2] * quad[j * 2 + 1];
    area -= quad[j * 2] * quad[i * 2 + 1];
  }
  return Math.abs(area) / 2;
}

/**
 * Check if a point is inside a quad
 * @param {number[]} quad - Quad coordinates
 * @param {number} x - Point x
 * @param {number} y - Point y
 * @returns {boolean}
 */
function isPointInQuad(quad, x, y) {
  // Using ray casting algorithm
  const points = [];
  for (let i = 0; i < 8; i += 2) {
    points.push({ x: quad[i], y: quad[i + 1] });
  }

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Get the largest quad from an array (most likely the visible content area)
 * @param {number[][]} quads - Array of quads
 * @returns {number[]|null}
 */
function getLargestQuad(quads) {
  if (!quads || quads.length === 0) return null;
  if (quads.length === 1) return quads[0];

  let largest = quads[0];
  let largestArea = calculateQuadArea(quads[0]);

  for (let i = 1; i < quads.length; i++) {
    const area = calculateQuadArea(quads[i]);
    if (area > largestArea) {
      largestArea = area;
      largest = quads[i];
    }
  }
  return largest;
}

// ============================================================================
// Element Handle
// ============================================================================

/**
 * Create an element handle for a remote object
 * @param {Object} session - CDP session
 * @param {string} objectId - Remote object ID from CDP
 * @param {Object} [options] - Additional options
 * @param {string} [options.selector] - Selector used to find this element
 * @returns {Object} Element handle interface
 */
export function createElementHandle(session, objectId, options = {}) {
  if (!session) throw new Error('CDP session is required');
  if (!objectId) throw new Error('objectId is required');

  let disposed = false;
  const selector = options.selector || null;

  function ensureNotDisposed() {
    if (disposed) throw new Error('ElementHandle has been disposed');
  }

  async function wrapCDPOperation(operation, fn) {
    try {
      return await fn();
    } catch (error) {
      if (isStaleElementError(error)) {
        throw staleElementError(objectId, { operation, selector, cause: error });
      }
      throw error;
    }
  }

  async function getBoundingBox() {
    ensureNotDisposed();
    return wrapCDPOperation('getBoundingBox', async () => {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          const rect = this.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }`,
        returnByValue: true
      });
      return result.result.value;
    });
  }

  /**
   * Get content quads for the element (handles CSS transforms)
   * Content quads give the actual renderable area accounting for transforms
   * @returns {Promise<{quads: number[][], center: {x: number, y: number}}|null>}
   */
  async function getContentQuads() {
    ensureNotDisposed();
    return wrapCDPOperation('getContentQuads', async () => {
      try {
        // First get the backend node ID
        const nodeResult = await session.send('DOM.describeNode', { objectId });
        const backendNodeId = nodeResult.node.backendNodeId;

        // Get content quads using CDP
        const quadsResult = await session.send('DOM.getContentQuads', { backendNodeId });
        const quads = quadsResult.quads;

        if (!quads || quads.length === 0) {
          // Fall back to bounding box if no quads
          const box = await getBoundingBox();
          return {
            quads: [[box.x, box.y, box.x + box.width, box.y,
                     box.x + box.width, box.y + box.height, box.x, box.y + box.height]],
            center: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
            fallback: true
          };
        }

        // Calculate center of first quad (8 numbers: 4 points * 2 coords)
        const quad = quads[0];
        const center = calculateQuadCenter(quad);

        return { quads, center, fallback: false };
      } catch (error) {
        // If getContentQuads fails, fall back to bounding box
        const box = await getBoundingBox();
        if (!box) return null;
        return {
          quads: [[box.x, box.y, box.x + box.width, box.y,
                   box.x + box.width, box.y + box.height, box.x, box.y + box.height]],
          center: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          fallback: true
        };
      }
    });
  }

  async function getClickPoint(useQuads = true) {
    ensureNotDisposed();

    // Try content quads first for accurate positioning with transforms
    if (useQuads) {
      try {
        const quadsResult = await getContentQuads();
        if (quadsResult && quadsResult.center) {
          return quadsResult.center;
        }
      } catch {
        // Fall back to bounding box
      }
    }

    const box = await getBoundingBox();
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    };
  }

  async function isConnectedToDOM() {
    ensureNotDisposed();
    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() { return this.isConnected; }`,
        returnByValue: true
      });
      return result.result.value === true;
    } catch (error) {
      if (isStaleElementError(error)) return false;
      throw error;
    }
  }

  async function ensureConnected(operation = null) {
    const connected = await isConnectedToDOM();
    if (!connected) {
      throw staleElementError(objectId, operation);
    }
  }

  async function isVisible() {
    ensureNotDisposed();
    return wrapCDPOperation('isVisible', async () => {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          const el = this;
          let current = el;
          while (current) {
            const style = window.getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return false;
            }
            current = current.parentElement;
          }
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          return true;
        }`,
        returnByValue: true
      });
      return result.result.value;
    });
  }

  /**
   * Check if element is in viewport using IntersectionObserver (improvement #11)
   * More efficient than manual rect calculations for determining visibility
   * @param {Object} [options] - Options
   * @param {number} [options.threshold=0] - Minimum intersection ratio (0-1)
   * @param {number} [options.timeout=5000] - Timeout in ms
   * @returns {Promise<{inViewport: boolean, intersectionRatio: number, boundingRect: Object}>}
   */
  async function isInViewport(options = {}) {
    ensureNotDisposed();
    const { threshold = 0, timeout = 5000 } = options;

    return wrapCDPOperation('isInViewport', async () => {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function(threshold, timeout) {
          return new Promise((resolve) => {
            const el = this;

            // Quick check first using getBoundingClientRect
            const rect = el.getBoundingClientRect();
            const viewHeight = window.innerHeight || document.documentElement.clientHeight;
            const viewWidth = window.innerWidth || document.documentElement.clientWidth;

            // Calculate intersection manually as a quick check
            const visibleTop = Math.max(0, rect.top);
            const visibleLeft = Math.max(0, rect.left);
            const visibleBottom = Math.min(viewHeight, rect.bottom);
            const visibleRight = Math.min(viewWidth, rect.right);

            const visibleWidth = Math.max(0, visibleRight - visibleLeft);
            const visibleHeight = Math.max(0, visibleBottom - visibleTop);
            const visibleArea = visibleWidth * visibleHeight;
            const totalArea = rect.width * rect.height;
            const ratio = totalArea > 0 ? visibleArea / totalArea : 0;

            // If no IntersectionObserver support, use manual calculation
            if (typeof IntersectionObserver === 'undefined') {
              resolve({
                inViewport: ratio > threshold,
                intersectionRatio: ratio,
                boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                method: 'manual'
              });
              return;
            }

            // Use IntersectionObserver for accurate detection
            let resolved = false;
            const timeoutId = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                observer.disconnect();
                // Fall back to manual calculation on timeout
                resolve({
                  inViewport: ratio > threshold,
                  intersectionRatio: ratio,
                  boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                  method: 'timeout-fallback'
                });
              }
            }, timeout);

            const observer = new IntersectionObserver((entries) => {
              if (resolved) return;
              resolved = true;
              clearTimeout(timeoutId);
              observer.disconnect();

              const entry = entries[0];
              if (!entry) {
                resolve({
                  inViewport: ratio > threshold,
                  intersectionRatio: ratio,
                  boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                  method: 'no-entry'
                });
                return;
              }

              resolve({
                inViewport: entry.isIntersecting && entry.intersectionRatio > threshold,
                intersectionRatio: entry.intersectionRatio,
                boundingRect: {
                  x: entry.boundingClientRect.x,
                  y: entry.boundingClientRect.y,
                  width: entry.boundingClientRect.width,
                  height: entry.boundingClientRect.height
                },
                rootBounds: entry.rootBounds ? {
                  width: entry.rootBounds.width,
                  height: entry.rootBounds.height
                } : null,
                method: 'intersectionObserver'
              });
            }, { threshold: [0, threshold, 1] });

            observer.observe(el);
          });
        }`,
        arguments: [{ value: threshold }, { value: timeout }],
        returnByValue: true,
        awaitPromise: true
      });
      return result.result.value;
    });
  }

  /**
   * Wait for element to enter viewport using IntersectionObserver
   * @param {Object} [options] - Options
   * @param {number} [options.threshold=0.1] - Minimum visibility ratio
   * @param {number} [options.timeout=30000] - Timeout in ms
   * @returns {Promise<{inViewport: boolean, intersectionRatio: number}>}
   */
  async function waitForInViewport(options = {}) {
    ensureNotDisposed();
    const { threshold = 0.1, timeout = 30000 } = options;

    return wrapCDPOperation('waitForInViewport', async () => {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function(threshold, timeout) {
          return new Promise((resolve, reject) => {
            const el = this;

            if (typeof IntersectionObserver === 'undefined') {
              // Fall back to scroll into view
              el.scrollIntoView({ block: 'center', behavior: 'instant' });
              resolve({ inViewport: true, method: 'scrolled' });
              return;
            }

            let resolved = false;
            const timeoutId = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                observer.disconnect();
                reject(new Error('Timeout waiting for element to enter viewport'));
              }
            }, timeout);

            const observer = new IntersectionObserver((entries) => {
              if (resolved) return;
              const entry = entries[0];
              if (entry && entry.isIntersecting && entry.intersectionRatio >= threshold) {
                resolved = true;
                clearTimeout(timeoutId);
                observer.disconnect();
                resolve({
                  inViewport: true,
                  intersectionRatio: entry.intersectionRatio,
                  method: 'intersectionObserver'
                });
              }
            }, { threshold: [threshold] });

            observer.observe(el);
          });
        }`,
        arguments: [{ value: threshold }, { value: timeout }],
        returnByValue: true,
        awaitPromise: true
      });
      return result.result.value;
    });
  }

  async function isActionable() {
    ensureNotDisposed();
    return wrapCDPOperation('isActionable', async () => {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          const el = this;
          if (!el.isConnected) return { actionable: false, reason: 'element not connected to DOM' };

          let current = el;
          while (current) {
            const style = window.getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return { actionable: false, reason: 'hidden by CSS' };
            }
            current = current.parentElement;
          }

          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return { actionable: false, reason: 'zero dimensions' };

          const viewHeight = window.innerHeight || document.documentElement.clientHeight;
          const viewWidth = window.innerWidth || document.documentElement.clientWidth;
          if (rect.bottom < 0 || rect.top > viewHeight || rect.right < 0 || rect.left > viewWidth) {
            return { actionable: false, reason: 'outside viewport' };
          }

          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const topElement = document.elementFromPoint(centerX, centerY);
          if (topElement === null) return { actionable: false, reason: 'element center not hittable' };
          if (topElement !== el && !el.contains(topElement)) {
            return { actionable: false, reason: 'occluded by another element' };
          }

          if (el.disabled) return { actionable: false, reason: 'element is disabled' };

          return { actionable: true, reason: null };
        }`,
        returnByValue: true
      });
      return result.result.value;
    });
  }

  async function scrollIntoView(opts = {}) {
    ensureNotDisposed();
    const { block = 'center', inline = 'nearest' } = opts;
    return wrapCDPOperation('scrollIntoView', async () => {
      await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function(block, inline) {
          this.scrollIntoView({ block, inline, behavior: 'instant' });
        }`,
        arguments: [{ value: block }, { value: inline }],
        returnByValue: true
      });
    });
  }

  async function focus() {
    ensureNotDisposed();
    return wrapCDPOperation('focus', async () => {
      await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          this.focus();
        }`,
        returnByValue: true
      });
    });
  }

  async function waitForStability(opts = {}) {
    ensureNotDisposed();
    const { frames = 3, timeout = 5000 } = opts;
    const startTime = Date.now();
    let lastBox = null;
    let stableFrames = 0;

    while (Date.now() - startTime < timeout) {
      const box = await getBoundingBox();
      if (!box) throw new Error('Element not visible');

      if (lastBox &&
          box.x === lastBox.x && box.y === lastBox.y &&
          box.width === lastBox.width && box.height === lastBox.height) {
        stableFrames++;
        if (stableFrames >= frames) return box;
      } else {
        stableFrames = 0;
      }

      lastBox = box;
      await sleep(16);
    }

    throw new Error(`Element position not stable after ${timeout}ms`);
  }

  async function evaluate(fn, ...args) {
    ensureNotDisposed();
    return wrapCDPOperation('evaluate', async () => {
      const fnString = typeof fn === 'function' ? fn.toString() : fn;
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: fnString,
        arguments: args.map(arg => ({ value: arg })),
        returnByValue: true
      });
      return result.result.value;
    });
  }

  async function dispose() {
    if (!disposed) {
      try {
        await session.send('Runtime.releaseObject', { objectId });
      } catch {
        // Ignore
      }
      disposed = true;
    }
  }

  return {
    get objectId() { return objectId; },
    get selector() { return selector; },
    getBoundingBox,
    getContentQuads,
    getClickPoint,
    isConnectedToDOM,
    ensureConnected,
    isVisible,
    isInViewport,
    waitForInViewport,
    isActionable,
    scrollIntoView,
    focus,
    waitForStability,
    evaluate,
    dispose,
    isDisposed: () => disposed
  };
}

// ============================================================================
// Element Locator
// ============================================================================

/**
 * Create an element locator for finding DOM elements
 * @param {Object} session - CDP session
 * @param {Object} [options] - Configuration options
 * @param {number} [options.timeout=30000] - Default timeout in ms
 * @returns {Object} Element locator interface
 */
export function createElementLocator(session, options = {}) {
  if (!session) throw new Error('CDP session is required');

  let defaultTimeout = options.timeout || 30000;

  function validateTimeout(timeout) {
    if (typeof timeout !== 'number' || !Number.isFinite(timeout)) return defaultTimeout;
    if (timeout < 0) return 0;
    if (timeout > MAX_TIMEOUT) return MAX_TIMEOUT;
    return timeout;
  }

  async function doReleaseObject(objId) {
    try {
      await session.send('Runtime.releaseObject', { objectId: objId });
    } catch {
      // Ignore
    }
  }

  async function querySelector(selector) {
    if (!selector || typeof selector !== 'string') {
      throw new Error('Selector must be a non-empty string');
    }

    let result;
    try {
      result = await session.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: false
      });
    } catch (error) {
      throw connectionError(error.message, 'Runtime.evaluate (querySelector)');
    }

    if (result.exceptionDetails) {
      const exceptionMessage = result.exceptionDetails.exception?.description ||
                               result.exceptionDetails.exception?.value ||
                               result.exceptionDetails.text ||
                               'Unknown selector error';
      throw new Error(`Selector error: ${exceptionMessage}`);
    }

    if (result.result.subtype === 'null' || result.result.type === 'undefined') {
      return null;
    }

    return createElementHandle(session, result.result.objectId, { selector });
  }

  async function querySelectorAll(selector) {
    if (!selector || typeof selector !== 'string') {
      throw new Error('Selector must be a non-empty string');
    }

    let result;
    try {
      result = await session.send('Runtime.evaluate', {
        expression: `Array.from(document.querySelectorAll(${JSON.stringify(selector)}))`,
        returnByValue: false
      });
    } catch (error) {
      throw connectionError(error.message, 'Runtime.evaluate (querySelectorAll)');
    }

    if (result.exceptionDetails) {
      const exceptionMessage = result.exceptionDetails.exception?.description ||
                               result.exceptionDetails.exception?.value ||
                               result.exceptionDetails.text ||
                               'Unknown selector error';
      throw new Error(`Selector error: ${exceptionMessage}`);
    }

    if (!result.result.objectId) return [];

    const arrayObjectId = result.result.objectId;
    let props;
    try {
      props = await session.send('Runtime.getProperties', {
        objectId: arrayObjectId,
        ownProperties: true
      });
    } catch (error) {
      await doReleaseObject(arrayObjectId);
      throw connectionError(error.message, 'Runtime.getProperties');
    }

    const elements = props.result
      .filter(p => /^\d+$/.test(p.name) && p.value && p.value.objectId)
      .map(p => createElementHandle(session, p.value.objectId, { selector }));

    await doReleaseObject(arrayObjectId);
    return elements;
  }

  async function waitForSelector(selector, waitOptions = {}) {
    if (!selector || typeof selector !== 'string') {
      throw new Error('Selector must be a non-empty string');
    }

    const { timeout = defaultTimeout, visible = false } = waitOptions;
    const validatedTimeout = validateTimeout(timeout);
    const startTime = Date.now();

    while (Date.now() - startTime < validatedTimeout) {
      const element = await querySelector(selector);

      if (element) {
        if (!visible) return element;

        try {
          const isVis = await element.isVisible();
          if (isVis) return element;
        } catch {
          // Element may have been removed
        }

        await element.dispose();
      }

      await sleep(100);
    }

    throw elementNotFoundError(selector, validatedTimeout);
  }

  async function waitForText(text, waitOptions = {}) {
    if (text === null || text === undefined) {
      throw new Error('Text must be provided');
    }
    const textStr = String(text);

    const { timeout = defaultTimeout, exact = false } = waitOptions;
    const validatedTimeout = validateTimeout(timeout);
    const startTime = Date.now();

    const checkExpr = exact
      ? `document.body.innerText.includes(${JSON.stringify(textStr)})`
      : `document.body.innerText.toLowerCase().includes(${JSON.stringify(textStr.toLowerCase())})`;

    while (Date.now() - startTime < validatedTimeout) {
      let result;
      try {
        result = await session.send('Runtime.evaluate', {
          expression: checkExpr,
          returnByValue: true
        });
      } catch (error) {
        throw connectionError(error.message, 'Runtime.evaluate (waitForText)');
      }

      if (result.result.value === true) return true;

      await sleep(100);
    }

    throw timeoutError(`Timeout (${validatedTimeout}ms) waiting for text: "${textStr}"`);
  }

  async function findElement(selector) {
    const element = await querySelector(selector);
    if (!element) return null;
    return { nodeId: element.objectId, _handle: element };
  }

  async function getBoundingBox(nodeId) {
    if (!nodeId) return null;

    let result;
    try {
      result = await session.send('Runtime.callFunctionOn', {
        objectId: nodeId,
        functionDeclaration: `function() {
          const rect = this.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }`,
        returnByValue: true
      });
    } catch {
      return null;
    }

    if (result.exceptionDetails || !result.result.value) return null;
    return result.result.value;
  }

  async function queryByRole(role, opts = {}) {
    const { name, checked, disabled } = opts;

    const ROLE_SELECTORS = {
      button: ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]', '[role="button"]'],
      textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="search"]', 'input[type="tel"]', 'input[type="url"]', 'textarea', '[role="textbox"]'],
      checkbox: ['input[type="checkbox"]', '[role="checkbox"]'],
      link: ['a[href]', '[role="link"]'],
      heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="heading"]'],
      listitem: ['li', '[role="listitem"]'],
      option: ['option', '[role="option"]'],
      combobox: ['select', '[role="combobox"]']
    };

    const selectors = ROLE_SELECTORS[role] || [`[role="${role}"]`];
    const selectorString = selectors.join(', ');

    const nameFilter = (name !== undefined && name !== null) ? JSON.stringify(name.toLowerCase()) : null;
    const checkedFilter = checked !== undefined ? checked : null;
    const disabledFilter = disabled !== undefined ? disabled : null;

    const expression = `
      (function() {
        const selectors = ${JSON.stringify(selectorString)};
        const nameFilter = ${nameFilter};
        const checkedFilter = ${checkedFilter !== null ? checkedFilter : 'null'};
        const disabledFilter = ${disabledFilter !== null ? disabledFilter : 'null'};

        const elements = Array.from(document.querySelectorAll(selectors));

        return elements.filter(el => {
          if (nameFilter !== null) {
            const accessibleName = (
              el.getAttribute('aria-label') ||
              el.textContent?.trim() ||
              el.getAttribute('title') ||
              el.getAttribute('placeholder') ||
              el.value ||
              ''
            ).toLowerCase();
            if (!accessibleName.includes(nameFilter)) return false;
          }

          if (checkedFilter !== null) {
            const isChecked = el.checked === true || el.getAttribute('aria-checked') === 'true';
            if (isChecked !== checkedFilter) return false;
          }

          if (disabledFilter !== null) {
            const isDisabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
            if (isDisabled !== disabledFilter) return false;
          }

          return true;
        });
      })()
    `;

    let result;
    try {
      result = await session.send('Runtime.evaluate', {
        expression,
        returnByValue: false
      });
    } catch (error) {
      throw connectionError(error.message, 'Runtime.evaluate (queryByRole)');
    }

    if (result.exceptionDetails) {
      throw new Error(`Role query error: ${result.exceptionDetails.text}`);
    }

    if (!result.result.objectId) return [];

    const arrayObjectId = result.result.objectId;
    let props;
    try {
      props = await session.send('Runtime.getProperties', {
        objectId: arrayObjectId,
        ownProperties: true
      });
    } catch (error) {
      await doReleaseObject(arrayObjectId);
      throw connectionError(error.message, 'Runtime.getProperties');
    }

    const elements = props.result
      .filter(p => /^\d+$/.test(p.name) && p.value && p.value.objectId)
      .map(p => createElementHandle(session, p.value.objectId, { selector: `[role="${role}"]` }));

    await doReleaseObject(arrayObjectId);
    return elements;
  }

  /**
   * Find an element by its visible text content
   * Priority order: buttons → links → [role="button"] → any clickable element
   * @param {string} text - Text to search for
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.exact=false] - Require exact text match
   * @param {string} [opts.tag] - Limit search to specific tag (e.g., 'button', 'a')
   * @returns {Promise<Object|null>} Element handle or null
   */
  async function findElementByText(text, opts = {}) {
    if (!text || typeof text !== 'string') {
      throw new Error('Text must be a non-empty string');
    }

    const { exact = false, tag = null } = opts;
    const textLower = text.toLowerCase();
    const textJson = JSON.stringify(text);
    const textLowerJson = JSON.stringify(textLower);

    // Build the selector priorities based on tag filter
    let selectorGroups;
    if (tag) {
      selectorGroups = [[tag]];
    } else {
      // Priority: buttons → links → role buttons → other clickable
      selectorGroups = [
        ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]'],
        ['a[href]'],
        ['[role="button"]'],
        ['[onclick]', '[tabindex]', 'label', 'summary']
      ];
    }

    const expression = `
      (function() {
        const text = ${textJson};
        const textLower = ${textLowerJson};
        const exact = ${exact};
        const selectorGroups = ${JSON.stringify(selectorGroups)};

        function getElementText(el) {
          // Check aria-label first
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return ariaLabel;

          // For inputs, check value and placeholder
          if (el.tagName === 'INPUT') {
            return el.value || el.placeholder || '';
          }

          // Get visible text content
          return el.textContent || '';
        }

        function matchesText(elText) {
          if (exact) {
            return elText.trim() === text;
          }
          return elText.toLowerCase().includes(textLower);
        }

        function isVisible(el) {
          if (!el.isConnected) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
          }
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        // Search in priority order
        for (const selectors of selectorGroups) {
          const selectorString = selectors.join(', ');
          const elements = document.querySelectorAll(selectorString);

          for (const el of elements) {
            if (!isVisible(el)) continue;
            const elText = getElementText(el);
            if (matchesText(elText)) {
              return el;
            }
          }
        }

        return null;
      })()
    `;

    let result;
    try {
      result = await session.send('Runtime.evaluate', {
        expression,
        returnByValue: false
      });
    } catch (error) {
      throw connectionError(error.message, 'Runtime.evaluate (findElementByText)');
    }

    if (result.exceptionDetails) {
      throw new Error(`Text search error: ${result.exceptionDetails.text}`);
    }

    if (result.result.subtype === 'null' || result.result.type === 'undefined') {
      return null;
    }

    return createElementHandle(session, result.result.objectId, { selector: `text:${text}` });
  }

  /**
   * Wait for an element with specific text to appear
   * @param {string} text - Text to search for
   * @param {Object} [opts] - Options
   * @param {number} [opts.timeout=30000] - Timeout in ms
   * @param {boolean} [opts.exact=false] - Require exact match
   * @param {boolean} [opts.visible=true] - Require element to be visible
   * @returns {Promise<Object>} Element handle
   */
  async function waitForElementByText(text, opts = {}) {
    const { timeout = defaultTimeout, exact = false, visible = true } = opts;
    const validatedTimeout = validateTimeout(timeout);
    const startTime = Date.now();

    while (Date.now() - startTime < validatedTimeout) {
      const element = await findElementByText(text, { exact });

      if (element) {
        if (!visible) return element;

        try {
          const isVis = await element.isVisible();
          if (isVis) return element;
        } catch {
          // Element may have been removed
        }

        await element.dispose();
      }

      await sleep(100);
    }

    throw elementNotFoundError(`text:"${text}"`, validatedTimeout);
  }

  return {
    get session() { return session; },
    querySelector,
    querySelectorAll,
    queryByRole,
    waitForSelector,
    waitForText,
    findElement,
    findElementByText,
    waitForElementByText,
    getBoundingBox,
    getDefaultTimeout: () => defaultTimeout,
    setDefaultTimeout: (timeout) => { defaultTimeout = validateTimeout(timeout); }
  };
}

// ============================================================================
// Input Emulator
// ============================================================================

/**
 * Create an input emulator for mouse and keyboard input
 * @param {Object} session - CDP session
 * @returns {Object} Input emulator interface
 */
export function createInputEmulator(session) {
  if (!session) throw new Error('CDP session is required');

  // Transaction-based mouse state (improvement #7)
  // Inspired by Puppeteer's CdpMouse
  const mouseState = {
    x: 0,
    y: 0,
    button: 'none',
    buttons: 0,
    transactionDepth: 0,
    pendingOperations: []
  };

  /**
   * Begin a mouse transaction for atomic operations
   * Prevents concurrent mouse operations from interfering
   * @returns {Object} Transaction handle with commit/rollback
   */
  function beginMouseTransaction() {
    mouseState.transactionDepth++;
    const startState = { ...mouseState };

    return {
      /**
       * Commit the transaction, applying all pending state
       */
      commit: () => {
        mouseState.transactionDepth--;
      },

      /**
       * Rollback the transaction, restoring initial state
       */
      rollback: async () => {
        mouseState.transactionDepth--;
        // Reset mouse to initial state
        if (startState.buttons !== mouseState.buttons) {
          // Release any pressed buttons
          if (mouseState.buttons !== 0) {
            await session.send('Input.dispatchMouseEvent', {
              type: 'mouseReleased',
              x: mouseState.x,
              y: mouseState.y,
              button: mouseState.button,
              buttons: 0
            });
          }
        }
        mouseState.x = startState.x;
        mouseState.y = startState.y;
        mouseState.button = startState.button;
        mouseState.buttons = startState.buttons;
      },

      /**
       * Get current transaction state
       */
      getState: () => ({ ...mouseState })
    };
  }

  /**
   * Reset mouse state to default
   * Useful after errors or when starting fresh
   */
  async function resetMouseState() {
    if (mouseState.buttons !== 0) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: mouseState.x,
        y: mouseState.y,
        button: mouseState.button,
        buttons: 0
      });
    }
    mouseState.x = 0;
    mouseState.y = 0;
    mouseState.button = 'none';
    mouseState.buttons = 0;
  }

  /**
   * Get current mouse state
   */
  function getMouseState() {
    return { ...mouseState };
  }

  function calculateModifiers(modifiers) {
    let flags = 0;
    if (modifiers.alt) flags |= 1;
    if (modifiers.ctrl) flags |= 2;
    if (modifiers.meta) flags |= 4;
    if (modifiers.shift) flags |= 8;
    return flags;
  }

  function getButtonMask(button) {
    const masks = { left: 1, right: 2, middle: 4, back: 8, forward: 16 };
    return masks[button] || 1;
  }

  function getKeyDefinition(char) {
    if (char >= 'a' && char <= 'z') {
      return { key: char, code: `Key${char.toUpperCase()}`, keyCode: char.toUpperCase().charCodeAt(0) };
    }
    if (char >= 'A' && char <= 'Z') {
      return { key: char, code: `Key${char}`, keyCode: char.charCodeAt(0) };
    }
    if (char >= '0' && char <= '9') {
      return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0) };
    }
    return { key: char, code: '', keyCode: char.charCodeAt(0), text: char };
  }

  function validateCoordinates(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number' ||
        !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Coordinates must be finite numbers');
    }
    if (x < 0 || y < 0) {
      throw new Error('Coordinates must be non-negative');
    }
  }

  function validateButton(button) {
    const valid = ['left', 'right', 'middle', 'back', 'forward', 'none'];
    if (!valid.includes(button)) {
      throw new Error(`Invalid button: ${button}. Must be one of: ${valid.join(', ')}`);
    }
  }

  function validateClickCount(clickCount) {
    if (typeof clickCount !== 'number' || !Number.isInteger(clickCount) || clickCount < 1) {
      throw new Error('Click count must be a positive integer');
    }
  }

  async function click(x, y, opts = {}) {
    validateCoordinates(x, y);

    const {
      button = 'left',
      clickCount = 1,
      delay = 0,
      modifiers = {}
    } = opts;

    validateButton(button);
    validateClickCount(clickCount);

    const modifierFlags = calculateModifiers(modifiers);
    const buttonMask = getButtonMask(button);

    // Update mouse state tracking
    mouseState.x = x;
    mouseState.y = y;

    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, modifiers: modifierFlags
    });

    mouseState.button = button;
    mouseState.buttons = buttonMask;

    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button, clickCount,
      modifiers: modifierFlags, buttons: buttonMask
    });

    if (delay > 0) await sleep(delay);

    mouseState.button = 'none';
    mouseState.buttons = 0;

    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button, clickCount,
      modifiers: modifierFlags, buttons: 0
    });
  }

  async function doubleClick(x, y, opts = {}) {
    await click(x, y, { ...opts, clickCount: 2 });
  }

  async function rightClick(x, y, opts = {}) {
    await click(x, y, { ...opts, button: 'right' });
  }

  async function type(text, opts = {}) {
    if (typeof text !== 'string') {
      throw new Error('Text must be a string');
    }

    const { delay = 0 } = opts;

    for (const char of text) {
      await session.send('Input.dispatchKeyEvent', {
        type: 'char',
        text: char,
        key: char,
        unmodifiedText: char
      });

      if (delay > 0) await sleep(delay);
    }
  }

  /**
   * Insert text using Input.insertText (like paste) - much faster than type()
   * Inspired by Rod & Puppeteer's insertText approach
   * Triggers synthetic input event for React/Vue bindings
   * @param {string} text - Text to insert
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.dispatchEvents=true] - Dispatch input/change events
   * @returns {Promise<void>}
   */
  async function insertText(text, opts = {}) {
    if (typeof text !== 'string') {
      throw new Error('Text must be a string');
    }

    const { dispatchEvents = true } = opts;

    // Use CDP Input.insertText for fast text insertion
    await session.send('Input.insertText', { text });

    // Trigger synthetic input event for framework bindings (React, Vue, etc.)
    if (dispatchEvents) {
      await session.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.activeElement;
            if (el) {
              el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
              el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            }
          })()
        `
      });
    }
  }

  async function fill(x, y, text, opts = {}) {
    await click(x, y);
    await sleep(50);

    const isMac = opts.useMeta ?? (typeof process !== 'undefined' && process.platform === 'darwin');
    const selectAllModifiers = isMac ? { meta: true } : { ctrl: true };
    await press('a', { modifiers: selectAllModifiers });

    await sleep(50);
    await type(text, opts);
  }

  async function press(key, opts = {}) {
    const { modifiers = {}, delay = 0 } = opts;
    const keyDef = KEY_DEFINITIONS[key] || getKeyDefinition(key);
    const modifierFlags = calculateModifiers(modifiers);

    await session.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      modifiers: modifierFlags
    });

    if (keyDef.text) {
      await session.send('Input.dispatchKeyEvent', {
        type: 'char',
        text: keyDef.text,
        key: keyDef.key,
        modifiers: modifierFlags
      });
    }

    if (delay > 0) await sleep(delay);

    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      modifiers: modifierFlags
    });
  }

  async function selectAll() {
    await session.send('Runtime.evaluate', {
      expression: `
        (function() {
          const el = document.activeElement;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
            el.select();
          } else if (window.getSelection) {
            document.execCommand('selectAll', false, null);
          }
        })()
      `
    });
  }

  async function moveMouse(x, y) {
    validateCoordinates(x, y);
    mouseState.x = x;
    mouseState.y = y;
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  }

  async function hover(x, y, opts = {}) {
    validateCoordinates(x, y);
    const { duration = 0 } = opts;

    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y
    });

    if (duration > 0) {
      await sleep(duration);
    }
  }

  async function scroll(deltaX, deltaY, x = 100, y = 100) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y, deltaX, deltaY
    });
  }

  function parseKeyCombo(combo) {
    const parts = combo.split('+');
    const modifiers = { ctrl: false, alt: false, meta: false, shift: false };
    let key = null;

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower === 'control' || lower === 'ctrl') {
        modifiers.ctrl = true;
      } else if (lower === 'alt') {
        modifiers.alt = true;
      } else if (lower === 'meta' || lower === 'cmd' || lower === 'command') {
        modifiers.meta = true;
      } else if (lower === 'shift') {
        modifiers.shift = true;
      } else {
        key = part;
      }
    }

    return { key, modifiers };
  }

  async function pressCombo(combo, opts = {}) {
    const { key, modifiers } = parseKeyCombo(combo);
    if (!key) {
      throw new Error(`Invalid key combo: ${combo} - no main key specified`);
    }
    await press(key, { ...opts, modifiers });
  }

  return {
    click,
    doubleClick,
    rightClick,
    type,
    insertText,
    fill,
    press,
    pressCombo,
    parseKeyCombo,
    selectAll,
    moveMouse,
    hover,
    scroll,
    // Transaction-based mouse state (improvement #7)
    beginMouseTransaction,
    resetMouseState,
    getMouseState
  };
}

// ============================================================================
// Actionability Checker (from ActionabilityChecker.js)
// ============================================================================

/**
 * Create an actionability checker for Playwright-style auto-waiting
 * @param {Object} session - CDP session
 * @returns {Object} Actionability checker interface
 */
export function createActionabilityChecker(session) {
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
      const result = await session.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: false
      });

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
   * Check if pointer-events CSS allows clicking (improvement #8)
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
   * Detect covered elements using CDP DOM.getNodeForLocation (improvement #1)
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
   * Scroll incrementally until an element becomes visible (Feature 10)
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
      await session.send('Runtime.evaluate', {
        expression: `window.scrollBy(0, ${scrollDir})`
      });

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

// ============================================================================
// Element Validator (from ElementValidator.js)
// ============================================================================

/**
 * Create an element validator for checking element properties and states
 * @param {Object} session - CDP session
 * @returns {Object} Element validator interface
 */
export function createElementValidator(session) {
  async function isEditable(objectId) {
    const result = await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        const el = this;
        const tagName = el.tagName ? el.tagName.toLowerCase() : '';
        if (el.isContentEditable) {
          return { editable: true, reason: null };
        }
        if (tagName === 'textarea') {
          if (el.disabled) {
            return { editable: false, reason: 'Element is disabled' };
          }
          if (el.readOnly) {
            return { editable: false, reason: 'Element is read-only' };
          }
          return { editable: true, reason: null };
        }
        if (tagName === 'input') {
          const inputType = (el.type || 'text').toLowerCase();
          const nonEditableTypes = ${JSON.stringify(NON_EDITABLE_INPUT_TYPES)};
          if (nonEditableTypes.includes(inputType)) {
            return { editable: false, reason: 'Input type "' + inputType + '" is not editable' };
          }
          if (el.disabled) {
            return { editable: false, reason: 'Element is disabled' };
          }
          if (el.readOnly) {
            return { editable: false, reason: 'Element is read-only' };
          }
          return { editable: true, reason: null };
        }
        return {
          editable: false,
          reason: 'Element <' + tagName + '> is not editable (expected input, textarea, or contenteditable)'
        };
      }`,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      const errorText = result.exceptionDetails.exception?.description ||
                        result.exceptionDetails.text ||
                        'Unknown error checking editability';
      return { editable: false, reason: errorText };
    }

    return result.result.value;
  }

  async function isClickable(objectId) {
    const result = await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        const el = this;
        const tagName = el.tagName ? el.tagName.toLowerCase() : '';
        if (el.disabled) {
          return { clickable: false, reason: 'Element is disabled', willNavigate: false };
        }
        let willNavigate = false;
        if (tagName === 'a') {
          const href = el.getAttribute('href');
          const target = el.getAttribute('target');
          willNavigate = href && href !== '#' && href !== 'javascript:void(0)' &&
                        target !== '_blank' && !href.startsWith('javascript:');
        }
        if ((tagName === 'button' || tagName === 'input') &&
            (el.type === 'submit' || (!el.type && tagName === 'button'))) {
          const form = el.closest('form');
          if (form && form.action) {
            willNavigate = true;
          }
        }
        if (el.onclick || el.getAttribute('onclick')) {
          const onclickStr = String(el.getAttribute('onclick') || '');
          if (onclickStr.includes('location') || onclickStr.includes('href') ||
              onclickStr.includes('navigate') || onclickStr.includes('submit')) {
            willNavigate = true;
          }
        }
        return { clickable: true, reason: null, willNavigate: willNavigate };
      }`,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      const errorText = result.exceptionDetails.exception?.description ||
                        result.exceptionDetails.text ||
                        'Unknown error checking clickability';
      return { clickable: false, reason: errorText, willNavigate: false };
    }

    return result.result.value;
  }

  return {
    isEditable,
    isClickable
  };
}

// ============================================================================
// React Input Filler (from ReactInputFiller.js)
// ============================================================================

/**
 * Create a React input filler for handling React controlled components
 * @param {Object} session - CDP session
 * @returns {Object} React input filler interface
 */
export function createReactInputFiller(session) {
  if (!session) {
    throw new Error('CDP session is required');
  }

  async function fillByObjectId(objectId, value) {
    const result = await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function(newValue) {
        const el = this;
        const prototype = el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const nativeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
        nativeValueSetter.call(el, newValue);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, value: el.value };
      }`,
      arguments: [{ value: String(value) }],
      returnByValue: true
    });

    if (result.exceptionDetails) {
      const errorText = result.exceptionDetails.exception?.description ||
                        result.exceptionDetails.text ||
                        'Unknown error during React fill';
      throw new Error(`React fill failed: ${errorText}`);
    }

    return result.result.value;
  }

  async function fillBySelector(selector, value) {
    const result = await session.send('Runtime.evaluate', {
      expression: `
        (function(selector, newValue) {
          const el = document.querySelector(selector);
          if (!el) {
            return { success: false, error: 'Element not found: ' + selector };
          }
          const prototype = el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
          if (!descriptor || !descriptor.set) {
            return { success: false, error: 'Cannot get native value setter' };
          }
          const nativeValueSetter = descriptor.set;
          nativeValueSetter.call(el, newValue);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, value: el.value };
        })(${JSON.stringify(selector)}, ${JSON.stringify(String(value))})
      `,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      const errorText = result.exceptionDetails.exception?.description ||
                        result.exceptionDetails.text ||
                        'Unknown error during React fill';
      throw new Error(`React fill failed: ${errorText}`);
    }

    const fillResult = result.result.value;
    if (!fillResult.success) {
      throw new Error(fillResult.error);
    }

    return fillResult;
  }

  return {
    fillByObjectId,
    fillBySelector
  };
}

// ============================================================================
// Click Executor (from ClickExecutor.js)
// ============================================================================

/**
 * Create a click executor for handling click operations
 * @param {Object} session - CDP session
 * @param {Object} elementLocator - Element locator instance
 * @param {Object} inputEmulator - Input emulator instance
 * @param {Object} [ariaSnapshot] - Optional ARIA snapshot instance
 * @returns {Object} Click executor interface
 */
export function createClickExecutor(session, elementLocator, inputEmulator, ariaSnapshot = null) {
  if (!session) throw new Error('CDP session is required');
  if (!elementLocator) throw new Error('Element locator is required');
  if (!inputEmulator) throw new Error('Input emulator is required');

  const actionabilityChecker = createActionabilityChecker(session);
  const elementValidator = createElementValidator(session);

  function calculateVisibleCenter(box, viewport = null) {
    let visibleBox = { ...box };

    if (viewport) {
      visibleBox.x = Math.max(box.x, 0);
      visibleBox.y = Math.max(box.y, 0);
      const right = Math.min(box.x + box.width, viewport.width);
      const bottom = Math.min(box.y + box.height, viewport.height);
      visibleBox.width = right - visibleBox.x;
      visibleBox.height = bottom - visibleBox.y;
    }

    return {
      x: visibleBox.x + visibleBox.width / 2,
      y: visibleBox.y + visibleBox.height / 2
    };
  }

  async function getViewportBounds() {
    const result = await session.send('Runtime.evaluate', {
      expression: `({
        width: window.innerWidth || document.documentElement.clientWidth,
        height: window.innerHeight || document.documentElement.clientHeight
      })`,
      returnByValue: true
    });
    return result.result.value;
  }

  /**
   * Detect content changes after an action using MutationObserver (Feature 6)
   * @param {Object} [options] - Detection options
   * @param {number} [options.timeout=5000] - Max wait time in ms
   * @param {number} [options.stableTime=500] - Time with no changes to consider stable
   * @param {boolean} [options.checkNavigation=true] - Also check for URL changes
   * @returns {Promise<Object>} Content change result
   */
  async function detectContentChange(options = {}) {
    const {
      timeout = 5000,
      stableTime = 500,
      checkNavigation = true
    } = options;

    const urlBefore = checkNavigation ? await getCurrentUrl(session) : null;

    const result = await session.send('Runtime.evaluate', {
      expression: `
        (function() {
          return new Promise((resolve) => {
            const timeout = ${timeout};
            const stableTime = ${stableTime};
            const startTime = Date.now();

            let changeCount = 0;
            let lastChangeTime = startTime;
            let stableCheckTimer = null;

            const observer = new MutationObserver((mutations) => {
              changeCount += mutations.length;
              lastChangeTime = Date.now();

              // Reset stable timer on each change
              if (stableCheckTimer) {
                clearTimeout(stableCheckTimer);
              }

              stableCheckTimer = setTimeout(() => {
                cleanup('contentChange');
              }, stableTime);
            });

            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true
            });

            const timeoutId = setTimeout(() => {
              cleanup(changeCount > 0 ? 'contentChange' : 'none');
            }, timeout);

            function cleanup(type) {
              observer.disconnect();
              clearTimeout(timeoutId);
              if (stableCheckTimer) clearTimeout(stableCheckTimer);

              resolve({
                type,
                changeCount,
                duration: Date.now() - startTime
              });
            }

            // Initial check: if no changes for stableTime, resolve as 'none'
            stableCheckTimer = setTimeout(() => {
              if (changeCount === 0) {
                cleanup('none');
              }
            }, stableTime);
          });
        })()
      `,
      returnByValue: true,
      awaitPromise: true
    });

    const changeResult = result.result.value || { type: 'none', changeCount: 0 };

    // Check for navigation
    if (checkNavigation) {
      const urlAfter = await getCurrentUrl(session);
      if (urlAfter !== urlBefore) {
        return {
          type: 'navigation',
          newUrl: urlAfter,
          previousUrl: urlBefore,
          changeCount: changeResult.changeCount,
          duration: changeResult.duration
        };
      }
    }

    return changeResult;
  }

  /**
   * Get information about what element is intercepting a click at given coordinates (Feature 4)
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {string} [targetObjectId] - Optional object ID of expected target
   * @returns {Promise<Object|null>} Interceptor info or null if no interception
   */
  async function getInterceptorInfo(x, y, targetObjectId = null) {
    const expression = `
      (function() {
        const x = ${x};
        const y = ${y};
        const el = document.elementFromPoint(x, y);
        if (!el) return null;

        function getSelector(element) {
          if (element.id) return '#' + element.id;
          let selector = element.tagName.toLowerCase();
          if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\\s+/).slice(0, 2);
            if (classes.length > 0 && classes[0]) {
              selector += '.' + classes.join('.');
            }
          }
          return selector;
        }

        function getText(element) {
          const text = element.textContent || '';
          return text.trim().substring(0, 100);
        }

        function isOverlay(element) {
          const style = window.getComputedStyle(element);
          const position = style.position;
          const zIndex = parseInt(style.zIndex) || 0;
          return (position === 'fixed' || position === 'absolute') && zIndex > 0;
        }

        function getCommonOverlayType(element) {
          const text = getText(element).toLowerCase();
          const classes = (element.className || '').toLowerCase();
          const id = (element.id || '').toLowerCase();

          if (text.includes('cookie') || classes.includes('cookie') || id.includes('cookie')) {
            return 'cookie-banner';
          }
          if (text.includes('accept') || classes.includes('consent') || id.includes('consent')) {
            return 'consent-dialog';
          }
          if (classes.includes('modal') || id.includes('modal') || element.getAttribute('role') === 'dialog') {
            return 'modal';
          }
          if (classes.includes('overlay') || id.includes('overlay')) {
            return 'overlay';
          }
          if (classes.includes('popup') || id.includes('popup')) {
            return 'popup';
          }
          if (classes.includes('toast') || id.includes('toast') || classes.includes('notification')) {
            return 'notification';
          }
          return null;
        }

        const rect = el.getBoundingClientRect();
        const overlayType = getCommonOverlayType(el);

        return {
          selector: getSelector(el),
          text: getText(el),
          tagName: el.tagName.toLowerCase(),
          isOverlay: isOverlay(el),
          overlayType,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      })()
    `;

    const result = await session.send('Runtime.evaluate', {
      expression,
      returnByValue: true
    });

    if (result.exceptionDetails || !result.result.value) {
      return null;
    }

    const interceptor = result.result.value;

    // If we have a target objectId, check if the interceptor is the same element
    if (targetObjectId) {
      const checkResult = await session.send('Runtime.callFunctionOn', {
        objectId: targetObjectId,
        functionDeclaration: `function(x, y) {
          const topEl = document.elementFromPoint(x, y);
          return topEl === this || this.contains(topEl);
        }`,
        arguments: [{ value: x }, { value: y }],
        returnByValue: true
      });

      if (checkResult.result.value === true) {
        // The target element is at the click point, no interception
        return null;
      }
    }

    return interceptor;
  }

  async function executeJsClick(objectId) {
    const result = await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        if (this.disabled) {
          return { success: false, reason: 'element is disabled' };
        }
        if (typeof this.focus === 'function') {
          this.focus();
        }
        this.click();
        return { success: true, targetReceived: true };
      }`,
      returnByValue: true
    });

    const value = result.result.value || {};
    if (!value.success) {
      throw new Error(`JS click failed: ${value.reason || 'unknown error'}`);
    }

    return { targetReceived: true };
  }

  async function executeJsClickOnRef(ref) {
    const result = await session.send('Runtime.evaluate', {
      expression: `
        (function() {
          const el = window.__ariaRefs && window.__ariaRefs.get(${JSON.stringify(ref)});
          if (!el) {
            return { success: false, reason: 'ref not found in __ariaRefs' };
          }
          if (!el.isConnected) {
            return { success: false, reason: 'element is no longer attached to DOM' };
          }
          if (el.disabled) {
            return { success: false, reason: 'element is disabled' };
          }
          if (typeof el.focus === 'function') el.focus();
          el.click();
          return { success: true };
        })()
      `,
      returnByValue: true
    });

    const value = result.result.value || {};
    if (!value.success) {
      throw new Error(`JS click on ref failed: ${value.reason || 'unknown error'}`);
    }
  }

  async function clickWithVerification(x, y, targetObjectId) {
    await session.send('Runtime.callFunctionOn', {
      objectId: targetObjectId,
      functionDeclaration: `function() {
        this.__clickReceived = false;
        this.__clickHandler = () => { this.__clickReceived = true; };
        this.addEventListener('click', this.__clickHandler, { once: true });
      }`
    });

    await inputEmulator.click(x, y);
    await sleep(50);

    const verifyResult = await session.send('Runtime.callFunctionOn', {
      objectId: targetObjectId,
      functionDeclaration: `function() {
        this.removeEventListener('click', this.__clickHandler);
        const received = this.__clickReceived;
        delete this.__clickReceived;
        delete this.__clickHandler;
        return received;
      }`,
      returnByValue: true
    });

    const targetReceived = verifyResult.result.value === true;
    const result = { targetReceived };

    // Feature 4: If click didn't reach target, get interceptor info
    if (!targetReceived) {
      const interceptor = await getInterceptorInfo(x, y, targetObjectId);
      if (interceptor) {
        result.interceptedBy = interceptor;
      }
    }

    return result;
  }

  async function addNavigationAndDebugInfo(result, urlBeforeClick, debugData, opts) {
    const { waitForNavigation = false, navigationTimeout = 100, debug = false, waitAfter = false, waitAfterOptions = {} } = opts;

    if (waitForNavigation) {
      const navResult = await detectNavigation(session, urlBeforeClick, navigationTimeout);
      result.navigated = navResult.navigated;
      if (navResult.newUrl) {
        result.newUrl = navResult.newUrl;
      }
    }

    // Feature 6: Auto-wait after click
    if (waitAfter) {
      const changeResult = await detectContentChange({
        timeout: waitAfterOptions.timeout || 5000,
        stableTime: waitAfterOptions.stableTime || 500,
        checkNavigation: true
      });
      result.waitResult = changeResult;
    }

    if (debug && debugData) {
      result.debug = {
        clickedAt: debugData.point,
        elementHit: debugData.elementAtPoint
      };
    }

    return result;
  }

  async function clickAtCoordinates(x, y, opts = {}) {
    const { debug = false, waitForNavigation = false, navigationTimeout = 100 } = opts;

    const urlBeforeClick = await getCurrentUrl(session);

    let elementAtPoint = null;
    if (debug) {
      elementAtPoint = await getElementAtPoint(session, x, y);
    }

    await inputEmulator.click(x, y);

    const result = {
      clicked: true,
      method: 'cdp',
      coordinates: { x, y }
    };

    if (waitForNavigation) {
      const navResult = await detectNavigation(session, urlBeforeClick, navigationTimeout);
      result.navigated = navResult.navigated;
      if (navResult.newUrl) {
        result.newUrl = navResult.newUrl;
      }
    }

    if (debug) {
      result.debug = {
        clickedAt: { x, y },
        elementHit: elementAtPoint
      };
    }

    return result;
  }

  async function clickByRef(ref, jsClick = false, opts = {}) {
    const { force = false, debug = false, waitForNavigation, navigationTimeout = 100 } = opts;

    if (!ariaSnapshot) {
      throw new Error('ariaSnapshot is required for ref-based clicks');
    }

    const refInfo = await ariaSnapshot.getElementByRef(ref);
    if (!refInfo) {
      throw elementNotFoundError(`ref:${ref}`, 0);
    }

    if (refInfo.stale) {
      return {
        clicked: false,
        stale: true,
        warning: `Element ref:${ref} is no longer attached to the DOM. Page content may have changed. Run 'snapshot' again to get fresh refs.`
      };
    }

    if (!force && refInfo.isVisible === false) {
      return {
        clicked: false,
        warning: `Element ref:${ref} exists but is not visible. It may be hidden or have zero dimensions.`
      };
    }

    const urlBeforeClick = await getCurrentUrl(session);

    const point = calculateVisibleCenter(refInfo.box);

    let elementAtPoint = null;
    if (debug) {
      elementAtPoint = await getElementAtPoint(session, point.x, point.y);
    }

    // Simple approach: do the click and trust it worked
    // We have exact coordinates from snapshot, so CDP click should hit the target
    let usedMethod = 'cdp';

    if (jsClick) {
      // User explicitly requested JS click
      await executeJsClickOnRef(ref);
      usedMethod = 'jsClick';
    } else {
      // Perform CDP click at coordinates
      await inputEmulator.click(point.x, point.y);
    }

    // Brief wait for any navigation to start
    await sleep(50);

    // Check for navigation
    let navigated = false;
    try {
      const urlAfterClick = await getCurrentUrl(session);
      navigated = urlAfterClick !== urlBeforeClick;
    } catch {
      // If we can't get URL, page likely navigated
      navigated = true;
    }

    const result = {
      clicked: true,
      method: usedMethod,
      ref,
      navigated
    };

    if (navigated) {
      try {
        result.newUrl = await getCurrentUrl(session);
      } catch {
        // Page still navigating
      }
    }

    if (debug) {
      result.debug = {
        clickedAt: point,
        elementHit: elementAtPoint
      };
    }

    return result;
  }

  async function tryJsClickFallback(selector, opts = {}) {
    const { urlBeforeClick, waitForNavigation = false, navigationTimeout = 100, debug = false, waitAfter = false, waitAfterOptions = {}, fallbackReason = 'CDP click failed' } = opts;

    const element = await elementLocator.findElement(selector);
    if (!element) {
      throw elementNotFoundError(selector, 0);
    }

    try {
      const result = await executeJsClick(element._handle.objectId);
      await element._handle.dispose();

      const clickResult = {
        clicked: true,
        method: 'jsClick-fallback',
        fallbackReason,
        ...result
      };

      return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
    } catch (e) {
      await element._handle.dispose();
      throw e;
    }
  }

  async function clickBySelector(selector, opts = {}) {
    const {
      jsClick = false,
      verify = false,
      force = false,
      debug = false,
      waitForNavigation = false,
      navigationTimeout = 100,
      timeout = 5000,  // Reduced from 30s to 5s for faster failure
      waitAfter = false,
      waitAfterOptions = {}
    } = opts;

    const urlBeforeClick = await getCurrentUrl(session);

    const waitResult = await actionabilityChecker.waitForActionable(selector, 'click', {
      timeout,
      force
    });

    if (!waitResult.success) {
      throw new Error(waitResult.error || `Element not found: ${selector}`);
    }

    const objectId = waitResult.objectId;

    try {
      // User explicitly requested JS click
      if (jsClick) {
        const result = await executeJsClick(objectId);
        const clickResult = { clicked: true, method: 'jsClick', ...result };
        return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
      }

      const point = await actionabilityChecker.getClickablePoint(objectId);
      if (!point) {
        throw new Error('Could not determine click point for element');
      }

      // Auto-fallback to JS click for zero-size elements (hidden inputs, etc.)
      if (point.rect.width === 0 || point.rect.height === 0) {
        const result = await executeJsClick(objectId);
        const clickResult = { clicked: true, method: 'jsClick', reason: 'zero-size-element', ...result };
        return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
      }

      const viewportBox = await getViewportBounds();
      const clippedPoint = calculateVisibleCenter(point.rect, viewportBox);

      let elementAtPoint = null;
      if (debug) {
        elementAtPoint = await getElementAtPoint(session, clippedPoint.x, clippedPoint.y);
      }

      // CDP click at coordinates
      await inputEmulator.click(clippedPoint.x, clippedPoint.y);

      const clickResult = { clicked: true, method: 'cdp' };
      return addNavigationAndDebugInfo(clickResult, urlBeforeClick, { point: clippedPoint, elementAtPoint }, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });

    } catch (e) {
      if (!jsClick) {
        try {
          return await tryJsClickFallback(selector, {
            urlBeforeClick,
            waitForNavigation,
            navigationTimeout,
            debug,
            waitAfter,
            waitAfterOptions,
            fallbackReason: e.message
          });
        } catch {
          // JS click also failed
        }
      }
      throw e;
    } finally {
      await releaseObject(session, objectId);
    }
  }

  /**
   * Click an element by its visible text content
   * @param {string} text - Text to find and click
   * @param {Object} opts - Click options
   * @returns {Promise<Object>} Click result
   */
  async function clickByText(text, opts = {}) {
    const {
      exact = false,
      tag = null,
      jsClick = false,
      verify = false,
      force = false,
      debug = false,
      waitForNavigation = false,
      navigationTimeout = 100,
      timeout = 30000,
      waitAfter = false,
      waitAfterOptions = {}
    } = opts;

    const urlBeforeClick = await getCurrentUrl(session);

    // Find element by text using the locator
    const element = await elementLocator.findElementByText(text, { exact, tag });
    if (!element) {
      throw elementNotFoundError(`text:"${text}"`, timeout);
    }

    const objectId = element.objectId;

    try {
      // Check actionability unless force is true
      if (!force) {
        const actionable = await element.isActionable();
        if (!actionable.actionable) {
          // Try JS click as fallback
          if (!jsClick) {
            try {
              const result = await executeJsClick(objectId);
              const clickResult = {
                clicked: true,
                method: 'jsClick-fallback',
                text,
                fallbackReason: actionable.reason,
                ...result
              };
              return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
            } catch {
              // JS click also failed
            }
          }
          throw new Error(`Element with text "${text}" not actionable: ${actionable.reason}`);
        }
      }

      if (jsClick) {
        const result = await executeJsClick(objectId);
        const clickResult = { clicked: true, method: 'jsClick', text, ...result };
        return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
      }

      const point = await element.getClickPoint();
      if (!point) {
        throw new Error(`Could not determine click point for element with text "${text}"`);
      }

      let elementAtPoint = null;
      if (debug) {
        elementAtPoint = await getElementAtPoint(session, point.x, point.y);
      }

      if (verify) {
        const result = await clickWithVerification(point.x, point.y, objectId);

        if (!result.targetReceived) {
          const jsResult = await executeJsClick(objectId);
          const clickResult = {
            clicked: true,
            method: 'jsClick-fallback',
            text,
            cdpAttempted: true,
            targetReceived: jsResult.targetReceived,
            interceptedBy: result.interceptedBy
          };
          return addNavigationAndDebugInfo(clickResult, urlBeforeClick, { point, elementAtPoint }, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
        }

        const clickResult = { clicked: true, method: 'cdp', text, ...result };
        return addNavigationAndDebugInfo(clickResult, urlBeforeClick, { point, elementAtPoint }, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
      }

      await inputEmulator.click(point.x, point.y);

      const clickResult = { clicked: true, method: 'cdp', text };
      return addNavigationAndDebugInfo(clickResult, urlBeforeClick, { point, elementAtPoint }, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });

    } catch (e) {
      if (!jsClick) {
        try {
          const result = await executeJsClick(objectId);
          const clickResult = {
            clicked: true,
            method: 'jsClick-fallback',
            text,
            fallbackReason: e.message,
            ...result
          };
          return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
        } catch {
          // JS click also failed
        }
      }
      throw e;
    } finally {
      await element.dispose();
    }
  }

  async function execute(params) {
    const selector = typeof params === 'string' ? params : params.selector;
    let ref = typeof params === 'object' ? params.ref : null;
    const text = typeof params === 'object' ? params.text : null;
    const selectors = typeof params === 'object' ? params.selectors : null;
    const jsClick = typeof params === 'object' && params.jsClick === true;
    const verify = typeof params === 'object' && params.verify === true;
    const force = typeof params === 'object' && params.force === true;
    const debug = typeof params === 'object' && params.debug === true;
    const waitForNavigation = typeof params === 'object' && params.waitForNavigation === true;
    const navigationTimeout = typeof params === 'object' ? params.navigationTimeout : undefined;
    const exact = typeof params === 'object' && params.exact === true;
    const tag = typeof params === 'object' ? params.tag : null;
    // Feature 6: Auto-wait after click
    const waitAfter = typeof params === 'object' && params.waitAfter === true;
    const waitAfterOptions = typeof params === 'object' ? params.waitAfterOptions : {};
    // Feature 10: Scroll until visible
    const scrollUntilVisible = typeof params === 'object' && params.scrollUntilVisible === true;
    const scrollOptions = typeof params === 'object' ? params.scrollOptions : {};

    // Detect if string selector looks like a ref (e.g., "e1", "e12", "e123")
    // This allows {"click": "e1"} to work the same as {"click": {"ref": "e1"}}
    if (!ref && selector && /^e\d+$/.test(selector)) {
      ref = selector;
    }

    // Handle coordinate-based click
    if (typeof params === 'object' && typeof params.x === 'number' && typeof params.y === 'number') {
      return clickAtCoordinates(params.x, params.y, { debug, waitForNavigation, navigationTimeout, waitAfter, waitAfterOptions });
    }

    // Handle click by ref
    if (ref && ariaSnapshot) {
      return clickByRef(ref, jsClick, { waitForNavigation, navigationTimeout, force, debug, waitAfter, waitAfterOptions });
    }

    // Handle click by visible text (Feature 5)
    if (text) {
      return clickByText(text, { exact, tag, jsClick, verify, force, debug, waitForNavigation, navigationTimeout, waitAfter, waitAfterOptions });
    }

    // Handle multi-selector fallback (Feature 1)
    if (selectors && Array.isArray(selectors)) {
      return clickWithMultiSelector(selectors, { jsClick, verify, force, debug, waitForNavigation, navigationTimeout, waitAfter, waitAfterOptions });
    }

    // Feature 10: If scrollUntilVisible is set, first scroll to find the element
    if (scrollUntilVisible && selector) {
      const scrollResult = await actionabilityChecker.scrollUntilVisible(selector, scrollOptions);
      if (!scrollResult.found) {
        throw elementNotFoundError(selector, scrollOptions.timeout || 30000);
      }
      // Release the objectId from scroll search since clickBySelector will find it again
      if (scrollResult.objectId) {
        try {
          await releaseObject(session, scrollResult.objectId);
        } catch { /* ignore cleanup errors */ }
      }
      // Element found, now proceed with normal click
      // The scrollUntilVisible already scrolled it into view, so the actionability check should pass
    }

    return clickBySelector(selector, { jsClick, verify, force, debug, waitForNavigation, navigationTimeout, waitAfter, waitAfterOptions });
  }

  /**
   * Click using multiple selectors with fallback (Feature 1)
   * Tries selectors in order until one succeeds
   * @param {Array} selectors - Array of selectors to try
   * @param {Object} opts - Click options
   * @returns {Promise<Object>} Click result
   */
  async function clickWithMultiSelector(selectors, opts = {}) {
    const errors = [];

    for (const selectorSpec of selectors) {
      try {
        // Handle role-based selector objects
        if (typeof selectorSpec === 'object' && selectorSpec.role) {
          const { role, name } = selectorSpec;
          const elements = await elementLocator.queryByRole(role, { name });
          if (elements.length > 0) {
            const element = elements[0];
            const result = await clickBySelector(element.selector || `[role="${role}"]`, opts);
            result.usedSelector = selectorSpec;
            result.selectorIndex = selectors.indexOf(selectorSpec);
            return result;
          }
          errors.push({ selector: selectorSpec, error: `No elements found with role="${role}"${name ? ` and name="${name}"` : ''}` });
          continue;
        }

        // Handle regular CSS selector
        const result = await clickBySelector(selectorSpec, opts);
        result.usedSelector = selectorSpec;
        result.selectorIndex = selectors.indexOf(selectorSpec);
        return result;
      } catch (e) {
        errors.push({ selector: selectorSpec, error: e.message });
      }
    }

    // All selectors failed
    const errorMessages = errors.map((e, i) => `  ${i + 1}. ${typeof e.selector === 'object' ? JSON.stringify(e.selector) : e.selector}: ${e.error}`).join('\n');
    throw new Error(`All ${selectors.length} selectors failed:\n${errorMessages}`);
  }

  return {
    execute,
    clickByText,
    clickWithMultiSelector
  };
}

// ============================================================================
// Fill Executor (from FillExecutor.js)
// ============================================================================

/**
 * Create a fill executor for handling fill operations
 * @param {Object} session - CDP session
 * @param {Object} elementLocator - Element locator instance
 * @param {Object} inputEmulator - Input emulator instance
 * @param {Object} [ariaSnapshot] - Optional ARIA snapshot instance
 * @returns {Object} Fill executor interface
 */
export function createFillExecutor(session, elementLocator, inputEmulator, ariaSnapshot = null) {
  if (!session) throw new Error('CDP session is required');
  if (!elementLocator) throw new Error('Element locator is required');
  if (!inputEmulator) throw new Error('Input emulator is required');

  const actionabilityChecker = createActionabilityChecker(session);
  const elementValidator = createElementValidator(session);
  const reactInputFiller = createReactInputFiller(session);

  async function fillByRef(ref, value, opts = {}) {
    const { clear = true, react = false } = opts;

    if (!ariaSnapshot) {
      throw new Error('ariaSnapshot is required for ref-based fills');
    }

    const refInfo = await ariaSnapshot.getElementByRef(ref);
    if (!refInfo) {
      throw elementNotFoundError(`ref:${ref}`, 0);
    }

    if (refInfo.stale) {
      throw new Error(`Element ref:${ref} is no longer attached to the DOM. Page content may have changed. Run 'snapshot' again to get fresh refs.`);
    }

    if (refInfo.isVisible === false) {
      throw new Error(`Element ref:${ref} exists but is not visible. It may be hidden or have zero dimensions.`);
    }

    const elementResult = await session.send('Runtime.evaluate', {
      expression: `(function() {
        const el = window.__ariaRefs && window.__ariaRefs.get(${JSON.stringify(ref)});
        return el;
      })()`,
      returnByValue: false
    });

    if (!elementResult.result.objectId) {
      throw elementNotFoundError(`ref:${ref}`, 0);
    }

    const objectId = elementResult.result.objectId;

    const editableCheck = await elementValidator.isEditable(objectId);
    if (!editableCheck.editable) {
      await releaseObject(session, objectId);
      throw elementNotEditableError(`ref:${ref}`, editableCheck.reason);
    }

    try {
      if (react) {
        await reactInputFiller.fillByObjectId(objectId, value);
        return { filled: true, ref, method: 'react' };
      }

      await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          this.scrollIntoView({ block: 'center', behavior: 'instant' });
        }`
      });

      await sleep(100);

      const x = refInfo.box.x + refInfo.box.width / 2;
      const y = refInfo.box.y + refInfo.box.height / 2;
      await inputEmulator.click(x, y);

      await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() { this.focus(); }`
      });

      if (clear) {
        await inputEmulator.selectAll();
      }

      await inputEmulator.type(String(value));

      return { filled: true, ref, method: 'keyboard' };
    } finally {
      await releaseObject(session, objectId);
    }
  }

  async function fillBySelector(selector, value, opts = {}) {
    const { clear = true, react = false, force = false, timeout = 5000 } = opts;  // Reduced from 30s

    const waitResult = await actionabilityChecker.waitForActionable(selector, 'fill', {
      timeout,
      force
    });

    if (!waitResult.success) {
      if (waitResult.missingState === 'editable') {
        throw elementNotEditableError(selector, waitResult.error);
      }
      throw new Error(`Element not actionable: ${waitResult.error}`);
    }

    const objectId = waitResult.objectId;

    try {
      if (react) {
        await reactInputFiller.fillByObjectId(objectId, value);
        return { filled: true, selector, method: 'react' };
      }

      const point = await actionabilityChecker.getClickablePoint(objectId);
      if (!point) {
        throw new Error('Could not determine click point for element');
      }

      await inputEmulator.click(point.x, point.y);

      await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() { this.focus(); }`
      });

      if (clear) {
        await inputEmulator.selectAll();
      }

      await inputEmulator.type(String(value));

      return { filled: true, selector, method: 'keyboard' };
    } catch (e) {
      await resetInputState(session);
      throw e;
    } finally {
      await releaseObject(session, objectId);
    }
  }

  /**
   * Find an input element by its associated label text (Feature 9)
   * Search order: label[for] → nested input in label → aria-label → placeholder
   * @param {string} labelText - Label text to search for
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.exact=false] - Require exact match
   * @returns {Promise<{objectId: string, method: string}|null>} Element info or null
   */
  async function findInputByLabel(labelText, opts = {}) {
    const { exact = false } = opts;
    const labelTextJson = JSON.stringify(labelText);
    const labelTextLowerJson = JSON.stringify(labelText.toLowerCase());

    const expression = `
      (function() {
        const labelText = ${labelTextJson};
        const labelTextLower = ${labelTextLowerJson};
        const exact = ${exact};

        function matchesText(text) {
          if (!text) return false;
          if (exact) {
            return text.trim() === labelText;
          }
          return text.toLowerCase().includes(labelTextLower);
        }

        function isEditable(el) {
          if (!el || !el.isConnected) return false;
          const tag = el.tagName.toLowerCase();
          if (tag === 'textarea') return true;
          if (tag === 'select') return true;
          if (el.isContentEditable) return true;
          if (tag === 'input') {
            const type = (el.type || 'text').toLowerCase();
            const editableTypes = ['text', 'password', 'email', 'number', 'search', 'tel', 'url', 'date', 'datetime-local', 'month', 'time', 'week'];
            return editableTypes.includes(type);
          }
          return false;
        }

        function isVisible(el) {
          if (!el.isConnected) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        // 1. Search label[for] pointing to an input
        const labels = document.querySelectorAll('label[for]');
        for (const label of labels) {
          if (matchesText(label.textContent)) {
            const input = document.getElementById(label.getAttribute('for'));
            if (input && isEditable(input) && isVisible(input)) {
              return { element: input, method: 'label-for' };
            }
          }
        }

        // 2. Search for nested input inside label
        const allLabels = document.querySelectorAll('label');
        for (const label of allLabels) {
          if (matchesText(label.textContent)) {
            const input = label.querySelector('input, textarea, select');
            if (input && isEditable(input) && isVisible(input)) {
              return { element: input, method: 'label-nested' };
            }
          }
        }

        // 3. Search by aria-label attribute
        const ariaElements = document.querySelectorAll('[aria-label]');
        for (const el of ariaElements) {
          if (matchesText(el.getAttribute('aria-label'))) {
            if (isEditable(el) && isVisible(el)) {
              return { element: el, method: 'aria-label' };
            }
          }
        }

        // 4. Search by aria-labelledby
        const ariaLabelledByElements = document.querySelectorAll('[aria-labelledby]');
        for (const el of ariaLabelledByElements) {
          const labelId = el.getAttribute('aria-labelledby');
          const labelEl = document.getElementById(labelId);
          if (labelEl && matchesText(labelEl.textContent)) {
            if (isEditable(el) && isVisible(el)) {
              return { element: el, method: 'aria-labelledby' };
            }
          }
        }

        // 5. Search by placeholder attribute
        const placeholderElements = document.querySelectorAll('[placeholder]');
        for (const el of placeholderElements) {
          if (matchesText(el.getAttribute('placeholder'))) {
            if (isEditable(el) && isVisible(el)) {
              return { element: el, method: 'placeholder' };
            }
          }
        }

        return null;
      })()
    `;

    let result;
    try {
      result = await session.send('Runtime.evaluate', {
        expression,
        returnByValue: false
      });
    } catch (error) {
      throw connectionError(error.message, 'Runtime.evaluate (findInputByLabel)');
    }

    if (result.exceptionDetails) {
      throw new Error(`Label search error: ${result.exceptionDetails.text}`);
    }

    if (result.result.subtype === 'null' || result.result.type === 'undefined') {
      return null;
    }

    // The result is an object with element and method
    // We need to get the element's objectId
    const objId = result.result.objectId;
    const propsResult = await session.send('Runtime.getProperties', {
      objectId: objId,
      ownProperties: true
    });

    let elementObjectId = null;
    let method = null;

    for (const prop of propsResult.result) {
      if (prop.name === 'element' && prop.value && prop.value.objectId) {
        elementObjectId = prop.value.objectId;
      }
      if (prop.name === 'method' && prop.value) {
        method = prop.value.value;
      }
    }

    // Release the wrapper object
    await releaseObject(session, objId);

    if (!elementObjectId) {
      return null;
    }

    return { objectId: elementObjectId, method };
  }

  /**
   * Fill an input field by its label text (Feature 9)
   * @param {string} label - Label text to find
   * @param {*} value - Value to fill
   * @param {Object} [opts] - Options
   * @returns {Promise<Object>} Fill result
   */
  async function fillByLabel(label, value, opts = {}) {
    const { clear = true, react = false, exact = false } = opts;

    const inputInfo = await findInputByLabel(label, { exact });
    if (!inputInfo) {
      throw elementNotFoundError(`label:"${label}"`, 0);
    }

    const { objectId, method: foundMethod } = inputInfo;

    const editableCheck = await elementValidator.isEditable(objectId);
    if (!editableCheck.editable) {
      await releaseObject(session, objectId);
      throw elementNotEditableError(`label:"${label}"`, editableCheck.reason);
    }

    try {
      if (react) {
        await reactInputFiller.fillByObjectId(objectId, value);
        return { filled: true, label, method: 'react', foundBy: foundMethod };
      }

      // Scroll into view
      await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          this.scrollIntoView({ block: 'center', behavior: 'instant' });
        }`
      });

      await sleep(100);

      // Get element bounds for clicking
      const boxResult = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          const rect = this.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }`,
        returnByValue: true
      });

      const box = boxResult.result.value;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await inputEmulator.click(x, y);

      // Focus the element
      await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() { this.focus(); }`
      });

      if (clear) {
        await inputEmulator.selectAll();
      }

      await inputEmulator.type(String(value));

      return { filled: true, label, method: 'keyboard', foundBy: foundMethod };
    } catch (e) {
      await resetInputState(session);
      throw e;
    } finally {
      await releaseObject(session, objectId);
    }
  }

  async function execute(params) {
    let { selector, ref, label, value, clear = true, react = false, exact = false } = params;

    if (value === undefined) {
      throw new Error('Fill requires value');
    }

    // Detect if selector looks like a ref (e.g., "e1", "e12", "e123")
    // This allows {"fill": {"selector": "e1", "value": "..."}} to work like {"fill": {"ref": "e1", "value": "..."}}
    if (!ref && selector && /^e\d+$/.test(selector)) {
      ref = selector;
    }

    // Handle fill by ref
    if (ref && ariaSnapshot) {
      return fillByRef(ref, value, { clear, react });
    }

    // Handle fill by label (Feature 9)
    if (label) {
      return fillByLabel(label, value, { clear, react, exact });
    }

    if (!selector) {
      throw new Error('Fill requires selector, ref, or label');
    }

    return fillBySelector(selector, value, { clear, react });
  }

  async function executeBatch(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('fillForm requires an object mapping selectors to values');
    }

    // Support both formats:
    // Simple: {"#firstName": "John", "#lastName": "Doe"}
    // Extended: {"fields": {"#firstName": "John"}, "react": true}
    let fields;
    let useReact = false;

    if (params.fields && typeof params.fields === 'object') {
      // Extended format with fields and react options
      fields = params.fields;
      useReact = params.react === true;
    } else {
      // Simple format - params is the fields object directly
      fields = params;
    }

    const entries = Object.entries(fields);
    if (entries.length === 0) {
      throw new Error('fillForm requires at least one field');
    }

    const results = [];
    const errors = [];

    for (const [selector, value] of entries) {
      try {
        const isRef = /^e\d+$/.test(selector);

        if (isRef) {
          await fillByRef(selector, value, { clear: true, react: useReact });
        } else {
          await fillBySelector(selector, value, { clear: true, react: useReact });
        }

        results.push({ selector, status: 'filled', value: String(value) });
      } catch (error) {
        errors.push({ selector, error: error.message });
        results.push({ selector, status: 'failed', error: error.message });
      }
    }

    return {
      total: entries.length,
      filled: results.filter(r => r.status === 'filled').length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  return {
    execute,
    executeBatch
  };
}

// ============================================================================
// Keyboard Executor (from KeyboardStepExecutor.js)
// ============================================================================

/**
 * Create a keyboard executor for handling type and select operations
 * @param {Object} session - CDP session
 * @param {Object} elementLocator - Element locator instance
 * @param {Object} inputEmulator - Input emulator instance
 * @returns {Object} Keyboard executor interface
 */
export function createKeyboardExecutor(session, elementLocator, inputEmulator) {
  const validator = createElementValidator(session);

  async function executeType(params) {
    const { selector, text, delay = 0 } = params;

    if (!selector || text === undefined) {
      throw new Error('Type requires selector and text');
    }

    const element = await elementLocator.findElement(selector);
    if (!element) {
      throw elementNotFoundError(selector, 0);
    }

    const editableCheck = await validator.isEditable(element._handle.objectId);
    if (!editableCheck.editable) {
      await element._handle.dispose();
      throw elementNotEditableError(selector, editableCheck.reason);
    }

    try {
      await element._handle.scrollIntoView({ block: 'center' });
      await element._handle.waitForStability({ frames: 2, timeout: 500 });

      await element._handle.focus();

      await inputEmulator.type(String(text), { delay });

      return {
        selector,
        typed: String(text),
        length: String(text).length
      };
    } finally {
      await element._handle.dispose();
    }
  }

  async function executeSelect(params) {
    let selector;
    let start = null;
    let end = null;

    if (typeof params === 'string') {
      selector = params;
    } else if (params && typeof params === 'object') {
      selector = params.selector;
      start = params.start !== undefined ? params.start : null;
      end = params.end !== undefined ? params.end : null;
    } else {
      throw new Error('Select requires a selector string or params object');
    }

    if (!selector) {
      throw new Error('Select requires selector');
    }

    const element = await elementLocator.findElement(selector);
    if (!element) {
      throw elementNotFoundError(selector, 0);
    }

    try {
      await element._handle.scrollIntoView({ block: 'center' });
      await element._handle.waitForStability({ frames: 2, timeout: 500 });

      await element._handle.focus();

      const result = await session.send('Runtime.callFunctionOn', {
        objectId: element._handle.objectId,
        functionDeclaration: `function(start, end) {
          const el = this;
          const tagName = el.tagName.toLowerCase();

          if (tagName === 'input' || tagName === 'textarea') {
            const len = el.value.length;
            const selStart = start !== null ? Math.min(start, len) : 0;
            const selEnd = end !== null ? Math.min(end, len) : len;

            el.focus();
            el.setSelectionRange(selStart, selEnd);

            return {
              success: true,
              start: selStart,
              end: selEnd,
              selectedText: el.value.substring(selStart, selEnd),
              totalLength: len
            };
          }

          if (el.isContentEditable) {
            const range = document.createRange();
            const text = el.textContent || '';
            const len = text.length;
            const selStart = start !== null ? Math.min(start, len) : 0;
            const selEnd = end !== null ? Math.min(end, len) : len;

            let currentPos = 0;
            let startNode = null, startOffset = 0;
            let endNode = null, endOffset = 0;

            function findPosition(node, target) {
              if (node.nodeType === Node.TEXT_NODE) {
                const nodeLen = node.textContent.length;
                if (!startNode && currentPos + nodeLen >= selStart) {
                  startNode = node;
                  startOffset = selStart - currentPos;
                }
                if (!endNode && currentPos + nodeLen >= selEnd) {
                  endNode = node;
                  endOffset = selEnd - currentPos;
                  return true;
                }
                currentPos += nodeLen;
              } else {
                for (const child of node.childNodes) {
                  if (findPosition(child, target)) return true;
                }
              }
              return false;
            }

            findPosition(el, null);

            if (startNode && endNode) {
              range.setStart(startNode, startOffset);
              range.setEnd(endNode, endOffset);

              const selection = window.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);

              return {
                success: true,
                start: selStart,
                end: selEnd,
                selectedText: text.substring(selStart, selEnd),
                totalLength: len
              };
            }
          }

          return {
            success: false,
            reason: 'Element does not support text selection'
          };
        }`,
        arguments: [
          { value: start },
          { value: end }
        ],
        returnByValue: true
      });

      const selectionResult = result.result.value;

      if (!selectionResult.success) {
        throw new Error(selectionResult.reason || 'Selection failed');
      }

      return {
        selector,
        start: selectionResult.start,
        end: selectionResult.end,
        selectedText: selectionResult.selectedText,
        totalLength: selectionResult.totalLength
      };
    } finally {
      await element._handle.dispose();
    }
  }

  return {
    executeType,
    executeSelect
  };
}

// ============================================================================
// Wait Executor (from WaitExecutor.js)
// ============================================================================

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
   * Wait for selector using browser-side MutationObserver (improvement #3)
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
   * Wait for text using browser-side MutationObserver (improvement #3)
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

// ============================================================================
// Convenience Functions
// ============================================================================

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
