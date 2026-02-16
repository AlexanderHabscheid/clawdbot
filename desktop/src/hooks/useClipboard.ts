import { useCallback } from "react";

/**
 * Hook for clipboard operations using the Electron API
 */
export function useClipboard() {
  /**
   * Read text from clipboard
   */
  const readClipboard = useCallback(async (): Promise<string> => {
    if (window.electronAPI?.readClipboard) {
      return await window.electronAPI.readClipboard();
    }
    // Fallback to browser API
    return await navigator.clipboard.readText();
  }, []);

  /**
   * Write text to clipboard
   */
  const writeClipboard = useCallback(async (text: string): Promise<void> => {
    if (window.electronAPI?.writeClipboard) {
      await window.electronAPI.writeClipboard(text);
    } else {
      // Fallback to browser API
      await navigator.clipboard.writeText(text);
    }
  }, []);

  /**
   * Paste from clipboard and call setter with the value
   * Falls back to browser API if Electron API is not available
   */
  const pasteFromClipboardWithFallback = useCallback(
    async (setter: (value: string) => void): Promise<void> => {
      try {
        const text = await readClipboard();
        if (text) {
          setter(text);
        }
      } catch (error) {
        console.error("Failed to read from clipboard:", error);
      }
    },
    [readClipboard],
  );

  return {
    readClipboard,
    writeClipboard,
    pasteFromClipboardWithFallback,
  };
}

export default useClipboard;
