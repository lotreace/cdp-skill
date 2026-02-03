/**
 * Browser Executors
 * PDF, eval, cookies, tabs, and console step executors
 *
 * EXPORTS:
 * - executePdf(pdfCapture, elementLocator, params) → Promise<Object>
 * - executeEval(pageController, params) → Promise<Object>
 * - executeCookies(cookieManager, pageController, params) → Promise<Object>
 * - executeListTabs(browser) → Promise<Array>
 * - executeCloseTab(browser, targetId) → Promise<Object>
 * - executeConsole(consoleCapture, params) → Promise<Object>
 * - formatCommandConsole(consoleCapture, messageCountBefore) → Object|null
 *
 * DEPENDENCIES:
 * - ../capture.js: createEvalSerializer
 * - ../utils.js: resolveTempPath
 */

import { createEvalSerializer } from '../capture/index.js';
import { resolveTempPath, getCurrentUrl } from '../utils.js';

export async function executePdf(pdfCapture, elementLocator, params) {
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

export async function executeEval(pageController, params) {
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

/**
 * Parse human-readable expiration string to Unix timestamp
 * Supports: "1h" (hours), "7d" (days), "30m" (minutes), "1w" (weeks), "1y" (years)
 * @param {string|number} expires - Expiration value
 * @returns {number} Unix timestamp in seconds
 */
export function parseExpiration(expires) {
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

export async function executeCookies(cookieManager, pageController, params) {
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

export async function executeListTabs(browser) {
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

export async function executeCloseTab(browser, targetId) {
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

export function formatStackTrace(stackTrace) {
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

export async function executeConsole(consoleCapture, params) {
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

export function formatCommandConsole(consoleCapture, messageCountBefore) {
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
      // Use preserveRefs to avoid clobbering refs from snapshotSearch
      // Use internal to avoid incrementing snapshot ID (this is for diff, not agent-facing)
      beforeViewport = await deps.ariaSnapshot.generate({ mode: 'ai', viewportOnly: true, preserveRefs: true, internal: true });
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
      // Use preserveRefs to avoid clobbering refs from snapshotSearch
      // Use internal to avoid incrementing snapshot ID (this is for diff, not agent-facing)
      const afterViewport = await deps.ariaSnapshot.generate({ mode: 'ai', viewportOnly: true, preserveRefs: true, internal: true });
      const afterFull = await deps.ariaSnapshot.generate({ mode: 'ai', viewportOnly: false, preserveRefs: true, internal: true });

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
 * Execute a validate step - query validation state of an element
 */
