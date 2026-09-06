# F3 發包拆解：從「戰鬥能開場」到「整體可玩」

本文是**可平行發包的工作單**。每一包都自帶完整規格：檔案路徑、port 精確簽章、參照範例、驗收標準。
負責人（整合者）保留 assembler 接線與註冊，發包方只交付「自成一檔＋自帶測試」的成品。

現況（2026-08-29）：引擎已能在真實 Content Pack 上開新遊戲、組出戰鬥遭遇、由派生統計引擎算出上限
HP/MP 與負重。已接線的 context：**team、combat、progression、inventory、quest**。
玩家指令現可達：`rest`／`startCityTravel`／`useCombatSkill`／`combatRest`／`equipItem`／
`configureWeaponSet`／`acceptQuest`（＋內部命令 `StartCombatEncounter`）。

---

## 零、所有包共通的鐵律

### 交付形狀（這條決定了能不能平行）

| 可以動 | 不可以動（整合者負責，動了就衝突） |
|---|---|
| 新檔 `src/app/content/<name>.ts` | `src/app/content/context-assembler.ts` |
| 新檔 `src/app/content/<name>.test.ts` | `scripts/verify-modules.ts` |
| 新檔 `content-source/core/<name>-params.ts` | `content-source/packs.ts` |
| 新檔 `src/app/content/<name>-resolvers.ts` | `src/app/content/resolver-registrations.ts` |
| （必要時）該模組 `src/modules/<m>/` 內的檔案 | `src/app/content/cross-module-ports.ts`（已滿載，新包一律開新檔） |

* 測試檔一律 `export function runTests(): void`，失敗就 `throw`。**不要**去 `verify-modules.ts` 註冊——
  交付時在說明裡寫一行「請註冊 `['<name>', <name>]`」，整合者會接。
* 若新增了 resolver shape 家族，export 一張 `<NAME>_SHAPE_BUILDERS` 表（比照
  `STATISTICS_SHAPE_BUILDERS`），整合者把它併進 `PRODUCTION_RESOLVER_SHAPES`。
* 若新增了內容 params，export `<name>Domain` 與 `<name>Bindings()`，整合者掛進 `packs.ts`。

### 紀律 7 關（`npm run verify:discipline`，違反就退件）

1. 正式依賴圖不得引用 test／fixtures／bring-up
2. 不得硬編碼內容 ID（型別導向偵測 branded ID 字面值）
3. 不得跨語意強制轉型（`as unknown as`）——同族窄化（`key as CharacterId`）可以
4. 不得玩法數值 fallback（`?? 30`、`?? 1.0`）
5. 讀內容讀不到時不得預設成空集合
6. 不得出現具名數值常數當調校量（`const BASE_HIT = 70`）
7. Definition 的 `kind` 不得裝領域變體

### 缺資料的五個合法出口（唯一許可的反應）

不啟動（Bootstrap 驗證失敗）／typed rejection（Handler 拒絕整筆交易）／明確拋出帶碼例外
（純服務）／回 `undefined` 讓呼叫端拒絕／`pending()` 明確標記未接線。
**任何情況下都不要「補一個看起來合理的預設值」**——那是本專案最主要的退件原因。

### 每一包都該先讀的參照範例

| 你要做的事 | 讀這個 |
|---|---|
| 寫 resolver shape 家族 | `src/app/content/statistics-resolvers.ts`（7 個 shape）、`combat-power-resolvers.ts` |
| 寫 resolver bridge（Port → registry） | `src/app/content/statistics-resolver-bridge.ts`、`combat-resolver-bridge.ts` |
| 寫內容 params ＋ bindings | `content-source/core/statistics-resolver-params.ts` |
| 寫 context／跨模組 adapter | `src/app/content/cross-module-ports.ts` 的 `createInventoryContext`／`createQuestContext` |
| 寫端到端測試（真實 pack） | `src/app/content/live-combat-wiring.test.ts`、`statistics-resolver-bridge.test.ts` |
| 窄化 Definition Reader | `src/app/content/statistics-reader.ts`（一 kind 一 reader） |

### 驗收（三條全綠才算交付）

```bash
npx tsc --noEmit
npm run verify:discipline
npx tsx -e "import('./src/app/content/<你的測試>.ts').then(m=>{m.runTests();console.log('PASS')})"
```

---

## 一、優先序（為什麼是這個順序）

目標是「整體可玩」，不是「模組齊全」。順序照**擋住玩的程度**排：

| 序 | 包 | 擋住什麼 |
|---|---|---|
| 1 | **P1 敵方 AI ＋ 反擊條件** | 敵人不會行動 → 戰鬥開得起來但打不完 |
| 2 | **P2 命中／格擋／減傷 ＋ 距離修正** | 傷害直接扣血，射程／命中設計等於沒上線（手感的核心） |
| 3 | **P3 DungeonMapPort** | 地城探索迴圈（移動／開門／互動）三個玩家指令全卡住 |
| 4 | **P4 map context ＋ spawn resolver** | 地圖沒有內容可生成 → 「下地城」沒東西可打 |
| 5 | **P5 防禦 MXP 路由** | 挨打不長防禦熟練（成長迴圈缺一半） |
| 6 | **P6 character lifecycle** | 生老病死不會發生（世界不動） |
| 7 | **P7 social**／**P8 city**／**P9 distribution** | 城市迴圈：社交、買賣、戰利品分配 |
| 8 | **P10 economy／world／crafting／npc-behavior／combat-sequence** | 世界模擬與生產（非主線） |
| 9 | **P11 UI** | 沒有畫面（另一條線，可與全部平行） |

P1、P2 建議優先且**不要同時發給兩個人**——兩者都動 combat 主路。

---

## P1 — 敵方 AI ＋ 反擊條件 Resolver　【最高優先】

**目標**：讓敵人真的會選招與選目標，讓反擊架勢條件可判定。

**現況（已核實）**：`src/app/content/combat-resolver-bridge.ts` 的 `chooseEnemyAction` 已經正確地走
`monster.aiPolicyId → CombatAiPolicyDefinition.behaviorResolverId → registry`，但目前註冊的 shape
只有 18 個（`combat-target:*` 8、`combat:weighted-power` 1、`statistics:*` 8、`team:default-placement` 1），
**沒有任何 AI／反擊 shape**，所以敵方回合會在 registry 查表時明確拋錯。`evaluateCounterStance` 同理。

**交付**
* `src/app/content/combat-ai-resolvers.ts`
  * export `COMBAT_AI_SHAPE_BUILDERS`，至少兩個 shape：
    * `combat-ai:<local>` → 輸入 `{ encounter, actorId }`，輸出 `EnemyActionChoice | undefined`
      （`{ skillId, targetCombatantIds }`）。選招與選目標的**權重與偏好全是 params**：
      例如「優先攻擊最低 HP 的敵方」「隨機挑一個射程內目標」都應該是 params 的差異，不是兩份程式。
    * `combat-counter:<local>` → 輸入 `{ encounter, defenderId, attackerId, incomingActionKind }`，
      輸出 `boolean`（述詞 shape，無 RNG）。
  * RNG 只能經 `ResolverContext.rng` ＋ `rngContext`（見 `resolver-adapter.ts` 的 `resolverContext({ rng, rngContext })`）。
* `content-source/core/combat-ai-params.ts`：export `combatAiParamsDomain` ＋ `combatAiBindings()`。
  綁定的 resolverId **必須恰好是內容既有的這五個**（已從 `content/` 抓出，不要自己發明）：

  | resolverId | 來源 | 語意（依名稱推定，實作前請讀該筆定義確認） |
  |---|---|---|
  | `resolver:combat.ai-behavior.single-skill-aggressor` | `combat-ai-policy` | 只會一招的雜兵：選唯一招式 ＋ 射程內任一敵 |
  | `resolver:combat.ai-behavior.elite-threat-focus` | `combat-ai-policy` | 精英：挑「威脅最高」的目標 |
  | `resolver:combat.ai-behavior.boss-rotation` | `combat-ai-policy` | 首領：招式輪替 |
  | `resolver:combat.counter-condition-block` | 反擊架勢 | 述詞：本次挨打是否觸發反擊 |
  | `resolver:combat.counter-condition-melee-block` | 反擊架勢 | 述詞：近戰挨打才觸發 |

  **三個 AI policy 應共用同一個 shape**（例如 `combat-ai:weighted-choice`），差異全部落在 params
  （目標權重、招式輪替表）——若你發現需要三份不同程式，先回報，那代表 shape 切錯了。
  兩個反擊條件同理共用一個述詞 shape。
* `src/app/content/combat-ai-resolvers.test.ts`：用**真實 pack**（`loadContentFromDisk`）證明
  一個怪物在一場真實遭遇裡選得出一個合法招式與合法目標，且**決定性**（同 seed 同結果）。

**陷阱**
* 目標必須是「敵對側、活著、在有效射程內」——射程過濾請重用 `filterByReach`
  （`src/modules/combat/target-shapes.ts`），不要自己寫距離。
* 「沒有合法行動」回 `undefined`（Handler 會視為休息），**不要**回一個假招式。

---

## P2 — 命中／格擋／減傷 ＋ 距離修正　【手感核心】

**目標**：把已定案的射程／命中模型接進傷害結算。

**設計來源**（已定案，見 `docs/02_systems/combat_skill_effect_spec.md` 與
`docs/00_core/game_design_document.md` 九、戰鬥系統）：

* 距離＝**排距**（不管左右，**從自己 0 起算**）：`combatDistance(attackerRow, targetRow)` 已實作於
  `src/modules/combat/state.ts`＝`rowsFromFront(a) + rowsFromFront(t)`（前對前＝0，最遠＝4）。
  距離修正表以**距離 2 為標準**（不是 3）。
* 有效射程＝武器 `reachCells` ＋ 招式 `extraReachCells`（Handler 已算好並過濾目標）。
* 命中率 ＝ `clamp(15, 95, 70 + (攻方命中 − 守方迴避) × 0.25)`，其中命中／迴避是**副屬分數**，
  且進公式前要先套**距離命中補正**（近距離加成、遠距離減成，正向壓低）。
* 格擋率 ＝ `clamp(0, 75, 守方格擋 × 0.25)`；格擋成功吸收 ＝ `raw / (raw + 80)`。
* 一般減傷 ＝ `raw / (raw + 120)`。
* 距離另外修正傷害與 CTB（距離短 → 傷害高、CD 短）。

**現況**：`applyEffect` 的 `dealDamage` 分支（`src/modules/combat/system.ts:703`）直接
`resolvePower → Math.round → 扣血`。沒有命中判定、沒有格擋、沒有減傷、沒有距離修正。

**關鍵缺口**：`CombatResolverPort` 目前**沒有取副屬分數的方法**。命中／迴避／格擋／減傷都是副屬，
必須新增一個 port 方法（例如 `getSecondaryAttribute(combatantId, secondaryAttributeId): number`），
由 Composition 以既有的派生統計引擎實作——`createCharacterStatsQuery` 目前只回 maxHP/MP，
但 `CharacterStatisticsSnapshot.secondaryAttributes` 已經算好全部副屬，擴出來即可。
怪物側請從 `MonsterDefinition.attributes` 取。

**交付**
* `src/modules/combat/system.ts`：`CombatResolverPort` 新增副屬查詢方法；`applyEffect` 的
  `dealDamage` 走「命中 roll → 格擋 roll → 減傷 → 距離修正 → 扣血」。
  **所有數字（70／0.25／15／95／120／80／距離曲線）一律是 resolver params，不得寫在 .ts 裡。**
  形狀在程式、量在資料——公式的骨架（clamp、比值飽和）用 `src/data-runtime/kernels.ts` 既有的
  `logisticRoll`／`ratioSaturation`／`thresholdTable`／`piecewiseLookup`，缺 kernel 才新增。
* `src/app/content/combat-hit-resolvers.ts` ＋ `content-source/core/combat-hit-params.ts`。
* 測試：真實 pack 上證明「同一招從第 1 排打 vs 從第 3 排打，命中率與傷害不同」，且
  「守方格擋高 → 期望傷害下降」。決定性（固定 rngContext）。

**陷阱**
* 這包會動 combat 契約與主路 → **不要與 P1 同時進行**。
* 未命中不得靜默 0 傷害後照樣記攻擊 MXP——有效傷害 0 就不記。
* 怪物沒有 MP／沒有 loadout，副屬查詢要能分辨 `source.kind === 'monster'`。

---

## P3 — DungeonMapPort（地城空間查詢）　【解鎖探索迴圈】

**目標**：讓 `moveDungeonRoom`／`openDungeonDoor`／`interactDungeonContent` 三個玩家指令可用。

**要實作的 port**（`src/modules/dungeon/system.ts:121`，精確簽章）：

```ts
interface DungeonMapPort {
  getMapVersion(mapId: MapInstanceId): number;
  getContentResolverId(mapId: MapInstanceId, contentId: ContentInstanceId): ResolverId | undefined;
  getEntranceRoom(mapId: MapInstanceId): Readonly<{ roomId: RoomId; entryCell: GridCell }>;
  isExitRoom(mapId: MapInstanceId, roomId: RoomId): boolean;
  getRoomTraversal(
    mapId: MapInstanceId, fromRoomId: RoomId, fromEntryCell: GridCell, toRoomId: RoomId,
  ): Readonly<{ cells: number; entryCell: GridCell }> | undefined;   // 不可通行 → undefined
  getDoorLink(mapId: MapInstanceId, linkId: RoomLinkId): /* 見原始碼 */;
}
```

**交付**
* `src/app/content/dungeon-map-port.ts`：以 `createMapQuery(mapState, mapDefinitions)` ＋ map
  的空間快照實作上述六個方法。**唯一有演算法的是 `getRoomTraversal`**（房間圖上的小格距離），
  請先讀 `src/modules/map/queries.ts` 的 `MapSpatialSnapshotView` 與 `01_map_module.md §2.1`。
* `src/app/content/dungeon-context.ts`：組出 `DungeonContext`
  （`reader`／`map`／`team`（已有 `createDungeonTeamPort`）／`worldDay`／`interactionRuleId`／
  `lootDistributionRuleId`／`npcExplorationRuleId`——後三個是「內容裡唯一一筆」的規則 id，
  用 `requireSingleDefinitionId` 的樣式取，缺或重複就不啟動）。
* 測試：真實 pack ＋ 一張真實地圖實例，證明入口房間讀得出、相鄰房間 traversal 有值、
  不相鄰回 `undefined`。

**陷阱**：`getContentResolverId` 未設定要回 `undefined`（Handler 會拒絕），
**不得**代填一個預設 resolver——原本 dungeon 寫死 `'resolver:dungeon-default'` 就是被這條擋掉的。

---

## P4 — map context ＋ 內容生成 Resolver

**目標**：地圖能刷出內容（遭遇／寶箱／事件），「下地城有東西可打」。

**要實作**：`MapHandlerContext` = `{ worldDay, definitions, world: WorldQuery,
presence: TeamPresenceQuery, ids, rng, rngContext, resolvers: MapContentResolver }`。

`MapContentResolver.resolveSpawnPayload({ mapId, spawnRule, kind, index, rng })` → 本局挑中的
Map Content 定義與 payload（encounterGroup／chest items／event def，全部從 Spawn Rule 的候選池抽）。

**交付**：`src/app/content/map-content-resolvers.ts`（shape 家族）＋
`content-source/core/map-spawn-params.ts` ＋ `src/app/content/map-context.ts` ＋ 測試
（真實 pack 上刷出的內容 100% 落在該 spawn rule 宣告的候選池內，且決定性）。

**陷阱**：候選池是空的時候要明確失敗，不得「回空陣列然後地圖沒東西」。

---

## P5 — 防禦 MXP 路由

**目標**：`resolveDefenseMastery(characterId)` 目前明確拋錯（`combat-resolver-bridge.ts:94`），
接上「讀該角色防禦裝備 → `defense-mastery-routing-rule` → MasteryId」。

**交付**：改 `combat-resolver-bridge.ts` 的該方法（**這是唯一許可修改既有橋接檔的包**，
所以不要和 P1／P2 同時發）＋ 測試證明穿輕甲與穿重甲路由到不同 Mastery。

---

## P6 — character lifecycle resolvers ＋ context

**Port**（`src/modules/character/system.ts:138`）：

```ts
interface CharacterResolverPort {
  resolveNaturalDeath(input: { character: Character; onDay: WorldDay }): LifecycleDecision;
  resolveRetirement(input: { character: Character; onDay: WorldDay }): LifecycleDecision;
  resolveBirth(input: { parents: readonly Character[]; onDay: WorldDay; /* 見原始碼 */ }): ...;
}
```

**交付**：`src/app/content/character-resolvers.ts`（shape）＋
`content-source/core/character-lifecycle-params.ts`（年齡曲線、機率——目前 `lifecycle-rule.core.standard`
已有成年天數 5475，其餘曲線是第一版待討論值，請標註 `第一版方案（待討論）`）＋
`src/app/content/character-context.ts`（`stats` 直接用既有的 `createCharacterStatsQuery`）＋ 測試。

---

## P7 — social resolvers ＋ context

**Ports**：`SocialResolverPort`（`resolveInitialAffinity` → `RngStep<number>`、
`resolveConversationDelta`、`resolvePlayerProposalAcceptance` → `boolean`、
`resolveHomeTutorPriceModifier`）；`SocialTeamQuery` 是
`Pick<TeamQuery, 'getPlayerTeamId' | …>`，直接轉接 `createTeamQuery`（零工作量）。
`socialSystemDefinitionId` 取內容唯一一筆 `social-system`。

**解鎖**：`interactWithAdventurer`、`proposeMarriageToTeamMember`。

**建議 kernel**：親和度用 `logisticCurve`／`logisticRoll`，對話增減用 `thresholdTable`。

---

## P8 — city ports ＋ resolvers ＋ context　【最大包，建議再拆兩份】

**P8a｜五個跨模組 port 轉接**（無 resolver，純投影）：
`CityTeamPort`（3 方法，與 `TeamQuery` 同簽章）、`CityInventoryPort`（4 方法同 `InventoryQuery`
＋ `isTradable` 從 `ItemDefinition.tradePolicy.tradable` 投影）、`CityEconomyPort`
（`nextTransferId`／帳戶查詢／`getShopOfferPurchaseQuote`）、`CityWorldPort`（2 方法）、
`CityAdventurerSupplyPort`（`countAdventurerSupply`——**沒有現成 Query**，要從 character/team
的事實定義，請先確認設計歸屬再實作）。

**P8b｜`CityResolverPort` ＋ context 組裝**：商店報價、家園升級、酒館情報等的資料化 resolver。

**解鎖**：`buyShopOffer`／`sellItemToShop`／`buyOrUpgradeHome`／`releaseHomeTeacher`。

---

## P9 — distribution（戰利品拍賣）

**Ports**：`DistributionEconomyQuery`（3 個 `find*Account`，全部回 `| undefined`）、
`DistributionInventoryQuery.findIntrinsicValue`、`DistributionTeamQuery.findPlayerControlledCharacterId`、
`DistributionResolverPort.resolveCompanionBid` → `RngStep<CompanionBidDecision>`。

**解鎖**：`submitLootBid`／`passLootItem`／`resolveLootAuctionRound`（地城帶回戰利品後的分配）。

---

## P10 — economy／world／crafting／npc-behavior／combat-sequence contexts

多為內部命令與 Job 驅動，不直接對應玩家指令，但世界要「活著」需要它們。各自 port 見：
`economy/system.ts:96`、`world/system.ts:125`、`crafting/system.ts:91,101,106,121`、
`npc-behavior/system.ts:96,105,120,131`、`combat-sequence/system.ts:99`。

**注意**：`EconomyHandlerContext.transactionId` 是**每筆交易**的值，不是建置期常數——
它的接線方式需要與整合者確認（可能要改 ContextAssembler 的簽章）。發包時請只交付
resolver bridge 與 port 轉接，`transactionId` 留給整合者。

---

## P11 — UI（React／Electron）　【獨立線，可與全部平行】

**現況**：`vite`／`electron` 已在 `package.json`，`app/` 目錄有 UI 的 tsconfig，
但沒有真正的畫面；`availableCommands` 目前是硬編碼的。

**第一版目標**（讓人能實際點、給手感反饋）：
開新遊戲 → 城市畫面（休息／旅行／酒館）→ 進冒險地 → 戰鬥畫面（3×3 格陣、CTB 順序、選招選目標）。

**接法**：UI 只送 `GameCommandRequest` 給 `runGameCommand(state, request, assembler)`，
讀 `result.state` 重繪。**不要**讓 UI 直接碰模組 Handler 或 Slice。
`src/app/composition/session.ts` 是唯一入口。

---

## 二、整合者（負責人）保留的工作

1. 每包交付後：接 `context-assembler.ts`、註冊 `verify-modules.ts`、掛 `packs.ts` 的 domain/bindings、
   併 `PRODUCTION_RESOLVER_SHAPES`。
2. 跑全套：`npm run verify`（typecheck → discipline → modules → content-packs → content-sync → content-scope）。
3. **跨包的「宣告了但沒接上」檢查**：每包自己綠不代表接起來是通的。整合後必須有一支
   端到端測試證明「玩家指令 → 真實內容 → 真實 Slice 改變」，比照
   `src/app/content/live-combat-wiring.test.ts`。
4. 逐包提交（一包一 commit，訊息寫清楚證據）。

## 三、與並行 Codex session 的邊界

`docs/03_content/**`、`build_*.mjs`、`docs/03_content/shared/*`、
`docs/02_systems/time_and_mastery_progression.md` 由另一個 session 維護。
**發包方一律不得修改這些路徑**，提交時用明確路徑 `git add <path>`，永遠不要 `git add -A`。
