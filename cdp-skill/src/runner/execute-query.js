/**
 * Query Executors
 * Snapshot, query, inspect, and element discovery step executors
 *
 * EXPORTS:
 * - executeSnapshot(ariaSnapshot, params) → Promise<Object>
 * - executeQuery(elementLocator, params) → Promise<Object>
 * - executeQueryAll(elementLocator, params) → Promise<Object>
 * - executeRoleQuery(elementLocator, params) → Promise<Object>
 * - executeInspect(pageController, elementLocator, params) → Promise<Object>
 * - executeGetDom(pageController, params) → Promise<Object>
 * - executeGetBox(ariaSnapshot, params) → Promise<Object>
 * - executeRefAt(session, params) → Promise<Object>
 * - executeElementsAt(session, coords) → Promise<Object>
 * - executeElementsNear(session, params) → Promise<Object>
 *
 * DEPENDENCIES:
 * - ../aria.js: createQueryOutputProcessor, createRoleQueryExecutor
 * - ../utils.js: elementNotFoundError
 */

import { createQueryOutputProcessor, createRoleQueryExecutor } from '../aria.js';
import { elementNotFoundError } from '../utils.js';

export async function executeSnapshot(ariaSnapshot, params) {
  if (!ariaSnapshot) {
    throw new Error('Aria snapshot not available');
  }

  const options = params === true ? {} : params;
  const result = await ariaSnapshot.generate(options);

  if (result.error) {
    throw new Error(result.error);
  }

  return {
    yaml: result.yaml,
    refs: result.refs,
    stats: result.stats
  };
}

export async function executeGetDom(pageController, params) {
  const session = pageController.session;

  // Determine selector - null means full page
  let selector = null;
  let outer = true; // include element's own tag

  if (params === true) {
    selector = null; // full page
  } else if (typeof params === 'string') {
    selector = params;
  } else if (typeof params === 'object' && params !== null) {
    selector = params.selector || null;
    if (params.outer === false) outer = false;
  }

  const expression = selector
    ? `(function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { error: 'Element not found: ${selector}' };
        return {
          html: ${outer} ? el.outerHTML : el.innerHTML,
          tagName: el.tagName.toLowerCase(),
          selector: ${JSON.stringify(selector)}
        };
      })()`
    : `(function() {
        return {
          html: document.documentElement.outerHTML,
          tagName: 'html'
        };
      })()`;

  const result = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(`getDom error: ${result.exceptionDetails.text}`);
  }

  const data = result.result.value;
  if (data.error) {
    throw new Error(data.error);
  }

  return {
    html: data.html,
    tagName: data.tagName,
    selector: data.selector || null,
    length: data.html.length
  };
}

/**
 * Execute a getBox step - get bounding box of one or more refs
 * @param {Object} ariaSnapshot - ARIA snapshot instance
 * @param {string|string[]|Object} params - ref, array of refs, or options object
 * @returns {Promise<Object>} Bounding box info
 */

export async function executeGetBox(ariaSnapshot, params) {
  if (!ariaSnapshot) {
    throw new Error('ariaSnapshot is required for getBox');
  }

  // Normalize params to array of refs
  let refs;
  if (typeof params === 'string') {
    refs = [params];
  } else if (Array.isArray(params)) {
    refs = params;
  } else if (typeof params === 'object' && params !== null) {
    refs = params.refs || (params.ref ? [params.ref] : []);
  } else {
    throw new Error('getBox requires ref(s)');
  }

  if (refs.length === 0) {
    throw new Error('getBox requires at least one ref');
  }

  const results = {};

  for (const ref of refs) {
    try {
      const refInfo = await ariaSnapshot.getElementByRef(ref);
      if (!refInfo) {
        results[ref] = { error: 'not found' };
      } else if (refInfo.stale) {
        results[ref] = { error: 'stale', message: 'Element no longer in DOM' };
      } else if (!refInfo.isVisible) {
        results[ref] = { error: 'hidden', box: refInfo.box };
      } else {
        results[ref] = {
          x: refInfo.box.x,
          y: refInfo.box.y,
          width: refInfo.box.width,
          height: refInfo.box.height,
          center: {
            x: Math.round(refInfo.box.x + refInfo.box.width / 2),
            y: Math.round(refInfo.box.y + refInfo.box.height / 2)
          }
        };
      }
    } catch (e) {
      results[ref] = { error: e.message };
    }
  }

  // If single ref, return just the box info (not wrapped in object)
  if (refs.length === 1) {
    return results[refs[0]];
  }

  return results;
}

/**
 * Execute a fillActive step - fill the currently focused element
 * @param {Object} pageController - Page controller
 * @param {Object} inputEmulator - Input emulator for typing
 * @param {string|Object} params - Value string or options object
 * @returns {Promise<Object>} Result with filled element info
 */

export async function executeRefAt(session, params) {
  const { x, y } = params;

  const result = await session.send('Runtime.evaluate', {
    expression: `(function() {
      const x = ${x};
      const y = ${y};

      // Get element at point
      const el = document.elementFromPoint(x, y);
      if (!el) {
        return { error: 'No element at coordinates (' + x + ', ' + y + ')' };
      }

      // Initialize refs map if needed
      if (!window.__ariaRefs) {
        window.__ariaRefs = new Map();
      }
      if (!window.__ariaRefCounter) {
        window.__ariaRefCounter = 0;
      }

      // Helper to generate a selector for an element
      function generateSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);

        // Try unique attributes
        for (const attr of ['data-testid', 'data-test-id', 'data-cy', 'name']) {
          if (el.hasAttribute(attr)) {
            const value = el.getAttribute(attr);
            const selector = '[' + attr + '="' + value.replace(/"/g, '\\\\"') + '"]';
            if (document.querySelectorAll(selector).length === 1) return selector;
          }
        }

        // Build path
        const path = [];
        let current = el;
        while (current && current !== document.body && path.length < 5) {
          let selector = current.tagName.toLowerCase();
          if (current.id) {
            selector = '#' + CSS.escape(current.id);
            path.unshift(selector);
            break;
          }
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1;
              selector += ':nth-of-type(' + index + ')';
            }
          }
          path.unshift(selector);
          current = parent;
        }
        return path.join(' > ');
      }

      // Helper to check if element is clickable
      function isClickable(el) {
        const tag = el.tagName;
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
          return true;
        }
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem' || role === 'checkbox' || role === 'radio') {
          return true;
        }
        if (el.onclick || el.hasAttribute('onclick')) return true;
        const style = window.getComputedStyle(el);
        if (style.cursor === 'pointer') return true;
        return false;
      }

      // Check if element already has a ref
      for (const [ref, refEl] of window.__ariaRefs) {
        if (refEl === el) {
          const rect = el.getBoundingClientRect();
          return {
            ref: ref,
            existing: true,
            tag: el.tagName,
            selector: generateSelector(el),
            clickable: isClickable(el),
            role: el.getAttribute('role') || null,
            name: el.getAttribute('aria-label') || el.textContent?.trim().substring(0, 50) || null,
            box: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          };
        }
      }

      // Create new ref
      window.__ariaRefCounter++;
      const ref = 'e' + window.__ariaRefCounter;
      window.__ariaRefs.set(ref, el);

      const rect = el.getBoundingClientRect();
      return {
        ref: ref,
        existing: false,
        tag: el.tagName,
        selector: generateSelector(el),
        clickable: isClickable(el),
        role: el.getAttribute('role') || null,
        name: el.getAttribute('aria-label') || el.textContent?.trim().substring(0, 50) || null,
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    })()`,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(`refAt error: ${result.exceptionDetails.text}`);
  }

  const value = result.result.value;
  if (value.error) {
    throw new Error(value.error);
  }

  return value;
}

/**
 * Execute an elementsAt step - get refs for elements at multiple coordinates
 */

export async function executeElementsAt(session, coords) {
  const result = await session.send('Runtime.evaluate', {
    expression: `(function() {
      const coords = ${JSON.stringify(coords)};

      // Initialize refs map if needed
      if (!window.__ariaRefs) {
        window.__ariaRefs = new Map();
      }
      if (!window.__ariaRefCounter) {
        window.__ariaRefCounter = 0;
      }

      // Helper to get or create ref for element
      function getOrCreateRef(el) {
        if (!el) return null;

        // Check if element already has a ref
        for (const [ref, refEl] of window.__ariaRefs) {
          if (refEl === el) {
            return { ref, existing: true };
          }
        }

        // Create new ref
        window.__ariaRefCounter++;
        const ref = 'e' + window.__ariaRefCounter;
        window.__ariaRefs.set(ref, el);
        return { ref, existing: false };
      }

      // Helper to generate a selector for an element
      function generateSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);

        // Try unique attributes
        for (const attr of ['data-testid', 'data-test-id', 'data-cy', 'name']) {
          if (el.hasAttribute(attr)) {
            const value = el.getAttribute(attr);
            const selector = '[' + attr + '="' + value.replace(/"/g, '\\\\"') + '"]';
            if (document.querySelectorAll(selector).length === 1) return selector;
          }
        }

        // Build path
        const path = [];
        let current = el;
        while (current && current !== document.body && path.length < 5) {
          let selector = current.tagName.toLowerCase();
          if (current.id) {
            selector = '#' + CSS.escape(current.id);
            path.unshift(selector);
            break;
          }
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1;
              selector += ':nth-of-type(' + index + ')';
            }
          }
          path.unshift(selector);
          current = parent;
        }
        return path.join(' > ');
      }

      // Helper to check if element is clickable
      function isClickable(el) {
        const tag = el.tagName;
        // Obviously clickable elements
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
          return true;
        }
        // Role-based
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem' || role === 'checkbox' || role === 'radio') {
          return true;
        }
        // Event listeners or cursor
        if (el.onclick || el.hasAttribute('onclick')) return true;
        const style = window.getComputedStyle(el);
        if (style.cursor === 'pointer') return true;
        return false;
      }

      // Helper to build element info
      function buildElementInfo(el, refInfo) {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          ref: refInfo.ref,
          existing: refInfo.existing,
          tag: el.tagName,
          selector: generateSelector(el),
          clickable: isClickable(el),
          role: el.getAttribute('role') || null,
          name: el.getAttribute('aria-label') || el.textContent?.trim().substring(0, 50) || null,
          box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      }

      const results = [];
      for (const coord of coords) {
        const el = document.elementFromPoint(coord.x, coord.y);
        if (!el) {
          results.push({ x: coord.x, y: coord.y, error: 'No element at this coordinate' });
        } else {
          const refInfo = getOrCreateRef(el);
          const info = buildElementInfo(el, refInfo);
          info.x = coord.x;
          info.y = coord.y;
          results.push(info);
        }
      }

      return { elements: results, count: results.filter(r => !r.error).length };
    })()`,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(`elementsAt error: ${result.exceptionDetails.text}`);
  }

  return result.result.value;
}

/**
 * Execute an elementsNear step - get refs for all elements near a coordinate
 */

export async function executeElementsNear(session, params) {
  const { x, y, radius = 50, limit = 20 } = params;

  const result = await session.send('Runtime.evaluate', {
    expression: `(function() {
      const centerX = ${x};
      const centerY = ${y};
      const radius = ${radius};
      const limit = ${limit};

      // Initialize refs map if needed
      if (!window.__ariaRefs) {
        window.__ariaRefs = new Map();
      }
      if (!window.__ariaRefCounter) {
        window.__ariaRefCounter = 0;
      }

      // Helper to get or create ref for element
      function getOrCreateRef(el) {
        // Check if element already has a ref
        for (const [ref, refEl] of window.__ariaRefs) {
          if (refEl === el) {
            return { ref, existing: true };
          }
        }

        // Create new ref
        window.__ariaRefCounter++;
        const ref = 'e' + window.__ariaRefCounter;
        window.__ariaRefs.set(ref, el);
        return { ref, existing: false };
      }

      // Helper to generate a selector for an element
      function generateSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);

        // Try unique attributes
        for (const attr of ['data-testid', 'data-test-id', 'data-cy', 'name']) {
          if (el.hasAttribute(attr)) {
            const value = el.getAttribute(attr);
            const selector = '[' + attr + '="' + value.replace(/"/g, '\\\\"') + '"]';
            if (document.querySelectorAll(selector).length === 1) return selector;
          }
        }

        // Build path
        const path = [];
        let current = el;
        while (current && current !== document.body && path.length < 5) {
          let selector = current.tagName.toLowerCase();
          if (current.id) {
            selector = '#' + CSS.escape(current.id);
            path.unshift(selector);
            break;
          }
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1;
              selector += ':nth-of-type(' + index + ')';
            }
          }
          path.unshift(selector);
          current = parent;
        }
        return path.join(' > ');
      }

      // Helper to check if element is clickable
      function isClickable(el) {
        const tag = el.tagName;
        // Obviously clickable elements
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
          return true;
        }
        // Role-based
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem' || role === 'checkbox' || role === 'radio') {
          return true;
        }
        // Event listeners or cursor
        if (el.onclick || el.hasAttribute('onclick')) return true;
        const style = window.getComputedStyle(el);
        if (style.cursor === 'pointer') return true;
        return false;
      }

      // Get all elements and filter by distance from center
      const allElements = document.querySelectorAll('*');
      const nearbyElements = [];

      for (const el of allElements) {
        // Skip non-visible elements
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        // Calculate center of element
        const elCenterX = rect.x + rect.width / 2;
        const elCenterY = rect.y + rect.height / 2;

        // Calculate distance from target point
        const distance = Math.sqrt(
          Math.pow(elCenterX - centerX, 2) + Math.pow(elCenterY - centerY, 2)
        );

        if (distance <= radius) {
          nearbyElements.push({ el, distance, rect });
        }
      }

      // Sort by distance (closest first) and limit
      nearbyElements.sort((a, b) => a.distance - b.distance);
      const limited = nearbyElements.slice(0, limit);

      // Build results
      const results = limited.map(({ el, distance, rect }) => {
        const refInfo = getOrCreateRef(el);
        return {
          ref: refInfo.ref,
          existing: refInfo.existing,
          tag: el.tagName,
          selector: generateSelector(el),
          clickable: isClickable(el),
          role: el.getAttribute('role') || null,
          name: el.getAttribute('aria-label') || el.textContent?.trim().substring(0, 50) || null,
          distance: Math.round(distance),
          box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      });

      return {
        center: { x: centerX, y: centerY },
        radius: radius,
        count: results.length,
        elements: results
      };
    })()`,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(`elementsNear error: ${result.exceptionDetails.text}`);
  }

  return result.result.value;
}

/**
 * Execute a query step - finds elements and returns info about them
 * Supports both CSS selectors and role-based queries
 *
 * Features:
 * - FR-016: Text cleanup with clean option
 * - FR-017: Multiple output modes via array
 * - FR-018: Attribute output via object
 * - FR-019: Element metadata in results
 */

export async function executeQuery(elementLocator, params) {
  // Check if this is a role-based query
  if (typeof params === 'object' && params.role) {
    return executeRoleQuery(elementLocator, params);
  }

  // Trim selector to avoid whitespace issues
  const rawSelector = typeof params === 'string' ? params : params.selector;
  const selector = typeof rawSelector === 'string' ? rawSelector.trim() : rawSelector;
  const limit = (typeof params === 'object' && params.limit) || 10;
  const output = (typeof params === 'object' && params.output) || 'text';
  const clean = typeof params === 'object' && params.clean === true;
  const metadata = typeof params === 'object' && params.metadata === true;

  const elements = await elementLocator.querySelectorAll(selector);
  const outputProcessor = createQueryOutputProcessor(elementLocator.session);
  const results = [];

  const count = Math.min(elements.length, limit);
  for (let i = 0; i < count; i++) {
    const el = elements[i];
    try {
      const resultItem = {
        index: i + 1,
        value: await outputProcessor.processOutput(el, output, { clean })
      };

      // Add element metadata if requested (FR-019)
      if (metadata) {
        resultItem.metadata = await outputProcessor.getElementMetadata(el);
      }

      results.push(resultItem);
    } catch (e) {
      results.push({ index: i + 1, value: null, error: e.message });
    }
  }

  // Dispose all elements
  for (const el of elements) {
    try { await el.dispose(); } catch { /* ignore */ }
  }

  return {
    selector,
    total: elements.length,
    showing: count,
    results
  };
}

/**
 * Execute a role-based query - finds elements by ARIA role
 * Supported roles: button, textbox, checkbox, link, heading, listitem, option, combobox
 *
 * Features:
 * - FR-020: Role level filter for headings
 * - FR-021: Compound role queries (array of roles)
 * - FR-055: Exact match option (nameExact)
 * - FR-056: Regex support (nameRegex)
 * - FR-057: Element refs in results
 * - FR-058: Count-only mode
 */

export async function executeRoleQuery(elementLocator, params) {
  const roleQueryExecutor = createRoleQueryExecutor(elementLocator.session, elementLocator);
  return roleQueryExecutor.execute(params);
}


export async function executeInspect(pageController, elementLocator, params) {
  const info = {
    title: await pageController.getTitle(),
    url: await pageController.getUrl()
  };

  // Count common element types
  const counts = {};
  const selectors = ['a', 'button', 'input', 'textarea', 'select', 'h1', 'h2', 'h3', 'img', 'form'];

  for (const sel of selectors) {
    try {
      const els = await elementLocator.querySelectorAll(sel);
      counts[sel] = els.length;
      for (const el of els) {
        try { await el.dispose(); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      counts[sel] = 0;
    }
  }

  info.elements = counts;

  // If specific selectors requested with optional limit for showing values
  if (typeof params === 'object' && params.selectors) {
    info.custom = {};
    const limit = params.limit || 0;

    for (const sel of params.selectors) {
      try {
        const els = await elementLocator.querySelectorAll(sel);
        const count = els.length;

        if (limit > 0 && count > 0) {
          const values = [];
          const showCount = Math.min(count, limit);
          for (let i = 0; i < showCount; i++) {
            try {
              const text = await els[i].evaluate(
                `function() { return this.textContent ? this.textContent.trim().substring(0, 100) : ''; }`
              );
              values.push(text);
            } catch (e) {
              values.push(null);
            }
          }
          info.custom[sel] = { count, values };
        } else {
          info.custom[sel] = count;
        }

        for (const el of els) {
          try { await el.dispose(); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        info.custom[sel] = 0;
      }
    }
  }

  return info;
}

/**
 * Execute a listTabs step - returns all open browser tabs
 */

export async function executeQueryAll(elementLocator, params) {
  const results = {};

  for (const [name, selectorOrConfig] of Object.entries(params)) {
    // Support both string selectors and query config objects
    const queryParams = typeof selectorOrConfig === 'string'
      ? selectorOrConfig
      : selectorOrConfig;

    try {
      results[name] = await executeQuery(elementLocator, queryParams);
    } catch (e) {
      results[name] = { error: e.message };
    }
  }

  return results;
}
