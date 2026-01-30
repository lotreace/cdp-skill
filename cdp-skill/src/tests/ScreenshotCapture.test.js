import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createScreenshotCapture } from '../capture.js';

describe('ScreenshotCapture', () => {
  let screenshotCapture;
  let mockCdp;

  beforeEach(() => {
    mockCdp = {
      send: mock.fn()
    };
    screenshotCapture = createScreenshotCapture(mockCdp);
  });

  afterEach(() => {
    mock.reset();
  });

  describe('captureViewport', () => {
    it('should capture viewport screenshot with default options', async () => {
      const base64Data = Buffer.from('test-image').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      const result = await screenshotCapture.captureViewport();

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
      assert.deepStrictEqual(mockCdp.send.mock.calls[0].arguments, [
        'Page.captureScreenshot',
        { format: 'png' }
      ]);
      assert.ok(Buffer.isBuffer(result));
      assert.strictEqual(result.toString(), 'test-image');
    });

    it('should capture viewport screenshot with jpeg format and quality', async () => {
      const base64Data = Buffer.from('jpeg-image').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      const result = await screenshotCapture.captureViewport({ format: 'jpeg', quality: 80 });

      assert.deepStrictEqual(mockCdp.send.mock.calls[0].arguments, [
        'Page.captureScreenshot',
        { format: 'jpeg', quality: 80 }
      ]);
      assert.ok(Buffer.isBuffer(result));
    });

    it('should throw error for quality above 100', async () => {
      await assert.rejects(
        () => screenshotCapture.captureViewport({ format: 'jpeg', quality: 150 }),
        { message: 'Quality must be a number between 0 and 100' }
      );
    });

    it('should throw error for quality below 0', async () => {
      await assert.rejects(
        () => screenshotCapture.captureViewport({ format: 'jpeg', quality: -10 }),
        { message: 'Quality must be a number between 0 and 100' }
      );
    });

    it('should throw error when quality is set for png format', async () => {
      await assert.rejects(
        () => screenshotCapture.captureViewport({ format: 'png', quality: 80 }),
        { message: 'Quality option is only supported for jpeg and webp formats, not png' }
      );
    });

    it('should accept png without quality', async () => {
      const base64Data = Buffer.from('png-image').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      await screenshotCapture.captureViewport({ format: 'png' });

      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[1].quality, undefined);
    });
  });

  describe('captureFullPage', () => {
    it('should capture full page screenshot', async () => {
      const base64Data = Buffer.from('full-page').toString('base64');
      mockCdp.send.mock.mockImplementation((method) => {
        if (method === 'Page.getLayoutMetrics') {
          return Promise.resolve({
            contentSize: { width: 1200, height: 3000 }
          });
        }
        return Promise.resolve({ data: base64Data });
      });

      const result = await screenshotCapture.captureFullPage();

      assert.strictEqual(mockCdp.send.mock.calls.length, 2);
      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[0], 'Page.getLayoutMetrics');
      assert.deepStrictEqual(mockCdp.send.mock.calls[1].arguments[1].clip, {
        x: 0,
        y: 0,
        width: 1200,
        height: 3000,
        scale: 1
      });
      assert.ok(Buffer.isBuffer(result));
    });
  });

  describe('captureRegion', () => {
    it('should capture specific region', async () => {
      const base64Data = Buffer.from('region').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      const region = { x: 100, y: 200, width: 300, height: 400 };
      const result = await screenshotCapture.captureRegion(region);

      assert.deepStrictEqual(mockCdp.send.mock.calls[0].arguments[1].clip, {
        x: 100,
        y: 200,
        width: 300,
        height: 400,
        scale: 1
      });
      assert.ok(Buffer.isBuffer(result));
    });

    it('should capture region with custom scale', async () => {
      const base64Data = Buffer.from('region').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      const region = { x: 0, y: 0, width: 100, height: 100 };
      await screenshotCapture.captureRegion(region, { scale: 2 });

      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[1].clip.scale, 2);
    });
  });

  describe('captureElement', () => {
    it('should capture element with bounding box', async () => {
      const base64Data = Buffer.from('element').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      const boundingBox = { x: 50, y: 100, width: 200, height: 150 };
      await screenshotCapture.captureElement(boundingBox);

      assert.deepStrictEqual(mockCdp.send.mock.calls[0].arguments[1].clip, {
        x: 50,
        y: 100,
        width: 200,
        height: 150,
        scale: 1
      });
    });

    it('should capture element with padding', async () => {
      const base64Data = Buffer.from('element').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      const boundingBox = { x: 50, y: 100, width: 200, height: 150 };
      await screenshotCapture.captureElement(boundingBox, { padding: 10 });

      assert.deepStrictEqual(mockCdp.send.mock.calls[0].arguments[1].clip, {
        x: 40,
        y: 90,
        width: 220,
        height: 170,
        scale: 1
      });
    });

    it('should not allow negative coordinates with padding', async () => {
      const base64Data = Buffer.from('element').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      const boundingBox = { x: 5, y: 5, width: 100, height: 100 };
      await screenshotCapture.captureElement(boundingBox, { padding: 10 });

      const clip = mockCdp.send.mock.calls[0].arguments[1].clip;
      assert.strictEqual(clip.x, 0);
      assert.strictEqual(clip.y, 0);
    });
  });

  describe('format validation', () => {
    it('should accept png format', async () => {
      const base64Data = Buffer.from('png').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      await screenshotCapture.captureViewport({ format: 'png' });

      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[1].format, 'png');
    });

    it('should accept jpeg format', async () => {
      const base64Data = Buffer.from('jpeg').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      await screenshotCapture.captureViewport({ format: 'jpeg' });

      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[1].format, 'jpeg');
    });

    it('should accept webp format', async () => {
      const base64Data = Buffer.from('webp').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      await screenshotCapture.captureViewport({ format: 'webp' });

      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[1].format, 'webp');
    });

    it('should throw error for invalid format', async () => {
      await assert.rejects(
        () => screenshotCapture.captureViewport({ format: 'gif' }),
        { message: 'Invalid screenshot format "gif". Valid formats are: png, jpeg, webp' }
      );
    });

    it('should throw error for invalid format in captureFullPage', async () => {
      await assert.rejects(
        () => screenshotCapture.captureFullPage({ format: 'bmp' }),
        { message: 'Invalid screenshot format "bmp". Valid formats are: png, jpeg, webp' }
      );
    });

    it('should throw error for invalid format in captureRegion', async () => {
      await assert.rejects(
        () => screenshotCapture.captureRegion({ x: 0, y: 0, width: 100, height: 100 }, { format: 'tiff' }),
        { message: 'Invalid screenshot format "tiff". Valid formats are: png, jpeg, webp' }
      );
    });

    it('should throw error for invalid format in captureElement', async () => {
      await assert.rejects(
        () => screenshotCapture.captureElement({ x: 0, y: 0, width: 100, height: 100 }, { format: 'svg' }),
        { message: 'Invalid screenshot format "svg". Valid formats are: png, jpeg, webp' }
      );
    });

    it('should accept quality for webp format', async () => {
      const base64Data = Buffer.from('webp').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      await screenshotCapture.captureViewport({ format: 'webp', quality: 75 });

      assert.deepStrictEqual(mockCdp.send.mock.calls[0].arguments, [
        'Page.captureScreenshot',
        { format: 'webp', quality: 75 }
      ]);
    });

    it('should throw error for non-numeric quality', async () => {
      await assert.rejects(
        () => screenshotCapture.captureViewport({ format: 'jpeg', quality: 'high' }),
        { message: 'Quality must be a number between 0 and 100' }
      );
    });

    it('should accept quality of exactly 0', async () => {
      const base64Data = Buffer.from('jpeg').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      await screenshotCapture.captureViewport({ format: 'jpeg', quality: 0 });

      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[1].quality, 0);
    });

    it('should accept quality of exactly 100', async () => {
      const base64Data = Buffer.from('jpeg').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      await screenshotCapture.captureViewport({ format: 'jpeg', quality: 100 });

      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[1].quality, 100);
    });

    it('should validate format before making CDP call in captureFullPage', async () => {
      // Ensure validation happens before getLayoutMetrics is called
      await assert.rejects(
        () => screenshotCapture.captureFullPage({ format: 'invalid' }),
        /Invalid screenshot format/
      );

      // Verify no CDP calls were made
      assert.strictEqual(mockCdp.send.mock.calls.length, 0);
    });
  });

  describe('saveToFile', () => {
    it('should return absolute path for saved file', async () => {
      // Note: We can't easily mock fs/promises in ESM, so we just test the path logic
      const buffer = Buffer.from('test-data');
      const path = '/tmp/screenshot-test-' + Date.now() + '.png';

      // This will actually write the file, but tests the functionality
      const result = await screenshotCapture.saveToFile(buffer, path);

      assert.ok(result.endsWith('.png'));
      assert.ok(result.includes('screenshot-test-'));

      // Cleanup
      const fs = await import('fs/promises');
      try {
        await fs.unlink(result);
      } catch (e) {
        // Ignore cleanup errors
      }
    });
  });

  describe('captureToFile', () => {
    it('should capture viewport and save to file', async () => {
      const base64Data = Buffer.from('viewport').toString('base64');
      mockCdp.send.mock.mockImplementation(() => Promise.resolve({ data: base64Data }));

      const path = '/tmp/capture-test-' + Date.now() + '.png';
      const result = await screenshotCapture.captureToFile(path);

      assert.ok(result.endsWith('.png'));
      assert.ok(result.includes('capture-test-'));

      // Verify CDP was called correctly
      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[0], 'Page.captureScreenshot');

      // Cleanup
      const fs = await import('fs/promises');
      try {
        await fs.unlink(result);
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    it('should capture full page when option is set', async () => {
      const base64Data = Buffer.from('fullpage').toString('base64');
      mockCdp.send.mock.mockImplementation((method) => {
        if (method === 'Page.getLayoutMetrics') {
          return Promise.resolve({ contentSize: { width: 800, height: 2000 } });
        }
        return Promise.resolve({ data: base64Data });
      });

      const path = '/tmp/fullpage-test-' + Date.now() + '.png';
      await screenshotCapture.captureToFile(path, { fullPage: true });

      // Should call getLayoutMetrics first for full page
      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[0], 'Page.getLayoutMetrics');

      // Cleanup
      const fs = await import('fs/promises');
      try {
        await fs.unlink(path);
      } catch (e) {
        // Ignore cleanup errors
      }
    });
  });
});
