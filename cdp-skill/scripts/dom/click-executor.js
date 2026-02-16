/**
 * Click Executor
 * High-level click operations with actionability checking and fallbacks
 *
 * EXPORTS:
 * - createClickExecutor(session, elementLocator, inputEmulator, ariaSnapshot?) → ClickExecutor
 *   Methods: execute, clickByText, clickWithMultiSelector
 *
 * DEPENDENCIES:
 * - ./actionability.js: createActionabilityChecker
 * - ../utils.js: sleep, elementNotFoundError, getCurrentUrl, getElementAtPoint, detectNavigation, releaseObject
 */

import { createActionabilityChecker } from './actionability.js';
import { createLazyResolver } from './LazyResolver.js';
import {
  sleep,
  elementNotFoundError,
  getCurrentUrl,
  getElementAtPoint,
  detectNavigation,
  releaseObject,
  isContextDestroyed
} from '../utils.js';

/**
 * Create a click executor for handling click operations
 * @param {Object} session - CDP session
 * @param {Object} elementLocator - Element locator instance
 * @param {Object} inputEmulator - Input emulator instance
 * @param {Object} [ariaSnapshot] - Optional ARIA snapshot instance
 * @returns {Object} Click executor interface
 */
export function createClickExecutor(session, elementLocator, inputEmulator, ariaSnapshot = null) {
  if (!session) throw new Error('CDP session is required');
  if (!elementLocator) throw new Error('Element locator is required');
  if (!inputEmulator) throw new Error('Input emulator is required');

  const getFrameContext = elementLocator.getFrameContext || null;
  const actionabilityChecker = createActionabilityChecker(session, { getFrameContext });
  const lazyResolver = createLazyResolver(session, { getFrameContext });

  /** Build Runtime.evaluate params with frame context when in an iframe. */
  function frameEvalParams(expression, returnByValue = true) {
    const params = { expression, returnByValue };
    if (getFrameContext) {
      const contextId = getFrameContext();
      if (contextId) params.contextId = contextId;
    }
    return params;
  }

  function calculateVisibleCenter(box, viewport = null) {
    let visibleBox = { ...box };

    if (viewport) {
      visibleBox.x = Math.max(box.x, 0);
      visibleBox.y = Math.max(box.y, 0);
      const right = Math.min(box.x + box.width, viewport.width);
      const bottom = Math.min(box.y + box.height, viewport.height);
      visibleBox.width = Math.max(0, right - visibleBox.x);
      visibleBox.height = Math.max(0, bottom - visibleBox.y);
    }

    return {
      x: visibleBox.x + visibleBox.width / 2,
      y: visibleBox.y + visibleBox.height / 2
    };
  }

  async function getViewportBounds() {
    const result = await session.send('Runtime.evaluate', frameEvalParams(`({
        width: window.innerWidth || document.documentElement.clientWidth,
        height: window.innerHeight || document.documentElement.clientHeight
      })`, true));
    return result.result.value;
  }

  /**
   * Detect content changes after an action using MutationObserver
   * @param {Object} [options] - Detection options
   * @param {number} [options.timeout=5000] - Max wait time in ms
   * @param {number} [options.stableTime=500] - Time with no changes to consider stable
   * @param {boolean} [options.checkNavigation=true] - Also check for URL changes
   * @returns {Promise<Object>} Content change result
   */
  async function detectContentChange(options = {}) {
    const {
      timeout = 5000,
      stableTime = 500,
      checkNavigation = true
    } = options;

    const urlBefore = checkNavigation ? await getCurrentUrl(session) : null;

    const detectExpr = `
        (function() {
          return new Promise((resolve) => {
            const timeout = ${timeout};
            const stableTime = ${stableTime};
            const startTime = Date.now();

            let changeCount = 0;
            let lastChangeTime = startTime;
            let stableCheckTimer = null;

            const observer = new MutationObserver((mutations) => {
              changeCount += mutations.length;
              lastChangeTime = Date.now();

              // Reset stable timer on each change
              if (stableCheckTimer) {
                clearTimeout(stableCheckTimer);
              }

              stableCheckTimer = setTimeout(() => {
                cleanup('contentChange');
              }, stableTime);
            });

            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true
            });

            const timeoutId = setTimeout(() => {
              cleanup(changeCount > 0 ? 'contentChange' : 'none');
            }, timeout);

            function cleanup(type) {
              observer.disconnect();
              clearTimeout(timeoutId);
              if (stableCheckTimer) clearTimeout(stableCheckTimer);

              resolve({
                type,
                changeCount,
                duration: Date.now() - startTime
              });
            }

            // Initial check: if no changes for stableTime, resolve as 'none'
            stableCheckTimer = setTimeout(() => {
              if (changeCount === 0) {
                cleanup('none');
              }
            }, stableTime);
          });
        })()
      `;
    const detectParams = frameEvalParams(detectExpr, true);
    detectParams.awaitPromise = true;
    const result = await session.send('Runtime.evaluate', detectParams);

    const changeResult = result.result.value || { type: 'none', changeCount: 0 };

    // Check for navigation
    if (checkNavigation) {
      const urlAfter = await getCurrentUrl(session);
      if (urlAfter !== urlBefore) {
        return {
          type: 'navigation',
          newUrl: urlAfter,
          previousUrl: urlBefore,
          changeCount: changeResult.changeCount,
          duration: changeResult.duration
        };
      }
    }

    return changeResult;
  }

  /**
   * Get information about what element is intercepting a click at given coordinates
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {string} [targetObjectId] - Optional object ID of expected target
   * @returns {Promise<Object|null>} Interceptor info or null if no interception
   */
  async function getInterceptorInfo(x, y, targetObjectId = null) {
    const expression = `
      (function() {
        const x = ${x};
        const y = ${y};
        const el = document.elementFromPoint(x, y);
        if (!el) return null;

        function getSelector(element) {
          if (element.id) return '#' + element.id;
          let selector = element.tagName.toLowerCase();
          if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\\s+/).slice(0, 2);
            if (classes.length > 0 && classes[0]) {
              selector += '.' + classes.join('.');
            }
          }
          return selector;
        }

        function getText(element) {
          const text = element.textContent || '';
          return text.trim().substring(0, 100);
        }

        function isOverlay(element) {
          const style = window.getComputedStyle(element);
          const position = style.position;
          const zIndex = parseInt(style.zIndex) || 0;
          return (position === 'fixed' || position === 'absolute') && zIndex > 0;
        }

        function getCommonOverlayType(element) {
          const text = getText(element).toLowerCase();
          const classes = (element.className || '').toLowerCase();
          const id = (element.id || '').toLowerCase();

          if (text.includes('cookie') || classes.includes('cookie') || id.includes('cookie')) {
            return 'cookie-banner';
          }
          if (text.includes('accept') || classes.includes('consent') || id.includes('consent')) {
            return 'consent-dialog';
          }
          if (classes.includes('modal') || id.includes('modal') || element.getAttribute('role') === 'dialog') {
            return 'modal';
          }
          if (classes.includes('overlay') || id.includes('overlay')) {
            return 'overlay';
          }
          if (classes.includes('popup') || id.includes('popup')) {
            return 'popup';
          }
          if (classes.includes('toast') || id.includes('toast') || classes.includes('notification')) {
            return 'notification';
          }
          return null;
        }

        const rect = el.getBoundingClientRect();
        const overlayType = getCommonOverlayType(el);

        return {
          selector: getSelector(el),
          text: getText(el),
          tagName: el.tagName.toLowerCase(),
          isOverlay: isOverlay(el),
          overlayType,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      })()
    `;

    const result = await session.send('Runtime.evaluate', frameEvalParams(expression, true));

    if (result.exceptionDetails || !result.result.value) {
      return null;
    }

    const interceptor = result.result.value;

    // If we have a target objectId, check if the interceptor is the same element
    if (targetObjectId) {
      const checkResult = await session.send('Runtime.callFunctionOn', {
        objectId: targetObjectId,
        functionDeclaration: `function(x, y) {
          const topEl = document.elementFromPoint(x, y);
          return topEl === this || this.contains(topEl);
        }`,
        arguments: [{ value: x }, { value: y }],
        returnByValue: true
      });

      if (checkResult.result.value === true) {
        // The target element is at the click point, no interception
        return null;
      }
    }

    return interceptor;
  }

  async function executeJsClick(objectId) {
    const result = await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        if (this.disabled) {
          return { success: false, reason: 'element is disabled' };
        }
        if (typeof this.focus === 'function') {
          this.focus();
        }
        this.click();
        return { success: true, targetReceived: true };
      }`,
      returnByValue: true
    });

    const value = result.result.value || {};
    if (!value.success) {
      throw new Error(`JS click failed: ${value.reason || 'unknown error'}`);
    }

    return { targetReceived: true };
  }

  /**
   * Browser-side lazy resolution script that always re-resolves refs from metadata.
   * This eliminates stale element errors by never relying on cached DOM references.
   */
  const LAZY_RESOLVE_SCRIPT = `
    function lazyResolveRef(ref) {
      const meta = window.__ariaRefMeta && window.__ariaRefMeta.get(ref);
      if (!meta) return null;

      // Helper: check if candidate matches role+name from metadata
      function matchesRoleAndName(candidate) {
        if (!candidate || !candidate.isConnected) return false;
        if (!meta.role) return true;

        // Get element's role
        const explicit = candidate.getAttribute('role');
        let candidateRole = explicit ? explicit.split(/\\s+/)[0] : null;
        if (!candidateRole) {
          const tag = candidate.tagName.toUpperCase();
          const implicitMap = {
            'A': 'link', 'BUTTON': 'button', 'SELECT': 'combobox', 'TEXTAREA': 'textbox',
            'H1': 'heading', 'H2': 'heading', 'H3': 'heading', 'H4': 'heading', 'H5': 'heading', 'H6': 'heading',
            'NAV': 'navigation', 'MAIN': 'main', 'LI': 'listitem', 'OPTION': 'option'
          };
          if (tag === 'INPUT') {
            const type = (candidate.type || 'text').toLowerCase();
            const typeMap = { 'checkbox': 'checkbox', 'radio': 'radio', 'range': 'slider', 'number': 'spinbutton', 'search': 'searchbox' };
            candidateRole = typeMap[type] || 'textbox';
          } else {
            candidateRole = implicitMap[tag] || null;
          }
        }

        const roleMatch = !meta.role || candidateRole === meta.role;
        if (!roleMatch) return false;
        if (!meta.name) return true;

        // Check accessible name
        const candidateName = (
          candidate.getAttribute('aria-label') ||
          candidate.getAttribute('title') ||
          candidate.getAttribute('placeholder') ||
          (candidate.textContent || '').replace(/\\s+/g, ' ').trim().substring(0, 200) ||
          ''
        );
        return candidateName.toLowerCase().includes(meta.name.toLowerCase().substring(0, 100));
      }

      // Helper: resolve through shadow DOM
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

      // Strategy 1: Try selector (with shadow path if applicable)
      if (meta.selector) {
        const hasShadow = meta.shadowHostPath && meta.shadowHostPath.length > 0;
        const candidate = hasShadow
          ? queryShadow(meta.shadowHostPath, meta.selector)
          : document.querySelector(meta.selector);
        if (matchesRoleAndName(candidate)) return candidate;
      }

      // Strategy 2: Role+name search
      if (meta.role) {
        const ROLE_SELECTORS = {
          button: 'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]',
          textbox: 'input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="tel"], input[type="url"], textarea, [role="textbox"]',
          checkbox: 'input[type="checkbox"], [role="checkbox"]',
          link: 'a[href], [role="link"]',
          heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
          combobox: 'select, [role="combobox"]',
          radio: 'input[type="radio"], [role="radio"]',
          tab: '[role="tab"]',
          menuitem: '[role="menuitem"]',
          option: 'option, [role="option"]',
          slider: 'input[type="range"], [role="slider"]',
          spinbutton: 'input[type="number"], [role="spinbutton"]',
          searchbox: 'input[type="search"], [role="searchbox"]',
          switch: '[role="switch"]'
        };
        const selectorString = ROLE_SELECTORS[meta.role] || '[role="' + meta.role + '"]';
        const elements = document.querySelectorAll(selectorString);
        for (const el of elements) {
          if (matchesRoleAndName(el)) return el;
        }

        // Strategy 3: Search in shadow roots via tree walk (avoids querySelectorAll('*'))
        function searchShadowRoots(node) {
          if (node.shadowRoot) {
            const els = node.shadowRoot.querySelectorAll(selectorString);
            for (const el of els) {
              if (matchesRoleAndName(el)) return el;
            }
            const found = searchShadowRoots(node.shadowRoot);
            if (found) return found;
          }
          const children = node.children || [];
          for (const child of children) {
            const found = searchShadowRoots(child);
            if (found) return found;
          }
          return null;
        }
        const shadowResult = searchShadowRoots(document.body);
        if (shadowResult) return shadowResult;
      }

      return null;
    }
  `;

  async function executeJsClickOnRef(ref) {
    const result = await session.send('Runtime.evaluate', frameEvalParams(`
        (function() {
          ${LAZY_RESOLVE_SCRIPT}

          const el = lazyResolveRef(${JSON.stringify(ref)});

          if (!el) {
            return { success: false, reason: 'ref could not be resolved - element not found' };
          }
          if (!el.isConnected) {
            return { success: false, reason: 'element is no longer attached to DOM' };
          }
          if (el.disabled) {
            return { success: false, reason: 'element is disabled' };
          }
          if (typeof el.focus === 'function') el.focus();
          el.click();
          return { success: true };
        })()
      `, true));

    const value = result.result.value || {};
    if (!value.success) {
      throw new Error(`JS click on ref failed: ${value.reason || 'unknown error'}`);
    }
  }

  async function clickWithVerification(x, y, targetObjectId) {
    // Use pointerdown for verification instead of click.
    // React (and similar frameworks) re-render elements between mousedown and click,
    // destroying the original DOM node and its event listeners. pointerdown fires
    // synchronously at the start of the interaction, before any re-render.
    // Also listen on document (capture phase) as a fallback — if the click target
    // is the element or a descendant, count it as received.
    await session.send('Runtime.callFunctionOn', {
      objectId: targetObjectId,
      functionDeclaration: `function() {
        this.__clickReceived = false;
        const self = this;
        this.__ptrHandler = (e) => { self.__clickReceived = true; };
        this.addEventListener('pointerdown', this.__ptrHandler, { once: true });
        // Document-level capture fallback: catch clicks that bubble from descendants
        this.__docHandler = (e) => {
          if (self.contains(e.target) || e.target === self) {
            self.__clickReceived = true;
          }
        };
        document.addEventListener('pointerdown', this.__docHandler, { capture: true, once: true });
      }`
    });

    try {
      await inputEmulator.click(x, y);
      await sleep(50);

      let verifyResult;
      try {
        verifyResult = await session.send('Runtime.callFunctionOn', {
          objectId: targetObjectId,
          functionDeclaration: `function() {
            this.removeEventListener('pointerdown', this.__ptrHandler);
            document.removeEventListener('pointerdown', this.__docHandler, { capture: true });
            const received = this.__clickReceived;
            delete this.__clickReceived;
            delete this.__ptrHandler;
            delete this.__docHandler;
            return received;
          }`,
          returnByValue: true
        });
      } catch (verifyError) {
        // Context destroyed during verification means click likely triggered navigation
        // Treat as successful click with navigation
        if (isContextDestroyed(null, verifyError)) {
          return { targetReceived: true, contextDestroyed: true };
        }
        throw verifyError;
      }

      const targetReceived = verifyResult.result.value === true;
      const result = { targetReceived };

      // If click didn't reach target, get interceptor info
      if (!targetReceived) {
        const interceptor = await getInterceptorInfo(x, y, targetObjectId);
        if (interceptor) {
          result.interceptedBy = interceptor;
        }
      }

      return result;
    } finally {
      // Always cleanup event listeners, even if click fails
      try {
        await session.send('Runtime.callFunctionOn', {
          objectId: targetObjectId,
          functionDeclaration: `function() {
            this.removeEventListener('pointerdown', this.__ptrHandler);
            document.removeEventListener('pointerdown', this.__docHandler, { capture: true });
            delete this.__clickReceived;
            delete this.__ptrHandler;
            delete this.__docHandler;
          }`,
          returnByValue: true
        });
      } catch (cleanupError) {
        // Ignore cleanup errors (element may be gone)
      }
    }
  }

  async function addNavigationAndDebugInfo(result, urlBeforeClick, debugData, opts) {
    const { waitForNavigation = false, navigationTimeout = 100, debug = false, waitAfter = false, waitAfterOptions = {} } = opts;

    if (waitForNavigation) {
      const navResult = await detectNavigation(session, urlBeforeClick, navigationTimeout);
      result.navigated = navResult.navigated;
      if (navResult.newUrl) {
        result.newUrl = navResult.newUrl;
      }
    }

    // Auto-wait after click
    if (waitAfter) {
      const changeResult = await detectContentChange({
        timeout: waitAfterOptions.timeout || 5000,
        stableTime: waitAfterOptions.stableTime || 500,
        checkNavigation: true
      });
      result.waitResult = changeResult;
    }

    if (debug && debugData) {
      result.debug = {
        clickedAt: debugData.point,
        elementHit: debugData.elementAtPoint
      };
    }

    return result;
  }

  async function clickAtCoordinates(x, y, opts = {}) {
    const { debug = false, waitForNavigation = false, navigationTimeout = 100, waitAfter = false, waitAfterOptions = {} } = opts;

    const urlBeforeClick = await getCurrentUrl(session);

    let elementAtPoint = null;
    if (debug) {
      elementAtPoint = await getElementAtPoint(session, x, y);
    }

    await inputEmulator.click(x, y);

    const result = {
      clicked: true,
      method: 'cdp',
      coordinates: { x, y }
    };

    return addNavigationAndDebugInfo(result, urlBeforeClick, { point: { x, y }, elementAtPoint }, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
  }

  let clickVerifyCounter = 0;

  async function clickWithVerificationByRef(ref, x, y) {
    // Use pointerdown for verification instead of click.
    // React re-renders between mousedown and click, destroying the original DOM node.
    // pointerdown fires synchronously before any re-render.
    // Also uses document-level capture as fallback for descendant hits.
    // LAZY RESOLUTION: Always resolve ref from metadata, never rely on cached element.
    const verifyKey = `__clickVerify_${++clickVerifyCounter}`;

    await session.send('Runtime.evaluate', frameEvalParams(`
        (function() {
          ${LAZY_RESOLVE_SCRIPT}

          const el = lazyResolveRef(${JSON.stringify(ref)});
          if (el && el.isConnected) {
            // Store resolved element for verification phase (unique key per click)
            window[${JSON.stringify(verifyKey)}] = el;
            el.__clickReceived = false;
            el.__ptrHandler = () => { el.__clickReceived = true; };
            el.addEventListener('pointerdown', el.__ptrHandler, { once: true });
            el.__docHandler = (e) => {
              if (el.contains(e.target) || e.target === el) {
                el.__clickReceived = true;
              }
            };
            document.addEventListener('pointerdown', el.__docHandler, { capture: true, once: true });
          }
        })()
      `, false));

    try {
      await inputEmulator.click(x, y);
      await sleep(50);
    } catch (clickError) {
      // Cleanup listeners on click failure
      try {
        await session.send('Runtime.evaluate', frameEvalParams(`
            (function() {
              const el = window[${JSON.stringify(verifyKey)}];
              delete window[${JSON.stringify(verifyKey)}];
              if (!el) return;
              if (el.__ptrHandler) el.removeEventListener('pointerdown', el.__ptrHandler);
              if (el.__docHandler) document.removeEventListener('pointerdown', el.__docHandler, { capture: true });
              delete el.__clickReceived;
              delete el.__ptrHandler;
              delete el.__docHandler;
            })()
          `, true));
      } catch { /* ignore cleanup errors */ }
      throw clickError;
    }

    // Check if pointerdown was received
    let verifyResult;
    try {
      verifyResult = await session.send('Runtime.evaluate', frameEvalParams(`
          (function() {
            const el = window[${JSON.stringify(verifyKey)}];
            delete window[${JSON.stringify(verifyKey)}];
            if (!el) return { targetReceived: false, reason: 'element not found' };
            if (el.__ptrHandler) el.removeEventListener('pointerdown', el.__ptrHandler);
            if (el.__docHandler) document.removeEventListener('pointerdown', el.__docHandler, { capture: true });
            const received = el.__clickReceived;
            delete el.__clickReceived;
            delete el.__ptrHandler;
            delete el.__docHandler;
            return { targetReceived: received };
          })()
        `, true));
    } catch (verifyError) {
      // Context destroyed during verification means click likely triggered navigation
      // Treat as successful click with navigation
      if (isContextDestroyed(null, verifyError)) {
        return { targetReceived: true, contextDestroyed: true };
      }
      throw verifyError;
    }

    return verifyResult.result.value || { targetReceived: false };
  }

  async function clickByRef(ref, jsClick = false, opts = {}) {
    const { force = false, debug = false, nativeOnly = false, waitForNavigation, navigationTimeout = 100, waitAfter = false, waitAfterOptions = {} } = opts;

    // LAZY RESOLUTION: Always resolve ref from metadata, never rely on cached element
    // This eliminates stale element errors entirely
    const resolved = await lazyResolver.resolveRef(ref);
    if (!resolved) {
      throw elementNotFoundError(`ref:${ref}`, 0);
    }

    // Get visibility info using the resolved element, then release the objectId
    let visibilityResult;
    try {
      visibilityResult = await session.send('Runtime.callFunctionOn', {
        objectId: resolved.objectId,
        functionDeclaration: `function() {
          const style = window.getComputedStyle(this);
          const rect = this.getBoundingClientRect();
          return {
            isVisible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0,
            box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          };
        }`,
        returnByValue: true
      });
    } finally {
      await releaseObject(session, resolved.objectId);
    }

    const refInfo = {
      box: visibilityResult.result?.value?.box || resolved.box,
      isVisible: visibilityResult.result?.value?.isVisible ?? true,
      resolvedBy: resolved.resolvedBy
    };

    if (!force && refInfo.isVisible === false) {
      // Special case: hidden radio/checkbox inputs — try to click associated label
      // LAZY RESOLUTION: Always resolve ref from metadata
      const labelResult = await session.send('Runtime.evaluate', frameEvalParams(`
        (function() {
          ${LAZY_RESOLVE_SCRIPT}

          const el = lazyResolveRef(${JSON.stringify(ref)});
          if (!el) return { found: false };

          const tag = el.tagName.toUpperCase();
          const type = (el.type || '').toLowerCase();
          if (tag === 'INPUT' && (type === 'radio' || type === 'checkbox')) {
            // Look for associated label
            let label = null;
            if (el.id) {
              label = document.querySelector('label[for="' + el.id + '"]');
            }
            if (!label) {
              label = el.closest('label');
            }

            if (label) {
              const rect = label.getBoundingClientRect();
              const style = window.getComputedStyle(label);
              const isVisible = style.display !== 'none' &&
                                style.visibility !== 'hidden' &&
                                style.opacity !== '0' &&
                                rect.width > 0 && rect.height > 0;

              if (isVisible) {
                return {
                  found: true,
                  clickedLabel: true,
                  box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                };
              }
            }
          }
          return { found: false };
        })()
      `, true));

      const labelInfo = labelResult.result?.value || { found: false };
      if (labelInfo.found && labelInfo.clickedLabel) {
        // Click the label instead
        const labelCenter = calculateVisibleCenter(labelInfo.box);
        const urlBefore = await getCurrentUrl(session);
        await inputEmulator.click(labelCenter.x, labelCenter.y);
        const urlAfter = await getCurrentUrl(session);
        const navigated = urlAfter !== urlBefore;

        return {
          clicked: true,
          method: 'label-proxy',
          ref,
          warning: `Element ref:${ref} is a hidden radio/checkbox input. Clicked associated label instead.`,
          navigated
        };
      }

      // No label found or element isn't radio/checkbox — return original error
      return {
        clicked: false,
        warning: `Element ref:${ref} exists but is not visible. It may be hidden or have zero dimensions.`
      };
    }

    // If element is outside viewport (e.g., inside an unscrolled container), scroll it into view first
    // LAZY RESOLUTION: Always resolve ref from metadata for scroll
    const box = refInfo.box;
    const vp = await getViewportBounds().catch(() => null) || { width: 1280, height: 720 };
    if (box && (box.x < 0 || box.y < 0 || box.x + box.width > vp.width || box.y + box.height > vp.height)) {
      try {
        await session.send('Runtime.evaluate', frameEvalParams(`
          (function() {
            ${LAZY_RESOLVE_SCRIPT}
            const el = lazyResolveRef(${JSON.stringify(ref)});
            if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          })()
        `, true));
        await sleep(100);
        // Re-fetch element info after scroll using lazy resolution
        const updatedResult = await lazyResolver.resolveRef(ref);
        if (updatedResult) {
          if (updatedResult.box) {
            refInfo.box = updatedResult.box;
          }
          if (updatedResult.objectId) {
            await releaseObject(session, updatedResult.objectId);
          }
        }
      } catch {
        // Scroll failed — proceed with original coordinates
      }
    }

    const urlBeforeClick = await getCurrentUrl(session);

    const point = calculateVisibleCenter(refInfo.box);

    let elementAtPoint = null;
    if (debug) {
      elementAtPoint = await getElementAtPoint(session, point.x, point.y);
    }

    let usedMethod = 'cdp';
    let targetReceived = true;

    // Check for navigation helper
    async function checkNavigation() {
      try {
        const urlAfterClick = await getCurrentUrl(session);
        return urlAfterClick !== urlBeforeClick;
      } catch {
        // If we can't get URL, page likely navigated
        return true;
      }
    }

    let navigated = false;

    if (jsClick) {
      // User explicitly requested JS click
      try {
        await executeJsClickOnRef(ref);
        usedMethod = 'jsClick';
      } catch (e) {
        // If jsClick fails, check if navigation happened - if so, click worked
        navigated = await checkNavigation();
        if (navigated) {
          usedMethod = 'jsClick';
          targetReceived = true;
        } else {
          throw e; // Re-throw if no navigation - genuine failure
        }
      }
    } else {
      // Perform CDP click with verification
      const verifyResult = await clickWithVerificationByRef(ref, point.x, point.y);
      targetReceived = verifyResult.targetReceived;

      if (!targetReceived && !nativeOnly) {
        // Give SPA routers / async navigations time to commit URL changes
        // before checking - frameworks like React Router use async state updates
        await sleep(50);
        // Check if navigation already happened before trying jsClick fallback
        // If page navigated, the CDP click did work, just the verification failed
        // because the element listener was destroyed during navigation
        navigated = await checkNavigation();
        if (!navigated) {
          // No navigation, so CDP click genuinely didn't reach target - fallback to jsClick
          try {
            await executeJsClickOnRef(ref);
            usedMethod = 'jsClick-auto';
          } catch (e) {
            // jsClick failed - check if navigation happened during the attempt
            navigated = await checkNavigation();
            if (navigated) {
              usedMethod = 'jsClick-auto';
              targetReceived = true;
            } else {
              throw e; // Re-throw if no navigation - genuine failure
            }
          }
        } else {
          // Navigation happened - CDP click worked, verification just failed due to page change
          targetReceived = true; // Mark as successful since navigation implies click worked
        }
      }
    }

    // Check for navigation (if not already checked)
    if (!navigated) {
      navigated = await checkNavigation();
    }

    const result = {
      clicked: true,
      method: usedMethod,
      ref,
      navigated,
      targetReceived
    };

    if (usedMethod === 'jsClick-auto') {
      result.cdpAttempted = true;
    }

    if (navigated) {
      try {
        result.newUrl = await getCurrentUrl(session);
      } catch {
        // Page still navigating
      }
    }

    // Auto-wait after click
    if (waitAfter) {
      const changeResult = await detectContentChange({
        timeout: waitAfterOptions.timeout || 5000,
        stableTime: waitAfterOptions.stableTime || 500,
        checkNavigation: true
      });
      result.waitResult = changeResult;
    }

    if (debug) {
      result.debug = {
        clickedAt: point,
        elementHit: elementAtPoint
      };
    }

    return result;
  }

  async function tryJsClickFallback(selector, opts = {}) {
    const { urlBeforeClick, waitForNavigation = false, navigationTimeout = 100, debug = false, waitAfter = false, waitAfterOptions = {}, fallbackReason = 'CDP click failed' } = opts;

    const element = await elementLocator.findElement(selector);
    if (!element) {
      throw elementNotFoundError(selector, 0);
    }

    try {
      const result = await executeJsClick(element._handle.objectId);
      await element._handle.dispose();

      const clickResult = {
        clicked: true,
        method: 'jsClick-fallback',
        fallbackReason,
        ...result
      };

      return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
    } catch (e) {
      await element._handle.dispose();
      throw e;
    }
  }

  async function clickBySelector(selector, opts = {}) {
    const {
      jsClick = false,
      nativeOnly = false,  // Skip jsClick fallback even if CDP click not received
      force = false,
      debug = false,
      waitForNavigation = false,
      navigationTimeout = 100,
      timeout = 5000,  // Reduced from 30s to 5s for faster failure
      waitAfter = false,
      waitAfterOptions = {}
    } = opts;

    const urlBeforeClick = await getCurrentUrl(session);

    const waitResult = await actionabilityChecker.waitForActionable(selector, 'click', {
      timeout,
      force
    });

    if (!waitResult.success) {
      throw new Error(waitResult.error || `Element not found: ${selector}`);
    }

    const objectId = waitResult.objectId;

    try {
      // User explicitly requested JS click
      if (jsClick) {
        const result = await executeJsClick(objectId);
        const clickResult = { clicked: true, method: 'jsClick', ...result };
        return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
      }

      const point = await actionabilityChecker.getClickablePoint(objectId);
      if (!point) {
        throw new Error('Could not determine click point for element');
      }

      // Auto-fallback to JS click for zero-size elements (hidden inputs, etc.)
      if (point.rect.width === 0 || point.rect.height === 0) {
        const result = await executeJsClick(objectId);
        const clickResult = { clicked: true, method: 'jsClick', reason: 'zero-size-element', ...result };
        return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
      }

      const viewportBox = await getViewportBounds();
      const clippedPoint = calculateVisibleCenter(point.rect, viewportBox);

      let elementAtPoint = null;
      if (debug) {
        elementAtPoint = await getElementAtPoint(session, clippedPoint.x, clippedPoint.y);
      }

      // Always verify CDP click and auto-fallback to jsClick if not received
      const verifyResult = await clickWithVerification(clippedPoint.x, clippedPoint.y, objectId);

      if (!verifyResult.targetReceived && !nativeOnly) {
        // CDP click didn't reach target, fallback to jsClick
        const jsResult = await executeJsClick(objectId);
        const clickResult = {
          clicked: true,
          method: 'jsClick-auto',
          cdpAttempted: true,
          interceptedBy: verifyResult.interceptedBy,
          ...jsResult
        };
        return addNavigationAndDebugInfo(clickResult, urlBeforeClick, { point: clippedPoint, elementAtPoint }, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
      }

      const clickResult = { clicked: true, method: 'cdp', targetReceived: verifyResult.targetReceived };
      if (verifyResult.interceptedBy) {
        clickResult.interceptedBy = verifyResult.interceptedBy;
      }
      return addNavigationAndDebugInfo(clickResult, urlBeforeClick, { point: clippedPoint, elementAtPoint }, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });

    } catch (e) {
      if (!jsClick && !nativeOnly) {
        try {
          return await tryJsClickFallback(selector, {
            urlBeforeClick,
            waitForNavigation,
            navigationTimeout,
            debug,
            waitAfter,
            waitAfterOptions,
            fallbackReason: e.message
          });
        } catch {
          // JS click also failed
        }
      }
      throw e;
    } finally {
      await releaseObject(session, objectId);
    }
  }

  /**
   * Click an element by its visible text content
   * @param {string} text - Text to find and click
   * @param {Object} opts - Click options
   * @returns {Promise<Object>} Click result
   */
  async function clickByText(text, opts = {}) {
    const {
      exact = false,
      tag = null,
      jsClick = false,
      nativeOnly = false,  // Skip jsClick auto-fallback
      force = false,
      debug = false,
      waitForNavigation = false,
      navigationTimeout = 100,
      timeout = 30000,
      waitAfter = false,
      waitAfterOptions = {},
      withinSelector = null  // Optional: scope text search to elements matching this selector
    } = opts;

    const urlBeforeClick = await getCurrentUrl(session);

    let element;
    if (withinSelector) {
      // Find element by text within elements matching the selector
      element = await elementLocator.findElementByTextWithinSelector(text, withinSelector, { exact, tag });
      if (!element) {
        throw elementNotFoundError(`text:"${text}" within selector "${withinSelector}"`, timeout);
      }
    } else {
      // Find element by text using the locator
      element = await elementLocator.findElementByText(text, { exact, tag });
      if (!element) {
        throw elementNotFoundError(`text:"${text}"`, timeout);
      }
    }

    const objectId = element.objectId;

    try {
      // Check actionability unless force is true
      if (!force) {
        const actionable = await element.isActionable();
        if (!actionable.actionable) {
          // Try JS click as fallback
          if (!jsClick && !nativeOnly) {
            try {
              const result = await executeJsClick(objectId);
              const clickResult = {
                clicked: true,
                method: 'jsClick-fallback',
                text,
                fallbackReason: actionable.reason,
                ...result
              };
              return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
            } catch {
              // JS click also failed
            }
          }
          throw new Error(`Element with text "${text}" not actionable: ${actionable.reason}`);
        }
      }

      if (jsClick) {
        const result = await executeJsClick(objectId);
        const clickResult = { clicked: true, method: 'jsClick', text, ...result };
        return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
      }

      const point = await element.getClickPoint();
      if (!point) {
        throw new Error(`Could not determine click point for element with text "${text}"`);
      }

      let elementAtPoint = null;
      if (debug) {
        elementAtPoint = await getElementAtPoint(session, point.x, point.y);
      }

      // Always verify CDP click and auto-fallback to jsClick if not received
      const verifyResult = await clickWithVerification(point.x, point.y, objectId);

      if (!verifyResult.targetReceived && !nativeOnly) {
        // CDP click didn't reach target, fallback to jsClick
        const jsResult = await executeJsClick(objectId);
        const clickResult = {
          clicked: true,
          method: 'jsClick-auto',
          text,
          cdpAttempted: true,
          interceptedBy: verifyResult.interceptedBy,
          ...jsResult
        };
        return addNavigationAndDebugInfo(clickResult, urlBeforeClick, { point, elementAtPoint }, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
      }

      const clickResult = { clicked: true, method: 'cdp', text, targetReceived: verifyResult.targetReceived };
      if (verifyResult.interceptedBy) {
        clickResult.interceptedBy = verifyResult.interceptedBy;
      }
      return addNavigationAndDebugInfo(clickResult, urlBeforeClick, { point, elementAtPoint }, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });

    } catch (e) {
      if (!jsClick && !nativeOnly) {
        try {
          const result = await executeJsClick(objectId);
          const clickResult = {
            clicked: true,
            method: 'jsClick-fallback',
            text,
            fallbackReason: e.message,
            ...result
          };
          return addNavigationAndDebugInfo(clickResult, urlBeforeClick, null, { waitForNavigation, navigationTimeout, debug, waitAfter, waitAfterOptions });
        } catch {
          // JS click also failed
        }
      }
      throw e;
    } finally {
      await element.dispose();
    }
  }

  async function execute(params) {
    const selector = typeof params === 'string' ? params : params.selector;
    let ref = typeof params === 'object' ? params.ref : null;
    const text = typeof params === 'object' ? params.text : null;
    const selectors = typeof params === 'object' ? params.selectors : null;
    const jsClick = typeof params === 'object' && params.jsClick === true;
    const nativeOnly = typeof params === 'object' && params.nativeOnly === true;  // Skip jsClick auto-fallback
    const force = typeof params === 'object' && params.force === true;
    const debug = typeof params === 'object' && params.debug === true;
    const waitForNavigation = typeof params === 'object' && params.waitForNavigation === true;
    const navigationTimeout = typeof params === 'object' ? params.navigationTimeout : undefined;
    const exact = typeof params === 'object' && params.exact === true;
    const tag = typeof params === 'object' ? params.tag : null;
    // Auto-wait after click
    const waitAfter = typeof params === 'object' && params.waitAfter === true;
    const waitAfterOptions = typeof params === 'object' ? params.waitAfterOptions : {};
    // Scroll until visible
    const scrollUntilVisible = typeof params === 'object' && params.scrollUntilVisible === true;
    const scrollOptions = typeof params === 'object' ? params.scrollOptions : {};

    // Detect if string selector looks like a versioned ref (f{frameId}s{N}e{M})
    // This allows {"click": "f0s1e1"} to work the same as {"click": {"ref": "f0s1e1"}}
    if (!ref && selector) {
      if (/^f(\d+|\[[^\]]+\])s\d+e\d+$/.test(selector)) {
        ref = selector;
      } else if (/^ref=f(\d+|\[[^\]]+\])s\d+e\d+$/i.test(selector)) {
        ref = selector.slice(4); // Remove "ref=" prefix
      }
    }

    // Handle coordinate-based click
    if (typeof params === 'object' && typeof params.x === 'number' && typeof params.y === 'number') {
      return clickAtCoordinates(params.x, params.y, { debug, waitForNavigation, navigationTimeout, waitAfter, waitAfterOptions });
    }

    // Handle click by ref
    if (ref && ariaSnapshot) {
      return clickByRef(ref, jsClick, { waitForNavigation, navigationTimeout, force, debug, nativeOnly, waitAfter, waitAfterOptions });
    }

    // Handle click by visible text (optionally scoped to selector)
    if (text) {
      return clickByText(text, { exact, tag, jsClick, nativeOnly, force, debug, waitForNavigation, navigationTimeout, waitAfter, waitAfterOptions, withinSelector: selector });
    }

    // Handle multi-selector fallback
    if (selectors && Array.isArray(selectors)) {
      return clickWithMultiSelector(selectors, { jsClick, nativeOnly, force, debug, waitForNavigation, navigationTimeout, waitAfter, waitAfterOptions });
    }

    // If scrollUntilVisible is set, first scroll to find the element
    if (scrollUntilVisible && selector) {
      const scrollResult = await actionabilityChecker.scrollUntilVisible(selector, scrollOptions);
      if (!scrollResult.found) {
        throw elementNotFoundError(selector, scrollOptions.timeout || 30000);
      }
      // Release the objectId from scrollUntilVisible — clickBySelector will re-find the element
      if (scrollResult.objectId) {
        await releaseObject(session, scrollResult.objectId);
      }
    }

    return clickBySelector(selector, { jsClick, nativeOnly, force, debug, waitForNavigation, navigationTimeout, waitAfter, waitAfterOptions });
  }

  /**
   * Click using multiple selectors with fallback
   * Tries selectors in order until one succeeds
   * @param {Array} selectors - Array of selectors to try
   * @param {Object} opts - Click options
   * @returns {Promise<Object>} Click result
   */
  async function clickWithMultiSelector(selectors, opts = {}) {
    const errors = [];

    for (const selectorSpec of selectors) {
      try {
        // Handle role-based selector objects
        if (typeof selectorSpec === 'object' && selectorSpec.role) {
          const { role, name } = selectorSpec;
          const elements = await elementLocator.queryByRole(role, { name });
          if (elements.length > 0) {
            const element = elements[0];
            const result = await clickBySelector(element.selector || `[role="${role}"]`, opts);
            result.usedSelector = selectorSpec;
            result.selectorIndex = selectors.indexOf(selectorSpec);
            return result;
          }
          errors.push({ selector: selectorSpec, error: `No elements found with role="${role}"${name ? ` and name="${name}"` : ''}` });
          continue;
        }

        // Handle regular CSS selector
        const result = await clickBySelector(selectorSpec, opts);
        result.usedSelector = selectorSpec;
        result.selectorIndex = selectors.indexOf(selectorSpec);
        return result;
      } catch (e) {
        errors.push({ selector: selectorSpec, error: e.message });
      }
    }

    // All selectors failed
    const errorMessages = errors.map((e, i) => `  ${i + 1}. ${typeof e.selector === 'object' ? JSON.stringify(e.selector) : e.selector}: ${e.error}`).join('\n');
    throw new Error(`All ${selectors.length} selectors failed:\n${errorMessages}`);
  }

  return {
    execute,
    clickByText,
    clickWithMultiSelector
  };
}
