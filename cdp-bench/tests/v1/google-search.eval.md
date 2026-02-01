---
id: google-search
name: Google Search and Results
category: search
site: https://www.google.com

goal: |
  Perform a Google search, interact with results, and navigate to a result page.

success_criteria:
  - Search results displayed for query
  - Successfully navigated to a search result

milestones:
  - id: homepage_loaded
    description: Google homepage loaded with search box visible
    weight: 0.15
  - id: query_entered
    description: Search query typed into search box
    weight: 0.2
  - id: results_displayed
    description: Search results page loaded with results
    weight: 0.3
  - id: result_clicked
    description: Clicked a search result and navigated to the page
    weight: 0.35

constraints:
  max_steps: 15
  max_time_ms: 60000
  max_retries: 2

improvement_focus: [actions, waits, selectors]
tags: [autocomplete, dynamic-content]
difficulty: easy
version: 1
---

# Google Search Test

## Site Information

Google Search is the most widely used search engine. The test validates basic search interaction including query input and result navigation.

## Test Steps

1. Navigate to google.com
2. Handle any cookie consent (if in EU/UK)
3. Click the search box
4. Enter a search query
5. Submit the search (Enter key or click search button)
6. View search results
7. Click on a search result

## Search Query Suggestions

Use a simple, unambiguous query:
- "what is the speed of light"
- "weather today"
- "python programming language"

## Autocomplete Behavior

- Google shows autocomplete suggestions as you type
- These appear in a dropdown below the search box
- You can ignore these and press Enter, or click a suggestion

## Cookie Consent

Google shows cookie consent for EU/UK visitors:
- Modal overlay with "Accept all" or "Customize" options
- Must be dismissed before interacting with search

## Notes for Agent

- Search box has multiple valid selectors - use snapshot to identify
- Search can be submitted via Enter key or clicking the search button
- Results page may show featured snippets, knowledge panels, or ads above organic results
- Handle the transition from homepage to results page
- Some results may be ads (marked with "Ad" label)
