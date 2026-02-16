/**
 * Input Executors
 * Fill and select step executors
 *
 * EXPORTS:
 * - executeFillActive(pageController, inputEmulator, params) → Promise<Object>
 * - executeSelectOption(elementLocator, params) → Promise<Object>
 *
 * DEPENDENCIES:
 * - ../utils.js: elementNotFoundError
 */

import { elementNotFoundError } from '../utils.js';

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
  // Parse params
  const value = typeof params === 'string' ? params : (params && params.value);
  const clear = typeof params === 'object' && params !== null ? params.clear !== false : true;

  // Check if there's an active element and if it's editable
  const checkResult = await pageController.evaluateInFrame(`(function() {
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
    })()`);


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
 * Execute an upload step - set files on a file input element via CDP
 * Uses DOM.setFileInputFiles to set file paths on <input type="file"> elements
 *
 * Shapes:
 *   {"upload": "/path/to/file.txt"}                           — single file, auto-find file input
 *   {"upload": ["/path/a.txt", "/path/b.png"]}                — multiple files, auto-find file input
 *   {"upload": {"selector": "#file-input", "file": "a.txt"}}  — targeted single file
 *   {"upload": {"selector": "#file-input", "files": ["a.txt", "b.png"]}} — targeted multiple files
 *   {"upload": {"ref": "f0s1e3", "files": ["a.txt"]}}         — ref-targeted
 */
export async function executeUpload(elementLocator, pageController, params) {
  const session = elementLocator.session;

  // Normalize params into { files, selector?, ref? }
  let files, selector, ref;
  if (typeof params === 'string') {
    files = [params];
  } else if (Array.isArray(params)) {
    files = params;
  } else {
    selector = params.selector;
    ref = params.ref;
    files = params.files || (params.file ? [params.file] : []);
  }

  // Find the file input element
  let objectId;
  try {
    if (ref) {
      // Resolve ref to objectId via aria refs
      const evalParams = {
        expression: `window.__ariaRefs && window.__ariaRefs.get(${JSON.stringify(ref)})`,
        returnByValue: false
      };
      const contextId = pageController.getFrameContext();
      if (contextId) evalParams.contextId = contextId;
      const result = await session.send('Runtime.evaluate', evalParams);
      if (!result.result.objectId) {
        throw new Error(`Element ref ${ref} not found — run 'snapshot' to get fresh refs`);
      }
      objectId = result.result.objectId;
    } else if (selector) {
      // Find by CSS selector
      const evalParams = {
        expression: `document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: false
      };
      const contextId = pageController.getFrameContext();
      if (contextId) evalParams.contextId = contextId;
      const result = await session.send('Runtime.evaluate', evalParams);
      if (!result.result.objectId) {
        throw elementNotFoundError(selector, 0);
      }
      objectId = result.result.objectId;
    } else {
      // Auto-find: look for a file input on the page
      const evalParams = {
        expression: `document.querySelector('input[type="file"]')`,
        returnByValue: false
      };
      const contextId = pageController.getFrameContext();
      if (contextId) evalParams.contextId = contextId;
      const result = await session.send('Runtime.evaluate', evalParams);
      if (!result.result.objectId) {
        throw new Error('No file input (input[type="file"]) found on the page');
      }
      objectId = result.result.objectId;
    }

    // Verify it's actually a file input
    const typeCheck = await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        return {
          tagName: this.tagName,
          type: this.type,
          accept: this.accept || '',
          multiple: this.hasAttribute('multiple')
        };
      }`,
      returnByValue: true
    });

    const info = typeCheck.result.value;
    if (!info || info.tagName !== 'INPUT' || info.type !== 'file') {
      throw new Error(`Target element is ${info?.tagName || 'unknown'} type="${info?.type || 'unknown'}" — expected input[type="file"]`);
    }

    if (files.length > 1 && !info.multiple) {
      throw new Error(`File input does not have 'multiple' attribute but ${files.length} files were provided`);
    }

    // Set files via CDP
    await session.send('DOM.setFileInputFiles', {
      objectId,
      files
    });

    // Dispatch change event so frameworks detect the file selection
    await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        this.dispatchEvent(new Event('change', { bubbles: true }));
        this.dispatchEvent(new Event('input', { bubbles: true }));
      }`
    });

    return {
      uploaded: true,
      files,
      accept: info.accept,
      multiple: info.multiple,
      target: selector || ref || 'input[type="file"]'
    };
  } finally {
    if (objectId) {
      try { await session.send('Runtime.releaseObject', { objectId }); } catch {}
    }
  }
}

/**
 * Execute a refAt step - get or create a ref for the element at given coordinates
 * Uses document.elementFromPoint to find the element, then assigns/retrieves a ref
 */
