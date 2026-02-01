/**
 * Page Operations Module
 * Re-exports all page-related functionality
 *
 * @module cdp-skill/page
 */

// DOM Stability (LCS-based)
export {
  lcsLength,
  lcsSimilarity,
  getDOMSignature,
  waitForDOMStability
} from './dom-stability.js';

// Wait Utilities
export {
  waitForCondition,
  waitForFunction,
  waitForNetworkIdle,
  waitForDocumentReady,
  waitForSelector,
  waitForText
} from './wait-utilities.js';

// Cookie Management
export { createCookieManager } from './cookie-manager.js';

// Web Storage Management
export { createWebStorageManager } from './web-storage-manager.js';

// Page Controller
export {
  WaitCondition,
  createPageController
} from './page-controller.js';
