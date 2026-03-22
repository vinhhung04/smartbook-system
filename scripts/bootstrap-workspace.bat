@echo off
set SCRIPT_DIR=%~dp0
if /I "%~1"=="--with-docker" (
    call "%SCRIPT_DIR%run-all.bat" --skip-env
    exit /b %errorlevel%
)

call "%SCRIPT_DIR%run-all.bat" --skip-env --skip-docker
exit /b %errorlevel%
