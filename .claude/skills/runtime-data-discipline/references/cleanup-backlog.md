# 暫代行為清理清單

> 規範原文 §16 的清單，加上 2026-08-17 逐條**實地核對**的位置與缺口分析。
> 原文只列項目名稱；這裡記錄「在哪一行、為什麼還沒補、補它需要先有什麼」，讓下一個人不必重新調查。
>
> 狀態標記：`未開始` / `契約已備、待資料` / `已完成`
> 完成一項就從這裡移除，並確認對應 Capability 是否可以從 `UNAVAILABLE_CAPABILITIES` 移出。

## 核對方式

以下每一項都經 grep 實地確認過位置，不是照抄規範。核對日期 2026-08-17，基準 commit `fae26d9`。
行號會隨改動漂移，僅供定位；判斷請以符號名稱為準。

---

## A. 跨語意 ID 強制轉型

### A1. Effect ID 被直接當成 Status ID　`已完成`

- 原位置：`src/modules/character/system.ts:700`
- **結論與本清單原本的提案不同**：原本寫「`EffectDefinition` 增加 `statusId` → Reader getter →
  Content Pack 填資料」，那會把 Effect→Status 對照放進 Character。但 Character 沒有能力做那層對照
  ——它的 Reader 只有 `getStatusDefinition`，Effect 定義的擁有者是 Crafting／Combat。§12：不擁有
  這個事實的地方不得決定它。
- 實際作法：把 `ApplyFoodStatusEffects` 的 `effectIds: EffectDefinitionId[]` 改成
  `statusIds: CharacterStatusDefinitionId[]`——Handler 的註解本來就寫著「已被 Crafting 解析」，
  只是型別沒說。契約現在陳述它真正收到的東西，轉型消失，對照留在送出端。
- 待接：Crafting 模組尚未實作，屆時由它做 Effect→Status 對照。目前**沒有任何送出端**，
  代表 `handleApplyFoodStatusEffects` 也沒有測試——見下方 H1。

---

## B. 固定成功 / 未解析的流程（Dungeon）

這一組的共同形狀是：**流程走得完，但結果不是資料決定的**。規範 §5「寫死事件成功或失敗」。

### B1. 事件選項固定成功　`部分完成`

- 位置：`src/modules/dungeon/system.ts:580` 附近（`resolveDungeonInteraction`）
- 已完成：R8 #4 已驗 `optionId` 合法性（不合法即拒絕，不動 Session）。
- 仍缺：**選項的資料化結果**（分支效果／戰鬥／物品）。合法選項目前一律回報 success。
- 需要：內容軌提供選項效果表 + `resolveContentEventOption` Resolver。

### B2. 固定陷阱尚未解析　`未開始`

- 位置：`src/modules/dungeon/system.ts:409`
- 現況：玩家進入 armed 固定陷阱房間時，不送 `ResolveMapTrap`、不套用陷阱效果。
- 需要：同一交易 required `ResolveMapTrap` + 陷阱效果命令；trapResolverId 已在
  `DungeonInteractionRuleDefinition` 中，資料側可用。

### B3. Control／Kidnap 未先解決守衛　`未開始`

- 位置：`src/modules/dungeon/system.ts:552`
- 現況：只走「直接可取 Chest」的簡化成功路徑。

### B4. NPC Dungeon 怪物內容固定視為成功　`未開始`

- 位置：`src/modules/dungeon/system.ts:683`、`:781`
- 現況：遇到怪物內容時不建立／不推進 Combat Sequence，已扣點的內容直接記成成功。
- 需要：required `StartCombatSequence(source=dungeonSweep)` + 保存 `combatSequenceId` +
  `ResolveNextCombatSequenceChallenge` 推進。

### B5. NPC Run 結算未建立實際戰利品　`未開始`

- 位置：`src/modules/dungeon/system.ts` 結算段
- 現況：只要求關閉 Distribution 收集，未依 `appliedResults` 建立戰利品。
- 相依：Distribution 模組（見 D1）。

---

## C. 寫死的可調數值

### C0.〔已完成〕Dungeon 的 `resolver:dungeon-default`

- 原位置：`src/modules/dungeon/system.ts` 的 `defaultResolverId()`，三個呼叫點。
- 根因不是隨手寫死：`MapContentResolution` 只有 `resolverId` 一種形狀，但內容有三種解析方式，
  其中「怪物組被一場戰鬥解決」根本沒有內容 Resolver 跑過。型別逼 Handler 交出它沒有的東西。
- 作法：`MapContentResolution` 改成依「由什麼解析」判別的聯集
  （`contentResolver` / `npcTargetResolver` / `combatEncounter`）；`MapContentInstance` 補上
  玩家側的 `playerResolverId`（與早就存在的 `npcResolverId` 對稱），Dungeon 經
  `DungeonMapPort.getContentResolverId` 取得，缺資料時回 `contentResolverMissing` typed rejection。
  戰鬥收斂路徑（Subscriber 不能拒絕）改帶事件本來就有的 `encounterId`。
- 順帶移除 `MapContentResolved.resolver`——它是 `resolution` 某個欄位的複本，聯集化後
  combatEncounter 那一支沒有 resolver 可複製。
- **仍未完成**：`outcome: 'success'` 依然是寫死的（見 B1／B3）。resolverId 缺資料時現在會拒絕，
  等於在資料補齊前擋住了那條偽裝成功的路徑，但 B 類本身沒有因此解決。

### C1. `combat-rule-standard` 寫死於 Combat　`未開始`

- 位置：`src/modules/combat/system.ts:455`
  `const COMBAT_RULE_ID = 'combat-rule-standard' as Parameters<...>[0];`
  使用點：`:444`（opening CTB）、`:1101`（戰鬥休息）
- 注意：這個常數**同時**存在於 `src/modules/combat/fixtures.ts:123`——production 自己複製了一份
  fixture 的 ID 字串。兩處都要處理。
- 需要：CombatRule 應由 EncounterGroup 或 Encounter 來源綁定，由 reader 依該 ID 取，
  而不是 Handler 自己選一個。

### C2. 戰鬥休息固定恢復 5 HP／MP　`未開始`

- 位置：`src/modules/combat/system.ts:1107` `const RESTORE = 5;`
- 需要：CombatRule（或休息專屬 Rule）提供回復量。

### C3. 控制抗性 Definition 未被 Runtime 使用　`未開始`

- 位置：`src/modules/combat/system.ts:548` 的 `resistedCtbIncrease()`——目前直接 `return raw`。
- 缺口：`CombatDefinitionReader` **沒有** `getControlResistanceProfile` getter。
  契約側 `controlResistanceProfileId` 已存在（`src/contracts/combat/index.ts:86`）。
- 需要：補 reader getter → 以 `ctbIncreaseMultiplier` 折算 → 套
  `maxExternalCtbIncreaseBeforeOwnAction` 上限。

### C4. 臨時角色性別固定 female　`未開始`

- 位置：`src/modules/character/system.ts:591-593`（註解已自承是佔位）
- 另有：`src/app/composition/bootstrap.ts:81` `input.leaderSex ?? 'female'`（屬 F1 Bring-up 範圍）
- 需要：角色生成規則提供性別分布（規範 §3「角色生成池、性別分布」）。

### C5. 年齡經驗倍率固定 1　`未開始`

- 位置：`src/modules/progression/system.ts:285-293`
- 現況：TODO 明載「第一版主路徑以 1.0 計」。
- 需要：讀 Character 年齡階段 + `AgeExperienceRule.stages`。

### C6. Team 休息時間寫在 Handler　`未開始`

- 位置：`src/modules/team/system.ts:101` `export const HOME_YEAR_REST_DAYS = 365;`
- 判斷：365 天是**內容**（住家年度休息的時長），不是結構不變量——改它會改變遊戲節奏。
- 需要：由 Rule Definition 提供。

---

## D. 缺模組 / 缺契約

### D1. Distribution 模組不存在　`未開始`

- 現況：Dungeon 已送 `StartAssetDistribution` / `FinalizeAssetDistributionCollection` /
  `AppendAssetDistributionResult`，但 Composition 沒有 Distribution Slice、模組實作，
  `INTERNAL_COMMAND_OWNER` 也沒有這三個命令。
- 影響：**玩家探索無法端到端完成**。單元測試只驗「有產生 Draft」，沒送進正式 Router。
- 依規範 §10：在 Distribution 閉合前，「玩家進入地牢」不得列為可用 Capability。

### D2. Skill 的 `weaponRequirementIds` 缺裝備端契約　`契約已備、待資料`

- 現況：`CombatSkillDefinitionView.weaponRequirementIds` 存在
  （`src/contracts/combat/index.ts:164`，combat-power 亦有），但 `EquipmentDefinition`
  **沒有**對應的 requirement 標記欄位——裝備側沒有可比對的資料。
- 已處理：weapon-set-configuration Workflow 已驗 Definition 存在／已學會／啟動手，
  並在程式碼中明確標示這一項驗不了（不是默默略過）。
- 需要：`EquipmentDefinition` 增加由 Inventory 擁有的 requirement／tag view + 內容資料。

### D3. Combat 沒有消費 `targetResolverId`　`未開始`

- 位置：`src/contracts/combat/index.ts:150` 有欄位；`src/modules/combat/system.ts:881`、`:949`、`:968`
  的註解自承「資料化 targeting resolver 待接」。
- 現況：目標合法性只靠 hostile／heal 側別推定，不驗範圍、形狀、距離與人數上限。

---

## E. 所有權錯置

### E1. Team 自行鑄造 Map Instance ID　`未開始`

- 位置：`src/modules/team/system.ts:1059`
  `const mapId = plan.payload.mapId ?? ctx.ids.nextMapInstanceId();`
  介面宣告在 `:117`，Session 注入於 `src/app/composition/session.ts:158`。
- 違反規範 §12「只鑄造自己擁有的 Runtime ID」——`MapState.instances` 的擁有者是 Map。
- 後果：Team 可能位於 Map 模組不存在的 `MapInstanceId`（懸空引用）。
- 需要：Map instance 由 Map Bootstrap／Workflow 建立；Team 只引用 Query 取得的既存 ID；
  移除 `nextMapInstanceId`。

---

## F. Bring-up 與正式路徑未隔離

### F1. Bring-up Bootstrap 使用固定值　`已隔離；固定值仍在（依設計）`

- 現位置：`src/testing/composition/bring-up-bootstrap.ts`（原 `src/app/composition/bootstrap.ts`）
- 已完成：移出正式目錄並改名。固定 archetype／HP／MP／性別／站位**留著**——它是 bring-up 工具，
  §13 的要求是「不得被正式路徑碰到」，不是「不得有固定值」。
- 一併拆掉的陷阱：門禁原本以**檔名** `bootstrap.ts` 把它排除在四項檢查外。正式
  `NewGameBootstrapper` 最自然的落點就是這個檔名，寫上去那天會安靜地免檢——而 Bootstrap 正是
  最該受檢的地方。該 pattern 已移除，改以目錄位置排除；`bootstrap.ts` 這個檔名現在是受檢的
  （已實測：在 `src/app/composition/bootstrap.ts` 放一筆寫死 ID，門禁抓到）。
- 仍待：正式 `NewGameBootstrapper`（§1.1）本身尚未存在，見 F4。

### F2.〔本次稽核新增，不在原文 §16〕模組 `public.ts` 對外再匯出 fixtures　`已完成`

四個模組的 `public.ts` 已移除 fixtures／test runner 的再匯出，測試改直接 import
`./fixtures`。`dungeon/public.ts` 檔尾留了說明，講清楚為什麼不該加回去。

### F3.〔本次稽核新增，不在原文 §16〕`session-fixture.ts` 位於正式 composition 目錄　`已完成`

已移至 `src/testing/composition/session-fixture.ts`。門禁的 `testing/` 目錄 pattern 本來就在，
現在是**位置**保證它進不了正式依賴圖，不是「碰巧沒有正式檔 import 它」。

### F4. 正式 Content Pack／Composition Root／NewGameBootstrapper 尚未建立　`未開始`

- 現況：沒有任何 content-pack JSON；沒有 `ResolverRegistration`；`GameSession` 每次執行都要外部
  傳入 `ContextAssembler`，而目前只有測試 fixture assembler。
- 這是 §8、§11、§13 的總前提：在它完成前，正式 Runtime 實際上**還沒有**可用的資料來源。

---

## G. 自動門禁　`大部分完成`

`scripts/verify-runtime-discipline.ts`（`npm run verify:discipline`）目前全綠，涵蓋：

| 檢查 | 狀態 |
|---|---|
| Production dependency graph／Fixture import 禁止 | ✅ |
| 硬編碼 Definition／Resolver／Rule ID | ✅（此檢查**不接受豁免**——§5 沒有合法例外） |
| 跨語意強制轉型（`as unknown as`） | ✅ |
| 正式路徑的純量 fallback（`?? <數值>`／`?? '字串'`） | ✅ 豁免 6 筆，具名附理由，ratchet 只能往下 |
| 空集合預設（`?? []`／`?? {}`） | ✅ 計數式 ratchet，基準線 31 |

`npm run verify` = typecheck + discipline + modules。

**仍缺**（兩項都不是靜態掃描抓得到的，要寫測試）：

- **缺少資料時必須失敗的負向測試**。目前是型別與 Handler 邏輯保證會拒絕，沒有測試釘住。
  最該先補的是 `dungeon.*.contentResolverMissing`（C0 剛建立的拒絕路徑）。
- **替換 Content Pack 後行為確實改變的測試**。這是整份規範的總驗證，但它要等 F4
  （正式 Content Pack）才有第二份 Pack 可換。

### H1.〔新增〕`handleApplyFoodStatusEffects` 沒有任何測試

A1 改型別時發現：全 `src/` 沒有任何地方建構 `ApplyFoodStatusEffects`（Crafting 未實作），
所以這個 Handler 已註冊、可路由，但從未被執行過。屬上面「負向測試」那一項的具體案例。

---

## G. 行為資料化的形狀未補齊（一個 Func 一張表）

規則見 `SKILL.md` 的「行為的資料化：一個 Func 一張表」與 `13_data_runtime.md` §6.0。
以下是 2026-08-21 實地 grep 的結果：**設計已在 §6 寫好判別聯集，但契約側尚未落實。**

### G1. `EffectDefinition` 只有一個 id，判別聯集完全沒實作　`未開始`

- 位置：`src/contracts/character/index.ts:44`
  —— `export type EffectDefinition = Readonly<{ id: EffectDefinitionId }>;`
- `13_data_runtime.md` §6 已明列 8 個 kind（`grantItem` / `consumeActorItem` /
  `removeActorCurrency` / `applyStatus` / `grantMasteryExperience` / `startDetailedCombat` /
  `setWorldFact` / `changeCityMetric`），各自帶自己的欄位。程式側**一個都沒有**。
- 連帶後果（都是實測回報，不是推測）：
  - world 模組的戰爭後果 Effect 完全沒接：`ConflictRuleDefinition` 的
    `marketPressureEffectIds` / `eventWeightEffectIds` / `passageEffectIds` 是 `EffectDefinitionId`，
    但沒有任何可解讀的 Schema，所以 world 刻意不讀它們（改由一條尚不存在的編排 Workflow 展開）。
  - crafting 的 Effect→Status 對照（清理清單 A1）也卡在同一個缺口。
  - dungeon 的事件選項（B1）「合法選項一律回報 success」——選項的結果就是 EffectPlan，缺這層就無法解析。
- 需要：依 §6 補齊 `EffectDefinition` / `ConditionDefinition` 判別聯集、每個 kind 一個 Validator、
  kind → 執行模組的非 Partial 派發表、以及 `EffectPlan` 的產生與提交路徑。
- **這是目前擋住最多下游功能的單一缺口。**

### G2. 四個 `Record<string, …>` 袋子欄位　`未開始`

| 位置 | 欄位 | 缺的是什麼 |
|---|---|---|
| `src/contracts/combat/index.ts:421` | `CommandAllyCommand.directive: Record<string, JsonValue>` | 指揮隊友的指令種類判別聯集（HANDOFF 已記一筆） |
| `src/contracts/combat/index.ts:445` | `CombatContentResolution = Record<string, JsonValue>` | 戰鬥內容解析結果的具型別形狀 |
| `src/contracts/combat/index.ts:447` | `CombatActionResult = Record<string, JsonValue>` | 戰鬥行動結果的具型別形狀 |
| `src/contracts/crafting/index.ts:53` | `EquipmentSkillEffectRef = Record<string, unknown>` | 裝備技能效果引用（應指向 G1 的 Effect kind） |

`src/contracts/map/index.ts:294`／`:305` 的 `details?: Record<string, JsonValue>` **不在此列**：
它們是 diagnostics 的附帶說明欄位，不承載玩法行為——但若哪天有 Handler 開始依 `details` 的內容
分支，它就變成同一個病，必須立刻補成判別聯集。

---

## L. 顯示文字（本地化）欠債　`部分完成`

2026-08-30 建立本地化管線時發現並鎖住的既有缺口。

### L1. 140 筆 `nameRef` 指向不存在的文字　`契約已備、待資料`

- 位置：`content-source/yunhua/{equipment,items}.ts`、`content-source/core/economy-social-distribution.ts`
- 現象：裝備 90／道具 30／素材 19／貨幣 1 筆定義都帶 `display.nameRef`，但在本地化管線
  存在之前沒有任何地方提供文字。**這是既有欠債，不是新增的**——`YUNHUA_EQUIPMENT_DISPLAY_NAMES`
  這個 export 早就備妥了 90 筆中文名，只是沒有管線可以送出去。
- 目前作法：`scripts/lib/content-compiler.ts` 的 `TEXT_DEBT_RATCHET` 逐 kind 記錄欠債數，
  **只能減少**（增加或減少都會編譯失敗，後者要求同步下修宣告值）。新的 kind 一律不得有缺字。
- 補它需要：把既有中文名接進 `AuthoredDomain.texts`（equipment 已有現成表），
  並補英文名。補完一個 kind 就把它從 `TEXT_DEBT_RATCHET` 刪掉。
- 不影響目前 UI：城市／設施／冒險據點／行進方式的名稱都已備妥雙語，主城與世界地圖畫面完整。

### L2. `Nation/Currency/Item DisplayDefinition` 三份重複型別　`未開始`

- 位置：`src/contracts/world/index.ts`（`NationDisplayDefinition`）、
  `src/contracts/economy/index.ts`、`src/contracts/inventory/index.ts`（後者標著 PLACEHOLDER (invented)）
- 三者結構完全相同（`{ nameRef: LocalizedTextRef }`）。新增的欄位已改用 core 的共用
  `DisplayDefinition`；這三份舊的待收斂到同一個型別。

---

## M. 地牢探索迴圈　`部分完成`（2026-08-30）

### M1. DungeonMapPort ＋ 地圖實例 ＋ team.world　`已完成`

- `src/app/content/dungeon-map-port.ts`：15 個方法全實作。唯一有演算法的 `getRoomTraversal`
  走**房內 BFS**（不是曼哈頓距離）——房間可為 L／T／凹形，直線距離會穿過不屬於該房的格子。
- `new-game-bootstrap.ts`：依 `adventure-site` 為每座據點建 MapInstance（雲華 9 座），
  紅門全關、版本從 1 起算。
- `dungeon-context.ts`：`TeamWorldReader`（據點↔圖↔城市三向投影）＋ `DungeonContext` 組裝，
  規則 ID 全部從內容選出（`dungeonLoot`＋`playerAuction` 判別，不寫死 ID）。
- `contracts/dungeon`：`startPlayerExploration` / `useDungeonExit` 已加回 GameCommand union。
- 端到端證據：`src/app/content/dungeon-wiring.test.ts`（7 案），含「紅門未開時移動必須被拒」。

### M2. `MapContentPayload.mapEvent` 補上實例身分　`已完成`

- 原本只有 `contentEventDefinitionId`，但 `ContentEventInstance` 要求 `instanceId` 與
  `rngStreamId`。少了它們，`getContentEventInstance` 只能把 ContentInstanceId 硬轉成
  ContentEventInstanceId（§7 點名的跨語意轉型），rngStreamId 更是無中生有。
  已加 `eventInstanceId` / `rngStreamId` 兩欄，由 map 生成內容時鑄造。

### M3. 地圖內容生成（P4）　`已完成`

> **兩次訂正**：本項先被記為「卡在缺內容，需要內容決策」（錯），再訂正為「卡在契約缺口」（對）。
> 現已完成。留下這段是因為第一次的錯誤診斷差點把工作推給內容作者。

- **阻塞是程式側的三個未登記 kind**，不是缺內容：`culture-content-rule` / `chest-pool` /
  `map-event-pool` 沒有登記擁有模組，Content Compiler 對未登記 kind 直接報錯，
  所以作者**寫不進去**。`content-source/yunhua/maps.ts` 的註解早已記載。
- **已補**：
  * `culture-content-rule` 登記到 map 模組 ＋ `CultureContentRuleDefinition` ＋ 窄化 Reader。
  * `MapSpawnRuleDefinition.contentTier`、`MapContentDefinition.threatRank`——後者是「一般群與
    菁英群的 contentKind 都是 monsterGroup，沒有欄位分得開」這個缺口的補丁（maps.ts 早有記載）。
  * 兩筆文化池（非人類 15／人類 5），候選由 `monsters.ts` 從同一份 MONSTER_ROWS 導出，
    Tier／威脅不可能與怪物定義漂移。
  * `src/app/content/map-context.ts`：`MapContentResolver`（文化池 → Tier／威脅篩選 → 均勻抽取）
    ＋ `MapHandlerContext`；已接進 ContextAssembler。
  * Bootstrap 把實例建在版本 0，再跑**正式** `refreshMapInstance` 推到版本 1 並生成內容——
    不另寫 bootstrap 專用生成路徑，否則「開局的圖」與「刷新後的圖」會變成兩套規則。
- **實測**：九座據點，第一版三圖依 §7.4 生成 3／5+1／3+1 共 13 筆，其餘六張 0 筆（§7.4 未列＝無預算）。
  同 worldSeed 決定性；Tier I 圖只出 Tier I 候選。
- **修掉一個真缺陷**：`generateMapContent` 對同批每一格傳**同一個 cursor**，而 `SpawnDraft` 沒有
  nextCursor 欄位，於是一張圖每格都抽到同一隻怪。Resolver 改用契約傳進來的 `index` 區分同批抽取。
- 仍未生成：`chest` / `mapEvent` / `kidnap` / `control`——**九張圖都沒有為它們編列槽位**
  （設計來源沒有給數量），所以不是接線缺口。`chest-pool` / `map-event-pool` 兩個 kind 同理仍未登記。

### M4. 仍為 pending 的兩個子 port　`未開始`

- `dungeon.resolvers`（陷阱判定）：雲華九圖 `fixedTraps` 全空，玩家路徑碰不到。
  接它要 `dungeon:trap` shape ＋ params 內容 ＋ core pack 補上
  `resolver:dungeon.trap.standard` 的 binding（目前 `resolverBindings` 沒有這一筆，
  而 `dungeon-interaction-rule` 已經引用了它——既有的「宣告 ≠ 實作」）。
- `distribution.resolvers`（競拍出價）：只在收集關閉後的拍賣輪用到；地牢開場的
  `StartAssetDistribution` 已能正常建立 collecting。

---

## N. P1 敵方 AI ＋ 反擊條件　`程式已完成，卡在怪物技能未授權`

### N1. AI／反擊 Resolver shape　`已完成`

- `src/app/content/combat-ai-resolvers.ts`：兩個 shape，五個既有 resolverId 全部綁上。
  * `combat-ai:policy-driven` —— 三個 AI Policy 共用（工作單要求：「若你發現需要三份不同程式，
    先回報，那代表 shape 切錯了」）。選招／選目標策略是**封閉 tagged 值**，程式只實作有限幾種。
  * `combat-counter:incoming-action` —— 兩個反擊條件共用的述詞。
- 參數在 `content-source/core/combat-ai-params.ts`（內容），程式側沒有任何「if 是雜兵就…」。
  射程過濾重用 `filterByReach`；沒有合法行動回 `undefined`，不回假招式（工作單兩個陷阱）。
- 測試 `combat-ai-resolvers.test.ts`：真實 pack、決定性、目標全滅時回 undefined、
  反擊述詞依動作種類與距離判定。

### N2. 怪物技能　`已解決（共通招）`

> **2026-08-30 專案擁有者決定**：所有怪物共用一招「撞擊」，不先授權 41 招。

- `combat-skill.core.monster-slam`（core 擁有，四國共用）＋ `combat-effect.core.deal-physical-damage`。
  20 隻怪的 `skillIds` 全部指向它，`0 → 20` 隻有技能。
- 整條鏈都已綁定：目標 `resolver:combat.target-single-hostile`、
  傷害威力 `resolver:combat.damage-power.physical`。所以怪物現在真的選得到行動也打得出傷害。
- **為什麼這一筆 dealDamage 可以住 core**（`combat-rules.ts` 上方明文「此檔不寫 dealDamage」）：
  那條的理由是「技能威力沒有欄位可放，所以每招需要自己的 damage rule」。撞擊是**基準攻擊**，
  沒有倍率修正，威力就是通道本身的值——引用 core 既有的 physical 規則是完整的，不是少填倍率。
  有倍率的招式仍各自需要自己的 damage rule，那條限制沒變。
- 測試已移除接線（graft），改為直接斷言「每隻怪都有技能、技能引用的定義都存在、目標 resolver 已綁」。

### N3. 41 招個別怪物技能　`未開始（不再阻塞）`

- **20 隻怪的 `skillIds` 全部是空陣列**。`content-source/yunhua/monsters.ts` 自己寫著：
  「這 20 筆怪物在 skillIds 接上之前不是可玩內容。」
- 原因不是沒資料：設計來源有 41 招怪物技能，「每一招都已經是可解析的資料（傷害通道、數值倍率、
  延遲檔、狀態效果、次數上限）」。但它們屬 `skill` kind、歸 skills domain，而現行 80 筆
  `combat-skill` **全是玩家武器線**（ring-saber / repeating-crossbow …）。作者留空是因為猜 local 名
  會讓整個 pack 編譯失敗（跨引用檢查）。
- 後果：AI shape 本身正確，但在真實 pack 上沒有招式可選，所以工作單要求的
  「真怪在真遭遇裡選得出招式」目前**證不到**。測試以 `combatDefsWithGraftedSkill()` 接一招真實
  技能證明 shape，並用專門的看門狗案例斷言「目前 0 隻怪有技能」——補完後那個案例會失敗並要求
  移除接線，不會讓缺口靜靜留著。
- 待辦：把 41 招怪物技能授權進 skills domain。**這已經不是阻塞項**——共通招「撞擊」讓戰鬥跑得起來，
  個別招式是把每隻怪的辨識度做出來（設計來源已有全部數值：傷害通道、倍率、延遲檔、狀態效果、
  次數上限）。屆時把該怪的 `skillIds` 從共通招換成自己的招式即可。
