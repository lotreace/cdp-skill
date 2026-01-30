# Test 12: Form Validation

## Objective
Test HTML5 form validation and error handling.

## Steps

1. Navigate to https://demoqa.com/automation-practice-form
2. Take a snapshot to discover form fields
3. Try submitting the empty form
4. Take a screenshot to capture validation errors
5. Use eval to check form validity: `form.checkValidity()`
6. Fill in required fields one by one
7. Check validation state after each field
8. Fill all required fields correctly
9. Submit and verify success

## Expected Results
- Empty form submission should be blocked
- Validation errors should appear on required fields
- Form validity should change as fields are filled
- Successful submission should show confirmation

## Notes
- For React forms, use `{"fill": {..., "react": true}}` option
