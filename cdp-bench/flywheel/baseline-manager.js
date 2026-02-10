/**
 * Baseline Manager
 *
 * Read/write/compare baselines. Manages latest.json, trend.jsonl,
 * flakiness.json. Implements regression gate.
 */

import fs from 'fs';
import path from 'path';

const BASELINES_DIR = path.join(import.meta.dirname || '.', '..', 'baselines');

// --- Read ---

function readLatestBaseline(baselinesDir = BASELINES_DIR) {
  const latestPath = path.join(baselinesDir, 'latest.json');
  if (!fs.existsSync(latestPath)) return null;
  return JSON.parse(fs.readFileSync(latestPath, 'utf8'));
}

function readFlakiness(baselinesDir = BASELINES_DIR) {
  const flakinessPath = path.join(baselinesDir, 'flakiness.json');
  if (!fs.existsSync(flakinessPath)) return {};
  return JSON.parse(fs.readFileSync(flakinessPath, 'utf8'));
}

function readTrend(baselinesDir = BASELINES_DIR) {
  const trendPath = path.join(baselinesDir, 'trend.jsonl');
  if (!fs.existsSync(trendPath)) return [];
  return fs.readFileSync(trendPath, 'utf8')
    .trim().split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l));
}

// --- Write ---

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeBaseline(runData, version, baselinesDir = BASELINES_DIR, ratchetState = {}) {
  ensureDir(baselinesDir);

  const baseline = {
    version,
    timestamp: runData.timestamp || new Date().toISOString(),
    shs: runData.shs,
    tests: {}
  };

  for (const result of (runData.testResults || [])) {
    baseline.tests[result.testId] = {
      score: result.completion,
      composite: result.composite,
      category: result.category,
      ratcheted: ratchetState[result.testId]?.ratcheted || false,
      consecutivePasses: ratchetState[result.testId]?.consecutivePasses || 0
    };
  }

  // Write latest
  const latestPath = path.join(baselinesDir, 'latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(baseline, null, 2));

  // Archive
  const ts = baseline.timestamp.replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = path.join(baselinesDir, `v${version}-${ts}.json`);
  fs.writeFileSync(archivePath, JSON.stringify(baseline, null, 2));

  return baseline;
}

function appendTrend(runData, version, baselinesDir = BASELINES_DIR) {
  ensureDir(baselinesDir);

  const trendPath = path.join(baselinesDir, 'trend.jsonl');
  const entry = {
    ts: runData.timestamp || new Date().toISOString(),
    version,
    shs: runData.shs,
    passRate: runData.passRate,
    tests: runData.totalTests,
    passed: runData.passed,
    perfect: runData.perfect,
    avgCompletion: runData.avgCompletion,
    avgEfficiency: runData.avgEfficiency
  };

  fs.appendFileSync(trendPath, JSON.stringify(entry) + '\n');
  return entry;
}

function updateFlakiness(testId, scores, baselinesDir = BASELINES_DIR) {
  ensureDir(baselinesDir);

  const flakiness = readFlakiness(baselinesDir);
  if (!flakiness[testId]) {
    flakiness[testId] = { scores: [], variance: 0, flaky: false };
  }

  const entry = flakiness[testId];
  entry.scores.push(...scores);
  // Keep last 5 scores
  if (entry.scores.length > 5) entry.scores = entry.scores.slice(-5);

  // Compute variance
  if (entry.scores.length >= 2) {
    const mean = entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length;
    const variance = entry.scores.reduce((s, v) => s + (v - mean) ** 2, 0) / entry.scores.length;
    entry.variance = Math.round(variance * 1000) / 1000;
    entry.flaky = entry.variance > 0.3;
  }

  const flakinessPath = path.join(baselinesDir, 'flakiness.json');
  fs.writeFileSync(flakinessPath, JSON.stringify(flakiness, null, 2));
  return flakiness;
}

// --- Regression Gate ---

function updateRatchet(baseline, testResults) {
  if (!baseline) return {};

  const ratcheted = {};
  for (const result of testResults) {
    const prev = baseline.tests?.[result.testId];
    if (!prev) continue;

    // A test is ratcheted if it passed 3+ consecutive runs
    const consecutivePasses = prev.consecutivePasses || 0;
    if (result.completion >= 0.5) {
      ratcheted[result.testId] = {
        consecutivePasses: consecutivePasses + 1,
        ratcheted: consecutivePasses + 1 >= 3
      };
    } else {
      ratcheted[result.testId] = {
        consecutivePasses: 0,
        ratcheted: false
      };
    }
  }
  return ratcheted;
}

function checkRegressionGate(runData, baseline, flakiness = {}) {
  const issues = [];
  let passed = true;

  if (!baseline) {
    return { passed: true, issues: [], message: 'No baseline to compare against (first run)' };
  }

  // SHS gate: new >= baseline - 1
  const shsDelta = runData.shs - baseline.shs;
  if (shsDelta < -1) {
    passed = false;
    issues.push({
      type: 'shs_regression',
      message: `SHS dropped from ${baseline.shs} to ${runData.shs} (delta: ${shsDelta})`,
      severity: 'blocking'
    });
  }

  // Ratcheted test gate
  for (const result of (runData.testResults || [])) {
    const prev = baseline.tests?.[result.testId];
    if (!prev) continue;

    // Skip flaky tests
    if (flakiness[result.testId]?.flaky) continue;

    const isRatcheted = prev.consecutivePasses >= 3 || prev.ratcheted;
    if (isRatcheted && result.completion < 0.7) {
      passed = false;
      issues.push({
        type: 'ratchet_regression',
        testId: result.testId,
        message: `Ratcheted test ${result.testId} dropped to ${result.completion} (was ${prev.score})`,
        severity: 'blocking'
      });
    }
  }

  // Non-blocking: any test that dropped significantly
  for (const result of (runData.testResults || [])) {
    const prev = baseline.tests?.[result.testId];
    if (!prev) continue;
    if (flakiness[result.testId]?.flaky) continue;

    const delta = result.completion - prev.score;
    if (delta < -0.2) {
      issues.push({
        type: 'test_regression',
        testId: result.testId,
        message: `Test ${result.testId} dropped from ${prev.score} to ${result.completion}`,
        severity: 'warning',
        delta
      });
    }
  }

  return {
    passed,
    shsDelta,
    issues,
    message: passed
      ? `Regression gate passed (SHS: ${baseline.shs} -> ${runData.shs})`
      : `Regression gate FAILED: ${issues.filter(i => i.severity === 'blocking').length} blocking issues`
  };
}

// --- Compare ---

function compareWithBaseline(runData, baseline) {
  if (!baseline) return { isFirst: true, improvements: [], regressions: [] };

  const improvements = [];
  const regressions = [];
  const newTests = [];

  for (const result of (runData.testResults || [])) {
    const prev = baseline.tests?.[result.testId];
    if (!prev) {
      newTests.push(result.testId);
      continue;
    }

    const delta = result.completion - prev.score;
    if (delta > 0.1) {
      improvements.push({ testId: result.testId, from: prev.score, to: result.completion, delta });
    } else if (delta < -0.1) {
      regressions.push({ testId: result.testId, from: prev.score, to: result.completion, delta });
    }
  }

  return {
    isFirst: false,
    shsDelta: runData.shs - baseline.shs,
    improvements: improvements.sort((a, b) => b.delta - a.delta),
    regressions: regressions.sort((a, b) => a.delta - b.delta),
    newTests
  };
}

export {
  readLatestBaseline,
  readFlakiness,
  readTrend,
  writeBaseline,
  appendTrend,
  updateFlakiness,
  updateRatchet,
  checkRegressionGate,
  compareWithBaseline
};
