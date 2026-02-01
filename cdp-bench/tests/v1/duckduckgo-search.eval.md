---
id: duckduckgo-search
name: DuckDuckGo Search
category: search
site: https://duckduckgo.com

goal: |
  Search DuckDuckGo and explore search features like instant answers and filters.

success_criteria:
  - Search results displayed
  - Interacted with a search feature (filter, instant answer, or result)

milestones:
  - id: homepage_loaded
    description: DuckDuckGo homepage loaded
    weight: 0.15
  - id: search_executed
    description: Search query submitted and results shown
    weight: 0.3
  - id: feature_used
    description: Used a search feature (filter by time, region, etc.)
    weight: 0.25
  - id: result_explored
    description: Clicked a result or explored instant answer
    weight: 0.3

constraints:
  max_steps: 20
  max_time_ms: 60000
  max_retries: 2

improvement_focus: [actions, selectors]
tags: [privacy-focused, filters, instant-answers]
difficulty: easy
version: 1
---

# DuckDuckGo Search Test

## Site Information

DuckDuckGo is a privacy-focused search engine with a clean interface. It features instant answers, bang commands, and various filters.

## Test Steps

1. Navigate to duckduckgo.com
2. Enter a search query in the search box
3. Submit the search
4. View results and any instant answers
5. Apply a filter (time, region, safe search) OR explore instant answer
6. Click a search result to verify navigation

## Search Features

- **Instant Answers**: Direct answers at top of results (calculators, definitions, etc.)
- **Time Filter**: Filter results by recency (past day, week, month)
- **Region Filter**: Limit results to specific regions
- **Safe Search**: Moderate or strict content filtering

## Suggested Queries

For instant answers:
- "calculator" - shows interactive calculator
- "weather" - shows weather widget
- "timer 5 minutes" - shows timer

For regular search:
- "best programming languages 2024"
- "how to learn javascript"

## Notes for Agent

- DuckDuckGo has a simpler interface than Google
- No cookie consent typically required
- Filters appear above search results
- Instant answers are interactive widgets
- The site respects privacy - no tracking popups
