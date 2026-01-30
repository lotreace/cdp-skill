import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createElementHandle } from '../dom.js';
import { ErrorTypes, staleElementError } from '../utils.js';

describe('ElementHandle', () => {
  let mockCdp;
  let handle;
  const testObjectId = 'test-object-id-123';

  beforeEach(() => {
    mockCdp = {
      send: mock.fn(async () => ({}))
    };
    handle = createElementHandle(mockCdp, testObjectId);
  });

  describe('constructor', () => {
    it('should throw if cdp is not provided', () => {
      assert.throws(() => createElementHandle(null, 'obj-id'), {
        message: 'CDP session is required'
      });
    });

    it('should throw if objectId is not provided', () => {
      assert.throws(() => createElementHandle(mockCdp, null), {
        message: 'objectId is required'
      });
    });

    it('should store objectId correctly', () => {
      assert.strictEqual(handle.objectId, testObjectId);
    });

    it('should accept selector option', () => {
      const handleWithSelector = createElementHandle(mockCdp, testObjectId, { selector: '#myButton' });
      assert.strictEqual(handleWithSelector.selector, '#myButton');
    });

    it('should default selector to null', () => {
      assert.strictEqual(handle.selector, null);
    });
  });

  describe('getBoundingBox', () => {
    it('should call Runtime.callFunctionOn with correct parameters', async () => {
      const expectedBox = { x: 10, y: 20, width: 100, height: 50 };
      mockCdp.send = mock.fn(async () => ({
        result: { value: expectedBox }
      }));

      const result = await handle.getBoundingBox();

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
      const [method, params] = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(method, 'Runtime.callFunctionOn');
      assert.strictEqual(params.objectId, testObjectId);
      assert.strictEqual(params.returnByValue, true);
      assert.ok(params.functionDeclaration.includes('getBoundingClientRect'));
      assert.deepStrictEqual(result, expectedBox);
    });

    it('should throw if handle is disposed', async () => {
      await handle.dispose();
      await assert.rejects(() => handle.getBoundingBox(), {
        message: 'ElementHandle has been disposed'
      });
    });
  });

  describe('getClickPoint', () => {
    it('should return center coordinates of bounding box', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: { x: 100, y: 200, width: 50, height: 30 } }
      }));

      const point = await handle.getClickPoint();

      assert.deepStrictEqual(point, { x: 125, y: 215 });
    });

    it('should throw if handle is disposed', async () => {
      await handle.dispose();
      await assert.rejects(() => handle.getClickPoint(), {
        message: 'ElementHandle has been disposed'
      });
    });
  });

  describe('isConnectedToDOM', () => {
    it('should return true when element is connected', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: true }
      }));

      const result = await handle.isConnectedToDOM();

      assert.strictEqual(result, true);
      const [method, params] = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(method, 'Runtime.callFunctionOn');
      assert.ok(params.functionDeclaration.includes('isConnected'));
    });

    it('should return false when element is not connected', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: false }
      }));

      const result = await handle.isConnectedToDOM();

      assert.strictEqual(result, false);
    });

    it('should return false when CDP throws stale element error', async () => {
      mockCdp.send = mock.fn(async () => {
        throw new Error('Could not find object with given id');
      });

      const result = await handle.isConnectedToDOM();

      assert.strictEqual(result, false);
    });

    it('should rethrow non-stale errors', async () => {
      mockCdp.send = mock.fn(async () => {
        throw new Error('Network error');
      });

      await assert.rejects(() => handle.isConnectedToDOM(), {
        message: 'Network error'
      });
    });

    it('should throw if handle is disposed', async () => {
      await handle.dispose();
      await assert.rejects(() => handle.isConnectedToDOM(), {
        message: 'ElementHandle has been disposed'
      });
    });
  });

  describe('ensureConnected', () => {
    it('should not throw when element is connected', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: true }
      }));

      await assert.doesNotReject(() => handle.ensureConnected('click'));
    });

    it('should throw StaleElementError when element is not connected', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: false }
      }));

      await assert.rejects(
        () => handle.ensureConnected('click'),
        (err) => {
          assert.strictEqual(err.name, ErrorTypes.STALE_ELEMENT);
          assert.strictEqual(err.objectId, testObjectId);
          assert.strictEqual(err.operation, 'click');
          return true;
        }
      );
    });

    it('should include operation name in error', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: false }
      }));

      await assert.rejects(
        () => handle.ensureConnected('getBoundingBox'),
        (err) => {
          assert.ok(err.message.includes('getBoundingBox'));
          return true;
        }
      );
    });
  });

  describe('isVisible', () => {
    it('should return true for visible elements', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: true }
      }));

      const result = await handle.isVisible();

      assert.strictEqual(result, true);
      const [method, params] = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(method, 'Runtime.callFunctionOn');
      assert.strictEqual(params.returnByValue, true);
    });

    it('should return false for hidden elements', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: false }
      }));

      const result = await handle.isVisible();

      assert.strictEqual(result, false);
    });
  });

  describe('isActionable', () => {
    it('should return actionable true when element is actionable', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: { actionable: true, reason: null } }
      }));

      const result = await handle.isActionable();

      assert.deepStrictEqual(result, { actionable: true, reason: null });
    });

    it('should return reason when element is not actionable', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: { actionable: false, reason: 'hidden by CSS' } }
      }));

      const result = await handle.isActionable();

      assert.deepStrictEqual(result, { actionable: false, reason: 'hidden by CSS' });
    });

    it('should detect opacity:0 as hidden', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: { actionable: false, reason: 'hidden by CSS' } }
      }));

      const result = await handle.isActionable();

      assert.strictEqual(result.actionable, false);
      assert.strictEqual(result.reason, 'hidden by CSS');
    });

    it('should detect element not connected to DOM', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: { actionable: false, reason: 'element not connected to DOM' } }
      }));

      const result = await handle.isActionable();

      assert.strictEqual(result.actionable, false);
      assert.strictEqual(result.reason, 'element not connected to DOM');
    });

    it('should detect element center not hittable', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: { actionable: false, reason: 'element center not hittable' } }
      }));

      const result = await handle.isActionable();

      assert.strictEqual(result.actionable, false);
      assert.strictEqual(result.reason, 'element center not hittable');
    });
  });

  describe('scrollIntoView', () => {
    it('should call Runtime.callFunctionOn with scrollIntoView options', async () => {
      mockCdp.send = mock.fn(async () => ({}));

      await handle.scrollIntoView({ block: 'center', inline: 'nearest' });

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
      const [method, params] = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(method, 'Runtime.callFunctionOn');
      assert.strictEqual(params.objectId, testObjectId);
      assert.ok(params.functionDeclaration.includes('scrollIntoView'));
      assert.deepStrictEqual(params.arguments, [{ value: 'center' }, { value: 'nearest' }]);
    });

    it('should use default block and inline values', async () => {
      mockCdp.send = mock.fn(async () => ({}));

      await handle.scrollIntoView();

      const [, params] = mockCdp.send.mock.calls[0].arguments;
      assert.deepStrictEqual(params.arguments, [{ value: 'center' }, { value: 'nearest' }]);
    });
  });

  describe('evaluate', () => {
    it('should evaluate function on element', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: 'test-value' }
      }));

      const result = await handle.evaluate(function() { return this.id; });

      assert.strictEqual(result, 'test-value');
      const [method, params] = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(method, 'Runtime.callFunctionOn');
      assert.strictEqual(params.objectId, testObjectId);
      assert.strictEqual(params.returnByValue, true);
    });

    it('should pass arguments to the function', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: 42 }
      }));

      await handle.evaluate(() => {}, 'arg1', 'arg2');

      const [, params] = mockCdp.send.mock.calls[0].arguments;
      assert.deepStrictEqual(params.arguments, [{ value: 'arg1' }, { value: 'arg2' }]);
    });

    it('should accept string function declaration', async () => {
      mockCdp.send = mock.fn(async () => ({
        result: { value: 'result' }
      }));

      await handle.evaluate('function() { return this.tagName; }');

      const [, params] = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(params.functionDeclaration, 'function() { return this.tagName; }');
    });
  });

  describe('dispose', () => {
    it('should call Runtime.releaseObject with objectId', async () => {
      mockCdp.send = mock.fn(async () => ({}));

      await handle.dispose();

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
      const [method, params] = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(method, 'Runtime.releaseObject');
      assert.strictEqual(params.objectId, testObjectId);
    });

    it('should mark handle as disposed', async () => {
      assert.strictEqual(handle.isDisposed(), false);

      await handle.dispose();

      assert.strictEqual(handle.isDisposed(), true);
    });

    it('should not call releaseObject twice', async () => {
      mockCdp.send = mock.fn(async () => ({}));

      await handle.dispose();
      await handle.dispose();

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
    });

    it('should not throw if releaseObject fails', async () => {
      mockCdp.send = mock.fn(async () => {
        throw new Error('Release failed');
      });

      await assert.doesNotReject(() => handle.dispose());
      assert.strictEqual(handle.isDisposed(), true);
    });
  });

  describe('disposed handle operations', () => {
    beforeEach(async () => {
      mockCdp.send = mock.fn(async () => ({}));
      await handle.dispose();
    });

    it('should throw on getBoundingBox', async () => {
      await assert.rejects(() => handle.getBoundingBox(), {
        message: 'ElementHandle has been disposed'
      });
    });

    it('should throw on isVisible', async () => {
      await assert.rejects(() => handle.isVisible(), {
        message: 'ElementHandle has been disposed'
      });
    });

    it('should throw on isActionable', async () => {
      await assert.rejects(() => handle.isActionable(), {
        message: 'ElementHandle has been disposed'
      });
    });

    it('should throw on scrollIntoView', async () => {
      await assert.rejects(() => handle.scrollIntoView(), {
        message: 'ElementHandle has been disposed'
      });
    });

    it('should throw on evaluate', async () => {
      await assert.rejects(() => handle.evaluate(() => {}), {
        message: 'ElementHandle has been disposed'
      });
    });
  });

  describe('stale element error handling', () => {
    const staleErrorMessages = [
      'Could not find object with given id',
      'Object reference not found',
      'Cannot find context with specified id',
      'Node with given id does not belong to the document',
      'No node with given id found',
      'Object is not available',
      'No object with given id',
      'Object with given id not found'
    ];

    describe('getBoundingBox', () => {
      staleErrorMessages.forEach(message => {
        it(`should throw StaleElementError for "${message}"`, async () => {
          mockCdp.send = mock.fn(async () => {
            throw new Error(message);
          });

          await assert.rejects(
            () => handle.getBoundingBox(),
            (err) => {
              assert.strictEqual(err.name, ErrorTypes.STALE_ELEMENT);
              assert.strictEqual(err.operation, 'getBoundingBox');
              assert.strictEqual(err.objectId, testObjectId);
              return true;
            }
          );
        });
      });

      it('should include selector in error when available', async () => {
        const handleWithSelector = createElementHandle(mockCdp, testObjectId, { selector: '#myButton' });
        mockCdp.send = mock.fn(async () => {
          throw new Error('Could not find object with given id');
        });

        await assert.rejects(
          () => handleWithSelector.getBoundingBox(),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.STALE_ELEMENT);
            assert.strictEqual(err.selector, '#myButton');
            assert.ok(err.message.includes('#myButton'));
            return true;
          }
        );
      });

      it('should preserve original error as cause', async () => {
        mockCdp.send = mock.fn(async () => {
          throw new Error('Could not find object with given id');
        });

        await assert.rejects(
          () => handle.getBoundingBox(),
          (err) => {
            assert.ok(err.cause instanceof Error);
            assert.strictEqual(err.cause.message, 'Could not find object with given id');
            return true;
          }
        );
      });

      it('should rethrow non-stale errors unchanged', async () => {
        const originalError = new Error('Network timeout');
        mockCdp.send = mock.fn(async () => {
          throw originalError;
        });

        await assert.rejects(
          () => handle.getBoundingBox(),
          (err) => {
            assert.strictEqual(err, originalError);
            return true;
          }
        );
      });
    });

    describe('isVisible', () => {
      it('should throw StaleElementError for stale element', async () => {
        mockCdp.send = mock.fn(async () => {
          throw new Error('Could not find object with given id');
        });

        await assert.rejects(
          () => handle.isVisible(),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.STALE_ELEMENT);
            assert.strictEqual(err.operation, 'isVisible');
            return true;
          }
        );
      });
    });

    describe('isActionable', () => {
      it('should throw StaleElementError for stale element', async () => {
        mockCdp.send = mock.fn(async () => {
          throw new Error('No node with given id found');
        });

        await assert.rejects(
          () => handle.isActionable(),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.STALE_ELEMENT);
            assert.strictEqual(err.operation, 'isActionable');
            return true;
          }
        );
      });
    });

    describe('scrollIntoView', () => {
      it('should throw StaleElementError for stale element', async () => {
        mockCdp.send = mock.fn(async () => {
          throw new Error('Object reference not found');
        });

        await assert.rejects(
          () => handle.scrollIntoView(),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.STALE_ELEMENT);
            assert.strictEqual(err.operation, 'scrollIntoView');
            return true;
          }
        );
      });
    });

    describe('evaluate', () => {
      it('should throw StaleElementError for stale element', async () => {
        mockCdp.send = mock.fn(async () => {
          throw new Error('Cannot find context with specified id');
        });

        await assert.rejects(
          () => handle.evaluate(() => this.id),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.STALE_ELEMENT);
            assert.strictEqual(err.operation, 'evaluate');
            return true;
          }
        );
      });
    });
  });

  describe('staleElementError factory function', () => {
    it('should support legacy string operation parameter', () => {
      const error = staleElementError('obj-123', 'click');
      assert.strictEqual(error.objectId, 'obj-123');
      assert.strictEqual(error.operation, 'click');
      assert.ok(error.message.includes('click'));
    });

    it('should support options object', () => {
      const error = staleElementError('obj-123', {
        operation: 'getBoundingBox',
        selector: 'button.submit'
      });
      assert.strictEqual(error.objectId, 'obj-123');
      assert.strictEqual(error.operation, 'getBoundingBox');
      assert.strictEqual(error.selector, 'button.submit');
      assert.ok(error.message.includes('button.submit'));
      assert.ok(error.message.includes('getBoundingBox'));
    });

    it('should include all details in message', () => {
      const error = staleElementError('obj-456', {
        operation: 'click',
        selector: '#login'
      });
      assert.ok(error.message.includes('obj-456'));
      assert.ok(error.message.includes('click'));
      assert.ok(error.message.includes('#login'));
    });

    it('should handle missing optional parameters', () => {
      const error = staleElementError('obj-789');
      assert.strictEqual(error.objectId, 'obj-789');
      assert.strictEqual(error.operation, null);
      assert.strictEqual(error.selector, null);
      assert.ok(error.message.includes('obj-789'));
    });
  });
});
