/**
 * Shared utilities for CDP browser automation
 * Consolidated: errors, key validation, form validation, device presets
 */

import os from 'os';
import path from 'path';
import fs from 'fs/promises';

// ============================================================================
// Temp Directory Utilities
// ============================================================================

let _tempDir = null;

/**
 * Get the platform-specific temp directory for CDP skill outputs (screenshots, PDFs, etc.)
 * Creates the directory if it doesn't exist
 * @returns {Promise<string>} Absolute path to temp directory
 */
export async function getTempDir() {
  if (_tempDir) return _tempDir;

  const baseTemp = os.tmpdir();
  _tempDir = path.join(baseTemp, 'cdp-skill');

  await fs.mkdir(_tempDir, { recursive: true });
  return _tempDir;
}

/**
 * Get the temp directory synchronously (returns cached value or creates new)
 * Note: First call should use getTempDir() to ensure directory exists
 * @returns {string} Absolute path to temp directory
 */
export function getTempDirSync() {
  if (_tempDir) return _tempDir;

  const baseTemp = os.tmpdir();
  _tempDir = path.join(baseTemp, 'cdp-skill');
  return _tempDir;
}

/**
 * Resolve a file path, using temp directory for relative paths
 * @param {string} filePath - File path (relative or absolute)
 * @param {string} [extension] - Default extension to add if missing
 * @returns {Promise<string>} Absolute path
 */
export async function resolveTempPath(filePath, extension) {
  // If already absolute, use as-is
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  // For relative paths, put in temp directory
  const tempDir = await getTempDir();
  let resolved = path.join(tempDir, filePath);

  // Add extension if missing
  if (extension && !path.extname(resolved)) {
    resolved += extension;
  }

  return resolved;
}

/**
 * Generate a unique temp file path with timestamp
 * @param {string} prefix - File prefix (e.g., 'screenshot', 'page')
 * @param {string} extension - File extension (e.g., '.png', '.pdf')
 * @returns {Promise<string>} Unique absolute path in temp directory
 */
export async function generateTempPath(prefix, extension) {
  const tempDir = await getTempDir();
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return path.join(tempDir, `${prefix}-${timestamp}-${random}${extension}`);
}

// ============================================================================
// Basic Utilities
// ============================================================================

/**
 * Promise-based delay
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Backoff Sleeper with Jitter (inspired by Rod)
// ============================================================================

/**
 * Create a backoff sleeper with exponential delay and jitter
 * Prevents thundering herd by randomizing retry delays
 * @param {Object} [options] - Configuration options
 * @param {number} [options.initialDelay=100] - Initial delay in ms
 * @param {number} [options.maxDelay=5000] - Maximum delay in ms
 * @param {number} [options.multiplier=2] - Base multiplier for exponential growth
 * @param {number} [options.jitterMin=0.9] - Minimum jitter factor (e.g., 0.9 = 90%)
 * @param {number} [options.jitterMax=1.1] - Maximum jitter factor (e.g., 1.1 = 110%)
 * @returns {Object} Backoff sleeper interface
 */
export function createBackoffSleeper(options = {}) {
  const {
    initialDelay = 100,
    maxDelay = 5000,
    multiplier = 2,
    jitterMin = 0.9,
    jitterMax = 1.1
  } = options;

  let attempt = 0;
  let currentDelay = initialDelay;

  /**
   * Apply jitter to a delay value
   * @param {number} delay - Base delay
   * @returns {number} Delay with jitter applied
   */
  function applyJitter(delay) {
    const jitterRange = jitterMax - jitterMin;
    const jitterFactor = jitterMin + Math.random() * jitterRange;
    return Math.floor(delay * jitterFactor);
  }

  /**
   * Sleep with exponential backoff and jitter
   * Each call increases the delay exponentially (with random factor)
   * @returns {Promise<number>} The delay that was used
   */
  async function sleep() {
    const delayWithJitter = applyJitter(currentDelay);
    await new Promise(resolve => setTimeout(resolve, delayWithJitter));

    // Increase delay for next attempt (with random multiplier 1.9-2.1)
    const randomMultiplier = multiplier * (0.95 + Math.random() * 0.1);
    currentDelay = Math.min(currentDelay * randomMultiplier, maxDelay);
    attempt++;

    return delayWithJitter;
  }

  /**
   * Reset the backoff state
   */
  function reset() {
    attempt = 0;
    currentDelay = initialDelay;
  }

  /**
   * Get current attempt count
   * @returns {number}
   */
  function getAttempt() {
    return attempt;
  }

  /**
   * Get next delay without sleeping (preview)
   * @returns {number}
   */
  function peekDelay() {
    return applyJitter(currentDelay);
  }

  return {
    sleep,
    reset,
    getAttempt,
    peekDelay
  };
}

/**
 * Sleep with backoff - simple one-shot function
 * @param {number} attempt - Current attempt number (0-based)
 * @param {Object} [options] - Options
 * @param {number} [options.initialDelay=100] - Initial delay
 * @param {number} [options.maxDelay=5000] - Max delay
 * @returns {Promise<number>} The delay used
 */
export async function sleepWithBackoff(attempt, options = {}) {
  const { initialDelay = 100, maxDelay = 5000 } = options;

  // Calculate delay: initialDelay * 2^attempt with jitter
  const baseDelay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

  // Apply jitter (0.9-1.1x)
  const jitter = 0.9 + Math.random() * 0.2;
  const delay = Math.floor(baseDelay * jitter);

  await sleep(delay);
  return delay;
}

/**
 * Release a CDP object reference to prevent memory leaks
 * @param {Object} session - CDP session
 * @param {string} objectId - Object ID to release
 */
export async function releaseObject(session, objectId) {
  if (!objectId) return;
  try {
    await session.send('Runtime.releaseObject', { objectId });
  } catch {
    // Ignore errors during cleanup - object may already be released
  }
}

/**
 * Reset input state to ensure no pending mouse/keyboard events
 * Helps prevent timeouts on subsequent operations after failures
 * @param {Object} session - CDP session
 */
export async function resetInputState(session) {
  try {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 0,
      y: 0,
      button: 'left',
      buttons: 0
    });
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Scroll alignment strategies for bringing elements into view
 */
export const SCROLL_STRATEGIES = ['center', 'end', 'start', 'nearest'];

/**
 * Action types for actionability checking
 */
export const ActionTypes = {
  CLICK: 'click',
  HOVER: 'hover',
  FILL: 'fill',
  TYPE: 'type',
  SELECT: 'select'
};

/**
 * Get current page URL
 * @param {Object} session - CDP session
 * @returns {Promise<string|null>}
 */
export async function getCurrentUrl(session) {
  try {
    const result = await session.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true
    });
    return result.result.value;
  } catch {
    return null;
  }
}

/**
 * Get element info at a specific point (for debug mode)
 * @param {Object} session - CDP session
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {Promise<Object|null>}
 */
export async function getElementAtPoint(session, x, y) {
  try {
    const result = await session.send('Runtime.evaluate', {
      expression: `
        (function() {
          const el = document.elementFromPoint(${x}, ${y});
          if (!el) return null;
          return {
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
            className: el.className || null,
            textContent: el.textContent ? el.textContent.trim().substring(0, 50) : null
          };
        })()
      `,
      returnByValue: true
    });
    return result.result.value;
  } catch {
    return null;
  }
}

/**
 * Detect navigation by comparing URLs before and after an action
 * @param {Object} session - CDP session
 * @param {string} urlBeforeAction - URL before the action
 * @param {number} timeout - Timeout to wait for navigation
 * @returns {Promise<{navigated: boolean, newUrl?: string}>}
 */
export async function detectNavigation(session, urlBeforeAction, timeout = 100) {
  await sleep(timeout);
  try {
    const urlAfterAction = await getCurrentUrl(session);
    const navigated = urlAfterAction !== urlBeforeAction;
    return {
      navigated,
      newUrl: navigated ? urlAfterAction : undefined
    };
  } catch {
    // If we can't get URL, page likely navigated
    return { navigated: true };
  }
}

// ============================================================================
// Error Types and Factory Functions (from errors.js)
// ============================================================================

/**
 * Error types for CDP browser driver operations
 */
export const ErrorTypes = Object.freeze({
  CONNECTION: 'CDPConnectionError',
  NAVIGATION: 'NavigationError',
  NAVIGATION_ABORTED: 'NavigationAbortedError',
  TIMEOUT: 'TimeoutError',
  ELEMENT_NOT_FOUND: 'ElementNotFoundError',
  ELEMENT_NOT_EDITABLE: 'ElementNotEditableError',
  STALE_ELEMENT: 'StaleElementError',
  PAGE_CRASHED: 'PageCrashedError',
  CONTEXT_DESTROYED: 'ContextDestroyedError',
  STEP_VALIDATION: 'StepValidationError'
});

/**
 * Create a typed error with standard properties
 * @param {string} type - Error type from ErrorTypes
 * @param {string} message - Error message
 * @param {Object} props - Additional properties to attach
 * @returns {Error}
 */
export function createError(type, message, props = {}) {
  const error = new Error(message);
  error.name = type;
  Object.assign(error, props);
  if (Error.captureStackTrace) {
    Error.captureStackTrace(error, createError);
  }
  return error;
}

/**
 * Create a CDPConnectionError
 * @param {string} message - Error message
 * @param {string} operation - The CDP operation that failed
 * @returns {Error}
 */
export function connectionError(message, operation) {
  return createError(
    ErrorTypes.CONNECTION,
    `CDP connection error during ${operation}: ${message}`,
    { operation, originalMessage: message }
  );
}

/**
 * Create a NavigationError
 * @param {string} message - Error message
 * @param {string} url - URL that failed to load
 * @returns {Error}
 */
export function navigationError(message, url) {
  return createError(
    ErrorTypes.NAVIGATION,
    `Navigation to ${url} failed: ${message}`,
    { url, originalMessage: message }
  );
}

/**
 * Create a NavigationAbortedError
 * @param {string} message - Abort reason
 * @param {string} url - URL being navigated to
 * @returns {Error}
 */
export function navigationAbortedError(message, url) {
  return createError(
    ErrorTypes.NAVIGATION_ABORTED,
    `Navigation to ${url} aborted: ${message}`,
    { url, originalMessage: message }
  );
}

/**
 * Create a TimeoutError
 * @param {string} message - Description of what timed out
 * @param {number} [timeout] - Timeout duration in ms
 * @returns {Error}
 */
export function timeoutError(message, timeout) {
  return createError(
    ErrorTypes.TIMEOUT,
    message,
    timeout !== undefined ? { timeout } : {}
  );
}

/**
 * Create an ElementNotFoundError
 * @param {string} selector - The selector that wasn't found
 * @param {number} timeout - Timeout duration in ms
 * @returns {Error}
 */
export function elementNotFoundError(selector, timeout) {
  return createError(
    ErrorTypes.ELEMENT_NOT_FOUND,
    `Element not found: "${selector}" (timeout: ${timeout}ms)`,
    { selector, timeout }
  );
}

/**
 * Create an ElementNotEditableError
 * @param {string} selector - The selector of the non-editable element
 * @param {string} reason - Reason why element is not editable
 * @returns {Error}
 */
export function elementNotEditableError(selector, reason) {
  return createError(
    ErrorTypes.ELEMENT_NOT_EDITABLE,
    `Element "${selector}" is not editable: ${reason}`,
    { selector, reason }
  );
}

/**
 * Create a StaleElementError
 * @param {string} objectId - CDP object ID of the stale element
 * @param {Object} [options] - Additional options
 * @param {string} [options.operation] - The operation that was attempted
 * @param {string} [options.selector] - Original selector used
 * @param {Error} [options.cause] - Underlying CDP error
 * @returns {Error}
 */
export function staleElementError(objectId, options = {}) {
  if (typeof options === 'string') {
    options = { operation: options };
  }
  const { operation = null, selector = null, cause = null } = options;

  let message = 'Element is no longer attached to the DOM';
  const details = [];
  if (selector) details.push(`selector: "${selector}"`);
  if (objectId) details.push(`objectId: ${objectId}`);
  if (operation) details.push(`operation: ${operation}`);
  if (details.length > 0) message += ` (${details.join(', ')})`;

  const error = createError(ErrorTypes.STALE_ELEMENT, message, {
    objectId,
    operation,
    selector
  });
  if (cause) error.cause = cause;
  return error;
}

/**
 * Create a PageCrashedError
 * @param {string} [message] - Optional message
 * @returns {Error}
 */
export function pageCrashedError(message = 'Page crashed') {
  return createError(ErrorTypes.PAGE_CRASHED, message);
}

/**
 * Create a ContextDestroyedError
 * @param {string} [message] - Optional message
 * @returns {Error}
 */
export function contextDestroyedError(message = 'Execution context was destroyed') {
  return createError(ErrorTypes.CONTEXT_DESTROYED, message);
}

/**
 * Create a StepValidationError
 * @param {Array<{index: number, step: Object, errors: string[]}>} invalidSteps
 * @returns {Error}
 */
export function stepValidationError(invalidSteps) {
  const messages = invalidSteps.map(({ index, errors }) =>
    `Step ${index + 1}: ${errors.join(', ')}`
  );
  return createError(
    ErrorTypes.STEP_VALIDATION,
    `Invalid step definitions:\n${messages.join('\n')}`,
    { invalidSteps }
  );
}

/**
 * Check if an error is of a specific type
 * @param {Error} error - The error to check
 * @param {string} type - Error type from ErrorTypes
 * @returns {boolean}
 */
export function isErrorType(error, type) {
  return error && error.name === type;
}

// Error message patterns for context destruction detection
const CONTEXT_DESTROYED_PATTERNS = [
  'Cannot find context with specified id',
  'Execution context was destroyed',
  'Inspected target navigated or closed',
  'Context was destroyed'
];

/**
 * Check if an error indicates context destruction
 * @param {Object} [exceptionDetails] - CDP exception details
 * @param {Error} [error] - Error thrown
 * @returns {boolean}
 */
export function isContextDestroyed(exceptionDetails, error) {
  const message = exceptionDetails?.exception?.description ||
                  exceptionDetails?.text ||
                  error?.message ||
                  '';
  return CONTEXT_DESTROYED_PATTERNS.some(pattern => message.includes(pattern));
}

// Stale element error indicators
const STALE_ELEMENT_PATTERNS = [
  'Could not find object with given id',
  'Object reference not found',
  'Cannot find context with specified id',
  'Node with given id does not belong to the document',
  'No node with given id found',
  'Object is not available',
  'No object with given id',
  'Object with given id not found'
];

/**
 * Check if an error indicates a stale element
 * @param {Error} error - The error to check
 * @returns {boolean}
 */
export function isStaleElementError(error) {
  if (!error || !error.message) return false;
  return STALE_ELEMENT_PATTERNS.some(indicator =>
    error.message.toLowerCase().includes(indicator.toLowerCase())
  );
}

// ============================================================================
// Key Validation (from KeyValidator.js)
// ============================================================================

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

// ============================================================================
// Form Validation (from FormValidator.js)
// ============================================================================

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

  return {
    validateElement,
    submitForm,
    getFormErrors
  };
}

// ============================================================================
// Device Presets (from DevicePresets.js)
// ============================================================================

/**
 * Device preset configurations for viewport emulation
 */
export const DEVICE_PRESETS = new Map([
  // iPhones
  ['iphone-se', { width: 375, height: 667, deviceScaleFactor: 2, mobile: true, hasTouch: true }],
  ['iphone-12', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-12-mini', { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-12-pro', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-12-pro-max', { width: 428, height: 926, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-13', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-13-mini', { width: 375, height: 812, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-13-pro', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-13-pro-max', { width: 428, height: 926, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-14', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-14-plus', { width: 428, height: 926, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-14-pro', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-14-pro-max', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-15', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-15-plus', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-15-pro', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-15-pro-max', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true, hasTouch: true }],

  // iPads
  ['ipad', { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true, hasTouch: true }],
  ['ipad-mini', { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true, hasTouch: true }],
  ['ipad-air', { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true, hasTouch: true }],
  ['ipad-pro-11', { width: 834, height: 1194, deviceScaleFactor: 2, mobile: true, hasTouch: true }],
  ['ipad-pro-12.9', { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true, hasTouch: true }],

  // Android phones
  ['pixel-5', { width: 393, height: 851, deviceScaleFactor: 2.75, mobile: true, hasTouch: true }],
  ['pixel-6', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, hasTouch: true }],
  ['pixel-7', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, hasTouch: true }],
  ['pixel-7-pro', { width: 412, height: 892, deviceScaleFactor: 3.5, mobile: true, hasTouch: true }],
  ['samsung-galaxy-s21', { width: 360, height: 800, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['samsung-galaxy-s22', { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['samsung-galaxy-s23', { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, hasTouch: true }],

  // Android tablets
  ['galaxy-tab-s7', { width: 800, height: 1280, deviceScaleFactor: 2, mobile: true, hasTouch: true }],

  // Desktop presets
  ['desktop', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, hasTouch: false }],
  ['desktop-hd', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, hasTouch: false }],
  ['desktop-4k', { width: 3840, height: 2160, deviceScaleFactor: 1, mobile: false, hasTouch: false }],
  ['laptop', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false, hasTouch: false }],
  ['laptop-hd', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, hasTouch: false }],
  ['macbook-air', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false, hasTouch: false }],
  ['macbook-pro-13', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false, hasTouch: false }],
  ['macbook-pro-14', { width: 1512, height: 982, deviceScaleFactor: 2, mobile: false, hasTouch: false }],
  ['macbook-pro-16', { width: 1728, height: 1117, deviceScaleFactor: 2, mobile: false, hasTouch: false }],

  // Landscape variants (appended with -landscape)
  ['iphone-14-landscape', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, hasTouch: true, isLandscape: true }],
  ['iphone-14-pro-landscape', { width: 852, height: 393, deviceScaleFactor: 3, mobile: true, hasTouch: true, isLandscape: true }],
  ['ipad-landscape', { width: 1024, height: 768, deviceScaleFactor: 2, mobile: true, hasTouch: true, isLandscape: true }],
  ['ipad-pro-11-landscape', { width: 1194, height: 834, deviceScaleFactor: 2, mobile: true, hasTouch: true, isLandscape: true }],
]);

/**
 * Get a device preset by name
 * @param {string} name - Device preset name (case-insensitive)
 * @returns {Object|null} Device configuration or null if not found
 */
export function getDevicePreset(name) {
  const normalizedName = name.toLowerCase().replace(/_/g, '-');
  return DEVICE_PRESETS.get(normalizedName) || null;
}

/**
 * Check if a preset exists
 * @param {string} name - Device preset name
 * @returns {boolean}
 */
export function hasDevicePreset(name) {
  const normalizedName = name.toLowerCase().replace(/_/g, '-');
  return DEVICE_PRESETS.has(normalizedName);
}

/**
 * Get all available preset names
 * @returns {string[]}
 */
export function listDevicePresets() {
  return Array.from(DEVICE_PRESETS.keys());
}

/**
 * Get presets by category
 * @param {string} category - 'iphone', 'ipad', 'android', 'desktop', 'landscape'
 * @returns {string[]}
 */
export function listDevicePresetsByCategory(category) {
  const categoryLower = category.toLowerCase();
  return listDevicePresets().filter(name => {
    if (categoryLower === 'iphone') return name.startsWith('iphone');
    if (categoryLower === 'ipad') return name.startsWith('ipad');
    if (categoryLower === 'android') return name.startsWith('pixel') || name.startsWith('samsung') || name.startsWith('galaxy');
    if (categoryLower === 'desktop') return name.startsWith('desktop') || name.startsWith('laptop') || name.startsWith('macbook');
    if (categoryLower === 'landscape') return name.endsWith('-landscape');
    return false;
  });
}

/**
 * Resolve viewport options - handles both preset strings and explicit configs
 * @param {string|Object} viewport - Either a preset name string or viewport config object
 * @returns {Object} Resolved viewport configuration
 * @throws {Error} If preset not found
 */
export function resolveViewport(viewport) {
  if (typeof viewport === 'string') {
    const preset = getDevicePreset(viewport);
    if (!preset) {
      const available = listDevicePresets().slice(0, 10).join(', ');
      throw new Error(`Unknown device preset "${viewport}". Available presets include: ${available}...`);
    }
    return { ...preset };
  }

  // It's an object - validate required fields
  if (!viewport.width || !viewport.height) {
    throw new Error('Viewport requires width and height');
  }

  return {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor || 1,
    mobile: viewport.mobile || false,
    hasTouch: viewport.hasTouch || false,
    isLandscape: viewport.isLandscape || false
  };
}

/**
 * Create a device presets manager (for backwards compatibility)
 * @returns {Object} Device presets manager
 */
export function createDevicePresets() {
  return {
    get: getDevicePreset,
    has: hasDevicePreset,
    list: listDevicePresets,
    listByCategory: listDevicePresetsByCategory,
    resolve: resolveViewport
  };
}
