---
id: github-command-palette
name: GitHub Command Palette Navigation
category: spa
site: https://github.com

goal: |
  Use GitHub's command palette (keyboard shortcut) to quickly navigate
  to repositories, files, and actions without using traditional navigation.

success_criteria:
  - Command palette opened via keyboard shortcut
  - Successfully navigated to a repository or page using the palette
  - Demonstrated type-ahead filtering in the palette

milestones:
  - id: page_loaded
    description: GitHub homepage or repository page loaded
    weight: 0.1
  - id: palette_opened
    description: Opened command palette using Cmd+K or Ctrl+K shortcut
    weight: 0.25
  - id: search_typed
    description: Typed a search query and saw filtered results
    weight: 0.3
  - id: navigation_completed
    description: Selected a result and navigated to the target page
    weight: 0.35

constraints:
  max_steps: 20
  max_time_ms: 90000
  max_retries: 3

improvement_focus: [keyboard, actions, waits]
tags: [keyboard-shortcuts, command-palette, type-ahead, modal]
difficulty: medium
version: 1
---

# GitHub Command Palette Navigation Test

## Site Information

GitHub's command palette is a keyboard-driven navigation feature similar to VS Code's command palette. It allows quick access to repositories, files, commands, and settings through fuzzy search matching.

## Test Steps

1. Navigate to github.com (no login required for basic palette)
2. Press keyboard shortcut to open command palette:
   - Mac: Cmd+K
   - Windows/Linux: Ctrl+K
3. Verify the command palette modal appears
4. Type a search query (e.g., "microsoft/vscode" or "react")
5. Wait for search results to appear
6. Use arrow keys or click to select a result
7. Press Enter or click to navigate
8. Verify navigation to the selected page

## Command Palette Features

The palette supports several search modes:
- **Repositories**: Type repo names to jump directly
- **Files**: Type `>` then filename to search files (requires being in a repo)
- **Commands**: Type `>` to access GitHub commands
- **Users/Orgs**: Type usernames to navigate to profiles

## Keyboard Interactions

- **Cmd/Ctrl+K**: Open palette
- **Escape**: Close palette
- **Arrow Up/Down**: Navigate results
- **Enter**: Select current result
- **Tab**: Cycle through result categories

## Search Query Suggestions

For anonymous users, try:
- "microsoft/vscode" - popular repository
- "facebook/react" - another popular repo
- "tensorflow" - search by keyword

## Page Structure

The command palette appears as:
- Modal overlay with dark backdrop
- Search input at top with icon
- Results list below, grouped by category
- Keyboard hints shown for navigation

## Notes for Agent

- The palette requires keyboard input - use `key` or `type` actions
- Results load asynchronously - wait for results to appear
- Palette closes on Escape or clicking outside
- No authentication needed for basic repository search
- Use snapshot to verify palette is open before typing
- Arrow key navigation works for selecting results
- The palette is a floating modal, not a new page
- Some features like file search require being in a repository context

## Keyboard Event Details

To trigger the command palette:
```javascript
// Dispatch keydown with Cmd/Ctrl modifier
key: "k", modifiers: ["Meta"] // Mac
key: "k", modifiers: ["Control"] // Windows/Linux
```

The palette listens for this key combination on the document level.

## Fallback Approach

If keyboard shortcut doesn't work:
1. Look for the search/command button in the header
2. It may have text like "Type / to search" or a search icon
3. Clicking this can also open the search/command interface
