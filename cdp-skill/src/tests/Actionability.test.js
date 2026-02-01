import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createActionabilityChecker } from '../dom/actionability.js';

describe('ActionabilityChecker', () => {
  let mockSession;
  let checker;

  beforeEach(() => {
    mockSession = {
      send: mock.fn(async () => ({}))
    };
    checker = createActionabilityChecker(mockSession);
  });

  afterEach(() => {
    mock.reset();
  });

  describe('createActionabilityChecker', () => {
    it('should return an object with expected methods', () => {
      assert.ok(typeof checker.waitForActionable === 'function');
      assert.ok(typeof checker.getClickablePoint === 'function');
      assert.ok(typeof checker.checkHitTarget === 'function');
      assert.ok(typeof checker.checkPointerEvents === 'function');
      assert.ok(typeof checker.checkCovered === 'function');
      assert.ok(typeof checker.checkVisible === 'function');
      assert.ok(typeof checker.checkEnabled === 'function');
      assert.ok(typeof checker.checkEditable === 'function');
      assert.ok(typeof checker.checkStable === 'function');
      assert.ok(typeof checker.getRequiredStates === 'function');
      assert.ok(typeof checker.scrollUntilVisible === 'function');
    });
  });

  describe('getRequiredStates', () => {
    it('should return attached state for click action', () => {
      const states = checker.getRequiredStates('click');
      assert.deepStrictEqual(states, ['attached']);
    });

    it('should return attached state for hover action', () => {
      const states = checker.getRequiredStates('hover');
      assert.deepStrictEqual(states, ['attached']);
    });

    it('should return attached and editable states for fill action', () => {
      const states = checker.getRequiredStates('fill');
      assert.deepStrictEqual(states, ['attached', 'editable']);
    });

    it('should return attached and editable states for type action', () => {
      const states = checker.getRequiredStates('type');
      assert.deepStrictEqual(states, ['attached', 'editable']);
    });

    it('should return attached state for select action', () => {
      const states = checker.getRequiredStates('select');
      assert.deepStrictEqual(states, ['attached']);
    });

    it('should return attached state for unknown action', () => {
      const states = checker.getRequiredStates('unknown');
      assert.deepStrictEqual(states, ['attached']);
    });
  });

  describe('checkVisible', () => {
    it('should return matches true for visible element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: true, received: 'visible' } }
      }));

      const result = await checker.checkVisible('obj-123');
      assert.deepStrictEqual(result, { matches: true, received: 'visible' });
    });

    it('should return matches false for hidden element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'visibility:hidden' } }
      }));

      const result = await checker.checkVisible('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'visibility:hidden');
    });

    it('should return matches false for display none element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'display:none' } }
      }));

      const result = await checker.checkVisible('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'display:none');
    });

    it('should return matches false for zero-size element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'zero-size' } }
      }));

      const result = await checker.checkVisible('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'zero-size');
    });

    it('should return matches false for detached element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'detached' } }
      }));

      const result = await checker.checkVisible('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'detached');
    });

    it('should handle errors gracefully', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('Connection lost');
      });

      const result = await checker.checkVisible('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'error');
      assert.ok(result.error);
    });
  });

  describe('checkEnabled', () => {
    it('should return matches true for enabled element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: true, received: 'enabled' } }
      }));

      const result = await checker.checkEnabled('obj-123');
      assert.deepStrictEqual(result, { matches: true, received: 'enabled' });
    });

    it('should return matches false for disabled element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'disabled' } }
      }));

      const result = await checker.checkEnabled('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'disabled');
    });

    it('should return matches false for aria-disabled element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'aria-disabled' } }
      }));

      const result = await checker.checkEnabled('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'aria-disabled');
    });

    it('should return matches false for fieldset-disabled element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'fieldset-disabled' } }
      }));

      const result = await checker.checkEnabled('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'fieldset-disabled');
    });

    it('should handle errors gracefully', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('Connection lost');
      });

      const result = await checker.checkEnabled('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'error');
    });
  });

  describe('checkEditable', () => {
    it('should return matches true for editable input', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: true, received: 'editable' } }
      }));

      const result = await checker.checkEditable('obj-123');
      assert.deepStrictEqual(result, { matches: true, received: 'editable' });
    });

    it('should return matches false for readonly element', async () => {
      // First call checks enabled, second checks editable
      let callCount = 0;
      mockSession.send = mock.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return { result: { value: { matches: true, received: 'enabled' } } };
        }
        return { result: { value: { matches: false, received: 'readonly' } } };
      });

      const result = await checker.checkEditable('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'readonly');
    });

    it('should return matches false for disabled element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'disabled' } }
      }));

      const result = await checker.checkEditable('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'disabled');
    });

    it('should return matches false for non-editable element', async () => {
      let callCount = 0;
      mockSession.send = mock.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return { result: { value: { matches: true, received: 'enabled' } } };
        }
        return { result: { value: { matches: false, received: 'not-editable-element' } } };
      });

      const result = await checker.checkEditable('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'not-editable-element');
    });
  });

  describe('checkStable', () => {
    it('should return matches true for stable element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: true, received: 'stable' } }
      }));

      const result = await checker.checkStable('obj-123');
      assert.deepStrictEqual(result, { matches: true, received: 'stable' });
    });

    it('should return matches false for unstable element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'unstable' } }
      }));

      const result = await checker.checkStable('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'unstable');
    });

    it('should return matches false for detached element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'detached' } }
      }));

      const result = await checker.checkStable('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'detached');
    });

    it('should handle errors gracefully', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('Connection lost');
      });

      const result = await checker.checkStable('obj-123');
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'error');
    });
  });

  describe('waitForActionable', () => {
    it('should return success when element is found and actionable', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          return { result: { value: { matches: true, received: 'attached' } } };
        }
        return {};
      });

      const result = await checker.waitForActionable('#button', 'click');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.objectId, 'obj-123');
    });

    it('should return success immediately with force option', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { objectId: 'obj-456' }
      }));

      const result = await checker.waitForActionable('#button', 'click', { force: true });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.objectId, 'obj-456');
      assert.strictEqual(result.forced, true);
    });

    it('should return failure when element not found', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { subtype: 'null' }
      }));

      const result = await checker.waitForActionable('#missing', 'click', { timeout: 100 });
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('Element not found'));
    });

    it('should retry until element becomes actionable', async () => {
      let callCount = 0;
      mockSession.send = mock.fn(async (method) => {
        callCount++;
        if (method === 'Runtime.evaluate') {
          if (callCount < 3) {
            return { result: { subtype: 'null' } };
          }
          return { result: { objectId: 'obj-789' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          return { result: { value: { matches: true, received: 'attached' } } };
        }
        return {};
      });

      const result = await checker.waitForActionable('#delayed', 'click', { timeout: 2000 });
      assert.strictEqual(result.success, true);
      assert.ok(callCount >= 3);
    });

    it('should timeout when element never becomes actionable', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          return { result: { value: { matches: false, received: 'detached' } } };
        }
        return {};
      });

      const result = await checker.waitForActionable('#failing', 'click', { timeout: 200 });
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('not attached'));
    });

    it('should release objectId on failure', async () => {
      let releaseObjectCalled = false;
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          return { result: { value: { matches: false, received: 'detached' } } };
        }
        if (method === 'Runtime.releaseObject') {
          releaseObjectCalled = true;
          return {};
        }
        return {};
      });

      await checker.waitForActionable('#failing', 'click', { timeout: 200 });
      assert.strictEqual(releaseObjectCalled, true);
    });
  });

  describe('getClickablePoint', () => {
    it('should return center point of element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: {
            x: 150,
            y: 100,
            rect: { x: 100, y: 50, width: 100, height: 100 }
          }
        }
      }));

      const result = await checker.getClickablePoint('obj-123');
      assert.strictEqual(result.x, 150);
      assert.strictEqual(result.y, 100);
      assert.deepStrictEqual(result.rect, { x: 100, y: 50, width: 100, height: 100 });
    });

    it('should return null on error', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('Element removed');
      });

      const result = await checker.getClickablePoint('obj-123');
      assert.strictEqual(result, null);
    });
  });

  describe('checkHitTarget', () => {
    it('should return matches true when element is hit', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: true, received: 'hit' } }
      }));

      const result = await checker.checkHitTarget('obj-123', { x: 100, y: 100 });
      assert.deepStrictEqual(result, { matches: true, received: 'hit' });
    });

    it('should return matches false when blocked by another element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'blocked', blockedBy: 'div.modal' } }
      }));

      const result = await checker.checkHitTarget('obj-123', { x: 100, y: 100 });
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'blocked');
      assert.strictEqual(result.blockedBy, 'div.modal');
    });

    it('should return matches false when no element at point', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { matches: false, received: 'no-element-at-point' } }
      }));

      const result = await checker.checkHitTarget('obj-123', { x: 100, y: 100 });
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'no-element-at-point');
    });

    it('should handle errors gracefully', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('Connection lost');
      });

      const result = await checker.checkHitTarget('obj-123', { x: 100, y: 100 });
      assert.strictEqual(result.matches, false);
      assert.strictEqual(result.received, 'error');
    });
  });

  describe('checkPointerEvents', () => {
    it('should return clickable true for normal element', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { clickable: true, pointerEvents: 'auto' } }
      }));

      const result = await checker.checkPointerEvents('obj-123');
      assert.strictEqual(result.clickable, true);
      assert.strictEqual(result.pointerEvents, 'auto');
    });

    it('should return clickable false for pointer-events none', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: { clickable: false, pointerEvents: 'none', blockedBy: 'self' } }
      }));

      const result = await checker.checkPointerEvents('obj-123');
      assert.strictEqual(result.clickable, false);
      assert.strictEqual(result.pointerEvents, 'none');
      assert.strictEqual(result.blockedBy, 'self');
    });

    it('should handle errors gracefully', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('Connection lost');
      });

      const result = await checker.checkPointerEvents('obj-123');
      assert.strictEqual(result.clickable, true);
      assert.strictEqual(result.pointerEvents, 'unknown');
    });
  });

  describe('checkCovered', () => {
    it('should return covered false when element is visible', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'DOM.describeNode') {
          return { node: { backendNodeId: 123 } };
        }
        if (method === 'DOM.getNodeForLocation') {
          return { backendNodeId: 123 };
        }
        return {};
      });

      const result = await checker.checkCovered('obj-123', { x: 100, y: 100 });
      assert.strictEqual(result.covered, false);
    });

    it('should return covered true when element is blocked', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'DOM.describeNode') {
          return { node: { backendNodeId: 123 } };
        }
        if (method === 'DOM.getNodeForLocation') {
          return { backendNodeId: 456 };
        }
        if (method === 'Runtime.callFunctionOn') {
          return { result: { value: { isChild: false, coverInfo: 'div.overlay' } } };
        }
        return {};
      });

      const result = await checker.checkCovered('obj-123', { x: 100, y: 100 });
      assert.strictEqual(result.covered, true);
      assert.strictEqual(result.coveringElement, 'div.overlay');
    });

    it('should return covered false when hit element is child', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'DOM.describeNode') {
          return { node: { backendNodeId: 123 } };
        }
        if (method === 'DOM.getNodeForLocation') {
          return { backendNodeId: 456 };
        }
        if (method === 'Runtime.callFunctionOn') {
          return { result: { value: { isChild: true } } };
        }
        return {};
      });

      const result = await checker.checkCovered('obj-123', { x: 100, y: 100 });
      assert.strictEqual(result.covered, false);
    });
  });

  describe('scrollUntilVisible', () => {
    it('should return found true when element is immediately visible', async () => {
      mockSession.send = mock.fn(async (method) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn') {
          return { result: { value: { matches: true, received: 'visible' } } };
        }
        return {};
      });

      const result = await checker.scrollUntilVisible('#element');
      assert.strictEqual(result.found, true);
      assert.strictEqual(result.scrollCount, 0);
      assert.ok(result.objectId);
    });

    it('should scroll and find element after scrolling', async () => {
      let callCount = 0;
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression?.includes('querySelector')) {
          callCount++;
          if (callCount < 3) {
            return { result: { subtype: 'null' } };
          }
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.evaluate' && params?.expression?.includes('scrollBy')) {
          return { result: {} };
        }
        if (method === 'Runtime.callFunctionOn') {
          return { result: { value: { matches: true, received: 'visible' } } };
        }
        return {};
      });

      const result = await checker.scrollUntilVisible('#element', { timeout: 5000 });
      assert.strictEqual(result.found, true);
      assert.ok(result.scrollCount > 0);
    });

    it('should return found false when maxScrolls reached', async () => {
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression?.includes('querySelector')) {
          return { result: { subtype: 'null' } };
        }
        if (method === 'Runtime.evaluate' && params?.expression?.includes('scrollBy')) {
          return { result: {} };
        }
        return {};
      });

      const result = await checker.scrollUntilVisible('#missing', { maxScrolls: 2, timeout: 1000 });
      assert.strictEqual(result.found, false);
      assert.strictEqual(result.reason, 'maxScrollsReached');
    });

    it('should scroll element into view when found but not visible', async () => {
      let scrollIntoViewCalled = false;
      mockSession.send = mock.fn(async (method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression?.includes('querySelector')) {
          return { result: { objectId: 'obj-123' } };
        }
        if (method === 'Runtime.callFunctionOn' && params?.functionDeclaration?.includes('scrollIntoView')) {
          scrollIntoViewCalled = true;
          return { result: {} };
        }
        if (method === 'Runtime.callFunctionOn') {
          // First visibility check returns false, second returns true
          if (!scrollIntoViewCalled) {
            return { result: { value: { matches: false, received: 'zero-size' } } };
          }
          return { result: { value: { matches: true, received: 'visible' } } };
        }
        if (method === 'Runtime.releaseObject') {
          return {};
        }
        return {};
      });

      const result = await checker.scrollUntilVisible('#element');
      assert.strictEqual(result.found, true);
      assert.strictEqual(result.scrolledIntoView, true);
    });
  });
});
