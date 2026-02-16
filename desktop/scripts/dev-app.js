#!/usr/bin/env node
/**
 * Development App Runner for Centris AI
 *
 * This script builds and runs the actual .app bundle so that Centris AI
 * has its own permissions identity in macOS (not inherited from Terminal/Cursor).
 *
 * Usage:
 *   npm run dev:app           - Build and run the app
 *   npm run dev:app:watch     - Build, run, and watch for changes
 *
 * Why this exists:
 *   When running `npm run dev` (electron .), permissions are inherited from
 *   the terminal/IDE that launched it (e.g., "Cursor", "Terminal").
 *
 *   By building and running the .app bundle directly, Centris AI gets its
 *   own entry in System Settings > Privacy & Security, allowing proper
 *   permission management.
 */

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT_DIR = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const APP_NAME = "Centris AI";

// Determine the correct architecture path
const arch = os.arch() === "arm64" ? "mac-arm64" : "mac";
const APP_PATH = path.join(DIST_DIR, arch, `${APP_NAME}.app`);
const ALT_APP_PATH = path.join(DIST_DIR, "mac", `${APP_NAME}.app`);

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  console.log(`${colors.cyan}[${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`${colors.green}✅ ${message}${colors.reset}`);
}

function logError(message) {
  console.log(`${colors.red}❌ ${message}${colors.reset}`);
}

function logWarning(message) {
  console.log(`${colors.yellow}⚠️  ${message}${colors.reset}`);
}

/**
 * Build the renderer (Vite)
 */
async function buildRenderer() {
  logStep("1/3", "Building renderer with Vite...");

  return new Promise((resolve, reject) => {
    const buildProcess = spawn("npm", ["run", "build:renderer"], {
      cwd: ROOT_DIR,
      stdio: "inherit",
      shell: true,
    });

    buildProcess.on("close", (code) => {
      if (code === 0) {
        logSuccess("Renderer built successfully");
        resolve();
      } else {
        reject(new Error(`Renderer build failed with code ${code}`));
      }
    });

    buildProcess.on("error", reject);
  });
}

/**
 * Build the Electron app (directory only, no DMG)
 */
async function buildApp() {
  logStep("2/3", "Building Electron app (.app bundle only)...");

  return new Promise((resolve, reject) => {
    // Use --dir to only create the .app bundle (much faster than DMG)
    // Use --config.mac.identity=null to skip code signing in dev
    const buildProcess = spawn(
      "npx",
      ["electron-builder", "--dir", "--config.mac.identity=null", "--config.mac.target=dir"],
      {
        cwd: ROOT_DIR,
        stdio: "inherit",
        shell: true,
        env: {
          ...process.env,
          NODE_ENV: "development",
          CSC_IDENTITY_AUTO_DISCOVERY: "false", // Disable auto code signing
        },
      },
    );

    buildProcess.on("close", (code) => {
      if (code === 0) {
        logSuccess("App bundle built successfully");
        resolve();
      } else {
        reject(new Error(`App build failed with code ${code}`));
      }
    });

    buildProcess.on("error", reject);
  });
}

/**
 * Find the built .app
 */
function findAppPath() {
  if (fs.existsSync(APP_PATH)) {
    return APP_PATH;
  }
  if (fs.existsSync(ALT_APP_PATH)) {
    return ALT_APP_PATH;
  }

  // Try to find any .app in dist
  const distContents = fs.readdirSync(DIST_DIR).filter((f) => f.startsWith("mac"));
  for (const dir of distContents) {
    const possiblePath = path.join(DIST_DIR, dir, `${APP_NAME}.app`);
    if (fs.existsSync(possiblePath)) {
      return possiblePath;
    }
  }

  return null;
}

/**
 * Run the built app
 */
async function runApp() {
  logStep("3/3", "Launching Centris AI...");

  const appPath = findAppPath();

  if (!appPath) {
    throw new Error(`Could not find ${APP_NAME}.app in ${DIST_DIR}`);
  }

  log(`\n📍 App location: ${appPath}`, "dim");
  log(`\n🔐 IMPORTANT: Permissions will now appear as "${APP_NAME}" in System Settings!`, "green");
  log(`   Go to: System Settings > Privacy & Security > Microphone/Accessibility`, "dim");
  log(`   Look for: "${APP_NAME}" (not Terminal or Cursor)\n`, "dim");

  return new Promise((resolve, reject) => {
    // Use 'open' command to launch the app properly
    const openProcess = spawn("open", ["-a", appPath, "--args", "--dev"], {
      cwd: ROOT_DIR,
      stdio: "inherit",
      detached: true,
    });

    openProcess.on("close", (code) => {
      if (code === 0) {
        logSuccess(`${APP_NAME} launched!`);
        log(`\n💡 The app is now running with its own permissions identity.`, "cyan");
        log(`   To grant permissions:`, "dim");
        log(`   1. Open System Settings > Privacy & Security`, "dim");
        log(`   2. Go to Microphone and enable "${APP_NAME}"`, "dim");
        log(`   3. Go to Accessibility and enable "${APP_NAME}"`, "dim");
        resolve();
      } else {
        reject(new Error(`Failed to launch app with code ${code}`));
      }
    });

    openProcess.on("error", reject);

    // Detach the process so the script can exit
    openProcess.unref();
  });
}

/**
 * Kill any existing Centris AI processes
 */
function killExistingApp() {
  try {
    execSync(`pkill -f "${APP_NAME}" 2>/dev/null || true`, { stdio: "ignore" });
  } catch (e) {
    // Ignore errors - app might not be running
  }
}

/**
 * Main execution
 */
async function main() {
  console.log("\n");
  log("═══════════════════════════════════════════════════════════════", "cyan");
  log("  Centris AI - Development App Builder", "bright");
  log("  Building .app bundle for proper macOS permissions", "dim");
  log("═══════════════════════════════════════════════════════════════", "cyan");
  console.log("\n");

  const startTime = Date.now();

  try {
    // Kill any existing app instances
    killExistingApp();

    // Build renderer
    await buildRenderer();

    // Build app
    await buildApp();

    // Run app
    await runApp();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\n⏱️  Total time: ${elapsed}s`, "dim");

    // Watch mode check
    if (process.argv.includes("--watch")) {
      log("\n👀 Watch mode enabled - rebuilding on changes...", "yellow");
      startWatcher();
    } else {
      log('\n💡 Tip: Use "npm run dev:app:watch" to auto-rebuild on changes', "dim");
      process.exit(0);
    }
  } catch (error) {
    logError(`Build failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * File watcher for auto-rebuild
 */
function startWatcher() {
  const chokidar = require("chokidar");

  const watchPaths = [
    path.join(ROOT_DIR, "main.js"),
    path.join(ROOT_DIR, "preload.js"),
    path.join(ROOT_DIR, "src"),
  ];

  let rebuildTimeout = null;
  let isRebuilding = false;

  const watcher = chokidar.watch(watchPaths, {
    ignored: [/node_modules/, /dist/, /\.git/, /\.DS_Store/],
    persistent: true,
    ignoreInitial: true,
  });

  const rebuild = async () => {
    if (isRebuilding) {
      return;
    }
    isRebuilding = true;

    log("\n🔄 Changes detected - rebuilding...", "yellow");

    try {
      killExistingApp();
      await buildRenderer();
      await buildApp();
      await runApp();
      logSuccess("Rebuild complete!");
    } catch (error) {
      logError(`Rebuild failed: ${error.message}`);
    } finally {
      isRebuilding = false;
    }
  };

  watcher.on("change", (filePath) => {
    log(`📝 Changed: ${path.relative(ROOT_DIR, filePath)}`, "dim");

    // Debounce rebuilds
    if (rebuildTimeout) {
      clearTimeout(rebuildTimeout);
    }
    rebuildTimeout = setTimeout(rebuild, 500);
  });

  watcher.on("add", (filePath) => {
    log(`➕ Added: ${path.relative(ROOT_DIR, filePath)}`, "dim");

    if (rebuildTimeout) {
      clearTimeout(rebuildTimeout);
    }
    rebuildTimeout = setTimeout(rebuild, 500);
  });

  log("Watching for changes in:", "dim");
  watchPaths.forEach((p) => log(`  - ${path.relative(ROOT_DIR, p)}`, "dim"));
  log("\nPress Ctrl+C to stop.\n", "dim");
}

// Run
main();
