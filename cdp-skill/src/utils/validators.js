/**
 * Validation Utilities
 * Key validation and form validation helpers
 */

const VALID_KEY_NAMES = new Set([
  // Standard keys
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Space',
  // Arrow keys
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  // Modifier keys
  'Shift', 'Control', 'Alt', 'Meta',
  // Function keys
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  // Navigation keys
  'Home', 'End', 'PageUp', 'PageDown', 'Insert',
  // Additional common keys
  'CapsLock', 'NumLock', 'ScrollLock', 'Pause', 'PrintScreen',
  'ContextMenu',
  // Numpad keys
  'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4',
  'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9',
  'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide',
  'NumpadDecimal', 'NumpadEnter'
]);

const MODIFIER_ALIASES = new Set([
  'control', 'ctrl', 'alt', 'meta', 'cmd', 'command', 'shift'
]);

/**
 * Create a key validator for validating key names against known CDP key codes
 * @returns {Object} Key validator with validation methods
 */
export function createKeyValidator() {
  function isKnownKey(keyName) {
    if (!keyName || typeof keyName !== 'string') {
      return false;
    }
    if (VALID_KEY_NAMES.has(keyName)) {
      return true;
    }
    // Check for single character keys (a-z, A-Z, 0-9, punctuation)
    if (keyName.length === 1) {
      return true;
    }
    return false;
  }

  function isModifierAlias(part) {
    return MODIFIER_ALIASES.has(part.toLowerCase());
  }

  function getKnownKeysSample() {
    return ['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'F1-F12'].join(', ');
  }

  function validateCombo(combo) {
    const parts = combo.split('+');
    const warnings = [];
    let mainKey = null;

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) {
        return {
          valid: false,
          warning: `Invalid key combo "${combo}": empty key part`
        };
      }

      // Check if it's a modifier
      if (isModifierAlias(trimmed) || VALID_KEY_NAMES.has(trimmed) &&
          ['Shift', 'Control', 'Alt', 'Meta'].includes(trimmed)) {
        continue;
      }

      // This should be the main key
      if (mainKey !== null) {
        return {
          valid: false,
          warning: `Invalid key combo "${combo}": multiple main keys specified`
        };
      }
      mainKey = trimmed;

      if (!isKnownKey(trimmed)) {
        warnings.push(`Unknown key "${trimmed}" in combo`);
      }
    }

    if (mainKey === null) {
      return {
        valid: false,
        warning: `Invalid key combo "${combo}": no main key specified`
      };
    }

    return {
      valid: true,
      warning: warnings.length > 0 ? warnings.join('; ') : null
    };
  }

  function validate(keyName) {
    if (!keyName || typeof keyName !== 'string') {
      return {
        valid: false,
        warning: 'Key name must be a non-empty string'
      };
    }

    // Handle key combos (e.g., "Control+a")
    if (keyName.includes('+')) {
      return validateCombo(keyName);
    }

    if (isKnownKey(keyName)) {
      return { valid: true, warning: null };
    }

    return {
      valid: true, // Still allow unknown keys to pass through
      warning: `Unknown key name "${keyName}". Known keys: ${getKnownKeysSample()}`
    };
  }

  function getValidKeyNames() {
    return new Set(VALID_KEY_NAMES);
  }

  return {
    isKnownKey,
    isModifierAlias,
    validate,
    validateCombo,
    getKnownKeysSample,
    getValidKeyNames
  };
}

/**
 * Create a form validator for handling form validation queries and submit operations
 * @param {Object} session - CDP session
 * @param {Object} elementLocator - Element locator instance
 * @returns {Object} Form validator with validation methods
 */
export function createFormValidator(session, elementLocator) {
  /**
   * Query validation state of an element using HTML5 constraint validation API
   * @param {string} selector - CSS selector for the input/form element
   * @returns {Promise<{valid: boolean, message: string, validity: Object}>}
   */
  async function validateElement(selector) {
    const element = await elementLocator.findElement(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId: element._handle.objectId,
        functionDeclaration: `function() {
          if (!this.checkValidity) {
            return { valid: true, message: '', validity: null, supported: false };
          }

          const valid = this.checkValidity();
          const message = this.validationMessage || '';

          // Get detailed validity state
          const validity = this.validity ? {
            valueMissing: this.validity.valueMissing,
            typeMismatch: this.validity.typeMismatch,
            patternMismatch: this.validity.patternMismatch,
            tooLong: this.validity.tooLong,
            tooShort: this.validity.tooShort,
            rangeUnderflow: this.validity.rangeUnderflow,
            rangeOverflow: this.validity.rangeOverflow,
            stepMismatch: this.validity.stepMismatch,
            badInput: this.validity.badInput,
            customError: this.validity.customError
          } : null;

          return { valid, message, validity, supported: true };
        }`,
        returnByValue: true
      });

      return result.result.value;
    } finally {
      await element._handle.dispose();
    }
  }

  /**
   * Submit a form and report validation errors
   * @param {string} selector - CSS selector for the form element
   * @param {Object} options - Submit options
   * @param {boolean} options.validate - Check validation before submitting (default: true)
   * @param {boolean} options.reportValidity - Show browser validation UI (default: false)
   * @returns {Promise<{submitted: boolean, valid: boolean, errors: Array}>}
   */
  async function submitForm(selector, options = {}) {
    const { validate = true, reportValidity = false } = options;

    const element = await elementLocator.findElement(selector);
    if (!element) {
      throw new Error(`Form not found: ${selector}`);
    }

    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId: element._handle.objectId,
        functionDeclaration: `function(validate, reportValidity) {
          // Check if this is a form element
          if (this.tagName !== 'FORM') {
            return { submitted: false, error: 'Element is not a form', valid: null, errors: [] };
          }

          const errors = [];
          let formValid = true;

          if (validate) {
            // Get all form elements and check validity
            const elements = this.elements;
            for (let i = 0; i < elements.length; i++) {
              const el = elements[i];
              if (el.checkValidity && !el.checkValidity()) {
                formValid = false;
                errors.push({
                  name: el.name || el.id || 'unknown',
                  type: el.type || el.tagName.toLowerCase(),
                  message: el.validationMessage,
                  value: el.value
                });
              }
            }

            if (!formValid) {
              if (reportValidity) {
                this.reportValidity();
              }
              return { submitted: false, valid: false, errors };
            }
          }

          // Submit the form
          this.submit();
          return { submitted: true, valid: true, errors: [] };
        }`,
        arguments: [
          { value: validate },
          { value: reportValidity }
        ],
        returnByValue: true
      });

      return result.result.value;
    } finally {
      await element._handle.dispose();
    }
  }

  /**
   * Get all validation errors for a form
   * @param {string} selector - CSS selector for the form element
   * @returns {Promise<Array<{name: string, type: string, message: string}>>}
   */
  async function getFormErrors(selector) {
    const element = await elementLocator.findElement(selector);
    if (!element) {
      throw new Error(`Form not found: ${selector}`);
    }

    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId: element._handle.objectId,
        functionDeclaration: `function() {
          if (this.tagName !== 'FORM') {
            return { error: 'Element is not a form', errors: [] };
          }

          const errors = [];
          const elements = this.elements;

          for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (el.checkValidity && !el.checkValidity()) {
              errors.push({
                name: el.name || el.id || 'unknown',
                type: el.type || el.tagName.toLowerCase(),
                message: el.validationMessage,
                value: el.value
              });
            }
          }

          return { errors };
        }`,
        returnByValue: true
      });

      return result.result.value.errors;
    } finally {
      await element._handle.dispose();
    }
  }

  /**
   * Get complete form state including all fields and their values
   * @param {string} selector - CSS selector for the form element
   * @returns {Promise<Object>} Form state object
   */
  async function getFormState(selector) {
    const element = await elementLocator.findElement(selector);
    if (!element) {
      throw new Error(`Form not found: ${selector}`);
    }

    try {
      const result = await session.send('Runtime.callFunctionOn', {
        objectId: element._handle.objectId,
        functionDeclaration: `function() {
          if (this.tagName !== 'FORM') {
            return { error: 'Element is not a form' };
          }

          const form = this;
          const fields = [];
          let formValid = true;

          // Get form attributes
          const action = form.action || '';
          const method = (form.method || 'get').toUpperCase();
          const enctype = form.enctype || 'application/x-www-form-urlencoded';

          // Get associated label for an element
          function getLabel(el) {
            // Try label with for attribute (use CSS.escape to prevent selector injection)
            if (el.id) {
              const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
              if (label) return label.textContent.trim();
            }
            // Try parent label
            const parentLabel = el.closest('label');
            if (parentLabel) {
              // Get text content excluding the input's text
              const clone = parentLabel.cloneNode(true);
              const inputs = clone.querySelectorAll('input, textarea, select');
              inputs.forEach(i => i.remove());
              return clone.textContent.trim();
            }
            // Try aria-label
            if (el.getAttribute('aria-label')) {
              return el.getAttribute('aria-label');
            }
            // Try placeholder
            if (el.placeholder) {
              return el.placeholder;
            }
            return null;
          }

          const elements = form.elements;
          for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const tagName = el.tagName.toLowerCase();
            const type = el.type ? el.type.toLowerCase() : tagName;

            // Skip buttons and hidden fields
            if (type === 'submit' || type === 'reset' || type === 'button' || type === 'hidden') {
              continue;
            }

            // Get validation state
            const valid = el.checkValidity ? el.checkValidity() : true;
            if (!valid) formValid = false;

            // Get value (mask passwords)
            let value;
            if (type === 'password') {
              value = el.value ? '••••••••' : '';
            } else if (type === 'checkbox' || type === 'radio') {
              value = el.checked;
            } else if (tagName === 'select') {
              const selected = [];
              for (let j = 0; j < el.selectedOptions.length; j++) {
                selected.push(el.selectedOptions[j].text);
              }
              value = el.multiple ? selected : (selected[0] || '');
            } else {
              value = el.value || '';
            }

            fields.push({
              name: el.name || el.id || null,
              type: type,
              label: getLabel(el),
              value: value,
              required: el.required || false,
              valid: valid,
              validationMessage: el.validationMessage || null,
              disabled: el.disabled || false,
              readOnly: el.readOnly || false
            });
          }

          return {
            action,
            method,
            enctype,
            fields,
            valid: formValid,
            fieldCount: fields.length
          };
        }`,
        returnByValue: true
      });

      return result.result.value;
    } finally {
      await element._handle.dispose();
    }
  }

  return {
    validateElement,
    submitForm,
    getFormErrors,
    getFormState
  };
}
