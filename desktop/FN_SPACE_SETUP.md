# Fn+Space Hotkey Setup (Like Wispr Flow)

## What This Does

Centris now supports **Fn+Space** as the default hotkey on macOS, just like Wispr Flow. This uses a native CGEventTap listener that detects when you press Space while holding the Fn modifier.

## How It Works

1. **Native Binary**: `macos-fn-space-listener.c` uses CGEventTap API to detect Fn+Space globally
2. **Event Detection**: Listens for Space key (keycode 49) when Fn modifier flag is active
3. **Global Detection**: Works system-wide, in any app, just like Wispr Flow

## Requirements

- **macOS only** (Windows/Linux use standard hotkeys)
- **Accessibility permissions** must be granted (same as Globe key)

## Compilation

The binary is compiled automatically, but you can rebuild it:

```bash
npm run compile:fn-space
# Or compile both Globe and Fn+Space listeners:
npm run compile:all
```

## Default Behavior

- **macOS**: Fn+Space (like Wispr Flow)
- **Windows/Linux**: Backtick (`)

## How It's Different from Electron's globalShortcut

- Electron's `globalShortcut` API **cannot** detect Fn modifier
- Our native listener uses **CGEventTap** (same as Wispr Flow) to see modifier flags
- This allows detection of Fn+Space, Fn+other keys, etc.

## Testing

1. Grant accessibility permissions in System Settings
2. Start the app: `npm run dev`
3. Press **Fn+Space** anywhere
4. The dictation panel should appear

## Troubleshooting

If Fn+Space doesn't work:

1. **Check permissions**: System Settings > Privacy & Security > Accessibility > Enable Centris
2. **Check binary**: Make sure `resources/bin/macos-fn-space-listener` exists and is executable
3. **Check logs**: Look for `[FnSpaceKeyManager]` messages in console
4. **Try Globe key**: If Globe key works but Fn+Space doesn't, there may be a keyboard-specific issue

## Technical Details

- Uses `CGEventTapCreate` with `kCGEventFlagMaskSecondaryFn` flag
- Listens at HID level (before system processes events)
- Returns events so system continues processing normally
- Requires Accessibility permissions (same as Globe key listener)
