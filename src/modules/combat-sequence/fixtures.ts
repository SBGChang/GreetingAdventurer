// modules/combat-sequence/fixtures.ts
// 最小測試 Fixture（對應 docs/00_core/architecture/21_combat_sequence_module.md §10）：
// 一支三人隊（攻擊權重 6／4／0、防禦列 0／1／2）、五個等值 Challenge 的戰鬥串，
// 加上 Definition Reader / Supply Query / Success-Chance Port / DeterministicRng 的決定性 stub。
//
// 純資料／純函式，無外部依賴。**正式路徑不得引用本檔**（門禁：verify-runtime-discipline）。

import type {
  CharacterId,
  ContentInstanceId,
  ContentPackId,
  DeterministicRng,
  ItemInstanceId,
  ItemTagId,
  MapInstanceId,
  MasteryId,
  Revision,
  RngContext,
  RngCursor,
  RngStreamId,
  Seed,
  SkillDefinitionId,
  SupportMasteryAwardRuleId,
  TeamId,
  WeaponSetId,
  WorldDay,
  ResolverId,
  EncounterGroupDefinitionId,
} from '../../contracts/core';
import type { CombatPowerRuleId, TeamCombatPowerSnapshot } from '../../contracts/combat-power';
import type { DefenseMasteryRoutingRuleId } from '../../contracts/progression';
import type {
  CombatSequenceAllocationSnapshot,
  CombatSequenceChallengeId,
  CombatSequenceChallengeResultId,
  CombatSequenceChallengeSnapshot,
  CombatSequenceDefinitionReader,
  CombatSequenceId,
  CombatSequenceMemberSnapshot,
  CombatSequenceRuleDefinition,
  CombatSequenceRuleId,
  CombatSequenceSourceCommitId,
  CombatSequenceSourceId,
  CombatSequenceSuccessChanceParamsId,
  CombatSequenceSupplyQuery,
  RetrySupplyCandidate,
  RetrySupplyPolicyDefinition,
  RetrySupplyPolicyId,
  SimplifiedCombatChallengeDefinitionView,
  SimplifiedCombatSkillDefinitionView,
  StartCombatSequence,
} from '../../contracts/combat-sequence';
import { logisticCurve, type LogisticCurveParams } from '../../data-runtime';

import type { CombatSequenceModuleState } from './state';
import { createInitialCombatSequenceState } from './state';
import type { CombatSequenceContext, CombatSequenceSuccessChancePort } from './system';
import {
  createCombatSequenceChallengeResolver,
  createCombatSequenceMasteryAllocator,
  handleStartCombatSequence,
} from './system';

const PACK = 'pack:combat-sequence-fixture' as ContentPackId;

// ── 固定 ID ────────────────────────────────────────────────────────────────
export const FIXTURE = {
  teamId: 'runtime:team:player' as TeamId,
  sequenceId: 'runtime:combat-sequence:sweep-1' as CombatSequenceId,
  sourceId: 'runtime:combat-sequence-source:dungeon-1' as CombatSequenceSourceId,
  sourceCommitId: 'runtime:combat-sequence-source-commit:c1' as CombatSequenceSourceCommitId,
  otherCommitId: 'runtime:combat-sequence-source-commit:c2' as CombatSequenceSourceCommitId,
  mapId: 'runtime:map-instance:cave' as MapInstanceId,
  mapVersion: 3,

  hero: 'runtime:character:hero' as CharacterId,
  ally: 'runtime:character:ally' as CharacterId,
  bard: 'runtime:character:bard' as CharacterId,

  weaponSetHero: 'runtime:weapon-set:hero-main' as WeaponSetId,
  weaponSetAlly: 'runtime:weapon-set:ally-main' as WeaponSetId,
  weaponSetBard: 'runtime:weapon-set:bard-main' as WeaponSetId,

  ruleId: 'definition:combat-sequence-rule:base' as CombatSequenceRuleId,
  successChanceResolverId: 'resolver:combat-sequence-success-chance' as ResolverId,
  successChanceParamsId:
    'definition:combat-sequence-success-chance-params:base' as CombatSequenceSuccessChanceParamsId,
  policyId: 'definition:retry-supply-policy:base' as RetrySupplyPolicyId,
  combatPowerRuleId: 'definition:combat-power-rule:base' as CombatPowerRuleId,
  defenseRoutingRuleId:
    'definition:defense-mastery-routing-rule:base' as DefenseMasteryRoutingRuleId,
  potionTagId: 'definition:item-tag:potion' as ItemTagId,

  encounterGroupId: 'definition:encounter-group:slimes' as EncounterGroupDefinitionId,
  skillBladeA: 'definition:skill:blade-strike' as SkillDefinitionId,
  skillBladeB: 'definition:skill:blade-sweep' as SkillDefinitionId,
  skillChant: 'definition:skill:war-chant' as SkillDefinitionId,
  chantAwardRuleId: 'definition:support-mastery-award-rule:chant' as SupportMasteryAwardRuleId,

  masteryBlade: 'definition:mastery:blade' as MasteryId,
  masteryGuard: 'definition:mastery:guard' as MasteryId,

  potionCheap: 'runtime:item-instance:potion-cheap' as ItemInstanceId,
  potionPricey: 'runtime:item-instance:potion-pricey' as ItemInstanceId,

  worldSeed: 'seed:combat-sequence-fixture' as Seed,
  streamId: 'rng-stream:combat-sequence-fixture' as RngStreamId,
  worldDay: 120 as WorldDay,
  teamPowerRevisionKey: 'team-power-rev-1',
  enemyPowerRevisionKey: 'enemy-power-rev-1',
  encounterSourceRevisionKey: 'encounter-def-rev-1',
} as const;

// 每個 Challenge 的等值預算（整數：最大餘數法要求總發放量等於預算）。
export const FIXTURE_BUDGETS = { attack: 10, defense: 6 } as const;
export const FIXTURE_CHALLENGE_COUNT = 5;
export const FIXTURE_TEAM_POWER = 100;
export const FIXTURE_ENEMY_POWER = 100;

export function challengeId(index: number): CombatSequenceChallengeId {
  return `runtime:combat-sequence-challenge:c${index}` as CombatSequenceChallengeId;
}

// ── Definition stub ────────────────────────────────────────────────────────

export function fixtureRule(
  overrides?: Partial<CombatSequenceRuleDefinition>,
): CombatSequenceRuleDefinition {
  return {
    id: FIXTURE.ruleId,
    schemaVersion: 1,
    packId: PACK,
    enabled: true,
    combatPowerRuleId: FIXTURE.combatPowerRuleId,
    successChanceResolverId: FIXTURE.successChanceResolverId,
    successChanceParamsId: FIXTURE.successChanceParamsId,
    retryRelativePowerGapMaximum: 0.15, // 第一版內容值。
    maxRetryCountPerChallenge: 1, // 第一版內容值。
    retrySupplyPolicyId: FIXTURE.policyId,
    defenseMasteryRoutingRuleId: FIXTURE.defenseRoutingRuleId,
    attackWeightScale: 6,
    attackSkillAggregation: 'equalConfiguredAttackSkills',
    distributionRounding: 'largestRemainderStableId',
    ...overrides,
  };
}

export function fixturePolicy(
  overrides?: Partial<RetrySupplyPolicyDefinition>,
): RetrySupplyPolicyDefinition {
  return {
    id: FIXTURE.policyId,
    schemaVersion: 1,
    packId: PACK,
    enabled: true,
    eligibleItemTagIds: [FIXTURE.potionTagId],
    selection: 'lowestValueThenStableId',
    quantityPerRetry: 1,
    ...overrides,
  };
}

export function fixtureChallengeView(
  id: EncounterGroupDefinitionId,
  overrides?: Partial<SimplifiedCombatChallengeDefinitionView>,
): SimplifiedCombatChallengeDefinitionView {
  return {
    encounterGroupId: id,
    combatPowerRuleId: FIXTURE.combatPowerRuleId,
    combatPower: FIXTURE_ENEMY_POWER,
    sourceRevisionKey: FIXTURE.encounterSourceRevisionKey,
    attackExperienceBudget: FIXTURE_BUDGETS.attack,
    defenseExperienceBudget: FIXTURE_BUDGETS.defense,
    ...overrides,
  };
}

export function fixtureSkillViews(): Record<string, SimplifiedCombatSkillDefinitionView> {
  return {
    [FIXTURE.skillBladeA]: {
      skillId: FIXTURE.skillBladeA,
      masteryExperienceMode: 'damage',
      attackMasterySplits: [{ masteryId: FIXTURE.masteryBlade, ratio: 1 }],
    },
    [FIXTURE.skillBladeB]: {
      skillId: FIXTURE.skillBladeB,
      masteryExperienceMode: 'damage',
      attackMasterySplits: [{ masteryId: FIXTURE.masteryBlade, ratio: 1 }],
    },
    [FIXTURE.skillChant]: {
      skillId: FIXTURE.skillChant,
      masteryExperienceMode: 'fixedSupport',
      supportMasteryAwardRuleId: FIXTURE.chantAwardRuleId,
    },
  };
}

export function createFixtureReader(
  overrides?: Readonly<{
    rule?: Partial<CombatSequenceRuleDefinition>;
    policy?: Partial<RetrySupplyPolicyDefinition>;
    challengeView?: Partial<SimplifiedCombatChallengeDefinitionView>;
    skillViews?: Record<string, SimplifiedCombatSkillDefinitionView>;
  }>,
): CombatSequenceDefinitionReader {
  const rule = fixtureRule(overrides?.rule);
  const policy = fixturePolicy(overrides?.policy);
  const skills = overrides?.skillViews ?? fixtureSkillViews();
  return {
    getRule: (id) => {
      if (id !== FIXTURE.ruleId) throw new Error(`fixture reader: unknown rule ${String(id)}`);
      return rule;
    },
    getRetrySupplyPolicy: (id) => {
      if (id !== FIXTURE.policyId) throw new Error(`fixture reader: unknown policy ${String(id)}`);
      return policy;
    },
    getEncounterView: (id) => fixtureChallengeView(id, overrides?.challengeView),
    getSkillView: (id) => {
      const view = skills[id];
      if (view === undefined) throw new Error(`fixture reader: unknown skill ${String(id)}`);
      return view;
    },
  };
}

// ── 補品 Query stub（由 inventory 支撐的 adapter 在正式路徑取代）──────────────
export function fixtureRetrySupplyCandidates(): RetrySupplyCandidate[] {
  return [
    // 故意讓「較貴」的排前面：selection='lowestValueThenStableId' 必須挑到 potionCheap。
    { itemId: FIXTURE.potionPricey, ownerCharacterId: FIXTURE.hero, availableQuantity: 2, unitValue: 9 },
    { itemId: FIXTURE.potionCheap, ownerCharacterId: FIXTURE.ally, availableQuantity: 1, unitValue: 3 },
  ];
}

export function createFixtureSupplyQuery(
  candidates: readonly RetrySupplyCandidate[] = fixtureRetrySupplyCandidates(),
): CombatSequenceSupplyQuery {
  return { listEligibleRetrySupplies: () => [...candidates] };
}

// ── 成功率 Port stub ───────────────────────────────────────────────────────

// 固定機率：讓測試精確控制「這一顆骰子會成功嗎」。
export function createFixedSuccessChancePort(probability: number): CombatSequenceSuccessChancePort {
  return { resolveSuccessChance: () => ({ probability }) };
}

// 資料調校版：形狀 = §7.1 kernel（logisticCurve），調校 = params 定義。
// 這是正式 Resolver 該長的樣子（app/content 的 ResolverRegistration 會走同一條路）。
export const FIXTURE_SUCCESS_CHANCE_PARAMS: LogisticCurveParams = {
  bias: 0,
  terms: [
    { inputKey: 'teamPower', weight: 0.02 },
    { inputKey: 'enemyPower', weight: -0.02 },
  ],
};

export function createLogisticSuccessChancePort(
  params: LogisticCurveParams = FIXTURE_SUCCESS_CHANCE_PARAMS,
): CombatSequenceSuccessChancePort {
  return {
    resolveSuccessChance: (input) => ({
      probability: logisticCurve(params, {
        teamPower: input.chance.teamPower,
        enemyPower: input.chance.enemyPower,
      }),
    }),
  };
}

// ── DeterministicRng stub（記錄實見 cursor，用來釘住游標串接）─────────────────
export type ScriptedRng = Readonly<{
  rng: DeterministicRng;
  seenCursors: number[];
  rolls: () => number;
}>;

export function createScriptedRng(values: readonly number[]): ScriptedRng {
  const seenCursors: number[] = [];
  let calls = 0;
  const rng: DeterministicRng = {
    nextFloat: ({ cursor }) => {
      seenCursors.push(cursor);
      const value = values[calls];
      calls += 1;
      if (value === undefined) {
        throw new Error(`scripted rng: 第 ${calls} 次取值超出腳本長度 ${values.length}`);
      }
      return { value, nextCursor: (cursor + 1) as RngCursor };
    },
    nextInt: () => {
      throw new Error('scripted rng: combat-sequence 不使用 nextInt');
    },
  };
  return { rng, seenCursors, rolls: () => calls };
}

// ── 開始快照 ───────────────────────────────────────────────────────────────

function member(
  characterId: CharacterId,
  weaponSetId: WeaponSetId,
  row: number,
  configuredSkillIds: readonly SkillDefinitionId[],
  attackSkillCount: number,
  attackWeightUnits: number,
  supportSkillIds: readonly SkillDefinitionId[],
): CombatSequenceMemberSnapshot {
  return {
    characterId,
    formationCell: { floor: 0, row, col: 0 },
    selectedWeaponSetId: weaponSetId,
    configuredSkillIds: [...configuredSkillIds],
    attackSkillCount,
    attackWeightUnits,
    attackMasterySplits:
      attackWeightUnits > 0 ? [{ masteryId: FIXTURE.masteryBlade, ratio: 1 }] : [],
    supportSkills: supportSkillIds.map((skillId) => ({
      skillId,
      awardRuleId: FIXTURE.chantAwardRuleId,
    })),
    defenseMasterySplits: [{ masteryId: FIXTURE.masteryGuard, ratio: 1 }],
  };
}

// 三人隊：權重 6 / 4 / 0（doc §10 驗收 7），列 0 / 1 / 2 → 防禦權重 3 / 2 / 1（驗收 8）。
export function fixtureMembers(): CombatSequenceMemberSnapshot[] {
  return [
    member(FIXTURE.hero, FIXTURE.weaponSetHero, 0, [FIXTURE.skillBladeA], 1, 6, []),
    member(
      FIXTURE.ally,
      FIXTURE.weaponSetAlly,
      1,
      [FIXTURE.skillBladeA, FIXTURE.skillBladeB, FIXTURE.skillChant],
      2,
      4,
      [FIXTURE.skillChant],
    ),
    member(FIXTURE.bard, FIXTURE.weaponSetBard, 2, [FIXTURE.skillChant], 0, 0, [
      FIXTURE.skillChant,
    ]),
  ];
}

export function fixtureAllocationSnapshot(
  members: readonly CombatSequenceMemberSnapshot[] = fixtureMembers(),
): CombatSequenceAllocationSnapshot {
  return {
    capturedOnDay: FIXTURE.worldDay,
    teamFormationRevision: 4 as Revision,
    teamPowerRevisionKey: FIXTURE.teamPowerRevisionKey,
    members: [...members],
  };
}

export function fixtureTeamPowerSnapshot(
  members: readonly CombatSequenceMemberSnapshot[] = fixtureMembers(),
  totalPower: number = FIXTURE_TEAM_POWER,
): TeamCombatPowerSnapshot {
  return {
    teamId: FIXTURE.teamId,
    participantCharacterIds: members.map((m) => m.characterId),
    combatPowerRuleId: FIXTURE.combatPowerRuleId,
    memberPowers: [],
    formationModifier: 1,
    totalPower,
    sourceRevisionKey: FIXTURE.teamPowerRevisionKey,
  };
}

export function fixtureChallenges(
  count: number = FIXTURE_CHALLENGE_COUNT,
  enemyPower: number = FIXTURE_ENEMY_POWER,
): CombatSequenceChallengeSnapshot[] {
  return Array.from({ length: count }, (_unused, index) => ({
    challengeId: challengeId(index),
    order: index,
    encounterGroupId: FIXTURE.encounterGroupId,
    sourceRef: {
      kind: 'mapContent' as const,
      mapId: FIXTURE.mapId,
      mapVersion: FIXTURE.mapVersion,
      contentId: `runtime:content-instance:monster-${index}` as ContentInstanceId,
      contentRevision: 1 as Revision,
    },
    enemyPower,
    enemyPowerRevisionKey: FIXTURE.enemyPowerRevisionKey,
    attackExperienceBudget: FIXTURE_BUDGETS.attack,
    defenseExperienceBudget: FIXTURE_BUDGETS.defense,
  }));
}

export function fixtureRngContext(cursor = 0): RngContext {
  return {
    worldSeed: FIXTURE.worldSeed,
    streamId: FIXTURE.streamId,
    cursor: cursor as RngCursor,
  };
}

export function fixtureStartCommand(
  overrides?: Partial<StartCombatSequence>,
): StartCombatSequence {
  const members = fixtureMembers();
  return {
    sequenceId: FIXTURE.sequenceId,
    teamId: FIXTURE.teamId,
    source: {
      kind: 'dungeonSweep',
      sourceId: FIXTURE.sourceId,
      mapId: FIXTURE.mapId,
      mapVersion: FIXTURE.mapVersion,
    },
    ruleId: FIXTURE.ruleId,
    allocationSnapshot: fixtureAllocationSnapshot(members),
    teamPowerSnapshot: fixtureTeamPowerSnapshot(members),
    challenges: fixtureChallenges(),
    rngContext: fixtureRngContext(),
    ...overrides,
  };
}

export function fixtureSingleBattleStartCommand(
  overrides?: Partial<StartCombatSequence>,
): StartCombatSequence {
  const challenges = fixtureChallenges(1);
  const first = challenges[0];
  if (first === undefined) throw new Error('fixture: 單場掃蕩需要一個 Challenge');
  return fixtureStartCommand({
    source: { kind: 'singleBattleSweep', sourceId: FIXTURE.sourceId },
    challenges: [
      { ...first, sourceRef: { kind: 'singleBattle', sourceId: FIXTURE.sourceId } },
    ],
    ...overrides,
  });
}

// ── Context ────────────────────────────────────────────────────────────────

export function createFixtureContext(
  overrides?: Partial<CombatSequenceContext> &
    Readonly<{ scripted?: ScriptedRng; successChance?: CombatSequenceSuccessChancePort }>,
): CombatSequenceContext {
  let resultCounter = 0;
  const scripted = overrides?.scripted ?? createScriptedRng([]);
  const successChance = overrides?.successChance ?? createFixedSuccessChancePort(1);
  const base: CombatSequenceContext = {
    reader: createFixtureReader(),
    supply: createFixtureSupplyQuery(),
    resolver: createCombatSequenceChallengeResolver({ rng: scripted.rng, successChance }),
    allocator: createCombatSequenceMasteryAllocator(),
    worldDay: FIXTURE.worldDay,
    nextChallengeResultId: () =>
      `runtime:combat-sequence-challenge-result:r${(resultCounter += 1)}` as CombatSequenceChallengeResultId,
  };
  return {
    ...base,
    ...(overrides?.reader !== undefined ? { reader: overrides.reader } : {}),
    ...(overrides?.supply !== undefined ? { supply: overrides.supply } : {}),
    ...(overrides?.resolver !== undefined ? { resolver: overrides.resolver } : {}),
    ...(overrides?.allocator !== undefined ? { allocator: overrides.allocator } : {}),
    ...(overrides?.worldDay !== undefined ? { worldDay: overrides.worldDay } : {}),
    ...(overrides?.nextChallengeResultId !== undefined
      ? { nextChallengeResultId: overrides.nextChallengeResultId }
      : {}),
  };
}

// 以真 Handler 建出「已開始」的 state：測試不手刻 Aggregate，避免繞過 Start 的驗證。
export function startedState(
  cmd: StartCombatSequence = fixtureStartCommand(),
  ctx: CombatSequenceContext = createFixtureContext(),
): CombatSequenceModuleState {
  const outcome = handleStartCombatSequence(createInitialCombatSequenceState(), cmd, ctx);
  if (!outcome.ok) {
    throw new Error(`fixture startedState: Start 被拒 ${outcome.rejection.code}`);
  }
  return outcome.result.nextSlice;
}
