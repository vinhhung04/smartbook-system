@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul

echo.
echo [INFO] ========================================
echo [INFO] SmartBook Workspace Bootstrap
echo [INFO] ========================================
echo.

REM Check if pnpm is installed
echo [INFO] Checking pnpm installation...
pnpm --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm is not installed
    echo [WARN] Installing pnpm globally...
    npm install -g pnpm
    if errorlevel 1 (
        echo [ERROR] Failed to install pnpm
        echo [INFO] Please run manually: npm install -g pnpm
        exit /b 1
    )
)

echo [INFO] pnpm version:
pnpm --version

REM Install workspace dependencies
echo.
echo [INFO] Installing workspace dependencies with pnpm...
echo [INFO] This may take a few minutes...
echo.

cd /d "%~dp0.."
pnpm install

if errorlevel 1 (
    echo [ERROR] pnpm install failed
    exit /b 1
)

echo.
echo [SUCCESS] ========================================
echo [SUCCESS] Workspace bootstrap completed!
echo [SUCCESS] ========================================
echo.
echo [INFO] Next steps:
echo   scripts\bootstrap.bat
echo.

if /I "%~1"=="--with-docker" (
    call "%~dp0bootstrap.bat"
)

exit /b 0
