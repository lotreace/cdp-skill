---
id: bbc-article
name: BBC News Article Navigation
category: news
site: https://www.bbc.com/news

goal: |
  Navigate BBC News, select a news category, read an article, and interact with related content.

success_criteria:
  - Article page loaded with full text visible
  - Successfully interacted with related content or navigation

milestones:
  - id: homepage_loaded
    description: BBC News homepage loaded with sections visible
    weight: 0.15
  - id: category_selected
    description: Navigated to a news category (World, Business, etc.)
    weight: 0.2
  - id: article_opened
    description: Opened a full article and see headline and body text
    weight: 0.35
  - id: related_explored
    description: Interacted with related stories or navigation
    weight: 0.3

constraints:
  max_steps: 20
  max_time_ms: 90000
  max_retries: 2

improvement_focus: [navigation, observations, waits]
tags: [responsive, lazy-load, media-heavy]
difficulty: medium
version: 1
---

# BBC News Article Navigation Test

## Site Information

BBC News is a major news outlet with a modern, responsive design. The site uses progressive loading and has various content types including text articles, video, and live updates.

## Test Steps

1. Navigate to bbc.com/news
2. Handle cookie consent if prompted
3. Navigate to a category (World, UK, Business, Tech, etc.)
4. Select an article from the category
5. Read the article (scroll through content)
6. Interact with related stories or "More on this story" section

## Page Structure

- **Homepage**: Featured stories, category navigation, live updates
- **Category Pages**: Story cards with images and headlines
- **Article Pages**: Headline, byline, body text, related content sidebar

## Cookie Consent

BBC shows a cookie consent banner for EU visitors. It appears as a modal overlay that must be dismissed before interacting with content.

## Notes for Agent

- The site uses lazy loading for images - wait for content to stabilize
- Article pages have sticky headers that may overlap content
- Related content may be in sidebar or at article bottom
- Use snapshot to verify page state after navigation
- Some content may be video-only - prefer text articles for this test
