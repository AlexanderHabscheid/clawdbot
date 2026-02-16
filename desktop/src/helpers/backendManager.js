/**
 * Backend Manager - Checks if the clawdbot gateway is running on port 18789
 *
 * The Python backend has been removed. All audio/transcription/task execution
 * is now handled by the clawdbot gateway running on port 18789.
 *
 * This module only monitors gateway health — it does not auto-start anything,
 * since the gateway is started separately (via the OpenClaw app or CLI).
 */

const { exec } = require("child_process");
const http = require("http");

const GATEWAY_PORT = 18789;

class BackendManager {
  constructor() {
    this.backendUrl = `http://127.0.0.1:${GATEWAY_PORT}`;
    this.backendProcess = null;
    this.isStarting = false;
    this.startAttempts = 0;
    this.maxStartAttempts = 3;
  }

  /**
   * Check if the clawdbot gateway is running
   * @returns {Promise<boolean>} True if gateway is reachable
   */
  async checkBackendHealth() {
    return new Promise((resolve) => {
      // POST to /tools/invoke with a dummy tool — 404 means gateway is alive
      const postData = JSON.stringify({ tool: "__health_probe", args: {} });
      const options = {
        hostname: "127.0.0.1",
        port: GATEWAY_PORT,
        path: "/tools/invoke",
        method: "POST",
        timeout: 2000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      };
      const req = http.request(options, (res) => {
        // 404 (tool not found) means gateway is alive and responding
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

  /**
   * Check if a process is using the gateway port
   * @returns {Promise<boolean>} True if port is in use
   */
  async isPortInUse() {
    return new Promise((resolve) => {
      exec(`lsof -ti:${GATEWAY_PORT}`, (error) => {
        resolve(error === null);
      });
    });
  }

  /**
   * Wait for gateway to be ready by polling health endpoint
   * @param {number} maxWaitSeconds Maximum seconds to wait
   * @returns {Promise<boolean>} True if gateway becomes ready
   */
  async waitForBackendReady(maxWaitSeconds = 30) {
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;
    const pollInterval = 1000;

    while (Date.now() - startTime < maxWaitMs) {
      const isHealthy = await this.checkBackendHealth();
      if (isHealthy) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return false;
  }

  /**
   * Ensure gateway is running — cannot auto-start, just check
   * @returns {Promise<boolean>} True if gateway is reachable
   */
  async ensureBackendRunning() {
    const isHealthy = await this.checkBackendHealth();
    if (isHealthy) {
      console.log("[BackendManager] Gateway is running on port " + GATEWAY_PORT);
      return true;
    }

    console.log("[BackendManager] Gateway not reachable on port " + GATEWAY_PORT);
    console.log("[BackendManager] Start the gateway with: openclaw gateway run");
    return false;
  }

  /**
   * No-op — gateway lifecycle is managed externally
   */
  async startBackend() {
    console.log("[BackendManager] The Python backend has been removed.");
    console.log("[BackendManager] Start the clawdbot gateway with: openclaw gateway run");
    return this.ensureBackendRunning();
  }

  /**
   * No-op — gateway lifecycle is managed externally
   */
  async stopBackend() {
    console.log(
      "[BackendManager] Gateway lifecycle is managed externally. Use the OpenClaw app or CLI to stop.",
    );
  }

  /**
   * Get gateway status
   */
  async getStatus() {
    const healthy = await this.checkBackendHealth();
    const portInUse = await this.isPortInUse();

    return {
      running: healthy,
      healthy: healthy,
      portInUse: portInUse,
      starting: this.isStarting,
    };
  }

  async checkBackendRunning() {
    return await this.checkBackendHealth();
  }
}

// Export singleton instance
const backendManager = new BackendManager();

module.exports = { BackendManager, backendManager };
