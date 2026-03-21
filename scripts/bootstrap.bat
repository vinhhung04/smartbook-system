@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul

echo.
echo [INFO] ========================================
echo [INFO] SmartBook System - Docker Bootstrap
echo [INFO] ========================================
echo.

set ROOT_DIR=%~dp0..
set COMPOSE_FILE=%ROOT_DIR%\docker-compose.yml
set ENV_FILE=%ROOT_DIR%\.env
set ENV_EXAMPLE=%ROOT_DIR%\.env.example

echo [INFO] Checking Docker installation...
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed or not in PATH
    exit /b 1
)

echo [INFO] Checking Docker daemon...
docker ps >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker daemon is not running
    exit /b 1
)
echo [SUCCESS] Docker daemon is running

echo [INFO] Checking Docker Compose...
docker compose version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Compose is not available
    exit /b 1
)

echo [INFO] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [WARN] Node.js not found. Docker stack can still run, but local scripts may fail.
) else (
    echo [SUCCESS] Node.js detected
)

if not exist "%ENV_FILE%" (
    echo [WARN] .env file not found
    if exist "%ENV_EXAMPLE%" (
        echo [INFO] Creating .env from .env.example...
        copy "%ENV_EXAMPLE%" "%ENV_FILE%" >nul
        echo [SUCCESS] .env created
    ) else (
        echo [ERROR] .env.example not found
        exit /b 1
    )
)

if not exist "%COMPOSE_FILE%" (
    echo [ERROR] docker-compose.yml not found at %COMPOSE_FILE%
    exit /b 1
)

echo.
echo [INFO] Starting Docker Compose stack...
echo [INFO] Compose file: %COMPOSE_FILE%
echo.

cd /d "%ROOT_DIR%"
docker compose up -d --build
if errorlevel 1 (
    echo [ERROR] Failed to start Docker Compose
    exit /b 1
)

echo.
echo [INFO] Waiting for services to initialize (20 seconds)...
timeout /t 20 /nobreak >nul

echo.
echo [INFO] Running database setup jobs...
docker compose --profile dev run --rm inventory-db-push
if errorlevel 1 (
    echo [ERROR] inventory-db-push failed
    exit /b 1
)

docker compose --profile dev run --rm borrow-db-push
if errorlevel 1 (
    echo [ERROR] borrow-db-push failed
    exit /b 1
)

echo.
echo [INFO] Importing SQL schema + seed data...
docker compose exec -T db psql -U user -d postgres -f /docker-entrypoint-initdb.d/00-full-schema.sql
if errorlevel 1 (
    echo [ERROR] Failed to import 00-full-schema.sql
    exit /b 1
)

docker compose exec -T db psql -U user -d postgres -f /docker-entrypoint-initdb.d/03-sample-seed.sql
if errorlevel 1 (
    echo [ERROR] Failed to import 03-sample-seed.sql
    exit /b 1
)

docker compose exec -T db psql -U user -d postgres -f /docker-entrypoint-initdb.d/04-extended-seed.sql
if errorlevel 1 (
    echo [ERROR] Failed to import 04-extended-seed.sql
    exit /b 1
)

echo.
echo [SUCCESS] ========================================
echo [SUCCESS] SmartBook System is ready
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
echo [INFO] Useful commands:
echo   docker compose logs -f
echo   docker compose down
echo.
echo [INFO] Quick health checks:
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://localhost:3000/health -TimeoutSec 8).StatusCode } catch { 'gateway: fail' }"
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://localhost:8000/health -TimeoutSec 8).StatusCode } catch { 'ai-service: fail' }"

exit /b 0
