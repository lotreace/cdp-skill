/**
 * Step Executors - Orchestration
 * Main step execution orchestration importing from domain modules
 *
 * EXPORTS:
 * - executeStep(deps, step, options?) → Promise<StepResult>
 * - runSteps(deps, steps, options?) → Promise<RunResult>
 *
 * SUBMODULES:
 * - ./execute-navigation.js: executeWait, executeWaitForNavigation, executeScroll
 * - ./execute-interaction.js: executeClick, executeHover, executeDrag
 * - ./execute-input.js: executeFill, executeFillActive, executeSelectOption
 * - ./execute-query.js: executeSnapshot, executeQuery, executeQueryAll, executeInspect, etc.
 * - ./execute-form.js: executeValidate, executeSubmit, executeFormState, executeExtract, executeAssert
 * - ./execute-browser.js: executePdf, executeEval, executeCookies, executeConsole, etc.
 */

import {
  timeoutError,
  stepValidationError,
  createKeyValidator,
  createFormValidator
} from '../utils.js';

import {
  createFillExecutor,
  createKeyboardExecutor
} from '../dom/index.js';

import {
  createSnapshotDiffer,
  createContextCapture
} from '../diff.js';

import { sleep, resolveTempPath, getCurrentUrl } from '../utils.js';
import fs from 'fs/promises';

// Import from submodules
import {
  STEP_TYPES,
  buildCommandContext,
  captureFailureContext
} from './context-helpers.js';

import { validateSteps } from './step-validator.js';

// Import domain executors
import { executeWait, executeWaitForNavigation, executeScroll } from './execute-navigation.js';
import { executeClick, executeHover, executeDrag } from './execute-interaction.js';
import { executeFillActive, executeSelectOption } from './execute-input.js';
import { executeSnapshot, executeSnapshotSearch, executeQuery, executeQueryAll, executeInspect, executeGetDom, executeGetBox, executeRefAt, executeElementsAt, executeElementsNear } from './execute-query.js';
// executeRefAt, executeElementsNear kept for internal dispatch from unified elementsAt
import { executeSubmit, executeExtract } from './execute-form.js';
import { executePdf, executeEval, executeCookies, executeListTabs, executeCloseTab, executeConsole, formatCommandConsole } from './execute-browser.js';
// executeEval kept for internal dispatch from unified pageFunction
import { executePageFunction, executePoll, executeWriteSiteProfile, executeReadSiteProfile, loadSiteProfile } from './execute-dynamic.js';

const keyValidator = createKeyValidator();

/**
 * Detect if a string looks like a function expression (vs a bare expression).
 * Functions start with (, function keyword, async keyword, or match arrow function patterns.
 * Must use word boundaries to avoid matching identifiers like "asyncStorage" or "functionName".
 */
function isFunctionExpression(str) {
  const trimmed = str.trim();
  // Parenthesized expression / IIFE / arrow with parens: (...)
  if (trimmed.startsWith('(')) {
    return true;
  }
  // function keyword followed by space, paren, or * (generator)
  if (/^function[\s*(]/.test(trimmed)) {
    return true;
  }
  // async keyword followed by space or paren (async function, async () =>)
  if (/^async[\s(]/.test(trimmed)) {
    return true;
  }
  // Arrow function: identifier => ...
  if (/^\w+\s*=>/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Execute a single test step
 * @param {Object} deps - Dependencies
 * @param {Object} step - Step definition
 * @param {Object} [options] - Execution options
 * @returns {Promise<Object>}
 */
export async function executeStep(deps, step, options = {}) {
  const { pageController, elementLocator, inputEmulator } = deps;
  const stepTimeout = options.stepTimeout || 30000;
  const isOptional = step.optional === true;

  const stepResult = {
    action: null,
    status: 'ok'
  };

  async function executeStepInternal() {
    const definedActions = STEP_TYPES.filter(type => step[type] !== undefined);
    if (definedActions.length === 0) {
      throw new Error(`Unknown step type: ${JSON.stringify(step)}`);
    }
    if (definedActions.length > 1) {
      throw new Error(`Ambiguous step: multiple actions defined (${definedActions.join(', ')}). Each step must have exactly one action.`);
    }

    // readyWhen hook: poll before action executes (on action steps with object params)
    const actionKey = definedActions[0];
    const actionValue = step[actionKey];
    if (actionValue && typeof actionValue === 'object' && actionValue.readyWhen) {
      const readyResult = await executePoll(pageController, {
        fn: actionValue.readyWhen,
        timeout: options.stepTimeout || 30000
      });
      if (!readyResult.resolved) {
        throw new Error(`readyWhen did not resolve within timeout`);
      }
    }

    if (step.goto !== undefined) {
      stepResult.action = 'goto';
      // Support both string URL and object format
      const url = typeof step.goto === 'string' ? step.goto : step.goto.url;
      const gotoOptions = typeof step.goto === 'object' ? step.goto : {};
      await pageController.navigate(url, gotoOptions);

      // Wait for network to settle after navigation (best-effort, never throws)
      await pageController.waitForNetworkSettle();

      // Site profile: load existing or signal that none exists
      try {
        const currentUrl = await pageController.evaluateInFrame('window.location.href', { returnByValue: true });
        const resolvedUrl = currentUrl.result?.value || url;
        const domain = new URL(resolvedUrl).hostname.replace(/^www\./, '');

        const existingProfile = await loadSiteProfile(domain);
        if (existingProfile) {
          stepResult.siteProfile = existingProfile;
        } else {
          stepResult.profileAvailable = false;
          stepResult.profileDomain = domain;
          stepResult.hint = `Unknown site: ${domain}. No site profile exists. Create one with writeSiteProfile after exploring the site (snapshot, pageFunction, snapshotSearch). This speeds up all future visits.`;
        }
      } catch {
        // Profile errors are non-fatal
      }
    } else if (step.reload !== undefined) {
      stepResult.action = 'reload';
      const reloadOptions = step.reload === true ? {} : step.reload;
      await pageController.reload(reloadOptions);
      await pageController.waitForNetworkSettle();
    } else if (step.sleep !== undefined) {
      stepResult.action = 'sleep';
      await sleep(step.sleep);
    } else if (step.wait !== undefined) {
      stepResult.action = 'wait';
      await executeWait(elementLocator, step.wait);
    } else if (step.click !== undefined) {
      stepResult.action = 'click';

      // Capture tabs before click for new-tab detection
      let tabsBefore = null;
      try {
        if (deps.browser) {
          const pages = await deps.browser.getPages();
          tabsBefore = new Set(pages.map(p => p.targetId));
        }
      } catch {
        // Detection failure is non-fatal
      }

      const clickResult = await executeClick(elementLocator, inputEmulator, deps.ariaSnapshot, step.click);
      if (clickResult) {
        if (clickResult.method) {
          stepResult.output = stepResult.output || {};
          stepResult.output.method = clickResult.method;
          if (clickResult.cdpAttempted) {
            stepResult.output.cdpAttempted = true;
          }
        }
        if (clickResult.stale || clickResult.warning) {
          stepResult.warning = clickResult.warning;
          stepResult.output = stepResult.output || {};
          stepResult.output.stale = clickResult.stale;
        }
        if (clickResult.navigated) {
          stepResult.output = stepResult.output || {};
          stepResult.output.navigated = true;
          stepResult.output.newUrl = clickResult.newUrl;
        }
        if (clickResult.method === 'jsClick-auto') {
          stepResult.warning = 'CDP click was intercepted, used JavaScript click fallback';
        }
      }

      // Detect new tabs opened by the click
      try {
        if (tabsBefore && deps.browser) {
          await sleep(200);
          const pagesAfter = await deps.browser.getPages();
          const newTabs = pagesAfter
            .filter(p => !tabsBefore.has(p.targetId))
            .map(p => ({ targetId: p.targetId, url: p.url, title: p.title }));
          if (newTabs.length > 0) {
            stepResult.output = stepResult.output || {};
            stepResult.output.newTabs = newTabs;
          }
        }
      } catch {
        // Detection failure is non-fatal
      }
    } else if (step.fill !== undefined) {
      stepResult.action = 'fill';
      const params = step.fill;

      if (typeof params === 'string') {
        // Shape 1: focused mode — type into active element
        stepResult.output = await executeFillActive(pageController, inputEmulator, params);
        stepResult.output.mode = 'focused';
      } else if (params && typeof params === 'object') {
        const hasTargeting = params.selector || params.ref || params.label;
        const hasFields = params.fields && typeof params.fields === 'object';

        if (hasTargeting) {
          // Shape 2: single field with targeting
          const fillExecutor = createFillExecutor(
            elementLocator.session,
            elementLocator,
            inputEmulator,
            deps.ariaSnapshot
          );
          const urlBeforeFill = await getCurrentUrl(elementLocator.session);
          await fillExecutor.execute(params);
          const urlAfterFill = await getCurrentUrl(elementLocator.session);
          stepResult.output = { mode: 'single' };
          if (urlAfterFill !== urlBeforeFill) {
            stepResult.output.navigated = true;
            stepResult.output.newUrl = urlAfterFill;
          }
        } else if (params.value !== undefined && !hasFields) {
          // Shape 3: focused with options
          stepResult.output = await executeFillActive(pageController, inputEmulator, params);
          stepResult.output.mode = 'focused';
        } else {
          // Shape 4 ({fields: ...}) or Shape 5 (plain mapping)
          const fillExecutor = createFillExecutor(
            elementLocator.session,
            elementLocator,
            inputEmulator,
            deps.ariaSnapshot
          );
          stepResult.output = await fillExecutor.executeBatch(params);
          stepResult.output.mode = 'batch';
        }
      }
    } else if (step.press !== undefined) {
      stepResult.action = 'press';
      const keyValidation = keyValidator.validate(step.press);
      if (keyValidation.warning) {
        stepResult.warning = keyValidation.warning;
      }
      if (typeof step.press === 'string' && step.press.includes('+')) {
        await inputEmulator.pressCombo(step.press);
      } else {
        await inputEmulator.press(step.press);
      }
    } else if (step.query !== undefined) {
      stepResult.action = 'query';
      stepResult.output = await executeQuery(elementLocator, step.query);
    } else if (step.inspect !== undefined) {
      stepResult.action = 'inspect';
      stepResult.output = await executeInspect(pageController, elementLocator, step.inspect);
    } else if (step.scroll !== undefined) {
      stepResult.action = 'scroll';
      stepResult.output = await executeScroll(elementLocator, inputEmulator, pageController, deps.ariaSnapshot, step.scroll);
    } else if (step.console !== undefined) {
      stepResult.action = 'console';
      stepResult.output = await executeConsole(deps.consoleCapture, step.console);
    } else if (step.pdf !== undefined) {
      stepResult.action = 'pdf';
      stepResult.output = await executePdf(deps.pdfCapture, elementLocator, step.pdf);
    } else if (step.snapshot !== undefined) {
      stepResult.action = 'snapshot';
      // Brief network settle before capturing — catches async content loading
      await pageController.waitForNetworkSettle({ timeout: 1500, idleTime: 200 });
      stepResult.output = await executeSnapshot(deps.ariaSnapshot, step.snapshot, { tabAlias: options.tabAlias, inlineLimit: options.inlineLimit });
    } else if (step.snapshotSearch !== undefined) {
      stepResult.action = 'snapshotSearch';
      stepResult.output = await executeSnapshotSearch(deps.ariaSnapshot, step.snapshotSearch);
    } else if (step.hover !== undefined) {
      stepResult.action = 'hover';
      const hoverResult = await executeHover(elementLocator, inputEmulator, deps.ariaSnapshot, step.hover);
      if (hoverResult.capturedResult) {
        stepResult.output = hoverResult.capturedResult;
      }
    } else if (step.viewport !== undefined) {
      stepResult.action = 'viewport';
      stepResult.output = await pageController.setViewport(step.viewport);
    } else if (step.cookies !== undefined) {
      stepResult.action = 'cookies';
      stepResult.output = await executeCookies(deps.cookieManager, deps.pageController, step.cookies);
    } else if (step.back !== undefined) {
      stepResult.action = 'back';
      const backOptions = step.back === true ? {} : step.back;
      const entry = await pageController.goBack(backOptions);
      stepResult.output = entry ? { url: entry.url, title: entry.title } : { noHistory: true };
      if (entry) await pageController.waitForNetworkSettle();
    } else if (step.forward !== undefined) {
      stepResult.action = 'forward';
      const forwardOptions = step.forward === true ? {} : step.forward;
      const entry = await pageController.goForward(forwardOptions);
      stepResult.output = entry ? { url: entry.url, title: entry.title } : { noHistory: true };
      if (entry) await pageController.waitForNetworkSettle();
    } else if (step.waitForNavigation !== undefined) {
      stepResult.action = 'waitForNavigation';
      await executeWaitForNavigation(pageController, step.waitForNavigation);
    } else if (step.listTabs !== undefined) {
      stepResult.action = 'listTabs';
      stepResult.output = await executeListTabs(deps.browser);
    } else if (step.closeTab !== undefined) {
      stepResult.action = 'closeTab';
      stepResult.output = await executeCloseTab(deps.browser, step.closeTab);
    } else if (step.newTab !== undefined) {
      stepResult.action = 'newTab';
      if (step._newTabHandled) {
        if (step._newTabUrl) {
          const navOptions = {};
          if (step._newTabTimeout) {
            navOptions.timeout = step._newTabTimeout;
          }
          await pageController.navigate(step._newTabUrl, navOptions);
          await pageController.waitForNetworkSettle();

          // Site profile check (same as goto)
          try {
            const currentUrl = await pageController.evaluateInFrame('window.location.href', { returnByValue: true });
            const resolvedUrl = currentUrl.result?.value || step._newTabUrl;
            const domain = new URL(resolvedUrl).hostname.replace(/^www\./, '');

            const existingProfile = await loadSiteProfile(domain);
            if (existingProfile) {
              stepResult.siteProfile = existingProfile;
            } else {
              stepResult.profileAvailable = false;
              stepResult.profileDomain = domain;
              stepResult.hint = `Unknown site: ${domain}. No site profile exists. Create one with writeSiteProfile after exploring the site (snapshot, pageFunction, snapshotSearch). This speeds up all future visits.`;
            }
          } catch {
            // Profile errors are non-fatal
          }
        }
        stepResult.output = { tab: step._newTabAlias };
      } else {
        throw new Error('openTab must be the first step when no targetId is provided');
      }
    } else if (step.selectText !== undefined) {
      stepResult.action = 'selectText';
      const keyboardExecutor = createKeyboardExecutor(
        elementLocator.session,
        elementLocator,
        inputEmulator
      );
      stepResult.output = await keyboardExecutor.executeSelect(step.selectText);
    } else if (step.submit !== undefined) {
      stepResult.action = 'submit';
      stepResult.output = await executeSubmit(elementLocator, step.submit);
    } else if (step.assert !== undefined) {
      stepResult.action = 'assert';
      stepResult.output = await executeAssert(pageController, elementLocator, step.assert);
    } else if (step.queryAll !== undefined) {
      stepResult.action = 'queryAll';
      stepResult.output = await executeQueryAll(elementLocator, step.queryAll);
    } else if (step.frame !== undefined) {
      stepResult.action = 'frame';
      const frameParams = step.frame;
      if (frameParams === 'top') {
        stepResult.output = await pageController.switchToMainFrame();
      } else if (typeof frameParams === 'object' && frameParams.list) {
        stepResult.output = await pageController.getFrameTree();
      } else {
        // string selector, number index, or {name: "foo"} — all go to switchToFrame
        stepResult.output = await pageController.switchToFrame(frameParams);
      }
    } else if (step.drag !== undefined) {
      stepResult.action = 'drag';
      stepResult.output = await executeDrag(elementLocator, inputEmulator, pageController, deps.ariaSnapshot, step.drag);
    } else if (step.get !== undefined) {
      stepResult.action = 'get';
      const getParams = step.get;
      const mode = typeof getParams === 'object' ? getParams.mode : null;

      if (mode === 'html') {
        // HTML extraction mode → use getDom
        stepResult.output = await executeGetDom(pageController, getParams);
        stepResult.output.mode = 'html';
      } else if (mode === 'box') {
        // Bounding box mode → use getBox (requires ref format)
        stepResult.output = await executeGetBox(deps.ariaSnapshot, getParams.ref || getParams.selector);
        stepResult.output.mode = 'box';
      } else if (mode === 'value') {
        // Form value extraction → use formState
        const formValidator = createFormValidator(elementLocator.session, elementLocator);
        const selector = typeof getParams === 'string' ? getParams : getParams.selector;
        stepResult.output = await formValidator.getFormState(selector);
        stepResult.output.mode = 'value';
      } else {
        // Default: text/attributes extraction → use extract
        stepResult.output = await executeExtract(deps, getParams);
        stepResult.output.mode = mode || 'text';
      }
    } else if (step.selectOption !== undefined) {
      stepResult.action = 'selectOption';
      stepResult.output = await executeSelectOption(elementLocator, step.selectOption);
    } else if (step.getDom !== undefined) {
      stepResult.action = 'getDom';
      stepResult.output = await executeGetDom(pageController, step.getDom);
    } else if (step.getBox !== undefined) {
      stepResult.action = 'getBox';
      stepResult.output = await executeGetBox(deps.ariaSnapshot, step.getBox);
    } else if (step.elementsAt !== undefined) {
      stepResult.action = 'elementsAt';
      const eaParams = step.elementsAt;
      if (Array.isArray(eaParams)) {
        // Batch mode (array of coordinates)
        stepResult.output = await executeElementsAt(pageController.session, eaParams);
      } else if (eaParams && typeof eaParams === 'object' && eaParams.radius !== undefined) {
        // Nearby mode (has radius)
        stepResult.output = await executeElementsNear(pageController.session, eaParams);
      } else {
        // Single point mode (was refAt)
        stepResult.output = await executeRefAt(pageController.session, eaParams);
      }
    } else if (step.pageFunction !== undefined) {
      stepResult.action = 'pageFunction';
      const pfParams = step.pageFunction;
      // Check if this is a bare expression (not a function)
      const pfStr = typeof pfParams === 'string' ? pfParams : (pfParams?.fn || pfParams?.expression);
      const isBareExpression = pfStr && !isFunctionExpression(pfStr);
      if (isBareExpression) {
        // Use eval-style wrapping for bare expressions
        const evalParams = typeof pfParams === 'string'
          ? pfStr
          : { expression: pfStr, await: pfParams?.await, serialize: pfParams?.serialize, timeout: pfParams?.timeout };
        stepResult.output = await executeEval(pageController, evalParams);
      } else {
        // If expression key provided, remap to fn
        if (typeof pfParams === 'object' && pfParams.expression && !pfParams.fn) {
          stepResult.output = await executePageFunction(pageController, { ...pfParams, fn: pfParams.expression });
        } else {
          stepResult.output = await executePageFunction(pageController, pfParams);
        }
      }
    } else if (step.poll !== undefined) {
      stepResult.action = 'poll';
      stepResult.output = await executePoll(pageController, step.poll);
    } else if (step.writeSiteProfile !== undefined) {
      stepResult.action = 'writeSiteProfile';
      stepResult.output = await executeWriteSiteProfile(step.writeSiteProfile);
    } else if (step.readSiteProfile !== undefined) {
      stepResult.action = 'readSiteProfile';
      stepResult.output = await executeReadSiteProfile(step.readSiteProfile);
    } else if (step.switchTab !== undefined) {
      stepResult.action = 'switchTab';
      if (step._switchTabHandled) {
        stepResult.output = { tab: step._switchTabAlias, connected: true };
      } else {
        throw new Error('switchTab must be the first step when no tab is specified');
      }
    } else if (step.getUrl !== undefined) {
      stepResult.action = 'getUrl';
      const urlResult = await pageController.evaluateInFrame('window.location.href', { returnByValue: true });
      stepResult.output = { url: urlResult.result?.value };
    } else if (step.getTitle !== undefined) {
      stepResult.action = 'getTitle';
      const titleResult = await pageController.evaluateInFrame('document.title', { returnByValue: true });
      stepResult.output = { title: titleResult.result?.value };
    }

    // Process hooks on action steps (settledWhen, observe)
    // readyWhen is handled before the action via actionability — for now settledWhen and observe run post-action
    const actionParams = step[stepResult.action];
    if (actionParams && typeof actionParams === 'object') {
      if (actionParams.settledWhen) {
        const settledResult = await executePoll(pageController, {
          fn: actionParams.settledWhen,
          timeout: stepTimeout || 30000
        });
        if (!settledResult.resolved) {
          const lastValStr = settledResult.lastValue !== undefined
            ? ` (last value: ${JSON.stringify(settledResult.lastValue).substring(0, 200)})`
            : '';
          stepResult.warning = (stepResult.warning || '') +
            `settledWhen timed out after ${settledResult.elapsed || 'unknown'}ms${lastValStr}`;
        }
      }

      if (actionParams.observe) {
        stepResult.observation = await executePageFunction(pageController, actionParams.observe);
      }
    }
  }

  const definedAction = STEP_TYPES.find(type => step[type] !== undefined);
  const stepParams = definedAction ? step[definedAction] : null;

  let timeoutId;
  try {
    const stepPromise = executeStepInternal();
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(timeoutError(`Step timed out after ${stepTimeout}ms`, stepTimeout));
      }, stepTimeout);
    });

    await Promise.race([stepPromise, timeoutPromise]);
    clearTimeout(timeoutId);
  } catch (error) {
    clearTimeout(timeoutId);
    stepResult.params = stepParams;

    try {
      // Extract selector or text from params for near-match suggestions
      const contextOptions = {};
      if (stepParams) {
        if (typeof stepParams === 'string') {
          contextOptions.failedSelector = stepParams;
        } else if (typeof stepParams === 'object') {
          contextOptions.failedSelector = stepParams.selector || stepParams.ref;
          contextOptions.failedText = stepParams.text;
        }
      }
      stepResult.context = await captureFailureContext(deps, contextOptions);
    } catch (e) {
      // Ignore context capture errors
    }

    if (isOptional) {
      stepResult.status = 'skipped';
      stepResult.error = `${error.message} (timeout: ${stepTimeout}ms)`;
    } else {
      stepResult.status = 'error';
      stepResult.error = error.message;
    }
  }

  return stepResult;
}

// Import executeAssert from execute-form.js
import { executeAssert } from './execute-form.js';

/**
 * Run an array of test steps
 * @param {Object} deps - Dependencies
 * @param {Array<Object>} steps - Array of step definitions
 * @param {Object} [options] - Execution options
 * @param {boolean} [options.stopOnError=true] - Stop on first error
 * @param {number} [options.stepTimeout=30000] - Timeout per step
 * @returns {Promise<{status: string, steps: Array, errors: Array}>}
 */
export async function runSteps(deps, steps, options = {}) {
  const validation = validateSteps(steps);
  if (!validation.valid) {
    throw stepValidationError(validation.errors);
  }

  const stopOnError = options.stopOnError !== false;
  const result = {
    status: 'ok',
    steps: [],
    errors: []
  };

  const consoleCountBefore = deps.consoleCapture ? deps.consoleCapture.getMessages().length : 0;

  let beforeUrl, beforeViewport;
  const contextCapture = deps.pageController ? createContextCapture(deps.pageController.session) : null;

  if (deps.ariaSnapshot && contextCapture) {
    try {
      beforeUrl = await getCurrentUrl(deps.pageController.session);
      // Use preserveRefs to avoid clobbering refs from snapshotSearch
      // Use internal to avoid incrementing snapshot ID (this is for diff, not agent-facing)
      beforeViewport = await deps.ariaSnapshot.generate({ mode: 'ai', viewportOnly: true, preserveRefs: true, internal: true });
    } catch {
      // Ignore initial snapshot errors
    }
  }

  for (const step of steps) {
    const stepResult = await executeStep(deps, step, options);
    result.steps.push(stepResult);

    if (stepResult.status === 'error') {
      result.status = 'error';
      result.errors.push({
        step: result.steps.length,
        action: stepResult.action,
        error: stepResult.error
      });

      if (stopOnError) {
        break;
      }
    }
  }

  if (deps.consoleCapture) {
    await sleep(250);
    const consoleSummary = formatCommandConsole(deps.consoleCapture, consoleCountBefore);
    if (consoleSummary) {
      result.console = consoleSummary;
    }
  }

  if (deps.ariaSnapshot && contextCapture && beforeViewport) {
    try {
      const afterUrl = await getCurrentUrl(deps.pageController.session);
      const afterContext = await contextCapture.captureContext();

      // Use preserveRefs to avoid clobbering refs from snapshotSearch
      // Use internal to avoid incrementing snapshot ID (this is for diff, not agent-facing)
      const afterViewport = await deps.ariaSnapshot.generate({ mode: 'ai', viewportOnly: true, preserveRefs: true, internal: true });
      const afterFull = await deps.ariaSnapshot.generate({ mode: 'ai', viewportOnly: false, preserveRefs: true, internal: true });

      const navigated = contextCapture.isNavigation(beforeUrl, afterUrl);

      const fullSnapshotPath = await resolveTempPath(`${options.tabAlias || 'command'}.after.yaml`, '.yaml');
      await fs.writeFile(fullSnapshotPath, afterFull.yaml || '', 'utf8');

      result.navigated = navigated;
      result.fullSnapshot = fullSnapshotPath;
      result.context = afterContext;
      result.viewportSnapshot = afterViewport.yaml;
      result.truncated = afterViewport.truncated || false;

      if (!navigated && beforeViewport?.yaml) {
        const differ = createSnapshotDiffer();
        const viewportDiff = differ.computeDiff(beforeViewport.yaml, afterViewport.yaml);

        if (differ.hasSignificantChanges(viewportDiff)) {
          const actionContext = buildCommandContext(steps);
          result.changes = differ.formatDiff(viewportDiff, { actionContext });
        }
      }
    } catch (e) {
      result.viewportSnapshotError = e.message;
    }
  }

  return result;
}
