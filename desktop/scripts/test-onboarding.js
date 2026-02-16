#!/usr/bin/env node

/**
 * Test script for onboarding System Settings opening
 * Run with: node scripts/test-onboarding.js [microphone|accessibility|screen]
 */

const OnboardingManager = require("../src/helpers/onboardingManager");

const manager = new OnboardingManager();
const pane = process.argv[2] || "accessibility";

console.log(`Testing onboarding manager for: ${pane}`);
console.log("");

async function test() {
  console.log("1. Checking current permissions...");
  const permissions = await manager.checkAllPermissions();
  console.log("   Microphone:", permissions.microphone ? "✓ Granted" : "✗ Not granted");
  console.log("   Accessibility:", permissions.accessibility ? "✓ Granted" : "✗ Not granted");
  console.log("");

  console.log(`2. Opening System Settings for ${pane}...`);
  const opened = await manager.openSystemPrivacyPane(pane);
  console.log(
    `   ${opened ? "✓ Successfully opened" : "⚠ Opened System Settings (may need manual navigation)"}`,
  );
  console.log("");

  console.log("3. Waiting 3 seconds, then checking permissions again...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const permissionsAfter = await manager.checkAllPermissions();
  console.log("   Microphone:", permissionsAfter.microphone ? "✓ Granted" : "✗ Not granted");
  console.log("   Accessibility:", permissionsAfter.accessibility ? "✓ Granted" : "✗ Not granted");
  console.log("");

  if (pane === "microphone") {
    console.log("4. Testing microphone permission request...");
    const micResult = await manager.requestMicrophonePermission();
    console.log(`   Result: ${micResult.granted ? "✓ Granted" : "✗ Not granted"}`);
  }

  if (pane === "accessibility") {
    console.log("4. Testing accessibility permission request...");
    const accResult = await manager.requestAccessibilityPermission();
    console.log(
      `   Result: ${accResult.granted ? "✓ Granted" : "✗ Not granted (user must enable manually)"}`,
    );
  }
}

test().catch(console.error);
