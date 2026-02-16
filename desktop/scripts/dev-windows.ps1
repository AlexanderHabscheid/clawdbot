# Centris Desktop - Windows Development Script
# Run this from PowerShell in the desktop directory

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Centris Desktop - Windows Dev Mode" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check dependencies
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install --legacy-peer-deps
}

Write-Host "Starting Centris Desktop in development mode..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Hotkey: Ctrl+` (backtick) to toggle dictation" -ForegroundColor Cyan
Write-Host "        Press Ctrl+Shift+D to open DevTools" -ForegroundColor Cyan
Write-Host ""
Write-Host "Make sure the backend is running on http://127.0.0.1:5001" -ForegroundColor Yellow
Write-Host ""

# Set environment and start
$env:NODE_ENV = "development"
npm run dev
