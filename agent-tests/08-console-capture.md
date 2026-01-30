# Test 8: Console Log Capture

## Objective
Test capturing browser console messages.

## Steps

1. Navigate to any page
2. Use eval to generate console messages:
   - console.log("Test log message")
   - console.warn("Test warning")
   - console.error("Test error")
3. Retrieve console logs
4. Verify all message types are captured
5. Test the level filter option
6. Test the limit option
7. Test the clear option

## Expected Results
- Console messages should be captured
- Different levels (log, warn, error) should be distinguished
- Filtering by level should work
- Limit should restrict number of messages returned
- Clear should remove captured messages

## Notes
- Console logs don't persist across CLI invocations
