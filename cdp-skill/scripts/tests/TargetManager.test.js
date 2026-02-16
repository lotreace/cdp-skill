import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTargetManager } from '../cdp/index.js';

/**
 * Mock CDPConnection for testing
 */
function createMockConnection() {
  const eventListeners = new Map();

  return {
    eventListeners,
    sentCommands: [],

    on(event, callback) {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set());
      }
      eventListeners.get(event).add(callback);
    },

    off(event, callback) {
      const listeners = eventListeners.get(event);
      if (listeners) {
        listeners.delete(callback);
      }
    },

    async send(method, params = {}) {
      this.sentCommands.push({ method, params });

      // Return mock responses based on method
      switch (method) {
        case 'Target.setDiscoverTargets':
          return {};
        case 'Target.getTargets':
          return {
            targetInfos: [
              { targetId: 'target1', type: 'page', title: 'Test Page', url: 'https://example.com', attached: false },
              { targetId: 'target2', type: 'service_worker', title: 'SW', url: 'https://example.com/sw.js', attached: false }
            ]
          };
        case 'Target.createTarget':
          return { targetId: 'new-target-id' };
        case 'Target.closeTarget':
          return { success: true };
        case 'Target.activateTarget':
          return {};
        case 'Target.getTargetInfo':
          return {
            targetInfo: { targetId: params.targetId, type: 'page', title: 'Test', url: 'https://test.com', attached: true }
          };
        default:
          throw new Error(`Unknown method: ${method}`);
      }
    },

    // Helper to emit events for testing
    emit(event, params) {
      const listeners = eventListeners.get(event);
      if (listeners) {
        for (const callback of listeners) {
          callback(params);
        }
      }
    }
  };
}

describe('TargetManager', () => {
  let mockConnection;
  let targetManager;

  beforeEach(() => {
    mockConnection = createMockConnection();
    targetManager = createTargetManager(mockConnection);
  });

  describe('constructor', () => {
    it('should create instance with connection', () => {
      assert.ok(targetManager);
    });
  });

  describe('enableDiscovery', () => {
    it('should enable target discovery', async () => {
      await targetManager.enableDiscovery();

      const cmd = mockConnection.sentCommands.find(c => c.method === 'Target.setDiscoverTargets');
      assert.ok(cmd);
      assert.strictEqual(cmd.params.discover, true);
    });

    it('should register event listeners', async () => {
      await targetManager.enableDiscovery();

      assert.ok(mockConnection.eventListeners.has('Target.targetCreated'));
      assert.ok(mockConnection.eventListeners.has('Target.targetDestroyed'));
      assert.ok(mockConnection.eventListeners.has('Target.targetInfoChanged'));
    });

    it('should not enable twice', async () => {
      await targetManager.enableDiscovery();
      await targetManager.enableDiscovery();

      const cmds = mockConnection.sentCommands.filter(c => c.method === 'Target.setDiscoverTargets');
      assert.strictEqual(cmds.length, 1);
    });
  });

  describe('disableDiscovery', () => {
    it('should disable target discovery', async () => {
      await targetManager.enableDiscovery();
      await targetManager.disableDiscovery();

      const cmds = mockConnection.sentCommands.filter(c => c.method === 'Target.setDiscoverTargets');
      assert.strictEqual(cmds.length, 2);
      assert.strictEqual(cmds[1].params.discover, false);
    });

    it('should remove event listeners', async () => {
      await targetManager.enableDiscovery();
      await targetManager.disableDiscovery();

      // Listeners should be removed (sets should be empty)
      const createdListeners = mockConnection.eventListeners.get('Target.targetCreated');
      assert.strictEqual(createdListeners?.size || 0, 0);
    });

    it('should do nothing if not enabled', async () => {
      await targetManager.disableDiscovery();

      const cmds = mockConnection.sentCommands.filter(c => c.method === 'Target.setDiscoverTargets');
      assert.strictEqual(cmds.length, 0);
    });
  });

  describe('getTargets', () => {
    it('should return all targets', async () => {
      const targets = await targetManager.getTargets();

      assert.strictEqual(targets.length, 2);
      assert.strictEqual(targets[0].targetId, 'target1');
    });

    it('should update internal cache', async () => {
      await targetManager.getTargets();

      const cached = targetManager.getCachedTarget('target1');
      assert.ok(cached);
      assert.strictEqual(cached.type, 'page');
    });
  });

  describe('getPages', () => {
    it('should return only page targets', async () => {
      const pages = await targetManager.getPages();

      assert.strictEqual(pages.length, 1);
      assert.strictEqual(pages[0].type, 'page');
    });
  });

  describe('createTarget', () => {
    it('should create new target with default URL', async () => {
      const targetId = await targetManager.createTarget();

      assert.strictEqual(targetId, 'new-target-id');

      const cmd = mockConnection.sentCommands.find(c => c.method === 'Target.createTarget');
      assert.strictEqual(cmd.params.url, 'about:blank');
    });

    it('should create target with custom URL and options', async () => {
      await targetManager.createTarget('https://example.com', {
        width: 1920,
        height: 1080,
        background: true,
        newWindow: true
      });

      const cmd = mockConnection.sentCommands.find(c => c.method === 'Target.createTarget');
      assert.strictEqual(cmd.params.url, 'https://example.com');
      assert.strictEqual(cmd.params.width, 1920);
      assert.strictEqual(cmd.params.height, 1080);
      assert.strictEqual(cmd.params.background, true);
      assert.strictEqual(cmd.params.newWindow, true);
    });
  });

  describe('closeTarget', () => {
    it('should close target and remove from cache', async () => {
      await targetManager.getTargets(); // Populate cache
      const result = await targetManager.closeTarget('target1');

      assert.strictEqual(result, true);
      assert.strictEqual(targetManager.getCachedTarget('target1'), undefined);
    });
  });

  describe('activateTarget', () => {
    it('should send activate command', async () => {
      await targetManager.activateTarget('target1');

      const cmd = mockConnection.sentCommands.find(c => c.method === 'Target.activateTarget');
      assert.strictEqual(cmd.params.targetId, 'target1');
    });
  });

  describe('getTargetInfo', () => {
    it('should get target info and update cache', async () => {
      const info = await targetManager.getTargetInfo('target1');

      assert.strictEqual(info.targetId, 'target1');
      assert.strictEqual(targetManager.getCachedTarget('target1').type, 'page');
    });
  });

  describe('getCachedTargets', () => {
    it('should return copy of cached targets', async () => {
      await targetManager.getTargets();

      const cached = targetManager.getCachedTargets();
      assert.ok(cached instanceof Map);
      assert.strictEqual(cached.size, 2);
    });
  });

  describe('event handling', () => {
    it('should handle targetCreated event', async () => {
      await targetManager.enableDiscovery();

      mockConnection.emit('Target.targetCreated', {
        targetInfo: { targetId: 'new-target', type: 'page', title: 'New', url: 'https://new.com' }
      });

      const cached = targetManager.getCachedTarget('new-target');
      assert.ok(cached);
      assert.strictEqual(cached.title, 'New');
    });

    it('should handle targetDestroyed event', async () => {
      await targetManager.enableDiscovery();
      await targetManager.getTargets(); // Populate cache

      mockConnection.emit('Target.targetDestroyed', { targetId: 'target1' });

      assert.strictEqual(targetManager.getCachedTarget('target1'), undefined);
    });

    it('should handle targetInfoChanged event', async () => {
      await targetManager.enableDiscovery();
      await targetManager.getTargets(); // Populate cache

      mockConnection.emit('Target.targetInfoChanged', {
        targetInfo: { targetId: 'target1', type: 'page', title: 'Updated Title', url: 'https://updated.com' }
      });

      const cached = targetManager.getCachedTarget('target1');
      assert.strictEqual(cached.title, 'Updated Title');
    });
  });

  describe('cleanup', () => {
    it('should disable discovery and clear cache', async () => {
      await targetManager.enableDiscovery();
      await targetManager.getTargets();

      await targetManager.cleanup();

      assert.strictEqual(targetManager.getCachedTargets().size, 0);
    });
  });
});
