# Agnipariksha - start backend + frontend concurrently (PowerShell)
# Usage:  powershell -ExecutionPolicy Bypass -File .\scripts\start_dev.ps1
#
# - Verifies prerequisites (node, npm, py/python)
# - Installs dependencies on first run
# - Launches backend (FastAPI) and frontend (Next dev) in parallel
# - Tears both down on Ctrl-C

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$RepoRoot    = Resolve-Path (Join-Path $PSScriptRoot '..')
$BackendDir  = Join-Path $RepoRoot 'backend'
$FrontendDir = Join-Path $RepoRoot 'frontend'

function Write-Log([string]$msg) {
  Write-Host "[start_dev] $msg" -ForegroundColor Cyan
}
function Write-Err([string]$msg) {
  Write-Host "[start_dev] $msg" -ForegroundColor Red
}

# --- Resolve python launcher -------------------------------------------------
$Py = $null
foreach ($candidate in @('py', 'python', 'python3')) {
  if (Get-Command $candidate -ErrorAction SilentlyContinue) {
    $Py = $candidate
    break
  }
}
if (-not $Py) {
  Write-Err "Python not found on PATH. Install Python 3.11+ from python.org and tick 'Add to PATH', then reopen PowerShell."
  exit 1
}

# --- Verify node / npm -------------------------------------------------------
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Err "npm not found. Install Node.js LTS from https://nodejs.org/ and reopen PowerShell."
  exit 1
}

# --- Install deps (idempotent) ----------------------------------------------
Write-Log "Installing backend deps..."
Push-Location $BackendDir
try {
  & $Py -m pip install --quiet -r requirements.txt
} finally {
  Pop-Location
}

if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
  Write-Log "Installing frontend deps (first run)..."
  Push-Location $FrontendDir
  try { npm install } finally { Pop-Location }
}

$envExample = Join-Path $RepoRoot '.env.example'
$envLocal   = Join-Path $FrontendDir '.env.local'
if ((-not (Test-Path $envLocal)) -and (Test-Path $envExample)) {
  Write-Log "Seeding frontend\.env.local from .env.example"
  Copy-Item $envExample $envLocal
}

# --- Launch ------------------------------------------------------------------
$procs = @()

Write-Log "Starting backend on :8000"
$backend = Start-Process -FilePath $Py `
  -ArgumentList @('main.py') `
  -WorkingDirectory $BackendDir `
  -NoNewWindow -PassThru
$procs += $backend

Write-Log "Starting frontend on :3000"
$frontend = Start-Process -FilePath 'npm.cmd' `
  -ArgumentList @('run', 'dev') `
  -WorkingDirectory $FrontendDir `
  -NoNewWindow -PassThru
$procs += $frontend

Write-Log "Both processes started.  Backend pid=$($backend.Id)  Frontend pid=$($frontend.Id)"
Write-Log "Open http://localhost:3000  -  press Ctrl-C to stop."

# Tear down both children when this script exits or Ctrl-C is pressed
$cleanup = {
  Write-Host "[start_dev] Shutting down..." -ForegroundColor Cyan
  foreach ($p in $procs) {
    if ($p -and -not $p.HasExited) {
      try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
}
Register-EngineEvent PowerShell.Exiting -Action $cleanup | Out-Null

try {
  while ($true) {
    Start-Sleep -Seconds 1
    foreach ($p in $procs) {
      if ($p.HasExited) {
        Write-Err "Process pid=$($p.Id) exited with code $($p.ExitCode). Tearing down."
        & $cleanup
        exit $p.ExitCode
      }
    }
  }
} finally {
  & $cleanup
}
