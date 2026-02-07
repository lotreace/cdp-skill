/**
 * Decision Engine
 *
 * Reads diagnosis recommendations + improvements.json + flywheel-history.jsonl
 * to produce history-aware, re-ranked fix recommendations. Penalizes recently
 * failed attempts, boosts persistent patterns, and skips issues with 3+
 * consecutive failures (flagged as "needs design review").
 */

import fs from 'fs';

function createDecisionEngine(improvementsPath, historyPath) {

  function readImprovements() {
    if (!fs.existsSync(improvementsPath)) return { issues: [], implemented: [] };
    return JSON.parse(fs.readFileSync(improvementsPath, 'utf8'));
  }

  function readCrankHistory() {
    if (!fs.existsSync(historyPath)) return [];
    return fs.readFileSync(historyPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }

  function getAttemptHistory(issueId) {
    const data = readImprovements();
    const issue = data.issues.find(i => i.id === issueId);
    const attempts = issue?.fixAttempts || [];
    const lastOutcome = attempts.length > 0
      ? attempts[attempts.length - 1].outcome
      : null;

    let consecutiveFailures = 0;
    for (let i = attempts.length - 1; i >= 0; i--) {
      if (attempts[i].outcome === 'failed' || attempts[i].outcome === 'reverted') {
        consecutiveFailures++;
      } else {
        break;
      }
    }

    return { attempts, lastOutcome, consecutiveFailures };
  }

  function rank(diagnosisRecommendations) {
    const cranks = readCrankHistory().filter(e => e.type === 'crank' || e.crank != null);
    const currentCrank = cranks.length > 0
      ? Math.max(...cranks.map(c => c.crank))
      : 0;

    return diagnosisRecommendations.map(rec => {
      const votingIds = rec.votingIds || rec.relatedVotingIssues?.map(v => v.id) || [];

      // Collect attempt history for every related issue
      const attemptHistory = {};
      for (const vid of votingIds) {
        attemptHistory[vid] = getAttemptHistory(vid);
      }

      let modifier = 1.0;
      let needsDesignReview = false;

      // Penalty for recent failed attempts (within last 2 cranks)
      for (const history of Object.values(attemptHistory)) {
        if (history.attempts.length > 0) {
          const last = history.attempts[history.attempts.length - 1];
          const isFailed = last.outcome === 'failed' || last.outcome === 'reverted';
          const isRecent = last.crank != null && currentCrank - last.crank <= 2;
          if (isFailed && isRecent) {
            modifier *= 0.3;
          }
        }

        // 3+ consecutive failures → flag and skip
        if (history.consecutiveFailures >= 3) {
          needsDesignReview = true;
          modifier = 0;
        }
      }

      // Boost for persistent patterns (detected in 3+ consecutive cranks)
      if (cranks.length >= 3) {
        const recentCranks = cranks.slice(-3);
        const patternId = rec.patternId;
        const patternInAll = recentCranks.every(c =>
          c.patternsDetected?.includes(patternId)
        );
        if (patternInAll) {
          modifier *= 1.5;
        }
      }

      return {
        ...rec,
        priority: rec.priority * modifier,
        attemptHistory,
        needsDesignReview,
        skipped: modifier === 0
      };
    })
    .filter(r => !r.skipped)
    .sort((a, b) => b.priority - a.priority);
  }

  return { rank, getAttemptHistory };
}

export { createDecisionEngine };
