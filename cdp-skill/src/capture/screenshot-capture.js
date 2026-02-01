/**
 * Screenshot Capture Module
 * CDP-based screenshot capture for viewport, full page, and regions
 *
 * PUBLIC EXPORTS:
 * - createScreenshotCapture(session, options?) - Factory for screenshot capture
 * - captureViewport(session, options?) - Capture viewport screenshot
 * - captureFullPage(session, options?) - Capture full page screenshot
 * - captureRegion(session, region, options?) - Capture specific region
 * - saveScreenshot(buffer, filePath) - Save screenshot to file
 *
 * @module cdp-skill/capture/screenshot-capture
 */

import fs from 'fs/promises';
import path from 'path';

const DEFAULT_MAX_DIMENSION = 16384;
const VALID_FORMATS = ['png', 'jpeg', 'webp'];

/**
 * Create a screenshot capture utility
 * @param {import('../types.js').CDPSession} session - CDP session
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

  /**
   * Capture viewport screenshot
   * @param {import('../types.js').ScreenshotOptions} [captureOptions] - Screenshot options
   * @returns {Promise<Buffer>} PNG/JPEG/WebP image buffer
   */
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

  /**
   * Capture full page screenshot
   * @param {import('../types.js').ScreenshotOptions} [captureOptions] - Screenshot options
   * @returns {Promise<Buffer>} PNG/JPEG/WebP image buffer
   */
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

  /**
   * Capture specific region
   * @param {import('../types.js').ClipRegion} region - Region to capture
   * @param {import('../types.js').ScreenshotOptions} [captureOptions] - Screenshot options
   * @returns {Promise<Buffer>} PNG/JPEG/WebP image buffer
   */
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

  /**
   * Capture element by bounding box
   * @param {import('../types.js').BoundingBox} boundingBox - Element bounding box
   * @param {Object} [captureOptions] - Screenshot options
   * @param {number} [captureOptions.padding=0] - Padding around element
   * @returns {Promise<Buffer>} PNG/JPEG/WebP image buffer
   */
  async function captureElement(boundingBox, captureOptions = {}) {
    const padding = captureOptions.padding || 0;
    return captureRegion({
      x: Math.max(0, boundingBox.x - padding),
      y: Math.max(0, boundingBox.y - padding),
      width: boundingBox.width + (padding * 2),
      height: boundingBox.height + (padding * 2)
    }, captureOptions);
  }

  /**
   * Save buffer to file
   * @param {Buffer} buffer - Image buffer
   * @param {string} filePath - Destination path
   * @returns {Promise<string>} Absolute path
   */
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

  /**
   * Capture and save to file
   * @param {string} filePath - Destination path
   * @param {Object} [captureOptions] - Screenshot options
   * @param {boolean} [captureOptions.fullPage=false] - Capture full page
   * @param {string} [captureOptions.selector] - Element selector to capture
   * @param {Object} [elementLocator] - Element locator for selector capture
   * @returns {Promise<string>} Absolute path
   */
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

  /**
   * Get viewport dimensions
   * @returns {Promise<{width: number, height: number}>}
   */
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
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {import('../types.js').ScreenshotOptions} [options] - Screenshot options
 * @returns {Promise<Buffer>}
 */
export async function captureViewport(session, options = {}) {
  const capture = createScreenshotCapture(session, options);
  return capture.captureViewport(options);
}

/**
 * Convenience function to capture full page
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {import('../types.js').ScreenshotOptions} [options] - Screenshot options
 * @returns {Promise<Buffer>}
 */
export async function captureFullPage(session, options = {}) {
  const capture = createScreenshotCapture(session, options);
  return capture.captureFullPage(options);
}

/**
 * Convenience function to capture a region
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {import('../types.js').ClipRegion} region - Region to capture
 * @param {import('../types.js').ScreenshotOptions} [options] - Screenshot options
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
 * @returns {Promise<string>} Absolute path
 */
export async function saveScreenshot(buffer, filePath) {
  const absolutePath = path.resolve(filePath);
  const dir = path.dirname(absolutePath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(absolutePath, buffer);
  return absolutePath;
}
