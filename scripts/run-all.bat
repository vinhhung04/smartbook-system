@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul

echo.
echo [INFO] =============================================
echo [INFO]  SmartBook System - One-Command Entrypoint
echo [INFO] =============================================
echo.

set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%.."
set "COMPOSE_FILE=%ROOT_DIR%\docker-compose.yml"
set "ENV_FILE=%ROOT_DIR%\.env"
set "ENV_EXAMPLE=%ROOT_DIR%\.env.example"

set "SKIP_ENV=0"
set "SKIP_WORKSPACE=0"
set "SKIP_DOCKER=0"
set "RESET_DB=0"
set "HELP_MODE=0"
set "NO_INPUT=0"

:parse_args
if "%~1"=="" goto :start
if /I "%~1"=="--help"    (set "HELP_MODE=1" & shift & goto :parse_args)
if /I "%~1"=="-h"        (set "HELP_MODE=1" & shift & goto :parse_args)
if /I "%~1"=="--skip-env"         (set "SKIP_ENV=1" & shift & goto :parse_args)
if /I "%~1"=="--skip-workspace"   (set "SKIP_WORKSPACE=1" & shift & goto :parse_args)
if /I "%~1"=="--skip-docker"       (set "SKIP_DOCKER=1" & shift & goto :parse_args)
if /I "%~1"=="--reset-db"         (set "RESET_DB=1" & shift & goto :parse_args)
if /I "%~1"=="-y"                 (set "NO_INPUT=1" & shift & goto :parse_args)
echo [ERROR] Unknown argument: %~1
goto :help

:start
if "%SKIP_ENV%"=="0" (
  echo [STEP 1/5] Checking environment...
  call :check_env
  if errorlevel 1 (
    echo [ERROR] Environment check failed.
    exit /b 1
  )
) else (
  echo [INFO] Skipping environment check.
)

echo.
if "%SKIP_WORKSPACE%"=="0" (
  echo [STEP 2/5] Installing workspace dependencies...
  call :bootstrap_workspace
  if errorlevel 1 (
    echo [ERROR] Workspace bootstrap failed.
    exit /b 1
  )
) else (
  echo [INFO] Skipping workspace bootstrap.
)

echo.
if "%SKIP_DOCKER%"=="0" (
  echo [STEP 3/5] Starting Docker stack (DB + all services)...
  call :bootstrap_docker
  if errorlevel 1 (
    echo [ERROR] Docker bootstrap failed.
    exit /b 1
  )
) else (
  echo [INFO] Skipping Docker bootstrap.
)

echo.
echo [STEP 4/5] Running DB schema migrations...
call :run_db_migrations
if errorlevel 1 (
  echo [WARN] DB migration step had warnings. Services may still start.
)

echo.
echo [STEP 5/5] Loading sample seed data...
call :run_seed_data

echo.
echo [SUCCESS] =============================================
echo [SUCCESS]  SmartBook bootstrap completed!
echo [SUCCESS] =============================================
echo.
echo  Access points:
echo    Web UI:       http://localhost:5173
echo    API Gateway:  http://localhost:3000
echo    AI Service:   http://localhost:8000
echo    pgAdmin:      http://localhost:8080  [admin^@admin.com / admin]
echo    Ollama:      http://localhost:11434
echo.
exit /b 0

:help
echo.
echo  Usage: scripts\run-all.bat [options]
echo.
echo  Options:
echo    --skip-env         Skip environment check
echo    --skip-workspace   Skip pnpm install
echo    --skip-docker      Skip docker compose up --build
echo    --reset-db         Wipe DB volumes before starting (fresh start)
echo    -y                 Auto-confirm prompts (no pause)
echo    --help, -h         Show this help
if "%HELP_MODE%"=="1" exit /b 0
exit /b 1

rem ----------------------------------------------------------------
rem  STEP 5 — Sample seed data (auth_db, inventory_db, borrow_db)
rem ----------------------------------------------------------------
:run_seed_data
docker compose exec -T db psql -U user -d inventory -f /seed-data/smartbook_sample_seed.sql >nul 2>&1
if errorlevel 1 (
  echo  [WARN] Seed returned non-zero — re-runs are safe due to ON CONFLICT DO NOTHING.
  echo         If this is a fresh DB and data is missing, check:
  echo         docker compose exec db psql -U user -f /seed-data/smartbook_sample_seed.sql
)
echo  [OK] Sample seed data loaded.
exit /b 0

rem ----------------------------------------------------------------
rem  STEP 1 — Environment check
rem ----------------------------------------------------------------
:check_env
set "FAILED=0"

echo  Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Node.js is not installed. Download from https://nodejs.org
  set "FAILED=1"
) else (
  for /f "delims=" %%v in ('node --version 2^>nul') do echo  [OK] Node.js %%v
)

echo.
echo  Checking Docker...
docker --version >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Docker is not installed. Download Docker Desktop.
  set "FAILED=1"
) else (
  for /f "delims=" %%v in ('docker --version 2^>nul') do echo  [OK] %%v
)

echo.
echo  Checking Docker Compose...
docker compose version >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Docker Compose is not installed.
  set "FAILED=1"
) else (
  for /f "delims=" %%v in ('docker compose version 2^>nul') do echo  [OK] %%v
)

echo.
echo  Checking Docker daemon...
docker ps >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Docker daemon is not running.
  echo         Please open Docker Desktop and wait until it shows "Docker Desktop is running".
  set "FAILED=1"
) else (
  echo  [OK] Docker daemon is running
)

echo.
echo  Checking .env file...
if exist "%ENV_FILE%" (
  echo  [OK] .env file found
) else (
  echo  [WARN] .env not found — will be created from .env.example
)

echo.
if %FAILED% equ 1 (
  echo  [ERROR] Required tools are missing. Please install them before continuing.
  exit /b 1
)
exit /b 0

rem ----------------------------------------------------------------
rem  STEP 2 — Workspace dependencies (pnpm install)
rem ----------------------------------------------------------------
:bootstrap_workspace
echo  Checking pnpm...
pnpm --version >nul 2>&1
if not errorlevel 1 goto :pnpm_ready

echo  pnpm not found. Installing via Corepack...
corepack enable >nul 2>&1
call corepack prepare pnpm@latest --activate >nul 2>&1
if errorlevel 1 (
  echo  Corepack failed. Installing via npm global install...
  call npm install -g pnpm >nul 2>&1
  if errorlevel 1 (
    echo  [ERROR] Could not install pnpm.
    exit /b 1
  )
)

:pnpm_ready
for /f "delims=" %%v in ('pnpm --version 2^>nul') do echo  pnpm %%v

echo.
echo  Installing workspace packages (this may take a few minutes)...
cd /d "%ROOT_DIR%"
call pnpm install
if errorlevel 1 (
  echo  [ERROR] pnpm install failed.
  echo         Try: cd %ROOT_DIR% ^&^& pnpm install
  exit /b 1
)
echo  [OK] Workspace dependencies installed
exit /b 0

rem ----------------------------------------------------------------
rem  STEP 3 — Docker Compose up --build
rem ----------------------------------------------------------------
:bootstrap_docker
echo  Checking Docker daemon...
docker ps >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Docker daemon is not running.
  exit /b 1
)

if not exist "%COMPOSE_FILE%" (
  echo  [ERROR] docker-compose.yml not found at: %COMPOSE_FILE%
  exit /b 1
)

rem Create .env from example if missing
if not exist "%ENV_FILE%" (
  if exist "%ENV_EXAMPLE%" (
    echo  Creating .env from .env.example...
    copy /Y "%ENV_EXAMPLE%" "%ENV_FILE%" >nul
    echo  [OK] .env created. Review it if you need custom credentials.
  ) else (
    echo  [ERROR] .env.example not found either.
    exit /b 1
  )
)

cd /d "%ROOT_DIR%"

if "%RESET_DB%"=="1" (
  echo  [WARN] Reset mode: removing all containers and volumes...
  docker compose down -v --remove-orphans 2>nul
  echo  [OK] Old volumes removed.
  echo.
)

echo  Starting full stack (docker compose up -d --build)...
echo  This will take several minutes on first run (downloading images, building)...
echo.
docker compose up -d --build
if errorlevel 1 (
  echo  [ERROR] docker compose up --build failed.
  echo         Check Docker Desktop is running and try again.
  exit /b 1
)

echo.
echo  Waiting for PostgreSQL to be healthy...
set "PG_READY=0"
for /L %%i in (1,1,30) do (
  if "!PG_READY!"=="0" (
    docker compose exec -T db pg_isready -U user -d inventory >nul 2>&1
    if not errorlevel 1 (
      set "PG_READY=1"
      echo  [OK] PostgreSQL is ready.
    ) else (
      echo  ...waiting (%%i/30)
      timeout /t 2 /nobreak >nul
    )
  )
)

if "%PG_READY%"=="0" (
  echo  [WARN] PostgreSQL did not become ready in 60s.
  echo         Continuing anyway — db-init scripts run in background.
)

echo.
echo  Docker stack started. Service status:
docker compose ps
exit /b 0

rem ----------------------------------------------------------------
rem  STEP 4 — DB schema migrations (prisma db push per service)
rem ----------------------------------------------------------------
:run_db_migrations
echo  Checking DB services...

docker compose ps db >nul 2>&1
if errorlevel 1 (
  echo  [SKIP] DB container not running.
  exit /b 0
)

echo  Running schema migrations for each service database...
echo.

set "MIGRATION_FAILED=0"

echo  [1/3] Auth Service — pushing schema to auth_db...
docker compose --profile dev run --rm auth-db-push >nul 2>&1
if errorlevel 1 (
  echo  [WARN] auth-db-push may have failed. Check: docker compose --profile dev run --rm auth-db-push
  set "MIGRATION_FAILED=1"
) else (
  echo  [OK] auth_db schema ready
)

echo.
echo  [2/3] Inventory Service — pushing schema to inventory_db...
docker compose --profile dev run --rm inventory-db-push >nul 2>&1
if errorlevel 1 (
  echo  [WARN] inventory-db-push may have failed. Check: docker compose --profile dev run --rm inventory-db-push
  set "MIGRATION_FAILED=1"
) else (
  echo  [OK] inventory_db schema ready
)

echo.
echo  [3/3] Borrow Service — pushing schema to borrow_db...
docker compose --profile dev run --rm borrow-db-push >nul 2>&1
if errorlevel 1 (
  echo  [WARN] borrow-db-push may have failed. Check: docker compose --profile dev run --rm borrow-db-push
  set "MIGRATION_FAILED=1"
) else (
  echo  [OK] borrow_db schema ready
)

echo.
if "%MIGRATION_FAILED%"=="1" (
  exit /b 1
)
echo  [OK] All DB schemas are up to date.

echo.
call :run_seed_data
if errorlevel 1 (
  echo [WARN] Seed data step had warnings. Services may still start.
)

echo.
echo [SUCCESS] =============================================
echo [SUCCESS]  SmartBook bootstrap completed!
echo [SUCCESS] =============================================
echo.
echo  Access points:
echo    Web UI:       http://localhost:5173
echo    API Gateway:  http://localhost:3000
echo    AI Service:   http://localhost:8000
echo    pgAdmin:      http://localhost:8080  [admin^@admin.com / admin]
echo    Ollama:      http://localhost:11434
echo.
exit /b 0
