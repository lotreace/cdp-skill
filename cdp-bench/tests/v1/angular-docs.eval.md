---
id: angular-docs
name: Angular Documentation SPA Navigation
category: spa
site: https://angular.dev

goal: |
  Navigate the Angular documentation site, browse tutorials, and interact with the SPA navigation.

success_criteria:
  - Homepage loaded with navigation and content
  - Tutorial section accessed via SPA routing
  - Code examples or interactive content viewed
  - Used search or navigated between sections

milestones:
  - id: homepage_loaded
    description: Angular.dev homepage loaded with navigation and hero section
    weight: 0.15
  - id: docs_navigated
    description: Navigated to documentation or tutorials section
    weight: 0.25
  - id: content_viewed
    description: Viewed a specific guide or tutorial page with content
    weight: 0.35
  - id: interaction_complete
    description: Used search, code examples, or navigated between pages
    weight: 0.25

constraints:
  max_steps: 20
  max_time_ms: 90000
  max_retries: 2

improvement_focus: [navigation, selectors, waits]
tags: [angular, routing, spa, documentation]
difficulty: medium
version: 1
---

# Angular Documentation Site Test

## Site Information

Angular.dev is the official Angular documentation site, built with Angular itself. It's a complex SPA with client-side routing, search functionality, code examples, and interactive tutorials.

## Test Steps

1. Navigate to angular.dev
2. Explore the main navigation (Docs, Tutorials, Reference, etc.)
3. Navigate to a tutorial or guide page
4. View content including code examples
5. Use search or navigate between different sections

## App Structure

- **Homepage**: Hero section with quick links to tutorials and docs
- **Documentation**: Guides organized by topic
- **Tutorials**: Step-by-step learning paths
- **Reference**: API documentation
- **Playground**: Interactive code editor

## Key Elements

- **Top navigation**: Links to main sections (Docs, Tutorials, Playground)
- **Sidebar**: Section navigation within docs
- **Content area**: Markdown-rendered documentation with code blocks
- **Search**: Global search functionality
- **Code blocks**: Syntax-highlighted code examples

## Notes for Agent

- The site uses Angular's router - URLs change without full page reload
- Content is loaded dynamically, so wait for it to appear
- The site has good accessibility markup
- Search opens a modal/overlay
- Code examples may have copy buttons and tabs
- Navigation sidebar updates based on current section
