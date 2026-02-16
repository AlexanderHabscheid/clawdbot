# Centris Desktop Application

A modern desktop voice assistant built with Electron and React, adapted from OpenWhispr for the Centris backend system.

## Features

- 🎤 **Global Hotkey**: Press Globe key (macOS) or Ctrl+` (Windows) to start/stop dictation
- 🤖 **Centris Backend Integration**: Uses Centris Python backend for transcription and task execution
- 🎨 **Modern UI**: Built with React 19, TypeScript, and Tailwind CSS v4
- 🚀 **Fast**: Optimized with Vite
- 📱 **Draggable Interface**: Move the dictation panel anywhere on your screen
- 🔄 **Real-time Feedback**: Visual states for listening, processing, success, and error

## Prerequisites

- **Node.js 18+** and npm
- **Centris Backend** running on `http://127.0.0.1:5001`
- **macOS 10.15+**, **Windows 10+**, or **Linux**

## Quick Start (macOS)

1. **Install dependencies**:

   ```bash
   cd desktop
   npm install
   ```

2. **Start the Centris backend** (in another terminal):

   ```bash
   cd ../backend
   python main.py
   ```

3. **Start the desktop app**:
   ```bash
   cd desktop
   npm start
   ```

## Quick Start (Windows)

1. **Install dependencies** (in PowerShell):

   ```powershell
   cd desktop
   npm install --legacy-peer-deps
   ```

2. **Start the Centris backend** (in another terminal):

   ```powershell
   cd ../backend
   pip install -r requirements.txt
   python main.py
   ```

3. **Start the desktop app**:
   ```powershell
   npm run dev:win
   ```

Or build a standalone Windows app:

```powershell
.\scripts\build-windows.ps1
```

## Platform-Specific Hotkeys

| Platform    | Hotkey            | Description               |
| ----------- | ----------------- | ------------------------- |
| **macOS**   | Globe/Fn key      | Press and hold to dictate |
| **Windows** | Ctrl+` (backtick) | Press to toggle dictation |
| **Linux**   | ` (backtick)      | Press to toggle dictation |

## Development

- `npm start` - Start in production mode
- `npm run dev` - Start with hot reload (requires Vite dev server)
- `npm run dev:win` - Start on Windows with hot reload
- `npm run build:renderer` - Build React app only
- `npm run build:win` - Build Windows installer
- `npm run build:win:dir` - Build Windows app (unpacked)

## Usage

1. **Press your platform's hotkey** to start recording
2. **Speak your command** (e.g., "open gmail")
3. **Press again** (or release on macOS) to stop and transcribe
4. **Watch** the UI show processing, then success/error

## Architecture

- **Main Process** (`main.js`): Electron main process, IPC handlers, window management
- **Renderer Process** (`src/`): React UI components
- **Backend Service** (`src/services/centrisBackendService.js`): Communication with Centris Python backend
- **Audio Manager** (`src/helpers/audioManager.js`): Handles recording and transcription flow

## Backend Endpoints

- `POST /api/audio/transcribe` - Transcribe audio to text
- `POST /api/task/execute-stream` - Execute a task with streaming updates (SSE)
- `GET /api/health` - Health check

## Notes

- The app connects to `http://127.0.0.1:5001` (IPv4) to avoid IPv6 connection issues
- Microphone permission is required
- The backend must be running for the app to function
