#!/usr/bin/env node

/**
 * Complete onboarding reset script for Electron
 * Clears all onboarding data from:
 * - electron-store (main process)
 * - localStorage files (renderer process)
 * - Config files
 *
 * Usage: node scripts/clear-onboarding-complete.js
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// Get app data directory based on OS
function getAppDataPath() {
  const appName = "Centris AI";

  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", appName);
    case "win32":
      return path.join(os.homedir(), "AppData", "Roaming", appName);
    case "linux":
      return path.join(os.homedir(), ".config", appName);
    default:
      return path.join(os.homedir(), ".config", appName);
  }
}

const appDataPath = getAppDataPath();
const configPath = path.join(appDataPath, "config.json");
const localStoragePath = path.join(appDataPath, "Local Storage");

console.log("🧹 Clearing all onboarding data...\n");
console.log(`📁 App data directory: ${appDataPath}\n`);

// 1. Clear electron-store config.json
if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const hadOnboarding = config.hasCompletedOnboarding !== undefined;

    delete config.hasCompletedOnboarding;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    if (hadOnboarding) {
      console.log("✅ Cleared hasCompletedOnboarding from electron-store");
    } else {
      console.log("ℹ️  No onboarding data found in electron-store");
    }
  } catch (error) {
    console.error("❌ Error clearing electron-store:", error.message);
  }
} else {
  console.log("ℹ️  Config file not found (app may not have run yet)");
}

// 2. Clear localStorage files
if (fs.existsSync(localStoragePath)) {
  try {
    const files = fs.readdirSync(localStoragePath);
    let clearedCount = 0;

    files.forEach((file) => {
      const filePath = path.join(localStoragePath, file);
      try {
        fs.unlinkSync(filePath);
        clearedCount++;
      } catch (error) {
        console.warn(`⚠️  Could not delete ${file}:`, error.message);
      }
    });

    if (clearedCount > 0) {
      console.log(`✅ Cleared ${clearedCount} localStorage file(s)`);
    } else {
      console.log("ℹ️  No localStorage files to clear");
    }
  } catch (error) {
    console.error("❌ Error clearing localStorage:", error.message);
  }
} else {
  console.log("ℹ️  LocalStorage directory not found (app may not have run yet)");
}

// 3. Clear any other onboarding-related files
const otherPaths = [
  path.join(appDataPath, "onboarding.json"),
  path.join(appDataPath, "onboarding-state.json"),
];

otherPaths.forEach((filePath) => {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`✅ Removed ${path.basename(filePath)}`);
    } catch (error) {
      console.warn(`⚠️  Could not remove ${filePath}:`, error.message);
    }
  }
});

console.log("\n✅ Onboarding reset complete!");
console.log("🔄 Restart the app to see the onboarding screen again.\n");
