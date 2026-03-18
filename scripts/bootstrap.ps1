#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Automated Docker bootstrap script for SmartBook system (Windows/PowerShell)

.DESCRIPTION
    This script:
    1. Checks Docker daemon is running
    2. Creates .env from .env.example if needed
    3. Validates required environment variables
    4. Starts docker-compose stack
    5. Waits for services to be ready
    6. Runs database migrations
    7. Displays health check results and URLs

.PARAMETER SkipHealthCheck
    Skip the HTTP health check after startup

.PARAMETER NoMigration
    Skip running database migrations (db push)

.EXAMPLE
    .\scripts\bootstrap.ps1
    .\scripts\bootstrap.ps1 -SkipHealthCheck
    .\scripts\bootstrap.ps1 -NoMigration
#>

param(
  [switch]$SkipHealthCheck,
  [switch]$NoMigration
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ============================================================================
# CONFIG
# ============================================================================

$ROOT_DIR = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$COMPOSE_FILE = Join-Path $ROOT_DIR "docker-compose.yml"
$ENV_FILE = Join-Path $ROOT_DIR ".env"
$ENV_EXAMPLE_FILE = Join-Path $ROOT_DIR ".env.example"

$REQUIRED_ENV_KEYS = @(
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'AUTH_DB_NAME',
  'INVENTORY_DB_NAME',
  'JWT_SECRET',
  'PGADMIN_DEFAULT_EMAIL',
  'PGADMIN_DEFAULT_PASSWORD'
)

$REQUIRED_SERVICES = @(
  'db',
  'pgadmin',
  'inventory-service',
  'auth-service',
  'ai-service',
  'api-gateway',
  'smartbook-ui',
  'ollama'
)

# ============================================================================
# FUNCTIONS
# ============================================================================

function Write-Info {
  param([string]$Message)
  Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Message)
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error-Custom {
  param([string]$Message)
  Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Check-Command {
  param([string]$Command)
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    Write-Error-Custom "Missing command: '$Command'"
    exit 1
  }
}

function Check-Docker {
  Check-Command "docker"
  
  try {
    $null = docker info 2>$null
  }
  catch {
    Write-Error-Custom "Docker daemon is not running. Please start Docker Desktop."
    exit 1
  }
  
  Write-Info "Docker daemon is running"
}

function Ensure-Env-File {
  if (Test-Path $ENV_FILE) {
    Write-Info ".env file already exists"
    return
  }
  
  if (-not (Test-Path $ENV_EXAMPLE_FILE)) {
    Write-Error-Custom "Neither .env nor .env.example found"
    exit 1
  }
  
  Copy-Item $ENV_EXAMPLE_FILE $ENV_FILE
  Write-Info "Created .env from .env.example"
}

function Get-Env-Value {
  param([string]$Key)
  
  try {
    $line = Select-String -Path $ENV_FILE -Pattern "^$Key=" | Select-Object -First 1
    if ($null -eq $line) {
      return ""
    }
    
    $value = $line.Line -replace "^$Key=", ""
    return $value.Trim()
  }
  catch {
    return ""
  }
}

function Validate-Env {
  Write-Info "Validating environment variables..."
  
  $missing = 0
  
  foreach ($key in $REQUIRED_ENV_KEYS) {
    $value = Get-Env-Value $key
    
    if ([string]::IsNullOrWhiteSpace($value)) {
      Write-Error-Custom "Required environment variable missing or empty: $key"
      $missing = 1
    }
  }
  
  if ($missing -ne 0) {
    Write-Error-Custom "Please update .env and try again"
    exit 1
  }
  
  Write-Info "Environment variables validated successfully"
}

function Validate-Compose-File {
  if (-not (Test-Path $COMPOSE_FILE)) {
    Write-Error-Custom "docker-compose.yml not found at $COMPOSE_FILE"
    exit 1
  }
  
  Write-Info "docker-compose.yml found"
  
  # Validate services in compose file
  Write-Info "Checking required services in docker-compose.yml..."
  
  try {
    $services = docker compose -f $COMPOSE_FILE config --services
    
    foreach ($svc in $REQUIRED_SERVICES) {
      if ($services -notcontains $svc) {
        Write-Error-Custom "Required service missing in docker-compose.yml: $svc"
        exit 1
      }
    }
    
    Write-Info "All required services found in docker-compose.yml"
  }
  catch {
    Write-Error-Custom "Failed to validate docker-compose.yml: $_"
    exit 1
  }
}

function Validate-Volume-Paths {
  $db_init = Join-Path $ROOT_DIR "db-init"
  
  if (-not (Test-Path $db_init)) {
    Write-Warn "Directory db-init not found. Database initialization scripts may not run."
  }
  
  $db_init_sql = Join-Path $db_init "01-extensions.sql"
  if (-not (Test-Path $db_init_sql)) {
    Write-Warn "File db-init/01-extensions.sql not found. pg_trgm extension may not be enabled."
  }
}

function Start-Stack {
  Write-Info "Starting Docker stack..."
  
  try {
    docker compose -f $COMPOSE_FILE up -d --build
  }
  catch {
    Write-Error-Custom "Failed to start docker-compose: $_"
    exit 1
  }
  
  Write-Info "Stack started. Waiting 20 seconds for services to be ready..."
  Start-Sleep -Seconds 20
  
  Write-Info "Current container status:"
  docker compose -f $COMPOSE_FILE ps
}

function Run-Migration {
  param(
    [string]$Service,
    [string]$Label
  )
  
  Write-Info "Running $Label..."
  
  try {
    docker compose -f $COMPOSE_FILE --profile dev run --rm $Service
  }
  catch {
    Write-Warn "$Label failed. Check logs with: docker compose logs $Service"
    Write-Warn "This is usually OK if database is still initializing."
    return $false
  }
  
  Write-Info "$Label completed successfully"
  return $true
}

function Check-Health {
  param(
    [string]$Url,
    [string]$Name
  )
  
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($response.StatusCode -eq 200) {
      Write-Info "$Name: OK ($Url)"
      return $true
    }
  }
  catch {
    # Silently fail for health check
  }
  
  Write-Warn "$Name: Not ready ($Url) - may still be starting"
  return $false
}

function Show-Summary {
  Write-Host "`n" + ("=" * 70) -ForegroundColor Cyan
  Write-Host "BOOTSTRAP COMPLETE!" -ForegroundColor Green
  Write-Host ("=" * 70) -ForegroundColor Cyan
  
  Write-Host "`n📍 LOCAL URLs:" -ForegroundColor Cyan
  Write-Host "  Web UI:           http://localhost:5173"
  Write-Host "  API Gateway:      http://localhost:3000/health"
  Write-Host "  Auth Service:     http://localhost:3004/health"
  Write-Host "  AI Service:       http://localhost:8000/health"
  Write-Host "  PostgreSQL:       localhost:5432"
  Write-Host "  pgAdmin:          http://localhost:8080"
  Write-Host "  Ollama:           http://localhost:11434"
  
  Write-Host "`n🔧 COMMON COMMANDS:" -ForegroundColor Cyan
  Write-Host "  View status:      docker compose ps"
  Write-Host "  View logs:        docker compose logs -f --tail 100"
  Write-Host "  View one service: docker compose logs -f api-gateway"
  Write-Host "  Stop stack:       docker compose down"
  Write-Host "  Stop + reset DB:  docker compose down -v"
  Write-Host "  Restart service:  docker compose restart api-gateway"
  
  Write-Host "`n📚 NEXT STEPS:" -ForegroundColor Cyan
  Write-Host "  1. Open http://localhost:5173 in browser"
  Write-Host "  2. Check logs: docker compose logs -f --tail 50"
  Write-Host "  3. Read more: docs/PROJECT_OVERVIEW.md"
  Write-Host ""
  
  Write-Host ("=" * 70) -ForegroundColor Cyan
}

# ============================================================================
# MAIN
# ============================================================================

function Main {
  Write-Host ""
  Write-Host "╔═══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
  Write-Host "║      SmartBook Docker Bootstrap (PowerShell)                          ║" -ForegroundColor Cyan
  Write-Host "╚═══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
  Write-Host ""
  
  # Step 1: Check Docker
  Write-Info "Step 1/6: Checking Docker..."
  Check-Docker
  
  # Step 2: Ensure .env exists
  Write-Info "Step 2/6: Preparing .env file..."
  Ensure-Env-File
  
  # Step 3: Validate environment
  Write-Info "Step 3/6: Validating environment..."
  Validate-Env
  Validate-Compose-File
  Validate-Volume-Paths
  
  # Step 4: Start stack
  Write-Info "Step 4/6: Starting Docker Compose stack..."
  Start-Stack
  
  # Step 5: Run migrations
  if (-not $NoMigration) {
    Write-Info "Step 5/6: Running database migrations..."
    Run-Migration "auth-db-push" "Prisma db push (auth-service)" | Out-Null
    Run-Migration "inventory-db-push" "Prisma db push (inventory-service)" | Out-Null
  }
  else {
    Write-Warn "Step 5/6: Skipping migrations (--NoMigration)"
  }
  
  # Step 6: Health checks
  if (-not $SkipHealthCheck) {
    Write-Info "Step 6/6: Checking health endpoints..."
    Check-Health "http://localhost:3000/health" "API Gateway" | Out-Null
    Check-Health "http://localhost:3004/health" "Auth Service" | Out-Null
    Check-Health "http://localhost:8000/health" "AI Service" | Out-Null
  }
  else {
    Write-Warn "Step 6/6: Skipping health checks (--SkipHealthCheck)"
  }
  
  Show-Summary
}

# Run main
Main
