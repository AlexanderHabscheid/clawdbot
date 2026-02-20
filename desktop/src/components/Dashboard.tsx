import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Activity,
  Settings,
  Mic,
  Volume2,
  Globe,
  Shield,
  Keyboard,
  FileText,
  Check,
  Zap,
  Type,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  Clock,
  Command,
} from "lucide-react";
import React, { useState, useEffect } from "react";
import { STORAGE_KEYS, DEFAULT_BACKEND_URL } from "../utils/constants";
import GalaxyBackground from "./GalaxyBackground";
import PermissionDiagnostic from "./PermissionDiagnostic";
import { useToast } from "./ui/Toast";

interface DashboardProps {
  onOpenSettings?: () => void;
}

interface ActivityItem {
  id: string;
  command: string;
  mode: "action" | "dictation";
  timestamp: Date;
  status: "success" | "failed" | "pending";
  duration_ms?: number;
}

type OperatingMode = "action" | "dictation";

const hotkeyOptions = [
  { id: "GLOBE", label: "Fn Key", icon: Globe, desc: "Globe/Fn key" },
  { id: "`", label: "Backtick", icon: Command, desc: "Under Esc key" },
  { id: "F1", label: "F1", icon: Keyboard, desc: "Function key" },
  { id: "F2", label: "F2", icon: Keyboard, desc: "Function key" },
];

// Navigation item component
const NavItem: React.FC<{
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ icon: Icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 text-sm ${
      active ? "bg-white/10 text-white" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
    }`}
  >
    <Icon className="w-4 h-4" />
    <span className="font-medium">{label}</span>
  </button>
);

// Status indicator component
const StatusIndicator: React.FC<{
  status: "connected" | "disconnected" | "checking";
  label: string;
}> = ({ status, label }) => (
  <div className="flex items-center gap-2">
    <div
      className={`w-1.5 h-1.5 rounded-full ${
        status === "connected"
          ? "bg-emerald-400"
          : status === "checking"
            ? "bg-yellow-400 animate-pulse"
            : "bg-zinc-600"
      }`}
    />
    <span className="text-xs text-zinc-500">{label}</span>
  </div>
);

const Dashboard: React.FC<DashboardProps> = ({ onOpenSettings }) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(true);

  const [backendStatus, setBackendStatus] = useState<"connected" | "disconnected" | "checking">(
    "checking",
  );
  const [runtimeAuthorityStatus, setRuntimeAuthorityStatus] = useState<
    "connected" | "disconnected" | "checking"
  >("checking");

  const [selectedHotkey, setSelectedHotkey] = useState("GLOBE");
  const [wakeWordEnabled, setWakeWordEnabled] = useState(true);
  const [operatingMode, setOperatingMode] = useState<OperatingMode>("action");
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [accessibilityPermissionGranted, setAccessibilityPermissionGranted] = useState(false);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const [isProbingRuntime, setIsProbingRuntime] = useState(false);
  const [routeIntent, setRouteIntent] = useState("dashboard.manual");
  const [lastRouteId, setLastRouteId] = useState("");
  const [isRecordingRoute, setIsRecordingRoute] = useState(false);
  const [isRouteBusy, setIsRouteBusy] = useState(false);

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const backendUrl = DEFAULT_BACKEND_URL || "http://127.0.0.1:5001";
        const response = await fetch(`${backendUrl}/api/health`, {
          method: "GET",
          signal: AbortSignal.timeout(3000),
        });
        setBackendStatus(response.ok ? "connected" : "disconnected");
      } catch {
        setBackendStatus("disconnected");
      }

      try {
        if (window.electronAPI?.observeRuntime) {
          const result = await window.electronAPI.observeRuntime({
            instruction: "dashboard runtime health probe",
          });
          setRuntimeAuthorityStatus(result?.ok === true ? "connected" : "disconnected");
        } else {
          setRuntimeAuthorityStatus("disconnected");
        }
      } catch {
        setRuntimeAuthorityStatus("disconnected");
      }
    };

    checkBackend();
    const interval = setInterval(checkBackend, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadActivities = async () => {
      setIsLoadingActivities(true);
      try {
        const history = await window.electronAPI?.getTranscriptionHistory?.();
        if (history && Array.isArray(history)) {
          const mapped: ActivityItem[] = history.slice(0, 20).map((item: any, index: number) => ({
            id: item.id?.toString() || `activity-${index}`,
            command: item.original_text || item.text || "Unknown command",
            mode: item.is_processed ? "action" : "dictation",
            timestamp: new Date(item.timestamp || Date.now()),
            status: "success" as const,
            duration_ms: item.duration_ms,
          }));
          setActivities(mapped);
        }
      } catch (error) {
        console.error("[Dashboard] Error loading activities:", error);
      } finally {
        setIsLoadingActivities(false);
      }
    };

    loadActivities();
  }, []);

  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const hotkey = window.localStorage?.getItem(STORAGE_KEYS.DICTATION_KEY) || "GLOBE";
        setSelectedHotkey(hotkey);

        const wakeWordSetting = window.localStorage?.getItem("wake_word_enabled");
        if (wakeWordSetting !== null) {
          setWakeWordEnabled(wakeWordSetting === "true");
        }

        const modeSetting = window.localStorage?.getItem(STORAGE_KEYS.CENTRIS_MODE);
        if (modeSetting === "dictation" || modeSetting === "action") {
          setOperatingMode(modeSetting);
        }

        try {
          const backendUrl = DEFAULT_BACKEND_URL || "http://127.0.0.1:5001";
          const response = await fetch(`${backendUrl}/api/mode/status`, { method: "GET" });
          if (response.ok) {
            const data = await response.json();
            if (data.current_mode) {
              setOperatingMode(data.current_mode as OperatingMode);
              window.localStorage?.setItem(STORAGE_KEYS.CENTRIS_MODE, data.current_mode);
            }
          }
        } catch {
          // Use local setting
        }

        const micStatus = await window.electronAPI?.checkMicrophonePermission?.();
        setMicPermissionGranted(micStatus?.granted === true);

        const accessibilityStatus = await window.electronAPI?.checkAccessibilityPermission?.();
        setAccessibilityPermissionGranted(accessibilityStatus?.granted === true);
      } catch (error) {
        console.error("Error loading preferences:", error);
      }
    };

    loadPreferences();

    const interval = setInterval(async () => {
      const micStatus = await window.electronAPI?.checkMicrophonePermission?.();
      setMicPermissionGranted(micStatus?.granted === true);
      const accessibilityStatus = await window.electronAPI?.checkAccessibilityPermission?.();
      setAccessibilityPermissionGranted(accessibilityStatus?.granted === true);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const handleHotkeyChange = async (hotkey: string) => {
    setSelectedHotkey(hotkey);
    window.localStorage?.setItem(STORAGE_KEYS.DICTATION_KEY, hotkey);
    await window.electronAPI?.updateHotkey?.(hotkey);
    toast({
      title: "Hotkey updated",
      description: `Now using ${hotkeyOptions.find((opt) => opt.id === hotkey)?.label || hotkey}`,
    });
  };

  const handleWakeWordToggle = () => {
    const newValue = !wakeWordEnabled;
    setWakeWordEnabled(newValue);
    window.localStorage?.setItem("wake_word_enabled", newValue ? "true" : "false");
    toast({
      title: newValue ? "Wake word enabled" : "Wake word disabled",
      description: newValue ? 'Say "Hey Centris" to activate' : "Use hotkey to activate",
    });
  };

  const handleModeSwitch = async (newMode: OperatingMode) => {
    if (newMode === operatingMode || isSwitchingMode) {
      return;
    }

    setIsSwitchingMode(true);

    try {
      setOperatingMode(newMode);
      window.localStorage?.setItem(STORAGE_KEYS.CENTRIS_MODE, newMode);

      const backendUrl = DEFAULT_BACKEND_URL || "http://127.0.0.1:5001";
      await fetch(`${backendUrl}/api/mode/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });

      toast({
        title: newMode === "action" ? "Action Mode" : "Dictation Mode",
        description:
          newMode === "action"
            ? "Voice commands control your computer"
            : "Voice will be transcribed as text",
      });
    } catch {
      toast({
        title: "Mode saved locally",
        description: "Will sync when connected",
      });
    } finally {
      setIsSwitchingMode(false);
    }
  };

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

  const handleRuntimeProbe = async () => {
    if (isProbingRuntime) {
      return;
    }
    setIsProbingRuntime(true);
    try {
      const result = await window.electronAPI?.observeRuntime?.({
        instruction: "manual dashboard runtime probe",
      });
      if (result?.ok) {
        setRuntimeAuthorityStatus("connected");
        toast({
          title: "Runtime probe passed",
          description: "Bridge-first authority endpoint is responding.",
        });
      } else {
        setRuntimeAuthorityStatus("disconnected");
        toast({
          title: "Runtime probe failed",
          description: result?.error?.message || "Bridge authority endpoint is unavailable.",
          variant: "destructive",
        });
      }
    } catch (error) {
      setRuntimeAuthorityStatus("disconnected");
      toast({
        title: "Runtime probe failed",
        description: "Unable to reach authority endpoint.",
        variant: "destructive",
      });
    } finally {
      setIsProbingRuntime(false);
    }
  };

  const handleRouteRecordToggle = async () => {
    if (isRouteBusy) {
      return;
    }
    setIsRouteBusy(true);
    try {
      if (!isRecordingRoute) {
        const startResult = await window.electronAPI?.routeRecordStart?.({
          intent: routeIntent.trim() || "dashboard.manual",
        });
        if (startResult?.ok) {
          setIsRecordingRoute(true);
          toast({
            title: "Route recording started",
            description: "Perform browser actions, then stop recording.",
          });
        } else {
          toast({
            title: "Could not start recording",
            description: startResult?.error?.message || "Route recorder unavailable.",
            variant: "destructive",
          });
        }
        return;
      }

      const stopResult = await window.electronAPI?.routeRecordStop?.({});
      if (stopResult?.ok) {
        const routeId =
          (stopResult?.result as { routeId?: string } | undefined)?.routeId ||
          (stopResult?.result as { route?: { routeId?: string } } | undefined)?.route?.routeId ||
          "";
        if (routeId) {
          setLastRouteId(routeId);
        }
        setIsRecordingRoute(false);
        toast({
          title: "Route recording saved",
          description: routeId ? `Route id: ${routeId}` : "Route captured successfully.",
        });
      } else {
        toast({
          title: "Could not stop recording",
          description: stopResult?.error?.message || "Route recorder stop failed.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Route recording failed",
        description: "Unexpected runtime error while recording.",
        variant: "destructive",
      });
    } finally {
      setIsRouteBusy(false);
    }
  };

  const handleRunRoute = async () => {
    if (isRouteBusy || !lastRouteId) {
      return;
    }
    setIsRouteBusy(true);
    try {
      const runResult = await window.electronAPI?.routeRunRuntime?.({ routeId: lastRouteId });
      if (runResult?.ok) {
        toast({
          title: "Route executed",
          description: `Executed ${lastRouteId} via runtime authority.`,
        });
      } else {
        toast({
          title: "Route execution failed",
          description: runResult?.error?.message || "Failed to run recorded route.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Route execution failed",
        description: "Unexpected runtime error while running route.",
        variant: "destructive",
      });
    } finally {
      setIsRouteBusy(false);
    }
  };

  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) {
      return "Just now";
    }
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    if (hours < 24) {
      return `${hours}h ago`;
    }
    return `${days}d ago`;
  };

  return (
    <div className="min-h-screen bg-black text-white flex overflow-hidden relative">
      <GalaxyBackground
        mouseRepulsion
        mouseInteraction
        density={1}
        glowIntensity={0.3}
        saturation={0}
        hueShift={270}
        twinkleIntensity={0.3}
        rotationSpeed={0.05}
        repulsionStrength={2}
        starSpeed={0.3}
        speed={0.5}
        transparent={false}
      />

      {/* Sidebar - clean black/white */}
      <aside className="w-56 border-r border-white/5 bg-black/80 backdrop-blur-xl p-4 flex flex-col z-10">
        <div className="flex items-center gap-2.5 px-3 py-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
            <Zap className="w-4 h-4 text-black" />
          </div>
          <span className="font-semibold text-base tracking-tight text-white">Centris</span>
        </div>

        <nav className="space-y-1 flex-1">
          <NavItem
            icon={LayoutDashboard}
            label="Overview"
            active={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
          />
          <NavItem
            icon={Activity}
            label="History"
            active={activeTab === "activity"}
            onClick={() => setActiveTab("activity")}
          />
          <NavItem
            icon={Settings}
            label="Settings"
            active={activeTab === "settings"}
            onClick={() => {
              setActiveTab("settings");
              onOpenSettings?.();
            }}
          />
        </nav>

        <div className="pt-4 border-t border-white/5 space-y-3">
          <StatusIndicator
            status={backendStatus}
            label={
              backendStatus === "connected"
                ? "System ready"
                : backendStatus === "checking"
                  ? "Connecting..."
                  : "Offline"
            }
          />
          <StatusIndicator
            status={runtimeAuthorityStatus}
            label={
              runtimeAuthorityStatus === "connected"
                ? "Browser bridge ready"
                : runtimeAuthorityStatus === "checking"
                  ? "Checking bridge..."
                  : "Bridge offline"
            }
          />

          <div className="px-2 py-2 rounded-lg bg-white/5 border border-white/5">
            <p className="text-[11px] text-zinc-500">
              Press{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-zinc-400 font-mono text-[10px] mx-0.5">
                Fn
              </kbd>
              or say "Hey Centris"
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 z-10">
        <header className="h-12 border-b border-white/5 flex items-center justify-between px-6 bg-black/60 backdrop-blur-xl">
          <div className="text-sm text-zinc-500">
            <span className="capitalize font-medium text-white">{activeTab}</span>
          </div>
          <div
            className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 border ${
              operatingMode === "action"
                ? "bg-white/5 text-white border-white/10"
                : "bg-white/5 text-zinc-400 border-white/10"
            }`}
          >
            {operatingMode === "action" ? (
              <Zap className="w-3 h-3" />
            ) : (
              <Type className="w-3 h-3" />
            )}
            {operatingMode === "action" ? "Action" : "Dictation"}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto">
            <AnimatePresence mode="wait">
              {activeTab === "overview" && (
                <motion.div
                  key="overview"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-6"
                >
                  <div className="mb-2">
                    <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">
                      Welcome to Centris
                    </h1>
                    <p className="text-sm text-zinc-500">
                      Control your computer with voice commands
                    </p>
                  </div>

                  {/* System Status - clean black/white */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
                      <div className="flex items-center gap-2.5 mb-2">
                        {backendStatus === "connected" ? (
                          <CheckCircle2 className="w-5 h-5 text-white" />
                        ) : backendStatus === "checking" ? (
                          <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                        ) : (
                          <XCircle className="w-5 h-5 text-zinc-600" />
                        )}
                        <span className="text-sm font-medium text-white">System</span>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {backendStatus === "connected"
                          ? "All systems ready"
                          : backendStatus === "checking"
                            ? "Connecting..."
                            : "Offline mode"}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
                      <div className="flex items-center gap-2.5 mb-2">
                        {runtimeAuthorityStatus === "connected" ? (
                          <CheckCircle2 className="w-5 h-5 text-white" />
                        ) : runtimeAuthorityStatus === "checking" ? (
                          <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                        ) : (
                          <Globe className="w-5 h-5 text-zinc-600" />
                        )}
                        <span className="text-sm font-medium text-white">Browser Bridge</span>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {runtimeAuthorityStatus === "connected"
                          ? "Authority endpoint active"
                          : runtimeAuthorityStatus === "checking"
                            ? "Validating runtime..."
                            : "Extension disconnected"}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
                      <div className="flex items-center gap-2.5 mb-2">
                        {micPermissionGranted ? (
                          <CheckCircle2 className="w-5 h-5 text-white" />
                        ) : (
                          <Mic className="w-5 h-5 text-zinc-500" />
                        )}
                        <span className="text-sm font-medium text-white">Microphone</span>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {micPermissionGranted ? "Ready to listen" : "Permission needed"}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
                      <div className="flex items-center gap-2.5 mb-2">
                        {accessibilityPermissionGranted ? (
                          <CheckCircle2 className="w-5 h-5 text-white" />
                        ) : (
                          <Shield className="w-5 h-5 text-zinc-500" />
                        )}
                        <span className="text-sm font-medium text-white">Accessibility</span>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {accessibilityPermissionGranted
                          ? "Full control enabled"
                          : "Permission needed"}
                      </p>
                    </div>
                  </div>

                  {/* Quick Start */}
                  <div className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
                    <h2 className="text-sm font-medium text-white mb-3">Try saying...</h2>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        "Open Gmail",
                        "Take a screenshot",
                        "Search Google for...",
                        "Switch to dictation",
                      ].map((cmd, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors border border-white/5"
                        >
                          <Mic className="w-3 h-3 text-zinc-500" />
                          <span className="text-sm text-zinc-300">"{cmd}"</span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setActiveTab("activity")}
                      className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                    >
                      View command history <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Mode Selector - clean black/white */}
                  <div className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
                    <h2 className="text-sm font-medium text-white mb-3">Operating Mode</h2>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleModeSwitch("action")}
                        disabled={isSwitchingMode}
                        className={`p-3 rounded-lg border transition-all ${
                          operatingMode === "action"
                            ? "bg-white text-black border-white"
                            : "bg-white/[0.03] border-white/10 text-zinc-400 hover:bg-white/[0.06]"
                        } ${isSwitchingMode ? "opacity-50" : ""}`}
                      >
                        <Zap className="w-4 h-4 mb-1.5 mx-auto" />
                        <div className="text-sm font-medium">Action</div>
                        <div
                          className={`text-[10px] mt-0.5 ${operatingMode === "action" ? "text-black/60" : "text-zinc-500"}`}
                        >
                          Control your computer
                        </div>
                      </button>
                      <button
                        onClick={() => handleModeSwitch("dictation")}
                        disabled={isSwitchingMode}
                        className={`p-3 rounded-lg border transition-all ${
                          operatingMode === "dictation"
                            ? "bg-white text-black border-white"
                            : "bg-white/[0.03] border-white/10 text-zinc-400 hover:bg-white/[0.06]"
                        } ${isSwitchingMode ? "opacity-50" : ""}`}
                      >
                        <Type className="w-4 h-4 mb-1.5 mx-auto" />
                        <div className="text-sm font-medium">Dictation</div>
                        <div
                          className={`text-[10px] mt-0.5 ${operatingMode === "dictation" ? "text-black/60" : "text-zinc-500"}`}
                        >
                          Voice to text
                        </div>
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "activity" && (
                <motion.div
                  key="activity"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-white">History</h2>
                    <p className="text-sm text-zinc-500 mt-0.5">Recent voice commands</p>
                  </div>

                  <div className="rounded-xl bg-white/[0.03] border border-white/5 overflow-hidden">
                    {isLoadingActivities ? (
                      <div className="p-8 text-center">
                        <Loader2 className="w-5 h-5 text-zinc-600 mx-auto mb-2 animate-spin" />
                        <p className="text-sm text-zinc-500">Loading...</p>
                      </div>
                    ) : activities.length > 0 ? (
                      activities.map((item, i) => (
                        <div
                          key={item.id}
                          className={`px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors ${
                            i !== activities.length - 1 ? "border-b border-white/5" : ""
                          }`}
                        >
                          <div className="w-7 h-7 rounded-md flex items-center justify-center bg-white/5">
                            {item.mode === "action" ? (
                              <Zap className="w-3.5 h-3.5 text-white" />
                            ) : (
                              <Type className="w-3.5 h-3.5 text-zinc-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{item.command}</p>
                            <p className="text-[11px] text-zinc-500">
                              {item.mode === "action" ? "Action" : "Dictation"}
                              {item.duration_ms && ` • ${(item.duration_ms / 1000).toFixed(1)}s`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {item.status === "success" && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-white/50" />
                            )}
                            <span className="text-[11px] text-zinc-600">
                              {formatRelativeTime(item.timestamp)}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-8 text-center">
                        <Clock className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                        <h3 className="text-sm font-medium text-zinc-500 mb-1">No history yet</h3>
                        <p className="text-xs text-zinc-600">Commands will appear here</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === "settings" && (
                <motion.div
                  key="settings"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-white">Settings</h2>
                    <p className="text-sm text-zinc-500 mt-0.5">Configure Centris</p>
                  </div>

                  {/* Activation Key */}
                  <div className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
                    <div className="flex items-center gap-2.5 mb-4">
                      <Keyboard className="w-4 h-4 text-zinc-400" />
                      <h3 className="text-sm font-medium text-white">Activation Key</h3>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {hotkeyOptions.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => handleHotkeyChange(opt.id)}
                          className={`p-3 rounded-lg border transition-all text-left ${
                            selectedHotkey === opt.id
                              ? "bg-white text-black border-white"
                              : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06]"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-sm font-medium ${selectedHotkey === opt.id ? "text-black" : "text-zinc-300"}`}
                            >
                              {opt.label}
                            </span>
                            {selectedHotkey === opt.id && (
                              <Check className="w-3.5 h-3.5 text-black" />
                            )}
                          </div>
                          <span
                            className={`text-[11px] ${selectedHotkey === opt.id ? "text-black/60" : "text-zinc-500"}`}
                          >
                            {opt.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Wake Word */}
                  <div className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Volume2 className="w-4 h-4 text-zinc-400" />
                        <div>
                          <h3 className="text-sm font-medium text-white">Voice Activation</h3>
                          <p className="text-[11px] text-zinc-500">Say "Hey Centris" to activate</p>
                        </div>
                      </div>
                      <button
                        onClick={handleWakeWordToggle}
                        className={`w-10 h-5 rounded-full flex items-center transition-all ${
                          wakeWordEnabled ? "bg-white justify-end" : "bg-zinc-700 justify-start"
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full mx-0.5 shadow ${wakeWordEnabled ? "bg-black" : "bg-white"}`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Permissions */}
                  <div className="grid grid-cols-2 gap-3">
                    <div
                      className={`p-4 rounded-xl border ${
                        micPermissionGranted
                          ? "bg-white/[0.03] border-white/10"
                          : "bg-white/[0.03] border-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Mic
                          className={`w-4 h-4 ${micPermissionGranted ? "text-white" : "text-zinc-500"}`}
                        />
                        <span className="text-sm font-medium text-white">Microphone</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs ${micPermissionGranted ? "text-zinc-400" : "text-zinc-500"}`}
                        >
                          {micPermissionGranted ? "Granted" : "Required"}
                        </span>
                        {!micPermissionGranted && (
                          <button
                            onClick={handleRequestMicrophone}
                            className="text-xs text-zinc-400 hover:text-white transition-colors"
                          >
                            Grant
                          </button>
                        )}
                      </div>
                    </div>

                    <div
                      className={`p-4 rounded-xl border ${
                        accessibilityPermissionGranted
                          ? "bg-white/[0.03] border-white/10"
                          : "bg-white/[0.03] border-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Shield
                          className={`w-4 h-4 ${accessibilityPermissionGranted ? "text-white" : "text-zinc-500"}`}
                        />
                        <span className="text-sm font-medium text-white">Accessibility</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs ${accessibilityPermissionGranted ? "text-zinc-400" : "text-zinc-500"}`}
                        >
                          {accessibilityPermissionGranted ? "Granted" : "Required"}
                        </span>
                        {!accessibilityPermissionGranted && (
                          <button
                            onClick={handleRequestAccessibility}
                            className="text-xs text-zinc-400 hover:text-white transition-colors"
                          >
                            Grant
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Runtime Authority Controls */}
                  <div className="p-5 rounded-xl bg-white/[0.03] border border-white/5 space-y-3">
                    <div className="flex items-center gap-2.5">
                      <Globe className="w-4 h-4 text-zinc-400" />
                      <h3 className="text-sm font-medium text-white">Runtime Authority</h3>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleRuntimeProbe}
                        disabled={isProbingRuntime}
                        className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs disabled:opacity-60 flex items-center gap-1.5"
                      >
                        {isProbingRuntime ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Globe className="w-3.5 h-3.5" />
                        )}
                        Observe
                      </button>
                      <button
                        onClick={handleRouteRecordToggle}
                        disabled={isRouteBusy}
                        className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs disabled:opacity-60"
                      >
                        {isRecordingRoute ? "Stop Recording" : "Start Recording"}
                      </button>
                      <button
                        onClick={handleRunRoute}
                        disabled={isRouteBusy || !lastRouteId}
                        className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs disabled:opacity-50"
                      >
                        Run Route
                      </button>
                    </div>
                    <input
                      value={routeIntent}
                      onChange={(e) => setRouteIntent(e.target.value)}
                      placeholder="Route intent"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500"
                    />
                    <p className="text-[11px] text-zinc-500">
                      {lastRouteId
                        ? `Last route: ${lastRouteId}`
                        : "No recorded route yet. Start recording to capture one."}
                    </p>
                  </div>

                  {/* Diagnostics */}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setShowDiagnostic(true)}
                      className="w-full p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors text-sm text-zinc-400 flex items-center justify-center gap-2"
                    >
                      <Shield className="w-4 h-4" />
                      Run Diagnostics
                    </button>
                    <button
                      onClick={handleRuntimeProbe}
                      disabled={isProbingRuntime}
                      className="w-full p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors text-sm text-zinc-400 flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {isProbingRuntime ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Globe className="w-4 h-4" />
                      )}
                      Check Runtime
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {showDiagnostic && <PermissionDiagnostic onClose={() => setShowDiagnostic(false)} />}
    </div>
  );
};

export default Dashboard;
