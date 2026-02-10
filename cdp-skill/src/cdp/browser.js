/**
 * Browser Module
 * High-level browser client and Chrome launcher
 *
 * PUBLIC EXPORTS:
 * - createBrowser(options?) - Factory for browser client
 * - findChromePath() - Find Chrome executable
 * - launchChrome(options?) - Launch Chrome with CDP
 * - getChromeStatus(options?) - Check/launch Chrome
 * - isChromeProcessRunning() - Check if Chrome process exists
 * - createNewTab(host?, port?, url?) - Create new tab via HTTP
 *
 * @module cdp-skill/cdp/browser
 */

import { spawn, execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { timeoutError, sleep } from '../utils.js';
import { createConnection } from './connection.js';
import { createDiscovery } from './discovery.js';
import { createTargetManager, createSessionRegistry, createPageSession } from './target-and-session.js';

// Chrome executable paths by platform
const CHROME_PATHS = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
  ],
  linux: [
    'google-chrome',
    'google-chrome-stable',
    'chromium-browser',
    'chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium'
  ],
  win32: [
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Chromium\\Application\\chrome.exe'
  ]
};

/**
 * Find Chrome executable on the system
 * @returns {string|null} Path to Chrome executable or null if not found
 */
export function findChromePath() {
  // Check environment variable first
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }
  }

  const platform = os.platform();
  const paths = CHROME_PATHS[platform] || [];

  for (const chromePath of paths) {
    try {
      // For Linux, check if command exists in PATH
      if (platform === 'linux' && !chromePath.startsWith('/')) {
        try {
          const result = execSync(`which ${chromePath}`, { encoding: 'utf8' }).trim();
          if (result) return result;
        } catch {
          continue;
        }
      } else if (fs.existsSync(chromePath)) {
        return chromePath;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Check if Chrome process is running (without necessarily having CDP enabled)
 * On macOS, Chrome can run without windows and without CDP port
 * @returns {{running: boolean, hasCdpPort: boolean, pid: number|null}}
 */
export function isChromeProcessRunning() {
  const platform = os.platform();

  try {
    if (platform === 'darwin') {
      // macOS: Check for Chrome process
      const result = execSync('pgrep -x "Google Chrome" 2>/dev/null || pgrep -f "Google Chrome.app" 2>/dev/null', {
        encoding: 'utf8',
        timeout: 5000
      }).trim();
      if (result) {
        const pids = result.split('\n').filter(p => p);
        // Check if any Chrome process has --remote-debugging-port
        try {
          const psResult = execSync(`ps aux | grep -E "Google Chrome.*--remote-debugging-port" | grep -v grep`, {
            encoding: 'utf8',
            timeout: 5000
          }).trim();
          return { running: true, hasCdpPort: psResult.length > 0, pid: parseInt(pids[0]) };
        } catch {
          return { running: true, hasCdpPort: false, pid: parseInt(pids[0]) };
        }
      }
    } else if (platform === 'linux') {
      const result = execSync('pgrep -f "(chrome|chromium)" 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
      if (result) {
        const pids = result.split('\n').filter(p => p);
        try {
          const psResult = execSync(`ps aux | grep -E "(chrome|chromium).*--remote-debugging-port" | grep -v grep`, {
            encoding: 'utf8',
            timeout: 5000
          }).trim();
          return { running: true, hasCdpPort: psResult.length > 0, pid: parseInt(pids[0]) };
        } catch {
          return { running: true, hasCdpPort: false, pid: parseInt(pids[0]) };
        }
      }
    } else if (platform === 'win32') {
      const result = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { encoding: 'utf8', timeout: 5000 });
      if (result.includes('chrome.exe')) {
        // Windows: harder to check command line args, assume CDP might be available
        return { running: true, hasCdpPort: true, pid: null };
      }
    }
  } catch {
    // Process check failed, assume not running
  }

  return { running: false, hasCdpPort: false, pid: null };
}

/**
 * Create a new tab in Chrome via CDP HTTP endpoint
 * @param {string} [host='localhost'] - Chrome debugging host
 * @param {number} [port=9222] - Chrome debugging port
 * @param {string} [url='about:blank'] - URL to open
 * @returns {Promise<{targetId: string, url: string}>}
 */
export async function createNewTab(host = 'localhost', port = 9222, url = 'about:blank') {
  const response = await fetch(`http://${host}:${port}/json/new?${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw new Error(`Failed to create new tab: ${response.statusText}`);
  }
  const target = await response.json();
  return {
    targetId: target.id,
    url: target.url
  };
}

/**
 * Launch Chrome with remote debugging enabled
 *
 * IMPORTANT: On macOS/Linux, if Chrome is already running without CDP,
 * starting Chrome with --remote-debugging-port will just open a new window
 * in the existing Chrome (which ignores the flag). To solve this, we
 * automatically use a separate user data directory when Chrome is already running.
 *
 * @param {Object} [options] - Launch options
 * @param {number} [options.port=9222] - Debugging port
 * @param {string} [options.chromePath] - Custom Chrome path
 * @param {boolean} [options.headless=false] - Run in headless mode
 * @param {string} [options.userDataDir] - Custom user data directory
 * @returns {Promise<{process: ChildProcess, port: number, usedSeparateProfile: boolean}>}
 */
export async function launchChrome(options = {}) {
  const {
    port = 9222,
    chromePath = findChromePath(),
    headless = false,
    userDataDir = null
  } = options;

  if (!chromePath) {
    throw new Error(
      'Chrome not found. Install Google Chrome or set CHROME_PATH environment variable.\n' +
      'Download: https://www.google.com/chrome/'
    );
  }

  const args = [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check'
  ];

  if (headless) {
    args.push('--headless=new');
    args.push('--disable-dev-shm-usage');
    args.push('--disable-software-rasterizer');
  }

  // Chrome requires --user-data-dir for remote debugging (as of Chrome 129+)
  // Always use a dedicated profile for CDP to avoid conflicts with user's normal browsing
  let usedSeparateProfile = false;
  if (userDataDir) {
    args.push(`--user-data-dir=${userDataDir}`);
  } else {
    // Use a separate profile per port to allow multiple instances
    // Include headless flag to separate headless from headful profiles
    const profileSuffix = headless ? `-headless-${port}` : `-${port}`;
    const tempDir = path.join(os.tmpdir(), `cdp-skill-chrome-profile${profileSuffix}`);
    args.push(`--user-data-dir=${tempDir}`);
    usedSeparateProfile = true;
  }

  // Capture stderr to report Chrome errors to the agent
  const chromeProcess = spawn(chromePath, args, {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'] // capture stderr
  });

  // Collect stderr output for error reporting
  let stderrOutput = '';
  chromeProcess.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  // Don't let this process keep Node alive
  chromeProcess.unref();

  // Wait for Chrome to be ready
  const discovery = createDiscovery('localhost', port, 1000);
  const maxWait = 10000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    if (await discovery.isAvailable()) {
      return { process: chromeProcess, port, usedSeparateProfile };
    }
    await sleep(100);
  }

  // Kill process if it didn't start properly
  try {
    chromeProcess.kill();
  } catch { /* ignore */ }

  // Include Chrome's error output in the error message
  const errorDetails = stderrOutput.trim();
  const errorMsg = errorDetails
    ? `Chrome failed to start within ${maxWait}ms. Chrome error: ${errorDetails}`
    : `Chrome failed to start within ${maxWait}ms`;
  throw new Error(errorMsg);
}

/**
 * Get Chrome status - check if running, optionally launch if not
 *
 * Handles several scenarios:
 * 1. Chrome not running -> launch new Chrome with CDP port
 * 2. Chrome running but without CDP port (common on macOS when all windows closed)
 *    -> launch NEW Chrome instance with CDP (never kills existing Chrome)
 * 3. Chrome running with CDP but no tabs -> create new tab
 * 4. Chrome running with CDP and tabs -> return tabs
 *
 * @param {Object} [options] - Options
 * @param {string} [options.host='localhost'] - Chrome host
 * @param {number} [options.port=9222] - Chrome debugging port
 * @param {boolean} [options.autoLaunch=true] - Auto-launch if not running
 * @param {boolean} [options.headless=false] - Launch in headless mode
 * @returns {Promise<{running: boolean, launched?: boolean, version?: string, tabs?: Array, error?: string, note?: string}>}
 */
export async function getChromeStatus(options = {}) {
  const {
    host = 'localhost',
    port = 9222,
    autoLaunch = true,
    headless = false
  } = options;

  const discovery = createDiscovery(host, port, 2000);

  // Check if CDP is available on the port
  let cdpAvailable = await discovery.isAvailable();
  let launched = false;
  let createdTab = false;
  let note = null;

  // If CDP not available, check if Chrome process is running
  if (!cdpAvailable && autoLaunch && host === 'localhost') {
    const processCheck = isChromeProcessRunning();

    if (processCheck.running) {
      // Chrome is running but CDP isn't available
      const reason = processCheck.hasCdpPort
        ? 'Chrome has --remote-debugging-port flag but CDP is not responding (stale instance)'
        : 'Chrome is running without CDP port';
      note = `${reason}. Launched new instance with debugging enabled.`;
      try {
        await launchChrome({ port, headless });
        launched = true;
        cdpAvailable = true;
      } catch (err) {
        return {
          running: false,
          launched: false,
          error: `${reason}. Failed to launch new instance: ${err.message}`,
          note: 'On macOS, Chrome keeps running after closing all windows. A new Chrome instance with CDP was attempted but failed.'
        };
      }
    } else {
      // Chrome not running at all - launch it
      try {
        await launchChrome({ port, headless });
        launched = true;
        cdpAvailable = true;
      } catch (err) {
        return {
          running: false,
          launched: false,
          error: err.message
        };
      }
    }
  }

  if (!cdpAvailable) {
    const processCheck = isChromeProcessRunning();
    if (processCheck.running) {
      const reason = processCheck.hasCdpPort
        ? `Chrome has --remote-debugging-port flag but CDP is not responding on port ${port} (stale instance).`
        : `Chrome is running but not with CDP debugging enabled on port ${port}.`;
      return {
        running: false,
        launched: false,
        error: `${reason} On macOS, Chrome stays running after closing all windows. ` +
               `Set autoLaunch:true to start a new Chrome instance with CDP.`
      };
    }
    return {
      running: false,
      launched: false,
      error: `Chrome not running on ${host}:${port}`
    };
  }

  // Get version and tabs
  try {
    const version = await discovery.getVersion();
    let pages = await discovery.getPages();

    // If no tabs and autoLaunch is enabled, create a new tab
    if (pages.length === 0 && autoLaunch && host === 'localhost') {
      try {
        const newTab = await createNewTab(host, port, 'about:blank');
        pages = [{ id: newTab.targetId, url: newTab.url, title: '' }];
        createdTab = true;
        note = note ? note + ' Created new tab.' : 'Chrome had no tabs open. Created new tab.';
      } catch (err) {
        return {
          running: true,
          launched,
          version: version.browser,
          port,
          tabs: [],
          error: `Chrome running but has no tabs and failed to create one: ${err.message}`,
          note: 'On macOS, Chrome can run without any windows. Try opening a new Chrome window manually.'
        };
      }
    }

    const result = {
      running: true,
      launched,
      version: version.browser,
      port,
      tabs: pages.map(p => ({
        targetId: p.id,
        url: p.url,
        title: p.title
      }))
    };

    if (createdTab) result.createdTab = true;
    if (note) result.note = note;

    return result;
  } catch (err) {
    return {
      running: false,
      launched,
      error: err.message
    };
  }
}

/**
 * Create a high-level browser client
 * @param {Object} [options] - Configuration options
 * @param {string} [options.host='localhost'] - Chrome host
 * @param {number} [options.port=9222] - Chrome debugging port
 * @param {number} [options.connectTimeout=30000] - Connection timeout in ms
 * @returns {Object} Browser client interface
 */
export function createBrowser(options = {}) {
  const host = options.host ?? 'localhost';
  const port = options.port ?? 9222;
  const connectTimeout = options.connectTimeout ?? 30000;

  let discovery = createDiscovery(host, port, connectTimeout);
  let connection = null;
  let targetManager = null;
  let sessionRegistry = null;
  let connected = false;
  const targetLocks = new Map();

  async function acquireLock(targetId) {
    // Wait for any existing lock to be released
    while (targetLocks.has(targetId)) {
      await targetLocks.get(targetId);
    }
    // Create a new lock
    let releaseFn;
    const lockPromise = new Promise(resolve => {
      releaseFn = resolve;
    });
    targetLocks.set(targetId, lockPromise);
    return { promise: lockPromise, release: releaseFn };
  }

  function releaseLock(targetId, lock) {
    if (targetLocks.get(targetId) === lock.promise) {
      targetLocks.delete(targetId);
    }
    lock.release();
  }

  function ensureConnected() {
    if (!connected) {
      throw new Error('BrowserClient not connected. Call connect() first.');
    }
  }

  async function doConnect() {
    const version = await discovery.getVersion();
    connection = createConnection(version.webSocketDebuggerUrl);
    await connection.connect();

    targetManager = createTargetManager(connection);
    sessionRegistry = createSessionRegistry(connection);

    await targetManager.enableDiscovery();
    connected = true;
  }

  /**
   * Connect to Chrome
   * @returns {Promise<void>}
   */
  async function connect() {
    if (connected) return;

    const connectPromise = doConnect();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(timeoutError(`Connection to Chrome timed out after ${connectTimeout}ms`));
      }, connectTimeout);
    });

    await Promise.race([connectPromise, timeoutPromise]);
  }

  /**
   * Disconnect from Chrome
   * @returns {Promise<void>}
   */
  async function disconnect() {
    if (!connected) return;

    await sessionRegistry.cleanup();
    await targetManager.cleanup();
    await connection.close();
    connected = false;
  }

  /**
   * Get all page targets
   * @returns {Promise<Array>} Array of page info objects
   */
  async function getPages() {
    ensureConnected();
    return targetManager.getPages();
  }

  /**
   * Create a new page (tab)
   * @param {string} [url='about:blank'] - Initial URL
   * @returns {Promise<import('../types.js').CDPSession>} Page session
   */
  async function newPage(url = 'about:blank') {
    ensureConnected();

    const targetId = await targetManager.createTarget(url);
    const sessionId = await sessionRegistry.attach(targetId);

    return createPageSession(connection, sessionId, targetId);
  }

  /**
   * Attach to existing page
   * @param {string} targetId - Target ID to attach to
   * @returns {Promise<import('../types.js').CDPSession>} Page session
   */
  async function attachToPage(targetId) {
    ensureConnected();
    const lock = await acquireLock(targetId);
    try {
      const sessionId = await sessionRegistry.attach(targetId);
      return createPageSession(connection, sessionId, targetId);
    } finally {
      releaseLock(targetId, lock);
    }
  }

  /**
   * Find and attach to page by URL pattern
   * @param {string|RegExp} urlPattern - URL pattern to match
   * @returns {Promise<import('../types.js').CDPSession|null>} Page session or null
   */
  async function findPage(urlPattern) {
    ensureConnected();

    const pages = await getPages();
    const regex = urlPattern instanceof RegExp ? urlPattern : new RegExp(urlPattern);
    const target = pages.find(p => regex.test(p.url));

    if (!target) return null;
    return attachToPage(target.targetId);
  }

  /**
   * Close a page
   * @param {string} targetId - Target ID to close
   * @returns {Promise<void>}
   */
  async function closePage(targetId) {
    ensureConnected();
    const lock = await acquireLock(targetId);
    try {
      await sessionRegistry.detachByTarget(targetId);
      await targetManager.closeTarget(targetId);
    } finally {
      releaseLock(targetId, lock);
    }
  }

  return {
    connect,
    disconnect,
    getPages,
    newPage,
    attachToPage,
    findPage,
    closePage,
    isConnected: () => connected,
    get connection() { return connection; },
    get targets() { return targetManager; },
    get sessions() { return sessionRegistry; }
  };
}
