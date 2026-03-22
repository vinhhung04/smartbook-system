@echo off
set SCRIPT_DIR=%~dp0
if /I "%~1"=="--help" goto :help
if /I "%~1"=="-h" goto :help

if /I "%~1"=="--reset-db" (
    call "%SCRIPT_DIR%run-all.bat" --skip-env --skip-workspace --reset-db
    exit /b %errorlevel%
)

call "%SCRIPT_DIR%run-all.bat" --skip-env --skip-workspace
exit /b %errorlevel%

:help
echo.
echo Usage:
echo   scripts\bootstrap.bat [--reset-db]
echo.
echo This is a compatibility wrapper. Core logic is in scripts\run-all.bat.
exit /b 0
