#!/usr/bin/env node

/**
 * Comprehensive Vite and Electron Cache Clearing Script
 * Clears all Vite build caches and Electron runtime caches
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

console.log("🧹 Clearing all Vite and Electron caches...\n");

const projectRoot = path.join(__dirname, "..");
let clearedCount = 0;
let totalSize = 0;

// Helper to get directory size
function getDirSize(dirPath) {
  let size = 0;
  try {
    if (fs.existsSync(dirPath)) {
      const stats = fs.statSync(dirPath);
      if (stats.isDirectory()) {
        const files = fs.readdirSync(dirPath);
        files.forEach((file) => {
          const filePath = path.join(dirPath, file);
          try {
            const fileStats = fs.statSync(filePath);
            if (fileStats.isDirectory()) {
              size += getDirSize(filePath);
            } else {
              size += fileStats.size;
            }
          } catch (e) {
            // Ignore errors
          }
        });
      } else {
        size = stats.size;
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return size;
}

// Helper to clear directory
function clearDir(dirPath, label) {
  if (fs.existsSync(dirPath)) {
    try {
      const size = getDirSize(dirPath);
      fs.rmSync(dirPath, { recursive: true, force: true });
      const sizeMB = (size / 1024 / 1024).toFixed(2);
      console.log(`✅ Cleared ${label} (${sizeMB} MB)`);
      clearedCount++;
      totalSize += size;
      return true;
    } catch (error) {
      console.warn(`⚠️  Could not clear ${label}:`, error.message);
      return false;
    }
  }
  return false;
}

// ============================================
// 1. VITE CACHES
// ============================================
console.log("📦 Clearing Vite caches...");

// Vite cache in node_modules
clearDir(path.join(projectRoot, "node_modules", ".vite"), "Vite cache (node_modules/.vite)");

// Vite cache in src (if exists)
clearDir(path.join(projectRoot, "src", ".vite"), "Vite cache (src/.vite)");

// Vite dist/build output
clearDir(path.join(projectRoot, "src", "dist"), "Vite dist (src/dist)");
clearDir(path.join(projectRoot, "dist"), "Vite dist (dist)");

// Vite cache in .vite (root level, if exists)
clearDir(path.join(projectRoot, ".vite"), "Vite cache (.vite)");

// ============================================
// 2. ELECTRON CACHES
// ============================================
console.log("\n⚡ Clearing Electron caches...");

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

// Electron cache directories
const electronCacheDirs = [
  { path: path.join(appDataPath, "Cache"), label: "Electron Cache" },
  { path: path.join(appDataPath, "Code Cache"), label: "Electron Code Cache" },
  { path: path.join(appDataPath, "GPUCache"), label: "Electron GPU Cache" },
  { path: path.join(appDataPath, "ShaderCache"), label: "Electron Shader Cache" },
  { path: path.join(appDataPath, "IndexedDB"), label: "Electron IndexedDB" },
  { path: path.join(appDataPath, "Local Storage"), label: "Electron Local Storage" },
  { path: path.join(appDataPath, "Session Storage"), label: "Electron Session Storage" },
];

electronCacheDirs.forEach(({ path: cachePath, label }) => {
  clearDir(cachePath, label);
});

// System cache (macOS)
if (process.platform === "darwin") {
  clearDir(path.join(os.homedir(), "Library", "Caches", "Centris AI"), "System Cache (macOS)");

  // Also clear Electron's system cache
  clearDir(
    path.join(os.homedir(), "Library", "Caches", "com.centris.app"),
    "Electron System Cache",
  );
}

// Windows Electron cache
if (process.platform === "win32") {
  clearDir(
    path.join(os.homedir(), "AppData", "Local", "Centris AI", "Cache"),
    "Windows Electron Cache",
  );
}

// Linux Electron cache
if (process.platform === "linux") {
  clearDir(path.join(os.homedir(), ".cache", "Centris AI"), "Linux Electron Cache");
}

// ============================================
// 3. BUILD ARTIFACTS
// ============================================
console.log("\n🔨 Clearing build artifacts...");

clearDir(path.join(projectRoot, "build"), "Build artifacts (build)");
clearDir(path.join(projectRoot, "out"), "Build output (out)");
clearDir(path.join(projectRoot, ".next"), "Next.js build (.next)");

// ============================================
// 4. SUMMARY
// ============================================
console.log("\n" + "=".repeat(50));
if (clearedCount > 0) {
  const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
  console.log(`✅ Cleared ${clearedCount} cache directory(ies)`);
  console.log(`💾 Freed ${totalSizeMB} MB of disk space`);
} else {
  console.log("ℹ️  No cache directories found (already clean)");
}
console.log("=".repeat(50));
console.log("\n🚀 Caches cleared! Restart your dev server: npm run dev\n");
