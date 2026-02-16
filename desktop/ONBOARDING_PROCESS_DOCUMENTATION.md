# Centris AI Onboarding Process Documentation

## Overview

This document provides detailed instructions on the Centris AI onboarding process, the post-onboarding screen, and the application architecture behind it.

## Table of Contents

1. [Onboarding Flow](#onboarding-flow)
2. [Post-Onboarding Screen](#post-onboarding-screen)
3. [Application Architecture](#application-architecture)
4. [Color Scheme](#color-scheme)
5. [Troubleshooting](#troubleshooting)

---

## Onboarding Flow

### Step-by-Step Process

#### Step 1: Welcome Screen

- **Purpose**: Introduction to Centris AI
- **Content**:
  - Welcome message with Centris AI branding
  - Feature highlights:
    - Voice Control: Speak naturally, get instant transcription
    - Global Hotkey: Activate from any app with Fn key
- **UI Elements**:
  - Centris logo (gradient orange to purple)
  - Feature cards with icons
  - "Next" button to proceed

#### Step 2: Microphone Permission (macOS only)

- **Purpose**: Request microphone access for voice input
- **Process**:
  1. Checks current microphone permission status
  2. If not granted, displays instructions
  3. User clicks "Open System Settings" button
  4. System Settings opens to Microphone privacy section
  5. User enables "Centris AI" in the microphone list
  6. App polls every 1.5 seconds to detect permission grant
  7. Auto-advances to next step when permission is detected
- **UI Elements**:
  - Microphone icon (orange when pending, green when granted)
  - Status indicator showing permission state
  - Instructions card
  - "Open System Settings" button

#### Step 3: Accessibility Permission (macOS only)

- **Purpose**: Request accessibility access for Fn key detection and text input
- **Process**:
  1. Checks current accessibility permission status
  2. If not granted, displays detailed instructions
  3. User clicks "Open System Settings" button
  4. System Settings opens to Accessibility section
  5. User finds "Centris AI" in the list and toggles it ON
  6. App polls every 1.5 seconds to detect permission grant
  7. Auto-advances to next step when permission is detected
- **UI Elements**:
  - Shield icon (purple when pending, green when granted)
  - Step-by-step instructions
  - "Open System Settings" button

#### Step 4: Hotkey Selection

- **Purpose**: Choose activation hotkey for voice input
- **Options**:
  - **macOS**: 🌐 Fn Key (Globe key) - Press Fn alone
  - **All Platforms**:
    - ` Backtick (top-left of keyboard)
    - F1, F2, F12 (Function keys)
- **Process**:
  1. User selects preferred hotkey from list
  2. Selected hotkey is highlighted with orange border
  3. Checkmark appears next to selected option
  4. Hotkey is saved to localStorage and electron-store
- **UI Elements**:
  - Keyboard icon
  - Hotkey option cards (selectable)
  - Visual feedback for selection

#### Step 5: Ready Screen

- **Purpose**: Confirm setup completion
- **Content**:
  - Success message: "You're All Set!"
  - Confirmation that Centris AI is ready
  - Display of selected hotkey
- **Actions**:
  - "Get Started" button completes onboarding
- **UI Elements**:
  - Zap icon (green gradient)
  - Confirmation message
  - Hotkey display card

### Onboarding Completion Process

When user clicks "Get Started":

1. **Save State**:
   - Hotkey saved to `localStorage.dictationKey`
   - Onboarding completion flag set: `localStorage.onboarding_completed = 'true'`
   - Electron-store updated via IPC: `completeOnboarding()`

2. **Window Conversion**:
   - Calls `minimizeAfterOnboarding()` IPC handler
   - Window manager converts from onboarding window (framed) to overlay window (frameless)
   - New overlay window is created with:
     - Full-screen transparent background
     - Click-through enabled (except for UI elements)
     - Always on top
     - Hidden from taskbar

3. **React Rendering**:
   - New window loads React app
   - React checks `localStorage.onboarding_completed`
   - If `true`, renders main UI (pill indicator)
   - If `false`, shows onboarding again

4. **Pill UI Rendering**:
   - System polls for pill UI element to appear
   - Checks every 500ms for up to 5 seconds
   - Once pill is visible, window is configured for overlay mode
   - Window remains visible (not minimized) so pill UI shows

5. **Control Panel**:
   - Control Panel window opens automatically
   - Provides full settings interface

---

## Post-Onboarding Screen

### Main UI: Pill Indicator

After onboarding completes, the main UI is a **pill-shaped indicator** positioned above the macOS dock.

#### Visual States

1. **Collapsed State** (Default):
   - Thin purple line (16px wide, 1px height)
   - Positioned above dock
   - Minimal visual footprint
   - Color: `bg-purple-500/70`

2. **Expanded State** (When active):
   - Full pill shape (256px wide, 48px height)
   - Black background with orange border
   - Shows status information
   - Color scheme:
     - Background: `bg-black/95`
     - Border: `border-orange-500/40`
     - Shadow: `shadow-2xl`

3. **Listening State**:
   - Orange accent colors
   - Border: `border-orange-500/80`
   - Background: `bg-orange-950/30`
   - Animated waveform visualization
   - Status text: "Listening..."

4. **Processing State**:
   - Purple accent colors
   - Border: `border-purple-500/60`
   - Background: `bg-black/95`
   - Spinner animation
   - Status text: "Processing..."

#### UI Components

**Status Indicator**:

- Dot indicator (orange/purple based on state)
- Status text ("Ready", "Listening...", "Processing...")
- Mode indicator ("⚡ Action" or "📝 Dictation")

**Settings Button**:

- Gear icon (orange)
- Opens settings panel
- Positioned on right side of expanded pill

**Settings Panel**:

- Modal overlay above pill
- Centris color scheme (black, orange, purple)
- Settings options:
  - Activation Key (read-only, shows "Configured in onboarding")
  - Voice Language (dropdown)
  - Auto-formatting (toggle)
  - Context awareness (toggle)

### Positioning

- **Dock Detection**: App queries macOS for dock height
- **Position**: `bottom: dockHeight + 20px`
- **Horizontal**: Centered (`left-1/2 -translate-x-1/2`)

---

## Application Architecture

### File Structure

```
desktop/
├── src/
│   ├── App.jsx                    # Main app component
│   ├── components/
│   │   ├── Onboarding.jsx        # Onboarding flow component
│   │   └── SettingsModal.tsx     # Settings modal (Control Panel)
│   ├── helpers/
│   │   ├── windowManager.js      # Window lifecycle management
│   │   └── ipcHandlers.js        # IPC communication handlers
│   └── index.css                 # Centris theme styles
├── preload.js                    # Electron preload script
└── main.js                       # Electron main process
```

### Component Flow

```
App.jsx
├── Check onboarding status (localStorage)
├── If onboarding needed:
│   └── Render <Onboarding />
└── If onboarding complete:
    └── Render Pill UI
        ├── Collapsed/Expanded states
        ├── Settings button
        └── Settings Panel (when open)
```

### IPC Communication

**Onboarding IPC Handlers**:

- `get-onboarding-status`: Check if onboarding completed
- `complete-onboarding`: Mark onboarding as complete
- `reset-onboarding`: Clear onboarding status
- `minimize-after-onboarding`: Convert window to overlay mode

**Window Management**:

- `convertToOverlayMode()`: Recreates window as frameless overlay
- `setMainWindowInteractivity()`: Controls click-through mode
- `createControlPanelWindow()`: Opens settings window

### State Management

**localStorage Keys**:

- `onboarding_completed`: `'true'` when onboarding done
- `dictationKey`: Selected hotkey value

**Electron Store**:

- `hasCompletedOnboarding`: Boolean flag
- Persisted across app restarts

---

## Color Scheme

### Centris Theme Colors

**Primary Colors**:

- **Orange**: `#ff6b35` (`--color-primary`)
- **Purple**: `#a855f7` (`--color-secondary`)
- **Black**: `#000000` (`--color-background`)

**Usage**:

- **Orange**: Primary actions, borders, accents, status indicators
- **Purple**: Secondary elements, text accents, collapsed pill
- **Black**: Backgrounds, cards, panels

### Component Colors

**Onboarding Screen**:

- Background: `bg-gradient-to-br from-black via-purple-900/20 to-black`
- Cards: `bg-black/90` with `border-orange-500/20`
- Buttons: `bg-gradient-to-r from-orange-600 to-orange-700`

**Pill UI**:

- Collapsed: `bg-purple-500/70`
- Expanded: `bg-black/95` with `border-orange-500/40`
- Listening: `bg-orange-950/30` with `border-orange-500/80`
- Processing: `bg-black/95` with `border-purple-500/60`

**Settings Panel**:

- Background: `bg-black/98`
- Border: `border-orange-500/40`
- Text: White primary, `text-purple-300` for labels

---

## Troubleshooting

### Pill UI Not Appearing After Onboarding

**Symptoms**: After completing onboarding, pill indicator doesn't show.

**Possible Causes**:

1. Window minimized before React renders
2. Window set to click-through before pill renders
3. React state check timing issue

**Solutions**:

- ✅ **Fixed**: Window now polls for pill UI before minimizing
- ✅ **Fixed**: Window stays visible until pill is confirmed rendered
- ✅ **Fixed**: Increased timeout and polling frequency

### Settings Button Not Clickable

**Symptoms**: Settings button doesn't respond to clicks.

**Possible Causes**:

1. Window in click-through mode blocking clicks
2. Z-index issues
3. Pointer events not properly set

**Solutions**:

- ✅ **Fixed**: Added `pointer-events-auto` to button
- ✅ **Fixed**: Added `z-50` to pill container
- ✅ **Fixed**: Added `z-[60]` to settings panel
- ✅ **Fixed**: Added `stopPropagation()` to prevent event blocking

### Color Scheme Not Applied

**Symptoms**: Post-onboarding screen doesn't match Centris colors.

**Possible Causes**:

1. CSS not loading properly
2. Tailwind classes not applied
3. Background transparency issues

**Solutions**:

- ✅ **Fixed**: Enhanced color opacity for better visibility
- ✅ **Fixed**: Ensured Centris color variables are used
- ✅ **Fixed**: Improved contrast for pill UI

### Window Doesn't Convert After Onboarding

**Symptoms**: Window stays in onboarding mode after completion.

**Possible Causes**:

1. IPC handler not called
2. Window conversion failed
3. React state not updating

**Solutions**:

- Check console logs for IPC errors
- Verify `localStorage.onboarding_completed === 'true'`
- Check window manager logs for conversion errors

---

## Testing Checklist

- [ ] Onboarding flow completes successfully
- [ ] Microphone permission detection works
- [ ] Accessibility permission detection works
- [ ] Hotkey selection saves correctly
- [ ] Pill UI appears after onboarding
- [ ] Pill UI uses correct Centris colors
- [ ] Settings button is clickable
- [ ] Settings panel opens and closes
- [ ] Settings panel buttons are clickable
- [ ] Window converts to overlay mode
- [ ] Control Panel opens automatically
- [ ] Window remains visible (not minimized)

---

## Developer Notes

### Key Code Locations

**Onboarding Component**: `desktop/src/components/Onboarding.jsx`

- Handles all 5 steps
- Permission checking logic
- Hotkey selection

**Main App**: `desktop/src/App.jsx`

- Renders onboarding or pill UI based on state
- Manages pill UI states
- Settings panel logic

**Window Manager**: `desktop/src/helpers/windowManager.js`

- `convertToOverlayMode()`: Window conversion logic
- Window lifecycle management

**IPC Handlers**: `desktop/src/helpers/ipcHandlers.js`

- `minimize-after-onboarding`: Post-onboarding transition
- Polling logic for pill UI detection

### Debugging Tips

1. **Check Console Logs**: All major steps log to console with emoji prefixes
2. **localStorage Inspection**: Check `localStorage.onboarding_completed` in DevTools
3. **Window State**: Use Electron DevTools to inspect window properties
4. **React DevTools**: Use React DevTools to inspect component state

### Common Issues

**Issue**: Pill doesn't appear

- **Check**: Is `onboarding_completed` set in localStorage?
- **Check**: Are there React render errors in console?
- **Check**: Is window visible and not minimized?

**Issue**: Settings button doesn't work

- **Check**: Is window in click-through mode? (Should be `false` for UI elements)
- **Check**: Are pointer-events set correctly?
- **Check**: Z-index conflicts?

**Issue**: Colors wrong

- **Check**: Is `index.css` loaded?
- **Check**: Are Tailwind classes applied?
- **Check**: CSS specificity conflicts?

---

## Future Improvements

1. **Animation**: Add smooth transitions between onboarding steps
2. **Accessibility**: Improve screen reader support
3. **Error Handling**: Better error messages for permission failures
4. **Customization**: Allow users to customize pill appearance
5. **Tutorial**: Add interactive tutorial after onboarding

---

## Version History

- **v1.0** (Current): Initial onboarding flow with 5 steps
- **v1.1** (Fixed): Pill UI rendering issues resolved
- **v1.2** (Fixed): Settings button clickability fixed
- **v1.3** (Fixed): Color scheme consistency improved
