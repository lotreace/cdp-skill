/**
 * Context Helpers
 * Action and command context building for diff summaries and failure debugging
 *
 * EXPORTS:
 * - buildActionContext(action, params, context) → string - Describes what action was taken
 * - buildCommandContext(steps) → string - Summarizes multi-step commands
 * - captureFailureContext(deps) → Object - Gathers debug info on failure
 * - STEP_TYPES - Array of valid step type names
 * - VISUAL_ACTIONS - Actions that trigger auto-screenshot
 *
 * DEPENDENCIES: None (pure functions)
 */

export const STEP_TYPES = [
  'goto', 'wait', 'click', 'fill', 'fillForm', 'press', 'query', 'queryAll',
  'inspect', 'scroll', 'console', 'pdf', 'eval', 'snapshot', 'snapshotSearch',
  'hover', 'viewport', 'cookies', 'back', 'forward', 'waitForNavigation', 'listTabs',
  'closeTab', 'openTab', 'type', 'select', 'selectOption', 'validate', 'submit',
  'assert', 'switchToFrame', 'switchToMainFrame', 'listFrames', 'drag', 'formState',
  'extract', 'getDom', 'getBox', 'fillActive', 'refAt', 'elementsAt', 'elementsNear',
  'reload', 'pageFunction', 'poll', 'pipeline', 'writeSiteManifest'
];

// Visual actions that trigger auto-screenshot
// Actions that should capture a screenshot - anything that interacts with or queries the visible page
export const VISUAL_ACTIONS = [
  'goto', 'reload', 'click', 'fill', 'fillForm', 'type', 'hover', 'press', 'scroll', 'wait',  // interactions
  'snapshot', 'snapshotSearch', 'query', 'queryAll', 'inspect', 'eval', 'extract', 'formState',  // queries
  'drag', 'select', 'selectOption', 'validate', 'submit', 'assert',  // other page interactions
  'openTab'  // navigation actions - behave like goto for auto-snapshot
];

/**
 * Build action context string for diff summary
 * Creates a human-readable description of what action was taken
 * @param {string} action - Action type (click, scroll, etc.)
 * @param {*} params - Action parameters
 * @param {Object} context - Page context (scroll, focused, etc.)
 * @returns {string} Action context description
 */
export function buildActionContext(action, params, context) {
  switch (action) {
    case 'scroll': {
      const { scroll } = context || {};
      if (scroll?.percent === 100) return 'Scrolled to bottom';
      if (scroll?.percent === 0) return 'Scrolled to top';
      if (scroll?.percent > 0) return `Scrolled to ${scroll.percent}%`;
      return 'Scrolled';
    }
    case 'click': {
      // Try to describe what was clicked
      if (typeof params === 'string') return `Clicked ${params}`;
      if (params?.selector) return `Clicked ${params.selector}`;
      if (params?.ref) return `Clicked [ref=${params.ref}]`;
      if (params?.text) return `Clicked "${params.text}"`;
      return 'Clicked element';
    }
    case 'hover': {
      if (typeof params === 'string') return `Hovered over ${params}`;
      if (params?.selector) return `Hovered over ${params.selector}`;
      return 'Hovered over element';
    }
    case 'fill':
    case 'type': {
      if (params?.selector) return `Typed in ${params.selector}`;
      if (params?.label) return `Typed in "${params.label}"`;
      return 'Typed in input';
    }
    case 'press': {
      return `Pressed ${params || 'key'}`;
    }
    default:
      return '';
  }
}

/**
 * Build command context string for diff summary
 * Summarizes what a multi-step command did for the diff output
 * @param {Array<Object>} steps - Array of step definitions
 * @returns {string} Human-readable summary of the command
 */
export function buildCommandContext(steps) {
  const actions = steps.map(step => {
    const action = STEP_TYPES.find(type => step[type] !== undefined);
    return action;
  }).filter(Boolean);

  // Return a summary based on the primary action(s)
  if (actions.includes('scroll')) return 'Scrolled';
  if (actions.includes('click')) return 'Clicked';
  if (actions.includes('hover')) return 'Hovered';
  if (actions.includes('fill') || actions.includes('type')) return 'Typed';
  if (actions.includes('press')) return 'Pressed key';
  if (actions.includes('goto') || actions.includes('openTab')) return 'Navigated';
  if (actions.includes('select')) return 'Selected';
  if (actions.includes('drag')) return 'Dragged';

  // Default: list the actions
  if (actions.length === 1) {
    return actions[0].charAt(0).toUpperCase() + actions[0].slice(1);
  }
  return '';
}

/**
 * Capture failure context for debugging
 * Gathers page info when a step fails to aid debugging
 * @param {Object} deps - Dependencies (pageController, etc.)
 * @param {Object} [options] - Optional context options
 * @param {string} [options.failedSelector] - The selector that failed to find
 * @param {string} [options.failedText] - The text that failed to match
 * @returns {Promise<Object>} Context information
 */
export async function captureFailureContext(deps, options = {}) {
  const { pageController } = deps;
  const { failedSelector, failedText } = options;
  const context = {};

  try {
    // Get page title
    const titleResult = await pageController.session.send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true
    });
    context.title = titleResult.result.value || '';
  } catch {
    context.title = null;
  }

  try {
    // Get current URL
    const urlResult = await pageController.session.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true
    });
    context.url = urlResult.result.value || '';
  } catch {
    context.url = null;
  }

  try {
    // Get scroll position
    const scrollResult = await pageController.session.send('Runtime.evaluate', {
      expression: `({
        x: window.scrollX || document.documentElement.scrollLeft,
        y: window.scrollY || document.documentElement.scrollTop,
        maxY: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight
      })`,
      returnByValue: true
    });
    const scroll = scrollResult.result.value;
    context.scrollPosition = {
      x: scroll.x,
      y: scroll.y,
      maxY: scroll.maxY,
      percentY: scroll.maxY > 0 ? Math.round((scroll.y / scroll.maxY) * 100) : 0
    };
  } catch {
    context.scrollPosition = null;
  }

  try {
    // Get visible buttons with refs (limit 8)
    const buttonsResult = await pageController.session.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'));
          return buttons
            .filter(b => {
              const rect = b.getBoundingClientRect();
              const style = window.getComputedStyle(b);
              return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            })
            .slice(0, 8)
            .map(b => {
              const text = (b.textContent || b.value || '').trim().substring(0, 50);
              let selector = b.id ? '#' + b.id : null;
              if (!selector && b.className && typeof b.className === 'string') {
                selector = b.tagName.toLowerCase() + '.' + b.className.split(' ')[0];
              }
              if (!selector) {
                selector = b.tagName.toLowerCase();
              }
              // Check if element has a ref
              let ref = null;
              if (window.__ariaRefs) {
                for (const [r, el] of window.__ariaRefs) {
                  if (el === b) { ref = r; break; }
                }
              }
              return { text, selector, ref };
            });
        })()
      `,
      returnByValue: true
    });
    context.visibleButtons = buttonsResult.result.value || [];
  } catch {
    context.visibleButtons = [];
  }

  try {
    // Get visible links (limit 5)
    const linksResult = await pageController.session.send('Runtime.evaluate', {
      expression: `
        (function() {
          const links = Array.from(document.querySelectorAll('a[href]'));
          return links
            .filter(a => {
              const rect = a.getBoundingClientRect();
              const style = window.getComputedStyle(a);
              return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            })
            .slice(0, 5)
            .map(a => ({
              text: (a.textContent || '').trim().substring(0, 50),
              href: a.href ? a.href.substring(0, 100) : ''
            }));
        })()
      `,
      returnByValue: true
    });
    context.visibleLinks = linksResult.result.value || [];
  } catch {
    context.visibleLinks = [];
  }

  try {
    // Get any visible error messages or alerts
    const errorsResult = await pageController.session.send('Runtime.evaluate', {
      expression: `
        (function() {
          const errorSelectors = [
            '.error', '.alert', '.warning', '.message',
            '[role="alert"]', '[role="status"]',
            '.toast', '.notification'
          ];
          const errors = [];
          for (const sel of errorSelectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              if (rect.width > 0 && rect.height > 0 && style.display !== 'none') {
                const text = (el.textContent || '').trim().substring(0, 100);
                if (text) errors.push(text);
              }
            }
            if (errors.length >= 3) break;
          }
          return errors.slice(0, 3);
        })()
      `,
      returnByValue: true
    });
    context.visibleErrors = errorsResult.result.value || [];
  } catch {
    context.visibleErrors = [];
  }

  // If a selector or text was provided, find near matches
  if (failedSelector || failedText) {
    try {
      const searchTerm = failedText || failedSelector;
      const nearMatchesResult = await pageController.session.send('Runtime.evaluate', {
        expression: `
          (function() {
            const searchTerm = ${JSON.stringify(searchTerm)}.toLowerCase();
            const candidates = [];

            // Search for elements with similar text or attributes
            const allElements = document.querySelectorAll('button, a, input, [role="button"], [role="link"], [role="tab"], [role="menuitem"]');

            for (const el of allElements) {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              if (rect.width === 0 || rect.height === 0 || style.display === 'none' || style.visibility === 'hidden') continue;

              const text = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
              const textLower = text.toLowerCase();

              // Calculate similarity score
              let score = 0;
              if (textLower === searchTerm) score = 100;
              else if (textLower.includes(searchTerm)) score = 80;
              else if (searchTerm.includes(textLower) && textLower.length > 2) score = 70;
              else {
                // Levenshtein-like partial match
                const words = searchTerm.split(/\\s+/);
                for (const word of words) {
                  if (word.length > 2 && textLower.includes(word)) score = Math.max(score, 50);
                }
              }

              if (score > 0) {
                let selector = el.id ? '#' + el.id : null;
                if (!selector && el.className && typeof el.className === 'string') {
                  selector = el.tagName.toLowerCase() + '.' + el.className.split(' ')[0];
                }
                if (!selector) selector = el.tagName.toLowerCase();

                // Check for ref
                let ref = null;
                if (window.__ariaRefs) {
                  for (const [r, refEl] of window.__ariaRefs) {
                    if (refEl === el) { ref = r; break; }
                  }
                }

                candidates.push({
                  text: text.substring(0, 50),
                  selector,
                  ref,
                  score
                });
              }
            }

            // Sort by score and return top 5
            candidates.sort((a, b) => b.score - a.score);
            return candidates.slice(0, 5);
          })()
        `,
        returnByValue: true
      });
      context.nearMatches = nearMatchesResult.result.value || [];
    } catch {
      context.nearMatches = [];
    }
  }

  return context;
}
