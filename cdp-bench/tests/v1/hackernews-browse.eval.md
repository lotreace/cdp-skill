---
id: hackernews-browse
name: Hacker News Browse and Comment
category: news
site: https://news.ycombinator.com

goal: |
  Browse Hacker News, navigate to a story's comments, and explore the discussion.

success_criteria:
  - Front page stories loaded
  - Comments page for a story displayed

milestones:
  - id: frontpage_loaded
    description: HN front page loaded with story list
    weight: 0.2
  - id: story_selected
    description: Identified a story with comments to explore
    weight: 0.2
  - id: comments_loaded
    description: Story comments page loaded showing discussion
    weight: 0.3
  - id: navigation_complete
    description: Successfully navigated comment tree or pagination
    weight: 0.3

constraints:
  max_steps: 15
  max_time_ms: 60000
  max_retries: 2

improvement_focus: [navigation, extraction]
tags: [simple-html, pagination, comments]
difficulty: easy
version: 1
---

# Hacker News Browse Test

## Site Information

Hacker News (news.ycombinator.com) is a minimalist tech news aggregator with a simple HTML interface. No JavaScript frameworks, just server-rendered HTML.

## Test Steps

1. Navigate to news.ycombinator.com
2. View the front page stories
3. Find a story with comments (look for "N comments" link)
4. Click to view the comments
5. Navigate within the comment thread (collapse/expand or pagination)

## Page Structure

- **Front Page**: Numbered list of stories with title, points, submitter, time, and comment count
- **Comments Page**: Story at top, threaded comments below with reply links
- **Navigation**: "More" link at bottom for pagination

## Element Identification

- Story titles are plain `<a>` tags
- Comment counts show as "N comments" text links
- Comment threads use indentation via `<td>` with different widths
- Upvote arrows are images/buttons

## Notes for Agent

- Very simple HTML structure - CSS selectors work well
- No popups or overlays to handle
- Comments are pre-rendered, no lazy loading
- The site is fast and lightweight
- Use snapshot to identify elements by their text content
