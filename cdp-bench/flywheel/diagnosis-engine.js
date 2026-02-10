/**
 * Diagnosis Engine
 *
 * Reads all results + baseline + improvements.json. Identifies failure patterns,
 * cross-references with known issues, detects regressions, computes
 * priority, and recommends top-3 fixes with history-aware ranking.
 */

import fs from 'fs';
import path from 'path';
import { createDecisionEngine } from './DecisionEngine.js';

// --- improvements.json Reader ---

function readImprovements(improvementsPath) {
  if (!fs.existsSync(improvementsPath)) return [];

  const data = JSON.parse(fs.readFileSync(improvementsPath, 'utf8'));
  return data.issues
    .filter(i => i.status !== 'fixed')
    .map(i => ({
      id: i.id,
      title: i.title,
      votes: i.votes,
      files: i.files || [],
      workaround: i.workaround,
      hasWorkaround: !!i.workaround
    }))
    .sort((a, b) => b.votes - a.votes);
}

// --- Trace Helpers ---

// Extract all step entries from any trace format (cliCalls, steps, trace arrays)
function extractSteps(trace) {
  const steps = [];
  if (trace.cliCalls) steps.push(...trace.cliCalls);
  if (Array.isArray(trace.steps)) steps.push(...trace.steps);
  if (Array.isArray(trace.trace)) steps.push(...trace.trace);
  return steps;
}

// Search all text fields in steps for a pattern
function stepsContainText(steps, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  return steps.some(s => {
    const text = JSON.stringify(s);
    return re.test(text);
  });
}

// --- Failure Pattern Detection ---

const FAILURE_PATTERNS = [
  {
    id: 'stale_refs',
    name: 'Stale element references',
    matchTrace: (trace) => {
      const steps = extractSteps(trace);
      return stepsContainText(steps, /ref not found|stale|no longer attached|ariaRefs/i);
    },
    votingIds: ['6.5']
  },
  {
    id: 'iframe_context',
    name: 'iframe/frame context issues',
    matchTrace: (trace) => {
      const steps = extractSteps(trace);
      const observations = trace.observations || [];
      return stepsContainText(steps, /iframe|switchToFrame|frame context|frame:/i) ||
        observations.some(o => o.toLowerCase().includes('iframe'));
    },
    votingIds: ['2.2', '2.3']
  },
  {
    id: 'click_timeout',
    name: 'Click timeout / actionability failure',
    matchTrace: (trace) => {
      const steps = extractSteps(trace);
      return steps.some(s =>
        (s.action === 'click' || s.status === 'error') &&
        stepsContainText([s], /timeout|not actionable/i)
      );
    },
    votingIds: ['1.2']
  },
  {
    id: 'fill_failure',
    name: 'Fill/input not working',
    matchTrace: (trace) => {
      const steps = extractSteps(trace);
      return steps.some(s =>
        s.action === 'fill' &&
        (s.status === 'error' || stepsContainText([s], /timeout|not accepting|failed/i))
      );
    },
    votingIds: ['4.3']
  },
  {
    id: 'navigation_missed',
    name: 'SPA navigation not detected',
    matchTrace: (trace) => {
      const steps = extractSteps(trace);
      return stepsContainText(steps, /navigated.*false|pushState|SPA navigation/i);
    },
    votingIds: ['11.1']
  },
  {
    id: 'snapshot_bloat',
    name: 'Snapshot response too large',
    matchTrace: (trace) => {
      const steps = extractSteps(trace);
      return steps.some(s => (s.responseBytes || 0) > 50000);
    },
    votingIds: ['9.1', '9.2', '9.3', '9.4']
  },
  {
    id: 'js_click_fallback',
    name: 'Required JS click fallback',
    matchTrace: (trace) => {
      const steps = extractSteps(trace);
      return stepsContainText(steps, /jsClick-auto|jsClick fallback|auto-fallback/i);
    },
    votingIds: []
  },
  {
    id: 'shadow_dom',
    name: 'Shadow DOM interaction failure',
    matchTrace: (trace) => {
      const steps = extractSteps(trace);
      const observations = trace.observations || [];
      return stepsContainText(steps, /shadow/i) ||
        observations.some(o => o.toLowerCase().includes('shadow'));
    },
    votingIds: ['3.1']
  },
  {
    id: 'eval_workaround',
    name: 'Used pageFunction workaround instead of native step',
    matchTrace: (trace) => {
      const steps = extractSteps(trace);
      return steps.some(s =>
        (s.action === 'eval' || s.action === 'pageFunction') &&
        stepsContainText([s], /\.click\(\)|\.value\s*=|dispatchEvent/i)
      );
    },
    votingIds: []
  },
  {
    id: 'excessive_steps',
    name: 'Excessive steps (token regression indicator)',
    matchTrace: (trace) => {
      const totalSteps = trace.totalSteps || trace.steps?.length || trace.trace?.length || 0;
      // Flag traces that used more than 15 steps (indicates workarounds/retries)
      return totalSteps > 15;
    },
    votingIds: []
  },
  {
    id: 'force_click',
    name: 'Required force:true for hidden/overlapped elements',
    matchTrace: (trace) => {
      const steps = extractSteps(trace);
      return stepsContainText(steps, /force.*true|hidden.*input|overlapped/i);
    },
    votingIds: []
  }
];

function detectFailurePatterns(traces) {
  const patternCounts = {};

  for (const pattern of FAILURE_PATTERNS) {
    const matchingTraces = traces.filter(t => {
      try { return pattern.matchTrace(t); }
      catch { return false; }
    });

    if (matchingTraces.length > 0) {
      patternCounts[pattern.id] = {
        name: pattern.name,
        count: matchingTraces.length,
        affectedTests: matchingTraces.map(t => t.testId),
        votingIds: pattern.votingIds
      };
    }
  }

  return patternCounts;
}

// --- Priority Computation ---

function computePriority(pattern, votingIssues, totalTests) {
  const impactedTests = pattern.count;
  const avgScoreLoss = 0.5; // conservative default

  // Sum votes from related issues
  const votes = pattern.votingIds.reduce((sum, id) => {
    const issue = votingIssues.find(i => i.id === id);
    return sum + (issue?.votes || 0);
  }, 0);

  return impactedTests * avgScoreLoss * (1 + votes / 10);
}

// --- Diagnosis ---

function diagnose(runDir, testsDir, improvementsPath, baseline) {
  // Read all traces
  const traceFiles = fs.readdirSync(runDir)
    .filter(f => f.endsWith('.trace.json'))
    .map(f => path.join(runDir, f));

  const traces = traceFiles.map(f => {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch { return null; }
  }).filter(Boolean);

  // Read all results
  const resultFiles = fs.readdirSync(runDir)
    .filter(f => f.endsWith('.result.json'))
    .map(f => path.join(runDir, f));

  const results = resultFiles.map(f => {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch { return null; }
  }).filter(Boolean);

  // Read improvements.json (replaces VOTING.md)
  const knownIssues = readImprovements(improvementsPath);

  // Detect failure patterns
  const patterns = detectFailurePatterns(traces);

  // Detect regressions vs baseline
  const regressions = [];
  if (baseline) {
    for (const result of results) {
      const prev = baseline.tests?.[result.testId];
      if (prev && result.scores?.completion < prev.score - 0.1) {
        regressions.push({
          testId: result.testId,
          from: prev.score,
          to: result.scores.completion,
          delta: result.scores.completion - prev.score
        });
      }
    }
  }

  // Compute priorities and rank
  const rawRecommendations = Object.entries(patterns)
    .map(([id, pattern]) => ({
      patternId: id,
      ...pattern,
      priority: computePriority(pattern, knownIssues, results.length),
      relatedVotingIssues: pattern.votingIds.map(vid => {
        const issue = knownIssues.find(i => i.id === vid);
        return issue ? { id: vid, title: issue.title, votes: issue.votes, files: issue.files } : null;
      }).filter(Boolean)
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);

  // Re-rank with history-aware decision engine
  const historyPath = path.join(path.dirname(improvementsPath), 'cdp-bench', 'baselines', 'flywheel-history.jsonl');
  const engine = createDecisionEngine(improvementsPath, historyPath);
  const recommendations = engine.rank(rawRecommendations);

  // Failed tests summary
  const failedTests = results
    .filter(r => r.scores?.completion < 0.5)
    .map(r => ({
      testId: r.testId,
      completion: r.scores?.completion || 0,
      milestones: r.milestones?.filter(m => !m.passed).map(m => m.id) || []
    }));

  // Category breakdown
  const categoryBreakdown = {};
  for (const result of results) {
    const cat = result.category || 'unknown';
    if (!categoryBreakdown[cat]) {
      categoryBreakdown[cat] = { total: 0, passed: 0, avgCompletion: 0, scores: [] };
    }
    categoryBreakdown[cat].total++;
    if (result.scores?.completion >= 0.5) categoryBreakdown[cat].passed++;
    categoryBreakdown[cat].scores.push(result.scores?.completion || 0);
  }
  for (const cat of Object.values(categoryBreakdown)) {
    cat.avgCompletion = cat.scores.length > 0
      ? Math.round((cat.scores.reduce((a, b) => a + b, 0) / cat.scores.length) * 1000) / 1000
      : 0;
    delete cat.scores;
  }

  const diagnosis = {
    timestamp: new Date().toISOString(),
    summary: {
      totalTests: results.length,
      failedTests: failedTests.length,
      patterns: Object.keys(patterns).length,
      regressions: regressions.length
    },
    failedTests,
    failurePatterns: patterns,
    regressions,
    categoryBreakdown,
    recommendations
  };

  // Write diagnosis
  const diagnosisPath = path.join(runDir, 'diagnosis.json');
  fs.writeFileSync(diagnosisPath, JSON.stringify(diagnosis, null, 2));

  return diagnosis;
}

export {
  readImprovements,
  detectFailurePatterns,
  computePriority,
  diagnose,
  extractSteps,
  FAILURE_PATTERNS
};
