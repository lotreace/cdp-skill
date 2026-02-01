---
id: ebay-browse
name: eBay Category Browse
category: ecommerce
site: https://www.ebay.com

goal: |
  Navigate eBay categories, browse products, and examine listing details.

success_criteria:
  - Category page loaded with product listings
  - Individual listing page viewed with bid/buy information

milestones:
  - id: homepage_loaded
    description: eBay homepage loaded successfully
    weight: 0.15
  - id: category_selected
    description: Navigated to a product category
    weight: 0.25
  - id: listings_visible
    description: Product listings displayed with prices
    weight: 0.25
  - id: listing_details
    description: Viewed individual listing with seller info and price
    weight: 0.35

constraints:
  max_steps: 25
  max_time_ms: 90000
  max_retries: 2

improvement_focus: [navigation, selectors]
tags: [categories, listings, dynamic-content]
difficulty: medium
version: 1
---

# eBay Category Browse Test

## Site Information

eBay is an online marketplace with auction-style and fixed-price listings. The site has complex category navigation and various listing formats.

## Test Steps

1. Navigate to ebay.com
2. Handle any cookie consent or promotional banners
3. Navigate to a category (e.g., Electronics > Cell Phones)
4. View the category listings page
5. Click on a product listing
6. Verify listing details (price, seller info, shipping)

## Category Navigation

eBay has a hierarchical category structure:
- Top-level categories in the main navigation
- Subcategories via hover menus or click-through
- Category pages show filters and listings

## Suggested Categories

- Electronics > Cell Phones & Accessories
- Clothing > Men's Clothing
- Home & Garden > Kitchen Appliances

## Notes for Agent

- Category menus may use hover interactions - use snapshot to verify menu state
- Listings can be auction (with bids) or "Buy It Now" (fixed price)
- The listing page layout varies based on listing type
- Watch for promotional overlays and cookie banners
- Use accessibility tree to navigate - eBay has good ARIA labeling
