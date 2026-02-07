/**
 * Interaction Executors
 * Click, hover, and drag step executors
 *
 * EXPORTS:
 * - executeClick(elementLocator, inputEmulator, ariaSnapshot, params) → Promise<Object>
 * - executeHover(elementLocator, inputEmulator, ariaSnapshot, params) → Promise<Object>
 * - executeDrag(elementLocator, inputEmulator, pageController, ariaSnapshot, params) → Promise<Object>
 *
 * DEPENDENCIES:
 * - ../dom/index.js: createClickExecutor, createActionabilityChecker
 * - ../utils.js: elementNotFoundError, sleep, resetInputState, releaseObject
 */

import { createClickExecutor, createActionabilityChecker } from '../dom/index.js';
import { elementNotFoundError, sleep, resetInputState, releaseObject } from '../utils.js';

const SCROLL_STRATEGIES = ['center', 'end', 'start', 'nearest'];

export async function executeClick(elementLocator, inputEmulator, ariaSnapshot, params) {
  // Delegate to ClickExecutor for improved click handling with JS fallback
  const clickExecutor = createClickExecutor(
    elementLocator.session,
    elementLocator,
    inputEmulator,
    ariaSnapshot
  );
  return clickExecutor.execute(params);
}

export async function clickWithVerification(elementLocator, inputEmulator, x, y, targetObjectId) {
  const session = elementLocator.session;

  // Setup event listener on target before clicking
  await session.send('Runtime.callFunctionOn', {
    objectId: targetObjectId,
    functionDeclaration: `function() {
      this.__clickReceived = false;
      this.__clickHandler = () => { this.__clickReceived = true; };
      this.addEventListener('click', this.__clickHandler, { once: true });
    }`
  });

  // Perform click
  await inputEmulator.click(x, y);
  await sleep(50);

  // Check if target received the click
  const verifyResult = await session.send('Runtime.callFunctionOn', {
    objectId: targetObjectId,
    functionDeclaration: `function() {
      this.removeEventListener('click', this.__clickHandler);
      const received = this.__clickReceived;
      delete this.__clickReceived;
      delete this.__clickHandler;
      return received;
    }`,
    returnByValue: true
  });

  return {
    clicked: true,
    targetReceived: verifyResult.result.value === true
  };
}

/**
 * Execute a hover step - moves mouse over an element to trigger hover events
 * Uses Playwright-style auto-waiting for element to be visible and stable
 * Feature 13: Supports captureResult to detect new visible elements after hover
 */
export async function executeHover(elementLocator, inputEmulator, ariaSnapshot, params) {
  const selector = typeof params === 'string' ? params : params.selector;
  let ref = typeof params === 'object' ? params.ref : null;
  const duration = typeof params === 'object' ? (params.duration || 0) : 0;

  // Detect if string selector looks like a ref (e.g., "s1e1", "s2e12")
  // This allows {"hover": "s1e1"} to work the same as {"hover": {"ref": "s1e1"}}
  if (!ref && selector && /^s\d+e\d+$/.test(selector)) {
    ref = selector;
  }
  const force = typeof params === 'object' && params.force === true;
  const timeout = typeof params === 'object' ? (params.timeout || 10000) : 10000; // Reduced from 30s to 10s
  const captureResult = typeof params === 'object' && params.captureResult === true;

  const session = elementLocator.session;
  let visibleElementsBefore = [];

  // Feature 13: Capture visible elements before hover
  if (captureResult) {
    try {
      const beforeResult = await session.send('Runtime.evaluate', {
        expression: `
          (function() {
            const selectors = [
              '[role="menu"]', '[role="listbox"]', '[role="tooltip"]',
              '.dropdown', '.menu', '.popup', '.tooltip', '.popover',
              '[class*="dropdown"]', '[class*="menu"]', '[class*="tooltip"]'
            ];
            const visible = new Set();

            for (const sel of selectors) {
              const elements = document.querySelectorAll(sel);
              for (const el of elements) {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                if (rect.width > 0 && rect.height > 0 &&
                    style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                  // Capture same structure as after capture for proper comparison
                  const items = el.querySelectorAll('[role="menuitem"], li, a, button');
                  const texts = [];
                  for (const item of items) {
                    const text = (item.textContent || '').trim();
                    if (text && text.length < 100) texts.push(text);
                  }
                  if (texts.length > 0) {
                    visible.add(JSON.stringify({
                      type: el.getAttribute('role') || sel.replace(/[\\[\\]"*=]/g, ''),
                      items: texts.slice(0, 10)
                    }));
                  } else {
                    const ownText = (el.textContent || '').trim();
                    if (ownText && ownText.length < 200) {
                      visible.add(JSON.stringify({
                        type: el.getAttribute('role') || sel.replace(/[\\[\\]"*=]/g, ''),
                        text: ownText
                      }));
                    }
                  }
                }
              }
            }
            return Array.from(visible);
          })()
        `,
        returnByValue: true
      });
      visibleElementsBefore = beforeResult.result.value || [];
    } catch {
      // Ignore capture errors
    }
  }

  // Handle hover by ref
  if (ref && ariaSnapshot) {
    const refInfo = await ariaSnapshot.getElementByRef(ref);
    if (!refInfo) {
      throw elementNotFoundError(`ref:${ref}`, 0);
    }
    const x = refInfo.box.x + refInfo.box.width / 2;
    const y = refInfo.box.y + refInfo.box.height / 2;
    await inputEmulator.hover(x, y, { duration });

    if (captureResult) {
      await sleep(100); // Wait for hover effects
      return await captureHoverResult(session, visibleElementsBefore);
    }
    return { hovered: true };
  }

  // Use Playwright-style auto-waiting for element to be actionable
  // Hover requires: visible, stable
  const actionabilityChecker = createActionabilityChecker(elementLocator.session);
  const waitResult = await actionabilityChecker.waitForActionable(selector, 'hover', {
    timeout,
    force
  });

  if (!waitResult.success) {
    throw new Error(`Element not actionable: ${waitResult.error}`);
  }

  // Get clickable point for hovering
  const point = await actionabilityChecker.getClickablePoint(waitResult.objectId);
  if (!point) {
    throw new Error('Could not determine hover point for element');
  }

  await inputEmulator.hover(point.x, point.y, { duration });

  // Release objectId to prevent memory leak
  try {
    await releaseObject(session, waitResult.objectId);
  } catch { /* ignore cleanup errors */ }

  // Build result with autoForced flag if applicable
  const result = { hovered: true };
  if (waitResult.autoForced) {
    result.autoForced = true;
  }

  if (captureResult) {
    await sleep(100); // Wait for hover effects
    const captured = await captureHoverResult(session, visibleElementsBefore);
    return { ...result, ...captured };
  }
  return result;
}

/**
 * Capture elements that appeared after hover (Feature 13)
 * @param {Object} session - CDP session
 * @param {Array} visibleBefore - Elements visible before hover
 * @returns {Promise<Object>} Hover result with appeared content
 */
export async function captureHoverResult(session, visibleBefore) {
  try {
    const afterResult = await session.send('Runtime.evaluate', {
      expression: `
        (function() {
          const selectors = [
            '[role="menu"]', '[role="listbox"]', '[role="tooltip"]', '[role="menuitem"]',
            '.dropdown', '.menu', '.popup', '.tooltip', '.popover',
            '[class*="dropdown"]', '[class*="menu"]', '[class*="tooltip"]'
          ];
          const visibleNow = [];

          for (const sel of selectors) {
            const elements = document.querySelectorAll(sel);
            for (const el of elements) {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              if (rect.width > 0 && rect.height > 0 &&
                  style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                // Get text content of menu items
                const items = el.querySelectorAll('[role="menuitem"], li, a, button');
                const texts = [];
                for (const item of items) {
                  const text = (item.textContent || '').trim();
                  if (text && text.length < 100) texts.push(text);
                }
                if (texts.length > 0) {
                  visibleNow.push({
                    type: el.getAttribute('role') || sel.replace(/[\\[\\]"*=]/g, ''),
                    items: texts.slice(0, 10)
                  });
                } else {
                  const ownText = (el.textContent || '').trim();
                  if (ownText && ownText.length < 200) {
                    visibleNow.push({
                      type: el.getAttribute('role') || sel.replace(/[\\[\\]"*=]/g, ''),
                      text: ownText
                    });
                  }
                }
              }
            }
          }
          return visibleNow;
        })()
      `,
      returnByValue: true
    });

    const visibleAfter = afterResult.result.value || [];

    // Filter to only new elements (not in before list)
    // visibleBefore contains JSON strings, visibleAfter contains objects
    const beforeSet = new Set(visibleBefore);
    const appeared = visibleAfter.filter(item => !beforeSet.has(JSON.stringify(item)));

    // Return format matching SKILL.md documentation
    return {
      hovered: true,
      capturedResult: {
        visibleElements: appeared.map(item => ({
          selector: item.type,
          text: item.text || (item.items ? item.items.join(', ') : ''),
          visible: true,
          ...(item.items ? { itemCount: item.items.length } : {})
        }))
      }
    };
  } catch {
    return { hovered: true, capturedResult: { visibleElements: [] } };
  }
}

/**
 * Execute a drag operation from source to target
 * @param {Object} elementLocator - Element locator instance
 * @param {Object} inputEmulator - Input emulator instance
 * @param {Object} pageController - Page controller instance
 * @param {Object} params - Drag parameters
 * @returns {Promise<Object>} Drag result
 */
export async function executeDrag(elementLocator, inputEmulator, pageController, ariaSnapshot, params) {
  const { source, target, steps = 10, delay = 0, method = 'auto' } = params;
  const session = elementLocator.session;

  // Helper to get element bounding box by ref
  async function getRefBox(ref) {
    if (!ariaSnapshot) {
      throw new Error('ariaSnapshot is required for ref-based drag');
    }
    const refInfo = await ariaSnapshot.getElementByRef(ref);
    if (!refInfo) {
      throw elementNotFoundError(`ref:${ref}`, 0);
    }
    if (refInfo.stale) {
      throw new Error(`Element ref:${ref} is no longer attached to the DOM. Run 'snapshot' again to get fresh refs.`);
    }
    return refInfo.box;
  }

  // Helper to get element bounding box in current frame context
  async function getElementBox(selector) {
    const evalParams = {
      expression: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()
      `,
      returnByValue: true
    };

    const contextId = pageController.getFrameContext();
    if (contextId) evalParams.contextId = contextId;

    const result = await session.send('Runtime.evaluate', evalParams);
    if (result.exceptionDetails) {
      throw new Error(`Selector error: ${result.exceptionDetails.text}`);
    }
    return result.result.value;
  }

  // Helper to resolve selector/ref to box with optional offsets
  async function resolveToBox(spec) {
    // Direct coordinates
    if (typeof spec === 'object' && typeof spec.x === 'number' && typeof spec.y === 'number') {
      return { x: spec.x, y: spec.y, width: 0, height: 0, offsetX: 0, offsetY: 0 };
    }

    // Ref object with optional offsets: {"ref": "s1e1", "offsetX": 10}
    if (typeof spec === 'object' && spec.ref) {
      const box = await getRefBox(spec.ref);
      return {
        ...box,
        offsetX: spec.offsetX || 0,
        offsetY: spec.offsetY || 0
      };
    }

    // Selector object: {"selector": "#draggable"}
    if (typeof spec === 'object' && spec.selector) {
      const box = await getElementBox(spec.selector);
      if (!box) {
        throw elementNotFoundError(spec.selector, 0);
      }
      return { ...box, offsetX: 0, offsetY: 0 };
    }

    // String - could be selector or ref
    const selectorOrRef = spec;

    // Check if it looks like a ref (e.g., "s1e1", "s2e12")
    if (/^s\d+e\d+$/.test(selectorOrRef)) {
      const box = await getRefBox(selectorOrRef);
      return { ...box, offsetX: 0, offsetY: 0 };
    }

    // Treat as CSS selector
    const box = await getElementBox(selectorOrRef);
    if (!box) {
      throw elementNotFoundError(selectorOrRef, 0);
    }
    return { ...box, offsetX: 0, offsetY: 0 };
  }

  // Helper to resolve selector string for JS execution
  function getSelectorExpression(spec) {
    if (typeof spec === 'string') {
      if (/^s\d+e\d+$/.test(spec)) {
        return `window.__ariaRefs && window.__ariaRefs.get(${JSON.stringify(spec)})`;
      }
      return `document.querySelector(${JSON.stringify(spec)})`;
    }
    if (typeof spec === 'object' && spec.ref) {
      return `window.__ariaRefs && window.__ariaRefs.get(${JSON.stringify(spec.ref)})`;
    }
    if (typeof spec === 'object' && spec.selector) {
      return `document.querySelector(${JSON.stringify(spec.selector)})`;
    }
    return null;
  }

  // Get source coordinates (center + offset)
  const sourceBox = await resolveToBox(source);
  const sourceX = sourceBox.x + sourceBox.width / 2 + (sourceBox.offsetX || 0);
  const sourceY = sourceBox.y + sourceBox.height / 2 + (sourceBox.offsetY || 0);

  // Get target coordinates (center + offset)
  const targetBox = await resolveToBox(target);
  const targetX = targetBox.x + targetBox.width / 2 + (targetBox.offsetX || 0);
  const targetY = targetBox.y + targetBox.height / 2 + (targetBox.offsetY || 0);

  // Try JavaScript-based drag (more reliable than CDP mouse events)
  const sourceSelector = getSelectorExpression(source);
  const targetSelector = getSelectorExpression(target);

  const jsDragResult = await session.send('Runtime.evaluate', {
    expression: `
      (function() {
        const sourceEl = ${sourceSelector || 'null'};
        const targetEl = ${targetSelector || 'null'};
        const sourceX = ${sourceX};
        const sourceY = ${sourceY};
        const targetX = ${targetX};
        const targetY = ${targetY};
        const steps = ${steps};
        const method = ${JSON.stringify(method)};

        // Check if source is an input[type=range] (slider)
        if (sourceEl && sourceEl.tagName === 'INPUT' && sourceEl.type === 'range') {
          const rect = sourceEl.getBoundingClientRect();
          const percent = Math.max(0, Math.min(1, (targetX - rect.left) / rect.width));
          const min = parseFloat(sourceEl.min) || 0;
          const max = parseFloat(sourceEl.max) || 100;
          const newValue = min + percent * (max - min);
          sourceEl.value = newValue;
          sourceEl.dispatchEvent(new Event('input', { bubbles: true }));
          sourceEl.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, method: 'range-input', value: newValue };
        }

        function doMouseDrag() {
          const sourceElAtPoint = sourceEl || document.elementFromPoint(sourceX, sourceY);
          if (!sourceElAtPoint) {
            return { success: false, error: 'No element at source coordinates' };
          }

          sourceElAtPoint.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true, cancelable: true,
            clientX: sourceX, clientY: sourceY, button: 0, buttons: 1
          }));

          const deltaX = (targetX - sourceX) / steps;
          const deltaY = (targetY - sourceY) / steps;

          for (let i = 1; i <= steps; i++) {
            const currentX = sourceX + deltaX * i;
            const currentY = sourceY + deltaY * i;
            const elAtPoint = document.elementFromPoint(currentX, currentY) || sourceElAtPoint;
            elAtPoint.dispatchEvent(new MouseEvent('mousemove', {
              bubbles: true, cancelable: true,
              clientX: currentX, clientY: currentY, button: 0, buttons: 1
            }));
          }

          const targetElAtPoint = document.elementFromPoint(targetX, targetY) || sourceElAtPoint;
          targetElAtPoint.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true, cancelable: true,
            clientX: targetX, clientY: targetY, button: 0, buttons: 0
          }));

          return { success: true, method: 'mouse-events' };
        }

        function doHtml5Drag() {
          if (!sourceEl || !targetEl) {
            return { success: false, error: 'HTML5 DnD requires both source and target elements' };
          }
          try {
            const dataTransfer = new DataTransfer();
            dataTransfer.effectAllowed = 'all';
            dataTransfer.dropEffect = 'move';

            sourceEl.dispatchEvent(new DragEvent('dragstart', {
              bubbles: true, cancelable: true, dataTransfer, clientX: sourceX, clientY: sourceY
            }));
            sourceEl.dispatchEvent(new DragEvent('drag', {
              bubbles: true, cancelable: true, dataTransfer, clientX: sourceX, clientY: sourceY
            }));
            targetEl.dispatchEvent(new DragEvent('dragenter', {
              bubbles: true, cancelable: true, dataTransfer, clientX: targetX, clientY: targetY
            }));
            targetEl.dispatchEvent(new DragEvent('dragover', {
              bubbles: true, cancelable: true, dataTransfer, clientX: targetX, clientY: targetY
            }));
            targetEl.dispatchEvent(new DragEvent('drop', {
              bubbles: true, cancelable: true, dataTransfer, clientX: targetX, clientY: targetY
            }));
            sourceEl.dispatchEvent(new DragEvent('dragend', {
              bubbles: true, cancelable: true, dataTransfer, clientX: targetX, clientY: targetY
            }));

            return { success: true, method: 'html5-dnd' };
          } catch (e) {
            return { success: false, error: e.message };
          }
        }

        if (method === 'mouse') return doMouseDrag();
        if (method === 'html5') return doHtml5Drag();

        // auto: try mouse first (works for jQuery UI, sortable lists), then HTML5 DnD
        const mouseResult = doMouseDrag();
        if (mouseResult.success) return mouseResult;

        if (sourceEl && targetEl) {
          const html5Result = doHtml5Drag();
          if (html5Result.success) return html5Result;
        }

        return mouseResult;
      })()
    `,
    returnByValue: true,
    awaitPromise: false
  });

  const dragResult = jsDragResult.result?.value;

  if (dragResult?.success) {
    return {
      dragged: true,
      method: dragResult.method,
      source: { x: sourceX, y: sourceY },
      target: { x: targetX, y: targetY },
      steps,
      value: dragResult.value // For range inputs
    };
  }

  // If JS drag failed, return error
  return {
    dragged: false,
    error: dragResult?.error || 'JavaScript drag simulation failed',
    source: { x: sourceX, y: sourceY },
    target: { x: targetX, y: targetY }
  };
}
