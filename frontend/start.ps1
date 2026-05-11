[CmdletBinding()]
param([int]$Port = 3000)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$LogDir = Join-Path $Repo 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'frontend.log'
$PidFile = Join-Path $LogDir 'frontend.pid'

if (Test-Path $PidFile) {
  $oldPid = Get-Content $PidFile -ErrorAction SilentlyContinue
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  }
}

$killPort = Join-Path $Repo 'frontend\node_modules\.bin\kill-port.cmd'
if (Test-Path $killPort) { try { & $killPort $Port 2>$null | Out-Null } catch { } }

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue) `
  ?? (Get-Command npm -ErrorAction SilentlyContinue)
if (-not $npm) { throw 'npm not on PATH' }

$proc = Start-Process -FilePath $npm.Source `
  -ArgumentList 'run','dev:noclean' `
  -WorkingDirectory (Join-Path $Repo 'frontend') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $Log `
  -RedirectStandardError  "$Log.err" `
  -PassThru
$proc.Id | Out-File -Encoding ascii $PidFile
Write-Host "[start] frontend pid $($proc.Id)  log $Log"
