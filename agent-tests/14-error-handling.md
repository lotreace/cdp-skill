# Test 14: Error Handling

## Objective
Test how the skill handles various error conditions.

## Steps

1. Navigate to any page
2. Try clicking a non-existent selector - should fail with clear message
3. Try an invalid CSS selector (e.g., `[[[invalid`) - check error message
4. Try scrolling to non-existent element
5. Try pressing an invalid key name
6. Try filling a non-editable element (e.g., h1)
7. Try using an invalid targetId
8. Test timeout behavior with a very slow operation
9. Use optional: true to continue past failures

## Expected Results
- Non-existent elements should return "Element not found" errors
- Invalid selectors should show full CSS parsing errors
- Scroll to non-existent element should throw error
- Invalid key names should produce warnings
- Fill on non-editable elements should throw error
- optional: true should allow workflow to continue
