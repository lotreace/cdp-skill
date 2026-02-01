import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createInputEmulator } from '../dom/index.js';

describe('InputEmulator', () => {
  let mockCdp;
  let input;

  beforeEach(() => {
    mockCdp = {
      send: mock.fn(async () => ({}))
    };
    input = createInputEmulator(mockCdp);
  });

  describe('constructor', () => {
    it('should throw if cdp is not provided', () => {
      assert.throws(() => createInputEmulator(null), {
        message: 'CDP session is required'
      });
    });
  });

  describe('click', () => {
    it('should send correct click sequence (mouseMoved, mousePressed, mouseReleased)', async () => {
      await input.click(100, 200);

      assert.strictEqual(mockCdp.send.mock.calls.length, 3);

      // Verify mouseMoved
      const moveCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(moveCall[0], 'Input.dispatchMouseEvent');
      assert.strictEqual(moveCall[1].type, 'mouseMoved');
      assert.strictEqual(moveCall[1].x, 100);
      assert.strictEqual(moveCall[1].y, 200);

      // Verify mousePressed
      const pressCall = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(pressCall[0], 'Input.dispatchMouseEvent');
      assert.strictEqual(pressCall[1].type, 'mousePressed');
      assert.strictEqual(pressCall[1].x, 100);
      assert.strictEqual(pressCall[1].y, 200);
      assert.strictEqual(pressCall[1].button, 'left');
      assert.strictEqual(pressCall[1].clickCount, 1);
      assert.strictEqual(pressCall[1].buttons, 1); // Left button mask

      // Verify mouseReleased
      const releaseCall = mockCdp.send.mock.calls[2].arguments;
      assert.strictEqual(releaseCall[0], 'Input.dispatchMouseEvent');
      assert.strictEqual(releaseCall[1].type, 'mouseReleased');
      assert.strictEqual(releaseCall[1].x, 100);
      assert.strictEqual(releaseCall[1].y, 200);
      assert.strictEqual(releaseCall[1].button, 'left');
      assert.strictEqual(releaseCall[1].buttons, 0); // No buttons on release
    });

    it('should use right button when specified', async () => {
      await input.click(50, 75, { button: 'right' });

      const pressCall = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(pressCall[1].button, 'right');
      assert.strictEqual(pressCall[1].buttons, 2); // Right button mask
    });

    it('should use middle button when specified', async () => {
      await input.click(50, 75, { button: 'middle' });

      const pressCall = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(pressCall[1].button, 'middle');
      assert.strictEqual(pressCall[1].buttons, 4); // Middle button mask
    });

    it('should include modifiers in events', async () => {
      await input.click(10, 20, { modifiers: { ctrl: true, shift: true } });

      const expectedModifiers = 2 | 8; // ctrl=2, shift=8

      const moveCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(moveCall[1].modifiers, expectedModifiers);

      const pressCall = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(pressCall[1].modifiers, expectedModifiers);

      const releaseCall = mockCdp.send.mock.calls[2].arguments;
      assert.strictEqual(releaseCall[1].modifiers, expectedModifiers);
    });

    it('should support all modifier combinations', async () => {
      await input.click(10, 20, { modifiers: { alt: true, ctrl: true, meta: true, shift: true } });

      const expectedModifiers = 1 | 2 | 4 | 8; // alt=1, ctrl=2, meta=4, shift=8

      const pressCall = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(pressCall[1].modifiers, expectedModifiers);
    });

    it('should set clickCount for double clicks', async () => {
      await input.click(100, 100, { clickCount: 2 });

      const pressCall = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(pressCall[1].clickCount, 2);
    });

    it('should throw on invalid coordinates', async () => {
      await assert.rejects(() => input.click('a', 100), {
        message: 'Coordinates must be finite numbers'
      });

      await assert.rejects(() => input.click(NaN, 100), {
        message: 'Coordinates must be finite numbers'
      });

      await assert.rejects(() => input.click(Infinity, 100), {
        message: 'Coordinates must be finite numbers'
      });
    });

    it('should throw on negative coordinates', async () => {
      await assert.rejects(() => input.click(-10, 100), {
        message: 'Coordinates must be non-negative'
      });

      await assert.rejects(() => input.click(100, -5), {
        message: 'Coordinates must be non-negative'
      });
    });

    it('should throw on invalid button', async () => {
      await assert.rejects(() => input.click(100, 100, { button: 'invalid' }), {
        message: /Invalid button: invalid/
      });
    });

    it('should throw on invalid clickCount (zero)', async () => {
      await assert.rejects(() => input.click(100, 100, { clickCount: 0 }), {
        message: 'Click count must be a positive integer'
      });
    });

    it('should throw on invalid clickCount (negative)', async () => {
      await assert.rejects(() => input.click(100, 100, { clickCount: -1 }), {
        message: 'Click count must be a positive integer'
      });
    });

    it('should throw on invalid clickCount (non-integer)', async () => {
      await assert.rejects(() => input.click(100, 100, { clickCount: 1.5 }), {
        message: 'Click count must be a positive integer'
      });
    });
  });

  describe('doubleClick', () => {
    it('should call click with clickCount 2', async () => {
      await input.doubleClick(50, 50);

      const pressCall = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(pressCall[1].clickCount, 2);
    });
  });

  describe('rightClick', () => {
    it('should call click with right button', async () => {
      await input.rightClick(50, 50);

      const pressCall = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(pressCall[1].button, 'right');
    });
  });

  describe('type', () => {
    it('should send char events for each character', async () => {
      await input.type('abc');

      assert.strictEqual(mockCdp.send.mock.calls.length, 3);

      for (let i = 0; i < 3; i++) {
        const call = mockCdp.send.mock.calls[i].arguments;
        assert.strictEqual(call[0], 'Input.dispatchKeyEvent');
        assert.strictEqual(call[1].type, 'char');
        assert.strictEqual(call[1].text, 'abc'[i]);
        assert.strictEqual(call[1].key, 'abc'[i]);
        assert.strictEqual(call[1].unmodifiedText, 'abc'[i]);
      }
    });

    it('should throw if text is not a string', async () => {
      await assert.rejects(() => input.type(123), {
        message: 'Text must be a string'
      });

      await assert.rejects(() => input.type(null), {
        message: 'Text must be a string'
      });
    });

    it('should handle empty string', async () => {
      await input.type('');
      assert.strictEqual(mockCdp.send.mock.calls.length, 0);
    });

    it('should handle special characters', async () => {
      await input.type('@#$');

      assert.strictEqual(mockCdp.send.mock.calls.length, 3);
      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[1].text, '@');
      assert.strictEqual(mockCdp.send.mock.calls[1].arguments[1].text, '#');
      assert.strictEqual(mockCdp.send.mock.calls[2].arguments[1].text, '$');
    });
  });

  describe('press', () => {
    it('should send rawKeyDown and keyUp events', async () => {
      await input.press('Enter');

      assert.strictEqual(mockCdp.send.mock.calls.length, 3); // rawKeyDown, char, keyUp

      // Verify rawKeyDown
      const downCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(downCall[0], 'Input.dispatchKeyEvent');
      assert.strictEqual(downCall[1].type, 'rawKeyDown');
      assert.strictEqual(downCall[1].key, 'Enter');
      assert.strictEqual(downCall[1].code, 'Enter');
      assert.strictEqual(downCall[1].windowsVirtualKeyCode, 13);

      // Verify char event (Enter has text)
      const charCall = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(charCall[1].type, 'char');
      assert.strictEqual(charCall[1].text, '\r');

      // Verify keyUp
      const upCall = mockCdp.send.mock.calls[2].arguments;
      assert.strictEqual(upCall[1].type, 'keyUp');
      assert.strictEqual(upCall[1].key, 'Enter');
    });

    it('should not send char event for keys without text', async () => {
      await input.press('Tab');

      // Tab has no text, so only rawKeyDown and keyUp
      assert.strictEqual(mockCdp.send.mock.calls.length, 2);
      assert.strictEqual(mockCdp.send.mock.calls[0].arguments[1].type, 'rawKeyDown');
      assert.strictEqual(mockCdp.send.mock.calls[1].arguments[1].type, 'keyUp');
    });

    it('should include modifiers', async () => {
      await input.press('a', { modifiers: { ctrl: true } });

      const downCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(downCall[1].modifiers, 2); // ctrl = 2
    });

    it('should handle lowercase letters', async () => {
      await input.press('a');

      const downCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(downCall[1].key, 'a');
      assert.strictEqual(downCall[1].code, 'KeyA');
      assert.strictEqual(downCall[1].windowsVirtualKeyCode, 65);
    });

    it('should handle uppercase letters', async () => {
      await input.press('A');

      const downCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(downCall[1].key, 'A');
      assert.strictEqual(downCall[1].code, 'KeyA');
      assert.strictEqual(downCall[1].windowsVirtualKeyCode, 65);
    });

    it('should handle numbers', async () => {
      await input.press('5');

      const downCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(downCall[1].key, '5');
      assert.strictEqual(downCall[1].code, 'Digit5');
      assert.strictEqual(downCall[1].windowsVirtualKeyCode, 53);
    });

    it('should handle arrow keys', async () => {
      await input.press('ArrowDown');

      const downCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(downCall[1].key, 'ArrowDown');
      assert.strictEqual(downCall[1].code, 'ArrowDown');
      assert.strictEqual(downCall[1].windowsVirtualKeyCode, 40);
    });

    it('should handle Escape key', async () => {
      await input.press('Escape');

      const downCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(downCall[1].key, 'Escape');
      assert.strictEqual(downCall[1].windowsVirtualKeyCode, 27);
    });

    it('should handle function keys', async () => {
      await input.press('F5');

      const downCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(downCall[1].key, 'F5');
      assert.strictEqual(downCall[1].code, 'F5');
      assert.strictEqual(downCall[1].windowsVirtualKeyCode, 116);
    });
  });

  describe('fill', () => {
    it('should click, select all, then type', async () => {
      await input.fill(100, 200, 'new text');

      const calls = mockCdp.send.mock.calls.map(c => c.arguments);

      // First 3 calls: click (mouseMoved, mousePressed, mouseReleased)
      assert.strictEqual(calls[0][1].type, 'mouseMoved');
      assert.strictEqual(calls[1][1].type, 'mousePressed');
      assert.strictEqual(calls[2][1].type, 'mouseReleased');

      // Next: Select all (rawKeyDown, keyUp for 'a')
      // On macOS uses meta (4), on other platforms uses ctrl (2)
      const selectAllDown = calls[3];
      assert.strictEqual(selectAllDown[1].type, 'rawKeyDown');
      assert.strictEqual(selectAllDown[1].key, 'a');
      const expectedModifier = process.platform === 'darwin' ? 4 : 2;
      assert.strictEqual(selectAllDown[1].modifiers, expectedModifier);

      // Then type the text
      const typeStart = 5; // After click (3) + select-all down/up (2)
      assert.strictEqual(calls[typeStart][1].type, 'char');
      assert.strictEqual(calls[typeStart][1].text, 'n');
    });
  });

  describe('moveMouse', () => {
    it('should send mouseMoved event', async () => {
      await input.moveMouse(300, 400);

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
      const call = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(call[0], 'Input.dispatchMouseEvent');
      assert.strictEqual(call[1].type, 'mouseMoved');
      assert.strictEqual(call[1].x, 300);
      assert.strictEqual(call[1].y, 400);
    });

    it('should validate coordinates', async () => {
      await assert.rejects(() => input.moveMouse('invalid', 100), {
        message: 'Coordinates must be finite numbers'
      });
    });
  });

  describe('scroll', () => {
    it('should send mouseWheel event', async () => {
      await input.scroll(0, 100);

      assert.strictEqual(mockCdp.send.mock.calls.length, 1);
      const call = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(call[0], 'Input.dispatchMouseEvent');
      assert.strictEqual(call[1].type, 'mouseWheel');
      assert.strictEqual(call[1].deltaX, 0);
      assert.strictEqual(call[1].deltaY, 100);
      assert.strictEqual(call[1].x, 100); // default origin
      assert.strictEqual(call[1].y, 100);
    });

    it('should allow custom origin coordinates', async () => {
      await input.scroll(50, 200, 250, 350);

      const call = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(call[1].x, 250);
      assert.strictEqual(call[1].y, 350);
    });
  });

  describe('modifier calculations', () => {
    it('should calculate alt modifier correctly', async () => {
      await input.click(0, 0, { modifiers: { alt: true } });
      const call = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(call[1].modifiers, 1);
    });

    it('should calculate ctrl modifier correctly', async () => {
      await input.click(0, 0, { modifiers: { ctrl: true } });
      const call = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(call[1].modifiers, 2);
    });

    it('should calculate meta modifier correctly', async () => {
      await input.click(0, 0, { modifiers: { meta: true } });
      const call = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(call[1].modifiers, 4);
    });

    it('should calculate shift modifier correctly', async () => {
      await input.click(0, 0, { modifiers: { shift: true } });
      const call = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(call[1].modifiers, 8);
    });
  });

  describe('button masks', () => {
    it('should use correct mask for left button', async () => {
      await input.click(0, 0, { button: 'left' });
      const call = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(call[1].buttons, 1);
    });

    it('should use correct mask for back button', async () => {
      await input.click(0, 0, { button: 'back' });
      const call = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(call[1].buttons, 8);
    });

    it('should use correct mask for forward button', async () => {
      await input.click(0, 0, { button: 'forward' });
      const call = mockCdp.send.mock.calls[1].arguments;
      assert.strictEqual(call[1].buttons, 16);
    });
  });

  describe('edge cases', () => {
    describe('click edge cases', () => {
      it('should handle zero coordinates', async () => {
        await input.click(0, 0);
        const call = mockCdp.send.mock.calls[0].arguments;
        assert.strictEqual(call[1].x, 0);
        assert.strictEqual(call[1].y, 0);
      });

      it('should handle very large coordinates', async () => {
        await input.click(10000, 10000);
        const call = mockCdp.send.mock.calls[0].arguments;
        assert.strictEqual(call[1].x, 10000);
        assert.strictEqual(call[1].y, 10000);
      });

      it('should handle decimal coordinates', async () => {
        await input.click(100.5, 200.7);
        const call = mockCdp.send.mock.calls[0].arguments;
        assert.strictEqual(call[1].x, 100.5);
        assert.strictEqual(call[1].y, 200.7);
      });

      it('should handle empty modifiers object', async () => {
        await input.click(100, 100, { modifiers: {} });
        const call = mockCdp.send.mock.calls[0].arguments;
        assert.strictEqual(call[1].modifiers, 0);
      });
    });

    describe('type edge cases', () => {
      it('should handle unicode characters', async () => {
        await input.type('日本語');
        assert.strictEqual(mockCdp.send.mock.calls.length, 3);
        assert.strictEqual(mockCdp.send.mock.calls[0].arguments[1].text, '日');
        assert.strictEqual(mockCdp.send.mock.calls[1].arguments[1].text, '本');
        assert.strictEqual(mockCdp.send.mock.calls[2].arguments[1].text, '語');
      });

      it('should handle emoji characters', async () => {
        await input.type('👍');
        // Simple emoji is 2 UTF-16 code units but JS for...of treats it as 1 char
        assert.strictEqual(mockCdp.send.mock.calls.length, 1);
        assert.strictEqual(mockCdp.send.mock.calls[0].arguments[1].text, '👍');
      });

      it('should handle emoji with skin tone modifier', async () => {
        await input.type('👍🏻');
        // Skin tone emoji is 2 graphemes in for...of (base + modifier)
        assert.strictEqual(mockCdp.send.mock.calls.length, 2);
      });

      it('should handle ZWJ emoji sequences', async () => {
        await input.type('👨‍👩‍👧');
        // ZWJ family emoji is multiple code points joined by ZWJ
        // for...of iterates code points, not graphemes
        assert.ok(mockCdp.send.mock.calls.length >= 5); // family emoji has multiple parts
      });

      it('should handle newline characters', async () => {
        await input.type('line1\nline2');
        const chars = mockCdp.send.mock.calls.map(c => c.arguments[1].text);
        assert.ok(chars.includes('\n'));
      });

      it('should handle tab characters', async () => {
        await input.type('col1\tcol2');
        const chars = mockCdp.send.mock.calls.map(c => c.arguments[1].text);
        assert.ok(chars.includes('\t'));
      });
    });

    describe('press edge cases', () => {
      it('should handle unknown key gracefully', async () => {
        await input.press('!');
        const call = mockCdp.send.mock.calls[0].arguments;
        assert.strictEqual(call[1].key, '!');
      });

      it('should handle modifier keys', async () => {
        await input.press('Shift');
        const call = mockCdp.send.mock.calls[0].arguments;
        assert.strictEqual(call[1].key, 'Shift');
        assert.strictEqual(call[1].code, 'ShiftLeft');
      });
    });

    describe('fill edge cases', () => {
      it('should handle empty string fill', async () => {
        await input.fill(100, 200, '');
        // Should still click and select all, just no chars typed
        assert.ok(mockCdp.send.mock.calls.length > 0);
      });

      it('should use meta modifier when useMeta option is true', async () => {
        await input.fill(100, 200, 'test', { useMeta: true });

        const calls = mockCdp.send.mock.calls.map(c => c.arguments);
        // Find the Ctrl/Cmd+A keydown
        const ctrlADown = calls.find(c => c[1].type === 'rawKeyDown' && c[1].key === 'a');
        assert.strictEqual(ctrlADown[1].modifiers, 4); // meta = 4
      });

      it('should use ctrl modifier when useMeta option is false', async () => {
        await input.fill(100, 200, 'test', { useMeta: false });

        const calls = mockCdp.send.mock.calls.map(c => c.arguments);
        // Find the Ctrl/Cmd+A keydown
        const ctrlADown = calls.find(c => c[1].type === 'rawKeyDown' && c[1].key === 'a');
        assert.strictEqual(ctrlADown[1].modifiers, 2); // ctrl = 2
      });
    });

    describe('scroll edge cases', () => {
      it('should handle negative scroll values', async () => {
        await input.scroll(-100, -200);
        const call = mockCdp.send.mock.calls[0].arguments;
        assert.strictEqual(call[1].deltaX, -100);
        assert.strictEqual(call[1].deltaY, -200);
      });

      it('should handle zero scroll values', async () => {
        await input.scroll(0, 0);
        const call = mockCdp.send.mock.calls[0].arguments;
        assert.strictEqual(call[1].deltaX, 0);
        assert.strictEqual(call[1].deltaY, 0);
      });
    });
  });

  describe('hover', () => {
    it('should dispatch mouseMoved event', async () => {
      await input.hover(100, 200);

      const call = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(call[0], 'Input.dispatchMouseEvent');
      assert.strictEqual(call[1].type, 'mouseMoved');
      assert.strictEqual(call[1].x, 100);
      assert.strictEqual(call[1].y, 200);
    });

    it('should validate coordinates', async () => {
      await assert.rejects(
        () => input.hover(-1, 100),
        /non-negative/
      );
    });
  });

  describe('pressCombo', () => {
    it('should parse and press Control+a', async () => {
      await input.pressCombo('Control+a');

      const keyDownCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(keyDownCall[0], 'Input.dispatchKeyEvent');
      assert.strictEqual(keyDownCall[1].key, 'a');
      assert.strictEqual(keyDownCall[1].modifiers, 2); // ctrl = 2
    });

    it('should parse and press Meta+c', async () => {
      await input.pressCombo('Meta+c');

      const keyDownCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(keyDownCall[1].key, 'c');
      assert.strictEqual(keyDownCall[1].modifiers, 4); // meta = 4
    });

    it('should parse complex combos like Control+Shift+Enter', async () => {
      await input.pressCombo('Control+Shift+Enter');

      const keyDownCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(keyDownCall[1].key, 'Enter');
      assert.strictEqual(keyDownCall[1].modifiers, 10); // ctrl=2 + shift=8 = 10
    });

    it('should handle Alt modifier', async () => {
      await input.pressCombo('Alt+Tab');

      const keyDownCall = mockCdp.send.mock.calls[0].arguments;
      assert.strictEqual(keyDownCall[1].key, 'Tab');
      assert.strictEqual(keyDownCall[1].modifiers, 1); // alt = 1
    });

    it('should throw for combo without main key', async () => {
      await assert.rejects(
        () => input.pressCombo('Control+Shift'),
        /no main key/
      );
    });
  });

  describe('parseKeyCombo', () => {
    it('should parse simple combo', () => {
      const { key, modifiers } = input.parseKeyCombo('Control+a');
      assert.strictEqual(key, 'a');
      assert.strictEqual(modifiers.ctrl, true);
      assert.strictEqual(modifiers.shift, false);
    });

    it('should parse Cmd alias for Meta', () => {
      const { key, modifiers } = input.parseKeyCombo('Cmd+v');
      assert.strictEqual(key, 'v');
      assert.strictEqual(modifiers.meta, true);
    });

    it('should parse Ctrl alias for Control', () => {
      const { key, modifiers } = input.parseKeyCombo('Ctrl+z');
      assert.strictEqual(key, 'z');
      assert.strictEqual(modifiers.ctrl, true);
    });

    it('should parse all modifiers', () => {
      const { key, modifiers } = input.parseKeyCombo('Control+Alt+Shift+Meta+x');
      assert.strictEqual(key, 'x');
      assert.strictEqual(modifiers.ctrl, true);
      assert.strictEqual(modifiers.alt, true);
      assert.strictEqual(modifiers.shift, true);
      assert.strictEqual(modifiers.meta, true);
    });
  });
});
