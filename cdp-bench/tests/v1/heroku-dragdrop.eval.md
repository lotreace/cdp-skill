---
id: heroku-dragdrop
name: The Internet - Drag and Drop
category: forms
site: https://the-internet.herokuapp.com/drag_and_drop

goal: |
  Complete the drag and drop challenge by dragging element A to element B's position,
  and verify the elements have swapped positions.

success_criteria:
  - Element A successfully dragged to element B's position
  - Elements visually swapped (A is now where B was, and vice versa)
  - Page state reflects the completed drag operation

milestones:
  - id: page_loaded
    description: Drag and drop page loaded with both columns visible
    weight: 0.15
  - id: elements_identified
    description: Identified column A and column B elements
    weight: 0.15
  - id: drag_initiated
    description: Started drag operation on column A
    weight: 0.25
  - id: drop_completed
    description: Dropped element onto column B position and elements swapped
    weight: 0.45

constraints:
  max_steps: 15
  max_time_ms: 60000
  max_retries: 3

improvement_focus: [actions, coordinates, mouse-events]
tags: [drag-drop, mouse-events, html5-dnd]
difficulty: hard
version: 1
---

# The Internet - Drag and Drop Test

## Site Information

"The Internet" (the-internet.herokuapp.com) is a collection of test automation practice pages. The drag and drop page tests HTML5 native drag-and-drop functionality, which is notoriously challenging for browser automation tools.

## Page Structure

The page contains two square columns side by side:
- **Column A**: Left column, contains header text "A"
- **Column B**: Right column, contains header text "B"

Both columns use HTML5 `draggable="true"` attribute and respond to native drag/drop events.

## HTML5 Drag and Drop

This page uses the HTML5 Drag and Drop API:
- `dragstart` event when drag begins
- `dragover` event while dragging over a drop target
- `drop` event when released on a drop target
- `dragend` event when drag operation completes

## Challenge Details

The goal is to drag column A onto column B (or vice versa). When successful:
- The headers swap: "A" appears where "B" was, and "B" appears where "A" was
- This is the visual confirmation of a successful drag operation

## Automation Approaches

Drag and drop can be automated several ways:

1. **Mouse events sequence**:
   - mousedown on source
   - mousemove to target
   - mouseup on target

2. **HTML5 DnD events**:
   - Dispatch dragstart on source
   - Dispatch dragover/drop on target
   - Dispatch dragend

3. **Direct DOM manipulation**:
   - Use JavaScript to swap elements (less realistic but reliable)

## Element Identification

- Column A: `#column-a` or the first `div.column` with header "A"
- Column B: `#column-b` or the second `div.column` with header "B"
- Both columns are within a `#columns` container

## Success Verification

After the drag operation:
- Check that `#column-a` now contains header "B"
- Check that `#column-b` now contains header "A"
- Or verify via snapshot that the text positions have swapped

## Notes for Agent

- HTML5 drag-and-drop is one of the harder interactions to automate
- The page uses standard HTML5 DnD, not a custom library
- Mouse event sequences may not trigger the DnD API correctly
- May need to dispatch synthetic drag events via JavaScript
- Use snapshot before and after to verify the swap occurred
- If standard approach fails, consider using CDP's Input.dispatchDragEvent
- The columns have clear visual boundaries for positioning
