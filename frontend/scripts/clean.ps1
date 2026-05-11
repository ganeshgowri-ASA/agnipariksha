# Nuke stale Next.js artefacts that cause errors like:
#   Module not found: Can't resolve 'react-server-dom-webpack/server'
#   ENOENT _next/static/...
# (usually means an orphan dev server wrote a half-built .next while
#  node_modules were on a different next version)
#
# Usage:
#   pwsh frontend/scripts/clean.ps1
#   pwsh frontend/scripts/clean.ps1 -NoBuild

[CmdletBinding()]
param([switch]$NoBuild)

$ErrorActionPreference = 'Stop'
Set-Location -Path (Join-Path (Split-Path -Parent $PSCommandPath) '..')

$killPort = Join-Path (Get-Location) 'node_modules\.bin\kill-port.cmd'
if (Test-Path $killPort) { try { & $killPort 3000 2>$null | Out-Null } catch { } }

try {
  $conns = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
  if ($conns) {
    $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
      try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch { }
    }
  }
} catch { }

Write-Host '[clean] removing .next, node_modules, package-lock.json'
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue .next, node_modules, package-lock.json

Write-Host '[clean] npm install (fresh)'
& npm install --no-audit --no-fund --loglevel=error

if (-not $NoBuild) {
  Write-Host '[clean] npm run build'
  & npm run build
}

Write-Host '[clean] done. Frontend modules + .next rebuilt.'
Write-Host '       Now run: pwsh deploy.ps1 -NoInstall   (or just pwsh deploy.ps1)'
