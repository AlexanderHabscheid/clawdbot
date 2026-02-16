#!/usr/bin/env node
/**
 * Audio & Permission Diagnostic Script for Centris AI
 *
 * Run this script to test audio recording and permissions outside of Electron.
 * This helps diagnose issues with microphone access and audio tools.
 *
 * Usage: node scripts/test-audio-permissions.js
 */

const { spawn, exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log("\n");
  log(`═══════════════════════════════════════════════════════════`, "cyan");
  log(`  ${title}`, "bright");
  log(`═══════════════════════════════════════════════════════════`, "cyan");
}

function logResult(label, success, details = "") {
  const icon = success ? "✅" : "❌";
  const color = success ? "green" : "red";
  log(`${icon} ${label}${details ? `: ${details}` : ""}`, color);
}

/**
 * Check if a command exists
 */
function commandExists(command) {
  try {
    execSync(`which ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check audio tools availability
 */
function checkAudioTools() {
  logSection("Audio Tools Check");

  const tools = [
    { name: "sox", description: "Sound eXchange - audio recording/playback" },
    { name: "rec", description: "sox recording command" },
    { name: "play", description: "sox playback command" },
    { name: "ffmpeg", description: "FFmpeg - audio/video processing" },
    { name: "afplay", description: "macOS built-in audio player" },
  ];

  const results = {};

  for (const tool of tools) {
    const exists = commandExists(tool.name);
    results[tool.name] = exists;
    logResult(tool.name, exists, exists ? tool.description : `NOT FOUND - ${tool.description}`);
  }

  if (!results.sox && !results.ffmpeg) {
    log("\n⚠️  No audio recording tools found!", "yellow");
    log("   Install with: brew install sox ffmpeg", "dim");
  }

  return results;
}

/**
 * Test microphone recording with sox
 */
async function testSoxRecording() {
  if (!commandExists("sox")) {
    return { success: false, error: "sox not installed" };
  }

  const tempFile = path.join(os.tmpdir(), "centris-test-recording.wav");

  log("\n🎤 Recording 2 seconds with sox...", "cyan");

  return new Promise((resolve) => {
    const proc = spawn(
      "sox",
      ["-d", "-t", "wav", "-r", "16000", "-c", "1", "-b", "16", tempFile, "trim", "0", "2"],
      {
        timeout: 10000,
      },
    );

    let stderr = "";

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(tempFile)) {
        const stats = fs.statSync(tempFile);
        const hasAudio = stats.size > 1000;

        // Cleanup
        try {
          fs.unlinkSync(tempFile);
        } catch {}

        resolve({
          success: hasAudio,
          fileSize: stats.size,
          message: hasAudio
            ? `Recorded ${stats.size} bytes`
            : "Recording too small - no audio captured",
        });
      } else {
        resolve({
          success: false,
          error: stderr || `sox exited with code ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Test microphone recording with ffmpeg
 */
async function testFfmpegRecording() {
  if (!commandExists("ffmpeg")) {
    return { success: false, error: "ffmpeg not installed" };
  }

  const tempFile = path.join(os.tmpdir(), "centris-test-recording.wav");

  log("\n🎤 Recording 2 seconds with ffmpeg...", "cyan");

  return new Promise((resolve) => {
    const proc = spawn(
      "ffmpeg",
      ["-f", "avfoundation", "-i", ":0", "-t", "2", "-ar", "16000", "-ac", "1", "-y", tempFile],
      {
        timeout: 10000,
      },
    );

    let stderr = "";

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(tempFile)) {
        const stats = fs.statSync(tempFile);
        const hasAudio = stats.size > 1000;

        // Cleanup
        try {
          fs.unlinkSync(tempFile);
        } catch {}

        resolve({
          success: hasAudio,
          fileSize: stats.size,
          message: hasAudio
            ? `Recorded ${stats.size} bytes`
            : "Recording too small - no audio captured",
        });
      } else {
        const permissionDenied = stderr.includes("not allowed") || stderr.includes("permission");
        resolve({
          success: false,
          error: permissionDenied
            ? "Permission denied - microphone access not granted"
            : `ffmpeg exited with code ${code}`,
          permissionIssue: permissionDenied,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Test system sound playback
 */
async function testSoundPlayback() {
  const systemSounds = [
    "/System/Library/Sounds/Ping.aiff",
    "/System/Library/Sounds/Pop.aiff",
    "/System/Library/Sounds/Glass.aiff",
  ];

  const soundPath = systemSounds.find((p) => fs.existsSync(p));

  if (!soundPath) {
    return { success: false, error: "No system sounds found" };
  }

  log("\n🔊 Playing system sound...", "cyan");

  return new Promise((resolve) => {
    const proc = spawn("afplay", [soundPath], { timeout: 5000 });

    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        message: code === 0 ? "Sound played successfully" : "Playback failed",
      });
    });

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Check TCC database for microphone permission
 */
function checkTccPermissions() {
  logSection("TCC Permission Check");

  // This requires node-mac-permissions which may not be available in this context
  // Just show how to check manually
  log("To check TCC database permissions manually:", "dim");
  log(
    "  sqlite3 ~/Library/Application\\ Support/com.apple.TCC/TCC.db \"SELECT * FROM access WHERE service='kTCCServiceMicrophone'\"",
    "dim",
  );
  log("\nOr use System Settings:", "dim");
  log("  System Settings > Privacy & Security > Microphone", "dim");
}

/**
 * Main diagnostic
 */
async function main() {
  console.log("\n");
  log("═══════════════════════════════════════════════════════════", "cyan");
  log("  Centris AI - Audio & Permission Diagnostics", "bright");
  log("═══════════════════════════════════════════════════════════", "cyan");
  console.log("\n");

  // Check audio tools
  const tools = checkAudioTools();

  // Test recording
  logSection("Microphone Recording Test");

  let recordingResult = null;

  if (tools.sox) {
    recordingResult = await testSoxRecording();
    logResult(
      "sox recording",
      recordingResult.success,
      recordingResult.message || recordingResult.error,
    );
  }

  if (!recordingResult?.success && tools.ffmpeg) {
    recordingResult = await testFfmpegRecording();
    logResult(
      "ffmpeg recording",
      recordingResult.success,
      recordingResult.message || recordingResult.error,
    );

    if (recordingResult.permissionIssue) {
      log("\n⚠️  Microphone permission not granted!", "yellow");
      log("   Open System Settings > Privacy & Security > Microphone", "dim");
      log("   Enable permission for Terminal (or the app running this script)", "dim");
    }
  }

  if (!recordingResult?.success) {
    log("\n❌ Recording test failed", "red");
    if (!tools.sox && !tools.ffmpeg) {
      log("   Install audio tools: brew install sox ffmpeg", "yellow");
    }
  }

  // Test playback
  logSection("Audio Playback Test");
  const playbackResult = await testSoundPlayback();
  logResult(
    "Audio playback",
    playbackResult.success,
    playbackResult.message || playbackResult.error,
  );

  // TCC check
  checkTccPermissions();

  // Summary
  logSection("Summary");

  const allPassed = recordingResult?.success && playbackResult.success;

  if (allPassed) {
    log("✅ All audio tests passed!", "green");
    log("   Microphone recording and playback are working correctly.", "dim");
  } else {
    log("⚠️  Some tests failed", "yellow");

    if (!recordingResult?.success) {
      log("\n📝 To fix microphone recording:", "cyan");
      log("   1. Install audio tools: brew install sox ffmpeg", "dim");
      log("   2. Grant microphone permission to Terminal/Cursor in System Settings", "dim");
      log("   3. Run this script again to verify", "dim");
    }
  }

  log("\n📝 For Centris AI app:", "cyan");
  log("   1. Run: npm run dev:app", "dim");
  log('   2. Grant permissions to "Centris AI" in System Settings', "dim");
  log("   3. Use the in-app diagnostic (Settings > Test Permissions)", "dim");

  console.log("\n");
}

main().catch(console.error);
