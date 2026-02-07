#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, basename, join } from 'path';
import { homedir } from 'os';
import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync, rmSync, cpSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageRoot = __dirname;
const skillName = basename(packageRoot);
const isDevMode = !packageRoot.includes('node_modules');

const targets = [
  { name: 'claude', path: join(homedir(), '.claude', 'skills', skillName) },
  { name: 'codex', path: join(homedir(), '.codex', 'skills', skillName) },
];

const filesToCopy = [
  'SKILL.md',
  'EXAMPLES.md',
  'src',
];

function ensureParentDir(targetPath) {
  const parent = dirname(targetPath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

function removeExisting(targetPath) {
  if (!existsSync(targetPath)) {
    return;
  }

  try {
    const stat = lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      unlinkSync(targetPath);
    } else {
      rmSync(targetPath, { recursive: true });
    }
  } catch (err) {
    console.warn(`  Warning: Could not remove existing ${targetPath}: ${err.message}`);
  }
}

function createSymlink(source, target) {
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(source, target, type);
}

function copyFiles(targetPath) {
  mkdirSync(targetPath, { recursive: true });

  for (const file of filesToCopy) {
    const sourcePath = join(packageRoot, file);
    const destPath = join(targetPath, file);

    if (!existsSync(sourcePath)) {
      console.warn(`  Warning: ${file} not found, skipping`);
      continue;
    }

    cpSync(sourcePath, destPath, { recursive: true });
  }
}

console.log(`Installing skill: ${skillName}`);
console.log(`Mode: ${isDevMode ? 'development (symlink)' : 'production (copy)'}`);
console.log();

for (const target of targets) {
  try {
    ensureParentDir(target.path);
    removeExisting(target.path);

    if (isDevMode) {
      createSymlink(packageRoot, target.path);
      console.log(`✓ Dev symlink: ${target.path} -> ${packageRoot}`);
    } else {
      copyFiles(target.path);
      console.log(`✓ Installed to ${target.name}: ${target.path}`);
    }
  } catch (err) {
    console.warn(`✗ Failed to install to ${target.name}: ${err.message}`);
  }
}

console.log();
console.log('Installation complete.');
