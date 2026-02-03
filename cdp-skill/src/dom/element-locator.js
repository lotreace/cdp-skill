/**
 * Element Locator
 * DOM element finding and waiting utilities
 *
 * EXPORTS:
 * - createElementLocator(session, options) → ElementLocator
 *   Methods: querySelector, querySelectorAll, queryByRole, waitForSelector,
 *            waitForText, findElement, findElementByText, findElementByTextWithinSelector,
 *            waitForElementByText, getBoundingBox, getDefaultTimeout, setDefaultTimeout
 *
 * DEPENDENCIES:
 * - ./element-handle.js: createElementHandle
 * - ../constants.js: TIMEOUTS
 * - ../utils.js: sleep, timeoutError, elementNotFoundError, connectionError
 */

import { createElementHandle } from './element-handle.js';
import { TIMEOUTS } from '../constants.js';
import {
  sleep,
  timeoutError,
  elementNotFoundError,
  connectionError
} from '../utils.js';

const MAX_TIMEOUT = TIMEOUTS.MAX;

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
   * Find an element by its visible text content within elements matching a selector
   * @param {string} text - Text to search for
   * @param {string} withinSelector - CSS selector to scope the search
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.exact=false] - Require exact text match
   * @param {string} [opts.tag] - Limit search to specific tag within the scoped elements
   * @returns {Promise<Object|null>} Element handle or null
   */
  async function findElementByTextWithinSelector(text, withinSelector, opts = {}) {
    if (!text || typeof text !== 'string') {
      throw new Error('Text must be a non-empty string');
    }
    if (!withinSelector || typeof withinSelector !== 'string') {
      throw new Error('Selector must be a non-empty string');
    }

    const { exact = false, tag = null } = opts;
    const textLower = text.toLowerCase();
    const textJson = JSON.stringify(text);
    const textLowerJson = JSON.stringify(textLower);
    const selectorJson = JSON.stringify(withinSelector);
    const tagJson = tag ? JSON.stringify(tag.toLowerCase()) : 'null';

    const expression = `
      (function() {
        const text = ${textJson};
        const textLower = ${textLowerJson};
        const exact = ${exact};
        const withinSelector = ${selectorJson};
        const tagFilter = ${tagJson};

        function getElementText(el) {
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return ariaLabel;
          if (el.tagName === 'INPUT') {
            return el.value || el.placeholder || '';
          }
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

        // Get all elements matching the selector
        const scopedElements = document.querySelectorAll(withinSelector);

        for (const scopedEl of scopedElements) {
          // Check if the scoped element itself matches the text
          if (isVisible(scopedEl)) {
            if (!tagFilter || scopedEl.tagName.toLowerCase() === tagFilter) {
              const elText = getElementText(scopedEl);
              if (matchesText(elText)) {
                return scopedEl;
              }
            }
          }

          // Search within the scoped element's descendants
          const descendants = tagFilter
            ? scopedEl.querySelectorAll(tagFilter)
            : scopedEl.querySelectorAll('*');

          for (const el of descendants) {
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
      throw connectionError(error.message, 'Runtime.evaluate (findElementByTextWithinSelector)');
    }

    if (result.exceptionDetails) {
      throw new Error(`Text search error: ${result.exceptionDetails.text}`);
    }

    if (result.result.subtype === 'null' || result.result.type === 'undefined') {
      return null;
    }

    return createElementHandle(session, result.result.objectId, { selector: `text:${text} within ${withinSelector}` });
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
    findElementByTextWithinSelector,
    waitForElementByText,
    getBoundingBox,
    getDefaultTimeout: () => defaultTimeout,
    setDefaultTimeout: (timeout) => { defaultTimeout = validateTimeout(timeout); }
  };
}
