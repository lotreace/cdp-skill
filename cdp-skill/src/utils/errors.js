/**
 * Error Types and Factory Functions
 * Typed errors for CDP browser driver operations
 */

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
