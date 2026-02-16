/**
 * Baseline Manager
 *
 * Read/write/compare baselines. Manages latest.json and trend.jsonl.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINES_DIR = path.join(__dirname, '..', 'baselines');

// --- Read ---

function readLatestBaseline(baselinesDir = BASELINES_DIR) {
  const latestPath = path.join(baselinesDir, 'latest.json');
  if (!fs.existsSync(latestPath)) return null;
  return JSON.parse(fs.readFileSync(latestPath, 'utf8'));
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

function writeBaseline(runData, version, baselinesDir = BASELINES_DIR) {
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
      category: result.category
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
  readTrend,
  writeBaseline,
  appendTrend,
  compareWithBaseline
};
