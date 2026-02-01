---
id: wikipedia-search
name: Wikipedia Search and Navigation
category: search
site: https://www.wikipedia.org

goal: |
  Search Wikipedia, navigate to an article, and explore internal links.

success_criteria:
  - Article page loaded with content
  - Successfully followed an internal wiki link

milestones:
  - id: homepage_loaded
    description: Wikipedia portal loaded
    weight: 0.1
  - id: search_executed
    description: Search submitted from portal or search page
    weight: 0.25
  - id: article_loaded
    description: Wikipedia article loaded with sections and content
    weight: 0.35
  - id: link_followed
    description: Clicked an internal wiki link to another article
    weight: 0.3

constraints:
  max_steps: 15
  max_time_ms: 60000
  max_retries: 2

improvement_focus: [navigation, extraction]
tags: [wiki-links, sections, infoboxes]
difficulty: easy
version: 1
---

# Wikipedia Search and Navigation Test

## Site Information

Wikipedia is a free online encyclopedia with millions of articles. The site has a consistent structure with search, article pages, sections, and extensive internal linking.

## Test Steps

1. Navigate to wikipedia.org (the portal page)
2. Either:
   - Use the search box on the portal, OR
   - Click English Wikipedia and use that search
3. Search for a topic (e.g., "Python programming language")
4. View the article page
5. Navigate within the article (scroll, sections, TOC)
6. Click an internal wiki link to another article

## Page Structure

- **Portal (wikipedia.org)**: Language selection with search box
- **Main Page (en.wikipedia.org)**: Featured content, news, search
- **Article Pages**: Title, infobox, sections, internal links, references

## Search Behavior

- Search from portal goes to English Wikipedia by default
- Autocomplete suggestions appear while typing
- Results may go directly to article or show search results page

## Suggested Search Topics

- "Python programming language"
- "Albert Einstein"
- "Climate change"
- "Artificial intelligence"

## Notes for Agent

- Wikipedia has excellent semantic HTML and accessibility
- Internal links are typically blue and underlined
- Articles have table of contents for navigation
- Infoboxes on the right contain structured data
- The site is fast and predictable
