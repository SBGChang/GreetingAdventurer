// vite.config.ts — 問候冒險者 renderer 的建置設定。
//
// root = app/（UI 住在 src/ 之外，避開以 src/ 為界的七道紀律門禁）。renderer 只引用引擎的**純函式**，
// 內容以 import.meta.glob 打包進 bundle（見 app/engine/content-browser.ts）——不碰 node:fs。

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'app'),
  // 相對 base：讓打包後的 index.html 在 Electron 的 file:// 下也能載到 assets（絕對 /assets 在 file:// 會失效）。
  base: './',
  plugins: [react()],
  build: {
    // 產物放 repo 根的 dist/renderer（Electron 之後從這裡載）。
    outDir: resolve(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: { port: 5473 },
});
