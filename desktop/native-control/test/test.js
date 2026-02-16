/**
 * Centris Native Control - Integration Tests
 *
 * Run with: npm test
 */

"use strict";

const nativeControl = require("../lib/index");

// Test helpers
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
    testsFailed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || "Assertion failed"}: expected ${expected}, got ${actual}`);
  }
}

function assertType(value, type, name) {
  if (typeof value !== type) {
    throw new Error(`Expected ${name} to be ${type}, got ${typeof value}`);
  }
}

// ============================================================================
// Tests
// ============================================================================

async function runTests() {
  console.log("\n=== Centris Native Control Tests ===\n");

  // -------------------------------------------------------------------------
  // Initialization Tests
  // -------------------------------------------------------------------------
  console.log("--- Initialization ---");

  await asyncTest("initialize() should return true", async () => {
    const result = await nativeControl.initialize({
      cacheElements: true,
      logPerformance: false,
    });
    assert(result, "Expected true");
  });

  // -------------------------------------------------------------------------
  // Mouse Position Tests
  // -------------------------------------------------------------------------
  console.log("\n--- Mouse Position ---");

  await asyncTest("getMousePosition() should return coordinates", async () => {
    const pos = await nativeControl.getMousePosition();
    assertType(pos.x, "number", "x");
    assertType(pos.y, "number", "y");
    console.log(`  Mouse at: (${pos.x}, ${pos.y})`);
  });

  // -------------------------------------------------------------------------
  // Application Tests
  // -------------------------------------------------------------------------
  console.log("\n--- Applications ---");

  await asyncTest("getRunningApps() should return array", async () => {
    const apps = await nativeControl.getRunningApps();
    assert(Array.isArray(apps), "Expected array");
    assert(apps.length > 0, "Expected at least one app");
    console.log(`  Found ${apps.length} running apps`);

    // Check first app has required fields
    const app = apps[0];
    assertType(app.name, "string", "name");
    assertType(app.pid, "number", "pid");
  });

  await asyncTest("getFrontmostApp() should return app info", async () => {
    const app = await nativeControl.getFrontmostApp();
    assert(app !== null, "Expected app info");
    assertType(app.name, "string", "name");
    console.log(`  Frontmost app: ${app.name}`);
  });

  // -------------------------------------------------------------------------
  // Window Tests
  // -------------------------------------------------------------------------
  console.log("\n--- Windows ---");

  await asyncTest("getWindows() should return array", async () => {
    const windows = await nativeControl.getWindows();
    assert(Array.isArray(windows), "Expected array");
    console.log(`  Found ${windows.length} windows`);

    if (windows.length > 0) {
      const win = windows[0];
      assertType(win.id, "number", "id");
      assertType(win.title, "string", "title");
      assertType(win.bounds, "object", "bounds");
    }
  });

  await asyncTest("getFrontmostWindow() should return window info", async () => {
    const window = await nativeControl.getFrontmostWindow();
    if (window) {
      assertType(window.id, "number", "id");
      assertType(window.title, "string", "title");
      console.log(`  Frontmost window: "${window.title}"`);
    } else {
      console.log("  No frontmost window (may be minimized)");
    }
  });

  // -------------------------------------------------------------------------
  // Display Tests
  // -------------------------------------------------------------------------
  console.log("\n--- Displays ---");

  await asyncTest("getDisplays() should return array", async () => {
    const displays = await nativeControl.getDisplays();
    assert(Array.isArray(displays), "Expected array");
    assert(displays.length > 0, "Expected at least one display");
    console.log(`  Found ${displays.length} display(s)`);

    const display = displays[0];
    assertType(display.bounds, "object", "bounds");
    assertType(display.scaleFactor, "number", "scaleFactor");
    console.log(
      `  Primary: ${display.bounds.width}x${display.bounds.height} @ ${display.scaleFactor}x`,
    );
  });

  // -------------------------------------------------------------------------
  // Interactive Snapshot Tests
  // -------------------------------------------------------------------------
  console.log("\n--- Interactive Snapshot ---");

  await asyncTest("getInteractiveSnapshot() should return elements", async () => {
    const snapshot = await nativeControl.getInteractiveSnapshot();

    assert(snapshot !== null, "Expected snapshot");
    assertType(snapshot.timestamp, "number", "timestamp");
    assertType(snapshot.elements, "object", "elements");
    assert(Array.isArray(snapshot.elements), "Expected elements array");

    console.log(`  App: ${snapshot.appName}`);
    console.log(`  Window: "${snapshot.windowTitle}"`);
    console.log(`  Elements: ${snapshot.elements.length}`);
    console.log(`  Duration: ${snapshot.durationMs}ms`);

    if (snapshot.elements.length > 0) {
      const element = snapshot.elements[0];
      assertType(element.id, "number", "id");
      assertType(element.role, "string", "role");
      assertType(element.bounds, "object", "bounds");
    }

    // Show element counts
    console.log("  Element counts:");
    for (const [role, count] of Object.entries(snapshot.elementCounts)) {
      console.log(`    ${role}: ${count}`);
    }
  });

  // -------------------------------------------------------------------------
  // Find Element Tests
  // -------------------------------------------------------------------------
  console.log("\n--- Find Elements ---");

  await asyncTest("findElements() should find buttons", async () => {
    const buttons = await nativeControl.findElements({
      role: "button",
    });

    assert(Array.isArray(buttons), "Expected array");
    console.log(`  Found ${buttons.length} buttons`);

    if (buttons.length > 0) {
      console.log(
        `  First button: "${buttons[0].name}" at (${buttons[0].bounds.x}, ${buttons[0].bounds.y})`,
      );
    }
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  console.log("\n--- Cleanup ---");

  await asyncTest("shutdown() should complete", async () => {
    await nativeControl.shutdown();
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n=== Test Results ===");
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  console.log("");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error("Test runner error:", error);
  process.exit(1);
});
