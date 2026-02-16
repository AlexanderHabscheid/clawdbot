import { Minus, Square, X, Copy } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";

export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;

    const syncIsMaximized = async () => {
      try {
        const maximized = await window.electronAPI?.windowIsMaximized?.();
        if (mounted) {
          setIsMaximized(!!maximized);
        }
      } catch {
        // Silently handle if API not available
      }
    };

    syncIsMaximized();
    const intervalId = setInterval(syncIsMaximized, 1000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

  const handleMinimize = async () => {
    try {
      await window.electronAPI?.windowMinimize?.();
    } catch {
      // Silently handle if API not available
    }
  };

  const handleMaximize = async () => {
    try {
      await window.electronAPI?.windowMaximize?.();
      const maximized = await window.electronAPI?.windowIsMaximized?.();
      setIsMaximized(!!maximized);
    } catch {
      // Silently handle if API not available
    }
  };

  const handleClose = async () => {
    try {
      await window.electronAPI?.windowClose?.();
    } catch {
      // Silently handle if API not available
    }
  };

  return (
    <div className="flex items-center gap-1 pointer-events-auto">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleMinimize}
        title="Minimize"
        className="h-8 w-8"
      >
        <Minus size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleMaximize}
        title={isMaximized ? "Restore" : "Maximize"}
        className="h-8 w-8"
      >
        {isMaximized ? <Copy size={14} /> : <Square size={12} />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleClose}
        className="h-8 w-8 hover:text-red-600 hover:bg-red-50"
        title="Close"
      >
        <X size={14} />
      </Button>
    </div>
  );
}
