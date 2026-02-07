import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createFlywheelRecorder } from '../FlywheelRecorder.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flywheel-recorder-test-'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function makeImprovements(issues = [], implemented = []) {
  return {
    meta: { totalVotes: 10, lastUpdated: '2026-01-01T00:00:00Z' },
    issues,
    implemented
  };
}

describe('FlywheelRecorder', () => {
  let tmpDir, improvementsPath, historyPath;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    improvementsPath = path.join(tmpDir, 'improvements.json');
    historyPath = path.join(tmpDir, 'baselines', 'flywheel-history.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('recordFixOutcome()', () => {
    it('appends fix attempt to the correct issue', () => {
      writeJson(improvementsPath, makeImprovements([
        { id: '2.2', title: 'switchToFrame', votes: 6, fixAttempts: [], status: 'open' },
        { id: '6.5', title: 'Stale refs', votes: 14, fixAttempts: [], status: 'open' }
      ]));

      const recorder = createFlywheelRecorder(improvementsPath, historyPath);
      recorder.recordFixOutcome('2.2', 'fixed', {
        crank: 3,
        version: '1.0.9',
        details: 'Injected getFrameContext via DI',
        filesChanged: ['page-controller.js', 'element-locator.js'],
        shsDelta: 1
      });

      const data = JSON.parse(fs.readFileSync(improvementsPath, 'utf8'));
      const issue = data.issues.find(i => i.id === '2.2');

      assert.equal(issue.fixAttempts.length, 1);
      assert.equal(issue.fixAttempts[0].outcome, 'fixed');
      assert.equal(issue.fixAttempts[0].version, '1.0.9');
      assert.equal(issue.fixAttempts[0].crank, 3);
      assert.deepEqual(issue.fixAttempts[0].filesChanged, ['page-controller.js', 'element-locator.js']);

      // Other issue untouched
      const other = data.issues.find(i => i.id === '6.5');
      assert.equal(other.fixAttempts.length, 0);
    });

    it('appends to existing fixAttempts array', () => {
      writeJson(improvementsPath, makeImprovements([
        {
          id: '6.5', title: 'Stale refs', votes: 14,
          fixAttempts: [{ date: '2026-02-01', outcome: 'failed', crank: 1 }],
          status: 'open'
        }
      ]));

      const recorder = createFlywheelRecorder(improvementsPath, historyPath);
      recorder.recordFixOutcome('6.5', 'partial', { crank: 2, details: 'Second attempt' });

      const data = JSON.parse(fs.readFileSync(improvementsPath, 'utf8'));
      const issue = data.issues.find(i => i.id === '6.5');
      assert.equal(issue.fixAttempts.length, 2);
      assert.equal(issue.fixAttempts[1].outcome, 'partial');
    });

    it('throws for unknown issue ID', () => {
      writeJson(improvementsPath, makeImprovements([]));
      const recorder = createFlywheelRecorder(improvementsPath, historyPath);

      assert.throws(
        () => recorder.recordFixOutcome('999.99', 'fixed'),
        /not found/
      );
    });

    it('appends JSONL entry to flywheel-history', () => {
      writeJson(improvementsPath, makeImprovements([
        { id: '2.2', title: 'test', votes: 1, fixAttempts: [], status: 'open' }
      ]));

      const recorder = createFlywheelRecorder(improvementsPath, historyPath);
      recorder.recordFixOutcome('2.2', 'fixed', { crank: 3 });

      const lines = fs.readFileSync(historyPath, 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);

      const entry = JSON.parse(lines[0]);
      assert.equal(entry.type, 'fix_outcome');
      assert.equal(entry.issueId, '2.2');
      assert.equal(entry.outcome, 'fixed');
      assert.equal(entry.crank, 3);
      assert.ok(entry.ts);
    });

    it('updates meta.lastUpdated timestamp', () => {
      writeJson(improvementsPath, makeImprovements([
        { id: '1.1', title: 'test', votes: 1, fixAttempts: [], status: 'open' }
      ]));

      const recorder = createFlywheelRecorder(improvementsPath, historyPath);
      recorder.recordFixOutcome('1.1', 'failed');

      const data = JSON.parse(fs.readFileSync(improvementsPath, 'utf8'));
      const updated = new Date(data.meta.lastUpdated);
      const now = new Date();
      assert.ok(now - updated < 5000); // Within 5 seconds
    });
  });

  describe('moveToImplemented()', () => {
    it('moves issue from issues array to implemented array', () => {
      writeJson(improvementsPath, makeImprovements([
        { id: '2.2', title: 'switchToFrame action context', votes: 6, fixAttempts: [], status: 'open' },
        { id: '6.5', title: 'Stale refs', votes: 14, fixAttempts: [], status: 'open' }
      ]));

      const recorder = createFlywheelRecorder(improvementsPath, historyPath);
      recorder.moveToImplemented('2.2', 'Injected getFrameContext via DI');

      const data = JSON.parse(fs.readFileSync(improvementsPath, 'utf8'));

      // Removed from issues
      assert.equal(data.issues.length, 1);
      assert.equal(data.issues[0].id, '6.5');

      // Added to implemented
      const impl = data.implemented.find(i => i.id === '2.2');
      assert.ok(impl);
      assert.equal(impl.title, 'switchToFrame action context');
      assert.equal(impl.votes, 6);
      assert.equal(impl.implementedAs, 'Injected getFrameContext via DI');
      assert.ok(impl.fixedDate);
    });

    it('throws for unknown issue ID', () => {
      writeJson(improvementsPath, makeImprovements([]));
      const recorder = createFlywheelRecorder(improvementsPath, historyPath);

      assert.throws(
        () => recorder.moveToImplemented('999.99', 'foo'),
        /not found/
      );
    });

    it('preserves existing implemented items', () => {
      writeJson(improvementsPath, makeImprovements(
        [{ id: '2.2', title: 'switchToFrame', votes: 6, fixAttempts: [], status: 'open' }],
        [{ id: '1.1', title: 'Drag timeout', votes: 11, implementedAs: 'JS simulation', fixedDate: '2026-01-15' }]
      ));

      const recorder = createFlywheelRecorder(improvementsPath, historyPath);
      recorder.moveToImplemented('2.2', 'Frame context DI');

      const data = JSON.parse(fs.readFileSync(improvementsPath, 'utf8'));
      assert.equal(data.implemented.length, 2);
      assert.equal(data.implemented[0].id, '1.1');
      assert.equal(data.implemented[1].id, '2.2');
    });
  });

  describe('recordCrankSummary()', () => {
    it('appends crank summary as JSONL', () => {
      writeJson(improvementsPath, makeImprovements([]));

      const recorder = createFlywheelRecorder(improvementsPath, historyPath);
      recorder.recordCrankSummary({
        crank: 3,
        shs: 99,
        shsDelta: -1,
        testsRun: 20,
        passRate: 0.95,
        patternsDetected: ['stale_refs', 'iframe_context']
      });

      const lines = fs.readFileSync(historyPath, 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);

      const entry = JSON.parse(lines[0]);
      assert.equal(entry.type, 'crank');
      assert.equal(entry.crank, 3);
      assert.equal(entry.shs, 99);
      assert.equal(entry.testsRun, 20);
      assert.deepEqual(entry.patternsDetected, ['stale_refs', 'iframe_context']);
      assert.ok(entry.ts);
    });

    it('appends multiple entries without overwriting', () => {
      writeJson(improvementsPath, makeImprovements([]));

      const recorder = createFlywheelRecorder(improvementsPath, historyPath);
      recorder.recordCrankSummary({ crank: 1, shs: 90 });
      recorder.recordCrankSummary({ crank: 2, shs: 95 });
      recorder.recordCrankSummary({ crank: 3, shs: 99 });

      const lines = fs.readFileSync(historyPath, 'utf8').trim().split('\n');
      assert.equal(lines.length, 3);

      assert.equal(JSON.parse(lines[0]).crank, 1);
      assert.equal(JSON.parse(lines[1]).crank, 2);
      assert.equal(JSON.parse(lines[2]).crank, 3);
    });

    it('creates baselines directory if it does not exist', () => {
      writeJson(improvementsPath, makeImprovements([]));
      // historyPath is inside tmpDir/baselines/ which doesn't exist yet

      const recorder = createFlywheelRecorder(improvementsPath, historyPath);
      recorder.recordCrankSummary({ crank: 1, shs: 100 });

      assert.ok(fs.existsSync(historyPath));
    });
  });
});
