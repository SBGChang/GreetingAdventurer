@echo off
rem Greeting Adventurer - desktop launcher
rem Double-click to play. First run installs dependencies and packages. Requires Node.js.
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js first: https://nodejs.org/
  pause
  exit /b 1
)
set "NEED_INSTALL="
if not exist "node_modules\.bin\vite.cmd" set "NEED_INSTALL=1"
if not exist "node_modules\.bin\electron.cmd" set "NEED_INSTALL=1"
if defined NEED_INSTALL (
  echo Installing dependencies, please wait. This can take a few minutes...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Check your network connection, then run this file again.
    pause
    exit /b 1
  )
)
echo Packaging and launching Greeting Adventurer (native window)...
call npm run app
if errorlevel 1 (
  echo.
  echo [HINT] Desktop build failed. You can try the browser version: npm run dev
  pause
)
