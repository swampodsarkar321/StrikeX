@echo off
title StrikeX - 20 Player Battle Royale
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js LTS and try again.
  pause
  exit /b
)

where python >nul 2>nul
if errorlevel 1 (
  echo Python not found. Install Python 3 and try again.
  pause
  exit /b
)

start "ZONE ROYALE SERVER" cmd /k "cd /d "%~dp0" && node server/index.js"
python serve.py
pause