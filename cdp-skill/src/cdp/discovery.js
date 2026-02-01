/**
 * CDP Discovery Module
 * HTTP-based Chrome DevTools Protocol endpoint discovery
 *
 * PUBLIC EXPORTS:
 * - createDiscovery(host?, port?, timeout?) - Factory for CDP discovery
 * - discoverChrome(host?, port?, timeout?) - Convenience function
 *
 * @module cdp-skill/cdp/discovery
 */

/**
 * Discover Chrome CDP endpoints via HTTP
 * @param {string} [host='localhost'] - Chrome debugging host
 * @param {number} [port=9222] - Chrome debugging port
 * @param {number} [timeout=5000] - Request timeout in ms
 * @returns {Object} Discovery interface
 */
export function createDiscovery(host = 'localhost', port = 9222, timeout = 5000) {
  const baseUrl = `http://${host}:${port}`;

  function createTimeoutController() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    return {
      signal: controller.signal,
      clear: () => clearTimeout(timeoutId)
    };
  }

  /**
   * Get Chrome version information
   * @returns {Promise<{browser: string, protocolVersion: string, webSocketDebuggerUrl: string}>}
   */
  async function getVersion() {
    const timeoutCtrl = createTimeoutController();
    try {
      const response = await fetch(`${baseUrl}/json/version`, { signal: timeoutCtrl.signal });
      if (!response.ok) {
        throw new Error(`Chrome not reachable at ${baseUrl}: ${response.status}`);
      }
      const data = await response.json();
      return {
        browser: data.Browser,
        protocolVersion: data['Protocol-Version'],
        webSocketDebuggerUrl: data.webSocketDebuggerUrl
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Chrome discovery timeout at ${baseUrl}`);
      }
      throw err;
    } finally {
      timeoutCtrl.clear();
    }
  }

  /**
   * Get all browser targets
   * @returns {Promise<Array>} Array of target info objects
   */
  async function getTargets() {
    const timeoutCtrl = createTimeoutController();
    try {
      const response = await fetch(`${baseUrl}/json/list`, { signal: timeoutCtrl.signal });
      if (!response.ok) {
        throw new Error(`Failed to get targets: ${response.status}`);
      }
      return response.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Chrome discovery timeout getting targets');
      }
      throw err;
    } finally {
      timeoutCtrl.clear();
    }
  }

  /**
   * Get page targets only
   * @returns {Promise<Array>} Array of page target info objects
   */
  async function getPages() {
    const targets = await getTargets();
    return targets.filter(t => t.type === 'page');
  }

  /**
   * Find a page by URL pattern
   * @param {string|RegExp} urlPattern - URL pattern to match
   * @returns {Promise<Object|null>} Matching target or null
   */
  async function findPageByUrl(urlPattern) {
    const pages = await getPages();
    const regex = urlPattern instanceof RegExp ? urlPattern : new RegExp(urlPattern);
    return pages.find(p => regex.test(p.url)) || null;
  }

  /**
   * Check if Chrome is available
   * @returns {Promise<boolean>}
   */
  async function isAvailable() {
    try {
      await getVersion();
      return true;
    } catch {
      return false;
    }
  }

  return {
    getVersion,
    getTargets,
    getPages,
    findPageByUrl,
    isAvailable
  };
}

/**
 * Convenience function to discover Chrome
 * @param {string} [host='localhost'] - Chrome debugging host
 * @param {number} [port=9222] - Chrome debugging port
 * @param {number} [timeout=5000] - Request timeout in ms
 * @returns {Promise<{wsUrl: string, version: Object, targets: Array}>}
 */
export async function discoverChrome(host = 'localhost', port = 9222, timeout = 5000) {
  const discovery = createDiscovery(host, port, timeout);
  const version = await discovery.getVersion();
  const targets = await discovery.getTargets();
  return {
    wsUrl: version.webSocketDebuggerUrl,
    version,
    targets
  };
}
