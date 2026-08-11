# 實作接手文件（Implementation Handoff）

> 給下一位接手者(人或 AI)。設計已定稿、地基與核心模組已實作且驗證通過;剩下的是**整合(串接)+ 補齊模組 + UI**。

## 現況(Wave C:composition 骨架 + root 路由 + 引擎 Session;tsc 乾淨、全部測試通過)

**已完成、且 `tsc` 乾淨 + 單元測試實跑通過:**

| 區塊 | 路徑 | 狀態 |
|---|---|---|
| 共用核心契約 | `src/contracts/core/` | ✅ 手寫 |
| 20 個模組公開契約 | `src/contracts/<module>/` | ✅ |
| kernel | `src/kernel/`(DeterministicRng、RuntimeIdGenerator、Scheduler、TransactionRunner) | ✅ + 測試 |
| data-runtime | `src/data-runtime/`(content 載入、Registry、窄化 Reader、驗證、ResolverRegistry、§7.1 kernels) | ✅ + 測試 |
| 核心 7 模組 | `src/modules/{character,inventory,progression,map,dungeon,combat,team}/` | ✅ 各含 state/system/queries/fixtures/*.test/public;7/7 測試通過 |
| composition 骨架 | `src/app/composition/`(GameState、訊息聯集、ExecutionOrderManifest、ModuleRegistry 啟動驗證、kernel↔模組 router) | ✅ + 測試 |
| root 路由 | `router.ts`:`routeGameCommand`(envelope→模組 Handler,teamId 取自 `actorTeamId`)、`routeJob`(job.type→Handler);Workflow 入口/未實作皆明確報錯(`PENDING_GAME_COMMANDS`/`PENDING_JOBS`) | ✅ + 測試 |
| context 工廠 | `router.ts`:`ModuleContextFactory = (state)=>ModuleContexts`,每次 dispatch 以當前 workingState 重建(query 工廠皆吃快照,§3.1 rule 3) | ✅ |
| 引擎 Session | `session.ts`:§7.2 交易私有 runtime-id cursor(seed 自 `core.nextRuntimeSequence`、鑄 envelope+entity+job ID、提交寫回)、真實 kernel id/rng ports;內容以注入的 `ContextAssembler` 供給 | ✅ + 測試(跨模組級聯 openDungeonDoor→OpenMapDoor→真 map slice) |

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

**已完成(本段新增):**
- **Game Command / Job 的 root 路由**:見上表 root 路由列。
- **引擎 Session 的 id/rng 骨幹**:見上表引擎 Session 列。id allocator ← kernel `RuntimeIdGenerator` + 交易私有 cursor(§7.2);RNG 產生器 ← kernel `DeterministicRng`。這半邊(內容無關的組裝)已真接並有跨模組級聯測試佐證。
- **內容 Reader adapter(全 7 模組完成)**:`src/app/content/reader-adapter.ts`(通用 `domainDefinitionView` / `narrowedDomainReader`)+ 每個模組一個 `createXxxDefinitionReader(registry)`(dungeon/inventory/character/team/map/progression/combat)。dungeon 有端到端證(真 reader 換進 Session 跑 openDungeonDoor);其餘 6 個有單元證(header 投影 + 特殊 getter + 跨 kind 防呆)。各模組 `XXX_DEFINITION_KINDS` 是內容作者標 `kind` 的唯一參照。特殊 getter:map `getGatheringMapView`(投影)、progression `listSocialMasteryBenefits`(list)、combat `getSkillView`(客製 mapView;是否與 progression skill 共用定義有 TODO 待內容軌敲定)。
- **內容 Resolver adapter 骨架**:`src/app/content/resolver-adapter.ts`(`runResolver` + `resolverContext`)+ `resolvers.ts` 兩個資料調校樣板(`logisticRollResolver`→boolean 含 RNG、`weightedProductResolver`→number)。樣板從 params 定義讀調校量(重用 reader adapter)、餵 §7.1 kernel、遵守 RNG 紀律回 `nextRngCursor`。已證:決定性、registry 未註冊/重複防呆、port bridge 微樣板。**待做**:具體 resolver(招募/傷害/自然死亡…)與各模組 `ResolverPort` bridge —— 這是**逐 resolver 的公式/領域工作**,與內容軌並行(非機械填);combat `resolvePower` 因 resolverId 在 input 內是最乾淨的 bridge 樣板。

**仍待做(其中「真實內容 ports」卡在下方內容軌):**
- **內容 ports(卡在內容)**:definition readers、resolvers(內嵌公式,§7.1 kernels + `params`)、跨模組 Query 的**真實** adapter(如 `DungeonMapPort`、combat formation 快照)、以及 world/derived-statistics 未實作模組供給的 `WorldQuery`/`TeamWorldReader`/carry-capacity。目前 Session 以注入的 `ContextAssembler` 供給,測試用 fixture 內容;換上真內容只換 Assembler,不動 Session。
- **雲華 content pack(內容軌,見 §2 下的新任務)**:無任何 content-pack JSON;無任何 `ResolverRegistration`;各模組 `XxxDefinitionReader` 是手寫領域介面,要真接需寫 registry→窄化 reader→領域 reader 的 adapter。把 `docs/03_content/yunhua/yunhua_content.data.mjs`(含 `firstMapLayouts`/`firstMapConfigs`)轉成引擎 content pack JSON,對齊各 Definition Schema,並以 data-runtime `createDefinitionReader` / `createResolverRegistry` 建 reader/resolver。**這是全 vertical slice 的關鍵路徑,可平行發包(依 domain 切)。**
- **NewGameBootstrapper**(§1.1)與**全 vertical slice**:bootstrap 新遊戲 → 腳本化跑「進城→下地城→一場戰鬥→結算→成長」→ golden 重播測試(同 seed+指令→同結果)。骨幹(Session)已就緒,卡在上面的內容 ports。
- **引擎 Session 尚未涵蓋(刻意,已記於 `session.ts`)**:Internal Command / Event Draft 物化為帶 CommandId/EventId 的完整信封(Outbox/存檔平台需要,與 State 正確性無關);§7.1 `invocationRngContext` 完整推導(現為簡化版)。

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
  `scripts/check-contract-duplicates.ts` 現在**雙重守門**:型別名稱重複(基準線 9,須歸零)+ discriminant
  宣告碰撞(基準線空——不同名卻同 `type: 'X'` 宣告會失敗;union 引用 `({ type } & Owner)` 不算)。
- **跨模組互動只走命令+事件,不設同步回傳 Port**:需要另一模組「做事並取結果」時,發 Internal Command →
  對方發 Domain Event → 訂閱回收。同步回傳會繞過 Transaction Runner／Slice 所有權／回滾(見 dungeon↔
  combat-sequence 的 §2.3;曾有的 `CombatSequenceHostPort.resolveNext()` 已移除)。
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
