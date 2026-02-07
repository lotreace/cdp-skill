import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  STEP_TYPES,
  VISUAL_ACTIONS,
  buildActionContext,
  buildCommandContext,
  captureFailureContext
} from '../runner/context-helpers.js';

describe('ContextHelpers', () => {
  describe('STEP_TYPES', () => {
    it('should be an array', () => {
      assert.ok(Array.isArray(STEP_TYPES));
    });

    it('should contain common step types', () => {
      assert.ok(STEP_TYPES.includes('goto'));
      assert.ok(STEP_TYPES.includes('click'));
      assert.ok(STEP_TYPES.includes('fill'));
      assert.ok(STEP_TYPES.includes('wait'));
      assert.ok(STEP_TYPES.includes('snapshot'));
      assert.ok(STEP_TYPES.includes('query'));
    });

    it('should contain navigation step types', () => {
      assert.ok(STEP_TYPES.includes('back'));
      assert.ok(STEP_TYPES.includes('forward'));
      assert.ok(STEP_TYPES.includes('waitForNavigation'));
    });

    it('should contain form step types', () => {
      assert.ok(STEP_TYPES.includes('fillForm'));
      assert.ok(STEP_TYPES.includes('type'));
      assert.ok(STEP_TYPES.includes('select'));
      assert.ok(STEP_TYPES.includes('selectOption'));
      assert.ok(STEP_TYPES.includes('submit'));
    });

    it('should contain tab step types', () => {
      assert.ok(STEP_TYPES.includes('listTabs'));
      assert.ok(STEP_TYPES.includes('closeTab'));
      assert.ok(STEP_TYPES.includes('openTab'));
    });

    it('should contain iframe step types', () => {
      assert.ok(STEP_TYPES.includes('switchToFrame'));
      assert.ok(STEP_TYPES.includes('switchToMainFrame'));
      assert.ok(STEP_TYPES.includes('listFrames'));
    });

    it('should contain coordinate-based step types', () => {
      assert.ok(STEP_TYPES.includes('refAt'));
      assert.ok(STEP_TYPES.includes('elementsAt'));
      assert.ok(STEP_TYPES.includes('elementsNear'));
    });
  });

  describe('VISUAL_ACTIONS', () => {
    it('should be an array', () => {
      assert.ok(Array.isArray(VISUAL_ACTIONS));
    });

    it('should contain interaction actions', () => {
      assert.ok(VISUAL_ACTIONS.includes('goto'));
      assert.ok(VISUAL_ACTIONS.includes('click'));
      assert.ok(VISUAL_ACTIONS.includes('fill'));
      assert.ok(VISUAL_ACTIONS.includes('type'));
      assert.ok(VISUAL_ACTIONS.includes('hover'));
      assert.ok(VISUAL_ACTIONS.includes('press'));
      assert.ok(VISUAL_ACTIONS.includes('scroll'));
    });

    it('should contain query actions', () => {
      assert.ok(VISUAL_ACTIONS.includes('snapshot'));
      assert.ok(VISUAL_ACTIONS.includes('query'));
      assert.ok(VISUAL_ACTIONS.includes('queryAll'));
      assert.ok(VISUAL_ACTIONS.includes('inspect'));
      assert.ok(VISUAL_ACTIONS.includes('eval'));
      assert.ok(VISUAL_ACTIONS.includes('extract'));
    });

    it('should not contain non-visual actions', () => {
      assert.ok(!VISUAL_ACTIONS.includes('cookies'));
      assert.ok(!VISUAL_ACTIONS.includes('listTabs'));
      assert.ok(!VISUAL_ACTIONS.includes('closeTab'));
    });
  });

  describe('buildActionContext', () => {
    describe('scroll action', () => {
      it('should return scrolled to bottom', () => {
        const result = buildActionContext('scroll', {}, { scroll: { percent: 100 } });
        assert.strictEqual(result, 'Scrolled to bottom');
      });

      it('should return scrolled to top', () => {
        const result = buildActionContext('scroll', {}, { scroll: { percent: 0 } });
        assert.strictEqual(result, 'Scrolled to top');
      });

      it('should return scrolled to percentage', () => {
        const result = buildActionContext('scroll', {}, { scroll: { percent: 50 } });
        assert.strictEqual(result, 'Scrolled to 50%');
      });

      it('should return generic scrolled when no context', () => {
        const result = buildActionContext('scroll', {}, null);
        assert.strictEqual(result, 'Scrolled');
      });
    });

    describe('click action', () => {
      it('should describe click with string selector', () => {
        const result = buildActionContext('click', '#button', {});
        assert.strictEqual(result, 'Clicked #button');
      });

      it('should describe click with object selector', () => {
        const result = buildActionContext('click', { selector: '.submit-btn' }, {});
        assert.strictEqual(result, 'Clicked .submit-btn');
      });

      it('should describe click with ref', () => {
        const result = buildActionContext('click', { ref: 's1e1' }, {});
        assert.strictEqual(result, 'Clicked [ref=s1e1]');
      });

      it('should describe click with text', () => {
        const result = buildActionContext('click', { text: 'Submit' }, {});
        assert.strictEqual(result, 'Clicked "Submit"');
      });

      it('should return generic for no params', () => {
        const result = buildActionContext('click', {}, {});
        assert.strictEqual(result, 'Clicked element');
      });
    });

    describe('hover action', () => {
      it('should describe hover with string selector', () => {
        const result = buildActionContext('hover', '#menu', {});
        assert.strictEqual(result, 'Hovered over #menu');
      });

      it('should describe hover with object selector', () => {
        const result = buildActionContext('hover', { selector: '.dropdown' }, {});
        assert.strictEqual(result, 'Hovered over .dropdown');
      });

      it('should return generic for no params', () => {
        const result = buildActionContext('hover', {}, {});
        assert.strictEqual(result, 'Hovered over element');
      });
    });

    describe('fill/type action', () => {
      it('should describe fill with selector', () => {
        const result = buildActionContext('fill', { selector: '#email' }, {});
        assert.strictEqual(result, 'Typed in #email');
      });

      it('should describe fill with label', () => {
        const result = buildActionContext('fill', { label: 'Email' }, {});
        assert.strictEqual(result, 'Typed in "Email"');
      });

      it('should describe type with selector', () => {
        const result = buildActionContext('type', { selector: '#search' }, {});
        assert.strictEqual(result, 'Typed in #search');
      });

      it('should return generic for no params', () => {
        const result = buildActionContext('fill', {}, {});
        assert.strictEqual(result, 'Typed in input');
      });
    });

    describe('press action', () => {
      it('should describe key press', () => {
        const result = buildActionContext('press', 'Enter', {});
        assert.strictEqual(result, 'Pressed Enter');
      });

      it('should handle undefined params', () => {
        const result = buildActionContext('press', undefined, {});
        assert.strictEqual(result, 'Pressed key');
      });
    });

    describe('unknown action', () => {
      it('should return empty string for unknown action', () => {
        const result = buildActionContext('unknown', {}, {});
        assert.strictEqual(result, '');
      });

      it('should return empty string for goto', () => {
        const result = buildActionContext('goto', 'https://example.com', {});
        assert.strictEqual(result, '');
      });
    });
  });

  describe('buildCommandContext', () => {
    it('should return Scrolled for scroll step', () => {
      const result = buildCommandContext([{ scroll: 'down' }]);
      assert.strictEqual(result, 'Scrolled');
    });

    it('should return Clicked for click step', () => {
      const result = buildCommandContext([{ click: '#btn' }]);
      assert.strictEqual(result, 'Clicked');
    });

    it('should return Hovered for hover step', () => {
      const result = buildCommandContext([{ hover: '#menu' }]);
      assert.strictEqual(result, 'Hovered');
    });

    it('should return Typed for fill step', () => {
      const result = buildCommandContext([{ fill: { selector: '#input', value: 'test' } }]);
      assert.strictEqual(result, 'Typed');
    });

    it('should return Typed for type step', () => {
      const result = buildCommandContext([{ type: { selector: '#input', text: 'test' } }]);
      assert.strictEqual(result, 'Typed');
    });

    it('should return Pressed key for press step', () => {
      const result = buildCommandContext([{ press: 'Enter' }]);
      assert.strictEqual(result, 'Pressed key');
    });

    it('should return Navigated for goto step', () => {
      const result = buildCommandContext([{ goto: 'https://example.com' }]);
      assert.strictEqual(result, 'Navigated');
    });

    it('should return Navigated for openTab step', () => {
      const result = buildCommandContext([{ openTab: 'https://example.com' }]);
      assert.strictEqual(result, 'Navigated');
    });

    it('should return Selected for select step', () => {
      const result = buildCommandContext([{ select: '#dropdown' }]);
      assert.strictEqual(result, 'Selected');
    });

    it('should return Dragged for drag step', () => {
      const result = buildCommandContext([{ drag: { source: '#a', target: '#b' } }]);
      assert.strictEqual(result, 'Dragged');
    });

    it('should capitalize single action name', () => {
      const result = buildCommandContext([{ snapshot: true }]);
      assert.strictEqual(result, 'Snapshot');
    });

    it('should return empty string for multiple actions without primary', () => {
      const result = buildCommandContext([{ snapshot: true }, { wait: 1000 }]);
      // Wait is in the list, so should return 'Scrolled' or similar based on priority
      // Actually wait is checked but not in priority list, so it goes to default
      assert.strictEqual(result, '');
    });

    it('should handle empty steps array', () => {
      const result = buildCommandContext([]);
      assert.strictEqual(result, '');
    });

    it('should prioritize scroll in multi-step command', () => {
      const result = buildCommandContext([{ wait: 1000 }, { scroll: 'down' }]);
      assert.strictEqual(result, 'Scrolled');
    });
  });

  describe('captureFailureContext', () => {
    let mockPageController;

    beforeEach(() => {
      mockPageController = {
        session: {
          send: mock.fn(async () => ({ result: { value: '' } }))
        },
        evaluateInFrame: mock.fn(async (expression, options = {}) => {
          const params = {
            expression,
            returnByValue: options.returnByValue !== false,
            awaitPromise: options.awaitPromise || false
          };
          return mockPageController.session.send('Runtime.evaluate', params);
        }),
        getFrameContext: mock.fn(() => null)
      };
    });

    afterEach(() => {
      mock.reset();
    });

    it('should capture page title', async () => {
      mockPageController.session.send = mock.fn(async (method, params) => {
        if (params?.expression === 'document.title') {
          return { result: { value: 'Test Page' } };
        }
        return { result: { value: '' } };
      });

      const context = await captureFailureContext({ pageController: mockPageController });

      assert.strictEqual(context.title, 'Test Page');
    });

    it('should capture current URL', async () => {
      mockPageController.session.send = mock.fn(async (method, params) => {
        if (params?.expression === 'window.location.href') {
          return { result: { value: 'https://example.com/page' } };
        }
        return { result: { value: '' } };
      });

      const context = await captureFailureContext({ pageController: mockPageController });

      assert.strictEqual(context.url, 'https://example.com/page');
    });

    it('should capture visible buttons', async () => {
      mockPageController.session.send = mock.fn(async (method, params) => {
        if (params?.expression?.includes('button')) {
          return {
            result: {
              value: [
                { text: 'Submit', selector: '#submit-btn' },
                { text: 'Cancel', selector: 'button.cancel' }
              ]
            }
          };
        }
        return { result: { value: '' } };
      });

      const context = await captureFailureContext({ pageController: mockPageController });

      assert.ok(Array.isArray(context.visibleButtons));
    });

    it('should capture visible links', async () => {
      mockPageController.session.send = mock.fn(async (method, params) => {
        if (params?.expression?.includes('a[href]')) {
          return {
            result: {
              value: [
                { text: 'Home', href: 'https://example.com/' },
                { text: 'About', href: 'https://example.com/about' }
              ]
            }
          };
        }
        return { result: { value: '' } };
      });

      const context = await captureFailureContext({ pageController: mockPageController });

      assert.ok(Array.isArray(context.visibleLinks));
    });

    it('should capture visible errors', async () => {
      mockPageController.session.send = mock.fn(async (method, params) => {
        if (params?.expression?.includes('errorSelectors')) {
          return {
            result: {
              value: ['Invalid email format', 'Password required']
            }
          };
        }
        return { result: { value: '' } };
      });

      const context = await captureFailureContext({ pageController: mockPageController });

      assert.ok(Array.isArray(context.visibleErrors));
    });

    it('should handle title capture error', async () => {
      mockPageController.session.send = mock.fn(async (method, params) => {
        if (params?.expression === 'document.title') {
          throw new Error('Context destroyed');
        }
        return { result: { value: '' } };
      });

      const context = await captureFailureContext({ pageController: mockPageController });

      assert.strictEqual(context.title, null);
    });

    it('should handle URL capture error', async () => {
      mockPageController.session.send = mock.fn(async (method, params) => {
        if (params?.expression === 'window.location.href') {
          throw new Error('Context destroyed');
        }
        return { result: { value: '' } };
      });

      const context = await captureFailureContext({ pageController: mockPageController });

      assert.strictEqual(context.url, null);
    });

    it('should handle buttons capture error', async () => {
      mockPageController.session.send = mock.fn(async (method, params) => {
        if (params?.expression?.includes('button')) {
          throw new Error('Timeout');
        }
        return { result: { value: '' } };
      });

      const context = await captureFailureContext({ pageController: mockPageController });

      assert.deepStrictEqual(context.visibleButtons, []);
    });

    it('should handle links capture error', async () => {
      mockPageController.session.send = mock.fn(async (method, params) => {
        if (params?.expression?.includes('a[href]')) {
          throw new Error('Timeout');
        }
        return { result: { value: '' } };
      });

      const context = await captureFailureContext({ pageController: mockPageController });

      assert.deepStrictEqual(context.visibleLinks, []);
    });

    it('should handle errors capture error', async () => {
      mockPageController.session.send = mock.fn(async (method, params) => {
        if (params?.expression?.includes('errorSelectors')) {
          throw new Error('Timeout');
        }
        return { result: { value: '' } };
      });

      const context = await captureFailureContext({ pageController: mockPageController });

      assert.deepStrictEqual(context.visibleErrors, []);
    });

    it('should return empty arrays when no elements found', async () => {
      mockPageController.session.send = mock.fn(async () => ({
        result: { value: null }
      }));

      const context = await captureFailureContext({ pageController: mockPageController });

      assert.deepStrictEqual(context.visibleButtons, []);
      assert.deepStrictEqual(context.visibleLinks, []);
      assert.deepStrictEqual(context.visibleErrors, []);
    });
  });
});
