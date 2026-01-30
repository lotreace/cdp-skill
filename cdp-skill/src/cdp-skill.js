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
 */

import { createBrowser, getChromeStatus } from './cdp.js';
import { createPageController } from './page.js';
import { createElementLocator, createInputEmulator } from './dom.js';
import { createScreenshotCapture, createConsoleCapture, createPdfCapture } from './capture.js';
import { createAriaSnapshot } from './aria.js';
import { createCookieManager } from './page.js';
import { runSteps } from './runner.js';

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
 */
async function getInput() {
  // Check for JSON argument (skip node and script path)
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Join all args in case JSON was split by shell
    const argInput = args.join(' ').trim();
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
 * Creates error response JSON
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
 * Handle chromeStatus step - lightweight, no session needed
 */
async function handleChromeStatus(config, step) {
  const host = config.host || 'localhost';
  const port = config.port || 9222;
  const autoLaunch = step.chromeStatus === true || step.chromeStatus?.autoLaunch !== false;
  const headless = step.chromeStatus?.headless || false;

  const status = await getChromeStatus({ host, port, autoLaunch, headless });

  return {
    status: status.running ? 'passed' : 'failed',
    chrome: status,
    steps: [{
      action: 'chromeStatus',
      status: status.running ? 'passed' : 'failed',
      output: status
    }],
    outputs: [{ step: 0, action: 'chromeStatus', output: status }],
    errors: status.error ? [{ step: 0, action: 'chromeStatus', error: status.error }] : []
  };
}

/**
 * Main CLI execution
 */
async function main() {
  let browser = null;
  let pageController = null;

  try {
    // Read and parse input (argument preferred, stdin fallback)
    const input = await getInput();
    const json = parseInput(input);

    // Extract config with defaults
    const config = json.config || {};
    const host = config.host || 'localhost';
    const port = config.port || 9222;
    const timeout = config.timeout || 30000;

    // Handle chromeStatus specially - no session needed
    if (isChromeStatusOnly(json.steps)) {
      const result = await handleChromeStatus(config, json.steps[0]);
      console.log(JSON.stringify(result));
      process.exit(result.status === 'passed' ? 0 : 1);
    }

    // Connect to browser
    browser = createBrowser({ host, port, connectTimeout: timeout });

    try {
      await browser.connect();
    } catch (err) {
      throw {
        type: ErrorType.CONNECTION,
        message: `Chrome not running on ${host}:${port} - ${err.message}`
      };
    }

    // Get or create page session
    let session;
    if (config.targetId) {
      try {
        session = await browser.attachToPage(config.targetId);
      } catch (err) {
        throw {
          type: ErrorType.CONNECTION,
          message: `Could not attach to tab ${config.targetId}: ${err.message}`
        };
      }
    } else {
      try {
        // If Chrome was just started, it has an empty tab - reuse it instead of creating another
        // Otherwise create a new tab for this test session
        // User should pass targetId from response to subsequent calls to reuse the same tab
        const emptyTab = await browser.findPage(/^(about:blank|chrome:\/\/newtab)/);
        if (emptyTab) {
          session = emptyTab;
        } else {
          session = await browser.newPage();
        }
      } catch (err) {
        // Check if Chrome has no tabs open (common when started with --remote-debugging-port)
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
    }

    // Create dependencies
    pageController = createPageController(session);
    const elementLocator = createElementLocator(session);
    const inputEmulator = createInputEmulator(session);
    const screenshotCapture = createScreenshotCapture(session);
    const consoleCapture = createConsoleCapture(session);
    const pdfCapture = createPdfCapture(session);
    const ariaSnapshot = createAriaSnapshot(session);
    const cookieManager = createCookieManager(session);

    // Initialize page controller (enables required CDP domains)
    await pageController.initialize();

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
      cookieManager
    };

    // Run steps
    const result = await runSteps(deps, json.steps, {
      stopOnError: true,
      stepTimeout: timeout
    });

    // Build output with tab info
    const viewport = await pageController.getViewport();
    const output = {
      status: result.status,
      tab: {
        targetId: session.targetId,
        url: await pageController.getUrl(),
        title: await pageController.getTitle(),
        viewport
      },
      steps: result.steps,
      outputs: result.outputs,
      errors: result.errors,
      screenshots: result.screenshots
    };

    // Output result
    console.log(JSON.stringify(output));

    // Cleanup
    await consoleCapture.stopCapture();
    pageController.dispose();
    await browser.disconnect();

    process.exit(result.status === 'passed' ? 0 : 1);

  } catch (err) {
    // Cleanup on error
    if (pageController) {
      try { pageController.dispose(); } catch (e) { /* ignore */ }
    }
    if (browser) {
      try { await browser.disconnect(); } catch (e) { /* ignore */ }
    }

    // Handle known error types
    if (err.type) {
      console.log(JSON.stringify(errorResponse(err.type, err.message)));
    } else {
      // Unknown error
      console.log(JSON.stringify(errorResponse(ErrorType.EXECUTION, err.message || String(err))));
    }

    process.exit(1);
  }
}

main();
