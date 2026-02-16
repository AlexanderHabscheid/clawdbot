#!/usr/bin/env node

/**
 * Script to clear onboarding status from localStorage and electron-store
 * Run this to reset onboarding: node scripts/clear-onboarding.js
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// Get the electron-store config path
function getElectronStorePath() {
  const platform = process.platform;
  const appName = "Centris AI";

  let configPath;

  if (platform === "darwin") {
    configPath = path.join(os.homedir(), "Library", "Application Support", appName, "config.json");
  } else if (platform === "win32") {
    configPath = path.join(os.homedir(), "AppData", "Roaming", appName, "config.json");
  } else {
    configPath = path.join(os.homedir(), ".config", appName, "config.json");
  }

  return configPath;
}

function clearOnboarding() {
  console.log("🧹 Clearing onboarding status...\n");

  const configPath = getElectronStorePath();

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      delete config.onboarding_completed;
      delete config.onboardingCompleted;
      delete config.dictationKey;
      delete config.dictation_key;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ Cleared onboarding from electron-store: ${configPath}`);
    } else {
      console.log(`ℹ️  Electron-store config not found at: ${configPath}`);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log(`ℹ️  Config directory doesn't exist yet`);
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
  }

  console.log("\n📋 To complete the reset:");
  console.log("   1. Open Centris AI app");
  console.log("   2. Open DevTools (Cmd+Option+I)");
  console.log("   3. Run in Console:");
  console.log('      localStorage.removeItem("onboarding_completed");');
  console.log('      localStorage.removeItem("dictationKey");');
  console.log("      location.reload();");
  console.log("\n✨ Or simply restart the app!");
}

clearOnboarding();
