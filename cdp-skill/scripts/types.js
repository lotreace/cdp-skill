/**
 * Common Type Definitions for CDP Skill
 *
 * This module provides JSDoc type definitions used across the codebase.
 * Import types using: @import {TypeName} from './types.js'
 *
 * @module cdp-skill/types
 */

// ============================================================================
// CDP Session and Connection Types
// ============================================================================

/**
 * CDP session interface for communicating with browser targets
 * @typedef {Object} CDPSession
 * @property {function(string, Object=): Promise<Object>} send - Send CDP command
 * @property {function(string, function): void} on - Subscribe to CDP event
 * @property {function(string, function): void} off - Unsubscribe from CDP event
 * @property {function(): void} dispose - Clean up session resources
 * @property {function(): boolean} isValid - Check if session is still valid
 * @property {string} sessionId - CDP session ID
 * @property {string} targetId - Target ID this session is attached to
 */

/**
 * CDP connection interface for WebSocket communication
 * @typedef {Object} CDPConnection
 * @property {function(): Promise<void>} connect - Establish WebSocket connection
 * @property {function(string, Object=, number=): Promise<Object>} send - Send CDP command
 * @property {function(string, string, Object=, number=): Promise<Object>} sendToSession - Send command to session
 * @property {function(string, function): void} on - Subscribe to event
 * @property {function(string, function): void} off - Unsubscribe from event
 * @property {function(string, function=, number=): Promise<Object>} waitForEvent - Wait for specific event
 * @property {function(): Promise<void>} close - Close connection
 * @property {function(string=): void} removeAllListeners - Remove event listeners
 * @property {function(function): void} onClose - Set close callback
 * @property {function(): boolean} isConnected - Check connection status
 * @property {function(): string} getWsUrl - Get WebSocket URL
 */

// ============================================================================
// Element and DOM Types
// ============================================================================

/**
 * Element handle for interacting with DOM elements
 * @typedef {Object} ElementHandle
 * @property {function(): Promise<BoundingBox|null>} getBoundingBox - Get element dimensions
 * @property {function(Object=): Promise<void>} click - Click the element
 * @property {function(string): Promise<void>} type - Type text into element
 * @property {function(string, Object=): Promise<void>} fill - Fill element with value
 * @property {function(Object=): Promise<void>} scrollIntoView - Scroll element into view
 * @property {function(): Promise<boolean>} isVisible - Check visibility
 * @property {function(): Promise<boolean>} isEnabled - Check if enabled
 * @property {function(string): Promise<string|null>} getAttribute - Get attribute value
 * @property {function(): Promise<string>} getInnerText - Get inner text
 * @property {function(string): Promise<*>} evaluate - Run JS on element
 * @property {function(): Promise<void>} dispose - Release element reference
 * @property {string} objectId - CDP object ID
 */

/**
 * Bounding box dimensions for an element
 * @typedef {Object} BoundingBox
 * @property {number} x - X coordinate (left edge)
 * @property {number} y - Y coordinate (top edge)
 * @property {number} width - Element width
 * @property {number} height - Element height
 */

/**
 * Quad coordinates (4 points defining element shape)
 * @typedef {Array<{x: number, y: number}>} Quad
 */

// ============================================================================
// Navigation and Page Types
// ============================================================================

/**
 * Viewport configuration
 * @typedef {Object} ViewportConfig
 * @property {number} width - Viewport width in pixels
 * @property {number} height - Viewport height in pixels
 * @property {number} [deviceScaleFactor=1] - Device pixel ratio
 * @property {boolean} [mobile=false] - Emulate mobile device
 * @property {boolean} [hasTouch=false] - Enable touch events
 * @property {boolean} [isLandscape=false] - Landscape orientation
 */

/**
 * Navigation options
 * @typedef {Object} NavigationOptions
 * @property {string} [waitUntil='load'] - Wait condition: 'load', 'domcontentloaded', 'networkidle', 'commit'
 * @property {number} [timeout=30000] - Navigation timeout in ms
 * @property {string} [referrer] - Referrer URL
 */

/**
 * Navigation result
 * @typedef {Object} NavigationResult
 * @property {string} frameId - Frame ID that navigated
 * @property {string} loaderId - Loader ID for this navigation
 * @property {string} url - Final URL after navigation
 */

/**
 * Wait condition options
 * @typedef {Object} WaitOptions
 * @property {number} [timeout=30000] - Maximum wait time in ms
 * @property {number} [pollInterval=100] - Polling interval in ms
 * @property {string} [message] - Custom timeout message
 */

// ============================================================================
// Screenshot and Capture Types
// ============================================================================

/**
 * Screenshot options
 * @typedef {Object} ScreenshotOptions
 * @property {'png'|'jpeg'|'webp'} [format='png'] - Image format
 * @property {number} [quality] - JPEG/WebP quality (0-100)
 * @property {boolean} [fullPage=false] - Capture full scrollable page
 * @property {boolean} [omitBackground=false] - Transparent background
 * @property {ClipRegion} [clip] - Capture specific region
 * @property {string} [selector] - Capture specific element
 */

/**
 * Clip region for screenshots
 * @typedef {Object} ClipRegion
 * @property {number} x - X coordinate
 * @property {number} y - Y coordinate
 * @property {number} width - Width
 * @property {number} height - Height
 * @property {number} [scale=1] - Scale factor
 */

/**
 * PDF generation options
 * @typedef {Object} PdfOptions
 * @property {boolean} [landscape=false] - Landscape orientation
 * @property {boolean} [displayHeaderFooter=false] - Show header/footer
 * @property {string} [headerTemplate=''] - Header HTML template
 * @property {string} [footerTemplate=''] - Footer HTML template
 * @property {boolean} [printBackground=true] - Print background graphics
 * @property {number} [scale=1] - Page scale (0.1 to 2)
 * @property {number} [paperWidth=8.5] - Paper width in inches
 * @property {number} [paperHeight=11] - Paper height in inches
 * @property {number} [marginTop=0.4] - Top margin in inches
 * @property {number} [marginBottom=0.4] - Bottom margin in inches
 * @property {number} [marginLeft=0.4] - Left margin in inches
 * @property {number} [marginRight=0.4] - Right margin in inches
 * @property {string} [pageRanges=''] - Page ranges (e.g., '1-5, 8')
 * @property {boolean} [preferCSSPageSize=false] - Use CSS page size
 */

// ============================================================================
// Cookie and Storage Types
// ============================================================================

/**
 * Cookie object
 * @typedef {Object} CookieObject
 * @property {string} name - Cookie name
 * @property {string} value - Cookie value
 * @property {string} [domain] - Cookie domain
 * @property {string} [path='/'] - Cookie path
 * @property {number} [expires] - Expiration timestamp
 * @property {boolean} [httpOnly=false] - HTTP only flag
 * @property {boolean} [secure=false] - Secure flag
 * @property {'Strict'|'Lax'|'None'} [sameSite='Lax'] - SameSite attribute
 * @property {string} [url] - URL to derive domain/path from
 */

/**
 * Storage item
 * @typedef {Object} StorageItem
 * @property {string} name - Item key
 * @property {string} value - Item value
 */

// ============================================================================
// Test Runner Types
// ============================================================================

/**
 * Step execution result
 * @typedef {Object} StepResult
 * @property {string} action - Action that was executed
 * @property {'ok'|'error'|'skipped'} status - Execution status
 * @property {*} [result] - Action-specific result data
 * @property {string} [error] - Error message if failed
 * @property {number} [duration] - Execution time in ms
 */

/**
 * Run result from test execution
 * @typedef {Object} RunResult
 * @property {'ok'|'error'} status - Overall run status
 * @property {string} [tab] - Tab alias (e.g., 't1')
 * @property {boolean} [navigated] - Whether navigation occurred
 * @property {string} [fullSnapshot] - Full ARIA snapshot
 * @property {Object} [context] - Page context (URL, scroll, activeElement)
 * @property {Object} [changes] - DOM changes detected
 * @property {string} [viewportSnapshot] - Viewport-only ARIA snapshot
 * @property {boolean} [truncated] - Whether snapshot was truncated
 * @property {string} [screenshot] - Screenshot file path
 * @property {Array<Object>} [console] - Console errors/warnings
 * @property {Array<StepResult>} steps - Individual step results
 * @property {Array<Object>} errors - Error details for failed steps
 */

/**
 * Step configuration
 * @typedef {Object} StepConfig
 * @property {string} [goto] - Navigate to URL
 * @property {string} [click] - Click element (selector, ref, text, or x/y)
 * @property {string|Object} [fill] - Fill input: string (focused), {selector,value} (single), {fields} or mapping (batch)
 * @property {string} [type] - Type into element
 * @property {string} [press] - Press key(s)
 * @property {Object} [scroll] - Scroll configuration
 * @property {boolean|Object} [snapshot] - Take ARIA snapshot
 * @property {string|Object} [query] - Query elements
 * @property {string|Object} [hover] - Hover over element (selector, ref, text, or x/y)
 * @property {string|Object} [wait] - Wait for selector/text/urlContains (no time delay — use sleep)
 * @property {number} [sleep] - Time delay in ms (0–60000)
 * @property {string|Object} [pageFunction] - Execute JS: function expression or bare expression
 * @property {true|string|{url?: string, host?: string, port?: number, headless?: boolean}} [openTab] - Open new tab
 * @property {string} [closeTab] - Close tab by ID
 * @property {string|Object} [selectOption] - Select dropdown option
 * @property {string|Object} [viewport] - Set viewport
 * @property {Object} [cookies] - Cookie operations
 * @property {boolean} [back] - Navigate back
 * @property {boolean} [forward] - Navigate forward
 * @property {Object} [drag] - Drag and drop
 * @property {string|number|Object} [frame] - Frame ops: "selector", index, "top", {name}, {list:true}
 * @property {Object|Array} [elementsAt] - Coordinate lookup: {x,y} (point), [{x,y},...] (batch), {x,y,radius} (near)
 * @property {Object} [extract] - Extract data from page
 * @property {Object} [formState] - Get form state
 * @property {Object} [assert] - Assert condition
 * @property {Object} [validate] - Validate page state
 * @property {string} [submit] - Submit form
 */

/**
 * Runner dependencies
 * @typedef {Object} RunnerDependencies
 * @property {Object} browser - Browser client instance
 * @property {Object} pageController - Page controller instance
 * @property {Object} elementLocator - Element locator instance
 * @property {Object} inputEmulator - Input emulator instance
 * @property {Object} screenshotCapture - Screenshot capture instance
 * @property {Object} consoleCapture - Console capture instance
 * @property {Object} pdfCapture - PDF capture instance
 * @property {Object} ariaSnapshot - ARIA snapshot instance
 * @property {Object} cookieManager - Cookie manager instance
 */

// ============================================================================
// Error Types
// ============================================================================

/**
 * CDP Skill error
 * @typedef {Object} CDPError
 * @property {string} type - Error type (CONNECTION, NAVIGATION, TIMEOUT, etc.)
 * @property {string} message - Error message
 * @property {string} [code] - Error code
 * @property {Object} [details] - Additional error details
 */

// ============================================================================
// Console and Network Capture Types
// ============================================================================

/**
 * Console message
 * @typedef {Object} ConsoleMessage
 * @property {'console'|'exception'} type - Message type
 * @property {'log'|'debug'|'info'|'warning'|'error'} level - Log level
 * @property {string} text - Message text
 * @property {Array<Object>} [args] - Original arguments
 * @property {Object} [stackTrace] - Stack trace if available
 * @property {number} [timestamp] - CDP timestamp
 * @property {string} [url] - Source URL for exceptions
 * @property {number} [line] - Line number for exceptions
 * @property {number} [column] - Column number for exceptions
 */

/**
 * Network error
 * @typedef {Object} NetworkError
 * @property {'network-failure'|'http-error'} type - Error type
 * @property {string} requestId - Request ID
 * @property {string} url - Request URL
 * @property {string} method - HTTP method
 * @property {string} [resourceType] - Resource type (Document, Script, etc.)
 * @property {string} [errorText] - Error description
 * @property {boolean} [canceled] - Whether request was canceled
 * @property {number} [status] - HTTP status code (for http-error)
 * @property {string} [statusText] - HTTP status text
 * @property {number} timestamp - CDP timestamp
 */

// Export empty object to make this a proper module
export {};
