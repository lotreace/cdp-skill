# Test 20: E2E Checkout Flow

## Objective
Complete a full e-commerce checkout flow on saucedemo.com.

## Steps

1. Navigate to https://www.saucedemo.com
2. Login with credentials:
   - Username: standard_user
   - Password: secret_sauce
3. Verify login success (should see inventory page)
4. Add items to cart (e.g., Sauce Labs Backpack)
5. Click the cart icon
6. Verify cart shows added items
7. Click checkout button
8. Fill shipping information:
   - First Name
   - Last Name
   - Zip Code
9. Click Continue
10. Review order on summary page
11. Click Finish
12. Verify order confirmation page

## Expected Results
- Login should work
- Items should be added to cart
- Checkout form should accept input
- Order should complete successfully

## Notes
- This is a React site - use `{"fill": {..., "react": true}}` for form inputs
- Use `{"click": {..., "jsClick": true}}` if native clicks don't work
