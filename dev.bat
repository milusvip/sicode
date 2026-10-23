@echo off
rem One-click start / restart for SiCode desktop dev.
rem Double-click again while it is running to restart it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0script\dev.ps1"
if errorlevel 1 pause
