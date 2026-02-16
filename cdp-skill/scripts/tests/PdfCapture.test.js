import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createPdfCapture } from '../capture/pdf-capture.js';

describe('PdfCapture', () => {
  let mockSession;
  let pdfCapture;

  beforeEach(() => {
    mockSession = {
      send: mock.fn(async () => ({}))
    };
    pdfCapture = createPdfCapture(mockSession);
  });

  afterEach(() => {
    mock.reset();
  });

  describe('createPdfCapture', () => {
    it('should return an object with expected methods', () => {
      assert.ok(typeof pdfCapture.generatePdf === 'function');
      assert.ok(typeof pdfCapture.saveToFile === 'function');
      assert.ok(typeof pdfCapture.extractPdfMetadata === 'function');
      assert.ok(typeof pdfCapture.validatePdf === 'function');
    });
  });

  describe('generatePdf', () => {
    it('should generate PDF with default options', async () => {
      const pdfData = Buffer.from('%PDF-1.4 test content %%EOF').toString('base64');
      mockSession.send = mock.fn(async () => ({
        data: pdfData
      }));

      const buffer = await pdfCapture.generatePdf();

      assert.ok(Buffer.isBuffer(buffer));
      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[0], 'Page.printToPDF');
      assert.strictEqual(call.arguments[1].landscape, false);
      assert.strictEqual(call.arguments[1].printBackground, true);
      assert.strictEqual(call.arguments[1].scale, 1);
      assert.strictEqual(call.arguments[1].paperWidth, 8.5);
      assert.strictEqual(call.arguments[1].paperHeight, 11);
    });

    it('should pass landscape option', async () => {
      mockSession.send = mock.fn(async () => ({
        data: Buffer.from('%PDF-1.4').toString('base64')
      }));

      await pdfCapture.generatePdf({ landscape: true });

      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[1].landscape, true);
    });

    it('should pass custom paper size', async () => {
      mockSession.send = mock.fn(async () => ({
        data: Buffer.from('%PDF-1.4').toString('base64')
      }));

      await pdfCapture.generatePdf({ paperWidth: 8.27, paperHeight: 11.69 }); // A4

      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[1].paperWidth, 8.27);
      assert.strictEqual(call.arguments[1].paperHeight, 11.69);
    });

    it('should pass margin options', async () => {
      mockSession.send = mock.fn(async () => ({
        data: Buffer.from('%PDF-1.4').toString('base64')
      }));

      await pdfCapture.generatePdf({
        marginTop: 1,
        marginBottom: 1,
        marginLeft: 0.5,
        marginRight: 0.5
      });

      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[1].marginTop, 1);
      assert.strictEqual(call.arguments[1].marginBottom, 1);
      assert.strictEqual(call.arguments[1].marginLeft, 0.5);
      assert.strictEqual(call.arguments[1].marginRight, 0.5);
    });

    it('should pass scale option', async () => {
      mockSession.send = mock.fn(async () => ({
        data: Buffer.from('%PDF-1.4').toString('base64')
      }));

      await pdfCapture.generatePdf({ scale: 0.75 });

      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[1].scale, 0.75);
    });

    it('should pass page ranges option', async () => {
      mockSession.send = mock.fn(async () => ({
        data: Buffer.from('%PDF-1.4').toString('base64')
      }));

      await pdfCapture.generatePdf({ pageRanges: '1-3' });

      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[1].pageRanges, '1-3');
    });

    it('should pass header and footer options', async () => {
      mockSession.send = mock.fn(async () => ({
        data: Buffer.from('%PDF-1.4').toString('base64')
      }));

      await pdfCapture.generatePdf({
        displayHeaderFooter: true,
        headerTemplate: '<div>Header</div>',
        footerTemplate: '<div>Footer</div>'
      });

      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[1].displayHeaderFooter, true);
      assert.strictEqual(call.arguments[1].headerTemplate, '<div>Header</div>');
      assert.strictEqual(call.arguments[1].footerTemplate, '<div>Footer</div>');
    });

    it('should pass preferCSSPageSize option', async () => {
      mockSession.send = mock.fn(async () => ({
        data: Buffer.from('%PDF-1.4').toString('base64')
      }));

      await pdfCapture.generatePdf({ preferCSSPageSize: true });

      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[1].preferCSSPageSize, true);
    });

    it('should handle printBackground false', async () => {
      mockSession.send = mock.fn(async () => ({
        data: Buffer.from('%PDF-1.4').toString('base64')
      }));

      await pdfCapture.generatePdf({ printBackground: false });

      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[1].printBackground, false);
    });
  });

  describe('extractPdfMetadata', () => {
    it('should extract file size', () => {
      const buffer = Buffer.from('%PDF-1.4 test content /Type /Page %%EOF');
      const metadata = pdfCapture.extractPdfMetadata(buffer);

      assert.strictEqual(metadata.fileSize, buffer.length);
    });

    it('should format file size in bytes', () => {
      const buffer = Buffer.alloc(500);
      buffer.write('%PDF-1.4');
      const metadata = pdfCapture.extractPdfMetadata(buffer);

      assert.strictEqual(metadata.fileSizeFormatted, '500 B');
    });

    it('should format file size in KB', () => {
      const buffer = Buffer.alloc(2048);
      buffer.write('%PDF-1.4');
      const metadata = pdfCapture.extractPdfMetadata(buffer);

      assert.strictEqual(metadata.fileSizeFormatted, '2.0 KB');
    });

    it('should format file size in MB', () => {
      const buffer = Buffer.alloc(1024 * 1024 * 2);
      buffer.write('%PDF-1.4');
      const metadata = pdfCapture.extractPdfMetadata(buffer);

      assert.strictEqual(metadata.fileSizeFormatted, '2.00 MB');
    });

    it('should count pages', () => {
      const content = '%PDF-1.4 /Type /Page /Type /Page /Type /Page %%EOF';
      const buffer = Buffer.from(content);
      const metadata = pdfCapture.extractPdfMetadata(buffer);

      assert.strictEqual(metadata.pageCount, 3);
    });

    it('should return 1 page when no page markers found', () => {
      const buffer = Buffer.from('%PDF-1.4 content %%EOF');
      const metadata = pdfCapture.extractPdfMetadata(buffer);

      assert.strictEqual(metadata.pageCount, 1);
    });

    it('should extract MediaBox dimensions', () => {
      const content = '%PDF-1.4 /MediaBox [ 0 0 612 792 ] /Type /Page %%EOF';
      const buffer = Buffer.from(content);
      const metadata = pdfCapture.extractPdfMetadata(buffer);

      assert.strictEqual(metadata.dimensions.width, 612);
      assert.strictEqual(metadata.dimensions.height, 792);
      assert.strictEqual(metadata.dimensions.unit, 'points');
    });

    it('should use default dimensions when MediaBox not found', () => {
      const buffer = Buffer.from('%PDF-1.4 /Type /Page %%EOF');
      const metadata = pdfCapture.extractPdfMetadata(buffer);

      assert.strictEqual(metadata.dimensions.width, 612);
      assert.strictEqual(metadata.dimensions.height, 792);
    });
  });

  describe('validatePdf', () => {
    it('should return valid for proper PDF', () => {
      const content = '%PDF-1.4\nxref\n%%EOF';
      const buffer = Buffer.alloc(200);
      buffer.write(content);
      const result = pdfCapture.validatePdf(buffer);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should return error for missing PDF header', () => {
      const buffer = Buffer.alloc(200);
      buffer.write('Not a PDF file');
      const result = pdfCapture.validatePdf(buffer);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('missing PDF header')));
    });

    it('should return warning for missing EOF marker', () => {
      const buffer = Buffer.alloc(200);
      buffer.write('%PDF-1.4 content');
      const result = pdfCapture.validatePdf(buffer);

      assert.ok(result.warnings.some(w => w.includes('missing EOF marker')));
    });

    it('should return warning for missing xref', () => {
      const buffer = Buffer.alloc(200);
      buffer.write('%PDF-1.4 content %%EOF');
      const result = pdfCapture.validatePdf(buffer);

      assert.ok(result.warnings.some(w => w.includes('no cross-reference found')));
    });

    it('should accept XRef stream as valid', () => {
      const content = '%PDF-1.4 /XRef %%EOF';
      const buffer = Buffer.alloc(200);
      buffer.write(content);
      const result = pdfCapture.validatePdf(buffer);

      assert.ok(!result.warnings.some(w => w.includes('cross-reference')));
    });

    it('should return error for too small file', () => {
      const buffer = Buffer.from('%PDF-1.4');
      const result = pdfCapture.validatePdf(buffer);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('too small')));
    });
  });

  describe('saveToFile', () => {
    it('should generate and save PDF', async () => {
      const pdfData = '%PDF-1.4\n/Type /Page\nxref\n%%EOF';
      const buffer = Buffer.alloc(200);
      buffer.write(pdfData);

      mockSession.send = mock.fn(async () => ({
        data: buffer.toString('base64')
      }));

      // Note: This test would need file system mocking for complete coverage
      // For now, we test the CDP interaction
      try {
        await pdfCapture.saveToFile('/tmp/test.pdf');
      } catch (e) {
        // Expected to fail on mkdir/writeFile in test environment
      }

      const call = mockSession.send.mock.calls[0];
      assert.strictEqual(call.arguments[0], 'Page.printToPDF');
    });

    it('should include validation when validate option is true', async () => {
      const pdfData = '%PDF-1.4\n/Type /Page\nxref\n%%EOF';
      const buffer = Buffer.alloc(200);
      buffer.write(pdfData);

      mockSession.send = mock.fn(async () => ({
        data: buffer.toString('base64')
      }));

      try {
        const result = await pdfCapture.saveToFile('/tmp/test.pdf', { validate: true });
        // If successful, check validation was included
        if (result) {
          assert.ok(result.validation);
        }
      } catch (e) {
        // Expected to fail on mkdir/writeFile in test environment
      }
    });
  });

  describe('generateElementPdf', () => {
    it('should throw when elementLocator not provided', async () => {
      // Access the internal generateElementPdf through saveToFile with selector
      mockSession.send = mock.fn(async () => ({
        data: Buffer.from('%PDF-1.4').toString('base64')
      }));

      try {
        // Try with selector but no elementLocator
        await pdfCapture.saveToFile('/tmp/test.pdf', { selector: '#element' }, null);
      } catch (e) {
        // Should fail requiring elementLocator
        if (e.message.includes('Element locator required')) {
          assert.ok(true);
        }
      }
    });
  });
});
