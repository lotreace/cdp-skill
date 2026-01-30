# Test 16: DuckDuckGo Search

## Objective
Test search flow on DuckDuckGo including form fill, search, and result clicking.

## Steps

1. Navigate to https://duckduckgo.com
2. Take a snapshot to find the search input
3. Fill the search input with a query (e.g., "OpenAI")
4. Submit the search (click button or press Enter)
5. Wait for results to load
6. Take a snapshot of search results
7. Query for result links
8. Try clicking on a search result
9. Verify navigation to the result page

## Expected Results
- Search input should accept text
- Search submission should trigger results page
- Results should be queryable
- Clicking result should navigate to target site

## Notes
- Use `{"click": {..., "jsClick": true}}` if native click doesn't trigger navigation
- Result elements may have overlays - jsClick bypasses these
