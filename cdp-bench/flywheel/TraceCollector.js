#!/usr/bin/env node
/**
 * TraceCollector
 *
 * Polls a run directory for expected trace files from runner agents.
 * Returns a compact summary when all traces arrive or timeout is reached.
 * Prevents context window bloat by replacing per-agent TaskOutput reads
 * with a single file-system poll.
 *
 * Usage:
 *   node TraceCollector.js --run-dir <path> --tests-dir <path> [--timeout 600] [--poll 10] [--test 001]
 *
 * Options:
 *   --run-dir    Directory where runners write .trace.json files
 *   --tests-dir  Directory containing .test.json definitions
 *   --timeout    Max seconds to wait (default: 600 = 10 min)
 *   --poll       Seconds between checks (default: 10)
 *   --test       Prefix filter for a single test
 */

import fs from 'fs';
import path from 'path';

function createTraceCollector({ runDir, testsDir, timeoutSec = 600, pollSec = 10, testPrefix = null }) {
  function discoverExpectedTests() {
    const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.json'));
    const tests = [];
    for (const file of files) {
      const def = JSON.parse(fs.readFileSync(path.join(testsDir, file), 'utf8'));
      if (testPrefix && !def.id.startsWith(testPrefix)) continue;
      tests.push({ id: def.id, file, category: def.category });
    }
    return tests;
  }

  function checkTraceStatus(expectedTests) {
    const found = [];
    const missing = [];

    for (const test of expectedTests) {
      const traceFile = path.join(runDir, `${test.id}.trace.json`);
      if (fs.existsSync(traceFile)) {
        try {
          const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
          found.push({
            testId: test.id,
            category: test.category,
            steps: trace.aggregate?.totalSteps || trace.totalSteps || (Array.isArray(trace.steps) ? trace.steps.length : trace.steps) || 0,
            errors: trace.aggregate?.totalErrors || trace.errors || 0,
            wallClockMs: trace.wallClockMs || 0,
            tabId: trace.tab || trace.tabId || null,
            hasSnapshot: !!trace.verificationSnapshot
          });
        } catch (e) {
          found.push({ testId: test.id, category: test.category, parseError: e.message });
        }
      } else {
        missing.push(test.id);
      }
    }

    return { found, missing, complete: missing.length === 0 };
  }

  function formatSummary(status, elapsedSec) {
    const lines = [
      `=== Trace Collection: ${status.found.length}/${status.found.length + status.missing.length} traces collected (${elapsedSec}s) ===`
    ];

    for (const t of status.found) {
      if (t.parseError) {
        lines.push(`  ${t.testId}: PARSE_ERROR (${t.parseError})`);
      } else {
        lines.push(`  ${t.testId}: steps=${t.steps} errors=${t.errors} wall=${t.wallClockMs}ms tab=${t.tabId} snap=${t.hasSnapshot ? 'yes' : 'no'}`);
      }
    }

    if (status.missing.length > 0) {
      lines.push(`  MISSING: ${status.missing.join(', ')}`);
    }

    return lines.join('\n');
  }

  async function collect() {
    const expectedTests = discoverExpectedTests();
    if (expectedTests.length === 0) {
      console.log(JSON.stringify({ error: 'No matching test definitions found', testsDir, testPrefix }));
      return { error: 'No matching tests' };
    }

    console.error(`Waiting for ${expectedTests.length} traces in ${runDir} (timeout: ${timeoutSec}s, poll: ${pollSec}s)`);

    const startTime = Date.now();
    const deadlineMs = startTime + timeoutSec * 1000;

    while (Date.now() < deadlineMs) {
      const status = checkTraceStatus(expectedTests);
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);

      if (status.complete) {
        const summary = formatSummary(status, elapsedSec);
        console.error(summary);
        const result = {
          status: 'complete',
          elapsedSec,
          total: expectedTests.length,
          collected: status.found.length,
          traces: status.found
        };
        console.log(JSON.stringify(result, null, 2));
        return result;
      }

      console.error(`  [${elapsedSec}s] ${status.found.length}/${expectedTests.length} traces, waiting for: ${status.missing.join(', ')}`);
      await new Promise(r => setTimeout(r, pollSec * 1000));
    }

    // Timeout reached
    const finalStatus = checkTraceStatus(expectedTests);
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    const summary = formatSummary(finalStatus, elapsedSec);
    console.error(summary);

    const result = {
      status: 'timeout',
      elapsedSec,
      total: expectedTests.length,
      collected: finalStatus.found.length,
      missing: finalStatus.missing,
      traces: finalStatus.found
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  return { collect, checkTraceStatus, discoverExpectedTests };
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-dir') flags.runDir = args[++i];
    else if (args[i] === '--tests-dir') flags.testsDir = args[++i];
    else if (args[i] === '--timeout') flags.timeout = parseInt(args[++i], 10);
    else if (args[i] === '--poll') flags.poll = parseInt(args[++i], 10);
    else if (args[i] === '--test') flags.test = args[++i];
  }

  if (!flags.runDir || !flags.testsDir) {
    console.error('Usage: node TraceCollector.js --run-dir <path> --tests-dir <path> [--timeout 600] [--poll 10] [--test prefix]');
    process.exit(1);
  }

  const collector = createTraceCollector({
    runDir: flags.runDir,
    testsDir: flags.testsDir,
    timeoutSec: flags.timeout || 600,
    pollSec: flags.poll || 10,
    testPrefix: flags.test || null
  });

  const result = await collector.collect();
  process.exit(result.status === 'complete' ? 0 : 1);
}

export { createTraceCollector };

const isMain = process.argv[1] && (
  process.argv[1].endsWith('TraceCollector.js') ||
  process.argv[1].endsWith('TraceCollector')
);
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
