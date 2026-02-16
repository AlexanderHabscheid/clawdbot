#!/usr/bin/env node

/**
 * Quick Permission Test Script
 *
 * Tests microphone and accessibility permissions locally.
 * Run: node scripts/test-permissions.js
 */

const { systemPreferences, app } = require("electron");
const { spawn } = require("child_process");
const permissions = require("node-mac-permissions");

// Only run on macOS
if (process.platform !== "darwin") {
  console.log("⚠️  This script only works on macOS");
  process.exit(0);
}

console.log("═══════════════════════════════════════════════════════════");
console.log("🔍 Testing Permissions for Centris AI");
console.log("═══════════════════════════════════════════════════════════\n");

const appName = app.getName();
const isDev = process.env.NODE_ENV === "development";

console.log(`📱 App Name: ${appName}`);
console.log(`🔧 Mode: ${isDev ? "Development" : "Production"}`);
console.log(`🔍 Look for: ${isDev ? '"Electron"' : '"Centris AI"'} in System Settings\n`);

// Test Microphone Permission
console.log("🎤 Testing Microphone Permission...");
try {
  const electronStatus = systemPreferences.getMediaAccessStatus("microphone");
  const micGranted = electronStatus === "granted";

  console.log(`   Electron API Status: ${electronStatus}`);

  // Also check TCC database
  try {
    const tccStatus = permissions.getAuthStatus("microphone");
    console.log(`   TCC Database Status: ${tccStatus}`);
    console.log(`   ✅ Microphone: ${micGranted ? "GRANTED" : "DENIED"}`);
  } catch (e) {
    console.log(`   ✅ Microphone: ${micGranted ? "GRANTED" : "DENIED"} (TCC check failed)`);
  }

  if (!micGranted) {
    console.log(`   📍 To grant: System Settings → Privacy & Security → Microphone`);
    console.log(`   📍 Enable: ${isDev ? '"Electron"' : '"Centris AI"'}`);
  }
} catch (error) {
  console.log(`   ❌ Error: ${error.message}`);
}

console.log("");

// Test Accessibility Permission
console.log("🔐 Testing Accessibility Permission...");
return new Promise((resolve) => {
  // Method 1: TCC Database (most reliable)
  try {
    const tccStatus = permissions.getAuthStatus("accessibility");
    const accGranted = tccStatus === "authorized";

    console.log(`   TCC Database Status: ${tccStatus}`);
    console.log(`   ✅ Accessibility: ${accGranted ? "GRANTED" : "DENIED"}`);

    if (!accGranted) {
      console.log(`   📍 To grant: System Settings → Privacy & Security → Accessibility`);
      console.log(`   📍 Enable: ${isDev ? '"Electron"' : '"Centris AI"'}`);
      if (isDev) {
        console.log(`   ⚠️  In dev mode, you might also need to enable your Terminal app`);
      }
    }

    // Also test with osascript (may give false positive in dev)
    const testProcess = spawn("osascript", [
      "-e",
      'tell application "System Events" to get name of first process',
    ]);

    let errorOutput = "";
    testProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    testProcess.on("close", (code) => {
      const osascriptGranted = code === 0 && !errorOutput.includes("not allowed");
      console.log(`   osascript Test: ${osascriptGranted ? "GRANTED" : "DENIED"}`);

      if (isDev && osascriptGranted && !accGranted) {
        console.log(`   ⚠️  WARNING: osascript may inherit Terminal permissions (false positive)`);
        console.log(`   ⚠️  Trust the TCC Database status above for accurate results`);
      }

      console.log("\n═══════════════════════════════════════════════════════════");
      console.log("📋 Summary:");
      console.log("═══════════════════════════════════════════════════════════");

      const micStatus = systemPreferences.getMediaAccessStatus("microphone");
      const micOk = micStatus === "granted";
      const accOk = accGranted;

      console.log(`🎤 Microphone: ${micOk ? "✅ GRANTED" : "❌ DENIED"}`);
      console.log(`🔐 Accessibility: ${accOk ? "✅ GRANTED" : "❌ DENIED"}`);
      console.log(
        `\n${micOk && accOk ? "✅ All permissions granted! Ready to use." : "❌ Some permissions missing. Please grant them in System Settings."}`,
      );

      if (!micOk || !accOk) {
        console.log("\n💡 Quick Fix:");
        console.log("   1. Open System Settings → Privacy & Security");
        console.log(`   2. Go to ${!micOk ? "Microphone" : "Accessibility"}`);
        console.log(`   3. Enable ${isDev ? '"Electron"' : '"Centris AI"'}`);
        console.log("   4. Restart the app");
      }

      resolve();
    });

    testProcess.on("error", (err) => {
      console.log(`   ❌ osascript Error: ${err.message}`);
      resolve();
    });
  } catch (error) {
    console.log(`   ❌ TCC Check Error: ${error.message}`);
    resolve();
  }
});
