# Test 10: Infinite Scroll / Pagination

## Objective
Test scrolling and pagination on Hacker News.

## Steps

1. Navigate to https://news.ycombinator.com
2. Query for story links and count them
3. Scroll to the bottom of the page
4. Find the "More" link
5. Click the "More" link to load next page
6. Wait for new content to load
7. Query for story links again and compare count
8. Repeat scrolling and pagination

## Expected Results
- Scroll should move the viewport
- "More" link should be clickable
- New page should load with more stories
- Story count should increase after pagination

## Notes
- Use `{"click": {..., "jsClick": true}}` if native click doesn't trigger navigation
