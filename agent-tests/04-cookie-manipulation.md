# Test 4: Cookie Manipulation

## Objective
Test getting, setting, and clearing cookies.

## Steps

1. Navigate to any website (e.g., https://httpbin.org)
2. Get all cookies and note the initial state
3. Set a custom cookie with name "test_cookie", value "test_value_123", and appropriate domain
4. Get cookies again and verify the new cookie exists
5. Set another cookie with different attributes (httpOnly, secure, sameSite)
6. Get cookies and verify both exist with correct attributes
7. Clear all cookies
8. Get cookies and verify they are cleared

## Expected Results
- Get should return array of cookies
- Set should successfully add cookies
- Cookie attributes should be preserved
- Clear should remove all cookies

## Feature Requests to Note
- FR-028: Clear cookies by domain
- FR-029: Delete specific cookie by name
- FR-030: Clear should return count of deleted cookies
