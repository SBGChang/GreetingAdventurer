# 戰鬥場景與呈現契約

角色改採序列美術的外觀、武器與播放規格見 [2D 角色序列美術](sprites/README.md)。正式與測試入口共用 `CombatScreen`，依同一份美術對應資料選取手繪序列或既有 3D；不能由測試入口指定另一套 renderer。兩種呈現共用正式引擎的技能與結果契約，已登記 2D 素材的角色身分、怪物與全部配招武器組必須相容才使用序列。

[models.json](models.json) 將正式雲華二十種怪物 ID 與隊伍代表對應到八種程序造型、配色及比例。[CombatModels.ts](../../CombatModels.ts) 只建立美術，不決定敵人種類、數量、能力或獎勵。這份資料供探索代表模型與未相容的 3D 戰鬥呈現使用；正式 2D 角色與怪物身分對應在 [序列綁定](sprites/bindings.json)，角色造型選擇與實際武器組共同決定圖集。

[CombatScreen.tsx](../../CombatScreen.tsx) 以透明疊層呈現戰鬥，包含壓暗／毛玻璃、平台、人物及 HUD。原場景由入口持有；戰鬥不卸載、複製或截圖替換原模型。背景停止操作及動畫，尺寸改變才補畫，戰後直接恢復。同一契約適用地牢、城市與大地圖；入口不能偷偷以水道插畫代替其他所在地。它接收 `CombatView`、明確的 `CombatEnvironment`（地圖／城市／道路 ID）、本地化查詢與命令回呼，正式 App 與測試入口共用。技能與目標送往正式命令，拒絕顯示原因並保持原狀；接受後逐段呈現 `CombatFrame`，不得自行擲骰或計算傷害。數字表示該動作前後的生命差值，可能包含反擊或生命成本，不宣稱是逐個效果的原始傷害。

[CombatHud.tsx](../../CombatHud.tsx) 共用於 2D 與 3D 戰鬥。右側 CTB 單一直列僅顯示頭像框與條，最多十八個、無捲動條；依正式 `CombatView.order` 移位。命中時先呈現 `CombatActionResolved.ctbAfterAction` 的實值（包含技能效果、反擊與自身行動延遲），動作結束後以 `layout.json.countdownMs`（450ms）線性插值至已提交的下一回合 CTB；歸零後才亮起下一位。回填條使用 `recoveryMs`（180ms），HP／MP 保持命中時更新。已就緒同批不另演倒扣，失能者不扣、戰鬥結束不再推進。這是已提交排程的快速時間流逝演出，不按真實秒數推進引擎，不推算下一回合；等待玩家指令時完全暫停。條長為 `min(currentCtb / 100, 1)`，超過 100 的完整數值保留在懸停資訊與輔助讀取。死亡者移出，勝負確定收起；減少動態效果偏好停用補間與呼吸光。

我方與敵方各有放大的 3×3 隊伍盤，並排佔據下方；右側 CTB 欄獨立使用全高，格位來自參戰者 row／col，前排朝向畫面中央。空位不生成單位資訊；實際占位顯示頭像及 HP／MP 美術條，MP 上限為 0 時保持空條。自動補位後若與屍體原格重合，優先呈現存活者。角色身上不放名牌或資源條。[CombatCommandMenu.tsx](../../CombatCommandMenu.tsx) 在每次我方決策點自動彈出，壓暗戰場；三列武器徽框各配三格技能框，均使用 [commands](commands/prompts.json) 內建 image_gen 原生透明素材。關閉後可點目前我方隊伍格重開，支援 Enter／Space 與選單內 Tab 循環。`CombatView.weaponSets` 由當前角色 loadout 投影，`isActive` 取自 Combatant 的 activeWeaponSetId；技能同時帶入 weaponSetId，不依名稱反推。成本、資源可用性與 validTargetIds 由正式 Query／共用 targeting resolver 投影，不在 renderer 算射程或以 actionKind 猜敵我。選技能後收起選單，只高亮合法角色與隊伍格；點選即送出正式命令，最後仍由 Handler 驗證。防禦側鈕篩選可用 guard 招式，休息執行正式命令；道具使用的交易尚未閉合，因此該圖示明確停用，不送出無效果的消耗指令。Esc 取消目標或關閉選單；接受命令後關閉並鎖定至演出完成，拒絕保留選取與原因。HUD 尺寸及面板位置由 `layout.json` 的 `squads`／`delay` 提供；共用地面向左上配置，底部隊伍盤與右側 CTB 欄不重疊，800px 視窗仍等比例完整顯示。

[頭框](hud/portrait-frame.png) 保留原生透明通道；[條圖集](hud/gauges.png) 為洋紅 RGB 底，載入時透過 `sprite-compositor.ts` 色鍵合成並快取，不覆寫來源圖片。[layout.json](hud/layout.json) 定義舞台、來源裁切與補間時間；頭像從已對應的待機序列裁切，未提供肖像的 3D 單位顯示名称首字，不套用其他角色樣本。素材由內建 image_gen 製作，[prompts.json](hud/prompts.json) 保存完整提示詞。

順序來自正式 Query；同時到 0 且已排入 `readyQueue` 的單位沿用已提交順序。尚未排定的同值者只作穩定列示，不保證未來回合的抽籤結果，也不消費 RNG。滿编測試入口含超過 100 的假 CTB，可檢查條長封頂及原始數值不封頂，並非額外戰鬥判定。

[CombatArena.tsx](../../CombatArena.tsx) 按正式 row／col 排列雙方角色及自動補位，呈現行動圈、通用出手、受擊與倒地。雙方站在同一塊連續地面，與 2D 共用地塊圖與環境對應，renderer 保持透明；鏡頭、格位間距及動作時間由 [presentation.json](presentation.json) 提供。地塊是按環境選擇的戰鬥前景；背景沿用交戰所在地的原模型。離場釋放 renderer、幾何、材質與貼圖。

`game-facade.ts` 在每筆玩家命令與已提交的敵方回合之間投影 `combatFrames`，包含前後快照及本次 `CombatActionResolved` 的技能、效果結果與排程前 CTB 端點；拒絕交易不公開演出事實。資料不寫入 `GameState` 或存檔。正式 App 立即儲存已提交結果，但等演出與胜敗確認完成才切換到下一個 GameView。恢復存檔只恢復已提交結果，不重播或重新結算。

房內遭遇用編組第一名怪物作代表；戰鬥內則使用全部正式參戰者。點選代表模型與房間內容卡使用同一命令；代表只在當前房間出現，勝利後依內容狀態移除。目前没有巡邏、追擊或場景即時攻防。

`npx tsx scripts/verify-combat-presentation.ts` 驗證模型覆蓋、提交快照連續性、敵方回合、拒絕、勝利及世界日期。隔離 Electron 測試透過模型點擊進入戰鬥、選技能／目標、觀看結果與返回原地，並確認不讀寫玩家存檔。

[CombatGround.tsx](../../CombatGround.tsx) 將一張俯視地塊圖投影成有薄厚度的連續戰場，雙方站在同一地面；`stage.json` 定義尺寸、斜向深度與緊湊隊形間距，不修改 row／col 或引擎射程。[地塊目錄](grounds/catalog.json) 明確對應九張地圖、十六座城市及全部道路 ID，使用濕石、泥草、城市鋪石、岩地及沙地五張原畫，搭配所在地色調。新增所在地必須補上綁定；缺少資料或圖片不得默認套用水道。正式入口從 `GameView` 取得交戰地點；測試入口的 `scene=dungeon|city|world`、`map`、`city`、`route` 參數轉成相同環境契約，背景與地塊一起選取。圖片載入完成才開放操作。[提示詞](grounds/prompts.json) 保存內建 image_gen 的五張原畫提示詞。容量入口的查看背景鈕只控制疊層顯示，不生成戰果。正式主城／大地圖遭遇種類的開放仍以 Runtime 與 CURRENT_STATUS 為準。

測試入口加 `weapons=alternate` 可將實際持有的環首刀移至第二組並配置引環斬，用於驗證跨組施放與目前武器標示。第一組因武器移走而不能施放；其他空技能欄保持空白，不捏造已學技能。
