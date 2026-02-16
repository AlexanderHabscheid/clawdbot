# Onboarding to Pill UI Flow

## Expected Flow After "Launch Centris AI" Click

### Step-by-Step Process

1. **User clicks "Launch Centris AI" button** (in ReadyStep component)
   - Button text: "Launch Centris AI"
   - Location: `Onboarding.jsx` → `ReadyStep` component

2. **Onboarding completion handler runs** (`handleComplete`)
   - Saves hotkey to localStorage: `dictationKey`
   - Saves onboarding status: `onboarding_completed = 'true'`
   - Updates electron-store via IPC
   - Calls `onComplete()` callback

3. **App.jsx receives completion** (`handleOnboardingComplete`)
   - Sets `showOnboarding = false`
   - Ensures localStorage is set
   - Calls `window.electronAPI.minimizeAfterOnboarding()`

4. **IPC Handler: `minimize-after-onboarding`**
   - Converts window from onboarding mode to overlay mode
   - Creates new frameless, transparent, full-screen window
   - Loads URL: `http://localhost:5174/` (NO `panel=true` parameter)
   - Waits for React to render pill UI

5. **React App loads in new window**
   - Checks `localStorage.onboarding_completed` → sees `'true'`
   - Sets `showOnboarding = false`
   - Checks `isControlPanel` → sees `false` (no panel param)
   - Renders pill UI component (Glass AI style)

6. **Pill UI appears**
   - Positioned above macOS dock
   - Transparent background
   - Glass AI styling with Framer Motion animations
   - Clickable and interactive

## What Should Happen

✅ **Onboarding window closes** (old framed window)
✅ **New overlay window opens** (frameless, transparent, full-screen)
✅ **Pill UI renders** (Glass AI style, positioned above dock)
✅ **Window stays visible** (not minimized, so pill shows)
✅ **Control Panel does NOT open** (only pill UI)

## What Should NOT Happen

❌ Control Panel opening automatically
❌ Old "Recent Transcriptions" page showing
❌ Window minimizing before pill UI renders
❌ Window staying in onboarding mode

## Debugging

If pill UI doesn't appear, check console logs for:

1. `[Onboarding] 🎉 User clicked Launch Centris AI!`
2. `[App] 🎉 Onboarding complete! Transitioning to pill UI...`
3. `[WindowManager] 🎯 Loading overlay window with URL: http://localhost:5174/`
4. `[WindowManager] ✅ URL has NO panel parameter - will show pill UI`
5. `[App] 🎨 Rendering main UI (pill indicator) - Glass AI style`
6. `[IPC] React render check X/15:` - Should show `hasPill: true`

## Key Files

- **Onboarding completion**: `desktop/src/components/Onboarding.jsx` → `handleComplete()`
- **App transition**: `desktop/src/App.jsx` → `handleOnboardingComplete()`
- **Window conversion**: `desktop/src/helpers/windowManager.js` → `convertToOverlayMode()`
- **IPC handler**: `desktop/src/helpers/ipcHandlers.js` → `minimize-after-onboarding`
- **Pill UI render**: `desktop/src/App.jsx` → Main return statement

## Verification Checklist

After clicking "Launch Centris AI":

- [ ] Console shows onboarding completion logs
- [ ] Window converts to overlay mode
- [ ] URL loads without `panel=true`
- [ ] React detects `onboarding_completed === 'true'`
- [ ] `showOnboarding` is `false`
- [ ] `isControlPanel` is `false`
- [ ] Pill UI element exists in DOM (`[data-pill-ui="true"]`)
- [ ] Pill UI is visible (not hidden)
- [ ] Window stays visible (not minimized)
- [ ] Control Panel does NOT open

## Current Implementation

✅ Onboarding saves status correctly
✅ Window conversion happens
✅ URL loads without panel parameter
✅ React checks onboarding status
✅ Pill UI component exists and renders
✅ Window stays visible after conversion

The flow is implemented correctly. If pill UI doesn't show, check console logs to see where it's failing.
