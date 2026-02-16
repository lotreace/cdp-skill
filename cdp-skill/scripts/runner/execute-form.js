/**
 * Form Executors
 * Form validation, submission, state, and assertion step executors
 *
 * EXPORTS:
 * - executeFormState(formValidator, selector) → Promise<Object>
 * - executeExtract(deps, params) → Promise<Object>
 * - executeValidate(elementLocator, selector) → Promise<Object>
 * - executeSubmit(elementLocator, params) → Promise<Object>
 * - executeAssert(pageController, elementLocator, params) → Promise<Object>
 *
 * DEPENDENCIES:
 * - ../utils.js: createFormValidator
 */

import { createFormValidator } from '../utils.js';

export async function executeFormState(formValidator, selector) {
  if (!formValidator) {
    throw new Error('Form validator not available');
  }

  const formSelector = typeof selector === 'string' ? selector : selector.selector;
  if (!formSelector) {
    throw new Error('formState requires a selector');
  }

  return formValidator.getFormState(formSelector);
}

/**
 * Execute an extract step - extract structured data from tables/lists (Feature 11)
 * @param {Object} deps - Dependencies
 * @param {string|Object} params - Selector or options
 * @returns {Promise<Object>} Extracted data
 */

export async function executeExtract(deps, params) {
  const { pageController } = deps;
  const session = pageController.session;

  const selector = typeof params === 'string' ? params : params.selector;
  const type = typeof params === 'object' ? params.type : null; // 'table' or 'list'
  const limit = typeof params === 'object' ? params.limit : 100;

  if (!selector) {
    throw new Error('extract requires a selector');
  }

  const extractExpr = `
      (function() {
        const selector = ${JSON.stringify(selector)};
        const typeHint = ${JSON.stringify(type)};
        const limit = ${limit};
        const el = document.querySelector(selector);

        if (!el) {
          return { error: 'Element not found: ' + selector };
        }

        const tagName = el.tagName.toLowerCase();

        // Auto-detect type if not specified
        let detectedType = typeHint;
        if (!detectedType) {
          if (tagName === 'table') {
            detectedType = 'table';
          } else if (tagName === 'ul' || tagName === 'ol' || el.getAttribute('role') === 'list') {
            detectedType = 'list';
          } else if (el.querySelector('table')) {
            detectedType = 'table';
            // Use the inner table
          } else if (el.querySelector('ul, ol, [role="list"]')) {
            detectedType = 'list';
          } else {
            // Try to detect based on structure
            const rows = el.querySelectorAll('[role="row"], tr');
            if (rows.length > 0) {
              detectedType = 'table';
            } else {
              const items = el.querySelectorAll('[role="listitem"], li');
              if (items.length > 0) {
                detectedType = 'list';
              }
            }
          }
        }

        if (detectedType === 'table') {
          // Extract table data
          const tableEl = tagName === 'table' ? el : el.querySelector('table');
          if (!tableEl) {
            return { error: 'No table found', type: 'table' };
          }

          const headers = [];
          const rows = [];

          // Get headers from thead or first row
          const headerRow = tableEl.querySelector('thead tr') || tableEl.querySelector('tr');
          if (headerRow) {
            const headerCells = headerRow.querySelectorAll('th, td');
            for (const cell of headerCells) {
              headers.push((cell.textContent || '').trim());
            }
          }

          // Get data rows - prefer tbody rows, fall back to all rows
          const dataRows = tableEl.querySelector('tbody')
            ? tableEl.querySelectorAll('tbody tr')
            : tableEl.querySelectorAll('tr');
          let count = 0;
          for (const row of dataRows) {
            // Skip header row
            if (row === headerRow) continue;
            if (count >= limit) break;

            const cells = row.querySelectorAll('td, th');
            const rowData = [];
            for (const cell of cells) {
              rowData.push((cell.textContent || '').trim());
            }
            if (rowData.length > 0) {
              rows.push(rowData);
              count++;
            }
          }

          return {
            type: 'table',
            headers,
            rows,
            rowCount: rows.length
          };
        }

        if (detectedType === 'list') {
          // Extract list data
          const listEl = (tagName === 'ul' || tagName === 'ol') ? el :
                        el.querySelector('ul, ol, [role="list"]');

          const items = [];
          const listItems = listEl ?
            listEl.querySelectorAll(':scope > li, :scope > [role="listitem"]') :
            el.querySelectorAll('[role="listitem"], li');

          let count = 0;
          for (const item of listItems) {
            if (count >= limit) break;
            const text = (item.textContent || '').trim();
            if (text) {
              items.push(text);
              count++;
            }
          }

          return {
            type: 'list',
            items,
            itemCount: items.length
          };
        }

        // Fallback: extract text content when element is not a table or list
        const text = (el.textContent || '').trim();
        return { type: 'text', text, tagName };
      })()
    `;
  const extractArgs = { expression: extractExpr, returnByValue: true };
  const contextId = pageController.getFrameContext();
  if (contextId) extractArgs.contextId = contextId;
  const result = await session.send('Runtime.evaluate', extractArgs);

  if (result.exceptionDetails) {
    throw new Error('Extract error: ' + result.exceptionDetails.text);
  }

  const data = result.result.value;
  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

/**
 * Execute a selectOption step - selects option(s) in a native <select> element
 * Following Puppeteer's approach: set option.selected and dispatch events
 *
 * Usage:
 *   {"selectOption": {"selector": "#dropdown", "value": "optionValue"}}
 *   {"selectOption": {"selector": "#dropdown", "label": "Option Text"}}
 *   {"selectOption": {"selector": "#dropdown", "index": 2}}
 *   {"selectOption": {"selector": "#dropdown", "values": ["a", "b"]}}  // multiple select
 */

export async function executeValidate(elementLocator, selector) {
  const formValidator = createFormValidator(elementLocator.session, elementLocator);
  return formValidator.validateElement(selector);
}

/**
 * Execute a submit step - submit a form with validation error reporting
 */

export async function executeSubmit(elementLocator, params) {
  const selector = typeof params === 'string' ? params : params.selector;
  const options = typeof params === 'object' ? params : {};

  const formValidator = createFormValidator(elementLocator.session, elementLocator);
  return formValidator.submitForm(selector, options);
}

/**
 * Execute an assert step - validates conditions about the page
 * Supports URL assertions and text assertions
 */

export async function executeAssert(pageController, elementLocator, params) {
  const result = {
    passed: true,
    assertions: []
  };

  // URL assertion
  if (params.url) {
    const currentUrl = (await pageController.getUrl()) || '';
    const urlAssertion = { type: 'url', actual: currentUrl };

    if (params.url.contains) {
      urlAssertion.expected = { contains: params.url.contains };
      urlAssertion.passed = currentUrl.includes(params.url.contains);
    } else if (params.url.equals) {
      urlAssertion.expected = { equals: params.url.equals };
      urlAssertion.passed = currentUrl === params.url.equals;
    } else if (params.url.startsWith) {
      urlAssertion.expected = { startsWith: params.url.startsWith };
      urlAssertion.passed = currentUrl.startsWith(params.url.startsWith);
    } else if (params.url.endsWith) {
      urlAssertion.expected = { endsWith: params.url.endsWith };
      urlAssertion.passed = currentUrl.endsWith(params.url.endsWith);
    } else if (params.url.matches) {
      urlAssertion.expected = { matches: params.url.matches };
      const regex = new RegExp(params.url.matches);
      urlAssertion.passed = regex.test(currentUrl);
    }

    result.assertions.push(urlAssertion);
    if (!urlAssertion.passed) {
      result.passed = false;
    }
  }

  // Text assertion
  if (params.text) {
    const selector = params.selector || 'body';
    const caseSensitive = params.caseSensitive !== false;
    const textAssertion = { type: 'text', expected: params.text, selector };

    try {
      // Get the text content of the target element
      const textResult = await pageController.evaluateInFrame(`
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            return el ? el.textContent : null;
          })()
        `);

      const actualText = textResult.result?.value ?? null;
      textAssertion.found = actualText !== null;

      if (actualText === null) {
        textAssertion.passed = false;
        textAssertion.error = `Element not found: ${selector}`;
      } else {
        if (caseSensitive) {
          textAssertion.passed = actualText.includes(params.text);
        } else {
          textAssertion.passed = actualText.toLowerCase().includes(params.text.toLowerCase());
        }
        textAssertion.actualLength = actualText.length;
      }
    } catch (e) {
      textAssertion.passed = false;
      textAssertion.error = e.message;
    }

    result.assertions.push(textAssertion);
    if (!textAssertion.passed) {
      result.passed = false;
    }
  }

  // Throw error if assertion failed (makes the step fail)
  if (!result.passed) {
    const failedAssertions = result.assertions.filter(a => !a.passed);
    const messages = failedAssertions.map(a => {
      if (a.type === 'url') {
        return `URL assertion failed: expected ${JSON.stringify(a.expected)}, actual "${a.actual}"`;
      } else if (a.type === 'text') {
        if (a.error) return `Text assertion failed: ${a.error}`;
        return `Text assertion failed: "${a.expected}" not found in ${a.selector}`;
      }
      return 'Assertion failed';
    });
    throw new Error(messages.join('; '));
  }

  return result;
}

/**
 * Execute a queryAll step - runs multiple queries and returns results
 * @param {Object} elementLocator - Element locator
 * @param {Object} params - Object mapping names to selectors
 * @returns {Promise<Object>} Results keyed by query name
 */
