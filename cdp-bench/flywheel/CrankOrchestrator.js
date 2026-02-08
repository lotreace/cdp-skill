#!/usr/bin/env node
/**
 * CrankOrchestrator
 *
 * Two-phase orchestrator for MEASURE+VALIDATE+RECORD. Each phase is a
 * single bash command, with the LLM matching step sandwiched between.
 *
 * Phase 1 (validate):
 *   Read traces -> validate (snapshot-first, live fallback) -> SHS ->
 *   regression gate -> extract feedback -> write validate-result.json
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
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { evaluateSnapshotOffline } from './VerificationSnapshot.js';
import { computeTestScore, computeSHS, validateRunDir } from './validator-harness.js';
import {
  readLatestBaseline,
  readFlakiness,
  checkRegressionGate,
  writeBaseline,
  appendTrend
} from './baseline-manager.js';
import { createFeedbackExtractor } from './FeedbackExtractor.js';
import { createFeedbackApplier } from './FeedbackApplier.js';
import { createFlywheelRecorder } from './FlywheelRecorder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  // 3. Regression gate
  const baseline = readLatestBaseline(baselinesDir);
  const flakiness = readFlakiness(baselinesDir);
  const gate = checkRegressionGate(runData, baseline, flakiness);

  // 4. Extract feedback
  let feedbackExtracted = 0;
  try {
    const extractor = createFeedbackExtractor(runDir);
    const fbResult = extractor.extract();
    feedbackExtracted = fbResult.totalDeduped;
  } catch (err) {
    console.error(`Feedback extraction warning: ${err.message}`);
  }

  // 5. Identify missing traces and validation sources
  const testFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.json'));
  const traceIds = new Set(results.map(r => r.testId));
  const allTestIds = testFiles.map(f => {
    const def = JSON.parse(fs.readFileSync(path.join(testsDir, f), 'utf8'));
    return def.id;
  });
  const missingTraces = allTestIds.filter(id => !traceIds.has(id));

  const snapshotCount = results.filter(r => r.validationSource === 'snapshot').length;
  const liveCount = results.filter(r => r.validationSource === 'live-cdp').length;

  // 6. Write validate-result.json
  const validateResult = {
    phase: 'validate',
    shs: shsResult.shs,
    shsDelta: baseline ? shsResult.shs - baseline.shs : null,
    gate: gate.passed ? 'passed' : 'failed',
    gateIssues: gate.issues,
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
  delete output.gateIssues;
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
      recorder.recordFixOutcome(fixIssue, fixOutcome, {
        crank,
        version,
        shsDelta: validateResult.shsDelta
      });

      if (fixOutcome === 'fixed') {
        recorder.moveToImplemented(fixIssue, `Crank ${crank}: fixed in v${version}`);
      }
    } catch (err) {
      console.error(`Fix record warning: ${err.message}`);
    }
  }

  // 3. Record crank summary
  recorder.recordCrankSummary({
    crank,
    shs: validateResult.shs,
    shsDelta: validateResult.shsDelta,
    fixAttempt: fixIssue ? { issueId: fixIssue, outcome: fixOutcome, version } : null,
    testsRun: validateResult.testsRun,
    testsPassed: validateResult.testsPassed,
    testsPerfect: validateResult.testsPerfect,
    feedbackExtracted: validateResult.feedbackExtracted,
    feedbackMatched: feedbackSummary.matched,
    gate: validateResult.gate
  });

  // 4. Update baseline + trend (if gate passed)
  let baselineUpdated = false;
  if (validateResult.gate === 'passed') {
    // Build runData shape for baseline-manager
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

    // Compute averages from results
    if (runData.testResults.length > 0) {
      runData.avgCompletion = runData.testResults.reduce((s, r) => s + r.completion, 0) / runData.testResults.length;
      runData.avgEfficiency = runData.testResults.reduce((s, r) => s + (r.composite || 0), 0) / runData.testResults.length;
    }

    writeBaseline(runData, version, baselinesDir);
    appendTrend(runData, version, baselinesDir);
    baselineUpdated = true;
  }

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
    gate: validateResult.gate,
    fixIssue,
    fixOutcome,
    feedbackMatched: feedbackSummary.matched,
    issuesCreated: feedbackSummary.newIssues,
    issuesUpvoted: feedbackSummary.upvoted,
    baselineUpdated,
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
