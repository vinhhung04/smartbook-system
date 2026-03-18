@echo off
REM ============================================================================
REM SmartBook System - Docker Bootstrap Script (Windows Batch)
REM ============================================================================
REM This script:
REM 1. Checks if Docker is running
REM 2. Creates .env from .env.example if needed
REM 3. Validates required environment variables
REM 4. Starts docker-compose stack
REM 5. Waits for services to be ready
REM 6. Runs database migrations
REM 7. Displays URLs and health status

setlocal enabledelayedexpansion
chcp 65001 > nul

echo.
echo [INFO] ========================================
echo [INFO] SmartBook System - Docker Bootstrap
echo [INFO] ========================================
echo.

REM Define paths
set ROOT_DIR=%~dp0..
set COMPOSE_FILE=%ROOT_DIR%\docker-compose.yml
set ENV_FILE=%ROOT_DIR%\.env
set ENV_EXAMPLE=%ROOT_DIR%\.env.example

REM Check Docker is installed
echo [INFO] Checking Docker installation...
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed or not in PATH
    echo [ERROR] Please install Docker Desktop from https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

REM Check Docker daemon is running
echo [INFO] Checking Docker daemon...
docker ps >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker daemon is not running
    echo [ERROR] Please start Docker Desktop
    pause
    exit /b 1
)
echo [INFO] Docker is running

REM Create .env if not exists
if not exist "%ENV_FILE%" (
    echo [WARN] .env file not found
    if exist "%ENV_EXAMPLE%" (
        echo [INFO] Creating .env from .env.example...
        copy "%ENV_EXAMPLE%" "%ENV_FILE%" >nul
        echo [WARN] Please edit %ENV_FILE% with your configuration
        pause
    ) else (
        echo [ERROR] .env.example not found
        pause
        exit /b 1
    )
)

REM Check required environment variables
echo [INFO] Validating environment variables...
for %%V in (
    POSTGRES_USER
    POSTGRES_PASSWORD
    DB_HOST
    DB_PORT
    DB_USER
    DB_PASSWORD
    AUTH_DB_NAME
    INVENTORY_DB_NAME
    JWT_SECRET
    PGADMIN_DEFAULT_EMAIL
    PGADMIN_DEFAULT_PASSWORD
) do (
    for /f "tokens=*" %%A in ('findstr /R "^%%V=" "%ENV_FILE%"') do (
        set LINE=%%A
        if not "!LINE:~0,1!"=="#" if not "!LINE!"=="" (
            for /f "tokens=1,* delims==" %%B in ("%%A") do (
                if "%%C"=="" (
                    echo [WARN] %%V is empty in .env file
                )
            )
        )
    )
)

REM Display information
echo.
echo [INFO] Starting Docker Compose stack...
echo [INFO] Compose file: %COMPOSE_FILE%
echo.

REM Start docker-compose
cd /d "%ROOT_DIR%"
docker compose up -d --build
if errorlevel 1 (
    echo [ERROR] Failed to start Docker Compose
    pause
    exit /b 1
)

REM Wait for services
echo.
echo [INFO] Waiting for services to be ready (30 seconds)...
timeout /t 30 /nobreak

REM Run migrations if needed
echo.
echo [INFO] Running database migrations...
docker compose --profile dev run --rm auth-service pnpm db:push 2>nul
docker compose --profile dev run --rm inventory-service pnpm db:push 2>nul

echo.
echo [SUCCESS] ========================================
echo [SUCCESS] SmartBook System is starting
echo [SUCCESS] ========================================
echo.
echo [INFO] Services running:
docker compose ps
echo.
echo [INFO] Access URLs:
echo   - Web UI:        http://localhost:5173
echo   - API Gateway:   http://localhost:3000
echo   - AI Service:    http://localhost:8000
echo   - pgAdmin:       http://localhost:8080
echo   - Ollama:        http://localhost:11434
echo.
echo [INFO] View logs with:
echo   docker compose logs -f
echo.
echo [INFO] Stop services with:
echo   docker compose down
echo.
pause
