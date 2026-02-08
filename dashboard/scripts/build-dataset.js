#!/usr/bin/env node
/**
 * build-dataset.js
 *
 * Reads cdp-bench source files and produces a single data/dataset.json
 * consumed by the dashboard. Run manually or as part of the flywheel.
 *
 * Sources:
 *   ../cdp-bench/baselines/trend.jsonl       -> trend[]
 *   ../cdp-bench/baselines/flywheel-history.jsonl -> fixes[]
 *   ../cdp-bench/tests/*.test.json           -> budgets (maxSteps per test)
 *   ../cdp-bench/runs/<runId>/*.trace.json   -> traces[], errorDetails[]
 *   ../../improvements.json                  -> improvements[]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.resolve(__dirname, '../../cdp-bench');
const IMPROVEMENTS_FILE = path.resolve(__dirname, '../../improvements.json');
const OUT_FILE = path.resolve(__dirname, '../data/dataset.json');

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function readTrend() {
  const rows = readJsonLines(path.join(BENCH_DIR, 'baselines/trend.jsonl'));
  return rows.map((row, i) => ({
    ts: row.ts,
    crank: i + 1,
    version: row.version,
    shs: row.shs,
    passRate: row.passRate,
    perfectRate: row.perfectRate,
    avgCompletion: row.avgCompletion,
    avgEfficiency: row.avgEfficiency,
    categoryCoverage: row.categoryCoverage,
    tests: row.tests
  }));
}

function readFixes() {
  const rows = readJsonLines(path.join(BENCH_DIR, 'baselines/flywheel-history.jsonl'));
  return rows
    .filter(row => row.type === 'fix_outcome')
    .map(row => ({
      crank: row.crank,
      issueId: row.issueId,
      title: row.details || `Issue #${row.issueId}`,
      outcome: row.outcome,
      shsDelta: row.shsDelta ?? 0,
      version: row.version
    }));
}

function readImprovements() {
  if (!fs.existsSync(IMPROVEMENTS_FILE)) return [];
  const data = JSON.parse(fs.readFileSync(IMPROVEMENTS_FILE, 'utf8'));
  return (data.issues || []).map(issue => ({
    id: issue.id,
    section: issue.section,
    title: issue.title,
    votes: issue.votes,
    status: issue.status,
    symptoms: issue.symptoms || [],
    expected: issue.expected || '',
    workaround: issue.workaround || null,
    files: issue.files || [],
    fixAttempts: (issue.fixAttempts || []).length,
    needsDesignReview: issue.needsDesignReview || false,
    source: issue.source || null
  }));
}

function readBudgets() {
  const testsDir = path.join(BENCH_DIR, 'tests');
  if (!fs.existsSync(testsDir)) return {};
  const budgets = {};
  for (const file of fs.readdirSync(testsDir).filter(f => f.endsWith('.test.json'))) {
    const test = JSON.parse(fs.readFileSync(path.join(testsDir, file), 'utf8'));
    if (test.id && test.budget?.maxSteps) {
      budgets[test.id] = test.budget.maxSteps;
    }
  }
  return budgets;
}

/**
 * Extract trace metrics — mirrors extractTraceMetrics from validator-harness.js.
 */
function extractTraceMetrics(trace) {
  if (!trace) return { totalSteps: 0, totalErrors: 0, wallClockMs: null };

  const agg = trace.aggregate || {};
  const stepsField = trace.steps;
  const stepsCount = typeof stepsField === 'number' ? stepsField
    : Array.isArray(stepsField) ? stepsField.length : 0;
  const totalSteps = agg.totalSteps || trace.totalSteps || stepsCount;

  const errorsField = agg.totalErrors ?? trace.errors ?? 0;
  const totalErrors = typeof errorsField === 'number' ? errorsField
    : Array.isArray(errorsField) ? errorsField.length : 0;

  const wallClockMs = trace.wallClockMs
    || (trace.endTs && trace.startTs ? trace.endTs - trace.startTs : null)
    || null;

  return { totalSteps, totalErrors, wallClockMs };
}

/**
 * Extract per-error detail entries from a trace.
 */
function extractErrors(trace, crank, testId) {
  const errors = [];
  const rawErrors = trace.errors;

  if (Array.isArray(rawErrors)) {
    for (const err of rawErrors) {
      const detail = typeof err === 'string' ? err
        : err.issue || err.error || err.message || JSON.stringify(err);
      errors.push({ crank, testId, error: detail });
    }
  }

  // Also scan step-level errors in steps array
  if (Array.isArray(trace.steps)) {
    for (const step of trace.steps) {
      if (step.status === 'error' || step.error) {
        const detail = step.error || step.note || `Step ${step.seq || step.step}: ${step.action} failed`;
        errors.push({ crank, testId, error: detail });
      }
    }
  }

  return errors;
}

/**
 * Match a trend entry to a run directory. Uses explicit runId when available,
 * otherwise finds the run directory whose timestamp is closest before the
 * trend timestamp.
 */
function matchTrendToRunDir(trendEntry, runDirNames) {
  // Explicit runId field takes priority
  if (trendEntry.runId && runDirNames.includes(trendEntry.runId)) {
    return trendEntry.runId;
  }

  // Convert trend ts (ISO) to comparable form: "2026-02-07T21:11" -> "2026-02-07T21-11"
  const trendTime = new Date(trendEntry.ts).getTime();

  // Parse run dir timestamps as UTC: "2026-02-07T21-00-08" -> "2026-02-07T21:00:08Z"
  const candidates = runDirNames
    .map(name => {
      const isoStr = name.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3Z');
      const time = new Date(isoStr).getTime();
      return { name, time };
    })
    .filter(c => !isNaN(c.time) && c.time <= trendTime)
    .sort((a, b) => b.time - a.time);

  return candidates.length > 0 ? candidates[0].name : null;
}

/**
 * Infer area from observation text (mirrors FeedbackAggregator logic).
 */
function inferArea(text) {
  const lower = text.toLowerCase();
  if (lower.includes('iframe') || lower.includes('frame')) return 'iframe';
  if (lower.includes('snapshot') || lower.includes('aria')) return 'snapshot';
  if (lower.includes('click') || lower.includes('hover') || lower.includes('drag')) return 'actions';
  if (lower.includes('type') || lower.includes('fill') || lower.includes('keyboard') || lower.includes('input')) return 'input';
  if (lower.includes('navig') || lower.includes('goto') || lower.includes('url')) return 'navigation';
  if (lower.includes('shadow')) return 'shadow-dom';
  if (lower.includes('timeout') || lower.includes('wait') || lower.includes('network') || lower.includes('idle')) return 'timing';
  if (lower.includes('error') || lower.includes('crash')) return 'error-handling';
  return 'other';
}

/**
 * Extract feedback entries from a single trace.
 */
function extractFeedback(trace, testId) {
  const entries = [];

  if (Array.isArray(trace.feedback)) {
    for (const fb of trace.feedback) {
      entries.push({
        testId,
        type: fb.type || 'improvement',
        area: fb.area || 'other',
        title: fb.title || '',
        detail: fb.detail || ''
      });
    }
  }

  if (Array.isArray(trace.improvements)) {
    for (const imp of trace.improvements) {
      entries.push({
        testId,
        type: 'improvement',
        area: imp.category || 'other',
        title: imp.description || '',
        detail: imp.description || ''
      });
    }
  }

  if (Array.isArray(trace.bugs)) {
    for (const bug of trace.bugs) {
      const detail = typeof bug === 'string' ? bug : (bug.description || bug.error || JSON.stringify(bug));
      entries.push({ testId, type: 'bug', area: 'other', title: detail.slice(0, 80), detail });
    }
  }

  if (Array.isArray(trace.observations)) {
    for (const obs of trace.observations) {
      entries.push({ testId, type: 'observation', area: inferArea(obs), title: obs.slice(0, 80), detail: obs });
    }
  }

  return entries;
}

function readTraces(trend) {
  const runsDir = path.join(BENCH_DIR, 'runs');
  if (!fs.existsSync(runsDir)) return { traces: [], errorDetails: [], feedback: [] };

  const budgets = readBudgets();
  const runDirNames = fs.readdirSync(runsDir)
    .filter(d => fs.statSync(path.join(runsDir, d)).isDirectory())
    .sort();

  const traces = [];
  const errorDetails = [];
  const feedbackRaw = [];
  const claimed = new Set();

  for (const trendEntry of trend) {
    const available = runDirNames.filter(d => !claimed.has(d));
    const runDirName = matchTrendToRunDir(trendEntry, available);
    if (runDirName) claimed.add(runDirName);
    if (!runDirName) continue;

    const crank = trendEntry.crank;
    const version = trendEntry.version;
    const runPath = path.join(runsDir, runDirName);

    const traceFiles = fs.readdirSync(runPath).filter(f => f.endsWith('.trace.json'));
    for (const file of traceFiles) {
      const testId = file.replace('.trace.json', '');
      const trace = JSON.parse(fs.readFileSync(path.join(runPath, file), 'utf8'));
      const metrics = extractTraceMetrics(trace);
      const budget = budgets[testId] || 50;

      traces.push({
        crank,
        version,
        testId,
        steps: metrics.totalSteps,
        budget,
        errors: metrics.totalErrors,
        wallClockMs: metrics.wallClockMs
      });

      const errs = extractErrors(trace, crank, testId);
      errorDetails.push(...errs);

      const fbs = extractFeedback(trace, testId);
      for (const fb of fbs) {
        feedbackRaw.push({ crank, ...fb });
      }
    }
  }

  // Deduplicate feedback per crank by area+title prefix
  const feedback = deduplicateFeedback(feedbackRaw);

  return { traces, errorDetails, feedback };
}

function deduplicateFeedback(feedbackRaw) {
  const groups = new Map();
  for (const fb of feedbackRaw) {
    const key = `${fb.crank}:${fb.area}:${fb.title.toLowerCase().slice(0, 40).trim()}`;
    if (!groups.has(key)) {
      groups.set(key, { ...fb, count: 1, tests: [fb.testId] });
    } else {
      const existing = groups.get(key);
      existing.count++;
      if (!existing.tests.includes(fb.testId)) {
        existing.tests.push(fb.testId);
      }
    }
  }
  return [...groups.values()]
    .map(({ testId, ...rest }) => rest)
    .sort((a, b) => b.count - a.count || a.crank - b.crank);
}

function build() {
  const trend = readTrend();
  const fixes = readFixes();
  const improvements = readImprovements();
  const { traces, errorDetails, feedback } = readTraces(trend);

  const dataset = {
    generated: new Date().toISOString(),
    trend,
    fixes,
    improvements,
    traces,
    errorDetails,
    feedback
  };

  const open = improvements.filter(i => i.status === 'open').length;
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(dataset, null, 2));
  console.log(`dataset.json written (${trend.length} cranks, ${traces.length} traces, ${fixes.length} fixes, ${errorDetails.length} errors, ${feedback.length} feedback, ${open} open improvements)`);
}

build();
