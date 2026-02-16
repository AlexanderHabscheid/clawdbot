export function formatHotkeyLabel(hotkey?: string | null): string {
  if (!hotkey || hotkey.trim() === "") {
    // Default to Globe on macOS, backtick on others
    return typeof window !== "undefined" && window.electronAPI?.getPlatform?.() === "darwin"
      ? "🌐 Globe"
      : "`";
  }

  if (hotkey === "GLOBE") {
    return "🌐 Globe";
  }

  return hotkey;
}
