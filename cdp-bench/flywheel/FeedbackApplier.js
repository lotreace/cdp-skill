#!/usr/bin/env node
/**
 * FeedbackApplier
 *
 * Reads extracted feedback + LLM match decisions, then deterministically
 * applies changes to improvements.json:
 *   - Upvotes matched issues (skipping low-confidence matches)
 *   - Creates new issues from unmatched bugs/workarounds
 *
 * Usage:
 *   node FeedbackApplier.js --run-dir <path> --improvements <path> [--apply]
 *
 * Without --apply, runs in dry-run mode and prints what would happen.
 */

import fs from 'fs';
import path from 'path';
import { AREA_TO_SECTION, AREA_TO_FILES, nextIssueId } from './feedback-constants.js';

/**
 * Factory: createFeedbackApplier(improvementsPath)
 *
 * Reads match decisions + extracted feedback, applies upvotes and creates
 * new issues deterministically.
 */
export function createFeedbackApplier(improvementsPath) {

  function readImprovements() {
    return JSON.parse(fs.readFileSync(improvementsPath, 'utf8'));
  }

  function writeImprovements(data) {
    data.meta.lastUpdated = new Date().toISOString();
    fs.writeFileSync(improvementsPath, JSON.stringify(data, null, 2));
  }

  /**
   * Apply feedback to improvements.json.
   *
   * @param {string} runDir - Path to the run directory
   * @param {object} options - { apply: boolean }
   * @returns {object} Summary of what was done
   */
  function apply(runDir, options = {}) {
    const dryRun = !options.apply;

    // Read inputs
    const extractedPath = path.join(runDir, 'extracted-feedback.json');
    const decisionsPath = path.join(runDir, 'match-decisions.json');

    if (!fs.existsSync(extractedPath)) {
      console.error(`Missing: ${extractedPath} — run FeedbackExtractor first`);
      process.exit(1);
    }
    if (!fs.existsSync(decisionsPath)) {
      console.error(`Missing: ${decisionsPath} — run the matching subagent first`);
      process.exit(1);
    }

    const extracted = JSON.parse(fs.readFileSync(extractedPath, 'utf8'));
    const decisions = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
    const data = readImprovements();

    // Index feedback entries by ID
    const feedbackById = new Map();
    for (const entry of extracted.entries) {
      feedbackById.set(entry.id, entry);
    }

    // Index decisions by feedbackId
    const decisionById = new Map();
    for (const d of decisions.decisions) {
      decisionById.set(d.feedbackId, d);
    }

    const upvoted = [];
    const created = [];
    const skippedLowConfidence = [];
    const unmatched = [];

    for (const entry of extracted.entries) {
      const decision = decisionById.get(entry.id);

      if (!decision || !decision.matchedIssueId) {
        // Unmatched — candidate for new issue creation
        unmatched.push(entry);
        continue;
      }

      // Skip low-confidence matches
      if (decision.confidence === 'low') {
        skippedLowConfidence.push({
          feedbackId: entry.id,
          issueId: decision.matchedIssueId,
          title: entry.title,
          reasoning: decision.reasoning
        });
        continue;
      }

      // Upvote matched issue
      const issue = data.issues.find(i => i.id === decision.matchedIssueId);
      if (!issue) {
        console.error(`Warning: matched issue ${decision.matchedIssueId} not found in improvements.json`);
        continue;
      }

      if (!dryRun) {
        issue.votes += entry.count;
      }

      upvoted.push({
        feedbackId: entry.id,
        issueId: issue.id,
        issueTitle: issue.title,
        feedbackTitle: entry.title,
        addedVotes: entry.count,
        newTotal: issue.votes + (dryRun ? entry.count : 0),
        confidence: decision.confidence
      });
    }

    // Create new issues from unmatched bugs/workarounds
    for (const fb of unmatched) {
      // Improvements need count >= 2 to auto-create
      if (fb.type === 'improvement' && fb.count < 2) continue;
      // Skip observations — they're informational, not actionable
      if (fb.type === 'observation') continue;
      // Skip entries with empty titles
      if (!fb.title.trim()) continue;

      const newId = nextIssueId(data.issues, fb.area);
      const section = AREA_TO_SECTION[fb.area] || 'Other Issues';
      const files = fb.files.length > 0 ? fb.files : (AREA_TO_FILES[fb.area] || []);

      const newIssue = {
        id: newId,
        section,
        title: fb.title,
        votes: fb.count,
        status: 'open',
        symptoms: [fb.detail],
        expected: '',
        workaround: fb.type === 'workaround' ? fb.detail : null,
        files,
        fixAttempts: [],
        source: 'runner-feedback',
        sourceTests: fb.tests
      };

      if (!dryRun) {
        data.issues.push(newIssue);
      }

      created.push({
        issueId: newId,
        title: fb.title,
        votes: fb.count,
        area: fb.area,
        type: fb.type
      });
    }

    // Write if changes were made
    if (!dryRun && (upvoted.length > 0 || created.length > 0)) {
      writeImprovements(data);
    }

    const result = {
      dryRun,
      total: extracted.entries.length,
      upvoted,
      created,
      skippedLowConfidence,
      unmatchedCount: unmatched.length,
      summary: {
        totalEntries: extracted.entries.length,
        matched: upvoted.length,
        newIssues: created.length,
        skippedLow: skippedLowConfidence.length,
        unmatched: unmatched.length - created.length
      }
    };

    // Write applier summary to run dir
    const summaryPath = path.join(runDir, 'feedback-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(result, null, 2));

    return result;
  }

  /**
   * Format a human-readable report from apply results.
   */
  function formatReport(result) {
    const lines = [];
    const prefix = result.dryRun ? '[DRY RUN] ' : '';
    lines.push(`${prefix}=== Feedback Applier: ${result.total} entries ===`);

    if (result.upvoted.length > 0) {
      lines.push('');
      lines.push(`Upvoted (${result.upvoted.length}):`);
      for (const u of result.upvoted) {
        lines.push(`  #${u.issueId} ${u.issueTitle} [+${u.addedVotes} → ${u.newTotal}] (${u.confidence})`);
        lines.push(`    ← "${u.feedbackTitle}"`);
      }
    }

    if (result.created.length > 0) {
      lines.push('');
      lines.push(`New issues created (${result.created.length}):`);
      for (const c of result.created) {
        lines.push(`  #${c.issueId} [${c.type}] ${c.title} (${c.votes} votes, area: ${c.area})`);
      }
    }

    if (result.skippedLowConfidence.length > 0) {
      lines.push('');
      lines.push(`Skipped (low confidence, ${result.skippedLowConfidence.length}):`);
      for (const s of result.skippedLowConfidence) {
        lines.push(`  ${s.feedbackId} → #${s.issueId}: ${s.reasoning}`);
      }
    }

    const s = result.summary;
    lines.push('');
    lines.push(`Summary: ${s.matched} matched, ${s.newIssues} new issues, ${s.skippedLow} skipped (low), ${s.unmatched} unmatched (no action)`);

    return lines.join('\n');
  }

  return { apply, formatReport };
}

// --- CLI ---

function main() {
  const args = process.argv.slice(2);
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-dir') flags.runDir = args[++i];
    else if (args[i] === '--improvements') flags.improvements = args[++i];
    else if (args[i] === '--apply') flags.apply = true;
  }

  if (!flags.runDir) {
    console.error('Usage: node FeedbackApplier.js --run-dir <path> --improvements <path> [--apply]');
    process.exit(1);
  }

  const improvementsPath = flags.improvements || 'improvements.json';
  const applier = createFeedbackApplier(improvementsPath);
  const result = applier.apply(flags.runDir, { apply: flags.apply });

  console.log(applier.formatReport(result));
  console.log('');
  console.log(JSON.stringify(result.summary, null, 2));
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith('FeedbackApplier.js') ||
  process.argv[1].endsWith('FeedbackApplier')
);
if (isMain) main();
