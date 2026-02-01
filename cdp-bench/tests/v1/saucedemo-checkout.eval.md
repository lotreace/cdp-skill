---
id: saucedemo-checkout
name: SauceDemo E-Commerce Checkout
category: ecommerce
site: https://www.saucedemo.com

goal: |
  Complete a full checkout flow: login with test credentials,
  add an item to cart, fill shipping form, and confirm the order.

success_criteria:
  - Order confirmation page displayed with "Thank you" message
  - Cart badge shows correct item count during flow

milestones:
  - id: login
    description: Successfully logged in and see inventory page with products
    weight: 0.2
  - id: add_to_cart
    description: Item added to cart, badge shows count of 1
    weight: 0.2
  - id: checkout_info
    description: Checkout form filled with name and postal code
    weight: 0.2
  - id: order_confirmed
    description: Order confirmation page shows success message
    weight: 0.4

constraints:
  max_steps: 25
  max_time_ms: 90000
  max_retries: 2

improvement_focus: [actions, waits]
tags: [react, forms, critical-path]
difficulty: easy
version: 1
---

# SauceDemo Checkout Test

## Site Information

SauceDemo is a React-based demo e-commerce site designed for testing automation. It simulates a typical shopping flow with login, product catalog, cart, and checkout.

## Test Credentials

- **Username:** `standard_user`
- **Password:** `secret_sauce`

## Flow Details

1. **Login Page** (`/`)
   - Username input: `#user-name`
   - Password input: `#password`
   - Login button: `#login-button`

2. **Inventory Page** (`/inventory.html`)
   - Products displayed in grid
   - "Add to cart" buttons on each product
   - Cart icon in header shows badge with count

3. **Cart Page** (`/cart.html`)
   - Shows added items
   - "Checkout" button to proceed

4. **Checkout Step One** (`/checkout-step-one.html`)
   - First Name, Last Name, Postal Code inputs
   - Continue button

5. **Checkout Step Two** (`/checkout-step-two.html`)
   - Order summary with items and total
   - Finish button

6. **Checkout Complete** (`/checkout-complete.html`)
   - "Thank you for your order!" message
   - Success icon

## Notes for Agent

- This is a React site - use `react: true` for fill operations to ensure proper event handling
- Cart badge updates dynamically after add-to-cart - wait briefly for animation
- The site resets state on page refresh, so complete the flow in one session
- Use accessibility snapshot to find elements - the site has good semantic markup
