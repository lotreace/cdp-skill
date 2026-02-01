/**
 * Capture and Monitoring Module
 * Re-exports all capture-related functionality
 *
 * @module cdp-skill/capture
 */

// Console Capture
export { createConsoleCapture } from './console-capture.js';

// Screenshot Capture
export {
  createScreenshotCapture,
  captureViewport,
  captureFullPage,
  captureRegion,
  saveScreenshot
} from './screenshot-capture.js';

// Network Capture
export { createNetworkCapture } from './network-capture.js';

// Error Aggregator
export {
  createErrorAggregator,
  aggregateErrors
} from './error-aggregator.js';

// PDF Capture
export { createPdfCapture } from './pdf-capture.js';

// Debug Capture
export { createDebugCapture } from './debug-capture.js';

// Eval Serializer
export {
  createEvalSerializer,
  getEvalSerializationFunction,
  processEvalResult
} from './eval-serializer.js';
