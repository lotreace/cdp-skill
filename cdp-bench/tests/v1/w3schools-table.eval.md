---
id: w3schools-table
name: W3Schools HTML Table Examples
category: tables
site: https://www.w3schools.com/html/html_tables.asp

goal: |
  Navigate W3Schools table documentation and interact with try-it examples.

success_criteria:
  - Table examples page loaded
  - Successfully used the "Try it Yourself" editor

milestones:
  - id: page_loaded
    description: HTML tables documentation page loaded
    weight: 0.15
  - id: examples_found
    description: Found table examples in the documentation
    weight: 0.2
  - id: tryit_opened
    description: Clicked "Try it Yourself" to open code editor
    weight: 0.35
  - id: code_modified
    description: Modified code in editor and saw result update
    weight: 0.3

constraints:
  max_steps: 25
  max_time_ms: 90000
  max_retries: 2

improvement_focus: [navigation, actions, waits]
tags: [documentation, code-editor, iframes]
difficulty: medium
version: 1
---

# W3Schools HTML Table Examples Test

## Site Information

W3Schools is a popular web development tutorial site with interactive code examples. The table documentation includes "Try it Yourself" editors that allow live code modification.

## Test Steps

1. Navigate to W3Schools HTML tables page
2. Handle any cookie consent banners
3. Scroll through the documentation to find table examples
4. Find a "Try it Yourself" button
5. Click to open the editor
6. View the split editor (code on left, result on right)
7. Modify the HTML code (e.g., add a row or change text)
8. Click "Run" to update the result
9. Verify the result pane updated

## Page Structure

- **Tutorial Content**: Text and code examples
- **Code Snippets**: Highlighted HTML examples with "Try it Yourself" buttons
- **Try It Editor**: Split view with editable code and live preview

## Try It Editor

The editor opens in a new page or modal with:
- Left pane: Editable HTML code
- Right pane: Rendered preview
- "Run" button to execute code
- Code is pre-populated from the example

## Cookie Consent

W3Schools shows a cookie consent banner:
- Appears at bottom of page
- "Accept" or "Settings" options
- Must be dismissed or accepted to interact fully

## Notes for Agent

- The Try It editor may open in a new tab - handle tab switching
- Editor uses an iframe for the preview
- Code changes are made in a textarea or code editor component
- "Run" button triggers preview update
- Multiple examples on the page - choose one to interact with
- The site has ads that may cover content - scroll to ensure visibility
