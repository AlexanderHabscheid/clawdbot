# Electron Browser Prevention

## Issue

The Glass AI UI was designed for browsers, but Centris AI is an Electron desktop app. We need to ensure:

1. The app NEVER opens in a browser
2. All navigation stays within Electron windows
3. External links are blocked or handled properly

## Solutions Implemented

### 1. Navigation Blocking

Added `will-navigate` handler to prevent external URLs:

```javascript
this.mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
  // Only allow local URLs (file:// or localhost)
  const isLocalUrl = parsedUrl.protocol === "file:" || parsedUrl.hostname === "localhost";
  if (!isLocalUrl) {
    event.preventDefault();
  }
});
```

### 2. Window Open Prevention

Added `setWindowOpenHandler` to prevent new browser windows:

```javascript
this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  // Block external URLs
  if (!isLocalUrl) {
    return { action: "deny" };
  }
  return { action: "allow" };
});
```

### 3. Electron Detection

Added checks to ensure app is running in Electron:

```javascript
// In main.jsx
if (!window.electronAPI) {
  // Show error, prevent rendering
}

// In App.jsx
useEffect(() => {
  if (!window.electronAPI) {
    alert("Must run in Electron");
  }
}, []);
```

### 4. WebPreferences Configuration

Enhanced webPreferences to ensure Electron-specific behavior:

```javascript
webPreferences: {
  webSecurity: true,
  allowRunningInsecureContent: false,
  nodeIntegrationInSubFrames: false,
}
```

## Development vs Production

### Development

- Uses Vite dev server: `http://localhost:5174/`
- Still runs in Electron BrowserWindow
- NOT a browser - it's Electron loading a localhost URL

### Production

- Uses file:// protocol: `file:///path/to/dist/index.html`
- Completely self-contained
- No external dependencies

## Testing

To verify the app is running in Electron:

1. Check console: `window.electronAPI` should exist
2. Check window: Should be Electron window, not browser
3. Try external link: Should be blocked
4. Check DevTools: Should show Electron context

## Key Differences: Browser vs Electron

| Feature    | Browser               | Electron                      |
| ---------- | --------------------- | ----------------------------- |
| Window     | Browser window        | Electron BrowserWindow        |
| API        | Browser APIs          | electronAPI (via preload)     |
| Navigation | Can navigate anywhere | Blocked to external URLs      |
| Links      | Open in browser       | Handled by Electron           |
| Storage    | localStorage only     | localStorage + electron-store |

## Fixed Issues

✅ Duplicate handler error (`clear-local-storage`)
✅ Navigation to external URLs blocked
✅ New windows prevented from opening in browser
✅ Electron detection added
✅ WebPreferences configured for Electron

The app is now properly configured as an Electron desktop app, not a browser app!
