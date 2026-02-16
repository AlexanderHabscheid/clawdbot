/**
 * Centris Native Audio Module - Test Suite
 */

const {
  NativeAudioCapture,
  AudioLevelMonitor,
  isAvailable,
  getInputDevices,
  getDefaultInputDevice,
} = require("../lib");

console.log("======================================");
console.log("Centris Native Audio Module Test");
console.log("======================================\n");

// Test 1: Check availability
console.log("Test 1: Native module availability");
console.log("  Available:", isAvailable());
console.log();

if (!isAvailable()) {
  console.log("Native module not available. Run `npm run build` first.\n");
  console.log("Expected behavior in Electron: The module will be built during npm install.");
  process.exit(0);
}

// Test 2: Device enumeration
console.log("Test 2: Device enumeration");
const devices = getInputDevices();
console.log("  Found", devices.length, "input devices:");
devices.forEach((device, i) => {
  console.log(`    ${i + 1}. ${device.name}`);
  console.log(`       ID: ${device.id}`);
  console.log(`       Default: ${device.isDefault}`);
  console.log(`       Channels: ${device.maxChannels}`);
  console.log(`       Sample Rate: ${device.defaultSampleRate}Hz`);
});
console.log();

// Test 3: Default device
console.log("Test 3: Default device");
const defaultDevice = getDefaultInputDevice();
if (defaultDevice) {
  console.log("  Name:", defaultDevice.name);
  console.log("  ID:", defaultDevice.id);
} else {
  console.log("  No default device found");
}
console.log();

// Test 4: Audio capture
console.log("Test 4: Audio capture (5 second test)");
console.log("  Speak into your microphone...\n");

async function testAudioCapture() {
  const capture = new NativeAudioCapture();

  // Track audio levels
  let maxLevel = 0;
  let levelCount = 0;
  let voiceStartCount = 0;
  let voiceEndCount = 0;

  capture.on("audioLevel", (level) => {
    if (level > maxLevel) {
      maxLevel = level;
    }
    levelCount++;

    // Print level bar
    const bar = "█".repeat(Math.floor(level * 50));
    process.stdout.write(`\r  Level: ${bar.padEnd(50, "░")} ${(level * 100).toFixed(1)}%`);
  });

  capture.on("voiceStart", () => {
    voiceStartCount++;
    console.log("\n  [Voice Started]");
  });

  capture.on("voiceEnd", () => {
    voiceEndCount++;
    console.log("  [Voice Ended]");
  });

  capture.on("transcript", (result) => {
    if (result.isFinal) {
      console.log("\n  Transcript (final):", result.text);
    } else {
      console.log("\n  Transcript (partial):", result.text);
    }
  });

  capture.on("error", (error) => {
    console.error("\n  Error:", error);
  });

  // Initialize
  const initialized = await capture.initialize({
    deviceId: "default",
    sampleRate: 16000,
    channels: 1,
    vadEnabled: true,
    vadThreshold: 0.3,
  });

  if (!initialized) {
    console.log("  Failed to initialize audio capture");
    return;
  }

  console.log("  Initialized successfully");

  // Start capture
  if (!capture.start()) {
    console.log("  Failed to start audio capture");
    return;
  }

  console.log("  Started capturing...\n");

  // Run for 5 seconds
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Stop and get stats
  capture.stop();
  const stats = capture.getStats();

  console.log("\n\n  Capture complete!");
  console.log("  Statistics:");
  console.log("    Total samples:", stats.totalSamples);
  console.log("    Dropped samples:", stats.droppedSamples);
  console.log("    Max level:", (maxLevel * 100).toFixed(1) + "%");
  console.log("    Level callbacks:", levelCount);
  console.log("    Voice starts:", voiceStartCount);
  console.log("    Voice ends:", voiceEndCount);

  // Cleanup
  capture.shutdown();
  console.log("\n  Shutdown complete");
}

testAudioCapture()
  .then(() => {
    console.log("\n======================================");
    console.log("Tests complete");
    console.log("======================================");
  })
  .catch((err) => {
    console.error("Test error:", err);
    process.exit(1);
  });
