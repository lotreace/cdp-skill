/**
 * DOM Stability Module
 * LCS-based DOM structure comparison for detecting page stability
 *
 * PUBLIC EXPORTS:
 * - lcsLength(a, b) - Calculate Longest Common Subsequence length
 * - lcsSimilarity(a, b) - Calculate similarity ratio using LCS
 * - getDOMSignature(session, selector?) - Get DOM structure signature
 * - waitForDOMStability(session, options?) - Wait for DOM to stabilize
 *
 * @module cdp-skill/page/dom-stability
 */

import { sleep } from '../utils.js';

/**
 * Calculate Longest Common Subsequence length between two arrays
 * Used for comparing DOM structure changes
 * @param {Array} a - First array
 * @param {Array} b - Second array
 * @returns {number} Length of LCS
 */
export function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;

  // Use frequency-based intersection for large arrays (preserves duplicate counts)
  if (m > 1000 || n > 1000) {
    const freqA = new Map();
    for (const item of a) {
      freqA.set(item, (freqA.get(item) || 0) + 1);
    }
    const freqB = new Map();
    for (const item of b) {
      freqB.set(item, (freqB.get(item) || 0) + 1);
    }
    let common = 0;
    for (const [item, countA] of freqA) {
      const countB = freqB.get(item) || 0;
      common += Math.min(countA, countB);
    }
    return common;
  }

  // Standard DP solution
  const dp = Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1;
      } else {
        dp[j] = Math.max(dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }

  return dp[n];
}

/**
 * Calculate similarity ratio between two arrays using LCS
 * @param {Array} a - First array
 * @param {Array} b - Second array
 * @returns {number} Similarity ratio between 0 and 1
 */
export function lcsSimilarity(a, b) {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const lcs = lcsLength(a, b);
  return (2 * lcs) / (a.length + b.length);
}

/**
 * Get DOM structure signature for stability comparison
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {string} [selector='body'] - Root element selector
 * @returns {Promise<string[]>} Array of element signatures
 */
export async function getDOMSignature(session, selector = 'body') {
  const result = await session.send('Runtime.evaluate', {
    expression: `
      (function() {
        const root = document.querySelector(${JSON.stringify(selector)}) || document.body;
        if (!root) return [];

        const signatures = [];
        const walker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_ELEMENT,
          {
            acceptNode: (node) => {
              // Skip script, style, and hidden elements
              if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.tagName)) {
                return NodeFilter.FILTER_REJECT;
              }
              const style = window.getComputedStyle(node);
              if (style.display === 'none' || style.visibility === 'hidden') {
                return NodeFilter.FILTER_SKIP;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );

        let node;
        let count = 0;
        const maxNodes = 500; // Limit to prevent huge arrays

        while ((node = walker.nextNode()) && count < maxNodes) {
          // Create signature: tagName + key attributes
          let sig = node.tagName.toLowerCase();
          if (node.id) sig += '#' + node.id;
          if (node.className && typeof node.className === 'string') {
            // Only include first 2 class names to reduce noise
            const classes = node.className.split(' ').filter(c => c).slice(0, 2);
            if (classes.length > 0) sig += '.' + classes.join('.');
          }
          // Include text content hash for leaf nodes
          if (!node.firstElementChild && node.textContent) {
            const text = node.textContent.trim().slice(0, 50);
            if (text) sig += ':' + text.length;
          }
          signatures.push(sig);
          count++;
        }

        return signatures;
      })()
    `,
    returnByValue: true
  });

  return result.result.value || [];
}

/**
 * Check if DOM has stabilized by comparing structure over time
 * Uses LCS to distinguish meaningful changes from cosmetic ones
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {Object} [options] - Options
 * @param {string} [options.selector='body'] - Root element to check
 * @param {number} [options.threshold=0.95] - Similarity threshold (0-1)
 * @param {number} [options.checks=3] - Number of consecutive stable checks
 * @param {number} [options.interval=100] - Ms between checks
 * @param {number} [options.timeout=10000] - Total timeout
 * @returns {Promise<{stable: boolean, similarity: number, checks: number}>}
 */
export async function waitForDOMStability(session, options = {}) {
  const {
    selector = 'body',
    threshold = 0.95,
    checks = 3,
    interval = 100,
    timeout = 10000
  } = options;

  const startTime = Date.now();
  let lastSignature = await getDOMSignature(session, selector);
  let stableCount = 0;
  let lastSimilarity = 1;

  while (Date.now() - startTime < timeout) {
    await sleep(interval);

    const currentSignature = await getDOMSignature(session, selector);
    const similarity = lcsSimilarity(lastSignature, currentSignature);
    lastSimilarity = similarity;

    if (similarity >= threshold) {
      stableCount++;
      if (stableCount >= checks) {
        return { stable: true, similarity, checks: stableCount };
      }
    } else {
      stableCount = 0;
    }

    lastSignature = currentSignature;
  }

  return { stable: false, similarity: lastSimilarity, checks: stableCount };
}
