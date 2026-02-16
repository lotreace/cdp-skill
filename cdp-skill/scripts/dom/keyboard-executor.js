/**
 * Keyboard Executor
 * Type and select operations for form inputs
 *
 * EXPORTS:
 * - createKeyboardExecutor(session, elementLocator, inputEmulator) → KeyboardExecutor
 *   Methods: executeType, executeSelect
 *
 * DEPENDENCIES:
 * - ./element-validator.js: createElementValidator
 * - ../utils.js: elementNotFoundError, elementNotEditableError
 */

import { createElementValidator } from './element-validator.js';
import { elementNotFoundError, elementNotEditableError } from '../utils.js';

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
