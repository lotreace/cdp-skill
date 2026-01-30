# Test 15: JavaScript Eval Expressions

## Objective
Test executing JavaScript in the page context.

## Steps

1. Navigate to any page
2. Eval simple expressions:
   - `document.title`
   - `window.location.href`
   - `1 + 1`
3. Eval DOM queries:
   - `document.querySelectorAll('a').length`
   - `document.querySelector('h1').textContent`
4. Eval with async/await:
   - `{"eval": {"expression": "fetch('/').then(r => r.status)", "await": true}}`
5. Test return value types:
   - String, number, boolean, object, array
6. Test edge cases:
   - undefined, null, Infinity, NaN
   - DOM elements (should return info, not empty object)
7. Eval to manipulate the page:
   - Change element content
   - Trigger click events

## Expected Results
- Simple expressions should return correct values
- Return type should be indicated in output
- Async expressions with await: true should wait for promises
- DOM manipulation should affect the page

## Feature Requests to Note
- FR-039: String representation for Infinity, NaN
- FR-040: Auto-serialize Date, Map, Set
- FR-041: DOM element info instead of empty object
- FR-042: Eval timeout option for async operations
