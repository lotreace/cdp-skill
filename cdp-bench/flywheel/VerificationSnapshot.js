/**
 * VerificationSnapshot
 *
 * Capture and offline evaluation of milestone verification data.
 * Eliminates the need for live CDP connections during validation by
 * capturing all necessary browser state into a portable snapshot.
 *
 * Two factory functions:
 *   buildCaptureExpression(milestones)  - JS expression for in-browser capture
 *   evaluateSnapshotOffline(snapshot, milestones) - offline evaluation from snapshot
 */

/**
 * Build a single JS expression that, when evaluated in the browser,
 * captures all data needed to verify every milestone offline.
 *
 * @param {Array} milestones - Array of milestone definitions with verify blocks
 * @returns {string} JS expression that returns a snapshot object
 */
export function buildCaptureExpression(milestones) {
  const captureBlocks = milestones.map((m, idx) =>
    `"${sanitizeKey(m.id || idx)}": ${buildVerifyCapture(m.verify)}`
  );

  return `(function() {
  try {
    return {
      url: location.href,
      title: document.title,
      timestamp: Date.now(),
      milestones: { ${captureBlocks.join(', ')} }
    };
  } catch (e) {
    return { error: e.message, url: location.href, title: document.title, timestamp: Date.now(), milestones: {} };
  }
})()`;
}

/**
 * Evaluate a captured snapshot offline against milestone definitions.
 * Returns the same shape as validateMilestones() in validator-harness.js.
 *
 * @param {object} snapshot - Captured snapshot from buildCaptureExpression
 * @param {Array} milestones - Array of milestone definitions
 * @returns {{ milestones: Array, completionScore: number }}
 */
export function evaluateSnapshotOffline(snapshot, milestones) {
  if (!snapshot || snapshot.error) {
    return {
      milestones: milestones.map(m => ({
        id: m.id,
        weight: m.weight,
        passed: false,
        detail: snapshot?.error || 'snapshot missing'
      })),
      completionScore: 0
    };
  }

  const results = [];
  let completionScore = 0;

  for (const milestone of milestones) {
    const key = milestone.id || String(milestones.indexOf(milestone));
    const captured = snapshot.milestones?.[key];
    const result = evaluateVerifyOffline(milestone.verify, captured, snapshot);

    results.push({
      id: milestone.id,
      weight: milestone.weight,
      passed: result.passed,
      detail: result.detail
    });

    if (result.passed) {
      completionScore += milestone.weight;
    }
  }

  return { milestones: results, completionScore: Math.min(1.0, completionScore) };
}

// --- Internal helpers ---

function sanitizeKey(key) {
  return String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Build a JS sub-expression that captures the data needed for a single verify block.
 * Returns a JSON-serializable value when evaluated in the browser.
 */
function buildVerifyCapture(verify) {
  if (verify.url_contains || verify.url_matches) {
    return `location.href`;
  }

  if (verify.eval_truthy) {
    return `(function() { try { return !!(${verify.eval_truthy}); } catch(e) { return false; } })()`;
  }

  if (verify.dom_exists) {
    return `!!document.querySelector(${JSON.stringify(verify.dom_exists)})`;
  }

  if (verify.dom_text) {
    const sel = JSON.stringify(verify.dom_text.selector);
    return `(document.querySelector(${sel})?.textContent || '')`;
  }

  if (verify.all) {
    const subs = verify.all.map((sub, i) => `"${i}": ${buildVerifyCapture(sub)}`);
    return `({ ${subs.join(', ')} })`;
  }

  if (verify.any) {
    const subs = verify.any.map((sub, i) => `"${i}": ${buildVerifyCapture(sub)}`);
    return `({ ${subs.join(', ')} })`;
  }

  return `null`;
}

/**
 * Evaluate a verify block offline using captured data.
 * Mirrors runVerifier() logic from validator-harness.js.
 */
function evaluateVerifyOffline(verify, captured, snapshot) {
  if (verify.url_contains) {
    const url = captured ?? snapshot.url ?? '';
    const passed = String(url).includes(verify.url_contains);
    return { passed, detail: `url=${url}` };
  }

  if (verify.url_matches) {
    const url = captured ?? snapshot.url ?? '';
    const re = new RegExp(verify.url_matches);
    const passed = re.test(String(url));
    return { passed, detail: `url=${url}` };
  }

  if (verify.eval_truthy) {
    const passed = !!captured;
    return { passed, detail: `eval=${captured}` };
  }

  if (verify.dom_exists) {
    const passed = !!captured;
    return { passed, detail: `dom_exists=${captured}` };
  }

  if (verify.dom_text) {
    const text = String(captured ?? '');
    const { contains, matches } = verify.dom_text;
    if (contains) return { passed: text.includes(contains), detail: `text="${text.slice(0, 100)}"` };
    if (matches) return { passed: new RegExp(matches).test(text), detail: `text="${text.slice(0, 100)}"` };
    return { passed: text.length > 0, detail: `text="${text.slice(0, 100)}"` };
  }

  if (verify.all) {
    const subs = verify.all;
    const subResults = [];
    for (let i = 0; i < subs.length; i++) {
      const subCaptured = captured?.[String(i)];
      const r = evaluateVerifyOffline(subs[i], subCaptured, snapshot);
      subResults.push(r);
      if (!r.passed) {
        return { passed: false, detail: `all: failed at ${JSON.stringify(subs[i])}`, sub: subResults };
      }
    }
    return { passed: true, detail: 'all passed', sub: subResults };
  }

  if (verify.any) {
    const subs = verify.any;
    const subResults = [];
    for (let i = 0; i < subs.length; i++) {
      const subCaptured = captured?.[String(i)];
      const r = evaluateVerifyOffline(subs[i], subCaptured, snapshot);
      subResults.push(r);
      if (r.passed) {
        return { passed: true, detail: `any: passed at ${JSON.stringify(subs[i])}`, sub: subResults };
      }
    }
    return { passed: false, detail: 'none passed', sub: subResults };
  }

  return { passed: false, detail: `Unknown verify type: ${JSON.stringify(Object.keys(verify))}` };
}
