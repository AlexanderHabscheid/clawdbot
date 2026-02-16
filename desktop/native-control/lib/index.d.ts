/**
 * Centris Native Control - TypeScript Definitions
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UIElement {
  /** Unique element ID */
  id: number;

  /** Element type: button, textField, checkbox, etc. */
  role: string;

  /** Element name/label */
  name: string;

  /** Accessibility label */
  label?: string;

  /** Current value (for inputs) */
  value?: string;

  /** Description/help text */
  description?: string;

  /** EXACT screen coordinates */
  bounds: Bounds;

  /** State flags */
  enabled: boolean;
  focused: boolean;
  visible: boolean;
  selected: boolean;
  checked: boolean;
  expanded: boolean;

  /** Hierarchy */
  parentId: number;
  childrenIds: number[];
  depth: number;

  /** Available actions */
  actions: string[];

  /** Application context */
  appName: string;
  appBundleId: string;
  appPid: number;
  windowId: number;
}

export interface InteractiveSnapshot {
  /** Timestamp when snapshot was taken */
  timestamp: number;

  /** Time to generate snapshot (ms) */
  durationMs: number;

  /** Application info */
  appName: string;
  appBundleId: string;
  appPid: number;

  /** Window info */
  windowId: number;
  windowTitle: string;
  windowBounds: Bounds;

  /** All interactive elements */
  elements: UIElement[];

  /** Element counts by role */
  elementCounts: Record<string, number>;
}

export interface WindowInfo {
  id: number;
  title: string;
  appName: string;
  appBundleId: string;
  appPid: number;
  bounds: Bounds;
  focused: boolean;
  minimized: boolean;
}

export interface AppInfo {
  name: string;
  bundleId: string;
  pid: number;
  focused: boolean;
  path: string;
}

export interface DisplayInfo {
  id: number;
  bounds: Bounds;
  workArea: Bounds;
  scaleFactor: number;
  isPrimary: boolean;
  name: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Options Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface InitConfig {
  cacheElements?: boolean;
  cacheTimeoutMs?: number;
  logPerformance?: boolean;
  moveMouseForClicks?: boolean;
}

export interface SnapshotOptions {
  /** App name (empty = frontmost) */
  appName?: string;
  /** Window title filter */
  windowTitle?: string;
  /** Include hidden elements */
  includeHidden?: boolean;
  /** Max tree depth (-1 = unlimited) */
  maxDepth?: number;
  /** Only include these roles */
  includeRoles?: string[];
  /** Exclude these roles */
  excludeRoles?: string[];
}

export interface ElementCriteria {
  appName?: string;
  role?: string;
  name?: string;
  label?: string;
  value?: string;
  nameExact?: boolean;
  enabled?: boolean;
  visible?: boolean;
}

export interface ClickOptions {
  /** Mouse button: 'left', 'right', 'middle' */
  button?: "left" | "right" | "middle";
  /** Number of clicks (1=single, 2=double) */
  clickCount?: number;
  /** Modifier keys: 'cmd', 'ctrl', 'alt', 'shift' */
  modifiers?: string[];
  /** Move real mouse cursor first */
  moveMouseFirst?: boolean;
  /** Delay before click (ms) */
  delayBeforeClick?: number;
}

export interface TypeOptions {
  /** Clear existing text first */
  clearFirst?: boolean;
  /** Press Enter after typing */
  pressEnter?: boolean;
  /** Delay between keystrokes (ms) */
  typeDelayMs?: number;
}

export interface ScrollDelta {
  /** Horizontal scroll (positive = right) */
  deltaX?: number;
  /** Vertical scroll (positive = down) */
  deltaY?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API Functions
// ═══════════════════════════════════════════════════════════════════════════════

/** Initialize the native control system */
export function initialize(config?: InitConfig): Promise<boolean>;

/** Shutdown the control system */
export function shutdown(): Promise<void>;

// Element Discovery
/** Get interactive snapshot of an application */
export function getInteractiveSnapshot(options?: SnapshotOptions): Promise<InteractiveSnapshot>;

/** Find a single element */
export function findElement(criteria: ElementCriteria): Promise<UIElement | null>;

/** Find all matching elements */
export function findElements(criteria: ElementCriteria): Promise<UIElement[]>;

/** Get element by ID from cache */
export function getElementById(elementId: number): Promise<UIElement | null>;

// Element Actions
/** Click element at exact center */
export function clickElement(elementId: number, options?: ClickOptions): Promise<boolean>;

/** Type text into element */
export function typeIntoElement(
  elementId: number,
  text: string,
  options?: TypeOptions,
): Promise<boolean>;

/** Perform accessibility action */
export function performAction(elementId: number, action: string): Promise<boolean>;

/** Set element value directly */
export function setValue(elementId: number, value: string): Promise<boolean>;

/**
 * Insert text at cursor position in the currently focused text field
 * This bypasses the clipboard entirely - perfect for dictation!
 *
 * Uses macOS Accessibility API to directly insert text at the cursor position.
 * If there's a selection, it replaces the selected text.
 *
 * @param text Text to insert
 * @returns true if successful
 */
export function insertTextAtCursor(text: string): Promise<boolean>;

// Mouse/Keyboard
/** Move mouse to position */
export function moveMouse(x: number, y: number): Promise<boolean>;

/** Click at coordinates */
export function click(x: number, y: number, options?: ClickOptions): Promise<boolean>;

/** Drag from point to point */
export function drag(fromX: number, fromY: number, toX: number, toY: number): Promise<boolean>;

/** Type text with current focus */
export function type(text: string): Promise<boolean>;

/** Press key combination */
export function keyPress(keyCombo: string): Promise<boolean>;

/** Scroll at current position */
export function scroll(delta: ScrollDelta): Promise<boolean>;

/** Get current mouse position */
export function getMousePosition(): Promise<{ x: number; y: number }>;

// Window Management
/** Get all windows */
export function getWindows(appName?: string): Promise<WindowInfo[]>;

/** Get frontmost window */
export function getFrontmostWindow(): Promise<WindowInfo | null>;

/** Focus a window */
export function focusWindow(windowId: number): Promise<boolean>;

/** Resize a window */
export function resizeWindow(windowId: number, width: number, height: number): Promise<boolean>;

/** Move a window */
export function moveWindow(windowId: number, x: number, y: number): Promise<boolean>;

// Application Management
/** Get running applications */
export function getRunningApps(): Promise<AppInfo[]>;

/** Get frontmost application */
export function getFrontmostApp(): Promise<AppInfo | null>;

/** Activate an application */
export function activateApp(appName: string): Promise<boolean>;

/** Launch an application */
export function launchApp(bundleIdOrPath: string): Promise<boolean>;

// Display
/** Get all displays */
export function getDisplays(): Promise<DisplayInfo[]>;
