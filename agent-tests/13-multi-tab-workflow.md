# Test 13: Multi-Tab Workflow

## Objective
Test managing multiple browser tabs independently.

## Steps

1. Create first tab by navigating to https://news.ycombinator.com
2. Save the targetId from the response
3. Create second tab (omit targetId) and navigate to https://google.com
4. Save the second targetId
5. Switch back to first tab using its targetId
6. Verify URL is still Hacker News
7. Switch to second tab
8. Verify URL is still Google
9. Set a cookie on one tab
10. Verify cookie persists when returning to that tab
11. Test with invalid targetId - should get error
12. Navigate within a tab and verify state persists

## Expected Results
- Each new invocation without targetId creates new tab
- Using targetId should reuse existing tab
- Tabs should maintain independent state
- Invalid targetId should return clear error
- Cookies should persist per-tab

## Notes
- Use `{"click": {..., "jsClick": true}}` if native click doesn't work on navigation links
