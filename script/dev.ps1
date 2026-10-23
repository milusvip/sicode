$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot

function Stop-ByCommandLine {
  param([string]$Pattern)
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like $Pattern } |
    ForEach-Object {
      Write-Host ("        kill " + $_.ProcessId + "  " + $_.Name)
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "  SiCode Dev  |  start / restart"
Write-Host "  ================================"

# Windows first: the main process owns the sidecar supervisor, so it has to go before we touch the
# server, otherwise the supervisor restarts the server behind us and the port is taken again.
Write-Host "[1/5] stopping electron windows..."
Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
  Where-Object { $_.ExecutablePath -like "*\SiCode\*" } |
  ForEach-Object {
    Write-Host ("        kill " + $_.ProcessId + "  electron")
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Milliseconds 1500

Write-Host "[2/5] stopping dev runner and sidecar..."
Stop-ByCommandLine "*scripts\dev.ts*"
# 3084 is a single-instance port. Any `serve --service` process holds it — including the packaged
# opencode-cli that another desktop build (or the upstream app) left running in the background.
Stop-ByCommandLine "*serve --service*"
Start-Sleep -Milliseconds 500

Write-Host "[3/5] waiting for port 3084..."
$deadline = (Get-Date).AddSeconds(8)
while ((Get-Date) -lt $deadline) {
  $conn = Get-NetTCPConnection -LocalPort 3084 -State Listen -ErrorAction SilentlyContinue
  if (-not $conn) { break }

  foreach ($c in $conn) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($c.OwningProcess)"
    $cmd = [string]$p.CommandLine

    if ($cmd -like "*SiCode*" -or $cmd -like "*opencode*") {
      Write-Host ("        kill " + $c.OwningProcess + "  " + $p.Name + " (holding 3084)")
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }

  Start-Sleep -Milliseconds 500
}

$conn = Get-NetTCPConnection -LocalPort 3084 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  Write-Host ("        WARNING: 3084 still held by PID " + $conn[0].OwningProcess + " - startup may fail")
} else {
  Write-Host "        3084 free"
}

Write-Host "[4/5] clearing build output..."
$out = Join-Path $root "packages\desktop\out"
if (Test-Path $out) { Remove-Item -Recurse -Force $out }

Write-Host "[5/5] launching (Ctrl+C to stop)..."
# Host tooling may inject a fs shim through NODE_OPTIONS; it blocks vite's out/ cleanup and breaks
# the build. Strip it along with the Electron switches this environment needs.
$env:NODE_OPTIONS = $null
$env:ELECTRON_RUN_AS_NODE = $null
$env:OPENCODE_DESKTOP_DISABLE_GPU = "1"
$env:OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT = "9333"

Set-Location (Join-Path $root "packages\desktop")
& bun ./scripts/dev.ts
