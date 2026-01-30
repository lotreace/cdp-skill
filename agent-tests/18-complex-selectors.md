# Test 18: Complex Selectors and Queries

## Objective
Test various CSS selector patterns and query options.

## Steps

1. Navigate to a content-rich page (e.g., https://news.ycombinator.com)
2. Test basic selectors:
   - Tag: `a`, `div`, `span`
   - Class: `.titleline`
   - ID: `#hnmain`
3. Test complex selectors:
   - Descendant: `table td a`
   - Child: `tr > td`
   - Attribute: `a[href^="https"]`
   - Nth-child: `tr:nth-child(odd)`
4. Test query with different output modes:
   - text (default)
   - href
   - html
   - value
   - tag
5. Test query with limit option
6. Use inspect to get element counts
7. Use inspect with custom selectors array

## Expected Results
- All CSS selector patterns should work
- Different output modes should return appropriate data
- Limit should restrict number of results
- Inspect should provide accurate counts

## Feature Requests to Note
- FR-018: Attribute output option
- FR-019: Element metadata in results (tag, classes)
- FR-020: Role level filter for headings
- FR-021: Compound role queries
- FR-048: Limit option for custom selectors in inspect
