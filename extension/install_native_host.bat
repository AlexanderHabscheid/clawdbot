@echo off
REM Centris Native Messaging Host Installer (Windows)
REM
REM This script installs the native messaging host for the Centris Chrome extension.
REM It sets up the host script and registry key so Chrome can communicate with the desktop app.
REM
REM Run this script as Administrator!

setlocal enabledelayedexpansion

echo ============================================================
echo        Centris Native Messaging Host Installer
echo ============================================================
echo.

REM Check for admin rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script requires Administrator privileges.
    echo Please right-click and select "Run as administrator"
    pause
    exit /b 1
)

REM Get script directory
set "SCRIPT_DIR=%~dp0"
set "HOST_DIR=%SCRIPT_DIR%native-host"

REM Check if host files exist
if not exist "%HOST_DIR%\centris_host.py" (
    echo ERROR: centris_host.py not found in %HOST_DIR%
    pause
    exit /b 1
)

if not exist "%HOST_DIR%\com.centris.host.json" (
    echo ERROR: com.centris.host.json not found in %HOST_DIR%
    pause
    exit /b 1
)

REM Set installation directories
set "INSTALL_DIR=%ProgramFiles%\Centris"
set "HOST_PATH=%INSTALL_DIR%\centris_host.py"
set "MANIFEST_PATH=%INSTALL_DIR%\com.centris.host.json"

echo Installation paths:
echo   Install directory: %INSTALL_DIR%
echo   Host script: %HOST_PATH%
echo   Manifest: %MANIFEST_PATH%
echo.

REM Prompt for extension ID
set "EXTENSION_ID="
set /p EXTENSION_ID="Enter your Chrome extension ID (from chrome://extensions): "

if "%EXTENSION_ID%"=="" (
    set "EXTENSION_ID=EXTENSION_ID_PLACEHOLDER"
    echo Using placeholder. Remember to update the manifest with your actual extension ID!
)

REM Create installation directory
echo Creating installation directory...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
echo Done.

REM Copy host script
echo Installing host script...
copy /Y "%HOST_DIR%\centris_host.py" "%HOST_PATH%" >nul
echo Done.

REM Create manifest with correct paths (escape backslashes for JSON)
set "HOST_PATH_ESCAPED=%HOST_PATH:\=\\%"

echo Creating manifest file...
(
echo {
echo   "name": "com.centris.host",
echo   "description": "Centris AI Native Messaging Host - Enables fast communication between Chrome extension and desktop app",
echo   "path": "%HOST_PATH_ESCAPED%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXTENSION_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"
echo Done.

REM Add registry key for Chrome
echo Registering with Chrome...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.centris.host" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul
echo Done.

REM Add registry key for Chromium (if installed)
reg query "HKCU\Software\Chromium" >nul 2>&1
if %errorLevel% equ 0 (
    echo Registering with Chromium...
    reg add "HKCU\Software\Chromium\NativeMessagingHosts\com.centris.host" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul
    echo Done.
)

REM Add registry key for Edge (Chromium-based)
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.centris.host" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul
echo Registered with Microsoft Edge.

REM Add registry key for Brave
reg add "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.centris.host" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul
echo Registered with Brave.

echo.
echo ============================================================
echo              Installation Complete!
echo ============================================================
echo.
echo Next steps:
echo 1. Open Chrome and go to chrome://extensions/
echo 2. Find your Centris extension and copy its ID
echo 3. If you used a placeholder, edit the manifest:
echo    %MANIFEST_PATH%
echo 4. Reload the extension
echo 5. The extension will now use Native Messaging (faster!)
echo.
echo Note: If the extension falls back to WebSocket, check:
echo   - Extension ID matches the one in the manifest
echo   - Host script path is correct in the manifest
echo   - Python is available in PATH
echo.

pause

