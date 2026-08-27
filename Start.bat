@echo off
rem 問候冒險者 · Greeting Adventurer — 桌面版試玩啟動器
rem 雙擊即可玩（第一次會自動安裝相依套件並打包，需要 Node.js）。
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 npm。請先安裝 Node.js: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo 第一次啟動：正在安裝相依套件，請稍候...
  call npm install
)
echo 正在打包並啟動問候冒險者（原生視窗）...
call npm run app
if errorlevel 1 (
  echo.
  echo [提示] 桌面版啟動失敗時，可改用瀏覽器版： npm run dev
  pause
)
