@echo off
REM ============================================================================
REM SmartBook Monorepo - Workspace Bootstrap (Windows Batch)
REM ============================================================================
REM This script installs workspace dependencies using pnpm

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
        echo [INFO] Manual install: npm install -g pnpm
        pause
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
    pause
    exit /b 1
)

echo.
echo [SUCCESS] ========================================
echo [SUCCESS] Workspace bootstrap completed!
echo [SUCCESS] ========================================
echo.
echo [INFO] Next steps:
echo   1. Run: .\scripts\bootstrap.bat
echo   2. Access web UI at http://localhost:5173
echo.
pause
