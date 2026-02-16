# Permission System Documentation

## Overview

Centris AI requires two critical permissions on macOS:

1. **Microphone Access** - For voice dictation and speech recognition
2. **Accessibility Access** - For typing text into applications and detecting the Globe/Fn key

The permission system monitors these permissions in real-time and handles graceful degradation when permissions are revoked.

## Architecture

### Main Process Components

#### 1. PermissionMonitor (`src/helpers/permissionMonitor.js`)

- **Purpose**: Monitors permissions during app runtime
- **Location**: Electron main process
- **Features**:
  - Continuous monitoring (checks every 5 seconds)
  - Detects permission changes
  - Emits events when permissions are revoked/granted
  - Provides synchronous status getter

#### 2. OnboardingManager (`src/helpers/onboardingManager.js`)

- **Purpose**: Handles permission requests and System Settings integration
- **Location**: Electron main process
- **Features**:
  - Opens System Settings to specific privacy panes
  - Checks permission status
  - Requests microphone permission (programmatically)
  - Opens accessibility settings (must be granted manually)

#### 3. IPC Handlers (`src/helpers/ipcHandlers.js`)

- **Purpose**: Exposes permission functions to renderer process
- **Available Handlers**:
  - `check-microphone-permission`
  - `request-microphone-permission`
  - `check-accessibility-permission`
  - `request-accessibility-permission`
  - `get-permission-status` (new)
  - `force-permission-check` (new)
  - `open-system-preferences`

### Main Process Integration (`main.js`)

The permission system is integrated into the main Electron process:

```javascript
// PermissionMonitor is started when app is ready
permissionMonitor.start();

// Handles permission changes gracefully
permissionMonitor.on("microphone-changed", ({ granted }) => {
  // Stops active recording if revoked
  // Notifies all windows
});

permissionMonitor.on("accessibility-changed", ({ granted }) => {
  // Stops GlobeKeyManager if revoked
  // Restarts GlobeKeyManager if granted and GLOBE is active
  // Notifies all windows
});
```

## Permission Monitoring

### Automatic Monitoring

The `PermissionMonitor` automatically:

- Checks permissions every 5 seconds
- Detects when permissions are revoked
- Emits events for permission changes
- Sends IPC messages to renderer process

### Manual Checks

You can force a permission check:

**From Renderer (React/UI):**

```javascript
// Get current status
const status = await window.electronAPI.getPermissionStatus();

// Force a check (useful after user grants permission)
const newStatus = await window.electronAPI.forcePermissionCheck();
```

**From Main Process:**

```javascript
// Force immediate check
await permissionMonitor.forceCheck();
```

## Permission Events

### Main Process Events

The `PermissionMonitor` emits these events:

1. **`microphone-changed`**
   - Emitted when microphone permission changes
   - Data: `{ granted: boolean, status: object }`

2. **`accessibility-changed`**
   - Emitted when accessibility permission changes
   - Data: `{ granted: boolean, status: object }`

3. **`permission-status`**
   - Emitted on every check (for logging/monitoring)
   - Data: `{ microphone: boolean, accessibility: boolean, allGranted: boolean, ... }`

### Renderer Process Events

The main process sends IPC messages to all windows:

**`permission-changed`** - Sent to all BrowserWindows when permissions change

```javascript
// Listen in renderer
const unsubscribe = window.electronAPI.onPermissionChanged((data) => {
  console.log("Permission changed:", data.type, data.granted);
  // data.type: 'microphone' | 'accessibility'
  // data.granted: boolean
});

// Cleanup
unsubscribe();
```

## Graceful Degradation

### When Microphone Permission is Revoked

1. **Active recording is stopped** - All windows receive `stop-dictation` message
2. **Windows are notified** - `permission-changed` event sent
3. **UI can handle** - Renderer can show error message or disable recording

### When Accessibility Permission is Revoked

1. **GlobeKeyManager is stopped** - Native Fn key detection stops
2. **Windows are notified** - `permission-changed` event sent
3. **Hotkey falls back** - If GLOBE was active, user should switch to Cmd+Shift+Space
4. **UI can handle** - Renderer can show error message or disable features

### When Accessibility Permission is Granted

1. **GlobeKeyManager restarts** - If GLOBE is the current hotkey
2. **Windows are notified** - `permission-changed` event sent
3. **Features re-enable** - Accessibility-dependent features work again

## Permission Re-check on App Focus

The system automatically re-checks permissions when:

- App window gains focus (`browser-window-focus` event)
- App is activated (`activate` event on macOS)

This ensures permissions are up-to-date after the user grants them in System Settings.

## API Reference

### Renderer Process API

```typescript
// Check individual permissions
const micStatus = await window.electronAPI.checkMicrophonePermission();
const accStatus = await window.electronAPI.checkAccessibilityPermission();

// Request permissions
await window.electronAPI.requestMicrophonePermission();
await window.electronAPI.requestAccessibilityPermission();

// Open System Settings
await window.electronAPI.openSystemPreferences("microphone");
await window.electronAPI.openSystemPreferences("accessibility");

// Get current status (all permissions at once)
const status = await window.electronAPI.getPermissionStatus();
// Returns: { microphone: boolean, accessibility: boolean, allGranted: boolean, ... }

// Force a check
const newStatus = await window.electronAPI.forcePermissionCheck();

// Listen for changes
const unsubscribe = window.electronAPI.onPermissionChanged((data) => {
  // data: { type: 'microphone' | 'accessibility', granted: boolean }
});
```

### Main Process API

```javascript
const PermissionMonitor = require("./src/helpers/permissionMonitor");
const permissionMonitor = new PermissionMonitor();

// Start monitoring
permissionMonitor.start();

// Stop monitoring
permissionMonitor.stop();

// Get current status (synchronous)
const status = permissionMonitor.getStatus();
// Returns: { microphone: boolean, accessibility: boolean, allGranted: boolean }

// Force a check
await permissionMonitor.forceCheck();

// Listen for events
permissionMonitor.on("microphone-changed", ({ granted }) => {
  // Handle microphone permission change
});

permissionMonitor.on("accessibility-changed", ({ granted }) => {
  // Handle accessibility permission change
});
```

## Testing Permissions

### Manual Testing

1. **Grant permissions** - Go through onboarding or grant in System Settings
2. **Revoke permissions** - System Settings > Privacy & Security > Microphone/Accessibility
3. **Observe behavior** - Check console logs and UI responses
4. **Re-grant permissions** - Verify features re-enable

### Automated Testing

```javascript
// In main process
const status = await permissionMonitor.checkPermissions();
console.log("Permissions:", status);

// In renderer
const status = await window.electronAPI.getPermissionStatus();
console.log("Permissions:", status);
```

## Troubleshooting

### Permission Not Detected

1. **Check System Settings** - Verify app is listed and enabled
2. **Restart app** - Sometimes permissions need app restart
3. **Check logs** - Look for `[PermissionMonitor]` messages
4. **Force check** - Call `forcePermissionCheck()` after granting

### Globe Key Not Working

1. **Check accessibility permission** - Required for GlobeKeyManager
2. **Check logs** - Look for GlobeKeyManager errors
3. **Verify binary** - Ensure `macos-globe-listener` is compiled
4. **Try fallback** - Use Cmd+Shift+Space instead

### Microphone Not Working

1. **Check microphone permission** - System Settings > Privacy & Security > Microphone
2. **Check browser permissions** - Electron uses browser APIs
3. **Check audio device** - Ensure microphone is connected
4. **Check logs** - Look for `[AudioManager]` errors

## Best Practices

1. **Always check permissions before using features**

   ```javascript
   const status = await window.electronAPI.getPermissionStatus();
   if (!status.microphone) {
     // Show error or request permission
   }
   ```

2. **Listen for permission changes**

   ```javascript
   window.electronAPI.onPermissionChanged((data) => {
     if (data.type === "microphone" && !data.granted) {
       // Stop recording, show error
     }
   });
   ```

3. **Re-check after user actions**

   ```javascript
   // After user clicks "Grant Permission"
   await window.electronAPI.openSystemPreferences("microphone");
   // Wait a moment, then check
   setTimeout(async () => {
     const status = await window.electronAPI.forcePermissionCheck();
     if (status.microphone) {
       // Enable recording
     }
   }, 2000);
   ```

4. **Handle permission revocation gracefully**
   - Stop active operations
   - Show clear error messages
   - Provide easy path to re-grant

## Implementation Notes

- **PermissionMonitor runs in main process only** - More reliable than renderer checks
- **Checks every 5 seconds** - Balance between responsiveness and performance
- **Uses Electron's systemPreferences API** - More reliable than node-mac-permissions alone
- **AppleScript fallback for accessibility** - Most reliable method on macOS
- **IPC events for renderer** - Allows UI to react to permission changes
- **Automatic cleanup** - PermissionMonitor stops on app quit

## Future Enhancements

- [ ] Permission status indicator in UI (optional)
- [ ] Permission expiration warnings
- [ ] Permission analytics (with user consent)
- [ ] Windows/Linux permission support
- [ ] Permission testing utilities
