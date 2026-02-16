/**
 * Web Storage Manager Module
 * Management for localStorage and sessionStorage via CDP
 *
 * PUBLIC EXPORTS:
 * - createWebStorageManager(session) - Factory for web storage manager
 *
 * @module cdp-skill/page/web-storage-manager
 */

/**
 * Creates a web storage manager for localStorage and sessionStorage
 * @param {import('../types.js').CDPSession} session - CDP session
 * @returns {Object} Web storage manager interface
 */
export function createWebStorageManager(session) {
  const STORAGE_SCRIPT = `
(function(storageType) {
  const storage = storageType === 'session' ? sessionStorage : localStorage;
  return Object.keys(storage).map(key => ({
    name: key,
    value: storage.getItem(key)
  }));
})
`;

  const SET_STORAGE_SCRIPT = `
(function(storageType, items) {
  const storage = storageType === 'session' ? sessionStorage : localStorage;
  for (const [key, value] of Object.entries(items)) {
    if (value === null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, value);
    }
  }
  return true;
})
`;

  const CLEAR_STORAGE_SCRIPT = `
(function(storageType) {
  const storage = storageType === 'session' ? sessionStorage : localStorage;
  storage.clear();
  return true;
})
`;

  /**
   * Get all items from localStorage or sessionStorage
   * @param {'local'|'session'} [type='local'] - Storage type
   * @returns {Promise<import('../types.js').StorageItem[]>} Array of storage items
   */
  async function getStorage(type = 'local') {
    const storageType = type === 'session' ? 'session' : 'local';
    const result = await session.send('Runtime.evaluate', {
      expression: `(${STORAGE_SCRIPT})('${storageType}')`,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      throw new Error(`Failed to get ${storageType}Storage: ${result.exceptionDetails.text}`);
    }

    return result.result.value || [];
  }

  /**
   * Set items in localStorage or sessionStorage
   * @param {Object} items - Object with key-value pairs (null value removes item)
   * @param {'local'|'session'} [type='local'] - Storage type
   * @returns {Promise<void>}
   */
  async function setStorage(items, type = 'local') {
    const storageType = type === 'session' ? 'session' : 'local';
    const result = await session.send('Runtime.evaluate', {
      expression: `(${SET_STORAGE_SCRIPT})('${storageType}', ${JSON.stringify(items)})`,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      throw new Error(`Failed to set ${storageType}Storage: ${result.exceptionDetails.text}`);
    }
  }

  /**
   * Clear all items from localStorage or sessionStorage
   * @param {'local'|'session'} [type='local'] - Storage type
   * @returns {Promise<void>}
   */
  async function clearStorage(type = 'local') {
    const storageType = type === 'session' ? 'session' : 'local';
    const result = await session.send('Runtime.evaluate', {
      expression: `(${CLEAR_STORAGE_SCRIPT})('${storageType}')`,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      throw new Error(`Failed to clear ${storageType}Storage: ${result.exceptionDetails.text}`);
    }
  }

  return {
    getStorage,
    setStorage,
    clearStorage
  };
}
