# 場景美術

城鎮使用 Blender 腳本建模與渲染；地下漕渠由內建 imagegen 生成。沒有複製參考專案的圖檔。程式原生 SVG 繪製戰鬥棋子與地圖。

- [十城與四國輿圖](geography/README.md)：十座獨立城市場景、3D 地貌／城市／道路大地圖，以及可編輯 Blender 原始檔。
- [雲京 GLB](town3d/yunhua-town.glb)：雲京的固定視角模型，包含功能建築與不可互動街坊。
- [Blender 場景](town3d/yunhua-town.blend)：可編輯原始場景；由 [建模腳本](../../scripts/blender/build-town.py) 產生 GLB 與渲染圖。
- [城鎮渲染圖](town3d/yunhua-town-render.png)：標題及設施視窗背景。
- [地下漕渠](yunhua-canal.png)：探索及戰鬥背景。
- [玩家介面美術](ui/README.md)：圖示圖集、木框紙本面板及生成提示詞。

## 重建城鎮

使用 Blender 背景模式執行 `scripts/blender/build-town.py`，會重建可編輯場景、GLB、渲染 PNG 與 `scene-info.json`。模型根節點的 `facility` 對應正式設施種類；`scenery` 為不可互動街坊。幾何、配色、鏡頭與尺寸是美術作者資料，不提供玩法規則。正式互動由 `app/TownModel.tsx` 讀取 GLB，僅開放 GameView 提供的設施。

## 漕渠提示詞

Single wide 16:9 environment background for a Chinese fantasy turn-based RPG battle arena. An ancient underground canal warehouse in Yunhua, broad EMPTY stone floor in foreground for combatants, ornate timber beams, mossy brick arches and water channels at both sides, scattered crates in background, shafts of cool teal light through ceiling, warm lanterns at rear. Side-on wide theatre-like composition, left and right foreground clear for battle formations, central negative space. Hand-painted detailed 2D illustrated game art, crisp ink edges, jade teal and dark sepia with golden light, visually legible old-school single-player RPG art. No characters, no monsters, no interface, NO text, NO letters, no borders, no panels. Landscape widest available. Project-bound background asset for Greeting Adventurer.
