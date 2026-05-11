[CmdletBinding()]
param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$LogDir = Join-Path $Repo 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'backend.log'
$PidFile = Join-Path $LogDir 'backend.pid'

if (Test-Path $PidFile) {
  $oldPid = Get-Content $PidFile -ErrorAction SilentlyContinue
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  }
}

$py = (Get-Command python -ErrorAction SilentlyContinue) `
  ?? (Get-Command python3 -ErrorAction SilentlyContinue) `
  ?? (Get-Command py -ErrorAction SilentlyContinue)
if (-not $py) { throw 'python not on PATH' }

$proc = Start-Process -FilePath $py.Source `
  -ArgumentList '-m','uvicorn','main:app','--host','0.0.0.0','--port',"$Port" `
  -WorkingDirectory (Join-Path $Repo 'backend') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $Log `
  -RedirectStandardError  "$Log.err" `
  -PassThru
$proc.Id | Out-File -Encoding ascii $PidFile
Write-Host "[start] backend pid $($proc.Id)  log $Log"
