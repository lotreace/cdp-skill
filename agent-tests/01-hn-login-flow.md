# Test 1: Hacker News Login Flow

## Objective
Test the login form workflow on Hacker News, including form discovery, filling credentials, and submitting.

## Steps

1. Navigate to https://news.ycombinator.com/login
2. Wait for the page to load, then take a snapshot to discover the form elements
3. Find the username and password input fields
4. Fill in test credentials (any fake username/password is fine - we expect login to fail)
5. Click the login button
6. Wait for the response and take another snapshot
7. Verify that an error message appears (e.g., "Bad login")

## Expected Results
- Form fields should be discoverable via snapshot
- Fill actions should populate the fields
- Click on submit should trigger form submission
- Error message should be visible after failed login attempt

## Notes
- Use `{"snapshot": {"includeText": true}}` to include error messages in snapshot output
