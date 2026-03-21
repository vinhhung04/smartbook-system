@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul

echo.
echo [INFO] ========================================
echo [INFO] SmartBook One-Command Entrypoint
echo [INFO] ========================================
echo.

set SKIP_ENV=0
set SKIP_WORKSPACE=0
set SKIP_DOCKER=0
set HELP_MODE=0

if /I "%~1"=="--help" (
  set HELP_MODE=1
  goto :help
)
if /I "%~1"=="-h" (
  set HELP_MODE=1
  goto :help
)

:parse_args
if "%~1"=="" goto :start
if /I "%~1"=="--skip-env" (
  set SKIP_ENV=1
  shift
  goto :parse_args
)
if /I "%~1"=="--skip-workspace" (
  set SKIP_WORKSPACE=1
  shift
  goto :parse_args
)
if /I "%~1"=="--skip-docker" (
  set SKIP_DOCKER=1
  shift
  goto :parse_args
)

echo [ERROR] Unknown argument: %~1
goto :help

:start
if "%SKIP_ENV%"=="0" (
  echo [STEP 1/3] Checking environment...
  call "%~dp0check-env.bat"
  if errorlevel 1 (
    echo [ERROR] Environment check failed.
    exit /b 1
  )
) else (
  echo [INFO] Skipping environment check.
)

echo.
if "%SKIP_WORKSPACE%"=="0" (
  echo [STEP 2/3] Installing workspace dependencies...
  call "%~dp0bootstrap-workspace.bat"
  if errorlevel 1 (
    echo [ERROR] Workspace bootstrap failed.
    exit /b 1
  )
) else (
  echo [INFO] Skipping workspace bootstrap.
)

echo.
if "%SKIP_DOCKER%"=="0" (
  echo [STEP 3/3] Starting Docker stack + DB setup...
  call "%~dp0bootstrap.bat"
  if errorlevel 1 (
    echo [ERROR] Docker bootstrap failed.
    exit /b 1
  )
) else (
  echo [INFO] Skipping Docker bootstrap.
)

echo.
echo [SUCCESS] ========================================
echo [SUCCESS] SmartBook bootstrap completed!
echo [SUCCESS] ========================================
echo [INFO] Web UI:      http://localhost:5173
echo [INFO] API Gateway: http://localhost:3000
exit /b 0

:help
echo.
echo Usage:
echo   scripts\run-all.bat [options]
echo.
echo Options:
echo   --skip-env         Skip check-env step
echo   --skip-workspace   Skip pnpm install step
echo   --skip-docker      Skip docker bootstrap step
echo   --help, -h         Show this help
if "%HELP_MODE%"=="1" (
  exit /b 0
)
exit /b 1
