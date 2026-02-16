/**
 * Debug Capture Module
 * Captures debugging state (screenshots, DOM) before/after actions
 *
 * PUBLIC EXPORTS:
 * - createDebugCapture(session, screenshotCapture, options?) - Factory for debug capture
 *
 * @module cdp-skill/capture/debug-capture
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Create a debug capture utility for capturing debugging state before/after actions
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {Object} screenshotCapture - Screenshot capture instance
 * @param {Object} [options] - Configuration options
 * @param {string} [options.outputDir] - Output directory (defaults to platform temp dir)
 * @param {boolean} [options.captureScreenshots=true] - Whether to capture screenshots
 * @param {boolean} [options.captureDom=true] - Whether to capture DOM
 * @returns {Object} Debug capture interface
 */
export function createDebugCapture(session, screenshotCapture, options = {}) {
  // Default to platform-specific temp directory
  const defaultOutputDir = path.join(os.tmpdir(), 'cdp-skill', 'debug-captures');
  const outputDir = options.outputDir || defaultOutputDir;
  const captureScreenshots = options.captureScreenshots !== false;
  const captureDom = options.captureDom !== false;
  let stepIndex = 0;

  async function ensureOutputDir() {
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (e) {
      // Ignore if already exists
    }
  }

  /**
   * Capture current state
   * @param {string} prefix - File name prefix
   * @returns {Promise<{timestamp: string, screenshot?: string, screenshotError?: string, dom?: string, domError?: string}>}
   */
  async function captureState(prefix) {
    await ensureOutputDir();
    const result = { timestamp: new Date().toISOString() };

    if (captureScreenshots) {
      try {
        const screenshotPath = path.join(outputDir, `${prefix}.png`);
        const buffer = await screenshotCapture.captureViewport();
        await fs.writeFile(screenshotPath, buffer);
        result.screenshot = screenshotPath;
      } catch (e) {
        result.screenshotError = e.message;
      }
    }

    if (captureDom) {
      try {
        const domPath = path.join(outputDir, `${prefix}.html`);
        const domResult = await session.send('Runtime.evaluate', {
          expression: 'document.documentElement.outerHTML',
          returnByValue: true
        });
        if (domResult.result && domResult.result.value) {
          await fs.writeFile(domPath, domResult.result.value);
          result.dom = domPath;
        }
      } catch (e) {
        result.domError = e.message;
      }
    }

    return result;
  }

  /**
   * Capture state before an action
   * @param {string} action - Action name
   * @param {Object} [params] - Action parameters
   * @returns {Promise<Object>} Capture result
   */
  async function captureBefore(action, params) {
    stepIndex++;
    const prefix = `step-${String(stepIndex).padStart(3, '0')}-${action}-before`;
    return captureState(prefix);
  }

  /**
   * Capture state after an action
   * @param {string} action - Action name
   * @param {Object} [params] - Action parameters
   * @param {string} status - Action status ('ok' or 'error')
   * @returns {Promise<Object>} Capture result
   */
  async function captureAfter(action, params, status) {
    const prefix = `step-${String(stepIndex).padStart(3, '0')}-${action}-after-${status}`;
    return captureState(prefix);
  }

  /**
   * Get current page info
   * @returns {Promise<{url: string, title: string, readyState: string, scrollX: number, scrollY: number, innerWidth: number, innerHeight: number, documentWidth: number, documentHeight: number} | {error: string}>}
   */
  async function getPageInfo() {
    try {
      const result = await session.send('Runtime.evaluate', {
        expression: `({
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight
        })`,
        returnByValue: true
      });
      return result.result.value;
    } catch (e) {
      return { error: e.message };
    }
  }

  /**
   * Reset step counter
   */
  function reset() {
    stepIndex = 0;
  }

  return {
    captureBefore,
    captureAfter,
    captureState,
    getPageInfo,
    reset
  };
}
