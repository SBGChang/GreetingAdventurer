// 委託、製作與戰鬥串的作者資料；委託契約見 docs/00_core/architecture/10_quest_module.md。

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
  ResolverBinding,
  ModuleId,
  DefinitionHeader,
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
import type { IntegerRangeParams } from '../../src/app/content/character-resolvers';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';

const core = cultureIds('core');
const QUEST_MODULE = 'quest' as ModuleId;

function resolver(owner: string, local: string): ResolverId {
  return `resolver:${owner}.${local}` as ResolverId;
}


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

const DEADLINE_RULE_IDS = {
  purchaseDelivery: core.id<QuestDeadlineRuleId>('quest-deadline-rule', 'purchase-delivery'),
  rescueExploration: core.id<QuestDeadlineRuleId>('quest-deadline-rule', 'rescue-exploration'),
  suppressionHunt: core.id<QuestDeadlineRuleId>('quest-deadline-rule', 'suppression-hunt'),
} as const;

const deadlineRules: readonly Authored<QuestDeadlineRuleDefinition>[] = [
  {
    kind: 'quest-deadline-rule',
    id: DEADLINE_RULE_IDS.purchaseDelivery,
    acceptDurationDays: 14,
    actualEndResolverId: resolver('quest', 'actual-end.purchase-delivery'),
    maxCityGapCount: 2,
  },
  {
    kind: 'quest-deadline-rule',
    id: DEADLINE_RULE_IDS.rescueExploration,
    acceptDurationDays: 7,
    actualEndResolverId: resolver('quest', 'actual-end.rescue-exploration'),
  },
  {
    kind: 'quest-deadline-rule',
    id: DEADLINE_RULE_IDS.suppressionHunt,
    acceptDurationDays: 14,
    actualEndResolverId: resolver('quest', 'actual-end.suppression-hunt'),
  },
];

type ReputationTier = 'minor' | 'standard' | 'major';


type RewardRow = Readonly<{
  experienceAwardLocal: string;
  reputationTier: ReputationTier;
}>;

const REWARD_ROWS: Readonly<Record<QuestKind, RewardRow>> = {
  purchase: { experienceAwardLocal: 'quest-purchase', reputationTier: 'minor' },
  delivery: { experienceAwardLocal: 'quest-delivery', reputationTier: 'minor' },
  escort: { experienceAwardLocal: 'quest-escort', reputationTier: 'standard' },
  rescue: { experienceAwardLocal: 'quest-rescue', reputationTier: 'standard' },
  exploration: { experienceAwardLocal: 'quest-exploration', reputationTier: 'standard' },
  suppression: { experienceAwardLocal: 'quest-suppression', reputationTier: 'major' },
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
    };
  },
);

type ReactionRow = Readonly<{
  local: string;
  sourceKind: QuestReactionSourceKind;
  questKind: QuestKind;
  creationChance: number;
  guildResolverLocal: string;
  destinationResolverLocal?: string;
  deadlineRuleId: QuestDeadlineRuleId;
}>;

const REACTION_ROWS: readonly ReactionRow[] = [
  {
    local: 'monster-group-suppression',
    sourceKind: 'monsterGroup',
    questKind: 'suppression',
    creationChance: 0.35,
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
    guildResolverLocal: 'guild.local-city',
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
    destinationResolverLocal: 'delivery-destination',
    deadlineRuleId: DEADLINE_RULE_IDS.purchaseDelivery,
  },
];

const reactionRules: readonly Authored<QuestReactionRuleDefinition>[] = REACTION_ROWS.map((row) => ({
  kind: 'quest-reaction-rule',
  id: core.id<QuestReactionRuleId>('quest-reaction-rule', row.local),
  sourceKind: row.sourceKind,
  questKind: row.questKind,
  creationChance: row.creationChance,
  ...(row.sourceKind === 'cityStockItem' ? { sourceItemKinds: ['material', 'combatConsumable', 'nonCombatConsumable', 'generalItem'] as const } : {}),
  guildResolverId: resolver('quest', row.guildResolverLocal),
  ...(row.destinationResolverLocal === undefined
    ? {}
    : { destinationResolverId: resolver('quest', row.destinationResolverLocal) }),
  deadlineRuleId: row.deadlineRuleId,
  objectiveRuleId: OBJECTIVE_RULE_IDS[row.questKind],
  rewardRuleId: REWARD_RULE_IDS[row.questKind],
}));


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

const npcCuisineDecisionRule: Authored<NpcCuisineDecisionRuleDefinition> = {
  kind: 'npc-cuisine-decision-rule',
  id: core.id<NpcCuisineDecisionRuleId>('npc-cuisine-decision-rule', 'standard'),
  selfCookWeightResolverId: resolver('crafting', 'npc-cuisine.self-cook-weight'),
  restaurantWeightResolverId: resolver('crafting', 'npc-cuisine.restaurant-weight'),
};


const RETRY_SUPPLY_POLICY_ID = core.id<RetrySupplyPolicyId>('retry-supply-policy', 'standard');

const retrySupplyPolicy: Authored<RetrySupplyPolicyDefinition> = {
  kind: 'retry-supply-policy',
  id: RETRY_SUPPLY_POLICY_ID,
  eligibleItemTagIds: [core.id<ItemTagId>('item-tag', 'combat-consumable')],
  selection: 'lowestValueThenStableId',
  quantityPerRetry: 1,
};

const combatSequenceRule: Authored<CombatSequenceRuleDefinition> = {
  kind: 'combat-sequence-rule',
  id: core.id<CombatSequenceRuleId>('combat-sequence-rule', 'standard'),
  enabled: false,
  combatPowerRuleId: core.id<CombatPowerRuleId>('combat-power-rule', 'shared'),
  successChanceResolverId: resolver('combat-sequence', 'success-chance'),
  successChanceParamsId: core.id<CombatSequenceSuccessChanceParamsId>(
    'combat-sequence-success-chance-params',
    'standard',
  ),
  retryRelativePowerGapMaximum: 0.15,
  maxRetryCountPerChallenge: 1,
  retrySupplyPolicyId: RETRY_SUPPLY_POLICY_ID,
  defenseMasteryRoutingRuleId: core.id<DefenseMasteryRoutingRuleId>(
    'defense-mastery-routing-rule',
    'standard',
  ),
  attackWeightScale: 6,
  attackSkillAggregation: 'equalConfiguredAttackSkills',
  distributionRounding: 'largestRemainderStableId',
};


const ACTUAL_END_RANGES: readonly Readonly<{ local: string; min: number; max: number }>[] = [
  { local: 'purchase-delivery', min: 14, max: 28 },
  { local: 'rescue-exploration', min: 7, max: 14 },
  { local: 'suppression-hunt', min: 21, max: 28 },
];

const actualEndParams: readonly Authored<DefinitionHeader & IntegerRangeParams>[] =
  ACTUAL_END_RANGES.map((row) => ({
    kind: 'integer-range-params',
    id: core.id('integer-range-params', `quest-actual-end-${row.local}`),
    min: row.min,
    max: row.max,
  }));

export function questGenerationBindings(): readonly ResolverBinding[] {
  return [
    {
      resolverId: resolver('quest', 'guild.local-city'),
      ownerModule: QUEST_MODULE,
      shape: 'quest-guild:local-city',
    },
    {
      resolverId: resolver('quest', 'guild.random-legal-city'),
      ownerModule: QUEST_MODULE,
      shape: 'quest-guild:random-city',
    },
    {
      resolverId: resolver('quest', 'delivery-destination'),
      ownerModule: QUEST_MODULE,
      shape: 'quest-destination:other-city',
    },
    ...ACTUAL_END_RANGES.map((row, i) => ({
      resolverId: resolver('quest', `actual-end.${row.local}`),
      ownerModule: QUEST_MODULE,
      shape: 'quest-actual-end:day-range',
      paramsDefId: actualEndParams[i]!.id,
    })),
  ];
}

export const questCraftingSequenceDomain: AuthoredDomain = {
  domain: 'quest-crafting-sequence',
  definitions: [
    ...objectiveRules,
    ...deadlineRules,
    ...rewardRules,
    ...reactionRules,
    ...actualEndParams,
    ...craftQualityRules,
    npcCuisineDecisionRule,
    retrySupplyPolicy,
    combatSequenceRule,
  ],
};
