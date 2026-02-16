/**
 * Centris Native Control - JavaScript Wrapper
 *
 * Provides async/Promise interface to native C++ accessibility module.
 * This is the "DOM for Desktop" - get exact element coordinates without vision/screenshots.
 */

"use strict";

// Load native addon
let nativeControl;
try {
  nativeControl = require("../build/Release/centris_control.node");
} catch (e) {
  console.error("Failed to load native control module:", e.message);
  console.error('Run "npm run build" to compile the native module.');
  throw e;
}

/**
 * Configuration for the control system
 */
const defaultConfig = {
  cacheElements: true, // Cache element tree between calls
  cacheTimeoutMs: 1000, // Cache invalidation timeout
  logPerformance: false, // Log timing info
  moveMouseForClicks: true, // Move real mouse for clicks
};

/**
 * Initialize the native control system
 * @param {Object} config - Configuration options
 * @returns {Promise<boolean>}
 */
async function initialize(config = {}) {
  const mergedConfig = { ...defaultConfig, ...config };
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.initialize(mergedConfig);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Shutdown the control system
 * @returns {Promise<void>}
 */
async function shutdown() {
  return new Promise((resolve) => {
    nativeControl.shutdown();
    resolve();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Element Discovery
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get interactive snapshot of an application
 * Like browser's getInteractiveSnapshot() - returns all clickable/interactive elements
 *
 * @param {Object} options
 * @param {string} [options.appName] - App name (empty = frontmost app)
 * @param {string} [options.windowTitle] - Filter by window title
 * @param {boolean} [options.includeHidden] - Include hidden elements
 * @param {number} [options.maxDepth] - Max tree depth (-1 = unlimited)
 * @returns {Promise<Object>} Snapshot with elements array
 *
 * @example
 * const snapshot = await getInteractiveSnapshot({ appName: 'Slack' });
 * console.log(`Found ${snapshot.elements.length} interactive elements`);
 */
async function getInteractiveSnapshot(options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.getInteractiveSnapshot(options);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Find a single element matching criteria
 * @param {Object} criteria
 * @param {string} [criteria.appName] - App name
 * @param {string} [criteria.role] - Element role (button, textField, etc.)
 * @param {string} [criteria.name] - Element name
 * @returns {Promise<Object|null>} Element or null if not found
 */
async function findElement(criteria) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.findElement(criteria);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Find all elements matching criteria
 * @param {Object} criteria
 * @returns {Promise<Array>} Array of matching elements
 */
async function findElements(criteria) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.findElements(criteria);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get element by ID from cache
 * @param {number} elementId
 * @returns {Promise<Object|null>}
 */
async function getElementById(elementId) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.getElementById(elementId);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Element Actions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Click an element by ID
 * Uses EXACT coordinates from accessibility API - no miss-clicks!
 *
 * @param {number} elementId - Element ID from snapshot
 * @param {Object} [options]
 * @param {string} [options.button='left'] - Mouse button
 * @param {number} [options.clickCount=1] - Number of clicks
 * @param {string[]} [options.modifiers=[]] - Modifier keys
 * @param {boolean} [options.moveMouseFirst=true] - Move cursor first
 * @returns {Promise<boolean>}
 *
 * @example
 * await clickElement(sendButton.id);
 * await clickElement(item.id, { clickCount: 2 }); // Double-click
 */
async function clickElement(elementId, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.clickElement(elementId, options);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Type text into an element
 * @param {number} elementId - Element ID (should be a text field)
 * @param {string} text - Text to type
 * @param {Object} [options]
 * @param {boolean} [options.clearFirst=true] - Clear existing text
 * @param {boolean} [options.pressEnter=false] - Press Enter after
 * @param {number} [options.typeDelayMs=0] - Delay between keystrokes
 * @returns {Promise<boolean>}
 */
async function typeIntoElement(elementId, text, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.typeIntoElement(elementId, text, options);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Perform native accessibility action on element
 * @param {number} elementId
 * @param {string} action - Action name (press, showMenu, expand, etc.)
 * @returns {Promise<boolean>}
 */
async function performAction(elementId, action) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.performAction(elementId, action);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Set element value directly
 * @param {number} elementId
 * @param {string} value
 * @returns {Promise<boolean>}
 */
async function setValue(elementId, value) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.setValue(elementId, value);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Insert text at cursor position in the currently focused text field
 * This bypasses the clipboard entirely - perfect for dictation!
 *
 * Uses macOS Accessibility API:
 * 1. Gets focused element via kAXFocusedUIElementAttribute
 * 2. Gets cursor position via kAXSelectedTextRangeAttribute
 * 3. Inserts text at cursor, replacing any selection
 * 4. Updates cursor position to after inserted text
 *
 * @param {string} text - Text to insert
 * @returns {Promise<boolean>} - true if successful
 *
 * @example
 * // Insert dictated text directly into the focused text field
 * await insertTextAtCursor("Hello, this is dictated text!");
 */
async function insertTextAtCursor(text) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.insertTextAtCursor(text);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Direct Mouse/Keyboard Control
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Move mouse to position
 * @param {number} x
 * @param {number} y
 * @returns {Promise<boolean>}
 */
async function moveMouse(x, y) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.moveMouse(x, y);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Click at coordinates
 * @param {number} x
 * @param {number} y
 * @param {Object} [options]
 * @returns {Promise<boolean>}
 */
async function click(x, y, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.click(x, y, options);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Drag from one point to another
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @returns {Promise<boolean>}
 */
async function drag(fromX, fromY, toX, toY) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.drag(fromX, fromY, toX, toY);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Type text (with current keyboard focus)
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function type(text) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.type(text);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Press key combination
 * @param {string} keyCombo - e.g., 'cmd+c', 'ctrl+shift+n'
 * @returns {Promise<boolean>}
 */
async function keyPress(keyCombo) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.keyPress(keyCombo);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Scroll at current or specified position
 * @param {Object} delta - { deltaX, deltaY }
 * @returns {Promise<boolean>}
 */
async function scroll(delta) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.scroll(delta);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get current mouse position
 * @returns {Promise<{x: number, y: number}>}
 */
async function getMousePosition() {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.getMousePosition();
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Window Management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get all windows
 * @param {string} [appName] - Filter by app name
 * @returns {Promise<Array>}
 */
async function getWindows(appName = "") {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.getWindows(appName);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get frontmost window
 * @returns {Promise<Object|null>}
 */
async function getFrontmostWindow() {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.getFrontmostWindow();
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Focus a window
 * @param {number} windowId
 * @returns {Promise<boolean>}
 */
async function focusWindow(windowId) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.focusWindow(windowId);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Resize a window
 * @param {number} windowId
 * @param {number} width
 * @param {number} height
 * @returns {Promise<boolean>}
 */
async function resizeWindow(windowId, width, height) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.resizeWindow(windowId, width, height);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Move a window
 * @param {number} windowId
 * @param {number} x
 * @param {number} y
 * @returns {Promise<boolean>}
 */
async function moveWindow(windowId, x, y) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.moveWindow(windowId, x, y);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Application Management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get running applications
 * @returns {Promise<Array>}
 */
async function getRunningApps() {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.getRunningApps();
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get frontmost application
 * @returns {Promise<Object|null>}
 */
async function getFrontmostApp() {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.getFrontmostApp();
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Activate (focus) an application
 * @param {string} appName
 * @returns {Promise<boolean>}
 */
async function activateApp(appName) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.activateApp(appName);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Launch an application
 * @param {string} bundleIdOrPath
 * @returns {Promise<boolean>}
 */
async function launchApp(bundleIdOrPath) {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.launchApp(bundleIdOrPath);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Display Information
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get all displays
 * @returns {Promise<Array>}
 */
async function getDisplays() {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeControl.getDisplays();
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Lifecycle
  initialize,
  shutdown,

  // Element Discovery
  getInteractiveSnapshot,
  findElement,
  findElements,
  getElementById,

  // Element Actions
  clickElement,
  typeIntoElement,
  performAction,
  setValue,
  insertTextAtCursor,

  // Mouse/Keyboard
  moveMouse,
  click,
  drag,
  type,
  keyPress,
  scroll,
  getMousePosition,

  // Window Management
  getWindows,
  getFrontmostWindow,
  focusWindow,
  resizeWindow,
  moveWindow,

  // Application Management
  getRunningApps,
  getFrontmostApp,
  activateApp,
  launchApp,

  // Display
  getDisplays,
};
