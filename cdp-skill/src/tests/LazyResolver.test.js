import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { createLazyResolver } from '../dom/LazyResolver.js';

describe('LazyResolver', () => {
  let mockSession;
  let resolver;

  beforeEach(() => {
    mockSession = {
      send: mock.fn()
    };
    resolver = createLazyResolver(mockSession);
  });

  describe('createLazyResolver', () => {
    it('should throw if session is not provided', () => {
      assert.throws(() => createLazyResolver(null), /CDP session is required/);
    });

    it('should create a resolver with all methods', () => {
      assert.ok(typeof resolver.resolveRef === 'function');
      assert.ok(typeof resolver.resolveSelector === 'function');
      assert.ok(typeof resolver.resolveText === 'function');
      assert.ok(typeof resolver.resolveByRoleAndName === 'function');
      assert.ok(typeof resolver.resolveThroughShadowDOM === 'function');
    });
  });

  describe('resolveSelector', () => {
    it('should return null for empty selector', async () => {
      const result = await resolver.resolveSelector('');
      assert.strictEqual(result, null);
    });

    it('should return null for non-string selector', async () => {
      const result = await resolver.resolveSelector(123);
      assert.strictEqual(result, null);
    });

    it('should return null when element not found', async () => {
      mockSession.send.mock.mockImplementation((method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { value: null } };
        }
      });

      const result = await resolver.resolveSelector('#nonexistent');
      assert.strictEqual(result, null);
    });

    it('should return objectId and box when element found', async () => {
      let callCount = 0;
      mockSession.send.mock.mockImplementation((method) => {
        callCount++;
        if (method === 'Runtime.evaluate') {
          if (callCount === 1) {
            // First call - check existence and get box
            return {
              result: {
                value: { found: true, box: { x: 10, y: 20, width: 100, height: 50 } }
              }
            };
          } else {
            // Second call - get objectId
            return {
              result: { objectId: 'obj-123' }
            };
          }
        }
      });

      const result = await resolver.resolveSelector('#myButton');
      assert.ok(result);
      assert.strictEqual(result.objectId, 'obj-123');
      assert.deepStrictEqual(result.box, { x: 10, y: 20, width: 100, height: 50 });
      assert.strictEqual(result.resolvedBy, 'selector');
    });

    it('should handle CDP errors gracefully', async () => {
      mockSession.send.mock.mockImplementation(() => {
        throw new Error('CDP connection lost');
      });

      const result = await resolver.resolveSelector('#myButton');
      assert.strictEqual(result, null);
    });
  });

  describe('resolveRef', () => {
    it('should return null for empty ref', async () => {
      const result = await resolver.resolveRef('');
      assert.strictEqual(result, null);
    });

    it('should return null for non-string ref', async () => {
      const result = await resolver.resolveRef(123);
      assert.strictEqual(result, null);
    });

    it('should return null when metadata not found', async () => {
      mockSession.send.mock.mockImplementation(() => {
        return { result: { value: null } };
      });

      const result = await resolver.resolveRef('s1e5');
      assert.strictEqual(result, null);
    });

    it('should resolve by selector from metadata', async () => {
      let callCount = 0;
      mockSession.send.mock.mockImplementation((method, params) => {
        callCount++;
        if (method === 'Runtime.evaluate') {
          if (callCount === 1) {
            // First call - get metadata
            return {
              result: {
                value: { selector: '#submitBtn', role: 'button', name: 'Submit' }
              }
            };
          } else if (callCount === 2) {
            // Second call - check element exists
            return {
              result: {
                value: { found: true, box: { x: 100, y: 200, width: 80, height: 30 } }
              }
            };
          } else {
            // Third call - get objectId
            return {
              result: { objectId: 'resolved-obj-456' }
            };
          }
        }
      });

      const result = await resolver.resolveRef('s1e5');
      assert.ok(result);
      assert.strictEqual(result.objectId, 'resolved-obj-456');
      assert.strictEqual(result.ref, 's1e5');
      assert.strictEqual(result.resolvedBy, 'selector');
    });

    it('should fall back to role+name search when selector fails', async () => {
      let callCount = 0;
      mockSession.send.mock.mockImplementation((method) => {
        callCount++;
        if (method === 'Runtime.evaluate') {
          if (callCount === 1) {
            // Get metadata
            return {
              result: {
                value: { selector: '#oldId', role: 'button', name: 'Submit' }
              }
            };
          } else if (callCount === 2) {
            // Selector check - fails (element not found)
            return { result: { value: null } };
          } else if (callCount === 3) {
            // Role+name search - succeeds
            return {
              result: {
                value: { found: true, box: { x: 50, y: 60, width: 100, height: 40 }, index: 0 }
              }
            };
          } else {
            // Get objectId via role+name
            return {
              result: { objectId: 'fallback-obj-789' }
            };
          }
        }
      });

      const result = await resolver.resolveRef('s1e5');
      assert.ok(result);
      assert.strictEqual(result.objectId, 'fallback-obj-789');
      assert.strictEqual(result.resolvedBy, 'role+name');
    });
  });

  describe('resolveByRoleAndName', () => {
    it('should return null for empty role', async () => {
      const result = await resolver.resolveByRoleAndName('', 'test');
      assert.strictEqual(result, null);
    });

    it('should find element by role and name', async () => {
      let callCount = 0;
      mockSession.send.mock.mockImplementation((method) => {
        callCount++;
        if (method === 'Runtime.evaluate') {
          if (callCount === 1) {
            return {
              result: {
                value: { found: true, box: { x: 10, y: 20, width: 100, height: 50 }, index: 2 }
              }
            };
          } else {
            return {
              result: { objectId: 'role-obj-123' }
            };
          }
        }
      });

      const result = await resolver.resolveByRoleAndName('button', 'Save');
      assert.ok(result);
      assert.strictEqual(result.objectId, 'role-obj-123');
      assert.strictEqual(result.resolvedBy, 'role+name');
      assert.strictEqual(result.role, 'button');
      assert.strictEqual(result.name, 'Save');
    });
  });

  describe('resolveThroughShadowDOM', () => {
    it('should return null for empty shadow host path', async () => {
      const result = await resolver.resolveThroughShadowDOM([], '#button');
      assert.strictEqual(result, null);
    });

    it('should resolve element through shadow DOM', async () => {
      let callCount = 0;
      mockSession.send.mock.mockImplementation((method) => {
        callCount++;
        if (method === 'Runtime.evaluate') {
          if (callCount === 1) {
            return {
              result: {
                value: { found: true, box: { x: 30, y: 40, width: 80, height: 30 } }
              }
            };
          } else {
            return {
              result: { objectId: 'shadow-obj-999' }
            };
          }
        }
      });

      const result = await resolver.resolveThroughShadowDOM(['#host1', '#host2'], '.inner-button');
      assert.ok(result);
      assert.strictEqual(result.objectId, 'shadow-obj-999');
      assert.strictEqual(result.resolvedBy, 'shadow-dom');
      assert.deepStrictEqual(result.shadowHostPath, ['#host1', '#host2']);
    });
  });

  describe('resolveText', () => {
    it('should return null for empty text', async () => {
      const result = await resolver.resolveText('');
      assert.strictEqual(result, null);
    });

    it('should return null for non-string text', async () => {
      const result = await resolver.resolveText(123);
      assert.strictEqual(result, null);
    });

    it('should find element by text', async () => {
      let callCount = 0;
      mockSession.send.mock.mockImplementation((method) => {
        callCount++;
        if (method === 'Runtime.evaluate') {
          if (callCount === 1) {
            return {
              result: {
                value: {
                  found: true,
                  box: { x: 100, y: 150, width: 120, height: 35 },
                  selectors: 'button, input[type="button"]'
                }
              }
            };
          } else {
            return {
              result: { objectId: 'text-obj-555' }
            };
          }
        }
      });

      const result = await resolver.resolveText('Submit Form');
      assert.ok(result);
      assert.strictEqual(result.objectId, 'text-obj-555');
      assert.strictEqual(result.resolvedBy, 'text');
      assert.strictEqual(result.text, 'Submit Form');
    });
  });

  describe('frame context support', () => {
    it('should include contextId in eval params when getFrameContext returns a value', async () => {
      const getFrameContext = () => 12345;
      const resolverWithFrame = createLazyResolver(mockSession, { getFrameContext });

      mockSession.send.mock.mockImplementation((method, params) => {
        if (method === 'Runtime.evaluate') {
          // Verify contextId is included
          assert.strictEqual(params.contextId, 12345);
          return { result: { value: null } };
        }
      });

      await resolverWithFrame.resolveSelector('#test');
      assert.ok(mockSession.send.mock.calls.length > 0);
    });

    it('should not include contextId when getFrameContext returns null', async () => {
      const getFrameContext = () => null;
      const resolverWithFrame = createLazyResolver(mockSession, { getFrameContext });

      mockSession.send.mock.mockImplementation((method, params) => {
        if (method === 'Runtime.evaluate') {
          // Verify contextId is NOT included
          assert.strictEqual(params.contextId, undefined);
          return { result: { value: null } };
        }
      });

      await resolverWithFrame.resolveSelector('#test');
      assert.ok(mockSession.send.mock.calls.length > 0);
    });
  });

  describe('edge cases', () => {
    it('should handle selector returning subtype null', async () => {
      mockSession.send.mock.mockImplementation((method) => {
        if (method === 'Runtime.evaluate') {
          return {
            result: { value: { found: true, box: { x: 0, y: 0, width: 0, height: 0 } } }
          };
        }
      });

      // Mock second call to return null subtype
      let firstCall = true;
      mockSession.send.mock.mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          return {
            result: { value: { found: true, box: { x: 0, y: 0, width: 10, height: 10 } } }
          };
        }
        return { result: { subtype: 'null' } };
      });

      const result = await resolver.resolveSelector('#test');
      assert.strictEqual(result, null);
    });

    it('should handle metadata with shadowHostPath', async () => {
      let callCount = 0;
      mockSession.send.mock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Metadata with shadow path
          return {
            result: {
              value: {
                selector: '.shadow-button',
                role: 'button',
                name: 'Click',
                shadowHostPath: ['#shadow-host']
              }
            }
          };
        } else if (callCount === 2) {
          // Shadow DOM resolution succeeds
          return {
            result: { value: { found: true, box: { x: 10, y: 20, width: 50, height: 30 } } }
          };
        } else {
          return { result: { objectId: 'shadow-resolved-obj' } };
        }
      });

      const result = await resolver.resolveRef('s2e3');
      assert.ok(result);
      assert.strictEqual(result.objectId, 'shadow-resolved-obj');
    });
  });
});
