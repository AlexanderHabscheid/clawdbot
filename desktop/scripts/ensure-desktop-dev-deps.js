#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BIN_DIR = path.join(ROOT, "node_modules", ".bin");
const IS_WINDOWS = process.platform === "win32";
const REQUIRED_BINS = ["concurrently", "cross-env", "electron", "vite"];

function binPath(binName) {
  return path.join(BIN_DIR, IS_WINDOWS ? `${binName}.cmd` : binName);
}

const missingBins = REQUIRED_BINS.filter((binName) => !fs.existsSync(binPath(binName)));

if (missingBins.length === 0) {
  process.exit(0);
}

console.log("Missing desktop dev dependencies:", missingBins.join(", "));
console.log("Running npm install in desktop to restore local toolchain...");

const install = spawnSync("npm", ["install"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: IS_WINDOWS,
});

if (install.status !== 0) {
  console.error("npm install failed. Please run `npm install` in desktop and retry.");
  process.exit(install.status || 1);
}

console.log("Desktop dependencies installed. Continuing dev startup.");
