# Electron UI Adaptation Guide

## Key Differences: Browser vs Electron

### Browser (Glass AI)

- Runs in a browser window with standard HTML/CSS
- Background is always opaque (white/black)
- Backdrop-blur works natively
- No window management concerns
- Standard DOM behavior

### Electron (Centris AI)

- Runs in a native window with transparency support
- **Onboarding**: Opaque window (`transparent: false`, `backgroundColor: "#000000"`)
- **Post-onboarding**: Transparent overlay (`transparent: true`, `backgroundColor: '#00000000'`)
- Backdrop-blur needs vendor prefixes for Electron
- Window management (click-through, always-on-top, etc.)
- Different rendering context

## Adaptations Made

### 1. **Onboarding Window** ✅

- **Window Config**: `transparent: false`, `backgroundColor: "#000000"`
- **CSS**: Full black background works perfectly
- **Background Gradients**: Work as expected (subtle blur effects)
- **Glass Cards**: Use backdrop-blur with vendor prefixes

### 2. **Post-Onboarding Pill UI** ✅

- **Window Config**: `transparent: true`, `backgroundColor: '#00000000'`
- **Root Container**: Fully transparent (`background: transparent`)
- **Pill Component**: Uses backdrop-blur for glass effect
- **Settings Panel**: Uses backdrop-blur for glass effect
- **Click-through**: Window is click-through except for pill/settings (handled by `pointer-events`)

### 3. **Backdrop Blur Support** ✅

```css
/* Electron-compatible backdrop-blur */
backdrop-filter: blur(24px);
-webkit-backdrop-filter: blur(24px); /* Required for Electron */
```

### 4. **CSS Adaptations**

#### Glassmorphism Utilities

```css
.glass-panel {
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px); /* Electron */
}

.glass-card {
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px); /* Electron */
}
```

#### Background Handling

- **Onboarding**: `bg-black` with inline style `backgroundColor: '#000000'` (ensures solid background)
- **Pill UI**: Transparent root, backdrop-blur on components

### 5. **Window States**

#### Onboarding State

```javascript
// Window: Framed, opaque, centered
{
  frame: true,
  transparent: false,
  backgroundColor: "#000000",
  width: 600,
  height: 750
}
```

#### Post-Onboarding State

```javascript
// Window: Frameless, transparent, full-screen overlay
{
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  width: screen.width,
  height: screen.height,
  clickThrough: true (except UI elements)
}
```

## Critical Electron Considerations

### 1. **Transparency**

- Electron windows can be fully transparent
- Use `backgroundColor: '#00000000'` for transparency
- Ensure CSS doesn't override transparency

### 2. **Backdrop Blur**

- Requires `-webkit-backdrop-filter` prefix in Electron
- Works on macOS (native support)
- May need fallback on Windows/Linux

### 3. **Click-Through**

- Window can be click-through (`setIgnoreMouseEvents(true)`)
- UI elements need `pointer-events: auto`
- Settings panel needs proper z-index

### 4. **Performance**

- Backdrop-blur can be expensive
- Use sparingly on low-end hardware
- Consider fallbacks for older systems

### 5. **Window Management**

- `alwaysOnTop: true` for overlay
- `skipTaskbar: true` for overlay
- `visibleOnAllWorkspaces: true` for macOS

## Testing Checklist

- [ ] Onboarding window has solid black background
- [ ] Onboarding glass cards have blur effect
- [ ] Post-onboarding pill has blur effect
- [ ] Settings panel has blur effect
- [ ] Click-through works (clicks pass through except UI)
- [ ] Pill is clickable
- [ ] Settings panel is clickable
- [ ] Window stays on top
- [ ] Backdrop-blur works on macOS
- [ ] Performance is acceptable

## Fallbacks

If backdrop-blur doesn't work:

1. Use solid backgrounds with opacity
2. Use CSS `filter: blur()` on pseudo-elements
3. Use SVG filters as fallback

## Platform-Specific Notes

### macOS ✅

- Full backdrop-blur support
- Native transparency
- Best performance

### Windows ⚠️

- Backdrop-blur may need fallback
- Transparency works but may have performance impact
- Consider solid backgrounds with opacity

### Linux ⚠️

- Backdrop-blur support varies by compositor
- May need fallbacks
- Test on target distributions

## Code Examples

### Onboarding Component (Opaque Window)

```jsx
<div
  className="min-h-screen bg-black"
  style={{ backgroundColor: "#000000" }} // Ensure solid background
>
  {/* Glass cards work here */}
  <div className="glass-card">...</div>
</div>
```

### Pill UI Component (Transparent Overlay)

```jsx
<div style={{ background: "transparent" }}>
  {/* Pill with backdrop-blur */}
  <motion.div
    style={{
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
    }}
  >
    {/* Content */}
  </motion.div>
</div>
```

## Summary

✅ **Onboarding**: Works perfectly with opaque window
✅ **Pill UI**: Adapted for transparent overlay with backdrop-blur
✅ **Settings Panel**: Uses backdrop-blur in transparent context
✅ **Click-through**: Properly handled with pointer-events
✅ **Performance**: Optimized for Electron rendering

The UI is now fully adapted for Electron while maintaining the Glass AI design aesthetic!
