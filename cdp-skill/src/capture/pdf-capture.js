/**
 * PDF Capture Module
 * Generate PDF documents from page content
 *
 * PUBLIC EXPORTS:
 * - createPdfCapture(session) - Factory for PDF capture
 *
 * @module cdp-skill/capture/pdf-capture
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Create a PDF capture utility
 * @param {import('../types.js').CDPSession} session - CDP session
 * @returns {Object} PDF capture interface
 */
export function createPdfCapture(session) {
  /**
   * Generate PDF from current page
   * @param {import('../types.js').PdfOptions} [options] - PDF options
   * @returns {Promise<Buffer>} PDF buffer
   */
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

  /**
   * Extract metadata from PDF buffer
   * @param {Buffer} buffer - PDF buffer
   * @returns {{fileSize: number, fileSizeFormatted: string, pageCount: number, dimensions: Object}}
   */
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

  /**
   * Validate PDF buffer
   * @param {Buffer} buffer - PDF buffer
   * @returns {{valid: boolean, errors: string[], warnings: string[]}}
   */
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

  /**
   * Generate PDF of specific element
   * @param {string} selector - Element selector
   * @param {import('../types.js').PdfOptions} [options] - PDF options
   * @param {Object} elementLocator - Element locator instance
   * @returns {Promise<Buffer>} PDF buffer
   */
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

  /**
   * Save PDF to file
   * @param {string} filePath - Destination path
   * @param {Object} [options] - PDF options
   * @param {string} [options.selector] - Element selector for element PDF
   * @param {boolean} [options.validate] - Validate PDF structure
   * @param {Object} [elementLocator] - Element locator for selector option
   * @returns {Promise<Object>} Result with path, metadata, and optional validation
   */
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
