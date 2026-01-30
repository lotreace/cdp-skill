/**
 * CDP Browser Driver Skill
 * A minimal, CDP-only browser automation library for Claude Code
 *
 * Functional API - All functions are stateless or return objects with closures
 */

// ============================================================================
// Core CDP Protocol and Browser Management
// ============================================================================
export {
  createConnection,
  createDiscovery,
  discoverChrome,
  createTargetManager,
  createSessionRegistry,
  createPageSession,
  createBrowser
} from './cdp.js';

// ============================================================================
// Page Operations and Waiting
// ============================================================================
export {
  WaitCondition,
  createPageController,
  waitForCondition,
  waitForFunction,
  waitForNetworkIdle,
  waitForDocumentReady,
  waitForSelector,
  waitForText,
  createCookieManager,
  createWebStorageManager,
  // LCS DOM Stability (improvement #9)
  lcsLength,
  lcsSimilarity,
  getDOMSignature,
  waitForDOMStability
} from './page.js';

// ============================================================================
// DOM Operations and Input
// ============================================================================
export {
  createElementHandle,
  createElementLocator,
  createInputEmulator,
  querySelector,
  querySelectorAll,
  findElement,
  getBoundingBox,
  isVisible,
  isActionable,
  scrollIntoView,
  click,
  type,
  fill,
  press,
  scroll,
  createClickExecutor,
  createFillExecutor,
  createWaitExecutor,
  createKeyboardExecutor,
  createActionabilityChecker,
  createElementValidator,
  createReactInputFiller
} from './dom.js';

// ============================================================================
// ARIA and Role-based Queries
// ============================================================================
export {
  createAriaSnapshot,
  createRoleQueryExecutor,
  createQueryOutputProcessor
} from './aria.js';

// ============================================================================
// Capture and Monitoring
// ============================================================================
export {
  createScreenshotCapture,
  captureViewport,
  captureFullPage,
  captureRegion,
  saveScreenshot,
  createConsoleCapture,
  createNetworkCapture,
  createErrorAggregator,
  aggregateErrors,
  createPdfCapture,
  createDebugCapture,
  createEvalSerializer
} from './capture.js';

// ============================================================================
// Test Execution
// ============================================================================
export {
  validateSteps,
  executeStep,
  runSteps,
  createTestRunner
} from './runner.js';

// ============================================================================
// Utilities and Errors
// ============================================================================
export {
  // Error types and factories
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
  isStaleElementError,
  // Utilities
  sleep,
  releaseObject,
  resetInputState,
  getCurrentUrl,
  getElementAtPoint,
  detectNavigation,
  // Temp directory utilities
  getTempDir,
  getTempDirSync,
  resolveTempPath,
  generateTempPath,
  // Backoff with jitter (improvement #5)
  createBackoffSleeper,
  sleepWithBackoff,
  // Validators
  createKeyValidator,
  createFormValidator,
  // Device presets
  DEVICE_PRESETS,
  getDevicePreset,
  resolveViewport
} from './utils.js';

// ============================================================================
// Default Export - High-level browser factory
// ============================================================================
import { createBrowser } from './cdp.js';
export default createBrowser;
