@echo off
setlocal
cd /d "%~dp0"

echo.
echo   SiCode Dev  ^|  start / restart
echo   ================================

echo [1/4] stopping running instances...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'electron.exe' -and $_.ExecutablePath -like '*\SiCode\*') -or ($_.CommandLine -like '*scripts\dev.ts*') } | ForEach-Object { Write-Host ('        kill ' + $_.ProcessId + '  ' + $_.Name); Stop-Process -Id $_.ProcessId -Force }"

echo [2/4] freeing port 3084...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3084 " ^| findstr "LISTENING"') do (
  echo        port 3084 held by PID %%p - killing
  taskkill /F /PID %%p >nul 2>&1
)

echo [3/4] clearing build output...
if exist "packages\desktop\out" rd /s /q "packages\desktop\out"

echo [4/4] launching...
rem Bun and Electron need these in this environment; see the README dev section.
set ELECTRON_RUN_AS_NODE=
set OPENCODE_DESKTOP_DISABLE_GPU=1
set OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT=9333

cd /d "%~dp0packages\desktop"
call bun ./scripts/dev.ts

echo.
echo dev exited with code %ERRORLEVEL%
pause
