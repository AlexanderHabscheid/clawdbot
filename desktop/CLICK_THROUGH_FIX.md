# Click-Through and Onboarding Fix

## Issues Identified

1. **Onboarding Not Appearing**: Window was being shown before content loaded
2. **Click-Through Not Working**: `setIgnoreMouseEvents(true, { forward: true })` needs proper timing

## Solutions Applied

### 1. Onboarding Fix

- **Problem**: Window was shown before `ready-to-show` event
- **Fix**: Only show window when `ready-to-show` fires
- **Also**: Added `did-finish-load` handler as backup to ensure window appears

### 2. Click-Through Fix

- **Problem**: Click-through enabled too early or not properly configured
- **Fix**:
  - Ensure window is visible before enabling click-through
  - Wait 2 seconds for React to fully render and set CSS `pointer-events: none`
  - Re-apply click-through after 1 second to ensure it sticks
  - Window must be shown and focused before enabling

## How Click-Through Works

1. **Electron Window**: `setIgnoreMouseEvents(true, { forward: true })` forwards mouse events
2. **React CSS**: Container has `pointerEvents: 'none'` - allows clicks through
3. **Pill Component**: Also has `pointerEvents: 'none'` - purely visual

## Testing

1. **Onboarding**: Should appear when `hasCompletedOnboarding` is false
2. **Click-Through**: Should allow clicks to pass through to underlying apps
3. **Pill UI**: Should be visible but not capture any clicks

## If Still Not Working

1. **Check Electron version**: `npm list electron`
2. **Check window visibility**: Look for logs showing window is visible
3. **Check click-through**: Look for logs showing click-through enabled
4. **Try disabling click-through temporarily**: Comment out `setIgnoreMouseEvents` to test if window appears
