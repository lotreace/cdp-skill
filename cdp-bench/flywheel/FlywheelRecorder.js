/**
 * Flywheel Recorder
 *
 * Persists fix outcomes and crank summaries after each flywheel crank turn.
 * Updates improvements.json with fix attempt history and appends to the
 * flywheel-history.jsonl timeline.
 */

import fs from 'fs';
import path from 'path';
import { createFileLock } from './file-lock.js';

function createFlywheelRecorder(improvementsPath, historyPath) {
  const fileLock = createFileLock();

  function readImprovements() {
    return JSON.parse(fs.readFileSync(improvementsPath, 'utf8'));
  }

  function writeImprovements(data) {
    data.meta.lastUpdated = new Date().toISOString();
    fs.writeFileSync(improvementsPath, JSON.stringify(data, null, 2));
  }

  function ensureHistoryDir() {
    const dir = path.dirname(historyPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async function appendToHistory(entry) {
    ensureHistoryDir();
    await fileLock.withLock(historyPath, () => {
      fs.appendFileSync(historyPath, JSON.stringify(entry) + '\n');
    });
  }

  async function recordFixOutcome(issueId, outcome, details = {}) {
    await fileLock.withLock(improvementsPath, () => {
      const data = readImprovements();
      const issue = data.issues.find(i => i.id === issueId);
      if (!issue) {
        throw new Error(`Issue "${issueId}" not found in improvements.json`);
      }

      const attempt = {
        date: new Date().toISOString().slice(0, 10),
        outcome,
        ...details
      };

      issue.fixAttempts.push(attempt);
      writeImprovements(data);
    });

    await appendToHistory({
      type: 'fix_outcome',
      ts: new Date().toISOString(),
      issueId,
      outcome,
      ...details
    });
  }

  async function moveToImplemented(issueId, implementedAs) {
    await fileLock.withLock(improvementsPath, () => {
      const data = readImprovements();
      const idx = data.issues.findIndex(i => i.id === issueId);
      if (idx === -1) {
        throw new Error(`Issue "${issueId}" not found in improvements.json`);
      }

      const [issue] = data.issues.splice(idx, 1);

      data.implemented.push({
        id: issue.id,
        title: issue.title,
        votes: issue.votes,
        implementedAs,
        fixedDate: new Date().toISOString().slice(0, 10)
      });

      writeImprovements(data);
    });
  }

  async function recordCrankSummary(crankData) {
    await appendToHistory({
      type: 'crank',
      ts: new Date().toISOString(),
      ...crankData
    });
  }

  return { recordFixOutcome, moveToImplemented, recordCrankSummary };
}

export { createFlywheelRecorder };
