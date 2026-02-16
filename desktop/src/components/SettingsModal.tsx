import { Keyboard as KeyboardIcon } from "lucide-react";
import React, { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import Keyboard from "./ui/Keyboard";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [selectedHotkey, setSelectedHotkey] = useState<string>("GLOBE");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Load current hotkey
    const loadHotkey = async () => {
      try {
        const currentHotkey = window.localStorage?.getItem("dictationKey") || "GLOBE";
        setSelectedHotkey(currentHotkey);
      } catch (error) {
        // Silent fail - hotkey will default to GLOBE
      }
    };
    if (open) {
      loadHotkey();
    }
  }, [open]);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      // Save to localStorage
      if (window.localStorage) {
        window.localStorage.setItem("dictationKey", selectedHotkey);
      }
      // Update via IPC
      await window.electronAPI?.updateHotkey?.(selectedHotkey);
      onOpenChange(false);
    } catch (error) {
      // Error handling is done via toast in parent component if needed
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyboardIcon size={20} className="text-orange-600" />
            Hotkey Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div>
            <p className="text-sm text-gray-600 mb-4">
              Select a hotkey to start/stop dictation. Press any key on the keyboard below.
            </p>
            <Keyboard selectedKey={selectedHotkey} setSelectedKey={setSelectedHotkey} />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Hotkey"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
