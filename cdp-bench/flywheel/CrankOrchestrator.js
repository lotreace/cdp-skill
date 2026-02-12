#!/usr/bin/env node
/**
 * CrankOrchestrator
 *
 * Two-phase orchestrator for MEASURE+VALIDATE+RECORD. Each phase is a
 * single bash command, with the LLM matching step sandwiched between.
 *
 * Phase 1 (validate):
 *   Read traces -> validate (snapshot-first, live fallback) -> SHS ->
 *   extract feedback -> write validate-result.json
 *
 * Phase 2 (record):
 *   Read match-decisions.json -> apply feedback -> record fix/crank ->
 *   update baseline -> rebuild dashboard -> write crank-summary.json
 *
 * Usage:
 *   node CrankOrchestrator.js --phase validate \
 *     --run-dir <path> --tests-dir <path> \
 *     --improvements <path> --baselines-dir <path> \
 *     --port 9222 [--version <ver>] [--crank <N>]
 *
 *   node CrankOrchestrator.js --phase record \
 *     --run-dir <path> --tests-dir <path> \
 *     --improvements <path> --baselines-dir <path> \
 *     [--version <ver>] [--crank <N>] \
 *     [--fix-issue <id>] [--fix-outcome <outcome>]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';
import { evaluateSnapshotOffline, buildCaptureExpression } from './VerificationSnapshot.js';
import { computeTestScore, computeSHS, validateRunDir } from './validator-harness.js';
import {
  readLatestBaseline,
  writeBaseline,
  appendTrend
} from './baseline-manager.js';
import { createFeedbackExtractor } from './FeedbackExtractor.js';
import { createFeedbackApplier } from './FeedbackApplier.js';
import { createFlywheelRecorder } from './FlywheelRecorder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Snapshot Capture ---

function loadTabRegistry() {
  const registryPath = path.join(os.tmpdir(), 'cdp-skill-tabs.json');
  try {
    if (fs.existsSync(registryPath)) {
      return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    }
  } catch { /* ignore */ }
  return { tabs: {} };
}

function resolveTabAlias(alias) {
  const registry = loadTabRegistry();
  const entry = registry.tabs[alias];
  if (!entry) return alias;
  return typeof entry === 'string' ? entry : entry.targetId;
}

/**
 * Capture verification snapshots for all traces that have invalid/missing snapshots.
 * This runs BEFORE validation to ensure all traces have proper snapshots.
 * Does NOT depend on runners - orchestrator captures directly via CDP.
 */
async function captureSnapshotsForTraces(runDir, testsDir, host, port) {
  const traceFiles = fs.readdirSync(runDir).filter(f => f.endsWith('.trace.json'));
  let captured = 0;
  let skipped = 0;
  let failed = 0;

  for (const traceFile of traceFiles) {
    const tracePath = path.join(runDir, traceFile);
    const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));

    // Check if snapshot is already valid
    const snapshot = trace.verificationSnapshot;
    if (snapshot && snapshot.milestones && typeof snapshot.milestones === 'object') {
      skipped++;
      continue;
    }

    // Need to capture - find the test definition
    const testId = trace.testId;
    const testFile = fs.readdirSync(testsDir).find(f => {
      if (!f.endsWith('.test.json')) return false;
      const def = JSON.parse(fs.readFileSync(path.join(testsDir, f), 'utf8'));
      return def.id === testId;
    });

    if (!testFile) {
      failed++;
      continue;
    }

    const testDef = JSON.parse(fs.readFileSync(path.join(testsDir, testFile), 'utf8'));
    const milestones = testDef.milestones || [];

    if (milestones.length === 0) {
      skipped++;
      continue;
    }

    // Resolve tab alias to target ID
    const tabAlias = trace.tabId || trace.tab;
    if (!tabAlias) {
      failed++;
      continue;
    }

    const targetId = resolveTabAlias(tabAlias);

    // Try to capture snapshot via CDP
    try {
      const newSnapshot = await captureSnapshotForTab(host, port, targetId, milestones);
      if (newSnapshot && newSnapshot.milestones) {
        trace.verificationSnapshot = newSnapshot;
        fs.writeFileSync(tracePath, JSON.stringify(trace, null, 2));
        captured++;
      } else {
        failed++;
      }
    } catch (err) {
      // Tab likely closed or unreachable
      failed++;
    }
  }

  return { captured, skipped, failed, total: traceFiles.length };
}

async function captureSnapshotForTab(host, port, targetId, milestones) {
  // Find target
  const targets = await new Promise((resolve, reject) => {
    const req = http.get(`http://${host}:${port}/json`, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('HTTP timeout')); });
  });

  const target = targets.find(t =>
    t.id === targetId || t.id === targetId?.toLowerCase()
  );
  if (!target) throw new Error(`Target ${targetId} not found`);

  // Connect via WebSocket and evaluate
  const expression = buildCaptureExpression(milestones);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let msgId = 0;
    const pending = new Map();
    const timer = setTimeout(() => { ws.close(); reject(new Error('WS timeout')); }, 10000);

    ws.onopen = async () => {
      clearTimeout(timer);
      try {
        const id = ++msgId;
        const result = await new Promise((res, rej) => {
          const t = setTimeout(() => { pending.delete(id); rej(new Error('Eval timeout')); }, 10000);
          pending.set(id, { resolve: res, reject: rej, timeout: t });
          ws.send(JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true, awaitPromise: false }
          }));
        });

        ws.close();
        if (result.exceptionDetails) {
          resolve(null);
        } else {
          resolve(result.result?.value || null);
        }
      } catch (e) {
        ws.close();
        reject(e);
      }
    };

    ws.onmessage = event => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej, timeout: t } = pending.get(msg.id);
        clearTimeout(t);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };

    ws.onerror = err => { clearTimeout(timer); reject(err); };
    ws.onclose = () => {
      clearTimeout(timer);
      for (const { reject: rej, timeout: t } of pending.values()) {
        clearTimeout(t);
        rej(new Error('WS closed'));
      }
    };
  });
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phase') flags.phase = args[++i];
    else if (args[i] === '--run-dir') flags.runDir = args[++i];
    else if (args[i] === '--tests-dir') flags.testsDir = args[++i];
    else if (args[i] === '--improvements') flags.improvements = args[++i];
    else if (args[i] === '--baselines-dir') flags.baselinesDir = args[++i];
    else if (args[i] === '--port') flags.port = parseInt(args[++i], 10);
    else if (args[i] === '--host') flags.host = args[++i];
    else if (args[i] === '--version') flags.version = args[++i];
    else if (args[i] === '--crank') flags.crank = parseInt(args[++i], 10);
    else if (args[i] === '--fix-issue') flags.fixIssue = args[++i];
    else if (args[i] === '--fix-outcome') flags.fixOutcome = args[++i];
  }
  return flags;
}

// --- Phase: Validate ---

async function runValidatePhase(flags) {
  const { runDir, testsDir, improvements: improvementsPath, baselinesDir, port, host, version, crank } = flags;

  // 0. Capture snapshots for any traces with invalid/missing snapshots
  // This ensures we don't depend on runners capturing snapshots correctly
  const captureResult = await captureSnapshotsForTraces(runDir, testsDir, host || 'localhost', port || 9222);
  if (captureResult.captured > 0) {
    console.error(`Captured ${captureResult.captured} snapshots (${captureResult.skipped} already valid, ${captureResult.failed} failed)`);
  }

  // 1. Validate all traces (snapshot-first, live CDP fallback)
  const results = await validateRunDir(
    runDir, testsDir, host || 'localhost', port || 9222,
    { preferSnapshot: true }
  );

  // 2. Compute SHS
  const shsResult = computeSHS(results);

  // Build runData in the shape baseline-manager expects
  const testResults = results.map(r => ({
    testId: r.testId,
    category: r.category,
    completion: r.scores?.completion || 0,
    efficiency: r.scores?.efficiency || 0,
    resilience: r.scores?.resilience || 0,
    composite: r.scores?.composite || 0
  }));

  const runData = {
    timestamp: new Date().toISOString(),
    shs: shsResult.shs,
    ...shsResult,
    testResults
  };

  const baseline = readLatestBaseline(baselinesDir);

  // 3. Extract feedback
  let feedbackExtracted = 0;
  try {
    const extractor = createFeedbackExtractor(runDir);
    const fbResult = extractor.extract();
    feedbackExtracted = fbResult.totalDeduped;
  } catch (err) {
    console.error(`Feedback extraction warning: ${err.message}`);
  }

  // 4. Identify missing traces and validation sources
  const testFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.json'));
  const traceIds = new Set(results.map(r => r.testId));
  const allTestIds = testFiles.map(f => {
    const def = JSON.parse(fs.readFileSync(path.join(testsDir, f), 'utf8'));
    return def.id;
  });
  const missingTraces = allTestIds.filter(id => !traceIds.has(id));

  const snapshotCount = results.filter(r => r.validationSource === 'snapshot').length;
  const liveCount = results.filter(r => r.validationSource === 'live-cdp').length;

  // 5. Write validate-result.json
  const validateResult = {
    phase: 'validate',
    shs: shsResult.shs,
    shsDelta: baseline ? shsResult.shs - baseline.shs : null,
    testsRun: results.length,
    testsPassed: results.filter(r => r.status === 'pass').length,
    testsPerfect: results.filter(r => r.scores?.completion === 1.0).length,
    missingTraces,
    feedbackExtracted,
    validationSources: { snapshot: snapshotCount, liveCdp: liveCount },
    version,
    crank,
    results: results.map(r => ({
      testId: r.testId,
      status: r.status,
      completion: r.scores?.completion || 0,
      composite: r.scores?.composite || 0,
      validationSource: r.validationSource
    }))
  };

  // Write full results for later consumption
  const summaryPath = path.join(runDir, 'validation-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    timestamp: runData.timestamp,
    testsRun: results.length,
    ...shsResult,
    results
  }, null, 2));

  const validateResultPath = path.join(runDir, 'validate-result.json');
  fs.writeFileSync(validateResultPath, JSON.stringify(validateResult, null, 2));

  // Write per-test result files
  for (const result of results) {
    const resultFile = path.join(runDir, `${result.testId}.result.json`);
    fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  }

  // Print compact JSON to stdout for conductor
  const output = { ...validateResult };
  delete output.results; // keep stdout compact
  console.log(JSON.stringify(output, null, 2));

  return validateResult;
}

// --- Phase: Record ---

async function runRecordPhase(flags) {
  const { runDir, testsDir, improvements: improvementsPath, baselinesDir, version, crank, fixIssue, fixOutcome } = flags;

  const historyPath = path.join(baselinesDir, 'flywheel-history.jsonl');
  const recorder = createFlywheelRecorder(improvementsPath, historyPath);

  // Read validation result from the validate phase
  const validateResultPath = path.join(runDir, 'validate-result.json');
  let validateResult;
  try {
    validateResult = JSON.parse(fs.readFileSync(validateResultPath, 'utf8'));
  } catch (err) {
    console.error(`Cannot read validate-result.json: ${err.message}`);
    console.error('Run --phase validate first');
    process.exit(1);
  }

  // 1. Apply feedback (if match-decisions.json exists)
  let feedbackSummary = { matched: 0, newIssues: 0, upvoted: 0 };
  const decisionsPath = path.join(runDir, 'match-decisions.json');
  if (fs.existsSync(decisionsPath)) {
    try {
      const applier = createFeedbackApplier(improvementsPath);
      const result = applier.apply(runDir, { apply: true });
      feedbackSummary = {
        matched: result.summary.matched,
        newIssues: result.summary.newIssues,
        upvoted: result.upvoted?.length || 0
      };
    } catch (err) {
      console.error(`Feedback apply warning: ${err.message}`);
    }
  }

  // 2. Record fix outcome
  if (fixIssue && fixOutcome) {
    try {
      await recorder.recordFixOutcome(fixIssue, fixOutcome, {
        crank,
        version,
        shsDelta: validateResult.shsDelta
      });

      if (fixOutcome === 'fixed') {
        await recorder.moveToImplemented(fixIssue, `Crank ${crank}: fixed in v${version}`);
      }
    } catch (err) {
      console.error(`Fix record warning: ${err.message}`);
    }
  }

  // 3. Record crank summary
  await recorder.recordCrankSummary({
    crank,
    shs: validateResult.shs,
    shsDelta: validateResult.shsDelta,
    fixAttempt: fixIssue ? { issueId: fixIssue, outcome: fixOutcome, version } : null,
    testsRun: validateResult.testsRun,
    testsPassed: validateResult.testsPassed,
    testsPerfect: validateResult.testsPerfect,
    feedbackExtracted: validateResult.feedbackExtracted,
    feedbackMatched: feedbackSummary.matched
  });

  // 4. Update baseline + trend
  const runData = {
    timestamp: new Date().toISOString(),
    shs: validateResult.shs,
    passRate: validateResult.testsPassed / Math.max(1, validateResult.testsRun),
    avgCompletion: 0,
    avgEfficiency: 0,
    totalTests: validateResult.testsRun,
    passed: validateResult.testsPassed,
    perfect: validateResult.testsPerfect,
    testResults: validateResult.results?.map(r => ({
      testId: r.testId,
      category: r.category,
      completion: r.completion,
      composite: r.composite
    })) || []
  };

  if (runData.testResults.length > 0) {
    runData.avgCompletion = runData.testResults.reduce((s, r) => s + r.completion, 0) / runData.testResults.length;
    runData.avgEfficiency = runData.testResults.reduce((s, r) => s + (r.composite || 0), 0) / runData.testResults.length;
  }

  writeBaseline(runData, version, baselinesDir);
  appendTrend(runData, version, baselinesDir);

  // 5. Rebuild dashboard
  let dashboardRebuilt = false;
  try {
    const dashboardScript = path.resolve(__dirname, '../../dashboard/scripts/build-dataset.js');
    if (fs.existsSync(dashboardScript)) {
      execSync(`node ${dashboardScript}`, { stdio: 'pipe' });
      dashboardRebuilt = true;
    }
  } catch (err) {
    console.error(`Dashboard rebuild warning: ${err.message}`);
  }

  // 6. Write crank-summary.json
  const crankSummary = {
    phase: 'record',
    crank,
    version,
    shs: validateResult.shs,
    shsDelta: validateResult.shsDelta,
    fixIssue,
    fixOutcome,
    feedbackMatched: feedbackSummary.matched,
    issuesCreated: feedbackSummary.newIssues,
    issuesUpvoted: feedbackSummary.upvoted,
    dashboardRebuilt
  };

  const crankSummaryPath = path.join(runDir, 'crank-summary.json');
  fs.writeFileSync(crankSummaryPath, JSON.stringify(crankSummary, null, 2));

  // Print compact JSON to stdout
  console.log(JSON.stringify(crankSummary, null, 2));

  return crankSummary;
}

// --- CLI ---

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  if (!flags.phase || !flags.runDir || !flags.testsDir) {
    console.error('Usage: node CrankOrchestrator.js --phase <validate|record> --run-dir <path> --tests-dir <path> --improvements <path> --baselines-dir <path> [options]');
    process.exit(1);
  }

  // Defaults
  flags.improvements = flags.improvements || 'improvements.json';
  flags.baselinesDir = flags.baselinesDir || path.join(__dirname, '..', 'baselines');

  if (flags.phase === 'validate') {
    await runValidatePhase(flags);
  } else if (flags.phase === 'record') {
    await runRecordPhase(flags);
  } else {
    console.error(`Unknown phase: ${flags.phase}. Use "validate" or "record".`);
    process.exit(1);
  }
}

export { runValidatePhase, runRecordPhase };

const isMain = process.argv[1] && (
  process.argv[1].endsWith('CrankOrchestrator.js') ||
  process.argv[1].endsWith('CrankOrchestrator')
);
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
