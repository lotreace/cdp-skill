/**
 * Temp Directory Utilities
 * Handles temp directory creation and path resolution for CDP skill outputs
 */

import os from 'os';
import path from 'path';
import fs from 'fs/promises';

let _tempDir = null;

/**
 * Get the platform-specific temp directory for CDP skill outputs (screenshots, PDFs, etc.)
 * Creates the directory if it doesn't exist
 * @returns {Promise<string>} Absolute path to temp directory
 */
export async function getTempDir() {
  if (_tempDir) return _tempDir;

  const baseTemp = os.tmpdir();
  _tempDir = path.join(baseTemp, 'cdp-skill');

  await fs.mkdir(_tempDir, { recursive: true });
  return _tempDir;
}

/**
 * Get the temp directory synchronously (returns cached value or creates new)
 * Note: First call should use getTempDir() to ensure directory exists
 * @returns {string} Absolute path to temp directory
 */
export function getTempDirSync() {
  if (_tempDir) return _tempDir;

  const baseTemp = os.tmpdir();
  _tempDir = path.join(baseTemp, 'cdp-skill');
  return _tempDir;
}

/**
 * Resolve a file path, using temp directory for relative paths
 * @param {string} filePath - File path (relative or absolute)
 * @param {string} [extension] - Default extension to add if missing
 * @returns {Promise<string>} Absolute path
 */
export async function resolveTempPath(filePath, extension) {
  // If already absolute, use as-is
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  // For relative paths, put in temp directory
  const tempDir = await getTempDir();
  let resolved = path.join(tempDir, filePath);

  // Add extension if missing
  if (extension && !path.extname(resolved)) {
    resolved += extension;
  }

  return resolved;
}

/**
 * Generate a unique temp file path with timestamp
 * @param {string} prefix - File prefix (e.g., 'screenshot', 'page')
 * @param {string} extension - File extension (e.g., '.png', '.pdf')
 * @returns {Promise<string>} Unique absolute path in temp directory
 */
export async function generateTempPath(prefix, extension) {
  const tempDir = await getTempDir();
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return path.join(tempDir, `${prefix}-${timestamp}-${random}${extension}`);
}
