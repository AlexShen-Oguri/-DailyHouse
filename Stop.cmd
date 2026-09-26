@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Stop.ps1" %*
if errorlevel 1 (
  echo Stop failed. Please read the error above.
  pause
  exit /b 1
)
