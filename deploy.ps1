# Agnipariksha one-click local deploy (Windows PowerShell).
#
#   pwsh deploy.ps1                # pull, install, restart, smoke-test
#   pwsh deploy.ps1 -NoPull        # skip git pull
#   pwsh deploy.ps1 -NoInstall     # skip pip / npm install
#
# Logs:  <repo>\logs\{backend,frontend}.log
# Pids:  <repo>\logs\{backend,frontend}.pid

[CmdletBinding()]
param(
  [switch]$NoPull,
  [switch]$NoInstall
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSCommandPath
Set-Location -Path $RepoRoot

$LogDir          = Join-Path $RepoRoot 'logs'
$BackendLog      = Join-Path $LogDir   'backend.log'
$FrontendLog     = Join-Path $LogDir   'frontend.log'
$BackendPidFile  = Join-Path $LogDir   'backend.pid'
$FrontendPidFile = Join-Path $LogDir   'frontend.pid'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Hr  { Write-Host ('-' * 52) }
function Say { param($m) Write-Host "[deploy] $m" -ForegroundColor DarkGray }
function Ok  { param($m) Write-Host "  OK  $m" -ForegroundColor Green }
function Wn  { param($m) Write-Host "  !   $m" -ForegroundColor Yellow }
function Er  { param($m) Write-Host "  X   $m" -ForegroundColor Red }

function Resolve-Python {
  foreach ($c in @('python','python3','py')) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  return $null
}

function Stop-Port {
  param([int]$Port)
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
  } catch { $conns = $null }
  if ($conns) {
    $procIds = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $procIds) {
      try {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Say "killed pid $procId on :$Port"
      } catch { }
    }
    Start-Sleep -Milliseconds 300
  }
  $killPort = Join-Path $RepoRoot 'frontend\node_modules\.bin\kill-port.cmd'
  if (Test-Path $killPort) {
    try { & $killPort $Port 2>$null | Out-Null } catch { }
  }
}

function Stop-RecordedPid {
  param([string]$File, [string]$Name)
  if (Test-Path $File) {
    $procId = (Get-Content $File -ErrorAction SilentlyContinue)
    if ($procId -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
      Say "stopping previous $Name (pid $procId)"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
    }
    Remove-Item $File -ErrorAction SilentlyContinue
  }
}

function Wait-Http200 {
  param([string]$Url, [int]$Tries = 30)
  $code = 0
  for ($i = 0; $i -lt $Tries; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
      $code = [int]$r.StatusCode
      if ($code -eq 200) { return $code }
    } catch {
      $code = 0
    }
    Start-Sleep -Seconds 1
  }
  return $code
}

Hr
Say 'Agnipariksha one-click deploy'
Say "repo root: $RepoRoot"
Hr

# 1. pull
if (-not $NoPull) {
  Say 'git fetch + fast-forward main'
  git fetch origin --quiet 2>$null
  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -eq 'main') {
    git pull --ff-only --quiet
    if ($LASTEXITCODE -eq 0) { Ok 'main fast-forwarded' } else { Wn 'git pull skipped' }
  } else {
    Wn "on branch '$branch' (not main); skipping pull"
  }
} else {
  Say 'skipping git pull (-NoPull)'
}

# 2. free ports
Say 'freeing ports :8000 (backend) and :3000 (frontend)'
Stop-RecordedPid -File $BackendPidFile  -Name 'backend'
Stop-RecordedPid -File $FrontendPidFile -Name 'frontend'
Stop-Port 8000
Stop-Port 3000

# 3. install deps
$Py = Resolve-Python
if (-not $Py) { Er 'no python interpreter on PATH'; exit 1 }

if (-not $NoInstall) {
  Say 'pip install -r backend\requirements.txt'
  Push-Location backend
  & $Py -m pip install --quiet --disable-pip-version-check -r requirements.txt
  $rc = $LASTEXITCODE
  Pop-Location
  if ($rc -ne 0) { Er 'pip install failed'; exit 1 }
  Ok 'backend deps installed'

  Say 'npm install (frontend)'
  Push-Location frontend
  & npm install --no-audit --no-fund --loglevel=error
  $rc = $LASTEXITCODE
  Pop-Location
  if ($rc -ne 0) { Er 'npm install failed'; exit 1 }
  Ok 'frontend deps installed'
} else {
  Say 'skipping installs (-NoInstall)'
}

# 4. start backend
Say "starting backend -> $BackendLog"
$bproc = Start-Process -FilePath $Py `
  -ArgumentList '-m','uvicorn','main:app','--host','0.0.0.0','--port','8000' `
  -WorkingDirectory (Join-Path $RepoRoot 'backend') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $BackendLog `
  -RedirectStandardError  "$BackendLog.err" `
  -PassThru
$bproc.Id | Out-File -Encoding ascii $BackendPidFile
Ok "backend pid $($bproc.Id)"

# 5. start frontend
Say "starting frontend -> $FrontendLog"
$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue) `
  ?? (Get-Command npm -ErrorAction SilentlyContinue)
if (-not $npmCmd) { Er 'npm not on PATH'; exit 1 }
$fproc = Start-Process -FilePath $npmCmd.Source `
  -ArgumentList 'run','dev:noclean' `
  -WorkingDirectory (Join-Path $RepoRoot 'frontend') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $FrontendLog `
  -RedirectStandardError  "$FrontendLog.err" `
  -PassThru
$fproc.Id | Out-File -Encoding ascii $FrontendPidFile
Ok "frontend pid $($fproc.Id)"

# 6. health checks
Hr
Say 'waiting up to 30s for backend /health'
$hcode = Wait-Http200 -Url 'http://127.0.0.1:8000/health' -Tries 30
if ($hcode -eq 200) {
  $body = (Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 2).Content
  Ok "backend  -> 200  $body"
} else {
  Er "backend  -> $hcode  (see $BackendLog)"
  if (Test-Path $BackendLog) { Get-Content $BackendLog -Tail 20 | ForEach-Object { "    | $_" } }
}

Say 'waiting up to 60s for frontend /'
$fcode = Wait-Http200 -Url 'http://127.0.0.1:3000/' -Tries 60
if ($fcode -eq 200) {
  Ok 'frontend -> 200'
} else {
  Er "frontend -> $fcode  (see $FrontendLog)"
  if (Test-Path $FrontendLog) { Get-Content $FrontendLog -Tail 20 | ForEach-Object { "    | $_" } }
}

Hr
if ($hcode -eq 200 -and $fcode -eq 200) {
  Write-Host 'PASS  Agnipariksha is up.' -ForegroundColor Green
  Write-Host "       backend  pid $($bproc.Id)   log $BackendLog"
  Write-Host "       frontend pid $($fproc.Id)   log $FrontendLog"
  Write-Host '       open  http://localhost:3000'
  exit 0
} else {
  Write-Host 'FAIL  one or more services did not return 200.' -ForegroundColor Red
  Write-Host "       backend  pid $($bproc.Id)   log $BackendLog"
  Write-Host "       frontend pid $($fproc.Id)   log $FrontendLog"
  exit 1
}
