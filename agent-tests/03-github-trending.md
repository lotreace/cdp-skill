# Test 3: GitHub Trending with Viewport

## Objective
Test viewport/device emulation while browsing GitHub trending repositories.

## Steps

1. Set viewport to mobile dimensions (375x667, mobile: true)
2. Navigate to https://github.com/trending
3. Take a screenshot to verify mobile layout
4. Query for repository names/links
5. Change viewport to desktop (1920x1080)
6. Take another screenshot to compare layouts
7. Query again and compare results

## Expected Results
- Viewport changes should affect page rendering
- Mobile layout should differ from desktop
- Query results should work in both viewports
- Screenshots should show different layouts

## Feature Requests to Note
- FR-026: Device presets like `{"viewport": "iphone-14"}`
- FR-027: Viewport info should be included in tab output
- FR-016: Query text cleanup option to trim whitespace
