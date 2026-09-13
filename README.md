# 問候冒險者 · Greeting Adventurer

React／TypeScript／Electron 單機 RPG。遊戲引擎在 renderer 執行，內容由編譯好的 JSON Content Pack 提供。**目前雲華主循環可玩，十六城可旅行與住宿；尚非四國完整遊戲。**

## 啟動

需要 Node.js 24 與 npm。Windows 可雙擊 `Start.bat`；首次會安裝相依套件，之後建置並開啟 Electron。

3D 模型（`.blend`／`.glb`）使用 Git LFS。複製專案前先安裝 Git LFS 並執行 `git lfs install`；既有 checkout 更新後執行 `git lfs pull`，確保取得實際模型檔。

```sh
npm ci
npm run app
```

介面採 16:9 橫向舞台，隨視窗等比例縮放；城鎮使用固定角度的 Blender 3D 近景；按住滑鼠左鍵或右鍵可上下左右拖曳平移，不提供旋轉及縮放，Hover 建築或設施頁簽會平順追焦；滑鼠移至模型建築會輕微浮起、投下即時陰影，外緣呈現呼吸光暈並顯示名稱，右側設施頁簽會同步高亮；點選建築或頁簽進入設施，下方行囊選單提供裝備、隊形配置、委託狀態與道具四個分頁。Esc 關閉設施或返回探索，戰鬥及戰利品結算中不能切換場景。

進入後選「踏上旅程」。先在裝備店買「環首短刀」與防具，到「行囊選單 → 裝備」裝備並配置「引環斬」，再到公會接取「舊漕渠與沉倉」的委託。戰後找地圖出口返城、處理戰利品，回公會領獎；每次成功操作都會自動存檔。

城門口可開啟可旋轉、縮放的 3D 大地圖，查看十六座各具地形與建築特色的城池。十六城均可抵達並切換各自模型，雲京與星井之間有渡湖線，其他文化區域由陸路銜接。新增十二城開放城門與住宿，專屬商品與冒險內容尚未完成。完整模型與地圖見 [十六城與四國輿圖](app/assets/geography/README.md)。

城鎮模型的可編輯來源與重建方式見 [場景美術](app/assets/README.md)。

瀏覽器開發模式：`npm run dev`。桌面與開發網站使用不同的本機存檔空間；瀏覽器清除網站資料會刪除該網站的存檔。

## 查閱順序

1. [目前實作狀態](docs/CURRENT_STATUS.md)：可用流程、未完成項目、驗收命令。這是唯一的實作狀態文件。
2. [核心遊戲設計](docs/00_core/game_design_document.md)：玩法目標。
3. [技術架構](docs/00_core/technical_architecture.md)及 [模組契約](docs/00_core/architecture/00_shared_contracts.md)：規格，不是完成清單。
4. [世界觀](docs/01_world/worldbuilding.md)及四國正式內容設計：[雲華](docs/03_content/yunhua/yunhua_content.md)、[維爾冬](docs/03_content/vildun/vildun_content.md)、[奧瑞恩](docs/03_content/aurelien/aurelien_content.md)、[薩菲爾](docs/03_content/safir/safir_content.md)。
5. [Runtime 開發規範](.claude/skills/runtime-data-discipline/SKILL.md)。

## 結構

| 路徑 | 責任 |
|---|---|
| `app/` | React 畫面、ViewModel、瀏覽器內容與存檔介面 |
| `electron/` | 原生視窗外殼 |
| `src/contracts/` | 型別與模組邊界 |
| `src/kernel/` | 交易、決定性 RNG、ID 與排程排序 |
| `src/modules/`、`src/domain-services/` | 領域狀態、Handler、Query 與純計算 |
| `src/app/` | 正式組裝、Workflow、內容 adapter、存檔驗證 |
| `content-source/` → `content/` | 作者資料 → 編譯產物；runtime 只讀後者 |
| `docs/03_content/` | 四國設計來源與 HTML 閱讀版 |

## 驗證與產生資料

```sh
npm run verify
npm run report:content
npm run content:packs
npm run content:all
npm run schema:save
```

`verify` 包含引擎與 UI 型別、Runtime 紀律、模組測試、正式 UI 門面整合測試、存檔 schema、內容同步、文件檢查與 UI 建置。
內容同步預設檢查工作樹，於暫存目錄重建，不覆蓋工作檔；稽核既有提交可用 `npm run verify:content-sync -- --ref=HEAD`。

修改狀態只更新對應文件；已解決問題移除，不附加「上一階段」紀錄。歷史差異由 Git 保存。
