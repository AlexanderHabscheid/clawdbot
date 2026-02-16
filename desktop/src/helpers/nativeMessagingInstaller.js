/**
 * Native Messaging Host Installer
 *
 * Automatically installs the Chrome Native Messaging host when the Centris
 * desktop app starts. This enables faster communication between the Chrome
 * extension and the backend (~1-2ms vs ~5-10ms with WebSocket).
 *
 * The extension will automatically use Native Messaging if installed,
 * otherwise falls back to WebSocket (still works, slightly slower).
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// Try to import logger, fallback to console if not available
let logger;
try {
  const loggerModule = require("../utils/logger");
  logger = loggerModule.default || loggerModule;
} catch (e) {
  logger = console;
}

// Native host configuration
const NATIVE_HOST_NAME = "com.centris.host";

// Extension ID - this will be updated when the user installs the extension
// For now, use a placeholder that will be detected/updated later
// The actual ID is saved to ~/.centris/extension_id.txt by the backend
const EXTENSION_ID_PLACEHOLDER = "EXTENSION_ID_PLACEHOLDER";

/**
 * Get the saved extension ID (if available)
 * The backend saves this when the extension connects
 */
function getSavedExtensionId() {
  const homeDir = app.getPath("home");
  const extensionIdFile = path.join(homeDir, ".centris", "extension_id.txt");

  try {
    if (fs.existsSync(extensionIdFile)) {
      const extensionId = fs.readFileSync(extensionIdFile, "utf8").trim();
      if (extensionId && extensionId.length > 10) {
        logger.log("[NativeMessagingInstaller] Found saved extension ID:", extensionId);
        return extensionId;
      }
    }
  } catch (e) {
    logger.log("[NativeMessagingInstaller] No saved extension ID found");
  }

  return null;
}

/**
 * Get the Chrome Native Messaging Hosts directory for the current platform
 */
function getNativeMessagingHostsDir() {
  const homeDir = app.getPath("home");

  switch (process.platform) {
    case "darwin":
      // macOS - check both Chrome and Chromium paths
      return [
        path.join(homeDir, "Library/Application Support/Google/Chrome/NativeMessagingHosts"),
        path.join(homeDir, "Library/Application Support/Chromium/NativeMessagingHosts"),
        path.join(
          homeDir,
          "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
        ),
      ];

    case "linux":
      return [
        path.join(homeDir, ".config/google-chrome/NativeMessagingHosts"),
        path.join(homeDir, ".config/chromium/NativeMessagingHosts"),
        path.join(homeDir, ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
      ];

    case "win32":
      // Windows uses registry, handled separately
      return [];

    default:
      return [];
  }
}

/**
 * Get the path to the native host script bundled with the app
 */
function getBundledHostPath() {
  // In production, resources are in the app bundle
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "native-host", "centris_host.py");
  }
  // In development, use the extension directory
  return path.join(__dirname, "..", "..", "..", "extension", "native-host", "centris_host.py");
}

/**
 * Get the installed host path (where we copy the script to)
 */
function getInstalledHostPath() {
  switch (process.platform) {
    case "darwin":
      return "/usr/local/bin/centris_host.py";
    case "linux":
      return "/usr/local/bin/centris_host.py";
    case "win32":
      return path.join(app.getPath("userData"), "centris_host.py");
    default:
      return null;
  }
}

/**
 * Create the native messaging host manifest
 */
function createManifest(hostPath, extensionId) {
  return JSON.stringify(
    {
      name: NATIVE_HOST_NAME,
      description:
        "Centris AI Native Messaging Host - Enables fast communication between Chrome extension and desktop app",
      path: hostPath,
      type: "stdio",
      allowed_origins: [`chrome-extension://${extensionId}/`],
    },
    null,
    2,
  );
}

/**
 * Check if native host is already installed
 */
function isHostInstalled() {
  const hostPath = getInstalledHostPath();
  if (!hostPath) {
    return false;
  }

  try {
    return fs.existsSync(hostPath);
  } catch (e) {
    return false;
  }
}

/**
 * Install the native messaging host
 * @param {string} extensionId - Chrome extension ID (optional, auto-detects if not provided)
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function installNativeHost(extensionId = null) {
  // Try to get extension ID: parameter > saved file > placeholder
  let effectiveExtensionId = extensionId || getSavedExtensionId() || EXTENSION_ID_PLACEHOLDER;

  if (effectiveExtensionId === EXTENSION_ID_PLACEHOLDER) {
    logger.log(
      "[NativeMessagingInstaller] Using placeholder ID - will update when extension connects",
    );
  }

  logger.log("[NativeMessagingInstaller] Starting native host installation...");
  logger.log("[NativeMessagingInstaller] Platform:", process.platform);
  logger.log("[NativeMessagingInstaller] Extension ID:", effectiveExtensionId);

  try {
    const bundledPath = getBundledHostPath();
    const installedPath = getInstalledHostPath();
    const hostDirs = getNativeMessagingHostsDir();

    logger.log("[NativeMessagingInstaller] Bundled host path:", bundledPath);
    logger.log("[NativeMessagingInstaller] Install path:", installedPath);

    // Check if bundled host exists
    if (!fs.existsSync(bundledPath)) {
      logger.warn("[NativeMessagingInstaller] Bundled host not found at:", bundledPath);
      return {
        success: false,
        message: "Native host not bundled with app - extension will use WebSocket fallback",
      };
    }

    // Platform-specific installation
    if (process.platform === "win32") {
      return await installWindowsHost(bundledPath, installedPath, effectiveExtensionId);
    } else {
      return await installUnixHost(bundledPath, installedPath, hostDirs, effectiveExtensionId);
    }
  } catch (error) {
    logger.error("[NativeMessagingInstaller] Installation failed:", error);
    return {
      success: false,
      message: `Installation failed: ${error.message}. Extension will use WebSocket fallback.`,
    };
  }
}

/**
 * Verify Python3 is available (for host script execution)
 */
function verifyPython3() {
  return new Promise((resolve) => {
    // Try to find python3
    exec("which python3", (error) => {
      if (error) {
        logger.warn("[NativeMessagingInstaller] python3 not found in PATH - host script may fail");
        logger.warn("[NativeMessagingInstaller] Users may need to install Python 3");
        resolve(false);
      } else {
        logger.log("[NativeMessagingInstaller] ✓ Python3 found in PATH");
        resolve(true);
      }
    });
  });
}

/**
 * Install on macOS/Linux
 */
async function installUnixHost(bundledPath, installedPath, hostDirs, extensionId) {
  return new Promise(async (resolve) => {
    try {
      // Verify Python3 is available (non-blocking warning)
      await verifyPython3();

      // Try to install to /usr/local/bin first (preferred location)
      let finalInstalledPath = installedPath;
      let installSuccess = false;

      // Create install directory if needed
      const installDir = path.dirname(installedPath);

      // Try to copy to /usr/local/bin first
      try {
        // Check if directory exists and is writable
        if (!fs.existsSync(installDir)) {
          // Try to create it (may require sudo, but we'll try)
          try {
            fs.mkdirSync(installDir, { recursive: true });
          } catch (mkdirError) {
            logger.log(
              "[NativeMessagingInstaller] Cannot create /usr/local/bin, will use user directory",
            );
            throw new Error("EACCES", { cause: mkdirError }); // Trigger fallback
          }
        }

        // Try to copy (may require sudo)
        fs.copyFileSync(bundledPath, installedPath);
        fs.chmodSync(installedPath, 0o755); // Make executable (octal notation)
        logger.log("[NativeMessagingInstaller] ✓ Host script installed to:", installedPath);
        installSuccess = true;
      } catch (copyError) {
        // If we can't write to /usr/local/bin, use user directory
        if (copyError.code === "EACCES" || copyError.message === "EACCES") {
          logger.log("[NativeMessagingInstaller] Cannot write to /usr/local/bin (requires sudo)");
          logger.log("[NativeMessagingInstaller] Using user directory instead...");

          // Use user-writable location
          const userDataDir = app.getPath("userData");
          const userPath = path.join(userDataDir, "centris_host.py");

          try {
            fs.copyFileSync(bundledPath, userPath);
            fs.chmodSync(userPath, 0o755);
            finalInstalledPath = userPath;
            logger.log(
              "[NativeMessagingInstaller] ✓ Host script installed to user directory:",
              finalInstalledPath,
            );
            installSuccess = true;
          } catch (userCopyError) {
            logger.error(
              "[NativeMessagingInstaller] Failed to copy to user directory:",
              userCopyError,
            );
            throw userCopyError;
          }
        } else {
          throw copyError;
        }
      }

      if (!installSuccess) {
        throw new Error("Failed to install host script");
      }

      // Create manifest in all browser directories (use finalInstalledPath)
      const manifest = createManifest(finalInstalledPath, extensionId);
      let manifestsInstalled = 0;

      for (const hostDir of hostDirs) {
        try {
          // Create directory if it doesn't exist
          if (!fs.existsSync(hostDir)) {
            fs.mkdirSync(hostDir, { recursive: true });
          }

          const manifestPath = path.join(hostDir, `${NATIVE_HOST_NAME}.json`);
          fs.writeFileSync(manifestPath, manifest);
          logger.log("[NativeMessagingInstaller] Manifest installed:", manifestPath);
          manifestsInstalled++;
        } catch (dirError) {
          // Skip if we can't write to this directory (browser not installed)
          logger.log("[NativeMessagingInstaller] Skipping directory (not writable):", hostDir);
        }
      }

      if (manifestsInstalled > 0) {
        logger.log("[NativeMessagingInstaller] ✅ Native host installed successfully");
        logger.log("[NativeMessagingInstaller] Manifests installed:", manifestsInstalled);
        logger.log("[NativeMessagingInstaller] Host script path:", finalInstalledPath);

        // Verify installation
        const verification = verifyInstallation(finalInstalledPath, hostDirs);
        if (!verification.hostExists) {
          logger.warn(
            "[NativeMessagingInstaller] ⚠️ Verification failed: Host script not found at expected path",
          );
        }
        if (verification.manifestsFound < manifestsInstalled) {
          logger.warn(
            "[NativeMessagingInstaller] ⚠️ Verification: Some manifests may not be readable",
          );
        }

        resolve({
          success: true,
          message: `Native Messaging host installed (${manifestsInstalled} browser(s))`,
          hostPath: finalInstalledPath,
          verification,
        });
      } else {
        logger.warn(
          "[NativeMessagingInstaller] No manifests installed - no supported browsers found",
        );
        resolve({
          success: false,
          message: "No supported browsers found - extension will use WebSocket fallback",
        });
      }
    } catch (error) {
      logger.error("[NativeMessagingInstaller] Unix installation error:", error);
      resolve({
        success: false,
        message: `Installation error: ${error.message}`,
      });
    }
  });
}

/**
 * Install on Windows (uses registry)
 */
async function installWindowsHost(bundledPath, installedPath, extensionId) {
  return new Promise((resolve) => {
    try {
      // Create install directory
      const installDir = path.dirname(installedPath);
      if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir, { recursive: true });
      }

      // Copy host script
      fs.copyFileSync(bundledPath, installedPath);
      logger.log("[NativeMessagingInstaller] Host script copied to:", installedPath);

      // Create manifest
      const manifestPath = path.join(installDir, `${NATIVE_HOST_NAME}.json`);
      const manifest = createManifest(installedPath, extensionId);
      fs.writeFileSync(manifestPath, manifest);
      logger.log("[NativeMessagingInstaller] Manifest created:", manifestPath);

      // Register with Windows registry for all browsers
      const browsers = [
        "Google\\Chrome",
        "Chromium",
        "Microsoft\\Edge",
        "BraveSoftware\\Brave-Browser",
      ];

      let registrySuccess = 0;
      const regCommands = browsers.map(
        (browser) =>
          `reg add "HKCU\\Software\\${browser}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}" /ve /t REG_SZ /d "${manifestPath}" /f`,
      );

      // Execute registry commands
      const executeNext = (index) => {
        if (index >= regCommands.length) {
          if (registrySuccess > 0) {
            logger.log("[NativeMessagingInstaller] ✅ Native host installed successfully");
            resolve({
              success: true,
              message: `Native Messaging host installed (${registrySuccess} browser(s))`,
            });
          } else {
            resolve({
              success: false,
              message: "Failed to register with any browser",
            });
          }
          return;
        }

        exec(regCommands[index], (error) => {
          if (!error) {
            registrySuccess++;
            logger.log("[NativeMessagingInstaller] Registry key added for:", browsers[index]);
          }
          executeNext(index + 1);
        });
      };

      executeNext(0);
    } catch (error) {
      logger.error("[NativeMessagingInstaller] Windows installation error:", error);
      resolve({
        success: false,
        message: `Installation error: ${error.message}`,
      });
    }
  });
}

/**
 * Verify installation by checking if files exist and are accessible
 */
function verifyInstallation(hostPath, hostDirs) {
  const result = {
    hostExists: false,
    hostExecutable: false,
    manifestsFound: 0,
    manifestPaths: [],
  };

  // Check host script
  try {
    if (fs.existsSync(hostPath)) {
      result.hostExists = true;
      const stats = fs.statSync(hostPath);
      result.hostExecutable = !!(stats.mode & parseInt("111", 8)); // Check if executable
    }
  } catch (e) {
    logger.warn("[NativeMessagingInstaller] Verification: Cannot check host script:", e.message);
  }

  // Check manifests
  for (const hostDir of hostDirs) {
    const manifestPath = path.join(hostDir, `${NATIVE_HOST_NAME}.json`);
    try {
      if (fs.existsSync(manifestPath)) {
        result.manifestsFound++;
        result.manifestPaths.push(manifestPath);
      }
    } catch (e) {
      // Skip
    }
  }

  return result;
}

/**
 * Get the actual installed host path (may differ from getInstalledHostPath if fallback was used)
 */
function getActualInstalledHostPath() {
  const preferredPath = getInstalledHostPath();

  // Check if preferred path exists
  if (preferredPath && fs.existsSync(preferredPath)) {
    return preferredPath;
  }

  // Check user data directory (fallback location)
  const userPath = path.join(app.getPath("userData"), "centris_host.py");
  if (fs.existsSync(userPath)) {
    return userPath;
  }

  return preferredPath; // Return preferred even if it doesn't exist yet
}

/**
 * Update the extension ID in installed manifests
 * Called when we detect the actual extension ID
 */
async function updateExtensionId(newExtensionId) {
  if (!newExtensionId || newExtensionId === EXTENSION_ID_PLACEHOLDER) {
    return { success: false, message: "Invalid extension ID" };
  }

  logger.log("[NativeMessagingInstaller] Updating extension ID to:", newExtensionId);

  const hostDirs = getNativeMessagingHostsDir();
  // Use actual installed path (may be in userData if /usr/local/bin wasn't writable)
  const installedPath = getActualInstalledHostPath();
  let updated = 0;

  for (const hostDir of hostDirs) {
    const manifestPath = path.join(hostDir, `${NATIVE_HOST_NAME}.json`);
    try {
      if (fs.existsSync(manifestPath)) {
        // Read existing manifest to get the correct path (in case it was installed to userData)
        let actualPath = installedPath;
        try {
          const existingManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          if (existingManifest.path && fs.existsSync(existingManifest.path)) {
            actualPath = existingManifest.path;
          }
        } catch (e) {
          // Use default path if we can't read existing manifest
        }

        const manifest = createManifest(actualPath, newExtensionId);
        fs.writeFileSync(manifestPath, manifest);
        updated++;
        logger.log("[NativeMessagingInstaller] Updated manifest:", manifestPath);
      }
    } catch (e) {
      logger.warn("[NativeMessagingInstaller] Failed to update manifest:", manifestPath, e.message);
    }
  }

  return {
    success: updated > 0,
    message: `Updated ${updated} manifest(s) with extension ID`,
  };
}

/**
 * Get installation status
 */
function getInstallationStatus() {
  const hostInstalled = isHostInstalled();
  const hostDirs = getNativeMessagingHostsDir();
  let manifestsFound = 0;

  for (const hostDir of hostDirs) {
    const manifestPath = path.join(hostDir, `${NATIVE_HOST_NAME}.json`);
    if (fs.existsSync(manifestPath)) {
      manifestsFound++;
    }
  }

  return {
    hostInstalled,
    manifestsFound,
    platform: process.platform,
    isPackaged: app.isPackaged,
  };
}

/**
 * Check for saved extension ID and update manifests if found
 * Call this periodically (e.g., every 30 seconds) to auto-update
 * when the extension first connects
 */
async function checkAndUpdateExtensionId() {
  const savedId = getSavedExtensionId();

  if (savedId && savedId !== EXTENSION_ID_PLACEHOLDER) {
    const status = getInstallationStatus();

    // Check if manifests exist but might have placeholder
    if (status.hostInstalled && status.manifestsFound > 0) {
      // Update manifests with the real extension ID
      const result = await updateExtensionId(savedId);
      if (result.success) {
        logger.log("[NativeMessagingInstaller] ✅ Manifests updated with real extension ID");
        return { updated: true, extensionId: savedId };
      }
    }
  }

  return { updated: false, extensionId: savedId };
}

/**
 * Start background monitoring for extension ID
 * Checks every 30 seconds for a saved extension ID and updates manifests
 */
function startExtensionIdMonitor(intervalMs = 30000) {
  logger.log("[NativeMessagingInstaller] Starting extension ID monitor");

  // Check immediately
  checkAndUpdateExtensionId();

  // Then check periodically
  const intervalId = setInterval(async () => {
    const result = await checkAndUpdateExtensionId();
    if (result.updated) {
      // Stop monitoring once we've updated
      clearInterval(intervalId);
      logger.log("[NativeMessagingInstaller] Extension ID monitor stopped (ID captured)");
    }
  }, intervalMs);

  return intervalId;
}

module.exports = {
  installNativeHost,
  updateExtensionId,
  isHostInstalled,
  getInstallationStatus,
  getSavedExtensionId,
  checkAndUpdateExtensionId,
  startExtensionIdMonitor,
  NATIVE_HOST_NAME,
  EXTENSION_ID_PLACEHOLDER,
};
