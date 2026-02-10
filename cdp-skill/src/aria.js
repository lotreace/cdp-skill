/**
 * ARIA - Accessibility tree generation and role-based queries for AI agents
 *
 * Consolidated module containing:
 * - AriaSnapshot: Generates semantic tree representation based on ARIA roles
 * - RoleQueryExecutor: Advanced role-based queries with filtering
 * - QueryOutputProcessor: Output formatting and attribute extraction
 */

// ============================================================================
// Query Output Processor (from QueryOutputProcessor.js)
// ============================================================================

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

// ============================================================================
// Role Query Executor (from RoleQueryExecutor.js)
// ============================================================================

/**
 * Create a role query executor for advanced role-based queries
 * @param {Object} session - CDP session
 * @param {Object} elementLocator - Element locator instance
 * @returns {Object} Role query executor interface
 */
export function createRoleQueryExecutor(session, elementLocator, options = {}) {
  const getFrameContext = options.getFrameContext || null;
  const outputProcessor = createQueryOutputProcessor(session);

  async function releaseObject(objectId) {
    try {
      await session.send('Runtime.releaseObject', { objectId });
    } catch {
      // Ignore
    }
  }

  /**
   * Query elements by one or more roles
   * @param {string[]} roles - Array of roles to query
   * @param {Object} filters - Filter options
   * @returns {Promise<Object[]>} Array of element handles
   */
  async function queryByRoles(roles, filters) {
    const { name, nameExact, nameRegex, checked, disabled, level } = filters;

    // Map ARIA roles to common HTML element selectors
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
      tabpanel: ['[role="tabpanel"]'],
      menu: ['[role="menu"]'],
      menuitem: ['[role="menuitem"]'],
      dialog: ['dialog', '[role="dialog"]'],
      alert: ['[role="alert"]'],
      navigation: ['nav', '[role="navigation"]'],
      main: ['main', '[role="main"]'],
      search: ['[role="search"]'],
      form: ['form', '[role="form"]']
    };

    // Build selectors for all requested roles
    const allSelectors = [];
    for (const r of roles) {
      const selectors = ROLE_SELECTORS[r] || [`[role="${r}"]`];
      allSelectors.push(...selectors);
    }
    const selectorString = allSelectors.join(', ');

    // Build filter conditions
    const nameFilter = (name !== undefined && name !== null) ? JSON.stringify(name) : null;
    const nameExactFlag = nameExact === true;
    const nameRegexPattern = nameRegex ? JSON.stringify(nameRegex) : null;
    const checkedFilter = checked !== undefined ? checked : null;
    const disabledFilter = disabled !== undefined ? disabled : null;
    const levelFilter = level !== undefined ? level : null;
    const rolesForLevel = roles; // For heading level detection

    const expression = `
      (function() {
        const selectors = ${JSON.stringify(selectorString)};
        const nameFilter = ${nameFilter};
        const nameExact = ${nameExactFlag};
        const nameRegex = ${nameRegexPattern};
        const checkedFilter = ${checkedFilter !== null ? checkedFilter : 'null'};
        const disabledFilter = ${disabledFilter !== null ? disabledFilter : 'null'};
        const levelFilter = ${levelFilter !== null ? levelFilter : 'null'};
        const rolesForLevel = ${JSON.stringify(rolesForLevel)};

        const elements = Array.from(document.querySelectorAll(selectors));

        return elements.filter(el => {
          // Filter by accessible name if specified
          if (nameFilter !== null || nameRegex !== null) {
            const accessibleName = (
              el.getAttribute('aria-label') ||
              el.textContent?.trim() ||
              el.getAttribute('title') ||
              el.getAttribute('placeholder') ||
              el.value ||
              ''
            );

            if (nameFilter !== null) {
              if (nameExact) {
                // Exact match
                if (accessibleName !== nameFilter) return false;
              } else {
                // Contains match (case-insensitive)
                if (!accessibleName.toLowerCase().includes(nameFilter.toLowerCase())) return false;
              }
            }

            if (nameRegex !== null) {
              // Regex match
              try {
                const regex = new RegExp(nameRegex);
                if (!regex.test(accessibleName)) return false;
              } catch (e) {
                // Invalid regex, skip filter
              }
            }
          }

          // Filter by checked state if specified
          if (checkedFilter !== null) {
            const isChecked = el.checked === true || el.getAttribute('aria-checked') === 'true';
            if (isChecked !== checkedFilter) return false;
          }

          // Filter by disabled state if specified
          if (disabledFilter !== null) {
            const isDisabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
            if (isDisabled !== disabledFilter) return false;
          }

          // Filter by heading level if specified
          if (levelFilter !== null && rolesForLevel.includes('heading')) {
            const tagName = el.tagName.toLowerCase();
            let headingLevel = null;

            // Check aria-level first
            const ariaLevel = el.getAttribute('aria-level');
            if (ariaLevel) {
              headingLevel = parseInt(ariaLevel, 10);
            } else if (tagName.match(/^h[1-6]$/)) {
              // Extract level from h1-h6 tag
              headingLevel = parseInt(tagName.charAt(1), 10);
            }

            if (headingLevel !== levelFilter) return false;
          }

          return true;
        });
      })()
    `;

    let result;
    try {
      const evalArgs = { expression, returnByValue: false };
      if (getFrameContext) {
        const contextId = getFrameContext();
        if (contextId) evalArgs.contextId = contextId;
      }
      result = await session.send('Runtime.evaluate', evalArgs);
    } catch (error) {
      throw new Error(`Role query error: ${error.message}`);
    }

    if (result.exceptionDetails) {
      throw new Error(`Role query error: ${result.exceptionDetails.text}`);
    }

    if (!result.result.objectId) return [];

    const arrayObjectId = result.result.objectId;
    let props;
    try {
      props = await session.send('Runtime.getProperties', {
        objectId: arrayObjectId,
        ownProperties: true
      });
    } catch (error) {
      await releaseObject(arrayObjectId);
      throw new Error(`Role query error: ${error.message}`);
    }

    const { createElementHandle } = await import('./dom/element-handle.js');
    const elements = props.result
      .filter(p => /^\d+$/.test(p.name) && p.value && p.value.objectId)
      .map(p => createElementHandle(session, p.value.objectId, {
        selector: `[role="${roles.join('|')}"]`
      }));

    await releaseObject(arrayObjectId);
    return elements;
  }

  /**
   * Execute a role-based query with advanced options
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Query results
   */
  async function execute(params) {
    const {
      role,
      name,
      nameExact,
      nameRegex,
      checked,
      disabled,
      level,
      limit = 10,
      output = 'text',
      clean = false,
      metadata = false,
      countOnly = false,
      refs = false
    } = params;

    // Handle compound roles
    const roles = Array.isArray(role) ? role : [role];

    // Build query expression
    const elements = await queryByRoles(roles, {
      name,
      nameExact,
      nameRegex,
      checked,
      disabled,
      level
    });

    // Count-only mode
    if (countOnly) {
      // Dispose all elements
      for (const el of elements) {
        try { await el.dispose(); } catch { /* ignore */ }
      }

      return {
        role: roles.length === 1 ? roles[0] : roles,
        total: elements.length,
        countOnly: true
      };
    }

    const results = [];
    const count = Math.min(elements.length, limit);

    for (let i = 0; i < count; i++) {
      const el = elements[i];
      try {
        const resultItem = {
          index: i + 1,
          value: await outputProcessor.processOutput(el, output, { clean })
        };

        // Add element metadata if requested
        if (metadata) {
          resultItem.metadata = await outputProcessor.getElementMetadata(el);
        }

        // Add element ref if requested
        if (refs) {
          resultItem.ref = el.objectId;
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
      role: roles.length === 1 ? roles[0] : roles,
      name: name || null,
      nameExact: nameExact || false,
      nameRegex: nameRegex || null,
      checked: checked !== undefined ? checked : null,
      disabled: disabled !== undefined ? disabled : null,
      level: level !== undefined ? level : null,
      total: elements.length,
      showing: count,
      results
    };
  }

  return {
    execute,
    queryByRoles
  };
}

// ============================================================================
// Aria Snapshot (from AriaSnapshot.js)
// ============================================================================

// The snapshot script runs entirely in the browser context
const SNAPSHOT_SCRIPT = `
(function generateAriaSnapshot(rootSelector, options) {
  const { mode = 'ai', maxDepth = 50, maxElements = 0, includeText = false, includeFrames = false, viewportOnly = false, pierceShadow = false, preserveRefs = false, since = null, internal = false } = options || {};

  // Viewport dimensions for viewport-only mode
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Element counter for maxElements limit
  let elementCount = 0;
  let limitReached = false;

  // Snapshot versioning - HTTP 304-like caching
  // Initialize global state for snapshot tracking
  if (window.__ariaSnapshotId === undefined) {
    window.__ariaSnapshotId = 0;
  }

  // Compute page hash for change detection
  // Hash combines: URL + scroll position + DOM size + interactive element count
  function computePageHash() {
    const url = location.href;
    const scroll = Math.round(window.scrollY / 100) * 100; // Round to nearest 100px for stability
    const bodySize = document.body?.innerHTML?.length || 0;
    const interactiveCount = document.querySelectorAll(
      'a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]'
    ).length;
    return url + '|' + scroll + '|' + bodySize + '|' + interactiveCount;
  }

  // Check if page has changed since a given snapshot ID
  // We only check the hash - if the page content hash is the same, no need for new snapshot
  // Note: snapshotId may have incremented due to internal auto-snapshots, but that doesn't
  // mean the page changed - the hash tells us if the actual content is different
  if (since) {
    const currentHash = computePageHash();

    // If the hash hasn't changed, page content is the same
    if (currentHash === window.__ariaSnapshotHash) {
      return {
        unchanged: true,
        snapshotId: 's' + window.__ariaSnapshotId,
        hash: currentHash
      };
    }
  }

  // Increment snapshot ID only for agent-facing snapshots (explicit snapshot step, navigation)
  // Internal snapshots (diff before/after, snapshotSearch) reuse the current ID
  // Exception: always increment from 0 so the first snapshot produces s1 (not s0)
  if (!internal || window.__ariaSnapshotId === 0) {
    window.__ariaSnapshotId++;
  }
  const currentSnapshotId = window.__ariaSnapshotId;

  // Role mappings from HTML elements to ARIA roles
  const IMPLICIT_ROLES = {
    'A': (el) => el.hasAttribute('href') ? 'link' : null,
    'AREA': (el) => el.hasAttribute('href') ? 'link' : null,
    'ARTICLE': () => 'article',
    'ASIDE': () => 'complementary',
    'BUTTON': () => 'button',
    'DATALIST': () => 'listbox',
    'DETAILS': () => 'group',
    'DIALOG': () => 'dialog',
    'FIELDSET': () => 'group',
    'FIGURE': () => 'figure',
    'FOOTER': () => 'contentinfo',
    'FORM': (el) => hasAccessibleName(el) ? 'form' : null,
    'H1': () => 'heading',
    'H2': () => 'heading',
    'H3': () => 'heading',
    'H4': () => 'heading',
    'H5': () => 'heading',
    'H6': () => 'heading',
    'HEADER': () => 'banner',
    'HR': () => 'separator',
    'IMG': (el) => el.getAttribute('alt') === '' ? 'presentation' : 'img',
    'INPUT': (el) => {
      const type = (el.type || 'text').toLowerCase();
      const typeRoles = {
        'button': 'button',
        'checkbox': 'checkbox',
        'radio': 'radio',
        'range': 'slider',
        'number': 'spinbutton',
        'search': 'searchbox',
        'email': 'textbox',
        'tel': 'textbox',
        'text': 'textbox',
        'url': 'textbox',
        'password': 'textbox',
        'submit': 'button',
        'reset': 'button',
        'image': 'button'
      };
      if (el.hasAttribute('list')) return 'combobox';
      return typeRoles[type] || 'textbox';
    },
    'LI': () => 'listitem',
    'MAIN': () => 'main',
    'MATH': () => 'math',
    'MENU': () => 'list',
    'NAV': () => 'navigation',
    'OL': () => 'list',
    'OPTGROUP': () => 'group',
    'OPTION': () => 'option',
    'OUTPUT': () => 'status',
    'P': () => 'paragraph',
    'PROGRESS': () => 'progressbar',
    'SECTION': (el) => hasAccessibleName(el) ? 'region' : null,
    'SELECT': (el) => el.multiple ? 'listbox' : 'combobox',
    'SPAN': () => null,
    'SUMMARY': () => 'button',
    'TABLE': () => 'table',
    'TBODY': () => 'rowgroup',
    'TD': () => 'cell',
    'TEXTAREA': () => 'textbox',
    'TFOOT': () => 'rowgroup',
    'TH': () => 'columnheader',
    'THEAD': () => 'rowgroup',
    'TR': () => 'row',
    'UL': () => 'list'
  };

  // Roles that support checked state
  const CHECKED_ROLES = ['checkbox', 'radio', 'menuitemcheckbox', 'menuitemradio', 'option', 'switch'];

  // Roles that support disabled state
  const DISABLED_ROLES = ['button', 'checkbox', 'combobox', 'gridcell', 'link', 'listbox', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'scrollbar', 'searchbox', 'slider',
    'spinbutton', 'switch', 'tab', 'textbox', 'treeitem'];

  // Roles that support expanded state
  const EXPANDED_ROLES = ['application', 'button', 'checkbox', 'combobox', 'gridcell', 'link',
    'listbox', 'menuitem', 'row', 'rowheader', 'tab', 'treeitem'];

  // Roles that support pressed state
  const PRESSED_ROLES = ['button'];

  // Roles that support selected state
  const SELECTED_ROLES = ['gridcell', 'option', 'row', 'tab', 'treeitem'];

  // Roles that support required state
  const REQUIRED_ROLES = ['checkbox', 'combobox', 'gridcell', 'listbox', 'radiogroup',
    'searchbox', 'spinbutton', 'textbox', 'tree'];

  // Roles that support invalid state
  const INVALID_ROLES = ['checkbox', 'combobox', 'gridcell', 'listbox', 'radiogroup',
    'searchbox', 'slider', 'spinbutton', 'textbox', 'tree'];

  // Interactable roles for AI mode
  const INTERACTABLE_ROLES = ['button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'searchbox', 'slider', 'spinbutton',
    'switch', 'tab', 'textbox', 'treeitem'];

  // Roles where text content is important to display (status messages, alerts, etc.)
  const TEXT_CONTENT_ROLES = ['alert', 'alertdialog', 'status', 'log', 'marquee', 'timer', 'paragraph'];

  // When preserveRefs is true, continue numbering from existing counter
  // This prevents new snapshots from overwriting refs generated by snapshotSearch
  let refCounter = preserveRefs && window.__ariaRefCounter ? window.__ariaRefCounter : 0;
  const elementRefs = new Map();
  const refElements = new Map();

  function hasAccessibleName(el) {
    return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || el.hasAttribute('title');
  }

  function isHiddenForAria(el) {
    if (el.hasAttribute('aria-hidden') && el.getAttribute('aria-hidden') !== 'false') return true;
    if (el.hidden) return true;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    return false;
  }

  function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    // Element is in viewport if any part of it is visible
    return rect.bottom > 0 && rect.top < viewportHeight &&
           rect.right > 0 && rect.left < viewportWidth;
  }

  // Container tags that may have scrollable content outside their bounding rect
  const CONTAINER_TAGS = new Set(['BODY', 'HTML', 'MAIN', 'ARTICLE', 'SECTION', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'DIV', 'FORM']);

  function isVisible(el) {
    if (isHiddenForAria(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    // In viewportOnly mode, check if element is in viewport
    // But allow container elements through - they may have children in viewport
    if (viewportOnly && !CONTAINER_TAGS.has(el.tagName) && !isInViewport(el)) return false;
    return true;
  }

  function getAriaRole(el) {
    // Explicit role takes precedence
    const explicitRole = el.getAttribute('role');
    if (explicitRole) {
      const roles = explicitRole.split(/\\s+/).filter(r => r);
      if (roles.length > 0 && roles[0] !== 'presentation' && roles[0] !== 'none') {
        return roles[0];
      }
      if (roles[0] === 'presentation' || roles[0] === 'none') {
        return null;
      }
    }

    // Implicit role from element type
    const tagName = el.tagName.toUpperCase();
    const roleFunc = IMPLICIT_ROLES[tagName];
    if (roleFunc) {
      return roleFunc(el);
    }

    return null;
  }

  function getAccessibleName(el) {
    // aria-labelledby takes precedence
    if (el.hasAttribute('aria-labelledby')) {
      const ids = el.getAttribute('aria-labelledby').split(/\\s+/);
      const texts = ids.map(id => {
        const labelEl = document.getElementById(id);
        return labelEl ? labelEl.textContent : '';
      }).filter(t => t);
      if (texts.length > 0) return normalizeWhitespace(texts.join(' '));
    }

    // aria-label
    if (el.hasAttribute('aria-label')) {
      return normalizeWhitespace(el.getAttribute('aria-label'));
    }

    // Labels for form elements
    if (el.id && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) return normalizeWhitespace(label.textContent);
    }

    // Wrapped in label
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel !== el) {
      // Get label text excluding the input itself
      const clone = parentLabel.cloneNode(true);
      const inputs = clone.querySelectorAll('input, select, textarea');
      inputs.forEach(i => i.remove());
      const text = normalizeWhitespace(clone.textContent);
      if (text) return text;
    }

    // Title attribute
    if (el.hasAttribute('title')) {
      return normalizeWhitespace(el.getAttribute('title'));
    }

    // Placeholder for inputs
    if (el.hasAttribute('placeholder') && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      return normalizeWhitespace(el.getAttribute('placeholder'));
    }

    // Alt text for images
    if (el.tagName === 'IMG' && el.hasAttribute('alt')) {
      return normalizeWhitespace(el.getAttribute('alt'));
    }

    // Text content for buttons, links, etc.
    const role = getAriaRole(el);
    if (['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
         'tab', 'treeitem', 'heading', 'gridcell', 'listitem', 'columnheader',
         'rowheader', 'cell', 'switch'].includes(role)) {
      return normalizeWhitespace(el.textContent);
    }

    // Short-text fallback for any remaining role with empty name
    if (role) {
      const fallbackText = normalizeWhitespace(el.textContent);
      if (fallbackText && fallbackText.length <= 80) return fallbackText;
    }

    return '';
  }

  function normalizeWhitespace(text) {
    if (!text) return '';
    return text.replace(/\\s+/g, ' ').trim();
  }

  function getCheckedState(el, role) {
    if (!CHECKED_ROLES.includes(role)) return undefined;

    const ariaChecked = el.getAttribute('aria-checked');
    if (ariaChecked === 'mixed') return 'mixed';
    if (ariaChecked === 'true') return true;
    if (ariaChecked === 'false') return false;

    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      return el.checked;
    }

    return undefined;
  }

  function getDisabledState(el, role) {
    if (!DISABLED_ROLES.includes(role)) return undefined;

    if (el.hasAttribute('aria-disabled')) {
      return el.getAttribute('aria-disabled') === 'true';
    }

    if (el.disabled !== undefined) {
      return el.disabled;
    }

    return undefined;
  }

  function getExpandedState(el, role) {
    if (!EXPANDED_ROLES.includes(role)) return undefined;

    if (el.hasAttribute('aria-expanded')) {
      return el.getAttribute('aria-expanded') === 'true';
    }

    if (el.tagName === 'DETAILS') {
      return el.open;
    }

    return undefined;
  }

  function getPressedState(el, role) {
    if (!PRESSED_ROLES.includes(role)) return undefined;

    const ariaPressed = el.getAttribute('aria-pressed');
    if (ariaPressed === 'mixed') return 'mixed';
    if (ariaPressed === 'true') return true;
    if (ariaPressed === 'false') return false;

    return undefined;
  }

  function getSelectedState(el, role) {
    if (!SELECTED_ROLES.includes(role)) return undefined;

    if (el.hasAttribute('aria-selected')) {
      return el.getAttribute('aria-selected') === 'true';
    }

    if (el.tagName === 'OPTION') {
      return el.selected;
    }

    return undefined;
  }

  function getLevel(el, role) {
    if (role !== 'heading') return undefined;

    if (el.hasAttribute('aria-level')) {
      return parseInt(el.getAttribute('aria-level'), 10);
    }

    const match = el.tagName.match(/^H(\\d)$/);
    if (match) {
      return parseInt(match[1], 10);
    }

    return undefined;
  }

  function getInvalidState(el, role) {
    if (!INVALID_ROLES.includes(role)) return undefined;

    // Check aria-invalid attribute
    if (el.hasAttribute('aria-invalid')) {
      const value = el.getAttribute('aria-invalid');
      if (value === 'true') return true;
      if (value === 'grammar') return 'grammar';
      if (value === 'spelling') return 'spelling';
      if (value === 'false') return false;
    }

    // Check HTML5 validation state for form elements
    if (el.validity && typeof el.validity === 'object') {
      // Only report invalid if the field has been interacted with
      // or has a value (to avoid showing all empty required fields as invalid)
      if (!el.validity.valid && (el.value || el.classList.contains('touched') || el.dataset.touched)) {
        return true;
      }
    }

    return undefined;
  }

  function getRequiredState(el, role) {
    if (!REQUIRED_ROLES.includes(role)) return undefined;

    // Check aria-required attribute
    if (el.hasAttribute('aria-required')) {
      return el.getAttribute('aria-required') === 'true';
    }

    // Check HTML5 required attribute
    if (el.required !== undefined) {
      return el.required;
    }

    return undefined;
  }

  function getNameAttribute(el, role) {
    // Only include name attribute for form-related roles
    const FORM_ROLES = ['textbox', 'searchbox', 'checkbox', 'radio', 'combobox',
                        'listbox', 'spinbutton', 'slider', 'switch'];
    if (!FORM_ROLES.includes(role)) return undefined;

    const name = el.getAttribute('name');
    if (name && name.trim()) {
      return name.trim();
    }
    return undefined;
  }

  function getBoundingBox(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function hasPointerCursor(el) {
    const style = window.getComputedStyle(el);
    return style.cursor === 'pointer';
  }

  function isInteractable(el, role) {
    if (!role) return false;
    if (INTERACTABLE_ROLES.includes(role)) return true;
    if (hasPointerCursor(el)) return true;
    if (el.onclick || el.hasAttribute('onclick')) return true;
    return false;
  }

  // Metadata map for ref re-resolution when elements go stale
  const refMeta = new Map();

  function generateRef(el, role, name) {
    // Check if element already has a ref in current snapshot
    if (elementRefs.has(el)) return elementRefs.get(el);

    // Build metadata with shadow host path for shadow DOM elements
    function buildMeta(element, r, n) {
      const meta = { selector: generateSelector(element), role: r || '', name: n || '' };
      const shadowPath = getShadowHostPath(element);
      if (shadowPath.length > 0) meta.shadowHostPath = shadowPath;
      return meta;
    }

    // Check if element already has a ref from a previous snapshot
    // This ensures the same element always gets the same ref
    if (window.__ariaRefs) {
      for (const [existingRef, existingEl] of window.__ariaRefs) {
        if (existingEl === el) {
          elementRefs.set(el, existingRef);
          refElements.set(existingRef, el);
          // Update metadata in case it changed
          refMeta.set(existingRef, buildMeta(el, role, name));
          return existingRef;
        }
      }
    }

    // New element - assign new ref with versioned format: s{snapshotId}e{refCounter}
    refCounter++;
    const ref = 's' + currentSnapshotId + 'e' + refCounter;
    elementRefs.set(el, ref);
    refElements.set(ref, el);
    // Store metadata for re-resolution fallback
    refMeta.set(ref, buildMeta(el, role, name));
    return ref;
  }

  function shouldIncludeTextContent(role) {
    // Always include text for roles that typically contain important messages
    return TEXT_CONTENT_ROLES.includes(role);
  }

  function buildAriaNode(el, depth, parentRole) {
    // Check maxElements limit
    if (maxElements > 0 && elementCount >= maxElements) {
      limitReached = true;
      return null;
    }

    if (depth > maxDepth) return null;
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;

    // Handle iframes specially if includeFrames is enabled
    if (includeFrames && (el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
      elementCount++;
      try {
        const frameDoc = el.contentDocument;
        if (frameDoc && frameDoc.body) {
          const frameNode = {
            role: 'document',
            name: el.title || el.name || 'iframe',
            isFrame: true,
            frameUrl: el.src || '',
            children: []
          };
          for (const child of frameDoc.body.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE) {
              const node = buildAriaNode(child, depth + 1, 'document');
              if (node) frameNode.children.push(node);
            }
          }
          return frameNode.children.length > 0 ? frameNode : null;
        }
      } catch (e) {
        // Cross-origin iframe - can't access content
        return {
          role: 'document',
          name: el.title || el.name || 'iframe (cross-origin)',
          isFrame: true,
          frameUrl: el.src || '',
          crossOrigin: true
        };
      }
      return null;
    }

    const visible = isVisible(el);
    if (mode === 'ai' && !visible) return null;

    const role = getAriaRole(el);
    const name = getAccessibleName(el);

    // Skip elements without semantic meaning
    if (!role && mode === 'ai') {
      // Still process children
      const children = buildChildren(el, depth, null);
      if (children.length === 0) return null;
      if (children.length === 1 && typeof children[0] !== 'string') return children[0];
      return { role: 'generic', name: '', children };
    }

    if (!role) return null;

    // Increment element count
    elementCount++;

    const node = { role, name };

    // Add states
    const checked = getCheckedState(el, role);
    if (checked !== undefined) node.checked = checked;

    const disabled = getDisabledState(el, role);
    if (disabled === true) node.disabled = true;

    const expanded = getExpandedState(el, role);
    if (expanded !== undefined) node.expanded = expanded;

    const pressed = getPressedState(el, role);
    if (pressed !== undefined) node.pressed = pressed;

    const selected = getSelectedState(el, role);
    if (selected === true) node.selected = true;

    const level = getLevel(el, role);
    if (level !== undefined) node.level = level;

    // Add invalid state
    const invalid = getInvalidState(el, role);
    if (invalid === true) node.invalid = true;
    else if (invalid === 'grammar' || invalid === 'spelling') node.invalid = invalid;

    // Add required state
    const required = getRequiredState(el, role);
    if (required === true) node.required = true;

    // Add ref for interactable elements in AI mode
    // Note: box info is stored in refs map for internal lookups, not in output tree
    if (mode === 'ai' && visible && isInteractable(el, role)) {
      node.ref = generateRef(el, role, name);
    }

    // Add name attribute for form elements
    const nameAttr = getNameAttribute(el, role);
    if (nameAttr) node.nameAttr = nameAttr;

    // Add value for inputs
    if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton') {
      const value = el.value || '';
      if (value) node.value = value;
    }

    // Add URL for links
    if (role === 'link' && el.href) {
      node.url = el.href;
    }

    // Build children - pass the role so text nodes can be included for certain roles
    const children = buildChildren(el, depth, role);
    if (children.length > 0) {
      node.children = children;
    }

    return node;
  }

  function buildChildren(el, depth, parentRole) {
    const children = [];

    // Determine if we should include text nodes for this parent
    const shouldIncludeText = includeText || shouldIncludeTextContent(parentRole);

    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = normalizeWhitespace(child.textContent);
        // Include text nodes in full mode, or when includeText option is set,
        // or when parent role typically contains important text content
        if (text && (mode !== 'ai' || shouldIncludeText)) {
          children.push({ role: 'staticText', name: text });
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const node = buildAriaNode(child, depth + 1, parentRole);
        if (node) {
          if (node.role === 'generic' && node.children) {
            // Flatten generic nodes
            children.push(...node.children);
          } else {
            children.push(node);
          }
        }
      }
    }

    // Handle shadow DOM (only when pierceShadow is enabled)
    if (pierceShadow && el.shadowRoot) {
      for (const child of el.shadowRoot.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const node = buildAriaNode(child, depth + 1, parentRole);
          if (node) children.push(node);
        }
      }
    }

    return children;
  }

  function renderYaml(node, indent = '') {
    if (typeof node === 'string') {
      return indent + '- text: ' + JSON.stringify(node);
    }

    // Handle staticText nodes
    if (node.role === 'staticText') {
      return indent + '- text ' + JSON.stringify(node.name);
    }

    let key = node.role;
    if (node.name) {
      key += ' ' + JSON.stringify(node.name);
    }

    // Add states
    if (node.checked === 'mixed') key += ' [checked=mixed]';
    else if (node.checked === true) key += ' [checked]';
    if (node.disabled) key += ' [disabled]';
    if (node.expanded === true) key += ' [expanded]';
    else if (node.expanded === false) key += ' [collapsed]';
    if (node.pressed === 'mixed') key += ' [pressed=mixed]';
    else if (node.pressed === true) key += ' [pressed]';
    if (node.selected) key += ' [selected]';
    if (node.required) key += ' [required]';
    if (node.invalid === true) key += ' [invalid]';
    else if (node.invalid === 'grammar') key += ' [invalid=grammar]';
    else if (node.invalid === 'spelling') key += ' [invalid=spelling]';
    if (node.level) key += ' [level=' + node.level + ']';
    if (node.nameAttr) key += ' [name=' + node.nameAttr + ']';
    if (node.ref) key += ' [ref=' + node.ref + ']';

    const lines = [];

    if (!node.children || node.children.length === 0) {
      // Leaf node
      if (node.value !== undefined) {
        lines.push(indent + '- ' + key + ': ' + JSON.stringify(node.value));
      } else {
        lines.push(indent + '- ' + key);
      }
    } else if (node.children.length === 1 && node.children[0].role === 'staticText') {
      // Single static text child - inline it
      lines.push(indent + '- ' + key + ': ' + JSON.stringify(node.children[0].name));
    } else {
      // Node with children
      lines.push(indent + '- ' + key + ':');
      for (const child of node.children) {
        lines.push(renderYaml(child, indent + '  '));
      }
    }

    return lines.join('\\n');
  }

  // Parse rootSelector - support both CSS selectors and role= syntax
  function resolveRoot(selector) {
    if (!selector) return document.body;

    // Check for role= syntax (e.g., "role=main", "role=navigation")
    const roleMatch = selector.match(/^role=(.+)$/i);
    if (roleMatch) {
      const targetRole = roleMatch[1].toLowerCase();

      // First, try explicit role attribute
      const explicitRoleEl = document.querySelector('[role="' + targetRole + '"]');
      if (explicitRoleEl) return explicitRoleEl;

      // Then try implicit roles from HTML elements
      const implicitMappings = {
        'main': 'main',
        'navigation': 'nav',
        'banner': 'header',
        'contentinfo': 'footer',
        'complementary': 'aside',
        'article': 'article',
        'form': 'form',
        'region': 'section',
        'list': 'ul, ol, menu',
        'listitem': 'li',
        'heading': 'h1, h2, h3, h4, h5, h6',
        'link': 'a[href]',
        'button': 'button, input[type="button"], input[type="submit"], input[type="reset"]',
        'textbox': 'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="password"], textarea',
        'checkbox': 'input[type="checkbox"]',
        'radio': 'input[type="radio"]',
        'combobox': 'select',
        'table': 'table',
        'row': 'tr',
        'cell': 'td',
        'columnheader': 'th',
        'img': 'img[alt]:not([alt=""])',
        'separator': 'hr',
        'dialog': 'dialog'
      };

      const implicitSelector = implicitMappings[targetRole];
      if (implicitSelector) {
        const el = document.querySelector(implicitSelector);
        if (el) return el;
      }

      return null; // Role not found
    }

    // Regular CSS selector
    return document.querySelector(selector);
  }

  // Main execution - auto-scope to <main> when no root specified (reduces footer/boilerplate noise)
  let autoScoped = false;
  let root;
  if (!rootSelector) {
    const mainEl = document.querySelector('main, [role="main"]');
    if (mainEl) {
      root = mainEl;
      autoScoped = true;
    } else {
      root = document.body;
    }
  } else {
    root = resolveRoot(rootSelector);
  }
  if (!root) {
    const roleMatch = rootSelector && rootSelector.match(/^role=(.+)$/i);
    if (roleMatch) {
      return { error: 'Root element not found for role: ' + roleMatch[1] + '. Use CSS selector (e.g., "main", "#container") or check that an element with this role exists.' };
    }
    return { error: 'Root element not found: ' + rootSelector + '. Note: for ARIA roles, use "role=main" syntax instead of just "main".' };
  }

  const tree = buildAriaNode(root, 0, null);
  if (!tree) {
    return { tree: null, yaml: '', refs: {} };
  }

  // Build refs map for output (selector only, box info available via getElementByRef)
  const refs = {};
  for (const [ref, el] of refElements) {
    refs[ref] = generateSelector(el);
  }

  // Build the shadow host path for an element (empty array if not in shadow DOM)
  function getShadowHostPath(el) {
    const hosts = [];
    let node = el;
    while (node) {
      const root = node.getRootNode();
      if (root instanceof ShadowRoot) {
        hosts.unshift(generateSelectorForElement(root.host));
        node = root.host;
      } else {
        break;
      }
    }
    return hosts;
  }

  // Generate a CSS selector for a single element (used by both generateSelector and shadow path)
  function generateSelectorForElement(el) {
    if (el.id) return '#' + CSS.escape(el.id);

    for (const attr of ['data-testid', 'data-test-id', 'data-cy', 'name']) {
      if (el.hasAttribute(attr)) {
        const value = el.getAttribute(attr);
        const selector = '[' + attr + '=' + JSON.stringify(value) + ']';
        try { if (document.querySelectorAll(selector).length === 1) return selector; } catch(e) {}
      }
    }

    // Build path from element up to its root (document or shadow root)
    const path = [];
    let current = el;
    const rootNode = el.getRootNode();
    while (current && current !== document.body && current !== rootNode) {
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

  function generateSelector(el) {
    return generateSelectorForElement(el);
  }

  // Build landmark header when auto-scoped to main (shows what else is on the page)
  let landmarkHeader = '';
  if (autoScoped) {
    const LM_QUERIES = [
      { sel: 'nav, [role="navigation"]', role: 'navigation' },
      { sel: 'header, [role="banner"]', role: 'banner' },
      { sel: 'footer, [role="contentinfo"]', role: 'contentinfo' },
      { sel: 'aside, [role="complementary"]', role: 'complementary' },
      { sel: '[role="search"]', role: 'search' }
    ];
    const found = [];
    for (const { sel, role } of LM_QUERIES) {
      try {
        const count = document.querySelectorAll(sel).length;
        if (count > 0) {
          const label = document.querySelector(sel).getAttribute('aria-label');
          found.push(label ? role + ' "' + label + '"' : role);
        }
      } catch (e) {}
    }
    if (found.length > 0) {
      landmarkHeader = '# Auto-scoped to main content. Other landmarks: ' + found.join(', ') + '\\n# Use {root: "body"} for full page\\n';
    } else {
      landmarkHeader = '# Auto-scoped to main content. Use {root: "body"} for full page\\n';
    }
  }

  const yaml = landmarkHeader + (tree.children ? tree.children.map(c => renderYaml(c, '')).join('\\n') : renderYaml(tree, ''));

  // Store refs globally for later use (e.g., click by ref)
  // When preserveRefs is true, merge new refs into existing map instead of overwriting
  if (preserveRefs && window.__ariaRefs) {
    // Merge new refs into existing map
    for (const [ref, el] of refElements) {
      window.__ariaRefs.set(ref, el);
    }
  } else {
    // Default: replace the entire map
    window.__ariaRefs = refElements;
  }
  // Store ref metadata for re-resolution fallback when elements go stale
  if (preserveRefs && window.__ariaRefMeta) {
    for (const [ref, meta] of refMeta) {
      window.__ariaRefMeta.set(ref, meta);
    }
  } else {
    window.__ariaRefMeta = refMeta;
  }
  // Always update the counter so future snapshots continue from here
  window.__ariaRefCounter = refCounter;

  // Store page hash for change detection
  window.__ariaSnapshotHash = computePageHash();

  const snapshotResult = {
    tree,
    yaml,
    refs,
    truncated: limitReached,
    snapshotId: 's' + currentSnapshotId
  };
  if (autoScoped) snapshotResult.autoScoped = true;
  return snapshotResult;
})
`;

/**
 * Create an ARIA snapshot generator for accessibility tree generation
 * @param {Object} session - CDP session
 * @returns {Object} ARIA snapshot interface
 */
export function createAriaSnapshot(session, options = {}) {
  const getFrameContext = options.getFrameContext || null;
  /**
   * Generate accessibility snapshot of the page
   * @param {Object} options - Snapshot options
   * @param {string} options.root - CSS selector or role selector (e.g., "role=main") for root element
   * @param {string} options.mode - 'ai' for agent-friendly output, 'full' for complete tree
   * @param {string} options.detail - Detail level: 'summary', 'interactive', or 'full' (default: 'full')
   * @param {number} options.maxDepth - Maximum tree depth (default: 50)
   * @param {number} options.maxElements - Maximum elements to include (default: unlimited)
   * @param {boolean} options.includeText - Include static text nodes in output (default: false for ai mode)
   * @param {boolean} options.includeFrames - Include same-origin iframe content (default: false)
   * @param {boolean} options.viewportOnly - Only include elements visible in viewport (default: false)
   * @param {boolean} options.pierceShadow - Traverse into open shadow DOM trees (default: false)
   * @param {boolean} options.preserveRefs - Merge new refs into existing instead of overwriting (default: false)
   * @param {string} options.since - Snapshot ID to check against (e.g., "s1") - returns {unchanged: true} if page hasn't changed
   * @returns {Promise<Object>} Snapshot result with tree, yaml, refs, and snapshotId
   */
  async function generate(options = {}) {
    const { root = null, mode = 'ai', detail = 'full', maxDepth = 50, maxElements = 0, includeText = false, includeFrames = false, viewportOnly = false, pierceShadow = false, preserveRefs = false, since = null, internal = false } = options;

    const evalArgs = {
      expression: `(${SNAPSHOT_SCRIPT})(${JSON.stringify(root)}, ${JSON.stringify({ mode, detail, maxDepth, maxElements, includeText, includeFrames, viewportOnly, pierceShadow, preserveRefs, since, internal })})`,
      returnByValue: true,
      awaitPromise: false
    };
    if (getFrameContext) {
      const contextId = getFrameContext();
      if (contextId) evalArgs.contextId = contextId;
    }
    const result = await session.send('Runtime.evaluate', evalArgs);

    if (result.exceptionDetails) {
      throw new Error(`Snapshot generation failed: ${result.exceptionDetails.text}`);
    }

    const snapshotResult = result.result.value;

    // If page unchanged (HTTP 304-like response), return early
    if (snapshotResult.unchanged) {
      return {
        unchanged: true,
        snapshotId: snapshotResult.snapshotId,
        message: `Page unchanged since ${since}`
      };
    }

    // Handle detail levels post-processing
    if (detail === 'summary') {
      const summaryResult = generateSummaryView(snapshotResult);
      summaryResult.snapshotId = snapshotResult.snapshotId;
      return summaryResult;
    } else if (detail === 'interactive') {
      const interactiveResult = generateInteractiveView(snapshotResult);
      interactiveResult.snapshotId = snapshotResult.snapshotId;
      return interactiveResult;
    }

    return snapshotResult;
  }

  /**
   * Generate a summary view of the snapshot
   * Shows landmarks and interactive element counts
   */
  function generateSummaryView(snapshot) {
    if (!snapshot || !snapshot.tree) {
      return { ...snapshot, detail: 'summary' };
    }

    const landmarks = [];
    let totalElements = 0;
    let interactiveElements = 0;
    let viewportElements = 0;

    const LANDMARK_ROLES = ['main', 'navigation', 'banner', 'contentinfo', 'complementary', 'search', 'form', 'region'];
    const INTERACTIVE_ROLES = ['button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'option', 'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem'];

    function walkTree(node, depth = 0) {
      if (!node) return;
      totalElements++;

      const role = node.role || '';
      const isInteractive = INTERACTIVE_ROLES.includes(role);
      const isLandmark = LANDMARK_ROLES.includes(role);

      if (isInteractive) {
        interactiveElements++;
      }

      // Count all semantic (non-generic, non-staticText) nodes as viewport elements
      // since they passed isVisible() checks during tree construction
      if (role && role !== 'generic' && role !== 'staticText') {
        viewportElements++;
      }

      if (isLandmark) {
        const landmark = {
          role,
          name: node.name || null,
          interactiveCount: countInteractive(node),
          children: getChildRoles(node)
        };
        landmarks.push(landmark);
      }

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          walkTree(child, depth + 1);
        }
      }
    }

    function countInteractive(node) {
      let count = 0;
      function walk(n) {
        if (!n) return;
        if (INTERACTIVE_ROLES.includes(n.role)) count++;
        if (n.children) n.children.forEach(walk);
      }
      if (node.children) node.children.forEach(walk);
      return count;
    }

    function getChildRoles(node) {
      const roles = [];
      if (node.children) {
        for (const child of node.children) {
          if (child.role && !['staticText', 'generic'].includes(child.role)) {
            roles.push(child.role);
          }
        }
      }
      return roles.slice(0, 5); // Limit to 5
    }

    walkTree(snapshot.tree);

    // Generate summary YAML
    const yamlLines = [];
    yamlLines.push('# Snapshot Summary');
    yamlLines.push(`# Total elements: ${totalElements}`);
    yamlLines.push(`# Interactive elements: ${interactiveElements}`);
    yamlLines.push(`# Viewport elements: ${viewportElements}`);
    yamlLines.push('');
    yamlLines.push('landmarks:');
    for (const lm of landmarks) {
      yamlLines.push(`  - role: ${lm.role}`);
      if (lm.name) yamlLines.push(`    name: "${lm.name}"`);
      yamlLines.push(`    interactiveCount: ${lm.interactiveCount}`);
      if (lm.children.length > 0) {
        yamlLines.push(`    children: [${lm.children.join(', ')}]`);
      }
    }

    return {
      yaml: yamlLines.join('\n'),
      refs: snapshot.refs,
      detail: 'summary',
      stats: {
        totalElements,
        interactiveElements,
        viewportElements,
        landmarkCount: landmarks.length
      },
      landmarks
    };
  }

  /**
   * Generate an interactive-only view of the snapshot
   * Shows only actionable elements with their paths
   */
  function generateInteractiveView(snapshot) {
    if (!snapshot || !snapshot.tree) {
      return { ...snapshot, detail: 'interactive' };
    }

    const INTERACTIVE_ROLES = ['button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem'];
    const elements = [];

    function walkTree(node, path = []) {
      if (!node) return;

      const role = node.role || '';
      const isInteractive = INTERACTIVE_ROLES.includes(role);

      if (isInteractive) {
        const el = {
          role,
          name: node.name || '',
          ref: node.ref || null,
          path: path.join(' > ')
        };
        if (node.checked !== undefined) el.checked = node.checked;
        if (node.disabled) el.disabled = true;
        if (node.expanded !== undefined) el.expanded = node.expanded;
        if (node.value) el.value = node.value;
        elements.push(el);
      }

      if (node.children && Array.isArray(node.children)) {
        const newPath = role && !['staticText', 'generic'].includes(role) ? [...path, role] : path;
        for (const child of node.children) {
          walkTree(child, newPath);
        }
      }
    }

    walkTree(snapshot.tree);

    // Generate compact YAML for interactive elements
    const yamlLines = elements.map(el => {
      let line = `- ${el.role} "${el.name}"`;
      if (el.ref) line += ` [ref=${el.ref}]`;
      if (el.checked !== undefined) line += el.checked ? ' [checked]' : '';
      if (el.disabled) line += ' [disabled]';
      if (el.expanded !== undefined) line += el.expanded ? ' [expanded]' : ' [collapsed]';
      line += `: path=${el.path}`;
      return line;
    });

    return {
      yaml: yamlLines.join('\n'),
      refs: snapshot.refs,
      detail: 'interactive',
      stats: {
        interactiveCount: elements.length
      },
      elements
    };
  }

  /**
   * Get element by ref with automatic re-resolution fallback.
   * When the original element is stale (removed from DOM), attempts to find
   * a replacement element using stored metadata (CSS selector + role/name verification).
   * @param {string} ref - Element reference (e.g., 's1e1')
   * @returns {Promise<Object>} Element info with selector, box, and connection status
   */
  async function getElementByRef(ref) {
    const evalArgs = {
      expression: `(function() {
        const ref = ${JSON.stringify(ref)};
        const refsMap = window.__ariaRefs;
        const metaMap = window.__ariaRefMeta;
        let el = refsMap && refsMap.get(ref);

        // Helper to build result from a live element
        function buildResult(element, reResolved) {
          const style = window.getComputedStyle(element);
          const isVisible = style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            style.opacity !== '0';
          const rect = element.getBoundingClientRect();
          const info = {
            selector: element.id ? '#' + element.id : null,
            box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            isConnected: true,
            isVisible: isVisible && rect.width > 0 && rect.height > 0
          };
          if (reResolved) info.reResolved = true;
          return info;
        }

        // Helper to compute accessible name for verification
        function getAccessibleName(element) {
          return (
            element.getAttribute('aria-label') ||
            element.getAttribute('title') ||
            element.getAttribute('placeholder') ||
            (element.textContent ? element.textContent.replace(/\\s+/g, ' ').trim().substring(0, 200) : '') ||
            ''
          );
        }

        // Helper to get ARIA role
        function getRole(element) {
          const explicit = element.getAttribute('role');
          if (explicit) return explicit.split(/\\s+/)[0];
          const tag = element.tagName.toUpperCase();
          if (tag === 'INPUT') {
            const type = (element.type || 'text').toLowerCase();
            const inputTypeMap = {
              'checkbox': 'checkbox', 'radio': 'radio',
              'range': 'slider', 'number': 'spinbutton',
              'search': 'searchbox'
            };
            return inputTypeMap[type] || 'textbox';
          }
          const implicitMap = {
            'A': 'link', 'BUTTON': 'button',
            'SELECT': 'combobox', 'TEXTAREA': 'textbox',
            'H1': 'heading', 'H2': 'heading', 'H3': 'heading',
            'H4': 'heading', 'H5': 'heading', 'H6': 'heading',
            'NAV': 'navigation', 'MAIN': 'main', 'LI': 'listitem',
            'OPTION': 'option', 'IMG': 'img', 'DIALOG': 'dialog'
          };
          return implicitMap[tag] || null;
        }

        // 1. Element exists and is connected - return as-is (fast path)
        if (el && el.isConnected) {
          return buildResult(el, false);
        }

        // Helper to check if candidate matches role+name
        function matchesRoleAndName(candidate, meta) {
          if (!candidate || !candidate.isConnected) return false;
          const candidateRole = getRole(candidate);
          const roleMatch = !meta.role || candidateRole === meta.role;
          if (!roleMatch) return false;
          if (!meta.name) return true;
          const candidateName = getAccessibleName(candidate);
          return candidateName.toLowerCase().includes(meta.name.toLowerCase().substring(0, 100));
        }

        // Helper to resolve a CSS selector through a chain of shadow hosts
        function queryShadow(shadowHostPath, selector) {
          let root = document;
          for (const hostSel of shadowHostPath) {
            try {
              const host = root.querySelector(hostSel);
              if (!host || !host.shadowRoot) return null;
              root = host.shadowRoot;
            } catch (e) { return null; }
          }
          try { return root.querySelector(selector); } catch (e) { return null; }
        }

        // Helper to querySelectorAll through shadow hosts
        function queryShadowAll(shadowHostPath, selector) {
          let root = document;
          for (const hostSel of shadowHostPath) {
            try {
              const host = root.querySelector(hostSel);
              if (!host || !host.shadowRoot) return [];
              root = host.shadowRoot;
            } catch (e) { return []; }
          }
          try { return Array.from(root.querySelectorAll(selector)); } catch (e) { return []; }
        }

        // Helper to collect all shadow roots in the document for broad search
        function collectShadowRoots(node, roots) {
          if (node.shadowRoot) {
            roots.push(node.shadowRoot);
            collectShadowRoots(node.shadowRoot, roots);
          }
          const children = node.children || node.childNodes || [];
          for (const child of children) {
            if (child.nodeType === 1) collectShadowRoots(child, roots);
          }
          return roots;
        }

        // 2. Element is null or stale - attempt re-resolution via metadata
        if (metaMap) {
          const meta = metaMap.get(ref);
          if (meta) {
            const hasShadowPath = meta.shadowHostPath && meta.shadowHostPath.length > 0;

            // 2a. Try stored CSS selector first (fastest)
            if (meta.selector) {
              try {
                const candidate = hasShadowPath
                  ? queryShadow(meta.shadowHostPath, meta.selector)
                  : document.querySelector(meta.selector);
                if (matchesRoleAndName(candidate, meta)) {
                  if (refsMap) refsMap.set(ref, candidate);
                  return buildResult(candidate, true);
                }
              } catch (e) {
                // querySelector can throw on invalid selectors - fall through
              }
            }

            // 2b. Broader search: find by role + name
            if (meta.role) {
              const roleSelectors = {
                'link': 'a[href]',
                'button': 'button,[role="button"]',
                'heading': 'h1,h2,h3,h4,h5,h6,[role="heading"]',
                'textbox': 'input:not([type]),input[type="text"],input[type="email"],input[type="url"],input[type="search"],input[type="tel"],textarea,[role="textbox"]',
                'checkbox': 'input[type="checkbox"],[role="checkbox"]',
                'radio': 'input[type="radio"],[role="radio"]',
                'combobox': 'select,[role="combobox"],[role="listbox"]',
                'img': 'img,[role="img"]',
                'listitem': 'li,[role="listitem"]',
                'tab': '[role="tab"]',
                'menuitem': '[role="menuitem"]'
              };
              const sel = roleSelectors[meta.role] || '[role="' + meta.role + '"]';

              // Search in known shadow path first, then light DOM
              if (hasShadowPath) {
                try {
                  const candidates = queryShadowAll(meta.shadowHostPath, sel);
                  for (const candidate of candidates) {
                    if (matchesRoleAndName(candidate, meta)) {
                      if (refsMap) refsMap.set(ref, candidate);
                      return buildResult(candidate, true);
                    }
                  }
                } catch (e) {}
              }

              // Light DOM search
              try {
                const candidates = document.querySelectorAll(sel);
                for (const candidate of candidates) {
                  if (matchesRoleAndName(candidate, meta)) {
                    if (refsMap) refsMap.set(ref, candidate);
                    return buildResult(candidate, true);
                  }
                }
              } catch (e) {}

              // 2c. Last resort: search ALL shadow roots in the document
              if (!hasShadowPath) {
                try {
                  const shadowRoots = collectShadowRoots(document.body, []);
                  for (const sr of shadowRoots) {
                    const candidates = sr.querySelectorAll(sel);
                    for (const candidate of candidates) {
                      if (matchesRoleAndName(candidate, meta)) {
                        if (refsMap) refsMap.set(ref, candidate);
                        return buildResult(candidate, true);
                      }
                    }
                  }
                } catch (e) {}
              }
            }
          }
        }

        // 3. All fallbacks failed
        if (el && !el.isConnected) {
          return { stale: true, ref: ref };
        }
        return null;
      })()`,
      returnByValue: true
    };
    if (getFrameContext) {
      const contextId = getFrameContext();
      if (contextId) evalArgs.contextId = contextId;
    }
    const result = await session.send('Runtime.evaluate', evalArgs);

    return result.result.value;
  }

  return {
    generate,
    getElementByRef
  };
}
