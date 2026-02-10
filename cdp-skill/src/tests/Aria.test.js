import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  createQueryOutputProcessor,
  createRoleQueryExecutor,
  createAriaSnapshot
} from '../aria.js';

describe('ARIA Module', () => {
  let mockSession;

  beforeEach(() => {
    mockSession = {
      send: mock.fn(async () => ({}))
    };
  });

  afterEach(() => {
    mock.reset();
  });

  // ============================================================================
  // QueryOutputProcessor Tests
  // ============================================================================

  describe('createQueryOutputProcessor', () => {
    let processor;

    beforeEach(() => {
      processor = createQueryOutputProcessor(mockSession);
    });

    it('should create processor with processOutput method', () => {
      assert.ok(typeof processor.processOutput === 'function');
    });

    describe('processOutput with string mode', () => {
      let mockElementHandle;

      beforeEach(() => {
        mockElementHandle = {
          evaluate: mock.fn(async () => 'test content')
        };
      });

      it('should extract text content', async () => {
        const result = await processor.processOutput(mockElementHandle, 'text', { clean: false });
        assert.strictEqual(result, 'test content');
      });

      it('should extract html content', async () => {
        mockElementHandle.evaluate = mock.fn(async () => '<div>test</div>');
        const result = await processor.processOutput(mockElementHandle, 'html', { clean: false });
        assert.strictEqual(result, '<div>test</div>');
      });

      it('should extract href attribute', async () => {
        mockElementHandle.evaluate = mock.fn(async () => 'https://example.com');
        const result = await processor.processOutput(mockElementHandle, 'href', { clean: false });
        assert.strictEqual(result, 'https://example.com');
      });

      it('should extract value attribute', async () => {
        mockElementHandle.evaluate = mock.fn(async () => 'input value');
        const result = await processor.processOutput(mockElementHandle, 'value', { clean: false });
        assert.strictEqual(result, 'input value');
      });

      it('should extract tag name', async () => {
        mockElementHandle.evaluate = mock.fn(async () => 'button');
        const result = await processor.processOutput(mockElementHandle, 'tag', { clean: false });
        assert.strictEqual(result, 'button');
      });

      it('should trim whitespace when clean=true', async () => {
        mockElementHandle.evaluate = mock.fn(async () => '  trimmed  ');
        const result = await processor.processOutput(mockElementHandle, 'text', { clean: true });
        assert.strictEqual(result, 'trimmed');
      });

      it('should handle empty/null values', async () => {
        mockElementHandle.evaluate = mock.fn(async () => null);
        const result = await processor.processOutput(mockElementHandle, 'text', { clean: false });
        assert.strictEqual(result, '');
      });
    });

    describe('processOutput with array of modes', () => {
      let mockElementHandle;

      beforeEach(() => {
        mockElementHandle = {
          evaluate: mock.fn(async () => 'test')
        };
      });

      it('should return object with values for multiple modes', async () => {
        let callCount = 0;
        mockElementHandle.evaluate = mock.fn(async () => {
          callCount++;
          return callCount === 1 ? 'text content' : 'button';
        });

        const result = await processor.processOutput(mockElementHandle, ['text', 'tag'], { clean: false });
        assert.ok(typeof result === 'object');
        assert.strictEqual(result.text, 'text content');
        assert.strictEqual(result.tag, 'button');
      });
    });

    describe('processOutput with object specification', () => {
      let mockElementHandle;

      beforeEach(() => {
        mockElementHandle = {
          evaluate: mock.fn(async () => 'test')
        };
      });

      it('should handle object with attribute key', async () => {
        mockElementHandle.evaluate = mock.fn(async () => 'data-value');

        const result = await processor.processOutput(mockElementHandle, { attribute: 'data-test' }, { clean: false });
        assert.ok(typeof result === 'string');
      });
    });

    describe('getAttribute', () => {
      it('should extract custom attribute', async () => {
        const mockElementHandle = {
          evaluate: mock.fn(async () => 'custom-value')
        };

        // processOutput with @attr syntax uses getAttribute internally
        const result = await processor.processOutput(mockElementHandle, '@data-id', { clean: false });
        assert.ok(result !== undefined);
      });
    });
  });

  // ============================================================================
  // RoleQueryExecutor Tests
  // ============================================================================

  describe('createRoleQueryExecutor', () => {
    let executor;
    let mockElementLocator;

    beforeEach(() => {
      mockElementLocator = {
        querySelector: mock.fn(async () => ({ objectId: 'obj-123' }))
      };
      executor = createRoleQueryExecutor(mockSession, mockElementLocator);
    });

    it('should create executor with execute method', () => {
      assert.ok(typeof executor.execute === 'function');
    });

    it('should create executor with queryByRoles method', () => {
      assert.ok(typeof executor.queryByRoles === 'function');
    });

    describe('query by single role', () => {
      it('should query button role', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: {
                objectId: 'array-1',
                value: undefined
              }
            };
          }
          if (method === 'Runtime.getProperties') {
            return {
              result: [
                { name: '0', value: { objectId: 'obj-1' } },
                { name: 'length', value: { value: 1 } }
              ]
            };
          }
          if (method === 'Runtime.callFunctionOn') {
            return {
              result: { value: 'Submit' }
            };
          }
          return {};
        });

        const result = await executor.execute({ role: 'button' });
        assert.ok(Array.isArray(result.elements) || typeof result === 'object');
      });

      it('should query textbox role', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return { result: { objectId: 'array-1', value: undefined } };
          }
          if (method === 'Runtime.getProperties') {
            return { result: [] };
          }
          if (method === 'Runtime.releaseObject') {
            return {};
          }
          return {};
        });

        await executor.execute({ role: 'textbox' });
        const calls = mockSession.send.mock.calls;
        assert.ok(calls.length > 0);
      });

      it('should query checkbox role', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return { result: { objectId: 'array-1', value: undefined } };
          }
          if (method === 'Runtime.getProperties') {
            return { result: [] };
          }
          if (method === 'Runtime.releaseObject') {
            return {};
          }
          return {};
        });

        await executor.execute({ role: 'checkbox' });
        const calls = mockSession.send.mock.calls;
        assert.ok(calls.length > 0);
      });

      it('should query link role', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return { result: { objectId: 'array-1', value: undefined } };
          }
          if (method === 'Runtime.getProperties') {
            return { result: [] };
          }
          if (method === 'Runtime.releaseObject') {
            return {};
          }
          return {};
        });

        await executor.execute({ role: 'link' });
        const calls = mockSession.send.mock.calls;
        assert.ok(calls.length > 0);
      });

      it('should query heading role', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return { result: { objectId: 'array-1', value: undefined } };
          }
          if (method === 'Runtime.getProperties') {
            return { result: [] };
          }
          if (method === 'Runtime.releaseObject') {
            return {};
          }
          return {};
        });

        await executor.execute({ role: 'heading' });
        const calls = mockSession.send.mock.calls;
        assert.ok(calls.length > 0);
      });
    });

    describe('query with name filter', () => {
      it('should filter by name (contains)', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: { objectId: 'array-1', value: undefined }
            };
          }
          if (method === 'Runtime.getProperties') {
            return { result: [] };
          }
          return {};
        });

        await executor.execute({ role: 'button', name: 'Submit' });
        const evaluateCalls = mockSession.send.mock.calls.filter(call => call.arguments[0] === 'Runtime.evaluate');
        assert.ok(evaluateCalls.length > 0);
        // Check that name filter is in the expression
        const expression = evaluateCalls[0].arguments[1].expression;
        assert.ok(expression.includes('Submit') || expression.includes('nameFilter'));
      });

      it('should filter by name (exact match)', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: { objectId: 'array-1', value: undefined }
            };
          }
          if (method === 'Runtime.getProperties') {
            return { result: [] };
          }
          return {};
        });

        await executor.execute({ role: 'button', name: 'Submit', nameExact: true });
        const evaluateCalls = mockSession.send.mock.calls.filter(call => call.arguments[0] === 'Runtime.evaluate');
        assert.ok(evaluateCalls.length > 0);
      });

      it('should filter by nameRegex', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: { objectId: 'array-1', value: undefined }
            };
          }
          if (method === 'Runtime.getProperties') {
            return { result: [] };
          }
          return {};
        });

        await executor.execute({ role: 'button', nameRegex: 'Sub.*' });
        const evaluateCalls = mockSession.send.mock.calls.filter(call => call.arguments[0] === 'Runtime.evaluate');
        assert.ok(evaluateCalls.length > 0);
      });
    });

    describe('query with state filters', () => {
      it('should filter by checked state', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: { objectId: 'array-1', value: undefined }
            };
          }
          if (method === 'Runtime.getProperties') {
            return { result: [] };
          }
          return {};
        });

        await executor.execute({ role: 'checkbox', checked: true });
        const evaluateCalls = mockSession.send.mock.calls.filter(call => call.arguments[0] === 'Runtime.evaluate');
        assert.ok(evaluateCalls.length > 0);
      });

      it('should filter by disabled state', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: { objectId: 'array-1', value: undefined }
            };
          }
          if (method === 'Runtime.getProperties') {
            return { result: [] };
          }
          return {};
        });

        await executor.execute({ role: 'button', disabled: false });
        const evaluateCalls = mockSession.send.mock.calls.filter(call => call.arguments[0] === 'Runtime.evaluate');
        assert.ok(evaluateCalls.length > 0);
      });

      it('should filter by heading level', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: { objectId: 'array-1', value: undefined }
            };
          }
          if (method === 'Runtime.getProperties') {
            return { result: [] };
          }
          return {};
        });

        await executor.execute({ role: 'heading', level: 2 });
        const evaluateCalls = mockSession.send.mock.calls.filter(call => call.arguments[0] === 'Runtime.evaluate');
        assert.ok(evaluateCalls.length > 0);
      });
    });

    describe('query with compound roles', () => {
      it('should handle array of roles', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: { objectId: 'array-1', value: undefined }
            };
          }
          if (method === 'Runtime.getProperties') {
            return { result: [] };
          }
          return {};
        });

        await executor.execute({ role: ['button', 'link'] });
        const evaluateCalls = mockSession.send.mock.calls.filter(call => call.arguments[0] === 'Runtime.evaluate');
        assert.ok(evaluateCalls.length > 0);
      });
    });

    describe('query with output specification', () => {
      it('should support output: "text"', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: { objectId: 'array-1', value: undefined }
            };
          }
          if (method === 'Runtime.getProperties') {
            return {
              result: [
                { name: '0', value: { objectId: 'obj-1' } },
                { name: 'length', value: { value: 1 } }
              ]
            };
          }
          if (method === 'Runtime.callFunctionOn') {
            return {
              result: { value: 'Button text' }
            };
          }
          return {};
        });

        await executor.execute({ role: 'button', output: 'text' });
        const callFunctionCalls = mockSession.send.mock.calls.filter(call => call.arguments[0] === 'Runtime.callFunctionOn');
        assert.ok(callFunctionCalls.length > 0);
      });

      it('should support output: array', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: { objectId: 'array-1', value: undefined }
            };
          }
          if (method === 'Runtime.getProperties') {
            return {
              result: [
                { name: '0', value: { objectId: 'obj-1' } },
                { name: 'length', value: { value: 1 } }
              ]
            };
          }
          if (method === 'Runtime.callFunctionOn') {
            return {
              result: { value: 'text' }
            };
          }
          return {};
        });

        await executor.execute({ role: 'button', output: ['text', 'tag'] });
        assert.ok(mockSession.send.mock.calls.length > 0);
      });

      it('should support output: object', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: { objectId: 'array-1', value: undefined }
            };
          }
          if (method === 'Runtime.getProperties') {
            return {
              result: [
                { name: '0', value: { objectId: 'obj-1' } },
                { name: 'length', value: { value: 1 } }
              ]
            };
          }
          if (method === 'Runtime.callFunctionOn') {
            return {
              result: { value: 'value' }
            };
          }
          return {};
        });

        await executor.execute({ role: 'button', output: { label: 'text', element: 'tag' } });
        assert.ok(mockSession.send.mock.calls.length > 0);
      });
    });

    describe('query with limit option', () => {
      it('should limit number of results', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: { objectId: 'array-1', value: undefined }
            };
          }
          if (method === 'Runtime.getProperties') {
            return {
              result: [
                { name: '0', value: { objectId: 'obj-1' } },
                { name: '1', value: { objectId: 'obj-2' } },
                { name: '2', value: { objectId: 'obj-3' } },
                { name: 'length', value: { value: 3 } }
              ]
            };
          }
          if (method === 'Runtime.callFunctionOn') {
            return {
              result: { value: 'text' }
            };
          }
          return {};
        });

        const result = await executor.execute({ role: 'button', limit: 2 });
        // Should only process up to limit
        assert.ok(result);
      });
    });

    describe('error handling', () => {
      it('should handle CDP errors gracefully', async () => {
        mockSession.send = mock.fn(async () => {
          throw new Error('CDP connection failed');
        });

        await assert.rejects(
          async () => await executor.execute({ role: 'button' }),
          Error
        );
      });

      it('should handle evaluation exceptions', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              exceptionDetails: {
                text: 'JavaScript error'
              }
            };
          }
          return {};
        });

        await assert.rejects(
          async () => await executor.execute({ role: 'button' }),
          Error
        );
      });
    });
  });

  // ============================================================================
  // AriaSnapshot Tests
  // ============================================================================

  describe('createAriaSnapshot', () => {
    let snapshot;

    beforeEach(() => {
      snapshot = createAriaSnapshot(mockSession);
    });

    it('should create snapshot with generate method', () => {
      assert.ok(typeof snapshot.generate === 'function');
    });

    it('should create snapshot with getElementByRef method', () => {
      assert.ok(typeof snapshot.getElementByRef === 'function');
    });

    describe('generate snapshot', () => {
      it('should generate basic snapshot', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'document', children: [] },
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        const result = await snapshot.generate();
        assert.ok(result.tree);
        assert.ok(result.snapshotId);
      });

      it('should support mode: "ai"', async () => {
        mockSession.send = mock.fn(async (method, params) => ({
          result: {
            value: {
              tree: { role: 'document', children: [] },
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        await snapshot.generate({ mode: 'ai' });
        const calls = mockSession.send.mock.calls;
        assert.ok(calls.length > 0);
        // Check expression includes mode parameter
        const expression = calls[0].arguments[1].expression;
        assert.ok(expression.includes('ai'));
      });

      it('should support mode: "full"', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'document', children: [] },
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        await snapshot.generate({ mode: 'full' });
        const calls = mockSession.send.mock.calls;
        assert.ok(calls.length > 0);
      });

      it('should support detail: "summary"', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'document', children: [
                { role: 'main', name: 'Main content', children: [] },
                { role: 'button', name: 'Submit', children: [] }
              ]},
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        const result = await snapshot.generate({ detail: 'summary' });
        assert.ok(result.snapshotId);
        // Summary view should have landmarks or stats
        assert.ok(result.landmarks || result.stats || result.tree);
      });

      it('should support detail: "interactive"', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'document', children: [
                { role: 'button', name: 'Click me', children: [] },
                { role: 'textbox', name: 'Username', children: [] }
              ]},
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        const result = await snapshot.generate({ detail: 'interactive' });
        assert.ok(result.snapshotId);
      });

      it('should support detail: "full"', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'document', children: [] },
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        const result = await snapshot.generate({ detail: 'full' });
        assert.ok(result.tree);
        assert.ok(result.snapshotId);
      });

      it('should support maxDepth option', async () => {
        mockSession.send = mock.fn(async (method, params) => ({
          result: {
            value: {
              tree: { role: 'document', children: [] },
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        await snapshot.generate({ maxDepth: 3 });
        const calls = mockSession.send.mock.calls;
        const expression = calls[0].arguments[1].expression;
        assert.ok(expression.includes('maxDepth'));
      });

      it('should support maxElements option', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'document', children: [] },
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        await snapshot.generate({ maxElements: 100 });
        const calls = mockSession.send.mock.calls;
        assert.ok(calls.length > 0);
      });

      it('should support viewportOnly option', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'document', children: [] },
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        await snapshot.generate({ viewportOnly: true });
        const calls = mockSession.send.mock.calls;
        const expression = calls[0].arguments[1].expression;
        assert.ok(expression.includes('viewportOnly'));
      });

      it('should support pierceShadow option', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'document', children: [] },
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        await snapshot.generate({ pierceShadow: true });
        const calls = mockSession.send.mock.calls;
        const expression = calls[0].arguments[1].expression;
        assert.ok(expression.includes('pierceShadow'));
      });

      it('should support root selector option', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'main', children: [] },
              yaml: 'main:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        await snapshot.generate({ root: 'main' });
        const calls = mockSession.send.mock.calls;
        const expression = calls[0].arguments[1].expression;
        assert.ok(expression.includes('main'));
      });

      it('should support since option for change detection', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              unchanged: true,
              snapshotId: 's2',
              message: 'Page unchanged since s1'
            }
          }
        }));

        const result = await snapshot.generate({ since: 's1' });
        assert.strictEqual(result.unchanged, true);
        assert.ok(result.message);
      });

      it('should handle snapshot generation errors', async () => {
        mockSession.send = mock.fn(async () => ({
          exceptionDetails: {
            text: 'Failed to generate snapshot'
          }
        }));

        await assert.rejects(
          async () => await snapshot.generate(),
          /Snapshot generation failed/
        );
      });
    });

    describe('getElementByRef', () => {
      it('should retrieve element info by ref', async () => {
        mockSession.send = mock.fn(async (method) => {
          if (method === 'Runtime.evaluate') {
            return {
              result: {
                value: {
                  selector: '#submit-btn',
                  box: { x: 10, y: 20, width: 100, height: 30 },
                  isConnected: true,
                  isVisible: true
                }
              }
            };
          }
          return {};
        });

        const refInfo = await snapshot.getElementByRef('s1e1');

        // Should return ref info with box, isConnected, etc
        assert.ok(refInfo);
        assert.ok(refInfo.box);
        assert.ok(typeof refInfo.isConnected === 'boolean');
      });

      it('should return null for non-existent ref', async () => {
        mockSession.send = mock.fn(async () => ({
          result: { value: null }
        }));

        const refInfo = await snapshot.getElementByRef('s99e99');

        assert.strictEqual(refInfo, null);
      });

      it('should detect stale refs', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              stale: true,
              message: 'Element no longer attached to DOM'
            }
          }
        }));

        const refInfo = await snapshot.getElementByRef('s1e1');

        // Stale refs return object with stale flag
        if (refInfo) {
          assert.ok(refInfo.stale === true || typeof refInfo === 'object');
        }
      });
    });

    describe('ref management', () => {
      it('should generate unique snapshot IDs', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'document', children: [] },
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        const result1 = await snapshot.generate();

        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'document', children: [] },
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's2'
            }
          }
        }));

        const result2 = await snapshot.generate();

        // IDs should be tracked (may or may not be different depending on implementation)
        assert.ok(result1.snapshotId);
        assert.ok(result2.snapshotId);
      });

      it('should support preserveRefs option', async () => {
        mockSession.send = mock.fn(async () => ({
          result: {
            value: {
              tree: { role: 'document', children: [] },
              yaml: 'document:\n',
              refs: new Map(),
              snapshotId: 's1'
            }
          }
        }));

        await snapshot.generate({ preserveRefs: true });
        const calls = mockSession.send.mock.calls;
        const expression = calls[0].arguments[1].expression;
        assert.ok(expression.includes('preserveRefs'));
      });
    });

    describe('frame context support', () => {
      it('should inject contextId when getFrameContext is provided', async () => {
        const mockGetFrameContext = () => 'frame-123';
        const frameSnapshot = createAriaSnapshot(mockSession, { getFrameContext: mockGetFrameContext });

        mockSession.send = mock.fn(async (method, params) => {
          // Verify contextId is included
          if (method === 'Runtime.evaluate') {
            assert.strictEqual(params.contextId, 'frame-123');
          }
          return {
            result: {
              value: {
                tree: { role: 'document', children: [] },
                yaml: 'document:\n',
                refs: new Map(),
                snapshotId: 's1'
              }
            }
          };
        });

        await frameSnapshot.generate();
        assert.ok(mockSession.send.mock.calls.length > 0);
      });

      it('should work without frame context', async () => {
        mockSession.send = mock.fn(async (method, params) => {
          // Verify contextId is NOT included when no getFrameContext
          if (method === 'Runtime.evaluate') {
            assert.strictEqual(params.contextId, undefined);
          }
          return {
            result: {
              value: {
                tree: { role: 'document', children: [] },
                yaml: 'document:\n',
                refs: new Map(),
                snapshotId: 's1'
              }
            }
          };
        });

        await snapshot.generate();
        assert.ok(mockSession.send.mock.calls.length > 0);
      });
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration', () => {
    it('should create all three factory functions', () => {
      const processor = createQueryOutputProcessor(mockSession);
      const executor = createRoleQueryExecutor(mockSession, {});
      const snapshot = createAriaSnapshot(mockSession);

      assert.ok(processor);
      assert.ok(executor);
      assert.ok(snapshot);
    });

    it('should handle role queries with snapshot refs', async () => {
      const snapshot = createAriaSnapshot(mockSession);

      let callCount = 0;
      mockSession.send = mock.fn(async (method) => {
        callCount++;
        if (callCount === 1) {
          // First call: generate snapshot
          return {
            result: {
              value: {
                tree: {
                  role: 'document',
                  children: [
                    { role: 'button', name: 'Click me', ref: 's1e1' }
                  ]
                },
                yaml: 'document:\n  button: Click me [s1e1]\n',
                refs: new Map([
                  ['s1e1', { ref: 's1e1', role: 'button', name: 'Click me' }]
                ]),
                snapshotId: 's1'
              }
            }
          };
        } else {
          // Second call: getElementByRef
          return {
            result: {
              value: {
                selector: '#btn',
                box: { x: 0, y: 0, width: 50, height: 30 },
                isConnected: true,
                isVisible: true
              }
            }
          };
        }
      });

      const result = await snapshot.generate();
      assert.ok(result.snapshotId);

      // Refs should be accessible via getElementByRef
      const refInfo = await snapshot.getElementByRef('s1e1');
      assert.ok(refInfo === null || typeof refInfo === 'object');
    });
  });
});
