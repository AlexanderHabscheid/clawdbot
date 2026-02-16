/**
 * PermissionDiagnostic - Test component for verifying ALL permissions and audio
 *
 * This component provides:
 * - Permission status checks for ALL system permissions:
 *   - Microphone (voice dictation)
 *   - Accessibility (UI control, text insertion)
 *   - Screen Recording (AI vision, OCR)
 *   - Input Monitoring (keyboard tracking)
 * - Actual microphone recording test
 * - Audio playback verification
 * - Globe key listener status
 * - Screen capture test
 * - Keyboard monitoring test
 *
 * Can be embedded in Preferences/Dashboard or used standalone for debugging
 */

import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Shield,
  ShieldCheck,
  ShieldX,
  Play,
  Square,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Loader2,
  Info,
  Monitor,
  Keyboard,
  Eye,
} from "lucide-react";
import React, { useState, useEffect } from "react";

const PermissionDiagnostic = ({ onClose, compact = false }) => {
  const [permissionStatus, setPermissionStatus] = useState(null);
  const [appIdentity, setAppIdentity] = useState(null);
  const [audioDevices, setAudioDevices] = useState(null);
  const [recordingTest, setRecordingTest] = useState(null);
  const [playbackTest, setPlaybackTest] = useState(null);
  const [isRunningFullTest, setIsRunningFullTest] = useState(false);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [isTestingPlayback, setIsTestingPlayback] = useState(false);
  const [troubleshooting, setTroubleshooting] = useState(null);
  const [fullTestResult, setFullTestResult] = useState(null);

  // Advanced permissions state
  const [screenRecordingStatus, setScreenRecordingStatus] = useState(null);
  const [inputMonitoringStatus, setInputMonitoringStatus] = useState(null);
  const [isTestingScreenCapture, setIsTestingScreenCapture] = useState(false);
  const [screenCaptureResult, setScreenCaptureResult] = useState(null);

  // Load initial data
  useEffect(() => {
    loadPermissionStatus();
    loadAppIdentity();
    loadAudioDevices();
    loadAdvancedPermissions();
  }, []);

  const loadPermissionStatus = async () => {
    try {
      const status = await window.electronAPI?.getPermissionStatus?.();
      setPermissionStatus(status);
      console.log("[PermissionDiagnostic] Permission status:", status);
    } catch (error) {
      console.error("[PermissionDiagnostic] Error loading permission status:", error);
    }
  };

  const loadAdvancedPermissions = async () => {
    try {
      // Load screen recording permission
      const screenStatus = await window.electronAPI?.checkScreenRecordingPermission?.();
      setScreenRecordingStatus(screenStatus);
      console.log("[PermissionDiagnostic] Screen recording status:", screenStatus);

      // Load input monitoring permission
      const inputStatus = await window.electronAPI?.checkInputMonitoringPermission?.();
      setInputMonitoringStatus(inputStatus);
      console.log("[PermissionDiagnostic] Input monitoring status:", inputStatus);
    } catch (error) {
      console.error("[PermissionDiagnostic] Error loading advanced permissions:", error);
    }
  };

  const loadAppIdentity = async () => {
    try {
      const identity = await window.electronAPI?.getAppIdentity?.();
      setAppIdentity(identity);
      console.log("[PermissionDiagnostic] App identity:", identity);
    } catch (error) {
      console.error("[PermissionDiagnostic] Error loading app identity:", error);
    }
  };

  const loadAudioDevices = async () => {
    try {
      const devices = await window.electronAPI?.getAudioInputDevices?.();
      setAudioDevices(devices);
      console.log("[PermissionDiagnostic] Audio devices:", devices);
    } catch (error) {
      console.error("[PermissionDiagnostic] Error loading audio devices:", error);
    }
  };

  const testMicrophoneRecording = async () => {
    setIsTestingMic(true);
    setRecordingTest({ status: "running", message: "Recording for 2 seconds..." });

    try {
      const result = await window.electronAPI?.testMicrophoneRecording?.(2);
      setRecordingTest(result);
      console.log("[PermissionDiagnostic] Recording test result:", result);

      // Refresh permission status after test
      await loadPermissionStatus();
    } catch (error) {
      setRecordingTest({ success: false, message: error.message });
      console.error("[PermissionDiagnostic] Recording test error:", error);
    } finally {
      setIsTestingMic(false);
    }
  };

  const testAudioPlayback = async () => {
    setIsTestingPlayback(true);
    setPlaybackTest({ status: "running", message: "Playing audio..." });

    try {
      const result = await window.electronAPI?.testAudioPlayback?.();
      setPlaybackTest(result);
      console.log("[PermissionDiagnostic] Playback test result:", result);
    } catch (error) {
      setPlaybackTest({ success: false, message: error.message });
      console.error("[PermissionDiagnostic] Playback test error:", error);
    } finally {
      setIsTestingPlayback(false);
    }
  };

  const playSystemSound = async () => {
    try {
      const result = await window.electronAPI?.playSystemSound?.();
      console.log("[PermissionDiagnostic] System sound result:", result);
      setPlaybackTest(result);
    } catch (error) {
      console.error("[PermissionDiagnostic] System sound error:", error);
    }
  };

  const runFullAudioTest = async () => {
    setIsRunningFullTest(true);
    setFullTestResult({ status: "running", message: "Running comprehensive audio test..." });

    try {
      const result = await window.electronAPI?.runFullAudioTest?.();
      setFullTestResult(result);
      console.log("[PermissionDiagnostic] Full audio test result:", result);

      // Update individual states from full test
      if (result?.tests?.recording) {
        setRecordingTest(result.tests.recording);
      }
      if (result?.tests?.playback) {
        setPlaybackTest(result.tests.playback);
      }

      // Refresh permission status
      await loadPermissionStatus();
    } catch (error) {
      setFullTestResult({ success: false, message: error.message });
      console.error("[PermissionDiagnostic] Full audio test error:", error);
    } finally {
      setIsRunningFullTest(false);
    }
  };

  const loadTroubleshooting = async () => {
    try {
      const info = await window.electronAPI?.getPermissionTroubleshooting?.();
      setTroubleshooting(info);
      console.log("[PermissionDiagnostic] Troubleshooting info:", info);
    } catch (error) {
      console.error("[PermissionDiagnostic] Error loading troubleshooting:", error);
    }
  };

  const openMicrophoneSettings = async () => {
    await window.electronAPI?.openSystemPreferences?.("microphone");
  };

  const openAccessibilitySettings = async () => {
    await window.electronAPI?.openSystemPreferences?.("accessibility");
  };

  const refreshAll = async () => {
    await Promise.all([
      loadPermissionStatus(),
      loadAppIdentity(),
      loadAudioDevices(),
      loadAdvancedPermissions(),
    ]);
  };

  // Status indicator component
  const StatusBadge = ({ success, label, details }) => (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
        success === true
          ? "bg-green-500/20 text-green-400"
          : success === false
            ? "bg-red-500/20 text-red-400"
            : "bg-yellow-500/20 text-yellow-400"
      }`}
    >
      {success === true ? (
        <CheckCircle className="w-4 h-4" />
      ) : success === false ? (
        <AlertCircle className="w-4 h-4" />
      ) : (
        <Info className="w-4 h-4" />
      )}
      <span className="font-medium">{label}</span>
      {details && <span className="text-xs opacity-70">({details})</span>}
    </div>
  );

  // Request advanced permissions
  const openScreenRecordingSettings = async () => {
    await window.electronAPI?.openSystemPreferences?.("screen-recording");
  };

  const openInputMonitoringSettings = async () => {
    await window.electronAPI?.openSystemPreferences?.("input-monitoring");
  };

  // Test screen capture
  const testScreenCapture = async () => {
    setIsTestingScreenCapture(true);
    setScreenCaptureResult({ status: "running", message: "Capturing screen..." });

    try {
      const result = await window.electronAPI?.captureScreen?.({ includeOCR: true });
      setScreenCaptureResult(result);
      console.log("[PermissionDiagnostic] Screen capture result:", result);

      // Refresh permissions
      await loadAdvancedPermissions();
    } catch (error) {
      setScreenCaptureResult({ success: false, message: error.message });
      console.error("[PermissionDiagnostic] Screen capture error:", error);
    } finally {
      setIsTestingScreenCapture(false);
    }
  };

  if (compact) {
    // Compact mode for embedding in other components
    return (
      <div className="bg-gray-900/50 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Permission Status
          </h3>
          <button
            onClick={() => {
              refreshAll();
              loadAdvancedPermissions();
            }}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Core Permissions */}
        <div className="flex flex-wrap gap-2">
          <StatusBadge success={permissionStatus?.microphone} label="Microphone" />
          <StatusBadge success={permissionStatus?.accessibility} label="Accessibility" />
        </div>

        {/* Advanced Permissions */}
        <div className="flex flex-wrap gap-2">
          <StatusBadge success={screenRecordingStatus?.granted} label="Screen Recording" />
          <StatusBadge success={inputMonitoringStatus?.granted} label="Input Monitoring" />
        </div>

        <div className="flex gap-2">
          <button
            onClick={testMicrophoneRecording}
            disabled={isTestingMic}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-sm"
          >
            {isTestingMic ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
            Test Recording
          </button>
          <button
            onClick={playSystemSound}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
          >
            <Volume2 className="w-4 h-4" />
            Test Sound
          </button>
        </div>

        {recordingTest && (
          <div
            className={`text-xs p-2 rounded ${recordingTest.success ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}
          >
            {recordingTest.message ||
              (recordingTest.success ? "✅ Recording works!" : "❌ Recording failed")}
          </div>
        )}
      </div>
    );
  }

  // Full diagnostic mode
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-purple-400" />
            Permission & Audio Diagnostics
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* App Identity */}
          <section>
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-400" />
              App Identity
            </h3>
            <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
              {appIdentity ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-400">App Name:</span>
                    <span className="text-white font-mono">{appIdentity.appName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Bundle ID:</span>
                    <span className="text-white font-mono">{appIdentity.bundleId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Mode:</span>
                    <span
                      className={`font-mono ${appIdentity.isDev ? "text-yellow-400" : "text-green-400"}`}
                    >
                      {appIdentity.isDev ? "Development" : "Production"}
                    </span>
                  </div>
                  {appIdentity.permissionNote && (
                    <div className="mt-3 p-3 bg-blue-500/20 rounded-lg text-blue-300 text-sm">
                      {appIdentity.permissionNote}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-gray-500">Loading...</div>
              )}
            </div>
          </section>

          {/* Permission Status */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-green-400" />
                Permission Status
              </h3>
              <button
                onClick={refreshAll}
                className="flex items-center gap-1 px-3 py-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
            {/* Core Permissions */}
            <h4 className="text-sm text-gray-400 mb-2">Core Permissions (Required)</h4>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {/* Microphone */}
              <div
                className={`p-4 rounded-lg ${
                  permissionStatus?.microphone
                    ? "bg-green-500/20 border border-green-500/30"
                    : "bg-red-500/20 border border-red-500/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {permissionStatus?.microphone ? (
                    <Mic className="w-5 h-5 text-green-400" />
                  ) : (
                    <MicOff className="w-5 h-5 text-red-400" />
                  )}
                  <span className="text-white font-medium">Microphone</span>
                </div>
                <div className="text-sm mb-2">
                  <span
                    className={permissionStatus?.microphone ? "text-green-300" : "text-red-300"}
                  >
                    {permissionStatus?.microphone ? "Granted ✅" : "Not Granted ❌"}
                  </span>
                </div>
                {!permissionStatus?.microphone && (
                  <button
                    onClick={openMicrophoneSettings}
                    className="w-full px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm"
                  >
                    Open Settings
                  </button>
                )}
              </div>

              {/* Accessibility */}
              <div
                className={`p-4 rounded-lg ${
                  permissionStatus?.accessibility
                    ? "bg-green-500/20 border border-green-500/30"
                    : "bg-red-500/20 border border-red-500/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {permissionStatus?.accessibility ? (
                    <ShieldCheck className="w-5 h-5 text-green-400" />
                  ) : (
                    <ShieldX className="w-5 h-5 text-red-400" />
                  )}
                  <span className="text-white font-medium">Accessibility</span>
                </div>
                <div className="text-sm mb-2">
                  <span
                    className={permissionStatus?.accessibility ? "text-green-300" : "text-red-300"}
                  >
                    {permissionStatus?.accessibility ? "Granted ✅" : "Not Granted ❌"}
                  </span>
                </div>
                {!permissionStatus?.accessibility && (
                  <button
                    onClick={openAccessibilitySettings}
                    className="w-full px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm"
                  >
                    Open Settings
                  </button>
                )}
              </div>
            </div>

            {/* Advanced Permissions */}
            <h4 className="text-sm text-gray-400 mb-2">Advanced Permissions (Optional)</h4>
            <div className="grid grid-cols-2 gap-4">
              {/* Screen Recording */}
              <div
                className={`p-4 rounded-lg ${
                  screenRecordingStatus?.granted
                    ? "bg-green-500/20 border border-green-500/30"
                    : "bg-yellow-500/20 border border-yellow-500/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Monitor
                    className={`w-5 h-5 ${screenRecordingStatus?.granted ? "text-green-400" : "text-yellow-400"}`}
                  />
                  <span className="text-white font-medium">Screen Recording</span>
                </div>
                <div className="text-sm mb-2">
                  <span
                    className={
                      screenRecordingStatus?.granted ? "text-green-300" : "text-yellow-300"
                    }
                  >
                    {screenRecordingStatus?.granted ? "Granted ✅" : "Not Granted ⚠️"}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-2">For AI vision & OCR</p>
                {!screenRecordingStatus?.granted && (
                  <button
                    onClick={openScreenRecordingSettings}
                    className="w-full px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm"
                  >
                    Open Settings
                  </button>
                )}
              </div>

              {/* Input Monitoring */}
              <div
                className={`p-4 rounded-lg ${
                  inputMonitoringStatus?.granted
                    ? "bg-green-500/20 border border-green-500/30"
                    : "bg-yellow-500/20 border border-yellow-500/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Keyboard
                    className={`w-5 h-5 ${inputMonitoringStatus?.granted ? "text-green-400" : "text-yellow-400"}`}
                  />
                  <span className="text-white font-medium">Input Monitoring</span>
                </div>
                <div className="text-sm mb-2">
                  <span
                    className={
                      inputMonitoringStatus?.granted ? "text-green-300" : "text-yellow-300"
                    }
                  >
                    {inputMonitoringStatus?.granted ? "Granted ✅" : "Not Granted ⚠️"}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-2">For keyboard tracking</p>
                {!inputMonitoringStatus?.granted && (
                  <button
                    onClick={openInputMonitoringSettings}
                    className="w-full px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm"
                  >
                    Open Settings
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Audio Devices */}
          <section>
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Mic className="w-5 h-5 text-purple-400" />
              Audio Input Devices
            </h3>
            <div className="bg-gray-800/50 rounded-lg p-4">
              {audioDevices?.devices ? (
                <ul className="space-y-2">
                  {audioDevices.devices.map((device, i) => (
                    <li key={i} className="flex items-center gap-2 text-gray-300">
                      <Mic className="w-4 h-4 text-gray-500" />
                      <span>{device.name}</span>
                      {device.isDefault && (
                        <span className="text-xs bg-purple-500/30 text-purple-300 px-2 py-0.5 rounded">
                          Default
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-gray-500">Loading devices...</div>
              )}
            </div>
          </section>

          {/* Audio Tests */}
          <section>
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Volume2 className="w-5 h-5 text-blue-400" />
              Audio Tests
            </h3>
            <div className="space-y-4">
              {/* Full test button */}
              <button
                onClick={runFullAudioTest}
                disabled={isRunningFullTest}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 text-white rounded-lg font-medium"
              >
                {isRunningFullTest ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Running Full Audio Test...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5" />
                    Run Full Audio Test
                  </>
                )}
              </button>

              {/* Full test result */}
              {fullTestResult && (
                <div
                  className={`p-4 rounded-lg ${fullTestResult.success ? "bg-green-500/20" : "bg-yellow-500/20"}`}
                >
                  <div className="font-medium text-white mb-2">
                    {fullTestResult.success
                      ? "✅ All Tests Passed!"
                      : "⚠️ Some Tests Need Attention"}
                  </div>
                  {fullTestResult.summary && (
                    <div className="text-sm text-gray-300">{fullTestResult.summary}</div>
                  )}
                </div>
              )}

              {/* Individual tests */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <button
                    onClick={testMicrophoneRecording}
                    disabled={isTestingMic}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg"
                  >
                    {isTestingMic ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                    Test Recording
                  </button>
                  {recordingTest && (
                    <div
                      className={`text-sm p-2 rounded ${recordingTest.success ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}
                    >
                      {recordingTest.message || (recordingTest.success ? "✅ Works!" : "❌ Failed")}
                      {recordingTest.tool && (
                        <span className="block text-xs opacity-70">Tool: {recordingTest.tool}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <button
                    onClick={recordingTest?.canPlayback ? testAudioPlayback : playSystemSound}
                    disabled={isTestingPlayback}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
                  >
                    {isTestingPlayback ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                    {recordingTest?.canPlayback ? "Play Recording" : "Test Sound"}
                  </button>
                  {playbackTest && (
                    <div
                      className={`text-sm p-2 rounded ${playbackTest.success ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}
                    >
                      {playbackTest.message || (playbackTest.success ? "✅ Works!" : "❌ Failed")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Screen Capture Test */}
          <section>
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Monitor className="w-5 h-5 text-cyan-400" />
              Screen Capture Test
            </h3>
            <div className="space-y-4">
              <button
                onClick={testScreenCapture}
                disabled={isTestingScreenCapture || !screenRecordingStatus?.granted}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 disabled:opacity-50 text-white rounded-lg font-medium"
              >
                {isTestingScreenCapture ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Capturing Screen...
                  </>
                ) : (
                  <>
                    <Eye className="w-5 h-5" />
                    {screenRecordingStatus?.granted
                      ? "Test Screen Capture + OCR"
                      : "Screen Recording Permission Required"}
                  </>
                )}
              </button>

              {screenCaptureResult && (
                <div
                  className={`p-4 rounded-lg ${screenCaptureResult.success ? "bg-green-500/20" : "bg-red-500/20"}`}
                >
                  <div className="font-medium text-white mb-2">
                    {screenCaptureResult.success
                      ? "✅ Screen Capture Successful!"
                      : "❌ Screen Capture Failed"}
                  </div>
                  {screenCaptureResult.imagePath && (
                    <div className="text-sm text-gray-300">
                      Saved to: {screenCaptureResult.imagePath}
                    </div>
                  )}
                  {screenCaptureResult.ocr?.success && (
                    <div className="mt-2 p-2 bg-black/30 rounded text-xs text-gray-300 max-h-32 overflow-y-auto">
                      <strong>OCR Text ({screenCaptureResult.ocr.wordCount} words):</strong>
                      <pre className="whitespace-pre-wrap mt-1">
                        {screenCaptureResult.ocr.text?.substring(0, 500)}...
                      </pre>
                    </div>
                  )}
                  {screenCaptureResult.error && (
                    <div className="text-sm text-red-300">{screenCaptureResult.error}</div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Troubleshooting */}
          <section>
            <button
              onClick={loadTroubleshooting}
              className="text-lg font-semibold text-white mb-3 flex items-center gap-2 hover:text-purple-400"
            >
              <AlertCircle className="w-5 h-5 text-yellow-400" />
              Troubleshooting Guide
              <span className="text-sm text-gray-500">(click to load)</span>
            </button>
            {troubleshooting && (
              <div className="bg-gray-800/50 rounded-lg p-4 space-y-4">
                {troubleshooting.instructions?.map((section, i) => (
                  <div key={i}>
                    <h4 className="font-medium text-white mb-2">{section.title}</h4>
                    {section.description && (
                      <p className="text-gray-400 text-sm mb-2">{section.description}</p>
                    )}
                    <ol className="list-decimal list-inside space-y-1 text-gray-300 text-sm">
                      {section.steps?.map((step, j) => (
                        <li key={j}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default PermissionDiagnostic;
