# NPM Skill Installer Specification

## Overview

Create a minimal, zero-dependency npm package structure that automatically installs a Claude Code / Codex skill into the appropriate directories when a user runs `npm i -g package-name` or `npm i ../local-path`.

## Goals

- Zero runtime dependencies (vanilla Node.js only)
- Skill name derived from the containing folder name
- Auto-detect dev mode (local path install) and use symlinks for live editing
- Production installs copy files
- Support both Claude Code and Codex CLI targets
- Clean uninstall that handles both symlinks and copied files

## File Structure

```
my-skill-name/
├── package.json
├── install.js
├── uninstall.js
├── SKILL.md
└── (optional additional files: scripts/, examples/, reference.md, etc.)
```

The folder name `my-skill-name` becomes the skill name in the target directories.

## Target Directories

| Tool        | Path                                      |
|-------------|-------------------------------------------|
| Claude Code | `~/.claude/skills/{skill-name}/`          |
| Codex CLI   | `~/.codex/skills/{skill-name}/`           |

## package.json

```json
{
  "name": "@scope/my-skill-name",
  "version": "1.0.0",
  "description": "Brief description of what this skill does",
  "scripts": {
    "postinstall": "node install.js",
    "preuninstall": "node uninstall.js"
  },
  "files": [
    "install.js",
    "uninstall.js",
    "SKILL.md"
  ],
  "keywords": ["claude-code", "codex", "skill"],
  "license": "MIT"
}
```

Note: The `files` array should be extended to include any additional files the skill requires (scripts/, reference.md, etc.).

## install.js Specification

### Behavior

1. **Determine skill name**: Extract from the immediate parent folder name of the script (i.e., `path.basename(path.dirname(__filename))` or equivalent for the package root).

2. **Detect dev mode**: A dev install is detected when ALL of the following are true:
    - The package directory contains a `.git` folder OR the path does not contain `node_modules`
    - `process.env.npm_config_global` is not `'true'`

   Alternative simpler heuristic: if `__dirname` does not include `node_modules`, treat as dev mode.

3. **For each target directory**:
    - Create parent directory if it doesn't exist (`~/.claude/skills/`, `~/.codex/skills/`)
    - Remove any existing installation (symlink or directory) at the target path
    - **Dev mode**: Create a symlink from target to the package source directory
    - **Production mode**: Create the target directory and copy all skill files

4. **Files to copy in production mode**:
    - `SKILL.md` (required)
    - Any additional files/folders specified in a config (see Config section)

5. **Output**: Log success/skip messages to stdout. Do not throw on permission errors; warn and continue to next target.

### Config (optional enhancement)

Support an optional `.skillconfig.json` in the package root:

```json
{
  "files": ["SKILL.md", "reference.md", "scripts/"],
  "targets": ["claude", "codex"]
}
```

If not present, default to:
- files: `["SKILL.md"]`
- targets: `["claude", "codex"]`

### Pseudocode

```
skillName = basename(packageRoot)
isDevMode = !packageRoot.includes('node_modules')

targets = [
  { name: 'claude', path: ~/.claude/skills/{skillName} },
  { name: 'codex',  path: ~/.codex/skills/{skillName} },
]

for each target:
  ensure parent directory exists
  remove existing target if present (rm -rf or unlink)
  
  if isDevMode:
    symlink(packageRoot -> target.path)
    log "✓ Dev symlink: {target.path} -> {packageRoot}"
  else:
    mkdir(target.path)
    for each file in filesToCopy:
      copy(packageRoot/file -> target.path/file)  # preserve directory structure
    log "✓ Installed to {target.name}: {target.path}"
```

## uninstall.js Specification

### Behavior

1. Determine skill name (same logic as install.js)
2. For each target directory:
    - Check if path exists
    - If symlink: `fs.unlinkSync()`
    - If directory: `fs.rmSync(path, { recursive: true })`
    - Log removal or skip if not present

### Pseudocode

```
skillName = basename(packageRoot)

targets = [
  ~/.claude/skills/{skillName},
  ~/.codex/skills/{skillName},
]

for each target:
  if not exists: continue
  
  if isSymlink(target):
    unlink(target)
  else:
    rmSync(target, recursive)
  
  log "✓ Removed: {target}"
```

## Edge Cases to Handle

1. **Permission denied**: Warn and continue, don't fail the npm install
2. **Target already exists as wrong type**: Remove before creating (e.g., was a symlink, now copying files)
3. **Symlink points to non-existent path**: Remove it anyway
4. **Windows compatibility**: Use `'junction'` type for directory symlinks on Windows (third argument to `fs.symlinkSync`)
5. **pnpm/yarn**: May have different `node_modules` structures; the `node_modules` detection heuristic should still work

## Testing Checklist

- [ ] `npm i -g .` from package root installs via copy
- [ ] `npm i ../my-skill-name` from another project installs via symlink
- [ ] Editing SKILL.md after symlink install reflects in `~/.claude/skills/`
- [ ] `npm uninstall -g package-name` removes the skill cleanly
- [ ] `npm uninstall ../my-skill-name` removes symlinks cleanly
- [ ] Running install twice doesn't error (idempotent)
- [ ] Works on macOS, Linux, Windows

## Example Usage

### As a published package
```bash
npm i -g @anthropic-community/pdf-skill
# -> Copies to ~/.claude/skills/pdf-skill/ and ~/.codex/skills/pdf-skill/
```

### During development
```bash
cd ~/projects/my-app
npm i ../my-pdf-skill
# -> Symlinks ~/.claude/skills/my-pdf-skill -> ~/projects/my-pdf-skill
# -> Edit ~/projects/my-pdf-skill/SKILL.md, changes appear immediately
```

### Uninstall
```bash
npm uninstall -g @anthropic-community/pdf-skill
# -> Removes ~/.claude/skills/pdf-skill/ and ~/.codex/skills/pdf-skill/
```

## Out of Scope

- Marketplace/registry integration
- Version tracking or manifests
- Dependency resolution between skills
- GUI or interactive prompts