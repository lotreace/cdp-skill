---
id: uitesting-playground
name: UI Testing Playground Challenges
category: forms
site: http://uitestingplayground.com

goal: |
  Complete multiple challenges on UI Testing Playground that test common automation difficulties.

success_criteria:
  - Successfully completed at least 3 different challenges
  - Handled dynamic elements, delays, and visibility issues

milestones:
  - id: homepage_loaded
    description: Playground homepage loaded with challenge list
    weight: 0.1
  - id: dynamic_id_handled
    description: Clicked button with dynamic ID successfully
    weight: 0.25
  - id: hidden_layers_handled
    description: Handled hidden layers or overlapping elements
    weight: 0.3
  - id: load_delay_handled
    description: Successfully handled load delays or AJAX content
    weight: 0.35

constraints:
  max_steps: 35
  max_time_ms: 120000
  max_retries: 3

improvement_focus: [selectors, waits, actions]
tags: [dynamic-content, delays, overlays, edge-cases]
difficulty: hard
version: 1
---

# UI Testing Playground Challenges Test

## Site Information

UI Testing Playground is specifically designed to test automation tool capabilities with common real-world challenges like dynamic IDs, hidden layers, load delays, and click interception.

## Available Challenges

1. **Dynamic ID** (`/dynamicid`)
   - Button has randomly generated ID on each page load
   - Must find element by text or other stable attribute

2. **Class Attribute** (`/classattr`)
   - Multiple buttons with varying class orders
   - Tests proper class matching

3. **Hidden Layers** (`/hiddenlayers`)
   - Green button covered by invisible overlay after first click
   - Tests click accuracy and overlay handling

4. **Load Delay** (`/loaddelay`)
   - Page with intentional long load time
   - Tests wait mechanisms

5. **AJAX Data** (`/ajax`)
   - Button triggers AJAX request, data appears after delay
   - Tests waiting for dynamic content

6. **Client Side Delay** (`/clientdelay`)
   - JavaScript delay before content appears
   - Tests handling of client-side rendering delays

7. **Click** (`/click`)
   - Button that changes state on click
   - Tests basic click reliability

8. **Text Input** (`/textinput`)
   - Input field that updates button text
   - Tests input handling

9. **Progress Bar** (`/progressbar`)
   - Progress bar that must be stopped at specific value
   - Tests timing and precision

10. **Visibility** (`/visibility`)
    - Elements hidden by various CSS methods
    - Tests visibility detection

## Recommended Challenge Order

1. Start with `/click` (basic verification)
2. Try `/dynamicid` (selector challenge)
3. Handle `/ajax` (wait for content)
4. Complete `/hiddenlayers` (overlay handling)

## Notes for Agent

- Each challenge is a separate page - use navigation
- The playground is designed to break naive automation
- Use snapshot to understand element state before acting
- Some challenges may require multiple attempts
- Timeouts are expected on delay challenges - adjust accordingly
- Focus on completing 3-4 challenges rather than all of them
