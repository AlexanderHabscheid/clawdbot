// Handle ES module interop - logger might be exported as { default: Logger }
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;

class DevServerManager {
  static async waitForDevServer(url = "http://localhost:5174/", maxAttempts = 30, delay = 1000) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const http = require("http");
        const urlObj = new URL(url);

        const result = await new Promise((resolve) => {
          const req = http.get(
            {
              hostname: urlObj.hostname,
              port: urlObj.port || 80,
              path: urlObj.pathname,
              timeout: 2000,
            },
            (res) => {
              resolve(res.statusCode >= 200 && res.statusCode < 400);
            },
          );

          req.on("error", () => resolve(false));
          req.on("timeout", () => {
            req.destroy();
            resolve(false);
          });
        });

        if (result) {
          logger.log(`Dev server ready after ${i + 1} attempts`);
          return true;
        }
      } catch (error) {
        logger.log(`Waiting for dev server... attempt ${i + 1}/${maxAttempts}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    logger.error("Dev server failed to start within timeout");
    return false;
  }

  static getAppUrl(isControlPanel = false) {
    if (process.env.NODE_ENV === "development") {
      return isControlPanel ? "http://localhost:5174/?panel=true" : "http://localhost:5174/";
    } else {
      const path = require("path");
      let appPath;
      try {
        const { app } = require("electron");
        // Use app.getAppPath() for more reliable path resolution
        appPath = app && app.isReady ? app.getAppPath() : null;
      } catch (e) {
        // app might not be available yet
        appPath = null;
      }

      // Fallback to __dirname-based resolution if app.getAppPath() isn't available
      if (!appPath) {
        // From src/helpers/ -> go up to desktop/ -> then into src/dist/
        appPath = path.resolve(__dirname, "..", "..");
      }

      const htmlPath = path.resolve(appPath, "src", "dist", "index.html");
      const url = isControlPanel ? `file://${htmlPath}?panel=true` : `file://${htmlPath}`;
      logger.log("Loading app from:", url);
      return url;
    }
  }
}

module.exports = DevServerManager;
