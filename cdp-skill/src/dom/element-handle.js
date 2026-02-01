/**
 * Element Handle
 * Remote object handle for interacting with DOM elements via CDP
 *
 * EXPORTS:
 * - createElementHandle(session, objectId, options) → ElementHandle
 *   Methods: getBoundingBox, getContentQuads, getClickPoint, isConnectedToDOM,
 *            ensureConnected, isVisible, isInViewport, waitForInViewport,
 *            isActionable, scrollIntoView, focus, waitForStability, evaluate, dispose
 *
 * DEPENDENCIES:
 * - ./quad-helpers.js: calculateQuadCenter
 * - ../utils.js: sleep, staleElementError, isStaleElementError
 */

import { calculateQuadCenter } from './quad-helpers.js';
import {
  sleep,
  staleElementError,
  isStaleElementError
} from '../utils.js';

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
   * Check if element is in viewport using IntersectionObserver
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
