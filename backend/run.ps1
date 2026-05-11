# Run Agnipariksha FastAPI backend on http://0.0.0.0:8000
#
# Usage:
#   pwsh backend/run.ps1
#   pwsh backend/run.ps1 -Reload
#   pwsh backend/run.ps1 -Port 8080
[CmdletBinding()]
param(
  [string]$Host_ = $env:HOST,
  [int]$Port = 0,
  [switch]$Reload
)

$ErrorActionPreference = 'Stop'
Set-Location -Path (Split-Path -Parent $PSCommandPath)

if (-not $Host_) { $Host_ = '0.0.0.0' }
if ($Port -eq 0) {
  if ($env:PORT) { $Port = [int]$env:PORT } else { $Port = 8000 }
}

$py = $env:PYTHON
if (-not $py) {
  if (Get-Command py -ErrorAction SilentlyContinue) { $py = 'py' }
  elseif (Get-Command python -ErrorAction SilentlyContinue) { $py = 'python' }
  else { throw 'Python interpreter not found on PATH (looked for python, py).' }
}

$cmd = @($py, '-m', 'uvicorn', 'main:app', '--host', $Host_, '--port', "$Port")
if ($Reload) { $cmd += '--reload' }

Write-Host "[agnipariksha] $($cmd -join ' ')"
& $cmd[0] $cmd[1..($cmd.Length - 1)]
