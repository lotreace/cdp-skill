# Test 5: Keyboard Combinations

## Objective
Test keyboard shortcuts and key combinations.

## Steps

1. Navigate to a page with a text input (e.g., https://www.google.com)
2. Click the search input to focus it
3. Type some text using fill
4. Try to select all text using Control+a (or Meta+a on Mac)
5. Verify selection state using eval
6. Try other combos: Control+c, Control+v, Tab, Enter
7. Test arrow keys and modifier combinations

## Expected Results
- Single key presses should work
- Key combinations should send correct events

## Known Limitations
- LIMIT-001: Browser shortcuts (Ctrl+A, Ctrl+C) don't actually trigger browser behavior
- CDP's Input.dispatchKeyEvent sends low-level events that browsers don't interpret as shortcuts

## Workarounds
- Use `{"eval": "document.querySelector('input').select()"}` for select-all
- Use `{"eval": "document.execCommand('copy')"}` for copy

## Feature Requests to Note
- FR-043: Add "type" step for typing without clearing
- FR-044: Add "select" step for text selection
