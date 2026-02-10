/**
 * Shared utilities for CDP browser automation
 *
 * This file re-exports all utility functions from the utils/ directory
 * for backward compatibility with existing imports.
 *
 * Original large file split into:
 * - utils/temp.js - Temp directory utilities
 * - utils/backoff.js - Backoff sleeper utilities
 * - utils/cdp-helpers.js - CDP helper functions
 * - utils/errors.js - Error types and factories
 * - utils/validators.js - Key and form validators
 * - utils/devices.js - Device presets
 */

export * from './utils/index.js';
