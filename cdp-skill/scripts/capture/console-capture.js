/**
 * Console Capture Module
 * Captures browser console messages and exceptions during test execution
 *
 * PUBLIC EXPORTS:
 * - createConsoleCapture(session, options?) - Factory for console capture
 *
 * @module cdp-skill/capture/console-capture
 */

const DEFAULT_MAX_MESSAGES = 10000;

/**
 * Create a console capture utility for capturing console messages and exceptions
 * Listens only to Runtime.consoleAPICalled to avoid duplicate messages
 * @param {import('../types.js').CDPSession} session - CDP session
 * @param {Object} [options] - Configuration options
 * @param {number} [options.maxMessages=10000] - Maximum messages to store
 * @returns {Object} Console capture interface
 */
export function createConsoleCapture(session, options = {}) {
  const maxMessages = options.maxMessages || DEFAULT_MAX_MESSAGES;
  let messages = [];
  let capturing = false;
  const handlers = {
    consoleAPICalled: null,
    exceptionThrown: null
  };

  function mapConsoleType(type) {
    const mapping = {
      'log': 'log',
      'debug': 'debug',
      'info': 'info',
      'error': 'error',
      'warning': 'warning',
      'warn': 'warning',
      'dir': 'log',
      'dirxml': 'log',
      'table': 'log',
      'trace': 'log',
      'assert': 'error',
      'count': 'log',
      'timeEnd': 'log'
    };
    return mapping[type] || 'log';
  }

  function formatArgs(args) {
    if (!Array.isArray(args)) return '[invalid args]';
    return args.map(arg => {
      try {
        if (arg.value !== undefined) return String(arg.value);
        if (arg.description) return arg.description;
        if (arg.unserializableValue) return arg.unserializableValue;
        if (arg.preview?.description) return arg.preview.description;
        return `[${arg.type || 'unknown'}]`;
      } catch {
        return '[unserializable]';
      }
    }).join(' ');
  }

  function extractExceptionMessage(exceptionDetails) {
    if (exceptionDetails.exception?.description) return exceptionDetails.exception.description;
    if (exceptionDetails.text) return exceptionDetails.text;
    return 'Unknown exception';
  }

  function addMessage(message) {
    messages.push(message);
    if (messages.length > maxMessages) {
      messages.shift();
    }
  }

  /**
   * Start capturing console messages
   * @returns {Promise<void>}
   */
  async function startCapture() {
    if (capturing) return;

    await session.send('Runtime.enable');

    handlers.consoleAPICalled = (params) => {
      addMessage({
        type: 'console',
        level: mapConsoleType(params.type),
        text: formatArgs(params.args),
        args: params.args,
        stackTrace: params.stackTrace,
        timestamp: params.timestamp
      });
    };

    handlers.exceptionThrown = (params) => {
      const exception = params.exceptionDetails;
      addMessage({
        type: 'exception',
        level: 'error',
        text: exception.text || extractExceptionMessage(exception),
        exception: exception.exception,
        stackTrace: exception.stackTrace,
        url: exception.url,
        line: exception.lineNumber,
        column: exception.columnNumber,
        timestamp: params.timestamp
      });
    };

    session.on('Runtime.consoleAPICalled', handlers.consoleAPICalled);
    session.on('Runtime.exceptionThrown', handlers.exceptionThrown);

    capturing = true;
  }

  /**
   * Stop capturing console messages
   * @returns {Promise<void>}
   */
  async function stopCapture() {
    if (!capturing) return;

    try {
      if (handlers.consoleAPICalled) {
        session.off('Runtime.consoleAPICalled', handlers.consoleAPICalled);
      }
      if (handlers.exceptionThrown) {
        session.off('Runtime.exceptionThrown', handlers.exceptionThrown);
      }

      await session.send('Runtime.disable');
    } finally {
      handlers.consoleAPICalled = null;
      handlers.exceptionThrown = null;
      capturing = false;
    }
  }

  /**
   * Get all captured messages
   * @returns {import('../types.js').ConsoleMessage[]}
   */
  function getMessages() {
    return [...messages];
  }

  /**
   * Get messages since a timestamp
   * @param {number} timestamp - CDP timestamp
   * @returns {import('../types.js').ConsoleMessage[]}
   */
  function getMessagesSince(timestamp) {
    return messages.filter(m => m.timestamp && m.timestamp >= timestamp);
  }

  /**
   * Get messages between timestamps
   * @param {number} startTimestamp - Start timestamp
   * @param {number} endTimestamp - End timestamp
   * @returns {import('../types.js').ConsoleMessage[]}
   */
  function getMessagesBetween(startTimestamp, endTimestamp) {
    return messages.filter(m =>
      m.timestamp && m.timestamp >= startTimestamp && m.timestamp <= endTimestamp
    );
  }

  /**
   * Get messages by log level
   * @param {string|string[]} levels - Log level(s) to filter
   * @returns {import('../types.js').ConsoleMessage[]}
   */
  function getMessagesByLevel(levels) {
    const levelSet = new Set(Array.isArray(levels) ? levels : [levels]);
    return messages.filter(m => levelSet.has(m.level));
  }

  /**
   * Get messages by type
   * @param {string|string[]} types - Message type(s) to filter
   * @returns {import('../types.js').ConsoleMessage[]}
   */
  function getMessagesByType(types) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    return messages.filter(m => typeSet.has(m.type));
  }

  /**
   * Get error messages only
   * @returns {import('../types.js').ConsoleMessage[]}
   */
  function getErrors() {
    return messages.filter(m => m.level === 'error' || m.type === 'exception');
  }

  /**
   * Get warning messages only
   * @returns {import('../types.js').ConsoleMessage[]}
   */
  function getWarnings() {
    return messages.filter(m => m.level === 'warning');
  }

  /**
   * Check if any errors were captured
   * @returns {boolean}
   */
  function hasErrors() {
    return messages.some(m => m.level === 'error' || m.type === 'exception');
  }

  /**
   * Clear captured messages
   */
  function clear() {
    messages = [];
  }

  /**
   * Clear browser console
   * @returns {Promise<void>}
   */
  async function clearBrowserConsole() {
    await session.send('Console.clearMessages');
  }

  return {
    startCapture,
    stopCapture,
    getMessages,
    getMessagesSince,
    getMessagesBetween,
    getMessagesByLevel,
    getMessagesByType,
    getErrors,
    getWarnings,
    hasErrors,
    clear,
    clearBrowserConsole
  };
}
