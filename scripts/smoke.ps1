# End-to-end smoke test (Windows PowerShell).
[CmdletBinding()]
param(
  [int]$BackPort  = 8801,
  [int]$FrontPort = 3801
)

$ErrorActionPreference = 'Continue'
$Repo = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$LogDir = Join-Path $Repo 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$BackLog  = Join-Path $LogDir 'smoke-backend.log'
$FrontLog = Join-Path $LogDir 'smoke-frontend.log'

$script:ok = 0; $script:fail = 0
function Pass($msg) { $script:ok++;   Write-Host "  PASS $msg" -ForegroundColor Green }
function Miss($msg) { $script:fail++; Write-Host "  FAIL $msg" -ForegroundColor Red }

$py = (Get-Command python -ErrorAction SilentlyContinue) `
  ?? (Get-Command py -ErrorAction SilentlyContinue)
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue) `
  ?? (Get-Command npm -ErrorAction SilentlyContinue)
if (-not $py)  { throw 'python not on PATH' }
if (-not $npm) { throw 'npm not on PATH' }

$back = Start-Process -FilePath $py.Source `
  -ArgumentList '-m','uvicorn','main:app','--host','127.0.0.1','--port',"$BackPort" `
  -WorkingDirectory (Join-Path $Repo 'backend') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $BackLog `
  -RedirectStandardError "$BackLog.err" -PassThru

$env:NEXT_PUBLIC_BACKEND_HTTP_URL = "http://127.0.0.1:$BackPort"
$front = Start-Process -FilePath $npm.Source `
  -ArgumentList 'exec','--','next','dev','--turbopack','-p',"$FrontPort" `
  -WorkingDirectory (Join-Path $Repo 'frontend') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $FrontLog `
  -RedirectStandardError "$FrontLog.err" -PassThru

function Wait200($url, $tries=60) {
  for ($i = 0; $i -lt $tries; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
      if ([int]$r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}

try {
  if (Wait200 "http://127.0.0.1:$BackPort/health" 60)   { Pass "backend /health" } else { Miss "backend did not come up" }
  if (Wait200 "http://127.0.0.1:$FrontPort/" 90)        { Pass "frontend /" }        else { Miss "frontend did not come up" }

  $h = Invoke-RestMethod "http://127.0.0.1:$BackPort/api/health" -TimeoutSec 3
  if ($h.PSObject.Properties.Name -contains 'scpi_reachable') {
    Pass "/api/health has scpi_reachable"
  } else {
    Miss "/api/health missing scpi_reachable"
  }

  foreach ($slug in 'thermal-cycling','humidity-freeze','damp-heat','pid','bypass-diode','reverse-current','ground-continuity') {
    try {
      $r = Invoke-WebRequest "http://127.0.0.1:$FrontPort/tests/$slug" -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop -TimeoutSec 5
      $code = [int]$r.StatusCode
    } catch {
      $code = [int]$_.Exception.Response.StatusCode.value__
    }
    if ($code -eq 307 -or $code -eq 200) { Pass "/tests/$slug -> $code" } else { Miss "/tests/$slug -> $code" }
  }

  $body = '{"testId":"ci-smoke","testName":"Damp Heat","standard":"IEC 61215-2 MQT 13"}'
  $out  = Join-Path $env:TEMP 'agni-smoke.pdf'
  Invoke-WebRequest "http://127.0.0.1:$FrontPort/api/reports/generate" `
    -UseBasicParsing -Method POST -ContentType 'application/json' -Body $body `
    -OutFile $out -TimeoutSec 8 -ErrorAction Stop | Out-Null
  $sz = (Get-Item $out).Length
  $head = (Get-Content $out -TotalCount 1 -Encoding Byte) -join ','
  if ($sz -gt 500) { Pass "POST /api/reports/generate returns PDF ($sz bytes)" }
  else             { Miss "POST /api/reports/generate too small ($sz)" }
}
finally {
  if ($back)  { try { Stop-Process -Id $back.Id  -Force -ErrorAction SilentlyContinue } catch {} }
  if ($front) { try { Stop-Process -Id $front.Id -Force -ErrorAction SilentlyContinue } catch {} }
}

Write-Host ""
Write-Host "[smoke] passed=$($script:ok) failed=$($script:fail)"
exit ([int]([bool]$script:fail))
