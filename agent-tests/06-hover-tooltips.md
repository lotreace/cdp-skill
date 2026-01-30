# Test 6: Hover and Tooltips

## Objective
Test hover action and tooltip visibility.

## Steps

1. Navigate to a page with hover-triggered tooltips (e.g., https://demoqa.com/tool-tips)
2. Take a snapshot to find hoverable elements
3. Hover over an element that has a tooltip
4. Wait briefly for tooltip to appear
5. Take a screenshot to capture the tooltip
6. Query or snapshot to verify tooltip text is visible
7. Move hover to a different element
8. Verify first tooltip disappears and new one appears

## Expected Results
- Hover should trigger mouseover events
- Tooltips should become visible after hover
- Screenshots should capture tooltip state
- Moving hover should change tooltip

## Notes
- This test was killed in original run - may have timeout issues
- Some tooltips use CSS :hover which should work
- JavaScript-based tooltips may need longer wait times
