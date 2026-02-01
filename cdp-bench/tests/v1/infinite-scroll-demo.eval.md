---
id: infinite-scroll-demo
name: Infinite Scroll Pattern Test
category: spa
site: https://the-internet.herokuapp.com/infinite_scroll

goal: |
  Test interaction with infinite scroll pages by scrolling to trigger
  dynamic content loading and verifying new content appears.

success_criteria:
  - Initial content loaded and visible
  - Scrolled to bottom to trigger content loading
  - New content appeared after scroll (more paragraphs loaded)
  - Successfully scrolled multiple times and loaded multiple batches

milestones:
  - id: page_loaded
    description: Infinite scroll page loaded with initial content visible
    weight: 0.15
  - id: initial_content_counted
    description: Identified and counted initial paragraph elements
    weight: 0.15
  - id: first_scroll_triggered
    description: Scrolled to bottom and new content loaded
    weight: 0.35
  - id: multiple_loads_verified
    description: Scrolled again and verified additional content loaded
    weight: 0.35

constraints:
  max_steps: 25
  max_time_ms: 90000
  max_retries: 3

improvement_focus: [scroll, waits, observations]
tags: [infinite-scroll, lazy-loading, dynamic-content, scroll-events]
difficulty: medium
version: 1
---

# Infinite Scroll Pattern Test

## Site Information

"The Internet" (the-internet.herokuapp.com) is a collection of test automation practice pages. The infinite scroll page demonstrates a common web pattern where content loads dynamically as the user scrolls, similar to social media feeds, search results, and news sites.

## Page Structure

The page contains:
- A heading explaining the infinite scroll feature
- Multiple paragraph (`<p>`) elements containing Lorem Ipsum text
- A JavaScript listener that loads more paragraphs when the user scrolls near the bottom
- Content dynamically appended to the page without full reload

## The Challenge

Infinite scroll tests several automation capabilities:
1. **Scroll detection**: The page must detect scroll events
2. **Viewport position**: Content loads when bottom of viewport nears page bottom
3. **Dynamic content**: New DOM elements are added after the initial page load
4. **Content verification**: Must detect that new content has been added
5. **Timing**: Must wait for AJAX/fetch requests to complete and content to render

## Test Steps

1. Navigate to the infinite scroll page
2. Take initial snapshot and count the number of paragraph elements
3. Scroll down to the bottom of the page
4. Wait for new content to load (watch for new paragraphs)
5. Verify more paragraphs exist than before
6. Scroll down again
7. Wait and verify additional content loaded
8. Confirm the scroll/load cycle works repeatedly

## Element Identification

- Content paragraphs: `.jscroll-added` or `div.jscroll-inner p`
- The page uses jscroll jQuery plugin for infinite scroll
- Each loaded batch adds new paragraphs wrapped in divs
- Initial content is in the main container, additional content is appended

## Scroll Methods

### Method 1: JavaScript Scroll
Execute JavaScript to scroll the page:
```javascript
window.scrollTo(0, document.body.scrollHeight);
```

### Method 2: Scroll to Element
Find the last paragraph and scroll it into view:
```javascript
document.querySelector('p:last-of-type').scrollIntoView();
```

### Method 3: CDP Scroll Commands
Use Input domain mouse wheel events:
```javascript
Input.dispatchMouseEvent({
  type: 'mouseWheel',
  x: 100,
  y: 300,
  deltaX: 0,
  deltaY: 1000
})
```

### Method 4: Keyboard Scroll
Focus the page and use Page Down or End key:
```javascript
key: "End"  // Scroll to bottom
key: "PageDown"  // Scroll one page
```

## Content Loading Behavior

The infinite scroll implementation:
- Triggers when viewport bottom is within threshold of page bottom
- Makes AJAX request to load more content
- Appends new paragraphs to the page
- Typical load time: 500ms-2s depending on network
- No loading indicator (silent loading)

## Verification Approach

Before scroll:
```javascript
const initialCount = document.querySelectorAll('.jscroll-added, p').length;
```

After scroll + wait:
```javascript
const newCount = document.querySelectorAll('.jscroll-added, p').length;
// newCount should be > initialCount
```

Alternative: Use snapshot to see new content has appeared.

## Timing Considerations

- Scroll event triggers async content load
- Must wait after scrolling for content to appear
- Suggested wait: 2-3 seconds after scroll
- Use polling to check for new content:
  ```javascript
  // Wait for paragraph count to increase
  await waitUntil(() =>
    document.querySelectorAll('p').length > initialCount
  );
  ```

## Common Pitfalls

1. **Not waiting long enough**: Content loads asynchronously
2. **Scroll not reaching threshold**: Must scroll far enough to trigger load
3. **Counting wrong elements**: The page structure may have nested paragraphs
4. **Race conditions**: Checking count before content renders
5. **Single scroll not enough**: Some implementations need multiple small scrolls

## Expected Behaviors

1. **Initial state**: ~5-10 paragraphs visible
2. **After first scroll**: Additional paragraphs appended (~5 more)
3. **After second scroll**: Even more paragraphs appended
4. **No limit**: Page continues loading indefinitely
5. **Smooth experience**: No page flicker or reload

## Notes for Agent

- This page uses jQuery jscroll plugin for infinite scroll
- Content loads silently - no visible loading spinner
- Must scroll far enough to trigger the threshold
- Wait 2-3 seconds after scroll for content to appear
- Count paragraphs before and after to verify loading
- The page has no footer/end - it truly scrolls infinitely
- If scroll doesn't trigger load, try scrolling in smaller increments
- Use snapshot to visually confirm new content appeared
- JavaScript `scrollTo` is the most reliable scroll method
- The paragraphs contain Lorem Ipsum placeholder text

## Automation Code Pattern

Suggested approach:
```javascript
// Step 1: Get initial count
const before = await eval('document.querySelectorAll("p").length');

// Step 2: Scroll to bottom
await eval('window.scrollTo(0, document.body.scrollHeight)');

// Step 3: Wait for load
await sleep(2500);

// Step 4: Get new count
const after = await eval('document.querySelectorAll("p").length');

// Step 5: Verify
if (after > before) {
  // Success - new content loaded
}
```

## Related Patterns

This test validates skills needed for:
- Social media feeds (Twitter/X, Facebook, Instagram)
- Search result pages with "load more"
- News sites with continuous scroll
- E-commerce product listings
- Image galleries with lazy loading
- Chat histories and message logs
