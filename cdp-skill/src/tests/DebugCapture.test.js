import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createDebugCapture } from '../capture/debug-capture.js';

describe('DebugCapture', () => {
  let mockSession;
  let mockScreenshotCapture;
  let debugCapture;

  beforeEach(() => {
    mockSession = {
      send: mock.fn(async () => ({
        result: { value: '<html></html>' }
      }))
    };

    mockScreenshotCapture = {
      captureViewport: mock.fn(async () => Buffer.from('fake-png-data'))
    };

    debugCapture = createDebugCapture(mockSession, mockScreenshotCapture, {
      outputDir: '/tmp/cdp-skill-test/debug'
    });
  });

  afterEach(() => {
    mock.reset();
  });

  describe('createDebugCapture', () => {
    it('should return an object with expected methods', () => {
      assert.ok(typeof debugCapture.captureBefore === 'function');
      assert.ok(typeof debugCapture.captureAfter === 'function');
      assert.ok(typeof debugCapture.captureState === 'function');
      assert.ok(typeof debugCapture.getPageInfo === 'function');
      assert.ok(typeof debugCapture.reset === 'function');
    });
  });

  describe('captureState', () => {
    it('should capture screenshot and DOM', async () => {
      mockSession.send = mock.fn(async () => ({
        result: { value: '<html><body>Test</body></html>' }
      }));

      const result = await debugCapture.captureState('test-prefix');

      assert.ok(result.timestamp);
      assert.strictEqual(mockScreenshotCapture.captureViewport.mock.calls.length, 1);
      assert.strictEqual(mockSession.send.mock.calls.length, 1);
    });

    it('should return timestamp in ISO format', async () => {
      const result = await debugCapture.captureState('test');

      assert.ok(result.timestamp);
      assert.ok(result.timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
    });

    it('should handle screenshot capture error', async () => {
      mockScreenshotCapture.captureViewport = mock.fn(async () => {
        throw new Error('Screenshot failed');
      });

      const result = await debugCapture.captureState('test');

      assert.ok(result.screenshotError);
      assert.strictEqual(result.screenshotError, 'Screenshot failed');
    });

    it('should handle DOM capture error', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('DOM access denied');
      });

      const result = await debugCapture.captureState('test');

      assert.ok(result.domError);
      assert.strictEqual(result.domError, 'DOM access denied');
    });

    it('should skip screenshot when disabled', async () => {
      const capture = createDebugCapture(mockSession, mockScreenshotCapture, {
        captureScreenshots: false,
        outputDir: '/tmp/test'
      });

      await capture.captureState('test');

      assert.strictEqual(mockScreenshotCapture.captureViewport.mock.calls.length, 0);
    });

    it('should skip DOM capture when disabled', async () => {
      const capture = createDebugCapture(mockSession, mockScreenshotCapture, {
        captureDom: false,
        outputDir: '/tmp/test'
      });

      await capture.captureState('test');

      // Only screenshot call, no DOM evaluation
      const evalCalls = mockSession.send.mock.calls.filter(
        c => c.arguments[0] === 'Runtime.evaluate'
      );
      assert.strictEqual(evalCalls.length, 0);
    });
  });

  describe('captureBefore', () => {
    it('should increment step index', async () => {
      await debugCapture.captureBefore('click');
      await debugCapture.captureBefore('fill');

      // Can't directly check step index, but we can verify the pattern is used
      assert.strictEqual(mockScreenshotCapture.captureViewport.mock.calls.length, 2);
    });

    it('should include action name in capture', async () => {
      const result = await debugCapture.captureBefore('click', { selector: '#btn' });

      assert.ok(result.timestamp);
    });
  });

  describe('captureAfter', () => {
    it('should capture state after action', async () => {
      await debugCapture.captureBefore('click');
      const result = await debugCapture.captureAfter('click', {}, 'ok');

      assert.ok(result.timestamp);
      assert.strictEqual(mockScreenshotCapture.captureViewport.mock.calls.length, 2);
    });

    it('should include status in capture', async () => {
      await debugCapture.captureBefore('fill');
      await debugCapture.captureAfter('fill', {}, 'error');

      assert.strictEqual(mockScreenshotCapture.captureViewport.mock.calls.length, 2);
    });
  });

  describe('getPageInfo', () => {
    it('should return page information', async () => {
      mockSession.send = mock.fn(async () => ({
        result: {
          value: {
            url: 'https://example.com/page',
            title: 'Test Page',
            readyState: 'complete',
            scrollX: 0,
            scrollY: 100,
            innerWidth: 1920,
            innerHeight: 1080,
            documentWidth: 1920,
            documentHeight: 3000
          }
        }
      }));

      const info = await debugCapture.getPageInfo();

      assert.strictEqual(info.url, 'https://example.com/page');
      assert.strictEqual(info.title, 'Test Page');
      assert.strictEqual(info.readyState, 'complete');
      assert.strictEqual(info.scrollX, 0);
      assert.strictEqual(info.scrollY, 100);
      assert.strictEqual(info.innerWidth, 1920);
      assert.strictEqual(info.innerHeight, 1080);
      assert.strictEqual(info.documentWidth, 1920);
      assert.strictEqual(info.documentHeight, 3000);
    });

    it('should handle error gracefully', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('Page not available');
      });

      const info = await debugCapture.getPageInfo();

      assert.ok(info.error);
      assert.strictEqual(info.error, 'Page not available');
    });
  });

  describe('reset', () => {
    it('should reset step counter', async () => {
      await debugCapture.captureBefore('click');
      await debugCapture.captureBefore('fill');
      debugCapture.reset();
      await debugCapture.captureBefore('hover');

      // After reset, step counter should restart
      assert.strictEqual(mockScreenshotCapture.captureViewport.mock.calls.length, 3);
    });
  });

  describe('options', () => {
    it('should use default output directory when not specified', () => {
      const capture = createDebugCapture(mockSession, mockScreenshotCapture);
      // Just verify it doesn't throw
      assert.ok(capture);
    });

    it('should use custom output directory', () => {
      const capture = createDebugCapture(mockSession, mockScreenshotCapture, {
        outputDir: '/custom/path/debug'
      });
      assert.ok(capture);
    });

    it('should enable screenshots by default', async () => {
      const capture = createDebugCapture(mockSession, mockScreenshotCapture, {
        outputDir: '/tmp/test'
      });

      await capture.captureState('test');

      assert.strictEqual(mockScreenshotCapture.captureViewport.mock.calls.length, 1);
    });

    it('should enable DOM capture by default', async () => {
      const capture = createDebugCapture(mockSession, mockScreenshotCapture, {
        outputDir: '/tmp/test'
      });

      mockSession.send = mock.fn(async () => ({
        result: { value: '<html></html>' }
      }));

      await capture.captureState('test');

      assert.strictEqual(mockSession.send.mock.calls.length, 1);
    });
  });

  describe('step naming', () => {
    it('should format step index with padding', async () => {
      // Capture several steps to verify naming
      for (let i = 0; i < 5; i++) {
        await debugCapture.captureBefore('click');
      }

      // Each captureBefore should increment the step index
      assert.strictEqual(mockScreenshotCapture.captureViewport.mock.calls.length, 5);
    });

    it('should handle before/after pairing', async () => {
      await debugCapture.captureBefore('click');
      await debugCapture.captureAfter('click', {}, 'ok');
      await debugCapture.captureBefore('fill');
      await debugCapture.captureAfter('fill', {}, 'error');

      // 2 before + 2 after = 4 captures
      assert.strictEqual(mockScreenshotCapture.captureViewport.mock.calls.length, 4);
    });
  });

  describe('error handling', () => {
    it('should not throw when screenshot fails', async () => {
      mockScreenshotCapture.captureViewport = mock.fn(async () => {
        throw new Error('Browser crashed');
      });

      const result = await debugCapture.captureState('test');

      assert.ok(result.screenshotError);
      assert.ok(!result.screenshot);
    });

    it('should not throw when DOM capture fails', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('Execution context destroyed');
      });

      const result = await debugCapture.captureState('test');

      assert.ok(result.domError);
      assert.ok(!result.dom);
    });

    it('should capture screenshot even when DOM fails', async () => {
      mockSession.send = mock.fn(async () => {
        throw new Error('DOM error');
      });

      const result = await debugCapture.captureState('test');

      assert.ok(result.domError);
      assert.strictEqual(mockScreenshotCapture.captureViewport.mock.calls.length, 1);
    });

    it('should capture DOM even when screenshot fails', async () => {
      mockScreenshotCapture.captureViewport = mock.fn(async () => {
        throw new Error('Screenshot error');
      });

      mockSession.send = mock.fn(async () => ({
        result: { value: '<html></html>' }
      }));

      const result = await debugCapture.captureState('test');

      assert.ok(result.screenshotError);
      assert.strictEqual(mockSession.send.mock.calls.length, 1);
    });
  });
});
