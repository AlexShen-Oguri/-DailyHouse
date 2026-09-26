@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start.ps1" %*
if errorlevel 1 (
  echo Startup failed. Please read the error above.
  pause
  exit /b 1
)
