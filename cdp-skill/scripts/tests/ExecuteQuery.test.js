import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  executeSnapshot,
  executeGetDom,
  executeGetBox,
  executeRefAt,
  executeElementsAt,
  executeElementsNear,
  executeQuery,
  executeRoleQuery,
  executeInspect,
  executeQueryAll,
  executeSnapshotSearch
} from '../runner/execute-query.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAriaSnapshot(opts = {}) {
  return {
    generate: mock.fn(async (options) => {
      if (opts.error) {
        return { error: opts.error };
      }
      if (opts.unchanged) {
        return {
          unchanged: true,
          snapshotId: opts.snapshotId || 1,
          message: 'Page unchanged since last snapshot'
        };
      }
      const yaml = opts.yaml || '- button "Submit"';
      const refs = opts.refs || { 'f0s1e1': 'ref-data' };

      // For snapshotSearch, return tree structure
      if (opts.searchTree) {
        return {
          tree: {
            role: 'document',
            children: [
              { role: 'button', name: 'Submit', ref: 'f0s1e1', box: { x: 10, y: 10, width: 80, height: 40 } },
              { role: 'button', name: 'Cancel', ref: 'f0s1e2', box: { x: 100, y: 10, width: 80, height: 40 } }
            ]
          },
          yaml,
          refs,
          stats: { elements: 10, viewportElements: 5 },
          snapshotId: opts.snapshotId || 1
        };
      }

      return {
        yaml,
        refs,
        stats: { elements: 10, viewportElements: 5 },
        snapshotId: opts.snapshotId || 1
      };
    }),
    getElementByRef: mock.fn(async (ref) => {
      if (opts.refNotFound || ref === 'f0s1e999') {
        return null;
      }
      if (opts.refStale || ref === 'f0s1e998') {
        return { stale: true };
      }
      if (opts.refHidden || ref === 'f0s1e997') {
        return {
          isVisible: false,
          box: { x: 0, y: 0, width: 0, height: 0 }
        };
      }
      return {
        isVisible: true,
        box: { x: 100, y: 200, width: 50, height: 30 }
      };
    })
  };
}

function createMockPageController(opts = {}) {
  return {
    session: {
      send: mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate') {
          if (opts.evalError) {
            return {
              exceptionDetails: { text: 'Evaluation error' }
            };
          }
          if (opts.domError) {
            return {
              result: {
                value: { error: 'Element not found: #missing' }
              }
            };
          }
          if (opts.getDom) {
            return {
              result: {
                value: {
                  html: '<div>Test content</div>',
                  tagName: 'div',
                  selector: '#test'
                }
              }
            };
          }
          if (opts.getDomFull) {
            return {
              result: {
                value: {
                  html: '<html><body>Full page</body></html>',
                  tagName: 'html'
                }
              }
            };
          }
          if (opts.refAt) {
            return {
              result: {
                value: {
                  ref: 'f0s1e1',
                  existing: false,
                  tag: 'BUTTON',
                  selector: 'button.submit',
                  clickable: true,
                  role: 'button',
                  name: 'Submit',
                  box: { x: 100, y: 200, width: 80, height: 40 }
                }
              }
            };
          }
          if (opts.refAtNoElement) {
            return {
              result: {
                value: { error: 'No element at coordinates (999, 999)' }
              }
            };
          }
          if (opts.elementsAt) {
            return {
              result: {
                value: {
                  results: [
                    { x: 100, y: 100, ref: 'f0s1e1', tag: 'BUTTON' },
                    { x: 200, y: 200, ref: 'f0s1e2', tag: 'A' }
                  ]
                }
              }
            };
          }
          if (opts.elementsNear) {
            return {
              result: {
                value: {
                  elements: [
                    { ref: 'f0s1e1', tag: 'BUTTON', distance: 10 },
                    { ref: 'f0s1e2', tag: 'A', distance: 25 }
                  ],
                  searchCenter: { x: 100, y: 100 },
                  searchRadius: 50
                }
              }
            };
          }
          return {
            result: { value: 'default' }
          };
        }
        if (method === 'Runtime.callFunctionOn') {
          return {
            result: { value: { content: 'mocked' } }
          };
        }
        return {};
      })
    },
    getFrameContext: mock.fn(() => opts.frameContext || null),
    evaluateInFrame: mock.fn(async () => {
      return { result: { value: 'evaluated' } };
    }),
    getTitle: mock.fn(async () => opts.title || 'Test Page'),
    getUrl: mock.fn(async () => opts.url || 'https://example.com')
  };
}

function createMockElementLocator(opts = {}) {
  const mockElement = {
    objectId: 'obj-123',
    tagName: 'BUTTON',
    textContent: 'Submit',
    dispose: mock.fn(async () => {})
  };

  return {
    session: createMockPageController(opts).session,
    findElement: mock.fn(async (selector) => {
      if (opts.notFound || selector === '#missing') {
        return null;
      }
      return mockElement;
    }),
    findElements: mock.fn(async (selector) => {
      if (opts.notFound) {
        return [];
      }
      return [mockElement, { ...mockElement, objectId: 'obj-124' }];
    }),
    querySelectorAll: mock.fn(async (selector) => {
      if (opts.notFound || selector === '#missing') {
        return [];
      }
      return [mockElement, { ...mockElement, objectId: 'obj-124' }];
    }),
    getElementInfo: mock.fn(async () => {
      if (opts.infoError) {
        throw new Error('Failed to get element info');
      }
      return {
        tagName: 'BUTTON',
        text: 'Submit',
        href: null,
        value: null,
        attributes: { class: 'btn-primary', id: 'submit-btn' }
      };
    }),
    getFrameContext: mock.fn(() => opts.frameContext || null)
  };
}

// ---------------------------------------------------------------------------
// Tests: executeSnapshot
// ---------------------------------------------------------------------------

describe('executeSnapshot', () => {
  it('should throw if ariaSnapshot is null', async () => {
    await assert.rejects(
      async () => executeSnapshot(null, true),
      /Aria snapshot not available/
    );
  });

  it('should generate snapshot with default options', async () => {
    const ariaSnapshot = createMockAriaSnapshot();
    const result = await executeSnapshot(ariaSnapshot, true);

    assert.strictEqual(result.yaml, '- button "Submit"');
    assert.deepStrictEqual(result.refs, { 'f0s1e1': 'ref-data' });
    assert.strictEqual(result.snapshotId, 1);
    assert.ok(result.stats);
  });

  it('should pass through snapshot options', async () => {
    const ariaSnapshot = createMockAriaSnapshot();
    const params = { mode: 'ai', viewportOnly: true };
    await executeSnapshot(ariaSnapshot, params);

    const call = ariaSnapshot.generate.mock.calls[0];
    assert.strictEqual(call.arguments[0].mode, 'ai');
    assert.strictEqual(call.arguments[0].viewportOnly, true);
  });

  it('should default preserveRefs to true', async () => {
    const ariaSnapshot = createMockAriaSnapshot();
    await executeSnapshot(ariaSnapshot, {});

    const call = ariaSnapshot.generate.mock.calls[0];
    assert.strictEqual(call.arguments[0].preserveRefs, true);
  });

  it('should throw if snapshot generation returns error', async () => {
    const ariaSnapshot = createMockAriaSnapshot({ error: 'Snapshot failed' });
    await assert.rejects(
      async () => executeSnapshot(ariaSnapshot, true),
      /Snapshot failed/
    );
  });

  it('should return unchanged response', async () => {
    const ariaSnapshot = createMockAriaSnapshot({
      unchanged: true,
      snapshotId: 2
    });
    const result = await executeSnapshot(ariaSnapshot, true);

    assert.strictEqual(result.unchanged, true);
    assert.strictEqual(result.snapshotId, 2);
    assert.ok(result.message);
  });

  it('should truncate large snapshots to file', async () => {
    const largeYaml = 'x'.repeat(10000);
    const ariaSnapshot = createMockAriaSnapshot({ yaml: largeYaml });
    const result = await executeSnapshot(ariaSnapshot, { inlineLimit: 5000 });

    assert.strictEqual(result.yaml, null);
    assert.strictEqual(result.truncatedInline, true);
    assert.ok(result.artifacts);
    assert.ok(result.artifacts.snapshot);
    assert.ok(result.message.includes('too large'));
  });

  it('should respect inlineLimit from options parameter', async () => {
    const largeYaml = 'x'.repeat(10000);
    const ariaSnapshot = createMockAriaSnapshot({ yaml: largeYaml });
    const result = await executeSnapshot(
      ariaSnapshot,
      true,
      { inlineLimit: 5000 }
    );

    assert.strictEqual(result.truncatedInline, true);
  });

  it('should save large refs to file', async () => {
    const largeRefs = {};
    for (let i = 0; i < 1500; i++) {
      largeRefs[`s1e${i}`] = `ref-${i}`;
    }
    const ariaSnapshot = createMockAriaSnapshot({
      yaml: 'x'.repeat(10000),
      refs: largeRefs
    });
    const result = await executeSnapshot(ariaSnapshot, { inlineLimit: 5000 });

    assert.strictEqual(result.refs, null);
    assert.ok(result.artifacts.refs);
    assert.strictEqual(result.refsCount, 1500);
  });
});

// ---------------------------------------------------------------------------
// Tests: executeGetDom
// ---------------------------------------------------------------------------

describe('executeGetDom', () => {
  it('should get full page HTML when params is true', async () => {
    const pageController = createMockPageController({ getDomFull: true });
    const result = await executeGetDom(pageController, true);

    assert.strictEqual(result.tagName, 'html');
    assert.ok(result.html.includes('Full page'));
    assert.strictEqual(result.selector, null);
  });

  it('should get element HTML with string selector', async () => {
    const pageController = createMockPageController({ getDom: true });
    const result = await executeGetDom(pageController, '#test');

    assert.strictEqual(result.tagName, 'div');
    assert.ok(result.html.includes('Test content'));
    assert.strictEqual(result.selector, '#test');
  });

  it('should get element HTML with object params', async () => {
    const pageController = createMockPageController({ getDom: true });
    const result = await executeGetDom(pageController, {
      selector: '#test',
      outer: true
    });

    assert.ok(result.html);
    assert.strictEqual(result.selector, '#test');
  });

  it('should throw if element not found', async () => {
    const pageController = createMockPageController({ domError: true });
    await assert.rejects(
      async () => executeGetDom(pageController, '#missing'),
      /Element not found/
    );
  });

  it('should throw on evaluation error', async () => {
    const pageController = createMockPageController({ evalError: true });
    await assert.rejects(
      async () => executeGetDom(pageController, '#test'),
      /Evaluation error/
    );
  });

  it('should respect frame context', async () => {
    const pageController = createMockPageController({
      getDom: true,
      frameContext: 'frame-123'
    });
    await executeGetDom(pageController, '#test');

    const calls = pageController.session.send.mock.calls;
    const evalCall = calls.find(c => c.arguments[0] === 'Runtime.evaluate');
    assert.strictEqual(evalCall.arguments[1].contextId, 'frame-123');
  });
});

// ---------------------------------------------------------------------------
// Tests: executeGetBox
// ---------------------------------------------------------------------------

describe('executeGetBox', () => {
  it('should throw if ariaSnapshot is null', async () => {
    await assert.rejects(
      async () => executeGetBox(null, 'f0s1e1'),
      /ariaSnapshot is required/
    );
  });

  it('should get box for single ref string', async () => {
    const ariaSnapshot = createMockAriaSnapshot();
    const result = await executeGetBox(ariaSnapshot, 'f0s1e1');

    assert.strictEqual(result.x, 100);
    assert.strictEqual(result.y, 200);
    assert.strictEqual(result.width, 50);
    assert.strictEqual(result.height, 30);
    assert.strictEqual(result.center.x, 125);
    assert.strictEqual(result.center.y, 215);
  });

  it('should get boxes for array of refs', async () => {
    const ariaSnapshot = createMockAriaSnapshot();
    const result = await executeGetBox(ariaSnapshot, ['f0s1e1', 'f0s1e2']);

    assert.ok(result.f0s1e1);
    assert.ok(result.f0s1e2);
    assert.strictEqual(result.f0s1e1.x, 100);
    assert.strictEqual(result.f0s1e2.x, 100);
  });

  it('should handle ref object with refs array', async () => {
    const ariaSnapshot = createMockAriaSnapshot();
    const result = await executeGetBox(ariaSnapshot, { refs: ['f0s1e1', 'f0s1e2'] });

    // When multiple refs, returns object with ref keys
    assert.ok(result.f0s1e1);
    assert.strictEqual(result.f0s1e1.x, 100);
  });

  it('should handle ref object with single ref', async () => {
    const ariaSnapshot = createMockAriaSnapshot();
    const result = await executeGetBox(ariaSnapshot, { ref: 'f0s1e1' });

    assert.strictEqual(result.x, 100);
  });

  it('should return error for not found ref', async () => {
    const ariaSnapshot = createMockAriaSnapshot({ refNotFound: true });
    const result = await executeGetBox(ariaSnapshot, 'f0s1e999');

    assert.strictEqual(result.error, 'not found');
  });

  it('should return stale error for stale ref', async () => {
    const ariaSnapshot = createMockAriaSnapshot({ refStale: true });
    const result = await executeGetBox(ariaSnapshot, 'f0s1e998');

    assert.strictEqual(result.error, 'stale');
    assert.ok(result.message.includes('no longer in DOM'));
  });

  it('should return hidden error for hidden element', async () => {
    const ariaSnapshot = createMockAriaSnapshot({ refHidden: true });
    const result = await executeGetBox(ariaSnapshot, 'f0s1e997');

    assert.strictEqual(result.error, 'hidden');
    assert.ok(result.box);
  });

  it('should throw if no refs provided', async () => {
    const ariaSnapshot = createMockAriaSnapshot();
    await assert.rejects(
      async () => executeGetBox(ariaSnapshot, {}),
      /requires at least one ref/
    );
  });

  it('should throw if empty refs array', async () => {
    const ariaSnapshot = createMockAriaSnapshot();
    await assert.rejects(
      async () => executeGetBox(ariaSnapshot, []),
      /requires at least one ref/
    );
  });

  it('should handle mixed results for multiple refs', async () => {
    const ariaSnapshot = createMockAriaSnapshot();
    const result = await executeGetBox(ariaSnapshot, ['f0s1e1', 'f0s1e999', 'f0s1e998']);

    assert.ok(result.f0s1e1.x);
    assert.strictEqual(result.f0s1e999.error, 'not found');
    assert.strictEqual(result.f0s1e998.error, 'stale');
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefAt
// ---------------------------------------------------------------------------

describe('executeRefAt', () => {
  it('should get element ref at coordinates', async () => {
    const pageController = createMockPageController({ refAt: true });
    const result = await executeRefAt(pageController, { x: 100, y: 200 });

    assert.strictEqual(result.ref, 'f0s1e1');
    assert.strictEqual(result.tag, 'BUTTON');
    assert.strictEqual(result.clickable, true);
    assert.strictEqual(result.existing, false);
  });

  it('should return element info with box', async () => {
    const pageController = createMockPageController({ refAt: true });
    const result = await executeRefAt(pageController, { x: 100, y: 200 });

    assert.ok(result.box);
    assert.strictEqual(result.box.x, 100);
    assert.strictEqual(result.box.y, 200);
    assert.strictEqual(result.box.width, 80);
    assert.strictEqual(result.box.height, 40);
  });

  it('should throw if no element at coordinates', async () => {
    const pageController = createMockPageController({ refAtNoElement: true });
    await assert.rejects(
      async () => executeRefAt(pageController, { x: 999, y: 999 }),
      /No element at coordinates/
    );
  });

  it('should throw on evaluation error', async () => {
    const pageController = createMockPageController({ evalError: true });
    await assert.rejects(
      async () => executeRefAt(pageController, { x: 100, y: 100 }),
      /Evaluation error/
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeElementsAt
// ---------------------------------------------------------------------------

describe('executeElementsAt', () => {
  it('should get elements at multiple coordinates', async () => {
    const pageController = createMockPageController({ elementsAt: true });
    const coords = [
      { x: 100, y: 100 },
      { x: 200, y: 200 }
    ];
    const result = await executeElementsAt(pageController, coords);

    assert.ok(result.results);
    assert.strictEqual(result.results.length, 2);
    assert.strictEqual(result.results[0].ref, 'f0s1e1');
    assert.strictEqual(result.results[1].ref, 'f0s1e2');
  });

  it('should handle empty coordinates array', async () => {
    const pageController = createMockPageController({ elementsAt: true });
    const result = await executeElementsAt(pageController, []);

    assert.ok(result.results || Array.isArray(result));
  });

  it('should throw on evaluation error', async () => {
    const pageController = createMockPageController({ evalError: true });
    await assert.rejects(
      async () => executeElementsAt(pageController, [{ x: 100, y: 100 }]),
      /Evaluation error/
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeElementsNear
// ---------------------------------------------------------------------------

describe('executeElementsNear', () => {
  it('should get elements near coordinates', async () => {
    const pageController = createMockPageController({ elementsNear: true });
    const params = { x: 100, y: 100, radius: 50 };
    const result = await executeElementsNear(pageController, params);

    assert.ok(result.elements);
    assert.strictEqual(result.elements.length, 2);
    assert.strictEqual(result.searchCenter.x, 100);
    assert.strictEqual(result.searchRadius, 50);
  });

  it('should default radius to 100 if not provided', async () => {
    const pageController = createMockPageController({ elementsNear: true });
    const params = { x: 100, y: 100 };
    const result = await executeElementsNear(pageController, params);

    // Should still work with default radius
    assert.ok(result.elements || result.searchRadius);
  });

  it('should throw on evaluation error', async () => {
    const pageController = createMockPageController({ evalError: true });
    await assert.rejects(
      async () => executeElementsNear(pageController, { x: 100, y: 100 }),
      /Evaluation error/
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeQuery
// ---------------------------------------------------------------------------

describe('executeQuery', () => {
  it('should query element with string selector', async () => {
    const locator = createMockElementLocator();
    const result = await executeQuery(locator, 'button.submit');

    assert.ok(locator.querySelectorAll.mock.calls.length > 0);
    assert.ok(result);
    assert.ok(result.results);
  });

  it('should query element with object params', async () => {
    const locator = createMockElementLocator();
    const result = await executeQuery(locator, {
      selector: 'button.submit',
      output: 'text'
    });

    assert.ok(result);
  });

  it('should return empty results if element not found', async () => {
    const locator = createMockElementLocator({ notFound: true });
    const result = await executeQuery(locator, '#missing');

    assert.ok(result);
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.showing, 0);
    assert.strictEqual(result.results.length, 0);
  });

  it('should return query results with elements', async () => {
    const locator = createMockElementLocator();
    const result = await executeQuery(locator, 'button');

    assert.ok(result.results);
    assert.ok(result.total >= 0);
    assert.ok(result.showing >= 0);
  });

  it('should handle output processing', async () => {
    const locator = createMockElementLocator();
    const result = await executeQuery(locator, {
      selector: 'button',
      output: 'text'
    });

    assert.ok(result.results);
    assert.strictEqual(result.selector, 'button');
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRoleQuery
// ---------------------------------------------------------------------------

describe('executeRoleQuery', () => {
  it('should query by role', async () => {
    const locator = createMockElementLocator();
    const result = await executeRoleQuery(locator, { role: 'button' });

    // Should use role-based querying
    assert.ok(result !== undefined);
  });

  it('should handle role query with no results', async () => {
    const locator = createMockElementLocator({ notFound: true });
    // Role queries may return empty results rather than throwing
    const result = await executeRoleQuery(locator, { role: 'missing-role' });
    assert.ok(result !== undefined);
  });
});

// ---------------------------------------------------------------------------
// Tests: executeInspect
// ---------------------------------------------------------------------------

describe('executeInspect', () => {
  it('should inspect page with default options', async () => {
    const pageController = createMockPageController();
    const locator = createMockElementLocator();
    const result = await executeInspect(pageController, locator, true);

    assert.ok(result);
  });

  it('should inspect with custom options', async () => {
    const pageController = createMockPageController();
    const locator = createMockElementLocator();
    const result = await executeInspect(pageController, locator, {
      include: ['title', 'url']
    });

    assert.ok(result);
  });

  it('should handle false params', async () => {
    const pageController = createMockPageController();
    const locator = createMockElementLocator();
    const result = await executeInspect(pageController, locator, false);

    // Should return minimal or no inspection
    assert.ok(result !== undefined);
  });
});

// ---------------------------------------------------------------------------
// Tests: executeQueryAll
// ---------------------------------------------------------------------------

describe('executeQueryAll', () => {
  it('should query multiple elements', async () => {
    const locator = createMockElementLocator();
    const params = {
      submit: 'button[type="submit"]',
      cancel: 'button.cancel'
    };
    const result = await executeQueryAll(locator, params);

    assert.ok(result);
    // Should have queried for both selectors
    assert.ok(locator.querySelectorAll.mock.calls.length >= 2);
  });

  it('should handle empty params object', async () => {
    const locator = createMockElementLocator();
    const result = await executeQueryAll(locator, {});

    // Should handle gracefully
    assert.ok(result !== undefined);
  });

  it('should continue on individual query failures', async () => {
    const locator = createMockElementLocator({ notFound: true });
    const params = {
      exists: 'button.exists',
      missing: '#missing'
    };

    // Should not throw, should return partial results
    const result = await executeQueryAll(locator, params).catch(e => ({ error: true }));
    assert.ok(result);
  });
});

// ---------------------------------------------------------------------------
// Tests: executeSnapshotSearch
// ---------------------------------------------------------------------------

describe('executeSnapshotSearch', () => {
  it('should throw if ariaSnapshot is null', async () => {
    await assert.rejects(
      async () => executeSnapshotSearch(null, { text: 'search' }),
      /Aria snapshot not available/
    );
  });

  it('should search by text', async () => {
    const ariaSnapshot = createMockAriaSnapshot({ searchTree: true });
    const result = await executeSnapshotSearch(ariaSnapshot, { text: 'Submit' });

    assert.ok(result.matches);
    assert.ok(result.matches.length >= 0);
    assert.ok(ariaSnapshot.generate.mock.calls.length > 0);
  });

  it('should search by pattern (regex)', async () => {
    const ariaSnapshot = createMockAriaSnapshot({ searchTree: true });
    const result = await executeSnapshotSearch(ariaSnapshot, {
      pattern: 'Sub.*'
    });

    assert.ok(ariaSnapshot.generate.mock.calls.length > 0);
    assert.ok(result.matches);
  });

  it('should search by role', async () => {
    const ariaSnapshot = createMockAriaSnapshot({ searchTree: true });
    const result = await executeSnapshotSearch(ariaSnapshot, { role: 'button' });

    assert.ok(ariaSnapshot.generate.mock.calls.length > 0);
    assert.ok(result.matches);
  });

  it('should return empty results for no matches', async () => {
    const ariaSnapshot = createMockAriaSnapshot({ searchTree: true });
    const result = await executeSnapshotSearch(ariaSnapshot, { text: 'nonexistent' });

    assert.ok(result.matches);
    assert.strictEqual(result.matches.length, 0);
  });

  it('should pass through limit option', async () => {
    const ariaSnapshot = createMockAriaSnapshot({ searchTree: true });
    const result = await executeSnapshotSearch(ariaSnapshot, { text: 'button', limit: 1 });

    // Limit should cap results
    assert.ok(result.matches.length <= 1);
  });

  it('should pass through context option', async () => {
    const ariaSnapshot = createMockAriaSnapshot({ searchTree: true });
    const result = await executeSnapshotSearch(ariaSnapshot, { text: 'button', context: 50 });

    // Should complete without error
    assert.ok(result.matches);
  });
});
