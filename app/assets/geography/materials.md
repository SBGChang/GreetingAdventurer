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

## 赤帆驛建築材質

城市採固定街區配置：中央水池廣場保留環行空間與座椅，西側四頂紅帆組成市集，商店與酒館接在市集北側；公會、書店與旅館位於北區，工坊與訓練設施位於西南。東南住宅區以四條巷道串連十六棟住宅，主路連接北城門、廣場及南側，橫街連接商業區與住宅區。住宅使用明確地塊，不再以空位散置；建模與匯出後的交叉檢查涵蓋獨立市集根節點。此配置僅套用赤帆驛，世界縮景從同一份模型重建。

赤帆驛使用獨立的 [redsail-detail.py](../../../scripts/blender/redsail-detail.py) 建模細節，先以 Blender 執行 `build-geography.py -- redsail`，再以另一個 Blender 背景程序執行 `build-geography.py -- world` 重建世界縮景。其他十五座城不套用這份建築樣式。圓頂採 64 個徑向分段、24 層弧面與獨立金屬肋線；拱門窗、陽台欄杆、簷口、階梯、露台、城垛及棕櫚分葉由實際幾何呈現，市集帆布採 16 × 12 分段垂墜曲面。

[redsail-material-atlas.png](redsail-material-atlas.png) 由內建 `image_gen.imagegen` 生成，實際尺寸 1254 × 1254。四象限依序為左上砂岩、右上藍釉星紋磚、左下刺繡红帆布、右下石灰抹面。`Craft UV` 明確綁定材質，保留象限內縮邊界；布面連續展開，砌體按面投影。圖集封裝在 `.blend` 與 `.glb` 中。四種材質使用各自的粗糙度，圖集搭配 Blender 烘焙的 [2048px 法線圖](redsail-craft-normal.png)。城牆由錯縫砌石、牆帽與分層垛口構成，角樓使用弧形砌石與釉磚飾帶；單塊石材的 UV 取樣單一石面，避免將整片磚牆縮在一塊石頭上。側牆補上立體拱窗與簷下托座。完整城鎮三角面上限為 360,000，世界縮景仍使用既有減面流程。

生成提示詞：

> Create a production game texture atlas, square 2048x2048, orthographic flat surface scans, no perspective, no cast shadows, no lettering, no objects. Precisely four equal square quadrants meeting at center without margins. TOP LEFT: warm pale honey sandstone masonry blocks with subtle hand chisel marks and narrow mortar, elegant painted realistic stylized fantasy craftsmanship. TOP RIGHT: exquisite turquoise teal glazed ceramic mosaic, small interlocking eight pointed Islamic geometric stars with muted gold fine outlines, aged glaze and subtle variation. BOTTOM LEFT: rich vermilion red woven canvas textile with fine gold repeating diamond embroidery, subtle woven fibers and faded areas, perfectly flat not folded. BOTTOM RIGHT: pale warm cream ochre plaster with subtle mottling and fine surface grain, no large cracks. All four quadrants evenly lit albedo textures, restrained fine details suitable for a high quality fixed isometric 3D desert caravan city. Material colors clear and elegant. This is an actual UV texture atlas, not a scene or presentation board.

街區近景另外使用兩張獨立 Base Color，均由內建 `image_gen.imagegen` 生成，實際尺寸各為 1254 × 1254。法線由共用 Blender 材質烘焙流程輸出 2048 × 2048；精細度來自獨立貼圖、固定 UV 比例及凹凸表現，而非將原圖放大。

- [石灰岩地坪](redsail-paving-albedo.png)／[地坪法線](redsail-paving-normal.png)：整片地坪及道路使用同一個世界座標 UV，每 6 個美術單位重複，避免道路和廣場的紋理比例斷裂。
- [細密藍釉鑲嵌](redsail-glaze-albedo.png)／[釉面法線](redsail-glaze-normal.png)：圓頂使用獨立的連續 UV，繞圓周重複兩次；立面飾帶仍使用原圖集。

地坪提示詞：
> Create one seamless tileable square game environment BASE COLOR texture of an elegant desert caravan city courtyard floor. Direct flat orthographic scan, physically even neutral diffuse light, NO perspective, NO objects, NO cast shadows, NO vignette, NO writing or borders. Weathered pale warm limestone paving slabs in staggered courses, approximately 9 to 12 slabs across the image. Narrow soft sand-filled joints, subtly chipped rounded stone edges, tiny mineral pores and delicately hand-chiseled limestone surfaces. A subtle scattering of extremely fine golden sand settles in the joints. Restrained natural ivory/beige color variation, low contrast, no giant cracks, no rough pebbles, no dirty brown patches. Refined realistic hand-painted fantasy RPG environment quality for close-up viewing, tactile and crisp fine detail. Entire square is one continuous seamlessly repeatable paving surface. Highest available detail and resolution.

釉面提示詞：
> Seamless square UV albedo material texture, full frame turquoise glazed ceramic mosaic for a refined fantasy desert city dome. Flat orthographic surface scan with completely even diffuse lighting, no shadows, perspective, borders, text, objects, or vignette. Dense small eight-point star and interlocking geometric mosaic, approximately twelve complete star motifs across the width, delicate thin warm ivory grout and occasional understated bronze tesserae. Dominantly deep teal/turquoise with elegant subtle shade variations and fine crazing glaze microtexture. Pattern must be much finer and more restrained than large bold gold ornamental lines. High detail sharp craftsmanship, realistic game-ready repeating material, readable tiny ceramic tile fragments, all over seamless geometry.
