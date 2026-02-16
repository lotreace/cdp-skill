/**
 * Element Validator
 * Validation utilities for checking element properties and states
 *
 * EXPORTS:
 * - createElementValidator(session) → ElementValidator
 *   Methods: isEditable, isClickable
 *
 * DEPENDENCIES:
 * - ../constants.js: NON_EDITABLE_INPUT_TYPES
 */

import { NON_EDITABLE_INPUT_TYPES } from '../constants.js';

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
