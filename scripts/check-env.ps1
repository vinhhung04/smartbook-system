#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Environment validation script for SmartBook Docker setup (Windows/PowerShell)

.DESCRIPTION
    Validates that the Docker environment is properly configured:
    - Docker daemon is running
    - docker-compose.yml exists and is valid
    - .env file exists and contains all required variables
    - All required services are defined in docker-compose.yml
    - Supporting directories and files are present

.EXAMPLE
    .\scripts\check-env.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# CONFIG
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

# FUNCTIONS
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

function Check-Docker {
  Write-Info "Checking Docker..."
  
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error-Custom "Docker command not found. Please install Docker Desktop."
    exit 1
  }
  
  try {
    $null = docker info 2>$null
  }
  catch {
    Write-Error-Custom "Docker daemon is not running. Please start Docker Desktop."
    exit 1
  }
  
  Write-Info "Docker daemon is running"
}

function Get-Env-Value {
  param([string]$Key)
  
  if (-not (Test-Path $ENV_FILE)) {
    return ""
  }
  
  try {
    $line = Select-String -Path $ENV_FILE -Pattern "^$Key=" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $line) {
      return ""
    }
    
    $value = $line.Line -replace "^$Key=", "" | ForEach-Object { $_.Trim() }
    return $value
  }
  catch {
    return ""
  }
}

function Validate-Compose-File {
  Write-Info "Checking docker-compose.yml..."
  
  if (-not (Test-Path $COMPOSE_FILE)) {
    Write-Error-Custom "docker-compose.yml not found at: $COMPOSE_FILE"
    exit 1
  }
  
  # Try to parse and validate docker-compose.yml
  try {
    $services = docker compose -f $COMPOSE_FILE config --services 2>$null
    Write-Info "docker-compose.yml is valid"
    
    # Check for required services
    $missing = $false
    foreach ($svc in $REQUIRED_SERVICES) {
      if ($services -notcontains $svc) {
        Write-Error-Custom "Required service missing in docker-compose.yml: $svc"
        $missing = $true
      }
    }
    
    if ($missing) {
      exit 1
    }
    
    Write-Info "All required services found in docker-compose.yml"
  }
  catch {
    Write-Error-Custom "Failed to validate docker-compose.yml: $_"
    exit 1
  }
}

function Validate-Env-File {
  Write-Info "Checking .env file..."
  
  if (-not (Test-Path $ENV_FILE)) {
    if (Test-Path $ENV_EXAMPLE_FILE) {
      Write-Warn ".env not found, but .env.example exists"
      Write-Warn "Run: Copy-Item .env.example .env"
      exit 1
    }
    else {
      Write-Error-Custom ".env not found and unable to find .env.example"
      exit 1
    }
  }
  
  Write-Info ".env file found"
  
  # Validate required keys
  $missing = $false
  foreach ($key in $REQUIRED_ENV_KEYS) {
    $value = Get-Env-Value $key
    
    if ([string]::IsNullOrWhiteSpace($value)) {
      Write-Error-Custom "Required variable missing or empty: $key"
      $missing = $true
    }
  }
  
  if ($missing) {
    Write-Error-Custom "Please update .env with all required variables and try again"
    exit 1
  }
  
  Write-Info "All required environment variables are set"
}

function Validate-Volumes {
  Write-Info "Checking volume paths..."
  
  $db_init = Join-Path $ROOT_DIR "db-init"
  if (-not (Test-Path $db_init)) {
    Write-Warn "Directory not found: db-init/"
    Write-Warn "Database initialization scripts may not run"
  }
  else {
    Write-Info "db-init directory found"
  }
  
  $db_init_sql = Join-Path $db_init "01-extensions.sql"
  if (-not (Test-Path $db_init_sql)) {
    Write-Warn "File not found: db-init/01-extensions.sql"
    Write-Warn "PostgreSQL extensions (pg_trgm) may not be enabled"
  }
  else {
    Write-Info "db-init/01-extensions.sql found"
  }
}

function Main {
  Write-Host ""
  Write-Host "╔═════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
  Write-Host "║  SmartBook Environment Check (PowerShell)                   ║" -ForegroundColor Cyan
  Write-Host "╚═════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
  Write-Host ""
  
  Check-Docker
  Validate-Compose-File
  Validate-Env-File
  Validate-Volumes
  
  Write-Host ""
  Write-Info "Environment validation completed successfully! ✓"
  Write-Host ""
}

Main
