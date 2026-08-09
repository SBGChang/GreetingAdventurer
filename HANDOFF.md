# 實作接手文件（Implementation Handoff）

> 給下一位接手者(人或 AI)。設計已定稿、地基與核心模組已實作且驗證通過;剩下的是**整合(串接)+ 補齊模組 + UI**。

## 現況(截至 commit `b2c1ff0`,已 push origin/main)

**已完成、且 `tsc` 乾淨 + 單元測試實跑通過:**

| 區塊 | 路徑 | 狀態 |
|---|---|---|
| 共用核心契約 | `src/contracts/core/` | ✅ 手寫 |
| 20 個模組公開契約 | `src/contracts/<module>/` | ✅ |
| kernel | `src/kernel/`(DeterministicRng、RuntimeIdGenerator、Scheduler、TransactionRunner) | ✅ + 測試 |
| data-runtime | `src/data-runtime/`(content 載入、Registry、窄化 Reader、驗證、ResolverRegistry、§7.1 kernels) | ✅ + 測試 |
| 核心 7 模組 | `src/modules/{character,inventory,progression,map,dungeon,combat,team}/` | ✅ 各含 state/system/queries/fixtures/*.test/public;7/7 測試通過 |

**驗證指令:**
```bash
npm install
npm run typecheck              # tsc --noEmit,目前 0 錯誤
npx tsx scripts/verify-modules.ts   # 跑 7 個模組單元測試,目前全過
```

## 待辦(依建議順序)

### 1. 整合 / 串接(最優先,讓它整條跑起來)—— 建 `src/app/composition/` + runner
- **`GameState`** = `{ core: CoreState<GameScheduledJob> } & { character: CharacterState; inventory: …; …7 slices }`(未實作模組先放最小 stub slice)。
- **ModuleRegistry**:註冊各模組 contract、handler、query、slice owner、migration。
- **ExecutionOrderManifest**:`jobTypeOrderByPhase` + `eventSubscriptionsByType`(見 `12_engine_runtime.md` §5.2)。
- **注入各模組需要的 ports**(它們都吃一個 context bag):
  - id allocator ← kernel `RuntimeIdGenerator`
  - RNG ← kernel `DeterministicRng` + 每次呼叫的 `rngContext`
  - 跨模組 Query ports ← 各模組 `createXxxQuery`
  - resolvers ← data-runtime `ResolverRegistry`(公式用 §7.1 kernels + `params`)
- **Handler 結果 adapter**:契約的 `ModuleResult<Slice>` **沒有 rejection 變體**。各模組各自處理了拒絕(inventory/team/map/combat 回傳 `{ok,result}|{ok,rejection}`;character/dungeon/progression 用「回傳未變 slice」表示 no-op)。**composition 要統一成一種**,並轉成 kernel TransactionRunner 的 accepted/rejected。
- **雲華 `content/*.json`**:把 `docs/03_content/yunhua/yunhua_content.data.mjs`(含 `firstMapLayouts`/`firstMapConfigs`)轉成引擎 content pack JSON,對齊各 Definition Schema。
- **無頭 runner**:bootstrap 新遊戲 → 腳本化跑「進城→下地城→一場戰鬥→結算→成長」→ 斷言跑完 + golden 重播測試(同 seed+指令→同結果)。

### 2. 補齊其餘模組(可平行發包,一模組一 worker,寫自己 `src/modules/<name>/`,禁止再分包)
economy、city、quest、social、crafting、distribution、world、npc-behavior,以及純服務 statistics / combat-power / gathering(後三者可能是無 State 純函式,放 `src/domain-services/`)。

### 3. Wave C:UI + Electron
Vite+React app、GameSession adapter、Projection/ViewModel、核心畫面(城市/地牢/戰鬥/角色)、Electron 打包 + 存檔平台。

## 各模組作者回報、需在整合時收斂的 TODO / 決策點
- **Rejection 模型不一致**(見上,最重要)。
- **注入 context bag**:各模組定義了本地 port 型別(如 `CharacterHandlerContext`、`InventoryDeps`、`DungeonContext`、`MapHandlerContext`、`CombatHandlerContext`、`TeamHandlerContext`);composition 要提供具體實作。
- **character 事件缺 `type` 判別欄**:作者加了本地 `CharacterDomainEvent` union;事件路由要對齊。
- **core 缺口**:`EntitySourceRef` 未含 `ContentEventInstanceId`(character/status 來源用得到)。
- **combat**:`CombatDefinitionReader` 缺 `getControlResistanceProfile`(Boss 控制抗性沒接);`CombatantState` 未快照 `maxMana`(結算寫回用 placeholder);CombatRule 目前用固定 `COMBAT_RULE_ID` 常數,應由 world/map 來源綁定;偵測到的「詳細戰鬥用數值 resolver」以 `CombatResolverPort` 實現(非 `contracts/combat-power` 的聚合服務)。
- **team**:`enterAdventureMap` 目前本地鑄 `MapInstanceId`(應由 map 模組擁有);`TeamQuery` 只有 `getPlayerControlledCharacterId`(無 `getPlayerCharacterId`)。
- **dungeon**:`NpcDungeonRunView` 目前含 `rngContext`(doc §4 要求 Query 不公開;`getNpcProgress` 是遮蔽版);跨午夜用了發明的 `{kind:'AdvanceWorldToDay'}` world 指令;`StartReturnFromDungeon` payload 未核對。
- **map**:`ProtectMapContent` 不發事件(union 無此事件);`MapContentResolver`/`SpawnDraft` 是發明的本地 port(依 §7.1 慣例)。
- **progression**:`ProgressionModuleState = ProgressionState & { grantLedger, dailyUsage }`(採集冪等帳本 + 每日計數;§2.5 概念上每日計數屬 social/city,待確認歸屬)。

## 慣例(務必遵守)
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
