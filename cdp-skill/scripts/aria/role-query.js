import { createQueryOutputProcessor } from './output-processor.js';

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

    const { createElementHandle } = await import('../dom/element-handle.js');
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
