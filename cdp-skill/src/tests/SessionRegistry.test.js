import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createSessionRegistry } from '../cdp.js';

/**
 * Mock CDPConnection for testing
 */
function createMockConnection() {
  const eventListeners = new Map();
  let sessionCounter = 0;

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

      switch (method) {
        case 'Target.attachToTarget':
          sessionCounter++;
          return { sessionId: `session-${sessionCounter}` };
        case 'Target.detachFromTarget':
          return {};
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

describe('SessionRegistry', () => {
  let mockConnection;
  let sessionRegistry;

  beforeEach(() => {
    mockConnection = createMockConnection();
    sessionRegistry = createSessionRegistry(mockConnection);
  });

  describe('constructor', () => {
    it('should create instance and register event listeners', () => {
      assert.ok(sessionRegistry);
      assert.ok(mockConnection.eventListeners.has('Target.attachedToTarget'));
      assert.ok(mockConnection.eventListeners.has('Target.detachedFromTarget'));
      assert.ok(mockConnection.eventListeners.has('Target.targetDestroyed'));
    });
  });

  describe('attach', () => {
    it('should attach to target and return sessionId', async () => {
      const sessionId = await sessionRegistry.attach('target-1');

      assert.strictEqual(sessionId, 'session-1');

      const cmd = mockConnection.sentCommands.find(c => c.method === 'Target.attachToTarget');
      assert.strictEqual(cmd.params.targetId, 'target-1');
      assert.strictEqual(cmd.params.flatten, true);
    });

    it('should return existing sessionId if already attached', async () => {
      const sessionId1 = await sessionRegistry.attach('target-1');
      const sessionId2 = await sessionRegistry.attach('target-1');

      assert.strictEqual(sessionId1, sessionId2);

      const cmds = mockConnection.sentCommands.filter(c => c.method === 'Target.attachToTarget');
      assert.strictEqual(cmds.length, 1);
    });

    it('should track session and target mappings', async () => {
      await sessionRegistry.attach('target-1');

      assert.strictEqual(sessionRegistry.getSessionForTarget('target-1'), 'session-1');
      assert.strictEqual(sessionRegistry.getTargetForSession('session-1'), 'target-1');
    });
  });

  describe('detach', () => {
    it('should detach from session', async () => {
      const sessionId = await sessionRegistry.attach('target-1');
      await sessionRegistry.detach(sessionId);

      const cmd = mockConnection.sentCommands.find(c => c.method === 'Target.detachFromTarget');
      assert.strictEqual(cmd.params.sessionId, sessionId);
    });

    it('should clear session and target mappings', async () => {
      const sessionId = await sessionRegistry.attach('target-1');
      await sessionRegistry.detach(sessionId);

      assert.strictEqual(sessionRegistry.getSessionForTarget('target-1'), undefined);
      assert.strictEqual(sessionRegistry.getTargetForSession(sessionId), undefined);
    });

    it('should do nothing for unknown session', async () => {
      await sessionRegistry.detach('unknown-session');

      const cmds = mockConnection.sentCommands.filter(c => c.method === 'Target.detachFromTarget');
      assert.strictEqual(cmds.length, 0);
    });
  });

  describe('detachByTarget', () => {
    it('should detach by targetId', async () => {
      await sessionRegistry.attach('target-1');
      await sessionRegistry.detachByTarget('target-1');

      assert.strictEqual(sessionRegistry.isAttached('target-1'), false);
    });

    it('should do nothing for unknown target', async () => {
      await sessionRegistry.detachByTarget('unknown-target');

      const cmds = mockConnection.sentCommands.filter(c => c.method === 'Target.detachFromTarget');
      assert.strictEqual(cmds.length, 0);
    });
  });

  describe('isAttached', () => {
    it('should return true for attached target', async () => {
      await sessionRegistry.attach('target-1');

      assert.strictEqual(sessionRegistry.isAttached('target-1'), true);
    });

    it('should return false for unattached target', () => {
      assert.strictEqual(sessionRegistry.isAttached('target-1'), false);
    });
  });

  describe('getAllSessions', () => {
    it('should return all active sessions', async () => {
      await sessionRegistry.attach('target-1');
      await sessionRegistry.attach('target-2');

      const sessions = sessionRegistry.getAllSessions();

      assert.strictEqual(sessions.length, 2);
      assert.ok(sessions.some(s => s.targetId === 'target-1'));
      assert.ok(sessions.some(s => s.targetId === 'target-2'));
    });

    it('should return empty array when no sessions', () => {
      const sessions = sessionRegistry.getAllSessions();
      assert.strictEqual(sessions.length, 0);
    });
  });

  describe('detachAll', () => {
    it('should detach all sessions', async () => {
      await sessionRegistry.attach('target-1');
      await sessionRegistry.attach('target-2');

      await sessionRegistry.detachAll();

      assert.strictEqual(sessionRegistry.getAllSessions().length, 0);

      const cmds = mockConnection.sentCommands.filter(c => c.method === 'Target.detachFromTarget');
      assert.strictEqual(cmds.length, 2);
    });
  });

  describe('event handling', () => {
    it('should handle attachedToTarget event', () => {
      mockConnection.emit('Target.attachedToTarget', {
        sessionId: 'external-session',
        targetInfo: { targetId: 'external-target' }
      });

      assert.strictEqual(sessionRegistry.getSessionForTarget('external-target'), 'external-session');
      assert.strictEqual(sessionRegistry.getTargetForSession('external-session'), 'external-target');
    });

    it('should handle detachedFromTarget event', async () => {
      const sessionId = await sessionRegistry.attach('target-1');

      mockConnection.emit('Target.detachedFromTarget', { sessionId });

      assert.strictEqual(sessionRegistry.isAttached('target-1'), false);
    });

    it('should handle targetDestroyed event (external tab close)', async () => {
      await sessionRegistry.attach('target-1');
      assert.strictEqual(sessionRegistry.isAttached('target-1'), true);

      // Simulate Chrome closing the tab externally
      mockConnection.emit('Target.targetDestroyed', { targetId: 'target-1' });

      assert.strictEqual(sessionRegistry.isAttached('target-1'), false);
      assert.strictEqual(sessionRegistry.getSessionForTarget('target-1'), undefined);
    });

    it('should ignore targetDestroyed for unknown targets', () => {
      // Should not throw
      mockConnection.emit('Target.targetDestroyed', { targetId: 'unknown-target' });
    });
  });

  describe('concurrent attach handling', () => {
    it('should return same session for concurrent attach calls to same target', async () => {
      // Start two attach calls concurrently
      const [sessionId1, sessionId2] = await Promise.all([
        sessionRegistry.attach('target-1'),
        sessionRegistry.attach('target-1')
      ]);

      assert.strictEqual(sessionId1, sessionId2);

      // Should only have sent one attach command
      const cmds = mockConnection.sentCommands.filter(c => c.method === 'Target.attachToTarget');
      assert.strictEqual(cmds.length, 1);
    });
  });

  describe('cleanup', () => {
    it('should detach all sessions and remove event listeners', async () => {
      await sessionRegistry.attach('target-1');
      await sessionRegistry.attach('target-2');

      await sessionRegistry.cleanup();

      assert.strictEqual(sessionRegistry.getAllSessions().length, 0);

      // Event listeners should be removed
      const attachedListeners = mockConnection.eventListeners.get('Target.attachedToTarget');
      assert.strictEqual(attachedListeners?.size || 0, 0);

      const destroyedListeners = mockConnection.eventListeners.get('Target.targetDestroyed');
      assert.strictEqual(destroyedListeners?.size || 0, 0);
    });
  });
});
