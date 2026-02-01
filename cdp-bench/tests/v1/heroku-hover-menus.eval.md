---
id: heroku-hover-menus
name: The Internet - Hover Dropdown Menus
category: forms
site: https://the-internet.herokuapp.com/hovers

goal: |
  Test interaction with hover-activated UI elements by triggering hover states
  on user cards to reveal hidden content, and then clicking the revealed links.

success_criteria:
  - Successfully triggered hover state on multiple user cards
  - Hidden profile links became visible on hover
  - Clicked through to at least one user profile page

milestones:
  - id: page_loaded
    description: Hovers page loaded with three user avatar figures visible
    weight: 0.1
  - id: hover_triggered
    description: Hovered over first avatar and revealed hidden username/link
    weight: 0.3
  - id: link_clicked
    description: Clicked "View profile" link while content was visible
    weight: 0.35
  - id: multiple_hovers
    description: Successfully hovered and interacted with a second user card
    weight: 0.25

constraints:
  max_steps: 20
  max_time_ms: 60000
  max_retries: 3

improvement_focus: [mouse-events, coordinates, waits]
tags: [hover, mouse-events, css-transitions, hidden-elements]
difficulty: medium
version: 1
---

# The Internet - Hover Dropdown Menus Test

## Site Information

"The Internet" (the-internet.herokuapp.com) is a collection of test automation practice pages. The hovers page tests CSS-based hover interactions where content is hidden until the user hovers over specific elements - a common pattern in web UIs for profile cards, navigation menus, and action buttons.

## Page Structure

The page displays three user avatar figures arranged horizontally:
- Each figure contains a profile image
- Hidden beneath each image is a caption with:
  - Username text (e.g., "name: user1")
  - A "View profile" link
- The caption only appears when the mouse hovers over the figure
- The caption uses CSS transitions for smooth appearance

## The Challenge

Hover interactions require precise mouse positioning:
1. The mouse cursor must move to the target element
2. The browser must recognize the hover state
3. CSS rules must apply to show hidden content
4. The hidden content must become visible and interactable
5. The agent must click the revealed link before moving away

This tests the CDP skill's ability to:
- Dispatch mousemove/mouseenter events correctly
- Wait for CSS transitions to complete
- Interact with dynamically revealed elements
- Maintain hover state while clicking

## Test Steps

1. Navigate to the hovers page
2. Identify the three figure elements with avatars
3. Move the mouse to the first figure to trigger hover
4. Wait for the hidden caption to appear (CSS transition)
5. Verify the username and "View profile" link are visible
6. Click the "View profile" link
7. Verify navigation to the user profile page (URL contains /users/1)
8. Navigate back to the hovers page
9. Repeat hover/click for a second user

## Element Identification

### Figure Elements:
- Container: `div.figure` (three instances)
- Avatar images: `div.figure img`
- Caption: `div.figcaption` (hidden by default)
- Username: `h5` inside figcaption
- Profile link: `a` inside figcaption with href `/users/N`

### CSS Behavior:
```css
/* Caption is hidden by default */
.figcaption { opacity: 0; }

/* Caption appears on figure hover */
.figure:hover .figcaption { opacity: 1; }
```

## Hover Event Sequence

To properly trigger hover state:

1. **Move mouse to element center**:
   ```javascript
   // Get element coordinates
   const bounds = element.getBoundingClientRect();
   const x = bounds.x + bounds.width / 2;
   const y = bounds.y + bounds.height / 2;

   // Dispatch mousemove to coordinates
   Input.dispatchMouseEvent({ type: 'mouseMoved', x, y })
   ```

2. **Wait for CSS transition**:
   - The opacity transition takes ~500ms
   - Wait for caption element to become visible/interactable

3. **Click while maintaining position**:
   - Click the revealed link without moving mouse away
   - The link is within the hover zone, so state is maintained

## User Profile URLs

The "View profile" links navigate to:
- User 1: `/users/1`
- User 2: `/users/2`
- User 3: `/users/3`

These pages show "Not Found" (intentionally) but the navigation itself proves the interaction worked.

## Verification Steps

1. **Before hover**: Caption should not be visible in snapshot
2. **During hover**: Caption should appear with username visible
3. **After click**: URL should change to `/users/N`
4. **On profile page**: Page shows "Not Found" (expected behavior)

## Automation Approaches

### Approach 1: Mouse Move Events
Use CDP Input domain to move mouse and trigger hover:
```javascript
// Move mouse to element
Input.dispatchMouseEvent({
  type: 'mouseMoved',
  x: centerX,
  y: centerY
})

// Wait for transition
await sleep(600)

// Click the revealed link
Input.dispatchMouseEvent({ type: 'mousePressed', ... })
Input.dispatchMouseEvent({ type: 'mouseReleased', ... })
```

### Approach 2: Hover via Element Coordinates
Get element position with `elementsAt` or `refAt`, then dispatch mouse events.

### Approach 3: JavaScript Hover Simulation
Dispatch mouseenter/mouseover events programmatically:
```javascript
element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
```

Note: CSS :hover pseudo-class may not respond to JavaScript events - real mouse positioning is often required.

## Common Pitfalls

1. **CSS :hover requires real mouse**: JavaScript events may not trigger CSS `:hover` state
2. **Moving too fast**: Must wait for transition before interacting with revealed content
3. **Moving away before clicking**: Mouse must stay over figure while clicking link
4. **Timing issues**: CSS transitions take time - need appropriate waits
5. **Element overlap**: The caption overlays the image - click coordinates matter

## Notes for Agent

- This is a pure CSS hover effect - no JavaScript event handlers
- The `:hover` pseudo-class is triggered by actual mouse cursor position
- CDP's `Input.dispatchMouseEvent` with `mouseMoved` should trigger hover
- Wait 500-600ms after hover for transition to complete
- The link inside the caption is clickable only when caption is visible
- Take snapshots before and after hover to verify visibility change
- The profile pages show 404, but reaching them proves success
- Each of the three figures works identically
- No popups or authentication required
- Simple page structure makes element selection straightforward

## Expected Behaviors

1. **Initial state**: Three avatar images visible, no captions
2. **On hover**: Caption fades in over ~500ms showing name and link
3. **Link click**: Navigates to /users/N
4. **Profile page**: Shows "Not Found" text
5. **Back navigation**: Returns to hovers page with same state

## Difficulty Notes

This test is medium difficulty because:
- Requires precise mouse positioning (not just clicking)
- CSS hover state can be tricky to trigger programmatically
- Timing matters (must wait for transitions)
- Must maintain hover while clicking a child element

The test validates that the CDP skill can handle hover-dependent UI patterns commonly found in navigation menus, user cards, and action buttons across the web.
