@echo off
REM ============================================================================
REM SmartBook System - Environment Check (Windows Batch)
REM ============================================================================

setlocal enabledelayedexpansion
chcp 65001 > nul

echo.
echo [INFO] ========================================
echo [INFO] SmartBook Environment Check
echo [INFO] ========================================
echo.

set FAILED=0

REM Check Node.js
echo [INFO] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed
    set FAILED=1
) else (
    echo [SUCCESS] Node.js version:
    node --version
)
echo.

REM Check npm
echo [INFO] Checking npm...
npm --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed
    set FAILED=1
) else (
    echo [SUCCESS] npm version:
    npm --version
)
echo.

REM Check pnpm
echo [INFO] Checking pnpm...
pnpm --version >nul 2>&1
if errorlevel 1 (
    echo [WARN] pnpm is not installed (optional)
    echo [WARN] Install with: npm install -g pnpm
) else (
    echo [SUCCESS] pnpm version:
    pnpm --version
)
echo.

REM Check Docker
echo [INFO] Checking Docker...
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed
    set FAILED=1
) else (
    echo [SUCCESS] Docker version:
    docker --version
)
echo.

REM Check Docker Compose
echo [INFO] Checking Docker Compose...
docker compose version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Compose is not installed
    set FAILED=1
) else (
    echo [SUCCESS] Docker Compose version:
    docker compose version
)
echo.

REM Check Docker daemon
echo [INFO] Checking Docker daemon...
docker ps >nul 2>&1
if errorlevel 1 (
    echo [WARN] Docker daemon is not running
    echo [WARN] Please start Docker Desktop
) else (
    echo [SUCCESS] Docker daemon is running
)
echo.

REM Check .env file
set ROOT_DIR=%~dp0..
set ENV_FILE=%ROOT_DIR%\.env
echo [INFO] Checking .env file...
if exist "%ENV_FILE%" (
    echo [SUCCESS] .env file found
) else (
    echo [WARN] .env file not found
    echo [WARN] Run: .\scripts\bootstrap.bat to create it
)
echo.

if %FAILED% equ 1 (
    echo [ERROR] ========================================
    echo [ERROR] Some required tools are missing!
    echo [ERROR] ========================================
    exit /b 1
) else (
    echo [SUCCESS] ========================================
    echo [SUCCESS] All required tools are installed!
    echo [SUCCESS] ========================================
    exit /b 0
)
