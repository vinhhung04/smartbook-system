@echo off
set SCRIPT_DIR=%~dp0
call "%SCRIPT_DIR%run-all.bat" --skip-workspace --skip-docker
exit /b %errorlevel%
