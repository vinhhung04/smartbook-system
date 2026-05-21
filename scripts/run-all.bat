@echo off
chcp 65001 > nul

echo.
echo #################################################################
echo  SmartBook - One Command Setup
echo #################################################################
echo.

set ROOT_DIR=%~dp0..
set ROOT_DIR=%ROOT_DIR:~0,-1%

:: Check Docker
docker --version > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed. Please install Docker Desktop first.
    echo Download: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

docker ps > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker daemon is not running. Please start Docker Desktop.
    pause
    exit /b 1
)

echo [OK] Docker is ready

:: Create .env if not exists
if not exist "%ROOT_DIR%\.env" (
    echo.
    echo [INFO] Creating .env file from example...
    if exist "%ROOT_DIR%\.env.example" (
        copy "%ROOT_DIR%\.env.example" "%ROOT_DIR%\.env" > nul
        echo [OK] .env file created
    ) else (
        echo [WARN] .env.example not found. Creating default .env...
        (
            echo # Database
            echo DB_HOST=db
            echo DB_PORT=5432
            echo DB_USER=user
            echo DB_PASSWORD=password
            echo INVENTORY_DB_NAME=inventory_db
            echo AUTH_DB_NAME=auth_db
            echo BORROW_DB_NAME=borrow_db
            echo.
            echo # JWT
            echo JWT_SECRET=smartbook_jwt_secret_key_2024_change_in_production
            echo.
            echo # Internal
            echo INTERNAL_SERVICE_KEY=smartbook_internal_key_change_in_production
            echo.
            echo # Ports
            echo API_PORT=3000
            echo INVENTORY_PORT=3001
            echo AUTH_PORT=3002
            echo INVENTORY_EXTERNAL_PORT=3003
            echo AUTH_EXTERNAL_PORT=3004
            echo BORROW_EXTERNAL_PORT=3005
            echo UI_PORT=5173
            echo.
            echo # Services
            echo INVENTORY_SERVICE_URL=http://inventory-service:3001
            echo AUTH_SERVICE_URL=http://auth-service:3002
            echo BORROW_SERVICE_URL=http://borrow-service:3005
            echo AI_SERVICE_URL=http://ai-service:8000
            echo GATEWAY_URL=http://api-gateway:3000
        ) > "%ROOT_DIR%\.env"
        echo [OK] Default .env file created
    )
)

:: Reset database if requested
if /I "%~1"=="--reset" (
    echo.
    echo [WARN] Reset mode: Removing old containers and volumes...
    docker compose -f "%ROOT_DIR%\docker-compose.yml" down -v --remove-orphans
    echo [OK] Clean slate ready
)

:: Start everything
echo.
echo #################################################################
echo  Starting SmartBook Stack...
echo #################################################################
echo.
echo Wait for services to initialize (this may take a few minutes on first run)...
echo.

cd /d "%ROOT_DIR%"
docker compose up -d --build

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start Docker Compose.
    pause
    exit /b 1
)

:: Wait for services
echo.
echo [INFO] Waiting for services to be ready...
timeout /t 30 /nobreak > nul

:: Show status
echo.
echo #################################################################
echo  SmartBook is starting!
echo #################################################################
echo.
docker compose -f "%ROOT_DIR%\docker-compose.yml" ps
echo.
echo =================================================================
echo  Access URLs:
echo =================================================================
echo   Web UI:      http://localhost:5173
echo   API Gateway: http://localhost:3000
echo   PgAdmin:     http://localhost:8080
echo     (admin@admin.com / admin)
echo.
echo =================================================================
echo  Default Login:
echo =================================================================
echo   Username: hung
echo   Password: 123456
echo.
echo =================================================================
echo.
echo [SUCCESS] SmartBook is starting!
echo.
echo To view logs: docker compose logs -f
echo To stop:     docker compose down
echo To reset:    scripts\run-all.bat --reset
echo.

pause
