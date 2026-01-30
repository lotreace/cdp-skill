# Test 23: Shadow DOM Component Interaction

## Objective
Test interaction with elements inside Shadow DOM. Modern web components use Shadow DOM which creates an encapsulated DOM tree that standard selectors cannot pierce.

## Steps

1. Navigate to https://shop.polymer-project.org/
2. Take a snapshot - some elements may not be visible due to Shadow DOM
3. The shop uses Polymer components with Shadow DOM
4. Try to click on a product category (e.g., "Men's Outerwear")
5. If standard click fails, use shadow-piercing technique:
   - `{"eval": "document.querySelector('shop-app').shadowRoot.querySelector('...').click()"}`
6. Navigate to https://nickersnews.github.io/nickersnews/demo-components/
7. Take a snapshot to see what's visible
8. Find the custom button component and click it
9. Verify the click triggered the expected action
10. Navigate to https://mdn.github.io/web-components-examples/popup-info-box-web-component/
11. Find the info icon (inside shadow DOM)
12. Hover over the info icon to trigger the popup
13. Verify the popup text appears
14. Query the text content inside the shadow DOM popup
15. Navigate to a page with nested shadow DOM (component inside component)
16. Traverse multiple shadow roots to reach a deeply nested element
17. Interact with the deeply nested element

## Expected Results
- Shadow DOM elements should be discoverable via eval
- Clicks on shadow DOM elements should work
- Hover effects should trigger on shadow DOM elements
- Nested shadow DOM should be traversable

## Difficulty
- Standard CSS selectors don't pierce shadow DOM boundaries
- Need to use `shadowRoot` to access encapsulated elements
- Multiple levels of shadow DOM require chained `shadowRoot` access
- Snapshot/ARIA tree may not include shadow DOM content

## Notes
- Key technique: `document.querySelector('host').shadowRoot.querySelector('target')`
- For nested: `el.shadowRoot.querySelector('inner').shadowRoot.querySelector('deep')`
- Consider if `{"query": {"piercesShadow": true}}` option exists
- May need to use `{"eval": "..."}` extensively for shadow DOM interaction
