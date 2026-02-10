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
