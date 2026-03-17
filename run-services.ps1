param(
    [ValidateSet('start', 'stop', 'restart', 'logs', 'status', 'help')]
    [string]$Action = 'start',
    [string]$Service = '',
    [switch]$NoBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ComposeCommand {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        try {
            docker compose version *> $null
            return @('docker', 'compose')
        } catch {
            if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
                return @('docker-compose')
            }
        }
    }

    if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
        return @('docker-compose')
    }

    throw 'Khong tim thay Docker Compose. Hay cai Docker Desktop hoac docker-compose.'
}

function Invoke-Compose {
    param(
        [string[]]$ComposeArgs
    )

    $composeCmd = Get-ComposeCommand
    $composeFile = Join-Path $PSScriptRoot 'docker-compose.yml'

    if (-not (Test-Path $composeFile)) {
        throw "Khong tim thay file docker-compose.yml tai: $composeFile"
    }

    if ($composeCmd.Count -eq 2) {
        & $composeCmd[0] $composeCmd[1] -f $composeFile @ComposeArgs
    } else {
        & $composeCmd[0] -f $composeFile @ComposeArgs
    }
}

function Show-Usage {
    Write-Host 'Usage:'
    Write-Host '  .\run-services.ps1 start [-NoBuild]'
    Write-Host '  .\run-services.ps1 stop'
    Write-Host '  .\run-services.ps1 restart [-NoBuild]'
    Write-Host '  .\run-services.ps1 logs [service]'
    Write-Host '  .\run-services.ps1 status'
}

switch ($Action.ToLowerInvariant()) {
    'start' {
        Write-Host 'Dang khoi dong tat ca services...'
        if ($NoBuild) {
            Invoke-Compose -ComposeArgs @('up', '-d')
        } else {
            Invoke-Compose -ComposeArgs @('up', '--build', '-d')
        }
        Invoke-Compose -ComposeArgs @('ps')
    }
    'stop' {
        Write-Host 'Dang dung tat ca services...'
        Invoke-Compose -ComposeArgs @('down')
    }
    'restart' {
        Write-Host 'Dang restart tat ca services...'
        Invoke-Compose -ComposeArgs @('down')
        if ($NoBuild) {
            Invoke-Compose -ComposeArgs @('up', '-d')
        } else {
            Invoke-Compose -ComposeArgs @('up', '--build', '-d')
        }
        Invoke-Compose -ComposeArgs @('ps')
    }
    'logs' {
        if ([string]::IsNullOrWhiteSpace($Service)) {
            Invoke-Compose -ComposeArgs @('logs', '-f', '--tail', '200')
        } else {
            Invoke-Compose -ComposeArgs @('logs', '-f', '--tail', '200', $Service)
        }
    }
    'status' {
        Invoke-Compose -ComposeArgs @('ps')
    }
    'help' {
        Show-Usage
    }
    default {
        Show-Usage
        exit 1
    }
}
