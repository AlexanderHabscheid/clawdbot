const fs = require("fs");
const path = require("path");
const os = require("os");
const { app } = require("electron");
// Handle ES module interop - logger might be exported as { default: Logger }
const loggerModule = require("./utils/logger");
const logger = loggerModule.default || loggerModule;

class AppUtils {
  static cleanup(mainWindow) {
    logger.log("Starting cleanup process...");

    // Database file deletion
    try {
      const dbPath = path.join(
        app.getPath("userData"),
        process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db",
      );
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        logger.log("✅ Database file deleted:", dbPath);
      }
    } catch (error) {
      logger.error("❌ Error deleting database file:", error);
    }

    // Local storage clearing
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents
        .executeJavaScript("localStorage.clear()")
        .then(() => {
          logger.log("✅ Local storage cleared");
        })
        .catch((error) => {
          logger.error("❌ Error clearing local storage:", error);
        });
    }

    // Local Whisper model deletion
    try {
      const modelCacheDir = path.join(os.homedir(), ".cache", "whisper");
      if (fs.existsSync(modelCacheDir)) {
        fs.rmSync(modelCacheDir, { recursive: true, force: true });
        logger.log("✅ Local Whisper models deleted:", modelCacheDir);
      }
    } catch (error) {
      logger.error("❌ Error deleting Whisper models:", error);
    }

    // Permissions instruction
    logger.log(
      "ℹ️ Please manually remove accessibility and microphone permissions via System Preferences if needed.",
    );

    // Env file deletion
    try {
      const envPath = path.join(app.getPath("userData"), ".env");
      if (fs.existsSync(envPath)) {
        fs.unlinkSync(envPath);
        logger.log("✅ .env file deleted:", envPath);
      }
    } catch (error) {
      logger.error("❌ Error deleting .env file:", error);
    }

    logger.log("Cleanup process completed.");
  }
}

module.exports = AppUtils;
