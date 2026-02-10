/**
 * SHS Calculator
 *
 * Centralized Skill Health Score computation.
 * Used by validator-harness.js and metrics-collector.js.
 */

/**
 * Compute Skill Health Score (SHS) from scoring dimensions.
 *
 * @param {number} passRate - Fraction of tests with completion >= 0.5
 * @param {number} avgCompletion - Average completion score across all tests
 * @param {number} perfectRate - Fraction of tests with completion = 1.0
 * @param {number} avgEfficiency - Average efficiency score across all tests
 * @param {number} categoryCoverage - Fraction of categories with at least one pass
 * @returns {number} SHS score (0-100)
 */
export function computeSHS(passRate, avgCompletion, perfectRate, avgEfficiency, categoryCoverage) {
  return Math.round(
    40 * passRate +
    25 * avgCompletion +
    15 * perfectRate +
    10 * avgEfficiency +
    10 * categoryCoverage
  );
}
