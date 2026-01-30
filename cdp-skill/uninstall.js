#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, basename, join } from 'path';
import { homedir } from 'os';
import { existsSync, lstatSync, unlinkSync, rmSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageRoot = __dirname;
const skillName = basename(packageRoot);

const targets = [
  join(homedir(), '.claude', 'skills', skillName),
  join(homedir(), '.codex', 'skills', skillName),
];

console.log(`Uninstalling skill: ${skillName}`);
console.log();

for (const targetPath of targets) {
  try {
    if (!existsSync(targetPath)) {
      console.log(`  Skipped: ${targetPath} (not found)`);
      continue;
    }

    const stat = lstatSync(targetPath);

    if (stat.isSymbolicLink()) {
      unlinkSync(targetPath);
      console.log(`✓ Removed symlink: ${targetPath}`);
    } else {
      rmSync(targetPath, { recursive: true });
      console.log(`✓ Removed directory: ${targetPath}`);
    }
  } catch (err) {
    console.warn(`✗ Failed to remove ${targetPath}: ${err.message}`);
  }
}

console.log();
console.log('Uninstallation complete.');
