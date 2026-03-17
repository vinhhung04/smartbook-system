@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run-services-auto.ps1" start
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run-services-auto.ps1" %*
)

if errorlevel 1 (
  echo.
  echo Script that bai. Nhan phim bat ky de dong cua so...
  pause >nul
)

endlocal
