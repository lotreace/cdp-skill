/**
 * Step Validator
 * Validates step definitions before execution
 *
 * EXPORTS:
 * - validateSteps(steps) → {valid: boolean, errors: Array}
 * - validateStepInternal(step) → string[] - Internal per-step validation
 *
 * DEPENDENCIES:
 * - ./context-helpers.js: STEP_TYPES
 */

import { STEP_TYPES } from './context-helpers.js';

/**
 * Validate a single step definition
 * @param {Object} step - Step definition
 * @returns {string[]} Array of validation errors
 */
export function validateStepInternal(step) {
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
      // Support both string URL and object format with options
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('goto requires a non-empty URL string');
        }
      } else if (params && typeof params === 'object') {
        if (!params.url || typeof params.url !== 'string') {
          errors.push('goto requires a non-empty url property');
        }
        // Validate waitUntil if provided
        if (params.waitUntil !== undefined) {
          const validWaitUntil = ['commit', 'domcontentloaded', 'load', 'networkidle'];
          if (!validWaitUntil.includes(params.waitUntil)) {
            errors.push(`goto waitUntil must be one of: ${validWaitUntil.join(', ')}`);
          }
        }
      } else {
        errors.push('goto requires a URL string or object with url property');
      }
      break;

    case 'reload':
      // reload can be boolean true or object with options
      if (params !== true && typeof params !== 'object') {
        errors.push('reload requires true or params object');
      }
      if (typeof params === 'object' && params.waitUntil !== undefined) {
        const validWaitUntil = ['commit', 'domcontentloaded', 'load', 'networkidle'];
        if (!validWaitUntil.includes(params.waitUntil)) {
          errors.push(`reload waitUntil must be one of: ${validWaitUntil.join(', ')}`);
        }
      }
      break;

    case 'wait':
      // Numeric wait is no longer supported - use sleep instead
      if (typeof params === 'number') {
        errors.push('wait no longer accepts a number — use { "sleep": N } for time delays');
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
        if (hasTime) {
          errors.push('wait no longer accepts time — use { "sleep": N } for time delays');
        }
        if (!hasSelector && !hasText && !hasTextRegex && !hasTime && !hasUrlContains) {
          errors.push('wait requires selector, text, textRegex, or urlContains');
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
        // Check for coordinate-based click
        const hasCoordinates = typeof params.x === 'number' && typeof params.y === 'number';
        // Check for text-based click
        const hasText = typeof params.text === 'string';
        // Check for multi-selector fallback
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
      // Unified fill: 5 shapes
      // 1. fill: "text" → focused mode (string)
      // 2. fill: {selector/ref/label, value} → single field
      // 3. fill: {value, clear?} → focused with options (no targeting key)
      // 4. fill: {fields: {...}, react?} → batch with options
      // 5. fill: {"#a": "v1", "#b": "v2"} → batch (fallback)
      if (typeof params === 'string') {
        // Shape 1: focused mode — string value is fine (even empty)
      } else if (params && typeof params === 'object') {
        const hasTargeting = params.selector || params.ref || params.label;
        const hasFields = params.fields && typeof params.fields === 'object';

        if (hasTargeting) {
          // Shape 2: single field with targeting
          if (params.selector && typeof params.selector !== 'string') {
            errors.push('fill selector must be a string');
          } else if (params.ref && typeof params.ref !== 'string') {
            errors.push('fill ref must be a string');
          } else if (params.label && typeof params.label !== 'string') {
            errors.push('fill label must be a string');
          }
          if (params.value === undefined) {
            errors.push('fill requires value');
          }
        } else if (hasFields) {
          // Shape 4: batch with options
          const entries = Object.entries(params.fields);
          if (entries.length === 0) {
            errors.push('fill requires at least one field');
          }
          if (params.react !== undefined && typeof params.react !== 'boolean') {
            errors.push('fill react option must be a boolean');
          }
        } else if (params.value !== undefined) {
          // Shape 3: focused with options (has value but no targeting key)
        } else {
          // Shape 5: batch (plain object mapping selectors→values)
          // Filter out option keys that aren't selector→value mappings
          const optionKeys = new Set(['clear', 'react', 'force', 'exact', 'timeout', 'readyWhen', 'settledWhen', 'observe', 'optional']);
          const fieldEntries = Object.entries(params).filter(([k]) => !optionKeys.has(k));
          if (fieldEntries.length === 0) {
            errors.push('fill requires at least one field mapping (selector → value)');
          }
        }
      } else {
        errors.push('fill requires a string, object with selector/ref/label and value, or object mapping selectors to values');
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
        // Role can be string or array of strings (compound roles)
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

    case 'snapshot':
      // snapshot can be boolean or object with options
      if (params !== true && params !== false && typeof params !== 'object') {
        errors.push('snapshot requires true or params object');
      }
      if (typeof params === 'object') {
        if (params.mode && !['ai', 'full'].includes(params.mode)) {
          errors.push('snapshot mode must be "ai" or "full"');
        }
        if (params.detail && !['summary', 'interactive', 'full'].includes(params.detail)) {
          errors.push('snapshot detail must be "summary", "interactive", or "full"');
        }
        if (params.inlineLimit !== undefined && (typeof params.inlineLimit !== 'number' || params.inlineLimit < 0)) {
          errors.push('snapshot inlineLimit must be a non-negative number');
        }
      }
      break;

    case 'snapshotSearch':
      // snapshotSearch requires at least one search criterion
      if (!params || typeof params !== 'object') {
        errors.push('snapshotSearch requires an object with search parameters');
      } else {
        const hasText = params.text !== undefined;
        const hasPattern = params.pattern !== undefined;
        const hasRole = params.role !== undefined;
        if (!hasText && !hasPattern && !hasRole) {
          errors.push('snapshotSearch requires at least one of: text, pattern, or role');
        }
        if (hasText && typeof params.text !== 'string') {
          errors.push('snapshotSearch text must be a string');
        }
        if (hasPattern && typeof params.pattern !== 'string') {
          errors.push('snapshotSearch pattern must be a string (regex)');
        }
        if (hasRole && typeof params.role !== 'string') {
          errors.push('snapshotSearch role must be a string');
        }
        if (params.limit !== undefined && (typeof params.limit !== 'number' || params.limit < 1)) {
          errors.push('snapshotSearch limit must be a positive number');
        }
        if (params.context !== undefined && (typeof params.context !== 'number' || params.context < 0)) {
          errors.push('snapshotSearch context must be a non-negative number');
        }
      }
      break;

    case 'hover':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('hover selector cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        const hasCoordinates = typeof params.x === 'number' && typeof params.y === 'number';
        const hasText = typeof params.text === 'string';
        if (!params.selector && !params.ref && !hasCoordinates && !hasText) {
          errors.push('hover requires selector, ref, text, or x/y coordinates');
        }
        if (hasText && params.text.length === 0) {
          errors.push('hover text cannot be empty');
        }
        if (hasCoordinates && (params.x < 0 || params.y < 0)) {
          errors.push('hover coordinates must be non-negative');
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

    case 'newTab':
      // newTab can be:
      // - true: just open a blank tab
      // - string: open tab and navigate to URL
      // - object with options: {url: "...", host: "...", port: N, headless: bool}
      if (params !== true && typeof params !== 'string' && (typeof params !== 'object' || params === null)) {
        errors.push('newTab must be true, a URL string, or an options object');
      }
      if (typeof params === 'object' && params !== null) {
        if (params.url !== undefined && typeof params.url !== 'string') {
          errors.push('newTab url must be a string');
        }
        if (params.host !== undefined && typeof params.host !== 'string') {
          errors.push('newTab host must be a string');
        }
        if (params.port !== undefined && typeof params.port !== 'number') {
          errors.push('newTab port must be a number');
        }
        if (params.headless !== undefined && typeof params.headless !== 'boolean') {
          errors.push('newTab headless must be a boolean');
        }
      }
      break;


    case 'selectText':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('selectText selector cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        if (!params.selector) {
          errors.push('selectText requires selector');
        } else if (typeof params.selector !== 'string') {
          errors.push('selectText selector must be a string');
        }
        if (params.start !== undefined && typeof params.start !== 'number') {
          errors.push('selectText start must be a number');
        }
        if (params.end !== undefined && typeof params.end !== 'number') {
          errors.push('selectText end must be a number');
        }
      } else {
        errors.push('selectText requires a selector string or params object');
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
        if (params.selector && typeof params.selector !== 'string') {
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

    case 'frame':
      // Unified frame operations:
      // frame: "selector" → switch by CSS selector
      // frame: 0 → switch by index
      // frame: "top" → return to main frame
      // frame: {name: "foo"} → switch by name
      // frame: {list: true} → list all frames
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('frame requires a non-empty selector string');
        }
      } else if (typeof params === 'number') {
        if (params < 0) {
          errors.push('frame index must be non-negative');
        }
      } else if (params && typeof params === 'object') {
        // Accept any object (name, list, etc.)
      } else {
        errors.push('frame requires a selector, index, "top", or options object');
      }
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
        if (params.method !== undefined && !['auto', 'mouse', 'html5'].includes(params.method)) {
          errors.push('drag method must be "auto", "mouse", or "html5"');
        }
      }
      break;

    case 'formState':
      if (typeof params !== 'string' && (!params || !params.selector)) {
        errors.push('formState requires a selector string or object with selector');
      }
      break;

    case 'get':
      // Unified content extraction: get: "selector" or {selector, mode: "text"|"html"|"value"|"box"|"attributes"}
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('get selector cannot be empty');
        }
      } else if (params && typeof params === 'object') {
        if (!params.selector && !params.ref) {
          errors.push('get requires selector or ref');
        }
        if (params.mode && !['text', 'html', 'value', 'box', 'attributes'].includes(params.mode)) {
          errors.push('get mode must be one of: text, html, value, box, attributes');
        }
      } else {
        errors.push('get requires a selector string or object with selector/ref');
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
      // getBox: "s1e1" or ["s1e1", "s1e2"] or {"refs": ["s1e1", "s1e2"]}
      // Versioned ref format: s{snapshotId}e{elementId}
      if (typeof params === 'string') {
        if (!/^s\d+e\d+$/.test(params)) {
          errors.push('getBox ref must be in format "s{N}e{M}" (e.g., "s1e1", "s2e34")');
        }
      } else if (Array.isArray(params)) {
        if (params.length === 0) {
          errors.push('getBox refs array cannot be empty');
        }
        for (const ref of params) {
          if (typeof ref !== 'string' || !/^s\d+e\d+$/.test(ref)) {
            errors.push('getBox refs must be strings in format "s{N}e{M}"');
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

    case 'elementsAt':
      // Unified coordinate lookups:
      // elementsAt: {x, y} → single point ref (was refAt)
      // elementsAt: [{x,y}, ...] → batch (was elementsAt)
      // elementsAt: {x, y, radius} → nearby search (was elementsNear)
      if (Array.isArray(params)) {
        // Batch mode
        if (params.length === 0) {
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
      } else if (params && typeof params === 'object') {
        // Single point or nearby (object with x, y, optional radius)
        if (typeof params.x !== 'number') {
          errors.push('elementsAt requires x coordinate as a number');
        }
        if (typeof params.y !== 'number') {
          errors.push('elementsAt requires y coordinate as a number');
        }
        if (params.radius !== undefined && typeof params.radius !== 'number') {
          errors.push('elementsAt radius must be a number');
        }
      } else {
        errors.push('elementsAt requires {x, y}, [{x,y}, ...], or {x, y, radius}');
      }
      break;

    case 'pageFunction':
      // pageFunction: "() => document.title" or "document.title" (bare expression)
      // or {fn, refs, timeout} or {expression, ...}
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('pageFunction requires a non-empty string');
        }
      } else if (params && typeof params === 'object') {
        const hasFn = params.fn && typeof params.fn === 'string';
        const hasExpression = params.expression && typeof params.expression === 'string';
        if (!hasFn && !hasExpression) {
          errors.push('pageFunction requires a non-empty fn or expression string');
        }
        if (params.refs !== undefined && typeof params.refs !== 'boolean') {
          errors.push('pageFunction refs must be a boolean');
        }
        if (params.timeout !== undefined && (typeof params.timeout !== 'number' || params.timeout < 0)) {
          errors.push('pageFunction timeout must be a non-negative number');
        }
      } else {
        errors.push('pageFunction requires a function/expression string or params object');
      }
      break;

    case 'poll':
      // poll: "() => condition" or {fn, interval, timeout}
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('poll requires a non-empty function string');
        }
      } else if (params && typeof params === 'object') {
        if (!params.fn || typeof params.fn !== 'string') {
          errors.push('poll requires a non-empty fn string');
        }
        if (params.interval !== undefined && (typeof params.interval !== 'number' || params.interval < 0)) {
          errors.push('poll interval must be a non-negative number');
        }
        if (params.timeout !== undefined && (typeof params.timeout !== 'number' || params.timeout < 0)) {
          errors.push('poll timeout must be a non-negative number');
        }
      } else {
        errors.push('poll requires a function string or params object');
      }
      break;


    case 'writeSiteProfile':
      if (!params || typeof params !== 'object') {
        errors.push('writeSiteProfile requires an object with domain and content');
      } else {
        const providedKeys = Object.keys(params).join(', ');
        if (!params.domain || typeof params.domain !== 'string') {
          errors.push(`writeSiteProfile requires a non-empty domain string (got keys: ${providedKeys})`);
        }
        if (!params.content || typeof params.content !== 'string') {
          errors.push(`writeSiteProfile requires a non-empty content string (got keys: ${providedKeys})`);
        }
      }
      break;

    case 'readSiteProfile':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('readSiteProfile requires a non-empty domain string');
        }
      } else if (params && typeof params === 'object') {
        if (!params.domain || typeof params.domain !== 'string') {
          errors.push('readSiteProfile requires a non-empty domain string');
        }
      } else {
        errors.push('readSiteProfile requires a domain string or object with domain');
      }
      break;

    case 'switchTab':
      if (typeof params === 'string') {
        if (params.length === 0) {
          errors.push('switchTab requires a non-empty alias or targetId string');
        }
      } else if (params && typeof params === 'object') {
        if (!params.targetId && !params.url) {
          errors.push('switchTab object requires targetId or url');
        }
        if (params.url !== undefined && typeof params.url !== 'string') {
          errors.push('switchTab url must be a string (regex pattern)');
        }
        if (params.targetId !== undefined && typeof params.targetId !== 'string') {
          errors.push('switchTab targetId must be a string');
        }
        if (params.host !== undefined && typeof params.host !== 'string') {
          errors.push('switchTab host must be a string');
        }
        if (params.port !== undefined && typeof params.port !== 'number') {
          errors.push('switchTab port must be a number');
        }
      } else {
        errors.push('switchTab requires a string (alias/targetId) or object with {targetId} or {url}');
      }
      break;

    case 'sleep':
      if (typeof params !== 'number') {
        errors.push('sleep requires a number (milliseconds)');
      } else if (params < 0) {
        errors.push('sleep time must be non-negative');
      } else if (params > 60000) {
        errors.push('sleep time must not exceed 60000ms');
      }
      break;

    case 'getUrl':
      if (params !== true) {
        errors.push('getUrl requires true');
      }
      break;

    case 'getTitle':
      if (params !== true) {
        errors.push('getTitle requires true');
      }
      break;
  }

  // Validate hooks on action steps (readyWhen, settledWhen, observe)
  if (typeof params === 'object' && params !== null) {
    if (params.readyWhen !== undefined && typeof params.readyWhen !== 'string') {
      errors.push('readyWhen must be a function string');
    }
    if (params.settledWhen !== undefined && typeof params.settledWhen !== 'string') {
      errors.push('settledWhen must be a function string');
    }
    if (params.observe !== undefined && typeof params.observe !== 'string') {
      errors.push('observe must be a function string');
    }
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
    return {
      valid: false,
      errors: invalidSteps
    };
  }

  return { valid: true, errors: [] };
}
