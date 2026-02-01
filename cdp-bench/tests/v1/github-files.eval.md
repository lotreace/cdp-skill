---
id: github-files
name: GitHub Repository File Browser
category: tables
site: https://github.com/microsoft/vscode

goal: |
  Navigate GitHub's file browser, explore directories, and view file contents.

success_criteria:
  - Repository file list loaded
  - Successfully navigated into a folder and viewed a file

milestones:
  - id: repo_loaded
    description: Repository main page loaded with file list visible
    weight: 0.15
  - id: readme_visible
    description: README content displayed below file list
    weight: 0.2
  - id: folder_navigated
    description: Clicked into a subfolder and see its contents
    weight: 0.3
  - id: file_viewed
    description: Opened a file and see its content/code
    weight: 0.35

constraints:
  max_steps: 20
  max_time_ms: 90000
  max_retries: 2

improvement_focus: [navigation, selectors, observations]
tags: [file-browser, code-view, nested-navigation]
difficulty: medium
version: 1
---

# GitHub Repository File Browser Test

## Site Information

GitHub's repository file browser is a table-like interface for navigating code. This test uses the VS Code repository as an example of a large, active project.

## Test Steps

1. Navigate to github.com/microsoft/vscode
2. Verify the repository page loads with file list
3. Observe the README rendered below the file list
4. Click on a folder (e.g., "src" or "extensions")
5. Verify folder contents are displayed
6. Click on a file to view its contents
7. Verify file content is displayed (code with syntax highlighting)

## Page Structure

- **File List**: Table of files/folders with name, commit message, last update
- **Folder Icons**: Indicate directories vs files
- **README**: Rendered markdown below file list
- **Breadcrumb**: Shows current path within repository
- **Branch Selector**: Dropdown to change branches

## Navigation Patterns

- Clicking a folder navigates into it (URL changes)
- Clicking a file shows its content (URL changes)
- Breadcrumb allows jumping to parent directories
- Back button works for navigation

## Suggested Navigation Path

1. Repository root: `/microsoft/vscode`
2. Click "src" folder
3. Click "vs" folder
4. Click any `.ts` or `.json` file

## Notes for Agent

- GitHub uses dynamic loading - wait for content to stabilize
- File list rows are clickable table rows
- Some folders have many files - may need scrolling
- Code view has line numbers and syntax highlighting
- The site may prompt for sign-in for some features (ignore for this test)
