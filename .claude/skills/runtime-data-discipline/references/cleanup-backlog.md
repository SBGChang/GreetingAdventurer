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

### A1. Effect ID 被直接當成 Status ID　`未開始`

- 位置：`src/modules/character/system.ts:700`
- 現況：`const statusId = effectId as unknown as CharacterStatusInstance['statusId'];`
- 缺口：**沒有 Effect → Status 的對照資料**。這不是轉型寫錯，是契約缺一層對照。
- 需要：`EffectDefinition` 增加 `statusId`（或獨立的對照 Definition kind）→ Reader getter →
  Content Pack 填資料 → 移除轉型。屬規範 §7 十步流程。
- 風險：目前若 Effect ID 與 Status ID 恰好不同命名空間，會在執行期查不到 Status 而靜默失效。

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

### F1. Bring-up Bootstrap 使用固定值　`未開始`

- 位置：`src/app/composition/bootstrap.ts`
- 現況：固定 archetype、HP／MP 100/50、性別、站位。檔案自身註解已聲明它不是正式
  `NewGameBootstrapper`。
- 依規範 §13：它必須移出正式路徑，且正式 Bootstrap 不得退回它。

### F2.〔本次稽核新增，不在原文 §16〕模組 `public.ts` 對外再匯出 fixtures　`未開始`

- 位置：
  - `src/modules/dungeon/public.ts:55`
  - `src/modules/inventory/public.ts:46`
  - `src/modules/map/public.ts:81`
  - `src/modules/team/public.ts:106`
- 問題：`public.ts` 是模組的**正式對外面**。從它再匯出 `createFixtureState` / `FIXTURE` 等，
  等於讓正式 Composition 有辦法引用 fixture——規範 §13 明訂「只要正式程式**可以**引用，
  就視為違反」，不需要真的用到。
- 需要：fixtures 改由獨立測試入口匯出，`public.ts` 只保留正式面。

### F3.〔本次稽核新增，不在原文 §16〕`session-fixture.ts` 位於正式 composition 目錄　`未開始`

- 位置：`src/app/composition/session-fixture.ts`
- 問題：規範 §13 明確點名 `session-fixture.ts` 不得出現在正式依賴圖，且測試 Fixture 必須
  **使用獨立目錄**。目前它就住在 `src/app/composition/`，與 `session.ts`、`router.ts` 同層。
- 需要：移到獨立測試目錄，並在 production dependency graph 檢查中禁止此路徑。

### F4. 正式 Content Pack／Composition Root／NewGameBootstrapper 尚未建立　`未開始`

- 現況：沒有任何 content-pack JSON；沒有 `ResolverRegistration`；`GameSession` 每次執行都要外部
  傳入 `ContextAssembler`，而目前只有測試 fixture assembler。
- 這是 §8、§11、§13 的總前提：在它完成前，正式 Runtime 實際上**還沒有**可用的資料來源。

---

## G. 自動門禁尚未建立　`未開始`

規範 §14 要求 CI 執行的檢查，目前存在的只有：TypeScript 型別檢查、Module Registry 驗證
（`scripts/verify-modules.ts`，R15 已補上「宣告 vs 實際 dispatch」交叉驗證）、內容驗證
（`scripts/verify-content.mjs`）、契約重複 ratchet。

尚缺的掃描（每一項都能擋下本清單裡的一整類問題，價值高）：

- 硬編碼 Definition／Resolver／Rule ID 掃描 → 擋 C1
- 跨語意 ID 強制轉型掃描（`as unknown as` 於正式路徑）→ 擋 A1
- 正式 Handler 的資料 fallback 掃描（`?? <數值>`）→ 擋 C2、C5
- Production dependency graph／Fixture import 禁止檢查 → 擋 F1～F3
- 缺少資料時必須失敗的負向測試
- 替換 Content Pack 後行為確實改變的測試

**建議優先做 dependency graph 與 fixture import 檢查**：它是唯一能自動防止 F 類問題復發的門禁，
而 F 類問題（正式路徑碰到測試資料）是最難用人工 review 抓到的——因為它不會讓任何測試失敗。
