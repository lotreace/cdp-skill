/**
 * Test Step Execution
 * Validates and executes YAML/JSON test step sequences
 */

import {
  elementNotFoundError,
  elementNotEditableError,
  timeoutError,
  stepValidationError,
  createKeyValidator,
  createFormValidator
} from './utils.js';

import {
  createClickExecutor,
  createFillExecutor,
  createWaitExecutor,
  createKeyboardExecutor,
  createElementValidator,
  createReactInputFiller,
  createActionabilityChecker
} from './dom.js';

import {
  createQueryOutputProcessor,
  createRoleQueryExecutor
} from './aria.js';

import {
  createEvalSerializer,
  createDebugCapture
} from './capture.js';

import { sleep, resetInputState, releaseObject, resolveTempPath, generateTempPath } from './utils.js';

const keyValidator = createKeyValidator();

const STEP_TYPES = ['goto', 'wait', 'delay', 'click', 'fill', 'fillForm', 'press', 'screenshot', 'query', 'queryAll', 'inspect', 'scroll', 'console', 'pdf', 'eval', 'snapshot', 'hover', 'viewport', 'cookies', 'back', 'forward', 'waitForNavigation', 'listTabs', 'closeTab', 'type', 'select', 'validate', 'submit', 'assert', 'switchToFrame', 'switchToMainFrame', 'listFrames', 'drag'];

/**
 * Validate a single step definition
 * @param {Object} step - Step definition
 * @returns {string[]} Array of validation errors
 */
function validateStepInternal(step) {
  const errors = [];

  if (!step || typeof step !== 'object') {
    errors.push('step must be an object');
    return errors;
  }

  const definedActions = STEP_TYPES.filter(type => step[type] !== undefined);

  if (definedActions.length === 0) {
    errors.push(`unknown step type, expected one of: ${STEP_TYPES.join(', ')}`);
    return errors;
  }

  if (definedActions.length > 1) {
    errors.push(`ambiguous step: multiple actions defined (${definedActions.join(', ')})`);
    return errors;
  }

  const action = definedActions[0];
  const params = step[action];

  switch (action) {
    case 'goto':
      if (typeof params !== 'string' || params.length === 0) {
        errors.push('goto requires a non-empty URL string');
      }
      break;

    case 'wait':
      // Support numeric value for simple delay: { "wait": 2000 }
      if (typeof params === 'number') {
        if (params < 0) {
          errors.push('wait time must be a non-negative number');
        }
      } else if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('wait selector cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        const hasSelector = params.selector !== undefined;
        const hasText = params.text !== undefined;
        const hasTextRegex = params.textRegex !== undefined;
        const hasTime = params.time !== undefined;
        const hasUrlContains = params.urlContains !== undefined;
        if (!hasSelector && !hasText && !hasTextRegex && !hasTime && !hasUrlContains) {
          errors.push('wait requires selector, text, textRegex, time, or urlContains');
        }
        if (hasSelector && typeof params.selector !== 'string') {
          errors.push('wait selector must be a string');
        }
        if (hasText && typeof params.text !== 'string') {
          errors.push('wait text must be a string');
        }
        if (hasTextRegex && typeof params.textRegex !== 'string') {
          errors.push('wait textRegex must be a string');
        }
        if (hasTime && (typeof params.time !== 'number' || params.time < 0)) {
          errors.push('wait time must be a non-negative number');
        }
        if (hasUrlContains && typeof params.urlContains !== 'string') {
          errors.push('wait urlContains must be a string');
        }
        if (params.minCount !== undefined && (typeof params.minCount !== 'number' || params.minCount < 0)) {
          errors.push('wait minCount must be a non-negative number');
        }
        if (params.caseSensitive !== undefined && typeof params.caseSensitive !== 'boolean') {
          errors.push('wait caseSensitive must be a boolean');
        }
        if (params.hidden !== undefined && typeof params.hidden !== 'boolean') {
          errors.push('wait hidden must be a boolean');
        }
      } else {
        errors.push('wait requires a number (ms), selector string, or params object');
      }
      break;

    case 'delay':
      // Simple delay step: { "delay": 2000 }
      if (typeof params !== 'number' || params < 0) {
        errors.push('delay requires a non-negative number (milliseconds)');
      }
      break;

    case 'click':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('click selector cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        // Check for coordinate-based click (FR-064)
        const hasCoordinates = typeof params.x === 'number' && typeof params.y === 'number';
        if (!params.selector && !params.ref && !hasCoordinates) {
          errors.push('click requires selector, ref, or x/y coordinates');
        } else if (params.selector && typeof params.selector !== 'string') {
          errors.push('click selector must be a string');
        } else if (params.ref && typeof params.ref !== 'string') {
          errors.push('click ref must be a string');
        } else if (hasCoordinates) {
          if (params.x < 0 || params.y < 0) {
            errors.push('click coordinates must be non-negative');
          }
        }
      } else {
        errors.push('click requires a selector string or params object');
      }
      break;

    case 'fill':
      if (!params || typeof params !== 'object') {
        errors.push('fill requires an object with selector/ref and value');
      } else {
        if (!params.selector && !params.ref) {
          errors.push('fill requires selector or ref');
        } else if (params.selector && typeof params.selector !== 'string') {
          errors.push('fill selector must be a string');
        } else if (params.ref && typeof params.ref !== 'string') {
          errors.push('fill ref must be a string');
        }
        if (params.value === undefined) {
          errors.push('fill requires value');
        }
      }
      break;

    case 'fillForm':
      if (!params || typeof params !== 'object') {
        errors.push('fillForm requires an object mapping selectors/refs to values');
      } else {
        // Support both formats:
        // Simple: {"#firstName": "John", "#lastName": "Doe"}
        // Extended: {"fields": {"#firstName": "John"}, "react": true}
        let fields;
        if (params.fields && typeof params.fields === 'object') {
          fields = params.fields;
          // Validate react option if present
          if (params.react !== undefined && typeof params.react !== 'boolean') {
            errors.push('fillForm react option must be a boolean');
          }
        } else {
          fields = params;
        }
        const entries = Object.entries(fields);
        if (entries.length === 0) {
          errors.push('fillForm requires at least one field');
        }
      }
      break;

    case 'press':
      if (typeof params !== 'string' || params.length === 0) {
        errors.push('press requires a non-empty key string');
      }
      break;

    case 'screenshot':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('screenshot path cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        if (!params.path) {
          errors.push('screenshot requires path');
        } else if (typeof params.path !== 'string') {
          errors.push('screenshot path must be a string');
        }
      } else {
        errors.push('screenshot requires a path string or params object');
      }
      break;

    case 'query':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('query selector cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        // Support both CSS selector and role-based queries
        if (!params.selector && !params.role) {
          errors.push('query requires selector or role');
        }
        // Role can be string or array of strings (FR-021 compound roles)
        if (params.role) {
          if (typeof params.role !== 'string' && !Array.isArray(params.role)) {
            errors.push('query role must be a string or array of strings');
          }
          if (Array.isArray(params.role) && !params.role.every(r => typeof r === 'string')) {
            errors.push('query role array must contain only strings');
          }
        }
        // Validate nameExact and nameRegex are not both set
        if (params.nameExact && params.nameRegex) {
          errors.push('query cannot have both nameExact and nameRegex');
        }
      } else {
        errors.push('query requires a selector string or params object');
      }
      break;

    case 'inspect':
      // inspect can be boolean or object with options
      break;

    case 'scroll':
      if (typeof params === 'string') {
        if (!['top', 'bottom', 'up', 'down'].includes(params) && params.length === 0) {
          errors.push('scroll requires direction (top/bottom/up/down) or selector');
        }
      } else if (params && typeof params === 'object') {
        // selector, x, y, deltaX, deltaY are all valid
      } else if (typeof params !== 'string') {
        errors.push('scroll requires direction string or params object');
      }
      break;

    case 'console':
      // console can be boolean or object with filter options
      break;

    case 'pdf':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('pdf path cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        if (!params.path) {
          errors.push('pdf requires path');
        } else if (typeof params.path !== 'string') {
          errors.push('pdf path must be a string');
        }
      } else {
        errors.push('pdf requires a path string or params object');
      }
      break;

    case 'eval':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('eval expression cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        if (!params.expression) {
          errors.push('eval requires expression');
        } else if (typeof params.expression !== 'string') {
          errors.push('eval expression must be a string');
        }
      } else {
        errors.push('eval requires an expression string or params object');
      }
      break;

    case 'snapshot':
      // snapshot can be boolean or object with options
      if (params !== true && params !== false && typeof params !== 'object') {
        errors.push('snapshot requires true or params object');
      }
      if (typeof params === 'object' && params.mode && !['ai', 'full'].includes(params.mode)) {
        errors.push('snapshot mode must be "ai" or "full"');
      }
      break;

    case 'hover':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('hover selector cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        if (!params.selector && !params.ref) {
          errors.push('hover requires selector or ref');
        }
      } else {
        errors.push('hover requires a selector string or params object');
      }
      break;

    case 'viewport':
      // Support both device preset strings and explicit config objects
      if (typeof params === 'string') {
        // Device preset name - validation happens at execution time
        if (params.length === 0) {
          errors.push('viewport preset name cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        if (!params.width || typeof params.width !== 'number') {
          errors.push('viewport requires numeric width');
        }
        if (!params.height || typeof params.height !== 'number') {
          errors.push('viewport requires numeric height');
        }
      } else {
        errors.push('viewport requires a device preset string or object with width and height');
      }
      break;

    case 'cookies':
      if (!params || typeof params !== 'object') {
        errors.push('cookies requires an object with action (get, set, or clear)');
      } else {
        const action = params.action || params.get || params.set || params.clear;
        if (params.set && !Array.isArray(params.set)) {
          errors.push('cookies set requires an array of cookie objects');
        }
      }
      break;

    case 'back':
      if (params !== true && typeof params !== 'object') {
        errors.push('back requires true or params object');
      }
      break;

    case 'forward':
      if (params !== true && typeof params !== 'object') {
        errors.push('forward requires true or params object');
      }
      break;

    case 'waitForNavigation':
      if (params !== true && typeof params !== 'object') {
        errors.push('waitForNavigation requires true or params object');
      }
      if (typeof params === 'object' && params.timeout !== undefined) {
        if (typeof params.timeout !== 'number' || params.timeout < 0) {
          errors.push('waitForNavigation timeout must be a non-negative number');
        }
      }
      break;

    case 'listTabs':
      // listTabs can be boolean true
      if (params !== true) {
        errors.push('listTabs requires true');
      }
      break;

    case 'closeTab':
      if (typeof params !== 'string' || params.length === 0) {
        errors.push('closeTab requires a non-empty targetId string');
      }
      break;

    case 'type':
      if (!params || typeof params !== 'object') {
        errors.push('type requires an object with selector and text');
      } else {
        if (!params.selector) {
          errors.push('type requires selector');
        } else if (typeof params.selector !== 'string') {
          errors.push('type selector must be a string');
        }
        if (params.text === undefined) {
          errors.push('type requires text');
        }
      }
      break;

    case 'select':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('select selector cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        if (!params.selector) {
          errors.push('select requires selector');
        } else if (typeof params.selector !== 'string') {
          errors.push('select selector must be a string');
        }
        if (params.start !== undefined && typeof params.start !== 'number') {
          errors.push('select start must be a number');
        }
        if (params.end !== undefined && typeof params.end !== 'number') {
          errors.push('select end must be a number');
        }
      } else {
        errors.push('select requires a selector string or params object');
      }
      break;

    case 'validate':
      if (typeof params !== 'string' || params.length === 0) {
        errors.push('validate requires a non-empty selector string');
      }
      break;

    case 'submit':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('submit requires a non-empty form selector');
        }
      } else if (params && typeof params === 'object') {
        if (!params.selector) {
          errors.push('submit requires selector');
        } else if (typeof params.selector !== 'string') {
          errors.push('submit selector must be a string');
        }
      } else {
        errors.push('submit requires a selector string or params object');
      }
      break;

    case 'assert':
      if (!params || typeof params !== 'object') {
        errors.push('assert requires an object with url, text, or selector');
      } else {
        const hasUrl = params.url !== undefined;
        const hasText = params.text !== undefined;
        const hasSelector = params.selector !== undefined;
        if (!hasUrl && !hasText) {
          errors.push('assert requires url or text');
        }
        if (hasUrl && typeof params.url !== 'object') {
          errors.push('assert url must be an object (e.g., { contains: "..." })');
        }
        if (hasUrl && params.url && !params.url.contains && !params.url.equals && !params.url.startsWith && !params.url.endsWith && !params.url.matches) {
          errors.push('assert url requires contains, equals, startsWith, endsWith, or matches');
        }
        if (hasText && typeof params.text !== 'string') {
          errors.push('assert text must be a string');
        }
        if (hasSelector && typeof params.selector !== 'string') {
          errors.push('assert selector must be a string');
        }
      }
      break;

    case 'queryAll':
      if (!params || typeof params !== 'object') {
        errors.push('queryAll requires an object mapping names to selectors');
      } else {
        const entries = Object.entries(params);
        if (entries.length === 0) {
          errors.push('queryAll requires at least one query');
        }
        for (const [name, selector] of entries) {
          if (typeof selector !== 'string' && typeof selector !== 'object') {
            errors.push(`queryAll "${name}" must be a selector string or query object`);
          }
        }
      }
      break;

    case 'switchToFrame':
      // Can be string (selector/name), number (index), or object
      if (params === null || params === undefined) {
        errors.push('switchToFrame requires a selector, index, or options object');
      }
      break;

    case 'switchToMainFrame':
      // No validation needed, params can be true or anything
      break;

    case 'listFrames':
      // No validation needed
      break;

    case 'drag':
      if (!params || typeof params !== 'object') {
        errors.push('drag requires an object with source and target');
      } else {
        if (!params.source) {
          errors.push('drag requires a source selector or coordinates');
        }
        if (!params.target) {
          errors.push('drag requires a target selector or coordinates');
        }
      }
      break;
  }

  return errors;
}

/**
 * Validate an array of step definitions
 * @param {Array<Object>} steps - Array of step definitions
 * @returns {{valid: boolean, errors: Array}}
 */
export function validateSteps(steps) {
  const invalidSteps = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const errors = validateStepInternal(step);
    if (errors.length > 0) {
      invalidSteps.push({ index: i, step, errors });
    }
  }

  if (invalidSteps.length > 0) {
    return { valid: false, errors: invalidSteps };
  }

  return { valid: true, errors: [] };
}

/**
 * Execute a single test step
 * @param {Object} deps - Dependencies
 * @param {Object} step - Step definition
 * @param {Object} [options] - Execution options
 * @returns {Promise<Object>}
 */
export async function executeStep(deps, step, options = {}) {
  const { pageController, elementLocator, inputEmulator, screenshotCapture } = deps;
  const startTime = Date.now();
  const stepTimeout = options.stepTimeout || 30000;
  const isOptional = step.optional === true;
  const debugMode = options.debug || false;
  const debugCapture = debugMode && screenshotCapture
    ? createDebugCapture(pageController.session, screenshotCapture, options.debugOptions || {})
    : null;

  const stepResult = {
    action: null,
    params: null,
    status: 'passed',
    duration: 0,
    error: null,
    warning: null,
    screenshot: null,
    output: null,
    debug: null
  };

  async function executeStepInternal() {
    // Check for ambiguous steps (multiple actions defined)
    const definedActions = STEP_TYPES.filter(type => step[type] !== undefined);
    if (definedActions.length === 0) {
      throw new Error(`Unknown step type: ${JSON.stringify(step)}`);
    }
    if (definedActions.length > 1) {
      throw new Error(`Ambiguous step: multiple actions defined (${definedActions.join(', ')}). Each step must have exactly one action.`);
    }

    if (step.goto !== undefined) {
      stepResult.action = 'goto';
      stepResult.params = { url: step.goto };
      await pageController.navigate(step.goto);
    } else if (step.delay !== undefined) {
      // Simple delay step: { "delay": 2000 }
      stepResult.action = 'delay';
      stepResult.params = { ms: step.delay };
      await sleep(step.delay);
    } else if (step.wait !== undefined) {
      stepResult.action = 'wait';
      stepResult.params = step.wait;
      // Support numeric value for simple delay: { "wait": 2000 }
      if (typeof step.wait === 'number') {
        await sleep(step.wait);
      } else {
        await executeWait(elementLocator, step.wait);
      }
    } else if (step.click !== undefined) {
      stepResult.action = 'click';
      stepResult.params = step.click;
      const clickResult = await executeClick(elementLocator, inputEmulator, deps.ariaSnapshot, step.click);
      if (clickResult) {
        // Build output object with all relevant info
        const output = { clicked: clickResult.clicked };

        // Handle stale ref warning
        if (clickResult.stale || clickResult.warning) {
          stepResult.warning = clickResult.warning;
          output.stale = clickResult.stale;
        }

        // Handle verify mode
        if (typeof step.click === 'object' && step.click.verify) {
          output.targetReceived = clickResult.targetReceived;
          if (!clickResult.targetReceived) {
            stepResult.warning = 'Click may have hit a different element';
          }
        }

        // Add navigation info (FR-008)
        if (clickResult.navigated !== undefined) {
          output.navigated = clickResult.navigated;
          if (clickResult.newUrl) {
            output.newUrl = clickResult.newUrl;
          }
        }

        // Add debug info (FR-005)
        if (clickResult.debug) {
          output.debug = clickResult.debug;
        }

        // Add coordinates for coordinate-based clicks (FR-064)
        if (clickResult.coordinates) {
          output.coordinates = clickResult.coordinates;
        }

        stepResult.output = output;
      }
    } else if (step.fill !== undefined) {
      stepResult.action = 'fill';
      stepResult.params = step.fill;
      const fillExecutor = createFillExecutor(
        elementLocator.session,
        elementLocator,
        inputEmulator,
        deps.ariaSnapshot
      );
      await fillExecutor.execute(step.fill);
    } else if (step.fillForm !== undefined) {
      stepResult.action = 'fillForm';
      stepResult.params = step.fillForm;
      const fillExecutor = createFillExecutor(
        elementLocator.session,
        elementLocator,
        inputEmulator,
        deps.ariaSnapshot
      );
      stepResult.output = await fillExecutor.executeBatch(step.fillForm);
    } else if (step.press !== undefined) {
      stepResult.action = 'press';
      stepResult.params = { key: step.press };
      // Validate key name and set warning if unknown
      const keyValidation = keyValidator.validate(step.press);
      if (keyValidation.warning) {
        stepResult.warning = keyValidation.warning;
      }
      // Support keyboard combos like "Control+a" or "Meta+Shift+Enter"
      if (typeof step.press === 'string' && step.press.includes('+')) {
        await inputEmulator.pressCombo(step.press);
      } else {
        await inputEmulator.press(step.press);
      }
    } else if (step.screenshot !== undefined) {
      stepResult.action = 'screenshot';
      stepResult.params = step.screenshot;
      const screenshotResult = await executeScreenshot(screenshotCapture, elementLocator, step.screenshot);
      stepResult.screenshot = screenshotResult.path;
      stepResult.output = screenshotResult;
    } else if (step.query !== undefined) {
      stepResult.action = 'query';
      stepResult.params = step.query;
      stepResult.output = await executeQuery(elementLocator, step.query);
    } else if (step.inspect !== undefined) {
      stepResult.action = 'inspect';
      stepResult.params = step.inspect;
      stepResult.output = await executeInspect(pageController, elementLocator, step.inspect);
    } else if (step.scroll !== undefined) {
      stepResult.action = 'scroll';
      stepResult.params = step.scroll;
      stepResult.output = await executeScroll(elementLocator, inputEmulator, pageController, step.scroll);
    } else if (step.console !== undefined) {
      stepResult.action = 'console';
      stepResult.params = step.console;
      stepResult.output = await executeConsole(deps.consoleCapture, step.console);
    } else if (step.pdf !== undefined) {
      stepResult.action = 'pdf';
      stepResult.params = step.pdf;
      const pdfResult = await executePdf(deps.pdfCapture, elementLocator, step.pdf);
      stepResult.output = pdfResult;
    } else if (step.eval !== undefined) {
      stepResult.action = 'eval';
      stepResult.params = step.eval;
      stepResult.output = await executeEval(pageController, step.eval);
    } else if (step.snapshot !== undefined) {
      stepResult.action = 'snapshot';
      stepResult.params = step.snapshot;
      stepResult.output = await executeSnapshot(deps.ariaSnapshot, step.snapshot);
    } else if (step.hover !== undefined) {
      stepResult.action = 'hover';
      stepResult.params = step.hover;
      await executeHover(elementLocator, inputEmulator, deps.ariaSnapshot, step.hover);
    } else if (step.viewport !== undefined) {
      stepResult.action = 'viewport';
      stepResult.params = step.viewport;
      const viewportResult = await pageController.setViewport(step.viewport);
      stepResult.output = viewportResult;
    } else if (step.cookies !== undefined) {
      stepResult.action = 'cookies';
      stepResult.params = step.cookies;
      stepResult.output = await executeCookies(deps.cookieManager, step.cookies);
    } else if (step.back !== undefined) {
      stepResult.action = 'back';
      stepResult.params = step.back;
      const backOptions = step.back === true ? {} : step.back;
      const entry = await pageController.goBack(backOptions);
      stepResult.output = entry ? { url: entry.url, title: entry.title } : { noHistory: true };
    } else if (step.forward !== undefined) {
      stepResult.action = 'forward';
      stepResult.params = step.forward;
      const forwardOptions = step.forward === true ? {} : step.forward;
      const entry = await pageController.goForward(forwardOptions);
      stepResult.output = entry ? { url: entry.url, title: entry.title } : { noHistory: true };
    } else if (step.waitForNavigation !== undefined) {
      stepResult.action = 'waitForNavigation';
      stepResult.params = step.waitForNavigation;
      await executeWaitForNavigation(pageController, step.waitForNavigation);
    } else if (step.listTabs !== undefined) {
      stepResult.action = 'listTabs';
      stepResult.params = step.listTabs;
      stepResult.output = await executeListTabs(deps.browser);
    } else if (step.closeTab !== undefined) {
      stepResult.action = 'closeTab';
      stepResult.params = { targetId: step.closeTab };
      stepResult.output = await executeCloseTab(deps.browser, step.closeTab);
    } else if (step.type !== undefined) {
      stepResult.action = 'type';
      stepResult.params = step.type;
      const keyboardExecutor = createKeyboardExecutor(
        elementLocator.session,
        elementLocator,
        inputEmulator
      );
      stepResult.output = await keyboardExecutor.executeType(step.type);
    } else if (step.select !== undefined) {
      stepResult.action = 'select';
      stepResult.params = step.select;
      const keyboardExecutor = createKeyboardExecutor(
        elementLocator.session,
        elementLocator,
        inputEmulator
      );
      stepResult.output = await keyboardExecutor.executeSelect(step.select);
    } else if (step.validate !== undefined) {
      stepResult.action = 'validate';
      stepResult.params = step.validate;
      stepResult.output = await executeValidate(elementLocator, step.validate);
    } else if (step.submit !== undefined) {
      stepResult.action = 'submit';
      stepResult.params = step.submit;
      stepResult.output = await executeSubmit(elementLocator, step.submit);
    } else if (step.assert !== undefined) {
      stepResult.action = 'assert';
      stepResult.params = step.assert;
      stepResult.output = await executeAssert(pageController, elementLocator, step.assert);
    } else if (step.queryAll !== undefined) {
      stepResult.action = 'queryAll';
      stepResult.params = step.queryAll;
      stepResult.output = await executeQueryAll(elementLocator, step.queryAll);
    } else if (step.switchToFrame !== undefined) {
      stepResult.action = 'switchToFrame';
      stepResult.params = step.switchToFrame;
      stepResult.output = await pageController.switchToFrame(step.switchToFrame);
    } else if (step.switchToMainFrame !== undefined) {
      stepResult.action = 'switchToMainFrame';
      stepResult.params = step.switchToMainFrame;
      stepResult.output = await pageController.switchToMainFrame();
    } else if (step.listFrames !== undefined) {
      stepResult.action = 'listFrames';
      stepResult.params = step.listFrames;
      stepResult.output = await pageController.getFrameTree();
    } else if (step.drag !== undefined) {
      stepResult.action = 'drag';
      stepResult.params = step.drag;
      stepResult.output = await executeDrag(elementLocator, inputEmulator, pageController, step.drag);
    }
  }

  try {
    const stepPromise = executeStepInternal();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(timeoutError(`Step timed out after ${stepTimeout}ms`, stepTimeout));
      }, stepTimeout);
    });

    // Debug: capture before state
    if (debugCapture && stepResult.action) {
      try {
        stepResult.debug = { before: await debugCapture.captureBefore(stepResult.action, stepResult.params) };
      } catch (e) {
        stepResult.debug = { beforeError: e.message };
      }
    }

    await Promise.race([stepPromise, timeoutPromise]);

    // Debug: capture after state on success
    if (debugCapture && stepResult.action) {
      try {
        stepResult.debug = stepResult.debug || {};
        stepResult.debug.after = await debugCapture.captureAfter(stepResult.action, stepResult.params, 'passed');
      } catch (e) {
        stepResult.debug = stepResult.debug || {};
        stepResult.debug.afterError = e.message;
      }
    }
  } catch (error) {
    // Debug: capture after state on failure
    if (debugCapture && stepResult.action) {
      try {
        stepResult.debug = stepResult.debug || {};
        stepResult.debug.after = await debugCapture.captureAfter(stepResult.action, stepResult.params, 'failed');
      } catch (e) {
        stepResult.debug = stepResult.debug || {};
        stepResult.debug.afterError = e.message;
      }
    }

    if (isOptional) {
      stepResult.status = 'skipped';
      stepResult.error = `${error.message} (timeout: ${stepTimeout}ms)`;
    } else {
      stepResult.status = 'failed';
      stepResult.error = error.message;
    }
  }

  stepResult.duration = Date.now() - startTime;
  return stepResult;
}

async function executeWait(elementLocator, params) {
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
async function executeWaitForNavigation(pageController, params) {
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

async function executeClick(elementLocator, inputEmulator, ariaSnapshot, params) {
  // Delegate to ClickExecutor for improved click handling with JS fallback
  const clickExecutor = createClickExecutor(
    elementLocator.session,
    elementLocator,
    inputEmulator,
    ariaSnapshot
  );
  return clickExecutor.execute(params);
}

// Legacy implementation kept for reference
async function _legacyExecuteClick(elementLocator, inputEmulator, ariaSnapshot, params) {
  const selector = typeof params === 'string' ? params : params.selector;
  const ref = typeof params === 'object' ? params.ref : null;
  const verify = typeof params === 'object' && params.verify === true;
  let lastError = null;

  // Handle click by ref
  if (ref && ariaSnapshot) {
    const refInfo = await ariaSnapshot.getElementByRef(ref);
    if (!refInfo) {
      throw elementNotFoundError(`ref:${ref}`, 0);
    }
    // Check if element is stale (no longer in DOM)
    if (refInfo.stale) {
      return {
        clicked: false,
        stale: true,
        warning: `Element ref:${ref} is no longer attached to the DOM. Page content may have changed.`
      };
    }
    // Check if element is visible
    if (!refInfo.isVisible) {
      return {
        clicked: false,
        warning: `Element ref:${ref} exists but is not visible. It may be hidden or have zero dimensions.`
      };
    }
    // Click at center of element
    const x = refInfo.box.x + refInfo.box.width / 2;
    const y = refInfo.box.y + refInfo.box.height / 2;
    await inputEmulator.click(x, y);

    if (verify) {
      // For ref-based clicks with verify, return verification result
      return { clicked: true, targetReceived: true };
    }
    return { clicked: true };
  }

  for (const strategy of SCROLL_STRATEGIES) {
    const element = await elementLocator.findElement(selector);

    if (!element) {
      throw elementNotFoundError(selector, 0);
    }

    try {
      await element._handle.scrollIntoView({ block: strategy });
      await element._handle.waitForStability({ frames: 2, timeout: 2000 });

      const actionable = await element._handle.isActionable();
      if (!actionable.actionable) {
        await element._handle.dispose();
        lastError = new Error(`Element not actionable: ${actionable.reason}`);
        continue; // Try next scroll strategy
      }

      const box = await element._handle.getBoundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;

      if (verify) {
        const result = await clickWithVerification(elementLocator, inputEmulator, x, y, element._handle.objectId);
        await element._handle.dispose();
        return result;
      }

      await inputEmulator.click(x, y);
      await element._handle.dispose();
      return; // Success
    } catch (e) {
      await element._handle.dispose();
      lastError = e;
      if (strategy === SCROLL_STRATEGIES[SCROLL_STRATEGIES.length - 1]) {
        // Reset input state before throwing to prevent subsequent operation timeouts
        await resetInputState(elementLocator.session);
        throw e; // Last strategy failed
      }
    }
  }

  if (lastError) {
    // Reset input state before throwing to prevent subsequent operation timeouts
    await resetInputState(elementLocator.session);
    throw lastError;
  }
}

async function clickWithVerification(elementLocator, inputEmulator, x, y, targetObjectId) {
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

async function executeFill(elementLocator, inputEmulator, params) {
  const { selector, value, react } = params;

  if (!selector || value === undefined) {
    throw new Error('Fill requires selector and value');
  }

  const element = await elementLocator.findElement(selector);
  if (!element) {
    throw elementNotFoundError(selector, 0);
  }

  // Validate element is editable before attempting fill
  const validator = createElementValidator(elementLocator.session);
  const editableCheck = await validator.isEditable(element._handle.objectId);
  if (!editableCheck.editable) {
    await element._handle.dispose();
    throw elementNotEditableError(selector, editableCheck.reason);
  }

  // Try fast path first - scroll to center with short stability check
  let actionable;
  try {
    await element._handle.scrollIntoView({ block: 'center' });
    // Use short stability timeout - most elements stabilize quickly
    await element._handle.waitForStability({ frames: 2, timeout: 300 });
    actionable = await element._handle.isActionable();
  } catch (e) {
    // Stability check failed, check actionability anyway
    actionable = await element._handle.isActionable();
  }

  // If not actionable, try alternative scroll strategies
  if (!actionable.actionable) {
    let lastError = new Error(`Element not actionable: ${actionable.reason}`);

    for (const strategy of ['end', 'start', 'nearest']) {
      try {
        await element._handle.scrollIntoView({ block: strategy });
        await element._handle.waitForStability({ frames: 2, timeout: 500 });
        actionable = await element._handle.isActionable();

        if (actionable.actionable) break;
        lastError = new Error(`Element not actionable: ${actionable.reason}`);
      } catch (e) {
        lastError = e;
      }
    }

    if (!actionable.actionable) {
      await element._handle.dispose();
      await resetInputState(elementLocator.session);
      throw lastError;
    }
  }

  try {
    // Use React-specific fill approach if react option is set
    if (react) {
      const reactFiller = createReactInputFiller(elementLocator.session);
      await reactFiller.fillByObjectId(element._handle.objectId, value);
      return; // Success
    }

    // Standard fill approach using keyboard events
    const box = await element._handle.getBoundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // Click to focus
    await inputEmulator.click(x, y);

    // Focus element directly - more reliable than relying on click
    await element._handle.focus();

    if (params.clear !== false) {
      await inputEmulator.selectAll();
    }

    await inputEmulator.type(String(value));
  } catch (e) {
    await resetInputState(elementLocator.session);
    throw e;
  } finally {
    await element._handle.dispose();
  }
}

async function executeScreenshot(screenshotCapture, elementLocator, params) {
  const rawPath = typeof params === 'string' ? params : params.path;
  const options = typeof params === 'object' ? params : {};

  // Resolve path - relative paths go to platform temp directory
  const format = options.format || 'png';
  const resolvedPath = await resolveTempPath(rawPath, `.${format}`);

  // Get viewport dimensions before capturing
  const viewport = await screenshotCapture.getViewportDimensions();

  // Pass elementLocator for element screenshots
  const savedPath = await screenshotCapture.captureToFile(resolvedPath, options, elementLocator);

  // Return metadata including viewport dimensions
  return {
    path: savedPath,
    viewport,
    format,
    fullPage: options.fullPage || false,
    selector: options.selector || null
  };
}

/**
 * Execute a PDF generation step
 * Supports element PDF via selector option (FR-060)
 * Returns metadata including file size, page count, dimensions (FR-059)
 * Supports validation option (FR-061)
 */
async function executePdf(pdfCapture, elementLocator, params) {
  if (!pdfCapture) {
    throw new Error('PDF capture not available');
  }

  const rawPath = typeof params === 'string' ? params : params.path;
  const options = typeof params === 'object' ? params : {};

  // Resolve path - relative paths go to platform temp directory
  const resolvedPath = await resolveTempPath(rawPath, '.pdf');

  // Pass elementLocator for element PDFs
  return pdfCapture.saveToFile(resolvedPath, options, elementLocator);
}

/**
 * Execute an eval step - executes JavaScript in the page context
 * Enhanced with serialization for non-JSON values (FR-039, FR-040, FR-041)
 * and optional timeout for async operations (FR-042)
 */
async function executeEval(pageController, params) {
  const expression = typeof params === 'string' ? params : params.expression;
  const awaitPromise = typeof params === 'object' && params.await === true;
  const serialize = typeof params === 'object' && params.serialize !== false;
  const evalTimeout = typeof params === 'object' && typeof params.timeout === 'number' ? params.timeout : null;

  // Validate the expression
  if (!expression || typeof expression !== 'string') {
    throw new Error('Eval requires a non-empty expression string');
  }

  // Check for common shell escaping issues
  const hasUnbalancedQuotes = (expression.match(/"/g) || []).length % 2 !== 0 ||
                              (expression.match(/'/g) || []).length % 2 !== 0;
  const hasUnbalancedBraces = (expression.match(/\{/g) || []).length !== (expression.match(/\}/g) || []).length;
  const hasUnbalancedParens = (expression.match(/\(/g) || []).length !== (expression.match(/\)/g) || []).length;

  if (hasUnbalancedQuotes || hasUnbalancedBraces || hasUnbalancedParens) {
    const issues = [];
    if (hasUnbalancedQuotes) issues.push('unbalanced quotes');
    if (hasUnbalancedBraces) issues.push('unbalanced braces {}');
    if (hasUnbalancedParens) issues.push('unbalanced parentheses ()');

    throw new Error(
      `Eval expression appears malformed (${issues.join(', ')}). ` +
      `This often happens due to shell escaping. Expression preview: "${expression.substring(0, 100)}${expression.length > 100 ? '...' : ''}". ` +
      `Tip: Use heredoc syntax or a JSON file to pass complex expressions.`
    );
  }

  // Build the wrapped expression for serialization
  let wrappedExpression;
  if (serialize) {
    // Use EvalSerializer for enhanced value handling
    const evalSerializer = createEvalSerializer();
    const serializerFn = evalSerializer.getSerializationFunction();
    wrappedExpression = `(${serializerFn})(${expression})`;
  } else {
    wrappedExpression = expression;
  }

  // Create the eval promise
  const evalPromise = pageController.session.send('Runtime.evaluate', {
    expression: wrappedExpression,
    returnByValue: true,
    awaitPromise
  });

  // Apply timeout if specified (FR-042)
  let result;
  if (evalTimeout !== null && evalTimeout > 0) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Eval timed out after ${evalTimeout}ms`));
      }, evalTimeout);
    });
    result = await Promise.race([evalPromise, timeoutPromise]);
  } else {
    result = await evalPromise;
  }

  if (result.exceptionDetails) {
    const errorText = result.exceptionDetails.exception?.description ||
                      result.exceptionDetails.text ||
                      'Unknown eval error';

    // Provide more context for syntax errors
    if (errorText.includes('SyntaxError')) {
      throw new Error(
        `Eval syntax error: ${errorText}. ` +
        `Expression was: "${expression.substring(0, 150)}${expression.length > 150 ? '...' : ''}". ` +
        `Tip: Check for shell escaping issues or use a JSON file for complex expressions.`
      );
    }

    throw new Error(`Eval error: ${errorText}`);
  }

  // Process serialized result if serialization was used
  if (serialize && result.result.value && typeof result.result.value === 'object') {
    const evalSerializer = createEvalSerializer();
    return evalSerializer.processResult(result.result.value);
  }

  return {
    value: result.result.value,
    type: result.result.type
  };
}

/**
 * Execute a snapshot step - generates accessibility tree snapshot
 */
async function executeSnapshot(ariaSnapshot, params) {
  if (!ariaSnapshot) {
    throw new Error('Aria snapshot not available');
  }

  const options = params === true ? {} : params;
  const result = await ariaSnapshot.generate(options);

  if (result.error) {
    throw new Error(result.error);
  }

  return {
    yaml: result.yaml,
    refs: result.refs,
    stats: result.stats
  };
}

/**
 * Execute a hover step - moves mouse over an element to trigger hover events
 * Uses Playwright-style auto-waiting for element to be visible and stable
 */
async function executeHover(elementLocator, inputEmulator, ariaSnapshot, params) {
  const selector = typeof params === 'string' ? params : params.selector;
  const ref = typeof params === 'object' ? params.ref : null;
  const duration = typeof params === 'object' ? (params.duration || 0) : 0;
  const force = typeof params === 'object' && params.force === true;
  const timeout = typeof params === 'object' ? (params.timeout || 30000) : 30000;

  // Handle hover by ref
  if (ref && ariaSnapshot) {
    const refInfo = await ariaSnapshot.getElementByRef(ref);
    if (!refInfo) {
      throw elementNotFoundError(`ref:${ref}`, 0);
    }
    const x = refInfo.box.x + refInfo.box.width / 2;
    const y = refInfo.box.y + refInfo.box.height / 2;
    await inputEmulator.hover(x, y, { duration });
    return;
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
}

/**
 * Execute a drag operation from source to target
 * @param {Object} elementLocator - Element locator instance
 * @param {Object} inputEmulator - Input emulator instance
 * @param {Object} pageController - Page controller instance
 * @param {Object} params - Drag parameters
 * @returns {Promise<Object>} Drag result
 */
async function executeDrag(elementLocator, inputEmulator, pageController, params) {
  const { source, target, steps = 10, delay = 0 } = params;

  // Helper to get element bounding box in current frame context
  async function getElementBox(selector) {
    // Use page controller's frame context if available
    const contextId = pageController.currentExecutionContextId;
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

    // Add context ID if we're in a non-main frame
    if (contextId && pageController.currentFrameId !== pageController.mainFrameId) {
      evalParams.contextId = contextId;
    }

    const result = await elementLocator.session.send('Runtime.evaluate', evalParams);
    if (result.exceptionDetails) {
      throw new Error(`Selector error: ${result.exceptionDetails.text}`);
    }
    return result.result.value;
  }

  // Get source coordinates
  let sourceX, sourceY;
  if (typeof source === 'object' && typeof source.x === 'number' && typeof source.y === 'number') {
    sourceX = source.x;
    sourceY = source.y;
  } else {
    const sourceSelector = typeof source === 'string' ? source : source.selector;
    const box = await getElementBox(sourceSelector);
    if (!box) {
      throw elementNotFoundError(sourceSelector, 0);
    }
    sourceX = box.x + box.width / 2;
    sourceY = box.y + box.height / 2;
  }

  // Get target coordinates
  let targetX, targetY;
  if (typeof target === 'object' && typeof target.x === 'number' && typeof target.y === 'number') {
    targetX = target.x;
    targetY = target.y;
  } else {
    const targetSelector = typeof target === 'string' ? target : target.selector;
    const box = await getElementBox(targetSelector);
    if (!box) {
      throw elementNotFoundError(targetSelector, 0);
    }
    targetX = box.x + box.width / 2;
    targetY = box.y + box.height / 2;
  }

  // Perform the drag operation using CDP mouse events
  // Move to source
  await elementLocator.session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: sourceX,
    y: sourceY
  });

  // Press mouse button
  await elementLocator.session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: sourceX,
    y: sourceY,
    button: 'left',
    clickCount: 1,
    buttons: 1
  });

  if (delay > 0) {
    await sleep(delay);
  }

  // Move in steps for smoother drag
  const deltaX = (targetX - sourceX) / steps;
  const deltaY = (targetY - sourceY) / steps;

  for (let i = 1; i <= steps; i++) {
    const currentX = sourceX + deltaX * i;
    const currentY = sourceY + deltaY * i;

    await elementLocator.session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: currentX,
      y: currentY,
      buttons: 1
    });

    if (delay > 0) {
      await sleep(delay / steps);
    }
  }

  // Release mouse button
  await elementLocator.session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: targetX,
    y: targetY,
    button: 'left',
    clickCount: 1,
    buttons: 0
  });

  return {
    dragged: true,
    source: { x: sourceX, y: sourceY },
    target: { x: targetX, y: targetY },
    steps
  };
}

/**
 * Parse human-readable expiration string to Unix timestamp
 * Supports: "1h" (hours), "7d" (days), "30m" (minutes), "1w" (weeks), "1y" (years)
 * @param {string|number} expires - Expiration value
 * @returns {number} Unix timestamp in seconds
 */
function parseExpiration(expires) {
  if (typeof expires === 'number') {
    return expires;
  }

  if (typeof expires !== 'string') {
    return undefined;
  }

  const match = expires.match(/^(\d+)([mhdwy])$/i);
  if (!match) {
    // Try parsing as number string
    const num = parseInt(expires, 10);
    if (!isNaN(num)) return num;
    return undefined;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  switch (unit) {
    case 'm': return now + value * 60;           // minutes
    case 'h': return now + value * 60 * 60;      // hours
    case 'd': return now + value * 60 * 60 * 24; // days
    case 'w': return now + value * 60 * 60 * 24 * 7; // weeks
    case 'y': return now + value * 60 * 60 * 24 * 365; // years
    default: return undefined;
  }
}

/**
 * Execute a cookies step - get, set, or clear cookies
 */
async function executeCookies(cookieManager, params) {
  if (!cookieManager) {
    throw new Error('Cookie manager not available');
  }

  // Determine the action
  if (params.get !== undefined || params.action === 'get') {
    const urls = Array.isArray(params.get) ? params.get : (params.urls || []);
    let cookies = await cookieManager.getCookies(urls);

    // Filter by name if specified
    if (params.name) {
      const names = Array.isArray(params.name) ? params.name : [params.name];
      cookies = cookies.filter(c => names.includes(c.name));
    }

    return { action: 'get', cookies };
  }

  if (params.set !== undefined || params.action === 'set') {
    const cookies = params.set || params.cookies || [];
    if (!Array.isArray(cookies)) {
      throw new Error('cookies set requires an array of cookie objects');
    }

    // Process cookies to convert human-readable expires values
    const processedCookies = cookies.map(cookie => {
      const processed = { ...cookie };
      if (processed.expires !== undefined) {
        processed.expires = parseExpiration(processed.expires);
      }
      return processed;
    });

    await cookieManager.setCookies(processedCookies);
    return { action: 'set', count: processedCookies.length };
  }

  if (params.clear !== undefined || params.action === 'clear') {
    const urls = Array.isArray(params.clear) ? params.clear : [];
    const result = await cookieManager.clearCookies(urls);
    return { action: 'clear', count: result.count };
  }

  if (params.delete !== undefined || params.action === 'delete') {
    const names = params.delete || params.names;
    if (!names) {
      throw new Error('cookies delete requires cookie name(s)');
    }
    const options = {};
    if (params.domain) options.domain = params.domain;
    if (params.path) options.path = params.path;
    const result = await cookieManager.deleteCookies(names, options);
    return { action: 'delete', count: result.count };
  }

  throw new Error('cookies requires action: get, set, clear, or delete');
}

/**

/**
 * Execute a query step - finds elements and returns info about them
 * Supports both CSS selectors and role-based queries
 *
 * Features:
 * - FR-016: Text cleanup with clean option
 * - FR-017: Multiple output modes via array
 * - FR-018: Attribute output via object
 * - FR-019: Element metadata in results
 */
async function executeQuery(elementLocator, params) {
  // Check if this is a role-based query
  if (typeof params === 'object' && params.role) {
    return executeRoleQuery(elementLocator, params);
  }

  const selector = typeof params === 'string' ? params : params.selector;
  const limit = (typeof params === 'object' && params.limit) || 10;
  const output = (typeof params === 'object' && params.output) || 'text';
  const clean = typeof params === 'object' && params.clean === true;
  const metadata = typeof params === 'object' && params.metadata === true;

  const elements = await elementLocator.querySelectorAll(selector);
  const outputProcessor = createQueryOutputProcessor(elementLocator.session);
  const results = [];

  const count = Math.min(elements.length, limit);
  for (let i = 0; i < count; i++) {
    const el = elements[i];
    try {
      const resultItem = {
        index: i + 1,
        value: await outputProcessor.processOutput(el, output, { clean })
      };

      // Add element metadata if requested (FR-019)
      if (metadata) {
        resultItem.metadata = await outputProcessor.getElementMetadata(el);
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
    selector,
    total: elements.length,
    showing: count,
    results
  };
}

/**
 * Execute a role-based query - finds elements by ARIA role
 * Supported roles: button, textbox, checkbox, link, heading, listitem, option, combobox
 *
 * Features:
 * - FR-020: Role level filter for headings
 * - FR-021: Compound role queries (array of roles)
 * - FR-055: Exact match option (nameExact)
 * - FR-056: Regex support (nameRegex)
 * - FR-057: Element refs in results
 * - FR-058: Count-only mode
 */
async function executeRoleQuery(elementLocator, params) {
  const roleQueryExecutor = createRoleQueryExecutor(elementLocator.session, elementLocator);
  return roleQueryExecutor.execute(params);
}

async function executeInspect(pageController, elementLocator, params) {
  const info = {
    title: await pageController.getTitle(),
    url: await pageController.getUrl()
  };

  // Count common element types
  const counts = {};
  const selectors = ['a', 'button', 'input', 'textarea', 'select', 'h1', 'h2', 'h3', 'img', 'form'];

  for (const sel of selectors) {
    try {
      const els = await elementLocator.querySelectorAll(sel);
      counts[sel] = els.length;
      for (const el of els) {
        try { await el.dispose(); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      counts[sel] = 0;
    }
  }

  info.elements = counts;

  // If specific selectors requested with optional limit for showing values
  if (typeof params === 'object' && params.selectors) {
    info.custom = {};
    const limit = params.limit || 0;

    for (const sel of params.selectors) {
      try {
        const els = await elementLocator.querySelectorAll(sel);
        const count = els.length;

        if (limit > 0 && count > 0) {
          const values = [];
          const showCount = Math.min(count, limit);
          for (let i = 0; i < showCount; i++) {
            try {
              const text = await els[i].evaluate(
                `function() { return this.textContent ? this.textContent.trim().substring(0, 100) : ''; }`
              );
              values.push(text);
            } catch (e) {
              values.push(null);
            }
          }
          info.custom[sel] = { count, values };
        } else {
          info.custom[sel] = count;
        }

        for (const el of els) {
          try { await el.dispose(); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        info.custom[sel] = 0;
      }
    }
  }

  return info;
}

/**
 * Execute a listTabs step - returns all open browser tabs
 */
async function executeListTabs(browser) {
  if (!browser) {
    throw new Error('Browser not available for listTabs');
  }

  const pages = await browser.getPages();
  const tabs = pages.map(page => ({
    targetId: page.targetId,
    url: page.url,
    title: page.title
  }));

  return {
    count: tabs.length,
    tabs
  };
}

/**
 * Execute a closeTab step - closes a browser tab by targetId
 */
async function executeCloseTab(browser, targetId) {
  if (!browser) {
    throw new Error('Browser not available for closeTab');
  }

  await browser.closePage(targetId);
  return { closed: targetId };
}

/**
 * Format a stack trace for output
 * @param {Object} stackTrace - CDP stack trace object
 * @returns {Array|null} Formatted stack frames or null
 */
function formatStackTrace(stackTrace) {
  if (!stackTrace || !stackTrace.callFrames) {
    return null;
  }

  return stackTrace.callFrames.map(frame => ({
    functionName: frame.functionName || '(anonymous)',
    url: frame.url || null,
    lineNumber: frame.lineNumber,
    columnNumber: frame.columnNumber
  }));
}

/**
 * Execute a console step - retrieves browser console logs
 *
 * Note: Console logs are captured from the moment startCapture() is called
 * (typically at session start). Logs do NOT persist across separate CLI invocations.
 * Each invocation starts with an empty log buffer.
 */
async function executeConsole(consoleCapture, params) {
  if (!consoleCapture) {
    return { error: 'Console capture not available', messages: [] };
  }

  const limit = (typeof params === 'object' && params.limit) || 50;
  const level = typeof params === 'object' ? params.level : null;
  const type = typeof params === 'object' ? params.type : null;
  const since = typeof params === 'object' ? params.since : null;
  const clear = typeof params === 'object' && params.clear === true;
  const includeStackTrace = typeof params === 'object' && params.stackTrace === true;

  let messages;
  // FR-036: Filter by type (console vs exception)
  if (type) {
    messages = consoleCapture.getMessagesByType(type);
  } else if (level) {
    messages = consoleCapture.getMessagesByLevel(level);
  } else {
    messages = consoleCapture.getMessages();
  }

  // FR-038: Filter by "since" timestamp
  if (since) {
    messages = messages.filter(m => m.timestamp >= since);
  }

  // Get the most recent messages up to limit
  const recentMessages = messages.slice(-limit);

  // Format messages for output
  const formatted = recentMessages.map(m => {
    const formatted = {
      level: m.level,
      text: m.text ? m.text.substring(0, 500) : '',
      type: m.type,
      url: m.url || null,
      line: m.line || null,
      timestamp: m.timestamp || null
    };

    // Include stack trace if requested
    if (includeStackTrace && m.stackTrace) {
      formatted.stackTrace = formatStackTrace(m.stackTrace);
    }

    return formatted;
  });

  if (clear) {
    consoleCapture.clear();
  }

  return {
    total: messages.length,
    showing: formatted.length,
    messages: formatted
  };
}

/**
 * Execute a scroll step
 */
async function executeScroll(elementLocator, inputEmulator, pageController, params) {
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
        await inputEmulator.scroll(0, -300, 400, 300);
        break;
      case 'down':
        await inputEmulator.scroll(0, 300, 400, 300);
        break;
      default:
        // Treat as selector - scroll element into view
        const el = await elementLocator.querySelector(params);
        if (!el) {
          throw elementNotFoundError(params, 0);
        }
        await el.scrollIntoView();
        await el.dispose();
    }
  } else if (params && typeof params === 'object') {
    if (params.selector) {
      // Scroll to element
      const el = await elementLocator.querySelector(params.selector);
      if (!el) {
        throw elementNotFoundError(params.selector, 0);
      }
      await el.scrollIntoView();
      await el.dispose();
    } else if (params.deltaY !== undefined || params.deltaX !== undefined) {
      // Scroll by delta
      const x = params.x || 400;
      const y = params.y || 300;
      await inputEmulator.scroll(params.deltaX || 0, params.deltaY || 0, x, y);
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

/**
 * Run an array of test steps
 * @param {Object} deps - Dependencies
 * @param {Array<Object>} steps - Array of step definitions
 * @param {Object} [options] - Execution options
 * @param {boolean} [options.stopOnError=true] - Stop on first error
 * @param {number} [options.stepTimeout=30000] - Timeout per step
 * @returns {Promise<{status: string, steps: Array, errors: Array, screenshots: Array}>}
 */
export async function runSteps(deps, steps, options = {}) {
  const validation = validateSteps(steps);
  if (!validation.valid) {
    throw stepValidationError(validation.errors);
  }

  const stopOnError = options.stopOnError !== false;
  const result = {
    status: 'passed',
    steps: [],
    errors: [],
    screenshots: [],
    outputs: []
  };

  for (const step of steps) {
    const stepResult = await executeStep(deps, step, options);
    result.steps.push(stepResult);

    if (stepResult.screenshot) {
      result.screenshots.push(stepResult.screenshot);
    }

    if (stepResult.output) {
      result.outputs.push({
        step: result.steps.length,
        action: stepResult.action,
        output: stepResult.output
      });
    }

    if (stepResult.status === 'failed') {
      result.status = 'failed';
      result.errors.push({
        step: result.steps.length,
        action: stepResult.action,
        error: stepResult.error
      });

      if (stopOnError) {
        break;
      }
    }
    // 'skipped' (optional) steps don't fail the run
  }

  return result;
}

/**
 * Create a test runner with bound dependencies
 * @param {Object} deps - Dependencies
 * @returns {Object} Test runner interface
 */
export function createTestRunner(deps) {
  const { pageController, elementLocator, inputEmulator, screenshotCapture } = deps;

  return {
    validateSteps,
    executeStep: (step, options) => executeStep(deps, step, options),
    run: (steps, options) => runSteps(deps, steps, options)
  };
}

/**
 * Execute a validate step - query validation state of an element
 */
async function executeValidate(elementLocator, selector) {
  const formValidator = createFormValidator(elementLocator.session, elementLocator);
  return formValidator.validateElement(selector);
}

/**
 * Execute a submit step - submit a form with validation error reporting
 */
async function executeSubmit(elementLocator, params) {
  const selector = typeof params === 'string' ? params : params.selector;
  const options = typeof params === 'object' ? params : {};

  const formValidator = createFormValidator(elementLocator.session, elementLocator);
  return formValidator.submitForm(selector, options);
}

/**
 * Execute an assert step - validates conditions about the page
 * Supports URL assertions and text assertions
 */
async function executeAssert(pageController, elementLocator, params) {
  const result = {
    passed: true,
    assertions: []
  };

  // URL assertion
  if (params.url) {
    const currentUrl = await pageController.getUrl();
    const urlAssertion = { type: 'url', actual: currentUrl };

    if (params.url.contains) {
      urlAssertion.expected = { contains: params.url.contains };
      urlAssertion.passed = currentUrl.includes(params.url.contains);
    } else if (params.url.equals) {
      urlAssertion.expected = { equals: params.url.equals };
      urlAssertion.passed = currentUrl === params.url.equals;
    } else if (params.url.startsWith) {
      urlAssertion.expected = { startsWith: params.url.startsWith };
      urlAssertion.passed = currentUrl.startsWith(params.url.startsWith);
    } else if (params.url.endsWith) {
      urlAssertion.expected = { endsWith: params.url.endsWith };
      urlAssertion.passed = currentUrl.endsWith(params.url.endsWith);
    } else if (params.url.matches) {
      urlAssertion.expected = { matches: params.url.matches };
      const regex = new RegExp(params.url.matches);
      urlAssertion.passed = regex.test(currentUrl);
    }

    result.assertions.push(urlAssertion);
    if (!urlAssertion.passed) {
      result.passed = false;
    }
  }

  // Text assertion
  if (params.text) {
    const selector = params.selector || 'body';
    const caseSensitive = params.caseSensitive !== false;
    const textAssertion = { type: 'text', expected: params.text, selector };

    try {
      // Get the text content of the target element
      const textResult = await pageController.session.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            return el ? el.textContent : null;
          })()
        `,
        returnByValue: true
      });

      const actualText = textResult.result.value;
      textAssertion.found = actualText !== null;

      if (actualText === null) {
        textAssertion.passed = false;
        textAssertion.error = `Element not found: ${selector}`;
      } else {
        if (caseSensitive) {
          textAssertion.passed = actualText.includes(params.text);
        } else {
          textAssertion.passed = actualText.toLowerCase().includes(params.text.toLowerCase());
        }
        textAssertion.actualLength = actualText.length;
      }
    } catch (e) {
      textAssertion.passed = false;
      textAssertion.error = e.message;
    }

    result.assertions.push(textAssertion);
    if (!textAssertion.passed) {
      result.passed = false;
    }
  }

  // Throw error if assertion failed (makes the step fail)
  if (!result.passed) {
    const failedAssertions = result.assertions.filter(a => !a.passed);
    const messages = failedAssertions.map(a => {
      if (a.type === 'url') {
        return `URL assertion failed: expected ${JSON.stringify(a.expected)}, actual "${a.actual}"`;
      } else if (a.type === 'text') {
        if (a.error) return `Text assertion failed: ${a.error}`;
        return `Text assertion failed: "${a.expected}" not found in ${a.selector}`;
      }
      return 'Assertion failed';
    });
    throw new Error(messages.join('; '));
  }

  return result;
}

/**
 * Execute a queryAll step - runs multiple queries and returns results
 * @param {Object} elementLocator - Element locator
 * @param {Object} params - Object mapping names to selectors
 * @returns {Promise<Object>} Results keyed by query name
 */
async function executeQueryAll(elementLocator, params) {
  const results = {};

  for (const [name, selectorOrConfig] of Object.entries(params)) {
    // Support both string selectors and query config objects
    const queryParams = typeof selectorOrConfig === 'string'
      ? selectorOrConfig
      : selectorOrConfig;

    try {
      results[name] = await executeQuery(elementLocator, queryParams);
    } catch (e) {
      results[name] = { error: e.message };
    }
  }

  return results;
}
