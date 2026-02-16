# Centris Desktop - Windows Setup Guide

This guide will help you set up and run Centris Desktop on Windows.

## Prerequisites

1. **Windows 10 or later** (64-bit recommended)
2. **Node.js 18+** - Download from [nodejs.org](https://nodejs.org)
3. **Python 3.9+** - Required for the backend
4. **Git** (optional but recommended)

## Quick Start

### Step 1: Clone the Repository

```powershell
git clone https://github.com/centris-ai/centris-ai.git
cd centris-ai
```

### Step 2: Set Up the Backend

Open a PowerShell terminal:

```powershell
cd backend
pip install -r requirements.txt
python main.py
```

Keep this terminal open - the backend needs to be running.

### Step 3: Set Up the Desktop App

Open another PowerShell terminal:

```powershell
cd desktop

# Install dependencies (use --legacy-peer-deps to avoid macOS-specific package errors)
npm install --legacy-peer-deps

# Start in development mode
npm run dev:win
```

### Step 4: Use the App

Once the app starts:

1. **Press `Ctrl+`` (backtick)** to start dictation
2. **Speak your command**
3. **Press `Ctrl+`` again** to stop and submit
4. The app will transcribe your speech and execute the command

## Building for Production

### Build Unpacked (for testing)

```powershell
npm run build:win:dir
```

The built app will be in `dist/win-unpacked/`

### Build Installer

```powershell
npm run build:win:installer
```

This creates an NSIS installer in the `dist/` folder.

### Build Portable

```powershell
npm run build:win:portable
```

Creates a portable executable that doesn't require installation.

## Hotkey Options

The default hotkey is `Ctrl+`` (Ctrl + backtick).

To change the hotkey, you can modify the `WINDOWS_HOTKEYS` in:
`desktop/src/helpers/windowsHotkeyManager.js`

Available options:

- `Control+`` (default)
- `Control+Shift+Space`
- `Control+Shift+D`
- `ScrollLock`
- `F13` (if your keyboard has it)

## Troubleshooting

### "npm install" fails with permission errors

Run PowerShell as Administrator, or use:

```powershell
npm install --legacy-peer-deps
```

### Backend not starting

1. Make sure Python 3.9+ is installed
2. Check if port 5001 is available
3. Install backend dependencies: `pip install -r requirements.txt`

### Microphone not working

1. Check Windows Privacy Settings > Microphone
2. Ensure the app has permission to access the microphone
3. Windows may prompt you for permission when you first use the app

### Hotkey not responding

1. Make sure the app window is running (check system tray)
2. Try running as Administrator
3. Check if another app is using the same hotkey

### Text not inserting

The app uses multiple fallback methods for text insertion:

1. Native Windows UI Automation (preferred)
2. Clipboard paste with Ctrl+V

If text isn't inserting:

1. Make sure the cursor is in a text field
2. Try clicking in the text field first
3. Check Windows Event Viewer for any errors

## File Locations

- **App Data**: `%APPDATA%\Centris AI\`
- **Logs**: `%APPDATA%\Centris AI\logs\`
- **Database**: `%APPDATA%\Centris AI\centris.db`

## Differences from macOS

| Feature        | macOS                    | Windows                   |
| -------------- | ------------------------ | ------------------------- |
| Default Hotkey | Globe/Fn key (hold)      | Ctrl+` (toggle)           |
| Text Insertion | Native Accessibility API | UI Automation / Clipboard |
| Permissions    | Requires explicit grants | Granted by default        |
| Hotkey Mode    | Push-to-talk (hold)      | Toggle (press twice)      |

## Development

### Running in dev mode

```powershell
npm run dev:win
```

### Opening DevTools

Press `Ctrl+Shift+D` to open DevTools for debugging.

### Building native modules

If you need to rebuild native modules:

```powershell
npm rebuild
# or
npx electron-rebuild -f -w better-sqlite3
```

## Support

If you encounter issues:

1. Check the console output for errors
2. Look in `%APPDATA%\Centris AI\logs\` for detailed logs
3. Open an issue on GitHub with:
   - Windows version
   - Node.js version
   - Error messages
   - Steps to reproduce
