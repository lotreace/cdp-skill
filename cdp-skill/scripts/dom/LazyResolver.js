/**
 * LazyResolver
 * Stateless element resolution - always re-resolves refs from metadata instead of caching DOM elements.
 * This eliminates stale element errors entirely.
 *
 * EXPORTS:
 * - createLazyResolver(session, options?) → LazyResolver
 *   Methods: resolveRef, resolveSelector, resolveText
 *
 * DEPENDENCIES:
 * - ../utils.js: releaseObject
 */

import { releaseObject } from '../utils.js';

/**
 * Create a lazy resolver for stateless element resolution
 * @param {Object} session - CDP session
 * @param {Object} [options] - Configuration options
 * @param {Function} [options.getFrameContext] - Returns contextId when in a non-main frame
 * @returns {Object} Lazy resolver interface
 */
export function createLazyResolver(session, options = {}) {
  if (!session) throw new Error('CDP session is required');

  const getFrameContext = options.getFrameContext || null;

  /**
   * Build Runtime.evaluate params with frame context when in an iframe.
   */
  function evalParams(expression, returnByValue = false) {
    const params = { expression, returnByValue };
    if (getFrameContext) {
      const contextId = getFrameContext();
      if (contextId) params.contextId = contextId;
    }
    return params;
  }

  /**
   * Resolve an element by CSS selector - always fresh resolution
   * @param {string} selector - CSS selector
   * @returns {Promise<{objectId: string, box: Object}|null>} Element with objectId and bounding box, or null
   */
  async function resolveSelector(selector) {
    if (!selector || typeof selector !== 'string') return null;

    const expression = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          found: true,
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      })()
    `;

    try {
      // First check if element exists and get box
      const checkResult = await session.send('Runtime.evaluate', evalParams(expression, true));
      if (!checkResult.result.value?.found) return null;

      // Now get the actual objectId
      const objResult = await session.send('Runtime.evaluate',
        evalParams(`document.querySelector(${JSON.stringify(selector)})`, false)
      );

      if (objResult.result.subtype === 'null' || !objResult.result.objectId) return null;

      return {
        objectId: objResult.result.objectId,
        box: checkResult.result.value.box,
        resolvedBy: 'selector',
        selector
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Resolve an element by role and name - always fresh resolution
   * @param {string} role - ARIA role
   * @param {string} name - Accessible name
   * @returns {Promise<{objectId: string, box: Object}|null>} Element with objectId and bounding box, or null
   */
  async function resolveByRoleAndName(role, name) {
    if (!role) return null;

    const expression = `
      (function() {
        const role = ${JSON.stringify(role)};
        const name = ${JSON.stringify(name || '')};

        // Role to selector mappings
        const ROLE_SELECTORS = {
          button: ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]', '[role="button"]'],
          textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="search"]', 'input[type="tel"]', 'input[type="url"]', 'textarea', '[role="textbox"]'],
          checkbox: ['input[type="checkbox"]', '[role="checkbox"]'],
          link: ['a[href]', '[role="link"]'],
          heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="heading"]'],
          listitem: ['li', '[role="listitem"]'],
          option: ['option', '[role="option"]'],
          combobox: ['select', '[role="combobox"]'],
          radio: ['input[type="radio"]', '[role="radio"]'],
          img: ['img[alt]', '[role="img"]'],
          tab: ['[role="tab"]'],
          menuitem: ['[role="menuitem"]'],
          slider: ['input[type="range"]', '[role="slider"]'],
          spinbutton: ['input[type="number"]', '[role="spinbutton"]'],
          searchbox: ['input[type="search"]', '[role="searchbox"]'],
          switch: ['[role="switch"]']
        };

        const selectors = ROLE_SELECTORS[role] || ['[role="' + role + '"]'];
        const selectorString = selectors.join(', ');
        const elements = document.querySelectorAll(selectorString);

        function getAccessibleName(el) {
          return (
            el.getAttribute('aria-label') ||
            el.textContent?.trim() ||
            el.getAttribute('title') ||
            el.getAttribute('placeholder') ||
            el.value ||
            ''
          );
        }

        function isVisible(el) {
          if (!el.isConnected) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        // Find element matching role and name
        for (const el of elements) {
          if (!isVisible(el)) continue;
          const elName = getAccessibleName(el);
          // Match by name (case-insensitive contains)
          if (name && !elName.toLowerCase().includes(name.toLowerCase())) continue;

          const rect = el.getBoundingClientRect();
          return {
            found: true,
            box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            index: Array.from(elements).indexOf(el)
          };
        }

        return null;
      })()
    `;

    try {
      const checkResult = await session.send('Runtime.evaluate', evalParams(expression, true));
      if (!checkResult.result.value?.found) return null;

      const index = checkResult.result.value.index;

      // Get the actual objectId
      const objExpression = `
        (function() {
          const role = ${JSON.stringify(role)};
          const ROLE_SELECTORS = {
            button: ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]', '[role="button"]'],
            textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="search"]', 'input[type="tel"]', 'input[type="url"]', 'textarea', '[role="textbox"]'],
            checkbox: ['input[type="checkbox"]', '[role="checkbox"]'],
            link: ['a[href]', '[role="link"]'],
            heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="heading"]'],
            listitem: ['li', '[role="listitem"]'],
            option: ['option', '[role="option"]'],
            combobox: ['select', '[role="combobox"]'],
            radio: ['input[type="radio"]', '[role="radio"]'],
            img: ['img[alt]', '[role="img"]'],
            tab: ['[role="tab"]'],
            menuitem: ['[role="menuitem"]'],
            slider: ['input[type="range"]', '[role="slider"]'],
            spinbutton: ['input[type="number"]', '[role="spinbutton"]'],
            searchbox: ['input[type="search"]', '[role="searchbox"]'],
            switch: ['[role="switch"]']
          };
          const selectors = ROLE_SELECTORS[role] || ['[role="' + role + '"]'];
          const elements = document.querySelectorAll(selectors.join(', '));
          return elements[${index}] || null;
        })()
      `;

      const objResult = await session.send('Runtime.evaluate', evalParams(objExpression, false));
      if (objResult.result.subtype === 'null' || !objResult.result.objectId) return null;

      return {
        objectId: objResult.result.objectId,
        box: checkResult.result.value.box,
        resolvedBy: 'role+name',
        role,
        name
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Resolve an element through shadow DOM using the host path
   * @param {string[]} shadowHostPath - Array of selectors for shadow hosts
   * @param {string} selector - Final selector within the shadow root
   * @returns {Promise<{objectId: string, box: Object}|null>} Element with objectId and bounding box, or null
   */
  async function resolveThroughShadowDOM(shadowHostPath, selector) {
    if (!shadowHostPath || shadowHostPath.length === 0) return null;

    const expression = `
      (function() {
        const hostPath = ${JSON.stringify(shadowHostPath)};
        const selector = ${JSON.stringify(selector)};

        let root = document;
        for (const hostSelector of hostPath) {
          const host = root.querySelector(hostSelector);
          if (!host || !host.shadowRoot) return null;
          root = host.shadowRoot;
        }

        const el = root.querySelector(selector);
        if (!el) return null;

        const rect = el.getBoundingClientRect();
        return {
          found: true,
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      })()
    `;

    try {
      const checkResult = await session.send('Runtime.evaluate', evalParams(expression, true));
      if (!checkResult.result.value?.found) return null;

      // Get objectId
      const objExpression = `
        (function() {
          const hostPath = ${JSON.stringify(shadowHostPath)};
          const selector = ${JSON.stringify(selector)};
          let root = document;
          for (const hostSelector of hostPath) {
            const host = root.querySelector(hostSelector);
            if (!host || !host.shadowRoot) return null;
            root = host.shadowRoot;
          }
          return root.querySelector(selector);
        })()
      `;

      const objResult = await session.send('Runtime.evaluate', evalParams(objExpression, false));
      if (objResult.result.subtype === 'null' || !objResult.result.objectId) return null;

      return {
        objectId: objResult.result.objectId,
        box: checkResult.result.value.box,
        resolvedBy: 'shadow-dom',
        shadowHostPath,
        selector
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Resolve an element ref using stored metadata - ALWAYS fresh resolution
   * This is the core of lazy resolution - never uses cached element references
   *
   * Resolution order:
   * 1. Try selector from metadata
   * 2. Try role+name search if selector fails
   * 3. Try shadow DOM traversal if shadowHostPath exists
   *
   * @param {string} ref - Element ref (e.g., "s1e5")
   * @returns {Promise<{objectId: string, box: Object, resolvedBy: string}|null>} Resolved element or null
   */
  async function resolveRef(ref) {
    if (!ref || typeof ref !== 'string') return null;

    // Get metadata from browser
    const metaExpression = `
      (function() {
        const meta = window.__ariaRefMeta && window.__ariaRefMeta.get(${JSON.stringify(ref)});
        if (!meta) return null;
        return {
          selector: meta.selector || null,
          role: meta.role || null,
          name: meta.name || null,
          shadowHostPath: meta.shadowHostPath || null
        };
      })()
    `;

    let metadata;
    try {
      const metaResult = await session.send('Runtime.evaluate', evalParams(metaExpression, true));
      metadata = metaResult.result.value;
    } catch (err) {
      return null;
    }

    if (!metadata) {
      // No metadata stored - ref doesn't exist
      return null;
    }

    // Strategy 1: Try selector first (most specific)
    if (metadata.selector) {
      // If there's a shadow host path, use shadow DOM resolution
      if (metadata.shadowHostPath && metadata.shadowHostPath.length > 0) {
        const shadowResult = await resolveThroughShadowDOM(metadata.shadowHostPath, metadata.selector);
        if (shadowResult) {
          shadowResult.ref = ref;
          return shadowResult;
        }
      }

      // Try regular selector
      const selectorResult = await resolveSelector(metadata.selector);
      if (selectorResult) {
        selectorResult.ref = ref;
        return selectorResult;
      }
    }

    // Strategy 2: Try role+name search (works even if selector changed)
    if (metadata.role) {
      const roleResult = await resolveByRoleAndName(metadata.role, metadata.name);
      if (roleResult) {
        roleResult.ref = ref;
        return roleResult;
      }
    }

    // Strategy 3: Last resort - scan all shadow roots for role+name
    if (metadata.role) {
      const shadowScanResult = await scanShadowRootsForRoleAndName(metadata.role, metadata.name);
      if (shadowScanResult) {
        shadowScanResult.ref = ref;
        return shadowScanResult;
      }
    }

    return null;
  }

  /**
   * Scan all shadow roots for an element matching role and name
   * @param {string} role - ARIA role
   * @param {string} name - Accessible name
   * @returns {Promise<{objectId: string, box: Object}|null>}
   */
  async function scanShadowRootsForRoleAndName(role, name) {
    const expression = `
      (function() {
        const targetRole = ${JSON.stringify(role)};
        const targetName = ${JSON.stringify(name || '')};

        const ROLE_SELECTORS = {
          button: ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]', '[role="button"]'],
          textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="search"]', 'input[type="tel"]', 'input[type="url"]', 'textarea', '[role="textbox"]'],
          checkbox: ['input[type="checkbox"]', '[role="checkbox"]'],
          link: ['a[href]', '[role="link"]'],
          heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="heading"]'],
          listitem: ['li', '[role="listitem"]'],
          option: ['option', '[role="option"]'],
          combobox: ['select', '[role="combobox"]'],
          radio: ['input[type="radio"]', '[role="radio"]'],
          tab: ['[role="tab"]'],
          menuitem: ['[role="menuitem"]']
        };

        function getAccessibleName(el) {
          return (
            el.getAttribute('aria-label') ||
            el.textContent?.trim() ||
            el.getAttribute('title') ||
            el.getAttribute('placeholder') ||
            el.value ||
            ''
          );
        }

        function isVisible(el) {
          if (!el.isConnected) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        function searchInRoot(root, path) {
          const selectors = ROLE_SELECTORS[targetRole] || ['[role="' + targetRole + '"]'];
          const elements = root.querySelectorAll(selectors.join(', '));

          for (const el of elements) {
            if (!isVisible(el)) continue;
            const elName = getAccessibleName(el);
            if (targetName && !elName.toLowerCase().includes(targetName.toLowerCase())) continue;

            const rect = el.getBoundingClientRect();
            return {
              found: true,
              box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              path: path
            };
          }
          return null;
        }

        // Walk the tree to find shadow roots (avoids querySelectorAll('*'))
        function walkForShadowRoots(node) {
          if (node.shadowRoot) {
            const result = searchInRoot(node.shadowRoot, []);
            if (result) return result;
          }
          const children = node.children || [];
          for (const child of children) {
            const result = walkForShadowRoots(child);
            if (result) return result;
          }
          return null;
        }
        return walkForShadowRoots(document.body);
      })()
    `;

    try {
      const checkResult = await session.send('Runtime.evaluate', evalParams(expression, true));
      if (!checkResult.result.value?.found) return null;

      // For simplicity, we'll re-run to get the objectId
      // This is acceptable because lazy resolution is already making fresh queries
      const objExpression = `
        (function() {
          const targetRole = ${JSON.stringify(role)};
          const targetName = ${JSON.stringify(name || '')};

          const ROLE_SELECTORS = {
            button: ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]', '[role="button"]'],
            textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="search"]', 'input[type="tel"]', 'input[type="url"]', 'textarea', '[role="textbox"]'],
            checkbox: ['input[type="checkbox"]', '[role="checkbox"]'],
            link: ['a[href]', '[role="link"]'],
            heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="heading"]'],
            listitem: ['li', '[role="listitem"]'],
            option: ['option', '[role="option"]'],
            combobox: ['select', '[role="combobox"]'],
            radio: ['input[type="radio"]', '[role="radio"]'],
            tab: ['[role="tab"]'],
            menuitem: ['[role="menuitem"]']
          };

          function getAccessibleName(el) {
            return (
              el.getAttribute('aria-label') ||
              el.textContent?.trim() ||
              el.getAttribute('title') ||
              el.getAttribute('placeholder') ||
              el.value ||
              ''
            );
          }

          function isVisible(el) {
            if (!el.isConnected) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }

          function walkForShadowRoots(node) {
            if (node.shadowRoot) {
              const selectors = ROLE_SELECTORS[targetRole] || ['[role="' + targetRole + '"]'];
              const elements = node.shadowRoot.querySelectorAll(selectors.join(', '));
              for (const el of elements) {
                if (!isVisible(el)) continue;
                const elName = getAccessibleName(el);
                if (targetName && !elName.toLowerCase().includes(targetName.toLowerCase())) continue;
                return el;
              }
              const found = walkForShadowRoots(node.shadowRoot);
              if (found) return found;
            }
            const children = node.children || [];
            for (const child of children) {
              const found = walkForShadowRoots(child);
              if (found) return found;
            }
            return null;
          }
          return walkForShadowRoots(document.body);
        })()
      `;

      const objResult = await session.send('Runtime.evaluate', evalParams(objExpression, false));
      if (objResult.result.subtype === 'null' || !objResult.result.objectId) return null;

      return {
        objectId: objResult.result.objectId,
        box: checkResult.result.value.box,
        resolvedBy: 'shadow-scan',
        role,
        name
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Resolve an element by text content - always fresh resolution
   * @param {string} text - Text to search for
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.exact=false] - Require exact match
   * @returns {Promise<{objectId: string, box: Object}|null>} Element with objectId and bounding box, or null
   */
  async function resolveText(text, opts = {}) {
    if (!text || typeof text !== 'string') return null;

    const { exact = false } = opts;
    const expression = `
      (function() {
        const text = ${JSON.stringify(text)};
        const exact = ${exact};

        function getElementText(el) {
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return ariaLabel;
          if (el.tagName === 'INPUT') return el.value || el.placeholder || '';
          return el.textContent || '';
        }

        function matchesText(elText) {
          if (exact) return elText.trim() === text;
          return elText.toLowerCase().includes(text.toLowerCase());
        }

        function isVisible(el) {
          if (!el.isConnected) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        // Priority: buttons → links → role buttons → other clickable
        const selectorGroups = [
          ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]'],
          ['a[href]'],
          ['[role="button"]'],
          ['[onclick]', '[tabindex]', 'label', 'summary']
        ];

        for (const selectors of selectorGroups) {
          const elements = document.querySelectorAll(selectors.join(', '));
          for (const el of elements) {
            if (!isVisible(el)) continue;
            if (matchesText(getElementText(el))) {
              const rect = el.getBoundingClientRect();
              return {
                found: true,
                box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                selectors: selectors.join(', ')
              };
            }
          }
        }
        return null;
      })()
    `;

    try {
      const checkResult = await session.send('Runtime.evaluate', evalParams(expression, true));
      if (!checkResult.result.value?.found) return null;

      const matchedSelectors = checkResult.result.value.selectors;

      // Get objectId
      const objExpression = `
        (function() {
          const text = ${JSON.stringify(text)};
          const exact = ${exact};
          const selectors = ${JSON.stringify(matchedSelectors)};

          function getElementText(el) {
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel;
            if (el.tagName === 'INPUT') return el.value || el.placeholder || '';
            return el.textContent || '';
          }

          function matchesText(elText) {
            if (exact) return elText.trim() === text;
            return elText.toLowerCase().includes(text.toLowerCase());
          }

          function isVisible(el) {
            if (!el.isConnected) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }

          const elements = document.querySelectorAll(selectors);
          for (const el of elements) {
            if (!isVisible(el)) continue;
            if (matchesText(getElementText(el))) return el;
          }
          return null;
        })()
      `;

      const objResult = await session.send('Runtime.evaluate', evalParams(objExpression, false));
      if (objResult.result.subtype === 'null' || !objResult.result.objectId) return null;

      return {
        objectId: objResult.result.objectId,
        box: checkResult.result.value.box,
        resolvedBy: 'text',
        text
      };
    } catch (err) {
      return null;
    }
  }

  return {
    resolveRef,
    resolveSelector,
    resolveText,
    resolveByRoleAndName,
    resolveThroughShadowDOM
  };
}
