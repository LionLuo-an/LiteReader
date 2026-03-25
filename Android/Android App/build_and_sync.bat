@echo off
echo ==========================================
echo      LightReader Android Build Script
echo ==========================================

set /p AppVersion=Enter new version (Press Enter to skip): 
if "%AppVersion%"=="" goto BuildStep

echo Updating version to v%AppVersion%...
call node scripts\update-version.js %AppVersion%
if %errorlevel% neq 0 (
    echo Version update failed!
    pause
    exit /b %errorlevel%
)
echo Version updated successfully.

:BuildStep
echo [0/2] Cleaning previous build...
if exist dist rd /s /q dist

echo.
echo [1/2] Building Vue Frontend...
call npm run build
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b %errorlevel%
)

echo.
echo [2/2] Syncing to Android Project...
call npx cap sync
if %errorlevel% neq 0 (
    echo Sync failed!
    pause
    exit /b %errorlevel%
)

echo.
echo ==========================================
echo      Build + Sync Complete!
echo ==========================================
echo [IMPORTANT] The code has been synced to the Android project.
echo [IMPORTANT] You MUST now Re-Run/"Run 'app'" in Android Studio 
echo [IMPORTANT] or Build a new APK to see the changes on your device!
echo ==========================================
pause
