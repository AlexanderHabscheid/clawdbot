/**
 * Re-export extension bridge connection helpers for use in the agent runner.
 * Keeps the import path clean (relative to agents/) without reaching into gateway/.
 */
export {
  isCentrisExtensionConnected,
  waitForExtension,
} from "../gateway/centris-extension-bridge.js";
