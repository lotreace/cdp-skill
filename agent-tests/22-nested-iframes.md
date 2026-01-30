# Test 22: Nested iFrame Interaction

## Objective
Test interaction with elements inside nested iframes. iFrames create separate browsing contexts that require special handling.

## Steps

1. Navigate to https://the-internet.herokuapp.com/nested_frames
2. Take a snapshot - should show the frame structure
3. The page has a frameset with:
   - Top frame (contains LEFT, MIDDLE, RIGHT frames)
   - Bottom frame
4. Query the content of each frame:
   - Access the "MIDDLE" frame text (nested inside top frame)
   - Access the "BOTTOM" frame text
5. Navigate to https://the-internet.herokuapp.com/iframe
6. Take a snapshot to find the TinyMCE editor iframe
7. Switch context to the iframe containing the editor
8. Clear the existing text in the editor
9. Type "Hello from inside the iframe!" into the editor
10. Switch back to the main frame
11. Click the "File" menu in TinyMCE toolbar
12. Verify the menu opens (snapshot should show menu items)
13. Navigate to https://www.w3schools.com/html/tryit.asp?filename=tryhtml_basic
14. This page has an iframe showing the result
15. Query the content inside the result iframe
16. Modify the code in the editor (left side)
17. Click "Run" button
18. Verify the result iframe updated with new content

## Expected Results
- Should be able to query content from nested frames
- Should be able to type into iframe-embedded editors
- Changes in parent should reflect in child iframes after refresh

## Difficulty
- iFrames have separate execution contexts
- Nested frames require traversing the frame tree
- Cross-origin iframes may be inaccessible
- TinyMCE editor has complex DOM structure inside iframe

## Notes
- May need `{"switchToFrame": "iframe-selector"}` or similar
- Use `{"eval": "...", "frame": "selector"}` to execute in specific frame
- Some operations may require waiting for iframe to load
