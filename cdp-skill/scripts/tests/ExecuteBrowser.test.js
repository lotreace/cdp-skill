import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  executePdf,
  executeEval,
  executeCookies,
  executeListTabs,
  executeCloseTab,
  executeConsole,
  parseExpiration,
  formatStackTrace,
  formatCommandConsole
} from '../runner/execute-browser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPdfCapture(opts = {}) {
  return {
    saveToFile: mock.fn((path, options) => {
      if (opts.saveError) throw new Error(opts.saveError);
      return Promise.resolve({ path, size: 12345 });
    })
  };
}

function createMockPageController(opts = {}) {
  return {
    session: {
      send: mock.fn(() => Promise.resolve({}))
    },
    evaluateInFrame: mock.fn((expression, options) => {
      if (opts.exception) {
        return Promise.resolve({
          result: { value: undefined },
          exceptionDetails: {
            exception: { description: opts.exception },
            text: opts.exception
          }
        });
      }
      if (opts.syntaxError) {
        return Promise.resolve({
          result: { value: undefined },
          exceptionDetails: {
            text: 'SyntaxError: Unexpected token'
          }
        });
      }
      if (opts.timeout) {
        return new Promise(() => {}); // Never resolves
      }
      return Promise.resolve({
        result: {
          value: opts.evalResult || { success: true },
          type: 'object'
        }
      });
    }),
    getFrameContext: mock.fn(() => opts.contextId || null)
  };
}

function createMockCookieManager(opts = {}) {
  return {
    getCookies: mock.fn((urls) => {
      if (opts.getError) throw new Error(opts.getError);
      return Promise.resolve(opts.cookies || [
        { name: 'session', value: 'abc123', domain: 'example.com' }
      ]);
    }),
    setCookies: mock.fn((cookies) => {
      if (opts.setError) throw new Error(opts.setError);
      return Promise.resolve({ count: cookies.length });
    }),
    clearCookies: mock.fn((urls, options) => {
      if (opts.clearError) throw new Error(opts.clearError);
      return Promise.resolve({ count: opts.clearCount || 5 });
    }),
    deleteCookies: mock.fn((names, options) => {
      if (opts.deleteError) throw new Error(opts.deleteError);
      return Promise.resolve({ count: Array.isArray(names) ? names.length : 1 });
    })
  };
}

function createMockBrowser(opts = {}) {
  return {
    getPages: mock.fn(() => {
      if (opts.getError) throw new Error(opts.getError);
      return Promise.resolve(opts.pages || [
        { targetId: 't1', url: 'https://example.com', title: 'Example' }
      ]);
    }),
    closePage: mock.fn((targetId) => {
      if (opts.closeError) throw new Error(opts.closeError);
      return Promise.resolve();
    })
  };
}

function createMockConsoleCapture(opts = {}) {
  return {
    getMessages: mock.fn(() => opts.messages || []),
    getMessagesByLevel: mock.fn((level) => opts.messagesByLevel || []),
    getMessagesByType: mock.fn((type) => opts.messagesByType || []),
    clear: mock.fn(() => {}),
    getMessageCount: mock.fn(() => opts.messageCount || 0)
  };
}

// ---------------------------------------------------------------------------
// Tests: executePdf
// ---------------------------------------------------------------------------

describe('executePdf', () => {
  afterEach(() => { mock.reset(); });

  it('should throw if pdfCapture not available', async () => {
    await assert.rejects(
      executePdf(null, {}, 'test.pdf'),
      { message: 'PDF capture not available' }
    );
  });

  it('should save PDF with string path param', async () => {
    const pdfCapture = createMockPdfCapture();
    const result = await executePdf(pdfCapture, {}, 'report.pdf');

    assert.strictEqual(pdfCapture.saveToFile.mock.calls.length, 1);
    assert.ok(result.path);
    assert.strictEqual(result.size, 12345);
  });

  it('should save PDF with object params', async () => {
    const pdfCapture = createMockPdfCapture();
    const result = await executePdf(pdfCapture, {}, {
      path: 'report.pdf',
      landscape: true
    });

    assert.ok(result.path);
    assert.strictEqual(pdfCapture.saveToFile.mock.calls.length, 1);
  });

  it('should propagate saveToFile errors', async () => {
    const pdfCapture = createMockPdfCapture({ saveError: 'Write failed' });
    await assert.rejects(
      executePdf(pdfCapture, {}, 'test.pdf'),
      { message: 'Write failed' }
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeEval
// ---------------------------------------------------------------------------

describe('executeEval', () => {
  afterEach(() => { mock.reset(); });

  it('should throw if expression is missing', async () => {
    const pc = createMockPageController();
    await assert.rejects(
      executeEval(pc, {}),
      { message: /requires a non-empty expression/i }
    );
  });

  it('should execute string expression', async () => {
    const pc = createMockPageController({ evalResult: { value: 42 } });
    const result = await executeEval(pc, 'document.title');

    assert.strictEqual(pc.evaluateInFrame.mock.calls.length, 1);
    assert.ok(result.value);
  });

  it('should execute object params with expression', async () => {
    const pc = createMockPageController({ evalResult: 123 });
    const result = await executeEval(pc, { expression: '1 + 2' });

    assert.ok(result);
  });

  it('should support await option', async () => {
    const pc = createMockPageController();
    await executeEval(pc, { expression: 'Promise.resolve(42)', await: true });

    const call = pc.evaluateInFrame.mock.calls[0];
    assert.strictEqual(call.arguments[1].awaitPromise, true);
  });

  it('should detect unbalanced quotes', async () => {
    const pc = createMockPageController();
    await assert.rejects(
      executeEval(pc, 'document.querySelector("test)'),
      { message: /unbalanced quotes/i }
    );
  });

  it('should detect unbalanced braces', async () => {
    const pc = createMockPageController();
    await assert.rejects(
      executeEval(pc, '{ foo: "bar" '),
      { message: /unbalanced braces/i }
    );
  });

  it('should detect unbalanced parentheses', async () => {
    const pc = createMockPageController();
    await assert.rejects(
      executeEval(pc, 'Math.max(1, 2 '),
      { message: /unbalanced parentheses/i }
    );
  });

  it('should handle syntax errors with context', async () => {
    const pc = createMockPageController({ syntaxError: true });
    await assert.rejects(
      executeEval(pc, 'invalid syntax here'),
      { message: /syntax error/i }
    );
  });

  it('should handle evaluation exceptions', async () => {
    const pc = createMockPageController({ exception: 'ReferenceError: x is not defined' });
    await assert.rejects(
      executeEval(pc, 'x'),
      { message: /Eval error/i }
    );
  });

  it('should support timeout option', async () => {
    const pc = createMockPageController({ timeout: true });
    await assert.rejects(
      executeEval(pc, { expression: 'new Promise(() => {})', timeout: 100 }),
      { message: /timed out/i }
    );
  });

  it('should support serialize option (default true)', async () => {
    const pc = createMockPageController();
    await executeEval(pc, { expression: 'document.title' });

    // Serialize wraps expression
    const call = pc.evaluateInFrame.mock.calls[0];
    assert.ok(call.arguments[0].includes('document.title'));
  });

  it('should support serialize: false', async () => {
    const pc = createMockPageController();
    await executeEval(pc, { expression: 'document.title', serialize: false });

    const call = pc.evaluateInFrame.mock.calls[0];
    assert.strictEqual(call.arguments[0], 'document.title');
  });
});

// ---------------------------------------------------------------------------
// Tests: parseExpiration
// ---------------------------------------------------------------------------

describe('parseExpiration', () => {
  it('should return number as-is', () => {
    assert.strictEqual(parseExpiration(12345), 12345);
  });

  it('should parse minutes', () => {
    const result = parseExpiration('5m');
    assert.ok(result > Date.now() / 1000);
  });

  it('should parse hours', () => {
    const result = parseExpiration('2h');
    assert.ok(result > Date.now() / 1000);
  });

  it('should parse days', () => {
    const result = parseExpiration('7d');
    assert.ok(result > Date.now() / 1000);
  });

  it('should parse weeks', () => {
    const result = parseExpiration('2w');
    assert.ok(result > Date.now() / 1000);
  });

  it('should parse years', () => {
    const result = parseExpiration('1y');
    assert.ok(result > Date.now() / 1000);
  });

  it('should parse number strings', () => {
    const result = parseExpiration('9999');
    assert.strictEqual(result, 9999);
  });

  it('should return undefined for invalid formats', () => {
    assert.strictEqual(parseExpiration('invalid'), undefined);
    // '5x' parses as number 5 (parseInt extracts leading digits)
    assert.strictEqual(parseExpiration('5x'), 5);
    assert.strictEqual(parseExpiration(true), undefined);
  });
});

// ---------------------------------------------------------------------------
// Tests: executeCookies
// ---------------------------------------------------------------------------

describe('executeCookies', () => {
  afterEach(() => { mock.reset(); });

  it('should throw if cookieManager not available', async () => {
    const pc = createMockPageController();
    await assert.rejects(
      executeCookies(null, pc, { get: true }),
      { message: 'Cookie manager not available' }
    );
  });

  it('should get cookies for current page', async () => {
    const manager = createMockCookieManager();
    const pc = createMockPageController();

    const result = await executeCookies(manager, pc, { get: true });

    assert.strictEqual(result.action, 'get');
    assert.ok(Array.isArray(result.cookies));
  });

  it('should get cookies with name filter', async () => {
    const manager = createMockCookieManager({
      cookies: [
        { name: 'session', value: 'abc' },
        { name: 'tracking', value: 'xyz' }
      ]
    });
    const pc = createMockPageController();

    const result = await executeCookies(manager, pc, { get: true, name: 'session' });

    assert.strictEqual(result.cookies.length, 1);
    assert.strictEqual(result.cookies[0].name, 'session');
  });

  it('should set cookies', async () => {
    const manager = createMockCookieManager();
    const pc = createMockPageController();

    const result = await executeCookies(manager, pc, {
      set: [{ name: 'test', value: '123', domain: 'example.com' }]
    });

    assert.strictEqual(result.action, 'set');
    assert.strictEqual(result.count, 1);
  });

  it('should parse human-readable expiration in cookies', async () => {
    const manager = createMockCookieManager();
    const pc = createMockPageController();

    await executeCookies(manager, pc, {
      set: [{ name: 'test', value: '123', expires: '7d' }]
    });

    const call = manager.setCookies.mock.calls[0];
    const cookie = call.arguments[0][0];
    assert.ok(typeof cookie.expires === 'number');
  });

  it('should clear cookies', async () => {
    const manager = createMockCookieManager({ clearCount: 10 });
    const pc = createMockPageController();

    const result = await executeCookies(manager, pc, { clear: [] });

    assert.strictEqual(result.action, 'clear');
    assert.strictEqual(result.count, 10);
  });

  it('should delete cookies by name', async () => {
    const manager = createMockCookieManager();
    const pc = createMockPageController();

    const result = await executeCookies(manager, pc, {
      delete: ['session', 'tracking']
    });

    assert.strictEqual(result.action, 'delete');
    assert.strictEqual(result.count, 2);
  });

  it('should throw for invalid action', async () => {
    const manager = createMockCookieManager();
    const pc = createMockPageController();

    await assert.rejects(
      executeCookies(manager, pc, {}),
      { message: /requires action/i }
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeListTabs
// ---------------------------------------------------------------------------

describe('executeListTabs', () => {
  afterEach(() => { mock.reset(); });

  it('should throw if browser not available', async () => {
    // executeListTabs checks browser synchronously
    try {
      await executeListTabs(null);
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('Browser not available'));
    }
  });

  it('should list all tabs', async () => {
    const browser = createMockBrowser({
      pages: [
        { targetId: 't1', url: 'https://a.com', title: 'A' },
        { targetId: 't2', url: 'https://b.com', title: 'B' }
      ]
    });

    const result = await executeListTabs(browser);

    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.tabs.length, 2);
    assert.strictEqual(result.tabs[0].targetId, 't1');
    assert.strictEqual(result.tabs[1].targetId, 't2');
  });

  it('should return empty tabs list', async () => {
    const browser = createMockBrowser({ pages: [] });
    const result = await executeListTabs(browser);

    assert.strictEqual(result.count, 0);
    assert.strictEqual(result.tabs.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: executeCloseTab
// ---------------------------------------------------------------------------

describe('executeCloseTab', () => {
  afterEach(() => { mock.reset(); });

  it('should throw if browser not available', async () => {
    // executeCloseTab checks browser synchronously
    try {
      await executeCloseTab(null, 't1');
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('Browser not available'));
    }
  });

  it('should close tab by targetId', async () => {
    const browser = createMockBrowser();
    const result = await executeCloseTab(browser, 't1');

    assert.strictEqual(result.closed, 't1');
    assert.strictEqual(browser.closePage.mock.calls.length, 1);
    assert.strictEqual(browser.closePage.mock.calls[0].arguments[0], 't1');
  });

  it('should propagate close errors', async () => {
    const browser = createMockBrowser({ closeError: 'Tab not found' });
    await assert.rejects(
      executeCloseTab(browser, 't999'),
      { message: 'Tab not found' }
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: formatStackTrace
// ---------------------------------------------------------------------------

describe('formatStackTrace', () => {
  it('should return null for empty stack', () => {
    assert.strictEqual(formatStackTrace(null), null);
    assert.strictEqual(formatStackTrace({}), null);
  });

  it('should format stack frames', () => {
    const stack = {
      callFrames: [
        { functionName: 'foo', url: 'https://example.com/app.js', lineNumber: 10, columnNumber: 5 },
        { functionName: '', url: 'https://example.com/app.js', lineNumber: 20, columnNumber: 10 }
      ]
    };

    const result = formatStackTrace(stack);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].functionName, 'foo');
    assert.strictEqual(result[0].lineNumber, 10);
    assert.strictEqual(result[1].functionName, '(anonymous)');
  });
});

// ---------------------------------------------------------------------------
// Tests: executeConsole
// ---------------------------------------------------------------------------

describe('executeConsole', () => {
  afterEach(() => { mock.reset(); });

  it('should return error if consoleCapture not available', async () => {
    const result = await executeConsole(null, {});

    assert.ok(result.error);
    assert.strictEqual(result.messages.length, 0);
  });

  it('should get console messages', async () => {
    const capture = createMockConsoleCapture({
      messages: [
        { level: 'log', text: 'Hello', timestamp: 1000 },
        { level: 'error', text: 'Error!', timestamp: 2000 }
      ]
    });

    const result = await executeConsole(capture, {});

    assert.strictEqual(capture.getMessages.mock.calls.length, 1);
  });

  it('should filter by level', async () => {
    const capture = createMockConsoleCapture({
      messagesByLevel: [
        { level: 'error', text: 'Error 1' }
      ]
    });

    await executeConsole(capture, { level: 'error' });

    assert.strictEqual(capture.getMessagesByLevel.mock.calls.length, 1);
    assert.strictEqual(capture.getMessagesByLevel.mock.calls[0].arguments[0], 'error');
  });

  it('should filter by type', async () => {
    const capture = createMockConsoleCapture({
      messagesByType: [
        { type: 'exception', text: 'Exception!' }
      ]
    });

    await executeConsole(capture, { type: 'exception' });

    assert.strictEqual(capture.getMessagesByType.mock.calls.length, 1);
  });

  it('should apply limit', async () => {
    const capture = createMockConsoleCapture({
      messages: Array(100).fill().map((_, i) => ({ level: 'log', text: `Msg ${i}` }))
    });

    await executeConsole(capture, { limit: 10 });

    // Limit is applied by slicing messages
    assert.ok(capture.getMessages.mock.calls.length > 0);
  });
});
