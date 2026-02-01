/**
 * Navigation Executors
 * Wait, scroll, and navigation-related step executors
 *
 * EXPORTS:
 * - executeWait(elementLocator, params) → Promise<void>
 * - executeWaitForNavigation(pageController, params) → Promise<void>
 * - executeScroll(elementLocator, inputEmulator, pageController, ariaSnapshot, params) → Promise<Object>
 *
 * DEPENDENCIES:
 * - ../dom/index.js: createWaitExecutor
 * - ../utils.js: elementNotFoundError
 */

import { createWaitExecutor } from '../dom/index.js';
import { elementNotFoundError } from '../utils.js';

/**
 * Execute a wait step
 */
export async function executeWait(elementLocator, params) {
  const waitExecutor = createWaitExecutor(elementLocator.session, elementLocator);
  await waitExecutor.execute(params);
}

/**
 * Execute a waitForNavigation step (FR-003)
 * Waits for page navigation to complete
 * @param {Object} pageController - Page controller
 * @param {boolean|Object} params - Wait parameters
 * @returns {Promise<void>}
 */
export async function executeWaitForNavigation(pageController, params) {
  const options = params === true ? {} : params;
  const timeout = options.timeout || 30000;
  const waitUntil = options.waitUntil || 'load';

  const session = pageController.session;
  const startTime = Date.now();

  // Poll for page ready state
  await new Promise((resolve, reject) => {
    const checkNavigation = async () => {
      if (Date.now() - startTime >= timeout) {
        reject(new Error(`Navigation timeout after ${timeout}ms`));
        return;
      }

      try {
        const result = await session.send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true
        });
        const readyState = result.result.value;

        if (waitUntil === 'commit') {
          resolve();
          return;
        }

        if (waitUntil === 'domcontentloaded' && (readyState === 'interactive' || readyState === 'complete')) {
          resolve();
          return;
        }

        if ((waitUntil === 'load' || waitUntil === 'networkidle') && readyState === 'complete') {
          resolve();
          return;
        }
      } catch {
        // Page might be navigating, continue polling
      }

      setTimeout(checkNavigation, 100);
    };

    checkNavigation();
  });
}

/**
 * Execute a scroll step
 */
export async function executeScroll(elementLocator, inputEmulator, pageController, ariaSnapshot, params) {
  // Helper to scroll to element by ref
  async function scrollToRef(ref) {
    if (!ariaSnapshot) {
      throw new Error('ariaSnapshot is required for ref-based scroll');
    }
    const refInfo = await ariaSnapshot.getElementByRef(ref);
    if (!refInfo) {
      throw elementNotFoundError(`ref:${ref}`, 0);
    }
    if (refInfo.stale) {
      throw new Error(`Element ref:${ref} is no longer attached to the DOM. Run 'snapshot' again to get fresh refs.`);
    }
    // Scroll to element using its coordinates
    await pageController.session.send('Runtime.evaluate', {
      expression: `
        (function() {
          const el = window.__ariaRefs && window.__ariaRefs.get(${JSON.stringify(ref)});
          if (el && el.scrollIntoView) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        })()
      `
    });
  }

  if (typeof params === 'string') {
    // Direction-based scroll
    switch (params) {
      case 'top':
        await pageController.session.send('Runtime.evaluate', {
          expression: 'window.scrollTo(0, 0)'
        });
        break;
      case 'bottom':
        await pageController.session.send('Runtime.evaluate', {
          expression: 'window.scrollTo(0, document.body.scrollHeight)'
        });
        break;
      case 'up':
        await pageController.session.send('Runtime.evaluate', {
          expression: 'window.scrollBy(0, -300)'
        });
        break;
      case 'down':
        await pageController.session.send('Runtime.evaluate', {
          expression: 'window.scrollBy(0, 300)'
        });
        break;
      default:
        // Check if it looks like a ref (e.g., "e1", "e12")
        if (/^e\d+$/.test(params)) {
          await scrollToRef(params);
        } else {
          // Treat as selector - scroll element into view
          const el = await elementLocator.querySelector(params);
          if (!el) {
            throw elementNotFoundError(params, 0);
          }
          await el.scrollIntoView();
          await el.dispose();
        }
    }
  } else if (params && typeof params === 'object') {
    // Check for ref first
    const ref = params.ref || (params.selector && /^e\d+$/.test(params.selector) ? params.selector : null);
    if (ref) {
      await scrollToRef(ref);
    } else if (params.selector) {
      // Scroll to element
      const el = await elementLocator.querySelector(params.selector);
      if (!el) {
        throw elementNotFoundError(params.selector, 0);
      }
      await el.scrollIntoView();
      await el.dispose();
    } else if (params.deltaY !== undefined || params.deltaX !== undefined) {
      // Scroll by delta using JavaScript (more reliable than CDP mouse wheel events)
      await pageController.session.send('Runtime.evaluate', {
        expression: `window.scrollBy(${params.deltaX || 0}, ${params.deltaY || 0})`
      });
    } else if (params.y !== undefined) {
      // Scroll to position
      await pageController.session.send('Runtime.evaluate', {
        expression: `window.scrollTo(${params.x || 0}, ${params.y})`
      });
    }
  }

  // Return current scroll position
  const posResult = await pageController.session.send('Runtime.evaluate', {
    expression: '({ scrollX: window.scrollX, scrollY: window.scrollY })',
    returnByValue: true
  });

  return posResult.result.value;
}
