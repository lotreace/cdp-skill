import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestRunner, validateSteps } from '../runner/index.js';
import { ErrorTypes } from '../utils.js';

describe('TestRunner', () => {
  let testRunner;
  let mockPageController;
  let mockElementLocator;
  let mockInputEmulator;
  let mockScreenshotCapture;

  // Helper to create a mock element handle
  function createMockHandle(box = { x: 100, y: 200, width: 50, height: 30 }) {
    return {
      objectId: 'mock-object-id-123',
      scrollIntoView: mock.fn(() => Promise.resolve()),
      waitForStability: mock.fn(() => Promise.resolve(box)),
      isActionable: mock.fn(() => Promise.resolve({ actionable: true, reason: null })),
      getBoundingBox: mock.fn(() => Promise.resolve(box)),
      dispose: mock.fn(() => Promise.resolve()),
      focus: mock.fn(() => Promise.resolve())
    };
  }

  beforeEach(() => {
    mockPageController = {
      navigate: mock.fn(() => Promise.resolve()),
      getUrl: mock.fn(() => Promise.resolve('http://test.com')),
      evaluateInFrame: mock.fn((expression, options = {}) => {
        // Delegate to session.send with same behavior as real evaluateInFrame
        const params = {
          expression,
          returnByValue: options.returnByValue !== false,
          awaitPromise: options.awaitPromise || false
        };
        return mockPageController.session.send('Runtime.evaluate', params);
      }),
      getFrameContext: mock.fn(() => null),
      session: { send: null } // Will be set after mockElementLocator is created
    };

    const mockHandle = createMockHandle();
    // Mock session.send to return appropriate values for different CDP calls
    const mockSessionSend = mock.fn((method, params) => {
      // Handle Runtime.evaluate for getCurrentUrl (window.location.href)
      if (method === 'Runtime.evaluate' && params?.expression?.includes('window.location.href')) {
        return Promise.resolve({ result: { value: 'http://test.com' } });
      }
      // Handle Runtime.evaluate for ActionabilityChecker.findElementInternal
      if (method === 'Runtime.evaluate' && params?.expression?.includes('document.querySelector')) {
        return Promise.resolve({ result: { objectId: 'mock-object-id-123' } });
      }
      // Handle Runtime.evaluate for viewport bounds (ClickExecutor._getViewportBounds)
      if (method === 'Runtime.evaluate' && params?.expression?.includes('innerWidth')) {
        return Promise.resolve({ result: { value: { width: 1920, height: 1080 } } });
      }
      // Handle Runtime.evaluate for WaitExecutor text search
      if (method === 'Runtime.evaluate' && params?.expression?.includes('document.body.innerText')) {
        return Promise.resolve({ result: { value: true } });
      }
      // Handle Runtime.evaluate for browser-side waitForSelector (MutationObserver)
      if (method === 'Runtime.evaluate' && params?.expression?.includes('MutationObserver') && params?.expression?.includes('querySelector')) {
        return Promise.resolve({ result: { value: { found: true, immediate: true } } });
      }
      // Handle Runtime.evaluate for WaitExecutor element count
      if (method === 'Runtime.evaluate' && params?.expression?.includes('querySelectorAll')) {
        return Promise.resolve({ result: { value: 10 } });
      }
      // Handle Runtime.evaluate for WaitExecutor hidden check
      if (method === 'Runtime.evaluate' && params?.expression?.includes('getComputedStyle')) {
        return Promise.resolve({ result: { value: true } });
      }
      // Handle Runtime.callFunctionOn for ActionabilityChecker - attached check
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('isConnected')) {
        return Promise.resolve({ result: { value: { matches: true, received: 'attached' } } });
      }
      // Handle Runtime.callFunctionOn for ActionabilityChecker - visible check
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('visibility')) {
        return Promise.resolve({ result: { value: { matches: true, received: 'visible' } } });
      }
      // Handle Runtime.callFunctionOn for ActionabilityChecker - enabled check
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('aria-disabled')) {
        return Promise.resolve({ result: { value: { matches: true, received: 'enabled' } } });
      }
      // Handle Runtime.callFunctionOn for ActionabilityChecker - stable check
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('requestAnimationFrame')) {
        return Promise.resolve({ result: { value: { matches: true, received: 'stable' } } });
      }
      // Handle Runtime.callFunctionOn for ActionabilityChecker - editable check
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('isContentEditable')) {
        return Promise.resolve({ result: { value: { matches: true, received: 'editable' } } });
      }
      // Handle Runtime.callFunctionOn for ElementValidator.isEditable
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('readOnly')) {
        return Promise.resolve({ result: { value: { editable: true, reason: null } } });
      }
      // Handle Runtime.callFunctionOn for ElementValidator.isClickable
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('clickable')) {
        return Promise.resolve({ result: { value: { clickable: true, reason: null, willNavigate: false } } });
      }
      // Handle Runtime.callFunctionOn for focus calls
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('focus')) {
        return Promise.resolve({ result: { value: true } });
      }
      // Handle Runtime.callFunctionOn for JS click execution
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('.click()')) {
        return Promise.resolve({ result: { value: { success: true, targetReceived: true } } });
      }
      // Handle Runtime.callFunctionOn for getClickablePoint (getBoundingClientRect in actionability checker)
      if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('getBoundingClientRect')) {
        // getClickablePoint returns { x: centerX, y: centerY, rect: {...} }
        return Promise.resolve({
          result: {
            value: {
              x: 125, // center: 100 + 50/2
              y: 215, // center: 200 + 30/2
              rect: { x: 100, y: 200, width: 50, height: 30 }
            }
          }
        });
      }
      // Handle Runtime.releaseObject (cleanup)
      if (method === 'Runtime.releaseObject') {
        return Promise.resolve({});
      }
      // Default response for other calls
      return Promise.resolve({ result: { value: true } });
    });
    mockElementLocator = {
      waitForSelector: mock.fn(() => Promise.resolve()),
      waitForText: mock.fn(() => Promise.resolve()),
      findElement: mock.fn(() => Promise.resolve({ nodeId: 123, _handle: mockHandle })),
      getBoundingBox: mock.fn(() => Promise.resolve({ x: 100, y: 200, width: 50, height: 30 })),
      querySelectorAll: mock.fn(() => Promise.resolve([])),
      session: { send: mockSessionSend }
    };

    // Set mockPageController session to use same send function
    mockPageController.session = { send: mockSessionSend };

    mockInputEmulator = {
      click: mock.fn(() => Promise.resolve()),
      type: mock.fn(() => Promise.resolve()),
      insertText: mock.fn(() => Promise.resolve()),
      press: mock.fn(() => Promise.resolve()),
      selectAll: mock.fn(() => Promise.resolve())
    };

    mockScreenshotCapture = {
      captureToFile: mock.fn(() => Promise.resolve('/tmp/screenshot.png')),
      getViewportDimensions: mock.fn(() => Promise.resolve({ width: 1920, height: 1080 }))
    };

    const mockConsoleCapture = {
      getMessages: () => []
    };

    testRunner = createTestRunner({
      pageController: mockPageController,
      elementLocator: mockElementLocator,
      inputEmulator: mockInputEmulator,
      screenshotCapture: mockScreenshotCapture,
      consoleCapture: mockConsoleCapture
    });
  });

  afterEach(() => {
    mock.reset();
  });

  describe('run', () => {
    it('should execute all steps and return passed status', async () => {
      const steps = [
        { goto: 'http://test.com' },
        { wait: '#main' },
        { click: '#button' }
      ];

      const result = await testRunner.run(steps);

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.steps.length, 3);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should stop on first error by default', async () => {
      // Override session.send to return null element for querySelector
      const originalSend = mockElementLocator.session.send;
      mockElementLocator.session.send = mock.fn((method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression?.includes('document.querySelector')) {
          return Promise.resolve({ result: { subtype: 'null' } });
        }
        return originalSend(method, params);
      });

      const steps = [
        { goto: 'http://test.com' },
        { click: '#nonexistent' },
        { click: '#button' }
      ];

      const result = await testRunner.run(steps, { stepTimeout: 500 });

      assert.strictEqual(result.status, 'error');
      assert.strictEqual(result.steps.length, 2);
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].step, 2);

      // Restore original mock
      mockElementLocator.session.send = originalSend;
    });

    it('should continue on error when stopOnError is false', async () => {
      // Track which selector is being queried
      let callCount = 0;
      const originalSend = mockElementLocator.session.send;
      mockElementLocator.session.send = mock.fn((method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression?.includes('document.querySelector')) {
          callCount++;
          // First querySelector call (for #nonexistent) should fail, second (for #button) should succeed
          if (params.expression.includes('#nonexistent')) {
            return Promise.resolve({ result: { subtype: 'null' } });
          }
          return Promise.resolve({ result: { objectId: 'mock-object-id-123' } });
        }
        return originalSend(method, params);
      });

      const steps = [
        { goto: 'http://test.com' },
        { click: '#nonexistent' },
        { click: '#button' }
      ];

      const result = await testRunner.run(steps, { stopOnError: false, stepTimeout: 500 });

      assert.strictEqual(result.status, 'error');
      assert.strictEqual(result.steps.length, 3);
      assert.strictEqual(result.errors.length, 1);

      // Restore original mock
      mockElementLocator.session.send = originalSend;
    });

  });

  describe('executeStep - goto', () => {
    it('should execute goto step with URL', async () => {
      const result = await testRunner.executeStep({ goto: 'http://test.com' });

      assert.strictEqual(result.action, 'goto');
      // Note: params are only included in error responses now
      assert.strictEqual(result.params, undefined);
      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(mockPageController.navigate.mock.calls.length, 1);
      assert.strictEqual(mockPageController.navigate.mock.calls[0].arguments[0], 'http://test.com');
    });
  });

  describe('executeStep - wait', () => {
    it('should wait for selector string', async () => {
      const result = await testRunner.executeStep({ wait: '#main' });

      assert.strictEqual(result.action, 'wait');
      // Note: params are only included in error responses now
      assert.strictEqual(result.params, undefined);
      assert.strictEqual(result.status, 'ok');
      // Browser-side polling now uses session.send directly, not elementLocator.waitForSelector
    });

    it('should wait for selector with timeout', async () => {
      const result = await testRunner.executeStep({ wait: { selector: '#main', timeout: 5000 } });

      assert.strictEqual(result.action, 'wait');
      assert.strictEqual(result.status, 'ok');
      // Note: params are only included in error responses now
      assert.strictEqual(result.params, undefined);
    });

    it('should wait for text', async () => {
      const result = await testRunner.executeStep({ wait: { text: 'Hello World', timeout: 3000 } });

      // WaitExecutor now uses session.send directly for text wait
      assert.strictEqual(result.action, 'wait');
      assert.strictEqual(result.status, 'ok');
      // Note: params are only included in error responses now
      assert.strictEqual(result.params, undefined);
    });

    it('should wait for time delay', async () => {
      const startTime = Date.now();
      const result = await testRunner.executeStep({ wait: { time: 50 } });
      const elapsed = Date.now() - startTime;

      assert.strictEqual(result.action, 'wait');
      assert.ok(elapsed >= 50);
    });

    it('should fail on invalid wait params', async () => {
      const result = await testRunner.executeStep({ wait: { invalid: true } });

      assert.strictEqual(result.status, 'error');
      assert.ok(result.error.includes('Invalid wait params'));
    });
  });

  describe('executeStep - click', () => {
    it('should click element by selector string', async () => {
      const result = await testRunner.executeStep({ click: '#button' });

      assert.strictEqual(result.action, 'click');
      assert.strictEqual(result.status, 'ok');
      // The ClickExecutor uses actionabilityChecker which goes through session.send
      // instead of elementLocator.findElement, so we verify click was called
      assert.strictEqual(mockInputEmulator.click.mock.calls.length, 1);
      // Click coordinates should be center of bounding box (100+25, 200+15)
      assert.strictEqual(mockInputEmulator.click.mock.calls[0].arguments[0], 125);
      assert.strictEqual(mockInputEmulator.click.mock.calls[0].arguments[1], 215);
    });

    it('should click element by selector object', async () => {
      const result = await testRunner.executeStep({ click: { selector: '#button' } });

      assert.strictEqual(result.status, 'ok');
      // Verify click was performed (actionabilityChecker handles element finding)
      assert.strictEqual(mockInputEmulator.click.mock.calls.length, 1);
    });

    it('should fail when element not found', async () => {
      // Override session.send to return null element for querySelector
      const originalSend = mockElementLocator.session.send;
      mockElementLocator.session.send = mock.fn((method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression?.includes('document.querySelector')) {
          return Promise.resolve({ result: { subtype: 'null' } });
        }
        return originalSend(method, params);
      });

      const result = await testRunner.executeStep({ click: '#missing' }, { stepTimeout: 1000 });

      assert.strictEqual(result.status, 'error');
      // The error could be about element not found, actionability, or timeout
      assert.ok(result.error.includes('Element not found') ||
                result.error.includes('not actionable') ||
                result.error.includes('Timeout') ||
                result.error.includes('timed out'));

      // Restore original mock
      mockElementLocator.session.send = originalSend;
    });

    it('should fail when element not attached', async () => {
      // Override session.send to return failure for attached check (element detached from DOM)
      const originalSend = mockElementLocator.session.send;
      mockElementLocator.session.send = mock.fn((method, params) => {
        // Return element found initially
        if (method === 'Runtime.evaluate' && params?.expression?.includes('document.querySelector')) {
          return Promise.resolve({ result: { objectId: 'mock-object-id-123' } });
        }
        // Return attached check failure (element disconnected)
        if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('isConnected')) {
          return Promise.resolve({ result: { value: { matches: false, received: 'detached' } } });
        }
        return originalSend(method, params);
      });

      const result = await testRunner.executeStep({ click: '#detached' }, { stepTimeout: 1000 });

      assert.strictEqual(result.status, 'error');
      // The error should be about element not being attached/actionable
      assert.ok(result.error.includes('not attached') ||
                result.error.includes('detached') ||
                result.error.includes('Timeout') ||
                result.error.includes('timed out'));

      // Restore original mock
      mockElementLocator.session.send = originalSend;
    });
  });

  describe('executeStep - fill', () => {
    it('should fill input field', async () => {
      const result = await testRunner.executeStep({ fill: { selector: '#input', value: 'test' } });

      assert.strictEqual(result.action, 'fill');
      // FillExecutor uses actionabilityChecker which goes through session.send
      // We verify the input operations were called
      assert.strictEqual(mockInputEmulator.click.mock.calls.length, 1);
      assert.strictEqual(mockInputEmulator.selectAll.mock.calls.length, 1);
      assert.strictEqual(mockInputEmulator.insertText.mock.calls.length, 1);
      assert.strictEqual(mockInputEmulator.insertText.mock.calls[0].arguments[0], 'test');
    });

    it('should fill without clearing when clear is false', async () => {
      const result = await testRunner.executeStep({ fill: { selector: '#input', value: 'test', clear: false } });

      assert.strictEqual(mockInputEmulator.selectAll.mock.calls.length, 0);
      assert.strictEqual(mockInputEmulator.insertText.mock.calls.length, 1);
    });

    it('should fail without selector, ref, or label', async () => {
      const result = await testRunner.executeStep({ fill: { value: 'test' } });

      assert.strictEqual(result.status, 'error');
      assert.ok(result.error.includes('Fill requires selector, ref, or label'));
    });

    it('should fail without value', async () => {
      const result = await testRunner.executeStep({ fill: { selector: '#input' } });

      assert.strictEqual(result.status, 'error');
      assert.ok(result.error.includes('Fill requires value'));
    });

    it('should fail when element not found', async () => {
      // Override session.send to return null element for querySelector
      const originalSend = mockElementLocator.session.send;
      mockElementLocator.session.send = mock.fn((method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression?.includes('document.querySelector')) {
          return Promise.resolve({ result: { subtype: 'null' } });
        }
        return originalSend(method, params);
      });

      const result = await testRunner.executeStep({ fill: { selector: '#missing', value: 'test' } }, { stepTimeout: 1000 });

      assert.strictEqual(result.status, 'error');
      // The error could be about element not found, actionability, or timeout
      assert.ok(result.error.includes('Element not found') ||
                result.error.includes('not actionable') ||
                result.error.includes('Timeout') ||
                result.error.includes('timed out'));

      // Restore original mock
      mockElementLocator.session.send = originalSend;
    });
  });

  describe('executeStep - press', () => {
    it('should press key', async () => {
      const result = await testRunner.executeStep({ press: 'Enter' });

      assert.strictEqual(result.action, 'press');
      // Note: params are only included in error responses now
      assert.strictEqual(result.params, undefined);
      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(mockInputEmulator.press.mock.calls.length, 1);
      assert.strictEqual(mockInputEmulator.press.mock.calls[0].arguments[0], 'Enter');
    });
  });

  describe('executeStep - unknown', () => {
    it('should fail on unknown step type', async () => {
      const result = await testRunner.executeStep({ unknownAction: true });

      assert.strictEqual(result.status, 'error');
      assert.ok(result.error.includes('Unknown step type'));
    });

    it('should fail on ambiguous step with multiple actions', async () => {
      const result = await testRunner.executeStep({ goto: 'http://test.com', click: '#button' });

      assert.strictEqual(result.status, 'error');
      assert.ok(result.error.includes('Ambiguous step'));
      assert.ok(result.error.includes('goto'));
      assert.ok(result.error.includes('click'));
    });
  });

  describe('executeStep - timeout', () => {
    it('should timeout long-running steps', async () => {
      mockPageController.navigate.mock.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 5000)));

      const result = await testRunner.executeStep({ goto: 'http://test.com' }, { stepTimeout: 50 });

      assert.strictEqual(result.status, 'error');
      assert.ok(result.error.includes('timed out'));
    });
  });

  // Note: Step duration tracking removed for streamlined response format

  describe('validateSteps', () => {
    it('should pass valid steps', () => {
      const steps = [
        { goto: 'http://test.com' },
        { wait: '#main' },
        { wait: { selector: '#element', timeout: 5000 } },
        { wait: { text: 'Hello', timeout: 3000 } },
        { wait: { time: 100 } },
        { click: '#button' },
        { click: { selector: '#link' } },
        { fill: { selector: '#input', value: 'test' } },
        { press: 'Enter' }
      ];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should return errors for unknown step type', () => {
      const steps = [{ unknownAction: true }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].index, 0);
      assert.ok(result.errors[0].errors[0].includes('unknown step type'));
    });

    it('should return errors for ambiguous step', () => {
      const steps = [{ goto: 'http://test.com', click: '#button' }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 1);
      assert.ok(result.errors[0].errors[0].includes('ambiguous'));
    });

    it('should return errors for empty goto URL', () => {
      const steps = [{ goto: '' }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('non-empty'));
    });

    it('should return errors for non-string goto', () => {
      const steps = [{ goto: 123 }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      // Now accepts both string and object format
      assert.ok(result.errors[0].errors[0].includes('URL string') || result.errors[0].errors[0].includes('url property'));
    });

    it('should return errors for empty wait selector', () => {
      const steps = [{ wait: '' }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('cannot be empty'));
    });

    it('should return errors for invalid wait object', () => {
      const steps = [{ wait: { invalid: true } }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('selector, text, textRegex, time, or urlContains'));
    });

    it('should return errors for negative wait time', () => {
      const steps = [{ wait: { time: -100 } }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('non-negative number'));
    });

    it('should return errors for empty click selector', () => {
      const steps = [{ click: '' }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('cannot be empty'));
    });

    it('should return errors for click without selector', () => {
      const steps = [{ click: { other: 'value' } }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires selector'));
    });

    it('should return errors for fill without selector, ref, or label', () => {
      const steps = [{ fill: { value: 'test' } }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors.some(e => e.includes('requires selector, ref, or label')));
    });

    it('should return errors for fill without value', () => {
      const steps = [{ fill: { selector: '#input' } }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors.some(e => e.includes('requires value')));
    });

    it('should return errors for fill with non-object', () => {
      const steps = [{ fill: '#input' }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('object with selector/ref/label and value'));
    });

    it('should accept fill with ref instead of selector', () => {
      const steps = [{ fill: { ref: 's1e3', value: 'test' } }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, true);
    });

    it('should validate fillForm step', () => {
      const steps = [{ fillForm: { '#firstName': 'John', '#lastName': 'Doe' } }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, true);
    });

    it('should return errors for empty fillForm', () => {
      const steps = [{ fillForm: {} }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('at least one field'));
    });

    it('should return errors for fillForm with non-object', () => {
      const steps = [{ fillForm: '#input' }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('object mapping'));
    });

    it('should return errors for empty press key', () => {
      const steps = [{ press: '' }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('non-empty key'));
    });

    it('should return errors for non-string press key', () => {
      const steps = [{ press: 123 }];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('non-empty key'));
    });

    it('should collect all invalid steps', () => {
      const steps = [
        { goto: 'http://test.com' },
        { click: '' },
        { wait: '#main' },
        { fill: { selector: '#input' } },
        { unknownAction: true }
      ];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 3);
      assert.strictEqual(result.errors[0].index, 1);
      assert.strictEqual(result.errors[1].index, 3);
      assert.strictEqual(result.errors[2].index, 4);
    });

    it('should return errors for non-object step', () => {
      const steps = [null];

      const result = testRunner.validateSteps(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('must be an object'));
    });
  });

  describe('run with validation', () => {
    it('should validate steps before execution', async () => {
      const steps = [
        { goto: 'http://test.com' },
        { unknownAction: true }
      ];

      await assert.rejects(
        () => testRunner.run(steps),
        (err) => err.name === ErrorTypes.STEP_VALIDATION
      );
      assert.strictEqual(mockPageController.navigate.mock.calls.length, 0);
    });

    it('should not execute any steps if validation fails', async () => {
      const steps = [
        { goto: 'http://test.com' },
        { click: '' },
        { wait: '#element' }
      ];

      await assert.rejects(
        () => testRunner.run(steps),
        (err) => err.name === ErrorTypes.STEP_VALIDATION
      );
      assert.strictEqual(mockPageController.navigate.mock.calls.length, 0);
      assert.strictEqual(mockElementLocator.findElement.mock.calls.length, 0);
      assert.strictEqual(mockElementLocator.waitForSelector.mock.calls.length, 0);
    });
  });

  describe('hover step validation', () => {
    it('should accept valid hover with selector string', () => {
      const result = validateSteps([{ hover: '#menu-item' }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid hover with selector object', () => {
      const result = validateSteps([{ hover: { selector: '.dropdown' } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid hover with ref', () => {
      const result = validateSteps([{ hover: { ref: 's1e4' } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should reject empty hover selector', () => {
      const result = validateSteps([{ hover: '' }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('cannot be empty'));
    });

    it('should reject hover without selector or ref', () => {
      const result = validateSteps([{ hover: { duration: 500 } }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires selector or ref'));
    });
  });

  describe('viewport step validation', () => {
    it('should accept valid viewport', () => {
      const result = validateSteps([{ viewport: { width: 1280, height: 720 } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept viewport with all options', () => {
      const result = validateSteps([{
        viewport: { width: 375, height: 667, mobile: true, hasTouch: true, deviceScaleFactor: 2 }
      }]);
      assert.strictEqual(result.valid, true);
    });

    it('should reject viewport without width', () => {
      const result = validateSteps([{ viewport: { height: 720 } }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires numeric width'));
    });

    it('should reject viewport without height', () => {
      const result = validateSteps([{ viewport: { width: 1280 } }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires numeric height'));
    });

    it('should accept viewport with device preset string', () => {
      // Viewport now accepts device preset strings
      const result = validateSteps([{ viewport: 'iphone12' }]);
      assert.strictEqual(result.valid, true);
    });

    it('should reject viewport with invalid type', () => {
      const result = validateSteps([{ viewport: 123 }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires a device preset string or object'));
    });
  });

  describe('cookies step validation', () => {
    it('should accept valid cookies get', () => {
      const result = validateSteps([{ cookies: { get: true } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept cookies get with URL filter', () => {
      const result = validateSteps([{ cookies: { get: ['https://example.com'] } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid cookies set', () => {
      const result = validateSteps([{
        cookies: { set: [{ name: 'session', value: 'abc', domain: 'example.com' }] }
      }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid cookies clear', () => {
      const result = validateSteps([{ cookies: { clear: true } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should reject non-object cookies', () => {
      const result = validateSteps([{ cookies: 'get' }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires an object'));
    });

    it('should reject cookies set with non-array', () => {
      const result = validateSteps([{ cookies: { set: { name: 'session', value: 'abc' } } }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires an array'));
    });
  });

  describe('press with keyboard combos', () => {
    it('should accept simple key press', () => {
      const result = validateSteps([{ press: 'Enter' }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept keyboard combo', () => {
      const result = validateSteps([{ press: 'Control+a' }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept complex keyboard combo', () => {
      const result = validateSteps([{ press: 'Control+Shift+Enter' }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept Meta key combo', () => {
      const result = validateSteps([{ press: 'Meta+c' }]);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('assert step validation', () => {
    it('should accept valid URL assertion with contains', () => {
      const result = validateSteps([{ assert: { url: { contains: '/wiki/Albert' } } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid URL assertion with equals', () => {
      const result = validateSteps([{ assert: { url: { equals: 'https://example.com' } } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid URL assertion with startsWith', () => {
      const result = validateSteps([{ assert: { url: { startsWith: 'https://' } } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid URL assertion with endsWith', () => {
      const result = validateSteps([{ assert: { url: { endsWith: '/success' } } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid URL assertion with matches', () => {
      const result = validateSteps([{ assert: { url: { matches: '^https://.*\\.example\\.com' } } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid text assertion', () => {
      const result = validateSteps([{ assert: { text: 'Welcome' } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept text assertion with selector', () => {
      const result = validateSteps([{ assert: { selector: 'h1', text: 'Title' } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should reject assert without url or text', () => {
      const result = validateSteps([{ assert: { selector: 'h1' } }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires url or text'));
    });

    it('should reject non-object assert', () => {
      const result = validateSteps([{ assert: 'text' }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires an object'));
    });

    it('should reject url assertion without valid operator', () => {
      const result = validateSteps([{ assert: { url: { invalid: 'test' } } }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires contains, equals'));
    });

    it('should reject url assertion with non-object url', () => {
      const result = validateSteps([{ assert: { url: '/wiki/Albert' } }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('url must be an object'));
    });

    it('should reject text assertion with non-string text', () => {
      const result = validateSteps([{ assert: { text: 123 } }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('text must be a string'));
    });
  });

  describe('queryAll step validation', () => {
    it('should accept valid queryAll with string selectors', () => {
      const result = validateSteps([{ queryAll: { title: 'h1', links: 'a' } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept queryAll with query config objects', () => {
      const result = validateSteps([{ queryAll: { buttons: { role: 'button' } } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept queryAll with mixed selectors and configs', () => {
      const result = validateSteps([{
        queryAll: {
          title: 'h1',
          buttons: { role: 'button', name: 'Submit' }
        }
      }]);
      assert.strictEqual(result.valid, true);
    });

    it('should reject empty queryAll', () => {
      const result = validateSteps([{ queryAll: {} }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires at least one query'));
    });

    it('should reject non-object queryAll', () => {
      const result = validateSteps([{ queryAll: 'h1' }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('requires an object'));
    });

    it('should reject queryAll with invalid selector type', () => {
      const result = validateSteps([{ queryAll: { title: 123 } }]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors[0].includes('must be a selector string or query object'));
    });
  });

  describe('cookies with name filter', () => {
    it('should accept cookies get with name filter', () => {
      const result = validateSteps([{ cookies: { get: true, name: 'session_id' } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept cookies get with array of names', () => {
      const result = validateSteps([{ cookies: { get: true, name: ['session_id', 'auth_token'] } }]);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('cookies with human-readable expiration', () => {
    it('should accept cookies set with human-readable expiration', () => {
      const result = validateSteps([{
        cookies: { set: [{ name: 'temp', value: 'data', domain: 'example.com', expires: '1h' }] }
      }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept cookies set with numeric expiration', () => {
      const result = validateSteps([{
        cookies: { set: [{ name: 'temp', value: 'data', domain: 'example.com', expires: 1706547600 }] }
      }]);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('console with stackTrace option', () => {
    it('should accept console with stackTrace option', () => {
      const result = validateSteps([{ console: { stackTrace: true } }]);
      assert.strictEqual(result.valid, true);
    });

    it('should accept console with stackTrace and other options', () => {
      const result = validateSteps([{ console: { level: 'error', stackTrace: true, limit: 10 } }]);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('executeStep - assert', () => {
    it('should pass URL assertion with contains', async () => {
      // Mock getUrl to return a test URL
      mockPageController.getUrl = mock.fn(() => Promise.resolve('https://example.com/wiki/Albert_Einstein'));

      const result = await testRunner.executeStep({
        assert: { url: { contains: '/wiki/Albert' } }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.action, 'assert');
      assert.strictEqual(result.output.passed, true);
      assert.strictEqual(result.output.assertions.length, 1);
      assert.strictEqual(result.output.assertions[0].type, 'url');
      assert.strictEqual(result.output.assertions[0].passed, true);
    });

    it('should fail URL assertion when not matching', async () => {
      mockPageController.getUrl = mock.fn(() => Promise.resolve('https://example.com/home'));

      const result = await testRunner.executeStep({
        assert: { url: { contains: '/wiki/Albert' } }
      });

      assert.strictEqual(result.status, 'error');
      assert.ok(result.error.includes('URL assertion failed'));
    });

    it('should pass URL assertion with equals', async () => {
      mockPageController.getUrl = mock.fn(() => Promise.resolve('https://example.com'));

      const result = await testRunner.executeStep({
        assert: { url: { equals: 'https://example.com' } }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.output.assertions[0].passed, true);
    });

    it('should pass URL assertion with startsWith', async () => {
      mockPageController.getUrl = mock.fn(() => Promise.resolve('https://secure.example.com/page'));

      const result = await testRunner.executeStep({
        assert: { url: { startsWith: 'https://' } }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.output.assertions[0].passed, true);
    });

    it('should pass URL assertion with endsWith', async () => {
      mockPageController.getUrl = mock.fn(() => Promise.resolve('https://example.com/success'));

      const result = await testRunner.executeStep({
        assert: { url: { endsWith: '/success' } }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.output.assertions[0].passed, true);
    });

    it('should pass URL assertion with matches (regex)', async () => {
      mockPageController.getUrl = mock.fn(() => Promise.resolve('https://api.example.com/v1/users'));

      const result = await testRunner.executeStep({
        assert: { url: { matches: '^https://.*\\.example\\.com' } }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.output.assertions[0].passed, true);
    });

    it('should pass text assertion when text is found', async () => {
      const originalSend = mockElementLocator.session.send;
      mockElementLocator.session.send = mock.fn((method, params) => {
        // Handle text content query
        if (method === 'Runtime.evaluate' && params?.expression?.includes('textContent')) {
          return Promise.resolve({ result: { value: 'Welcome to our website! Please login.' } });
        }
        return originalSend(method, params);
      });
      mockPageController.session.send = mockElementLocator.session.send;

      const result = await testRunner.executeStep({
        assert: { text: 'Welcome' }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.output.passed, true);
      assert.strictEqual(result.output.assertions[0].type, 'text');
      assert.strictEqual(result.output.assertions[0].passed, true);

      mockElementLocator.session.send = originalSend;
      mockPageController.session.send = originalSend;
    });

    it('should fail text assertion when text is not found', async () => {
      const originalSend = mockElementLocator.session.send;
      mockElementLocator.session.send = mock.fn((method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression?.includes('textContent')) {
          return Promise.resolve({ result: { value: 'Hello World' } });
        }
        return originalSend(method, params);
      });
      mockPageController.session.send = mockElementLocator.session.send;

      const result = await testRunner.executeStep({
        assert: { text: 'Goodbye' }
      });

      assert.strictEqual(result.status, 'error');
      assert.ok(result.error.includes('Text assertion failed'));

      mockElementLocator.session.send = originalSend;
      mockPageController.session.send = originalSend;
    });

    it('should support text assertion with selector', async () => {
      const originalSend = mockElementLocator.session.send;
      mockElementLocator.session.send = mock.fn((method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression?.includes('textContent')) {
          // Verify the selector is being used
          assert.ok(params.expression.includes('h1'));
          return Promise.resolve({ result: { value: 'Page Title' } });
        }
        return originalSend(method, params);
      });
      mockPageController.session.send = mockElementLocator.session.send;

      const result = await testRunner.executeStep({
        assert: { selector: 'h1', text: 'Title' }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.output.assertions[0].selector, 'h1');

      mockElementLocator.session.send = originalSend;
      mockPageController.session.send = originalSend;
    });
  });

  describe('executeStep - queryAll', () => {
    it('should execute multiple queries and return results', async () => {
      const originalSend = mockElementLocator.session.send;
      mockElementLocator.querySelectorAll = mock.fn((selector) => {
        if (selector === 'h1') {
          return Promise.resolve([{
            objectId: 'h1-obj',
            dispose: mock.fn(() => Promise.resolve())
          }]);
        }
        if (selector === 'a') {
          return Promise.resolve([
            { objectId: 'a1-obj', dispose: mock.fn(() => Promise.resolve()) },
            { objectId: 'a2-obj', dispose: mock.fn(() => Promise.resolve()) }
          ]);
        }
        return Promise.resolve([]);
      });

      mockElementLocator.session.send = mock.fn((method, params) => {
        // Mock text content for query output
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: 'Sample text' } });
        }
        return originalSend(method, params);
      });

      const result = await testRunner.executeStep({
        queryAll: {
          title: 'h1',
          links: 'a'
        }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.action, 'queryAll');
      assert.ok(result.output.title);
      assert.ok(result.output.links);
      assert.strictEqual(result.output.title.total, 1);
      assert.strictEqual(result.output.links.total, 2);

      mockElementLocator.session.send = originalSend;
    });

    it('should handle errors in individual queries', async () => {
      mockElementLocator.querySelectorAll = mock.fn((selector) => {
        if (selector === 'h1') {
          return Promise.resolve([{
            objectId: 'h1-obj',
            dispose: mock.fn(() => Promise.resolve())
          }]);
        }
        if (selector === '.nonexistent') {
          throw new Error('Query failed');
        }
        return Promise.resolve([]);
      });

      const result = await testRunner.executeStep({
        queryAll: {
          title: 'h1',
          missing: '.nonexistent'
        }
      });

      assert.strictEqual(result.status, 'ok');
      assert.ok(result.output.title);
      assert.ok(result.output.missing.error);

      // Restore mock
      mockElementLocator.querySelectorAll = mock.fn(() => Promise.resolve([]));
    });
  });

  describe('executeStep - cookies with name filter', () => {
    it('should filter cookies by name', async () => {
      const mockCookieManager = {
        getCookies: mock.fn(() => Promise.resolve([
          { name: 'session_id', value: 'abc123', domain: 'example.com' },
          { name: 'auth_token', value: 'xyz789', domain: 'example.com' },
          { name: 'tracking_id', value: 'track123', domain: 'example.com' }
        ]))
      };

      const testRunnerWithCookies = createTestRunner({
        pageController: mockPageController,
        elementLocator: mockElementLocator,
        inputEmulator: mockInputEmulator,
        screenshotCapture: mockScreenshotCapture,
        cookieManager: mockCookieManager
      });

      const result = await testRunnerWithCookies.executeStep({
        cookies: { get: true, name: 'session_id' }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.output.cookies.length, 1);
      assert.strictEqual(result.output.cookies[0].name, 'session_id');
    });

    it('should filter cookies by multiple names', async () => {
      const mockCookieManager = {
        getCookies: mock.fn(() => Promise.resolve([
          { name: 'session_id', value: 'abc123', domain: 'example.com' },
          { name: 'auth_token', value: 'xyz789', domain: 'example.com' },
          { name: 'tracking_id', value: 'track123', domain: 'example.com' }
        ]))
      };

      const testRunnerWithCookies = createTestRunner({
        pageController: mockPageController,
        elementLocator: mockElementLocator,
        inputEmulator: mockInputEmulator,
        screenshotCapture: mockScreenshotCapture,
        cookieManager: mockCookieManager
      });

      const result = await testRunnerWithCookies.executeStep({
        cookies: { get: true, name: ['session_id', 'auth_token'] }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.output.cookies.length, 2);
      const names = result.output.cookies.map(c => c.name);
      assert.ok(names.includes('session_id'));
      assert.ok(names.includes('auth_token'));
      assert.ok(!names.includes('tracking_id'));
    });
  });

  describe('executeStep - cookies with human-readable expiration', () => {
    it('should parse hours expiration', async () => {
      const setCookiesCall = { cookies: null };
      const mockCookieManager = {
        setCookies: mock.fn((cookies) => {
          setCookiesCall.cookies = cookies;
          return Promise.resolve();
        })
      };

      const testRunnerWithCookies = createTestRunner({
        pageController: mockPageController,
        elementLocator: mockElementLocator,
        inputEmulator: mockInputEmulator,
        screenshotCapture: mockScreenshotCapture,
        cookieManager: mockCookieManager
      });

      const beforeTime = Math.floor(Date.now() / 1000);
      await testRunnerWithCookies.executeStep({
        cookies: { set: [{ name: 'temp', value: 'data', domain: 'example.com', expires: '1h' }] }
      });
      const afterTime = Math.floor(Date.now() / 1000);

      assert.strictEqual(setCookiesCall.cookies.length, 1);
      const expiresTimestamp = setCookiesCall.cookies[0].expires;
      // Should be approximately 1 hour (3600 seconds) from now
      assert.ok(expiresTimestamp >= beforeTime + 3600 - 1);
      assert.ok(expiresTimestamp <= afterTime + 3600 + 1);
    });

    it('should parse days expiration', async () => {
      const setCookiesCall = { cookies: null };
      const mockCookieManager = {
        setCookies: mock.fn((cookies) => {
          setCookiesCall.cookies = cookies;
          return Promise.resolve();
        })
      };

      const testRunnerWithCookies = createTestRunner({
        pageController: mockPageController,
        elementLocator: mockElementLocator,
        inputEmulator: mockInputEmulator,
        screenshotCapture: mockScreenshotCapture,
        cookieManager: mockCookieManager
      });

      const beforeTime = Math.floor(Date.now() / 1000);
      await testRunnerWithCookies.executeStep({
        cookies: { set: [{ name: 'persist', value: 'data', domain: 'example.com', expires: '7d' }] }
      });
      const afterTime = Math.floor(Date.now() / 1000);

      const expiresTimestamp = setCookiesCall.cookies[0].expires;
      // Should be approximately 7 days from now
      const sevenDaysInSeconds = 7 * 24 * 60 * 60;
      assert.ok(expiresTimestamp >= beforeTime + sevenDaysInSeconds - 1);
      assert.ok(expiresTimestamp <= afterTime + sevenDaysInSeconds + 1);
    });

    it('should parse minutes expiration', async () => {
      const setCookiesCall = { cookies: null };
      const mockCookieManager = {
        setCookies: mock.fn((cookies) => {
          setCookiesCall.cookies = cookies;
          return Promise.resolve();
        })
      };

      const testRunnerWithCookies = createTestRunner({
        pageController: mockPageController,
        elementLocator: mockElementLocator,
        inputEmulator: mockInputEmulator,
        screenshotCapture: mockScreenshotCapture,
        cookieManager: mockCookieManager
      });

      const beforeTime = Math.floor(Date.now() / 1000);
      await testRunnerWithCookies.executeStep({
        cookies: { set: [{ name: 'short', value: 'data', domain: 'example.com', expires: '30m' }] }
      });
      const afterTime = Math.floor(Date.now() / 1000);

      const expiresTimestamp = setCookiesCall.cookies[0].expires;
      // Should be approximately 30 minutes from now
      const thirtyMinutesInSeconds = 30 * 60;
      assert.ok(expiresTimestamp >= beforeTime + thirtyMinutesInSeconds - 1);
      assert.ok(expiresTimestamp <= afterTime + thirtyMinutesInSeconds + 1);
    });

    it('should parse weeks expiration', async () => {
      const setCookiesCall = { cookies: null };
      const mockCookieManager = {
        setCookies: mock.fn((cookies) => {
          setCookiesCall.cookies = cookies;
          return Promise.resolve();
        })
      };

      const testRunnerWithCookies = createTestRunner({
        pageController: mockPageController,
        elementLocator: mockElementLocator,
        inputEmulator: mockInputEmulator,
        screenshotCapture: mockScreenshotCapture,
        cookieManager: mockCookieManager
      });

      const beforeTime = Math.floor(Date.now() / 1000);
      await testRunnerWithCookies.executeStep({
        cookies: { set: [{ name: 'weekly', value: 'data', domain: 'example.com', expires: '2w' }] }
      });
      const afterTime = Math.floor(Date.now() / 1000);

      const expiresTimestamp = setCookiesCall.cookies[0].expires;
      // Should be approximately 2 weeks from now
      const twoWeeksInSeconds = 2 * 7 * 24 * 60 * 60;
      assert.ok(expiresTimestamp >= beforeTime + twoWeeksInSeconds - 1);
      assert.ok(expiresTimestamp <= afterTime + twoWeeksInSeconds + 1);
    });

    it('should preserve numeric expiration timestamps', async () => {
      const setCookiesCall = { cookies: null };
      const mockCookieManager = {
        setCookies: mock.fn((cookies) => {
          setCookiesCall.cookies = cookies;
          return Promise.resolve();
        })
      };

      const testRunnerWithCookies = createTestRunner({
        pageController: mockPageController,
        elementLocator: mockElementLocator,
        inputEmulator: mockInputEmulator,
        screenshotCapture: mockScreenshotCapture,
        cookieManager: mockCookieManager
      });

      const specificTimestamp = 1706547600;
      await testRunnerWithCookies.executeStep({
        cookies: { set: [{ name: 'fixed', value: 'data', domain: 'example.com', expires: specificTimestamp }] }
      });

      assert.strictEqual(setCookiesCall.cookies[0].expires, specificTimestamp);
    });
  });

  describe('executeStep - console with stackTrace', () => {
    it('should include stack trace when option is enabled', async () => {
      const mockConsoleCapture = {
        getMessages: mock.fn(() => [
          {
            level: 'error',
            text: 'Uncaught TypeError: Cannot read property',
            type: 'console',
            url: 'https://example.com/app.js',
            line: 42,
            timestamp: Date.now(),
            stackTrace: {
              callFrames: [
                { functionName: 'handleClick', url: 'https://example.com/app.js', lineNumber: 42, columnNumber: 15 },
                { functionName: '', url: 'https://example.com/app.js', lineNumber: 100, columnNumber: 5 }
              ]
            }
          }
        ])
      };

      const testRunnerWithConsole = createTestRunner({
        pageController: mockPageController,
        elementLocator: mockElementLocator,
        inputEmulator: mockInputEmulator,
        screenshotCapture: mockScreenshotCapture,
        consoleCapture: mockConsoleCapture
      });

      const result = await testRunnerWithConsole.executeStep({
        console: { stackTrace: true }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.output.messages.length, 1);
      assert.ok(result.output.messages[0].stackTrace);
      assert.strictEqual(result.output.messages[0].stackTrace.length, 2);
      assert.strictEqual(result.output.messages[0].stackTrace[0].functionName, 'handleClick');
      assert.strictEqual(result.output.messages[0].stackTrace[0].lineNumber, 42);
      assert.strictEqual(result.output.messages[0].stackTrace[1].functionName, '(anonymous)');
    });

    it('should not include stack trace when option is disabled', async () => {
      const mockConsoleCapture = {
        getMessages: mock.fn(() => [
          {
            level: 'error',
            text: 'Error message',
            type: 'console',
            timestamp: Date.now(),
            stackTrace: {
              callFrames: [
                { functionName: 'test', url: 'test.js', lineNumber: 1, columnNumber: 1 }
              ]
            }
          }
        ])
      };

      const testRunnerWithConsole = createTestRunner({
        pageController: mockPageController,
        elementLocator: mockElementLocator,
        inputEmulator: mockInputEmulator,
        screenshotCapture: mockScreenshotCapture,
        consoleCapture: mockConsoleCapture
      });

      const result = await testRunnerWithConsole.executeStep({
        console: { stackTrace: false }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.output.messages.length, 1);
      assert.strictEqual(result.output.messages[0].stackTrace, undefined);
    });

    it('should handle messages without stack trace gracefully', async () => {
      const mockConsoleCapture = {
        getMessages: mock.fn(() => [
          {
            level: 'log',
            text: 'Simple log message',
            type: 'console',
            timestamp: Date.now()
            // No stackTrace property
          }
        ])
      };

      const testRunnerWithConsole = createTestRunner({
        pageController: mockPageController,
        elementLocator: mockElementLocator,
        inputEmulator: mockInputEmulator,
        screenshotCapture: mockScreenshotCapture,
        consoleCapture: mockConsoleCapture
      });

      const result = await testRunnerWithConsole.executeStep({
        console: { stackTrace: true }
      });

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.output.messages.length, 1);
      // stackTrace should be undefined when not present on the message
      assert.strictEqual(result.output.messages[0].stackTrace, undefined);
    });
  });
});
