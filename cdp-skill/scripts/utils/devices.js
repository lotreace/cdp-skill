/**
 * Device Presets
 * Viewport configurations for device emulation
 */

/**
 * Device preset configurations for viewport emulation
 */
export const DEVICE_PRESETS = new Map([
  // iPhones
  ['iphone-se', { width: 375, height: 667, deviceScaleFactor: 2, mobile: true, hasTouch: true }],
  ['iphone-12', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-12-mini', { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-12-pro', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-12-pro-max', { width: 428, height: 926, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-13', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-13-mini', { width: 375, height: 812, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-13-pro', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-13-pro-max', { width: 428, height: 926, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-14', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-14-plus', { width: 428, height: 926, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-14-pro', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-14-pro-max', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-15', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-15-plus', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-15-pro', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['iphone-15-pro-max', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true, hasTouch: true }],

  // iPads
  ['ipad', { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true, hasTouch: true }],
  ['ipad-mini', { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true, hasTouch: true }],
  ['ipad-air', { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true, hasTouch: true }],
  ['ipad-pro-11', { width: 834, height: 1194, deviceScaleFactor: 2, mobile: true, hasTouch: true }],
  ['ipad-pro-12.9', { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true, hasTouch: true }],

  // Android phones
  ['pixel-5', { width: 393, height: 851, deviceScaleFactor: 2.75, mobile: true, hasTouch: true }],
  ['pixel-6', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, hasTouch: true }],
  ['pixel-7', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, hasTouch: true }],
  ['pixel-7-pro', { width: 412, height: 892, deviceScaleFactor: 3.5, mobile: true, hasTouch: true }],
  ['samsung-galaxy-s21', { width: 360, height: 800, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['samsung-galaxy-s22', { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, hasTouch: true }],
  ['samsung-galaxy-s23', { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, hasTouch: true }],

  // Android tablets
  ['galaxy-tab-s7', { width: 800, height: 1280, deviceScaleFactor: 2, mobile: true, hasTouch: true }],

  // Desktop presets
  ['desktop', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, hasTouch: false }],
  ['desktop-hd', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, hasTouch: false }],
  ['desktop-4k', { width: 3840, height: 2160, deviceScaleFactor: 1, mobile: false, hasTouch: false }],
  ['laptop', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false, hasTouch: false }],
  ['laptop-hd', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, hasTouch: false }],
  ['macbook-air', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false, hasTouch: false }],
  ['macbook-pro-13', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false, hasTouch: false }],
  ['macbook-pro-14', { width: 1512, height: 982, deviceScaleFactor: 2, mobile: false, hasTouch: false }],
  ['macbook-pro-16', { width: 1728, height: 1117, deviceScaleFactor: 2, mobile: false, hasTouch: false }],

  // Landscape variants (appended with -landscape)
  ['iphone-14-landscape', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, hasTouch: true, isLandscape: true }],
  ['iphone-14-pro-landscape', { width: 852, height: 393, deviceScaleFactor: 3, mobile: true, hasTouch: true, isLandscape: true }],
  ['ipad-landscape', { width: 1024, height: 768, deviceScaleFactor: 2, mobile: true, hasTouch: true, isLandscape: true }],
  ['ipad-pro-11-landscape', { width: 1194, height: 834, deviceScaleFactor: 2, mobile: true, hasTouch: true, isLandscape: true }],
]);

/**
 * Get a device preset by name
 * @param {string} name - Device preset name (case-insensitive)
 * @returns {Object|null} Device configuration or null if not found
 */
export function getDevicePreset(name) {
  const normalizedName = name.toLowerCase().replace(/_/g, '-');
  return DEVICE_PRESETS.get(normalizedName) || null;
}

/**
 * Check if a preset exists
 * @param {string} name - Device preset name
 * @returns {boolean}
 */
export function hasDevicePreset(name) {
  const normalizedName = name.toLowerCase().replace(/_/g, '-');
  return DEVICE_PRESETS.has(normalizedName);
}

/**
 * Get all available preset names
 * @returns {string[]}
 */
export function listDevicePresets() {
  return Array.from(DEVICE_PRESETS.keys());
}

/**
 * Get presets by category
 * @param {string} category - 'iphone', 'ipad', 'android', 'desktop', 'landscape'
 * @returns {string[]}
 */
export function listDevicePresetsByCategory(category) {
  const categoryLower = category.toLowerCase();
  return listDevicePresets().filter(name => {
    if (categoryLower === 'iphone') return name.startsWith('iphone');
    if (categoryLower === 'ipad') return name.startsWith('ipad');
    if (categoryLower === 'android') return name.startsWith('pixel') || name.startsWith('samsung') || name.startsWith('galaxy');
    if (categoryLower === 'desktop') return name.startsWith('desktop') || name.startsWith('laptop') || name.startsWith('macbook');
    if (categoryLower === 'landscape') return name.endsWith('-landscape');
    return false;
  });
}

/**
 * Resolve viewport options - handles both preset strings and explicit configs
 * @param {string|Object} viewport - Either a preset name string or viewport config object
 * @returns {Object} Resolved viewport configuration
 * @throws {Error} If preset not found
 */
export function resolveViewport(viewport) {
  if (typeof viewport === 'string') {
    const preset = getDevicePreset(viewport);
    if (!preset) {
      const available = listDevicePresets().slice(0, 10).join(', ');
      throw new Error(`Unknown device preset "${viewport}". Available presets include: ${available}...`);
    }
    return { ...preset };
  }

  // It's an object - validate required fields
  if (!viewport.width || !viewport.height) {
    throw new Error('Viewport requires width and height');
  }

  return {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor || 1,
    mobile: viewport.mobile || false,
    hasTouch: viewport.hasTouch || false,
    isLandscape: viewport.isLandscape || false
  };
}
