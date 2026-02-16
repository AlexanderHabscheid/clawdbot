# Centris AI - Complete Permissions List

## Overview

Centris AI requests **4 macOS permissions** to enable its full functionality. These are divided into:

- **Core Permissions** (Required for basic functionality)
- **Advanced Permissions** (Required for AI vision and keyboard monitoring)

---

## 🔐 Core Permissions (Required)

### 1. **Microphone** 🎤

**Location in System Settings:** `Privacy & Security → Microphone`

**What it enables:**

- Voice dictation (speech-to-text)
- Voice typing in any application
- Fn/Globe key hotkey functionality
- Real-time voice transcription
- Meeting transcription (when combined with system audio)

**How it's requested:**

- Automatically prompts when user clicks "Record Voice" button
- Uses `navigator.mediaDevices.getUserMedia({ audio: true })`
- Can also be requested via `permissions.askForMicrophoneAccess()`

**Status Check:**

- Uses Electron's `systemPreferences.getMediaAccessStatus('microphone')`
- Also checks TCC database via `node-mac-permissions`

**What happens if denied:**

- Voice typing won't work
- Microphone test in onboarding will fail
- Globe key hotkey won't trigger voice recording

---

### 2. **Accessibility** ♿

**Location in System Settings:** `Privacy & Security → Accessibility`

**What it enables:**

- **UI Control**: Click buttons, interact with windows
- **Text Insertion**: Paste transcribed text into any application
- **Globe Key Detection**: Native Fn/Globe key hotkey listener
- **System Events Access**: Monitor and control other applications
- **Keyboard Shortcuts**: Global hotkey registration

**How it's requested:**

- **Cannot be requested programmatically** - user must manually enable
- Opens System Settings to the Accessibility pane
- Uses `node-mac-permissions.getAuthStatus('accessibility')` to check TCC database
- Falls back to `osascript` test: `tell application "System Events" to get name of first process`

**Status Check:**

- Primary: `permissions.getAuthStatus('accessibility')` (TCC database)
- Fallback: AppleScript test for System Events access

**What happens if denied:**

- Cannot paste text into other applications
- Globe key hotkey won't work
- UI automation features disabled
- Voice typing won't be able to insert text

**Special Notes:**

- This is the **most critical permission** for Centris AI functionality
- Required for the native Globe Key Manager to work
- Must be enabled manually by user (macOS security requirement)

---

## 🚀 Advanced Permissions (Optional but Recommended)

### 3. **Screen Recording** 📺

**Location in System Settings:** `Privacy & Security → Screen Recording`

**What it enables:**

- **Screen Capture**: Take screenshots for AI vision
- **OCR (Optical Character Recognition)**: Extract text from any screen content
- **AI Vision**: Provide visual context to AI models
- **System Audio Capture**: Record audio playing through speakers (macOS 11+)
- **Meeting Transcription**: Capture audio from Zoom, Google Meet, etc.
- **Workflow Tracking**: Visual understanding of user's screen

**How it's requested:**

- Can be prompted via `permissions.askForScreenCaptureAccess()`
- Falls back to opening System Settings if prompt fails
- Uses `node-mac-permissions.getAuthStatus('screen')` to check status

**Status Check:**

- Uses `permissions.getAuthStatus('screen')` (TCC database)

**What happens if denied:**

- Screen capture features disabled
- OCR won't work
- System audio capture disabled (unless virtual audio device is used)
- AI vision features limited

**Special Notes:**

- On macOS 11+, Screen Recording permission **also enables system audio capture**
- This is why system audio doesn't need a separate permission

---

### 4. **Input Monitoring** ⌨️

**Location in System Settings:** `Privacy & Security → Input Monitoring`

**What it enables:**

- **Global Keyboard Monitoring**: Track keystrokes across all applications
- **Context Awareness**: Understand what user is typing for better AI suggestions
- **Command Detection**: Detect custom keyboard shortcuts
- **Activity Patterns**: Build intelligent autocomplete suggestions
- **Privacy-Aware Filtering**: Can exclude sensitive fields (passwords, tokens, etc.)

**How it's requested:**

- Can be prompted via `permissions.askForInputMonitoringAccess('listen')`
- Falls back to opening System Settings if prompt fails
- Uses `node-mac-permissions.getAuthStatus('input-monitoring')` to check status

**Status Check:**

- Uses `permissions.getAuthStatus('input-monitoring')` (TCC database)

**What happens if denied:**

- Global keyboard monitoring disabled
- Context-aware features limited
- Keyboard-based triggers won't work

**Privacy Features:**

- Service includes privacy-aware mode (enabled by default)
- Automatically excludes password fields
- Filters sensitive patterns (SSN, credit cards, tokens)
- Data processed locally, never sent externally

---

## 📊 Permission Status Summary

### Current Status on Your Computer

To check your current permissions, look in:

- **System Settings → Privacy & Security**
- Look for **"Centris AI"** in each category:
  - ✅ Microphone
  - ✅ Accessibility
  - ✅ Screen Recording
  - ✅ Input Monitoring

### Permission Groups

**Core Permissions (Required):**

- Microphone ✅
- Accessibility ✅
- **Result**: `coreGranted = true` when both are enabled

**Advanced Permissions (Optional):**

- Screen Recording ✅
- Input Monitoring ✅
- **Result**: `advancedGranted = true` when both are enabled

**All Permissions:**

- **Result**: `allGranted = true` when all 4 are enabled

---

## 🔄 Permission Monitoring

Centris AI continuously monitors all permissions:

- **Check Interval**: Every 5 seconds
- **Change Detection**: Emits events when permissions are revoked
- **Graceful Degradation**: Services automatically stop if permissions are revoked

**Events Emitted:**

- `microphone-changed` - When microphone permission changes
- `accessibility-changed` - When accessibility permission changes
- `screen-recording-changed` - When screen recording permission changes
- `input-monitoring-changed` - When input monitoring permission changes
- `permission-status` - Overall status update

---

## 🛠️ Services That Use Permissions

### Services Requiring Core Permissions:

1. **Voice Typing / Dictation**
   - Requires: Microphone + Accessibility
   - Function: Record voice, transcribe, paste into active app

2. **Globe Key Manager**
   - Requires: Accessibility
   - Function: Detect Fn/Globe key press for voice typing hotkey

3. **Text Insertion**
   - Requires: Accessibility
   - Function: Paste transcribed text into any application

### Services Requiring Advanced Permissions:

1. **ScreenCaptureService**
   - Requires: Screen Recording
   - Function: Screenshots, OCR, AI vision

2. **SystemAudioService**
   - Requires: Screen Recording (macOS 11+)
   - Function: Capture system audio for meeting transcription

3. **KeyboardMonitorService**
   - Requires: Input Monitoring
   - Function: Global keyboard event monitoring

---

## 🔒 Privacy & Security

### What Centris AI Does NOT Do:

- ❌ **Never monitors password fields** (automatically filtered)
- ❌ **Never sends keyboard data externally** (processed locally)
- ❌ **Never captures screen without user action** (only on-demand or when explicitly enabled)
- ❌ **Never records audio without user activation** (only when globe key pressed or button clicked)

### Privacy Features:

- **Privacy-Aware Mode**: Enabled by default for keyboard monitoring
- **Sensitive Field Filtering**: Automatically excludes passwords, tokens, SSN, credit cards
- **Local Processing**: All data processed locally before any API calls
- **User Control**: All features can be disabled in preferences

---

## 📝 For Future Users

### Onboarding Flow:

1. **Step 1: Welcome** - Introduction
2. **Step 2: Microphone** - Request microphone permission, test recording
3. **Step 3: Accessibility** - Guide user to enable in System Settings, test voice typing
4. **Step 4: Advanced** - Optional screen recording and input monitoring permissions
5. **Step 5: Complete** - Ready to use

### What Users See:

- Clear explanations of why each permission is needed
- Visual indicators showing permission status
- Test buttons to verify permissions work
- Direct links to System Settings
- Privacy notes explaining data usage

### Permission Request Methods:

- **Microphone**: Can be requested programmatically (prompt appears)
- **Accessibility**: Must be enabled manually (opens System Settings)
- **Screen Recording**: Can be requested programmatically (prompt appears)
- **Input Monitoring**: Can be requested programmatically (prompt appears)

---

## 🐛 Troubleshooting

### If Permissions Don't Work:

1. **Check System Settings**: Make sure "Centris AI" appears in each category
2. **Restart App**: Sometimes permissions need app restart to take effect
3. **Check TCC Database**: Use `tccutil` command to reset if needed
4. **Verify App Bundle**: Make sure you're running the built app, not dev mode

### Common Issues:

- **"Permission denied" but it's enabled**: App may need restart
- **Globe key doesn't work**: Check Accessibility permission specifically
- **Microphone not activating**: Check both Microphone permission AND that no other app is using it
- **Screen capture fails**: Screen Recording permission required on macOS

---

## 📚 Technical Details

### Permission Checking Methods:

1. **Electron's `systemPreferences`**: For microphone (most reliable)
2. **`node-mac-permissions`**: For TCC database checks (all permissions)
3. **AppleScript tests**: Fallback for accessibility (less reliable in dev mode)

### Permission Request Methods:

1. **`permissions.askForMicrophoneAccess()`**: Programmatic request
2. **`permissions.askForScreenCaptureAccess()`**: Programmatic request
3. **`permissions.askForInputMonitoringAccess()`**: Programmatic request
4. **System Settings URL**: Opens specific privacy pane (for accessibility)

### Files Involved:

- `desktop/src/helpers/permissionMonitor.js` - Monitors all permissions
- `desktop/src/helpers/onboardingManager.js` - Requests permissions
- `desktop/src/services/permissionService.js` - Permission status service
- `desktop/src/helpers/ipcHandlers.js` - IPC handlers for permission checks
- `desktop/preload.js` - Exposes permission APIs to renderer

---

## ✅ Summary

**Total Permissions Requested: 4**

1. ✅ **Microphone** - Core (Voice dictation)
2. ✅ **Accessibility** - Core (UI control, text insertion, globe key)
3. ✅ **Screen Recording** - Advanced (Screen capture, OCR, system audio)
4. ✅ **Input Monitoring** - Advanced (Keyboard monitoring)

**Minimum Required for Basic Functionality:**

- Microphone + Accessibility (Core permissions)

**Full Functionality:**

- All 4 permissions enabled

---

_Last Updated: December 19, 2025_
