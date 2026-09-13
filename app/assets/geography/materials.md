# 大地圖 UV 材質

草地、雪岩、砂地與岩層 Base Color 使用內建 `image_gen.imagegen` 生成，原圖保存在本資料夾；法線由 Blender 材質烘焙產生。地形的真實高低差由網格提供。

- [meadow-albedo.png](meadow-albedo.png)、[meadow-normal.png](meadow-normal.png)：草地與濕潤土壤。
- [snow-albedo.png](snow-albedo.png)、[snow-normal.png](snow-normal.png)：雪岩與冰霜。
- [sand-albedo.png](sand-albedo.png)、[sand-normal.png](sand-normal.png)：砂地與紅岩碎屑。
- [rock-albedo.png](rock-albedo.png)、[rock-normal.png](rock-normal.png)：風化岩層。

[world-surface.py](../../../scripts/blender/world-surface.py) 建立一片連續陸地與封閉內陸湖，指定可重複的 UV，再烘焙法線與封裝貼圖。地表每 35 個美術單位重複，岩層每 17 單位重複；不拉伸整幅大陸貼圖。Blender 與 GLB 均封裝所需材質，遊戲端使用各向異性取樣及陰影。

城市縮景取用完整城牆、街坊與水道；先更新匯入物件的父層變換，排除攝影棚地板，再合併小於畫面像素的建築接縫並減面。地基、階台、街道與城垣不做這種合併及減面，以保留結構輪廓。城市完整方形占地周圍預留平地；外部道路、水道與樹木避開城池範圍。統計見 [world-mesh-info.json](world-mesh-info.json)。

## 生成提示詞

### meadow

Production seamless tileable square game terrain ALBEDO texture, flat orthographic overhead, edge to edge material only, finely hand-painted realistic tactile fantasy strategy game style. Even diffuse lighting, no cast shadows, no perspective, no buildings, no trees standing up, no roads, no text, no frame, no horizon. Small-scale rich surface detail, natural irregular mottled distribution without directional streaks. Muted olive and sage meadow grass mixed with worn warm earth, tiny pebbles, moss patches and low sparse vegetation, predominantly earthy olive green.

### snow

Production seamless tileable square game terrain ALBEDO texture, flat orthographic overhead, edge to edge material only, finely hand-painted realistic tactile fantasy strategy game style. Even diffuse lighting, no cast shadows, no perspective, no buildings, no trees standing up, no roads, no text, no frame, no horizon. Small-scale rich surface detail, natural irregular mottled distribution without directional streaks. Alpine pale snow over blue-grey slate, icy granular crust, fine fractured frost, scattered dark grey rock patches, predominantly cool off-white and grey.

### sand

Production seamless tileable square game terrain ALBEDO texture, flat orthographic overhead, edge to edge material only, finely hand-painted realistic tactile fantasy strategy game style. Even diffuse lighting, no cast shadows, no perspective, no buildings, no trees standing up, no roads, no text, no frame, no horizon. Small-scale rich surface detail, natural irregular mottled distribution without directional streaks. Warm ochre desert sandstone ground, fine sand grains, subtle dunes ripples, tiny reddish rock fragments and dry cracked earth patches, predominantly warm light tan and terracotta.

### rock

Use case: stylized-concept. A single seamless tileable game material texture, square, flat orthographic material scan of weathered alpine granite cliff rock. Fine layered slate-grey and warm grey strata, fractured mineral seams, sediment bands, tiny quartz flecks, deep narrow cracks, subtle ochre lichen deposits in crevices. Rich intricately hand-painted PBR albedo quality suited to a premium fantasy strategy map viewed close up. Dense small and medium-scale varied detail over entire surface. Neutral even diffuse lighting, no directional shadow, no perspective, no terrain silhouette, no peaks, no snow, no borders, no text, no grid, no interface, no objects. A continuous natural rock surface filling the canvas edge to edge, tileable edges.

## 十六城近景工藝材質

[town-craft-atlas.png](town-craft-atlas.png) 由內建 `image_gen.imagegen` 生成，實際尺寸 1254 × 1254，四象限為雪松木板、石灰岩砌石、青綠釉瓦、藍灰板岩。[town-craft-normal.png](town-craft-normal.png) 是 Blender 烘焙的 2048 × 2048 切線法線。各材質以 `Craft UV` 明確綁定象限並留內縮邊界，避免不同材質滲色；城牆小石塊取樣單一石面，地坪與階台使用每 5 個美術單位重複的世界座標投影，垂直面依面向投影，避免拉伸。微細節來自貼圖，屋簷、窗框、雕刻屋脊、棚架、門板、器皿與欄杆使用實際幾何。

多翼住宅合併後，薩菲爾每棟保留最多約 10,000 個三角面，雲京每棟約 18,000 個，減去圓頂、瓦作與小型雕拱過密的細分，保留 UV 與材質；公共建築不套用這個住宅上限。赤帆整城維持原有 420,000 三角面預算。

世界縮景合併共面路面、移除小於 0.2 個世界美術單位的孤立零件，並清除材質未使用的 UV 層；城內模型保留生活細節。單一 GLB 輸出限制在 100 MiB 內，整張世界地圖維持 450,000 三角面上限，均以實際輸出驗證。

生成提示詞（內建工具；圖集由預設生成位置複製到本目錄）：

> Production game architecture material BASE COLOR texture atlas, square high resolution 3072x3072, for finely crafted fixed-camera fantasy town models. Four exactly equal square quadrants, no gutters or margins, strictly orthographic flat surface, no lighting shadows, no perspective, no text or labels. TOP LEFT: warm weathered cedar boards running vertically, fine restrained wood grain, many thin boards (about 12 across), subtle aged joinery, no protruding hardware. TOP RIGHT: refined pale warm limestone ashlar wall in staggered courses, finely chiseled faces and narrow recessed mortar, small surface pores, about 10 stones across. BOTTOM LEFT: elegant muted jade green glazed Chinese curved roof tiles in close regular rows, fine ceramic patina and subtle streaks, 12 tiles across, no entire roofs or buildings. BOTTOM RIGHT: blue charcoal slate roofing shingles in staggered rows, restrained mineral grain and softly worn edges, 12 tiles across. Hand-painted realistic fantasy RPG material quality, sophisticated restrained colors, microdetails for close viewing, evenly lit diffuse albedo, each quadrant is a coherent tiling material patch without objects.

## 赤帆驛建築材質

城市採固定街區配置：中央水池廣場保留環行空間與座椅，西側布匹、陶器、蔬果與商旅貨運四種攤位組成市集，商店與酒館接在市集北側；公會、書店與旅館位於北區，工坊與訓練設施位於西南。東南住宅區以四條巷道串連十六棟住宅，主路連接北城門、廣場及南側，橫街連接商業區與住宅區。住宅使用明確地塊，不再以空位散置；建模與匯出後的交叉檢查逐一涵蓋四個攤位根節點。此配置僅套用赤帆驛，世界縮景從同一份模型重建。

赤帆驛使用獨立的 [redsail-detail.py](../../../scripts/blender/redsail-detail.py) 建模細節，先以 Blender 執行 `build-geography.py -- redsail`，再以另一個 Blender 背景程序執行 `build-geography.py -- world` 重建世界縮景。薩菲爾四城共用雕拱、釉面、退台住宅與生活物件語彙；赤帆驛的固定街區與大型攤位另有獨立配置。修改共用薩菲爾細節時需重建 `starwell redsail saltmirror ochrestep`，再重建世界縮景。圓頂採 64 個徑向分段、24 層弧面與獨立金屬肋線；拱門窗、陽台欄杆、簷口、階梯、露台、城垛及棕櫚分葉由實際幾何呈現，市集帆布採 16 × 12 分段垂墜曲面。

[redsail-material-atlas.png](redsail-material-atlas.png) 由內建 `image_gen.imagegen` 生成，實際尺寸 1254 × 1254。四象限依序為左上砂岩、右上藍釉星紋磚、左下刺繡红帆布、右下石灰抹面。`Craft UV` 明確綁定材質，保留象限內縮邊界；布面連續展開，砌體按面投影。圖集封裝在 `.blend` 與 `.glb` 中。四種材質使用各自的粗糙度，圖集搭配 Blender 烘焙的 [2048px 法線圖](redsail-craft-normal.png)。城牆由錯縫砌石、牆帽與分層垛口構成，角樓使用弧形砌石與釉磚飾帶；單塊石材的 UV 取樣單一石面，避免將整片磚牆縮在一塊石頭上。側牆補上立體拱窗與簷下托座。包含商業陳列、住宅與公共生活細節的完整城鎮三角面上限為 420,000，世界縮景仍使用既有減面流程。

[redsail-life.py](../../../scripts/blender/redsail-life.py) 定義近景用途與生活細節：布商使用高脊紅棚和垂掛地毯，陶器攤使用靛藍拱棚與分層陶器架，蔬果攤使用亞麻斜棚與波浪垂邊，貨運攤使用半覆木架、板車與貨箱。赤帆十六棟住家混用風塔、織戶、退台與陶工屋，以及 [town-neighbourhoods.py](../../../scripts/blender/town-neighbourhoods.py) 的開放院落、騎樓、附翼與工作院結構；分為四組錯落的家庭街坊。晾衣、屏風窗、露台階梯、盆栽、小窯、排水管及修補補充近景。公共建築各自具有屋頂客房、茶座、藏書閣、材料架或訓練平台。生活物件是靜態場景美術，不代表新增商品、製作或 NPC 行為。布面沿用圖集象限與連續 UV，陶器採帶中空口緣的旋轉剖面，木箱、車輪、棚架及井架使用實際幾何。

生成提示詞：

> Create a production game texture atlas, square 2048x2048, orthographic flat surface scans, no perspective, no cast shadows, no lettering, no objects. Precisely four equal square quadrants meeting at center without margins. TOP LEFT: warm pale honey sandstone masonry blocks with subtle hand chisel marks and narrow mortar, elegant painted realistic stylized fantasy craftsmanship. TOP RIGHT: exquisite turquoise teal glazed ceramic mosaic, small interlocking eight pointed Islamic geometric stars with muted gold fine outlines, aged glaze and subtle variation. BOTTOM LEFT: rich vermilion red woven canvas textile with fine gold repeating diamond embroidery, subtle woven fibers and faded areas, perfectly flat not folded. BOTTOM RIGHT: pale warm cream ochre plaster with subtle mottling and fine surface grain, no large cracks. All four quadrants evenly lit albedo textures, restrained fine details suitable for a high quality fixed isometric 3D desert caravan city. Material colors clear and elegant. This is an actual UV texture atlas, not a scene or presentation board.

街區近景另外使用兩張獨立 Base Color，均由內建 `image_gen.imagegen` 生成，實際尺寸各為 1254 × 1254。法線由共用 Blender 材質烘焙流程輸出 2048 × 2048；精細度來自獨立貼圖、固定 UV 比例及凹凸表現，而非將原圖放大。

- [石灰岩地坪](redsail-paving-albedo.png)／[地坪法線](redsail-paving-normal.png)：整片地坪及道路使用同一個世界座標 UV，每 6 個美術單位重複，避免道路和廣場的紋理比例斷裂。
- [細密藍釉鑲嵌](redsail-glaze-albedo.png)／[釉面法線](redsail-glaze-normal.png)：圓頂使用獨立的連續 UV，繞圓周重複兩次；立面飾帶仍使用原圖集。

地坪提示詞：
> Create one seamless tileable square game environment BASE COLOR texture of an elegant desert caravan city courtyard floor. Direct flat orthographic scan, physically even neutral diffuse light, NO perspective, NO objects, NO cast shadows, NO vignette, NO writing or borders. Weathered pale warm limestone paving slabs in staggered courses, approximately 9 to 12 slabs across the image. Narrow soft sand-filled joints, subtly chipped rounded stone edges, tiny mineral pores and delicately hand-chiseled limestone surfaces. A subtle scattering of extremely fine golden sand settles in the joints. Restrained natural ivory/beige color variation, low contrast, no giant cracks, no rough pebbles, no dirty brown patches. Refined realistic hand-painted fantasy RPG environment quality for close-up viewing, tactile and crisp fine detail. Entire square is one continuous seamlessly repeatable paving surface. Highest available detail and resolution.

釉面提示詞：
> Seamless square UV albedo material texture, full frame turquoise glazed ceramic mosaic for a refined fantasy desert city dome. Flat orthographic surface scan with completely even diffuse lighting, no shadows, perspective, borders, text, objects, or vignette. Dense small eight-point star and interlocking geometric mosaic, approximately twelve complete star motifs across the width, delicate thin warm ivory grout and occasional understated bronze tesserae. Dominantly deep teal/turquoise with elegant subtle shade variations and fine crazing glaze microtexture. Pattern must be much finer and more restrained than large bold gold ornamental lines. High detail sharp craftsmanship, realistic game-ready repeating material, readable tiny ceramic tile fragments, all over seamless geometry.
