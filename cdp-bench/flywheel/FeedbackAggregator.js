#!/usr/bin/env node
/**
 * FeedbackAggregator
 *
 * Extracts structured feedback from runner traces, matches against existing
 * improvements.json issues (upvoting matches), and surfaces new unmatched
 * feedback as candidate issues. This closes the flywheel loop — runners
 * report what works and what doesn't, and that data flows back into the
 * improvement backlog.
 *
 * Usage:
 *   node FeedbackAggregator.js --run-dir <path> --improvements <path>
 *
 * Output:
 *   - Prints a feedback report to stdout (JSON)
 *   - Optionally writes updates to improvements.json (--apply flag)
 */

import fs from 'fs';
import path from 'path';

// Area → section mapping for new issues
const AREA_TO_SECTION = {
  actions: 'Timeout / Actionability Issues',
  snapshot: 'Snapshot Content/Accuracy Issues',
  navigation: 'Navigation/Detection Issues',
  iframe: 'Frame / Context Issues',
  input: 'Input / Typing Issues',
  'error-handling': 'Error Handling Issues',
  'shadow-dom': 'Shadow DOM Issues',
  timing: 'Stagehand-Inspired Improvements',
  other: 'Other Issues'
};

// Area → likely source files
const AREA_TO_FILES = {
  actions: ['src/runner/execute-interaction.js', 'src/dom/click-executor.js'],
  snapshot: ['src/aria.js'],
  navigation: ['src/page/page-controller.js', 'src/runner/execute-navigation.js'],
  iframe: ['src/page/page-controller.js'],
  input: ['src/dom/fill-executor.js', 'src/dom/keyboard-executor.js'],
  'error-handling': ['src/utils.js'],
  'shadow-dom': ['src/dom/element-locator.js', 'src/aria.js'],
  timing: ['src/page/page-controller.js', 'src/page/wait-utilities.js']
};

function createFeedbackAggregator(improvementsPath) {

  function readImprovements() {
    return JSON.parse(fs.readFileSync(improvementsPath, 'utf8'));
  }

  function writeImprovements(data) {
    data.meta.lastUpdated = new Date().toISOString();
    fs.writeFileSync(improvementsPath, JSON.stringify(data, null, 2));
  }

  /**
   * Extract feedback entries from all traces in a run directory.
   * Supports both the new `feedback` array and legacy `improvements`/`bugs`/`observations` fields.
   */
  function extractFeedback(runDir) {
    const traceFiles = fs.readdirSync(runDir).filter(f => f.endsWith('.trace.json'));
    const allFeedback = [];

    for (const file of traceFiles) {
      const trace = JSON.parse(fs.readFileSync(path.join(runDir, file), 'utf8'));
      const testId = trace.testId || file.replace('.trace.json', '');

      // New structured format
      if (Array.isArray(trace.feedback)) {
        for (const fb of trace.feedback) {
          allFeedback.push({
            testId,
            type: fb.type || 'improvement',
            area: fb.area || 'other',
            title: fb.title || '',
            detail: fb.detail || '',
            files: fb.files || []
          });
        }
      }

      // Legacy format: improvements array
      if (Array.isArray(trace.improvements)) {
        for (const imp of trace.improvements) {
          allFeedback.push({
            testId,
            type: 'improvement',
            area: imp.category || 'other',
            title: imp.description || '',
            detail: imp.description || '',
            files: []
          });
        }
      }

      // Legacy format: bugs array
      if (Array.isArray(trace.bugs)) {
        for (const bug of trace.bugs) {
          const detail = typeof bug === 'string' ? bug : (bug.description || bug.error || JSON.stringify(bug));
          allFeedback.push({
            testId,
            type: 'bug',
            area: 'other',
            title: detail.slice(0, 80),
            detail,
            files: []
          });
        }
      }

      // Legacy format: observations (convert to feedback)
      if (Array.isArray(trace.observations)) {
        for (const obs of trace.observations) {
          const text = typeof obs === 'string' ? obs : JSON.stringify(obs);
          allFeedback.push({
            testId,
            type: 'improvement',
            area: inferArea(text),
            title: text.slice(0, 80),
            detail: text,
            files: []
          });
        }
      }
    }

    return allFeedback;
  }

  /**
   * Infer area from observation text.
   */
  function inferArea(text) {
    const lower = text.toLowerCase();
    if (lower.includes('iframe') || lower.includes('frame')) return 'iframe';
    if (lower.includes('snapshot') || lower.includes('aria')) return 'snapshot';
    if (lower.includes('click') || lower.includes('hover') || lower.includes('drag')) return 'actions';
    if (lower.includes('type') || lower.includes('fill') || lower.includes('keyboard') || lower.includes('input')) return 'input';
    if (lower.includes('navig') || lower.includes('goto') || lower.includes('url')) return 'navigation';
    if (lower.includes('shadow')) return 'shadow-dom';
    if (lower.includes('timeout') || lower.includes('wait') || lower.includes('network') || lower.includes('idle')) return 'timing';
    if (lower.includes('error') || lower.includes('crash')) return 'error-handling';
    return 'other';
  }

  /**
   * Match a feedback entry to existing improvements.json issues.
   * Returns the matched issue or null.
   */
  function matchToExisting(fb, issues) {
    const fbText = `${fb.title} ${fb.detail}`.toLowerCase();
    const fbArea = fb.area;

    let bestMatch = null;
    let bestScore = 0;

    for (const issue of issues) {
      if (issue.status !== 'open') continue;

      let score = 0;

      // Area/section match
      const expectedSection = AREA_TO_SECTION[fbArea];
      if (expectedSection && issue.section === expectedSection) score += 2;

      // Keyword matching against issue title + symptoms
      const issueText = `${issue.title} ${(issue.symptoms || []).join(' ')}`.toLowerCase();
      const issueWords = issueText.split(/\s+/).filter(w => w.length > 3);
      const fbWords = fbText.split(/\s+/).filter(w => w.length > 3);

      const sharedWords = fbWords.filter(w => issueWords.includes(w));
      score += sharedWords.length;

      // File overlap
      if (fb.files.length > 0 && issue.files) {
        const fbFileSet = new Set(fb.files.map(f => path.basename(f)));
        const issueFileSet = new Set(issue.files.map(f => path.basename(f)));
        for (const f of fbFileSet) {
          if (issueFileSet.has(f)) score += 3;
        }
      }

      if (score > bestScore && score >= 3) {
        bestScore = score;
        bestMatch = issue;
      }
    }

    return bestMatch;
  }

  /**
   * Deduplicate feedback entries by grouping similar titles.
   */
  function deduplicateFeedback(feedbackList) {
    const groups = new Map();

    for (const fb of feedbackList) {
      // Simple dedup key: area + first 40 chars of title lowercased
      const key = `${fb.area}:${fb.title.toLowerCase().slice(0, 40).trim()}`;
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
      }
    }

    return [...groups.values()].sort((a, b) => b.count - a.count);
  }

  /**
   * Generate the next issue ID for a given section.
   */
  function nextIssueId(issues, section) {
    const sectionPrefix = AREA_TO_SECTION[section] || section;
    // Find existing IDs in the same section prefix range
    const sectionIssues = issues.filter(i => i.section === sectionPrefix);
    if (sectionIssues.length === 0) {
      // Find the highest major number across all issues
      const maxMajor = Math.max(0, ...issues.map(i => parseInt(i.id.split('.')[0]) || 0));
      return `${maxMajor + 1}.1`;
    }
    const maxMinor = Math.max(...sectionIssues.map(i => parseInt(i.id.split('.')[1]) || 0));
    const major = sectionIssues[0].id.split('.')[0];
    return `${major}.${maxMinor + 1}`;
  }

  /**
   * Main aggregation: extract, match, upvote, report new.
   */
  function aggregate(runDir, options = {}) {
    const apply = options.apply || false;
    const data = readImprovements();
    const rawFeedback = extractFeedback(runDir);

    if (rawFeedback.length === 0) {
      return { total: 0, matched: [], unmatched: [], upvoted: [], created: [] };
    }

    const deduped = deduplicateFeedback(rawFeedback);

    const matched = [];
    const unmatched = [];

    for (const fb of deduped) {
      const match = matchToExisting(fb, data.issues);
      if (match) {
        matched.push({ feedback: fb, issueId: match.id, issueTitle: match.title });
      } else {
        unmatched.push(fb);
      }
    }

    const upvoted = [];
    const created = [];

    if (apply) {
      // Upvote matched issues
      for (const { feedback, issueId } of matched) {
        const issue = data.issues.find(i => i.id === issueId);
        if (issue) {
          issue.votes += feedback.count;
          upvoted.push({ issueId, title: issue.title, addedVotes: feedback.count, newTotal: issue.votes });
        }
      }

      // Create new issues from unmatched feedback (bugs and workarounds get auto-created)
      for (const fb of unmatched) {
        if (fb.type === 'improvement' && fb.count < 2) continue; // Need 2+ reports for new improvements
        // Bugs and workarounds always get created
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

        data.issues.push(newIssue);
        created.push({ issueId: newId, title: fb.title, votes: fb.count, area: fb.area });
      }

      if (upvoted.length > 0 || created.length > 0) {
        writeImprovements(data);
      }
    }

    return {
      total: rawFeedback.length,
      deduped: deduped.length,
      matched: matched.map(m => ({
        issueId: m.issueId,
        issueTitle: m.issueTitle,
        feedbackTitle: m.feedback.title,
        count: m.feedback.count,
        tests: m.feedback.tests
      })),
      unmatched: unmatched.map(u => ({
        type: u.type,
        area: u.area,
        title: u.title,
        detail: u.detail,
        count: u.count,
        tests: u.tests
      })),
      upvoted,
      created
    };
  }

  /**
   * Format a human-readable report from aggregation results.
   */
  function formatReport(result) {
    const lines = [];
    lines.push(`=== Runner Feedback: ${result.total} entries from traces (${result.deduped} unique) ===`);

    if (result.matched.length > 0) {
      lines.push('');
      lines.push(`Matched to existing issues (${result.matched.length}):`);
      for (const m of result.matched) {
        const votes = result.upvoted.find(u => u.issueId === m.issueId);
        const voteStr = votes ? ` [+${votes.addedVotes} votes → ${votes.newTotal}]` : '';
        lines.push(`  #${m.issueId} ${m.issueTitle}${voteStr} (${m.count}x from ${m.tests.join(', ')})`);
      }
    }

    if (result.unmatched.length > 0) {
      lines.push('');
      lines.push(`New feedback (${result.unmatched.length}):`);
      for (const u of result.unmatched) {
        const created = result.created.find(c => c.title === u.title);
        const tag = created ? ` → NEW #${created.issueId}` : ' (not auto-created)';
        lines.push(`  [${u.type}] ${u.area}: ${u.title} (${u.count}x from ${u.tests.join(', ')})${tag}`);
      }
    }

    if (result.total === 0) {
      lines.push('  No feedback collected. Runners should populate the feedback array in traces.');
    }

    return lines.join('\n');
  }

  return { extractFeedback, deduplicateFeedback, aggregate, formatReport };
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-dir') flags.runDir = args[++i];
    else if (args[i] === '--improvements') flags.improvements = args[++i];
    else if (args[i] === '--apply') flags.apply = true;
  }

  if (!flags.runDir) {
    console.error('Usage: node FeedbackAggregator.js --run-dir <path> [--improvements <path>] [--apply]');
    process.exit(1);
  }

  const improvementsPath = flags.improvements || 'improvements.json';
  const aggregator = createFeedbackAggregator(improvementsPath);
  const result = aggregator.aggregate(flags.runDir, { apply: flags.apply });

  console.log(aggregator.formatReport(result));
  console.log('');
  console.log(JSON.stringify(result, null, 2));
}

export { createFeedbackAggregator };

const isMain = process.argv[1] && (
  process.argv[1].endsWith('FeedbackAggregator.js') ||
  process.argv[1].endsWith('FeedbackAggregator')
);
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
