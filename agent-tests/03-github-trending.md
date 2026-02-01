# Test 3: GitHub Trending Navigation

## Objective
Test navigation and data extraction on GitHub trending repositories.

## Steps

1. Navigate to https://github.com/trending
2. Wait for the repository list to load
3. Use snapshot to get the accessibility tree
4. Query for repository links (use CSS selector `h2 a` or role-based query)
5. Extract the first 5 repository names
6. Click on the first repository to navigate to it
7. Verify navigation occurred (URL should contain the repo name)
8. Use inspect to get page overview
9. Go back to trending page
10. Verify we're back on trending

## Expected Results
- Repository list should load and be queryable
- Navigation to repo page should work
- Back navigation should return to trending
- All data extraction methods should return results

## Features Being Tested
- Navigation (goto, back)
- Waiting for content
- Accessibility snapshots
- CSS and role-based queries
- Click navigation
- Page inspection
