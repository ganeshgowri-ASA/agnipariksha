# Agnipariksha one-paste bootstrap (Windows PowerShell 5.1+).
#
# Clones/updates the repo, checks out the DC-PSU app branch, installs
# backend + frontend deps, starts both in their own windows (DEMO mode,
# no hardware), and opens the browser at the PSU console. Idempotent —
# safe to re-run; it pulls instead of re-cloning and reuses the venv.
#
# Run it with one paste (PowerShell, not Git Bash):
#   iwr -useb https://raw.githubusercontent.com/ganeshgowri-ASA/agnipariksha/claude/lucid-pascal-btoQd/scripts/windows-oneclick.ps1 | iex
#
# Or from a clone:  powershell -ExecutionPolicy Bypass -File scripts\windows-oneclick.ps1

$ErrorActionPreference = 'Stop'
$Branch  = 'claude/lucid-pascal-btoQd'
$RepoUrl = 'https://github.com/ganeshgowri-ASA/agnipariksha.git'
$Root    = Join-Path $HOME 'agnipariksha'

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "XX  $msg" -ForegroundColor Red; exit 1 }

# --- Prerequisites ---------------------------------------------------------
Step 'Checking prerequisites (git, python, node/npm)'

function Resolve-RealPython {
  # A working, non-Microsoft-Store-alias Python, or $null. The Store alias
  # (…\WindowsApps\python.exe) is a stub that just opens the Store, so it is
  # skipped; the `py` launcher is preferred because it never collides with it.
  $cands = @()
  $pl = Get-Command py -ErrorAction SilentlyContinue
  if ($pl) { $cands += $pl.Source }
  foreach ($c in (Get-Command python -All -ErrorAction SilentlyContinue)) { $cands += $c.Source }
  foreach ($p in $cands) {
    if ($p -match 'WindowsApps') { continue }
    try { & $p --version 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { return $p } } catch {}
  }
  return $null
}

# Detect what's genuinely usable and auto-install the rest via winget. PATH
# does not refresh inside a running session, so if anything is installed the
# script stops and asks for a fresh window rather than failing halfway.
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
$pyExe  = Resolve-RealPython
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue

$need = @()
if (-not $gitCmd) { $need += 'Git.Git' }
if (-not $pyExe)  { $need += 'Python.Python.3.12' }
if (-not $npmCmd) { $need += 'OpenJS.NodeJS.LTS' }

if ($need.Count -gt 0) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Step ("Installing missing prerequisites via winget: " + ($need -join ', '))
    foreach ($pkg in $need) {
      winget install --id $pkg -e --source winget --accept-package-agreements --accept-source-agreements
    }
    Write-Host ""
    Write-Host "Prerequisites installed. Windows PATH only updates in a NEW shell." -ForegroundColor Yellow
    if ($need -contains 'Python.Python.3.12') {
      Write-Host "If Python still isn't found next run, disable its Store alias:" -ForegroundColor Yellow
      Write-Host "  Settings > Apps > Advanced app settings > App execution aliases > turn OFF python.exe/python3.exe" -ForegroundColor Yellow
    }
    Write-Host "==> Close this window, open a NEW PowerShell, and run the one-paste again." -ForegroundColor Yellow
    exit 0
  }
  Fail ("Missing: " + ($need -join ', ') + ". Install these, open a new PowerShell, then re-run.")
}

Write-Host ("    git={0}  python={1}  npm={2}" -f $gitCmd.Source, $pyExe, $npmCmd.Source)

# --- Clone or update -------------------------------------------------------
if (Test-Path (Join-Path $Root '.git')) {
  Step "Repo exists at $Root - fetching branch $Branch"
  git -C $Root fetch origin $Branch
} else {
  Step "Cloning into $Root"
  git clone $RepoUrl $Root
}
git -C $Root checkout $Branch
git -C $Root pull origin $Branch

# --- Backend: venv + deps --------------------------------------------------
$Backend = Join-Path $Root 'backend'
$Venv    = Join-Path $Backend '.venv'
$VenvPy  = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path $VenvPy)) {
  Step 'Creating backend virtualenv (avoids the bare-uvicorn Permission denied issue)'
  & $pyExe -m venv $Venv
}
Step 'Installing backend requirements'
& $VenvPy -m pip install --quiet --upgrade pip
& $VenvPy -m pip install --quiet -r (Join-Path $Backend 'requirements.txt')

# --- Frontend deps ---------------------------------------------------------
Step 'Installing frontend dependencies (first run takes a few minutes)'
$Frontend = Join-Path $Root 'frontend'
Push-Location $Frontend
& $npmCmd.Source install --no-audit --no-fund
Pop-Location

# --- Start both in their own windows --------------------------------------
Step 'Starting backend (DEMO mode) in its own window on :8000'
Start-Process powershell -WorkingDirectory $Backend -ArgumentList @(
  '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command',
  "`$env:DEMO_MODE='true'; & '$VenvPy' -m uvicorn main:app --host 127.0.0.1 --port 8000"
)

# Frontend: -ExecutionPolicy Bypass + npm.cmd so a Restricted machine policy
# (which blocks npm.ps1) does not stop `npm run dev`.
Step 'Starting frontend in its own window on :3000'
Start-Process powershell -WorkingDirectory $Frontend -ArgumentList @(
  '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command',
  "npm.cmd run dev"
)

# --- Wait for health, then open the PSU console ---------------------------
function Wait200($url, $tries) {
  for ($i = 0; $i -lt $tries; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
      if ([int]$r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}

Step 'Waiting for backend /health'
if (Wait200 'http://127.0.0.1:8000/health' 90) { Write-Host '    backend: OK' -ForegroundColor Green }
else { Write-Host '    backend did not answer in 90 s - check the backend window for errors' -ForegroundColor Yellow }

Step 'Waiting for frontend'
if (Wait200 'http://127.0.0.1:3000' 180) { Write-Host '    frontend: OK' -ForegroundColor Green }
else { Write-Host '    frontend did not answer in 180 s - check the frontend window' -ForegroundColor Yellow }

Step 'Opening the PSU console'
Start-Process 'http://localhost:3000/psu'
Write-Host "`nDone. Both servers keep running in their own windows; close them to stop." -ForegroundColor Green
Write-Host 'Test: set 48 V / 2 A, toggle Output ON, click "Write setpoints", watch the gauges converge.'
