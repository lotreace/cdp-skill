# Test 27: Complex Rich Text WYSIWYG Editor (Slate/TipTap/ProseMirror)

## Objective
Test interaction with modern block-based rich text editors. Unlike Monaco (code editor), WYSIWYG editors like Notion, Confluence, or Google Docs use contenteditable with complex DOM manipulation, making them extremely challenging to automate.

## Steps

### Part 1: TipTap Playground
1. Navigate to https://tiptap.dev/playground
2. Wait for the editor to fully load
3. Take a snapshot - note the contenteditable structure
4. Clear any existing content (Ctrl+A, then Delete)
5. **Goal: Create formatted text**
   - Type "Hello World" and press Enter
   - Type "This is **bold** text" - select "bold" and press Ctrl+B
   - Type " and this is *italic*" - select "italic" and press Ctrl+I
   - Press Enter twice
6. **Goal: Create a heading**
   - Type "# " (hash + space) at the start of a line to trigger heading conversion
   - Type "Main Heading"
   - Press Enter
7. **Goal: Create a bullet list**
   - Type "- " to start a bullet list
   - Type "First item" and press Enter
   - Type "Second item" and press Enter
   - Type "Third item" and press Enter twice (to exit list)
8. **Goal: Create a numbered list**
   - Type "1. " to start numbered list
   - Type "Step one" and press Enter
   - Type "Step two" and press Enter
   - Press Tab to nest this item
   - Type "Nested step" and press Enter
   - Press Shift+Tab to un-nest
   - Type "Step three"
9. Query the editor content:
   - `{"eval": "document.querySelector('[contenteditable]').innerHTML"}`
10. Verify the HTML contains `<h1>`, `<ul>`, `<ol>`, `<strong>`, `<em>` tags

### Part 2: Slate.js Examples
11. Navigate to https://www.slatejs.org/examples/richtext
12. Wait for editor to load
13. **Goal: Test keyboard shortcuts**
    - Click inside the editor to focus
    - Select all (Ctrl+A) and delete
    - Type "Testing Slate" and press Enter
    - Type "Bold text" - select it, press Ctrl+B
    - Verify text is bold
14. **Goal: Test block types**
    - Press Enter for new line
    - Find and click the "heading" dropdown/button (may vary)
    - Or use keyboard: select line, apply heading format
15. Take screenshot of formatted content

### Part 3: Quill Editor
16. Navigate to https://quilljs.com/playground/snow
17. Wait for Quill to load
18. Clear editor content
19. **Goal: Use toolbar formatting**
    - Click the Bold button in toolbar
    - Type "Bold from toolbar"
    - Click Bold again to toggle off
    - Click Italic button
    - Type " Italic from toolbar"
20. **Goal: Insert a link**
    - Type "Click here" and select it
    - Click the Link button in toolbar
    - In the popup, enter "https://google.com"
    - Confirm the link
21. **Goal: Insert a code block**
    - Press Enter, then click Code Block button
    - Type `function test() { return true; }`
22. Query editor content:
    - `{"eval": "document.querySelector('.ql-editor').innerHTML"}`
23. Verify HTML structure

### Part 4: Lexical (Meta's Editor)
24. Navigate to https://playground.lexical.dev/
25. Wait for playground to load
26. **Goal: Test slash commands** (if supported)
    - Type "/" to open command menu
    - Select or type "heading"
    - Type heading text
27. **Goal: Test mention/autocomplete**
    - Type "@" to trigger mention popup (if available)
    - Type partial name and select from dropdown
28. **Goal: Test drag-and-drop blocks**
    - Create multiple paragraphs
    - Attempt to drag a block handle to reorder
    - Use query to detect block handles: `[draggable="true"]`
29. **Goal: Test undo/redo**
    - Make several edits
    - Press Ctrl+Z multiple times
    - Press Ctrl+Y to redo
    - Verify content state
30. Take final screenshot

### Part 5: Google Docs (Advanced)
31. Navigate to https://docs.google.com/document/create
32. Handle any login prompts (may need to skip if not authenticated)
33. If accessible without login:
    - Wait for editor to load
    - Type "Google Docs Test"
    - Apply formatting using toolbar
34. Note: Google Docs uses canvas rendering in some cases, making DOM interaction impossible

## Expected Results
- Should be able to type text into contenteditable regions
- Keyboard shortcuts (Ctrl+B, Ctrl+I) should toggle formatting
- Markdown shortcuts (# for heading, - for list) should work in TipTap
- Toolbar buttons should be clickable and apply formatting
- Editor content should be queryable via innerHTML
- Nested lists should be achievable via Tab/Shift+Tab

## Difficulty
- ContentEditable is notoriously inconsistent across browsers
- Selection APIs are complex (Range, Selection objects)
- Many editors use virtual DOM or synthetic events
- Toolbars may use custom event handlers that bypass native input
- Some editors intercept and transform all keyboard input
- Block-based editors (Notion-style) have complex focus management
- Drag handles may require precise coordinate clicking
- Undo/redo stacks may not respond to Ctrl+Z in expected ways

## Key Techniques
- Focus contenteditable before typing: click on `[contenteditable="true"]`
- Use `{"type": {"text": "..."}}` for text input
- For formatting, type text first, then:
  1. Query for the text node: `{"eval": "window.getSelection().selectAllChildren(document.querySelector('[contenteditable]').firstChild)"}`
  2. Or use keyboard to select (Shift+Ctrl+Left)
  3. Then press formatting key
- Query selection state: `{"eval": "window.getSelection().toString()"}`
- Get cursor position: `{"eval": "window.getSelection().getRangeAt(0).startOffset"}`
- For toolbar buttons, use role queries: `{"query": {"role": "button", "name": "Bold"}}`

## Common Pitfalls
- Clicking "outside" the editable area won't focus it
- Pressing Enter may create `<div>`, `<p>`, or `<br>` depending on editor
- Copy/paste may strip formatting
- Tab key may move focus instead of indenting
- Some editors require clicking a specific "+" or block handle to add content
- Autosave may trigger network requests that cause state changes

## Success Criteria
- Successfully input formatted text in at least 3 different editor frameworks
- Create headings, bold/italic text, and lists
- Query and verify the resulting HTML structure
- Handle toolbar interactions
- Navigate and edit existing content
