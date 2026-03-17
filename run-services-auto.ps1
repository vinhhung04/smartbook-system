param(
    [ValidateSet('start', 'stop', 'restart', 'logs', 'status', 'help')]
    [string]$Action = 'start',
    [string]$Service = '',
    [switch]$NoBuild,
    [switch]$SkipSetup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Show-Usage {
    Write-Host 'Usage:'
    Write-Host '  .\run-services-auto.ps1 start [-NoBuild] [-SkipSetup]'
    Write-Host '  .\run-services-auto.ps1 stop'
    Write-Host '  .\run-services-auto.ps1 restart [-NoBuild] [-SkipSetup]'
    Write-Host '  .\run-services-auto.ps1 logs [service]'
    Write-Host '  .\run-services-auto.ps1 status'
}

function Ensure-Command {
    param(
        [string]$Name,
        [string]$InstallHint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Khong tim thay lenh '$Name'. $InstallHint"
    }
}

function Install-NodeDeps {
    param(
        [string]$ServicePath,
        [switch]$GeneratePrisma
    )

    Write-Host "\n[SETUP] $ServicePath"
    Push-Location $ServicePath
    try {
        if (-not (Test-Path 'node_modules')) {
            if (Test-Path 'package-lock.json') {
                Write-Host 'node_modules chua co -> npm ci'
                npm ci
            } else {
                Write-Host 'node_modules chua co -> npm install'
                npm install
            }
        } else {
            Write-Host 'node_modules da ton tai -> bo qua cai dat npm'
        }

        if ($GeneratePrisma -and (Test-Path 'prisma\schema.prisma')) {
            Write-Host 'Chay prisma generate...'
            npx prisma generate
        }
    } finally {
        Pop-Location
    }
}

function Install-AiDeps {
    param(
        [string]$ServicePath
    )

    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        Write-Warning "Khong tim thay python, bo qua setup local cho ai-service. Docker build van co the chay duoc."
        return
    }

    Write-Host "\n[SETUP] $ServicePath"
    Push-Location $ServicePath
    try {
        if (-not (Test-Path '.venv')) {
            Write-Host 'Tao .venv cho ai-service...'
            python -m venv .venv
        } else {
            Write-Host '.venv da ton tai -> bo qua tao moi'
        }

        $pip = Join-Path '.venv' 'Scripts\pip.exe'
        if (-not (Test-Path $pip)) {
            Write-Warning 'Khong tim thay pip trong .venv, bo qua cai dat requirements cho ai-service.'
            return
        }

        if (Test-Path 'requirements.txt') {
            Write-Host 'Cai dat requirements cho ai-service...'
            & $pip install -r requirements.txt
        }
    } finally {
        Pop-Location
    }
}

function Run-SetupIfNeeded {
    if ($SkipSetup) {
        Write-Host '[SETUP] Skip setup theo tham so -SkipSetup'
        return
    }

    Ensure-Command -Name 'npm' -InstallHint 'Hay cai Node.js va npm.'

    Install-NodeDeps -ServicePath (Join-Path $PSScriptRoot 'inventory-service') -GeneratePrisma
    Install-NodeDeps -ServicePath (Join-Path $PSScriptRoot 'auth-service') -GeneratePrisma
    Install-NodeDeps -ServicePath (Join-Path $PSScriptRoot 'smartbook-ui')
    Install-AiDeps -ServicePath (Join-Path $PSScriptRoot 'ai-service')
}

function Invoke-Runner {
    param(
        [string]$RequestedAction,
        [string]$RequestedService,
        [switch]$RunnerNoBuild
    )

    $runner = Join-Path $PSScriptRoot 'run-services.ps1'
    if (-not (Test-Path $runner)) {
        throw "Khong tim thay file: $runner"
    }

    $runnerParams = @{
        Action = $RequestedAction
    }

    if ($RunnerNoBuild) {
        $runnerParams.NoBuild = $true
    }

    if (-not [string]::IsNullOrWhiteSpace($RequestedService)) {
        $runnerParams.Service = $RequestedService
    }

    & $runner @runnerParams
}

switch ($Action.ToLowerInvariant()) {
    'start' {
        Run-SetupIfNeeded
        Invoke-Runner -RequestedAction 'start' -RunnerNoBuild:$NoBuild
    }
    'restart' {
        Run-SetupIfNeeded
        Invoke-Runner -RequestedAction 'restart' -RunnerNoBuild:$NoBuild
    }
    'stop' {
        Invoke-Runner -RequestedAction 'stop'
    }
    'logs' {
        Invoke-Runner -RequestedAction 'logs' -RequestedService $Service
    }
    'status' {
        Invoke-Runner -RequestedAction 'status'
    }
    'help' {
        Show-Usage
    }
    default {
        Show-Usage
        exit 1
    }
}
