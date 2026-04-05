@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul

echo.
echo [INFO] ========================================
echo [INFO] SmartBook One-Command Entrypoint
echo [INFO] ========================================
echo.

set SCRIPT_DIR=%~dp0
set ROOT_DIR=%SCRIPT_DIR%..
set COMPOSE_FILE=%ROOT_DIR%\docker-compose.yml
set ENV_FILE=%ROOT_DIR%\.env
set ENV_EXAMPLE=%ROOT_DIR%\.env.example

set SKIP_ENV=0
set SKIP_WORKSPACE=0
set SKIP_DOCKER=0
set RESET_DB=0
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
if /I "%~1"=="--reset-db" (
  set RESET_DB=1
  shift
  goto :parse_args
)

echo [ERROR] Unknown argument: %~1
goto :help

:start
if "%SKIP_ENV%"=="0" (
  echo [STEP 1/3] Checking environment...
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
  echo [STEP 2/3] Installing workspace dependencies...
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
  echo [STEP 3/3] Starting Docker stack + DB setup...
  call :bootstrap_docker
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
echo   --reset-db         Reset Docker DB volumes before bootstrap
echo   --help, -h         Show this help
if "%HELP_MODE%"=="1" (
  exit /b 0
)
exit /b 1

:check_env
set FAILED=0

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
echo [INFO] Checking npm...
call npm --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm is not installed
  set FAILED=1
) else (
  echo [SUCCESS] npm version:
  call npm --version
)

echo.
echo [INFO] Checking pnpm...
call pnpm --version >nul 2>&1
if errorlevel 1 (
  echo [WARN] pnpm is not installed (optional)
  echo [WARN] Install with: npm install -g pnpm
) else (
  echo [SUCCESS] pnpm version:
  call pnpm --version
)

echo.
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
echo [INFO] Checking Docker daemon...
docker ps >nul 2>&1
if errorlevel 1 (
  echo [WARN] Docker daemon is not running
  echo [WARN] Please start Docker Desktop
) else (
  echo [SUCCESS] Docker daemon is running
)

echo.
echo [INFO] Checking .env file...
if exist "%ENV_FILE%" (
  echo [SUCCESS] .env file found
) else (
  echo [WARN] .env file not found
)

echo.
if %FAILED% equ 1 (
  echo [ERROR] Required tool check failed
  exit /b 1
)
echo [SUCCESS] Environment check passed
exit /b 0

:bootstrap_workspace
echo [INFO] Checking pnpm installation...
call pnpm --version >nul 2>&1
if errorlevel 1 (
  echo [WARN] pnpm not found. Installing globally...
  call npm install -g pnpm
  if errorlevel 1 (
    echo [ERROR] Failed to install pnpm
    exit /b 1
  )
)

echo [INFO] pnpm version:
call pnpm --version

echo.
echo [INFO] Installing workspace dependencies...
cd /d "%ROOT_DIR%"
call pnpm install
if errorlevel 1 (
  echo [ERROR] pnpm install failed
  exit /b 1
)

echo [SUCCESS] Workspace dependencies installed
exit /b 0

:bootstrap_docker
echo [INFO] Checking Docker daemon...
docker ps >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker daemon is not running
  exit /b 1
)

if not exist "%ENV_FILE%" (
  if exist "%ENV_EXAMPLE%" (
    echo [INFO] Creating .env from .env.example...
    copy "%ENV_EXAMPLE%" "%ENV_FILE%" >nul
  ) else (
    echo [ERROR] .env.example not found
    exit /b 1
  )
)

if not exist "%COMPOSE_FILE%" (
  echo [ERROR] docker-compose.yml not found: %COMPOSE_FILE%
  exit /b 1
)

cd /d "%ROOT_DIR%"
if "%RESET_DB%"=="1" (
  echo [WARN] Reset mode enabled: removing old containers and volumes...
  docker compose down -v --remove-orphans
  if errorlevel 1 (
    echo [ERROR] Failed to reset Docker volumes
    exit /b 1
  )
)

echo.
echo [INFO] Starting PostgreSQL service...
docker compose up -d db
if errorlevel 1 (
  echo [ERROR] Failed to start db service
  exit /b 1
)

echo.
echo [INFO] Waiting for PostgreSQL readiness...
docker compose exec -T db sh -lc "until pg_isready -U ${POSTGRES_USER:-user} -d ${POSTGRES_DB:-inventory}; do sleep 1; done"
if errorlevel 1 (
  echo [ERROR] PostgreSQL is not ready
  exit /b 1
)

if "%RESET_DB%"=="1" (
  echo [INFO] Fresh volume detected. PostgreSQL entrypoint auto-init will run db-init scripts.
) else (
  echo [INFO] Importing SQL schema + merged seed data...
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U user -d postgres -f /docker-entrypoint-initdb.d/00-full-schema.sql
  if errorlevel 1 exit /b 1
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U user -d postgres -f /docker-entrypoint-initdb.d/01-extensions.sql
  if errorlevel 1 exit /b 1
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U user -d postgres -f /docker-entrypoint-initdb.d/02-putaway-available.sql
  if errorlevel 1 exit /b 1
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U user -d postgres -f /docker-entrypoint-initdb.d/03-sample-seed.sql
  if errorlevel 1 exit /b 1
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U user -d postgres -f /docker-entrypoint-initdb.d/04-extended-seed.sql
  if errorlevel 1 exit /b 1
)

echo.
echo [INFO] Starting full application stack...
docker compose up -d --build
if errorlevel 1 (
  echo [ERROR] Failed to start full Docker stack
  exit /b 1
)

echo.
echo [INFO] Services running:
docker compose ps

echo.
echo [INFO] Quick health checks:
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://localhost:3000/health -TimeoutSec 8).StatusCode } catch { 'gateway: fail' }"
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://localhost:8000/health -TimeoutSec 8).StatusCode } catch { 'ai-service: fail' }"

exit /b 0
