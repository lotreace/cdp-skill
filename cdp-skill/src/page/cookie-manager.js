/**
 * Cookie Manager Module
 * CDP-based cookie management for getting, setting, and clearing cookies
 *
 * PUBLIC EXPORTS:
 * - createCookieManager(session) - Factory for cookie manager
 *
 * @module cdp-skill/page/cookie-manager
 */

/**
 * Creates a cookie manager for getting, setting, and clearing cookies
 * @param {import('../types.js').CDPSession} session - CDP session
 * @returns {Object} Cookie manager interface
 */
export function createCookieManager(session) {
  /**
   * Get all cookies, optionally filtered by URLs
   * @param {string[]} [urls=[]] - Optional URLs to filter cookies
   * @returns {Promise<import('../types.js').CookieObject[]>} Array of cookie objects
   */
  async function getCookies(urls = []) {
    const result = await session.send('Storage.getCookies', {});
    let cookies = result.cookies || [];

    // Filter by URLs if provided
    if (urls.length > 0) {
      cookies = cookies.filter(cookie => {
        return urls.some(url => {
          try {
            const parsed = new URL(url);
            // Domain matching
            const domainMatch = cookie.domain.startsWith('.')
              ? parsed.hostname.endsWith(cookie.domain.slice(1))
              : parsed.hostname === cookie.domain;
            // Path matching
            const pathMatch = parsed.pathname.startsWith(cookie.path);
            // Secure matching
            const secureMatch = !cookie.secure || parsed.protocol === 'https:';
            return domainMatch && pathMatch && secureMatch;
          } catch {
            return false;
          }
        });
      });
    }

    return cookies.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite || 'Lax'
    }));
  }

  /**
   * Set one or more cookies
   * @param {import('../types.js').CookieObject[]} cookies - Array of cookie objects to set
   * @returns {Promise<void>}
   */
  async function setCookies(cookies) {
    const processedCookies = cookies.map(cookie => {
      const processed = {
        name: cookie.name,
        value: cookie.value
      };

      // If URL provided, derive domain/path/secure from it
      if (cookie.url) {
        try {
          const parsed = new URL(cookie.url);
          processed.domain = cookie.domain || parsed.hostname;
          processed.path = cookie.path || '/';
          processed.secure = cookie.secure !== undefined ? cookie.secure : parsed.protocol === 'https:';
        } catch {
          throw new Error(`Invalid cookie URL: ${cookie.url}`);
        }
      } else {
        // Require domain and path if no URL
        if (!cookie.domain) {
          throw new Error('Cookie requires either url or domain');
        }
        processed.domain = cookie.domain;
        processed.path = cookie.path || '/';
        processed.secure = cookie.secure || false;
      }

      // Optional properties
      if (cookie.expires !== undefined) {
        processed.expires = cookie.expires;
      }
      if (cookie.httpOnly !== undefined) {
        processed.httpOnly = cookie.httpOnly;
      }
      if (cookie.sameSite) {
        processed.sameSite = cookie.sameSite;
      }

      return processed;
    });

    await session.send('Storage.setCookies', { cookies: processedCookies });
  }

  /**
   * Clear all cookies or cookies matching specific domains
   * @param {string[]} [urls=[]] - Optional URLs to filter cookies by domain
   * @param {Object} [options] - Optional filters
   * @param {string} [options.domain] - Clear cookies for specific domain
   * @returns {Promise<{count: number}>} Number of cookies deleted
   */
  async function clearCookies(urls = [], options = {}) {
    const { domain } = options;

    if (urls.length === 0 && !domain) {
      // Clear all cookies
      const allCookies = await getCookies();
      const count = allCookies.length;
      await session.send('Storage.clearCookies', {});
      return { count };
    }

    // Get cookies to filter
    let cookiesToDelete;
    if (domain) {
      // Filter by domain - get all cookies and match domain
      const allCookies = await getCookies();
      cookiesToDelete = allCookies.filter(cookie =>
        cookie.domain === domain ||
        cookie.domain === `.${domain}` ||
        cookie.domain.endsWith(`.${domain}`)
      );
    } else {
      // Filter by URLs (original behavior)
      cookiesToDelete = await getCookies(urls);
    }

    let deletedCount = 0;

    for (const cookie of cookiesToDelete) {
      try {
        await session.send('Network.deleteCookies', {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path
        });
        deletedCount++;
      } catch {
        // Ignore individual deletion failures
      }
    }

    return { count: deletedCount };
  }

  /**
   * Delete specific cookies by name
   * @param {string|string[]} names - Cookie name(s) to delete
   * @param {Object} [options] - Optional filters
   * @param {string} [options.domain] - Limit deletion to specific domain
   * @param {string} [options.path] - Limit deletion to specific path
   * @returns {Promise<{count: number}>} Number of cookies deleted
   */
  async function deleteCookies(names, options = {}) {
    const nameList = Array.isArray(names) ? names : [names];
    const { domain, path } = options;
    let deletedCount = 0;

    // Get all cookies to find matching ones
    const allCookies = await getCookies();

    for (const cookie of allCookies) {
      if (!nameList.includes(cookie.name)) continue;
      if (domain && cookie.domain !== domain && !cookie.domain.endsWith(`.${domain}`)) continue;
      if (path && cookie.path !== path) continue;

      try {
        await session.send('Network.deleteCookies', {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path
        });
        deletedCount++;
      } catch {
        // Ignore individual deletion failures
      }
    }

    return { count: deletedCount };
  }

  return {
    getCookies,
    setCookies,
    clearCookies,
    deleteCookies
  };
}
