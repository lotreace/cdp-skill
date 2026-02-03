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
import { executeValidate, executeSubmit, executeExtract } from './execute-form.js';
import { executePdf, executeEval, executeCookies, executeListTabs, executeCloseTab, executeConsole, formatCommandConsole } from './execute-browser.js';

const keyValidator = createKeyValidator();

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

    if (step.goto !== undefined) {
      stepResult.action = 'goto';
      // Support both string URL and object format
      const url = typeof step.goto === 'string' ? step.goto : step.goto.url;
      const gotoOptions = typeof step.goto === 'object' ? step.goto : {};
      await pageController.navigate(url, gotoOptions);
    } else if (step.reload !== undefined) {
      stepResult.action = 'reload';
      const reloadOptions = step.reload === true ? {} : step.reload;
      await pageController.reload(reloadOptions);
    } else if (step.wait !== undefined) {
      stepResult.action = 'wait';
      if (typeof step.wait === 'number') {
        await sleep(step.wait);
      } else {
        await executeWait(elementLocator, step.wait);
      }
    } else if (step.click !== undefined) {
      stepResult.action = 'click';
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
    } else if (step.fill !== undefined) {
      stepResult.action = 'fill';
      const fillExecutor = createFillExecutor(
        elementLocator.session,
        elementLocator,
        inputEmulator,
        deps.ariaSnapshot
      );
      const urlBeforeFill = await getCurrentUrl(elementLocator.session);
      await fillExecutor.execute(step.fill);
      const urlAfterFill = await getCurrentUrl(elementLocator.session);
      if (urlAfterFill !== urlBeforeFill) {
        stepResult.output = { navigated: true, newUrl: urlAfterFill };
      }
    } else if (step.fillForm !== undefined) {
      stepResult.action = 'fillForm';
      const fillExecutor = createFillExecutor(
        elementLocator.session,
        elementLocator,
        inputEmulator,
        deps.ariaSnapshot
      );
      stepResult.output = await fillExecutor.executeBatch(step.fillForm);
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
    } else if (step.eval !== undefined) {
      stepResult.action = 'eval';
      stepResult.output = await executeEval(pageController, step.eval);
    } else if (step.snapshot !== undefined) {
      stepResult.action = 'snapshot';
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
    } else if (step.forward !== undefined) {
      stepResult.action = 'forward';
      const forwardOptions = step.forward === true ? {} : step.forward;
      const entry = await pageController.goForward(forwardOptions);
      stepResult.output = entry ? { url: entry.url, title: entry.title } : { noHistory: true };
    } else if (step.waitForNavigation !== undefined) {
      stepResult.action = 'waitForNavigation';
      await executeWaitForNavigation(pageController, step.waitForNavigation);
    } else if (step.listTabs !== undefined) {
      stepResult.action = 'listTabs';
      stepResult.output = await executeListTabs(deps.browser);
    } else if (step.closeTab !== undefined) {
      stepResult.action = 'closeTab';
      stepResult.output = await executeCloseTab(deps.browser, step.closeTab);
    } else if (step.openTab !== undefined) {
      stepResult.action = 'openTab';
      if (step._openTabHandled) {
        if (step._openTabUrl) {
          await pageController.navigate(step._openTabUrl);
        }
        stepResult.output = { tab: step._openTabAlias };
      } else {
        throw new Error('openTab must be the first step when no targetId is provided');
      }
    } else if (step.type !== undefined) {
      stepResult.action = 'type';
      const keyboardExecutor = createKeyboardExecutor(
        elementLocator.session,
        elementLocator,
        inputEmulator
      );
      stepResult.output = await keyboardExecutor.executeType(step.type);
    } else if (step.select !== undefined) {
      stepResult.action = 'select';
      const keyboardExecutor = createKeyboardExecutor(
        elementLocator.session,
        elementLocator,
        inputEmulator
      );
      stepResult.output = await keyboardExecutor.executeSelect(step.select);
    } else if (step.validate !== undefined) {
      stepResult.action = 'validate';
      stepResult.output = await executeValidate(elementLocator, step.validate);
    } else if (step.submit !== undefined) {
      stepResult.action = 'submit';
      stepResult.output = await executeSubmit(elementLocator, step.submit);
    } else if (step.assert !== undefined) {
      stepResult.action = 'assert';
      stepResult.output = await executeAssert(pageController, elementLocator, step.assert);
    } else if (step.queryAll !== undefined) {
      stepResult.action = 'queryAll';
      stepResult.output = await executeQueryAll(elementLocator, step.queryAll);
    } else if (step.switchToFrame !== undefined) {
      stepResult.action = 'switchToFrame';
      stepResult.output = await pageController.switchToFrame(step.switchToFrame);
    } else if (step.switchToMainFrame !== undefined) {
      stepResult.action = 'switchToMainFrame';
      stepResult.output = await pageController.switchToMainFrame();
    } else if (step.listFrames !== undefined) {
      stepResult.action = 'listFrames';
      stepResult.output = await pageController.getFrameTree();
    } else if (step.drag !== undefined) {
      stepResult.action = 'drag';
      stepResult.output = await executeDrag(elementLocator, inputEmulator, pageController, deps.ariaSnapshot, step.drag);
    } else if (step.formState !== undefined) {
      stepResult.action = 'formState';
      const formValidator = createFormValidator(elementLocator.session, elementLocator);
      const formSelector = typeof step.formState === 'string' ? step.formState : step.formState.selector;
      stepResult.output = await formValidator.getFormState(formSelector);
    } else if (step.extract !== undefined) {
      stepResult.action = 'extract';
      stepResult.output = await executeExtract(deps, step.extract);
    } else if (step.selectOption !== undefined) {
      stepResult.action = 'selectOption';
      stepResult.output = await executeSelectOption(elementLocator, step.selectOption);
    } else if (step.getDom !== undefined) {
      stepResult.action = 'getDom';
      stepResult.output = await executeGetDom(pageController, step.getDom);
    } else if (step.getBox !== undefined) {
      stepResult.action = 'getBox';
      stepResult.output = await executeGetBox(deps.ariaSnapshot, step.getBox);
    } else if (step.fillActive !== undefined) {
      stepResult.action = 'fillActive';
      stepResult.output = await executeFillActive(pageController, inputEmulator, step.fillActive);
    } else if (step.refAt !== undefined) {
      stepResult.action = 'refAt';
      stepResult.output = await executeRefAt(pageController.session, step.refAt);
    } else if (step.elementsAt !== undefined) {
      stepResult.action = 'elementsAt';
      stepResult.output = await executeElementsAt(pageController.session, step.elementsAt);
    } else if (step.elementsNear !== undefined) {
      stepResult.action = 'elementsNear';
      stepResult.output = await executeElementsNear(pageController.session, step.elementsNear);
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
