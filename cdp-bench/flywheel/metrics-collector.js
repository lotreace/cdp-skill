/**
 * Metrics Collector
 *
 * Aggregates I/O byte metrics from traces and metrics files.
 * Computes per-test scoring dimensions and Skill Health Score (SHS).
 */

import fs from 'fs';
import path from 'path';
import { computeSHS as computeSHSScore } from './shs-calculator.js';

// --- Metrics from Trace ---

function extractTraceMetrics(trace) {
  const cliCalls = trace.cliCalls || [];
  const aggregate = trace.aggregate || {};

  return {
    cliInvocations: cliCalls.length,
    totalSteps: aggregate.totalSteps || cliCalls.reduce((s, c) => s + (c.input?.steps?.length || 0), 0),
    wallClockMs: trace.wallClockMs || 0,
    errorCount: aggregate.totalErrors || 0,
    recoveredErrors: aggregate.recoveredErrors || 0,
    autoForceCount: aggregate.autoForceCount || 0,
    jsClickFallbackCount: aggregate.jsClickFallbackCount || 0,
    totalResponseBytes: aggregate.totalResponseBytes || cliCalls.reduce((s, c) => s + (c.responseBytes || 0), 0),
    totalInputBytes: aggregate.totalInputBytes || cliCalls.reduce((s, c) => s + (c.inputBytes || 0), 0),
    workaroundCount: aggregate.workaroundCount || 0
  };
}

// --- Metrics from CDP_METRICS_FILE ---

function readMetricsFile(metricsFilePath) {
  if (!fs.existsSync(metricsFilePath)) return [];

  const lines = fs.readFileSync(metricsFilePath, 'utf8').trim().split('\n');
  return lines.filter(l => l.trim()).map(line => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean);
}

function aggregateMetricsFile(entries) {
  if (entries.length === 0) return { totalInputBytes: 0, totalOutputBytes: 0, totalSteps: 0, totalTimeMs: 0 };

  return {
    totalInputBytes: entries.reduce((s, e) => s + (e.input_bytes || 0), 0),
    totalOutputBytes: entries.reduce((s, e) => s + (e.output_bytes || 0), 0),
    totalSteps: entries.reduce((s, e) => s + (e.steps || 0), 0),
    totalTimeMs: entries.reduce((s, e) => s + (e.time_ms || 0), 0),
    invocations: entries.length
  };
}

// --- Per-Test Scoring ---

function computeTestScores(completionScore, metrics, budget) {
  const maxSteps = budget?.maxSteps || 50;
  const stepsUsed = metrics?.totalSteps || 0;
  const efficiency = Math.max(0, 1 - Math.max(0, stepsUsed - maxSteps) / maxSteps);

  const errors = metrics?.errorCount || 0;
  const recovered = metrics?.recoveredErrors || 0;
  const resilience = errors === 0 ? 1.0 : 0.5 + 0.5 * (recovered / Math.max(1, errors));

  const responseQuality = 1.0; // placeholder until response_checks are defined

  const composite =
    0.60 * completionScore +
    0.15 * efficiency +
    0.10 * resilience +
    0.15 * responseQuality;

  return {
    completion: completionScore,
    efficiency: round3(efficiency),
    resilience: round3(resilience),
    responseQuality: round3(responseQuality),
    composite: round3(composite)
  };
}

// --- Skill Health Score ---

function computeSHS(testResults) {
  if (testResults.length === 0) return { shs: 0 };

  const passRate = testResults.filter(r => r.completion >= 0.5).length / testResults.length;
  const avgCompletion = testResults.reduce((s, r) => s + r.completion, 0) / testResults.length;
  const perfectRate = testResults.filter(r => r.completion === 1.0).length / testResults.length;
  const avgEfficiency = testResults.reduce((s, r) => s + (r.efficiency || 0), 0) / testResults.length;

  const categories = new Set(testResults.map(r => r.category).filter(Boolean));
  const passedCategories = new Set(
    testResults.filter(r => r.completion >= 0.5).map(r => r.category).filter(Boolean)
  );
  const categoryCoverage = categories.size > 0 ? passedCategories.size / categories.size : 0;

  const shs = computeSHSScore(passRate, avgCompletion, perfectRate, avgEfficiency, categoryCoverage);

  return {
    shs,
    passRate: round3(passRate),
    avgCompletion: round3(avgCompletion),
    perfectRate: round3(perfectRate),
    avgEfficiency: round3(avgEfficiency),
    categoryCoverage: round3(categoryCoverage),
    totalTests: testResults.length,
    passed: testResults.filter(r => r.completion >= 0.5).length,
    perfect: testResults.filter(r => r.completion === 1.0).length
  };
}

// --- Aggregate Run Metrics ---

function collectRunMetrics(runDir) {
  const resultFiles = fs.readdirSync(runDir)
    .filter(f => f.endsWith('.result.json'))
    .map(f => path.join(runDir, f));

  const testResults = [];
  const metricsTable = [];

  for (const file of resultFiles) {
    try {
      const result = JSON.parse(fs.readFileSync(file, 'utf8'));
      testResults.push({
        testId: result.testId,
        category: result.category,
        completion: result.scores?.completion || 0,
        efficiency: result.scores?.efficiency || 0,
        resilience: result.scores?.resilience || 0,
        composite: result.scores?.composite || 0
      });

      // Load trace if available
      const traceFile = file.replace('.result.json', '.trace.json');
      if (fs.existsSync(traceFile)) {
        const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
        const metrics = extractTraceMetrics(trace);
        metricsTable.push({ testId: result.testId, ...metrics });
      }
    } catch (e) {
      // skip bad files
    }
  }

  const shsResult = computeSHS(testResults);

  return {
    timestamp: new Date().toISOString(),
    ...shsResult,
    testResults,
    metricsTable
  };
}

// --- Helpers ---

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

export {
  extractTraceMetrics,
  readMetricsFile,
  aggregateMetricsFile,
  computeTestScores,
  computeSHS,
  collectRunMetrics
};
