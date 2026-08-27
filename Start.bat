@echo off
rem 問候冒險者 · Greeting Adventurer — 第一版試玩啟動器
rem 雙擊這個檔就會啟動遊戲（第一次會自動安裝相依套件，需要 Node.js）。
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
echo 啟動問候冒險者（瀏覽器會自動開啟；關閉此視窗即結束遊戲）...
call npm run dev
pause
