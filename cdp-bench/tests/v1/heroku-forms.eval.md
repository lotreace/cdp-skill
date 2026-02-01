---
id: heroku-forms
name: The Internet - Form Authentication
category: forms
site: https://the-internet.herokuapp.com/login

goal: |
  Test form authentication with valid and invalid credentials on the Heroku test site.

success_criteria:
  - Successfully logged in with valid credentials
  - Proper error message shown for invalid credentials

milestones:
  - id: login_page_loaded
    description: Login form loaded with username and password fields
    weight: 0.15
  - id: invalid_login_attempted
    description: Submitted invalid credentials and saw error message
    weight: 0.25
  - id: valid_login_successful
    description: Logged in with valid credentials and saw secure area
    weight: 0.35
  - id: logout_completed
    description: Successfully logged out and returned to login page
    weight: 0.25

constraints:
  max_steps: 15
  max_time_ms: 60000
  max_retries: 2

improvement_focus: [actions, observations]
tags: [authentication, flash-messages, simple-html]
difficulty: easy
version: 1
---

# The Internet - Form Authentication Test

## Site Information

"The Internet" (the-internet.herokuapp.com) is a collection of test automation practice pages created by Dave Haeffner. The login page tests basic form authentication.

## Test Credentials

**Valid Credentials:**
- Username: `tomsmith`
- Password: `SuperSecretPassword!`

**Invalid Credentials (for testing error handling):**
- Username: `invalid`
- Password: `invalid`

## Test Steps

1. Navigate to the login page
2. First, test invalid credentials:
   - Enter invalid username and password
   - Click Login button
   - Verify error flash message appears
3. Then, test valid credentials:
   - Enter valid username and password
   - Click Login button
   - Verify success and "Secure Area" page
4. Click Logout button
5. Verify return to login page

## Page Elements

- Username input: `#username`
- Password input: `#password`
- Login button: `.radius` or `button[type="submit"]`
- Flash messages: `#flash` (shows success/error)
- Logout button: `.button.secondary` in secure area

## Flash Messages

- **Error**: "Your username is invalid!" or "Your password is invalid!"
- **Success**: "You logged into a secure area!"
- **Logout**: "You logged out of the secure area!"

## Notes for Agent

- Very simple HTML structure - straightforward selectors
- Flash messages appear at the top of the page
- The secure area shows a different URL (/secure)
- No popups or complex interactions
- Good site for validating basic form handling
