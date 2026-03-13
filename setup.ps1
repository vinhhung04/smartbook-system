Param(
    [switch]$UseDocker
)

Write-Host "== Smartbook system - setup script =="

function RunOrExit($scriptBlock) {
    try {
        & $scriptBlock
    } catch {
        Write-Host "ERROR: command failed -> $_" -ForegroundColor Red
        Exit 1
    }
}

# inventory-service (Node + Prisma)
Write-Host "\n-- inventory-service: installing Node deps and generating Prisma client --"
Push-Location .\inventory-service
if (Test-Path package-lock.json) { Write-Host "Running npm ci"; RunOrExit { npm ci } } else { Write-Host "Running npm install"; RunOrExit { npm install } }
Write-Host "Generating Prisma client..."
RunOrExit { npx prisma generate }
Pop-Location

# smartbook-ui (frontend)
Write-Host "\n-- smartbook-ui: installing Node deps --"
Push-Location .\smartbook-ui
if (Test-Path package-lock.json) { Write-Host "Running npm ci"; RunOrExit { npm ci } } else { Write-Host "Running npm install"; RunOrExit { npm install } }
Pop-Location

# ai-service (Python)
Write-Host "\n-- ai-service: setting up Python venv and installing requirements --"
Push-Location .\ai-service
if (-not (Test-Path .venv)) {
    Write-Host "Creating virtual environment .venv"
    RunOrExit { python -m venv .venv }
}
$pip = Join-Path -Path ".venv" -ChildPath "Scripts\pip.exe"
if (-not (Test-Path $pip)) {
    Write-Host "pip not found in .venv; ensure Python is available in PATH" -ForegroundColor Yellow
} else {
    Write-Host "Upgrading pip and installing requirements"
    RunOrExit { & $pip install --upgrade pip }
    if (Test-Path requirements.txt) { RunOrExit { & $pip install -r requirements.txt } }
}
Pop-Location

Write-Host "\nSetup finished. Next steps:\n - To run full stack in Docker: 'docker compose up --build'\n - To run services locally:\n   * inventory-service: cd inventory-service && npm run dev\n   * smartbook-ui: cd smartbook-ui && npm run dev\n   * ai-service: .\.venv\Scripts\Activate.ps1 && python main.py"

if ($UseDocker) {
    Write-Host "\nStarting Docker compose..."
    RunOrExit { docker compose up --build }
}
