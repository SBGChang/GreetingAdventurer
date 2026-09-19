# 四文化設施接待美術

正式呈現資料為 [facilities.json](../../../content/presentation/facilities.json)。以文化 ID＋設施種類選取名稱、招待員、四表情、台詞、外框與詳情底板取樣範圍、文字安全區及返回圖示。名稱同時由 `content-source/facility-names.ts` 供內容編譯器輸出至正式語言包，城內標籤和接待畫面不另存另一套名稱。

左側為招待員立繪、對話、服務分類及確認選項；右側為連續清單及詳情。城門保留 3D 地圖，旅行方式及出發確認移至招待員對話區。選取只檢視，確認沿用原正式命令；切換設施時清除上位招待員的情緒。招待員目前是呈現角色，不是隊員、世界人口或可招募 NPC。

## 素材

- 招待員對話使用四文化九宮格邊框：[雲華](yunhua-dialogue.png)、[維爾冬](vildun-dialogue.png)、[奧瑞恩](aurelien-dialogue.png)、[薩菲爾](safir-dialogue.png)，由內建 imagegen 製作，見[提示詞及來源](dialogue-prompts.json)。`theme.dialogue` 提供邊框、切線與配色；中央以純色填滿，角飾固定、邊條重複，上方角標連向立繪。正文與補充資訊分隔，內容可按住拖曳、滾輪或鍵盤捲動；換招待員或對話時回到頂端，無可見捲軸。

- 安居牙行的整頁外框先採九宮格延伸試作：[yunhua-home-frame.png](yunhua-home-frame.png)，由內建 imagegen 繪製，見[完整提示詞](home-frame-prompt.json)。`theme.frame` 設定取樣切線、固定框寬及中央單色；四角等比保留，四周保留雲紋、花枝與雕飾，水平／垂直邊條以 round 分段重複，中央不用原圖而以純色填滿。原圖 1254 × 1254，可延伸至不同寬高；不另外輸出大型背景。其他設施外框及右側詳情圖仍使用既有圖集，尚未轉為九宮格。

新製可延伸底板的中央區不得放花紋、漸層或景物，四角及邊條仍可保留豐富花紋；獨立角飾不伸縮，邊條花紋以可銜接的單元重複鋪設，避免把整張背景做雙向拉伸。

- 清單、分類及確認共用 [service-button.png](service-button.png)，採無文化圖樣的薄金屬邊按鈕；Hover、選取、按壓與停用狀態由介面呈現。標題使用 [facility-plaque.png](facility-plaque.png) 匾額，置中跨在視窗上緣、一半突出；返回圖示移至右上框角。清單不分頁、不顯示捲軸；按住上下拖曳捲動，短按檢視項目，拖曳結束不觸發選取，也支援滾輪與鍵盤。兩張新圖均由內建 imagegen 製作，[完整提示詞與來源](controls-prompt.json)。

- 右側詳情使用獨立的四文化圖集：[雲華](yunhua-details.png)、[維爾冬](vildun-details.png)、[奧瑞恩](aurelien-details.png)、[薩菲爾](safir-details.png)。每張 5 欄 × 2 列，各有十種職務美術；`theme.detail` 定義圖集、實際取樣範圍及文字安全區，完整呈現原圖，不以泛白外框充當詳情底板。地契、委託、書籍、兵器等裝飾留在邊缘；長文字在安全區內獨立捲動。由內建 imagegen 生成，見[提示詞與原始來源](detail-prompts.json)。
- 四張 `*-panels.png` 各有十種不同職務的面板，木材、織物、金屬、紙張與文化裝飾均獨立繪製。原圖的列高並非完全等分，正式目錄的 `theme.rect` 記錄人工核對後的歸一化取樣範圍，以 CSS 取圖，不存重複裁切副本。
- 四十張 `文化-設施.png` 各是同一角色的四表情：左上一般、右上開心、左下生氣、右下沮喪。背景與服飾保持一致；介面只載入當前所需圖片。表情圖集必須是完整不透明的 RGB PNG，不能讓人物或背景隨表情淡出。
- [return-icons.png](return-icons.png) 為四文化的純圖示返回鍵，左上雲華、右上維爾冬、左下奧瑞恩、右下薩菲爾。
- 全部由內建 `image_gen.imagegen` 生成：[角色與面板完整提示詞](prompts.json)、[返回圖示提示詞](return-prompt.json)、[立繪不透明修正提示詞與來源](repair-prompts.json)。透明瑕疵以原圖為參考重新繪製，未以程式修改圖片通道。原始輸出保留於 Codex generated_images；正式引用均為本資料夾的專案檔案。

## 表情契約

| 呈現事件 | 表情 | 資料依據 |
|---|---|---|
| 進入、檢視可辦理項目 | 一般 | 目前設施與選取項目 |
| 正式命令成功 | 開心 | CommandOutcome.accepted |
| 正式命令拒絕 | 生氣 | 正式 rejectionCode；不自行推定交易成功 |
| 條件不足、清單為空、招募失敗、執行例外 | 沮喪 | disabled／查詢空結果／招募結果／明確錯誤 |

表情只影響畫面，不改價格、好感、命令條件或存檔。實際操作訊息附在台詞下方；純裝飾台詞不能代替正式錯誤。文字均提供繁中與英文。

固定接待人以設施 ID 維持身分，`host.name` 提供人工校訂的繁中與英文完整姓名。英文使用固定拼寫，不沿用中文字；職稱由設施職務呈現，不與本名拼在一起。隨機姓名庫保留與固定接待人重疊的完整姓名。

## 設施與接待人

| 文化 | 設施 | 招待員 | 圖片 |
|---|---|---|---|
| yunhua | 聽雨客棧 | 蘇晚晴 | [四表情](yunhua-inn.png) |
| yunhua | 流霞酒肆 | 杜寬 | [四表情](yunhua-tavern.png) |
| yunhua | 雲行會館 | 沈知微 | [四表情](yunhua-adventurerGuild.png) |
| yunhua | 百草行 | 陶秀蘭 | [四表情](yunhua-itemShop.png) |
| yunhua | 青鐵坊 | 魏成 | [四表情](yunhua-equipmentShop.png) |
| yunhua | 定鋒武館 | 霍英 | [四表情](yunhua-trainingGround.png) |
| yunhua | 竹簡書齋 | 顧文禮 | [四表情](yunhua-bookstore.png) |
| yunhua | 山行驛 | 陸進 | [四表情](yunhua-adventureCheckpoint.png) |
| yunhua | 雲關署 | 秦岳 | [四表情](yunhua-cityGate.png) |
| yunhua | 安居牙行 | 許惠如 | [四表情](yunhua-home.png) |
| vildun | 爐火長屋 | 艾妲 | [四表情](vildun-inn.png) |
| vildun | 鹿角蜜酒堂 | 托爾姆 | [四表情](vildun-tavern.png) |
| vildun | 誓獵集會 | 芙蕾雅 | [四表情](vildun-adventurerGuild.png) |
| vildun | 霜苔藥舍 | 艾文 | [四表情](vildun-itemShop.png) |
| vildun | 沼鐵鍛屋 | 布倫 | [四表情](vildun-equipmentShop.png) |
| vildun | 盾環試場 | 西格妮 | [四表情](vildun-trainingGround.png) |
| vildun | 樺皮卷屋 | 烏爾文 | [四表情](vildun-bookstore.png) |
| vildun | 獵徑哨所 | 莉芙 | [四表情](vildun-adventureCheckpoint.png) |
| vildun | 霜門守所 | 哈肯 | [四表情](vildun-cityGate.png) |
| vildun | 長屋置產所 | 茉伊菈 | [四表情](vildun-home.png) |
| aurelien | 白鐘旅舍 | 艾莉絲 | [四表情](aurelien-inn.png) |
| aurelien | 金杯酒館 | 加斯頓 | [四表情](aurelien-tavern.png) |
| aurelien | 巡誓公所 | 瑟蕾娜 | [四表情](aurelien-adventurerGuild.png) |
| aurelien | 聖露藥房 | 盧西安 | [四表情](aurelien-itemShop.png) |
| aurelien | 獅徽軍械坊 | 瑪爾塔 | [四表情](aurelien-equipmentShop.png) |
| aurelien | 銀槍教場 | 羅蘭 | [四表情](aurelien-trainingGround.png) |
| aurelien | 晨光書庫 | 貝雅特麗絲 | [四表情](aurelien-bookstore.png) |
| aurelien | 巡境驛站 | 賽德里克 | [四表情](aurelien-adventureCheckpoint.png) |
| aurelien | 獅門衛署 | 伊蓮娜 | [四表情](aurelien-cityGate.png) |
| aurelien | 白石地契所 | 奧斯溫 | [四表情](aurelien-home.png) |
| safir | 月泉客舍 | 蕾拉 | [四表情](safir-inn.png) |
| safir | 琥珀茶坊 | 法里德 | [四表情](safir-tavern.png) |
| safir | 星路商盟 | 娜迪雅 | [四表情](safir-adventurerGuild.png) |
| safir | 綠洲香藥鋪 | 薩米爾 | [四表情](safir-itemShop.png) |
| safir | 赤銅兵作 | 札赫拉 | [四表情](safir-equipmentShop.png) |
| safir | 沙環演武庭 | 卡里姆 | [四表情](safir-trainingGround.png) |
| safir | 星井抄書院 | 雅斯敏 | [四表情](safir-bookstore.png) |
| safir | 駝鈴行驛 | 塔里克 | [四表情](safir-adventureCheckpoint.png) |
| safir | 日輪門署 | 瑪莉卡 | [四表情](safir-cityGate.png) |
| safir | 綠庭契坊 | 伊德里斯 | [四表情](safir-home.png) |

## 檢視與驗證

`/facility-art.html` 是隔離假資料入口，使用正式 `FacilityReception` 和 `FacilityChoices`，注入 12 筆清單項目供拖曳檢查，可切換全部文化、設施及四種表情，不建立遊戲引擎或讀寫存檔。可用 `?facility=safir-adventurerGuild` 直接指定。素材登錄不會自動開放尚缺正式玩法的服務。

`node scripts/verify-reception-art.mjs` 已納入 `npm run verify`，驗證 40 個文化／職務配對、獨立圖片、名稱與台詞完整性。`npx electron scripts/electron-reception-smoke.cjs` 檢查 160 次表情切換、圖片載入、左右版面及存檔隔離。`scripts/electron-facilities-smoke.cjs` 驗證正式購買、出售、住宿、接取及操作結果表情。

`npx electron scripts/electron-facility-scroll-smoke.cjs` 以真實滑鼠輸入檢查 800／1440 視窗拖曳比例、防誤選、短按、滾輪、鍵盤到達末項及失焦停止。
