@echo off
setlocal
chcp 65001 >nul
title Local Password Manager
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Download the LTS version from https://nodejs.org, then run this file again.
  echo.
  pause
  exit /b 1
)

node -e "process.exit(parseInt(process.versions.node)>=18?0:1)"
if errorlevel 1 (
  echo Your Node.js version is too old. Version 18 or newer is required.
  node -v
  echo.
  pause
  exit /b 1
)

node "src\index.js"
set EXITCODE=%errorlevel%

if not "%EXITCODE%"=="0" if not "%EXITCODE%"=="130" if not "%EXITCODE%"=="143" (
  echo.
  echo The program exited with code %EXITCODE%.
  pause
)

exit /b %EXITCODE%
