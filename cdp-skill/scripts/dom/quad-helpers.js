/**
 * Quad Helpers
 * Geometry calculations for content quads (used by CDP for element positioning)
 *
 * EXPORTS:
 * - calculateQuadCenter(quad) → {x, y} - Get center point of a quad
 * - calculateQuadArea(quad) → number - Calculate area using shoelace formula
 * - isPointInQuad(quad, x, y) → boolean - Ray casting point-in-polygon test
 * - getLargestQuad(quads) → quad|null - Find largest quad by area
 *
 * DEPENDENCIES: None
 */

/**
 * Calculate center point of a quad
 * Quads are arrays of 8 numbers: [x1,y1, x2,y2, x3,y3, x4,y4]
 * @param {number[]} quad - Quad coordinates
 * @returns {{x: number, y: number}}
 */
export function calculateQuadCenter(quad) {
  let x = 0, y = 0;
  for (let i = 0; i < 8; i += 2) {
    x += quad[i];
    y += quad[i + 1];
  }
  return { x: x / 4, y: y / 4 };
}

/**
 * Calculate area of a quad using shoelace formula
 * @param {number[]} quad - Quad coordinates
 * @returns {number}
 */
export function calculateQuadArea(quad) {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += quad[i * 2] * quad[j * 2 + 1];
    area -= quad[j * 2] * quad[i * 2 + 1];
  }
  return Math.abs(area) / 2;
}

/**
 * Check if a point is inside a quad using ray casting algorithm
 * @param {number[]} quad - Quad coordinates
 * @param {number} x - Point x
 * @param {number} y - Point y
 * @returns {boolean}
 */
export function isPointInQuad(quad, x, y) {
  const points = [];
  for (let i = 0; i < 8; i += 2) {
    points.push({ x: quad[i], y: quad[i + 1] });
  }

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Get the largest quad from an array (most likely the visible content area)
 * @param {number[][]} quads - Array of quads
 * @returns {number[]|null}
 */
export function getLargestQuad(quads) {
  if (!quads || quads.length === 0) return null;
  if (quads.length === 1) return quads[0];

  let largest = quads[0];
  let largestArea = calculateQuadArea(quads[0]);

  for (let i = 1; i < quads.length; i++) {
    const area = calculateQuadArea(quads[i]);
    if (area > largestArea) {
      largestArea = area;
      largest = quads[i];
    }
  }
  return largest;
}
