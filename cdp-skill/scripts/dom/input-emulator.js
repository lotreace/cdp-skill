/**
 * Input Emulator
 * Mouse and keyboard input simulation via CDP
 *
 * EXPORTS:
 * - createInputEmulator(session) → InputEmulator
 *   Methods: click, doubleClick, rightClick, type, insertText, fill, press,
 *            pressCombo, parseKeyCombo, selectAll, moveMouse, hover, scroll,
 *            beginMouseTransaction, resetMouseState, getMouseState
 *
 * DEPENDENCIES:
 * - ../constants.js: KEY_DEFINITIONS
 * - ../utils.js: sleep
 */

import { KEY_DEFINITIONS } from '../constants.js';
import { sleep } from '../utils.js';

/**
 * Create an input emulator for mouse and keyboard input
 * @param {Object} session - CDP session
 * @returns {Object} Input emulator interface
 */
export function createInputEmulator(session, options = {}) {
  if (!session) throw new Error('CDP session is required');

  const { getFrameContext } = options;

  // Transaction-based mouse state
  // Inspired by Puppeteer's CdpMouse
  const mouseState = {
    x: 0,
    y: 0,
    button: 'none',
    buttons: 0,
    transactionDepth: 0,
    pendingOperations: []
  };

  /**
   * Begin a mouse transaction for atomic operations
   * Prevents concurrent mouse operations from interfering
   * @returns {Object} Transaction handle with commit/rollback
   */
  function beginMouseTransaction() {
    mouseState.transactionDepth++;
    const startState = { ...mouseState };

    return {
      /**
       * Commit the transaction, applying all pending state
       */
      commit: () => {
        mouseState.transactionDepth--;
      },

      /**
       * Rollback the transaction, restoring initial state
       */
      rollback: async () => {
        mouseState.transactionDepth--;
        // Reset mouse to initial state
        if (startState.buttons !== mouseState.buttons) {
          // Release any pressed buttons
          if (mouseState.buttons !== 0) {
            await session.send('Input.dispatchMouseEvent', {
              type: 'mouseReleased',
              x: mouseState.x,
              y: mouseState.y,
              button: mouseState.button,
              buttons: 0
            });
          }
        }
        mouseState.x = startState.x;
        mouseState.y = startState.y;
        mouseState.button = startState.button;
        mouseState.buttons = startState.buttons;
      },

      /**
       * Get current transaction state
       */
      getState: () => ({ ...mouseState })
    };
  }

  /**
   * Reset mouse state to default
   * Useful after errors or when starting fresh
   */
  async function resetMouseState() {
    if (mouseState.buttons !== 0) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: mouseState.x,
        y: mouseState.y,
        button: mouseState.button,
        buttons: 0
      });
    }
    mouseState.x = 0;
    mouseState.y = 0;
    mouseState.button = 'none';
    mouseState.buttons = 0;
  }

  /**
   * Get current mouse state
   */
  function getMouseState() {
    return { ...mouseState };
  }

  function calculateModifiers(modifiers) {
    let flags = 0;
    if (modifiers.alt) flags |= 1;
    if (modifiers.ctrl) flags |= 2;
    if (modifiers.meta) flags |= 4;
    if (modifiers.shift) flags |= 8;
    return flags;
  }

  function getButtonMask(button) {
    const masks = { left: 1, right: 2, middle: 4, back: 8, forward: 16 };
    return masks[button] || 1;
  }

  function getKeyDefinition(char) {
    if (char >= 'a' && char <= 'z') {
      return { key: char, code: `Key${char.toUpperCase()}`, keyCode: char.toUpperCase().charCodeAt(0) };
    }
    if (char >= 'A' && char <= 'Z') {
      return { key: char, code: `Key${char}`, keyCode: char.charCodeAt(0) };
    }
    if (char >= '0' && char <= '9') {
      return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0) };
    }
    return { key: char, code: '', keyCode: char.charCodeAt(0), text: char };
  }

  function validateCoordinates(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number' ||
        !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Coordinates must be finite numbers');
    }
    if (x < 0 || y < 0) {
      throw new Error('Coordinates must be non-negative');
    }
  }

  function validateButton(button) {
    const valid = ['left', 'right', 'middle', 'back', 'forward', 'none'];
    if (!valid.includes(button)) {
      throw new Error(`Invalid button: ${button}. Must be one of: ${valid.join(', ')}`);
    }
  }

  function validateClickCount(clickCount) {
    if (typeof clickCount !== 'number' || !Number.isInteger(clickCount) || clickCount < 1) {
      throw new Error('Click count must be a positive integer');
    }
  }

  async function click(x, y, opts = {}) {
    validateCoordinates(x, y);

    const {
      button = 'left',
      clickCount = 1,
      delay = 0,
      modifiers = {}
    } = opts;

    validateButton(button);
    validateClickCount(clickCount);

    const modifierFlags = calculateModifiers(modifiers);
    const buttonMask = getButtonMask(button);

    // Update mouse state tracking
    mouseState.x = x;
    mouseState.y = y;

    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, modifiers: modifierFlags
    });

    mouseState.button = button;
    mouseState.buttons = buttonMask;

    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button, clickCount,
      modifiers: modifierFlags, buttons: buttonMask
    });

    if (delay > 0) await sleep(delay);

    mouseState.button = 'none';
    mouseState.buttons = 0;

    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button, clickCount,
      modifiers: modifierFlags, buttons: 0
    });
  }

  async function doubleClick(x, y, opts = {}) {
    await click(x, y, { ...opts, clickCount: 2 });
  }

  async function rightClick(x, y, opts = {}) {
    await click(x, y, { ...opts, button: 'right' });
  }

  async function type(text, opts = {}) {
    if (typeof text !== 'string') {
      throw new Error('Text must be a string');
    }

    const { delay = 0 } = opts;

    for (const char of text) {
      await session.send('Input.dispatchKeyEvent', {
        type: 'char',
        text: char,
        key: char,
        unmodifiedText: char
      });

      if (delay > 0) await sleep(delay);
    }
  }

  /**
   * Insert text using Input.insertText (like paste) - much faster than type()
   * Inspired by Rod & Puppeteer's insertText approach
   * Triggers synthetic input event for React/Vue bindings
   * @param {string} text - Text to insert
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.dispatchEvents=true] - Dispatch input/change events
   * @returns {Promise<void>}
   */
  async function insertText(text, opts = {}) {
    if (typeof text !== 'string') {
      throw new Error('Text must be a string');
    }

    const { dispatchEvents = true } = opts;

    // Use CDP Input.insertText for fast text insertion
    await session.send('Input.insertText', { text });

    // Trigger synthetic input event for framework bindings (React, Vue, etc.)
    if (dispatchEvents) {
      const evalParams = {
        expression: `
          (function() {
            const el = document.activeElement;
            if (el) {
              el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
              el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            }
          })()
        `
      };
      if (getFrameContext) {
        const contextId = getFrameContext();
        if (contextId) evalParams.contextId = contextId;
      }
      await session.send('Runtime.evaluate', evalParams);
    }
  }

  async function fill(x, y, text, opts = {}) {
    await click(x, y);
    await sleep(50);

    const isMac = opts.useMeta ?? (typeof process !== 'undefined' && process.platform === 'darwin');
    const selectAllModifiers = isMac ? { meta: true } : { ctrl: true };
    await press('a', { modifiers: selectAllModifiers });

    await sleep(50);
    await type(text, opts);
  }

  // Mapping of Meta+key combos to macOS editing commands (sent via CDP commands param)
  const MAC_COMMANDS = {
    'a': ['selectAll'], 'c': ['copy'], 'v': ['paste'], 'x': ['cut'],
    'z': ['undo'],
  };
  const MAC_SHIFT_COMMANDS = {
    'z': ['redo'],
  };

  async function press(key, opts = {}) {
    const { modifiers = {}, delay = 0, commands } = opts;
    const keyDef = KEY_DEFINITIONS[key] || getKeyDefinition(key);
    const modifierFlags = calculateModifiers(modifiers);

    // Resolve commands: explicit > auto-detect for Meta combos on macOS
    const resolvedCommands = commands
      || (modifiers.meta && modifiers.shift && MAC_SHIFT_COMMANDS[keyDef.key])
      || (modifiers.meta && MAC_COMMANDS[keyDef.key])
      || undefined;

    const keyDown = {
      type: 'rawKeyDown',
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      nativeVirtualKeyCode: keyDef.keyCode,
      modifiers: modifierFlags
    };
    if (resolvedCommands) keyDown.commands = resolvedCommands;

    await session.send('Input.dispatchKeyEvent', keyDown);

    // Skip char event when command modifiers are held (shortcuts shouldn't produce text)
    // Shift alone still produces text (e.g., Shift+a → "A")
    const hasCommandModifier = modifiers.ctrl || modifiers.meta || modifiers.alt;
    if (keyDef.text && !hasCommandModifier) {
      await session.send('Input.dispatchKeyEvent', {
        type: 'char',
        text: keyDef.text,
        key: keyDef.key,
        modifiers: modifierFlags
      });
    }

    if (delay > 0) await sleep(delay);

    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      nativeVirtualKeyCode: keyDef.keyCode,
      modifiers: modifierFlags
    });
  }

  async function selectAll() {
    const evalParams = {
      expression: `
        (function() {
          const el = document.activeElement;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
            el.select();
          } else if (window.getSelection) {
            document.execCommand('selectAll', false, null);
          }
        })()
      `
    };
    if (getFrameContext) {
      const contextId = getFrameContext();
      if (contextId) evalParams.contextId = contextId;
    }
    await session.send('Runtime.evaluate', evalParams);
  }

  async function moveMouse(x, y) {
    validateCoordinates(x, y);
    mouseState.x = x;
    mouseState.y = y;
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  }

  async function hover(x, y, opts = {}) {
    validateCoordinates(x, y);
    const { duration = 0 } = opts;

    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y
    });

    mouseState.x = x;
    mouseState.y = y;

    if (duration > 0) {
      await sleep(duration);
    }
  }

  async function scroll(deltaX, deltaY, x = 100, y = 100) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y, deltaX, deltaY
    });
  }

  function parseKeyCombo(combo) {
    const parts = combo.split('+');
    const modifiers = { ctrl: false, alt: false, meta: false, shift: false };
    let key = null;

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower === 'control' || lower === 'ctrl') {
        modifiers.ctrl = true;
      } else if (lower === 'alt') {
        modifiers.alt = true;
      } else if (lower === 'meta' || lower === 'cmd' || lower === 'command') {
        modifiers.meta = true;
      } else if (lower === 'shift') {
        modifiers.shift = true;
      } else {
        key = part;
      }
    }

    return { key, modifiers };
  }

  async function pressCombo(combo, opts = {}) {
    const { key, modifiers } = parseKeyCombo(combo);
    if (!key) {
      throw new Error(`Invalid key combo: ${combo} - no main key specified`);
    }
    await press(key, { ...opts, modifiers });
  }

  return {
    click,
    doubleClick,
    rightClick,
    type,
    insertText,
    fill,
    press,
    pressCombo,
    parseKeyCombo,
    selectAll,
    moveMouse,
    hover,
    scroll,
    // Transaction-based mouse state
    beginMouseTransaction,
    resetMouseState,
    getMouseState
  };
}
