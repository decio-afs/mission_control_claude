@echo off
title Mission Control - Hermes
cd /d "%~dp0"

where node >nul 2>nul || (echo [X] Node.js not found - install from https://nodejs.org & pause & exit /b 1)

if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install
)

echo Launching Mission Control...
call npm run desktop

REM keep window open if it exited with an error
if errorlevel 1 pause
