/**
 * CDP Protocol Module
 * Re-exports all CDP-related functionality
 *
 * @module cdp-skill/cdp
 */

// Connection
export { createConnection } from './connection.js';

// Discovery
export { createDiscovery, discoverChrome } from './discovery.js';

// Target and Session Management
export {
  createTargetManager,
  createSessionRegistry,
  createPageSession
} from './target-and-session.js';

// Browser Client and Launcher
export {
  createBrowser,
  findChromePath,
  launchChrome,
  getChromeStatus,
  isChromeProcessRunning,
  createNewTab
} from './browser.js';

