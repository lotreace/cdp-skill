#!/usr/bin/env node
/**
 * Validator Harness
 *
 * Deterministic milestone verification via CDP. Connects to a browser tab
 * and runs verify blocks from .test.json files against live browser state.
 *
 * Usage:
 *   node validator-harness.js --test path/to/test.json --port 9222 [--target targetId]
 *   node validator-harness.js --run-dir cdp-bench/runs/2026-02-01T12-00-00 --port 9222
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import os from 'os';
import { evaluateSnapshotOffline } from './VerificationSnapshot.js';

// --- CDP Connection ---

function connectToTarget(host, port, targetId, urlHint) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${host}:${port}/json`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const targets = JSON.parse(data);
          let target;
          if (targetId) {
            // Match by id (CDP uses lowercase 'id' in /json response)
            target = targets.find(t => t.id === targetId || t.id === targetId.toLowerCase());
          }
          if (!target && urlHint) {
            // Fallback: match by URL from trace's finalState
            target = targets.find(t => t.type === 'page' && t.url && t.url.includes(urlHint));
          }
          if (!target) {
            // Last resort: first page — but ONLY if no targetId was specified
            // (if a specific tab was requested but closed, don't fall back to random tab)
            if (!targetId) {
              target = targets.find(t => t.type === 'page');
            }
          }
          if (!target) {
            reject(new Error(`No target found${targetId ? ` with id ${targetId}` : ''}${urlHint ? ` (url hint: ${urlHint})` : ''} — tab may have been closed`));
            return;
          }
          resolve(target);
        } catch (e) {
          reject(new Error(`Failed to parse target list: ${e.message}`));
        }
      });
    }).on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout connecting to Chrome /json')); });
  });
}

async function createCDPSession(wsUrl) {
  const WebSocket = globalThis.WebSocket;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 0;
    const pending = new Map();
    const connectTimeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket connection timeout for ${wsUrl}`));
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectTimeout);
      const session = {
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++msgId;
            const cmdTimeout = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`CDP command timeout: ${method}`));
            }, 10000);
            pending.set(id, { resolve: res, reject: rej, timeout: cmdTimeout });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          ws.close();
        }
      };
      resolve(session);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej, timeout } = pending.get(msg.id);
        clearTimeout(timeout);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };

    ws.onerror = (err) => { clearTimeout(connectTimeout); reject(err); };
    ws.onclose = () => {
      clearTimeout(connectTimeout);
      for (const { reject: rej, timeout } of pending.values()) {
        clearTimeout(timeout);
        rej(new Error('WebSocket closed'));
      }
      pending.clear();
    };
  });
}

// --- Validator Execution ---

async function evaluateExpression(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false
  });
  if (result.exceptionDetails) {
    return { success: false, error: result.exceptionDetails.text || 'eval exception' };
  }
  return { success: true, value: result.result.value };
}

async function runVerifier(session, verify) {
  if (verify.url_contains) {
    const { value } = await evaluateExpression(session, 'window.location.href');
    return { passed: String(value).includes(verify.url_contains), detail: `url=${value}` };
  }

  if (verify.url_matches) {
    const { value } = await evaluateExpression(session, 'window.location.href');
    const re = new RegExp(verify.url_matches);
    return { passed: re.test(String(value)), detail: `url=${value}` };
  }

  if (verify.eval_truthy) {
    const result = await evaluateExpression(session, `!!(${verify.eval_truthy})`);
    if (!result.success) return { passed: false, detail: result.error };
    return { passed: !!result.value, detail: `eval=${result.value}` };
  }

  if (verify.dom_exists) {
    const result = await evaluateExpression(session, `!!document.querySelector(${JSON.stringify(verify.dom_exists)})`);
    if (!result.success) return { passed: false, detail: result.error };
    return { passed: !!result.value, detail: `dom_exists=${result.value}` };
  }

  if (verify.dom_text) {
    const { selector, contains, matches } = verify.dom_text;
    const result = await evaluateExpression(session,
      `(document.querySelector(${JSON.stringify(selector)})?.textContent || '')`
    );
    if (!result.success) return { passed: false, detail: result.error };
    const text = String(result.value);
    if (contains) return { passed: text.includes(contains), detail: `text="${text.slice(0, 100)}"` };
    if (matches) return { passed: new RegExp(matches).test(text), detail: `text="${text.slice(0, 100)}"` };
    return { passed: text.length > 0, detail: `text="${text.slice(0, 100)}"` };
  }

  if (verify.all) {
    const results = [];
    for (const sub of verify.all) {
      const r = await runVerifier(session, sub);
      results.push(r);
      if (!r.passed) return { passed: false, detail: `all: failed at ${JSON.stringify(sub)}`, sub: results };
    }
    return { passed: true, detail: 'all passed', sub: results };
  }

  if (verify.any) {
    const results = [];
    for (const sub of verify.any) {
      const r = await runVerifier(session, sub);
      results.push(r);
      if (r.passed) return { passed: true, detail: `any: passed at ${JSON.stringify(sub)}`, sub: results };
    }
    return { passed: false, detail: 'none passed', sub: results };
  }

  return { passed: false, detail: `Unknown verify type: ${JSON.stringify(Object.keys(verify))}` };
}

// --- Milestone Validation ---

async function validateMilestones(session, milestones) {
  const results = [];
  let completionScore = 0;

  for (const milestone of milestones) {
    const result = await runVerifier(session, milestone.verify);
    results.push({
      id: milestone.id,
      weight: milestone.weight,
      passed: result.passed,
      detail: result.detail
    });
    if (result.passed) {
      completionScore += milestone.weight;
    }
  }

  return { milestones: results, completionScore: Math.min(1.0, completionScore) };
}

// --- Skip Check ---

async function checkSkipCondition(session, skipWhen) {
  if (!skipWhen) return false;
  const result = await runVerifier(session, skipWhen);
  return result.passed;
}

// --- Scoring ---

function extractTraceMetrics(trace) {
  if (!trace) return { totalSteps: 0, totalErrors: 0, recoveredErrors: 0, wallClockMs: null };

  // Normalize: support aggregate.X, root-level X, and steps as array or number
  const agg = trace.aggregate || {};
  const stepsField = trace.steps;
  const stepsCount = typeof stepsField === 'number' ? stepsField
    : Array.isArray(stepsField) ? stepsField.length : 0;
  const totalSteps = agg.totalSteps || trace.totalSteps || stepsCount;
  const errorsField = agg.totalErrors ?? trace.errors ?? 0;
  const totalErrors = typeof errorsField === 'number' ? errorsField
    : Array.isArray(errorsField) ? errorsField.length : 0;
  const recoveredField = agg.recoveredErrors ?? trace.recoveredErrors ?? 0;
  const recoveredErrors = typeof recoveredField === 'number' ? recoveredField : 0;
  const wallClockMs = trace.wallClockMs || null;

  // Compute wallClock from timestamps if not directly available
  const computedWallClock = wallClockMs
    || (trace.endTs && trace.startTs ? trace.endTs - trace.startTs : null);

  return { totalSteps, totalErrors, recoveredErrors, wallClockMs: computedWallClock };
}

function computeTestScore(completionScore, trace, budget) {
  const metrics = extractTraceMetrics(trace);

  // Efficiency: penalize exceeding budget
  const maxSteps = budget?.maxSteps || 50;
  const efficiency = Math.max(0, 1 - Math.max(0, metrics.totalSteps - maxSteps) / maxSteps);

  // Resilience: error recovery
  const resilience = metrics.totalErrors === 0
    ? 1.0
    : 0.5 + 0.5 * (metrics.recoveredErrors / Math.max(1, metrics.totalErrors));

  // Response quality: fraction of response_checks passed (1.0 if none defined)
  const responseQuality = 1.0;

  // Composite
  const composite =
    0.60 * completionScore +
    0.15 * efficiency +
    0.10 * resilience +
    0.15 * responseQuality;

  return {
    completion: completionScore,
    efficiency: Math.round(efficiency * 1000) / 1000,
    resilience: Math.round(resilience * 1000) / 1000,
    responseQuality,
    composite: Math.round(composite * 1000) / 1000,
    stepsUsed: metrics.totalSteps,
    wallClockMs: metrics.wallClockMs
  };
}

function computeSHS(testResults) {
  if (testResults.length === 0) return 0;

  const passRate = testResults.filter(r => r.scores.completion >= 0.5).length / testResults.length;
  const avgCompletion = testResults.reduce((s, r) => s + r.scores.completion, 0) / testResults.length;
  const perfectRate = testResults.filter(r => r.scores.completion === 1.0).length / testResults.length;
  const avgEfficiency = testResults.reduce((s, r) => s + r.scores.efficiency, 0) / testResults.length;

  const categories = new Set(testResults.map(r => r.category));
  const passedCategories = new Set(
    testResults.filter(r => r.scores.completion >= 0.5).map(r => r.category)
  );
  const categoryCoverage = categories.size > 0 ? passedCategories.size / categories.size : 0;

  const shs = Math.round(
    40 * passRate +
    25 * avgCompletion +
    15 * perfectRate +
    10 * avgEfficiency +
    10 * categoryCoverage
  );

  return {
    shs,
    passRate: Math.round(passRate * 1000) / 1000,
    avgCompletion: Math.round(avgCompletion * 1000) / 1000,
    perfectRate: Math.round(perfectRate * 1000) / 1000,
    avgEfficiency: Math.round(avgEfficiency * 1000) / 1000,
    categoryCoverage: Math.round(categoryCoverage * 1000) / 1000
  };
}

// --- Single Test Validation ---

async function validateTest(testPath, host, port, targetId, urlHint, options = {}) {
  const testDef = JSON.parse(fs.readFileSync(testPath, 'utf8'));

  // Use pre-loaded trace from batch mode, or try loading from runDir
  let trace = options.trace || null;
  if (!trace && options.runDir) {
    const traceFile = path.join(options.runDir, `${testDef.id}.trace.json`);
    try { trace = JSON.parse(fs.readFileSync(traceFile, 'utf8')); } catch (e) { /* no trace */ }
  }

  // Snapshot-first path: evaluate offline from captured snapshot
  if (options.preferSnapshot && trace?.verificationSnapshot) {
    const validation = evaluateSnapshotOffline(trace.verificationSnapshot, testDef.milestones || []);
    const scores = computeTestScore(validation.completionScore, trace, testDef.budget);
    return {
      testId: testDef.id,
      category: testDef.category,
      status: validation.completionScore >= 0.5 ? 'pass' : 'fail',
      milestones: validation.milestones,
      scores,
      wallClockMs: scores.wallClockMs,
      validationSource: 'snapshot'
    };
  }

  // Live CDP path: connect to browser tab
  const target = await connectToTarget(host, port, targetId, urlHint);
  const session = await createCDPSession(target.webSocketDebuggerUrl);

  try {
    // Check skip condition
    if (testDef.skipWhen) {
      const shouldSkip = await checkSkipCondition(session, testDef.skipWhen);
      if (shouldSkip) {
        return { testId: testDef.id, status: 'skipped', reason: 'skipWhen condition met' };
      }
    }

    // Validate milestones
    const validation = await validateMilestones(session, testDef.milestones || []);

    // Compute scores
    const scores = computeTestScore(validation.completionScore, trace, testDef.budget);

    return {
      testId: testDef.id,
      category: testDef.category,
      status: validation.completionScore >= 0.5 ? 'pass' : 'fail',
      milestones: validation.milestones,
      scores,
      wallClockMs: scores.wallClockMs,
      validationSource: 'live-cdp'
    };
  } finally {
    session.close();
  }
}

// --- Tab Registry ---

function loadTabRegistry() {
  const registryPath = path.join(os.tmpdir(), 'cdp-skill-tabs.json');
  try {
    if (fs.existsSync(registryPath)) {
      return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return { tabs: {} };
}

function resolveTabAlias(alias) {
  const registry = loadTabRegistry();
  const entry = registry.tabs[alias];
  if (!entry) return alias;
  // Entry can be a string (legacy) or {targetId, host, port} object
  return typeof entry === 'string' ? entry : entry.targetId;
}

// --- Batch Validation ---

async function validateRunDir(runDir, testsDir, host, port, options = {}) {
  const testFiles = fs.readdirSync(testsDir)
    .filter(f => f.endsWith('.test.json'))
    .map(f => path.join(testsDir, f));

  const results = [];
  for (const testPath of testFiles) {
    const testDef = JSON.parse(fs.readFileSync(testPath, 'utf8'));
    const testId = testDef.id;

    // Find trace for this test to get targetId via tab alias
    // Trace files are named by test ID (e.g., "001-saucedemo-checkout.trace.json"),
    // not by test filename (e.g., "001-saucedemo.trace.json")
    const traceFile = path.join(runDir, `${testId}.trace.json`);
    let targetId = null;
    let urlHint = null;
    let trace = null;
    try {
      trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
      // Resolve tab alias (e.g., "t825") to CDP targetId
      const tabAlias = trace.tab || trace.tabId;
      if (tabAlias) {
        targetId = resolveTabAlias(tabAlias);
      }
      // Fallback to direct targetId field
      if (!targetId) targetId = trace.targetId || null;
      // Extract URL hint from trace finalState for URL-based tab matching
      if (!targetId) {
        urlHint = trace.finalState?.url || trace.finalUrl || null;
        // Extract domain from URL for broader matching
        if (urlHint) {
          try { urlHint = new URL(urlHint).hostname; } catch { /* keep full url */ }
        }
      }
    } catch (e) { /* no trace */ }

    try {
      const result = await validateTest(testPath, host, port, targetId, urlHint, { trace, runDir, preferSnapshot: options.preferSnapshot });
      results.push(result);

      // Write result file (named by test ID to match trace files)
      const resultFile = path.join(runDir, `${testId}.result.json`);
      fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
    } catch (err) {
      results.push({
        testId,
        status: 'error',
        error: err.message,
        scores: { completion: 0, efficiency: 0, resilience: 0, responseQuality: 0, composite: 0 }
      });
    }
  }

  return results;
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--test') flags.test = args[++i];
    else if (args[i] === '--run-dir') flags.runDir = args[++i];
    else if (args[i] === '--tests-dir') flags.testsDir = args[++i];
    else if (args[i] === '--port') flags.port = parseInt(args[++i], 10);
    else if (args[i] === '--host') flags.host = args[++i];
    else if (args[i] === '--target') flags.target = args[++i];
    else if (args[i] === '--prefer-snapshot') flags.preferSnapshot = true;
    else if (args[i] === '--no-prefer-snapshot') flags.preferSnapshot = false;
  }

  const host = flags.host || 'localhost';
  const port = flags.port || 9222;

  if (flags.test) {
    // Single test validation
    const result = await validateTest(flags.test, host, port, flags.target);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === 'pass' ? 0 : 1);
  }

  if (flags.runDir) {
    // Batch validation
    const testsDir = flags.testsDir || path.join(path.dirname(flags.runDir), '..', 'tests');
    const preferSnapshot = flags.preferSnapshot !== false; // default: true
    const results = await validateRunDir(flags.runDir, testsDir, host, port, { preferSnapshot });
    const shsResult = computeSHS(results);

    const summary = {
      timestamp: new Date().toISOString(),
      testsRun: results.length,
      ...shsResult,
      results
    };

    console.log(JSON.stringify(summary, null, 2));

    // Write summary
    const summaryFile = path.join(flags.runDir, 'validation-summary.json');
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

    process.exit(0);
  }

  console.error('Usage: node validator-harness.js --test <path> | --run-dir <path>');
  process.exit(1);
}

// Exports for use as module
export {
  runVerifier,
  validateMilestones,
  computeTestScore,
  computeSHS,
  validateTest,
  validateRunDir,
  extractTraceMetrics
};

// Run CLI if invoked directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('validator-harness.js') ||
  process.argv[1].endsWith('validator-harness')
);
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
