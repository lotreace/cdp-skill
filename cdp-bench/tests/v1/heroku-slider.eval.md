---
id: heroku-slider
name: The Internet - Horizontal Slider
category: forms
site: https://the-internet.herokuapp.com/horizontal_slider

goal: |
  Test interaction with an HTML5 range slider by moving the slider
  to specific values and verifying the displayed value updates correctly.

success_criteria:
  - Slider moved to multiple distinct positions
  - Displayed value accurately reflects slider position
  - Slider responds to both mouse drag and keyboard input

milestones:
  - id: page_loaded
    description: Horizontal slider page loaded with slider visible
    weight: 0.1
  - id: initial_value_read
    description: Read and noted the initial slider value
    weight: 0.15
  - id: slider_moved_mouse
    description: Moved slider using mouse/drag interaction
    weight: 0.35
  - id: slider_moved_keyboard
    description: Moved slider using keyboard arrow keys
    weight: 0.4

constraints:
  max_steps: 20
  max_time_ms: 60000
  max_retries: 3

improvement_focus: [actions, coordinates, keyboard]
tags: [range-input, slider, mouse-drag, keyboard-arrows]
difficulty: medium
version: 1
---

# The Internet - Horizontal Slider Test

## Site Information

"The Internet" (the-internet.herokuapp.com) is a collection of test automation practice pages. The horizontal slider page tests interaction with HTML5 range input elements, which require precise positioning and can be controlled via mouse or keyboard.

## Page Structure

The page contains:
- A horizontal range slider (`<input type="range">`)
- A text display showing the current slider value
- The slider range is from 0 to 5 with 0.5 increments

## HTML5 Range Input

The slider uses a standard HTML5 range input:
```html
<input type="range" min="0" max="5" step="0.5">
```

The displayed value updates dynamically as the slider moves.

## Test Steps

1. Navigate to the horizontal slider page
2. Identify the slider element and value display
3. Read the initial slider value (typically starts at 0 or middle)
4. **Mouse Interaction**: Click and drag the slider to a new position
5. Verify the displayed value updated correctly
6. **Keyboard Interaction**: Focus the slider and use arrow keys
   - Right/Up arrow: Increase value by step (0.5)
   - Left/Down arrow: Decrease value by step (0.5)
7. Verify value changes with each keypress

## Slider Interaction Methods

### Method 1: Click at Position
- Calculate target X coordinate based on desired value
- Click directly at that position on the slider track
- Formula: x = sliderLeft + (value / max) * sliderWidth

### Method 2: Drag Operation
- Click and hold on the slider thumb
- Drag to desired position
- Release

### Method 3: Keyboard Navigation
- Focus the slider element (click or Tab)
- Use arrow keys to adjust value
- Each keypress moves by the step value (0.5)
- This is the most reliable method

### Method 4: Direct Value Set
- Use JavaScript to set the value property
- Dispatch 'input' and 'change' events
- Less realistic but guaranteed to work

## Element Identification

- Slider: `input[type="range"]` or the single input on the page
- Value display: `#range` (span element showing current value)
- The slider may also be identifiable by its position in the DOM

## Target Values for Testing

Test multiple values to verify interaction:
1. Move to 2.5 (middle)
2. Move to 5 (maximum)
3. Move to 0 (minimum)
4. Move to 3.5 (arbitrary value)

## Verification

After each move, verify:
- The value display element shows the expected number
- The slider thumb position visually corresponds to the value
- Use snapshot to confirm both slider and display state

## Notes for Agent

- Range inputs can be tricky - keyboard method is most reliable
- The slider has discrete steps (0.5) - values will snap to nearest step
- Focus the slider before using keyboard navigation
- Wait briefly after interaction for value display to update
- If drag doesn't work, try click-at-position or keyboard
- The value display is a separate element from the slider
- No authentication or popups to handle
- Simple, isolated test of slider interaction mechanics

## Keyboard Event Details

To move slider with keyboard:
```javascript
// Focus the slider first
click: "input[type='range']"

// Then use arrow keys
key: "ArrowRight"  // Increase by 0.5
key: "ArrowLeft"   // Decrease by 0.5
```

Multiple keypresses can set specific values from a known starting point.

## Expected Behaviors

- Slider starts at some initial value (check with snapshot)
- Each ArrowRight increases value by 0.5 (up to max 5)
- Each ArrowLeft decreases value by 0.5 (down to min 0)
- Value display updates immediately
- Slider thumb position moves visually
