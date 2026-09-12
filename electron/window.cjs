const { BrowserWindow } = require('electron');
const path = require('node:path');

function createWindow({ show = true, offscreen = false, devUrl = process.env.VITE_DEV_SERVER_URL } = {}) {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 800, minHeight: 640, show,
    title: '問候冒險者 · Greeting Adventurer',
    webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen },
  });
  const ready = devUrl
    ? win.loadURL(devUrl)
    : win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  return { win, ready };
}
module.exports = { createWindow };
