import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createNetworkCapture } from '../capture/index.js';

describe('NetworkErrorCapture', () => {
  let networkCapture;
  let mockCdp;
  let eventHandlers;

  beforeEach(() => {
    eventHandlers = {};
    mockCdp = {
      send: mock.fn(() => Promise.resolve()),
      on: mock.fn((event, handler) => {
        eventHandlers[event] = handler;
      }),
      off: mock.fn((event, handler) => {
        if (eventHandlers[event] === handler) {
          delete eventHandlers[event];
        }
      })
    };
    networkCapture = createNetworkCapture(mockCdp);
  });

  afterEach(() => {
    mock.reset();
  });

  describe('startCapture', () => {
    it('should enable Network domain', async () => {
      await networkCapture.startCapture();

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[0], 'Network.enable');
    });

    it('should register event handlers', async () => {
      await networkCapture.startCapture();

      assert.strictEqual(mockCdp.on.mock.calls.length, 4);
      assert.ok(eventHandlers['Network.requestWillBeSent']);
      assert.ok(eventHandlers['Network.loadingFailed']);
      assert.ok(eventHandlers['Network.responseReceived']);
      assert.ok(eventHandlers['Network.loadingFinished']);
    });

    it('should not start capturing twice', async () => {
      await networkCapture.startCapture();
      await networkCapture.startCapture();

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
    });
  });

  describe('stopCapture', () => {
    it('should disable Network domain', async () => {
      await networkCapture.startCapture();
      await networkCapture.stopCapture();

      assert.ok(mockCdp.send.mock.calls.some(c => c.arguments[0] === 'Network.disable'));
    });

    it('should unregister event handlers', async () => {
      await networkCapture.startCapture();
      await networkCapture.stopCapture();

      assert.strictEqual(mockCdp.off.mock.calls.length, 4);
    });

    it('should do nothing if not capturing', async () => {
      await networkCapture.stopCapture();

      assert.strictEqual(mockCdp.send.mock.calls.length, 0);
    });
  });

  describe('network failures', () => {
    it('should capture loading failures', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.requestWillBeSent']({
        requestId: 'req-1',
        request: { url: 'http://test.com/api', method: 'GET' },
        timestamp: 1000,
        type: 'XHR'
      });

      eventHandlers['Network.loadingFailed']({
        requestId: 'req-1',
        type: 'XHR',
        errorText: 'net::ERR_CONNECTION_REFUSED',
        timestamp: 1001
      });

      const failures = networkCapture.getNetworkFailures();
      assert.strictEqual(failures.length, 1);
      assert.strictEqual(failures[0].type, 'network-failure');
      assert.strictEqual(failures[0].url, 'http://test.com/api');
      assert.strictEqual(failures[0].method, 'GET');
      assert.strictEqual(failures[0].errorText, 'net::ERR_CONNECTION_REFUSED');
    });

    it('should handle unknown request in loading failure', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.loadingFailed']({
        requestId: 'unknown-req',
        type: 'Script',
        errorText: 'net::ERR_NAME_NOT_RESOLVED',
        timestamp: 1000
      });

      const failures = networkCapture.getNetworkFailures();
      assert.strictEqual(failures.length, 1);
      assert.strictEqual(failures[0].url, 'unknown');
      assert.strictEqual(failures[0].method, 'unknown');
    });

    it('should capture canceled requests', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.requestWillBeSent']({
        requestId: 'req-1',
        request: { url: 'http://test.com/slow', method: 'GET' },
        timestamp: 1000,
        type: 'XHR'
      });

      eventHandlers['Network.loadingFailed']({
        requestId: 'req-1',
        type: 'XHR',
        errorText: 'net::ERR_ABORTED',
        canceled: true,
        timestamp: 1001
      });

      const failures = networkCapture.getNetworkFailures();
      assert.strictEqual(failures[0].canceled, true);
    });
  });

  describe('HTTP errors', () => {
    it('should capture 4xx errors', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.requestWillBeSent']({
        requestId: 'req-1',
        request: { url: 'http://test.com/notfound', method: 'GET' },
        timestamp: 1000,
        type: 'Document'
      });

      eventHandlers['Network.responseReceived']({
        requestId: 'req-1',
        response: {
          url: 'http://test.com/notfound',
          status: 404,
          statusText: 'Not Found',
          mimeType: 'text/html'
        },
        type: 'Document',
        timestamp: 1001
      });

      const httpErrors = networkCapture.getHttpErrors();
      assert.strictEqual(httpErrors.length, 1);
      assert.strictEqual(httpErrors[0].type, 'http-error');
      assert.strictEqual(httpErrors[0].status, 404);
      assert.strictEqual(httpErrors[0].statusText, 'Not Found');
    });

    it('should capture 5xx errors', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.requestWillBeSent']({
        requestId: 'req-1',
        request: { url: 'http://test.com/api', method: 'POST' },
        timestamp: 1000,
        type: 'XHR'
      });

      eventHandlers['Network.responseReceived']({
        requestId: 'req-1',
        response: {
          url: 'http://test.com/api',
          status: 500,
          statusText: 'Internal Server Error',
          mimeType: 'application/json'
        },
        type: 'XHR',
        timestamp: 1001
      });

      const httpErrors = networkCapture.getHttpErrors();
      assert.strictEqual(httpErrors.length, 1);
      assert.strictEqual(httpErrors[0].status, 500);
    });

    it('should not capture successful responses', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.requestWillBeSent']({
        requestId: 'req-1',
        request: { url: 'http://test.com/ok', method: 'GET' },
        timestamp: 1000,
        type: 'Document'
      });

      eventHandlers['Network.responseReceived']({
        requestId: 'req-1',
        response: {
          url: 'http://test.com/ok',
          status: 200,
          statusText: 'OK',
          mimeType: 'text/html'
        },
        type: 'Document',
        timestamp: 1001
      });

      const httpErrors = networkCapture.getHttpErrors();
      assert.strictEqual(httpErrors.length, 0);
    });

    it('should not capture HTTP errors when disabled', async () => {
      await networkCapture.startCapture({ captureHttpErrors: false });

      eventHandlers['Network.responseReceived']({
        requestId: 'req-1',
        response: {
          url: 'http://test.com/notfound',
          status: 404,
          statusText: 'Not Found',
          mimeType: 'text/html'
        },
        type: 'Document',
        timestamp: 1001
      });

      const httpErrors = networkCapture.getHttpErrors();
      assert.strictEqual(httpErrors.length, 0);
    });

    it('should ignore specified status codes', async () => {
      await networkCapture.startCapture({ ignoreStatusCodes: [404] });

      eventHandlers['Network.responseReceived']({
        requestId: 'req-1',
        response: {
          url: 'http://test.com/notfound',
          status: 404,
          statusText: 'Not Found',
          mimeType: 'text/html'
        },
        type: 'Document',
        timestamp: 1000
      });

      eventHandlers['Network.responseReceived']({
        requestId: 'req-2',
        response: {
          url: 'http://test.com/error',
          status: 500,
          statusText: 'Internal Server Error',
          mimeType: 'text/html'
        },
        type: 'Document',
        timestamp: 1001
      });

      const httpErrors = networkCapture.getHttpErrors();
      assert.strictEqual(httpErrors.length, 1);
      assert.strictEqual(httpErrors[0].status, 500);
    });
  });

  describe('getAllErrors', () => {
    it('should combine and sort all errors', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.responseReceived']({
        requestId: 'req-1',
        response: { url: 'http://test.com/a', status: 404, statusText: 'Not Found', mimeType: 'text/html' },
        type: 'Document',
        timestamp: 3000
      });

      eventHandlers['Network.loadingFailed']({
        requestId: 'req-2',
        type: 'Script',
        errorText: 'Failed',
        timestamp: 1000
      });

      eventHandlers['Network.responseReceived']({
        requestId: 'req-3',
        response: { url: 'http://test.com/b', status: 500, statusText: 'Error', mimeType: 'text/html' },
        type: 'Document',
        timestamp: 2000
      });

      const allErrors = networkCapture.getAllErrors();
      assert.strictEqual(allErrors.length, 3);
      assert.strictEqual(allErrors[0].timestamp, 1000);
      assert.strictEqual(allErrors[1].timestamp, 2000);
      assert.strictEqual(allErrors[2].timestamp, 3000);
    });
  });

  describe('hasErrors', () => {
    it('should return false when no errors', async () => {
      await networkCapture.startCapture();
      assert.strictEqual(networkCapture.hasErrors(), false);
    });

    it('should return true when network failures exist', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.loadingFailed']({
        requestId: 'req-1',
        type: 'Script',
        errorText: 'Failed',
        timestamp: 1000
      });

      assert.strictEqual(networkCapture.hasErrors(), true);
    });

    it('should return true when HTTP errors exist', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.responseReceived']({
        requestId: 'req-1',
        response: { url: 'http://test.com/a', status: 404, statusText: 'Not Found', mimeType: 'text/html' },
        type: 'Document',
        timestamp: 1000
      });

      assert.strictEqual(networkCapture.hasErrors(), true);
    });
  });

  describe('getErrorsByType', () => {
    it('should filter errors by resource type', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.loadingFailed']({
        requestId: 'req-1',
        type: 'Script',
        errorText: 'Script failed',
        timestamp: 1000
      });

      eventHandlers['Network.loadingFailed']({
        requestId: 'req-2',
        type: 'Document',
        errorText: 'Document failed',
        timestamp: 1001
      });

      const scriptErrors = networkCapture.getErrorsByType('Script');
      assert.strictEqual(scriptErrors.length, 1);
      assert.strictEqual(scriptErrors[0].resourceType, 'Script');
    });

    it('should filter by multiple types', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.loadingFailed']({
        requestId: 'req-1',
        type: 'Script',
        errorText: 'Failed',
        timestamp: 1000
      });

      eventHandlers['Network.loadingFailed']({
        requestId: 'req-2',
        type: 'Stylesheet',
        errorText: 'Failed',
        timestamp: 1001
      });

      eventHandlers['Network.loadingFailed']({
        requestId: 'req-3',
        type: 'Image',
        errorText: 'Failed',
        timestamp: 1002
      });

      const filtered = networkCapture.getErrorsByType(['Script', 'Stylesheet']);
      assert.strictEqual(filtered.length, 2);
    });
  });

  describe('clear', () => {
    it('should clear all errors and requests', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.requestWillBeSent']({
        requestId: 'req-1',
        request: { url: 'http://test.com/api', method: 'GET' },
        timestamp: 1000,
        type: 'XHR'
      });

      eventHandlers['Network.loadingFailed']({
        requestId: 'req-1',
        type: 'XHR',
        errorText: 'Failed',
        timestamp: 1001
      });

      eventHandlers['Network.responseReceived']({
        requestId: 'req-2',
        response: { url: 'http://test.com/error', status: 500, statusText: 'Error', mimeType: 'text/html' },
        type: 'Document',
        timestamp: 1002
      });

      assert.strictEqual(networkCapture.getNetworkFailures().length, 1);
      assert.strictEqual(networkCapture.getHttpErrors().length, 1);

      networkCapture.clear();

      assert.strictEqual(networkCapture.getNetworkFailures().length, 0);
      assert.strictEqual(networkCapture.getHttpErrors().length, 0);
    });
  });

  describe('request cleanup', () => {
    it('should clean up requests on loading finished', async () => {
      await networkCapture.startCapture();

      eventHandlers['Network.requestWillBeSent']({
        requestId: 'req-1',
        request: { url: 'http://test.com/api', method: 'GET' },
        timestamp: 1000,
        type: 'XHR'
      });

      eventHandlers['Network.loadingFinished']({
        requestId: 'req-1',
        timestamp: 1001
      });

      eventHandlers['Network.loadingFailed']({
        requestId: 'req-1',
        type: 'XHR',
        errorText: 'Failed',
        timestamp: 1002
      });

      const failures = networkCapture.getNetworkFailures();
      assert.strictEqual(failures[0].url, 'unknown');
    });
  });
});
