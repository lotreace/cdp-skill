# Test 11: Snapshot-Based Navigation

## Objective
Test using accessibility snapshots for page understanding and navigation via refs.

## Steps

1. Navigate to https://news.ycombinator.com
2. Take a snapshot with default options
3. Examine the YAML output to understand page structure
4. Find a link's ref (e.g., [ref=e5])
5. Click using the ref: `{"click": {"ref": "e5"}}`
6. Wait for navigation and take another snapshot
7. Test snapshot with root option: `{"snapshot": {"root": "#hnmain"}}`
8. Test snapshot with root using role syntax: `{"snapshot": {"root": "role=main"}}`
9. Test snapshot with maxDepth option

## Expected Results
- Snapshot should return YAML accessibility tree
- Refs should be assigned to interactive elements
- Clicking by ref should work
- Root option should limit scope (accepts CSS selectors or `role=` syntax)
- Large pages should be manageable with maxDepth

## Notes
- Refs become stale after page changes - a warning will be returned if clicking a stale ref
