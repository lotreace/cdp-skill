/**
 * Snapshot Diffing and Context Capture
 * Compares ARIA snapshots and captures page context for auto-snapshot feature
 */

/**
 * Create a snapshot differ for comparing ARIA trees
 * @returns {Object} Snapshot differ interface
 */
export function createSnapshotDiffer() {
  /**
   * Parse YAML snapshot into a map of refs to node info
   * @param {string} yaml - YAML snapshot string
   * @returns {Map<string, Object>} Map of ref to node info
   */
  function parseSnapshot(yaml) {
    const refMap = new Map();
    if (!yaml) return refMap;

    const lines = yaml.split('\n');
    for (const line of lines) {
      // Match lines like: - button "Submit" [ref=f0s1e1]
      // Or: - heading "Title" [level=1] [ref=f0s2e3]
      // Ref format: f{frameId}s{snapshotId}e{elementNumber} where frameId can be a number or [name]
      const refMatch = line.match(/\[ref=(f(?:\d+|\[[^\]]+\])s\d+e\d+)\]/);
      if (refMatch) {
        const ref = refMatch[1];

        // Extract role and name
        const roleMatch = line.match(/- (\w+)/);
        const nameMatch = line.match(/"([^"]+)"/);

        // Extract state attributes like [checked], [expanded], [disabled], [selected], etc.
        const states = {};
        const checkedMatch = line.match(/\[checked\]/);
        const expandedMatch = line.match(/\[expanded(?:=(true|false))?\]/);
        const disabledMatch = line.match(/\[disabled\]/);
        const levelMatch = line.match(/\[level=(\d+)\]/);
        const selectedMatch = line.match(/\[selected\]/);
        const pressedMatch = line.match(/\[pressed(?:=(true|false|mixed))?\]/);
        const requiredMatch = line.match(/\[required\]/);
        const readonlyMatch = line.match(/\[readonly\]/);
        const focusedMatch = line.match(/\[focused\]/);

        if (checkedMatch) states.checked = true;
        if (expandedMatch) states.expanded = expandedMatch[1] !== 'false';
        if (disabledMatch) states.disabled = true;
        if (levelMatch) states.level = parseInt(levelMatch[1], 10);
        if (selectedMatch) states.selected = true;
        if (pressedMatch) states.pressed = pressedMatch[1] || true;
        if (requiredMatch) states.required = true;
        if (readonlyMatch) states.readonly = true;
        if (focusedMatch) states.focused = true;

        refMap.set(ref, {
          ref,
          role: roleMatch ? roleMatch[1] : null,
          name: nameMatch ? nameMatch[1] : null,
          states,
          line: line.trim()
        });
      }
    }

    return refMap;
  }

  /**
   * Compute diff between two snapshots
   * @param {string} before - YAML snapshot before action
   * @param {string} after - YAML snapshot after action
   * @returns {Object} Diff result with added, removed, changed arrays
   */
  function computeDiff(before, after) {
    const beforeMap = parseSnapshot(before);
    const afterMap = parseSnapshot(after);

    const added = [];
    const removed = [];
    const changed = [];

    // Find added and changed elements
    for (const [ref, afterNode] of afterMap) {
      const beforeNode = beforeMap.get(ref);

      if (!beforeNode) {
        // New element
        added.push(afterNode.line);
      } else {
        // Check for state changes
        const beforeStates = beforeNode.states;
        const afterStates = afterNode.states;

        for (const [key, afterValue] of Object.entries(afterStates)) {
          if (beforeStates[key] !== afterValue) {
            changed.push({
              ref,
              field: key,
              from: beforeStates[key] ?? null,
              to: afterValue
            });
          }
        }

        // Check for removed states
        for (const [key, beforeValue] of Object.entries(beforeStates)) {
          if (!(key in afterStates)) {
            changed.push({
              ref,
              field: key,
              from: beforeValue,
              to: null
            });
          }
        }
      }
    }

    // Find removed elements
    for (const [ref, beforeNode] of beforeMap) {
      if (!afterMap.has(ref)) {
        removed.push(beforeNode.line);
      }
    }

    return { added, removed, changed };
  }

  /**
   * Extract ref from a line like "- link \"text\" [ref=f0s1e42]"
   */
  function extractRef(line) {
    const match = line.match(/\[ref=(f(?:\d+|\[[^\]]+\])s\d+e\d+)\]/);
    return match ? match[1] : null;
  }

  /**
   * Format refs as a compact list
   * e.g., [f0s1e1, f0s1e2, f0s1e5] -> "f0s1e1, f0s1e2, f0s1e5"
   */
  function formatRefs(lines, maxRefs = 10) {
    const refs = lines.map(extractRef).filter(Boolean);
    if (refs.length === 0) return '';
    if (refs.length <= maxRefs) {
      return refs.join(', ');
    }
    // Show first few and count
    return refs.slice(0, maxRefs).join(', ') + `, +${refs.length - maxRefs} more`;
  }

  /**
   * Format diff for output, including summary
   * @param {Object} diff - Diff result from computeDiff
   * @param {Object} options - Format options
   * @param {string} options.actionContext - Action context like "Scrolled down", "Clicked button"
   * @param {number} options.maxItems - Max items per array (default 10)
   * @returns {Object} Formatted diff with summary
   */
  function formatDiff(diff, options = {}) {
    const { maxItems = 10, actionContext = '' } = options;

    // Build summary
    const parts = [];

    // Add action context first if provided
    if (actionContext) {
      parts.push(actionContext);
    }

    if (diff.added.length > 0) {
      const refs = formatRefs(diff.added);
      parts.push(`${diff.added.length} added (${refs})`);
    }

    if (diff.removed.length > 0) {
      const refs = formatRefs(diff.removed);
      parts.push(`${diff.removed.length} removed (${refs})`);
    }

    if (diff.changed.length > 0) {
      // Group changes by type
      const expandedChanges = diff.changed.filter(c => c.field === 'expanded');
      const checkedChanges = diff.changed.filter(c => c.field === 'checked');

      if (expandedChanges.length > 0) {
        const refs = expandedChanges.map(c => c.ref).join(', ');
        parts.push(`${expandedChanges.length} expanded/collapsed (${refs})`);
      }
      if (checkedChanges.length > 0) {
        const refs = checkedChanges.map(c => c.ref).join(', ');
        parts.push(`${checkedChanges.length} toggled (${refs})`);
      }
    }

    return {
      summary: parts.join('. ') + (parts.length > 0 ? '.' : 'No significant changes.'),
      added: diff.added.slice(0, maxItems),
      removed: diff.removed.slice(0, maxItems),
      changed: diff.changed.slice(0, maxItems)
    };
  }

  /**
   * Check if diff has significant changes worth reporting
   * @param {Object} diff - Diff result from computeDiff
   * @returns {boolean} True if there are significant changes
   */
  function hasSignificantChanges(diff) {
    return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
  }

  return {
    computeDiff,
    formatDiff,
    hasSignificantChanges,
    parseSnapshot
  };
}

/**
 * Create a context capture for gathering page state
 * @param {Object} session - CDP session
 * @returns {Object} Context capture interface
 */
export function createContextCapture(session) {
  /**
   * Capture current page context (scroll, focus, modal, URL, title)
   * @returns {Promise<Object>} Context object
   */
  async function captureContext() {
    try {
      const result = await session.send('Runtime.evaluate', {
        expression: `(function() {
          // Scroll position and percentage (y only - horizontal scroll rarely relevant)
          const scrollY = window.scrollY;
          const maxScrollY = document.documentElement.scrollHeight - window.innerHeight;
          const scrollPercent = maxScrollY > 0 ? Math.round((scrollY / maxScrollY) * 100) : 0;

          // Viewport dimensions
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;

          // Active element details (only if non-body)
          let activeElement = null;
          const focused = document.activeElement;
          if (focused && focused !== document.body && focused !== document.documentElement) {
            const tag = focused.tagName;
            const rect = focused.getBoundingClientRect();

            // Build selector
            let selector = null;
            if (focused.id) {
              selector = '#' + CSS.escape(focused.id);
            } else if (focused.name) {
              selector = '[name="' + focused.name + '"]';
            } else if (focused.className && typeof focused.className === 'string') {
              const cls = focused.className.trim().split(/\\s+/)[0];
              if (cls) selector = tag.toLowerCase() + '.' + CSS.escape(cls);
            }
            if (!selector) {
              selector = tag.toLowerCase();
            }

            // Determine if editable
            const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
            const isContentEditable = focused.isContentEditable;
            const editable = isInput || isContentEditable;

            activeElement = {
              tag: tag,
              selector: selector,
              box: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              },
              editable: editable
            };

            // Add type for inputs
            if (tag === 'INPUT') {
              activeElement.type = focused.type || 'text';
            }

            // Add value for form elements
            if (isInput && focused.value !== undefined) {
              activeElement.value = focused.value;
            }

            // Add placeholder if present
            if (focused.placeholder) {
              activeElement.placeholder = focused.placeholder;
            }

            // Add aria-label if present
            const ariaLabel = focused.getAttribute('aria-label');
            if (ariaLabel) {
              activeElement.label = ariaLabel;
            }
          }

          // Modal detection
          let modalTitle = null;
          const dialog = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]');
          if (dialog) {
            const style = window.getComputedStyle(dialog);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              modalTitle = dialog.getAttribute('aria-label') ||
                          dialog.querySelector('h1, h2, h3, [role="heading"]')?.textContent?.trim() ||
                          'Dialog';
            }
          }

          // Build result - only include activeElement/modal when present
          const context = {
            url: window.location.href,
            title: document.title,
            scroll: { y: scrollY, percent: scrollPercent },
            viewport: { width: viewportWidth, height: viewportHeight }
          };
          if (activeElement) context.activeElement = activeElement;
          if (modalTitle) context.modal = modalTitle;
          return context;
        })()`,
        returnByValue: true
      });

      // Handle case where result.value is undefined (can happen during navigation)
      if (!result.result?.value) {
        return {
          url: null,
          title: null,
          scroll: { y: 0, percent: 0 },
          viewport: { width: 0, height: 0 }
        };
      }
      return result.result.value;
    } catch (err) {
      // Return minimal context on error
      return {
        url: null,
        title: null,
        scroll: { y: 0, percent: 0 },
        viewport: { width: 0, height: 0 },
        error: err.message
      };
    }
  }

  /**
   * Check if URL change represents a navigation (pathname changed)
   * @param {string} urlBefore - URL before action
   * @param {string} urlAfter - URL after action
   * @returns {boolean} True if navigated to different path
   */
  function isNavigation(urlBefore, urlAfter) {
    if (!urlBefore || !urlAfter) return true;

    try {
      const before = new URL(urlBefore);
      const after = new URL(urlAfter);

      // Same origin, same pathname, only hash changed = not navigation
      if (before.origin === after.origin &&
          before.pathname === after.pathname &&
          before.search === after.search) {
        return false;
      }

      return true;
    } catch {
      // If URL parsing fails, assume navigation
      return urlBefore !== urlAfter;
    }
  }

  return {
    captureContext,
    isNavigation
  };
}
