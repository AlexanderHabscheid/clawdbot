# Centris Desktop - Windows Build Script
# Run this from PowerShell in the desktop directory

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Centris Desktop - Windows Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js version
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "ERROR: Node.js is not installed!" -ForegroundColor Red
    Write-Host "Please install Node.js 18+ from https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green

# Check if npm is available
$npmVersion = npm --version 2>$null
if (-not $npmVersion) {
    Write-Host "ERROR: npm is not installed!" -ForegroundColor Red
    exit 1
}

Write-Host "npm version: $npmVersion" -ForegroundColor Green
Write-Host ""

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install --legacy-peer-deps

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install dependencies!" -ForegroundColor Red
    exit 1
}

Write-Host "Dependencies installed successfully!" -ForegroundColor Green
Write-Host ""

# Build the renderer (React app)
Write-Host "Building renderer (React app)..." -ForegroundColor Yellow
npm run build:renderer

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to build renderer!" -ForegroundColor Red
    exit 1
}

Write-Host "Renderer built successfully!" -ForegroundColor Green
Write-Host ""

# Build the Electron app for Windows
Write-Host "Building Electron app for Windows..." -ForegroundColor Yellow
npx electron-builder --win --dir

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to build Electron app!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  BUILD COMPLETED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "The built app is in: dist/win-unpacked/" -ForegroundColor Yellow
Write-Host "Run: .\dist\win-unpacked\Centris AI.exe" -ForegroundColor Yellow
Write-Host ""
Write-Host "Default hotkey: Ctrl+` (backtick) to start/stop dictation" -ForegroundColor Cyan
