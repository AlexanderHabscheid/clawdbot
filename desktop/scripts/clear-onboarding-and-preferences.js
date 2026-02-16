#!/usr/bin/env node

/**
 * Clear onboarding and preferences to reset the app to initial state
 * This allows users to go through onboarding and preferences setup again
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// Get electron-store path
function getElectronStorePath() {
  const platform = process.platform;
  let appDataPath;

  if (platform === "darwin") {
    appDataPath = path.join(os.homedir(), "Library", "Application Support", "Centris AI");
  } else if (platform === "win32") {
    appDataPath = path.join(os.homedir(), "AppData", "Roaming", "Centris AI");
  } else {
    appDataPath = path.join(os.homedir(), ".config", "Centris AI");
  }

  return path.join(appDataPath, "config.json");
}

// Clear electron-store
function clearElectronStore() {
  try {
    const storePath = getElectronStorePath();
    if (fs.existsSync(storePath)) {
      const store = JSON.parse(fs.readFileSync(storePath, "utf8"));

      // Remove onboarding and preferences flags
      delete store.hasCompletedOnboarding;

      // Write back
      fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
      console.log("✅ Cleared electron-store onboarding flag");
      return true;
    } else {
      console.log("ℹ️  Electron-store file not found (this is OK if app hasn't been run yet)");
      return false;
    }
  } catch (error) {
    console.error("❌ Error clearing electron-store:", error.message);
    return false;
  }
}

// Clear Electron cache directories
function clearElectronCaches() {
  const platform = process.platform;
  let appDataPath;

  if (platform === "darwin") {
    appDataPath = path.join(os.homedir(), "Library", "Application Support", "Centris AI");
  } else if (platform === "win32") {
    appDataPath = path.join(os.homedir(), "AppData", "Roaming", "Centris AI");
  } else {
    appDataPath = path.join(os.homedir(), ".config", "Centris AI");
  }

  const cacheDirs = ["Cache", "Code Cache", "GPUCache", "ShaderCache"];
  let cleared = 0;

  cacheDirs.forEach((dir) => {
    const cachePath = path.join(appDataPath, dir);
    try {
      if (fs.existsSync(cachePath)) {
        fs.rmSync(cachePath, { recursive: true, force: true });
        console.log(`✅ Cleared ${dir}`);
        cleared++;
      }
    } catch (error) {
      console.error(`❌ Error clearing ${dir}:`, error.message);
    }
  });

  // Also clear system cache on macOS
  if (platform === "darwin") {
    const systemCachePath = path.join(os.homedir(), "Library", "Caches", "Centris AI");
    try {
      if (fs.existsSync(systemCachePath)) {
        fs.rmSync(systemCachePath, { recursive: true, force: true });
        console.log("✅ Cleared system cache");
        cleared++;
      }
    } catch (error) {
      console.error("❌ Error clearing system cache:", error.message);
    }
  }

  return cleared;
}

// Main execution
console.log("🧹 Clearing onboarding and preferences...\n");

const storeCleared = clearElectronStore();
const cachesCleared = clearElectronCaches();

console.log("\n📊 Summary:");
console.log(`   Electron-store: ${storeCleared ? "✅ Cleared" : "ℹ️  Not found"}`);
console.log(`   Cache directories: ${cachesCleared} cleared`);

console.log("\n✅ Done! Next time you run the app, you'll see:");
console.log("   1. Onboarding screen");
console.log("   2. Preferences screen");
console.log("   3. Then the pill UI");

console.log("\n💡 Note: localStorage will be cleared when the app starts");
console.log("   (the app clears localStorage on startup in development mode)");
