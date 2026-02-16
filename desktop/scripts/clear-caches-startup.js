#!/usr/bin/env node

/**
 * Startup cache clearing script
 * Clears all caches before starting dev server
 * Run automatically via npm run dev
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

console.log("🧹 Clearing all caches before startup...\n");

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
const cacheDirs = [
  path.join(appDataPath, "Cache"),
  path.join(appDataPath, "Code Cache"),
  path.join(appDataPath, "GPUCache"),
  path.join(appDataPath, "ShaderCache"),
];

// System cache (macOS)
if (process.platform === "darwin") {
  cacheDirs.push(path.join(os.homedir(), "Library", "Caches", "Centris AI"));
}

// Clear Electron cache directories
let clearedCount = 0;
cacheDirs.forEach((cacheDir) => {
  if (fs.existsSync(cacheDir)) {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      console.log(`✅ Cleared ${path.basename(cacheDir)}`);
      clearedCount++;
    } catch (error) {
      console.warn(`⚠️  Could not clear ${cacheDir}:`, error.message);
    }
  }
});

// Clear Vite cache (including optimized dependencies)
const viteCacheDirs = [
  path.join(__dirname, "..", "src", ".vite"),
  path.join(__dirname, "..", "src", "dist"),
  path.join(__dirname, "..", "node_modules", ".vite"),
  // Also clear any Vite cache in the root
  path.join(__dirname, "..", ".vite"),
];

viteCacheDirs.forEach((cacheDir) => {
  if (fs.existsSync(cacheDir)) {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      console.log(`✅ Cleared ${path.relative(__dirname + "/..", cacheDir)}`);
      clearedCount++;
    } catch (error) {
      // Ignore errors for Vite cache
    }
  }
});

// Force clear Vite's optimized dependencies by removing the entire .vite folder
// This fixes "504 Outdated Optimize Dep" errors
const viteOptimizedDeps = path.join(__dirname, "..", "node_modules", ".vite");
if (fs.existsSync(viteOptimizedDeps)) {
  try {
    // Remove all contents but keep the directory structure
    const contents = fs.readdirSync(viteOptimizedDeps);
    contents.forEach((item) => {
      const itemPath = path.join(viteOptimizedDeps, item);
      try {
        fs.rmSync(itemPath, { recursive: true, force: true });
      } catch (e) {
        // Ignore individual item errors
      }
    });
  } catch (error) {
    // If that fails, try removing the whole directory
    try {
      fs.rmSync(viteOptimizedDeps, { recursive: true, force: true });
    } catch (e) {
      // Ignore
    }
  }
}

if (clearedCount > 0) {
  console.log(`\n✅ Cleared ${clearedCount} cache directory(ies)`);
} else {
  console.log("\nℹ️  No cache directories found (fresh start)");
}

console.log("🚀 Starting dev server...\n");
