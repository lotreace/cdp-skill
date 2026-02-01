---
id: amazon-search
name: Amazon Product Search
category: ecommerce
site: https://www.amazon.com

goal: |
  Search for a product on Amazon, filter results, and view product details.

success_criteria:
  - Search results displayed for query
  - Product detail page loaded with price visible

milestones:
  - id: homepage_loaded
    description: Amazon homepage loaded with search box visible
    weight: 0.15
  - id: search_executed
    description: Search query entered and results page displayed
    weight: 0.25
  - id: filter_applied
    description: Applied at least one filter (price, rating, or category)
    weight: 0.25
  - id: product_viewed
    description: Clicked into a product and see detail page with price
    weight: 0.35

constraints:
  max_steps: 30
  max_time_ms: 120000
  max_retries: 3

improvement_focus: [selectors, waits, observations]
tags: [dynamic-content, filters, popups]
difficulty: medium
version: 1
---

# Amazon Product Search Test

## Site Information

Amazon is a complex e-commerce site with dynamic content loading, personalization, and various promotional elements. This test validates basic search and navigation capabilities.

## Test Steps

1. Navigate to amazon.com
2. Handle any location/cookie popups that appear
3. Enter a search query (e.g., "wireless headphones")
4. Wait for search results to load
5. Apply a filter (e.g., price range or customer rating)
6. Click on a product from the results
7. Verify product detail page shows price

## Challenges

- **Popups**: Amazon frequently shows location, cookie consent, or promotional modals
- **Dynamic loading**: Results load progressively with lazy images
- **A/B testing**: Layout may vary between sessions
- **Bot detection**: May see CAPTCHA under heavy automation

## Search Query Suggestions

Use a common product search term:
- "wireless headphones"
- "usb cable"
- "phone case"

## Notes for Agent

- Be prepared to dismiss modals/popups before interacting with main content
- Use snapshot to identify current page state before each action
- The search box typically has id `twotabsearchtextbox` but verify via snapshot
- Filter sidebar may require scrolling to access
- Product prices may be in multiple formats ($XX.XX or "From $XX")
