# 十六城與四國輿圖

這是呈現層的 Blender 美術資料，不建立城市、通行權、旅費或旅行天數。城市名稱與文化歸屬沿用四國正式設計；地形、視覺座標及道路折點是本次新增的美術設計。所有道路與雲京—星井渡湖線均以 `routeId` 對應正式 Content Pack；湖面虛線表示乘船航段。

## 城池

| 城市 | 外觀與布局 | 可編輯來源 |
|---|---|---|
| 雲京 | 水道坊市、石橋、重簷公會與完整城垣 | [Blender](../town3d/yunhua-town.blend) |
| 青岑城 | 依山階台、石階、竹林與藥圃 | [Blender](qingcen.blend) |
| 澄浦城 | 開放港池、長棧橋、泊船與鹽田 | [Blender](chengpu.blend) |
| 赤嶺城 | 紅岩、磚窯、煙囪與工坊街 | [Blender](chiling.blend) |
| 霜灣 | 雪地港口、陡頂木屋、船塢與山脊 | [Blender](frostbay.blend) |
| 杉脊堡 | 杉林環寨、木柵、瞭望塔與符石 | [Blender](cedarkeep.blend) |
| 晨冠城 | 白石藍頂、教堂雙塔、噴泉與學院街 | [Blender](dawncrown.blend) |
| 灰楯堡 | 厚重內外城垣、石造主堡與兵營 | [Blender](greyshield.blend) |
| 星井城 | 中央綠洲、藍釉穹頂、棕櫚與觀星塔 | [Blender](starwell.blend) |
| 赤帆驛 | 中央水池廣場、西側紅帆市集、東南住宅巷弄、北側公會與旅館、西南工坊；星紋藍釉弧頂與雕拱窗 | [Blender](redsail.blend) |
| 冰鑿城 | 冰川採石階台、吊架與融水池 | [Blender](icechisel.blend) |
| 燼鐵城 | 黑岩鍛爐、煙道與熔渣溝 | [Blender](emberforge.blend) |
| 風穗城 | 風車、穀田與石屋街坊 | [Blender](windharvest.blend) |
| 白崖港 | 白堊港池、石棧橋與燈塔 | [Blender](whitecliff.blend) |
| 鹽鏡城 | 鹽湖階池與鹽倉穹頂 | [Blender](saltmirror.blend) |
| 赭階城 | 紅砂岩石台、階梯與跨谷橋 | [Blender](ochrestep.blend) |

各城均保留十個 `facility` 根節點與不可互動的 `scenery` 街坊。住宅先避開設施、岩壁與文化地標再配置；樹木避開功能建築與地標。階台建築按完整占地抬高並補基座。正式城鎮只有 GameView 提供的設施可互動；圖鑑預覽不發送遊戲指令。十六城均可旅行；其他十二城目前只開放城門與住宿，文化專屬遊戲內容仍待完成。

## 大地圖

依[世界地理契約](../../../docs/01_world/worldbuilding.md#四國十六城與海陸配置)，各文化一座主堡與三座小城。四國位於一片連續大陸，雲華與薩菲爾間為雲星大湖；沿岸道路與湖上航線分開建模。城市縮景保留整城布局、城牆與街坊，主堡寬度 26、小城 20 個美術單位；每座城的建築採約 18,000 三角面減面目標，地基、階台、街道與城垣另保留原始結構。地表使用少於 24,000 頂點的裁切三角網格，呈現各區坡地、支脈與山谷，微細節沿用 UV 材質。

開圖預設聚焦玩家所在地；選城聚焦附近，左鍵拖曳巡覽、右鍵旋轉、滾輪縮放。「全圖總覽」查看大陸、內陸湖與十六城，「回到所在地」恢復區域視野。鏡頭參數記於 atlas.json 的 camera。

[world.blend](world.blend) 與 [world.glb](world.glb) 包含海面、立體陸塊、連續山脊、雪地、森林、河流、沙地、城市縮景與道路。地表採精簡網格搭配 [UV 顏色與法線材質](materials.md)，海岸使用連續輪廓，岩層紋理與地表微細節不靠增加幾何。東方雲華、西方奧瑞恩、北方維爾冬、南方薩菲爾。城市的 `cityKey` 根節點供射線選取與名稱投影使用；UI 文字不烘焙到模型。

[atlas.json](atlas.json) 是美術布局來源，列出模型引用、名稱、文化、城市視覺座標與道路折點。十六城均帶正式 `cityId`，使用世界節點 ID；旅行拓樸由 `content-source/world-network.ts` 與雲華作者資料提供。遊戲旅行選項仍由 `city.neighbours` 與 `city.travelModes` 決定，不根據本圖的距離或道路標記推算。

## 重建與檢查

使用 Blender 背景模式執行 [build-geography.py](../../../scripts/blender/build-geography.py)，產生十五座城池與大地圖的 `.blend`、`.glb`、`.png`。可在 `--` 後列指定城市 key（例如 `qingcen`）；城市完成後，以另一個 Blender 背景程序執行 `-- world`，避免從目前開啟的同一份 `.blend` 匯入自身。只更新路面可用 `-- paving qingcen chengpu`：會重開對應原始場景、更新單一不重疊路面，再輸出模型與渲染圖；赤帆驛的路面與專屬街區共用材質，因此指定 `paving redsail` 會重建整座城。雲京仍由 [build-town.py](../../../scripts/blender/build-town.py) 重建；新建模腳本共用其中的建築基礎函式；大地圖由 [world-surface.py](../../../scripts/blender/world-surface.py) 處理，舊的大色塊與錐體山脈建模已移除。

模型輸出後，以 Blender `--background --python-exit-code 1 --python scripts/blender/verify-clearance.py` 執行[幾何交叉檢查](../../../scripts/blender/verify-clearance.py)。它檢查十六城的獨立建築與外部景物，以及大地圖城市和地形、道路、水道、樹木的交叉；同棟建築的結構接合不算穿模。結果與受檢 `.blend`／`.glb` 的 SHA-256 寫入 `geometry-clearance.json`，修改模型後必須重新檢查。

`npm run verify:geography` 驗證上述結果與模型雜湊一致，並檢查模型各自不同、十種地標、街坊、世界城市標記與全部正式路線一致，並檢查連通陸地與封閉湖岸。`npm run verify:atlas` 使用隔離桌面存檔查看十六城，檢查預覽不改動進度，並實際抵達全部十六城、跨湖與跨國、重載存檔及驗證地標射線選取。
