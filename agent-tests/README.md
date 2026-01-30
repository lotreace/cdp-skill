# Agent Tests

This folder contains test specifications for the CDP Browser Automation skill. Each test is a markdown file with plain English instructions that an AI agent can read and execute.

## How to Use

1. Give an agent access to `SKILL.md` and one of these test files
2. The agent reads the test instructions and executes them using the skill
3. The agent reports results, bugs found, and feature requests

## Test Files

| # | File | Description |
|---|------|-------------|
| 01 | hn-login-flow.md | Login form workflow on Hacker News |
| 02 | wikipedia-search.md | Search and content extraction |
| 03 | github-trending.md | Viewport/device emulation |
| 04 | cookie-manipulation.md | Get, set, clear cookies |
| 05 | keyboard-combos.md | Key combinations and shortcuts |
| 06 | hover-tooltips.md | Hover actions and tooltips |
| 07 | pdf-generation.md | PDF creation with options |
| 08 | console-capture.md | Browser console log capture |
| 09 | role-based-queries.md | ARIA role queries |
| 10 | infinite-scroll.md | Scrolling and pagination |
| 11 | snapshot-navigation.md | Accessibility snapshots and refs |
| 12 | form-validation.md | HTML5 form validation |
| 13 | multi-tab-workflow.md | Managing multiple tabs |
| 14 | error-handling.md | Error conditions and edge cases |
| 15 | eval-expressions.md | JavaScript execution |
| 16 | duckduckgo-search.md | Search engine workflow |
| 17 | screenshot-variants.md | Screenshot options |
| 18 | complex-selectors.md | CSS selector patterns |
| 19 | wait-strategies.md | Wait conditions |
| 20 | e2e-checkout.md | Full checkout flow |

## Test Results

See `RESULTS.md` in the parent directory for detailed test results including:
- Bugs found (16 total)
- Feature requests (67 total)
- Priority recommendations

## Running All Tests

To run all tests with multiple agents:

```
For each test file in agent-tests/:
  1. Spawn an agent with access to SKILL.md and the test file
  2. Instruct it to execute the test and report findings
  3. Collect bugs and feature requests
```
