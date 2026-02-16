import { Trash2, Settings, FileText, X, Keyboard as KeyboardIcon } from "lucide-react";
import React, { useState, useEffect } from "react";
import SettingsModal from "./SettingsModal";
import TitleBar from "./TitleBar";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useToast } from "./ui/Toast";
import TranscriptionItem from "./ui/TranscriptionItem";

interface TranscriptionItemData {
  id: number;
  text: string;
  timestamp: string;
}

export default function ControlPanel() {
  const [history, setHistory] = useState<TranscriptionItemData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const { toast } = useToast();
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
    variant?: "default" | "destructive";
  }>({
    open: false,
    title: "",
    description: "",
    onConfirm: () => {},
  });
  const [alertDialog, setAlertDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
  }>({
    open: false,
    title: "",
    description: "",
  });

  const isWindows =
    typeof window !== "undefined" && window.electronAPI?.getPlatform?.() === "win32";

  const handleClose = () => {
    void window.electronAPI?.windowClose?.();
  };

  useEffect(() => {
    loadTranscriptions();
  }, []);

  const loadTranscriptions = async () => {
    try {
      setIsLoading(true);
      const transcriptions = await window.electronAPI?.getTranscriptions?.(50);
      if (transcriptions) {
        setHistory(transcriptions);
      }
    } catch (error) {
      showAlertDialog({
        title: "Unable to load history",
        description: "Please try again in a moment.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: "Text copied to your clipboard",
        variant: "success",
        duration: 2000,
      });
    } catch (err) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy text to clipboard",
        variant: "destructive",
      });
    }
  };

  const clearHistory = async () => {
    setConfirmDialog({
      open: true,
      title: "Clear History",
      description:
        "Are you certain you wish to clear all transcription records? This action cannot be undone.",
      onConfirm: async () => {
        try {
          const result = await window.electronAPI?.clearTranscriptions?.();
          setHistory([]);
          setConfirmDialog((prev) => ({ ...prev, open: false }));
          setAlertDialog({
            open: true,
            title: "History Cleared",
            description: `Successfully cleared ${result?.cleared || 0} transcriptions.`,
          });
        } catch (error) {
          setConfirmDialog((prev) => ({ ...prev, open: false }));
          setAlertDialog({
            open: true,
            title: "Error",
            description: "Failed to clear history. Please try again.",
          });
        }
      },
      variant: "destructive",
    });
  };

  const deleteTranscription = async (id: number) => {
    setConfirmDialog({
      open: true,
      title: "Delete Transcription",
      description: "Are you certain you wish to remove this transcription from your records?",
      onConfirm: async () => {
        try {
          const result = await window.electronAPI?.deleteTranscription?.(id);
          if (result?.success) {
            setHistory((prev) => prev.filter((item) => item.id !== id));
            setConfirmDialog((prev) => ({ ...prev, open: false }));
          } else {
            setConfirmDialog((prev) => ({ ...prev, open: false }));
            setAlertDialog({
              open: true,
              title: "Delete Failed",
              description: "Failed to delete transcription. It may have already been removed.",
            });
          }
        } catch (error) {
          setConfirmDialog((prev) => ({ ...prev, open: false }));
          setAlertDialog({
            open: true,
            title: "Delete Failed",
            description: "Failed to delete transcription. Please try again.",
          });
        }
      },
      variant: "destructive",
    });
  };

  const showAlertDialog = (dialog: { title: string; description: string }) => {
    setAlertDialog({ ...dialog, open: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => setAlertDialog({ ...alertDialog, open })}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => setAlertDialog({ ...alertDialog, open: false })}
      />

      <TitleBar
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(!showSettings)}
              title="Settings"
            >
              <Settings size={16} />
            </Button>
            {isWindows && (
              <div className="flex items-center gap-1 ml-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={handleClose}
                  aria-label="Close window"
                >
                  <X size={14} />
                </Button>
              </div>
            )}
          </>
        }
      />

      <SettingsModal open={showSettings} onOpenChange={setShowSettings} />

      {/* Main content */}
      <div className="p-6">
        <div className="space-y-6 max-w-4xl mx-auto">
          {/* History Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText size={18} className="text-orange-600" />
                  Recent Transcriptions
                </CardTitle>
                <div className="flex gap-2">
                  {history.length > 0 && (
                    <Button
                      onClick={clearHistory}
                      variant="ghost"
                      size="icon"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      title="Clear all history"
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-gray-500">Loading transcriptions...</div>
              ) : history.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <FileText size={48} className="mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium mb-2">No transcriptions yet</p>
                  <p className="text-sm">Your transcription history will appear here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {history.map((item, index) => (
                    <TranscriptionItem
                      key={item.id}
                      item={item}
                      index={index}
                      total={history.length}
                      onCopy={copyToClipboard}
                      onDelete={deleteTranscription}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
