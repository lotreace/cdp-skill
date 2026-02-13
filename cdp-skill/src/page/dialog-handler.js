/**
 * Dialog Handler Module
 * Handles JavaScript alerts, confirms, and prompts
 *
 * PUBLIC EXPORTS:
 * - createDialogHandler(session) - Factory for dialog handler
 *
 * @module cdp-skill/page/dialog-handler
 */

/**
 * Create a dialog handler for JavaScript dialogs
 * @param {import('../types.js').CDPSession} session - CDP session
 * @returns {Object} Dialog handler interface
 */
export function createDialogHandler(session) {
  let dialogCallback = null;
  let boundHandler = null;
  const responseQueue = [];

  function onDialogOpening(params) {
    const { type, message, defaultPrompt } = params;

    // Default behavior: accept all dialogs
    let accept = true;
    let promptText = undefined;

    // Check if there's a queued response
    if (responseQueue.length > 0) {
      const queued = responseQueue.shift();
      accept = queued.accept !== false;
      promptText = queued.promptText;
    } else if (dialogCallback) {
      // If custom callback is set, use it
      try {
        const result = dialogCallback({ type, message, defaultPrompt });
        accept = result.accept !== false;
        promptText = result.promptText;
      } catch {
        // Callback threw — fall through to default accept behavior
      }
    } else {
      // Auto-accept with reasonable defaults for prompts
      if (type === 'prompt') {
        // Use defaultPrompt if available
        // Otherwise, for test automation purposes, use a reasonable default
        if (defaultPrompt !== undefined && defaultPrompt.length > 0) {
          promptText = defaultPrompt;
        } else if (message && message.toLowerCase().includes('prompt')) {
          // For prompt dialogs asking for input, use a test value
          promptText = 'Hello CDP';
        } else {
          promptText = '';
        }
      }
    }

    // Handle the dialog
    session.send('Page.handleJavaScriptDialog', {
      accept,
      promptText
    }).catch(err => {
      // Ignore errors - dialog may have been already handled
    });
  }

  /**
   * Enable dialog handling
   * @param {Function} [callback] - Optional callback to customize dialog handling
   * @returns {Promise<void>}
   */
  async function enable(callback = null) {
    dialogCallback = callback;

    if (!boundHandler) {
      boundHandler = onDialogOpening;
      session.on('Page.javascriptDialogOpening', boundHandler);
    }

    // Enable page domain if not already enabled
    try {
      await session.send('Page.enable');
    } catch (err) {
      // Ignore if already enabled
    }
  }

  /**
   * Disable dialog handling
   * @returns {Promise<void>}
   */
  async function disable() {
    if (boundHandler) {
      session.off('Page.javascriptDialogOpening', boundHandler);
      boundHandler = null;
    }
    dialogCallback = null;
  }

  /**
   * Set a custom dialog handler
   * @param {Function} callback - Callback({type, message, defaultPrompt}) => {accept, promptText}
   */
  function setHandler(callback) {
    dialogCallback = callback;
  }

  /**
   * Queue a response for the next dialog
   * @param {boolean} accept - Whether to accept the dialog
   * @param {string} [promptText] - Text to enter for prompts
   */
  function queueResponse(accept, promptText) {
    responseQueue.push({ accept, promptText });
  }

  return {
    enable,
    disable,
    setHandler,
    queueResponse
  };
}
