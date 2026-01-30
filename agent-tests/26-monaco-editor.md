# Test 26: Monaco/VS Code Editor Manipulation

## Objective
Test interaction with Monaco editor (the editor powering VS Code). Monaco doesn't use standard input elements - it has a complex virtualized rendering system that makes automation extremely challenging.

## Steps

### Part 1: Monaco Playground
1. Navigate to https://microsoft.github.io/monaco-editor/playground.html
2. Wait for the editor to fully load
3. Take a snapshot - note that Monaco's DOM is complex and may not expose text content easily
4. The editor should have sample JavaScript code loaded
5. **Goal: Navigate to line 5 and add a comment**
   - Use keyboard shortcut Ctrl+G (Go to Line) to open the "Go to Line" dialog
   - Type "5" and press Enter to jump to line 5
   - Press End to go to end of line
   - Press Enter to create a new line
   - Type "// This comment was added by automation"
6. Verify the comment was added by querying the editor content:
   - `{"eval": "monaco.editor.getModels()[0].getValue()"}`
7. **Goal: Select and delete lines 10-12**
   - Press Ctrl+G, type "10", Enter to go to line 10
   - Press Ctrl+Shift+K three times to delete 3 lines (or select lines and delete)
   - OR use: Ctrl+L to select line, then Shift+Down twice, then Delete
8. Verify 3 lines were removed
9. **Goal: Find and replace text**
   - Press Ctrl+H to open Find and Replace
   - Type "function" in the find field
   - Type "const myFunc = " in the replace field
   - Click "Replace All" or press Ctrl+Alt+Enter
10. Verify replacements were made
11. **Goal: Insert text at specific position (line 1, column 1)**
    - Press Ctrl+Home to go to beginning
    - Type: `"use strict";\n`
12. Verify the directive was added at the top

### Part 2: vscode.dev (Full VS Code)
13. Navigate to https://vscode.dev/
14. Wait for VS Code to fully load (may take several seconds)
15. Handle any welcome dialogs or popups
16. Press Ctrl+N to create a new file
17. A new untitled file should open
18. Type the following code:
```javascript
function calculateSum(arr) {
    let total = 0;
    for (let i = 0; i < arr.length; i++) {
        total += arr[i];
    }
    return total;
}
```
19. **Goal: Refactor using selection**
    - Select "let total = 0" on line 2 (Ctrl+D or double-click + shift)
    - Replace with "const total = arr.reduce((a, b) => a + b, 0)"
20. **Goal: Delete the for loop (lines 3-5)**
    - Navigate to line 3
    - Select lines 3, 4, 5
    - Delete them
21. **Goal: Fix the function to just return the reduce**
    - The function should now look like:
```javascript
function calculateSum(arr) {
    const total = arr.reduce((a, b) => a + b, 0);
    return total;
}
```
22. Press Ctrl+S to trigger save dialog (just verify it opens, then Escape)

### Part 3: CodeSandbox
23. Navigate to https://codesandbox.io/s/vanilla
24. Wait for sandbox to load
25. Find the editor pane (index.js or similar)
26. Navigate to a specific line and make an edit
27. Verify the edit appears in the preview pane

## Expected Results
- Should be able to navigate to specific lines via Ctrl+G
- Should be able to type text into Monaco editor
- Should be able to select, delete, and replace text
- Find and Replace dialog should work
- Editor content should be queryable via Monaco API

## Difficulty
- Monaco uses a `<textarea>` for input but renders separately
- The textarea is nearly invisible (1x1 pixel) and positioned absolutely
- Line rendering is virtualized - not all lines exist in DOM
- Selection highlighting is done via overlays, not native selection
- Keyboard shortcuts may be intercepted by the page
- VS Code web has additional abstraction layers

## Key Techniques
- Click on editor to focus it before typing
- Use `{"type": {"text": "..."}}` after focusing
- Use `{"press": "Control+g"}` for keyboard shortcuts
- Query editor state via: `monaco.editor.getModels()[0].getValue()`
- Get cursor position: `monaco.editor.getEditors()[0].getPosition()`
- Set cursor: `{"eval": "monaco.editor.getEditors()[0].setPosition({lineNumber: 5, column: 1})"}`

## Notes
- If standard input doesn't work, try clicking coordinates in the editor area
- Monaco's input textarea selector is often `.inputarea` or similar
- May need to use eval to interact with Monaco API directly
- vscode.dev may have additional overlays and welcome experiences to dismiss
- Take screenshots at each step to debug positioning issues
