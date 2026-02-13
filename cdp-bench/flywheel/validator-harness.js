#!/usr/bin/env node
/**
 * Validator Harness
 *
 * Reads runner self-reported milestoneResults from trace files and computes
 * per-test scores + aggregate SHS. No live browser connection needed.
 *
 * Usage:
 *   node validator-harness.js --run-dir cdp-bench/runs/2026-02-01T12-00-00
 *   node validator-harness.js --run-dir cdp-bench/runs/... --tests-dir cdp-bench/tests
 */

import fs from 'fs';
import path from 'path';
import { computeSHS as computeSHSScore } from './shs-calculator.js';

// --- Scoring ---

function extractTraceMetrics(trace) {
  if (!trace) return { wallClockMs: null };
  return { wallClockMs: trace.wallClockMs || null };
}

function computeTestScore(completionScore, trace) {
  const metrics = extractTraceMetrics(trace);

  // Runners self-report milestoneResults only — no step/error counts available.
  // Composite is weighted by completion (primary signal) with a fixed baseline
  // for efficiency/resilience/responseQuality since traces don't carry that data.
  const composite =
    0.60 * completionScore +
    0.15 * 1.0 +  // efficiency (no step count in trace)
    0.10 * 1.0 +  // resilience (no error count in trace)
    0.15 * 1.0;   // responseQuality

  return {
    completion: completionScore,
    efficiency: 1.0,
    resilience: 1.0,
    responseQuality: 1.0,
    composite: Math.round(composite * 1000) / 1000,
    wallClockMs: metrics.wallClockMs
  };
}

function computeSHS(testResults) {
  if (testResults.length === 0) return 0;

  const passRate = testResults.filter(r => r.scores?.completion >= 0.5).length / testResults.length;
  const avgCompletion = testResults.reduce((s, r) => s + (r.scores?.completion || 0), 0) / testResults.length;
  const perfectRate = testResults.filter(r => r.scores?.completion === 1.0).length / testResults.length;
  const avgEfficiency = testResults.reduce((s, r) => s + (r.scores?.efficiency || 0), 0) / testResults.length;

  const categories = new Set(testResults.map(r => r.category));
  const passedCategories = new Set(
    testResults.filter(r => r.scores?.completion >= 0.5).map(r => r.category)
  );
  const categoryCoverage = categories.size > 0 ? passedCategories.size / categories.size : 0;

  const shs = computeSHSScore(passRate, avgCompletion, perfectRate, avgEfficiency, categoryCoverage);

  return {
    shs,
    passRate: Math.round(passRate * 1000) / 1000,
    avgCompletion: Math.round(avgCompletion * 1000) / 1000,
    perfectRate: Math.round(perfectRate * 1000) / 1000,
    avgEfficiency: Math.round(avgEfficiency * 1000) / 1000,
    categoryCoverage: Math.round(categoryCoverage * 1000) / 1000
  };
}

// --- Single Test Validation (from trace) ---

function validateTest(testPath, options = {}) {
  const testDef = JSON.parse(fs.readFileSync(testPath, 'utf8'));
  const milestones = testDef.milestones || [];

  let trace = options.trace || null;
  if (!trace && options.runDir) {
    const traceFile = path.join(options.runDir, `${testDef.id}.trace.json`);
    try { trace = JSON.parse(fs.readFileSync(traceFile, 'utf8')); } catch (e) {
      // Fallback: scan all trace files for matching testId field
      const traceFiles = fs.readdirSync(options.runDir).filter(f => f.endsWith('.trace.json'));
      for (const f of traceFiles) {
        try {
          const candidate = JSON.parse(fs.readFileSync(path.join(options.runDir, f), 'utf8'));
          if (candidate.testId === testDef.id) { trace = candidate; break; }
        } catch (e2) { /* skip malformed trace */ }
      }
    }
  }

  // Use runner's self-reported milestoneResults
  if (trace?.milestoneResults && typeof trace.milestoneResults === 'object') {
    const results = [];
    let completionScore = 0;

    for (const milestone of milestones) {
      const passed = !!trace.milestoneResults[milestone.id];
      results.push({
        id: milestone.id,
        weight: milestone.weight,
        passed,
        detail: passed ? 'runner verified' : 'runner reported failure'
      });
      if (passed) completionScore += milestone.weight;
    }

    completionScore = Math.min(1.0, completionScore);
    const scores = computeTestScore(completionScore, trace);

    return {
      testId: testDef.id,
      category: testDef.category,
      status: completionScore >= 0.5 ? 'pass' : 'fail',
      milestones: results,
      scores,
      wallClockMs: scores.wallClockMs,
      validationSource: 'runner'
    };
  }

  // No milestoneResults in trace — test gets score 0
  const results = milestones.map(m => ({
    id: m.id,
    weight: m.weight,
    passed: false,
    detail: trace ? 'milestoneResults missing from trace' : 'no trace file found'
  }));

  const scores = computeTestScore(0, trace);

  return {
    testId: testDef.id,
    category: testDef.category,
    status: 'fail',
    milestones: results,
    scores,
    wallClockMs: scores.wallClockMs,
    validationSource: trace ? 'trace-incomplete' : 'no-trace'
  };
}

// --- Batch Validation ---

function validateRunDir(runDir, testsDir) {
  const testFiles = fs.readdirSync(testsDir)
    .filter(f => f.endsWith('.test.json'))
    .map(f => path.join(testsDir, f));

  const results = [];
  for (const testPath of testFiles) {
    const testDef = JSON.parse(fs.readFileSync(testPath, 'utf8'));
    const testId = testDef.id;

    let trace = null;
    const traceFile = path.join(runDir, `${testId}.trace.json`);
    try { trace = JSON.parse(fs.readFileSync(traceFile, 'utf8')); } catch (e) {
      // Fallback: scan all trace files for matching testId field
      const traceFiles = fs.readdirSync(runDir).filter(f => f.endsWith('.trace.json'));
      for (const f of traceFiles) {
        try {
          const candidate = JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf8'));
          if (candidate.testId === testId) { trace = candidate; break; }
        } catch (e2) { /* skip malformed trace */ }
      }
    }

    const result = validateTest(testPath, { trace, runDir });
    results.push(result);

    const resultFile = path.join(runDir, `${testId}.result.json`);
    fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  }

  return results;
}

// --- CLI ---

function main() {
  const args = process.argv.slice(2);
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-dir') flags.runDir = args[++i];
    else if (args[i] === '--tests-dir') flags.testsDir = args[++i];
  }

  if (flags.runDir) {
    const testsDir = flags.testsDir || path.join(path.dirname(flags.runDir), '..', 'tests');
    const results = validateRunDir(flags.runDir, testsDir);
    const shsResult = computeSHS(results);

    const summary = {
      timestamp: new Date().toISOString(),
      testsRun: results.length,
      ...shsResult,
      results
    };

    console.log(JSON.stringify(summary, null, 2));

    const summaryFile = path.join(flags.runDir, 'validation-summary.json');
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

    process.exit(0);
  }

  console.error('Usage: node validator-harness.js --run-dir <path> [--tests-dir <path>]');
  process.exit(1);
}

// Exports for use as module
export {
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
if (isMain) main();
