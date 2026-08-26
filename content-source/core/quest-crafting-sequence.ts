// content-source/core/quest-crafting-sequence.ts
// 委託規則、製作規則、簡易戰鬥串規則。**文化無關**——這三組全部是「四國共用的結構與平衡」，
// 一國的配方、素材詞條、料理、菜單、怪物與物品都不在這裡（見本檔末尾「刻意不寫在 core 的內容」）。
//
// 來源（逐筆對照見下方各段註解；沒有文件依據的數值一律標「第一版方案（待討論）」）：
//   * 委託：`docs/00_core/game_design_document.md`「三、委託系統」
//     + `docs/00_core/architecture/10_quest_module.md` §2.2／§2.3／§2.4／§2.5／§8
//   * 製作：`docs/00_core/architecture/20_crafting_and_cuisine_module.md` §2／§2.1／§2.2／§2.3
//   * 戰鬥串：`docs/00_core/architecture/21_combat_sequence_module.md` §2.2／§6.2
//
// 本檔只有資料、ID 常數與純資料展開工具（把一張表展開成逐筆 definition）。沒有任何規則邏輯：
// 成功率、品質、期限長度的**計算**全在 Resolver（程式形狀）+ params（資料調校），不在這裡。

import type {
  CraftQualityRuleId,
  EffectDefinitionId,
  ExperienceAwardRuleId,
  ItemTagId,
  NpcCuisineDecisionRuleId,
  QuestDeadlineRuleId,
  QuestObjectiveRuleId,
  QuestReactionRuleId,
  QuestRewardRuleId,
  ResolverId,
} from '../../src/contracts/core';
import type {
  QuestDeadlineRuleDefinition,
  QuestKind,
  QuestObjectiveRuleDefinition,
  QuestReactionRuleDefinition,
  QuestReactionSourceKind,
  QuestRewardRuleDefinition,
} from '../../src/contracts/quest';
import type {
  CraftQualityRuleDefinition,
  NpcCuisineDecisionRuleDefinition,
} from '../../src/contracts/crafting';
import type {
  CombatSequenceRuleDefinition,
  CombatSequenceRuleId,
  CombatSequenceSuccessChanceParamsId,
  RetrySupplyPolicyDefinition,
  RetrySupplyPolicyId,
} from '../../src/contracts/combat-sequence';
import type { RewardRuleId } from '../../src/contracts/economy';
import type { CombatPowerRuleId } from '../../src/contracts/combat-power';
import type { DefenseMasteryRoutingRuleId } from '../../src/contracts/progression';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';

const core = cultureIds('core');

// `ResolverId` 不是 `DefinitionId`，所以它不走 `cultureIds().id`（那支只產生
// `<prefix>.<culture>.<local>` 的定義 ID）。Resolver 的字串形狀在既有程式裡一律是
// `resolver:<擁有模組>.<名稱>`（例：`resolver:combat-power.unit-sum`、
// `resolver:statistics.age-modifier`），這裡照同一個形狀，集中一處以免逐筆打錯。
function resolver(owner: string, local: string): ResolverId {
  return `resolver:${owner}.${local}` as ResolverId;
}

// ════════════════════════════════════════════════════════════════════════════
// 委託（quest）
// ════════════════════════════════════════════════════════════════════════════

// ── 目標規則（quest-objective-rule）─────────────────────────────────────────
//
// 契約上這張表只有 `questKind` 一欄（`QuestObjectiveRuleDefinition`；10_quest_module.md 具名了
// 這個 Reader 但從未給出欄位表）。七種委託各一筆——GDD「委託類型」與 doc §2.2 都要求
// 「每張委託在生成時固定一種類型」，而 doc §8 的七條完成條件是逐類型不同的規則，
// 所以類型不能合併成一筆共用目標規則。
//
// 用非 Partial 的 `Record<QuestKind, …>`：QuestKind 多一個成員而這裡沒補，`tsc` 直接擋下。
const OBJECTIVE_RULE_IDS: Readonly<Record<QuestKind, QuestObjectiveRuleId>> = {
  purchase: core.id<QuestObjectiveRuleId>('quest-objective-rule', 'purchase'),
  delivery: core.id<QuestObjectiveRuleId>('quest-objective-rule', 'delivery'),
  escort: core.id<QuestObjectiveRuleId>('quest-objective-rule', 'escort'),
  rescue: core.id<QuestObjectiveRuleId>('quest-objective-rule', 'rescue'),
  exploration: core.id<QuestObjectiveRuleId>('quest-objective-rule', 'exploration'),
  suppression: core.id<QuestObjectiveRuleId>('quest-objective-rule', 'suppression'),
  hunt: core.id<QuestObjectiveRuleId>('quest-objective-rule', 'hunt'),
};

const ALL_QUEST_KINDS: readonly QuestKind[] = [
  'purchase',
  'delivery',
  'escort',
  'rescue',
  'exploration',
  'suppression',
  'hunt',
];

const objectiveRules: readonly Authored<QuestObjectiveRuleDefinition>[] = ALL_QUEST_KINDS.map(
  (questKind) => ({
    kind: 'quest-objective-rule',
    id: OBJECTIVE_RULE_IDS[questKind],
    questKind,
  }),
);

// ── 期限規則（quest-deadline-rule）──────────────────────────────────────────
//
// doc §2.4「第一版已定規則」的表格逐列照抄，一列一筆：
//
//   | 類型      | 接受期限        | 實際結束期限                                      |
//   | 購買／送貨 | 生成日 + 14    | + 每個城市距離格各自 RNG 9～15 日；最多相隔 2 城      |
//   | 救援／探索 | 生成日 + 7     | + 每個城市距離格各自 RNG 9～15 日                   |
//   | 鎮壓／討伐 | 生成時固定      | 生成日 + 41 日（三個 14 日刷新期減 1 日）           |
//   | 護衛      | 尚未定案        | Deadline Resolver 未啟用前不得生成                  |
//
// `acceptDurationDays` 進得了資料；**實際結束期限的數值進不來**——契約的
// `QuestDeadlineRuleDefinition` 只有 `actualEndResolverId`，沒有指向 kernel params 的欄位，
// 所以「9～15」與「41」目前沒有合法的資料落點（詳見回報的契約缺口）。
// 這裡不把它們寫進註解當替代資料、也不塞進 resolverId 字串，只逐條指定各自獨立的 Resolver，
// 讓 params 欄位補上後每條規則各自帶自己的調校量。
//
// 護衛沒有 deadline 規則：GDD「護衛委託的生成」明寫「目的地選擇、接受期限與實際結束期限尚未定義，
// 不自行假設」，doc §2.4 同一列寫「Deadline Resolver 未啟用前不得生成」。因此護衛也沒有
// reaction rule（見下一段）——沒有 reaction rule 就不會生成護衛委託，正是文件要求的狀態。
const DEADLINE_RULE_IDS = {
  // 購買／送貨
  purchaseDelivery: core.id<QuestDeadlineRuleId>('quest-deadline-rule', 'purchase-delivery'),
  // 救援／探索
  rescueExploration: core.id<QuestDeadlineRuleId>('quest-deadline-rule', 'rescue-exploration'),
  // 鎮壓／討伐
  suppressionHunt: core.id<QuestDeadlineRuleId>('quest-deadline-rule', 'suppression-hunt'),
} as const;

const deadlineRules: readonly Authored<QuestDeadlineRuleDefinition>[] = [
  {
    kind: 'quest-deadline-rule',
    id: DEADLINE_RULE_IDS.purchaseDelivery,
    // doc §2.4：購買／送貨「生成日 + 14」。
    acceptDurationDays: 14,
    actualEndResolverId: resolver('quest', 'actual-end.purchase-delivery'),
    // doc §2.4：「最多相隔 2 城」。
    maxCityGapCount: 2,
  },
  {
    kind: 'quest-deadline-rule',
    id: DEADLINE_RULE_IDS.rescueExploration,
    // doc §2.4：救援／探索「生成日 + 7」。
    acceptDurationDays: 7,
    actualEndResolverId: resolver('quest', 'actual-end.rescue-exploration'),
    // 這一列沒有城市距離上限；`maxCityGapCount` 省略＝不設上限（選填欄位不補預設值）。
  },
  {
    kind: 'quest-deadline-rule',
    id: DEADLINE_RULE_IDS.suppressionHunt,
    // **第一版方案（待討論）**：doc §2.4 只寫「生成時固定」，沒有給天數。取 14——
    // 理由：這一列的實際結束期限是 41 日（三個 14 日刷新期減 1 日），把接受窗口對齊成
    // 一個完整刷新期，可讓「委託撤下」與「地圖刷新鎖」用同一個週期敘事，並留 27 日給接取後完成。
    // 若日後定案為別的值，只改這一行。
    acceptDurationDays: 14,
    actualEndResolverId: resolver('quest', 'actual-end.suppression-hunt'),
  },
];

// ── 報酬規則（quest-reward-rule）────────────────────────────────────────────
//
// doc §2.5：「Quest 只選擇這筆委託引用哪個報酬組合；金額、任務熟練度與聲望效果各由擁有模組的
// Definition／Resolver 處理。」所以本檔只填三個**跨模組引用**，不填任何金額或 MXP 數值：
//   * `masteryExperienceRuleId` → progression 的 `experience-award-rule`
//   * `currencyRewardRuleId`    → economy 的 `reward-rule`
//   * `reputationEffectIds`     → `effect` 家族
//
// 七種委託各一筆（GDD「委託狀態與結案」：任務熟練度依類型發放，doc §2.2「對應同名任務熟練度」）。
//
// `experienceAwardLocal` 對齊 progression 的**熟練度** local 名（`content-source/core/progression.ts`
// 的 QUEST_MASTERIES）。注意 `hunt`（討伐）在熟練度那側叫 `quest-subjugation`，不是 `quest-hunt`——
// 兩邊命名不同不是筆誤，是各自沿用自己擁有者的詞彙；整合時要對得上這一筆。
//
// ⚠️ **未解決：這七筆 `masteryExperienceRuleId` 目前指向不存在的定義，需要裁決。**
// 引用的 kind 是 `experience-award-rule`（不是 `mastery`），而 progression 內容側
// （`content-source/core/progression-rules.ts` 的 `questAwardRules`）把委託經驗規則**逐階級**
// 展開成五筆：`experience-award-rule.core.quest-purchase-tier-i` … `-tier-v`（七類型共 35 筆），
// 沒有任何一筆叫 `experience-award-rule.core.quest-purchase`。
// 熟練度 local 名對得上，但**經驗規則 local 名對不上**——原本這段註解只講前者，讀起來像已經接上了。
//
// 這不是換個字串就能修的：`QuestRewardRuleDefinition.masteryExperienceRuleId` 是**單一必填 ID**，
// 契約沒有任何欄位承載「這張委託算第幾階級」，所以委託資料無法自己挑 tier。在這裡硬填某一階
// （例如一律 `-tier-i`）等於替平衡做決定並讓其餘四階永遠讀不到——那是編造內容，不是補資料。
// 兩條合法出路，都要擁有者裁決，不在本檔能決定的範圍：
//   (a) progression 另外提供七筆不分階級的委託經驗規則（tier 由 Resolver 依目標內容階級決定）；
//   (b) 契約補一個「階級 → ExperienceAwardRuleId」的對照欄位，比照 `FoodAffixDefinition.effectByTier`。
// 在裁決前，這裡保留**擁有者詞彙的無階級名**：它是 (a) 的形狀，且刻意讓引用檢查指得出缺哪一筆，
// 而不是用一個能載入成功的錯 tier 把問題藏起來。
type ReputationTier = 'minor' | 'standard' | 'major';

const REPUTATION_EFFECT_IDS: Readonly<Record<ReputationTier, EffectDefinitionId>> = {
  minor: core.id<EffectDefinitionId>('effect', 'quest-reputation-minor'),
  standard: core.id<EffectDefinitionId>('effect', 'quest-reputation-standard'),
  major: core.id<EffectDefinitionId>('effect', 'quest-reputation-major'),
};

type RewardRow = Readonly<{
  // progression 的 experience-award-rule local（＝該類型任務熟練度的 local 名）。
  experienceAwardLocal: string;
  reputationTier: ReputationTier;
}>;

// **第一版方案（待討論）**：聲望分三檔而不是逐類型七筆。
// 理由：GDD 只說結案才發放獎勵與任務熟練度，沒有規定聲望要逐類型不同；分檔依「委託失敗的代價與
// 公開程度」——城內買賣（minor）＜出城作業（standard）＜清空地圖／討伐大怪（major）。
// 要改成逐類型七筆，只需把這張表的 tier 換成七個不同 ID，不動任何程式。
const REWARD_ROWS: Readonly<Record<QuestKind, RewardRow>> = {
  purchase: { experienceAwardLocal: 'quest-purchase', reputationTier: 'minor' },
  delivery: { experienceAwardLocal: 'quest-delivery', reputationTier: 'minor' },
  escort: { experienceAwardLocal: 'quest-escort', reputationTier: 'standard' },
  rescue: { experienceAwardLocal: 'quest-rescue', reputationTier: 'standard' },
  exploration: { experienceAwardLocal: 'quest-exploration', reputationTier: 'standard' },
  suppression: { experienceAwardLocal: 'quest-suppression', reputationTier: 'major' },
  // 討伐：熟練度 local 是 `quest-subjugation`（見上方說明）。
  hunt: { experienceAwardLocal: 'quest-subjugation', reputationTier: 'major' },
};

const REWARD_RULE_IDS: Readonly<Record<QuestKind, QuestRewardRuleId>> = {
  purchase: core.id<QuestRewardRuleId>('quest-reward-rule', 'purchase'),
  delivery: core.id<QuestRewardRuleId>('quest-reward-rule', 'delivery'),
  escort: core.id<QuestRewardRuleId>('quest-reward-rule', 'escort'),
  rescue: core.id<QuestRewardRuleId>('quest-reward-rule', 'rescue'),
  exploration: core.id<QuestRewardRuleId>('quest-reward-rule', 'exploration'),
  suppression: core.id<QuestRewardRuleId>('quest-reward-rule', 'suppression'),
  hunt: core.id<QuestRewardRuleId>('quest-reward-rule', 'hunt'),
};

const rewardRules: readonly Authored<QuestRewardRuleDefinition>[] = ALL_QUEST_KINDS.map(
  (questKind) => {
    const row = REWARD_ROWS[questKind];
    return {
      kind: 'quest-reward-rule',
      id: REWARD_RULE_IDS[questKind],
      masteryExperienceRuleId: core.id<ExperienceAwardRuleId>(
        'experience-award-rule',
        row.experienceAwardLocal,
      ),
      currencyRewardRuleId: core.id<RewardRuleId>('reward-rule', `quest-${questKind}`),
      reputationEffectIds: [REPUTATION_EFFECT_IDS[row.reputationTier]],
    };
  },
);

// ── 內容反應規則（quest-reaction-rule）──────────────────────────────────────
//
// doc §2.3「既定基準」逐條落地。這張表是「世界內容 → 委託」的唯一入口，所以 sourceKind 與
// questKind 的配對就是委託系統的內容面。
//
// `guildResolverId`：doc §2.3 只有兩種歸屬——「當地公會」與「隨機一座合法城市」（綁架）。
// 兩個 Resolver 都尚未註冊（見回報）。
//
// `creationChance`：
//   * 怪物群、Boss、綁架 = 1（doc §2.3：怪物／控制類 100%；綁架 100%；Boss 無條件形成討伐委託）。
//   * 地圖物品與城市庫存物品 = **第一版方案（待討論）**。doc 只寫「依資料機率形成探索、購買或送貨
//     委託；未形成時可只留下情報」，機率本身刻意留給資料。取 0.35／0.30／0.20，理由是三者都必須
//     明顯低於 1（「未形成時可只留下情報」是設計預期的常態），且送貨要跨城、成本最高故機率最低。
type ReactionRow = Readonly<{
  local: string;
  sourceKind: QuestReactionSourceKind;
  questKind: QuestKind;
  creationChance: number;
  guildResolverLocal: string;
  deadlineRuleId: QuestDeadlineRuleId;
}>;

const REACTION_ROWS: readonly ReactionRow[] = [
  {
    local: 'monster-group-suppression',
    sourceKind: 'monsterGroup',
    questKind: 'suppression',
    creationChance: 1,
    guildResolverLocal: 'guild.local-city',
    deadlineRuleId: DEADLINE_RULE_IDS.suppressionHunt,
  },
  {
    local: 'boss-hunt',
    sourceKind: 'boss',
    questKind: 'hunt',
    creationChance: 1,
    guildResolverLocal: 'guild.local-city',
    deadlineRuleId: DEADLINE_RULE_IDS.suppressionHunt,
  },
  {
    local: 'kidnap-rescue',
    sourceKind: 'kidnap',
    questKind: 'rescue',
    creationChance: 1,
    // doc §2.3：「綁架：隨機一座合法城市 100% 形成救援委託。」
    guildResolverLocal: 'guild.random-legal-city',
    deadlineRuleId: DEADLINE_RULE_IDS.rescueExploration,
  },
  {
    local: 'map-item-exploration',
    sourceKind: 'mapItem',
    questKind: 'exploration',
    creationChance: 0.35,
    guildResolverLocal: 'guild.local-city',
    deadlineRuleId: DEADLINE_RULE_IDS.rescueExploration,
  },
  {
    local: 'city-stock-purchase',
    sourceKind: 'cityStockItem',
    questKind: 'purchase',
    creationChance: 0.3,
    guildResolverLocal: 'guild.local-city',
    deadlineRuleId: DEADLINE_RULE_IDS.purchaseDelivery,
  },
  {
    local: 'city-stock-delivery',
    sourceKind: 'cityStockItem',
    questKind: 'delivery',
    creationChance: 0.2,
    guildResolverLocal: 'guild.local-city',
    deadlineRuleId: DEADLINE_RULE_IDS.purchaseDelivery,
  },
  // `escortCandidate` 沒有這一列——護衛的兩個期限「尚未定義，不自行假設」（GDD）；
  // doc §2.4 要求「Deadline Resolver 未啟用前不得生成」。少一列 reaction rule 就是不生成。
];

const reactionRules: readonly Authored<QuestReactionRuleDefinition>[] = REACTION_ROWS.map((row) => ({
  kind: 'quest-reaction-rule',
  id: core.id<QuestReactionRuleId>('quest-reaction-rule', row.local),
  sourceKind: row.sourceKind,
  questKind: row.questKind,
  creationChance: row.creationChance,
  guildResolverId: resolver('quest', row.guildResolverLocal),
  deadlineRuleId: row.deadlineRuleId,
  objectiveRuleId: OBJECTIVE_RULE_IDS[row.questKind],
  rewardRuleId: REWARD_RULE_IDS[row.questKind],
}));

// ════════════════════════════════════════════════════════════════════════════
// 製作與料理（crafting）——**只有規則**
// ════════════════════════════════════════════════════════════════════════════

// ── 製作品質規則（craft-quality-rule）───────────────────────────────────────
//
// 契約只有一欄 `resolverId`（doc §2：「只讀製作者 Mastery、配方、設施與投入素材快照」）。
//
// 分成三筆而不是一筆共用：doc §2.1／§2.2 把品質結果的**用途**逐 outputKind 分開了——
//   * equipment  → 品質決定可繼承詞條數（plain 0 … demonGod 5），實得 `min(品質詞條數, 候選詞條數)`
//   * consumable → 品質「只由 Consumable Yield Resolver 轉為同批材料的固定道具產量」，且
//                  「絕不帶精良～鬼神前綴或素材詞條」（不變量 4）
//   * tradeGood  → 「不繼承素材詞條」，品質「只套用出售倍率」，且「低階工藝品亦可骰到鬼神品質」
// 三種用途的品質分佈本來就不該共用同一條曲線（工藝品明說低階也可骰到最高品質，裝備沒有這句），
// 所以三筆各自帶一個 Resolver。**第一版方案（待討論）**：文件沒有明講要幾筆。
// 分佈本身（各 Mastery 等級的品質機率）是 params，此契約沒有 params 欄位（見回報的契約缺口）。
const CRAFT_QUALITY_ROWS: readonly Readonly<{ local: string }>[] = [
  { local: 'equipment' },
  { local: 'consumable' },
  { local: 'trade-good' },
];

const craftQualityRules: readonly Authored<CraftQualityRuleDefinition>[] = CRAFT_QUALITY_ROWS.map(
  (row) => ({
    kind: 'craft-quality-rule',
    id: core.id<CraftQualityRuleId>('craft-quality-rule', row.local),
    resolverId: resolver('crafting', `quality.${row.local}`),
  }),
);

// ── NPC 料理決策規則（npc-cuisine-decision-rule）────────────────────────────
//
// 契約兩欄，都是 Resolver（doc §4：「對每名無 FoodStatus 的非玩家主角角色，資料化抽取自製料理
// 或餐館；餐館候選只在角色所在城市的 Inn 開放時可用」）。一筆即可：這條規則不依國家、不依角色
// 類型分歧——doc 把差異全放進兩個權重 Resolver 的輸入，而不是多張規則表。
const npcCuisineDecisionRule: Authored<NpcCuisineDecisionRuleDefinition> = {
  kind: 'npc-cuisine-decision-rule',
  id: core.id<NpcCuisineDecisionRuleId>('npc-cuisine-decision-rule', 'standard'),
  selfCookWeightResolverId: resolver('crafting', 'npc-cuisine.self-cook-weight'),
  restaurantWeightResolverId: resolver('crafting', 'npc-cuisine.restaurant-weight'),
};

// ════════════════════════════════════════════════════════════════════════════
// 簡易戰鬥串（combat-sequence）
// ════════════════════════════════════════════════════════════════════════════

// ── 補品重骰政策（retry-supply-policy）──────────────────────────────────────
//
// doc §2.2 的三欄，其中兩欄在契約裡已是字面型別（`selection: 'lowestValueThenStableId'`、
// `quantityPerRetry: 1`）——那是契約層的結構不變量，這裡只能照填。
//
// `eligibleItemTagIds`：doc §6.2「自動選擇最低價合法品」沒有列舉標籤；
// `docs/02_systems/item_system_design.md`「物品總分類」把可用道具分成「戰鬥消耗道具」與
// 「非戰鬥消耗道具」，重骰補品屬前者。**跨 domain 引用**：`item-tag` 家族不屬本檔
// （擁有者是 inventory 的物品軌），此處只引用它的 ID。
//
// ⚠️ **未解決：`item-tag` 這個 kind 目前沒有登記，所以這筆引用沒有任何人能提供。**
// `ItemTagId = DefinitionId<'item-tag'>`（`src/contracts/core/ids.ts:73`）而且
// `ItemDefinition.itemTagIds`（`src/contracts/inventory/index.ts:94`）確實吃它，但
// `item-tag` 不在 `ALL_DEFINITION_KINDS`（`src/app/content/definition-kinds.ts`）裡——
// `INVENTORY_DEFINITION_KINDS` 只登記了 `item` 與各 `ItemKind`（`combatConsumable` 等）。
// 未登記的 kind 對 Content Compiler 是編譯失敗，所以物品軌**寫不出**這一列。
// 這與 §6-2 的 `combat-sequence-success-chance-params` 是同一類缺口（宣告了 ID 型別、
// 沒登記 kind），不是「等別的 domain 交件」。
//
// 為什麼不比照 §6-2 標 `enabled: false`：`eligibleItemTagIds` 是必填陣列，
// 空陣列的語意是「沒有任何合法補品」——那會把重骰整條路靜靜關掉，比留一個查得出來的
// 懸空引用更難發現。停不停用這一筆是整合者的決定（連帶影響已停用的
// `combat-sequence-rule.core.standard`），故此處只標明缺口，不自行改變啟用狀態。
// 註：目前 repo 尚無任何模組提供 `ReferenceRule`（`src/data-runtime/contribution.ts`
// 的 `referenceRules` 無人填），所以這筆懸空引用今天不會被擋下——會在引用檢查接上的那天才爆。
const RETRY_SUPPLY_POLICY_ID = core.id<RetrySupplyPolicyId>('retry-supply-policy', 'standard');

const retrySupplyPolicy: Authored<RetrySupplyPolicyDefinition> = {
  kind: 'retry-supply-policy',
  id: RETRY_SUPPLY_POLICY_ID,
  eligibleItemTagIds: [core.id<ItemTagId>('item-tag', 'combat-consumable')],
  selection: 'lowestValueThenStableId',
  quantityPerRetry: 1,
};

// ── 戰鬥串規則（combat-sequence-rule）───────────────────────────────────────
//
// doc §2.2 的九欄，其中三欄是契約層字面不變量（`attackWeightScale: 6`、
// `attackSkillAggregation`、`distributionRounding`），兩個數值有明文的第一版內容值
// （`retryRelativePowerGapMaximum` 0.15、`maxRetryCountPerChallenge` 1；doc 明講
// 「15% 與一次重骰仍存在資料檔，不散落在 Handler 常數中」）。
//
// **本筆 `enabled: false`**，唯一原因是：`successChanceParamsId` 指向的那一列**無法撰寫**。
// 它的 kind `combat-sequence-success-chance-params` 沒有登記在
// `src/app/content/combat-sequence-reader.ts` 的 `COMBAT_SEQUENCE_DEFINITION_KINDS`，
// 因此也不在 `definition-kinds.ts` 的登記表裡；Content Compiler 對未登記的 kind 是編譯失敗。
// 沒有那一列，成功率曲線的 bias／terms 就沒有合法落點——寫成程式常數是規範 §6 明令禁止的，
// 所以這條規則本版不啟用，而不是「先給一組寫死的機率」。
// 成功率的形狀本身已定：`logisticCurve` kernel（`src/data-runtime/kernels.ts`），
// 輸入是契約規定的 `teamPower` / `enemyPower`，輸出 0..1 機率——不需要新 kernel、不需要 DSL。
// 登記那個 kind 之後，把 params 補進來、移除本行 `enabled: false` 即可，其餘欄位不必動。
//
// 跨 domain 引用：`combatPowerRuleId`（combat-power 服務）、`defenseMasteryRoutingRuleId`
// （progression）。兩者都不是本檔擁有的事實，只引用既存 ID 規約。
const combatSequenceRule: Authored<CombatSequenceRuleDefinition> = {
  kind: 'combat-sequence-rule',
  id: core.id<CombatSequenceRuleId>('combat-sequence-rule', 'standard'),
  enabled: false,
  // 跨 domain：`combat-power-rule` 的擁有者是 combat-power 服務，內容側由
  // `content-source/core/services.ts` 產出，local 名是 **`shared`**（該檔的
  // `COMBAT_POWER_RULE_ID`），不是 `standard`。原本這裡寫 `standard`，指向一筆不存在的定義。
  combatPowerRuleId: core.id<CombatPowerRuleId>('combat-power-rule', 'shared'),
  successChanceResolverId: resolver('combat-sequence', 'success-chance'),
  successChanceParamsId: core.id<CombatSequenceSuccessChanceParamsId>(
    'combat-sequence-success-chance-params',
    'standard',
  ),
  // doc §2.2：「第一版內容值 0.15」。§6.2 的資格式為
  // abs(teamPower - enemyPower) / max(enemyPower, 1) <= retryRelativePowerGapMaximum。
  retryRelativePowerGapMaximum: 0.15,
  // doc §2.2：「第一版內容值 1」／「第一版基礎資料固定每個 Challenge 最多重骰一次」。
  maxRetryCountPerChallenge: 1,
  retrySupplyPolicyId: RETRY_SUPPLY_POLICY_ID,
  // 跨 domain：`defense-mastery-routing-rule` 的擁有者是 progression，內容側由
  // `content-source/core/progression-rules.ts` 產出，local 名是 **`standard`**；
  // `content-source/core/combat-rules.ts` 也以 `standard` 引用同一筆。
  // 原本這裡寫 `shared`，指向一筆不存在的定義。
  defenseMasteryRoutingRuleId: core.id<DefenseMasteryRoutingRuleId>(
    'defense-mastery-routing-rule',
    'standard',
  ),
  // 以下三欄在契約裡是字面型別＝結構不變量（doc §3.2：三招上限使得 0/2/3/4/6 可整數表示；
  // 「不可產生非整數後偷偷四捨五入」）。
  attackWeightScale: 6,
  attackSkillAggregation: 'equalConfiguredAttackSkills',
  distributionRounding: 'largestRemainderStableId',
};

// ════════════════════════════════════════════════════════════════════════════
// 刻意不寫在 core 的內容（判準：四國都一樣才是 core）
// ════════════════════════════════════════════════════════════════════════════
//
//   * `crafting-recipe` / `cuisine-recipe` / `restaurant-menu`：逐國配方、菜單與城市綁定
//     （`yunhua_content.md` §11.3／§11.4 全部是 `material.yunhua.*`、雲京／青岑的菜色）。
//   * `material-affix` / `food-affix`：詞條是**文化內容**，不是規則。yunhua_content.md §11.1
//     的每一條都是 `affix.yunhua.*` 並綁定該國素材（青鐵錠→straight-force…）；
//     `FoodAffixDefinition.effectByTier` 也逐條指向文化 effect。四國不會共用同一份，故不進 core。
//   * `simplified-combat-challenge` / `simplified-combat-skill`：這兩個 kind 是 **Content Compiler
//     的產物**，不是手寫來源（`combat-sequence-reader.ts` 檔頭：「原始 Monster／Encounter／Skill
//     資料仍分別只有一份；Data Runtime 將它們編譯成 Combat Sequence 所需的窄化 View」）。
//     手寫它們就是製造第二份怪物經驗表，doc §2.3 明文禁止。
//   * `effect` / `item`：crafting reader 讀得到它們，但兩者的內容擁有者分別是效果軌與物品軌。

export const questCraftingSequenceDomain: AuthoredDomain = {
  domain: 'quest-crafting-sequence',
  definitions: [
    ...objectiveRules,
    ...deadlineRules,
    ...rewardRules,
    ...reactionRules,
    ...craftQualityRules,
    npcCuisineDecisionRule,
    retrySupplyPolicy,
    combatSequenceRule,
  ],
};
