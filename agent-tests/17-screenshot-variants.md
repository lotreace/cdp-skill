# Test 17: Screenshot Variants

## Objective
Test screenshot functionality with various options.

## Steps

1. Navigate to a page with scrollable content (e.g., Wikipedia article)
2. Take a regular viewport screenshot
3. Take a fullPage screenshot
4. Compare file sizes - fullPage should be larger
5. Verify screenshots are valid PNG files
6. Test with different viewport sizes
7. Take screenshots before and after scrolling
8. Verify screenshots capture current viewport state

## Expected Results
- Screenshots should be saved to specified paths
- Output should include absolute path
- fullPage: true should capture entire page
- Regular screenshot should capture viewport only
- Different viewports should produce different screenshots

## Feature Requests to Note
- FR-031: Element screenshot by selector
- FR-032: JPEG format with quality option
- FR-033: omitBackground and clip options
- FR-034: Viewport dimensions in screenshot output
