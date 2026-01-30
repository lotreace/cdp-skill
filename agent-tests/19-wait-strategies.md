# Test 19: Wait Strategies

## Objective
Test different wait conditions and strategies.

## Steps

1. Navigate to a page that loads dynamically
2. Test time-based wait:
   - `{"wait": {"time": 2000}}`
3. Test wait for selector:
   - `{"wait": {"selector": "#dynamic-element"}}`
4. Test wait for text:
   - `{"wait": {"text": "Loading complete"}}`
5. Test wait with timeout:
   - `{"wait": {"selector": "#slow-element", "timeout": 5000}}`
6. Test wait failure when element doesn't appear
7. Navigate to a page and wait for specific content
8. Combine wait with subsequent actions

## Expected Results
- Time wait should pause for specified milliseconds
- Selector wait should resolve when element appears
- Text wait should resolve when text is found
- Timeout should limit wait duration
- Failed wait should return appropriate error

## Feature Requests to Note
- FR-004: Wait for URL change
- FR-022: Case-sensitive text option
- FR-023: Wait for element disappearance
- FR-024: Wait for element count
- FR-025: Regex text matching
