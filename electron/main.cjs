// 問候冒險者：Electron 視窗生命週期。遊戲與存檔介面由 renderer 提供。
const { app, BrowserWindow } = require('electron');
const { createWindow } = require('./window.cjs');
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
