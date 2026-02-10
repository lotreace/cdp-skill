/**
 * Input Executors
 * Fill and select step executors
 *
 * EXPORTS:
 * - executeFill(elementLocator, inputEmulator, params) → Promise<void>
 * - executeFillActive(pageController, inputEmulator, params) → Promise<Object>
 * - executeSelectOption(elementLocator, params) → Promise<Object>
 *
 * DEPENDENCIES:
 * - ../dom/index.js: createElementValidator, createReactInputFiller
 * - ../utils.js: elementNotFoundError, elementNotEditableError, resetInputState
 */

import { createElementValidator, createReactInputFiller } from '../dom/index.js';
import { elementNotFoundError, elementNotEditableError, resetInputState } from '../utils.js';

export async function executeFill(elementLocator, inputEmulator, params) {
  const { selector, value, react } = params;

  if (!selector || value === undefined) {
    throw new Error('Fill requires selector and value');
  }

  const element = await elementLocator.findElement(selector);
  if (!element) {
    throw elementNotFoundError(selector, 0);
  }

  // Validate element is editable before attempting fill
  const validator = createElementValidator(elementLocator.session);
  const editableCheck = await validator.isEditable(element._handle.objectId);
  if (!editableCheck.editable) {
    await element._handle.dispose();
    throw elementNotEditableError(selector, editableCheck.reason);
  }

  // Try fast path first - scroll to center with short stability check
  let actionable;
  try {
    await element._handle.scrollIntoView({ block: 'center' });
    // Use short stability timeout - most elements stabilize quickly
    await element._handle.waitForStability({ frames: 2, timeout: 300 });
    actionable = await element._handle.isActionable();
  } catch (e) {
    // Stability check failed, check actionability anyway
    actionable = await element._handle.isActionable();
  }

  // If not actionable, try alternative scroll strategies
  if (!actionable.actionable) {
    let lastError = new Error(`Element not actionable: ${actionable.reason}`);

    for (const strategy of ['end', 'start', 'nearest']) {
      try {
        await element._handle.scrollIntoView({ block: strategy });
        await element._handle.waitForStability({ frames: 2, timeout: 500 });
        actionable = await element._handle.isActionable();

        if (actionable.actionable) break;
        lastError = new Error(`Element not actionable: ${actionable.reason}`);
      } catch (e) {
        lastError = e;
      }
    }

    if (!actionable.actionable) {
      await element._handle.dispose();
      await resetInputState(elementLocator.session);
      throw lastError;
    }
  }

  try {
    // Use React-specific fill approach if react option is set
    if (react) {
      const reactFiller = createReactInputFiller(elementLocator.session);
      await reactFiller.fillByObjectId(element._handle.objectId, value);
      return; // Success
    }

    // Standard fill approach using keyboard events
    const box = await element._handle.getBoundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // Click to focus
    await inputEmulator.click(x, y);

    // Focus element directly - more reliable than relying on click
    await element._handle.focus();

    if (params.clear !== false) {
      await inputEmulator.selectAll();
    }

    await inputEmulator.type(String(value));
  } catch (e) {
    await resetInputState(elementLocator.session);
    throw e;
  } finally {
    await element._handle.dispose();
  }
}

/**
 * Execute a selectOption step - select option in dropdown
 */
export async function executeSelectOption(elementLocator, params) {
  const selector = params.selector;
  const value = params.value;
  const label = params.label;
  const index = params.index;
  const values = params.values; // for multi-select

  if (!selector) {
    throw new Error('selectOption requires selector');
  }
  if (value === undefined && label === undefined && index === undefined && !values) {
    throw new Error('selectOption requires value, label, index, or values');
  }

  const element = await elementLocator.findElement(selector);
  if (!element) {
    throw elementNotFoundError(selector, 0);
  }

  try {
    const result = await elementLocator.session.send('Runtime.callFunctionOn', {
      objectId: element._handle.objectId,
      functionDeclaration: `function(matchBy, matchValue, matchValues) {
        const el = this;

        // Validate element is a select
        if (!(el instanceof HTMLSelectElement)) {
          return { error: 'Element is not a <select> element' };
        }

        const selectedValues = [];
        const isMultiple = el.multiple;
        const options = Array.from(el.options);

        // Build match function based on type
        let matchFn;
        if (matchBy === 'value') {
          const valuesToMatch = matchValues ? matchValues : [matchValue];
          matchFn = (opt) => valuesToMatch.includes(opt.value);
        } else if (matchBy === 'label') {
          matchFn = (opt) => opt.textContent.trim() === matchValue || opt.label === matchValue;
        } else if (matchBy === 'index') {
          matchFn = (opt, idx) => idx === matchValue;
        } else {
          return { error: 'Invalid match type' };
        }

        // For single-select, deselect all first
        if (!isMultiple) {
          for (const option of options) {
            option.selected = false;
          }
        }

        // Select matching options
        let matched = false;
        for (let i = 0; i < options.length; i++) {
          const option = options[i];
          if (matchFn(option, i)) {
            option.selected = true;
            selectedValues.push(option.value);
            matched = true;
            if (!isMultiple) break; // Single select stops at first match
          }
        }

        if (!matched) {
          return {
            error: 'No option matched',
            matchBy,
            matchValue: matchValues || matchValue,
            availableOptions: options.slice(0, 10).map(o => ({ value: o.value, label: o.textContent.trim() }))
          };
        }

        // Dispatch events (same as Puppeteer)
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        return {
          success: true,
          selected: selectedValues,
          multiple: isMultiple
        };
      }`,
      arguments: [
        { value: values ? 'value' : (value !== undefined ? 'value' : (label !== undefined ? 'label' : 'index')) },
        { value: value !== undefined ? value : (label !== undefined ? label : index) },
        { value: values || null }
      ],
      returnByValue: true
    });

    const selectResult = result.result.value;

    if (selectResult.error) {
      const errorMsg = selectResult.error;
      if (selectResult.availableOptions) {
        throw new Error(`${errorMsg}. Available options: ${JSON.stringify(selectResult.availableOptions)}`);
      }
      throw new Error(errorMsg);
    }

    return {
      selected: selectResult.selected,
      multiple: selectResult.multiple
    };
  } finally {
    await element._handle.dispose();
  }
}

/**
 * Execute a getDom step - get raw HTML of page or element
 * @param {Object} pageController - Page controller
 * @param {boolean|string|Object} params - true for full page, selector string, or options object
 * @returns {Promise<Object>} DOM content
 */

export async function executeFillActive(pageController, inputEmulator, params) {
  const session = pageController.session;

  // Parse params
  const value = typeof params === 'string' ? params : (params && params.value);
  const clear = typeof params === 'object' && params !== null ? params.clear !== false : true;

  // Check if there's an active element and if it's editable
  const checkResult = await session.send('Runtime.evaluate', {
    expression: `(function() {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) {
        return { error: 'No element is focused' };
      }

      const tag = el.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const isContentEditable = el.isContentEditable;

      if (!isInput && !isContentEditable) {
        return { error: 'Focused element is not editable', tag: tag };
      }

      // Check if disabled or readonly
      if (el.disabled) {
        return { error: 'Focused element is disabled', tag: tag };
      }
      if (el.readOnly) {
        return { error: 'Focused element is readonly', tag: tag };
      }

      // Build selector for reporting
      let selector = tag.toLowerCase();
      if (el.id) {
        selector = '#' + el.id;
      } else if (el.name) {
        selector = '[name="' + el.name + '"]';
      }

      return {
        editable: true,
        tag: tag,
        type: tag === 'INPUT' ? (el.type || 'text') : null,
        selector: selector,
        valueBefore: el.value || ''
      };
    })()`,
    returnByValue: true
  });

  if (checkResult.exceptionDetails) {
    throw new Error(`fillActive error: ${checkResult.exceptionDetails.text}`);
  }

  const check = checkResult.result.value;
  if (check.error) {
    throw new Error(check.error);
  }

  // Clear existing content if requested
  if (clear) {
    await inputEmulator.selectAll();
  }

  // Type the new value
  await inputEmulator.type(String(value));

  return {
    filled: true,
    tag: check.tag,
    type: check.type,
    selector: check.selector,
    valueBefore: check.valueBefore,
    valueAfter: value
  };
}

/**
 * Execute a refAt step - get or create a ref for the element at given coordinates
 * Uses document.elementFromPoint to find the element, then assigns/retrieves a ref
 */
