/**
 * Eval Serializer Module
 * Handles serialization of JavaScript values for eval results
 *
 * PUBLIC EXPORTS:
 * - createEvalSerializer() - Factory for eval serializer
 * - getEvalSerializationFunction() - Get browser-side serialization code
 * - processEvalResult(serialized) - Process serialized result
 *
 * @module cdp-skill/capture/eval-serializer
 */

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
