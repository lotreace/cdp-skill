/**
 * Shared constants for feedback extraction and application.
 * Used by FeedbackExtractor, FeedbackApplier, and build-dataset.js.
 */

// Area → section mapping for new issues in improvements.json
export const AREA_TO_SECTION = {
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

// Area → likely source files for auto-created issues
export const AREA_TO_FILES = {
  actions: ['src/runner/execute-interaction.js', 'src/dom/click-executor.js'],
  snapshot: ['src/aria.js'],
  navigation: ['src/page/page-controller.js', 'src/runner/execute-navigation.js'],
  iframe: ['src/page/page-controller.js'],
  input: ['src/dom/fill-executor.js', 'src/dom/keyboard-executor.js'],
  'error-handling': ['src/utils.js'],
  'shadow-dom': ['src/dom/element-locator.js', 'src/aria.js'],
  timing: ['src/page/page-controller.js', 'src/page/wait-utilities.js']
};

/**
 * Infer area from free-text observation.
 */
export function inferArea(text) {
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
 * Normalize type/severity to one of: bug, improvement, workaround, observation.
 */
export function normalizeType(raw) {
  const lower = (raw || '').toLowerCase();
  if (lower.includes('bug') || lower.includes('error') || lower.includes('critical') || lower.includes('high')) return 'bug';
  if (lower.includes('workaround')) return 'workaround';
  if (lower.includes('observation') || lower.includes('info') || lower.includes('note')) return 'observation';
  return 'improvement';
}

/**
 * Robust title extraction waterfall — handles all known schema variants.
 */
export function extractTitle(fb) {
  return fb.title
    || fb.issue
    || fb.summary
    || (fb.observation ? String(fb.observation).slice(0, 80) : '')
    || (fb.message ? String(fb.message).slice(0, 80) : '')
    || '';
}

/**
 * Robust detail extraction waterfall.
 */
export function extractDetail(fb) {
  return fb.detail
    || fb.description
    || fb.observation
    || fb.message
    || fb.suggestion
    || '';
}

/**
 * Robust area extraction waterfall with text-based inference fallback.
 */
export function extractArea(fb, fallbackText) {
  return fb.area || fb.category || fb.component || inferArea(fallbackText || '');
}

/**
 * Generate the next issue ID for a given section within an issues list.
 */
export function nextIssueId(issues, area) {
  const sectionName = AREA_TO_SECTION[area] || 'Other Issues';
  const sectionIssues = issues.filter(i => i.section === sectionName);
  if (sectionIssues.length === 0) {
    const maxMajor = Math.max(0, ...issues.map(i => parseInt(i.id.split('.')[0]) || 0));
    return `${maxMajor + 1}.1`;
  }
  const maxMinor = Math.max(...sectionIssues.map(i => parseInt(i.id.split('.')[1]) || 0));
  const major = sectionIssues[0].id.split('.')[0];
  return `${major}.${maxMinor + 1}`;
}
