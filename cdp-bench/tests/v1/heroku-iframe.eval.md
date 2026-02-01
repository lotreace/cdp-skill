---
id: heroku-iframe
name: The Internet - Iframe Editor
category: forms
site: https://the-internet.herokuapp.com/iframe

goal: |
  Test interaction with content inside an iframe by typing text into
  a TinyMCE rich text editor embedded within an iframe.

success_criteria:
  - Successfully switched context to the iframe
  - Typed text into the TinyMCE editor
  - Verified the typed text appears in the editor

milestones:
  - id: page_loaded
    description: Iframe editor page loaded with TinyMCE visible
    weight: 0.15
  - id: iframe_identified
    description: Identified the iframe containing the editor
    weight: 0.2
  - id: editor_focused
    description: Focused the text editor inside the iframe
    weight: 0.25
  - id: text_entered
    description: Successfully typed text into the editor and verified content
    weight: 0.4

constraints:
  max_steps: 20
  max_time_ms: 90000
  max_retries: 3

improvement_focus: [iframes, selectors, actions]
tags: [iframe, rich-text-editor, tinymce, cross-frame]
difficulty: hard
version: 1
---

# The Internet - Iframe Editor Test

## Site Information

"The Internet" (the-internet.herokuapp.com) is a collection of test automation practice pages. The iframe page contains a TinyMCE rich text editor embedded within an iframe, which is a common real-world scenario that requires special handling in browser automation.

## Page Structure

The page contains:
- A header and description text in the main document
- An `<iframe>` element containing the TinyMCE editor
- The TinyMCE toolbar (bold, italic, formatting options) outside or inside the iframe
- The editable content area inside the iframe

## The Challenge

Iframes create a separate document context. To interact with elements inside an iframe:
1. The iframe element must be identified in the parent document
2. Context must be switched to the iframe's document
3. Elements inside the iframe can then be accessed
4. Actions must target elements within the iframe context

## TinyMCE Editor

TinyMCE is a popular WYSIWYG editor that uses an iframe for its content-editable area:
- The toolbar buttons are typically in the parent document
- The actual text content is in an iframe with id `mce_0_ifr` or similar
- The editable area inside the iframe is typically a `<body>` with `contenteditable="true"` or a `#tinymce` element

## Test Steps

1. Navigate to the iframe editor page
2. Wait for TinyMCE to fully load (it initializes asynchronously)
3. Identify the iframe containing the editor content
4. Switch context to the iframe
5. Find the editable element (usually `body` or `#tinymce`)
6. Clear any existing content (default text: "Your content goes here.")
7. Type new text into the editor
8. Verify the text appears in the editor
9. Optionally: Switch back to parent and use toolbar buttons

## Element Identification

### In Parent Document:
- Iframe element: `#mce_0_ifr` or `iframe` within `.tox-edit-area`
- Toolbar: `.tox-toolbar` or similar TinyMCE classes
- Editor container: `#tinymce` or `.tox-tinymce`

### Inside Iframe:
- Editable body: `body#tinymce` or just `body`
- Content paragraph: `p` elements containing the text
- The body typically has `contenteditable="true"`

## Automation Approaches

### Approach 1: CDP Frame Context
Use CDP to get the frame's execution context and run scripts there:
```javascript
// Get frame info
Page.getFrameTree()
// Execute in frame context
Runtime.evaluate({ contextId: frameContextId, ... })
```

### Approach 2: Direct Element Access
Some CDP methods can target elements by backend node ID across frames:
```javascript
// Get iframe's content document
DOM.describeNode({ objectId: iframeObjectId })
// Access nodes inside iframe
DOM.querySelector({ nodeId: iframeDocumentNodeId, selector: "body" })
```

### Approach 3: JavaScript Evaluation
Execute JavaScript that accesses iframe content:
```javascript
document.querySelector('iframe').contentDocument.body.innerText = 'New text';
```

## Default Content

The editor starts with default text:
```
Your content goes here.
```

This should be cleared or selected before typing new content.

## Verification

After typing, verify by:
- Reading the text content of the editable element
- Taking a snapshot that includes iframe content
- Checking that the typed text appears in the editor

## Notes for Agent

- TinyMCE takes a moment to initialize - wait for the editor to be ready
- The iframe may have a different document - snapshot may need to include it
- Cross-origin iframes would be blocked, but this is same-origin
- If direct iframe access fails, try JavaScript injection approach
- The editor has default content that should be handled
- Focus management is important - click inside editor before typing
- TinyMCE version may vary - selector patterns might differ slightly
- The toolbar is typically outside the iframe, content inside
- Some commands need to target the iframe's document context specifically

## Expected Behaviors

- Page loads with TinyMCE editor visible
- Editor shows default text initially
- Clicking inside editor focuses the content area
- Typing should append or replace text based on selection
- Toolbar buttons (Bold, Italic, etc.) format selected text
- Content persists until page refresh

## Alternative Test: Toolbar Interaction

If basic typing works, also test toolbar:
1. Select some text in the editor
2. Click the Bold button in the toolbar
3. Verify the selected text becomes bold (wrapped in `<strong>` tags)
