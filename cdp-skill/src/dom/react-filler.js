/**
 * React Input Filler
 * Handles React controlled component input filling
 *
 * EXPORTS:
 * - createReactInputFiller(session) → ReactInputFiller
 *   Methods: fillByObjectId, fillBySelector
 *
 * DEPENDENCIES: None (uses session directly)
 */

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
