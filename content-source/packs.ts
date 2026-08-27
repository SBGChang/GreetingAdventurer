// content-source/packs.ts
// Content Pack 宣告：有哪些 pack、版本、相依、載入順序，以及每個 pack 由哪些 domain 檔組成。
//
// 分包原則（這是「同一套 Runtime 載入不同文化 Pack 就產生不同遊戲」的落實點）：
//   * `pack:core` —— **文化無關**的規則與結構：熟練度清單與曲線、生命週期規則、貨幣、
//     戰鬥規則骨架、通用 Resolver 調校。四國共用，不含任何一國的物件、怪物、地圖或城市。
//   * `pack:<culture>` —— 一國的內容：裝備、技能、怪物、遭遇、物品、素材、配方、地圖、城市、
//     委託、世界節點。每一國都 `requiredPacks: [core]`。
//
// 抽換文化 = 換掉 loadOrder 裡的文化 pack；core 不動。若某個數值換文化會改變，它就屬文化 pack；
// 若四國都相同且屬遊戲結構，才放 core。判不出來的一律放文化 pack——猜錯的代價不對稱
// （放文化包只是多複製一份；放 core 會讓該國永遠改不動它）。

import type { ContentPackId } from '../src/contracts/core';
import type { AuthoredManifest, AuthoredPack } from './authoring';
import { combatTargetBindings } from './core/resolver-ids';

import { progressionDomain } from './core/progression';
// Wave F1：八個 domain 的文化無關規則。
import { characterDomain } from './core/character';
import { progressionRulesDomain } from './core/progression-rules';
import { teamDomain } from './core/team';
import { combatRulesDomain } from './core/combat-rules';
import { economySocialDistributionDomain } from './core/economy-social-distribution';
import { questCraftingSequenceDomain } from './core/quest-crafting-sequence';
import { servicesDomain } from './core/services';
import { worldMapDungeonNpcDomain } from './core/world-map-dungeon-npc';
// Wave F2a：雲華 culture pack（設計來源 docs/03_content/yunhua 的映射）。
import { yunhuaEquipmentDomain } from './yunhua/equipment';
import { yunhuaSkillsDomain } from './yunhua/skills';
import { monstersDomain as yunhuaMonstersDomain } from './yunhua/monsters';
import { yunhuaItemsDomain } from './yunhua/items';
import { yunhuaMapsDomain } from './yunhua/maps';
import { yunhuaWorldCityDomain } from './yunhua/world-city';
import { yunhuaQuestsEventsDomain } from './yunhua/quests-events';

const CORE_PACK_ID = 'pack:core' as ContentPackId;

// core pack 實際內容的 kind 聯集（72 筆）。刻意手寫：Compiler 會逐筆交叉比對，
// 多了或少了都會指名，所以改內容而忘了改這裡不會靜默通過（見 authoring.ts 的說明）。
const DECLARED_KINDS: readonly string[] = [
  'action-chain-template',
  'action-delay-rule',
  'adventurer-decision-policy',
  'age-experience-rule',
  'age-modifier-rule',
  'asset-distribution-rule',
  'attack-mastery-award-rule',
  'birth-rule',
  'carry-capacity-rule',
  'character-archetype',
  'character-status',
  'child-education-rule',
  'combat-ai-policy',
  'combat-control-resistance-profile',
  'combat-ctb-adjustment-rule',
  'combat-damage-rule',
  'combat-effect',
  'combat-heal-rule',
  'combat-interruption-rule',
  'combat-power-feasibility-rule',
  'combat-power-feature-rule',
  'combat-power-rule',
  'combat-rule',
  'combat-sequence-rule',
  'combat-status',
  'craft-quality-rule',
  'currency',
  'defense-mastery-routing-rule',
  'dungeon-interaction-rule',
  'encounter-experience-budget',
  'experience-award-rule',
  'free-action-rule',
  'gathering-destination-policy',
  'grip-rule',
  'lifecycle-rule',
  'mastery',
  'mastery-curve',
  'member-retention-rule',
  'monster-experience-profile',
  'non-player-member-daily-social-practice-rule',
  'npc-cuisine-decision-rule',
  'npc-dungeon-target-resolver',
  'npc-exploration-rule',
  'npc-market-policy',
  'npc-marriage-rule',
  'npc-sequence-rule',
  'npc-travel-rule',
  'opening-ctb-rule',
  'passage-policy',
  'player-affinity-rule',
  'player-conversation-rule',
  'player-travel-mode',
  'price-modifier-rule',
  'price-rule',
  'quest-deadline-rule',
  'quest-objective-rule',
  'quest-reaction-rule',
  'quest-reward-rule',
  'recent-activity-rule',
  'recruitment-rule',
  'retry-supply-policy',
  'reward-rule',
  'secondary-attribute',
  'social-mastery-benefit',
  'social-system',
  'statistics-rule',
  'support-mastery-award-rule',
  'teaching-rule',
  'team-formation-rule',
  'team-plan-rule',
  'temporary-character-rule',
  'world-adventurer-generation-rule',
];

const corePack: AuthoredPack = {
  packId: CORE_PACK_ID,
  version: '1.0.0',
  contentRoot: 'core',
  requiredPacks: [],
  optional: false,
  // base pack 不綁文化：cultureIds 為空（§8）。
  scope: {
    cultureIds: [],
    features: [
      'progression',
      'character',
      'team',
      'combat',
      'economy',
      'social',
      'distribution',
      'quest',
      'crafting',
      'combat-sequence',
      'statistics',
      'combat-power',
      'gathering',
      'world',
      'map',
      'dungeon',
      'npc-behavior',
    ],
  },
  // 目前 core 的內容沒有任何 Resolver 引用。有了就必須在這裡列出來——
  // Bootstrap 以此確認「pack 用到的 Resolver 全部已註冊」才啟動。
  requiredResolverIds: [],
  // core **宣告並提供** combat 目標 shape 的 Resolver 綁定（模組擁有、四國共用；文化 pack 的技能
  // 只引用這些 ID）。目前為 target-shapes.ts 已實作的 8 種；隨實作增加逐筆補上。
  resolverBindings: [...combatTargetBindings()],
  runtimeCompatibility: { minRuntimeVersion: '0.1.0' },
  // 由 Compiler 交叉比對（見 authoring.ts 的說明：這一欄刻意手寫，推導出來的宣告等於沒有檢查）。
  // 下面這份清單是實際內容的 kind 聯集；改內容而忘了改這裡，編譯就會指名多了/少了哪些。
  declaredKinds: DECLARED_KINDS,
  domains: [
    progressionDomain,
    characterDomain,
    progressionRulesDomain,
    teamDomain,
    combatRulesDomain,
    economySocialDistributionDomain,
    questCraftingSequenceDomain,
    servicesDomain,
    worldMapDungeonNpcDomain,
  ],
};

// 文化 pack 一律相依 core 的同一版本；版本不合就不得啟動（§1.1）。
const CORE_DEPENDENCY = [{ packId: CORE_PACK_ID, version: corePack.version }] as const;
export { CORE_DEPENDENCY, CORE_PACK_ID };

// ── 雲華 culture pack ────────────────────────────────────────────────────────
//
// 雲華 pack 實際內容的 kind 聯集（38 筆）。與 core 同樣刻意手寫，Compiler 交叉比對。
const YUNHUA_DECLARED_KINDS: readonly string[] = [
  'adventure-site',
  'attack-mastery-award-rule',
  'city',
  'city-action-rule',
  'city-node',
  'combat-skill',
  'combatConsumable',
  'content-event',
  'crafting-recipe',
  'cuisine-recipe',
  'culture',
  'effect',
  'encounter-group',
  'equipment',
  'escort-generation-rule',
  'facility',
  'generalItem',
  'home-rule',
  'home-upgrade',
  'intel-rule',
  'map-content',
  'map-spawn-rule',
  'map-template',
  'material',
  'material-affix',
  'monster',
  'nation',
  'non-combat-use-rule',
  'nonCombatConsumable',
  'player-commerce-daily-limit',
  'player-commerce-practice-rule',
  'population-supply-rule',
  'region',
  'route',
  'shop-rule',
  'skill',
  'support-mastery-award-rule',
  'use-delay-rule',
];

const yunhuaPack: AuthoredPack = {
  packId: 'pack:yunhua' as ContentPackId,
  version: '1.0.0',
  contentRoot: 'yunhua',
  requiredPacks: [...CORE_DEPENDENCY],
  optional: false,
  scope: { cultureIds: ['culture.yunhua'], features: ['culture-content'] },
  requiredResolverIds: [],
  // 雲華不自帶 Resolver 實作；它的技能**引用** core 宣告的 combat 目標 Resolver（見 skills.ts）。
  resolverBindings: [],
  runtimeCompatibility: { minRuntimeVersion: '0.1.0' },
  declaredKinds: YUNHUA_DECLARED_KINDS,
  domains: [
    yunhuaEquipmentDomain,
    yunhuaSkillsDomain,
    yunhuaMonstersDomain,
    yunhuaItemsDomain,
    yunhuaMapsDomain,
    yunhuaWorldCityDomain,
    yunhuaQuestsEventsDomain,
  ],
};

export const AUTHORED_MANIFEST: AuthoredManifest = {
  manifestVersion: '1.0.0',
  // core 先載入：文化 pack 引用它的熟練度、貨幣與規則 ID。
  // core 先載入：文化 pack 引用它的熟練度、規則與貨幣 ID。
  loadOrder: [CORE_PACK_ID, 'pack:yunhua' as ContentPackId],
  packs: [corePack, yunhuaPack],
};
