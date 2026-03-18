Param(
  [switch]$UsePnpm
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host '== SmartBook Monorepo Bootstrap =='

if ($UsePnpm) {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw 'pnpm is not installed. Install via: npm i -g pnpm'
  }
  pnpm install
} else {
  Write-Host 'Skipping pnpm install. Run with -UsePnpm to install workspace dependencies.'
}

Write-Host 'Done.'
