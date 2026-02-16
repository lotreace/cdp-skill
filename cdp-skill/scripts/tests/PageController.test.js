import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createPageController, WaitCondition } from '../page/index.js';
import { ErrorTypes } from '../utils.js';

describe('PageController', () => {
  let mockClient;
  let controller;
  let eventHandlers;

  beforeEach(() => {
    eventHandlers = {};
    mockClient = {
      send: mock.fn(),
      on: mock.fn((event, handler) => {
        if (!eventHandlers[event]) {
          eventHandlers[event] = [];
        }
        eventHandlers[event].push(handler);
      }),
      off: mock.fn((event, handler) => {
        if (eventHandlers[event]) {
          eventHandlers[event] = eventHandlers[event].filter(h => h !== handler);
        }
      })
    };
    controller = createPageController(mockClient);
  });

  afterEach(() => {
    if (controller) {
      controller.dispose();
    }
  });

  const emitEvent = (event, data) => {
    if (eventHandlers[event]) {
      eventHandlers[event].forEach(handler => handler(data));
    }
  };

  describe('initialize', () => {
    it('should enable required CDP domains', async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame-id' } } };
        }
        return {};
      });

      await controller.initialize();

      const calls = mockClient.send.mock.calls;
      const methods = calls.map(c => c.arguments[0]);

      assert.ok(methods.includes('Page.enable'));
      assert.ok(methods.includes('Page.setLifecycleEventsEnabled'));
      assert.ok(methods.includes('Network.enable'));
      assert.ok(methods.includes('Runtime.enable'));
      assert.ok(methods.includes('Page.getFrameTree'));
    });

    it('should set up event listeners', async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame-id' } } };
        }
        return {};
      });

      await controller.initialize();

      const events = mockClient.on.mock.calls.map(c => c.arguments[0]);
      assert.ok(events.includes('Page.lifecycleEvent'));
      assert.ok(events.includes('Page.frameNavigated'));
      assert.ok(events.includes('Network.requestWillBeSent'));
      assert.ok(events.includes('Network.loadingFinished'));
      assert.ok(events.includes('Network.loadingFailed'));
    });

    it('should store the main frame ID', async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'test-frame-123' } } };
        }
        return {};
      });

      await controller.initialize();

      assert.strictEqual(controller.mainFrameId, 'test-frame-123');
    });
  });

  describe('navigate', () => {
    beforeEach(async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        if (method === 'Page.navigate') {
          return { frameId: 'main-frame', loaderId: 'loader-1' };
        }
        return {};
      });
      await controller.initialize();
    });

    it('should navigate to URL and return navigation info', async () => {
      const navigatePromise = controller.navigate('https://example.com', {
        waitUntil: WaitCondition.COMMIT
      });

      const result = await navigatePromise;

      assert.strictEqual(result.url, 'https://example.com');
      assert.strictEqual(result.frameId, 'main-frame');
      assert.strictEqual(result.loaderId, 'loader-1');
    });

    it('should wait for load event by default', async () => {
      const navigatePromise = controller.navigate('https://example.com');

      // Simulate load event after short delay
      setTimeout(() => {
        emitEvent('Page.lifecycleEvent', { frameId: 'main-frame', name: 'load' });
      }, 10);

      const result = await navigatePromise;
      assert.strictEqual(result.url, 'https://example.com');
    });

    it('should wait for DOMContentLoaded when specified', async () => {
      const navigatePromise = controller.navigate('https://example.com', {
        waitUntil: WaitCondition.DOM_CONTENT_LOADED
      });

      setTimeout(() => {
        emitEvent('Page.lifecycleEvent', { frameId: 'main-frame', name: 'DOMContentLoaded' });
      }, 10);

      await navigatePromise;
    });

    it('should throw NavigationError on navigation failure', async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.navigate') {
          return { errorText: 'net::ERR_NAME_NOT_RESOLVED' };
        }
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        return {};
      });

      await assert.rejects(
        controller.navigate('https://invalid.url', { waitUntil: WaitCondition.COMMIT }),
        (err) => {
          assert.strictEqual(err.name, ErrorTypes.NAVIGATION);
          assert.strictEqual(err.url, 'https://invalid.url');
          return true;
        }
      );
    });

    it('should throw NavigationError when CDP send fails', async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.navigate') {
          throw new Error('Connection failed');
        }
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        return {};
      });

      await assert.rejects(
        controller.navigate('https://example.com', { waitUntil: WaitCondition.COMMIT }),
        (err) => err.name === ErrorTypes.NAVIGATION
      );
    });

    it('should timeout when wait condition not met', async () => {
      await assert.rejects(
        controller.navigate('https://example.com', {
          waitUntil: WaitCondition.LOAD,
          timeout: 50
        }),
        (err) => err.name === ErrorTypes.TIMEOUT
      );
    });

    it('should pass referrer when provided', async () => {
      const navigatePromise = controller.navigate('https://example.com', {
        waitUntil: WaitCondition.COMMIT,
        referrer: 'https://referrer.com'
      });

      await navigatePromise;

      const navigateCall = mockClient.send.mock.calls.find(
        c => c.arguments[0] === 'Page.navigate'
      );
      assert.strictEqual(navigateCall.arguments[1].referrer, 'https://referrer.com');
    });
  });

  describe('reload', () => {
    beforeEach(async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        return {};
      });
      await controller.initialize();
    });

    it('should reload the page', async () => {
      const reloadPromise = controller.reload({ waitUntil: WaitCondition.COMMIT });

      await reloadPromise;

      const reloadCall = mockClient.send.mock.calls.find(
        c => c.arguments[0] === 'Page.reload'
      );
      assert.ok(reloadCall);
    });

    it('should respect ignoreCache option', async () => {
      const reloadPromise = controller.reload({
        ignoreCache: true,
        waitUntil: WaitCondition.COMMIT
      });

      await reloadPromise;

      const reloadCall = mockClient.send.mock.calls.find(
        c => c.arguments[0] === 'Page.reload'
      );
      assert.strictEqual(reloadCall.arguments[1].ignoreCache, true);
    });
  });

  describe('goBack and goForward', () => {
    beforeEach(async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        if (method === 'Page.getNavigationHistory') {
          return {
            currentIndex: 1,
            entries: [
              { id: 0, url: 'https://first.com' },
              { id: 1, url: 'https://second.com' },
              { id: 2, url: 'https://third.com' }
            ]
          };
        }
        return {};
      });
      await controller.initialize();
    });

    it('should navigate back in history', async () => {
      const backPromise = controller.goBack({ waitUntil: WaitCondition.COMMIT });

      const result = await backPromise;

      assert.strictEqual(result.url, 'https://first.com');
    });

    it('should navigate forward in history', async () => {
      const forwardPromise = controller.goForward({ waitUntil: WaitCondition.COMMIT });

      const result = await forwardPromise;

      assert.strictEqual(result.url, 'https://third.com');
    });

    it('should return null when no back history', async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        if (method === 'Page.getNavigationHistory') {
          return {
            currentIndex: 0,
            entries: [{ id: 0, url: 'https://only.com' }]
          };
        }
        return {};
      });

      const result = await controller.goBack();
      assert.strictEqual(result, null);
    });

    it('should return null when no forward history', async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        if (method === 'Page.getNavigationHistory') {
          return {
            currentIndex: 0,
            entries: [{ id: 0, url: 'https://only.com' }]
          };
        }
        return {};
      });

      const result = await controller.goForward();
      assert.strictEqual(result, null);
    });
  });

  describe('stopLoading', () => {
    beforeEach(async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        return {};
      });
      await controller.initialize();
    });

    it('should call Page.stopLoading', async () => {
      await controller.stopLoading();

      const stopCall = mockClient.send.mock.calls.find(
        c => c.arguments[0] === 'Page.stopLoading'
      );
      assert.ok(stopCall);
    });
  });

  describe('getUrl and getTitle', () => {
    beforeEach(async () => {
      mockClient.send.mock.mockImplementation(async (method, params) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        if (method === 'Runtime.evaluate') {
          if (params.expression === 'window.location.href') {
            return { result: { value: 'https://current.url' } };
          }
          if (params.expression === 'document.title') {
            return { result: { value: 'Page Title' } };
          }
        }
        return {};
      });
      await controller.initialize();
    });

    it('should return current URL', async () => {
      const url = await controller.getUrl();
      assert.strictEqual(url, 'https://current.url');
    });

    it('should return current title', async () => {
      const title = await controller.getTitle();
      assert.strictEqual(title, 'Page Title');
    });
  });

  describe('lifecycle events', () => {
    beforeEach(async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        if (method === 'Page.navigate') {
          return { frameId: 'main-frame', loaderId: 'loader-1' };
        }
        return {};
      });
      await controller.initialize();
    });

    it('should track lifecycle events per frame', async () => {
      const navigatePromise = controller.navigate('https://example.com', {
        waitUntil: WaitCondition.LOAD,
        timeout: 1000
      });

      emitEvent('Page.lifecycleEvent', { frameId: 'main-frame', name: 'DOMContentLoaded' });
      emitEvent('Page.lifecycleEvent', { frameId: 'main-frame', name: 'load' });

      await navigatePromise;
    });

    it('should update main frame ID on frameNavigated', async () => {
      emitEvent('Page.frameNavigated', { frame: { id: 'new-main-frame' } });
      assert.strictEqual(controller.mainFrameId, 'new-main-frame');
    });

    it('should not update main frame ID for child frames', async () => {
      emitEvent('Page.frameNavigated', { frame: { id: 'child-frame', parentId: 'main-frame' } });
      assert.strictEqual(controller.mainFrameId, 'main-frame');
    });
  });

  describe('network idle', () => {
    beforeEach(async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        if (method === 'Page.navigate') {
          return { frameId: 'main-frame', loaderId: 'loader-1' };
        }
        return {};
      });
      await controller.initialize();
    });

    it('should wait for network idle', async () => {
      const navigatePromise = controller.navigate('https://example.com', {
        waitUntil: WaitCondition.NETWORK_IDLE,
        timeout: 2000
      });

      // Simulate page load
      emitEvent('Page.lifecycleEvent', { frameId: 'main-frame', name: 'load' });

      // Network is already idle (no pending requests), should resolve
      await navigatePromise;
    });

    it('should track pending requests', async () => {
      const navigatePromise = controller.navigate('https://example.com', {
        waitUntil: WaitCondition.NETWORK_IDLE,
        timeout: 2000
      });

      // Simulate request flow
      emitEvent('Network.requestWillBeSent', { requestId: 'req-1' });
      emitEvent('Network.loadingFinished', { requestId: 'req-1' });
      emitEvent('Page.lifecycleEvent', { frameId: 'main-frame', name: 'load' });

      await navigatePromise;
    });
  });

  describe('dispose', () => {
    beforeEach(async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        return {};
      });
      await controller.initialize();
    });

    it('should remove all event listeners', () => {
      const initialOffCalls = mockClient.off.mock.calls.length;

      controller.dispose();

      assert.ok(mockClient.off.mock.calls.length > initialOffCalls);
    });

    it('should clear lifecycle waiters', async () => {
      // Start a navigation that will wait
      const navigatePromise = controller.navigate('https://example.com', {
        waitUntil: WaitCondition.LOAD,
        timeout: 5000
      }).catch(() => {});

      // Dispose immediately
      controller.dispose();

      // The promise should eventually resolve/reject but the waiter should be cleared
      // We just verify dispose doesn't throw
    });
  });

  describe('edge cases', () => {
    beforeEach(async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        if (method === 'Page.navigate') {
          return { frameId: 'main-frame', loaderId: 'loader-1' };
        }
        return {};
      });
      await controller.initialize();
    });

    describe('navigate edge cases', () => {
      it('should throw NavigationError on empty URL', async () => {
        await assert.rejects(
          controller.navigate('', { waitUntil: WaitCondition.COMMIT }),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.NAVIGATION);
            assert.ok(err.message.includes('URL must be a non-empty string'));
            return true;
          }
        );
      });

      it('should throw NavigationError on null URL', async () => {
        await assert.rejects(
          controller.navigate(null, { waitUntil: WaitCondition.COMMIT }),
          (err) => err.name === ErrorTypes.NAVIGATION
        );
      });

      it('should clamp very long timeout to max', async () => {
        const navigatePromise = controller.navigate('https://example.com', {
          waitUntil: WaitCondition.COMMIT,
          timeout: 999999999
        });

        const result = await navigatePromise;
        assert.strictEqual(result.url, 'https://example.com');
      });

      it('should handle negative timeout', async () => {
        // With timeout 0, it should succeed immediately for COMMIT
        const result = await controller.navigate('https://example.com', {
          waitUntil: WaitCondition.COMMIT,
          timeout: -100
        });
        assert.strictEqual(result.url, 'https://example.com');
      });

      it('should handle non-finite timeout', async () => {
        const result = await controller.navigate('https://example.com', {
          waitUntil: WaitCondition.COMMIT,
          timeout: NaN
        });
        assert.strictEqual(result.url, 'https://example.com');
      });
    });

    describe('reload edge cases', () => {
      it('should throw CDPConnectionError when connection drops', async () => {
        mockClient.send.mock.mockImplementation(async (method) => {
          if (method === 'Page.getFrameTree') {
            return { frameTree: { frame: { id: 'main-frame' } } };
          }
          if (method === 'Page.reload') {
            throw new Error('WebSocket closed');
          }
          return {};
        });

        await assert.rejects(
          controller.reload({ waitUntil: WaitCondition.COMMIT }),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.CONNECTION);
            assert.ok(err.message.includes('WebSocket closed'));
            return true;
          }
        );
      });
    });

    describe('stopLoading edge cases', () => {
      it('should throw CDPConnectionError when connection drops', async () => {
        mockClient.send.mock.mockImplementation(async (method) => {
          if (method === 'Page.getFrameTree') {
            return { frameTree: { frame: { id: 'main-frame' } } };
          }
          if (method === 'Page.stopLoading') {
            throw new Error('Connection reset');
          }
          return {};
        });

        await assert.rejects(
          controller.stopLoading(),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.CONNECTION);
            return true;
          }
        );
      });
    });

    describe('getUrl edge cases', () => {
      it('should throw CDPConnectionError when connection drops', async () => {
        mockClient.send.mock.mockImplementation(async (method) => {
          if (method === 'Page.getFrameTree') {
            return { frameTree: { frame: { id: 'main-frame' } } };
          }
          if (method === 'Runtime.evaluate') {
            throw new Error('Connection lost');
          }
          return {};
        });

        await assert.rejects(
          controller.getUrl(),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.CONNECTION);
            return true;
          }
        );
      });
    });

    describe('getTitle edge cases', () => {
      it('should throw CDPConnectionError when connection drops', async () => {
        mockClient.send.mock.mockImplementation(async (method) => {
          if (method === 'Page.getFrameTree') {
            return { frameTree: { frame: { id: 'main-frame' } } };
          }
          if (method === 'Runtime.evaluate') {
            throw new Error('Socket closed');
          }
          return {};
        });

        await assert.rejects(
          controller.getTitle(),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.CONNECTION);
            return true;
          }
        );
      });
    });

    describe('goBack/goForward edge cases', () => {
      it('should throw CDPConnectionError when getNavigationHistory fails', async () => {
        mockClient.send.mock.mockImplementation(async (method) => {
          if (method === 'Page.getFrameTree') {
            return { frameTree: { frame: { id: 'main-frame' } } };
          }
          if (method === 'Page.getNavigationHistory') {
            throw new Error('Connection dropped');
          }
          return {};
        });

        await assert.rejects(
          controller.goBack(),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.CONNECTION);
            return true;
          }
        );
      });

      it('should throw CDPConnectionError when navigateToHistoryEntry fails', async () => {
        mockClient.send.mock.mockImplementation(async (method) => {
          if (method === 'Page.getFrameTree') {
            return { frameTree: { frame: { id: 'main-frame' } } };
          }
          if (method === 'Page.getNavigationHistory') {
            return {
              currentIndex: 1,
              entries: [
                { id: 0, url: 'https://first.com' },
                { id: 1, url: 'https://second.com' }
              ]
            };
          }
          if (method === 'Page.navigateToHistoryEntry') {
            throw new Error('Navigation failed');
          }
          return {};
        });

        await assert.rejects(
          controller.goBack({ waitUntil: WaitCondition.COMMIT }),
          (err) => {
            assert.strictEqual(err.name, ErrorTypes.CONNECTION);
            return true;
          }
        );
      });
    });
  });

  describe('navigation abort handling', () => {
    beforeEach(async () => {
      mockClient.send.mock.mockImplementation(async (method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        if (method === 'Page.navigate') {
          return { frameId: 'main-frame', loaderId: 'loader-1' };
        }
        return {};
      });
      await controller.initialize();
    });

    it('should abort previous navigation when new navigation starts', async () => {
      // Start first navigation that will wait for load
      const firstNav = controller.navigate('https://first.com', {
        waitUntil: WaitCondition.LOAD,
        timeout: 5000
      });

      // Start second navigation immediately - should abort first
      const secondNav = controller.navigate('https://second.com', {
        waitUntil: WaitCondition.COMMIT
      });

      // First navigation should be aborted
      await assert.rejects(
        firstNav,
        (err) => {
          assert.strictEqual(err.name, ErrorTypes.NAVIGATION_ABORTED);
          assert.ok(err.message.includes('superseded'));
          assert.strictEqual(err.url, 'https://first.com');
          return true;
        }
      );

      // Second navigation should succeed
      const result = await secondNav;
      assert.strictEqual(result.url, 'https://second.com');
    });

    it('should abort navigation when stopLoading is called', async () => {
      // Start navigation that will wait for load
      const navPromise = controller.navigate('https://example.com', {
        waitUntil: WaitCondition.LOAD,
        timeout: 5000
      });

      // Call stopLoading after a short delay
      setTimeout(async () => {
        await controller.stopLoading();
      }, 10);

      // Navigation should be aborted
      await assert.rejects(
        navPromise,
        (err) => {
          assert.strictEqual(err.name, ErrorTypes.NAVIGATION_ABORTED);
          assert.ok(err.message.includes('stopped'));
          assert.strictEqual(err.url, 'https://example.com');
          return true;
        }
      );
    });

    it('should not affect navigation that has already completed', async () => {
      // Start navigation with COMMIT (immediate completion)
      const result = await controller.navigate('https://example.com', {
        waitUntil: WaitCondition.COMMIT
      });

      assert.strictEqual(result.url, 'https://example.com');

      // stopLoading after navigation completes should not throw
      await controller.stopLoading();
    });

    it('should properly clean up abort state after navigation completes', async () => {
      // First navigation
      await controller.navigate('https://first.com', {
        waitUntil: WaitCondition.COMMIT
      });

      // Second navigation should not be affected by first
      const result = await controller.navigate('https://second.com', {
        waitUntil: WaitCondition.COMMIT
      });

      assert.strictEqual(result.url, 'https://second.com');
    });

    it('should handle multiple rapid navigation cancellations', async () => {
      // Start three navigations in quick succession
      const nav1 = controller.navigate('https://first.com', {
        waitUntil: WaitCondition.LOAD,
        timeout: 5000
      });

      const nav2 = controller.navigate('https://second.com', {
        waitUntil: WaitCondition.LOAD,
        timeout: 5000
      });

      const nav3 = controller.navigate('https://third.com', {
        waitUntil: WaitCondition.COMMIT
      });

      // First two should be aborted
      await assert.rejects(nav1, (err) => err.name === ErrorTypes.NAVIGATION_ABORTED);
      await assert.rejects(nav2, (err) => err.name === ErrorTypes.NAVIGATION_ABORTED);

      // Third should succeed
      const result = await nav3;
      assert.strictEqual(result.url, 'https://third.com');
    });

    it('should include correct URL in abort error', async () => {
      const nav = controller.navigate('https://specific-url.com/path?query=1', {
        waitUntil: WaitCondition.LOAD,
        timeout: 5000
      });

      // Abort with new navigation
      controller.navigate('https://new.com', { waitUntil: WaitCondition.COMMIT });

      await assert.rejects(
        nav,
        (err) => {
          assert.strictEqual(err.name, ErrorTypes.NAVIGATION_ABORTED);
          assert.strictEqual(err.url, 'https://specific-url.com/path?query=1');
          assert.ok(err.originalMessage.includes('superseded'));
          return true;
        }
      );
    });
  });
});
