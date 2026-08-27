// electron/main.cjs — 問候冒險者 桌面外殼。
//
// 最小 Electron main：開一個視窗載入 renderer。renderer（app/）已自帶引擎與內容（打包進 bundle），
// 所以這一版 main **不需要 IPC**——它就是個原生視窗殼。之後內容變大需 node:fs、或要做存檔時，
// 再把引擎移進 main 走 IPC（見 HANDOFF 的 F4 架構決定）。
//
// 安全預設：contextIsolation 開、nodeIntegration 關（renderer 是純前端，不需要 node）。
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    title: '問候冒險者 · Greeting Adventurer',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // 開發時載 Vite dev server（熱更新）；否則載打包好的 renderer。
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl !== undefined && devUrl !== '') {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
