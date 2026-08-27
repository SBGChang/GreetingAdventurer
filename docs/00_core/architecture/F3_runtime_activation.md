# F3：讓引擎在真實內容上跑起來（Runtime Activation）

> 這份是 F3 的建置規格，寫在動手之前。F3 是「可遊玩」路上最硬的一波——它是所有「已宣告但
> 還接著絆線（`unusedContext`）」的接縫變成真的地方。內容已到 91%（939 筆 Definition），
> 但**內容齊 ≠ 跑得起來**。F3 之後才輪到 F4（React + Electron + Start.bat）。
>
> 使用者已定案：介面 = React + Electron；四國全做；數值可由我設計但須資料化並記為
> 「第一版方案（待討論）」；結束條件 = 可遊玩第一版 + Start.bat。使用者選擇**直接等圖形版**
> （不要中間的文字版）。

## 為什麼 F3 比看起來大

初判是「把 140 個 Resolver 註冊起來」。實查後不是：那 140 個引用**收斂成約 15–20 個 shape**
（見下），但**它們大多不是機械式的 kernel 樣板套用，而是真實領域邏輯**。

關鍵發現（2026-08-xx 實查）：`CombatPowerInput = { resolverId, encounter, actorId, targetId? }`
**不帶 `paramsDefId`**。所以 `resolvers.ts` 現成的 `weightedProductResolver` / `logisticRollResolver`
樣板（它們從 `input.paramsDefId` 讀 params）**套不上**戰鬥數值 Resolver——後者必須自己從
Definitions 讀「該角色的武器係數 + 技能倍率 + 目標防禦」再算。這是真實戰鬥數學，接近
statistics / combat-power 服務在做的事。

因此 F3 的 Resolver 層是**約 20 個領域 Resolver 工廠**，每個讀正確的 Definition View，不是
把 140 個 ID 各塞一行。

## Resolver 呼叫契約（本輪確立，動手前必懂）

1. 內容把 `resolverId` 存在規則欄位（例：`CombatRuleDefinition.powerResolverId`）。
2. 模組 Handler 呼叫 `ctx.resolvers.resolvePower({ resolverId, encounter, actorId, targetId })`
   ——結構性輸入直接帶入，**不帶調校量**。
3. Port bridge（`resolver-adapter.ts` 的 `runResolver`）做 `registry.require(resolverId).resolve(input, context)`。
4. Resolver 的 `resolve(input, ctx)` 從 `ctx.definitions`（窄化 Reader）讀調校量、算出結果，
   用 RNG 時以 `ctx.rngContext` 顯式串接並回 `nextRngCursor`。

調校量的來源**因家族而異**（這是 F3 要逐家族定的設計）：
- 有些從 input 帶的實體（skill / equipment / monster）的 Definition 欄位讀。
- 有些該有一筆專屬的 `*-params` 定義——但目前 `logistic-roll-params` / `weighted-product-params`
  兩個 kind **零資料**（F1/F2a 只寫了 resolver 的**引用**，沒寫 params 定義）。凡是要走 kernel
  樣板的 Resolver，得先補對應的 params 定義（那是內容，屬 content-source）。

## Resolver shape 分組（140 個引用 → ~20 個工廠）

| shape 群 | 數量 | 回傳 | 調校來源 | 備註 |
|---|---|---|---|---|
| `combat.target-*`（single/up-to/self/same-column/front-row…） | ~25 | `CombatantId[]` | **純邏輯**，讀 encounter 的 grid/side/column | 最大群，自足，無 params 依賴——**適合當 F3 第一個增量** |
| `combat.counter-condition-*` | 2+ | boolean | 純邏輯，讀 encounter | 反擊條件述詞 |
| `combat.damage-power.*` / `heal-power.*` / `ctb-amount.*` | ~8 | number | 讀武器係數 + 技能倍率 + 目標防禦 | **領域數學，非樣板** |
| `combat.status-modifier.*` | ~5 | number | 讀 combat-status 定義 | |
| `combat.ai-behavior.{single,elite,boss}` | 3 | 選招+目標 | 讀 ai-policy 定義 + 加權抽選 | 用 RNG |
| `economy.reward.*`（quest 七種 + dungeon-gold + loot-direct） | ~10 | MoneyValue | 讀 reward-rule 定義 | |
| `economy.{personal-trade,shop-buyback,home-tutor}` | ~4 | number | 讀 price-modifier 定義 + 熟練度 Query | 買賣加成依角色本人 |
| `social.affinity.*`（conversation-delta/initial/home-tutor/player-proposal） | ~4 | number/bool | 讀 affinity-rule 定義 | player-proposal 不用 RNG（§2） |
| `character.*`（natural-death/retirement/birth-outcome/birth-eligibility/temporary-*/world-adventurer） | ~8 | 各異 | 讀 lifecycle/birth/temporary 定義 | 用 RNG 者回 cursor |
| `team.free-action` / `npc-behavior.{free,intent}` | ~11 | 選擇/權重 | 讀 policy 定義 + 加權抽選 | 用 RNG |

（精確清單：`npm run report:content` 的「── Resolver ──」段。）

## 第二部分：正式 ContextAssembler

`session.ts` 的 `ContextAssembler = (runtime, state) => ModuleContexts` 目前只有測試 fixture 版
（`session-fixture.ts` 的 `makeAssembler`，只接 dungeon、其餘 `unusedContext` 絆線）。

正式版住 `src/app/content/`（或 `src/app/composition/`），吃
**DefinitionRegistry + ResolverRegistry**，為 16 模組 + 3 服務各組 HandlerContext：
- **Definition Reader**：`createXxxDefinitionReader(registry)` 全部已存在，直接用。
- **跨模組 Query**：`cross-module-ports.ts` 已有部分（DungeonTeamPort…）；缺的照樣式補。
- **id allocator**：`runtime.ids` 提供。
- **Resolver Port bridge**：把模組的領域 ResolverPort 方法橋到 `runResolver(registry, resolverId, …)`。
- **RNG**：`runtime.rngContextFor(tag)`。

每個模組 HandlerContext 的精確形狀見各自 `system.ts` 的本地 port 型別宣告（§7.1 慣例）。

## 第三部分：NewGameBootstrapper（§1.1）

正式路徑目前沒有，只有 `src/testing/composition/bring-up-bootstrap.ts`。正式版要：
派生 archetype 屬性、排生命週期 Job、驗內容/城/archetype、產 diagnostics。

**ID 規約衝突（動手前先解）**：bring-up 用 `definition:<kind>:<local>`（見
`bring-up-bootstrap.ts` 的 `DEFAULT_ARCHETYPE = 'definition:character-archetype:founder'`），
而 content-source 產出的是 `<kind>.<culture>.<local>`（例 `character-archetype.yunhua.…`）。
兩者對不上，Bootstrapper 要用後者。先確認 content 裡真的有一筆「起始 archetype」可用
（character domain 的 archetype 若帶文化色彩已歸 culture pack）。

## 建議建置順序

1. **`combat.target-*`（~25，純邏輯，自足）**——建立 `resolver-registrations.ts` 的組裝點與
   pattern，先把最大且無 params 依賴的一群做完並測。gap 立刻可見下降。
2. **其餘純邏輯／述詞 Resolver**（counter-condition、character 生命週期）。
3. **數值 Resolver**（damage/heal/ctb/reward/affinity）——同時補它們要讀的 params 或改讀既有
   Definition 欄位；逐家族定調校來源。
4. **正式 ContextAssembler**——逐模組接上（Reader/Query/ids/Resolver bridge）。
5. **NewGameBootstrapper** + 一支「開新遊戲 → 下幾個指令 → golden 重播」的整合測試。
6. 交棒 F4。

每一步都能獨立提交並被 `npm run report:content` / `verify` 量測——不要憋成一個大 commit。

## 動手 combat 核心前必須先解的架構子題（本輪實查確認）

**resolver 註冊不能在 `src/` 硬編碼 resolver ID。** `ResolverId = Brand<string,'resolver'>`，而紀律
門禁的 `CONTENT_BRAND_EXACT` 含 `'resolver'`——所以任何 `'resolver.yunhua.target-self' as ResolverId`
寫在 `src/` 都會被「硬編碼內容 ID」擋下（實查 `scripts/lib/ast-gates.ts:63`）。resolvers.ts 現有的
`logisticRollResolver(resolverId, ownerModule)` 樣板正是因此把 resolverId 收成**參數**——呼叫端才帶入。

但呼叫端若也在 `src/`，literal 一樣被擋。所以 registry 組裝必須讓 **resolver ID 住在內容側**，
`src/` 只認**與內容無關的 shape/kind 代碼識別子**。這一層目前**不存在**，是 combat 核心的真正前置。

**建議機制（下一次動手先做這個）**：
1. 新增一個 **resolver 定義 kind**（例 `combat-target-resolver` / `combat-power-resolver`…，或通用
   `resolver-binding`），內容欄位 `{ shape: string; params?: … }`；作者層（content-source）替每個
   resolver ID 寫一筆，指定它是哪個 shape。resolver ID 出現在 content-source（合法）。
2. `src/` 提供一張 `Record<shapeKey, ResolverImpl>`（shapeKey 是純代碼字串,非內容 ID）：
   `combat.target.single-hostile`、`combat.target.same-column`、`combat.power.weighted`… 每個 shape
   一個純函式實作（grid 邏輯／kernel 公式）。
3. 組裝：iterate 內容的 resolver 定義 → 依 `shape` 查 impl → `registry.register({ resolverId: def.id, resolve: impl(def.params) })`。
   `src/` 全程只碰 shapeKey，碰不到 resolver ID literal → 門禁綠。
4. pack 標頭的 `requiredResolverIds` 已存在，Bootstrap Gate 可據此確認「內容指名的 resolver 都註冊了」。

**combat target resolver 的 shape 盤點（25 筆）**：
- 純 grid/side/status（~15,可直接實作）：self、single-hostile、single-ally、self-or-single-ally、
  same-column-hostiles、own-front-row、whole-party、two-allies、up-to-three-{allies,hostiles}、
  single-hostile-casting（讀 combatant.casting）、single-hostile-with-negative-status（讀 activeStatuses）。
- 需武器 reach／guard 語意（~10,要 loadout 或 status 佐料）：single-hostile-{melee,ranged,mid,
  guarding,with-guard-down}、up-to-three-hostiles-{melee,ranged}、blocked-melee-attacker、
  self-after-block、counter-condition-{block,melee-block}。

**combat power resolver**（damage/heal/ctb）：讀 actor 裝備係數 × 技能倍率 × 主屬 × 目標防禦，
形狀近似 statistics/combat-power 服務;調校量走 balanceModel（已是 core 內容）。這是 combat 核心
最重的一塊,務必逐個釘測試（不同輸入→期望傷害）再接。

做完上面 1–3 的機制,combat 核心就從「25 個散落的 ID」變成「一張 shape→impl 表 + 內容側的綁定」,
可逐 shape 增量、逐個驗證。
