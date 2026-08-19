// domain-services/combat-power/fixtures.ts
// 決定性測試 fixture。**正式路徑不得引用本檔**（規範 §13，門禁靠檔名排除）。
//
// 這裡刻意提供**兩份**內容變體（muscleHeavy / mindHeavy）：同一組 Feature Rule ID、不同的
// coefficient。它們是「換一份 Content Pack」的最小模型，用來釘住本服務最重要的性質——
// 戰力排序由資料決定，不由程式決定。
//
// 兩個 Resolver 以外的東西都不在這裡發明數值：Resolver 的行為一律由 §7.1 kernel + 本檔的 params
// 組成（fixture 內的 params 就是「這一份測試 pack 的調校量」），不是手寫公式。

import type {
  CharacterId,
  ContentPackId,
  EncounterGroupDefinitionId,
  EquipmentEffectDefinitionId,
  MonsterDefinitionId,
  QuestId,
  ResolverId,
  Revision,
  SecondaryAttributeId,
  SkillDefinitionId,
  SkillTagId,
  StatisticsRuleId,
  TeamId,
  WeaponRequirementId,
  WeaponSetId,
} from '../../contracts/core';
import type { DefinitionId } from '../../contracts/core';
import type {
  CombatCapabilityId,
  CombatPowerFeasibilityRuleId,
  CombatPowerFeatureId,
  CombatPowerFeatureRuleId,
  CombatPowerRuleId,
  CombatUnitStatisticsSnapshot,
  EquipmentLoadoutCandidateId,
} from '../../contracts/combat-power';
import type { CharacterEquipmentLoadoutView } from '../../contracts/inventory';
import type { GridCell } from '../../contracts/map';
import type { QuestObjectiveView } from '../../contracts/quest';
import {
  createDefinitionRegistry,
  logisticCurve,
  weightedLinearProduct,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';
import type {
  CombatPowerEncounterCompositionView,
  CombatPowerEncounterPort,
  CombatPowerLoadoutPort,
  CombatPowerQuestOppositionPort,
  CombatPowerResolverPort,
  CombatPowerStatisticsPort,
  CombatPowerTeamCompositionView,
  CombatPowerTeamPort,
  CombatPowerWeaponSetConfigurationView,
} from './combat-power';

export const FIXTURE = {
  packId: 'pack:combat-power-bringup' as ContentPackId,

  ruleId: 'definition:combat-power-rule:standard' as CombatPowerRuleId,
  otherRuleId: 'definition:combat-power-rule:other' as CombatPowerRuleId,
  feasibilityRuleId: 'definition:combat-power-feasibility-rule:standard' as CombatPowerFeasibilityRuleId,
  statisticsRuleId: 'definition:statistics-rule:standard' as StatisticsRuleId,

  featureRuleIds: {
    muscle: 'definition:combat-power-feature-rule:muscle' as CombatPowerFeatureRuleId,
    intelligence: 'definition:combat-power-feature-rule:intelligence' as CombatPowerFeatureRuleId,
    attackPower: 'definition:combat-power-feature-rule:attack-power' as CombatPowerFeatureRuleId,
    health: 'definition:combat-power-feature-rule:health' as CombatPowerFeatureRuleId,
    healing: 'definition:combat-power-feature-rule:healing' as CombatPowerFeatureRuleId,
    ward: 'definition:combat-power-feature-rule:ward' as CombatPowerFeatureRuleId,
    duplicateMuscle: 'definition:combat-power-feature-rule:muscle-again' as CombatPowerFeatureRuleId,
  },
  featureIds: {
    muscle: 'definition:combat-power-feature:muscle' as CombatPowerFeatureId,
    intelligence: 'definition:combat-power-feature:intelligence' as CombatPowerFeatureId,
    attackPower: 'definition:combat-power-feature:attack-power' as CombatPowerFeatureId,
    health: 'definition:combat-power-feature:health' as CombatPowerFeatureId,
    healing: 'definition:combat-power-feature:healing' as CombatPowerFeatureId,
    ward: 'definition:combat-power-feature:ward' as CombatPowerFeatureId,
  },
  capabilityIds: {
    healing: 'definition:combat-capability:healing' as CombatCapabilityId,
    ward: 'definition:combat-capability:ward' as CombatCapabilityId,
  },
  attackPowerAttributeId: 'definition:secondary-attribute:attack-power' as SecondaryAttributeId,
  missingAttributeId: 'definition:secondary-attribute:absent' as SecondaryAttributeId,

  resolverIds: {
    unitAggregation: 'resolver:combat-power.unit-sum' as ResolverId,
    teamFormation: 'resolver:combat-power.formation' as ResolverId,
    halveTransform: 'resolver:combat-power.halve' as ResolverId,
    capabilityScaling: 'resolver:combat-power.capability-scaling' as ResolverId,
    expectedSuccess: 'resolver:combat-power.expected-success' as ResolverId,
  },

  skillIds: {
    slash: 'definition:skill:slash' as SkillDefinitionId,
    heal: 'definition:skill:heal' as SkillDefinitionId,
    arcane: 'definition:skill:arcane-bolt' as SkillDefinitionId,
  },
  skillTagIds: {
    attack: 'definition:skill-tag:attack' as SkillTagId,
    support: 'definition:skill-tag:support' as SkillTagId,
    fire: 'definition:skill-tag:fire' as SkillTagId,
  },
  weaponRequirementIds: {
    sword: 'definition:weapon-requirement:one-handed-sword' as WeaponRequirementId,
    staff: 'definition:weapon-requirement:staff' as WeaponRequirementId,
  },
  equipmentEffectIds: {
    wardAlways: 'definition:equipment-effect:ward-always' as EquipmentEffectDefinitionId,
    wardFireBound: 'definition:equipment-effect:ward-fire-bound' as EquipmentEffectDefinitionId,
  },

  characterIds: {
    brawler: 'runtime:character:brawler' as CharacterId,
    scholar: 'runtime:character:scholar' as CharacterId,
    outsider: 'runtime:character:outsider' as CharacterId,
  },
  weaponSetIds: {
    sword: 'runtime:weapon-set:sword' as WeaponSetId,
    staff: 'runtime:weapon-set:staff' as WeaponSetId,
  },
  teamId: 'runtime:team:player' as TeamId,
  questId: 'runtime:quest:hunt' as QuestId,
  monsterDefinitionId: 'definition:monster:ogre' as MonsterDefinitionId,
  encounterGroupId: 'definition:encounter-group:ogre-pair' as EncounterGroupDefinitionId,
  candidateIds: {
    current: 'ephemeral:equipment-loadout-candidate:current' as EquipmentLoadoutCandidateId,
    alternate: 'ephemeral:equipment-loadout-candidate:alternate' as EquipmentLoadoutCandidateId,
    tieBreaker: 'ephemeral:equipment-loadout-candidate:aaa-tie' as EquipmentLoadoutCandidateId,
  },
} as const;

// ── 內容變體：同一組 Feature Rule ID、不同 coefficient ────────────────────────

export type FixtureContentVariant = 'muscleHeavy' | 'mindHeavy';

const COEFFICIENTS: Readonly<Record<FixtureContentVariant, Readonly<{ muscle: number; intelligence: number }>>> = {
  muscleHeavy: { muscle: 2, intelligence: 0.5 },
  mindHeavy: { muscle: 0.5, intelligence: 2 },
};

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-bringup',
  manifestHash: 'bringup',
  packs: [{ packId: FIXTURE.packId, version: '0.0.0', hash: 'bringup' }],
};

export function definition(
  id: string,
  kind: string,
  data: Record<string, unknown>,
): ContentDefinition {
  return {
    id: id as DefinitionId,
    kind,
    schemaVersion: 1,
    packId: FIXTURE.packId,
    enabled: true,
    sourcePath: `mem://${kind}/${id}`,
    data: data as ContentDefinition['data'],
  };
}

// kind 字串與 app/content/combat-power-reader.ts 的 COMBAT_POWER_DEFINITION_KINDS 一致。
// fixture 不 import 那個常數，是為了讓「reader 的 kind 命名改了」在測試裡以失敗的形式被看見。
export function combatPowerDefinitions(
  variant: FixtureContentVariant = 'muscleHeavy',
): readonly ContentDefinition[] {
  const coefficients = COEFFICIENTS[variant];
  return [
    definition(FIXTURE.ruleId, 'combat-power-rule', {
      statisticsRuleId: FIXTURE.statisticsRuleId,
      featureRuleIds: [
        FIXTURE.featureRuleIds.muscle,
        FIXTURE.featureRuleIds.intelligence,
        FIXTURE.featureRuleIds.attackPower,
        FIXTURE.featureRuleIds.health,
        FIXTURE.featureRuleIds.healing,
        FIXTURE.featureRuleIds.ward,
      ],
      feasibilityRuleId: FIXTURE.feasibilityRuleId,
      unitAggregationResolverId: FIXTURE.resolverIds.unitAggregation,
      teamFormationResolverId: FIXTURE.resolverIds.teamFormation,
      teamAggregation: 'sumMembersThenFormation',
      encounterAggregation: 'sumMembersThenFormation',
      minimumPower: 1,
      rounding: 'roundHalfUpAtFinalOutput',
    }),
    definition(FIXTURE.feasibilityRuleId, 'combat-power-feasibility-rule', {
      combatPowerRuleId: FIXTURE.ruleId,
      expectedSuccessResolverId: FIXTURE.resolverIds.expectedSuccess,
      riskBandThresholds: [
        { maxExpectedSuccess: 0.05, riskBand: 'impossible' },
        { maxExpectedSuccess: 0.3, riskBand: 'dangerous' },
        { maxExpectedSuccess: 0.6, riskBand: 'even' },
        { maxExpectedSuccess: 0.9, riskBand: 'favorable' },
        { maxExpectedSuccess: 1, riskBand: 'trivial' },
      ],
      minimumAttemptExpectedSuccess: 0.4,
      opposingAggregation: 'sumEncounterGroups',
    }),
    definition(FIXTURE.featureRuleIds.muscle, 'combat-power-feature-rule', {
      featureId: FIXTURE.featureIds.muscle,
      source: { kind: 'primaryAttribute', attributeId: 'muscle' },
      coefficient: coefficients.muscle,
    }),
    definition(FIXTURE.featureRuleIds.intelligence, 'combat-power-feature-rule', {
      featureId: FIXTURE.featureIds.intelligence,
      source: { kind: 'primaryAttribute', attributeId: 'intelligence' },
      coefficient: coefficients.intelligence,
    }),
    definition(FIXTURE.featureRuleIds.attackPower, 'combat-power-feature-rule', {
      featureId: FIXTURE.featureIds.attackPower,
      source: { kind: 'secondaryAttribute', attributeId: FIXTURE.attackPowerAttributeId },
      coefficient: 1,
    }),
    definition(FIXTURE.featureRuleIds.health, 'combat-power-feature-rule', {
      featureId: FIXTURE.featureIds.health,
      source: { kind: 'maximumResource', resource: 'health' },
      coefficient: 1,
      transformResolverId: FIXTURE.resolverIds.halveTransform,
    }),
    definition(FIXTURE.featureRuleIds.healing, 'combat-power-feature-rule', {
      featureId: FIXTURE.featureIds.healing,
      source: { kind: 'skillCapability', capabilityId: FIXTURE.capabilityIds.healing },
      coefficient: 1,
    }),
    definition(FIXTURE.featureRuleIds.ward, 'combat-power-feature-rule', {
      featureId: FIXTURE.featureIds.ward,
      source: { kind: 'equipmentEffectCapability', capabilityId: FIXTURE.capabilityIds.ward },
      coefficient: 1,
    }),
    // 重複 Feature ID（與 muscle 同一個 featureId），供 §7.2 的重複檢查用。
    definition(FIXTURE.featureRuleIds.duplicateMuscle, 'combat-power-feature-rule', {
      featureId: FIXTURE.featureIds.muscle,
      source: { kind: 'primaryAttribute', attributeId: 'muscle' },
      coefficient: 1,
    }),

    definition(FIXTURE.skillIds.slash, 'skill', {
      weaponRequirementIds: [FIXTURE.weaponRequirementIds.sword],
      skillTagIds: [FIXTURE.skillTagIds.attack],
      capabilityContributions: [],
    }),
    definition(FIXTURE.skillIds.heal, 'skill', {
      weaponRequirementIds: [],
      skillTagIds: [FIXTURE.skillTagIds.support],
      capabilityContributions: [
        { capabilityId: FIXTURE.capabilityIds.healing, baseValue: 10 },
      ],
    }),
    definition(FIXTURE.skillIds.arcane, 'skill', {
      weaponRequirementIds: [FIXTURE.weaponRequirementIds.staff],
      skillTagIds: [FIXTURE.skillTagIds.fire, FIXTURE.skillTagIds.attack],
      capabilityContributions: [
        {
          capabilityId: FIXTURE.capabilityIds.healing,
          baseValue: 5,
          scalingResolverId: FIXTURE.resolverIds.capabilityScaling,
        },
      ],
    }),

    definition(FIXTURE.equipmentEffectIds.wardAlways, 'equipment-effect', {
      triggerEligibility: 'alwaysWhileEquipped',
      requiredSkillTagIds: [],
      capabilityContributions: [{ capabilityId: FIXTURE.capabilityIds.ward, baseValue: 7 }],
    }),
    definition(FIXTURE.equipmentEffectIds.wardFireBound, 'equipment-effect', {
      triggerEligibility: 'configuredSkillCompatible',
      requiredSkillTagIds: [FIXTURE.skillTagIds.fire, FIXTURE.skillTagIds.attack],
      capabilityContributions: [{ capabilityId: FIXTURE.capabilityIds.ward, baseValue: 11 }],
    }),
  ];
}

export function createFixtureRegistry(
  variant: FixtureContentVariant = 'muscleHeavy',
  extra: readonly ContentDefinition[] = [],
): DefinitionRegistry {
  return createDefinitionRegistry([...combatPowerDefinitions(variant), ...extra], IDENTITY);
}

// ── Resolver Port：kernel + 本 fixture pack 的 params ─────────────────────────
//
// 五個角色各對一組 params。這些 params 是「這份測試 pack 的調校量」，換成正式 pack 時由
// Content Pack 提供，程式形狀（哪個 kernel）不變。

const HALVE_PARAMS = { mode: 'linear', terms: [{ inputKey: 'rawAmount', weight: 0.5 }] } as const;
const SCALING_PARAMS = { mode: 'linear', terms: [{ inputKey: 'baseValue', weight: 2 }] } as const;
const FORMATION_PARAMS = {
  mode: 'linear',
  bias: 1,
  terms: [{ inputKey: 'memberCount', weight: 0.1 }],
} as const;
const EXPECTED_SUCCESS_PARAMS = {
  bias: 0,
  terms: [
    { inputKey: 'teamPower', weight: 0.01 },
    { inputKey: 'opposingPower', weight: -0.01 },
  ],
} as const;

export function createFixtureResolverPort(): CombatPowerResolverPort {
  return {
    transformFeatureAmount: (_resolverId, input) =>
      weightedLinearProduct(HALVE_PARAMS, { rawAmount: input.rawAmount }),
    scaleCapabilityContribution: (_resolverId, input) =>
      weightedLinearProduct(SCALING_PARAMS, { baseValue: input.baseValue }),
    // 第一版單位聚合就是「加權後的 Feature 量相加」（形狀在程式、權重在資料）。
    aggregateUnitFeatures: (_resolverId, input) =>
      input.featureAmounts.reduce((sum, amount) => sum + amount.weightedAmount, 0),
    resolveFormationModifier: (_resolverId, input) =>
      weightedLinearProduct(FORMATION_PARAMS, { memberCount: input.placements.length }),
    resolveExpectedSuccess: (_resolverId, input) =>
      logisticCurve(EXPECTED_SUCCESS_PARAMS, {
        teamPower: input.teamPower,
        opposingPower: input.opposingPower,
      }),
  };
}

// ── 世界事實 Port 的決定性 stub ───────────────────────────────────────────────

export function cell(row: number, col: number): GridCell {
  return { floor: 0, row, col };
}

export function statisticsSnapshot(
  params: Readonly<{
    muscle: number;
    intelligence: number;
    attackPower: number;
    maxHealth: number;
    maxMana: number;
    revisionKey: string;
    omitAttackPower?: boolean;
  }>,
): CombatUnitStatisticsSnapshot {
  const secondaryAttributes: Record<SecondaryAttributeId, number> = {};
  if (params.omitAttackPower !== true) {
    secondaryAttributes[FIXTURE.attackPowerAttributeId] = params.attackPower;
  }
  return {
    effectivePrimaryAttributes: {
      muscle: params.muscle,
      intelligence: params.intelligence,
      reaction: 10,
      coordination: 10,
      charisma: 10,
    },
    secondaryAttributes,
    maxHealth: params.maxHealth,
    maxMana: params.maxMana,
    sourceRevisionKey: params.revisionKey,
  };
}

export const BRAWLER_STATISTICS = statisticsSnapshot({
  muscle: 40,
  intelligence: 10,
  attackPower: 12,
  maxHealth: 100,
  maxMana: 20,
  revisionKey: 'stats@brawler@1',
});

export const SCHOLAR_STATISTICS = statisticsSnapshot({
  muscle: 10,
  intelligence: 40,
  attackPower: 12,
  maxHealth: 100,
  maxMana: 20,
  revisionKey: 'stats@scholar@1',
});

export const MONSTER_STATISTICS = statisticsSnapshot({
  muscle: 30,
  intelligence: 5,
  attackPower: 20,
  maxHealth: 200,
  maxMana: 0,
  revisionKey: 'stats@ogre@1',
});

export function configurationKey(characterId: CharacterId, weaponSetId: WeaponSetId): string {
  return `${String(characterId)}|${String(weaponSetId)}`;
}

export function weaponSetConfiguration(
  params: Readonly<{
    characterId: CharacterId;
    selectedWeaponSetId: WeaponSetId;
    configuredSkillIds: readonly SkillDefinitionId[];
    satisfiedWeaponRequirementIds: readonly WeaponRequirementId[];
    activeEquipmentEffectIds: readonly EquipmentEffectDefinitionId[];
    battleReady?: boolean;
    sourceRevisionKey?: string;
  }>,
): CombatPowerWeaponSetConfigurationView {
  return {
    characterId: params.characterId,
    selectedWeaponSetId: params.selectedWeaponSetId,
    configuredSkillIds: params.configuredSkillIds,
    satisfiedWeaponRequirementIds: params.satisfiedWeaponRequirementIds,
    activeEquipmentEffectIds: params.activeEquipmentEffectIds,
    battleReady: params.battleReady !== false,
    sourceRevisionKey:
      params.sourceRevisionKey === undefined
        ? `loadout@${String(params.characterId)}@${String(params.selectedWeaponSetId)}@1`
        : params.sourceRevisionKey,
  };
}

// combat-power 不解讀 Loadout 的內容（它只是原樣轉給 statistics／inventory Port），
// 所以這裡只需要一個結構合法的最小值。
export const EMPTY_LOADOUT: CharacterEquipmentLoadoutView = {
  characterId: FIXTURE.characterIds.brawler,
  armorSlots: {},
  weaponSets: [
    { weaponSetId: FIXTURE.weaponSetIds.sword, selectedSkillIds: [] },
    { weaponSetId: FIXTURE.weaponSetIds.staff, selectedSkillIds: [] },
    { weaponSetId: FIXTURE.weaponSetIds.sword, selectedSkillIds: [] },
  ],
  revision: 1 as Revision,
};

export type FixtureWorld = Readonly<{
  statisticsByCharacterId: Readonly<Record<string, CombatUnitStatisticsSnapshot>>;
  candidateStatisticsByKey: Readonly<Record<string, CombatUnitStatisticsSnapshot>>;
  configurationByKey: Readonly<Record<string, CombatPowerWeaponSetConfigurationView>>;
  candidateConfigurationByKey: Readonly<Record<string, CombatPowerWeaponSetConfigurationView>>;
  teamComposition?: CombatPowerTeamCompositionView;
  encounterComposition?: CombatPowerEncounterCompositionView;
  opposingByObjectiveKind: Readonly<Record<string, readonly EncounterGroupDefinitionId[]>>;
}>;

export function defaultTeamComposition(): CombatPowerTeamCompositionView {
  return {
    teamId: FIXTURE.teamId,
    formationRevision: 7 as Revision,
    formalMembers: [
      {
        characterId: FIXTURE.characterIds.brawler,
        anchorCell: cell(0, 0),
        occupiedCells: [cell(0, 0)],
        selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
      },
      {
        characterId: FIXTURE.characterIds.scholar,
        anchorCell: cell(1, 1),
        occupiedCells: [cell(1, 1)],
        selectedWeaponSetId: FIXTURE.weaponSetIds.staff,
      },
    ],
    sourceRevisionKey: 'team@player@7',
  };
}

export function defaultEncounterComposition(): CombatPowerEncounterCompositionView {
  return {
    encounterGroupId: FIXTURE.encounterGroupId,
    members: [
      {
        monsterDefinitionId: FIXTURE.monsterDefinitionId,
        memberIndex: 0,
        statistics: MONSTER_STATISTICS,
        configuredSkillIds: [FIXTURE.skillIds.heal],
        satisfiedWeaponRequirementIds: [],
        activeEquipmentEffectIds: [],
        anchorCell: cell(0, 0),
        occupiedCells: [cell(0, 0)],
        sourceRevisionKey: 'encounter-member@ogre@0',
      },
      {
        monsterDefinitionId: FIXTURE.monsterDefinitionId,
        memberIndex: 1,
        statistics: MONSTER_STATISTICS,
        configuredSkillIds: [FIXTURE.skillIds.heal],
        satisfiedWeaponRequirementIds: [],
        activeEquipmentEffectIds: [],
        anchorCell: cell(1, 0),
        occupiedCells: [cell(1, 0)],
        sourceRevisionKey: 'encounter-member@ogre@1',
      },
    ],
    encounterDefinitionRevisionKey: 'encounter@ogre-pair@1',
  };
}

export function defaultFixtureWorld(): FixtureWorld {
  const brawlerConfiguration = weaponSetConfiguration({
    characterId: FIXTURE.characterIds.brawler,
    selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
    configuredSkillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
    satisfiedWeaponRequirementIds: [FIXTURE.weaponRequirementIds.sword],
    activeEquipmentEffectIds: [FIXTURE.equipmentEffectIds.wardAlways],
  });
  const scholarConfiguration = weaponSetConfiguration({
    characterId: FIXTURE.characterIds.scholar,
    selectedWeaponSetId: FIXTURE.weaponSetIds.staff,
    configuredSkillIds: [FIXTURE.skillIds.arcane, FIXTURE.skillIds.heal],
    satisfiedWeaponRequirementIds: [FIXTURE.weaponRequirementIds.staff],
    activeEquipmentEffectIds: [FIXTURE.equipmentEffectIds.wardFireBound],
  });
  return {
    statisticsByCharacterId: {
      [String(FIXTURE.characterIds.brawler)]: BRAWLER_STATISTICS,
      [String(FIXTURE.characterIds.scholar)]: SCHOLAR_STATISTICS,
    },
    candidateStatisticsByKey: {
      [configurationKey(FIXTURE.characterIds.brawler, FIXTURE.weaponSetIds.sword)]:
        BRAWLER_STATISTICS,
      [configurationKey(FIXTURE.characterIds.brawler, FIXTURE.weaponSetIds.staff)]:
        SCHOLAR_STATISTICS,
    },
    configurationByKey: {
      [configurationKey(FIXTURE.characterIds.brawler, FIXTURE.weaponSetIds.sword)]:
        brawlerConfiguration,
      [configurationKey(FIXTURE.characterIds.scholar, FIXTURE.weaponSetIds.staff)]:
        scholarConfiguration,
    },
    candidateConfigurationByKey: {
      [configurationKey(FIXTURE.characterIds.brawler, FIXTURE.weaponSetIds.sword)]:
        brawlerConfiguration,
      [configurationKey(FIXTURE.characterIds.brawler, FIXTURE.weaponSetIds.staff)]:
        weaponSetConfiguration({
          characterId: FIXTURE.characterIds.brawler,
          selectedWeaponSetId: FIXTURE.weaponSetIds.staff,
          configuredSkillIds: [FIXTURE.skillIds.arcane],
          satisfiedWeaponRequirementIds: [FIXTURE.weaponRequirementIds.staff],
          activeEquipmentEffectIds: [FIXTURE.equipmentEffectIds.wardFireBound],
        }),
    },
    teamComposition: defaultTeamComposition(),
    encounterComposition: defaultEncounterComposition(),
    // hunt 目標對到一個編組；purchase 完全不在表內 → Port 回 undefined → unsupportedObjective。
    opposingByObjectiveKind: { hunt: [FIXTURE.encounterGroupId] },
  };
}

export type FixturePorts = Readonly<{
  statistics: CombatPowerStatisticsPort;
  loadout: CombatPowerLoadoutPort;
  team: CombatPowerTeamPort;
  encounter: CombatPowerEncounterPort;
  questOpposition: CombatPowerQuestOppositionPort;
}>;

export function createFixturePorts(world: FixtureWorld): FixturePorts {
  return {
    statistics: {
      getCharacterStatistics: (input) =>
        world.statisticsByCharacterId[String(input.characterId)],
      getStatisticsForCandidateLoadout: (input) =>
        world.candidateStatisticsByKey[
          configurationKey(input.characterId, input.selectedWeaponSetId)
        ],
    },
    loadout: {
      getWeaponSetConfiguration: (input) =>
        world.configurationByKey[
          configurationKey(input.characterId, input.selectedWeaponSetId)
        ],
      getCandidateWeaponSetConfiguration: (input) =>
        world.candidateConfigurationByKey[
          configurationKey(input.characterId, input.selectedWeaponSetId)
        ],
    },
    team: {
      getComposition: (teamId) =>
        world.teamComposition !== undefined && String(world.teamComposition.teamId) === String(teamId)
          ? world.teamComposition
          : undefined,
    },
    encounter: {
      getComposition: (encounterGroupId) =>
        world.encounterComposition !== undefined &&
        String(world.encounterComposition.encounterGroupId) === String(encounterGroupId)
          ? world.encounterComposition
          : undefined,
    },
    questOpposition: {
      listOpposingEncounterGroupIds: (objective: QuestObjectiveView) =>
        world.opposingByObjectiveKind[objective.kind],
    },
  };
}

export const HUNT_OBJECTIVE: QuestObjectiveView = {
  kind: 'hunt',
  mapId: 'runtime:map-instance:lair' as never,
  bossContentIds: [],
};

export const PURCHASE_OBJECTIVE: QuestObjectiveView = {
  kind: 'purchase',
  itemId: 'runtime:item-instance:gem' as never,
  shopOfferId: 'runtime:shop-offer:gem' as never,
};
