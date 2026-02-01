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
  createEvalSerializer
} from './capture.js';

import {
  createSnapshotDiffer,
  createContextCapture
} from './diff.js';

import { sleep, resetInputState, releaseObject, resolveTempPath, generateTempPath, getCurrentUrl } from './utils.js';
import fs from 'fs/promises';

const keyValidator = createKeyValidator();

const STEP_TYPES = ['goto', 'wait', 'click', 'fill', 'fillForm', 'press', 'query', 'queryAll', 'inspect', 'scroll', 'console', 'pdf', 'eval', 'snapshot', 'hover', 'viewport', 'cookies', 'back', 'forward', 'waitForNavigation', 'listTabs', 'closeTab', 'openTab', 'type', 'select', 'selectOption', 'validate', 'submit', 'assert', 'switchToFrame', 'switchToMainFrame', 'listFrames', 'drag', 'formState', 'extract', 'getDom', 'getBox', 'fillActive', 'refAt', 'elementsAt', 'elementsNear'];

// Feature 7: Visual actions that trigger auto-screenshot
// Actions that should capture a screenshot - anything that interacts with or queries the visible page
const VISUAL_ACTIONS = [
  'goto', 'click', 'fill', 'fillForm', 'type', 'hover', 'press', 'scroll', 'wait',  // interactions
  'snapshot', 'query', 'queryAll', 'inspect', 'eval', 'extract', 'formState',  // queries
  'drag', 'select', 'selectOption', 'validate', 'submit', 'assert',  // other page interactions
  'openTab'  // navigation actions - behave like goto for auto-snapshot
];

/**
 * Build action context string for diff summary (Feature 8.1)
 * Creates a human-readable description of what action was taken
 * @param {string} action - Action type (click, scroll, etc.)
 * @param {*} params - Action parameters
 * @param {Object} context - Page context (scroll, focused, etc.)
 * @returns {string} Action context description
 */
function buildActionContext(action, params, context) {
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
 * Build command context string for diff summary (Feature 8.1)
 * Summarizes what a multi-step command did for the diff output
 * @param {Array<Object>} steps - Array of step definitions
 * @returns {string} Human-readable summary of the command
 */
function buildCommandContext(steps) {
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
 * Capture failure context for debugging (Feature 8)
 * Gathers page info when a step fails to aid debugging
 * @param {Object} deps - Dependencies (pageController, etc.)
 * @returns {Promise<Object>} Context information
 */
async function captureFailureContext(deps) {
  const { pageController } = deps;
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
    // Get visible buttons (limit 5)
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
            .slice(0, 5)
            .map(b => ({
              text: (b.textContent || b.value || '').trim().substring(0, 50),
              selector: b.id ? '#' + b.id : (b.className ? b.tagName.toLowerCase() + '.' + b.className.split(' ')[0] : b.tagName.toLowerCase())
            }));
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

  return context;
}

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

    case 'click':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('click selector cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        // Check for coordinate-based click (FR-064)
        const hasCoordinates = typeof params.x === 'number' && typeof params.y === 'number';
        // Check for text-based click (Feature 5)
        const hasText = typeof params.text === 'string';
        // Check for multi-selector fallback (Feature 1)
        const hasSelectors = Array.isArray(params.selectors);
        if (!params.selector && !params.ref && !hasCoordinates && !hasText && !hasSelectors) {
          errors.push('click requires selector, ref, text, selectors array, or x/y coordinates');
        } else if (params.selector && typeof params.selector !== 'string') {
          errors.push('click selector must be a string');
        } else if (params.ref && typeof params.ref !== 'string') {
          errors.push('click ref must be a string');
        } else if (hasText && params.text.length === 0) {
          errors.push('click text cannot be empty');
        } else if (hasSelectors && params.selectors.length === 0) {
          errors.push('click selectors array cannot be empty');
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
        errors.push('fill requires an object with selector/ref/label and value');
      } else {
        if (!params.selector && !params.ref && !params.label) {
          errors.push('fill requires selector, ref, or label');
        } else if (params.selector && typeof params.selector !== 'string') {
          errors.push('fill selector must be a string');
        } else if (params.ref && typeof params.ref !== 'string') {
          errors.push('fill ref must be a string');
        } else if (params.label && typeof params.label !== 'string') {
          errors.push('fill label must be a string');
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

    case 'openTab':
      // openTab can be:
      // - true: just open a blank tab
      // - string: open tab and navigate to URL
      // - object with options: {url: "...", viewport: {...}}
      if (params !== true && typeof params !== 'string' && (typeof params !== 'object' || params === null)) {
        errors.push('openTab must be true, a URL string, or an options object');
      }
      if (typeof params === 'object' && params !== null && params.url !== undefined && typeof params.url !== 'string') {
        errors.push('openTab url must be a string');
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

    case 'formState':
      if (typeof params !== 'string' && (!params || !params.selector)) {
        errors.push('formState requires a selector string or object with selector');
      }
      break;

    case 'extract':
      if (typeof params !== 'string' && (!params || !params.selector)) {
        errors.push('extract requires a selector string or object with selector');
      }
      break;

    case 'selectOption':
      // selectOption: {"selector": "#dropdown", "value": "optionValue"}
      // or: {"selector": "#dropdown", "label": "Option Text"}
      // or: {"selector": "#dropdown", "index": 2}
      if (!params || typeof params !== 'object') {
        errors.push('selectOption requires an object with selector and value/label/index');
      } else {
        if (!params.selector) {
          errors.push('selectOption requires selector');
        }
        if (params.value === undefined && params.label === undefined && params.index === undefined && !params.values) {
          errors.push('selectOption requires value, label, index, or values');
        }
      }
      break;

    case 'getDom':
      // getDom: true (full page) or selector string or object with selector
      if (params !== true && typeof params !== 'string' && (typeof params !== 'object' || params === null)) {
        errors.push('getDom requires true, a selector string, or an options object');
      }
      if (typeof params === 'object' && params !== null && params.selector && typeof params.selector !== 'string') {
        errors.push('getDom selector must be a string');
      }
      break;

    case 'getBox':
      // getBox: "e1" or ["e1", "e2"] or {"refs": ["e1", "e2"]}
      if (typeof params === 'string') {
        if (!/^e\d+$/.test(params)) {
          errors.push('getBox ref must be in format "eN" (e.g., "e1", "e12")');
        }
      } else if (Array.isArray(params)) {
        if (params.length === 0) {
          errors.push('getBox refs array cannot be empty');
        }
        for (const ref of params) {
          if (typeof ref !== 'string' || !/^e\d+$/.test(ref)) {
            errors.push('getBox refs must be strings in format "eN"');
            break;
          }
        }
      } else if (typeof params === 'object' && params !== null) {
        if (!params.refs && !params.ref) {
          errors.push('getBox requires ref or refs');
        }
      } else {
        errors.push('getBox requires a ref string, array of refs, or options object');
      }
      break;

    case 'fillActive':
      // fillActive: "text" or {"value": "text", "clear": true}
      if (typeof params === 'string') {
        // Simple string value is fine
      } else if (typeof params === 'object' && params !== null) {
        if (params.value === undefined) {
          errors.push('fillActive requires value');
        }
      } else {
        errors.push('fillActive requires a string value or options object with value');
      }
      break;

    case 'refAt':
      // refAt: {"x": 100, "y": 200}
      if (!params || typeof params !== 'object') {
        errors.push('refAt requires an object with x and y coordinates');
      } else {
        if (typeof params.x !== 'number') {
          errors.push('refAt requires x coordinate as a number');
        }
        if (typeof params.y !== 'number') {
          errors.push('refAt requires y coordinate as a number');
        }
      }
      break;

    case 'elementsAt':
      // elementsAt: [{"x": 100, "y": 200}, {"x": 300, "y": 400}]
      if (!Array.isArray(params)) {
        errors.push('elementsAt requires an array of {x, y} coordinates');
      } else if (params.length === 0) {
        errors.push('elementsAt array cannot be empty');
      } else {
        for (let i = 0; i < params.length; i++) {
          const coord = params[i];
          if (!coord || typeof coord !== 'object') {
            errors.push(`elementsAt[${i}] must be an object with x and y`);
          } else if (typeof coord.x !== 'number' || typeof coord.y !== 'number') {
            errors.push(`elementsAt[${i}] requires x and y as numbers`);
          }
        }
      }
      break;

    case 'elementsNear':
      // elementsNear: {"x": 100, "y": 200, "radius": 50}
      if (!params || typeof params !== 'object') {
        errors.push('elementsNear requires an object with x, y, and optional radius');
      } else {
        if (typeof params.x !== 'number') {
          errors.push('elementsNear requires x coordinate as a number');
        }
        if (typeof params.y !== 'number') {
          errors.push('elementsNear requires y coordinate as a number');
        }
        if (params.radius !== undefined && typeof params.radius !== 'number') {
          errors.push('elementsNear radius must be a number');
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
  const { pageController, elementLocator, inputEmulator } = deps;
  const stepTimeout = options.stepTimeout || 30000;
  const isOptional = step.optional === true;

  // Start with minimal result - only add fields when needed
  const stepResult = {
    action: null,
    status: 'ok'
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
      await pageController.navigate(step.goto);
    } else if (step.wait !== undefined) {
      stepResult.action = 'wait';
      // Support numeric value for simple delay: { "wait": 2000 }
      if (typeof step.wait === 'number') {
        await sleep(step.wait);
      } else {
        await executeWait(elementLocator, step.wait);
      }
    } else if (step.click !== undefined) {
      stepResult.action = 'click';
      const clickResult = await executeClick(elementLocator, inputEmulator, deps.ariaSnapshot, step.click);
      if (clickResult) {
        // Only include output for non-trivial results
        if (clickResult.stale || clickResult.warning) {
          stepResult.warning = clickResult.warning;
          stepResult.output = { stale: clickResult.stale };
        }
        // Add navigation info (FR-008)
        if (clickResult.navigated) {
          stepResult.output = { navigated: true, newUrl: clickResult.newUrl };
        }
        // Add verify mode result
        if (typeof step.click === 'object' && step.click.verify && !clickResult.targetReceived) {
          stepResult.warning = 'Click may have hit a different element';
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
      // Capture URL before fill for navigation detection
      const urlBeforeFill = await getCurrentUrl(elementLocator.session);
      await fillExecutor.execute(step.fill);
      // Check for navigation after fill (some SPAs navigate on input)
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
      stepResult.output = await executeSnapshot(deps.ariaSnapshot, step.snapshot);
    } else if (step.hover !== undefined) {
      stepResult.action = 'hover';
      const hoverResult = await executeHover(elementLocator, inputEmulator, deps.ariaSnapshot, step.hover);
      // Only include output if there's capturedResult
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
      // openTab is handled in cdp-skill.js before runSteps
      // This is just for the step result - the tab was already created
      if (step._openTabHandled) {
        // Navigate to URL if provided
        if (step._openTabUrl) {
          await pageController.navigate(step._openTabUrl);
        }
        // Output includes tab alias for reference
        stepResult.output = { tab: step._openTabAlias };
      } else {
        // openTab can only be the first step and is pre-handled
        throw new Error('openTab must be the first step when no targetId is provided');
      }
    } else if (step.type !== undefined) {
      stepResult.action = 'type';
      const keyboardExecutor = createKeyboardExecutor(
        elementLocator.session,
        elementLocator,
        inputEmulator
      );
      // type always returns output with typed info
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
      // Feature 12: Form state dump
      stepResult.action = 'formState';
      // Create formValidator lazily since it's not in deps
      const formValidator = createFormValidator(elementLocator.session, elementLocator);
      // Extract selector - can be string or object with selector property
      const formSelector = typeof step.formState === 'string' ? step.formState : step.formState.selector;
      stepResult.output = await formValidator.getFormState(formSelector);
    } else if (step.extract !== undefined) {
      // Feature 11: Extract structured data
      stepResult.action = 'extract';
      stepResult.output = await executeExtract(deps, step.extract);
    } else if (step.selectOption !== undefined) {
      // Native select dropdown - set option by value/label/index
      stepResult.action = 'selectOption';
      stepResult.output = await executeSelectOption(elementLocator, step.selectOption);
    } else if (step.getDom !== undefined) {
      // Get raw DOM/HTML of page or element
      stepResult.action = 'getDom';
      stepResult.output = await executeGetDom(pageController, step.getDom);
    } else if (step.getBox !== undefined) {
      // Get bounding box of one or more refs
      stepResult.action = 'getBox';
      stepResult.output = await executeGetBox(deps.ariaSnapshot, step.getBox);
    } else if (step.fillActive !== undefined) {
      // Fill the currently focused element
      stepResult.action = 'fillActive';
      stepResult.output = await executeFillActive(pageController, inputEmulator, step.fillActive);
    } else if (step.refAt !== undefined) {
      // Get ref for element at coordinates
      stepResult.action = 'refAt';
      stepResult.output = await executeRefAt(session, step.refAt);
    } else if (step.elementsAt !== undefined) {
      // Get refs for elements at multiple coordinates
      stepResult.action = 'elementsAt';
      stepResult.output = await executeElementsAt(session, step.elementsAt);
    } else if (step.elementsNear !== undefined) {
      // Get refs for elements near a coordinate
      stepResult.action = 'elementsNear';
      stepResult.output = await executeElementsNear(session, step.elementsNear);
    }
  }

  // Track params for error reporting
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

    // Include params in error response for debugging
    stepResult.params = stepParams;

    // Feature 8: Capture failure context
    try {
      stepResult.context = await captureFailureContext(deps);
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

  // Note: Console capture moved to command-level in runSteps()
  // Step-level console capture removed to reduce redundancy

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
        warning: `Element ref:${ref} is no longer attached to the DOM. Page content may have changed. Run 'snapshot' again to get fresh refs.`
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

  // Create the eval promise - use evaluateInFrame to respect frame context (Bug #9 fix)
  const evalPromise = pageController.evaluateInFrame(wrappedExpression, {
    returnByValue: true,
    awaitPromise
  });

  // Apply timeout if specified (FR-042)
  let result;
  if (evalTimeout !== null && evalTimeout > 0) {
    let evalTimeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      evalTimeoutId = setTimeout(() => {
        reject(new Error(`Eval timed out after ${evalTimeout}ms`));
      }, evalTimeout);
    });
    result = await Promise.race([evalPromise, timeoutPromise]);
    clearTimeout(evalTimeoutId);
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
 * Feature 13: Supports captureResult to detect new visible elements after hover
 */
async function executeHover(elementLocator, inputEmulator, ariaSnapshot, params) {
  const selector = typeof params === 'string' ? params : params.selector;
  let ref = typeof params === 'object' ? params.ref : null;
  const duration = typeof params === 'object' ? (params.duration || 0) : 0;

  // Detect if string selector looks like a ref (e.g., "e1", "e12", "e123")
  // This allows {"hover": "e1"} to work the same as {"hover": {"ref": "e1"}}
  if (!ref && selector && /^e\d+$/.test(selector)) {
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
async function captureHoverResult(session, visibleBefore) {
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
async function executeDrag(elementLocator, inputEmulator, pageController, ariaSnapshot, params) {
  const { source, target, steps = 10, delay = 0 } = params;

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

  // Helper to resolve selector/ref to box with optional offsets
  // Supports: string selectors, ref strings, coordinate objects, ref objects with offsets
  // Examples:
  //   "#draggable" -> selector
  //   "e1" -> ref string
  //   {"x": 100, "y": 200} -> coordinates
  //   {"ref": "e1", "offsetX": 10, "offsetY": -5} -> ref with offsets
  async function resolveToBox(spec) {
    // Direct coordinates
    if (typeof spec === 'object' && typeof spec.x === 'number' && typeof spec.y === 'number') {
      return { x: spec.x, y: spec.y, width: 0, height: 0, offsetX: 0, offsetY: 0 };
    }

    // Ref object with optional offsets: {"ref": "e1", "offsetX": 10}
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

    // Check if it looks like a ref (e.g., "e1", "e12")
    if (/^e\d+$/.test(selectorOrRef)) {
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

  // Get source coordinates (center + offset)
  const sourceBox = await resolveToBox(source);
  const sourceX = sourceBox.x + sourceBox.width / 2 + (sourceBox.offsetX || 0);
  const sourceY = sourceBox.y + sourceBox.height / 2 + (sourceBox.offsetY || 0);

  // Get target coordinates (center + offset)
  const targetBox = await resolveToBox(target);
  const targetX = targetBox.x + targetBox.width / 2 + (targetBox.offsetX || 0);
  const targetY = targetBox.y + targetBox.height / 2 + (targetBox.offsetY || 0);

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
 * By default, only returns cookies for the current tab's domain
 */
async function executeCookies(cookieManager, pageController, params) {
  if (!cookieManager) {
    throw new Error('Cookie manager not available');
  }

  // Get current page URL for domain filtering
  const currentUrl = await getCurrentUrl(pageController.session);

  // Determine the action
  if (params.get !== undefined || params.action === 'get') {
    // Default to current page URL if no URLs specified
    const urls = Array.isArray(params.get) && params.get.length > 0
      ? params.get
      : (params.urls && params.urls.length > 0 ? params.urls : [currentUrl]);
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
    const options = {};
    if (params.domain) options.domain = params.domain;
    const result = await cookieManager.clearCookies(urls, options);
    return { action: 'clear', count: result.count, ...(params.domain ? { domain: params.domain } : {}) };
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
 * Execute a formState step - dump form field state (Feature 12)
 * @param {Object} formValidator - Form validator instance
 * @param {string} selector - CSS selector for the form
 * @returns {Promise<Object>} Form state
 */
async function executeFormState(formValidator, selector) {
  if (!formValidator) {
    throw new Error('Form validator not available');
  }

  const formSelector = typeof selector === 'string' ? selector : selector.selector;
  if (!formSelector) {
    throw new Error('formState requires a selector');
  }

  return formValidator.getFormState(formSelector);
}

/**
 * Execute an extract step - extract structured data from tables/lists (Feature 11)
 * @param {Object} deps - Dependencies
 * @param {string|Object} params - Selector or options
 * @returns {Promise<Object>} Extracted data
 */
async function executeExtract(deps, params) {
  const { pageController } = deps;
  const session = pageController.session;

  const selector = typeof params === 'string' ? params : params.selector;
  const type = typeof params === 'object' ? params.type : null; // 'table' or 'list'
  const limit = typeof params === 'object' ? params.limit : 100;

  if (!selector) {
    throw new Error('extract requires a selector');
  }

  const result = await session.send('Runtime.evaluate', {
    expression: `
      (function() {
        const selector = ${JSON.stringify(selector)};
        const typeHint = ${JSON.stringify(type)};
        const limit = ${limit};
        const el = document.querySelector(selector);

        if (!el) {
          return { error: 'Element not found: ' + selector };
        }

        const tagName = el.tagName.toLowerCase();

        // Auto-detect type if not specified
        let detectedType = typeHint;
        if (!detectedType) {
          if (tagName === 'table') {
            detectedType = 'table';
          } else if (tagName === 'ul' || tagName === 'ol' || el.getAttribute('role') === 'list') {
            detectedType = 'list';
          } else if (el.querySelector('table')) {
            detectedType = 'table';
            // Use the inner table
          } else if (el.querySelector('ul, ol, [role="list"]')) {
            detectedType = 'list';
          } else {
            // Try to detect based on structure
            const rows = el.querySelectorAll('[role="row"], tr');
            if (rows.length > 0) {
              detectedType = 'table';
            } else {
              const items = el.querySelectorAll('[role="listitem"], li');
              if (items.length > 0) {
                detectedType = 'list';
              }
            }
          }
        }

        if (detectedType === 'table') {
          // Extract table data
          const tableEl = tagName === 'table' ? el : el.querySelector('table');
          if (!tableEl) {
            return { error: 'No table found', type: 'table' };
          }

          const headers = [];
          const rows = [];

          // Get headers from thead or first row
          const headerRow = tableEl.querySelector('thead tr') || tableEl.querySelector('tr');
          if (headerRow) {
            const headerCells = headerRow.querySelectorAll('th, td');
            for (const cell of headerCells) {
              headers.push((cell.textContent || '').trim());
            }
          }

          // Get data rows
          const dataRows = tableEl.querySelectorAll('tbody tr, tr');
          let count = 0;
          for (const row of dataRows) {
            // Skip header row
            if (row === headerRow) continue;
            if (count >= limit) break;

            const cells = row.querySelectorAll('td, th');
            const rowData = [];
            for (const cell of cells) {
              rowData.push((cell.textContent || '').trim());
            }
            if (rowData.length > 0) {
              rows.push(rowData);
              count++;
            }
          }

          return {
            type: 'table',
            headers,
            rows,
            rowCount: rows.length
          };
        }

        if (detectedType === 'list') {
          // Extract list data
          const listEl = (tagName === 'ul' || tagName === 'ol') ? el :
                        el.querySelector('ul, ol, [role="list"]');

          const items = [];
          const listItems = listEl ?
            listEl.querySelectorAll(':scope > li, :scope > [role="listitem"]') :
            el.querySelectorAll('[role="listitem"], li');

          let count = 0;
          for (const item of listItems) {
            if (count >= limit) break;
            const text = (item.textContent || '').trim();
            if (text) {
              items.push(text);
              count++;
            }
          }

          return {
            type: 'list',
            items,
            itemCount: items.length
          };
        }

        return { error: 'Could not detect data type. Use type: "table" or "list" option.', detectedType };
      })()
    `,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error('Extract error: ' + result.exceptionDetails.text);
  }

  const data = result.result.value;
  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

/**
 * Execute a selectOption step - selects option(s) in a native <select> element
 * Following Puppeteer's approach: set option.selected and dispatch events
 *
 * Usage:
 *   {"selectOption": {"selector": "#dropdown", "value": "optionValue"}}
 *   {"selectOption": {"selector": "#dropdown", "label": "Option Text"}}
 *   {"selectOption": {"selector": "#dropdown", "index": 2}}
 *   {"selectOption": {"selector": "#dropdown", "values": ["a", "b"]}}  // multiple select
 */
async function executeSelectOption(elementLocator, params) {
  const selector = params.selector;
  const value = params.value;
  const label = params.label;
  const index = params.index;
  const values = params.values; // for multi-select

  if (!selector) {
    throw new Error('selectOption requires selector');
  }
  if (value === undefined && label === undefined && index === undefined && !values) {
    throw new Error('selectOption requires value, label, index, or values');
  }

  const element = await elementLocator.findElement(selector);
  if (!element) {
    throw elementNotFoundError(selector, 0);
  }

  try {
    const result = await elementLocator.session.send('Runtime.callFunctionOn', {
      objectId: element._handle.objectId,
      functionDeclaration: `function(matchBy, matchValue, matchValues) {
        const el = this;

        // Validate element is a select
        if (!(el instanceof HTMLSelectElement)) {
          return { error: 'Element is not a <select> element' };
        }

        const selectedValues = [];
        const isMultiple = el.multiple;
        const options = Array.from(el.options);

        // Build match function based on type
        let matchFn;
        if (matchBy === 'value') {
          const valuesToMatch = matchValues ? matchValues : [matchValue];
          matchFn = (opt) => valuesToMatch.includes(opt.value);
        } else if (matchBy === 'label') {
          matchFn = (opt) => opt.textContent.trim() === matchValue || opt.label === matchValue;
        } else if (matchBy === 'index') {
          matchFn = (opt, idx) => idx === matchValue;
        } else {
          return { error: 'Invalid match type' };
        }

        // For single-select, deselect all first
        if (!isMultiple) {
          for (const option of options) {
            option.selected = false;
          }
        }

        // Select matching options
        let matched = false;
        for (let i = 0; i < options.length; i++) {
          const option = options[i];
          if (matchFn(option, i)) {
            option.selected = true;
            selectedValues.push(option.value);
            matched = true;
            if (!isMultiple) break; // Single select stops at first match
          }
        }

        if (!matched) {
          return {
            error: 'No option matched',
            matchBy,
            matchValue: matchValues || matchValue,
            availableOptions: options.slice(0, 10).map(o => ({ value: o.value, label: o.textContent.trim() }))
          };
        }

        // Dispatch events (same as Puppeteer)
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        return {
          success: true,
          selected: selectedValues,
          multiple: isMultiple
        };
      }`,
      arguments: [
        { value: values ? 'value' : (value !== undefined ? 'value' : (label !== undefined ? 'label' : 'index')) },
        { value: value !== undefined ? value : (label !== undefined ? label : index) },
        { value: values || null }
      ],
      returnByValue: true
    });

    const selectResult = result.result.value;

    if (selectResult.error) {
      const errorMsg = selectResult.error;
      if (selectResult.availableOptions) {
        throw new Error(`${errorMsg}. Available options: ${JSON.stringify(selectResult.availableOptions)}`);
      }
      throw new Error(errorMsg);
    }

    return {
      selected: selectResult.selected,
      multiple: selectResult.multiple
    };
  } finally {
    await element._handle.dispose();
  }
}

/**
 * Execute a getDom step - get raw HTML of page or element
 * @param {Object} pageController - Page controller
 * @param {boolean|string|Object} params - true for full page, selector string, or options object
 * @returns {Promise<Object>} DOM content
 */
async function executeGetDom(pageController, params) {
  const session = pageController.session;

  // Determine selector - null means full page
  let selector = null;
  let outer = true; // include element's own tag

  if (params === true) {
    selector = null; // full page
  } else if (typeof params === 'string') {
    selector = params;
  } else if (typeof params === 'object' && params !== null) {
    selector = params.selector || null;
    if (params.outer === false) outer = false;
  }

  const expression = selector
    ? `(function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { error: 'Element not found: ${selector}' };
        return {
          html: ${outer} ? el.outerHTML : el.innerHTML,
          tagName: el.tagName.toLowerCase(),
          selector: ${JSON.stringify(selector)}
        };
      })()`
    : `(function() {
        return {
          html: document.documentElement.outerHTML,
          tagName: 'html'
        };
      })()`;

  const result = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(`getDom error: ${result.exceptionDetails.text}`);
  }

  const data = result.result.value;
  if (data.error) {
    throw new Error(data.error);
  }

  return {
    html: data.html,
    tagName: data.tagName,
    selector: data.selector || null,
    length: data.html.length
  };
}

/**
 * Execute a getBox step - get bounding box of one or more refs
 * @param {Object} ariaSnapshot - ARIA snapshot instance
 * @param {string|string[]|Object} params - ref, array of refs, or options object
 * @returns {Promise<Object>} Bounding box info
 */
async function executeGetBox(ariaSnapshot, params) {
  if (!ariaSnapshot) {
    throw new Error('ariaSnapshot is required for getBox');
  }

  // Normalize params to array of refs
  let refs;
  if (typeof params === 'string') {
    refs = [params];
  } else if (Array.isArray(params)) {
    refs = params;
  } else if (typeof params === 'object' && params !== null) {
    refs = params.refs || (params.ref ? [params.ref] : []);
  } else {
    throw new Error('getBox requires ref(s)');
  }

  if (refs.length === 0) {
    throw new Error('getBox requires at least one ref');
  }

  const results = {};

  for (const ref of refs) {
    try {
      const refInfo = await ariaSnapshot.getElementByRef(ref);
      if (!refInfo) {
        results[ref] = { error: 'not found' };
      } else if (refInfo.stale) {
        results[ref] = { error: 'stale', message: 'Element no longer in DOM' };
      } else if (!refInfo.isVisible) {
        results[ref] = { error: 'hidden', box: refInfo.box };
      } else {
        results[ref] = {
          x: refInfo.box.x,
          y: refInfo.box.y,
          width: refInfo.box.width,
          height: refInfo.box.height,
          center: {
            x: Math.round(refInfo.box.x + refInfo.box.width / 2),
            y: Math.round(refInfo.box.y + refInfo.box.height / 2)
          }
        };
      }
    } catch (e) {
      results[ref] = { error: e.message };
    }
  }

  // If single ref, return just the box info (not wrapped in object)
  if (refs.length === 1) {
    return results[refs[0]];
  }

  return results;
}

/**
 * Execute a fillActive step - fill the currently focused element
 * @param {Object} pageController - Page controller
 * @param {Object} inputEmulator - Input emulator for typing
 * @param {string|Object} params - Value string or options object
 * @returns {Promise<Object>} Result with filled element info
 */
async function executeFillActive(pageController, inputEmulator, params) {
  const session = pageController.session;

  // Parse params
  const value = typeof params === 'string' ? params : params.value;
  const clear = typeof params === 'object' ? params.clear !== false : true;

  // Check if there's an active element and if it's editable
  const checkResult = await session.send('Runtime.evaluate', {
    expression: `(function() {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) {
        return { error: 'No element is focused' };
      }

      const tag = el.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const isContentEditable = el.isContentEditable;

      if (!isInput && !isContentEditable) {
        return { error: 'Focused element is not editable', tag: tag };
      }

      // Check if disabled or readonly
      if (el.disabled) {
        return { error: 'Focused element is disabled', tag: tag };
      }
      if (el.readOnly) {
        return { error: 'Focused element is readonly', tag: tag };
      }

      // Build selector for reporting
      let selector = tag.toLowerCase();
      if (el.id) {
        selector = '#' + el.id;
      } else if (el.name) {
        selector = '[name="' + el.name + '"]';
      }

      return {
        editable: true,
        tag: tag,
        type: tag === 'INPUT' ? (el.type || 'text') : null,
        selector: selector,
        valueBefore: el.value || ''
      };
    })()`,
    returnByValue: true
  });

  if (checkResult.exceptionDetails) {
    throw new Error(`fillActive error: ${checkResult.exceptionDetails.text}`);
  }

  const check = checkResult.result.value;
  if (check.error) {
    throw new Error(check.error);
  }

  // Clear existing content if requested
  if (clear) {
    await inputEmulator.selectAll();
  }

  // Type the new value
  await inputEmulator.type(String(value));

  return {
    filled: true,
    tag: check.tag,
    type: check.type,
    selector: check.selector,
    valueBefore: check.valueBefore,
    valueAfter: value
  };
}

/**
 * Execute a refAt step - get or create a ref for the element at given coordinates
 * Uses document.elementFromPoint to find the element, then assigns/retrieves a ref
 */
async function executeRefAt(session, params) {
  const { x, y } = params;

  const result = await session.send('Runtime.evaluate', {
    expression: `(function() {
      const x = ${x};
      const y = ${y};

      // Get element at point
      const el = document.elementFromPoint(x, y);
      if (!el) {
        return { error: 'No element at coordinates (' + x + ', ' + y + ')' };
      }

      // Initialize refs map if needed
      if (!window.__ariaRefs) {
        window.__ariaRefs = new Map();
      }
      if (!window.__ariaRefCounter) {
        window.__ariaRefCounter = 0;
      }

      // Helper to generate a selector for an element
      function generateSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);

        // Try unique attributes
        for (const attr of ['data-testid', 'data-test-id', 'data-cy', 'name']) {
          if (el.hasAttribute(attr)) {
            const value = el.getAttribute(attr);
            const selector = '[' + attr + '="' + value.replace(/"/g, '\\\\"') + '"]';
            if (document.querySelectorAll(selector).length === 1) return selector;
          }
        }

        // Build path
        const path = [];
        let current = el;
        while (current && current !== document.body && path.length < 5) {
          let selector = current.tagName.toLowerCase();
          if (current.id) {
            selector = '#' + CSS.escape(current.id);
            path.unshift(selector);
            break;
          }
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1;
              selector += ':nth-of-type(' + index + ')';
            }
          }
          path.unshift(selector);
          current = parent;
        }
        return path.join(' > ');
      }

      // Helper to check if element is clickable
      function isClickable(el) {
        const tag = el.tagName;
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
          return true;
        }
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem' || role === 'checkbox' || role === 'radio') {
          return true;
        }
        if (el.onclick || el.hasAttribute('onclick')) return true;
        const style = window.getComputedStyle(el);
        if (style.cursor === 'pointer') return true;
        return false;
      }

      // Check if element already has a ref
      for (const [ref, refEl] of window.__ariaRefs) {
        if (refEl === el) {
          const rect = el.getBoundingClientRect();
          return {
            ref: ref,
            existing: true,
            tag: el.tagName,
            selector: generateSelector(el),
            clickable: isClickable(el),
            role: el.getAttribute('role') || null,
            name: el.getAttribute('aria-label') || el.textContent?.trim().substring(0, 50) || null,
            box: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          };
        }
      }

      // Create new ref
      window.__ariaRefCounter++;
      const ref = 'e' + window.__ariaRefCounter;
      window.__ariaRefs.set(ref, el);

      const rect = el.getBoundingClientRect();
      return {
        ref: ref,
        existing: false,
        tag: el.tagName,
        selector: generateSelector(el),
        clickable: isClickable(el),
        role: el.getAttribute('role') || null,
        name: el.getAttribute('aria-label') || el.textContent?.trim().substring(0, 50) || null,
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    })()`,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(`refAt error: ${result.exceptionDetails.text}`);
  }

  const value = result.result.value;
  if (value.error) {
    throw new Error(value.error);
  }

  return value;
}

/**
 * Execute an elementsAt step - get refs for elements at multiple coordinates
 */
async function executeElementsAt(session, coords) {
  const result = await session.send('Runtime.evaluate', {
    expression: `(function() {
      const coords = ${JSON.stringify(coords)};

      // Initialize refs map if needed
      if (!window.__ariaRefs) {
        window.__ariaRefs = new Map();
      }
      if (!window.__ariaRefCounter) {
        window.__ariaRefCounter = 0;
      }

      // Helper to get or create ref for element
      function getOrCreateRef(el) {
        if (!el) return null;

        // Check if element already has a ref
        for (const [ref, refEl] of window.__ariaRefs) {
          if (refEl === el) {
            return { ref, existing: true };
          }
        }

        // Create new ref
        window.__ariaRefCounter++;
        const ref = 'e' + window.__ariaRefCounter;
        window.__ariaRefs.set(ref, el);
        return { ref, existing: false };
      }

      // Helper to generate a selector for an element
      function generateSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);

        // Try unique attributes
        for (const attr of ['data-testid', 'data-test-id', 'data-cy', 'name']) {
          if (el.hasAttribute(attr)) {
            const value = el.getAttribute(attr);
            const selector = '[' + attr + '="' + value.replace(/"/g, '\\\\"') + '"]';
            if (document.querySelectorAll(selector).length === 1) return selector;
          }
        }

        // Build path
        const path = [];
        let current = el;
        while (current && current !== document.body && path.length < 5) {
          let selector = current.tagName.toLowerCase();
          if (current.id) {
            selector = '#' + CSS.escape(current.id);
            path.unshift(selector);
            break;
          }
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1;
              selector += ':nth-of-type(' + index + ')';
            }
          }
          path.unshift(selector);
          current = parent;
        }
        return path.join(' > ');
      }

      // Helper to check if element is clickable
      function isClickable(el) {
        const tag = el.tagName;
        // Obviously clickable elements
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
          return true;
        }
        // Role-based
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem' || role === 'checkbox' || role === 'radio') {
          return true;
        }
        // Event listeners or cursor
        if (el.onclick || el.hasAttribute('onclick')) return true;
        const style = window.getComputedStyle(el);
        if (style.cursor === 'pointer') return true;
        return false;
      }

      // Helper to build element info
      function buildElementInfo(el, refInfo) {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          ref: refInfo.ref,
          existing: refInfo.existing,
          tag: el.tagName,
          selector: generateSelector(el),
          clickable: isClickable(el),
          role: el.getAttribute('role') || null,
          name: el.getAttribute('aria-label') || el.textContent?.trim().substring(0, 50) || null,
          box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      }

      const results = [];
      for (const coord of coords) {
        const el = document.elementFromPoint(coord.x, coord.y);
        if (!el) {
          results.push({ x: coord.x, y: coord.y, error: 'No element at this coordinate' });
        } else {
          const refInfo = getOrCreateRef(el);
          const info = buildElementInfo(el, refInfo);
          info.x = coord.x;
          info.y = coord.y;
          results.push(info);
        }
      }

      return { elements: results, count: results.filter(r => !r.error).length };
    })()`,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(`elementsAt error: ${result.exceptionDetails.text}`);
  }

  return result.result.value;
}

/**
 * Execute an elementsNear step - get refs for all elements near a coordinate
 */
async function executeElementsNear(session, params) {
  const { x, y, radius = 50, limit = 20 } = params;

  const result = await session.send('Runtime.evaluate', {
    expression: `(function() {
      const centerX = ${x};
      const centerY = ${y};
      const radius = ${radius};
      const limit = ${limit};

      // Initialize refs map if needed
      if (!window.__ariaRefs) {
        window.__ariaRefs = new Map();
      }
      if (!window.__ariaRefCounter) {
        window.__ariaRefCounter = 0;
      }

      // Helper to get or create ref for element
      function getOrCreateRef(el) {
        // Check if element already has a ref
        for (const [ref, refEl] of window.__ariaRefs) {
          if (refEl === el) {
            return { ref, existing: true };
          }
        }

        // Create new ref
        window.__ariaRefCounter++;
        const ref = 'e' + window.__ariaRefCounter;
        window.__ariaRefs.set(ref, el);
        return { ref, existing: false };
      }

      // Helper to generate a selector for an element
      function generateSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);

        // Try unique attributes
        for (const attr of ['data-testid', 'data-test-id', 'data-cy', 'name']) {
          if (el.hasAttribute(attr)) {
            const value = el.getAttribute(attr);
            const selector = '[' + attr + '="' + value.replace(/"/g, '\\\\"') + '"]';
            if (document.querySelectorAll(selector).length === 1) return selector;
          }
        }

        // Build path
        const path = [];
        let current = el;
        while (current && current !== document.body && path.length < 5) {
          let selector = current.tagName.toLowerCase();
          if (current.id) {
            selector = '#' + CSS.escape(current.id);
            path.unshift(selector);
            break;
          }
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1;
              selector += ':nth-of-type(' + index + ')';
            }
          }
          path.unshift(selector);
          current = parent;
        }
        return path.join(' > ');
      }

      // Helper to check if element is clickable
      function isClickable(el) {
        const tag = el.tagName;
        // Obviously clickable elements
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
          return true;
        }
        // Role-based
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem' || role === 'checkbox' || role === 'radio') {
          return true;
        }
        // Event listeners or cursor
        if (el.onclick || el.hasAttribute('onclick')) return true;
        const style = window.getComputedStyle(el);
        if (style.cursor === 'pointer') return true;
        return false;
      }

      // Get all elements and filter by distance from center
      const allElements = document.querySelectorAll('*');
      const nearbyElements = [];

      for (const el of allElements) {
        // Skip non-visible elements
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        // Calculate center of element
        const elCenterX = rect.x + rect.width / 2;
        const elCenterY = rect.y + rect.height / 2;

        // Calculate distance from target point
        const distance = Math.sqrt(
          Math.pow(elCenterX - centerX, 2) + Math.pow(elCenterY - centerY, 2)
        );

        if (distance <= radius) {
          nearbyElements.push({ el, distance, rect });
        }
      }

      // Sort by distance (closest first) and limit
      nearbyElements.sort((a, b) => a.distance - b.distance);
      const limited = nearbyElements.slice(0, limit);

      // Build results
      const results = limited.map(({ el, distance, rect }) => {
        const refInfo = getOrCreateRef(el);
        return {
          ref: refInfo.ref,
          existing: refInfo.existing,
          tag: el.tagName,
          selector: generateSelector(el),
          clickable: isClickable(el),
          role: el.getAttribute('role') || null,
          name: el.getAttribute('aria-label') || el.textContent?.trim().substring(0, 50) || null,
          distance: Math.round(distance),
          box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      });

      return {
        center: { x: centerX, y: centerY },
        radius: radius,
        count: results.length,
        elements: results
      };
    })()`,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(`elementsNear error: ${result.exceptionDetails.text}`);
  }

  return result.result.value;
}

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

  // Trim selector to avoid whitespace issues
  const rawSelector = typeof params === 'string' ? params : params.selector;
  const selector = typeof rawSelector === 'string' ? rawSelector.trim() : rawSelector;
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
async function executeScroll(elementLocator, inputEmulator, pageController, ariaSnapshot, params) {
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
        await inputEmulator.scroll(0, -300, 400, 300);
        break;
      case 'down':
        await inputEmulator.scroll(0, 300, 400, 300);
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
 * Format command-level console messages
 * Dedupes consecutive identical messages and filters to errors/warnings
 * @param {Object} consoleCapture - Console capture instance
 * @param {number} messageCountBefore - Number of messages before command started
 * @returns {Object|null} Console summary or null if no relevant messages
 */
function formatCommandConsole(consoleCapture, messageCountBefore) {
  if (!consoleCapture) return null;

  const allMessages = consoleCapture.getMessages();
  const newMessages = allMessages.slice(messageCountBefore);

  // Filter to errors and warnings only
  const relevant = newMessages.filter(m =>
    m.level === 'error' || m.level === 'warning'
  );

  // Dedupe consecutive identical messages
  const deduped = relevant.filter((m, i) =>
    i === 0 || m.text !== relevant[i - 1].text
  );

  if (deduped.length === 0) return null;

  return {
    errors: deduped.filter(m => m.level === 'error').length,
    warnings: deduped.filter(m => m.level === 'warning').length,
    messages: deduped.map(m => ({
      level: m.level,
      text: m.text,
      source: m.url ? `${m.url.split('/').pop()}:${m.line}` : undefined
    }))
  };
}

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

  // Capture console message count before command starts
  const consoleCountBefore = deps.consoleCapture ? deps.consoleCapture.getMessages().length : 0;

  // Feature 8.1: Capture BEFORE state at command start (for diff baseline)
  let beforeUrl, beforeViewport, beforeSnapshot;
  const contextCapture = deps.pageController ? createContextCapture(deps.pageController.session) : null;

  if (deps.ariaSnapshot && contextCapture) {
    try {
      beforeUrl = await getCurrentUrl(deps.pageController.session);
      // Capture viewport-only snapshot for command-level diff
      beforeViewport = await deps.ariaSnapshot.generate({ mode: 'ai', viewportOnly: true });
    } catch {
      // Ignore initial snapshot errors - will just skip diff comparison
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
    // 'skipped' (optional) steps don't fail the run
  }

  // Wait for async console messages after steps complete
  if (deps.consoleCapture) {
    await sleep(250);
    const consoleSummary = formatCommandConsole(deps.consoleCapture, consoleCountBefore);
    if (consoleSummary) {
      result.console = consoleSummary;
    }
  }

  // Feature 8.1: Capture AFTER state and compute command-level diff
  if (deps.ariaSnapshot && contextCapture && beforeViewport) {
    try {
      const afterUrl = await getCurrentUrl(deps.pageController.session);
      const afterContext = await contextCapture.captureContext();

      // Capture both viewport and full page snapshots
      const afterViewport = await deps.ariaSnapshot.generate({ mode: 'ai', viewportOnly: true });
      const afterFull = await deps.ariaSnapshot.generate({ mode: 'ai', viewportOnly: false });

      const navigated = contextCapture.isNavigation(beforeUrl, afterUrl);

      // Save full page snapshot to file (use tabAlias for filename)
      const fullSnapshotPath = await resolveTempPath(`${options.tabAlias || 'command'}.after.yaml`, '.yaml');
      await fs.writeFile(fullSnapshotPath, afterFull.yaml || '', 'utf8');

      // Add command-level results
      result.navigated = navigated;
      result.fullSnapshot = fullSnapshotPath;
      result.context = afterContext;

      // Always include viewport snapshot inline
      result.viewportSnapshot = afterViewport.yaml;
      result.truncated = afterViewport.truncated || false;

      // For same-page interactions, compute viewport diff
      if (!navigated && beforeViewport?.yaml) {
        const differ = createSnapshotDiffer();
        const viewportDiff = differ.computeDiff(beforeViewport.yaml, afterViewport.yaml);

        // Report changes if any significant changes found
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
