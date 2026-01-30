import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  // Core connection and browser management
  createConnection,
  createDiscovery,
  discoverChrome,
  createTargetManager,
  createSessionRegistry,
  createBrowser,
  createPageSession,

  // Page operations
  createPageController,
  WaitCondition,
  waitForCondition,
  waitForFunction,
  waitForNetworkIdle,
  waitForDocumentReady,
  waitForSelector,
  waitForText,

  // Element location and interaction
  createElementHandle,
  createElementLocator,
  createInputEmulator,
  querySelector,
  querySelectorAll,
  findElement,
  getBoundingBox,
  isVisible,
  isActionable,
  scrollIntoView,
  click,
  type,
  fill,
  press,
  scroll,

  // Capture and monitoring
  createScreenshotCapture,
  captureViewport,
  captureFullPage,
  captureRegion,
  saveScreenshot,
  createConsoleCapture,
  createNetworkCapture,
  createErrorAggregator,
  aggregateErrors,

  // Test execution
  validateSteps,
  executeStep,
  runSteps,
  createTestRunner,

  // Errors
  ErrorTypes,
  createError,
  navigationError,
  timeoutError,
  elementNotFoundError,
  staleElementError,
  pageCrashedError,
  contextDestroyedError,
  stepValidationError,
  isErrorType,
  isContextDestroyed,
  isStaleElementError
} from '../index.js';

describe('Integration: Index Exports', () => {
  describe('Core connection and browser management', () => {
    it('should export createConnection', () => {
      assert.ok(createConnection, 'createConnection should be exported');
      assert.strictEqual(typeof createConnection, 'function');
    });

    it('should export createDiscovery', () => {
      assert.ok(createDiscovery, 'createDiscovery should be exported');
      assert.strictEqual(typeof createDiscovery, 'function');
    });

    it('should export discoverChrome', () => {
      assert.ok(discoverChrome, 'discoverChrome should be exported');
      assert.strictEqual(typeof discoverChrome, 'function');
    });

    it('should export createTargetManager', () => {
      assert.ok(createTargetManager, 'createTargetManager should be exported');
      assert.strictEqual(typeof createTargetManager, 'function');
    });

    it('should export createSessionRegistry', () => {
      assert.ok(createSessionRegistry, 'createSessionRegistry should be exported');
      assert.strictEqual(typeof createSessionRegistry, 'function');
    });

    it('should export createBrowser', () => {
      assert.ok(createBrowser, 'createBrowser should be exported');
      assert.strictEqual(typeof createBrowser, 'function');
    });

    it('should export createPageSession', () => {
      assert.ok(createPageSession, 'createPageSession should be exported');
      assert.strictEqual(typeof createPageSession, 'function');
    });
  });

  describe('Page operations', () => {
    it('should export createPageController', () => {
      assert.ok(createPageController, 'createPageController should be exported');
      assert.strictEqual(typeof createPageController, 'function');
    });

    it('should export WaitCondition', () => {
      assert.ok(WaitCondition, 'WaitCondition should be exported');
      assert.strictEqual(typeof WaitCondition, 'object');
      assert.strictEqual(WaitCondition.LOAD, 'load');
      assert.strictEqual(WaitCondition.DOM_CONTENT_LOADED, 'domcontentloaded');
      assert.strictEqual(WaitCondition.NETWORK_IDLE, 'networkidle');
      assert.strictEqual(WaitCondition.COMMIT, 'commit');
    });

    it('should export wait functions', () => {
      assert.ok(waitForCondition, 'waitForCondition should be exported');
      assert.ok(waitForFunction, 'waitForFunction should be exported');
      assert.ok(waitForNetworkIdle, 'waitForNetworkIdle should be exported');
      assert.ok(waitForDocumentReady, 'waitForDocumentReady should be exported');
      assert.ok(waitForSelector, 'waitForSelector should be exported');
      assert.ok(waitForText, 'waitForText should be exported');
    });
  });

  describe('Element location and interaction', () => {
    it('should export createElementHandle', () => {
      assert.ok(createElementHandle, 'createElementHandle should be exported');
      assert.strictEqual(typeof createElementHandle, 'function');
    });

    it('should export createElementLocator', () => {
      assert.ok(createElementLocator, 'createElementLocator should be exported');
      assert.strictEqual(typeof createElementLocator, 'function');
    });

    it('should export createInputEmulator', () => {
      assert.ok(createInputEmulator, 'createInputEmulator should be exported');
      assert.strictEqual(typeof createInputEmulator, 'function');
    });

    it('should export DOM convenience functions', () => {
      assert.ok(querySelector, 'querySelector should be exported');
      assert.ok(querySelectorAll, 'querySelectorAll should be exported');
      assert.ok(findElement, 'findElement should be exported');
      assert.ok(getBoundingBox, 'getBoundingBox should be exported');
      assert.ok(isVisible, 'isVisible should be exported');
      assert.ok(isActionable, 'isActionable should be exported');
      assert.ok(scrollIntoView, 'scrollIntoView should be exported');
    });

    it('should export input convenience functions', () => {
      assert.ok(click, 'click should be exported');
      assert.ok(type, 'type should be exported');
      assert.ok(fill, 'fill should be exported');
      assert.ok(press, 'press should be exported');
      assert.ok(scroll, 'scroll should be exported');
    });
  });

  describe('Capture and monitoring', () => {
    it('should export createScreenshotCapture', () => {
      assert.ok(createScreenshotCapture, 'createScreenshotCapture should be exported');
      assert.strictEqual(typeof createScreenshotCapture, 'function');
    });

    it('should export screenshot convenience functions', () => {
      assert.ok(captureViewport, 'captureViewport should be exported');
      assert.ok(captureFullPage, 'captureFullPage should be exported');
      assert.ok(captureRegion, 'captureRegion should be exported');
      assert.ok(saveScreenshot, 'saveScreenshot should be exported');
    });

    it('should export createConsoleCapture', () => {
      assert.ok(createConsoleCapture, 'createConsoleCapture should be exported');
      assert.strictEqual(typeof createConsoleCapture, 'function');
    });

    it('should export createNetworkCapture', () => {
      assert.ok(createNetworkCapture, 'createNetworkCapture should be exported');
      assert.strictEqual(typeof createNetworkCapture, 'function');
    });

    it('should export createErrorAggregator', () => {
      assert.ok(createErrorAggregator, 'createErrorAggregator should be exported');
      assert.strictEqual(typeof createErrorAggregator, 'function');
    });

    it('should export aggregateErrors', () => {
      assert.ok(aggregateErrors, 'aggregateErrors should be exported');
      assert.strictEqual(typeof aggregateErrors, 'function');
    });
  });

  describe('Test execution', () => {
    it('should export validateSteps', () => {
      assert.ok(validateSteps, 'validateSteps should be exported');
      assert.strictEqual(typeof validateSteps, 'function');
    });

    it('should export executeStep', () => {
      assert.ok(executeStep, 'executeStep should be exported');
      assert.strictEqual(typeof executeStep, 'function');
    });

    it('should export runSteps', () => {
      assert.ok(runSteps, 'runSteps should be exported');
      assert.strictEqual(typeof runSteps, 'function');
    });

    it('should export createTestRunner', () => {
      assert.ok(createTestRunner, 'createTestRunner should be exported');
      assert.strictEqual(typeof createTestRunner, 'function');
    });
  });

  describe('Error utilities', () => {
    it('should export ErrorTypes', () => {
      assert.ok(ErrorTypes, 'ErrorTypes should be exported');
      assert.strictEqual(typeof ErrorTypes, 'object');
      assert.ok(ErrorTypes.CONNECTION);
      assert.ok(ErrorTypes.NAVIGATION);
      assert.ok(ErrorTypes.TIMEOUT);
      assert.ok(ErrorTypes.ELEMENT_NOT_FOUND);
      assert.ok(ErrorTypes.STALE_ELEMENT);
    });

    it('should export error factory functions', () => {
      assert.ok(createError, 'createError should be exported');
      assert.ok(navigationError, 'navigationError should be exported');
      assert.ok(timeoutError, 'timeoutError should be exported');
      assert.ok(elementNotFoundError, 'elementNotFoundError should be exported');
      assert.ok(staleElementError, 'staleElementError should be exported');
      assert.ok(pageCrashedError, 'pageCrashedError should be exported');
      assert.ok(contextDestroyedError, 'contextDestroyedError should be exported');
      assert.ok(stepValidationError, 'stepValidationError should be exported');
    });

    it('should export error check functions', () => {
      assert.ok(isErrorType, 'isErrorType should be exported');
      assert.ok(isContextDestroyed, 'isContextDestroyed should be exported');
      assert.ok(isStaleElementError, 'isStaleElementError should be exported');
    });

    it('should create errors with correct names', () => {
      const navError = navigationError('test error', 'http://example.com');
      assert.ok(navError instanceof Error);
      assert.strictEqual(navError.name, ErrorTypes.NAVIGATION);

      const toError = timeoutError('test timeout');
      assert.ok(toError instanceof Error);
      assert.strictEqual(toError.name, ErrorTypes.TIMEOUT);

      const elemError = elementNotFoundError('#selector', 5000);
      assert.ok(elemError instanceof Error);
      assert.strictEqual(elemError.name, ErrorTypes.ELEMENT_NOT_FOUND);
      assert.strictEqual(elemError.selector, '#selector');
      assert.strictEqual(elemError.timeout, 5000);
    });
  });
});

describe('Integration: Component Instantiation', () => {
  describe('createBrowser', () => {
    it('should instantiate with default options', () => {
      const client = createBrowser();
      assert.ok(client);
      assert.strictEqual(client.isConnected(), false);
    });

    it('should instantiate with custom host/port', () => {
      const client = createBrowser({ host: '127.0.0.1', port: 9223 });
      assert.ok(client);
    });
  });

  describe('createDiscovery', () => {
    it('should instantiate with host and port', () => {
      const discovery = createDiscovery('localhost', 9222);
      assert.ok(discovery);
      assert.ok(typeof discovery.getVersion === 'function');
    });
  });
});

describe('Integration: TestRunner with Mocks', () => {
  it('should work with mock dependencies', async () => {
    const mockPageController = {
      navigate: async () => {}
    };

    // Create a full mock handle with stability/scroll methods
    const createMockHandle = (box = { x: 100, y: 200, width: 50, height: 30 }) => ({
      objectId: 'mock-object-id-123',
      scrollIntoView: async () => {},
      waitForStability: async () => box,
      isActionable: async () => ({ actionable: true, reason: null }),
      getBoundingBox: async () => box,
      dispose: async () => {},
      focus: async () => {}
    });

    const mockHandle = createMockHandle();
    // Mock session.send to return appropriate values for different CDP calls
    const mockSessionSend = async (method, params) => {
      // Handle Runtime.evaluate for getCurrentUrl (window.location.href)
      if (method === 'Runtime.evaluate' && params?.expression?.includes('window.location.href')) {
        return { result: { value: 'http://example.com' } };
      }
      // Handle Runtime.evaluate for ActionabilityChecker.findElementInternal
      if (method === 'Runtime.evaluate' && params?.expression?.includes('document.querySelector')) {
        return { result: { objectId: 'mock-object-id-123' } };
      }
      // Handle Runtime.evaluate for viewport bounds (ClickExecutor._getViewportBounds)
      if (method === 'Runtime.evaluate' && params?.expression?.includes('innerWidth')) {
        return { result: { value: { width: 1920, height: 1080 } } };
      }
      // Handle Runtime.callFunctionOn for ActionabilityChecker - visible check
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('visibility')) {
        return { result: { value: { matches: true, received: 'visible' } } };
      }
      // Handle Runtime.callFunctionOn for ActionabilityChecker - enabled check
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('aria-disabled')) {
        return { result: { value: { matches: true, received: 'enabled' } } };
      }
      // Handle Runtime.callFunctionOn for ActionabilityChecker - stable check
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('requestAnimationFrame')) {
        return { result: { value: { matches: true, received: 'stable' } } };
      }
      // Handle Runtime.callFunctionOn for ActionabilityChecker - editable check
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('isContentEditable')) {
        return { result: { value: { matches: true, received: 'editable' } } };
      }
      // Handle Runtime.callFunctionOn for getClickablePoint (getBoundingClientRect)
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('getBoundingClientRect')) {
        return { result: { value: { x: 125, y: 215, rect: { x: 100, y: 200, width: 50, height: 30 } } } };
      }
      // Handle Runtime.callFunctionOn for JS click execution
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('.click()')) {
        return { result: { value: { success: true, targetReceived: true } } };
      }
      // Handle Runtime.callFunctionOn for focus calls
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('focus')) {
        return { result: { value: true } };
      }
      // Handle Runtime.releaseObject (cleanup)
      if (method === 'Runtime.releaseObject') {
        return {};
      }
      // Default response for other calls
      return { result: { value: true } };
    };
    const mockElementLocator = {
      waitForSelector: async () => ({ dispose: async () => {} }),
      waitForText: async () => true,
      findElement: async () => ({ nodeId: '123', _handle: mockHandle }),
      getBoundingBox: async () => ({ x: 0, y: 0, width: 100, height: 50 }),
      session: { send: mockSessionSend }
    };

    const mockInputEmulator = {
      click: async () => {},
      type: async () => {},
      press: async () => {},
      selectAll: async () => {}
    };

    const mockScreenshotCapture = {
      captureToFile: async (path) => path,
      getViewportDimensions: async () => ({ width: 1920, height: 1080 })
    };

    const runner = createTestRunner({
      pageController: mockPageController,
      elementLocator: mockElementLocator,
      inputEmulator: mockInputEmulator,
      screenshotCapture: mockScreenshotCapture
    });

    const result = await runner.run([
      { goto: 'http://example.com' },
      { wait: '#main' },
      { click: '#button' },
      { fill: { selector: '#input', value: 'test' } },
      { press: 'Enter' },
      { screenshot: '/tmp/test.png' }
    ]);

    assert.strictEqual(result.status, 'passed');
    assert.strictEqual(result.steps.length, 6);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.screenshots.length, 1);
  });
});

describe('Integration: Error Aggregator with Mocks', () => {
  it('should aggregate errors from console and network captures', () => {
    const mockConsoleCapture = {
      getErrors: () => [{ level: 'error', text: 'Test error', type: 'console' }],
      getWarnings: () => [{ level: 'warning', text: 'Test warning' }]
    };

    const mockNetworkCapture = {
      getNetworkFailures: () => [{ type: 'network-failure', url: 'http://test.com', errorText: 'Failed' }],
      getHttpErrors: () => [{ type: 'http-error', status: 500, url: 'http://api.test.com' }],
      getAllErrors: () => [
        { type: 'network-failure', url: 'http://test.com', errorText: 'Failed', timestamp: 1 },
        { type: 'http-error', status: 500, url: 'http://api.test.com', timestamp: 2 }
      ]
    };

    const aggregator = createErrorAggregator(mockConsoleCapture, mockNetworkCapture);
    const summary = aggregator.getSummary();

    assert.ok(summary.hasErrors);
    assert.strictEqual(summary.counts.consoleErrors, 1);
    assert.strictEqual(summary.counts.consoleWarnings, 1);
    assert.strictEqual(summary.counts.networkFailures, 1);
    assert.strictEqual(summary.counts.httpServerErrors, 1);
  });
});
