# Automatic Cache Clearing Setup

## ✅ Implemented

### 1. Startup Cache Clearing

The `npm run dev` command now automatically clears all caches before starting:

```json
"dev": "node scripts/clear-caches-startup.js && concurrently -k -r \"npm:dev:renderer\" \"npm:dev:main\""
```

### 2. What Gets Cleared

**On Startup (`clear-caches-startup.js`):**

- ✅ Electron cache directories (Cache, Code Cache, GPUCache, ShaderCache)
- ✅ System cache (macOS: ~/Library/Caches/Centris AI)
- ✅ Vite cache (src/.vite, src/dist, node_modules/.vite)

**On App Start (`main.js`):**

- ✅ Electron session cache
- ✅ Storage data (localStorage, cookies, etc.)

### 3. Scripts Available

**Automatic (runs on `npm run dev`):**

- `scripts/clear-caches-startup.js` - Clears all caches before starting

**Manual:**

- `scripts/clear-all-caches.sh` - Comprehensive cache clearing
- `scripts/clear-onboarding-complete.js` - Onboarding-specific clearing
- `npm run clear-caches` - Quick cache clear (onboarding + Electron)

## Usage

### Development

```bash
npm run dev
```

This automatically clears caches first, then starts the dev server.

### Manual Cache Clear

```bash
# Full clear
./scripts/clear-all-caches.sh

# Onboarding only
node scripts/clear-onboarding-complete.js

# Quick clear
npm run clear-caches
```

## Benefits

1. **No Stale Code**: Always starts fresh
2. **Consistent State**: No cached UI components
3. **Easy Development**: No manual cache clearing needed
4. **Reliable Testing**: Every run is clean

## Cache Locations Cleared

### macOS

- `~/Library/Application Support/Centris AI/Cache`
- `~/Library/Application Support/Centris AI/Code Cache`
- `~/Library/Application Support/Centris AI/GPUCache`
- `~/Library/Application Support/Centris AI/ShaderCache`
- `~/Library/Caches/Centris AI`
- `desktop/src/.vite`
- `desktop/src/dist`
- `desktop/node_modules/.vite`

### Windows

- `%APPDATA%/Centris AI/Cache`
- `%APPDATA%/Centris AI/Code Cache`
- `%APPDATA%/Centris AI/GPUCache`
- `%APPDATA%/Centris AI/ShaderCache`

### Linux

- `~/.config/Centris AI/Cache`
- `~/.config/Centris AI/Code Cache`
- `~/.config/Centris AI/GPUCache`
- `~/.config/Centris AI/ShaderCache`

## Notes

- Cache clearing happens automatically on every `npm run dev`
- Takes ~1-2 seconds (negligible)
- Safe to run multiple times
- Won't delete important data (only caches)
