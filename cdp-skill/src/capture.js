/**
 * Capture and Monitoring
 * Screenshots, console capture, network monitoring, error aggregation,
 * debug capture, and eval serialization
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ============================================================================
// Console Capture (from ConsoleCapture.js)
// ============================================================================

const DEFAULT_MAX_MESSAGES = 10000;

/**
 * Create a console capture utility for capturing console messages and exceptions
 * Listens only to Runtime.consoleAPICalled to avoid duplicate messages
 * @param {Object} session - CDP session
 * @param {Object} [options] - Configuration options
 * @param {number} [options.maxMessages=10000] - Maximum messages to store
 * @returns {Object} Console capture interface
 */
export function createConsoleCapture(session, options = {}) {
  const maxMessages = options.maxMessages || DEFAULT_MAX_MESSAGES;
  let messages = [];
  let capturing = false;
  const handlers = {
    consoleAPICalled: null,
    exceptionThrown: null
  };

  function mapConsoleType(type) {
    const mapping = {
      'log': 'log',
      'debug': 'debug',
      'info': 'info',
      'error': 'error',
      'warning': 'warning',
      'warn': 'warning',
      'dir': 'log',
      'dirxml': 'log',
      'table': 'log',
      'trace': 'log',
      'assert': 'error',
      'count': 'log',
      'timeEnd': 'log'
    };
    return mapping[type] || 'log';
  }

  function formatArgs(args) {
    if (!Array.isArray(args)) return '[invalid args]';
    return args.map(arg => {
      try {
        if (arg.value !== undefined) return String(arg.value);
        if (arg.description) return arg.description;
        if (arg.unserializableValue) return arg.unserializableValue;
        if (arg.preview?.description) return arg.preview.description;
        return `[${arg.type || 'unknown'}]`;
      } catch {
        return '[unserializable]';
      }
    }).join(' ');
  }

  function extractExceptionMessage(exceptionDetails) {
    if (exceptionDetails.exception?.description) return exceptionDetails.exception.description;
    if (exceptionDetails.text) return exceptionDetails.text;
    return 'Unknown exception';
  }

  function addMessage(message) {
    messages.push(message);
    if (messages.length > maxMessages) {
      messages.shift();
    }
  }

  async function startCapture() {
    if (capturing) return;

    await session.send('Runtime.enable');

    handlers.consoleAPICalled = (params) => {
      addMessage({
        type: 'console',
        level: mapConsoleType(params.type),
        text: formatArgs(params.args),
        args: params.args,
        stackTrace: params.stackTrace,
        timestamp: params.timestamp
      });
    };

    handlers.exceptionThrown = (params) => {
      const exception = params.exceptionDetails;
      addMessage({
        type: 'exception',
        level: 'error',
        text: exception.text || extractExceptionMessage(exception),
        exception: exception.exception,
        stackTrace: exception.stackTrace,
        url: exception.url,
        line: exception.lineNumber,
        column: exception.columnNumber,
        timestamp: params.timestamp
      });
    };

    session.on('Runtime.consoleAPICalled', handlers.consoleAPICalled);
    session.on('Runtime.exceptionThrown', handlers.exceptionThrown);

    capturing = true;
  }

  async function stopCapture() {
    if (!capturing) return;

    if (handlers.consoleAPICalled) {
      session.off('Runtime.consoleAPICalled', handlers.consoleAPICalled);
      handlers.consoleAPICalled = null;
    }
    if (handlers.exceptionThrown) {
      session.off('Runtime.exceptionThrown', handlers.exceptionThrown);
      handlers.exceptionThrown = null;
    }

    await session.send('Runtime.disable');

    capturing = false;
  }

  function getMessages() {
    return [...messages];
  }

  function getMessagesSince(timestamp) {
    return messages.filter(m => m.timestamp && m.timestamp >= timestamp);
  }

  function getMessagesBetween(startTimestamp, endTimestamp) {
    return messages.filter(m =>
      m.timestamp && m.timestamp >= startTimestamp && m.timestamp <= endTimestamp
    );
  }

  function getMessagesByLevel(levels) {
    const levelSet = new Set(Array.isArray(levels) ? levels : [levels]);
    return messages.filter(m => levelSet.has(m.level));
  }

  function getMessagesByType(types) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    return messages.filter(m => typeSet.has(m.type));
  }

  function getErrors() {
    return messages.filter(m => m.level === 'error' || m.type === 'exception');
  }

  function getWarnings() {
    return messages.filter(m => m.level === 'warning');
  }

  function hasErrors() {
    return messages.some(m => m.level === 'error' || m.type === 'exception');
  }

  function clear() {
    messages = [];
  }

  async function clearBrowserConsole() {
    await session.send('Console.clearMessages');
  }

  return {
    startCapture,
    stopCapture,
    getMessages,
    getMessagesSince,
    getMessagesBetween,
    getMessagesByLevel,
    getMessagesByType,
    getErrors,
    getWarnings,
    hasErrors,
    clear,
    clearBrowserConsole
  };
}

// ============================================================================
// Screenshot Capture
// ============================================================================

const DEFAULT_MAX_DIMENSION = 16384;
const VALID_FORMATS = ['png', 'jpeg', 'webp'];

/**
 * Create a screenshot capture utility
 * @param {Object} session - CDP session
 * @param {Object} [options] - Configuration options
 * @param {number} [options.maxDimension=16384] - Maximum dimension for full page captures
 * @returns {Object} Screenshot capture interface
 */
export function createScreenshotCapture(session, options = {}) {
  const maxDimension = options.maxDimension || DEFAULT_MAX_DIMENSION;

  function validateFormat(format) {
    if (!VALID_FORMATS.includes(format)) {
      throw new Error(
        `Invalid screenshot format "${format}". Valid formats are: ${VALID_FORMATS.join(', ')}`
      );
    }
  }

  function validateQuality(quality, format) {
    if (quality === undefined) return;
    if (format === 'png') {
      throw new Error('Quality option is only supported for jpeg and webp formats, not png');
    }
    if (typeof quality !== 'number' || quality < 0 || quality > 100) {
      throw new Error('Quality must be a number between 0 and 100');
    }
  }

  function validateOptions(opts = {}) {
    const format = opts.format || 'png';
    validateFormat(format);
    validateQuality(opts.quality, format);
    return { ...opts, format };
  }

  async function captureViewport(captureOptions = {}) {
    const validated = validateOptions(captureOptions);
    const params = { format: validated.format };

    if (params.format !== 'png' && validated.quality !== undefined) {
      params.quality = validated.quality;
    }

    // Support omitBackground option
    if (captureOptions.omitBackground) {
      params.fromSurface = true;
      // Enable transparent background
      await session.send('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 }
      });
    }

    // Support clip option for region capture
    if (captureOptions.clip) {
      params.clip = {
        x: captureOptions.clip.x,
        y: captureOptions.clip.y,
        width: captureOptions.clip.width,
        height: captureOptions.clip.height,
        scale: captureOptions.clip.scale || 1
      };
    }

    const result = await session.send('Page.captureScreenshot', params);

    // Reset background override if we changed it
    if (captureOptions.omitBackground) {
      await session.send('Emulation.setDefaultBackgroundColorOverride');
    }

    return Buffer.from(result.data, 'base64');
  }

  async function captureFullPage(captureOptions = {}) {
    const validated = validateOptions(captureOptions);

    const metrics = await session.send('Page.getLayoutMetrics');
    const { contentSize } = metrics;

    const width = Math.ceil(contentSize.width);
    const height = Math.ceil(contentSize.height);

    if (width > maxDimension || height > maxDimension) {
      throw new Error(
        `Page dimensions (${width}x${height}) exceed maximum allowed (${maxDimension}x${maxDimension}). ` +
        `Consider using captureViewport() or captureRegion() instead.`
      );
    }

    const params = {
      format: validated.format,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 }
    };

    if (params.format !== 'png' && validated.quality !== undefined) {
      params.quality = validated.quality;
    }

    const result = await session.send('Page.captureScreenshot', params);
    return Buffer.from(result.data, 'base64');
  }

  async function captureRegion(region, captureOptions = {}) {
    const validated = validateOptions(captureOptions);
    const params = {
      format: validated.format,
      clip: {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        scale: captureOptions.scale || 1
      }
    };

    if (params.format !== 'png' && validated.quality !== undefined) {
      params.quality = validated.quality;
    }

    const result = await session.send('Page.captureScreenshot', params);
    return Buffer.from(result.data, 'base64');
  }

  async function captureElement(boundingBox, captureOptions = {}) {
    const padding = captureOptions.padding || 0;
    return captureRegion({
      x: Math.max(0, boundingBox.x - padding),
      y: Math.max(0, boundingBox.y - padding),
      width: boundingBox.width + (padding * 2),
      height: boundingBox.height + (padding * 2)
    }, captureOptions);
  }

  async function saveToFile(buffer, filePath) {
    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);

    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new Error(`Permission denied: cannot create directory "${dir}"`);
      }
      if (err.code === 'EROFS') {
        throw new Error(`Read-only filesystem: cannot create directory "${dir}"`);
      }
      throw new Error(`Failed to create directory "${dir}": ${err.message}`);
    }

    try {
      await fs.writeFile(absolutePath, buffer);
    } catch (err) {
      if (err.code === 'ENOSPC') {
        throw new Error(`Disk full: cannot write screenshot to "${absolutePath}"`);
      }
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new Error(`Permission denied: cannot write to "${absolutePath}"`);
      }
      if (err.code === 'EROFS') {
        throw new Error(`Read-only filesystem: cannot write to "${absolutePath}"`);
      }
      throw new Error(`Failed to save screenshot to "${absolutePath}": ${err.message}`);
    }

    return absolutePath;
  }

  async function captureToFile(filePath, captureOptions = {}, elementLocator = null) {
    let buffer;
    let elementBox = null;

    // Support element screenshot via selector
    if (captureOptions.selector && elementLocator) {
      const element = await elementLocator.querySelector(captureOptions.selector);
      if (!element) {
        throw new Error(`Element not found: ${captureOptions.selector}`);
      }
      const box = await element.getBoundingBox();
      await element.dispose();

      if (!box || box.width === 0 || box.height === 0) {
        throw new Error(`Element has no visible dimensions: ${captureOptions.selector}`);
      }

      elementBox = box;
      buffer = await captureElement(box, captureOptions);
    } else if (captureOptions.fullPage) {
      buffer = await captureFullPage(captureOptions);
    } else {
      buffer = await captureViewport(captureOptions);
    }

    return saveToFile(buffer, filePath);
  }

  async function getViewportDimensions() {
    const result = await session.send('Runtime.evaluate', {
      expression: '({ width: window.innerWidth, height: window.innerHeight })',
      returnByValue: true
    });
    return result.result.value;
  }

  return {
    captureViewport,
    captureFullPage,
    captureRegion,
    captureElement,
    saveToFile,
    captureToFile,
    getViewportDimensions
  };
}

/**
 * Convenience function to capture viewport
 * @param {Object} session - CDP session
 * @param {Object} [options] - Screenshot options
 * @returns {Promise<Buffer>}
 */
export async function captureViewport(session, options = {}) {
  const capture = createScreenshotCapture(session, options);
  return capture.captureViewport(options);
}

/**
 * Convenience function to capture full page
 * @param {Object} session - CDP session
 * @param {Object} [options] - Screenshot options
 * @returns {Promise<Buffer>}
 */
export async function captureFullPage(session, options = {}) {
  const capture = createScreenshotCapture(session, options);
  return capture.captureFullPage(options);
}

/**
 * Convenience function to capture a region
 * @param {Object} session - CDP session
 * @param {Object} region - Region to capture
 * @param {Object} [options] - Screenshot options
 * @returns {Promise<Buffer>}
 */
export async function captureRegion(session, region, options = {}) {
  const capture = createScreenshotCapture(session, options);
  return capture.captureRegion(region, options);
}

/**
 * Save a screenshot buffer to file
 * @param {Buffer} buffer - Screenshot buffer
 * @param {string} filePath - Destination path
 * @returns {Promise<string>}
 */
export async function saveScreenshot(buffer, filePath) {
  const absolutePath = path.resolve(filePath);
  const dir = path.dirname(absolutePath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(absolutePath, buffer);
  return absolutePath;
}

// ============================================================================
// Network Error Capture
// ============================================================================

const DEFAULT_MAX_PENDING_REQUESTS = 10000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Create a network error capture utility
 * @param {Object} session - CDP session
 * @param {Object} [config] - Configuration options
 * @param {number} [config.maxPendingRequests=10000] - Maximum pending requests
 * @param {number} [config.requestTimeoutMs=300000] - Stale request timeout
 * @returns {Object} Network capture interface
 */
export function createNetworkCapture(session, config = {}) {
  const maxPendingRequests = config.maxPendingRequests || DEFAULT_MAX_PENDING_REQUESTS;
  const requestTimeoutMs = config.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;

  const requests = new Map();
  let errors = [];
  let httpErrors = [];
  let capturing = false;
  const handlers = {};
  let captureOptions = {};
  let cleanupIntervalId = null;

  function cleanupStaleRequests() {
    const now = Date.now() / 1000;
    const timeoutSec = requestTimeoutMs / 1000;

    for (const [requestId, request] of requests) {
      if (now - request.timestamp > timeoutSec) {
        requests.delete(requestId);
      }
    }
  }

  async function startCapture(startOptions = {}) {
    if (capturing) return;

    captureOptions = {
      captureHttpErrors: startOptions.captureHttpErrors !== false,
      ignoreStatusCodes: new Set(startOptions.ignoreStatusCodes || [])
    };

    await session.send('Network.enable');

    handlers.requestWillBeSent = (params) => {
      if (requests.size >= maxPendingRequests) {
        const oldestKey = requests.keys().next().value;
        requests.delete(oldestKey);
      }
      requests.set(params.requestId, {
        url: params.request.url,
        method: params.request.method,
        timestamp: params.timestamp,
        type: params.type
      });
    };

    handlers.loadingFailed = (params) => {
      const request = requests.get(params.requestId);
      errors.push({
        type: 'network-failure',
        requestId: params.requestId,
        url: request?.url || 'unknown',
        method: request?.method || 'unknown',
        resourceType: params.type,
        errorText: params.errorText,
        canceled: params.canceled || false,
        blockedReason: params.blockedReason,
        timestamp: params.timestamp
      });
      requests.delete(params.requestId);
    };

    handlers.responseReceived = (params) => {
      const status = params.response.status;

      if (captureOptions.captureHttpErrors && status >= 400 &&
          !captureOptions.ignoreStatusCodes.has(status)) {
        const request = requests.get(params.requestId);
        httpErrors.push({
          type: 'http-error',
          requestId: params.requestId,
          url: params.response.url,
          method: request?.method || 'unknown',
          status,
          statusText: params.response.statusText,
          resourceType: params.type,
          mimeType: params.response.mimeType,
          timestamp: params.timestamp
        });
      }
    };

    handlers.loadingFinished = (params) => {
      requests.delete(params.requestId);
    };

    session.on('Network.requestWillBeSent', handlers.requestWillBeSent);
    session.on('Network.loadingFailed', handlers.loadingFailed);
    session.on('Network.responseReceived', handlers.responseReceived);
    session.on('Network.loadingFinished', handlers.loadingFinished);

    cleanupIntervalId = setInterval(
      cleanupStaleRequests,
      Math.min(requestTimeoutMs / 2, 60000)
    );

    capturing = true;
  }

  async function stopCapture() {
    if (!capturing) return;

    session.off('Network.requestWillBeSent', handlers.requestWillBeSent);
    session.off('Network.loadingFailed', handlers.loadingFailed);
    session.off('Network.responseReceived', handlers.responseReceived);
    session.off('Network.loadingFinished', handlers.loadingFinished);

    if (cleanupIntervalId) {
      clearInterval(cleanupIntervalId);
      cleanupIntervalId = null;
    }

    requests.clear();
    await session.send('Network.disable');
    capturing = false;
  }

  function getNetworkFailures() {
    return [...errors];
  }

  function getHttpErrors() {
    return [...httpErrors];
  }

  function getAllErrors() {
    return [...errors, ...httpErrors].sort((a, b) => a.timestamp - b.timestamp);
  }

  function hasErrors() {
    return errors.length > 0 || httpErrors.length > 0;
  }

  function getErrorsByType(types) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    return getAllErrors().filter(e => typeSet.has(e.resourceType));
  }

  function clear() {
    errors = [];
    httpErrors = [];
    requests.clear();
  }

  return {
    startCapture,
    stopCapture,
    getNetworkFailures,
    getHttpErrors,
    getAllErrors,
    hasErrors,
    getErrorsByType,
    clear
  };
}

// ============================================================================
// Error Aggregator
// ============================================================================

/**
 * Create an error aggregator that combines console and network errors
 * @param {Object} consoleCapture - Console capture instance
 * @param {Object} networkCapture - Network capture instance
 * @returns {Object} Error aggregator interface
 */
export function createErrorAggregator(consoleCapture, networkCapture) {
  if (!consoleCapture) throw new Error('consoleCapture is required');
  if (!networkCapture) throw new Error('networkCapture is required');

  function getSummary() {
    const consoleErrors = consoleCapture.getErrors();
    const consoleWarnings = consoleCapture.getWarnings();
    const networkFailures = networkCapture.getNetworkFailures();
    const httpErrs = networkCapture.getHttpErrors();

    return {
      hasErrors: consoleErrors.length > 0 || networkFailures.length > 0 ||
                 httpErrs.some(e => e.status >= 500),
      hasWarnings: consoleWarnings.length > 0 ||
                   httpErrs.some(e => e.status >= 400 && e.status < 500),
      counts: {
        consoleErrors: consoleErrors.length,
        consoleWarnings: consoleWarnings.length,
        networkFailures: networkFailures.length,
        httpClientErrors: httpErrs.filter(e => e.status >= 400 && e.status < 500).length,
        httpServerErrors: httpErrs.filter(e => e.status >= 500).length
      },
      errors: {
        console: consoleErrors,
        network: networkFailures,
        http: httpErrs
      }
    };
  }

  function getAllErrorsChronological() {
    const all = [
      ...consoleCapture.getErrors().map(e => ({ ...e, source: 'console' })),
      ...networkCapture.getAllErrors().map(e => ({ ...e, source: 'network' }))
    ];

    return all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  function getCriticalErrors() {
    return [
      ...consoleCapture.getErrors().filter(e => e.type === 'exception'),
      ...networkCapture.getNetworkFailures(),
      ...networkCapture.getHttpErrors().filter(e => e.status >= 500)
    ];
  }

  function formatReport() {
    const summary = getSummary();
    const lines = ['=== Error Report ==='];

    if (summary.counts.consoleErrors > 0) {
      lines.push('\n## Console Errors');
      for (const error of summary.errors.console) {
        lines.push(`  [${error.level.toUpperCase()}] ${error.text}`);
        if (error.url) {
          lines.push(`    at ${error.url}:${error.line || '?'}`);
        }
      }
    }

    if (summary.counts.networkFailures > 0) {
      lines.push('\n## Network Failures');
      for (const error of summary.errors.network) {
        lines.push(`  [FAILED] ${error.method} ${error.url}`);
        lines.push(`    Error: ${error.errorText}`);
      }
    }

    if (summary.counts.httpServerErrors > 0 || summary.counts.httpClientErrors > 0) {
      lines.push('\n## HTTP Errors');
      for (const error of summary.errors.http) {
        lines.push(`  [${error.status}] ${error.method} ${error.url}`);
      }
    }

    if (!summary.hasErrors && !summary.hasWarnings) {
      lines.push('\nNo errors or warnings captured.');
    }

    return lines.join('\n');
  }

  function toJSON() {
    return {
      timestamp: new Date().toISOString(),
      summary: getSummary(),
      all: getAllErrorsChronological()
    };
  }

  return {
    getSummary,
    getAllErrorsChronological,
    getCriticalErrors,
    formatReport,
    toJSON
  };
}

/**
 * Aggregate errors from console and network captures
 * @param {Object} consoleCapture - Console capture instance
 * @param {Object} networkCapture - Network capture instance
 * @returns {{summary: Object, critical: Array, report: string}}
 */
export function aggregateErrors(consoleCapture, networkCapture) {
  const aggregator = createErrorAggregator(consoleCapture, networkCapture);
  return {
    summary: aggregator.getSummary(),
    critical: aggregator.getCriticalErrors(),
    report: aggregator.formatReport()
  };
}

// ============================================================================
// PDF Capture
// ============================================================================

/**
 * Create a PDF capture utility
 * @param {Object} session - CDP session
 * @returns {Object} PDF capture interface
 */
export function createPdfCapture(session) {
  async function generatePdf(options = {}) {
    const params = {
      landscape: options.landscape || false,
      displayHeaderFooter: options.displayHeaderFooter || false,
      headerTemplate: options.headerTemplate || '',
      footerTemplate: options.footerTemplate || '',
      printBackground: options.printBackground !== false,
      scale: options.scale || 1,
      paperWidth: options.paperWidth || 8.5,
      paperHeight: options.paperHeight || 11,
      marginTop: options.marginTop || 0.4,
      marginBottom: options.marginBottom || 0.4,
      marginLeft: options.marginLeft || 0.4,
      marginRight: options.marginRight || 0.4,
      pageRanges: options.pageRanges || '',
      preferCSSPageSize: options.preferCSSPageSize || false
    };

    const result = await session.send('Page.printToPDF', params);
    return Buffer.from(result.data, 'base64');
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function extractPdfMetadata(buffer) {
    const fileSize = buffer.length;
    const content = buffer.toString('binary');

    // Count pages by looking for /Type /Page entries
    const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
    const pageCount = pageMatches ? pageMatches.length : 1;

    // Try to extract media box dimensions (default page size)
    let dimensions = { width: 612, height: 792 }; // Default Letter size in points
    const mediaBoxMatch = content.match(/\/MediaBox\s*\[\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\]/);
    if (mediaBoxMatch) {
      dimensions = {
        width: parseFloat(mediaBoxMatch[3]) - parseFloat(mediaBoxMatch[1]),
        height: parseFloat(mediaBoxMatch[4]) - parseFloat(mediaBoxMatch[2])
      };
    }

    return {
      fileSize,
      fileSizeFormatted: formatFileSize(fileSize),
      pageCount,
      dimensions: {
        width: dimensions.width,
        height: dimensions.height,
        unit: 'points'
      }
    };
  }

  function validatePdf(buffer) {
    const content = buffer.toString('binary');
    const errors = [];
    const warnings = [];

    // Check PDF header
    if (!content.startsWith('%PDF-')) {
      errors.push('Invalid PDF: missing PDF header');
    }

    // Check for EOF marker
    if (!content.includes('%%EOF')) {
      warnings.push('PDF may be truncated: missing EOF marker');
    }

    // Check for xref table or xref stream
    if (!content.includes('xref') && !content.includes('/XRef')) {
      warnings.push('PDF may have structural issues: no cross-reference found');
    }

    // Check minimum size (a valid PDF should be at least a few hundred bytes)
    if (buffer.length < 100) {
      errors.push('PDF file is too small to be valid');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  async function generateElementPdf(selector, options = {}, elementLocator) {
    if (!elementLocator) {
      throw new Error('Element locator required for element PDF');
    }

    // Find the element
    const element = await elementLocator.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    try {
      // Get the element's HTML and create a print-optimized version
      const elementHtml = await element.evaluate(`function() {
        const clone = this.cloneNode(true);
        // Create a wrapper with print-friendly styles
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'width: 100%; margin: 0; padding: 0;';
        wrapper.appendChild(clone);
        return wrapper.outerHTML;
      }`);

      // Store original body content
      await session.send('Runtime.evaluate', {
        expression: `
          window.__originalBody = document.body.innerHTML;
          window.__originalStyles = document.body.style.cssText;
        `
      });

      // Replace body with element content for printing
      await session.send('Runtime.evaluate', {
        expression: `
          document.body.innerHTML = ${JSON.stringify(elementHtml)};
          document.body.style.cssText = 'margin: 0; padding: 20px;';
        `
      });

      // Generate the PDF
      const buffer = await generatePdf(options);

      // Restore original body
      await session.send('Runtime.evaluate', {
        expression: `
          document.body.innerHTML = window.__originalBody;
          document.body.style.cssText = window.__originalStyles;
          delete window.__originalBody;
          delete window.__originalStyles;
        `
      });

      return buffer;
    } finally {
      await element.dispose();
    }
  }

  async function saveToFile(filePath, options = {}, elementLocator = null) {
    let buffer;

    // Support element PDF via selector
    if (options.selector && elementLocator) {
      buffer = await generateElementPdf(options.selector, options, elementLocator);
    } else {
      buffer = await generatePdf(options);
    }

    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);

    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new Error(`Permission denied: cannot create directory "${dir}"`);
      }
      if (err.code === 'EROFS') {
        throw new Error(`Read-only filesystem: cannot create directory "${dir}"`);
      }
      throw new Error(`Failed to create directory "${dir}": ${err.message}`);
    }

    try {
      await fs.writeFile(absolutePath, buffer);
    } catch (err) {
      if (err.code === 'ENOSPC') {
        throw new Error(`Disk full: cannot write PDF to "${absolutePath}"`);
      }
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new Error(`Permission denied: cannot write to "${absolutePath}"`);
      }
      if (err.code === 'EROFS') {
        throw new Error(`Read-only filesystem: cannot write to "${absolutePath}"`);
      }
      throw new Error(`Failed to save PDF to "${absolutePath}": ${err.message}`);
    }

    // Extract metadata
    const metadata = extractPdfMetadata(buffer);

    // Optionally validate
    let validation = null;
    if (options.validate) {
      validation = validatePdf(buffer);
    }

    return {
      path: absolutePath,
      ...metadata,
      validation,
      selector: options.selector || null
    };
  }

  return { generatePdf, saveToFile, extractPdfMetadata, validatePdf };
}

// ============================================================================
// Debug Capture (from DebugCapture.js)
// ============================================================================

/**
 * Create a debug capture utility for capturing debugging state before/after actions
 * @param {Object} session - CDP session
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

  async function captureBefore(action, params) {
    stepIndex++;
    const prefix = `step-${String(stepIndex).padStart(3, '0')}-${action}-before`;
    return captureState(prefix);
  }

  async function captureAfter(action, params, status) {
    const prefix = `step-${String(stepIndex).padStart(3, '0')}-${action}-after-${status}`;
    return captureState(prefix);
  }

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

// ============================================================================
// Eval Serializer (from EvalSerializer.js)
// ============================================================================

/**
 * Create an eval serializer for handling serialization of JavaScript values
 * Provides special handling for non-JSON-serializable values
 * @returns {Object} Eval serializer interface
 */
export function createEvalSerializer() {
  /**
   * Get the serialization function that runs in browser context
   * @returns {string} JavaScript function declaration
   */
  function getSerializationFunction() {
    return `function(value) {
      // Handle primitives and null
      if (value === null) return { type: 'null', value: null };
      if (value === undefined) return { type: 'undefined', value: null };

      const type = typeof value;

      // Handle special number values (FR-039)
      if (type === 'number') {
        if (Number.isNaN(value)) return { type: 'number', value: null, repr: 'NaN' };
        if (value === Infinity) return { type: 'number', value: null, repr: 'Infinity' };
        if (value === -Infinity) return { type: 'number', value: null, repr: '-Infinity' };
        return { type: 'number', value: value };
      }

      // Handle strings, booleans, bigint
      if (type === 'string') return { type: 'string', value: value };
      if (type === 'boolean') return { type: 'boolean', value: value };
      if (type === 'bigint') return { type: 'bigint', value: null, repr: value.toString() + 'n' };
      if (type === 'symbol') return { type: 'symbol', value: null, repr: value.toString() };
      if (type === 'function') return { type: 'function', value: null, repr: value.toString().substring(0, 100) };

      // Handle Date (FR-040)
      if (value instanceof Date) {
        return {
          type: 'Date',
          value: value.toISOString(),
          timestamp: value.getTime()
        };
      }

      // Handle Map (FR-040)
      if (value instanceof Map) {
        const entries = [];
        let count = 0;
        for (const [k, v] of value) {
          if (count >= 50) break; // Limit entries
          try {
            entries.push([
              typeof k === 'object' ? JSON.stringify(k) : String(k),
              typeof v === 'object' ? JSON.stringify(v) : String(v)
            ]);
          } catch (e) {
            entries.push([String(k), '[Circular]']);
          }
          count++;
        }
        return {
          type: 'Map',
          size: value.size,
          entries: entries
        };
      }

      // Handle Set (FR-040)
      if (value instanceof Set) {
        const items = [];
        let count = 0;
        for (const item of value) {
          if (count >= 50) break; // Limit items
          try {
            items.push(typeof item === 'object' ? JSON.stringify(item) : item);
          } catch (e) {
            items.push('[Circular]');
          }
          count++;
        }
        return {
          type: 'Set',
          size: value.size,
          values: items
        };
      }

      // Handle RegExp
      if (value instanceof RegExp) {
        return { type: 'RegExp', value: value.toString() };
      }

      // Handle Error
      if (value instanceof Error) {
        return {
          type: 'Error',
          name: value.name,
          message: value.message,
          stack: value.stack ? value.stack.substring(0, 500) : null
        };
      }

      // Handle DOM Element (FR-041)
      if (value instanceof Element) {
        const attrs = {};
        for (const attr of value.attributes) {
          attrs[attr.name] = attr.value.substring(0, 100);
        }
        return {
          type: 'Element',
          tagName: value.tagName.toLowerCase(),
          id: value.id || null,
          className: value.className || null,
          attributes: attrs,
          textContent: value.textContent ? value.textContent.trim().substring(0, 200) : null,
          innerHTML: value.innerHTML ? value.innerHTML.substring(0, 200) : null,
          isConnected: value.isConnected,
          childElementCount: value.childElementCount
        };
      }

      // Handle NodeList
      if (value instanceof NodeList || value instanceof HTMLCollection) {
        const items = [];
        const len = Math.min(value.length, 20);
        for (let i = 0; i < len; i++) {
          const el = value[i];
          if (el instanceof Element) {
            items.push({
              tagName: el.tagName.toLowerCase(),
              id: el.id || null,
              className: el.className || null
            });
          }
        }
        return {
          type: value instanceof NodeList ? 'NodeList' : 'HTMLCollection',
          length: value.length,
          items: items
        };
      }

      // Handle Document
      if (value instanceof Document) {
        return {
          type: 'Document',
          title: value.title,
          url: value.URL,
          readyState: value.readyState
        };
      }

      // Handle Window
      if (value === window) {
        return {
          type: 'Window',
          location: value.location.href,
          innerWidth: value.innerWidth,
          innerHeight: value.innerHeight
        };
      }

      // Handle arrays - recursively serialize each element
      if (Array.isArray(value)) {
        const items = [];
        const len = Math.min(value.length, 100); // Limit to 100 items
        for (let i = 0; i < len; i++) {
          items.push(arguments.callee(value[i])); // Recursive call
        }
        return {
          type: 'array',
          length: value.length,
          items: items,
          truncated: value.length > 100
        };
      }

      // Handle plain objects - recursively serialize values
      if (type === 'object') {
        const keys = Object.keys(value);
        const entries = {};
        const len = Math.min(keys.length, 50); // Limit to 50 keys
        for (let i = 0; i < len; i++) {
          const k = keys[i];
          entries[k] = arguments.callee(value[k]); // Recursive call
        }
        return {
          type: 'object',
          keys: keys.length,
          entries: entries,
          truncated: keys.length > 50
        };
      }

      return { type: 'unknown', repr: String(value) };
    }`;
  }

  /**
   * Process the serialized result into a clean output format
   * @param {Object} serialized - The serialized result from browser
   * @returns {Object} Processed output
   */
  function processResult(serialized) {
    if (!serialized || typeof serialized !== 'object') {
      return { type: 'unknown', value: serialized };
    }

    const result = {
      type: serialized.type
    };

    // Include value if present
    if (serialized.value !== undefined) {
      result.value = serialized.value;
    }

    // Include repr for non-serializable values
    if (serialized.repr !== undefined) {
      result.repr = serialized.repr;
    }

    // Include additional properties based on type
    switch (serialized.type) {
      case 'Date':
        result.timestamp = serialized.timestamp;
        break;
      case 'Map':
        result.size = serialized.size;
        result.entries = serialized.entries;
        break;
      case 'Set':
        result.size = serialized.size;
        result.values = serialized.values;
        break;
      case 'Element':
        result.tagName = serialized.tagName;
        result.id = serialized.id;
        result.className = serialized.className;
        result.attributes = serialized.attributes;
        result.textContent = serialized.textContent;
        result.isConnected = serialized.isConnected;
        result.childElementCount = serialized.childElementCount;
        break;
      case 'NodeList':
      case 'HTMLCollection':
        result.length = serialized.length;
        result.items = serialized.items;
        break;
      case 'Error':
        result.name = serialized.name;
        result.message = serialized.message;
        if (serialized.stack) result.stack = serialized.stack;
        break;
      case 'Document':
        result.title = serialized.title;
        result.url = serialized.url;
        result.readyState = serialized.readyState;
        break;
      case 'Window':
        result.location = serialized.location;
        result.innerWidth = serialized.innerWidth;
        result.innerHeight = serialized.innerHeight;
        break;
      case 'array':
        result.length = serialized.length;
        if (serialized.items) {
          // Recursively process each item
          result.items = serialized.items.map(item => processResult(item));
        }
        if (serialized.truncated) result.truncated = true;
        break;
      case 'object':
        result.keys = serialized.keys;
        if (serialized.entries) {
          // Recursively process each entry value
          result.entries = {};
          for (const [k, v] of Object.entries(serialized.entries)) {
            result.entries[k] = processResult(v);
          }
        }
        if (serialized.truncated) result.truncated = true;
        break;
    }

    return result;
  }

  return {
    getSerializationFunction,
    processResult
  };
}

/**
 * Get the serialization function (convenience export)
 * @returns {string} JavaScript function declaration
 */
export function getEvalSerializationFunction() {
  return createEvalSerializer().getSerializationFunction();
}

/**
 * Process a serialized eval result (convenience export)
 * @param {Object} serialized - The serialized result from browser
 * @returns {Object} Processed output
 */
export function processEvalResult(serialized) {
  return createEvalSerializer().processResult(serialized);
}
