/**
 * ARIA - Accessibility tree generation and role-based queries for AI agents
 *
 * Consolidated module containing:
 * - AriaSnapshot: Generates semantic tree representation based on ARIA roles
 * - RoleQueryExecutor: Advanced role-based queries with filtering
 * - QueryOutputProcessor: Output formatting and attribute extraction
 */

// Query Output Processor (from QueryOutputProcessor.js)

/**
 * Create a query output processor for handling multiple output modes
 * @param {Object} session - CDP session
 * @returns {Object} Query output processor interface
 */
export function createQueryOutputProcessor(session) {
  /**
   * Get a single output value by mode
   * @param {Object} elementHandle - Element handle
   * @param {string} mode - Output mode
   * @param {boolean} clean - Whether to trim whitespace
   * @returns {Promise<string>}
   */
  async function getSingleOutput(elementHandle, mode, clean) {
    let value;

    switch (mode) {
      case 'text':
        value = await elementHandle.evaluate(`function() {
          return this.textContent ? this.textContent.substring(0, 100) : '';
        }`);
        break;

      case 'html':
        value = await elementHandle.evaluate(`function() {
          return this.outerHTML ? this.outerHTML.substring(0, 200) : '';
        }`);
        break;

      case 'href':
        value = await elementHandle.evaluate(`function() {
          return this.href || this.getAttribute('href') || '';
        }`);
        break;

      case 'value':
        value = await elementHandle.evaluate(`function() {
          return this.value || '';
        }`);
        break;

      case 'tag':
        value = await elementHandle.evaluate(`function() {
          return this.tagName ? this.tagName.toLowerCase() : '';
        }`);
        break;

      default:
        value = await elementHandle.evaluate(`function() {
          return this.textContent ? this.textContent.substring(0, 100) : '';
        }`);
    }

    // Apply text cleanup
    if (clean && typeof value === 'string') {
      value = value.trim();
    }

    return value || '';
  }

  /**
   * Get an attribute value from element
   * @param {Object} elementHandle - Element handle
   * @param {string} attributeName - Attribute name to retrieve
   * @param {boolean} clean - Whether to trim whitespace
   * @returns {Promise<string|null>}
   */
  async function getAttribute(elementHandle, attributeName, clean) {
    const value = await elementHandle.evaluate(`function() {
      return this.getAttribute(${JSON.stringify(attributeName)});
    }`);

    if (clean && typeof value === 'string') {
      return value.trim();
    }

    return value;
  }

  /**
   * Process output for an element based on output specification
   * @param {Object} elementHandle - Element handle with evaluate method
   * @param {string|string[]|Object} output - Output specification
   * @param {Object} options - Additional options
   * @param {boolean} options.clean - Whether to trim whitespace
   * @returns {Promise<*>} Processed output value
   */
  async function processOutput(elementHandle, output, options = {}) {
    const clean = options.clean === true;

    // Handle multiple output modes
    if (Array.isArray(output)) {
      const result = {};
      for (const mode of output) {
        result[mode] = await getSingleOutput(elementHandle, mode, clean);
      }
      return result;
    }

    // Handle attribute output
    if (typeof output === 'object' && output !== null) {
      if (output.attribute) {
        return getAttribute(elementHandle, output.attribute, clean);
      }
      // Default to text if object doesn't specify attribute
      return getSingleOutput(elementHandle, 'text', clean);
    }

    // Handle single output mode
    return getSingleOutput(elementHandle, output || 'text', clean);
  }

  /**
   * Get element metadata
   * @param {Object} elementHandle - Element handle
   * @returns {Promise<Object>} Element metadata
   */
  async function getElementMetadata(elementHandle) {
    return elementHandle.evaluate(`function() {
      const el = this;

      // Build selector path
      const getSelectorPath = (element) => {
        const path = [];
        let current = element;
        while (current && current !== document.body && path.length < 5) {
          let selector = current.tagName.toLowerCase();
          if (current.id) {
            selector += '#' + current.id;
            path.unshift(selector);
            break; // ID is unique, stop here
          }
          if (current.className && typeof current.className === 'string') {
            const classes = current.className.trim().split(/\\s+/).slice(0, 2);
            if (classes.length > 0 && classes[0]) {
              selector += '.' + classes.join('.');
            }
          }
          path.unshift(selector);
          current = current.parentElement;
        }
        return path.join(' > ');
      };

      return {
        tag: el.tagName ? el.tagName.toLowerCase() : null,
        classes: el.className && typeof el.className === 'string'
          ? el.className.trim().split(/\\s+/).filter(c => c)
          : [],
        selectorPath: getSelectorPath(el)
      };
    }`);
  }

  return {
    processOutput,
    getSingleOutput,
    getAttribute,
    getElementMetadata
  };
}
