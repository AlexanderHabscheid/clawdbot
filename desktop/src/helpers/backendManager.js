/**
 * Backend Manager - Gateway health monitoring
 *
 * Monitors the Centris gateway (Railway production or local dev).
 * Checks env vars for a remote URL first, falls back to localhost:18789.
 */

const { exec } = require("child_process");
const http = require("http");
const https = require("https");

const LOCAL_GATEWAY_PORT = 18789;
const PRODUCTION_GATEWAY_URL = "https://centris-ai-production.up.railway.app";
const HEALTH_TIMEOUT_MS = 3000;

function resolveGatewayUrl() {
  return (
    process.env.CENTRIS_GATEWAY_URL ||
    process.env.OPENCLAW_GATEWAY_URL ||
    process.env.VITE_CENTRIS_GATEWAY_URL ||
    PRODUCTION_GATEWAY_URL
  );
}

class BackendManager {
  constructor() {
    this.backendUrl = resolveGatewayUrl();
    this.backendProcess = null;
    this.isStarting = false;
    this.startAttempts = 0;
    this.maxStartAttempts = 3;
  }

  /**
   * Check if the gateway is reachable (remote or local).
   * Tries the configured URL first via /health, then falls back to local port.
   */
  async checkBackendHealth() {
    // Try the configured gateway URL (remote or local)
    const healthy = await this._checkUrlHealth(this.backendUrl);
    if (healthy) return true;

    // If configured URL failed and it's NOT the local fallback, try local too
    const isLocal = this.backendUrl.includes("127.0.0.1") || this.backendUrl.includes("localhost");
    if (!isLocal) {
      const localHealthy = await this._checkLocalGateway();
      if (localHealthy) {
        this.backendUrl = `http://127.0.0.1:${LOCAL_GATEWAY_PORT}`;
        return true;
      }
    }

    return false;
  }

  /**
   * Check a URL's /health endpoint
   */
  async _checkUrlHealth(baseUrl) {
    return new Promise((resolve) => {
      try {
        const url = new URL("/health", baseUrl);
        const client = url.protocol === "https:" ? https : http;
        const req = client.get(url.href, { timeout: HEALTH_TIMEOUT_MS }, (res) => {
          resolve(res.statusCode >= 200 && res.statusCode < 500);
          res.resume();
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Check if a local gateway is running on port 18789
   */
  async _checkLocalGateway() {
    return new Promise((resolve) => {
      const postData = JSON.stringify({ tool: "__health_probe", args: {} });
      const options = {
        hostname: "127.0.0.1",
        port: LOCAL_GATEWAY_PORT,
        path: "/tools/invoke",
        method: "POST",
        timeout: 2000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      };
      const req = http.request(options, (res) => {
        resolve(res.statusCode === 200 || res.statusCode === 404);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.write(postData);
      req.end();
    });
  }

  async isPortInUse() {
    return new Promise((resolve) => {
      exec(`lsof -ti:${LOCAL_GATEWAY_PORT}`, (error) => {
        resolve(error === null);
      });
    });
  }

  async waitForBackendReady(maxWaitSeconds = 30) {
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;
    const pollInterval = 1000;

    while (Date.now() - startTime < maxWaitMs) {
      const isHealthy = await this.checkBackendHealth();
      if (isHealthy) return true;
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return false;
  }

  async ensureBackendRunning() {
    const isHealthy = await this.checkBackendHealth();
    if (isHealthy) {
      console.log(`[BackendManager] Gateway reachable at ${this.backendUrl}`);
      return true;
    }

    console.log(`[BackendManager] Gateway not reachable at ${this.backendUrl}`);
    return false;
  }

  async startBackend() {
    return this.ensureBackendRunning();
  }

  async stopBackend() {
    console.log("[BackendManager] Gateway lifecycle is managed externally.");
  }

  async getStatus() {
    const healthy = await this.checkBackendHealth();
    const portInUse = await this.isPortInUse();

    return {
      running: healthy,
      healthy: healthy,
      portInUse: portInUse,
      starting: this.isStarting,
      gatewayUrl: this.backendUrl,
    };
  }

  async checkBackendRunning() {
    return await this.checkBackendHealth();
  }
}

const backendManager = new BackendManager();

module.exports = { BackendManager, backendManager };
