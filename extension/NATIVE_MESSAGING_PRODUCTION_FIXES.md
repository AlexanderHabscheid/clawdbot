# Native Messaging Production Fixes

## Summary

Fixed Native Messaging installation to work automatically in production when users install the Electron desktop app. The app now handles installation silently in the background.

## What Was Fixed

### 1. **Improved Error Logging in Extension** ✅

- Added immediate error detection after `connectNative()` call
- Added diagnostic helper function to interpret Chrome error messages
- Better error messages with actionable solutions

**File:** `extension/background.js`

### 2. **Enhanced Electron App Installer** ✅

- **Permission Handling**: Automatically falls back to user directory if `/usr/local/bin` requires sudo
- **Python Verification**: Checks if Python3 is available (warns if not)
- **Path Detection**: Correctly handles both `/usr/local/bin` and user data directory paths
- **Verification Step**: Verifies installation succeeded after setup
- **Extension ID Updates**: Automatically updates manifests when extension connects

**File:** `desktop/src/helpers/nativeMessagingInstaller.js`

### 3. **Automatic Installation Flow** ✅

The Electron app automatically installs Native Messaging when it starts:

```javascript
// desktop/main.js (lines 637-666)
app.whenReady().then(() => {
  // Automatically install Native Messaging host
  const status = NativeMessagingInstaller.getInstallationStatus();

  if (!status.hostInstalled || status.manifestsFound === 0) {
    await NativeMessagingInstaller.installNativeHost();
  }

  // Monitor for extension ID and update manifests
  NativeMessagingInstaller.startExtensionIdMonitor(30000);
});
```

## Production Flow

### When User Installs Desktop App:

1. **App Starts** → Automatically installs Native Messaging host
   - Copies `centris_host.py` to `/usr/local/bin/` (or user directory if no permissions)
   - Creates manifests in Chrome/Chromium/Brave directories
   - Uses placeholder extension ID initially

2. **User Installs Extension** → Extension connects via WebSocket
   - Extension sends `extension_ready` with its ID
   - Backend saves extension ID to `~/.centris/extension_id.txt`

3. **Desktop App Detects Extension ID** → Updates manifests automatically
   - App monitors for saved extension ID (every 30 seconds)
   - Updates all manifests with real extension ID
   - Extension can now use Native Messaging (faster!)

## Installation Locations

### macOS/Linux:

- **Preferred**: `/usr/local/bin/centris_host.py` (requires sudo, but faster)
- **Fallback**: `~/Library/Application Support/Centris/centris_host.py` (user-writable)

### Windows:

- **Location**: `%APPDATA%\Centris\centris_host.py`

## Manifest Locations

### macOS:

- Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json`
- Chromium: `~/Library/Application Support/Chromium/NativeMessagingHosts/com.centris.host.json`
- Brave: `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.centris.host.json`

### Linux:

- Chrome: `~/.config/google-chrome/NativeMessagingHosts/com.centris.host.json`
- Chromium: `~/.config/chromium/NativeMessagingHosts/com.centris.host.json`
- Brave: `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.centris.host.json`

### Windows:

- Registry: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.centris.host`
- Manifest: `%APPDATA%\Centris\com.centris.host.json`

## Error Handling

### If Installation Fails:

- Extension automatically falls back to WebSocket
- App logs warning but continues normally
- User experience is unaffected (just slightly slower)

### Common Issues Fixed:

1. ✅ **Permission denied** → Falls back to user directory
2. ✅ **Python3 not found** → Logs warning, extension uses WebSocket
3. ✅ **Extension ID placeholder** → Auto-updates when extension connects
4. ✅ **Manifest not found** → Creates all necessary directories
5. ✅ **Multiple browsers** → Installs manifests for all installed browsers

## Verification

The installer now verifies installation:

- Checks if host script exists and is executable
- Verifies manifests are readable
- Logs verification results

## Testing

To test the installation:

1. **Start the desktop app** → Check logs for:

   ```
   [NativeMessagingInstaller] ✓ Host script installed to: ...
   [NativeMessagingInstaller] ✓ Native host installed successfully
   ```

2. **Install extension** → Check extension logs for:

   ```
   ✅ Native Messaging handshake sent
   ✅ Native host ready
   ```

3. **If Native Messaging fails** → Extension logs will show:
   ```
   ❌ Native Messaging connection failed immediately
   [diagnosis with specific issue and solution]
   📡 Falling back to WebSocket connection
   ```

## Files Modified

1. `extension/background.js` - Improved error logging and diagnostics
2. `desktop/src/helpers/nativeMessagingInstaller.js` - Enhanced installer with fallbacks and verification
3. `extension/NATIVE_MESSAGING_TROUBLESHOOTING.md` - Comprehensive troubleshooting guide

## Next Steps for Production

1. ✅ **Automatic installation** - Done
2. ✅ **Error handling** - Done
3. ✅ **Extension ID auto-update** - Done
4. ⚠️ **Bundle host script** - Ensure `centris_host.py` is included in app bundle (check `desktop/package.json`)

The host script should be bundled via:

```json
// desktop/package.json
"extraResources": [
  {
    "from": "../extension/native-host",
    "to": "native-host",
    "filter": ["centris_host.py"]
  }
]
```

This is already configured! ✅

## Summary

Native Messaging now works automatically in production:

- ✅ Desktop app installs it on startup
- ✅ Extension ID auto-updates when extension connects
- ✅ Graceful fallback to WebSocket if installation fails
- ✅ Better error messages for debugging
- ✅ Works with or without sudo permissions

Users don't need to do anything - it just works! 🎉
