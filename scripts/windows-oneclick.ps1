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

function Have($names) {
  foreach ($n in $names) { if (Get-Command $n -ErrorAction SilentlyContinue) { return $true } }
  return $false
}

# Figure out what's missing and auto-install via winget. PATH does not
# refresh inside a running session, so if anything is installed the script
# stops and asks for a fresh window rather than failing halfway.
$need = @()
if (-not (Have @('git')))           { $need += 'Git.Git' }
if (-not (Have @('python', 'py')))  { $need += 'Python.Python.3.12' }
if (-not (Have @('npm', 'npm.cmd'))) { $need += 'OpenJS.NodeJS.LTS' }

if ($need.Count -gt 0) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Step ("Installing missing prerequisites via winget: " + ($need -join ', '))
    foreach ($pkg in $need) {
      winget install --id $pkg -e --source winget --accept-package-agreements --accept-source-agreements
    }
    Write-Host ""
    Write-Host "Prerequisites installed. Windows PATH only updates in a NEW shell." -ForegroundColor Yellow
    Write-Host "==> Close this window, open a NEW PowerShell, and run the one-paste again." -ForegroundColor Yellow
    exit 0
  }
  Fail ("Missing: " + ($need -join ', ') + ". Install these, open a new PowerShell, then re-run.")
}

$git = Get-Command git -ErrorAction SilentlyContinue
$py  = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
Write-Host ("    git={0}  python={1}  npm={2}" -f $git.Source, $py.Source, $npm.Source)

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
  & $py.Source -m venv $Venv
}
Step 'Installing backend requirements'
& $VenvPy -m pip install --quiet --upgrade pip
& $VenvPy -m pip install --quiet -r (Join-Path $Backend 'requirements.txt')

# --- Frontend deps ---------------------------------------------------------
Step 'Installing frontend dependencies (first run takes a few minutes)'
$Frontend = Join-Path $Root 'frontend'
Push-Location $Frontend
& $npm.Source install --no-audit --no-fund
Pop-Location

# --- Start both in their own windows --------------------------------------
Step 'Starting backend (DEMO mode) in its own window on :8000'
Start-Process powershell -WorkingDirectory $Backend -ArgumentList @(
  '-NoExit', '-Command',
  "`$env:DEMO_MODE='true'; & '$VenvPy' -m uvicorn main:app --host 127.0.0.1 --port 8000"
)

Step 'Starting frontend in its own window on :3000'
Start-Process powershell -WorkingDirectory $Frontend -ArgumentList @(
  '-NoExit', '-Command',
  "npm run dev"
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
