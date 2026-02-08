#!/usr/bin/env node
/**
 * FeedbackExtractor
 *
 * Extracts, normalizes, and deduplicates feedback from runner trace files.
 * Handles all known schema variants produced by runner agents. Does NOT
 * perform matching — that is delegated to an LLM subagent.
 *
 * Usage:
 *   node FeedbackExtractor.js --run-dir <path>
 *
 * Output:
 *   {runDir}/extracted-feedback.json — array of normalized, deduplicated entries
 *   with stable fb-NNN IDs.
 */

import fs from 'fs';
import path from 'path';
import {
  inferArea,
  normalizeType,
  extractTitle,
  extractDetail,
  extractArea
} from './feedback-constants.js';

/**
 * Factory: createFeedbackExtractor(runDir)
 *
 * Extracts and normalizes feedback from all trace files in a run directory.
 * Returns { extract, getResults }.
 */
export function createFeedbackExtractor(runDir) {
  let results = null;

  /**
   * Normalize a single raw feedback object from a trace into a standard shape.
   */
  function normalizeFeedbackEntry(fb, testId) {
    const title = extractTitle(fb);
    const detail = String(extractDetail(fb));
    const combinedText = `${title} ${detail}`;
    const area = extractArea(fb, combinedText);
    const type = normalizeType(fb.type || fb.severity || 'improvement');

    return {
      testId,
      type,
      area,
      title,
      detail,
      files: fb.files || []
    };
  }

  /**
   * Extract all feedback from a single trace object.
   * Handles: feedback[], improvements[], bugs[], observations[] arrays.
   */
  function extractFromTrace(trace, testId) {
    const entries = [];

    // Primary: structured feedback array
    if (Array.isArray(trace.feedback)) {
      for (const fb of trace.feedback) {
        entries.push(normalizeFeedbackEntry(fb, testId));
      }
    }

    // Legacy: improvements array
    if (Array.isArray(trace.improvements)) {
      for (const imp of trace.improvements) {
        const desc = imp.description || '';
        entries.push({
          testId,
          type: 'improvement',
          area: imp.category || inferArea(desc),
          title: desc.slice(0, 80),
          detail: desc,
          files: []
        });
      }
    }

    // Legacy: bugs array
    if (Array.isArray(trace.bugs)) {
      for (const bug of trace.bugs) {
        const detail = typeof bug === 'string'
          ? bug
          : (bug.description || bug.error || JSON.stringify(bug));
        entries.push({
          testId,
          type: 'bug',
          area: inferArea(detail),
          title: detail.slice(0, 80),
          detail,
          files: []
        });
      }
    }

    // Legacy: observations array
    if (Array.isArray(trace.observations)) {
      for (const obs of trace.observations) {
        const text = typeof obs === 'string' ? obs : JSON.stringify(obs);
        entries.push({
          testId,
          type: 'observation',
          area: inferArea(text),
          title: text.slice(0, 80),
          detail: text,
          files: []
        });
      }
    }

    return entries;
  }

  /**
   * Deduplicate feedback entries by area + title prefix.
   * Empty titles get individual keys to prevent collapsing.
   */
  function deduplicateFeedback(feedbackList) {
    const groups = new Map();
    let emptyCounter = 0;

    for (const fb of feedbackList) {
      const titleKey = fb.title.toLowerCase().slice(0, 80).trim();
      // Prevent empty-title collapse: each empty entry gets a unique key
      const key = titleKey === ''
        ? `${fb.area}:__empty_${emptyCounter++}`
        : `${fb.area}:${titleKey}`;

      if (!groups.has(key)) {
        groups.set(key, { ...fb, count: 1, tests: [fb.testId] });
      } else {
        const existing = groups.get(key);
        existing.count++;
        if (!existing.tests.includes(fb.testId)) {
          existing.tests.push(fb.testId);
        }
        // Merge files
        for (const f of fb.files) {
          if (!existing.files.includes(f)) existing.files.push(f);
        }
        // Keep longer detail
        if (fb.detail.length > existing.detail.length) {
          existing.detail = fb.detail;
        }
      }
    }

    return [...groups.values()].sort((a, b) => b.count - a.count);
  }

  /**
   * Run extraction: read all traces, normalize, dedup, assign stable IDs.
   * Writes extracted-feedback.json to runDir.
   */
  function extract() {
    const traceFiles = fs.readdirSync(runDir).filter(f => f.endsWith('.trace.json'));
    const allFeedback = [];

    for (const file of traceFiles) {
      const trace = JSON.parse(fs.readFileSync(path.join(runDir, file), 'utf8'));
      const testId = trace.testId || file.replace('.trace.json', '');
      const entries = extractFromTrace(trace, testId);
      allFeedback.push(...entries);
    }

    const deduped = deduplicateFeedback(allFeedback);

    // Assign stable IDs
    const withIds = deduped.map((entry, i) => ({
      id: `fb-${String(i + 1).padStart(3, '0')}`,
      ...entry
    }));

    // Remove testId from deduped entries (tests array replaces it)
    for (const entry of withIds) {
      delete entry.testId;
    }

    results = {
      runDir,
      extractedAt: new Date().toISOString(),
      totalRaw: allFeedback.length,
      totalDeduped: withIds.length,
      traceFiles: traceFiles.length,
      entries: withIds
    };

    // Write to disk
    const outPath = path.join(runDir, 'extracted-feedback.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

    return results;
  }

  function getResults() {
    return results;
  }

  return { extract, getResults };
}

// --- CLI ---

function main() {
  const args = process.argv.slice(2);
  let runDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-dir') runDir = args[++i];
  }

  if (!runDir) {
    console.error('Usage: node FeedbackExtractor.js --run-dir <path>');
    process.exit(1);
  }

  const extractor = createFeedbackExtractor(runDir);
  const results = extractor.extract();

  console.log(`Extracted ${results.totalRaw} raw → ${results.totalDeduped} deduplicated entries from ${results.traceFiles} traces`);
  console.log(`Written to: ${path.join(runDir, 'extracted-feedback.json')}`);

  // Print summary table
  const byType = {};
  for (const e of results.entries) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }
  console.log(`Types: ${Object.entries(byType).map(([t, n]) => `${t}=${n}`).join(', ')}`);

  // Show entries with empty titles as warning
  const empties = results.entries.filter(e => e.title === '');
  if (empties.length > 0) {
    console.log(`Warning: ${empties.length} entries with empty titles (kept separate, not collapsed)`);
  }
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith('FeedbackExtractor.js') ||
  process.argv[1].endsWith('FeedbackExtractor')
);
if (isMain) main();
