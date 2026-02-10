/**
 * Tests for file-lock.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createFileLock } from './file-lock.js';

describe('FileLock', () => {
  let testDir;
  let lockDir;
  let testFile;
  let fileLock;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-lock-test-'));
    lockDir = path.join(testDir, 'locks');
    testFile = path.join(testDir, 'test.json');
    fs.writeFileSync(testFile, JSON.stringify({ counter: 0 }));
    fileLock = createFileLock(lockDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should acquire and release lock', async () => {
    const release = await fileLock.acquire(testFile);
    expect(typeof release).toBe('function');

    // Lock directory should exist
    expect(fs.existsSync(lockDir)).toBe(true);

    // Lock file should exist
    const lockFiles = fs.readdirSync(lockDir);
    expect(lockFiles.length).toBe(1);

    release();

    // Lock file should be removed
    const lockFilesAfter = fs.readdirSync(lockDir);
    expect(lockFilesAfter.length).toBe(0);
  });

  it('should prevent concurrent access', async () => {
    const results = [];

    const worker = async (id) => {
      const release = await fileLock.acquire(testFile, 5000);
      try {
        // Read current value
        const data = JSON.parse(fs.readFileSync(testFile, 'utf8'));
        const current = data.counter;

        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 50));

        // Increment and write
        data.counter = current + 1;
        fs.writeFileSync(testFile, JSON.stringify(data));

        results.push({ id, value: data.counter });
      } finally {
        release();
      }
    };

    // Launch 5 concurrent workers
    await Promise.all([
      worker(1),
      worker(2),
      worker(3),
      worker(4),
      worker(5)
    ]);

    // Final counter should be 5 (no lost updates)
    const finalData = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(finalData.counter).toBe(5);

    // All workers should see sequential values
    const values = results.map(r => r.value).sort((a, b) => a - b);
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it('should work with withLock helper', async () => {
    const result = await fileLock.withLock(testFile, () => {
      const data = JSON.parse(fs.readFileSync(testFile, 'utf8'));
      data.counter = 42;
      fs.writeFileSync(testFile, JSON.stringify(data));
      return data.counter;
    });

    expect(result).toBe(42);

    const finalData = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(finalData.counter).toBe(42);
  });

  it('should work with atomicModify helper', async () => {
    const result = await fileLock.atomicModify(testFile, (data) => {
      data.counter += 10;
      data.modified = true;
      return data;
    });

    expect(result.counter).toBe(10);
    expect(result.modified).toBe(true);

    const finalData = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(finalData.counter).toBe(10);
    expect(finalData.modified).toBe(true);
  });

  it('should handle non-existent files in atomicModify', async () => {
    const newFile = path.join(testDir, 'new-file.json');

    const result = await fileLock.atomicModify(newFile, (data) => {
      data.created = true;
      return data;
    });

    expect(result.created).toBe(true);
    expect(fs.existsSync(newFile)).toBe(true);
  });

  it('should timeout if lock cannot be acquired', async () => {
    const release = await fileLock.acquire(testFile);

    try {
      // Try to acquire again with short timeout
      await expect(
        fileLock.acquire(testFile, 100)
      ).rejects.toThrow(/Failed to acquire lock.*after 100ms/);
    } finally {
      release();
    }
  });

  it('should be idempotent on release', async () => {
    const release = await fileLock.acquire(testFile);

    release();
    release(); // Should not throw
    release(); // Should not throw
  });

  it('should handle exceptions in withLock', async () => {
    const error = new Error('Test error');

    await expect(
      fileLock.withLock(testFile, () => {
        throw error;
      })
    ).rejects.toThrow('Test error');

    // Lock should be released even after error
    const lockFilesAfter = fs.readdirSync(lockDir);
    expect(lockFilesAfter.length).toBe(0);
  });
});
