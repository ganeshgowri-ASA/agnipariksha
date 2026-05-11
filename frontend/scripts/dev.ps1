# Run Next dev on :3000, killing any orphan listener first.
#
# Usage:
#   pwsh frontend/scripts/dev.ps1
#   pwsh frontend/scripts/dev.ps1 -Port 3001
[CmdletBinding()]
param(
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
Set-Location -Path (Join-Path (Split-Path -Parent $PSCommandPath) '..')

if ($Port -eq 0) {
  if ($env:PORT) { $Port = [int]$env:PORT } else { $Port = 3000 }
}

Write-Host "[agnipariksha] clearing any process bound to :$Port"

# Primary: kill-port (cross-platform, in devDependencies).
try {
  npx --yes kill-port $Port 2>$null | Out-Null
} catch { }

# Belt-and-braces: hunt via Get-NetTCPConnection (Windows 8/Server 2012+).
try {
  $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
  if ($conns) {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $pids) {
      try {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "[agnipariksha] stopped pid $procId on :$Port"
      } catch { }
    }
  }
} catch { }

Write-Host "[agnipariksha] starting next dev on :$Port"
npx next dev --turbopack -p $Port
