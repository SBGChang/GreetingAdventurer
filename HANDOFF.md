# 實作接手文件（Implementation Handoff）

> 給下一位接手者(人或 AI)。設計已定稿、地基與核心模組已實作且驗證通過;剩下的是**整合(串接)+ 補齊模組 + UI**。

## 現況(B.5 接線硬化 + Wave C 第一段 composition 骨架;tsc 乾淨、全部測試通過)

**已完成、且 `tsc` 乾淨 + 單元測試實跑通過:**

| 區塊 | 路徑 | 狀態 |
|---|---|---|
| 共用核心契約 | `src/contracts/core/` | ✅ 手寫 |
| 20 個模組公開契約 | `src/contracts/<module>/` | ✅ |
| kernel | `src/kernel/`(DeterministicRng、RuntimeIdGenerator、Scheduler、TransactionRunner) | ✅ + 測試 |
| data-runtime | `src/data-runtime/`(content 載入、Registry、窄化 Reader、驗證、ResolverRegistry、§7.1 kernels) | ✅ + 測試 |
| 核心 7 模組 | `src/modules/{character,inventory,progression,map,dungeon,combat,team}/` | ✅ 各含 state/system/queries/fixtures/*.test/public;7/7 測試通過 |
| composition 骨架 | `src/app/composition/`(GameState、訊息聯集、ExecutionOrderManifest、ModuleRegistry 啟動驗證、kernel↔模組 router) | ✅ + 測試 |

**驗證指令:**
```bash
npm install
npm run typecheck              # tsc --noEmit,目前 0 錯誤
npx tsx scripts/verify-modules.ts   # kernel + data-runtime + 7 模組 + composition + 交易接線,目前全過
```

## 待辦(依建議順序)

### 1. 整合 / 串接 —— `src/app/composition/`

**已完成:**
- `state.ts`:`GameState`(core + 7 slices)、`GameScheduledJob`、`SLICE_OWNER`、`applyMutation`(拒絕寫 `core` 與未註冊 Slice)。
- `messages.ts`:`GameCommand` / `GameInternalCommand` / `GameDomainEvent` 聯集 + 路由表。`GAME_COMMAND_ENTRY` 是**完整** `Record<GameCommandType, …>`,新增指令卻沒指定入口會被 tsc 擋下;入口是模組或 Workflow,不可兼有(§5.1)。
- `manifest.ts`:`ExecutionOrderManifest`(§6.2 相位 + 事件訂閱綁定)+ §5.2 啟動驗證。
- `registry.ts` + `composition.test.ts`:啟動驗證(重複/缺少 Handler、Slice owner、Manifest 綁定)。
- `router.ts` + `transaction.test.ts`:kernel `TransactionRunner` ↔ 真實模組 Handler 的接線,含參數順序/回傳形狀/Slice 歸屬三種差異的收斂。
- **kernel 補洞**:`TransactionRunner` 原本把模組回傳的 `scheduledJobs` 直接丟掉(沒有模組排得了 Job)。現在 `SliceMutation` 帶 `scheduledJobs`/`cancelledJobIds`/`kernelRequests`,Runner 累積後於提交時經注入的 `applyScheduling` 落地,`kernelRequests` 則回傳給呼叫者於提交後執行。

**仍待做:**
- **注入真實 ports**(目前只有各模組 fixture stub):id allocator ← kernel `RuntimeIdGenerator` + `core.nextRuntimeSequence`;RNG ← kernel `DeterministicRng` + `rngContext`;跨模組 Query ← 各模組 `createXxxQuery`;resolvers ← data-runtime `ResolverRegistry`(§7.1 kernels + `params`);definition readers ← data-runtime 窄化 Reader。
- **Game Command / Job 的 root 路由**:`router.ts` 目前只做 Internal Command 與 Event;Game Command 與 Job 的 root handler 分派待補。
- **雲華 `content/*.json`**:把 `docs/03_content/yunhua/yunhua_content.data.mjs`(含 `firstMapLayouts`/`firstMapConfigs`)轉成引擎 content pack JSON,對齊各 Definition Schema。
- **NewGameBootstrapper**(§1.1)與**無頭 runner**:bootstrap 新遊戲 → 腳本化跑「進城→下地城→一場戰鬥→結算→成長」→ golden 重播測試(同 seed+指令→同結果)。

### 1b. Wave B 宣告但未實作的 Handler(整合時浮現的真實缺口)

`ModuleContract` 宣告 ≠ 有實作。路由到這些型別會**明確報錯**(不是靜默成功),清單見 `router.ts` 的 `PENDING_INTERNAL_COMMANDS`:

| 模組 | 未實作的 Internal Command |
|---|---|
| inventory | `ApplyQuestItemLifecycle`、`ReleaseExpiredQuestCargo`、`ConsumeBookForLearning`、`TransformCraftingItems`、`ConsumeCuisineIngredients`、`ConsumeCombatSequenceRetrySupply` |
| team | `StartTimedCityAction`、`StartChildStudyPlan`、`CreateNpcTeam`、`OpenPlayerTravelInteraction`、`CompletePlayerTravelSegmentWithoutEvent`、`MarkPlayerTravelInteractionAwaitingCombat`、`CompletePlayerTravelInteraction`、`AssignNpcMemberFreeAction`、`RecordTeamWorkSettlementValue`、`AttachQuestTemporaryMember` |

另有 Game Command 未實作:inventory 的 `unequipItem`/`useItem`/`splitStack` 與四筆 encumbrance 指令、progression 的 `learnFromBook`/`startTeaching`、team 的 `chooseCityFreeAction`/`dismissMember`;Job 未實作:team 的 `freeActionDue`/`nonPlayerMemberCityFreeDayTick`。Subscriber 未實作:combat 全部 5 筆、team 全部 6 筆、dungeon 的 combat-sequence 相關 4 筆(這三組的 `subscriptionHandlerIds` 已清空以符合事實)。

### 2. 補齊其餘模組(可平行發包,一模組一 worker,寫自己 `src/modules/<name>/`,禁止再分包)
economy、city、quest、social、crafting、distribution、world、npc-behavior,以及純服務 statistics / combat-power / gathering(後三者可能是無 State 純函式,放 `src/domain-services/`)。

### 3. Wave C:UI + Electron
Vite+React app、GameSession adapter、Projection/ViewModel、核心畫面(城市/地牢/戰鬥/角色)、Electron 打包 + 存檔平台。

## 各模組作者回報、需在整合時收斂的 TODO / 決策點

> **已於 B.5 修掉**(見下節):rejection 型別分裂、判別鍵三分裂、六條跨模組 payload 不匹配、
> `AdvanceWorldToDay` 偽命令、combat `maxMana` 佔位、`StartReturnFromDungeon` payload、
> `EntitySourceRef`(本來就已含 `ContentEventInstanceId`,原記載過期)。

**仍待處理:**
- **注入 context bag**:各模組定義了本地 port 型別(如 `CharacterHandlerContext`、`InventoryDeps`、`DungeonContext`、`MapHandlerContext`、`CombatHandlerContext`、`TeamHandlerContext`);composition 要提供具體實作。
- **character / combat 的拒絕分類**(B.5 只轉了 dungeon):兩者仍以「回傳未變 slice」表示前置條件不符。character 的 21 個 no-op **多數是真正冪等**(程式自己註解「冪等」),只有 `handleCreatePartnerFamilyLink` 的硬條件(自我求婚、同性、未成年、已有配偶)是真拒絕;combat 的 16 個需逐點判讀。這是**逐點語意判斷**,不能用批次改寫。型別已備妥:改用 `ModuleOutcome<TSlice>`,照 `modules/dungeon/system.ts` 的 `accept()`/`reject()` 樣板。
- **combat**:`CombatDefinitionReader` 缺 `getControlResistanceProfile`(Boss 控制抗性沒接);CombatRule 目前用固定 `COMBAT_RULE_ID` 常數,應由 world/map 來源綁定;偵測到的「詳細戰鬥用數值 resolver」以 `CombatResolverPort` 實現(非 `contracts/combat-power` 的聚合服務)。
- **team**:`enterAdventureMap` 目前本地鑄 `MapInstanceId`(應由 map 模組擁有);`TeamQuery` 只有 `getPlayerControlledCharacterId`(無 `getPlayerCharacterId`)。
- **dungeon**:`NpcDungeonRunView` 目前含 `rngContext`(doc §4 要求 Query 不公開;`getNpcProgress` 是遮蔽版)。
- **map**:`ProtectMapContent` 不發事件(union 無此事件);`MapContentResolver`/`SpawnDraft` 是發明的本地 port(依 §7.1 慣例)。
- **progression**:`ProgressionModuleState = ProgressionState & { grantLedger, dailyUsage }`(採集冪等帳本 + 每日計數;§2.5 概念上每日計數屬 social/city,待確認歸屬)。
- **文件衝突(已裁決,待回寫文件)**:`11_combat_module.md` §432 說 combat 送 `ResolvePlayerMapContent`,`03_dungeon_module.md` §288/§310 說 dungeon 訂閱 `CombatEncounterResolved` 後送。該命令必填 `distributionId`(屬 Dungeon Session,combat 取不到),故**裁定由 dungeon 發送**,已實作 `handleCombatEncounterResolved`。

## B.5 接線硬化(已完成)

問題:所有 Internal Command / DomainEvent 都以 `TransactionMessageDraft` 的 `unknown` 跨模組傳遞,
`tsc` 看不見 payload 不匹配,各模組測試又只用自己的 stub —— 六條跨模組訊息實際上是斷的。

已做:
1. **訊息判別欄統一為 `type`**(規範寫在 `contracts/core/messages.ts`)。Game Command 用 camelCase,
   Internal Command 與 Domain Event 用 PascalCase。`kind` 保留給**領域模型**變體(`ItemLocation.kind`、
   `CombatEncounterSource.kind`),兩者不得混用。
2. **補齊訊息 union**:character / progression 契約原本沒有 `*InternalCommand` / `*DomainEvent` 聯集宣告。
3. **外送命令改引用接收模組契約的真實型別**(`DungeonOutboundInternalCommand`、
   `CombatOutboundInternalCommand`、team 的 `StartNpcDungeonRunPayload`)。發送端與接收端從此由編譯器保證。
4. **`ModuleOutcome<TSlice>`** 進 `contracts/core`,inventory/map/team 的三份重複宣告收斂到它;dungeon 由
   no-op 改為顯式拒絕。**Subscriber 仍回 `ModuleResult`**(已發生事實不可拒絕,§7.2 rule 6)。
5. **`ModuleResult.kernelRequests`**:世界日由 Kernel 獨占寫入,模組不得指使 world 模組推進。
   dungeon 跨午夜改走此通道(doc §140/§385 的「呼叫核心」在純函式 Handler 下的正確表達)。

## 慣例(務必遵守)
- **訊息判別欄**:每個 Command / Event payload 必帶 `type` 字面值欄位(Game Command camelCase,
  Internal Command 與 Event PascalCase)。跨模組外送命令**引用接收模組契約的型別**,不得自行複寫欄位。
- **Handler 回傳**:可拒絕的 Handler(Game/Internal Command、Job root)回 `ModuleOutcome<TSlice>`;
  Event Subscriber 回 `ModuleResult<TSlice>`。不得用「回傳未變 slice」表示拒絕。
- **branded ID 家族**:`DefinitionId<K>` / `RuntimeId<K>` / `EphemeralId<K>` / `TemplateLocalId<K>` + registry brands(`ModuleId`/`WorkflowId`/`ResolverId`/`SchemaId`…),定義在 `contracts/core`。無泛型 `GameId`。
- **公式 = 程式形狀 + Data 調校**:用 `13_data_runtime.md` §7.1 的通用 kernel(`logisticCurve`/`weightedLinearProduct`/`monotonicAdjust`/`thresholdTable`)+ `params`;**禁止** expression DSL 或資料夾帶可執行腳本。
- **決定論可重播**:handler 純函式;RNG 只走注入的 cursor;無 `Math.random`/`Date.now`/I/O。
- **解耦**:模組只依賴 `contracts/`;跨模組走公開 Command/Event/Query,不 deep-import 他模組實作/State。
- **Yunhua-only v1;不新增機制**(新機制屬另立的擴充功能)。

## 專案事實
- Repo:本目錄;Node v24 + TypeScript;`node_modules` 已 gitignore。
- Remote:`origin` → github.com/SBGChang/GreetingAdventurer;**直接 commit 到 `main`**;commit message 收尾加 `Co-Authored-By: Claude Opus 4.8`。**`git add -A` 前先 `git status`。**
- 設計文件入口:`README.md`、`docs/00_core/`、`docs/00_core/architecture/00_shared_contracts.md` + `12/13/…`、`docs/review/`(設計複審決策紀錄)。
- 雲華內容 HTML 產生:`node build_yunhua_content_html.mjs`。
