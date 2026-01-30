# Test 9: Role-Based Queries

## Objective
Test querying elements by ARIA role instead of CSS selectors.

## Steps

1. Navigate to https://news.ycombinator.com
2. Query for all links: `{"query": {"role": "link"}}`
3. Query for links with name filter: `{"query": {"role": "link", "name": "new"}}`
4. Query for buttons: `{"query": {"role": "button"}}`
5. Query for textboxes: `{"query": {"role": "textbox"}}`
6. Navigate to a page with checkboxes
7. Query for checked checkboxes: `{"query": {"role": "checkbox", "checked": true}}`
8. Query for disabled elements: `{"query": {"role": "textbox", "disabled": true}}`
9. Test the output parameter with role queries: `{"query": {"role": "link", "output": "href"}}`

## Expected Results
- Role queries should find elements by semantic role
- Name filter should match accessible names (case-insensitive substring)
- State filters (checked, disabled) should work
- Output parameter should work with role queries
