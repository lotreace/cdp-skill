import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createDecisionEngine } from '../DecisionEngine.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'decision-engine-test-'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeJsonl(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
}

function makeImprovements(issues = []) {
  return {
    meta: { totalVotes: 10, lastUpdated: '2026-01-01T00:00:00Z' },
    issues,
    implemented: []
  };
}

function makeRec(patternId, priority, votingIds = []) {
  return {
    patternId,
    priority,
    votingIds,
    name: `Pattern ${patternId}`,
    count: 1,
    affectedTests: ['test-1']
  };
}

describe('DecisionEngine', () => {
  let tmpDir, improvementsPath, historyPath;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    improvementsPath = path.join(tmpDir, 'improvements.json');
    historyPath = path.join(tmpDir, 'flywheel-history.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('rank() with empty history', () => {
    it('returns same rankings as raw diagnosis when no history exists', () => {
      writeJson(improvementsPath, makeImprovements([
        { id: '1.1', fixAttempts: [], status: 'open' },
        { id: '2.2', fixAttempts: [], status: 'open' }
      ]));

      const engine = createDecisionEngine(improvementsPath, historyPath);
      const recs = [
        makeRec('stale_refs', 10, ['1.1']),
        makeRec('iframe_context', 5, ['2.2'])
      ];

      const ranked = engine.rank(recs);

      assert.equal(ranked.length, 2);
      assert.equal(ranked[0].patternId, 'stale_refs');
      assert.equal(ranked[0].priority, 10);
      assert.equal(ranked[1].patternId, 'iframe_context');
      assert.equal(ranked[1].priority, 5);
    });

    it('returns empty array for empty input', () => {
      writeJson(improvementsPath, makeImprovements([]));
      const engine = createDecisionEngine(improvementsPath, historyPath);
      const ranked = engine.rank([]);
      assert.deepEqual(ranked, []);
    });
  });

  describe('penalty for recent failed attempts', () => {
    it('applies 0.3x penalty for issue that failed in last 2 cranks', () => {
      writeJson(improvementsPath, makeImprovements([
        {
          id: '2.2',
          fixAttempts: [
            { date: '2026-02-07', crank: 3, outcome: 'failed' }
          ],
          status: 'open'
        }
      ]));

      writeJsonl(historyPath, [
        { type: 'crank', crank: 3, shs: 95 },
        { type: 'crank', crank: 4, shs: 96 }
      ]);

      const engine = createDecisionEngine(improvementsPath, historyPath);
      const ranked = engine.rank([makeRec('iframe_context', 10, ['2.2'])]);

      assert.equal(ranked.length, 1);
      assert.equal(ranked[0].priority, 3); // 10 * 0.3
    });

    it('does not penalize if failure was more than 2 cranks ago', () => {
      writeJson(improvementsPath, makeImprovements([
        {
          id: '2.2',
          fixAttempts: [
            { date: '2026-02-01', crank: 1, outcome: 'failed' }
          ],
          status: 'open'
        }
      ]));

      writeJsonl(historyPath, [
        { type: 'crank', crank: 1, shs: 90 },
        { type: 'crank', crank: 2, shs: 92 },
        { type: 'crank', crank: 3, shs: 95 },
        { type: 'crank', crank: 4, shs: 96 }
      ]);

      const engine = createDecisionEngine(improvementsPath, historyPath);
      const ranked = engine.rank([makeRec('iframe_context', 10, ['2.2'])]);

      assert.equal(ranked[0].priority, 10); // No penalty
    });
  });

  describe('skip on 3+ consecutive failures', () => {
    it('removes recommendation with 3 consecutive failures', () => {
      writeJson(improvementsPath, makeImprovements([
        {
          id: '6.5',
          fixAttempts: [
            { date: '2026-02-01', crank: 1, outcome: 'failed' },
            { date: '2026-02-02', crank: 2, outcome: 'reverted' },
            { date: '2026-02-03', crank: 3, outcome: 'failed' }
          ],
          status: 'open'
        },
        { id: '2.2', fixAttempts: [], status: 'open' }
      ]));

      const engine = createDecisionEngine(improvementsPath, historyPath);
      const recs = [
        makeRec('stale_refs', 20, ['6.5']),
        makeRec('iframe_context', 5, ['2.2'])
      ];

      const ranked = engine.rank(recs);

      assert.equal(ranked.length, 1);
      assert.equal(ranked[0].patternId, 'iframe_context');
    });

    it('flags needsDesignReview on skipped items', () => {
      writeJson(improvementsPath, makeImprovements([
        {
          id: '6.5',
          fixAttempts: [
            { outcome: 'failed' },
            { outcome: 'failed' },
            { outcome: 'failed' }
          ],
          status: 'open'
        }
      ]));

      const engine = createDecisionEngine(improvementsPath, historyPath);

      // The rec itself gets filtered, but we can check via getAttemptHistory
      const history = engine.getAttemptHistory('6.5');
      assert.equal(history.consecutiveFailures, 3);
    });
  });

  describe('boost for persistent patterns', () => {
    it('applies 1.5x boost when pattern appears in 3 consecutive cranks', () => {
      writeJson(improvementsPath, makeImprovements([
        { id: '1.1', fixAttempts: [], status: 'open' }
      ]));

      writeJsonl(historyPath, [
        { type: 'crank', crank: 1, shs: 90, patternsDetected: ['stale_refs', 'iframe_context'] },
        { type: 'crank', crank: 2, shs: 92, patternsDetected: ['stale_refs', 'click_timeout'] },
        { type: 'crank', crank: 3, shs: 95, patternsDetected: ['stale_refs'] }
      ]);

      const engine = createDecisionEngine(improvementsPath, historyPath);
      const ranked = engine.rank([makeRec('stale_refs', 10, ['1.1'])]);

      assert.equal(ranked[0].priority, 15); // 10 * 1.5
    });

    it('does not boost pattern that appears in fewer than 3 cranks', () => {
      writeJson(improvementsPath, makeImprovements([
        { id: '1.1', fixAttempts: [], status: 'open' }
      ]));

      writeJsonl(historyPath, [
        { type: 'crank', crank: 1, shs: 90, patternsDetected: ['stale_refs'] },
        { type: 'crank', crank: 2, shs: 92, patternsDetected: ['click_timeout'] },
        { type: 'crank', crank: 3, shs: 95, patternsDetected: ['stale_refs'] }
      ]);

      const engine = createDecisionEngine(improvementsPath, historyPath);
      const ranked = engine.rank([makeRec('stale_refs', 10, ['1.1'])]);

      assert.equal(ranked[0].priority, 10); // No boost
    });
  });

  describe('getAttemptHistory()', () => {
    it('returns empty history for issue with no attempts', () => {
      writeJson(improvementsPath, makeImprovements([
        { id: '1.1', fixAttempts: [], status: 'open' }
      ]));

      const engine = createDecisionEngine(improvementsPath, historyPath);
      const history = engine.getAttemptHistory('1.1');

      assert.deepEqual(history.attempts, []);
      assert.equal(history.lastOutcome, null);
      assert.equal(history.consecutiveFailures, 0);
    });

    it('returns correct history for issue with mixed outcomes', () => {
      writeJson(improvementsPath, makeImprovements([
        {
          id: '2.2',
          fixAttempts: [
            { outcome: 'failed', crank: 1 },
            { outcome: 'fixed', crank: 2 },
            { outcome: 'reverted', crank: 3 },
            { outcome: 'failed', crank: 4 }
          ],
          status: 'open'
        }
      ]));

      const engine = createDecisionEngine(improvementsPath, historyPath);
      const history = engine.getAttemptHistory('2.2');

      assert.equal(history.attempts.length, 4);
      assert.equal(history.lastOutcome, 'failed');
      assert.equal(history.consecutiveFailures, 2); // reverted + failed
    });

    it('returns empty for unknown issue', () => {
      writeJson(improvementsPath, makeImprovements([]));
      const engine = createDecisionEngine(improvementsPath, historyPath);
      const history = engine.getAttemptHistory('999.99');

      assert.deepEqual(history.attempts, []);
      assert.equal(history.lastOutcome, null);
      assert.equal(history.consecutiveFailures, 0);
    });
  });

  describe('attemptHistory on ranked output', () => {
    it('attaches attemptHistory to each ranked recommendation', () => {
      writeJson(improvementsPath, makeImprovements([
        {
          id: '2.2',
          fixAttempts: [{ outcome: 'failed', crank: 1 }],
          status: 'open'
        }
      ]));

      const engine = createDecisionEngine(improvementsPath, historyPath);
      const ranked = engine.rank([makeRec('iframe_context', 10, ['2.2'])]);

      assert.ok(ranked[0].attemptHistory);
      assert.ok(ranked[0].attemptHistory['2.2']);
      assert.equal(ranked[0].attemptHistory['2.2'].attempts.length, 1);
    });
  });

  describe('relatedVotingIssues fallback', () => {
    it('uses relatedVotingIssues when votingIds not present', () => {
      writeJson(improvementsPath, makeImprovements([
        { id: '6.5', fixAttempts: [], status: 'open' }
      ]));

      const engine = createDecisionEngine(improvementsPath, historyPath);
      const rec = {
        patternId: 'stale_refs',
        priority: 10,
        relatedVotingIssues: [{ id: '6.5', title: 'Stale refs', votes: 14 }],
        name: 'Stale refs',
        count: 1,
        affectedTests: ['test-1']
      };

      const ranked = engine.rank([rec]);
      assert.ok(ranked[0].attemptHistory['6.5']);
    });
  });
});
