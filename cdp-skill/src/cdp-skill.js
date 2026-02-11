#!/usr/bin/env node
/**
 * CDP Skill CLI
 *
 * JSON interpreter for browser automation. Accepts JSON as argument (preferred)
 * or reads from stdin (fallback).
 *
 * Usage:
 *   node src/cdp-skill.js '{"steps":[{"goto":"https://google.com"}]}'
 *   echo '{"steps":[...]}' | node src/cdp-skill.js
 *   node src/cdp-skill.js --debug '{"steps":[...]}'  # Enable debug logging
 */

import { createBrowser, getChromeStatus } from './cdp/index.js';
import { createPageController } from './page/index.js';
import { createElementLocator, createInputEmulator } from './dom/index.js';
import { createScreenshotCapture, createConsoleCapture, createPdfCapture } from './capture/index.js';
import { createAriaSnapshot } from './aria.js';
import { createCookieManager } from './page/index.js';
import { runSteps } from './runner/index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Debug logging state
let debugMode = false;
let debugLogDir = null;
let debugSequence = 0;

/**
 * Initialize debug logging - creates log/ directory
 */
function initDebugLogging() {
  debugLogDir = path.join(process.cwd(), 'log');
  if (!fs.existsSync(debugLogDir)) {
    fs.mkdirSync(debugLogDir, { recursive: true });
  }
  // Find next sequence number based on existing files
  const files = fs.readdirSync(debugLogDir).filter(f => f.match(/^\d{3}-/));
  if (files.length > 0) {
    const maxSeq = Math.max(...files.map(f => parseInt(f.slice(0, 3), 10)));
    debugSequence = maxSeq + 1;
  } else {
    debugSequence = 1;
  }
}

/**
 * Generate a descriptive filename based on steps and tab
 * @param {Array} steps - Array of step objects
 * @param {string} status - 'ok' or 'error'
 * @param {string|null} tabId - Tab ID (e.g., 't1')
 * @returns {string} Filename like "001-t1-goto-click.ok.json"
 */
function generateDebugFilename(steps, status, tabId) {
  const seq = String(debugSequence).padStart(3, '0');
  debugSequence++;

  // Extract action names from steps (max 3 for filename brevity)
  const actions = steps.slice(0, 3).map(step => {
    // Find the action key in the step
    const actionKeys = ['goto', 'click', 'fill', 'type', 'press', 'scroll', 'snapshot',
      'query', 'hover', 'wait', 'sleep', 'pageFunction', 'newTab', 'closeTab',
      'selectOption', 'select', 'viewport', 'cookies', 'back', 'forward', 'drag',
      'frame', 'elementsAt', 'extract', 'formState', 'assert', 'validate', 'submit'];
    for (const key of actionKeys) {
      if (step[key] !== undefined) return key;
    }
    return 'step';
  });

  let actionStr = actions.join('-');
  if (steps.length > 3) {
    actionStr += `-plus${steps.length - 3}`;
  }

  // Sanitize for filename safety
  actionStr = actionStr.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 50);

  // Include tab ID if available
  const tabPart = tabId ? `${tabId}-` : '';

  return `${seq}-${tabPart}${actionStr}.${status}.json`;
}

/**
 * Write debug log combining request and response
 * @param {Object} request - The parsed JSON request
 * @param {Object} response - The response object
 */
function writeDebugLog(request, response) {
  if (!debugMode || !debugLogDir) return;

  const steps = request.steps || [];
  const status = response.status || 'unknown';

  // Extract tab ID from request or response
  const tabId = request.tab || response.tab || response.closed || null;

  const filename = generateDebugFilename(steps, status, tabId);
  const filepath = path.join(debugLogDir, filename);

  const logEntry = {
    timestamp: new Date().toISOString(),
    request: request,
    response: response
  };

  try {
    fs.writeFileSync(filepath, JSON.stringify(logEntry, null, 2));
  } catch (e) {
    // Don't let logging errors break the CLI
    console.error(`Debug log error: ${e.message}`);
  }
}

// Tab registry - maps short aliases (t1, t2, ...) to {targetId, host, port} entries
const TAB_REGISTRY_PATH = path.join(os.tmpdir(), 'cdp-skill-tabs.json');

// Frame state registry - persists frame context across CLI invocations, keyed by targetId
const FRAME_STATE_PATH = path.join(os.tmpdir(), 'cdp-skill-frames.json');

function loadFrameStates() {
  try {
    if (fs.existsSync(FRAME_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(FRAME_STATE_PATH, 'utf8'));
    }
  } catch (e) {
    // Ignore errors, start fresh
  }
  return {};
}

function saveFrameStates(states) {
  try {
    fs.writeFileSync(FRAME_STATE_PATH, JSON.stringify(states));
  } catch (e) {
    // Ignore errors
  }
}

function saveFrameState(targetId, frameState) {
  const states = loadFrameStates();
  states[targetId] = { ...frameState, timestamp: Date.now() };
  saveFrameStates(states);
}

function loadFrameState(targetId) {
  const states = loadFrameStates();
  const state = states[targetId];
  if (!state) return null;
  // Expire after 1 hour (frames may have reloaded)
  if (Date.now() - state.timestamp > 3600000) {
    delete states[targetId];
    saveFrameStates(states);
    return null;
  }
  return state;
}

function clearFrameState(targetId) {
  const states = loadFrameStates();
  delete states[targetId];
  saveFrameStates(states);
}

function loadTabRegistry() {
  try {
    if (fs.existsSync(TAB_REGISTRY_PATH)) {
      return JSON.parse(fs.readFileSync(TAB_REGISTRY_PATH, 'utf8'));
    }
  } catch (e) {
    // Ignore errors, start fresh
  }
  return { tabs: {}, nextId: 1 };
}

function saveTabRegistry(registry) {
  try {
    fs.writeFileSync(TAB_REGISTRY_PATH, JSON.stringify(registry, null, 2));
  } catch (e) {
    // Ignore errors
  }
}

function registerTab(targetId, host = 'localhost', port = 9222) {
  const registry = loadTabRegistry();

  // Check if already registered
  for (const [alias, entry] of Object.entries(registry.tabs)) {
    const existingTargetId = typeof entry === 'string' ? entry : entry.targetId;
    if (existingTargetId === targetId) return alias;
  }

  // Assign new alias
  const alias = `t${registry.nextId}`;
  registry.tabs[alias] = { targetId, host, port };
  registry.nextId++;
  saveTabRegistry(registry);
  return alias;
}

function resolveTabEntry(aliasOrTargetId) {
  if (!aliasOrTargetId) return null;

  // If it looks like a full targetId (32 hex chars), return with defaults
  if (/^[A-F0-9]{32}$/i.test(aliasOrTargetId)) {
    return { targetId: aliasOrTargetId, host: 'localhost', port: 9222 };
  }

  const registry = loadTabRegistry();
  const entry = registry.tabs[aliasOrTargetId];
  if (!entry) return null;

  // Defensive: handle stale registry files with string entries
  if (typeof entry === 'string') {
    return { targetId: entry, host: 'localhost', port: 9222 };
  }

  return { targetId: entry.targetId, host: entry.host || 'localhost', port: entry.port || 9222 };
}

function resolveTabAlias(aliasOrTargetId) {
  if (!aliasOrTargetId) return null;

  // If it looks like a full targetId (32 hex chars), return as-is
  if (/^[A-F0-9]{32}$/i.test(aliasOrTargetId)) {
    return aliasOrTargetId;
  }

  // Try to resolve alias
  const registry = loadTabRegistry();
  const entry = registry.tabs[aliasOrTargetId];
  if (!entry) return aliasOrTargetId;

  // Defensive: handle stale registry files with string entries
  return typeof entry === 'string' ? entry : entry.targetId;
}

function unregisterTab(targetId) {
  const registry = loadTabRegistry();
  for (const [alias, entry] of Object.entries(registry.tabs)) {
    const existingTargetId = typeof entry === 'string' ? entry : entry.targetId;
    if (existingTargetId === targetId) {
      delete registry.tabs[alias];
      saveTabRegistry(registry);
      clearFrameState(targetId);
      return alias;
    }
  }
  return null;
}

function getTabAlias(targetId) {
  const registry = loadTabRegistry();
  for (const [alias, entry] of Object.entries(registry.tabs)) {
    const existingTargetId = typeof entry === 'string' ? entry : entry.targetId;
    if (existingTargetId === targetId) return alias;
  }
  return null;
}

const ErrorType = {
  PARSE: 'PARSE',
  VALIDATION: 'VALIDATION',
  CONNECTION: 'CONNECTION',
  EXECUTION: 'EXECUTION'
};

/**
 * Reads entire stdin and returns as string (with timeout for TTY detection)
 */
async function readStdin() {
  return new Promise((resolve, reject) => {
    // If stdin is a TTY (interactive terminal) with no data, don't wait
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    const chunks = [];
    let hasData = false;

    process.stdin.setEncoding('utf8');

    process.stdin.on('data', chunk => {
      hasData = true;
      chunks.push(chunk);
    });

    process.stdin.on('end', () => {
      resolve(chunks.join(''));
    });

    process.stdin.on('error', err => {
      reject(err);
    });

    // Timeout if no data arrives (handles edge cases)
    setTimeout(() => {
      if (!hasData) {
        resolve('');
      }
    }, 100);
  });
}

/**
 * Get input from argument or stdin
 * Prefers argument for cross-platform compatibility
 * Also parses --debug flag
 */
async function getInput() {
  // Check for JSON argument (skip node and script path)
  const args = process.argv.slice(2);

  // Filter out --debug flag and enable debug mode if present
  const filteredArgs = [];
  for (const arg of args) {
    if (arg === '--debug') {
      debugMode = true;
      initDebugLogging();
    } else {
      filteredArgs.push(arg);
    }
  }

  if (filteredArgs.length > 0) {
    // Join all args in case JSON was split by shell
    const argInput = filteredArgs.join(' ').trim();
    if (argInput) {
      return argInput;
    }
  }

  // Fallback to stdin
  return readStdin();
}

/**
 * Parses JSON input and validates basic structure
 */
function parseInput(input) {
  const trimmed = input.trim();

  if (!trimmed) {
    throw { type: ErrorType.PARSE, message: 'Empty input' };
  }

  let json;
  try {
    json = JSON.parse(trimmed);
  } catch (err) {
    throw { type: ErrorType.PARSE, message: `Invalid JSON: ${err.message}` };
  }

  if (!json || typeof json !== 'object') {
    throw { type: ErrorType.VALIDATION, message: 'Input must be a JSON object' };
  }

  if (json.config) {
    throw {
      type: ErrorType.VALIDATION,
      message: '"config" is no longer supported. Use top-level "tab"/"timeout". Connection params go in newTab: {"steps":[{"newTab":{"url":"...","port":9333}}]}'
    };
  }

  if (!json.steps) {
    throw { type: ErrorType.VALIDATION, message: 'Missing required "steps" array' };
  }

  if (!Array.isArray(json.steps)) {
    throw { type: ErrorType.VALIDATION, message: '"steps" must be an array' };
  }

  if (json.steps.length === 0) {
    throw { type: ErrorType.VALIDATION, message: '"steps" array cannot be empty' };
  }

  return json;
}

/**
 * Creates error response JSON (streamlined format)
 */
function errorResponse(type, message) {
  return {
    status: 'error',
    error: { type, message }
  };
}

/**
 * Check if steps contain only chromeStatus (lightweight query)
 */
function isChromeStatusOnly(steps) {
  return steps.length === 1 && steps[0].chromeStatus !== undefined;
}

/**
 * Check if steps contain only closeTab (doesn't need a tab session)
 */
function isCloseTabOnly(steps) {
  return steps.length === 1 && steps[0].closeTab !== undefined;
}

/**
 * Handle chromeStatus step - lightweight, no session needed
 */
async function handleChromeStatus(step) {
  const params = typeof step.chromeStatus === 'object' ? step.chromeStatus : {};
  const host = params.host || 'localhost';
  const port = params.port || 9222;
  const autoLaunch = step.chromeStatus === true || params.autoLaunch !== false;
  const headless = params.headless || false;

  const status = await getChromeStatus({ host, port, autoLaunch, headless });

  // Streamlined format
  const content = {
    status: status.running ? 'ok' : 'error',
    chrome: status,
    steps: [{ action: 'chromeStatus', status: status.running ? 'ok' : 'error' }]
  };

  // Add errors only if present
  if (status.error) {
    content.errors = [{ step: 1, action: 'chromeStatus', error: status.error }];
  }

  return content;
}

/**
 * Handle closeTab step - no session needed, just close the target via CDP
 */
async function handleCloseTab(step) {
  const tabRef = step.closeTab;

  if (!tabRef || typeof tabRef !== 'string') {
    return {
      status: 'error',
      error: { type: 'VALIDATION', message: 'closeTab requires a tab id or targetId string' }
    };
  }

  // Resolve alias to full entry (targetId + host + port)
  const entry = resolveTabEntry(tabRef);
  const targetId = entry ? entry.targetId : tabRef;
  const host = entry ? entry.host : 'localhost';
  const port = entry ? entry.port : 9222;
  const alias = getTabAlias(targetId);

  try {
    // Use http to close the target directly via CDP's /json/close endpoint
    const http = await import('http');
    const closeUrl = `http://${host}:${port}/json/close/${targetId}`;

    await new Promise((resolve, reject) => {
      const req = http.get(closeUrl, (res) => {
        res.resume(); // Drain response body to prevent memory leak
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`Failed to close tab: HTTP ${res.statusCode}`));
        }
      });
      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Timeout closing tab'));
      });
    });

    // Unregister the tab alias
    unregisterTab(targetId);

    // Streamlined format
    return {
      status: 'ok',
      closed: alias || tabRef,
      steps: [{ action: 'closeTab', status: 'ok' }]
    };

  } catch (err) {
    return {
      status: 'error',
      error: { type: 'EXECUTION', message: err.message }
    };
  }
}

/**
 * Main CLI execution
 */
async function main() {
  const startTime = Date.now();
  let browser = null;
  let pageController = null;
  let parsedRequest = null;  // Track for debug logging in error handler

  try {
    // Read and parse input (argument preferred, stdin fallback)
    const input = await getInput();
    const json = parseInput(input);
    parsedRequest = json;  // Store for error handler

    // Extract top-level fields
    const tab = json.tab || null;
    const timeout = json.timeout || 30000;
    let host = 'localhost';
    let port = 9222;
    let headless = false;

    // Handle chromeStatus specially - no session needed
    if (isChromeStatusOnly(json.steps)) {
      const result = await handleChromeStatus(json.steps[0]);
      writeDebugLog(json, result);
      console.log(JSON.stringify(result));
      process.exit(result.status === 'ok' ? 0 : 1);
    }

    // Handle closeTab specially - no session needed, just close the target
    if (isCloseTabOnly(json.steps)) {
      const result = await handleCloseTab(json.steps[0]);
      writeDebugLog(json, result);
      console.log(JSON.stringify(result));
      process.exit(result.status === 'ok' ? 0 : 1);
    }

    // Check if first step is newTab or switchTab
    const firstStep = json.steps[0];
    const hasNewTab = firstStep && firstStep.newTab !== undefined;
    const hasSwitchTab = firstStep && firstStep.switchTab !== undefined;

    // Extract URL and options from newTab if provided
    let newTabUrl = null;
    let newTabTimeout = null;
    if (hasNewTab) {
      const newTabParam = firstStep.newTab;
      if (typeof newTabParam === 'string') {
        newTabUrl = newTabParam;
      } else if (typeof newTabParam === 'object' && newTabParam !== null) {
        newTabUrl = newTabParam.url || null;
        newTabTimeout = newTabParam.timeout || null;
        // Extract connection overrides from newTab object form
        if (newTabParam.host) host = newTabParam.host;
        if (newTabParam.port) port = newTabParam.port;
        if (newTabParam.headless) headless = newTabParam.headless;
      }
    }

    // Extract connection overrides from switchTab object form
    if (hasSwitchTab) {
      const switchParam = firstStep.switchTab;
      if (typeof switchParam === 'object' && switchParam !== null) {
        if (switchParam.host) host = switchParam.host;
        if (switchParam.port) port = switchParam.port;
      }
    }

    // If tab specified, resolve host/port from registry
    if (tab) {
      const tabEntry = resolveTabEntry(tab);
      if (tabEntry) {
        host = tabEntry.host;
        port = tabEntry.port;
      }
    }

    // Resolve tab alias to targetId
    const resolvedTargetId = tab ? resolveTabAlias(tab) : null;

    // Connect to browser, auto-launch if needed
    browser = createBrowser({ host, port, connectTimeout: timeout });

    try {
      await browser.connect();
    } catch (err) {
      // Chrome not running - try to auto-launch
      const status = await getChromeStatus({ host, port, autoLaunch: true, headless });
      if (!status.running) {
        throw {
          type: ErrorType.CONNECTION,
          message: `Chrome not running and failed to launch: ${status.error || 'unknown error'}`
        };
      }
      // Retry connection after launch
      try {
        await browser.connect();
      } catch (retryErr) {
        throw {
          type: ErrorType.CONNECTION,
          message: `Chrome launched but connection failed: ${retryErr.message}`
        };
      }
    }

    // Get page session - requires explicit targetId or newTab step
    let session;

    if (resolvedTargetId) {
      try {
        session = await browser.attachToPage(resolvedTargetId);
      } catch (err) {
        throw {
          type: ErrorType.CONNECTION,
          message: `Could not attach to tab ${tab}${tab !== resolvedTargetId ? ` (${resolvedTargetId})` : ''}: ${err.message}`
        };
      }
    } else if (hasSwitchTab) {
      // Connect to an existing tab by alias, targetId, or URL regex
      try {
        const switchParam = firstStep.switchTab;
        let switchTargetId = null;

        if (typeof switchParam === 'string') {
          // Try alias first, then targetId
          switchTargetId = resolveTabAlias(switchParam);
        } else if (switchParam && typeof switchParam === 'object') {
          if (switchParam.targetId) {
            switchTargetId = switchParam.targetId;
          } else if (switchParam.url) {
            // Find tab by URL regex
            const pages = await browser.getPages();
            const urlRegex = new RegExp(switchParam.url);
            const match = pages.find(p => urlRegex.test(p.url));
            if (!match) {
              throw new Error(`No tab matches URL pattern: ${switchParam.url}`);
            }
            switchTargetId = match.targetId;
          }
        }

        if (!switchTargetId) {
          throw new Error('Could not resolve switchTab target');
        }

        session = await browser.attachToPage(switchTargetId);
        const tabAlias = getTabAlias(switchTargetId) || registerTab(switchTargetId, host, port);
        json.steps[0]._switchTabHandled = true;
        json.steps[0]._switchTabAlias = tabAlias;
      } catch (err) {
        throw {
          type: ErrorType.CONNECTION,
          message: `switchTab failed: ${err.message}`
        };
      }
    } else if (hasNewTab) {
      // Create new tab via newTab step
      try {
        // Create blank tab - URL navigation happens in step executor
        session = await browser.newPage('about:blank');
        // Register the new tab and get its alias
        const tabAlias = registerTab(session.targetId, host, port);
        // Mark newTab as handled and store URL/alias/timeout if provided
        json.steps[0]._newTabHandled = true;
        json.steps[0]._newTabUrl = newTabUrl;
        json.steps[0]._newTabTimeout = newTabTimeout;
        json.steps[0]._newTabAlias = tabAlias;
      } catch (err) {
        if (err.message.includes('no browser is open')) {
          throw {
            type: ErrorType.CONNECTION,
            message: `Chrome has no tabs open. This can happen when Chrome is started with --remote-debugging-port but no window is visible. Try opening a new Chrome window or restarting Chrome normally.`
          };
        }
        throw {
          type: ErrorType.EXECUTION,
          message: `Failed to create new tab: ${err.message}`
        };
      }
    } else {
      // No targetId and no newTab/switchTab step - fail with helpful message
      throw {
        type: ErrorType.VALIDATION,
        message: `No tab specified. Either:\n` +
          `  1. Use {"steps":[{"newTab":"url"},...]} to create a new tab\n` +
          `  2. Use {"steps":[{"switchTab":"t1"},...]} to connect to an existing tab\n` +
          `  3. Pass tab id: {"tab":"t1", "steps":[...]}`
      };
    }

    // Create dependencies
    pageController = createPageController(session, {
      onFrameChanged: (frameState) => saveFrameState(session.targetId, frameState),
      getSavedFrameState: () => loadFrameState(session.targetId)
    });
    const frameContextProvider = () => pageController.getFrameContext();
    const elementLocator = createElementLocator(session, { getFrameContext: frameContextProvider });
    const inputEmulator = createInputEmulator(session);
    const screenshotCapture = createScreenshotCapture(session);
    const consoleCapture = createConsoleCapture(session);
    const pdfCapture = createPdfCapture(session);
    const ariaSnapshot = createAriaSnapshot(session, { getFrameContext: frameContextProvider });
    const cookieManager = createCookieManager(session);

    // Initialize page controller (enables required CDP domains)
    await pageController.initialize();

    // Reset viewport to default (clears any previous emulation from other sessions)
    await pageController.resetViewport();

    // Start console capture to collect logs during execution
    await consoleCapture.startCapture();

    const deps = {
      browser,
      pageController,
      elementLocator,
      inputEmulator,
      screenshotCapture,
      consoleCapture,
      pdfCapture,
      ariaSnapshot,
      cookieManager,
      registerNewTab: (targetId) => registerTab(targetId, host, port)
    };

    // Run steps (pass tab alias for auto-screenshots)
    const tabAlias = getTabAlias(session.targetId) || registerTab(session.targetId, host, port);
    const result = await runSteps(deps, json.steps, {
      stopOnError: true,
      stepTimeout: timeout,
      targetId: session.targetId,
      tabAlias
    });

    // Capture screenshot at command-level (replaces per-step screenshots)
    let screenshotPath = null;
    try {
      const screenshotId = tabAlias || 'command';
      screenshotPath = path.join(os.tmpdir(), 'cdp-skill', `${screenshotId}.after.png`);
      // Ensure directory exists
      const screenshotDir = path.dirname(screenshotPath);
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      await screenshotCapture.captureToFile(screenshotPath, { fullPage: false });
    } catch (e) {
      // Screenshot failure shouldn't fail the command
      screenshotPath = null;
    }

    // Bubble up site profile info from goto/newTab steps to top level
    let siteProfile = undefined;
    let actionRequired = undefined;
    for (const step of result.steps) {
      if (step.siteProfile) {
        siteProfile = step.siteProfile;
        delete step.siteProfile;
      } else if (step.profileAvailable === false) {
        actionRequired = {
          action: 'createSiteProfile',
          domain: step.profileDomain,
          message: `STOP: No site profile for "${step.profileDomain}". You MUST create one before doing anything else. Run these steps now: (1) snapshot — see page structure, (2) pageFunction — detect framework/routing, (3) writeSiteProfile — save what you learned. Then continue your task. Skipping this causes unreliable automation.`
        };
        delete step.profileAvailable;
        delete step.profileDomain;
        delete step.hint;
      }
    }

    // Build streamlined output
    const output = {
      status: result.status,
      tab: getTabAlias(session.targetId) || registerTab(session.targetId, host, port),
      // Site profile — prominent, right after status/tab
      siteProfile,
      actionRequired,
      // Command-level auto-snapshot results
      navigated: result.navigated,
      fullSnapshot: result.fullSnapshot,
      screenshot: screenshotPath,
      context: result.context,
      changes: result.changes,
      // Command-level console (errors/warnings only)
      console: result.console,
      steps: result.steps,
      errors: result.errors,
      // Viewport snapshot at the end (can be large)
      viewportSnapshot: result.viewportSnapshot,
      truncated: result.truncated
    };

    // Remove null/undefined fields for compactness
    if (!output.siteProfile) delete output.siteProfile;
    if (!output.actionRequired) delete output.actionRequired;
    if (output.navigated === undefined) delete output.navigated;
    if (!output.fullSnapshot) delete output.fullSnapshot;
    if (!output.context) delete output.context;
    if (!output.changes) delete output.changes;
    if (!output.viewportSnapshot) delete output.viewportSnapshot;
    if (output.truncated === undefined) delete output.truncated;
    if (!output.screenshot) delete output.screenshot;
    if (!output.console) delete output.console;
    if (output.errors.length === 0) delete output.errors;

    // Simplify context - remove scroll.x and null values
    if (output.context) {
      if (output.context.scroll) {
        delete output.context.scroll.x;
      }
      if (output.context.activeElement === null) delete output.context.activeElement;
      if (output.context.modal === null) delete output.context.modal;
    }

    // Create final output (no summary - agent should inspect keys directly)
    const finalOutput = output;

    // Debug logging
    writeDebugLog(json, finalOutput);

    // Write metrics if CDP_METRICS_FILE is set
    const metricsFile = process.env.CDP_METRICS_FILE;
    if (metricsFile) {
      const inputBytes = Buffer.byteLength(input, 'utf8');
      const outputJson = JSON.stringify(finalOutput);
      const outputBytes = Buffer.byteLength(outputJson, 'utf8');
      const metricsLine = JSON.stringify({
        ts: new Date().toISOString(),
        input_bytes: inputBytes,
        output_bytes: outputBytes,
        steps: json.steps.length,
        time_ms: Date.now() - startTime
      }) + '\n';
      try {
        const metricsDir = path.dirname(metricsFile);
        if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });
        fs.appendFileSync(metricsFile, metricsLine);
      } catch (e) { /* metrics write failure is non-fatal */ }
    }

    // Output result
    console.log(JSON.stringify(finalOutput));

    // Cleanup
    await consoleCapture.stopCapture();
    pageController.dispose();
    await browser.disconnect();

    process.exit(result.status === 'ok' ? 0 : 1);

  } catch (err) {
    // Cleanup on error
    if (pageController) {
      try { pageController.dispose(); } catch (e) { /* ignore */ }
    }
    if (browser) {
      try { await browser.disconnect(); } catch (e) { /* ignore */ }
    }

    // Handle known error types
    let errResponse;
    if (err.type) {
      errResponse = errorResponse(err.type, err.message);
    } else {
      // Unknown error
      errResponse = errorResponse(ErrorType.EXECUTION, err.message || String(err));
    }

    // Debug logging for errors
    writeDebugLog(parsedRequest || { steps: [] }, errResponse);

    console.log(JSON.stringify(errResponse));
    process.exit(1);
  }
}

main();
