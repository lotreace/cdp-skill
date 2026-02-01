---
id: reuters-search
name: Reuters News Search
category: news
site: https://www.reuters.com

goal: |
  Search Reuters for a topic, browse results, and read an article.

success_criteria:
  - Search results displayed for query
  - Article page loaded with content visible

milestones:
  - id: homepage_loaded
    description: Reuters homepage loaded successfully
    weight: 0.15
  - id: search_opened
    description: Search interface opened and query entered
    weight: 0.25
  - id: results_displayed
    description: Search results page shows matching articles
    weight: 0.3
  - id: article_read
    description: Opened and scrolled through an article
    weight: 0.3

constraints:
  max_steps: 25
  max_time_ms: 90000
  max_retries: 2

improvement_focus: [selectors, actions, waits]
tags: [search, paywall, modern-ui]
difficulty: medium
version: 1
---

# Reuters News Search Test

## Site Information

Reuters is a global news agency with a modern web interface. The site has search functionality and may show registration prompts for some content.

## Test Steps

1. Navigate to reuters.com
2. Handle any cookie consent or newsletter popups
3. Find and open the search interface (magnifying glass icon)
4. Enter a search term (e.g., "technology" or "markets")
5. View search results
6. Click an article and read content

## Search Interface

- Search icon is typically in the header
- Clicking opens a search overlay or navigates to search page
- Results show article cards with headlines and snippets

## Suggested Search Terms

- "technology"
- "markets"
- "climate"
- "economy"

## Paywall Considerations

Reuters may show registration prompts or limit access to some articles. The test should handle these gracefully:
- Dismiss registration modals if they appear
- If article is blocked, try a different one
- Focus on freely accessible content

## Notes for Agent

- The site has a modern JavaScript-heavy interface
- Search results load dynamically
- Handle any modal overlays before proceeding
- Use snapshot to identify search icon and form elements
- Articles may have ads or promotional content between paragraphs
