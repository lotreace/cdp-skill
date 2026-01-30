# Test 25: Bot Detection Evasion & Fingerprint Analysis

## Objective
Test the automation's ability to pass bot detection checks and analyze browser fingerprinting. This tests how "human-like" the automation appears.

## Steps

1. Navigate to https://bot.sannysoft.com/
2. Wait for all tests to complete (page runs fingerprint checks)
3. Take a screenshot of the results
4. Query the test results table - extract pass/fail status for each check:
   - User Agent
   - WebDriver
   - Chrome (headless detection)
   - Permissions
   - Plugins
   - Languages
   - WebGL Vendor/Renderer
   - Broken Image Dimensions
   - And others...
5. Count how many tests show "PASS" vs "FAIL"
6. Navigate to https://arh.antoinevastel.com/bots/areyouheadless
7. Wait for the detection to complete
8. Query the result - does it say "You are not Chrome headless" or "You are Chrome headless"?
9. Take a screenshot
10. Navigate to https://intoli.com/blog/not-possible-to-block-chrome-headless/chrome-headless-test.html
11. Run the headless detection tests
12. Query and report the results
13. Navigate to https://pixelscan.net/
14. Wait for fingerprint analysis to complete
15. Query the "Fingerprint" result - is it "Consistent" or "Inconsistent"?
16. Extract the browser fingerprint details shown
17. Navigate to https://www.google.com/recaptcha/api2/demo
18. Find the reCAPTCHA checkbox
19. Click the "I'm not a robot" checkbox
20. Observe what happens:
    - If it passes immediately (green checkmark) - PASS
    - If it shows image challenge - note this (expected for automation)
    - If it fails outright - FAIL
21. Take a screenshot of the reCAPTCHA state

## Expected Results
- Bot detection pages should report findings
- Some tests may fail (WebDriver flag, etc.) - document which ones
- reCAPTCHA will likely show challenge (this is expected)
- Fingerprint analysis should complete and provide data

## Difficulty
- CDP automation is often detected by advanced bot detection
- WebDriver flag is typically exposed
- navigator.webdriver property reveals automation
- This test documents the current state rather than requiring all passes

## Notes
- This is more of an audit than a pass/fail test
- Results help understand what bot detection sees
- Some failures are expected and unavoidable
- Consider testing with `{"eval": "delete navigator.webdriver"}` (may not work)
- Document which evasion techniques could improve results

## Success Criteria
- Successfully navigate to all bot detection sites
- Extract and report test results from each
- Complete reCAPTCHA interaction (even if challenge appears)
- Generate a summary of the automation's "detectability"
