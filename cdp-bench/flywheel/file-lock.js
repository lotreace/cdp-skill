/**
 * File-based locking for concurrent file access
 * Prevents race conditions when multiple processes read/modify/write shared files
 * Uses atomic filesystem operations and exponential backoff
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const LOCK_TIMEOUT_MS = 10000; // Maximum time to wait for lock
const LOCK_CHECK_INTERVAL_MS = 50; // Initial check interval (doubles each retry)
const STALE_LOCK_THRESHOLD_MS = 30000; // Clean up locks older than 30s

/**
 * Create a file lock manager
 * @param {string} lockDir - Directory to store lock files (defaults to tmp)
 * @returns {Object} Lock manager with acquire/release methods
 */
export function createFileLock(lockDir = path.join(os.tmpdir(), 'cdp-bench-locks')) {
  // Ensure lock directory exists
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }

  /**
   * Get lock file path for a resource
   * @param {string} resourcePath - Absolute path to the file being locked
   * @returns {string} Path to lock file
   */
  function getLockPath(resourcePath) {
    // Use filename + inode-like hash to handle same-named files in different dirs
    const basename = path.basename(resourcePath);
    const hash = resourcePath.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0);
    return path.join(lockDir, `${basename}.${Math.abs(hash)}.lock`);
  }

  /**
   * Check if lock is stale (older than threshold)
   * @param {string} lockPath - Path to lock file
   * @returns {boolean} True if lock should be cleaned up
   */
  function isLockStale(lockPath) {
    try {
      const stat = fs.statSync(lockPath);
      const age = Date.now() - stat.mtimeMs;
      return age > STALE_LOCK_THRESHOLD_MS;
    } catch {
      return false; // Lock doesn't exist, not stale
    }
  }

  /**
   * Acquire exclusive lock on a file
   * @param {string} resourcePath - Absolute path to file to lock
   * @param {number} timeoutMs - Max time to wait (default: 10s)
   * @returns {Promise<Function>} Release function to unlock
   * @throws {Error} If lock cannot be acquired within timeout
   */
  async function acquire(resourcePath, timeoutMs = LOCK_TIMEOUT_MS) {
    const lockPath = getLockPath(resourcePath);
    const startTime = Date.now();
    let checkInterval = LOCK_CHECK_INTERVAL_MS;

    // Exponential backoff loop
    while (Date.now() - startTime < timeoutMs) {
      try {
        // Clean up stale locks before attempting to acquire
        if (isLockStale(lockPath)) {
          try {
            fs.unlinkSync(lockPath);
          } catch { /* ignore if someone else cleaned it */ }
        }

        // Atomic lock acquisition using O_EXCL flag (fails if file exists)
        const lockData = JSON.stringify({
          pid: process.pid,
          timestamp: Date.now(),
          resource: resourcePath
        });
        fs.writeFileSync(lockPath, lockData, { flag: 'wx' });

        // Lock acquired! Return release function
        let released = false;
        return function release() {
          if (released) return; // Idempotent
          released = true;
          try {
            fs.unlinkSync(lockPath);
          } catch { /* ignore if lock already removed */ }
        };
      } catch (err) {
        // Lock exists, wait and retry with exponential backoff
        if (err.code === 'EEXIST') {
          await new Promise(resolve => setTimeout(resolve, checkInterval));
          checkInterval = Math.min(checkInterval * 2, 1000); // Cap at 1s
        } else {
          throw err; // Unexpected error
        }
      }
    }

    throw new Error(`Failed to acquire lock for ${resourcePath} after ${timeoutMs}ms`);
  }

  /**
   * Execute a function with exclusive file lock
   * @template T
   * @param {string} resourcePath - Absolute path to file to lock
   * @param {Function} fn - Function to execute while holding lock
   * @returns {Promise<T>} Result of fn()
   */
  async function withLock(resourcePath, fn) {
    const release = await acquire(resourcePath);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Read-modify-write with atomic lock
   * @param {string} filePath - File to modify
   * @param {Function} modifier - (data: Object) => Object
   * @returns {Promise<Object>} Modified data
   */
  async function atomicModify(filePath, modifier) {
    return withLock(filePath, () => {
      let data;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        data = JSON.parse(content);
      } catch (err) {
        if (err.code === 'ENOENT') {
          data = {}; // File doesn't exist, start with empty object
        } else {
          throw err;
        }
      }

      const modified = modifier(data);
      fs.writeFileSync(filePath, JSON.stringify(modified, null, 2), 'utf8');
      return modified;
    });
  }

  return {
    acquire,
    withLock,
    atomicModify
  };
}
