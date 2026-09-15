# 雲華冒險地圖 3D 場景

正式九張冒險地圖共十八層、一百七十一間房，完整對照見 [catalog.json](catalog.json)。每張都有封裝材質的 GLB、各層渲染、可編輯 Blender 檔及從實際模型烘焙的行走遮罩。

| 場景 | 層數 | 造景主題／可編輯來源 |
|---|---:|---|
| 舊漕渠與沉倉 | 2 | [水工倉房、蓄水槽與手輪閘](old-canal.blend) |
| 司曆殘院 | 1 | [斷柱、碑銘與觀星儀器](calendar-court-ruin.blend) |
| 天衡印塔 | 6 | [卷軸書庫、校印工作臺與封印地廳](seal-tower.blend) |
| 霧篁藥谷 | 1 | [竹徑、山壁與採藥晾架](mist-bamboo-valley.blend) |
| 懸泉石窟 | 2 | [泉池、石筍與洞壁](hanging-spring-grotto.blend) |
| 潮生蘆洲 | 1 | [蘆葦水岸與漁網晾架](tidal-reed-isle.blend) |
| 鹽井封窖 | 2 | [滷水蒸發盤與結晶鹽](salt-well-cellar.blend) |
| 朱砂斷嶺 | 1 | [赤岩、朱砂礦料與採礦工具](cinnabar-ridge.blend) |
| 古窯火道 | 2 | [帶爐口的磚窯、煙囪與陶器架](old-kiln-flue.blend) |

## 共用造景契約

完整實地、中央留空、陳設靠實際房間邊界；避開正式門位與樓梯格。每格六個美術單位，Blender 平面座標為 `x=(col-3)*6, y=(3-row)*6`；轉為 Three 時 `z=(row-3)*6`。五、六、八格寬的地圖都沿用同一座標契約，碰撞網格依正式樓層尺寸擴展。自然場景用岩岸輪廓，建築使用砌牆、石拱及切面前牆；地板紋理不使用山壁大岩塊材質。

拓樸取自正式 Content Pack，部分既有模板共用布局，這次未改寫玩法連線。陳設是美術，並非可領取物品、資源生成或怪物標記。

## 漕渠造景

第一座地牢模型採雲华水工遺構的剖面視角。上層包含卸貨入口、西側倉房、引水走廊與東側沉倉；地下層包含導渠、靠牆的蓄水槽、手輪水閘、沉貨區與出口。地板以連續實地為主，貨架、陶罐、木桶及箱堆按整間房的外牆配置，排水槽與水閘也收在牆邊；不在大房間中央或內部格子接縫擺設。中央保留人物、怪物及遭遇的活動空間。前側牆降低以利辨識，後側保留砌體與石拱；沒有屋頂遮擋探索。

- [可編輯 Blender 場景](old-canal.blend)：上、下層分高放置，可選取房間根節點。
- [上層模型](canal-upper.glb)／[地下模型](canal-lower.glb)：封裝全部色彩及法線貼圖。
- [上層渲染](canal-upper.png)／[地下渲染](canal-lower.png)。
- [場景對照資料](canal.json)：正式模板、樓層、房間 ID 與模型名稱。
- [色彩圖集](canal-atlas.png)／[切線法線](canal-normal.png)。

## 重建與驗證

共用幾何工具在 [dungeon_geometry.py](../../../scripts/blender/dungeon_geometry.py)。漕渠以 [build-dungeon.py](../../../scripts/blender/build-dungeon.py) 重建；其餘八張由 [dungeon-profiles.json](../../../scripts/blender/dungeon-profiles.json) 決定美術主題、名稱及樓層標籤，交給 [build-dungeon-catalog.py](../../../scripts/blender/build-dungeon-catalog.py) 建立。

```powershell
& 'D:/SteamLibrary/steamapps/common/Blender/blender.exe' --background --python-exit-code 1 --python scripts/blender/bake-dungeon-ground.py
& 'D:/SteamLibrary/steamapps/common/Blender/blender.exe' --background --python-exit-code 1 --python scripts/blender/build-dungeon-catalog.py -- seal-tower
& 'D:/SteamLibrary/steamapps/common/Blender/blender.exe' --background --python-exit-code 1 --python scripts/blender/verify-dungeon-clearance.py -- seal-tower
node scripts/build-dungeon-index.mjs
npm run verify
npm run verify:dungeon-catalog
```

僅調整地質配色時，可用 [refresh-dungeon-tints.py](../../../scripts/blender/refresh-dungeon-tints.py) 加 `-- key` 更新 GLB 和 Blender 來源，之後仍須重跑空間檢查。色彩乘法使用 glTF 匯出器支援的 ShaderNodeMix，避免只在離線渲染有色調。

其他圖使用 profiles 的 key 替換 `seal-tower`。漕渠檢查不加 `-- key`。所有 map manifest 備妥後重建 catalog；不得手改 GLB 卻保留舊空間驗收結果。每張地圖的 `*-navigation.json` 和 `*-clearance.json` 分別記錄行走遮罩及模型雜湊；漕渠保留 `navigation.json`、`clearance.json` 原檔名。

Blender 背景執行 [build-dungeon.py](../../../scripts/blender/build-dungeon.py)。腳本讀取正式 `content/yunhua/maps.json` 的房間占地、門及樓梯，不自行增刪玩法連線。每格六個美術單位，房間輪廓由實際格座標合併；石拱對準正式門位，階梯井縮為含護欄約 1.4 × 2.0 美術單位的角落配置，井口以外都是完整平台；避開牆中央門口，保留繞行與樓梯上下端落腳空間。美術根節點使用 `roomId`，可開門扇使用 `linkId`，`anchor` 位於乾地。生成兩份 GLB、渲染、對照資料與可編輯場景。每層三角面上限 150,000；依房間、結構／陳設及材質合併降低繪製呼叫。細竹枝、蘆葦及繩索使用八邊截面，裝飾超過預算才減面，通路結構保持精確。

建模後以 Blender 執行 [verify-dungeon-clearance.py](../../../scripts/blender/verify-dungeon-clearance.py)，對實際匯出的 GLB 取樣，驗證直徑 1.0 美術單位的角色足跡能穿過各門、連續房間內部通路及中央遭遇區；另檢查八級樓梯踏面與實地占比。這是美術尺度的空間驗收；同一支腳本另輸出 [navigation.json](navigation.json)，供正式與測試入口共用的行走控制器使用。結果與模型 SHA-256 存在 [clearance.json](clearance.json)。

`npm run verify:dungeon-art` 檢查完整房間對照、門、UV、封装貼圖、面數及空間驗收雜湊；`npm run verify:dungeon` 用隔離桌面存檔實測正式鍵盤行走／開門、跨房、讀檔、同層場景保留、上下樓及離場。正式 `npm run verify` 包含靜態美術檢查。

## 遊戲中的呈現契約

[DungeonAdventure.tsx](../../DungeonAdventure.tsx) 是正式探索與測試入口共用的畫面，包含 [WalkScene.tsx](../../WalkScene.tsx)、小地圖、房間內容、門與楼梯操作。正式 App 只把 GameView 與命令結果傳入；[入口型別](../../walk-types.ts) 定義房間占地、進入格、連線、門狀態及隊伍，場景不查存檔、不建立地圖實例、不產生怪物或獎勵。

[walk-controller.ts](../../walk-controller.ts) 使用注入的幾何遮罩及門／連線資料，WASD／方向鍵依畫面方向行走。房內移動是呈現座標；跨房透過 `moveDungeonRoom`，拒絕時不換房，接受後等 GameView 確認才移入。[walk-interactions.ts](../../walk-interactions.ts) 由正式連線格建立門口與樓梯平台錨點。場景光環與提示跟隨該位置；走近後可點選或按 E，紅門呼叫 `openDungeonDoor`，樓梯由相鄰房間指令切換樓層並使用正式 `entryCell`。距離不足、非目前房間或暫停操作時不接受互動；E 的鍵盤重複事件不派發，等待新投影期間不重送。內容與出口沿用 `interactDungeonContent`、`useDungeonExit`；戰鬥使用共用 [3D 戰鬥畫面](../combat/README.md)。房內怪群使用編組第一隻怪物的模型，點擊模型與內容卡均送出同一正式互動命令；只呈現當前房間未清除的遭遇。

探索身分、地圖版本與樓層共同決定場景生命週期。同樓層資料更新、戰鬥與行囊往返保留模型及房內位置。戰鬥時原模型留在可見背景，凍結行走與鏡頭、停畫小地圖並隱藏探索 UI，上方透明戰鬥層負責壓暗及毛玻璃；行囊期間隱藏場景並停止操作與繪製。換層或離場釋放 GPU 資源。重讀存檔按正式房間及進入格出生，不保存房內細部座標。非目前房間只保留昏暗結構，`visualRole=contents` 根節點隱藏。小地圖使用同一個 WebGL renderer 與已載入模型，透過獨立 viewport／scissor 做北方朝上的垂直空拍，不重複載入 GLB；只繪製已揭露房間，未知房間連外框與符號都不繪製，門的模型需兩端皆已知，已看過的地形持續保留。門與樓梯圖示由正式連線投影：只要本層一端房間已揭露，就標出該入口，門標記同步開關狀態，跨層入口依目標樓層標示上／下樓；不顯示未知目的房間或其他樓層的圖形。同座標多個入口並排，圖示位置與場景互動平台一致；過近的標記在螢幕座標錯開，細線仍指向實際入口。每次空拍後恢復主場景的材質、可見性、陰影與 viewport，維持主畫面只有當前房間亮燈。我方箭頭由行走控制器的房內座標投影，朝向與人物一致；換層使用新樓層及正式進入格。

[walk-presentation.json](walk-presentation.json) 提供座標換算、步速、動畫倍率、鏡頭、小地圖最小取景範圍／邊距及互動距離／平台偏移參數；[dungeon-walk-data.ts](../../dungeon-walk-data.ts) 將模板對應到模型碰撞資料，驗證正式占地與模型一致，缺資料明確失敗。[Walker.ts](../../Walker.ts) 是隊伍代表造型；實際隊員身分由入口提供，但尚不依外貌／裝備改變模型。

`/dungeon-walk.html` 是明確隔離的測試入口，[adventure-fixture.ts](../../testing/adventure-fixture.ts) 提供假探索 ID、門狀態及一筆測試遭遇。模型／占地沿用正式美術資料；移動、開門與離場更改記憶體 fixture，可用「拒絕下次移動」驗證拒絕。戰鬥另由 [combat-sandbox.ts](../../testing/combat-sandbox.ts) 建立固定種子的隔離世界、配裝隊伍與漕渠怪群，注入同一 `CombatScreen`，實際執行正式回合引擎，勝利才移除測試遭遇；不再提供直接結束遭遇的按鈕。切换其他地形仍使用這組獨立戰鬥測試資料，不代表該地圖的正式怪物池。測試入口完全不讀寫存檔；正式 Runtime 不得引用測試入口。
