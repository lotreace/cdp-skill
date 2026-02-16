/**
 * Utils Module
 * Re-exports all utility functions for backward compatibility
 */

// Temp directory utilities
export {
  getTempDir,
  getTempDirSync,
  resolveTempPath,
  generateTempPath
} from './temp.js';

// Backoff and sleep utilities
export {
  sleep,
  createBackoffSleeper,
  sleepWithBackoff
} from './backoff.js';

// CDP helper utilities
export {
  releaseObject,
  resetInputState,
  SCROLL_STRATEGIES,
  ActionTypes,
  getCurrentUrl,
  getElementAtPoint,
  detectNavigation
} from './cdp-helpers.js';

// Error types and factories
export {
  ErrorTypes,
  createError,
  connectionError,
  navigationError,
  navigationAbortedError,
  timeoutError,
  elementNotFoundError,
  elementNotEditableError,
  staleElementError,
  pageCrashedError,
  contextDestroyedError,
  stepValidationError,
  isErrorType,
  isContextDestroyed,
  isStaleElementError
} from './errors.js';

// Validators
export {
  createKeyValidator,
  createFormValidator
} from './validators.js';

// Device presets
export {
  DEVICE_PRESETS,
  getDevicePreset,
  hasDevicePreset,
  listDevicePresets,
  listDevicePresetsByCategory,
  resolveViewport
} from './devices.js';
