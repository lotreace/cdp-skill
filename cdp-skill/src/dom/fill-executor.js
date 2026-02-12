/**
 * Fill Executor
 * High-level form filling operations with actionability checking
 *
 * EXPORTS:
 * - createFillExecutor(session, elementLocator, inputEmulator, ariaSnapshot?) → FillExecutor
 *   Methods: execute, executeBatch
 *
 * DEPENDENCIES:
 * - ./actionability.js: createActionabilityChecker
 * - ./element-validator.js: createElementValidator
 * - ./react-filler.js: createReactInputFiller
 * - ../utils.js: sleep, elementNotFoundError, elementNotEditableError, connectionError, releaseObject, resetInputState
 */

import { createActionabilityChecker } from './actionability.js';
import { createElementValidator } from './element-validator.js';
import { createReactInputFiller } from './react-filler.js';
import { createLazyResolver } from './LazyResolver.js';
import {
  sleep,
  elementNotFoundError,
  elementNotEditableError,
  connectionError,
  releaseObject,
  resetInputState
} from '../utils.js';

/**
 * Create a fill executor for handling fill operations
 * @param {Object} session - CDP session
 * @param {Object} elementLocator - Element locator instance
 * @param {Object} inputEmulator - Input emulator instance
 * @param {Object} [ariaSnapshot] - Optional ARIA snapshot instance
 * @param {Object} [options] - Configuration options
 * @param {Function} [options.getFrameContext] - Returns contextId when in a non-main frame
 * @returns {Object} Fill executor interface
 */
export function createFillExecutor(session, elementLocator, inputEmulator, ariaSnapshot = null, options = {}) {
  if (!session) throw new Error('CDP session is required');
  if (!elementLocator) throw new Error('Element locator is required');
  if (!inputEmulator) throw new Error('Input emulator is required');

  const getFrameContext = options.getFrameContext || null;
  const actionabilityChecker = createActionabilityChecker(session);
  const elementValidator = createElementValidator(session);
  const reactInputFiller = createReactInputFiller(session);
  const lazyResolver = createLazyResolver(session, { getFrameContext });

  /**
   * Build Runtime.evaluate params, injecting contextId when in an iframe.
   */
  function evalParams(expression, returnByValue = false) {
    const params = { expression, returnByValue };
    if (getFrameContext) {
      const contextId = getFrameContext();
      if (contextId) params.contextId = contextId;
    }
    return params;
  }

  /**
   * Select all and fill with value, handling the empty-string case.
   * When value is "" and clear is true, presses Delete after selectAll
   * to actually remove the selected content (insertText("") is a no-op).
   */
  async function selectAndFill(value, clear) {
    if (clear) {
      await inputEmulator.selectAll();
    }
    if (value === '' && clear) {
      // insertText("") is a no-op in CDP — press Delete to remove selected text
      await inputEmulator.press('Delete');
      // Dispatch input/change events so frameworks (React, Vue, etc.) react to the clear
      await session.send('Runtime.evaluate', evalParams(`
        (function() {
          const el = document.activeElement;
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          }
        })()
      `, true));
    } else {
      await inputEmulator.insertText(String(value));
    }
  }

  async function fillByRef(ref, value, opts = {}) {
    const { clear = true, react = false } = opts;

    // LAZY RESOLUTION: Always resolve ref from metadata, never rely on cached element
    // This eliminates stale element errors entirely
    const resolved = await lazyResolver.resolveRef(ref);
    if (!resolved) {
      throw elementNotFoundError(`ref:${ref}`, 0);
    }

    const objectId = resolved.objectId;

    // Get visibility info using the resolved element
    const visibilityResult = await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        const style = window.getComputedStyle(this);
        const rect = this.getBoundingClientRect();
        return {
          isVisible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0,
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      }`,
      returnByValue: true
    });

    const refInfo = {
      box: visibilityResult.result?.value?.box || resolved.box,
      isVisible: visibilityResult.result?.value?.isVisible ?? true
    };

    if (refInfo.isVisible === false) {
      await releaseObject(session, objectId);
      throw new Error(`Element ref:${ref} exists but is not visible. It may be hidden or have zero dimensions.`);
    }

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

      await selectAndFill(value, clear);

      return { filled: true, ref, method: 'insertText' };
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

      await selectAndFill(value, clear);

      return { filled: true, selector, method: 'insertText' };
    } catch (e) {
      await resetInputState(session);
      throw e;
    } finally {
      await releaseObject(session, objectId);
    }
  }

  /**
   * Find an input element by its associated label text
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
      result = await session.send('Runtime.evaluate',
        evalParams(expression, false)
      );
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
   * Fill an input field by its label text
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

      await selectAndFill(value, clear);

      return { filled: true, label, method: 'insertText', foundBy: foundMethod };
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

    // Detect if selector looks like a versioned ref (f{frameId}s{N}e{M})
    // This allows {"fill": {"selector": "f0s1e1", "value": "..."}} to work like {"fill": {"ref": "f0s1e1", "value": "..."}}
    if (!ref && selector && /^f(\d+|\[[^\]]+\])s\d+e\d+$/.test(selector)) {
      ref = selector;
    }

    // Handle fill by ref
    if (ref && ariaSnapshot) {
      return fillByRef(ref, value, { clear, react });
    }

    // Handle fill by label
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
      throw new Error('fill batch requires an object mapping selectors to values');
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
      throw new Error('fill batch requires at least one field');
    }

    const results = [];
    const errors = [];

    for (const [selector, value] of entries) {
      try {
        // Match versioned ref format f{frameId}s{N}e{M}
        const isRef = /^f(\d+|\[[^\]]+\])s\d+e\d+$/.test(selector);

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
