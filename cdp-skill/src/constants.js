/**
 * Constants
 * Centralized configuration values used across the codebase
 *
 * EXPORTS:
 * - TIMEOUTS - Timeout values in milliseconds
 * - POLL_INTERVALS - Polling interval values
 * - LIMITS - Various size and count limits
 * - VALID_FORMATS - Allowed screenshot formats
 * - KEY_DEFINITIONS - Special key code mappings
 * - NON_EDITABLE_INPUT_TYPES - Input types that cannot be typed into
 */

// Timeouts (milliseconds)
export const TIMEOUTS = {
  MAX: 300000,           // 5 minutes - absolute maximum
  DEFAULT: 10000,        // 10 seconds - default for actionability
  NETWORK_IDLE: 500,     // network idle threshold
  STABILITY: 50,         // DOM stability check
};

export const POLL_INTERVALS = {
  DEFAULT: 100,          // standard polling
  FAST: 50,              // actionability retries
};

export const LIMITS = {
  MAX_CONSOLE_MESSAGES: 10000,
  MAX_SCREENSHOT_DIMENSION: 16384,
  MAX_PENDING_REQUESTS: 10000,
  MAX_DOM_NODES: 500,
};

export const VALID_FORMATS = ['png', 'jpeg', 'webp'];

/**
 * Special key definitions for keyboard input
 */
export const KEY_DEFINITIONS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  Control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  Alt: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  Meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  F1: { key: 'F1', code: 'F1', keyCode: 112 },
  F2: { key: 'F2', code: 'F2', keyCode: 113 },
  F3: { key: 'F3', code: 'F3', keyCode: 114 },
  F4: { key: 'F4', code: 'F4', keyCode: 115 },
  F5: { key: 'F5', code: 'F5', keyCode: 116 },
  F6: { key: 'F6', code: 'F6', keyCode: 117 },
  F7: { key: 'F7', code: 'F7', keyCode: 118 },
  F8: { key: 'F8', code: 'F8', keyCode: 119 },
  F9: { key: 'F9', code: 'F9', keyCode: 120 },
  F10: { key: 'F10', code: 'F10', keyCode: 121 },
  F11: { key: 'F11', code: 'F11', keyCode: 122 },
  F12: { key: 'F12', code: 'F12', keyCode: 123 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Insert: { key: 'Insert', code: 'Insert', keyCode: 45 }
};

/**
 * Non-editable input types that cannot receive text input
 */
export const NON_EDITABLE_INPUT_TYPES = [
  'button', 'checkbox', 'color', 'file', 'hidden',
  'image', 'radio', 'range', 'reset', 'submit'
];
