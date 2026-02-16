# Onboarding Code Comparison

## Key Differences Between Example and Current Implementation

### 1. **Permission Checking Approach**

**Example Code:**

- Uses `node-mac-permissions` package for permission checking
- Single IPC handler `check-permissions` that returns both microphone and accessibility status
- Checks permissions every 1 second automatically
- Simpler permission status checking

**Current Code:**

- Uses Electron's built-in `systemPreferences.askForMediaAccess` for microphone
- Uses AppleScript (`osascript`) to test accessibility permission
- Separate IPC handlers: `check-microphone-permission` and `check-accessibility-permission`
- Checks permissions every 1.5 seconds (PERMISSION_CHECK_INTERVAL_MS)

### 2. **UI Structure**

**Example Code:**

- Single screen showing both permissions at once
- Two permission cards side-by-side or stacked
- Auto-updates UI when permissions are granted
- Continue button only enabled when both permissions granted
- Simpler, cleaner design

**Current Code:**

- Multi-step wizard (5 steps: Welcome, Microphone, Accessibility, Hotkey, Ready)
- One permission per screen
- Progress bar showing step progression
- More complex UI with animations and transitions

### 3. **Permission Request Flow**

**Example Code:**

```javascript
// Single handler for both permissions
ipcMain.handle("check-permissions", async () => {
  const mic = await checkMicrophonePermission();
  const accessibility = await checkAccessibilityPermission();
  return { microphone: mic, accessibility: accessibility };
});

// Auto-checks every second
setInterval(async () => {
  const status = await ipcRenderer.invoke("check-permissions");
  // Update UI based on status
}, 1000);
```

**Current Code:**

```javascript
// Separate handlers
ipcMain.handle('check-microphone-permission', ...)
ipcMain.handle('check-accessibility-permission', ...)

// Checks every 1.5 seconds, auto-advances when granted
useEffect(() => {
  const checkPermissions = async () => {
    const micStatus = await window.electronAPI?.checkMicrophonePermission?.();
    const accessibilityStatus = await window.electronAPI?.checkAccessibilityPermission?.();
    // Auto-advance logic
  };
  const interval = setInterval(checkPermissions, PERMISSION_CHECK_INTERVAL_MS);
}, [currentStep]);
```

### 4. **System Preferences Opening**

**Example Code:**

```javascript
function openSystemPreferences(prefType) {
  const prefPane = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
  shell.openExternal(prefPane);
}
```

**Current Code:**

```javascript
// More robust with fallbacks
ipcMain.handle("open-system-preferences", async (event, pane) => {
  const urls = {
    microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  };
  // Tries 'open' command first, falls back to shell.openExternal
});
```

### 5. **Dependencies**

**Example Code:**

- `node-mac-permissions` - For permission checking
- Simpler dependency list

**Current Code:**

- Uses Electron's built-in APIs
- No additional permission packages needed
- More self-contained

## Recommendations

### Option 1: Keep Current Multi-Step Approach

**Pros:**

- More guided experience
- Better for first-time users
- Can explain each permission separately
- Includes hotkey selection step

**Cons:**

- More complex code
- Slower to complete
- More screens to navigate

### Option 2: Adopt Example's Single-Screen Approach

**Pros:**

- Faster onboarding
- Simpler code
- Both permissions visible at once
- Auto-detects when granted

**Cons:**

- Less guidance for users
- No hotkey selection (would need separate step)
- Less polished UI

### Option 3: Hybrid Approach (Recommended)

- Keep multi-step for Welcome and Hotkey steps
- Combine Microphone + Accessibility into single step (like example)
- Use `node-mac-permissions` for cleaner permission checking
- Keep auto-advance when permissions granted

## Implementation Notes

1. **Permission Checking**: The example uses `node-mac-permissions` which provides cleaner API:

   ```javascript
   const status = permissions.getAuthStatus("microphone");
   ```

2. **Auto-Detection**: Example checks every second and updates UI automatically - this is better UX

3. **Single Screen**: Showing both permissions at once is faster and less confusing

4. **Continue Button**: Only enabled when both granted - prevents user confusion

## Code Quality Comparison

**Example Code:**

- ✅ Simpler, more maintainable
- ✅ Faster permission detection
- ✅ Less code to maintain
- ❌ Less polished UI
- ❌ No hotkey selection

**Current Code:**

- ✅ More polished UI
- ✅ Better user guidance
- ✅ Includes hotkey selection
- ❌ More complex
- ❌ Slower to complete
- ❌ More code to maintain
