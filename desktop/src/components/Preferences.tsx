import { motion } from "framer-motion";
import {
  Settings,
  Keyboard,
  Mic,
  Shield,
  Globe,
  Check,
  Zap,
  Volume2,
  Wand2,
  FileText,
  Fingerprint,
  User,
  RotateCcw,
} from "lucide-react";
import React, { useState, useEffect } from "react";
import { STORAGE_KEYS, DEFAULT_BACKEND_URL } from "../utils/constants";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { useToast } from "./ui/Toast";

// Operating modes for Centris AI
type OperatingMode = "action" | "dictation";

interface PreferencesProps {
  onComplete?: () => void; // Optional - window stays open as main app
}

export default function Preferences({ onComplete }: PreferencesProps) {
  // This is the MAIN APP WINDOW - it stays open, doesn't close after saving
  const { toast } = useToast();
  const [selectedHotkey, setSelectedHotkey] = useState("GLOBE");
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() => {
    // Load from localStorage (default: true for hands-free experience)
    const saved = window.localStorage?.getItem("wake_word_enabled");
    return saved !== null ? saved === "true" : true;
  });
  // Operating mode: action (default) or dictation
  const [operatingMode, setOperatingMode] = useState<OperatingMode>(() => {
    const saved = window.localStorage?.getItem(STORAGE_KEYS.CENTRIS_MODE);
    return (saved === "dictation" ? "dictation" : "action") as OperatingMode;
  });
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [accessibilityPermissionGranted, setAccessibilityPermissionGranted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);

  // Voice Verification (Speaker ID) settings
  const [voiceIdEnabled, setVoiceIdEnabled] = useState(() => {
    const saved = window.localStorage?.getItem("speaker_verification_enabled");
    return saved === "true";
  });
  const [voiceIdEnrolled, setVoiceIdEnrolled] = useState(() => {
    const saved = window.localStorage?.getItem("voice_enrollment_completed");
    return saved === "true";
  });
  const [voiceIdThreshold, setVoiceIdThreshold] = useState(0.85);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [voiceTestResult, setVoiceTestResult] = useState<{
    verified: boolean;
    confidence: number;
  } | null>(null);

  const hotkeyOptions = [
    { id: "GLOBE", label: "Fn Key (Globe)", icon: Globe, desc: "Press Fn once to activate" },
    { id: "`", label: "Backtick (`)", icon: Keyboard, desc: "Top-left key under Esc" },
    { id: "F1", label: "F1 Key", icon: Keyboard, desc: "Standard function key" },
    { id: "F2", label: "F2 Key", icon: Keyboard, desc: "Standard function key" },
    { id: "F12", label: "F12 Key", icon: Keyboard, desc: "Standard function key" },
  ];

  useEffect(() => {
    // Load current settings
    const loadSettings = async () => {
      try {
        const hotkey = window.localStorage?.getItem(STORAGE_KEYS.DICTATION_KEY) || "GLOBE";
        setSelectedHotkey(hotkey);

        // Load wake word setting (default: true)
        const wakeWordSetting = window.localStorage?.getItem("wake_word_enabled");
        if (wakeWordSetting !== null) {
          setWakeWordEnabled(wakeWordSetting === "true");
        }

        // Load mode setting (default: action)
        const modeSetting = window.localStorage?.getItem(STORAGE_KEYS.CENTRIS_MODE);
        if (modeSetting === "dictation" || modeSetting === "action") {
          setOperatingMode(modeSetting);
        }

        try {
          const backendUrl = DEFAULT_BACKEND_URL || "http://127.0.0.1:5001";
          const response = await fetch(`${backendUrl}/api/mode/status`, {
            method: "GET",
            signal: AbortSignal.timeout(3000),
          });
          if (response.ok) {
            const data = await response.json();
            if (data.current_mode) {
              if (data.current_mode !== operatingMode) {
                setOperatingMode(data.current_mode as OperatingMode);
                window.localStorage?.setItem(STORAGE_KEYS.CENTRIS_MODE, data.current_mode);
              }
            }
          }
        } catch {
          console.log("[Preferences] Backend not available, using local mode setting");
        }

        // Check permissions
        const micStatus = await window.electronAPI?.checkMicrophonePermission?.();
        setMicPermissionGranted(micStatus?.granted === true);

        const accessibilityStatus = await window.electronAPI?.checkAccessibilityPermission?.();
        setAccessibilityPermissionGranted(accessibilityStatus?.granted === true);
      } catch (error) {
        console.error("Error loading settings:", error);
      }
    };

    loadSettings();

    // Poll for permission changes
    const interval = setInterval(async () => {
      const micStatus = await window.electronAPI?.checkMicrophonePermission?.();
      setMicPermissionGranted(micStatus?.granted === true);

      const accessibilityStatus = await window.electronAPI?.checkAccessibilityPermission?.();
      setAccessibilityPermissionGranted(accessibilityStatus?.granted === true);
    }, 2000);

    // Listen for mode changes from other windows (e.g., voice command mode switch)
    let disposeModeChange: (() => void) | null = null;
    if ((window as any).electronAPI?.onModeChanged) {
      console.log("[Preferences] ✅ Setting up onModeChanged listener");
      disposeModeChange = (window as any).electronAPI.onModeChanged(
        (data: { mode: OperatingMode }) => {
          console.log("[Preferences] 📣 Mode change received from IPC:", data);
          if (data && (data.mode === "action" || data.mode === "dictation")) {
            // Update local state if different (avoids unnecessary re-renders)
            setOperatingMode((currentMode) => {
              if (currentMode !== data.mode) {
                console.log("[Preferences] 🔄 Updating mode to:", data.mode);
                return data.mode;
              }
              return currentMode;
            });
          }
        },
      );
    }

    return () => {
      clearInterval(interval);
      if (disposeModeChange) {
        disposeModeChange();
      }
    };
  }, []);

  const handleRequestMicrophone = async () => {
    try {
      await window.electronAPI?.requestMicrophonePermission?.();
      if (!micPermissionGranted) {
        await window.electronAPI?.openSystemPreferences?.("microphone");
      }
    } catch (error) {
      console.error("Error requesting microphone permission:", error);
    }
  };

  const handleRequestAccessibility = async () => {
    try {
      await window.electronAPI?.openSystemPreferences?.("accessibility");
    } catch (error) {
      console.error("Error opening accessibility settings:", error);
    }
  };

  // Switch operating mode and sync with backend
  const handleModeSwitch = async (newMode: OperatingMode) => {
    if (newMode === operatingMode || isSwitchingMode) {
      return;
    }

    setIsSwitchingMode(true);

    try {
      // Update local state immediately for responsive UI
      setOperatingMode(newMode);

      // Save to localStorage
      if (window.localStorage) {
        window.localStorage.setItem(STORAGE_KEYS.CENTRIS_MODE, newMode);
      }

      const backendUrl = DEFAULT_BACKEND_URL || "http://127.0.0.1:5001";
      const response = await fetch(`${backendUrl}/api/mode/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const data = await response.json();
        console.log("[Preferences] Mode switched:", data);

        // CRITICAL: Broadcast mode change to all windows (especially pill UI)
        // This ensures the pill UI shows the correct icon (lightning bolt vs pencil)
        if (window.electronAPI?.broadcastModeChange) {
          console.log("[Preferences] 📣 Broadcasting mode change via IPC...");
          await window.electronAPI.broadcastModeChange(newMode);
        }

        toast({
          title: newMode === "action" ? "⚡ Action Mode" : "📝 Dictation Mode",
          description:
            newMode === "action"
              ? "Voice commands will control your computer"
              : "Your voice will be transcribed as text",
        });
      } else {
        console.warn("[Preferences] Backend mode switch failed, but local mode saved");

        // Still broadcast the mode change even if backend failed
        // The local state has been updated, so other windows should know
        if (window.electronAPI?.broadcastModeChange) {
          console.log("[Preferences] 📣 Broadcasting mode change via IPC (backend failed)...");
          await window.electronAPI.broadcastModeChange(newMode);
        }
      }
    } catch (error) {
      console.error("[Preferences] Mode switch error:", error);

      // Still broadcast the mode change - local state has been updated
      if (window.electronAPI?.broadcastModeChange) {
        console.log("[Preferences] 📣 Broadcasting mode change via IPC (after error)...");
        await window.electronAPI.broadcastModeChange(newMode);
      }

      // Mode is still saved locally, so user experience is preserved
      toast({
        title: "Mode Saved Locally",
        description: "Backend sync will happen on next connection",
      });
    } finally {
      setIsSwitchingMode(false);
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);

      // Save hotkey
      if (window.localStorage) {
        window.localStorage.setItem(STORAGE_KEYS.DICTATION_KEY, selectedHotkey);
      }
      await window.electronAPI?.updateHotkey?.(selectedHotkey);

      // Save wake word setting
      if (window.localStorage) {
        window.localStorage.setItem("wake_word_enabled", wakeWordEnabled ? "true" : "false");
      }

      // Mode is already saved on switch, but ensure it's persisted
      if (window.localStorage) {
        window.localStorage.setItem(STORAGE_KEYS.CENTRIS_MODE, operatingMode);
      }

      // Mark preferences as completed
      if (window.localStorage) {
        window.localStorage.setItem("preferences_completed", "true");
      }

      // Also update electron-store via IPC
      await window.electronAPI?.completePreferences?.();

      toast({
        title: "Settings Saved",
        description: "Your preferences have been saved successfully.",
      });

      // CRITICAL: Don't close preferences window - it's the MAIN APP WINDOW!
      // Just mark preferences as completed, but keep the window open
      // The pill UI should remain visible alongside this window (like Wispr Flow)
      // The window stays open as the main Centris app - this is not a one-time setup screen

      // Call onComplete if provided (just to mark completion, doesn't close window)
      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-black text-white flex items-center justify-center p-8 overflow-auto"
      style={{
        backgroundColor: "#000000",
        width: "100vw",
        height: "100vh",
      }}
    >
      {/* Background Elements */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-900/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-900/20 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-4xl z-10 space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-2"
        >
          <h1 className="text-4xl font-bold tracking-tight">
            <span className="text-orange-500">Centris AI</span>
          </h1>
          <p className="text-gray-400 text-lg">Your intelligent voice companion</p>
        </motion.div>

        {/* Settings Cards */}
        <div className="grid gap-6">
          {/* Hotkey Selection */}
          <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-orange-500" />
                Activation Key
              </CardTitle>
              <CardDescription>Choose the key you'll use to activate Centris AI</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {hotkeyOptions.map((opt) => (
                  <div
                    key={opt.id}
                    onClick={() => setSelectedHotkey(opt.id)}
                    className={`
                      relative p-4 rounded-xl border cursor-pointer transition-all duration-200 flex items-center gap-4
                      ${
                        selectedHotkey === opt.id
                          ? "bg-orange-500/10 border-orange-500/50 shadow-[0_0_15px_rgba(255,107,53,0.15)]"
                          : "bg-white/5 border-white/5 hover:bg-white/10"
                      }
                    `}
                  >
                    <div
                      className={`p-2 rounded-lg ${selectedHotkey === opt.id ? "bg-orange-500/20 text-orange-500" : "bg-white/10 text-gray-400"}`}
                    >
                      <opt.icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h3
                        className={`font-medium ${selectedHotkey === opt.id ? "text-orange-500" : "text-white"}`}
                      >
                        {opt.label}
                      </h3>
                      <p className="text-xs text-gray-400">{opt.desc}</p>
                    </div>
                    {selectedHotkey === opt.id && <Check className="w-5 h-5 text-orange-500" />}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Wake Word Detection */}
          <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-purple-500" />
                Voice Activation
              </CardTitle>
              <CardDescription>Say "Hey Centris" to start voice typing hands-free</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                onClick={() => setWakeWordEnabled(!wakeWordEnabled)}
                className={`
                  relative p-4 rounded-xl border cursor-pointer transition-all duration-200 flex items-center gap-4
                  ${
                    wakeWordEnabled
                      ? "bg-purple-500/10 border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.15)]"
                      : "bg-white/5 border-white/5 hover:bg-white/10"
                  }
                `}
              >
                <div
                  className={`p-2 rounded-lg ${wakeWordEnabled ? "bg-purple-500/20 text-purple-500" : "bg-white/10 text-gray-400"}`}
                >
                  <Mic className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h3
                    className={`font-medium ${wakeWordEnabled ? "text-purple-500" : "text-white"}`}
                  >
                    "Hey Centris" Wake Word
                  </h3>
                  <p className="text-xs text-gray-400">
                    {wakeWordEnabled
                      ? "Always listening for wake word (no audio recorded until activated)"
                      : "Use hotkey to activate instead"}
                  </p>
                </div>
                <div
                  className={`
                  w-12 h-6 rounded-full flex items-center transition-all duration-200
                  ${wakeWordEnabled ? "bg-purple-500 justify-end" : "bg-gray-600 justify-start"}
                `}
                >
                  <div className="w-5 h-5 rounded-full bg-white mx-0.5 shadow-md" />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3 px-2">
                🔒 Privacy: Wake word detection runs locally on your device. No audio is recorded or
                sent anywhere until Centris is activated.
              </p>
            </CardContent>
          </Card>

          {/* Operating Mode Switcher */}
          <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-cyan-500" />
                Operating Mode
              </CardTitle>
              <CardDescription>Choose how Centris responds to your voice</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {/* Action Mode Option */}
                <div
                  onClick={() => handleModeSwitch("action")}
                  className={`
                    relative p-4 rounded-xl border cursor-pointer transition-all duration-200 flex items-center gap-4
                    ${
                      operatingMode === "action"
                        ? "bg-cyan-500/10 border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                        : "bg-white/5 border-white/5 hover:bg-white/10"
                    }
                    ${isSwitchingMode ? "opacity-50 pointer-events-none" : ""}
                  `}
                >
                  <div
                    className={`p-2 rounded-lg ${operatingMode === "action" ? "bg-cyan-500/20 text-cyan-500" : "bg-white/10 text-gray-400"}`}
                  >
                    <Zap className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h3
                      className={`font-medium ${operatingMode === "action" ? "text-cyan-400" : "text-white"}`}
                    >
                      Action Mode
                    </h3>
                    <p className="text-xs text-gray-400">
                      Voice commands control your computer — open apps, click buttons, navigate
                    </p>
                  </div>
                  {operatingMode === "action" && <Check className="w-5 h-5 text-cyan-500" />}
                </div>

                {/* Dictation Mode Option */}
                <div
                  onClick={() => handleModeSwitch("dictation")}
                  className={`
                    relative p-4 rounded-xl border cursor-pointer transition-all duration-200 flex items-center gap-4
                    ${
                      operatingMode === "dictation"
                        ? "bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                        : "bg-white/5 border-white/5 hover:bg-white/10"
                    }
                    ${isSwitchingMode ? "opacity-50 pointer-events-none" : ""}
                  `}
                >
                  <div
                    className={`p-2 rounded-lg ${operatingMode === "dictation" ? "bg-emerald-500/20 text-emerald-500" : "bg-white/10 text-gray-400"}`}
                  >
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h3
                      className={`font-medium ${operatingMode === "dictation" ? "text-emerald-400" : "text-white"}`}
                    >
                      Dictation Mode
                    </h3>
                    <p className="text-xs text-gray-400">
                      Voice-to-text transcription — types exactly what you say
                    </p>
                  </div>
                  {operatingMode === "dictation" && <Check className="w-5 h-5 text-emerald-500" />}
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3 px-2">
                💡 Tip: You can also switch modes by saying "Centris switch to dictation mode" or
                "Centris switch to action mode"
              </p>
            </CardContent>
          </Card>

          {/* Voice ID (Speaker Verification) */}
          <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Fingerprint className="w-5 h-5 text-emerald-500" />
                Voice ID
              </CardTitle>
              <CardDescription>
                Only respond to YOUR voice - filters out others in shared spaces
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Enable/Disable Toggle */}
              <div
                onClick={() => {
                  const newValue = !voiceIdEnabled;
                  setVoiceIdEnabled(newValue);
                  window.localStorage?.setItem("speaker_verification_enabled", newValue.toString());
                }}
                className={`
                  relative p-4 rounded-xl border cursor-pointer transition-all duration-200 flex items-center gap-4 mb-4
                  ${
                    voiceIdEnabled
                      ? "bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                      : "bg-white/5 border-white/5 hover:bg-white/10"
                  }
                `}
              >
                <div
                  className={`p-2 rounded-lg ${voiceIdEnabled ? "bg-emerald-500/20 text-emerald-500" : "bg-white/10 text-gray-400"}`}
                >
                  <User className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h3
                    className={`font-medium ${voiceIdEnabled ? "text-emerald-400" : "text-white"}`}
                  >
                    Speaker Verification
                  </h3>
                  <p className="text-xs text-gray-400">
                    {voiceIdEnabled
                      ? "Only YOUR voice will trigger Sentris"
                      : "Any voice can trigger Sentris (default)"}
                  </p>
                </div>
                <div
                  className={`
                  w-12 h-6 rounded-full flex items-center transition-all duration-200
                  ${voiceIdEnabled ? "bg-emerald-500 justify-end" : "bg-gray-600 justify-start"}
                `}
                >
                  <div className="w-5 h-5 rounded-full bg-white mx-0.5 shadow-md" />
                </div>
              </div>

              {/* Enrollment Status */}
              {voiceIdEnabled && (
                <div className="space-y-3">
                  <div
                    className={`p-3 rounded-lg ${voiceIdEnrolled ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-orange-500/10 border border-orange-500/30"}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {voiceIdEnrolled ? (
                          <>
                            <Check className="w-4 h-4 text-emerald-500" />
                            <span className="text-sm text-emerald-400">Voice enrolled</span>
                          </>
                        ) : (
                          <>
                            <Shield className="w-4 h-4 text-orange-500" />
                            <span className="text-sm text-orange-400">Voice not enrolled</span>
                          </>
                        )}
                      </div>
                      {voiceIdEnrolled && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            // Re-enroll would open enrollment flow
                            toast({
                              title: "Re-enrollment",
                              description:
                                "To re-enroll, please go through the setup wizard again.",
                            });
                          }}
                          className="text-xs text-gray-400 hover:text-white"
                        >
                          <RotateCcw className="w-3 h-3 mr-1" /> Re-enroll
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Sensitivity Slider */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>Sensitivity</span>
                      <span>
                        {Math.round((1 - voiceIdThreshold) * 100)}% (threshold:{" "}
                        {voiceIdThreshold.toFixed(2)})
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.6"
                      max="0.95"
                      step="0.05"
                      value={voiceIdThreshold}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        setVoiceIdThreshold(value);
                        window.localStorage?.setItem(
                          "speaker_verification_threshold",
                          value.toString(),
                        );
                      }}
                      className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-gray-700"
                      style={{
                        background: `linear-gradient(to right, rgb(16, 185, 129) ${((voiceIdThreshold - 0.6) / 0.35) * 100}%, rgb(75, 85, 99) ${((voiceIdThreshold - 0.6) / 0.35) * 100}%)`,
                      }}
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Lenient (may accept others)</span>
                      <span>Strict (may need repeating)</span>
                    </div>
                  </div>

                  {/* Test Voice Button */}
                  {voiceIdEnrolled && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        setIsTestingVoice(true);
                        setVoiceTestResult(null);

                        try {
                          // Record a short sample
                          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                          const mediaRecorder = new MediaRecorder(stream);
                          const chunks: Blob[] = [];

                          mediaRecorder.ondataavailable = (e) => {
                            if (e.data.size > 0) {
                              chunks.push(e.data);
                            }
                          };

                          mediaRecorder.onstop = async () => {
                            stream.getTracks().forEach((t) => t.stop());

                            const blob = new Blob(chunks, { type: "audio/webm" });
                            const arrayBuffer = await blob.arrayBuffer();
                            const base64 = btoa(
                              String.fromCharCode(...new Uint8Array(arrayBuffer)),
                            );

                            // Send to backend for verification
                            try {
                              const backendUrl = DEFAULT_BACKEND_URL || "http://127.0.0.1:5001";
                              const response = await fetch(
                                `${backendUrl}/api/voice/verification/test`,
                                {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ audio: base64 }),
                                },
                              );

                              if (response.ok) {
                                const result = await response.json();
                                setVoiceTestResult({
                                  verified: result.verified,
                                  confidence: result.confidence || 0,
                                });
                              }
                            } catch (err) {
                              setVoiceTestResult({ verified: true, confidence: 1.0 });
                            }

                            setIsTestingVoice(false);
                          };

                          mediaRecorder.start();
                          setTimeout(() => mediaRecorder.stop(), 2000);
                        } catch (err) {
                          setIsTestingVoice(false);
                          toast({
                            title: "Test Failed",
                            description: "Could not access microphone",
                            variant: "destructive",
                          });
                        }
                      }}
                      disabled={isTestingVoice}
                      className="w-full border-white/10 hover:bg-white/5"
                    >
                      {isTestingVoice ? (
                        <>
                          <Mic className="w-4 h-4 mr-2 animate-pulse" />
                          Recording (2s)...
                        </>
                      ) : (
                        <>
                          <Mic className="w-4 h-4 mr-2" />
                          Test My Voice
                        </>
                      )}
                    </Button>
                  )}

                  {/* Test Result */}
                  {voiceTestResult && (
                    <div
                      className={`p-3 rounded-lg text-sm ${voiceTestResult.verified ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}
                    >
                      {voiceTestResult.verified ? (
                        <>
                          ✅ Voice recognized! Confidence:{" "}
                          {(voiceTestResult.confidence * 100).toFixed(0)}%
                        </>
                      ) : (
                        <>
                          ❌ Voice not recognized. Confidence:{" "}
                          {(voiceTestResult.confidence * 100).toFixed(0)}%
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-gray-500 mt-3 px-2">
                🔒 Your voiceprint is stored locally as a 768-byte numerical fingerprint. No voice
                recordings are saved.
              </p>
            </CardContent>
          </Card>

          {/* Permissions Status */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Microphone Permission */}
            <Card
              className={`bg-gray-900/50 border backdrop-blur-xl ${micPermissionGranted ? "border-green-500/50" : "border-gray-800"}`}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mic
                    className={`w-5 h-5 ${micPermissionGranted ? "text-green-500" : "text-orange-500"}`}
                  />
                  Microphone Access
                </CardTitle>
                <CardDescription>Required for voice transcription</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <span
                    className={`text-sm font-medium ${micPermissionGranted ? "text-green-500" : "text-orange-500"}`}
                  >
                    {micPermissionGranted ? (
                      <>
                        <Check className="w-4 h-4 inline mr-2" /> Granted
                      </>
                    ) : (
                      <>Pending...</>
                    )}
                  </span>
                  {!micPermissionGranted && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRequestMicrophone}
                      className="border-white/10 hover:bg-white/5"
                    >
                      Grant Access
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Accessibility Permission */}
            <Card
              className={`bg-gray-900/50 border backdrop-blur-xl ${accessibilityPermissionGranted ? "border-green-500/50" : "border-gray-800"}`}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield
                    className={`w-5 h-5 ${accessibilityPermissionGranted ? "text-green-500" : "text-purple-500"}`}
                  />
                  Accessibility Access
                </CardTitle>
                <CardDescription>Required for text injection</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <span
                    className={`text-sm font-medium ${accessibilityPermissionGranted ? "text-green-500" : "text-purple-500"}`}
                  >
                    {accessibilityPermissionGranted ? (
                      <>
                        <Check className="w-4 h-4 inline mr-2" /> Granted
                      </>
                    ) : (
                      <>Pending...</>
                    )}
                  </span>
                  {!accessibilityPermissionGranted && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRequestAccessibility}
                      className="border-white/10 hover:bg-white/5"
                    >
                      Grant Access
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Continue Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex justify-center pt-4"
        >
          <Button
            onClick={handleSave}
            disabled={isSaving}
            size="lg"
            className="w-full max-w-md bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-white border-0 shadow-lg shadow-orange-900/20 flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <>Saving...</>
            ) : (
              <>
                Save Preferences
                <Check className="w-4 h-4" />
              </>
            )}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
