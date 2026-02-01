import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createErrorAggregator } from '../capture/index.js';

describe('ErrorAggregator', () => {
  let errorAggregator;
  let mockConsoleCapture;
  let mockNetworkCapture;

  beforeEach(() => {
    mockConsoleCapture = {
      getErrors: mock.fn(() => []),
      getWarnings: mock.fn(() => [])
    };

    mockNetworkCapture = {
      getNetworkFailures: mock.fn(() => []),
      getHttpErrors: mock.fn(() => []),
      getAllErrors: mock.fn(() => [])
    };

    errorAggregator = createErrorAggregator(mockConsoleCapture, mockNetworkCapture);
  });

  afterEach(() => {
    mock.reset();
  });

  describe('constructor', () => {
    it('should throw error when consoleCapture is null', () => {
      assert.throws(
        () => createErrorAggregator(null, mockNetworkCapture),
        { message: 'consoleCapture is required' }
      );
    });

    it('should throw error when networkCapture is null', () => {
      assert.throws(
        () => createErrorAggregator(mockConsoleCapture, null),
        { message: 'networkCapture is required' }
      );
    });

    it('should throw error when consoleCapture is undefined', () => {
      assert.throws(
        () => createErrorAggregator(undefined, mockNetworkCapture),
        { message: 'consoleCapture is required' }
      );
    });

    it('should throw error when networkCapture is undefined', () => {
      assert.throws(
        () => createErrorAggregator(mockConsoleCapture, undefined),
        { message: 'networkCapture is required' }
      );
    });
  });

  describe('getSummary', () => {
    it('should return empty summary when no errors', () => {
      const summary = errorAggregator.getSummary();

      assert.strictEqual(summary.hasErrors, false);
      assert.strictEqual(summary.hasWarnings, false);
      assert.strictEqual(summary.counts.consoleErrors, 0);
      assert.strictEqual(summary.counts.consoleWarnings, 0);
      assert.strictEqual(summary.counts.networkFailures, 0);
      assert.strictEqual(summary.counts.httpClientErrors, 0);
      assert.strictEqual(summary.counts.httpServerErrors, 0);
    });

    it('should count console errors', () => {
      mockConsoleCapture.getErrors.mock.mockImplementation(() => [
        { level: 'error', text: 'Error 1' },
        { level: 'error', text: 'Error 2' }
      ]);

      const summary = errorAggregator.getSummary();

      assert.strictEqual(summary.hasErrors, true);
      assert.strictEqual(summary.counts.consoleErrors, 2);
    });

    it('should count console warnings', () => {
      mockConsoleCapture.getWarnings.mock.mockImplementation(() => [
        { level: 'warning', text: 'Warning 1' }
      ]);

      const summary = errorAggregator.getSummary();

      assert.strictEqual(summary.hasWarnings, true);
      assert.strictEqual(summary.counts.consoleWarnings, 1);
    });

    it('should count network failures', () => {
      mockNetworkCapture.getNetworkFailures.mock.mockImplementation(() => [
        { type: 'network-failure', errorText: 'Connection refused' }
      ]);

      const summary = errorAggregator.getSummary();

      assert.strictEqual(summary.hasErrors, true);
      assert.strictEqual(summary.counts.networkFailures, 1);
    });

    it('should count HTTP client errors (4xx) as warnings', () => {
      mockNetworkCapture.getHttpErrors.mock.mockImplementation(() => [
        { type: 'http-error', status: 404 },
        { type: 'http-error', status: 403 }
      ]);

      const summary = errorAggregator.getSummary();

      assert.strictEqual(summary.hasWarnings, true);
      assert.strictEqual(summary.hasErrors, false);
      assert.strictEqual(summary.counts.httpClientErrors, 2);
    });

    it('should count HTTP server errors (5xx) as errors', () => {
      mockNetworkCapture.getHttpErrors.mock.mockImplementation(() => [
        { type: 'http-error', status: 500 },
        { type: 'http-error', status: 502 },
        { type: 'http-error', status: 404 }
      ]);

      const summary = errorAggregator.getSummary();

      assert.strictEqual(summary.hasErrors, true);
      assert.strictEqual(summary.counts.httpServerErrors, 2);
      assert.strictEqual(summary.counts.httpClientErrors, 1);
    });

    it('should include error arrays in summary', () => {
      const consoleError = { level: 'error', text: 'Error' };
      const networkFailure = { type: 'network-failure', errorText: 'Failed' };
      const httpError = { type: 'http-error', status: 500 };

      mockConsoleCapture.getErrors.mock.mockImplementation(() => [consoleError]);
      mockNetworkCapture.getNetworkFailures.mock.mockImplementation(() => [networkFailure]);
      mockNetworkCapture.getHttpErrors.mock.mockImplementation(() => [httpError]);

      const summary = errorAggregator.getSummary();

      assert.deepStrictEqual(summary.errors.console, [consoleError]);
      assert.deepStrictEqual(summary.errors.network, [networkFailure]);
      assert.deepStrictEqual(summary.errors.http, [httpError]);
    });
  });

  describe('getAllErrorsChronological', () => {
    it('should combine and sort all errors by timestamp', () => {
      mockConsoleCapture.getErrors.mock.mockImplementation(() => [
        { level: 'error', text: 'Console error', timestamp: 2000 }
      ]);

      mockNetworkCapture.getAllErrors.mock.mockImplementation(() => [
        { type: 'network-failure', timestamp: 1000 },
        { type: 'http-error', status: 500, timestamp: 3000 }
      ]);

      const errors = errorAggregator.getAllErrorsChronological();

      assert.strictEqual(errors.length, 3);
      assert.strictEqual(errors[0].timestamp, 1000);
      assert.strictEqual(errors[0].source, 'network');
      assert.strictEqual(errors[1].timestamp, 2000);
      assert.strictEqual(errors[1].source, 'console');
      assert.strictEqual(errors[2].timestamp, 3000);
      assert.strictEqual(errors[2].source, 'network');
    });

    it('should handle errors with missing timestamps', () => {
      mockConsoleCapture.getErrors.mock.mockImplementation(() => [
        { level: 'error', text: 'No timestamp' }
      ]);

      mockNetworkCapture.getAllErrors.mock.mockImplementation(() => [
        { type: 'network-failure', timestamp: 1000 }
      ]);

      const errors = errorAggregator.getAllErrorsChronological();

      assert.strictEqual(errors.length, 2);
      assert.strictEqual(errors[0].timestamp || 0, 0);
      assert.strictEqual(errors[1].timestamp, 1000);
    });
  });

  describe('getCriticalErrors', () => {
    it('should return only exceptions', () => {
      mockConsoleCapture.getErrors.mock.mockImplementation(() => [
        { type: 'exception', level: 'error', text: 'Exception' },
        { type: 'console', level: 'error', text: 'Console error' }
      ]);

      const critical = errorAggregator.getCriticalErrors();

      const consoleErrors = critical.filter(e => e.type === 'exception');
      assert.strictEqual(consoleErrors.length, 1);
    });

    it('should return network failures', () => {
      mockNetworkCapture.getNetworkFailures.mock.mockImplementation(() => [
        { type: 'network-failure', errorText: 'Connection refused' }
      ]);

      const critical = errorAggregator.getCriticalErrors();

      assert.strictEqual(critical.length, 1);
      assert.strictEqual(critical[0].type, 'network-failure');
    });

    it('should return only 5xx HTTP errors', () => {
      mockNetworkCapture.getHttpErrors.mock.mockImplementation(() => [
        { type: 'http-error', status: 500 },
        { type: 'http-error', status: 404 },
        { type: 'http-error', status: 502 }
      ]);

      const critical = errorAggregator.getCriticalErrors();

      assert.strictEqual(critical.length, 2);
      assert.ok(critical.every(e => e.status >= 500));
    });

    it('should combine all critical error types', () => {
      mockConsoleCapture.getErrors.mock.mockImplementation(() => [
        { type: 'exception', level: 'error', text: 'Exception' }
      ]);
      mockNetworkCapture.getNetworkFailures.mock.mockImplementation(() => [
        { type: 'network-failure', errorText: 'Failed' }
      ]);
      mockNetworkCapture.getHttpErrors.mock.mockImplementation(() => [
        { type: 'http-error', status: 500 }
      ]);

      const critical = errorAggregator.getCriticalErrors();

      assert.strictEqual(critical.length, 3);
    });
  });

  describe('formatReport', () => {
    it('should format empty report', () => {
      const report = errorAggregator.formatReport();

      assert.ok(report.includes('=== Error Report ==='));
      assert.ok(report.includes('No errors or warnings captured'));
    });

    it('should format console errors', () => {
      mockConsoleCapture.getErrors.mock.mockImplementation(() => [
        { level: 'error', text: 'Test error', url: 'http://test.com/app.js', line: 42 }
      ]);

      const report = errorAggregator.formatReport();

      assert.ok(report.includes('## Console Errors'));
      assert.ok(report.includes('[ERROR] Test error'));
      assert.ok(report.includes('at http://test.com/app.js:42'));
    });

    it('should format network failures', () => {
      mockNetworkCapture.getNetworkFailures.mock.mockImplementation(() => [
        { method: 'GET', url: 'http://test.com/api', errorText: 'Connection refused' }
      ]);

      const report = errorAggregator.formatReport();

      assert.ok(report.includes('## Network Failures'));
      assert.ok(report.includes('[FAILED] GET http://test.com/api'));
      assert.ok(report.includes('Error: Connection refused'));
    });

    it('should format HTTP errors', () => {
      mockNetworkCapture.getHttpErrors.mock.mockImplementation(() => [
        { status: 404, method: 'GET', url: 'http://test.com/notfound' }
      ]);

      const report = errorAggregator.formatReport();

      assert.ok(report.includes('## HTTP Errors'));
      assert.ok(report.includes('[404] GET http://test.com/notfound'));
    });

    it('should format console error without url', () => {
      mockConsoleCapture.getErrors.mock.mockImplementation(() => [
        { level: 'error', text: 'Test error' }
      ]);

      const report = errorAggregator.formatReport();

      assert.ok(report.includes('[ERROR] Test error'));
      assert.ok(!report.includes('at undefined'));
    });
  });

  describe('toJSON', () => {
    it('should export errors as JSON', () => {
      mockConsoleCapture.getErrors.mock.mockImplementation(() => [
        { level: 'error', text: 'Error', timestamp: 1000 }
      ]);
      mockNetworkCapture.getAllErrors.mock.mockImplementation(() => []);

      const json = errorAggregator.toJSON();

      assert.ok(json.timestamp);
      assert.ok(json.summary);
      assert.ok(Array.isArray(json.all));
    });

    it('should include ISO timestamp', () => {
      const json = errorAggregator.toJSON();

      assert.ok(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(json.timestamp));
    });

    it('should include full summary', () => {
      const json = errorAggregator.toJSON();

      assert.ok('hasErrors' in json.summary);
      assert.ok('hasWarnings' in json.summary);
      assert.ok('counts' in json.summary);
      assert.ok('errors' in json.summary);
    });
  });
});
