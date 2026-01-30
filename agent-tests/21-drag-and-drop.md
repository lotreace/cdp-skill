# Test 21: Drag and Drop Sortable List

## Objective
Test drag and drop functionality to reorder elements in a sortable list. This is notoriously difficult with CDP because it requires precise mouse event sequences.

## Steps

1. Navigate to https://the-internet.herokuapp.com/drag_and_drop
2. Take a snapshot to identify the two draggable columns (A and B)
3. Query the initial order - Column A should be on the left, Column B on the right
4. Perform drag and drop to swap the columns:
   - Use `{"drag": {"from": "#column-a", "to": "#column-b"}}` if available
   - OR manually simulate: mousedown on A, mousemove to B's position, mouseup
5. Verify the columns have swapped positions (A is now on right, B on left)
6. Navigate to https://jqueryui.com/sortable/
7. Switch to the iframe containing the sortable demo
8. Query the initial list order (Item 1, Item 2, Item 3, etc.)
9. Drag Item 3 to the top of the list
10. Verify Item 3 is now first in the list
11. Drag Item 5 between Item 1 and Item 2
12. Verify the new order reflects the change

## Expected Results
- Drag events should move elements between positions
- Sortable lists should accept reordering
- Position changes should persist after drop

## Difficulty
- CDP mouse events require precise coordinate calculations
- Some sites use HTML5 drag/drop API which may need `dataTransfer` events
- jQuery UI sortable uses different event handling than native drag/drop

## Notes
- May need to use `{"eval": "..."}` to trigger drag events programmatically if native doesn't work
- The iframe on jqueryui.com adds complexity
- Consider using `{"hover": selector}` before drag to ensure element is in correct state
