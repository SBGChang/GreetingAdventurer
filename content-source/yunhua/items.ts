// content-source/yunhua/items.ts
// 雲華：消耗品、素材、素材詞條、一般物品、製作配方與料理食譜。
//
// ── 這個檔案是「映射」，不是「發明」────────────────────────────────────────
//
// 設計來源已經有結構化資料，本檔把它對應到引擎的 Definition Schema：
//   * `docs/03_content/yunhua/yunhua_content.data.mjs`（唯讀）
//       - `consumables.combat` / `.nonCombat` / `.general`
//       - `craftingCatalog.economyRules` / `.materials` / `.affixes` / `.recipes` / `.cuisine` / `.books`
//       - `equipmentCatalog`（只用它的 blueprint id 與 names[0]/names[1] 來把配方名對回裝備 ID）
//   * `docs/03_content/yunhua/yunhua_content.md` §5（ID 規約）、§10（道具）、§11（素材／配方／料理／書籍）
//
// ⚠ **設計來源的數值大量嵌在中文散文字串裡**（`'重量 1／價值 24'`、
// `'基礎 34；反 −0.10／點、協 −0.06／點；最低 18'`）。本檔**不以 regex 剖析散文**：每一筆都逐字
// 人工判讀，並在資料旁的註解寫出「來源字串 → 哪個欄位得到什麼值」。設計師改措辭時，這些註解
// 就是唯一能讓下一個人發現漂移的東西。
//
// ── 本檔刻意**不發**的三個 kind（見回報「契約缺口」）──────────────────────
//
//   1. `book`（48 筆）——設計來源每一列只有 名稱／學習等級／取得來源／可教內容分類。
//      `BookDefinition` 的 `unitWeight`、`intrinsicValue`、`stackPolicy`、`learningPolicy`、`teaches`
//      **五個必填欄位全部沒有來源**；而且 md §11.5 明文說 learningPolicy「應由全局書籍經濟規則
//      統一定義，不因雲華內容個別偷改」——設計來源是**刻意**還沒給書籍的 Definition 資料。
//      技能書的 `teaches` 還要指向 `skill.yunhua.*`（別的 domain 擁有，且 `skill` 是已登記 kind，
//      三段式引用會被編譯期跨引用檢查抓成懸空）。48 筆全部發不出來，不是「等別人交件」。
//   2. `food-affix`——`FoodAffixDefinition.effectByTier` 是 `Record<1|2|3|4|5, EffectDefinitionId>`，
//      五個鍵全必填、無法留空。`effect` 是已登記 kind，三段式引用必須解析得到，而本輪沒有任何
//      domain 產出 `effect.yunhua.*`；退一步說，`crafting-reader.ts` 的 `getFoodEffect` 讀的是
//      `characterStatusId`，而 `EffectDefinition` 的 applyStatus 變體欄位叫 `statusId`——欄名對不上，
//      料理效果今天就算寫出來也讀不到。
//   3. `restaurant-menu`——`cityId` 必填且指向 `city.yunhua.<local>`（`city` 是已登記 kind、三段式，
//      擁有者是別的 domain，本檔無從確認 local 名）；`entries[].mealVariantId` 的 kind
//      `restaurant-meal-variant` **沒有登記**，任何人都寫不出那筆定義。兩個阻斷點疊在一起，
//      發出去只會讓整個 pack 編譯失敗。餐館三道菜的內容已寫進回報，供整合者接。
//
// 本檔**不改**契約、`packs.ts`、`docs/**`、`scripts/**`、`content/**`。

import type {
  CraftingRecipeDefinition,
  CraftingIngredientSlotDefinition,
  CuisineIngredientSlotDefinition,
  CuisineRecipeDefinition,
  MaterialAffixDefinition,
} from '../../src/contracts/crafting';
import type {
  ItemDefinition,
  NonCombatUseRuleDefinition,
  NonCombatUseRuleId,
  ItemUseContextId,
  GeneralItemCategoryId,
  UseDelayAttributeReductionRule,
  UseDelayRuleDefinition,
} from '../../src/contracts/inventory';
import type { MasteryRequirement } from '../../src/contracts/progression';
import type {
  CraftQualityRuleId,
  CraftingIngredientSlotId,
  CraftingRecipeId,
  CuisineRecipeId,
  CurrencyId,
  ExperienceAwardRuleId,
  ItemDefinitionId,
  ItemTagId,
  MasteryId,
  MaterialAffixId,
  MaterialTagId,
  ResolverId,
  RestaurantMealVariantId,
  UseDelayRuleId,
} from '../../src/contracts/core';
import { cultureIds, type Authored, type AuthoredDomain, type AuthoredText } from '../authoring';

const yunhua = cultureIds('yunhua');
const core = cultureIds('core');

const CULTURE_ID = yunhua.cultureId;

// ── 跨定義引用（本檔不擁有這些定義，只引用既存 ID）──────────────────────────
//
// 逐筆已對帳（實測方式：把 `content-source/core/**` 每個 domain 的 definitions 收成 id 集合，
// 再逐筆比對命中）。加新引用時請重做這件事，不要只靠註解宣稱「已存在」。

// 貨幣。`content-source/core/economy-social-distribution.ts` 的 `currency`，local 名 `standard`。
const CURRENCY_ID = core.id<CurrencyId>('currency', 'standard');

// 熟練度。`content-source/core/progression.ts` 的 `MASTERY_IDS`（LIFE_MASTERIES 五筆全部命中）。
const MASTERY_SMITHING = core.id<MasteryId>('mastery', 'smithing');
const MASTERY_TAILORING = core.id<MasteryId>('mastery', 'tailoring');
const MASTERY_HANDICRAFT = core.id<MasteryId>('mastery', 'handicraft');
const MASTERY_ALCHEMY = core.id<MasteryId>('mastery', 'alchemy');
const MASTERY_COOKING = core.id<MasteryId>('mastery', 'cooking');

// 製作品質規則。`content-source/core/quest-crafting-sequence.ts` 的 `CRAFT_QUALITY_ROWS`
// 發三筆：`equipment` / `consumable` / `trade-good`（**連字號**，不是 tradeGood）。
const QUALITY_RULE_EQUIPMENT = core.id<CraftQualityRuleId>('craft-quality-rule', 'equipment');
const QUALITY_RULE_CONSUMABLE = core.id<CraftQualityRuleId>('craft-quality-rule', 'consumable');
const QUALITY_RULE_TRADE_GOOD = core.id<CraftQualityRuleId>('craft-quality-rule', 'trade-good');

// 製作／料理 MXP。`content-source/core/progression-rules.ts`：
//   * `craftingAwardRules` = `craft-<mastery>-tier-<i..v>`，mastery ∈ {smithing, tailoring,
//     handicraft, alchemy}，階級標記是**小寫羅馬數字**。
//   * `cuisineAwardRules` = `cuisine-tier-<i..v>`。
// 兩者的 Tier I／II 基數是 400／1,000，與設計來源每一筆配方寫的 `MXP 400`／`MXP 1,000` 完全相同
// ——所以「配方指名哪一條規則」是查表，不是挑值。
function craftExperienceRule(masteryLocal: string, tier: 'i' | 'ii'): ExperienceAwardRuleId {
  return core.id<ExperienceAwardRuleId>('experience-award-rule', `craft-${masteryLocal}-tier-${tier}`);
}
function cuisineExperienceRule(tier: 'i' | 'ii'): ExperienceAwardRuleId {
  return core.id<ExperienceAwardRuleId>('experience-award-rule', `cuisine-tier-${tier}`);
}

// ── Resolver ID ─────────────────────────────────────────────────────────────
//
// `authoring.ts` 的 `definitionId` 只造 `DefinitionId`；ResolverId 是另一個 brand 家族
// （沒有文化段——Resolver 由模組擁有，不由文化擁有）。字串形狀沿用既有落地寫法
// `resolver:<module>.<name>`（`content-source/core/team.ts`、`economy-social-distribution.ts`）。
// 本檔只寫 ID；Resolver 實作與 kernel params 不屬內容作者層。**這六筆必須進 pack 的
// `requiredResolverIds`，否則 Bootstrap 不會發現它們沒註冊**（見回報第 5 節）。
function craftingResolver(local: string): ResolverId {
  return `resolver:crafting.${local}` as ResolverId;
}

// 成功率／失敗素材去向。md §11.3：「成功率、失敗素材去向與品質由配方的 `outcomeResolverId`／
// `qualityRuleId` 統一處理。」**第一版方案（待討論）**：逐 outputKind 一條，理由與
// `craft-quality-rule` 分三筆同一個——三種產物的失敗代價本來就不同（裝備失敗要決定素材去向、
// 消耗品失敗只影響產量、工藝品失敗影響淨利），共用一條會讓那個差別住進 Resolver 的 if 裡。
const OUTCOME_RESOLVER_EQUIPMENT = craftingResolver('outcome.equipment');
const OUTCOME_RESOLVER_CONSUMABLE = craftingResolver('outcome.consumable');
const OUTCOME_RESOLVER_TRADE_GOOD = craftingResolver('outcome.trade-good');

// 消耗品產量。設計來源逐筆寫「成功產量 2，製藥 Lv.4 起每 2 級 +1」——那是這個 Resolver 的 params，
// 契約沒有承載 params 的欄位（見回報「契約缺口」），所以三筆製藥配方共用同一條。
const CONSUMABLE_YIELD_RESOLVER = craftingResolver('consumable-yield.standard');

// 工藝品出售倍率。md §11.3：「品質只改出售倍率」。兩筆工藝配方共用。
const TRADE_GOOD_SALE_MULTIPLIER_RESOLVER = craftingResolver('trade-good-sale-multiplier.standard');

// 料理詞條階級。md §11.4：「廚藝決定詞條最後階級；餐館版本全部以 Tier 1 詞條呈現。」
const FOOD_AFFIX_TIER_RESOLVER = craftingResolver('food-affix-tier.standard');

// ── 未登記 kind 的引用（三個家族）──────────────────────────────────────────
//
// 下面三個 ID 家族在 `contracts/core/ids.ts` 有型別、在 `ItemDefinition` 有欄位，但它們的 kind
// **沒有登記在 `ALL_DEFINITION_KINDS`**，所以沒有任何人寫得出那些定義（Content Compiler 對未登記
// 的 kind 是編譯失敗）。這與 `content-source/core/quest-crafting-sequence.ts` 的 `item-tag` 是同一類
// 缺口（宣告了 ID 型別、沒登記 kind），照那裡的先例處理：**照實填 ID、把缺口寫進回報**，
// 而不是填空陣列——空陣列的語意是「沒有任何標籤／沒有任何合法情境」，那比一個查得出來的
// 懸空引用更難發現。
//
// 註：編譯期的跨定義引用檢查只認「第一段是已登記 kind」的三段式字串，所以這三家族**不會**被擋，
// 也就是說它們今天不會讓 pack 編譯失敗——會在那些 kind 登記的那天才浮現。
//
//   * `item-tag`：`ItemTagId`。**local 名刻意與 core 對齊**——`quest-crafting-sequence.ts` 的
//     `retrySupplyPolicy.eligibleItemTagIds` 已經引用 `item-tag.core.combat-consumable`，所以雲華的
//     戰鬥消耗品必須帶**同一個** ID，否則重骰補品永遠選不到任何東西。標籤家族本身文化無關
//     （四國的「戰鬥消耗道具」是同一個分類），故用 `.core.` 段而不是 `.yunhua.`。
//   * `material-tag`：`MaterialTagId`。配方的 `acceptedMaterialTagIds` 靠它指定收哪個素材。
//     md §11.3 要求「資料表要個別列出每個 Ingredient Slot，不能僅寫『需要青鐵和竹材』」，而設計
//     來源的配方欄寫的是**具名素材**（`青鐵錠 ×1`）。契約只講標籤，所以每個素材各帶一條**身分標籤**
//     （local 名 = 該素材的 local 名），配方槽收那條身分標籤。**第一版方案（待討論）**：
//     這是「具名素材」到「標籤」最小失真的對應；要做「任一種鐵錠皆可」時再加類別標籤。
//   * `item-use-context`：`ItemUseContextId`。非戰鬥使用的合法情境。
function itemTag(local: string): ItemTagId {
  return core.id<ItemTagId>('item-tag', local);
}
function materialTag(local: string): MaterialTagId {
  return yunhua.id<MaterialTagId>('material-tag', local);
}

const TAG_COMBAT_CONSUMABLE = itemTag('combat-consumable');
const TAG_NON_COMBAT_CONSUMABLE = itemTag('non-combat-consumable');
const TAG_GENERAL_ITEM = itemTag('general-item');
const TAG_MATERIAL = itemTag('material');

// 階級標籤。`ItemDefinition` **沒有 tier 欄位**（見回報「契約缺口」），而設計來源逐筆都給了
// Tier I～V，且採集池、寶箱池與商店貨架都要按階級抽。`itemTagIds` 是唯一承載得住它的位置。
// **第一版方案（待討論）**：把階級資料化成標籤，而不是讓它在編譯時消失。
const TIER_TAG: Readonly<Record<ItemTier, ItemTagId>> = {
  I: itemTag('tier-i'),
  II: itemTag('tier-ii'),
  III: itemTag('tier-iii'),
  IV: itemTag('tier-iv'),
  V: itemTag('tier-v'),
};

type ItemTier = 'I' | 'II' | 'III' | 'IV' | 'V';

// ── 共用的物品欄位 ──────────────────────────────────────────────────────────
//
// `stackPolicy`：設計來源**沒有**逐筆指定堆疊策略（md §5 要求「每個物品明列…堆疊策略」，但
// `yunhua_content.data.mjs` 沒有那一欄）。**第一版方案（待討論）**：本檔全部 `stackable`。
// 理由：製藥「成功產量 2」必須疊得起來；素材配方寫 `×1`／`×2` 是數量需求；一般物品是購買／送貨
// 委託的**計量**目標並會進城市永久庫存。`maxStack` 一律不填——設計來源沒有上限值，填一個就是發明。
//
// `tradePolicy.tradable`：逐筆從設計來源的「取得／用途」欄讀出（每一列都出現店貨、購買委託、
// 送貨、收購或商店庫存），所以四類物品都可交易。判讀依據寫在各段。
//
// `unresolvedMapDisposition`：md §11.6 的表逐字明文——「素材、一般物品、裝備、戰鬥／非戰鬥消耗品
// → `toCityPermanentStock`」。本檔四類物品全部落在那一列。
const DISPOSITION_TO_STOCK = 'toCityPermanentStock' as const;

function nameRef(prefix: string, local: string): ItemDefinition['display'] {
  // 本地化鍵刻意寫成四段（`<prefix>.yunhua.<local>.name`）：三段式且第一段是已登記 kind 的字串會被
  // 跨定義引用檢查當成定義引用，而本地化鍵不是定義。
  return { nameRef: { key: `${prefix}.yunhua.${local}.name` } };
}

// ════════════════════════════════════════════════════════════════════════════
// §1 戰鬥消耗品的使用延遲（use-delay-rule）
// ════════════════════════════════════════════════════════════════════════════
//
// md §6.3：「實際基礎、主屬減免與最低值統一收在 `rule.yunhua.delay.*`；同一招的文字、怪物 AI 與
// NPC Combat Sequence 一律引用同一個 Rule。」md §10.1 只給「延遲定位」（迅捷／標準／沉重），並明說
// 「下表的『延遲定位』在正式資料中必須展開為實際 `baseDelay`、主屬扣減與 `minimumDelay`」——
// 而 `yunhua_content.data.mjs` 的 `consumables.combat` 每一列**已經**給了那三個實際值。
//
// ⚠ **這八筆的數值與 `balanceModel.delayProfiles` 不一致，而且不一致是設計來源自己的狀態。**
// 例如金瘡散在 md §10.1 標「迅捷」，但 `delayProfiles.quick` 是 base 28／min 14，
// 而 `consumables.combat` 那一列寫 base 34／min 18。本檔**採用 `consumables.combat` 的逐筆數值**
// （md §12：「雲華的第一輪實際數字已集中在 `yunhua_content.data.mjs`」），並因此逐消耗品一條規則，
// 而不是五條共用的 profile。回報第 3 節列出全部判讀。
//
// ── 散文判讀（逐筆；來源字串 → 欄位）──────────────────────────────────────
// 判讀規則（人工，非 regex）：分號分段；第一段「基礎 N」→ baseDelay；中間各段
// 「<主屬> −X／點」→ reductions（主屬中文名對 PrimaryAttributeId：智 intelligence、
// 反 reaction、協 coordination）；最後一段「最低 N」→ minimumDelay。
// 出現在中間、無欄位可放的段落（清瘴丸的「使用 CTB −4」）**不吞掉也不改欄位語意**，
// 逐筆記在該筆註解與回報裡。

type DelayRow = Readonly<{
  local: string;
  sourceText: string;
  baseDelay: number;
  reductions: readonly UseDelayAttributeReductionRule[];
  minimumDelay: number;
}>;

const DELAY_ROWS: readonly DelayRow[] = [
  {
    // 金瘡散：'基礎 34；反 −0.10／點、協 −0.06／點；最低 18'
    // → baseDelay 34、reaction 0.10、coordination 0.06、minimumDelay 18
    local: 'gold-wound-powder',
    sourceText: '基礎 34；反 −0.10／點、協 −0.06／點；最低 18',
    baseDelay: 34,
    reductions: [
      { primaryAttribute: 'reaction', reductionPerPoint: 0.1 },
      { primaryAttribute: 'coordination', reductionPerPoint: 0.06 },
    ],
    minimumDelay: 18,
  },
  {
    // 清瘴丸：'基礎 30；反 −0.10／點、協 −0.06／點；使用 CTB −4；最低 16'
    // → baseDelay 30、reaction 0.10、coordination 0.06、minimumDelay 16
    // ⚠ **「使用 CTB −4」沒有欄位可放**：`UseDelayRuleDefinition` 只有
    // baseDelay / reductions / minimumDelay 三欄，沒有「使用時額外調整使用者 CTB」的位置；
    // 那是 `CombatCtbAdjustmentRuleDefinition` 的形狀，而 `ItemDefinition` 接不到它
    // （`useEffectIds` 是 `EffectDefinitionId`，那個家族沒有 adjustCtb 變體）。
    // 這一段資料本輪**表達不出來**，不折進 baseDelay（30 − 4 = 26 會讓一個獨立效果消失在基數裡）。
    local: 'clear-miasma-pill',
    sourceText: '基礎 30；反 −0.10／點、協 −0.06／點；使用 CTB −4；最低 16',
    baseDelay: 30,
    reductions: [
      { primaryAttribute: 'reaction', reductionPerPoint: 0.1 },
      { primaryAttribute: 'coordination', reductionPerPoint: 0.06 },
    ],
    minimumDelay: 16,
  },
  {
    // 醒神香：'基礎 38；智 −0.05／點、反 −0.08／點；最低 20'
    local: 'sober-incense',
    sourceText: '基礎 38；智 −0.05／點、反 −0.08／點；最低 20',
    baseDelay: 38,
    reductions: [
      { primaryAttribute: 'intelligence', reductionPerPoint: 0.05 },
      { primaryAttribute: 'reaction', reductionPerPoint: 0.08 },
    ],
    minimumDelay: 20,
  },
  {
    // 回元膏：'基礎 42；反 −0.08／點、協 −0.05／點；最低 24'
    local: 'returning-origin-paste',
    sourceText: '基礎 42；反 −0.08／點、協 −0.05／點；最低 24',
    baseDelay: 42,
    reductions: [
      { primaryAttribute: 'reaction', reductionPerPoint: 0.08 },
      { primaryAttribute: 'coordination', reductionPerPoint: 0.05 },
    ],
    minimumDelay: 24,
  },
  {
    // 護印香丸：'基礎 44；智 −0.06／點、反 −0.05／點；最低 26'
    local: 'ward-incense-pill',
    sourceText: '基礎 44；智 −0.06／點、反 −0.05／點；最低 26',
    baseDelay: 44,
    reductions: [
      { primaryAttribute: 'intelligence', reductionPerPoint: 0.06 },
      { primaryAttribute: 'reaction', reductionPerPoint: 0.05 },
    ],
    minimumDelay: 26,
  },
  {
    // 五草湯劑：'基礎 48；智 −0.06／點、反 −0.06／點；最低 28'
    local: 'five-herbs-decoction',
    sourceText: '基礎 48；智 −0.06／點、反 −0.06／點；最低 28',
    baseDelay: 48,
    reductions: [
      { primaryAttribute: 'intelligence', reductionPerPoint: 0.06 },
      { primaryAttribute: 'reaction', reductionPerPoint: 0.06 },
    ],
    minimumDelay: 28,
  },
  {
    // 鎮心靈膏：'基礎 42；智 −0.07／點、反 −0.06／點；最低 24'
    local: 'towerheart-elixir',
    sourceText: '基礎 42；智 −0.07／點、反 −0.06／點；最低 24',
    baseDelay: 42,
    reductions: [
      { primaryAttribute: 'intelligence', reductionPerPoint: 0.07 },
      { primaryAttribute: 'reaction', reductionPerPoint: 0.06 },
    ],
    minimumDelay: 24,
  },
  {
    // 回天膏：'基礎 52；智 −0.07／點、反 −0.06／點；最低 30'
    local: 'returning-heaven-paste',
    sourceText: '基礎 52；智 −0.07／點、反 −0.06／點；最低 30',
    baseDelay: 52,
    reductions: [
      { primaryAttribute: 'intelligence', reductionPerPoint: 0.07 },
      { primaryAttribute: 'reaction', reductionPerPoint: 0.06 },
    ],
    minimumDelay: 30,
  },
];

function useDelayRuleId(local: string): UseDelayRuleId {
  return yunhua.id<UseDelayRuleId>('use-delay-rule', local);
}

const useDelayRules: readonly Authored<UseDelayRuleDefinition>[] = DELAY_ROWS.map((row) => ({
  kind: 'use-delay-rule',
  id: useDelayRuleId(row.local),
  baseDelay: row.baseDelay,
  reductions: row.reductions,
  minimumDelay: row.minimumDelay,
}));

// ════════════════════════════════════════════════════════════════════════════
// §2 非戰鬥使用規則（non-combat-use-rule）
// ════════════════════════════════════════════════════════════════════════════
//
// `consumables.nonCombat` 兩列的第三欄都是 `'零時間；地城非戰鬥'`——**同一組時機與情境**，
// 所以一條規則兩筆共用，而不是各發一條（各發一條會讓「兩者其實是同一種使用方式」這件事消失）。
//
// ── 散文判讀 ────────────────────────────────────────────────────────────────
// 來源字串 `'零時間；地城非戰鬥'`
//   → `timing: { kind: 'zeroTime' }`（設計來源的三種寫法對應契約的三個變體：
//      「零時間」→ zeroTime、「迷宮分鐘」→ dungeonMinutes、「Team Plan 日數」→ teamPlanDays）
//   → `allowedContextIds: [item-use-context.yunhua.dungeon-non-combat]`（「地城非戰鬥」）
//
// ⚠ **與 md §10.2 不一致，且本檔採用 data.mjs。** md §10.2 把驅瘴香的使用時間寫成「迷宮分鐘」、
// 合法情境寫成「地城休整或房間互動」，效果寫成「降低下一次瘴息來源的效果」；
// `consumables.nonCombat` 則寫「零時間」「地城非戰鬥」「解除一名角色的瘴霧環境狀態」。
// 依 md §12（實際數字集中在 data.mjs）取後者。回報第 3 節列出。
//
// ⚠ md §10.2 另有兩筆（潤軸油、安營香）並自己寫明「在未有合法 Handler 前，資料必須標為
// `enabled: false`」。`consumables.nonCombat` 已經不含它們（版本 2026-08-16），且它們沒有重量與
// 價值——本檔不發這兩筆，不是漏掉。
const NON_COMBAT_USE_RULE_ID = yunhua.id<NonCombatUseRuleId>(
  'non-combat-use-rule',
  'zero-time-dungeon-non-combat',
);

const nonCombatUseRule: Authored<NonCombatUseRuleDefinition> = {
  kind: 'non-combat-use-rule',
  id: NON_COMBAT_USE_RULE_ID,
  timing: { kind: 'zeroTime' },
  allowedContextIds: [yunhua.id<ItemUseContextId>('item-use-context', 'dungeon-non-combat')],
};

// ════════════════════════════════════════════════════════════════════════════
// §3 戰鬥消耗品（combatConsumable）
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠⚠ **這八筆全部 `enabled: false`，唯一原因是它們的效果無法表達。**
//
// 設計來源給每一筆一個明確效果（治療 120／解除瘴息／自身護印 2 行動…）。承載它的欄位是
// `ItemDefinition.useEffectIds?: readonly EffectDefinitionId[]`，而 `EffectDefinitionId` 屬 core 的
// `effect` 家族——`contracts/core/values.ts` 的 `EffectDefinition` 是封閉判別聯集，八個變體是
// grantItem / consumeActorItem / removeActorCurrency / applyStatus / grantMasteryExperience /
// startDetailedCombat / setWorldFact / changeCityMetric：**沒有 heal、沒有 removeStatus、
// 沒有 adjustCtb**；唯一的 applyStatus 吃 `CharacterStatusDefinitionId` 且 `duration` 沒有單位，
// 而設計來源的護印／定息是**以行動數計時的戰鬥狀態**。
//
// 這八筆需要的正是 `CombatEffectDefinition`（`contracts/combat`）的 heal / removeStatus /
// applyStatus(`durationTargetActions`)——一對一對得上。但那是 `CombatEffectDefinitionId`，另一個
// brand 家族，填不進 `useEffectIds`；要填只能 `as unknown as`，那是規範明令禁止的「用轉型掩蓋
// 契約缺口」。
//
// 為什麼不留 `useEffectIds` 空著、讓物品保持啟用：`src/modules/inventory/system.ts` 的
// `commitCombatItemUse` 已實作且會**接受**該命令，第 529 行 `effectRefs: def.useEffectIds ?? []`
// ——物品會被消耗、事件會發出、什麼都不會發生。那正是規範 §6 點名的「固定成功」。
// 未完成不是錯誤；把未完成偽裝成可用才是。所以整筆不啟用，而不是留一個吃掉道具的空效果。
//
// 契約補上（`useEffectIds` 能承載戰鬥效果家族）之後，移除 `enabled: false` 與加上 effect 引用即可，
// 其餘欄位不必動。
//
// ── 散文判讀（逐筆；來源字串 → 欄位）──────────────────────────────────────
// 判讀規則（人工）：第三欄 `'重量 W／價值 V'` → unitWeight W、intrinsicValue.amount V
// （全角斜線分段；價值含千分位逗號時逐字去掉，例如 `'價值 1,320'` → 1320）。
// 第一欄 `'Tier N'` → 階級標籤。第五欄是效果敘述（本輪無欄位可放，逐筆記在註解）。
// 第六欄是取得定位（本輪只用來判 `tradePolicy.tradable`）。

type CombatConsumableRow = Readonly<{
  local: string;
  tier: ItemTier;
  weightValueText: string;
  unitWeight: number;
  value: number;
  effectText: string;
  sourceText: string;
}>;

// local 名逐字取自 md §10.1 的 `ID／名稱` 欄（`item.yunhua.gold-wound-powder`／金瘡散 …），
// 不另創一套。
const COMBAT_CONSUMABLE_ROWS: readonly CombatConsumableRow[] = [
  {
    // 金瘡散｜'重量 1／價值 24' → unitWeight 1、intrinsicValue.amount 24
    local: 'gold-wound-powder',
    tier: 'I',
    weightValueText: '重量 1／價值 24',
    unitWeight: 1,
    value: 24,
    effectText: '治療 120。', // 需 CombatEffectDefinition.heal
    sourceText: '基礎店貨與基礎製藥配方。',
  },
  {
    // 清瘴丸｜'重量 1／價值 28' → 1、28
    local: 'clear-miasma-pill',
    tier: 'I',
    weightValueText: '重量 1／價值 28',
    unitWeight: 1,
    value: 28,
    effectText: '解除瘴息。', // 需 removeStatus(status.yunhua.miasma)
    sourceText: '霧篁素材配方。',
  },
  {
    // 醒神香｜'重量 1／價值 36' → 1、36
    local: 'sober-incense',
    tier: 'I',
    weightValueText: '重量 1／價值 36',
    unitWeight: 1,
    value: 36,
    effectText: '解除印痕。', // 需 removeStatus(status.yunhua.sigil-mark)
    sourceText: '藥店與漕渠寶箱。',
  },
  {
    // 回元膏｜'重量 1／價值 110' → 1、110
    local: 'returning-origin-paste',
    tier: 'II',
    weightValueText: '重量 1／價值 110',
    unitWeight: 1,
    value: 110,
    effectText: '治療 240。',
    sourceText: '高級製藥書。',
  },
  {
    // 護印香丸｜'重量 1／價值 135' → 1、135
    local: 'ward-incense-pill',
    tier: 'II',
    weightValueText: '重量 1／價值 135',
    unitWeight: 1,
    value: 135,
    effectText: '自身護印 2 行動。', // 需 applyStatus + durationTargetActions 2
    sourceText: '印塔素材配方。',
  },
  {
    // 五草湯劑｜'重量 1／價值 420' → 1、420
    local: 'five-herbs-decoction',
    tier: 'III',
    weightValueText: '重量 1／價值 420',
    unitWeight: 1,
    value: 420,
    effectText: '治療 380；解除瘴息或印痕。',
    sourceText: '探索配方，不進基礎店貨。',
  },
  {
    // 鎮心靈膏｜'重量 1／價值 1,320' → 1、1320（千分位逗號逐字去掉）
    local: 'towerheart-elixir',
    tier: 'IV',
    weightValueText: '重量 1／價值 1,320',
    unitWeight: 1,
    value: 1_320,
    effectText: '治療 520；定息 2 行動。',
    sourceText: 'Boss 素材與極品配方。',
  },
  {
    // 回天膏｜'重量 1／價值 4,600' → 1、4600
    local: 'returning-heaven-paste',
    tier: 'V',
    weightValueText: '重量 1／價值 4,600',
    unitWeight: 1,
    value: 4_600,
    effectText: '治療 720；解除一個負面；護印 2 行動。',
    sourceText: '終局素材與 Boss 配方。',
  },
];

function combatConsumableId(local: string): ItemDefinitionId {
  // ID 前綴 `item` 逐字取自 md §5 的檔案佈局與 §10.1 的 ID 欄（`item.yunhua.*`）。
  // 注意 registry 的 `kind` 與 `ItemDefinition.kind` 是同一個欄位（見
  // `src/app/content/inventory-reader.ts` 的長註解），所以 kind 是 `combatConsumable`，
  // **不是** `item`——ID 前綴與 kind 在物品這一族本來就不同名。
  return yunhua.id<ItemDefinitionId>('item', local);
}

const combatConsumables: readonly Authored<ItemDefinition>[] = COMBAT_CONSUMABLE_ROWS.map((row) => ({
  kind: 'combatConsumable',
  id: combatConsumableId(row.local),
  // 見本節開頭：效果表達不出來，所以整筆不啟用。
  enabled: false,
  originCultureId: CULTURE_ID,
  itemTagIds: [TAG_COMBAT_CONSUMABLE, TIER_TAG[row.tier]],
  stackPolicy: 'stackable',
  unitWeight: row.unitWeight,
  // 「基礎店貨」「藥店」「霧篁素材配方」——每一列都在商店或製作流通。
  tradePolicy: { tradable: true },
  display: nameRef('item', row.local),
  intrinsicValue: { currencyId: CURRENCY_ID, amount: row.value },
  combatUseDelayRuleId: useDelayRuleId(row.local),
  unresolvedMapDisposition: DISPOSITION_TO_STOCK,
}));

// ════════════════════════════════════════════════════════════════════════════
// §4 非戰鬥消耗品（nonCombatConsumable）
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠ 兩筆同樣 `enabled: false`，同一個原因：效果是「解除一名角色的環境狀態」，而 `effect` 家族
// 沒有 removeStatus 變體。`nonCombatUseRuleId`（時機與情境）表達得出來，效果表達不出來——
// 一個只有時機沒有效果的消耗品被用掉就是白吃一個道具。
//
// ── 散文判讀 ────────────────────────────────────────────────────────────────
// 第二欄 `'Tier I／重量 1／價值 22'` → tier I、unitWeight 1、intrinsicValue.amount 22
// （全角斜線三段；與戰鬥消耗品不同的是階級併在同一欄）。
type NonCombatConsumableRow = Readonly<{
  local: string;
  tier: ItemTier;
  headerText: string;
  unitWeight: number;
  value: number;
  effectText: string;
}>;

// local 名逐字取自 md §10.2 的 ID 欄。
const NON_COMBAT_CONSUMABLE_ROWS: readonly NonCombatConsumableRow[] = [
  {
    // 驅瘴香｜'Tier I／重量 1／價值 22' → I、1、22
    local: 'miasma-repelling-incense',
    tier: 'I',
    headerText: 'Tier I／重量 1／價值 22',
    unitWeight: 1,
    value: 22,
    effectText: '解除一名角色的瘴霧環境狀態。',
  },
  {
    // 祛濕膏｜'Tier I／重量 1／價值 20' → I、1、20
    local: 'dry-salve',
    tier: 'I',
    headerText: 'Tier I／重量 1／價值 20',
    unitWeight: 1,
    value: 20,
    effectText: '解除一名角色的潮濕環境狀態。',
  },
];

const nonCombatConsumables: readonly Authored<ItemDefinition>[] = NON_COMBAT_CONSUMABLE_ROWS.map(
  (row) => ({
    kind: 'nonCombatConsumable',
    id: yunhua.id<ItemDefinitionId>('item', row.local),
    enabled: false,
    originCultureId: CULTURE_ID,
    itemTagIds: [TAG_NON_COMBAT_CONSUMABLE, TIER_TAG[row.tier]],
    stackPolicy: 'stackable',
    unitWeight: row.unitWeight,
    tradePolicy: { tradable: true },
    display: nameRef('item', row.local),
    intrinsicValue: { currencyId: CURRENCY_ID, amount: row.value },
    nonCombatUseRuleId: NON_COMBAT_USE_RULE_ID,
    unresolvedMapDisposition: DISPOSITION_TO_STOCK,
  }),
);

// ════════════════════════════════════════════════════════════════════════════
// §5 一般物品（generalItem）
// ════════════════════════════════════════════════════════════════════════════
//
// `consumables.general` 是**五組具名欄位**（`[名稱, 階級, 重量, 價值, 用途]`），不是散文——
// 這一段的判讀風險最低。唯一的判讀是**欄位位置**：第三欄是重量、第四欄是價值。依據是
// `craftingCatalog.materials` 同一份資料寫成 `'重量 2／價值 34'` 的順序，以及 md §10.3
// 「每一件正式 Definition 仍須指定重量與價值」的同一順序。
//
// local 名由本檔鑄造（設計來源的一般物品**沒有給 ID**，md §10.3 只有中文名）。
//
// ⚠ md §10.3 另有第六類「珍藏與器件」（天衡印石座、銅鈴底座、官印銅件、古琴斷軫），
// `consumables.general` 沒有這一組，因此**沒有重量與價值**。本檔不發那四筆——填一個「看起來
// 合理」的重量與價格就是發明經濟內容。
//
// ⚠ **赤參根同時是一般物品與素材**（`consumables.general` 的「藥材與商貨」與
// `craftingCatalog.materials` 的「製藥材料」都有它，重量 1／價值 28 兩邊相同）。md §5 明文
// 「`item`、`material` 分別是不同 Definition，不以名稱字串互相推導」，所以本檔照兩張表各發一筆
// （`item.yunhua.red-ginseng-root` 與 `material.yunhua.red-ginseng-root`），**不合併**。
// 這是設計來源的一個待裁決點，見回報。

type GeneralItemRow = Readonly<{
  local: string;
  chinese: string;
  tier: ItemTier;
  unitWeight: number;
  value: number;
  usageText: string;
}>;

type GeneralCategoryRow = Readonly<{
  categoryLocal: string;
  title: string;
  rows: readonly GeneralItemRow[];
}>;

const GENERAL_ITEM_CATEGORIES: readonly GeneralCategoryRow[] = [
  {
    categoryLocal: 'herbs-and-goods',
    title: '藥材與商貨',
    rows: [
      { local: 'red-ginseng-root', chinese: '赤參根', tier: 'I', unitWeight: 1, value: 28, usageText: '購買、送貨、探索、城市永久庫存。' },
      { local: 'mist-bamboo-tea-brick', chinese: '霧篁茶磚', tier: 'I', unitWeight: 4, value: 46, usageText: '購買、送貨、酒館情報。' },
      { local: 'sinking-reed-bundle', chinese: '沉水草束', tier: 'I', unitWeight: 1, value: 20, usageText: '探索、製藥與購買委託。' },
      { local: 'medicine-bamboo-tube', chinese: '藥竹筒', tier: 'I', unitWeight: 2, value: 34, usageText: '送貨、探索與工藝材料。' },
    ],
  },
  {
    categoryLocal: 'canal-cargo',
    title: '漕運貨物',
    rows: [
      { local: 'canal-manifest', chinese: '漕運貨單', tier: 'I', unitWeight: 1, value: 38, usageText: '送貨、酒館情報。' },
      { local: 'wax-sealed-casket', chinese: '封蠟木匣', tier: 'I', unitWeight: 8, value: 120, usageText: '送貨、購買委託。' },
      { local: 'bronze-scale-weight', chinese: '青銅秤砣', tier: 'I', unitWeight: 5, value: 75, usageText: '探索、購買委託。' },
      { local: 'water-damaged-cloth-roll', chinese: '濕損布卷', tier: 'I', unitWeight: 6, value: 90, usageText: '送貨、工藝加工與購買委託。' },
    ],
  },
  {
    categoryLocal: 'ceramics-and-relics',
    title: '陶器與文物',
    rows: [
      { local: 'attendant-figurine', chinese: '侍從陶俑', tier: 'II', unitWeight: 12, value: 720, usageText: '探索、收藏、購買委託。' },
      { local: 'jade-wine-pot', chinese: '青玉酒壺', tier: 'II', unitWeight: 4, value: 360, usageText: '探索、收藏與購買委託。' },
      { local: 'kiln-marked-shard', chinese: '窯印陶片', tier: 'I', unitWeight: 2, value: 85, usageText: '探索、工藝研究。' },
      { local: 'bronze-lamp-stand', chinese: '銅燈架', tier: 'I', unitWeight: 7, value: 130, usageText: '探索、購買與住家布置。' },
    ],
  },
  {
    categoryLocal: 'furniture',
    title: '家具',
    rows: [
      { local: 'lacquered-bookshelf', chinese: '漆木書架', tier: 'I', unitWeight: 18, value: 220, usageText: '運送、購買與住家布置。' },
      { local: 'herb-cabinet', chinese: '藥材櫃', tier: 'II', unitWeight: 22, value: 460, usageText: '運送、購買與住家布置。' },
      { local: 'woven-bamboo-screen', chinese: '竹編屏風', tier: 'I', unitWeight: 12, value: 250, usageText: '運送、購買與住家布置。' },
      { local: 'low-table', chinese: '矮案', tier: 'I', unitWeight: 14, value: 310, usageText: '運送、購買與住家布置。' },
    ],
  },
  {
    categoryLocal: 'paper-and-documents',
    title: '紙本與文書',
    rows: [
      { local: 'cloud-pattern-paper', chinese: '雲紋宣紙', tier: 'I', unitWeight: 1, value: 18, usageText: '購買、送貨、製符。' },
      { local: 'ancient-edict-fragment', chinese: '古詔殘頁', tier: 'II', unitWeight: 1, value: 150, usageText: '探索、書籍事件與收藏。' },
      { local: 'seal-tower-transcript', chinese: '印塔抄本', tier: 'II', unitWeight: 2, value: 240, usageText: '探索、書籍事件與購買委託。' },
      { local: 'academy-ledger', chinese: '書院帳冊', tier: 'I', unitWeight: 3, value: 180, usageText: '送貨、購買與酒館情報。' },
    ],
  },
];

const generalItems: readonly Authored<ItemDefinition>[] = GENERAL_ITEM_CATEGORIES.flatMap(
  (category) =>
    category.rows.map((row) => ({
      kind: 'generalItem' as const,
      id: yunhua.id<ItemDefinitionId>('item', row.local),
      originCultureId: CULTURE_ID,
      itemTagIds: [TAG_GENERAL_ITEM, TIER_TAG[row.tier]],
      stackPolicy: 'stackable' as const,
      unitWeight: row.unitWeight,
      // 每一列的用途欄都含「購買」「送貨」或「購買委託」。
      tradePolicy: { tradable: true },
      display: nameRef('item', row.local),
      intrinsicValue: { currencyId: CURRENCY_ID, amount: row.value },
      // `general-item-category` 這個 kind 沒有登記（見上方「未登記 kind 的引用」），所以這五個
      // 分類今天沒有人寫得出定義。照實填 ID 而不是省略欄位：省略的語意是「這件物品沒有分類」，
      // 而設計來源明確把二十件物品分成五組。
      generalItemCategoryId: yunhua.id<GeneralItemCategoryId>(
        'general-item-category',
        category.categoryLocal,
      ),
      unresolvedMapDisposition: DISPOSITION_TO_STOCK,
    })),
);

// ════════════════════════════════════════════════════════════════════════════
// §6 素材（material）與素材詞條（material-affix）
// ════════════════════════════════════════════════════════════════════════════
//
// md §5 的規約：「每個素材恰有零或一條 `materialAffixId`。素材自身的文化不被投入配方後改寫；
// 成品文化由配方與輸出 Item Definition 固定。」本節逐條遵守：素材帶零或一條詞條、
// `originCultureId` 一律是雲華、配方各自帶自己的 `originCultureId`。
//
// ── 散文判讀 ────────────────────────────────────────────────────────────────
// `craftingCatalog.materials` 每列是 `[名稱, 階級, '重量 W／價值 V', 詞條敘述, 用途]`。
//   * 第三欄 `'重量 2／價值 34'` → unitWeight 2、intrinsicValue.amount 34。
//   * 第四欄 `'勁直：物理傷害偏肌力'` → 詞條**名稱**取冒號前那段；`'無詞條'` → 不帶 materialAffixId。
//     詞條的 local 名**不從中文推導**——逐筆對到 md §11.1 表格已經給的 affix ID
//     （`affix.yunhua.straight-force` 等），只把前綴改成已登記的 kind 名（見下）。
//
// ⚠ **ID 前綴決定**：md §5 的檔案佈局寫 `material-affixes/affix.yunhua.*.json`，也就是設計來源用
// `affix.` 當前綴。本檔改用 **`material-affix.`**（= 已登記的 kind 名），理由有兩個：
//   1. 本輪的 ID 規約是 `<kind>.yunhua.<local>`，而 `affix` 不是任何已登記的 kind。
//   2. 只有第一段是已登記 kind 的三段式字串才會被編譯期跨引用檢查驗證。用 `affix.` 會讓 19 筆
//      素材對詞條的引用全部落在檢查之外——打錯一個字沒有任何門禁擋得住。
// **local 名逐字沿用 md §11.1**，只換前綴。
//
// ⚠ **本輪不發 Tier III～V 的七筆素材**（漕河青銅、雲銀、古漆、龍紋青鐵、封印青玉、天衡銅心、
// 落星鋼）。md §11.1 有它們與它們的詞條，但 `craftingCatalog.materials` **沒有它們的重量與價值**
// ——`unitWeight` 與 `intrinsicValue` 都是必填。其中漕河青銅是 Tier I 且出現在 md §11.2 的採集表
// （`gathering.yunhua.waterway-reed`），所以它是真的缺一筆數值，不只是「後續內容」。見回報。

type AffixRow = Readonly<{
  local: string;
  chinese: string;
  sourceMaterialText: string;
  applicabilityText: string;
  directionText: string;
  compatibleOutputKinds: readonly ('equipment' | 'cuisine')[];
  tier: 1 | 2 | 3 | 4 | 5;
}>;

// `craftingCatalog.affixes` 十六列，逐列對到 md §11.1 的 affix ID。
//
// `compatibleOutputKinds` 從第三欄（適用範圍）人工判讀：出現武器／盾牌／甲／杖／樂器等裝備部位
// → `equipment`；出現「料理」→ `cuisine`。
// ⚠ **兩處讀不進去的適用範圍**（見回報「契約缺口」）：
//   * 刻印的 `'法杖／符具／工藝品'` 含「工藝品」＝ Trade Good，
//   * 冷食與護食的 `'料理／膏藥'` 含「膏藥」＝消耗品。
//   `compatibleOutputKinds` 的聯集只有 `'equipment' | 'cuisine'`，兩者都表達不出來；而且
//   crafting 不變量 4 明說消耗品「絕不帶精良～鬼神前綴或素材詞條」，所以「膏藥」這半句與契約
//   本身相衝突。本檔只填表達得出的那一半，不擴充也不丟棄——差異記在這裡與回報裡。
//
// `tier` 取**該詞條來源素材的階級**（設計來源沒有單獨給詞條階級）。
// **第一版方案（待討論）**：Tier II 素材的詞條給 2、Tier I 給 1。理由是 md §3.2 把品級與詞條供給
// 綁在一起，而同一條詞條只有一個來源素材（暖食是唯一的兩個來源，兩者都是 Tier I，不衝突）。
const AFFIX_ROWS: readonly AffixRow[] = [
  { local: 'straight-force', chinese: '勁直', sourceMaterialText: '青鐵錠', applicabilityText: '武器／盾牌', directionText: '物理傷害係數向肌力傾斜。', compatibleOutputKinds: ['equipment'], tier: 1 },
  { local: 'quick-hand', chinese: '快手', sourceMaterialText: '霧篁藥竹', applicabilityText: '弓、笛、輕甲、竹器', directionText: '命中係數與迅捷型技能效果方向。', compatibleOutputKinds: ['equipment'], tier: 1 },
  { local: 'light-step', chinese: '輕步', sourceMaterialText: '竹背皮', applicabilityText: '布甲／輕甲', directionText: '迴避係數與定息方向。', compatibleOutputKinds: ['equipment'], tier: 1 },
  { local: 'steady-guard', chinese: '定守', sourceMaterialText: '潮殼', applicabilityText: '盾牌／中甲', directionText: '格擋與格擋吸收 raw 方向。', compatibleOutputKinds: ['equipment'], tier: 1 },
  { local: 'unyielding', chinese: '不屈', sourceMaterialText: '鎖印陶芯', applicabilityText: '中重甲／雙手盾', directionText: '一般減傷 raw 與守勢方向。', compatibleOutputKinds: ['equipment'], tier: 2 },
  // 「工藝品」這一半表達不出來，見本節註解。
  { local: 'inscribed', chinese: '刻印', sourceMaterialText: '印塔石', applicabilityText: '法杖／符具／工藝品', directionText: '符術命中與印痕方向。', compatibleOutputKinds: ['equipment'], tier: 2 },
  { local: 'warding', chinese: '護印', sourceMaterialText: '官朱砂', applicabilityText: '符杖／藥香器', directionText: '護印與魔法減傷 raw 方向。', compatibleOutputKinds: ['equipment'], tier: 2 },
  { local: 'break-mark', chinese: '破印', sourceMaterialText: '斷符墨', applicabilityText: '符紙／單手扇', directionText: '詛咒符與破綻方向。', compatibleOutputKinds: ['equipment'], tier: 2 },
  { local: 'clear-tone', chinese: '清音', sourceMaterialText: '鈴殼', applicabilityText: '竹笛／七弦琴／藥香器', directionText: '演奏治療、解除與定息方向。', compatibleOutputKinds: ['equipment'], tier: 2 },
  { local: 'warming-meal', chinese: '暖食', sourceMaterialText: '赤參根／獾肉', applicabilityText: '料理', directionText: '治療與一般防護方向。', compatibleOutputKinds: ['cuisine'], tier: 1 },
  { local: 'satiety', chinese: '飽足', sourceMaterialText: '穀物', applicabilityText: '料理', directionText: '一般防護方向。', compatibleOutputKinds: ['cuisine'], tier: 1 },
  { local: 'freshness', chinese: '鮮味', sourceMaterialText: '魚材', applicabilityText: '料理', directionText: '命中方向。', compatibleOutputKinds: ['cuisine'], tier: 1 },
  { local: 'aroma', chinese: '清香', sourceMaterialText: '香草', applicabilityText: '料理', directionText: '定息與解除方向。', compatibleOutputKinds: ['cuisine'], tier: 1 },
  // 「膏藥」這一半表達不出來（且與 crafting 不變量 4 相衝），見本節註解。
  { local: 'cooling-meal', chinese: '冷食', sourceMaterialText: '沉水草', applicabilityText: '料理／膏藥', directionText: '護印與解除負面方向。', compatibleOutputKinds: ['cuisine'], tier: 1 },
  { local: 'warding-meal', chinese: '護食', sourceMaterialText: '藥泉薑根', applicabilityText: '料理／膏藥', directionText: '護印與印痕解除方向。', compatibleOutputKinds: ['cuisine'], tier: 2 },
  { local: 'vigor', chinese: '雄健', sourceMaterialText: '獾王肉材', applicabilityText: '料理', directionText: '高量治療與一般防護方向。', compatibleOutputKinds: ['cuisine'], tier: 2 },
];

function materialAffixId(local: string): MaterialAffixId {
  return yunhua.id<MaterialAffixId>('material-affix', local);
}

// `equipmentEffectRefs` 與 `foodAffixId` 都**不填**：
//   * `equipmentEffectRefs` 的每一筆是 `{ effectId: EquipmentEffectDefinitionId }`，而
//     `equipment-effect` 是已登記 kind、擁有者是 combat，本檔無從確認任何 local 名；三段式懸空
//     引用會讓整個 pack 編譯失敗。契約自己也註明這個欄位目前**零消費者**、鏈路要等 backlog G1。
//   * `foodAffixId` 指向 `food-affix`（已登記 kind），但本檔不發 food-affix（見檔頭：`effectByTier`
//     的五個鍵必填、無法留空，而 `effect.yunhua.*` 沒有任何 domain 產出）。填了就是懸空。
// 兩者缺席的後果誠實地寫在回報裡：**這十六條詞條目前只有身分與相容性，沒有效果。**
const materialAffixes: readonly Authored<MaterialAffixDefinition>[] = AFFIX_ROWS.map((row) => ({
  kind: 'material-affix',
  id: materialAffixId(row.local),
  compatibleOutputKinds: [...row.compatibleOutputKinds],
  tier: row.tier,
}));

type MaterialRow = Readonly<{
  local: string;
  chinese: string;
  categoryText: string;
  tier: ItemTier;
  weightValueText: string;
  unitWeight: number;
  value: number;
  affixLocal?: string;
  affixText: string;
  usageText: string;
}>;

// `craftingCatalog.materials` 六組共十九列。local 名逐字取自 md §11.1 的 ID 欄。
const MATERIAL_ROWS: readonly MaterialRow[] = [
  // 武器與工藝材料
  { local: 'green-iron-ingot', chinese: '青鐵錠', categoryText: '武器與工藝材料', tier: 'I', weightValueText: '重量 2／價值 34', unitWeight: 2, value: 34, affixLocal: 'straight-force', affixText: '勁直：物理傷害偏肌力', usageText: '鍛造刀、槍、偃刀、盾。' },
  { local: 'mist-bamboo', chinese: '霧篁藥竹', categoryText: '武器與工藝材料', tier: 'I', weightValueText: '重量 1／價值 26', unitWeight: 1, value: 26, affixLocal: 'quick-hand', affixText: '快手：命中與迅捷技能', usageText: '弓、笛、輕甲、竹器。' },
  // 防具與盾牌材料
  { local: 'bamboo-back-hide', chinese: '竹背皮', categoryText: '防具與盾牌材料', tier: 'I', weightValueText: '重量 2／價值 32', unitWeight: 2, value: 32, affixLocal: 'light-step', affixText: '輕步：迴避與定息', usageText: '布甲、輕甲。' },
  { local: 'tide-shell', chinese: '潮殼', categoryText: '防具與盾牌材料', tier: 'I', weightValueText: '重量 2／價值 30', unitWeight: 2, value: 30, affixLocal: 'steady-guard', affixText: '定守：格擋與格擋吸收', usageText: '盾、中甲。' },
  { local: 'seal-ceramic-core', chinese: '鎖印陶芯', categoryText: '防具與盾牌材料', tier: 'II', weightValueText: '重量 3／價值 135', unitWeight: 3, value: 135, affixLocal: 'unyielding', affixText: '不屈：一般減傷與守勢', usageText: '中重甲、雙手盾。' },
  // 符術材料
  { local: 'seal-stone', chinese: '印塔石', categoryText: '符術材料', tier: 'II', weightValueText: '重量 3／價值 90', unitWeight: 3, value: 90, affixLocal: 'inscribed', affixText: '刻印：符術命中與印痕', usageText: '法杖、符具、工藝品。' },
  { local: 'official-cinnabar', chinese: '官朱砂', categoryText: '符術材料', tier: 'II', weightValueText: '重量 1／價值 110', unitWeight: 1, value: 110, affixLocal: 'warding', affixText: '護印：護印與魔法減傷', usageText: '符杖、護印香丸。' },
  { local: 'frayed-seal-ink', chinese: '斷符墨', categoryText: '符術材料', tier: 'II', weightValueText: '重量 1／價值 96', unitWeight: 1, value: 96, affixLocal: 'break-mark', affixText: '破印：詛咒符與破綻方向', usageText: '符紙、單手扇。' },
  // 樂器材料
  { local: 'bell-shell', chinese: '鈴殼', categoryText: '樂器材料', tier: 'II', weightValueText: '重量 2／價值 100', unitWeight: 2, value: 100, affixLocal: 'clear-tone', affixText: '清音：樂器治療與解除方向', usageText: '樂器、藥香器。' },
  // 製藥材料
  { local: 'mist-wing-powder', chinese: '瘴翅粉', categoryText: '製藥材料', tier: 'I', weightValueText: '重量 1／價值 18', unitWeight: 1, value: 18, affixText: '無詞條', usageText: '清瘴丸、驅瘴香。' },
  { local: 'common-herb', chinese: '常見藥草', categoryText: '製藥材料', tier: 'I', weightValueText: '重量 1／價值 12', unitWeight: 1, value: 12, affixText: '無詞條', usageText: '金瘡散、清瘴丸、基礎料理。' },
  { local: 'red-ginseng-root', chinese: '赤參根', categoryText: '製藥材料', tier: 'I', weightValueText: '重量 1／價值 28', unitWeight: 1, value: 28, affixLocal: 'warming-meal', affixText: '暖食：料理治療方向', usageText: '金瘡散、Tier I～II 料理。' },
  { local: 'sinking-reed', chinese: '沉水草', categoryText: '製藥材料', tier: 'I', weightValueText: '重量 1／價值 20', unitWeight: 1, value: 20, affixLocal: 'cooling-meal', affixText: '冷食：料理解除／護印方向', usageText: '膏藥、Tier I 料理。' },
  // 料理材料
  { local: 'badger-meat', chinese: '獾肉', categoryText: '料理材料', tier: 'I', weightValueText: '重量 2／價值 24', unitWeight: 2, value: 24, affixLocal: 'warming-meal', affixText: '暖食：料理治療方向', usageText: 'Tier I～II 料理。' },
  { local: 'grain', chinese: '穀物', categoryText: '料理材料', tier: 'I', weightValueText: '重量 1／價值 8', unitWeight: 1, value: 8, affixLocal: 'satiety', affixText: '飽足：一般防護方向', usageText: '粥、湯餅與餐館基礎料理。' },
  { local: 'fish', chinese: '魚材', categoryText: '料理材料', tier: 'I', weightValueText: '重量 2／價值 16', unitWeight: 2, value: 16, affixLocal: 'freshness', affixText: '鮮味：命中方向', usageText: '魚羹與蒸魚。' },
  { local: 'aromatic-herb', chinese: '香草', categoryText: '料理材料', tier: 'I', weightValueText: '重量 1／價值 14', unitWeight: 1, value: 14, affixLocal: 'aroma', affixText: '清香：定息與解除方向', usageText: '湯飲與蒸魚。' },
  { local: 'spring-ginger', chinese: '藥泉薑根', categoryText: '料理材料', tier: 'II', weightValueText: '重量 1／價值 74', unitWeight: 1, value: 74, affixLocal: 'warding-meal', affixText: '護食：料理護印方向', usageText: 'Tier II 料理、回元膏。' },
  { local: 'badger-king-meat', chinese: '獾王肉材', categoryText: '料理材料', tier: 'II', weightValueText: '重量 4／價值 110', unitWeight: 4, value: 110, affixLocal: 'vigor', affixText: '雄健：高量治療與一般防護方向', usageText: 'Tier II Boss 料理。' },
];

function materialId(local: string): ItemDefinitionId {
  // ID 前綴 `material` 逐字取自 md §5 與 §11.1（`material.yunhua.green-iron-ingot`）。
  return yunhua.id<ItemDefinitionId>('material', local);
}

const materials: readonly Authored<ItemDefinition>[] = MATERIAL_ROWS.map((row) => ({
  kind: 'material',
  id: materialId(row.local),
  originCultureId: CULTURE_ID,
  itemTagIds: [TAG_MATERIAL, TIER_TAG[row.tier]],
  stackPolicy: 'stackable',
  unitWeight: row.unitWeight,
  // md §11.1：「素材是可被採集、怪物掉落、寶箱取得或**商店庫存流通**的 `material`。」
  tradePolicy: { tradable: true },
  display: nameRef('material', row.local),
  intrinsicValue: { currencyId: CURRENCY_ID, amount: row.value },
  // 身分標籤，供配方槽指名（見上方「未登記 kind 的引用」）。
  materialTagIds: [materialTag(row.local)],
  // md §5：「每個素材恰有零或一條 `materialAffixId`。」`'無詞條'` 的兩筆不帶。
  ...(row.affixLocal === undefined ? {} : { materialAffixId: materialAffixId(row.affixLocal) }),
  unresolvedMapDisposition: DISPOSITION_TO_STOCK,
}));

// ════════════════════════════════════════════════════════════════════════════
// §7 製作配方（crafting-recipe）
// ════════════════════════════════════════════════════════════════════════════
//
// `craftingCatalog.recipes` 四組共 41 列：Tier I 裝備 18、Tier II 裝備 18、製藥 3、工藝 2。
//
// ── 散文判讀 ────────────────────────────────────────────────────────────────
// 第二欄是「品級／日數／MXP（／設施費）」複合字串：
//   * `'一般／1 日／MXP 400'`        → outputRarity common、craftingDurationDays 1、Tier I MXP 規則
//   * `'精品／2 日／MXP 1,000'`      → outputRarity fine、craftingDurationDays 2、Tier II MXP 規則
//   * `'Tier I／1 日／MXP 400'`      → （製藥）Tier I、1 日
//   * `'Tier I／1 日／MXP 400／設施費 12'` → （工藝）Tier I、1 日、**設施費 12 無欄位可放**
// 第三欄是素材需求：`'青鐵錠 ×1、潮殼 ×1'` → 兩個 ingredient slot，quantity 各 1。
// 第四欄是產物規則敘述（`'裝備；品質決定 0～1 條詞條。'` 等），用來判 `contributesEquipmentAffix`。
//
// ⚠ **設施費（12／30）沒有欄位。** `craftingCatalog.economyRules` 明列「Tier I 工藝設施費｜每次 12」
// 與「Tier II｜每次 30」，`CraftingRecipeDefinition` 沒有任何費用欄位，`price-rule` 也不在本檔的
// kind 範圍內。同一組 economyRules 的「商店收購｜標示價值 ×50%」也一樣沒有落點。見回報。
//
// ── outputDefinitionId：配方名 → 裝備 ID ───────────────────────────────────
// 裝備定義屬另一個 domain。**但它的 ID 不需要猜**：`yunhua_content.data.mjs` 自己就有
// `id: \`equipment.yunhua.${blueprint.id}.${meta.tier.toLowerCase()}\``，而配方的中文名逐字等於
// 同一個 blueprint 的 `names[0]`（Tier I）與 `names[1]`（Tier II）。下面 36 列的對應是用這兩份
// 名單逐名比對出來的，不是音譯。
// 註：`equipment.yunhua.<blueprint>.<tier>` 是**四段**，落在編譯期跨引用檢查的三段式判準之外，
// 所以這 36 筆引用不會被自動驗證——對錯只靠上面那份名單。
//
// ── requiredMasteries：本節最大的判讀 ──────────────────────────────────────
// **設計來源沒有逐配方指定製作熟練度。** 可用的線索只有 md §11.3 的表：
//   * 那張表的「產物規則」欄把五種製作類型的產物固定住：鍛造→裝備、裁縫→裝備、製藥→消耗品、
//     工藝→**Trade Good**、廚藝→FoodStatus。也就是說**只有鍛造與裁縫產出裝備**。
//   * 裁縫的示例是「青岑布衣、竹面皮甲、藥囊 ／ 素紋罩袍、魚鱗輕甲、雲紋皮札」＝布甲與輕甲；
//     鍛造的示例含刀、槍、偃刀、盾與札甲。
// 於是本檔採用一條**由那張表導出**的規則：**輸出是布甲或輕甲 → 裁縫；其餘裝備 → 鍛造。**
// **第一版方案（待討論）**：竹弓、竹笛、桐木短琴、桃木／桑木長杖由「鍛造」製作在敘事上很怪，
// 直覺上屬工藝；但 md §11.3 明說工藝的產物是 Trade Good，把它們掛到工藝就是自己發明一條
// 「工藝也能產裝備」的規則。要改的話該從 md §11.3 那張表改起，本檔跟。
// 這條判讀同時決定 `craftingExperienceRuleId`（`craft-<mastery>-tier-<i|ii>`），所以它不是純標籤：
// 選錯熟練度會把 MXP 記到錯的熟練度上。
//
// ── requiredMasteries.minLevel ─────────────────────────────────────────────
// 取自 `craftingCatalog.books.crafting`：基礎書（`《青鐵鍛作》`＝Tier I 鍛造配方、
// `《山藥散方》`＝Tier I 製藥配方、`《家常湯餅》`＝Tier I 料理配方）一律 `'Lv.3'`；
// 高級書（`《沉倉藥錄》`＝Tier II 製藥、`《鎖印陶作》`＝Tier II 鍛造／工藝、
// `《藥泉食單》`＝Tier II～III 料理）一律 `'Lv.6'`。md §11.5 同一張表也寫「基礎書｜Lv.3 所需的
// 基礎技能與 Tier I 配方」「高級書｜Lv.6 技能與 Tier II～III 配方」。
// 所以 **Tier I 配方 → minLevel 3、Tier II 配方 → minLevel 6**。
// ⚠ 裁縫在整份書單裡**沒有任何一本書**（基礎書只有鍛造、製符／製藥、製藥、料理四本），
// 所以裁縫配方的等級門檻是按階級類推的，不是書單直接給的。見回報。
const TIER_I_MIN_LEVEL = 3;
const TIER_II_MIN_LEVEL = 6;

function slotId(index: number): CraftingIngredientSlotId {
  // TemplateLocalId：只需在所屬配方內唯一（見 crafting-reader.ts 的註解）。
  return `slot-${index + 1}` as CraftingIngredientSlotId;
}

function ingredientSlots(
  materialLocals: readonly Readonly<{ local: string; quantity: number }>[],
  contributesEquipmentAffix: boolean,
): CraftingIngredientSlotDefinition[] {
  return materialLocals.map((entry, index) => ({
    slotId: slotId(index),
    acceptedMaterialTagIds: [materialTag(entry.local)],
    quantity: entry.quantity,
    contributesEquipmentAffix,
  }));
}

function mastery(masteryId: MasteryId, minLevel: number): MasteryRequirement[] {
  return [{ masteryId, minLevel }];
}

// ── §7.1 裝備配方（36 筆）───────────────────────────────────────────────────
//
// `contributesEquipmentAffix: true`：第四欄逐列寫「品質決定 0～1 條詞條」（Tier I，1 個素材）
// 與「品質決定 0～2 條詞條」（Tier II，2 個素材）——詞條上限恰等於素材槽數，所以每一槽都是
// 一個候選詞條來源。md §11.3 的「每一筆裝備配方的材料總數必須與其 `outputRarity` 一致：
// 一般 1、精品 2…」也對得上（Tier I 一般 1 槽、Tier II 精品 2 槽）。
type EquipmentRecipeRow = Readonly<{
  recipeLocal: string;
  chinese: string;
  blueprint: string;
  equipmentTier: 'i' | 'ii';
  outputRarity: 'common' | 'fine';
  durationDays: number;
  tailoring: boolean;
  ingredients: readonly Readonly<{ local: string; quantity: number }>[];
  sourceText: string;
}>;

const EQUIPMENT_RECIPE_ROWS: readonly EquipmentRecipeRow[] = [
  // 裝備製作｜Tier I 一般（'一般／1 日／MXP 400'；素材各 ×1）
  { recipeLocal: 'ring-saber-i', chinese: '環首短刀', blueprint: 'ring-saber', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }], sourceText: '青鐵錠 ×1' },
  { recipeLocal: 'iron-fan-i', chinese: '鐵骨折扇', blueprint: 'iron-fan', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }], sourceText: '青鐵錠 ×1' },
  { recipeLocal: 'spear-i', chinese: '棗木長槍', blueprint: 'spear', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }], sourceText: '霧篁藥竹 ×1' },
  { recipeLocal: 'glaive-i', chinese: '木柄偃刀', blueprint: 'glaive', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }], sourceText: '青鐵錠 ×1' },
  { recipeLocal: 'needle-i', chinese: '飛針囊', blueprint: 'needle', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }], sourceText: '青鐵錠 ×1' },
  { recipeLocal: 'chain-weight-i', chinese: '鐵蒺藜袋', blueprint: 'chain-weight', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }], sourceText: '青鐵錠 ×1' },
  { recipeLocal: 'bamboo-bow-i', chinese: '竹弓', blueprint: 'bamboo-bow', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }], sourceText: '霧篁藥竹 ×1' },
  { recipeLocal: 'repeating-crossbow-i', chinese: '手弩', blueprint: 'repeating-crossbow', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }], sourceText: '霧篁藥竹 ×1' },
  { recipeLocal: 'one-hand-staff-i', chinese: '桃木短杖', blueprint: 'one-hand-staff', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }], sourceText: '霧篁藥竹 ×1' },
  { recipeLocal: 'two-hand-staff-i', chinese: '桑木長杖', blueprint: 'two-hand-staff', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }], sourceText: '霧篁藥竹 ×1' },
  { recipeLocal: 'bamboo-flute-i', chinese: '竹笛', blueprint: 'bamboo-flute', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }], sourceText: '霧篁藥竹 ×1' },
  { recipeLocal: 'seven-string-i', chinese: '桐木短琴', blueprint: 'seven-string', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }], sourceText: '霧篁藥竹 ×1' },
  { recipeLocal: 'cloth-i', chinese: '青岑布衣', blueprint: 'cloth', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: true, ingredients: [{ local: 'bamboo-back-hide', quantity: 1 }], sourceText: '竹背皮 ×1' },
  { recipeLocal: 'light-armor-i', chinese: '竹面皮甲', blueprint: 'light-armor', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: true, ingredients: [{ local: 'bamboo-back-hide', quantity: 1 }], sourceText: '竹背皮 ×1' },
  { recipeLocal: 'medium-armor-i', chinese: '皮襯札甲', blueprint: 'medium-armor', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'tide-shell', quantity: 1 }], sourceText: '潮殼 ×1' },
  { recipeLocal: 'heavy-armor-i', chinese: '鐵葉重札', blueprint: 'heavy-armor', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }], sourceText: '青鐵錠 ×1' },
  { recipeLocal: 'one-hand-shield-i', chinese: '藤編小盾', blueprint: 'one-hand-shield', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }], sourceText: '霧篁藥竹 ×1' },
  { recipeLocal: 'two-hand-shield-i', chinese: '木骨大牌', blueprint: 'two-hand-shield', equipmentTier: 'i', outputRarity: 'common', durationDays: 1, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }], sourceText: '霧篁藥竹 ×1' },
  // 裝備製作｜Tier II 精品（'精品／2 日／MXP 1,000'；兩個素材各 ×1）
  { recipeLocal: 'ring-saber-ii', chinese: '雲紋佩刀', blueprint: 'ring-saber', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }, { local: 'tide-shell', quantity: 1 }], sourceText: '青鐵錠 ×1、潮殼 ×1' },
  { recipeLocal: 'iron-fan-ii', chinese: '漆紋鐵扇', blueprint: 'iron-fan', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }, { local: 'frayed-seal-ink', quantity: 1 }], sourceText: '青鐵錠 ×1、斷符墨 ×1' },
  { recipeLocal: 'spear-ii', chinese: '青鐵長槍', blueprint: 'spear', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }, { local: 'mist-bamboo', quantity: 1 }], sourceText: '青鐵錠 ×1、霧篁藥竹 ×1' },
  { recipeLocal: 'glaive-ii', chinese: '月牙偃刀', blueprint: 'glaive', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }, { local: 'seal-stone', quantity: 1 }], sourceText: '青鐵錠 ×1、印塔石 ×1' },
  { recipeLocal: 'needle-ii', chinese: '銅尾飛針', blueprint: 'needle', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }, { local: 'frayed-seal-ink', quantity: 1 }], sourceText: '青鐵錠 ×1、斷符墨 ×1' },
  { recipeLocal: 'chain-weight-ii', chinese: '青鐵流星錘', blueprint: 'chain-weight', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }, { local: 'tide-shell', quantity: 1 }], sourceText: '青鐵錠 ×1、潮殼 ×1' },
  { recipeLocal: 'bamboo-bow-ii', chinese: '漆背角弓', blueprint: 'bamboo-bow', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }, { local: 'bamboo-back-hide', quantity: 1 }], sourceText: '霧篁藥竹 ×1、竹背皮 ×1' },
  { recipeLocal: 'repeating-crossbow-ii', chinese: '連珠弩', blueprint: 'repeating-crossbow', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }, { local: 'green-iron-ingot', quantity: 1 }], sourceText: '霧篁藥竹 ×1、青鐵錠 ×1' },
  { recipeLocal: 'one-hand-staff-ii', chinese: '朱砂令杖', blueprint: 'one-hand-staff', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }, { local: 'official-cinnabar', quantity: 1 }], sourceText: '霧篁藥竹 ×1、官朱砂 ×1' },
  { recipeLocal: 'two-hand-staff-ii', chinese: '銅鈴長杖', blueprint: 'two-hand-staff', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }, { local: 'bell-shell', quantity: 1 }], sourceText: '霧篁藥竹 ×1、鈴殼 ×1' },
  { recipeLocal: 'bamboo-flute-ii', chinese: '銅節簫', blueprint: 'bamboo-flute', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }, { local: 'bell-shell', quantity: 1 }], sourceText: '霧篁藥竹 ×1、鈴殼 ×1' },
  { recipeLocal: 'seven-string-ii', chinese: '漆面七弦', blueprint: 'seven-string', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }, { local: 'bell-shell', quantity: 1 }], sourceText: '霧篁藥竹 ×1、鈴殼 ×1' },
  { recipeLocal: 'cloth-ii', chinese: '素紋罩袍', blueprint: 'cloth', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: true, ingredients: [{ local: 'bamboo-back-hide', quantity: 1 }, { local: 'official-cinnabar', quantity: 1 }], sourceText: '竹背皮 ×1、官朱砂 ×1' },
  { recipeLocal: 'light-armor-ii', chinese: '魚鱗輕甲', blueprint: 'light-armor', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: true, ingredients: [{ local: 'bamboo-back-hide', quantity: 1 }, { local: 'tide-shell', quantity: 1 }], sourceText: '竹背皮 ×1、潮殼 ×1' },
  { recipeLocal: 'medium-armor-ii', chinese: '青鐵札甲', blueprint: 'medium-armor', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }, { local: 'bamboo-back-hide', quantity: 1 }], sourceText: '青鐵錠 ×1、竹背皮 ×1' },
  { recipeLocal: 'heavy-armor-ii', chinese: '鎮關重鎧', blueprint: 'heavy-armor', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'green-iron-ingot', quantity: 1 }, { local: 'seal-ceramic-core', quantity: 1 }], sourceText: '青鐵錠 ×1、鎖印陶芯 ×1' },
  { recipeLocal: 'one-hand-shield-ii', chinese: '圓木鐵緣盾', blueprint: 'one-hand-shield', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }, { local: 'green-iron-ingot', quantity: 1 }], sourceText: '霧篁藥竹 ×1、青鐵錠 ×1' },
  { recipeLocal: 'two-hand-shield-ii', chinese: '漕關門盾', blueprint: 'two-hand-shield', equipmentTier: 'ii', outputRarity: 'fine', durationDays: 2, tailoring: false, ingredients: [{ local: 'mist-bamboo', quantity: 1 }, { local: 'tide-shell', quantity: 1 }], sourceText: '霧篁藥竹 ×1、潮殼 ×1' },
];

const equipmentRecipes: readonly Authored<CraftingRecipeDefinition>[] = EQUIPMENT_RECIPE_ROWS.map(
  (row) => ({
    kind: 'crafting-recipe',
    id: yunhua.id<CraftingRecipeId>('crafting-recipe', row.recipeLocal),
    originCultureId: CULTURE_ID,
    outputKind: 'equipment',
    // 四段式 ID，逐字沿用設計來源自己的 `makeEquipmentLine` 公式。
    outputDefinitionId: `equipment.yunhua.${row.blueprint}.${row.equipmentTier}` as ItemDefinitionId,
    outputRarity: row.outputRarity,
    requiredMasteries: mastery(
      row.tailoring ? MASTERY_TAILORING : MASTERY_SMITHING,
      row.equipmentTier === 'i' ? TIER_I_MIN_LEVEL : TIER_II_MIN_LEVEL,
    ),
    // md §11.3：鍛造與裁縫都在「裝備店工坊」。
    requiredFacilityKind: 'equipmentShop',
    craftingDurationDays: row.durationDays,
    ingredientSlots: ingredientSlots(row.ingredients, true),
    craftingExperienceRuleId: craftExperienceRule(
      row.tailoring ? 'tailoring' : 'smithing',
      row.equipmentTier,
    ),
    outcomeResolverId: OUTCOME_RESOLVER_EQUIPMENT,
    qualityRuleId: QUALITY_RULE_EQUIPMENT,
  }),
);

// ── §7.2 製藥配方（3 筆）────────────────────────────────────────────────────
//
// 產物是本檔 §3 的戰鬥消耗品（ID 存在，但目前 `enabled: false`——見 §3 的理由）。
// 配方本身的資料是完整的，所以配方**保持啟用**：能不能做出一瓶藥、以及那瓶藥用起來有沒有效，
// 是兩個不同的事實，各由自己那筆定義的 `enabled` 表達。整合者若決定連配方一起關，改這裡即可。
//
// `contributesEquipmentAffix: false`：md §11.3「消耗品；不產生前綴或詞條，品質只提高產量」，
// 且 crafting 不變量 4 明說消耗品絕不帶素材詞條。
type AlchemyRecipeRow = Readonly<{
  recipeLocal: string;
  chinese: string;
  outputLocal: string;
  tier: 'i' | 'ii';
  durationDays: number;
  ingredients: readonly Readonly<{ local: string; quantity: number }>[];
  headerText: string;
  ingredientText: string;
  outputText: string;
}>;

const ALCHEMY_RECIPE_ROWS: readonly AlchemyRecipeRow[] = [
  {
    // 'Tier I／1 日／MXP 400' → Tier I、1 日；'赤參根 ×1、常見藥草 ×1' → 兩槽各 1
    recipeLocal: 'gold-wound-powder',
    chinese: '金瘡散',
    outputLocal: 'gold-wound-powder',
    tier: 'i',
    durationDays: 1,
    ingredients: [{ local: 'red-ginseng-root', quantity: 1 }, { local: 'common-herb', quantity: 1 }],
    headerText: 'Tier I／1 日／MXP 400',
    ingredientText: '赤參根 ×1、常見藥草 ×1',
    outputText: '消耗品；成功產量 2，製藥 Lv.4 起每 2 級 +1。',
  },
  {
    recipeLocal: 'clear-miasma-pill',
    chinese: '清瘴丸',
    outputLocal: 'clear-miasma-pill',
    tier: 'i',
    durationDays: 1,
    ingredients: [{ local: 'mist-wing-powder', quantity: 1 }, { local: 'common-herb', quantity: 1 }],
    headerText: 'Tier I／1 日／MXP 400',
    ingredientText: '瘴翅粉 ×1、常見藥草 ×1',
    outputText: '消耗品；成功產量 2，製藥 Lv.4 起每 2 級 +1。',
  },
  {
    // 'Tier II／2 日／MXP 1,000' → Tier II、2 日；三個素材各 ×1
    recipeLocal: 'returning-origin-paste',
    chinese: '回元膏',
    outputLocal: 'returning-origin-paste',
    tier: 'ii',
    durationDays: 2,
    ingredients: [
      { local: 'red-ginseng-root', quantity: 1 },
      { local: 'sinking-reed', quantity: 1 },
      { local: 'spring-ginger', quantity: 1 },
    ],
    headerText: 'Tier II／2 日／MXP 1,000',
    ingredientText: '赤參根 ×1、沉水草 ×1、藥泉薑根 ×1',
    outputText: '消耗品；成功產量 2，製藥 Lv.4 起每 2 級 +1。',
  },
];

const alchemyRecipes: readonly Authored<CraftingRecipeDefinition>[] = ALCHEMY_RECIPE_ROWS.map(
  (row) => ({
    kind: 'crafting-recipe',
    id: yunhua.id<CraftingRecipeId>('crafting-recipe', row.recipeLocal),
    originCultureId: CULTURE_ID,
    outputKind: 'consumable',
    outputDefinitionId: combatConsumableId(row.outputLocal),
    // `outputRarity` 不填：契約註明「僅 equipment，基礎係數預算的唯一來源」。
    requiredMasteries: mastery(
      MASTERY_ALCHEMY,
      row.tier === 'i' ? TIER_I_MIN_LEVEL : TIER_II_MIN_LEVEL,
    ),
    // md §11.3：製藥在「道具店工坊」。
    requiredFacilityKind: 'itemShop',
    craftingDurationDays: row.durationDays,
    ingredientSlots: ingredientSlots(row.ingredients, false),
    craftingExperienceRuleId: craftExperienceRule('alchemy', row.tier),
    outcomeResolverId: OUTCOME_RESOLVER_CONSUMABLE,
    qualityRuleId: QUALITY_RULE_CONSUMABLE,
    // 契約：`outputKind === 'consumable'` 時必填。產量曲線（成功 2、Lv.4 起每 2 級 +1）
    // 是這個 Resolver 的 params，契約沒有 params 欄位——見回報。
    consumableYieldResolverId: CONSUMABLE_YIELD_RESOLVER,
  }),
);

// ── §7.3 工藝配方（2 筆）────────────────────────────────────────────────────
//
// 產物是本檔 §5 的一般物品（漆木書架、侍從陶俑）。
// `contributesEquipmentAffix: false`：第四欄「Trade Good；…品質只改出售倍率」，
// md §11.3 也寫工藝品「不繼承素材詞條」。
//
// ⚠ 第二欄的「設施費 12」「設施費 30」與第四欄的「基準收購 110／360」「基準淨利 46／52.5 每日」
// **全部沒有欄位可放**（見本節開頭）。
type HandicraftRecipeRow = Readonly<{
  recipeLocal: string;
  chinese: string;
  outputLocal: string;
  tier: 'i' | 'ii';
  durationDays: number;
  ingredients: readonly Readonly<{ local: string; quantity: number }>[];
  headerText: string;
  ingredientText: string;
  outputText: string;
}>;

const HANDICRAFT_RECIPE_ROWS: readonly HandicraftRecipeRow[] = [
  {
    // 'Tier I／1 日／MXP 400／設施費 12' → Tier I、1 日、（設施費 12 無落點）
    // '霧篁藥竹 ×2' → 一槽、quantity 2
    recipeLocal: 'lacquered-bookshelf',
    chinese: '漆木書架',
    outputLocal: 'lacquered-bookshelf',
    tier: 'i',
    durationDays: 1,
    ingredients: [{ local: 'mist-bamboo', quantity: 2 }],
    headerText: 'Tier I／1 日／MXP 400／設施費 12',
    ingredientText: '霧篁藥竹 ×2',
    outputText: 'Trade Good；基準收購 110，成功時基準淨利 46／日；品質只改出售倍率。',
  },
  {
    // 'Tier II／2 日／MXP 1,000／設施費 30' → Tier II、2 日、（設施費 30 無落點）
    recipeLocal: 'attendant-figurine',
    chinese: '侍從陶俑',
    outputLocal: 'attendant-figurine',
    tier: 'ii',
    durationDays: 2,
    ingredients: [{ local: 'seal-ceramic-core', quantity: 1 }, { local: 'seal-stone', quantity: 1 }],
    headerText: 'Tier II／2 日／MXP 1,000／設施費 30',
    ingredientText: '鎖印陶芯 ×1、印塔石 ×1',
    outputText: 'Trade Good；基準收購 360，成功時基準淨利 52.5／日；品質只改出售倍率。',
  },
];

const handicraftRecipes: readonly Authored<CraftingRecipeDefinition>[] =
  HANDICRAFT_RECIPE_ROWS.map((row) => ({
    kind: 'crafting-recipe',
    id: yunhua.id<CraftingRecipeId>('crafting-recipe', row.recipeLocal),
    originCultureId: CULTURE_ID,
    outputKind: 'tradeGood',
    outputDefinitionId: yunhua.id<ItemDefinitionId>('item', row.outputLocal),
    requiredMasteries: mastery(
      MASTERY_HANDICRAFT,
      row.tier === 'i' ? TIER_I_MIN_LEVEL : TIER_II_MIN_LEVEL,
    ),
    // md §11.3：工藝在「道具店工坊」。
    requiredFacilityKind: 'itemShop',
    craftingDurationDays: row.durationDays,
    ingredientSlots: ingredientSlots(row.ingredients, false),
    craftingExperienceRuleId: craftExperienceRule('handicraft', row.tier),
    outcomeResolverId: OUTCOME_RESOLVER_TRADE_GOOD,
    qualityRuleId: QUALITY_RULE_TRADE_GOOD,
    // 契約：`outputKind === 'tradeGood'` 時必填。
    tradeGoodSaleMultiplierResolverId: TRADE_GOOD_SALE_MULTIPLIER_RESOLVER,
  }));

// ════════════════════════════════════════════════════════════════════════════
// §8 料理食譜（cuisine-recipe）
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠⚠ **這六筆全部 `enabled: false`，唯一原因是 `baseFoodEffectIds` 寫不出來。**
// 它是必填的 `EffectDefinitionId[]`，而 `effect` 是已登記 kind：三段式引用必須解析得到，
// 本輪沒有任何 domain 產出 `effect.yunhua.*`。更根本的是 `crafting-reader.ts` 的 `getFoodEffect`
// 讀 `characterStatusId`，而 `EffectDefinition` 的 applyStatus 變體欄位叫 `statusId`——**欄名對不上**，
// 料理效果就算寫出來也讀不到（見回報「契約缺口」）。
// 留空陣列＋不啟用，而不是留空陣列＋啟用：一份「維持 3 日但什麼都不給」的料理會佔住 FoodStatus
// 並封鎖三天內的再次進食（md §11.4），那比沒有這道菜更糟。
//
// ── 散文判讀 ────────────────────────────────────────────────────────────────
// `craftingCatalog.cuisine` 每列是 `[名稱, 'Tier N／MXP M／維持 D 日', 食材, 效果方向, 備註]`。
//   * 第二欄三段：`'Tier I／MXP 400／維持 3 日'` → Tier I、（MXP 400 → `cuisine-tier-i`）、
//     foodStatusDurationDays 3；`'Tier II／MXP 1,000／維持 6 日'` → Tier II、6 日。
//   * 第三欄 `'霧篁藥竹＋獾肉'` → 兩個素材槽（全角加號分隔）。**沒有數量**——與製作配方的
//     `×1` 寫法不同。**第一版方案（待討論）**：每槽 quantity 1，理由是設計來源在需要多份時
//     會寫出來（`霧篁藥竹 ×2`），沒寫就是一份。
//   * 第四欄是效果方向（本輪無落點，見上）。
//   * 第五欄 `'青岑餐館版本：所有詞條 Tier 1，MXP 133。'` → 有餐館版本；`'只能自製。'` → 沒有。
//     133／400 = 1/3，與契約 `restaurantExperienceMultiplier` 的目標值一致。
type CuisineRow = Readonly<{
  local: string;
  chinese: string;
  tier: 'i' | 'ii';
  durationDays: number;
  ingredients: readonly string[];
  restaurantVariantLocal?: string;
  headerText: string;
  ingredientText: string;
  directionText: string;
  noteText: string;
}>;

// md §11.4 另有「天衡宴」（Tier V），但該表自己的註明寫「其 MXP／維持日數尚未定案；第一版料理
// 資料（`craftingCatalog.cuisine`）只含 Tier I／II，故不納入，也不自行編造數值」。本檔照辦。
const CUISINE_ROWS: readonly CuisineRow[] = [
  {
    local: 'bamboo-shoot-pork-soup',
    chinese: '竹筍肉湯',
    tier: 'i',
    durationDays: 3,
    ingredients: ['mist-bamboo', 'badger-meat'],
    restaurantVariantLocal: 'qingcen-bamboo-shoot-pork-soup',
    headerText: 'Tier I／MXP 400／維持 3 日',
    ingredientText: '霧篁藥竹＋獾肉',
    directionText: '定息、一般防護方向',
    noteText: '青岑餐館版本：所有詞條 Tier 1，MXP 133。',
  },
  {
    local: 'red-ginseng-congee',
    chinese: '赤參粥',
    tier: 'i',
    durationDays: 3,
    ingredients: ['red-ginseng-root', 'grain'],
    restaurantVariantLocal: 'qingcen-red-ginseng-congee',
    headerText: 'Tier I／MXP 400／維持 3 日',
    ingredientText: '赤參根＋穀物',
    directionText: '治療、定息方向',
    noteText: '青岑餐館版本：所有詞條 Tier 1，MXP 133。',
  },
  {
    local: 'canal-fish-stew',
    chinese: '漕河魚羹',
    tier: 'i',
    durationDays: 3,
    ingredients: ['sinking-reed', 'fish'],
    restaurantVariantLocal: 'yunjing-canal-fish-stew',
    headerText: 'Tier I／MXP 400／維持 3 日',
    ingredientText: '沉水草＋魚材',
    directionText: '護印、解除方向',
    noteText: '雲京餐館版本：所有詞條 Tier 1，MXP 133。',
  },
  {
    local: 'spring-braised-meat',
    chinese: '藥泉燉肉',
    tier: 'ii',
    durationDays: 6,
    ingredients: ['badger-king-meat', 'red-ginseng-root'],
    headerText: 'Tier II／MXP 1,000／維持 6 日',
    ingredientText: '獾王肉材＋赤參根',
    directionText: '一般防護、治療方向',
    noteText: '只能自製。',
  },
  {
    local: 'spring-ginger-broth',
    chinese: '藥泉薑湯',
    tier: 'ii',
    durationDays: 6,
    ingredients: ['spring-ginger', 'aromatic-herb'],
    headerText: 'Tier II／MXP 1,000／維持 6 日',
    ingredientText: '藥泉薑根＋香草',
    directionText: '護印、印痕解除方向',
    noteText: '只能自製。',
  },
  {
    local: 'clear-tone-steamed-fish',
    chinese: '清音蒸魚',
    tier: 'ii',
    durationDays: 6,
    ingredients: ['aromatic-herb', 'fish', 'spring-ginger'],
    headerText: 'Tier II／MXP 1,000／維持 6 日',
    ingredientText: '香草＋魚材＋藥泉薑根',
    directionText: '命中、定息與護印方向',
    noteText: '只能自製。',
  },
];

// md §11.4／crafting 不變量 7：餐館基礎料理的 MXP「固定為同級自製的 1/3」。設計來源的實際數字
// （自製 MXP 400 → 餐館 133）就是 round(400 × 1/3)。契約把它放在食譜上（隨食譜走＝文化內容），
// 所以每一筆都填 1/3——包含三筆「只能自製」的：那三筆沒有餐館版本，這個倍率永遠不會被用到，
// 但欄位必填，填 1/3 至少與其他三筆同義。
const RESTAURANT_EXPERIENCE_MULTIPLIER = 1 / 3;

function cuisineIngredientSlots(materialLocals: readonly string[]): CuisineIngredientSlotDefinition[] {
  return materialLocals.map((local, index) => ({
    slotId: slotId(index),
    acceptedMaterialTagIds: [materialTag(local)],
    quantity: 1,
  }));
}

const cuisineRecipes: readonly Authored<CuisineRecipeDefinition>[] = CUISINE_ROWS.map((row) => ({
  kind: 'cuisine-recipe',
  id: yunhua.id<CuisineRecipeId>('cuisine-recipe', row.local),
  // 見本節開頭：基礎效果寫不出來，所以整筆不啟用。
  enabled: false,
  originCultureId: CULTURE_ID,
  requiredMasteries: mastery(
    MASTERY_COOKING,
    row.tier === 'i' ? TIER_I_MIN_LEVEL : TIER_II_MIN_LEVEL,
  ),
  ingredientSlots: cuisineIngredientSlots(row.ingredients),
  // 空陣列＋不啟用。填 `effect.yunhua.*` 會是懸空引用（`effect` 是已登記 kind，會擋下整個 pack）。
  baseFoodEffectIds: [],
  foodStatusDurationDays: row.durationDays,
  cookingExperienceRuleId: cuisineExperienceRule(row.tier),
  foodAffixTierResolverId: FOOD_AFFIX_TIER_RESOLVER,
  // `restaurant-meal-variant` 這個 kind 沒有登記（見上方「未登記 kind 的引用」），所以這三筆
  // 今天沒有人寫得出定義。照實填而不是省略：省略的語意是「這道菜沒有餐館版本」，而設計來源
  // 明確給了三道菜的餐館版本與 MXP。
  ...(row.restaurantVariantLocal === undefined
    ? {}
    : {
        restaurantBaseVariantId: yunhua.id<RestaurantMealVariantId>(
          'restaurant-meal-variant',
          row.restaurantVariantLocal,
        ),
      }),
  restaurantExperienceMultiplier: RESTAURANT_EXPERIENCE_MULTIPLIER,
}));

// ════════════════════════════════════════════════════════════════════════════
// 匯出
// ════════════════════════════════════════════════════════════════════════════

// ── 顯示名 ─────────────────────────────────────────────────────────────────
//
// 中文逐字取自設計來源 `docs/03_content/yunhua/yunhua_content.data.mjs`
// （`consumables.combat` / `.nonCombat` / `.general`、`materials`）；英文是這一輪授權的翻譯
// （意譯為主，專名保留：霧篁 Mistbamboo、印塔 Seal Tower）。
//
// key 用**同一個** `nameRef()` 產生，不是重打一次字串——所以「有 nameRef 卻沒有文字」與
// 「有文字卻沒人引用」兩邊都由 Compiler 檢查得到，抄錯一個字母就會在編譯期現形。
const ITEM_TEXTS: readonly AuthoredText[] = [
  { key: nameRef('item', 'academy-ledger').nameRef.key, name: { 'zh-Hant': '書院帳冊', en: 'Academy Ledger' } },
  { key: nameRef('item', 'ancient-edict-fragment').nameRef.key, name: { 'zh-Hant': '古詔殘頁', en: 'Ancient Edict Fragment' } },
  { key: nameRef('item', 'attendant-figurine').nameRef.key, name: { 'zh-Hant': '侍從陶俑', en: 'Attendant Figurine' } },
  { key: nameRef('item', 'bronze-lamp-stand').nameRef.key, name: { 'zh-Hant': '銅燈架', en: 'Bronze Lamp Stand' } },
  { key: nameRef('item', 'bronze-scale-weight').nameRef.key, name: { 'zh-Hant': '青銅秤砣', en: 'Bronze Scale Weight' } },
  { key: nameRef('item', 'canal-manifest').nameRef.key, name: { 'zh-Hant': '漕運貨單', en: 'Canal Freight Manifest' } },
  { key: nameRef('item', 'clear-miasma-pill').nameRef.key, name: { 'zh-Hant': '清瘴丸', en: 'Miasma-Clearing Pill' } },
  { key: nameRef('item', 'cloud-pattern-paper').nameRef.key, name: { 'zh-Hant': '雲紋宣紙', en: 'Cloud-Pattern Paper' } },
  { key: nameRef('item', 'dry-salve').nameRef.key, name: { 'zh-Hant': '祛濕膏', en: 'Damp-Drawing Salve' } },
  { key: nameRef('item', 'five-herbs-decoction').nameRef.key, name: { 'zh-Hant': '五草湯劑', en: 'Five-Herb Decoction' } },
  { key: nameRef('item', 'gold-wound-powder').nameRef.key, name: { 'zh-Hant': '金瘡散', en: 'Goldwound Powder' } },
  { key: nameRef('item', 'herb-cabinet').nameRef.key, name: { 'zh-Hant': '藥材櫃', en: 'Herb Cabinet' } },
  { key: nameRef('item', 'jade-wine-pot').nameRef.key, name: { 'zh-Hant': '青玉酒壺', en: 'Jade Wine Pot' } },
  { key: nameRef('item', 'kiln-marked-shard').nameRef.key, name: { 'zh-Hant': '窯印陶片', en: 'Kiln-Marked Shard' } },
  { key: nameRef('item', 'lacquered-bookshelf').nameRef.key, name: { 'zh-Hant': '漆木書架', en: 'Lacquered Bookshelf' } },
  { key: nameRef('item', 'low-table').nameRef.key, name: { 'zh-Hant': '矮案', en: 'Low Table' } },
  { key: nameRef('item', 'medicine-bamboo-tube').nameRef.key, name: { 'zh-Hant': '藥竹筒', en: 'Medicine Bamboo Tube' } },
  { key: nameRef('item', 'miasma-repelling-incense').nameRef.key, name: { 'zh-Hant': '驅瘴香', en: 'Miasma-Repelling Incense' } },
  { key: nameRef('item', 'mist-bamboo-tea-brick').nameRef.key, name: { 'zh-Hant': '霧篁茶磚', en: 'Mistbamboo Tea Brick' } },
  { key: nameRef('item', 'red-ginseng-root').nameRef.key, name: { 'zh-Hant': '赤參根', en: 'Red Ginseng Root' } },
  { key: nameRef('item', 'returning-heaven-paste').nameRef.key, name: { 'zh-Hant': '回天膏', en: 'Heaven-Returning Salve' } },
  { key: nameRef('item', 'returning-origin-paste').nameRef.key, name: { 'zh-Hant': '回元膏', en: 'Origin-Restoring Salve' } },
  { key: nameRef('item', 'seal-tower-transcript').nameRef.key, name: { 'zh-Hant': '印塔抄本', en: 'Seal Tower Transcript' } },
  { key: nameRef('item', 'sinking-reed-bundle').nameRef.key, name: { 'zh-Hant': '沉水草束', en: 'Sunken-Reed Bundle' } },
  { key: nameRef('item', 'sober-incense').nameRef.key, name: { 'zh-Hant': '醒神香', en: 'Waking Incense' } },
  { key: nameRef('item', 'towerheart-elixir').nameRef.key, name: { 'zh-Hant': '鎮心靈膏', en: 'Heart-Stilling Elixir' } },
  { key: nameRef('item', 'ward-incense-pill').nameRef.key, name: { 'zh-Hant': '護印香丸', en: 'Seal-Warding Pastille' } },
  { key: nameRef('item', 'water-damaged-cloth-roll').nameRef.key, name: { 'zh-Hant': '濕損布卷', en: 'Water-Damaged Cloth Roll' } },
  { key: nameRef('item', 'wax-sealed-casket').nameRef.key, name: { 'zh-Hant': '封蠟木匣', en: 'Wax-Sealed Casket' } },
  { key: nameRef('item', 'woven-bamboo-screen').nameRef.key, name: { 'zh-Hant': '竹編屏風', en: 'Woven Bamboo Screen' } },
  { key: nameRef('material', 'aromatic-herb').nameRef.key, name: { 'zh-Hant': '香草', en: 'Aromatic Herb' } },
  { key: nameRef('material', 'badger-king-meat').nameRef.key, name: { 'zh-Hant': '獾王肉材', en: 'Badger King Meat' } },
  { key: nameRef('material', 'badger-meat').nameRef.key, name: { 'zh-Hant': '獾肉', en: 'Badger Meat' } },
  { key: nameRef('material', 'bamboo-back-hide').nameRef.key, name: { 'zh-Hant': '竹背皮', en: 'Bamboo-Back Hide' } },
  { key: nameRef('material', 'bell-shell').nameRef.key, name: { 'zh-Hant': '鈴殼', en: 'Bell Shell' } },
  { key: nameRef('material', 'common-herb').nameRef.key, name: { 'zh-Hant': '常見藥草', en: 'Common Herb' } },
  { key: nameRef('material', 'fish').nameRef.key, name: { 'zh-Hant': '魚材', en: 'Fish' } },
  { key: nameRef('material', 'frayed-seal-ink').nameRef.key, name: { 'zh-Hant': '斷符墨', en: 'Seal-Breaking Ink' } },
  { key: nameRef('material', 'grain').nameRef.key, name: { 'zh-Hant': '穀物', en: 'Grain' } },
  { key: nameRef('material', 'green-iron-ingot').nameRef.key, name: { 'zh-Hant': '青鐵錠', en: 'Green-Iron Ingot' } },
  { key: nameRef('material', 'mist-bamboo').nameRef.key, name: { 'zh-Hant': '霧篁藥竹', en: 'Mistbamboo Cane' } },
  { key: nameRef('material', 'mist-wing-powder').nameRef.key, name: { 'zh-Hant': '瘴翅粉', en: 'Miasma-Wing Powder' } },
  { key: nameRef('material', 'official-cinnabar').nameRef.key, name: { 'zh-Hant': '官朱砂', en: 'Official Cinnabar' } },
  { key: nameRef('material', 'red-ginseng-root').nameRef.key, name: { 'zh-Hant': '赤參根', en: 'Red Ginseng Root' } },
  { key: nameRef('material', 'seal-ceramic-core').nameRef.key, name: { 'zh-Hant': '鎖印陶芯', en: 'Sealbound Ceramic Core' } },
  { key: nameRef('material', 'seal-stone').nameRef.key, name: { 'zh-Hant': '印塔石', en: 'Seal Tower Stone' } },
  { key: nameRef('material', 'sinking-reed').nameRef.key, name: { 'zh-Hant': '沉水草', en: 'Sunken Reed' } },
  { key: nameRef('material', 'spring-ginger').nameRef.key, name: { 'zh-Hant': '藥泉薑根', en: 'Springwell Ginger' } },
  { key: nameRef('material', 'tide-shell').nameRef.key, name: { 'zh-Hant': '潮殼', en: 'Tide Shell' } },
];

export const yunhuaItemsDomain: AuthoredDomain = {
  domain: 'items',
  definitions: [
    ...useDelayRules,
    nonCombatUseRule,
    ...combatConsumables,
    ...nonCombatConsumables,
    ...generalItems,
    ...materials,
    ...materialAffixes,
    ...equipmentRecipes,
    ...alchemyRecipes,
    ...handicraftRecipes,
    ...cuisineRecipes,
  ],
  texts: ITEM_TEXTS,
};

// 本檔擁有的 kind（供 `packs.ts` 的 `declaredKinds` 交叉比對；那一欄由整合者手寫，這裡只列出
// 事實，不代它填）：
//   combatConsumable / nonCombatConsumable / generalItem / material / material-affix /
//   use-delay-rule / non-combat-use-rule / crafting-recipe / cuisine-recipe
// 本檔**不含**（見檔頭理由）：book / food-affix / restaurant-menu。
export const YUNHUA_ITEMS_KINDS: readonly string[] = [
  'combatConsumable',
  'crafting-recipe',
  'cuisine-recipe',
  'generalItem',
  'material',
  'material-affix',
  'non-combat-use-rule',
  'nonCombatConsumable',
  'use-delay-rule',
];
