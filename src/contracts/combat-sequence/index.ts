// contracts/combat-sequence — public contract transcribed from docs/00_core/architecture/21_combat_sequence_module.md

import type {
  DefinitionHeader,
  DefinitionId,
  RuntimeId,
  ResolverId,
  RngContext,
  WorldDay,
  Revision,
  TeamId,
  CharacterId,
  MapInstanceId,
  ContentInstanceId,
  ItemInstanceId,
  WeaponSetId,
  EncounterId,
  EncounterGroupDefinitionId,
  SkillDefinitionId,
  MasteryId,
  ItemTagId,
  SupportMasteryAwardRuleId,
} from '../core';
// Cross-module: combat-power domain service (docs/.../22_combat_power_service.md → src/contracts/combat-power).
import type { CombatPowerRuleId, TeamCombatPowerSnapshot } from '../combat-power';
// Cross-module: map owns GridCell (src/contracts/map).
import type { GridCell } from '../map';
// Cross-module: progression owns DefenseMasteryRoutingRuleId (src/contracts/progression).
import type { DefenseMasteryRoutingRuleId } from '../progression';

// ── 本模組擁有的 branded ID（§1）────────────────────────────────────────
export type CombatSequenceId = RuntimeId<'combat-sequence'>;
export type CombatSequenceChallengeId = RuntimeId<'combat-sequence-challenge'>;
export type CombatSequenceChallengeResultId = RuntimeId<'combat-sequence-challenge-result'>;
export type CombatSequenceSourceId = RuntimeId<'combat-sequence-source'>;
export type CombatSequenceSourceCommitId = RuntimeId<'combat-sequence-source-commit'>;
export type CombatSequenceRuleId = DefinitionId<'combat-sequence-rule'>;
export type RetrySupplyPolicyId = DefinitionId<'retry-supply-policy'>;
// 成功率 kernel 的調校參數定位。
//
// 原本規則只有 `successChanceResolverId`，於是「用哪一條公式」是資料，「這條公式的係數」卻無處可放——
// data-runtime 的 kernel-resolver 樣板（app/content/resolvers.ts 的 KernelResolverInput）要求呼叫端帶
// `paramsDefId`，而唯一知道該用哪筆參數的內容就是這條規則。缺這個欄位的後果不是少一層間接，
// 是 bias/terms 只能寫進程式（規範 §6 明令禁止）。詳見實作回報「我改了自己的契約嗎」。
export type CombatSequenceSuccessChanceParamsId = DefinitionId<'combat-sequence-success-chance-params'>;

// ── 來源與生命週期列舉（§1.3、§4）────────────────────────────────────────
export type CombatSequenceSource =
  | { kind: 'singleBattleSweep'; sourceId: CombatSequenceSourceId }
  | {
      kind: 'dungeonSweep';
      sourceId: CombatSequenceSourceId;
      mapId: MapInstanceId;
      mapVersion: number;
    };

// Named unions extracted from the CombatSequence aggregate (which is internal State
// and not transcribed); the doc references them via indexed access (see report note).
export type CombatSequenceStatus = 'active' | 'awaitingSourceCommit' | 'settled' | 'invalid';
export type CombatSequenceTerminationReason =
  | 'allResolved'
  | 'challengeFailed'
  | 'hostStopped'
  | 'sourceInvalidated';
export type CombatSequenceChallengeOutcome = 'success' | 'failure' | 'skippedBeforeAttempt';

// ── 靜態資料契約（§2）─────────────────────────────────────────────────
export type CombatSequenceRuleDefinition = DefinitionHeader & {
  combatPowerRuleId: CombatPowerRuleId;
  successChanceResolverId: ResolverId;
  successChanceParamsId: CombatSequenceSuccessChanceParamsId;
  retryRelativePowerGapMaximum: number;
  maxRetryCountPerChallenge: number;
  retrySupplyPolicyId: RetrySupplyPolicyId;
  defenseMasteryRoutingRuleId: DefenseMasteryRoutingRuleId;
  attackWeightScale: 6;
  attackSkillAggregation: 'equalConfiguredAttackSkills';
  distributionRounding: 'largestRemainderStableId';
};

export type RetrySupplyPolicyDefinition = DefinitionHeader & {
  eligibleItemTagIds: ItemTagId[];
  selection: 'lowestValueThenStableId';
  quantityPerRetry: 1;
};

export type CombatSequenceSuccessChanceInput = {
  teamPower: number;
  enemyPower: number;
};

export type CombatSequenceSuccessChanceResult = {
  probability: number; // 0..1
};

export interface CombatSequenceDefinitionReader {
  getRule(id: CombatSequenceRuleId): CombatSequenceRuleDefinition;
  getRetrySupplyPolicy(id: RetrySupplyPolicyId): RetrySupplyPolicyDefinition;
  getEncounterView(id: EncounterGroupDefinitionId): SimplifiedCombatChallengeDefinitionView;
  getSkillView(id: SkillDefinitionId): SimplifiedCombatSkillDefinitionView;
}

// ── 窄化 View（§2.3）──────────────────────────────────────────────────
export type SimplifiedCombatChallengeDefinitionView = {
  encounterGroupId: EncounterGroupDefinitionId;
  combatPowerRuleId: CombatPowerRuleId;
  combatPower: number;
  sourceRevisionKey: string;
  attackExperienceBudget: number;
  defenseExperienceBudget: number;
};

export type MasteryRatio = {
  masteryId: MasteryId;
  ratio: number;
};

export type SimplifiedCombatSkillDefinitionView = {
  skillId: SkillDefinitionId;
  masteryExperienceMode: 'damage' | 'fixedSupport';
  attackMasterySplits?: MasteryRatio[];
  supportMasteryAwardRuleId?: SupportMasteryAwardRuleId;
};

// ── 開始時不可變快照（§3）─────────────────────────────────────────────
export type CombatSequenceMemberSnapshot = {
  characterId: CharacterId;
  formationCell: GridCell;
  selectedWeaponSetId: WeaponSetId;
  configuredSkillIds: SkillDefinitionId[];
  attackSkillCount: number;
  attackWeightUnits: number;
  attackMasterySplits: MasteryRatio[];
  supportSkills: Array<{
    skillId: SkillDefinitionId;
    awardRuleId: SupportMasteryAwardRuleId;
  }>;
  defenseMasterySplits: MasteryRatio[];
};

export type CombatSequenceAllocationSnapshot = {
  capturedOnDay: WorldDay;
  teamFormationRevision: Revision;
  teamPowerRevisionKey: string;
  members: CombatSequenceMemberSnapshot[];
};

// ── Challenge / Result 快照（§4）──────────────────────────────────────
export type CombatSequenceChallengeSourceRef =
  | { kind: 'singleBattle'; sourceId: CombatSequenceSourceId }
  | {
      kind: 'mapContent';
      mapId: MapInstanceId;
      mapVersion: number;
      contentId: ContentInstanceId;
      contentRevision: Revision;
    };

export type CombatSequenceChallengeSnapshot = {
  challengeId: CombatSequenceChallengeId;
  order: number;
  encounterGroupId: EncounterGroupDefinitionId;
  sourceRef: CombatSequenceChallengeSourceRef;
  enemyPower: number;
  enemyPowerRevisionKey: string;
  attackExperienceBudget: number;
  defenseExperienceBudget: number;
};

export type CombatSequenceRollResult = {
  attemptIndex: number;
  rngDrawIndex: number;
  successProbability: number;
  roll: number; // [0, 1)
  success: boolean;
};

export type CombatSequenceChallengeResult = {
  resultId: CombatSequenceChallengeResultId;
  challengeId: CombatSequenceChallengeId;
  attemptedOnDay?: WorldDay;
  outcome: CombatSequenceChallengeOutcome;
  attempts: CombatSequenceRollResult[];
  consumedSupplyItemIds: ItemInstanceId[];
};

// ── 公開 Query（§5）───────────────────────────────────────────────────
// Derived read model; the doc names CombatSequenceView but never defines it (see report note).
export type CombatSequenceView = Readonly<{
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  source: CombatSequenceSource;
  ruleId: CombatSequenceRuleId;
  status: CombatSequenceStatus;
  terminationReason?: CombatSequenceTerminationReason;
  challengeCount: number;
  cursor: number;
  startedOnDay: WorldDay;
  endedOnDay?: WorldDay;
  revision: Revision;
}>;

export type CombatSequenceProgressView = {
  sequenceId: CombatSequenceId;
  status: CombatSequenceStatus;
  resolvedCount: number;
  challengeCount: number;
  settledSuccessfulCount?: number;
};

export interface CombatSequenceQuery {
  getSequence(id: CombatSequenceId): CombatSequenceView | undefined;
  getActiveSequenceForTeam(teamId: TeamId): CombatSequenceView | undefined;
  getProgress(id: CombatSequenceId): CombatSequenceProgressView;
}

// ── 純 Resolver 與 Allocator（§5）──────────────────────────────────────
export type CombatSequenceChallengeResolutionInput = {
  rule: CombatSequenceRuleDefinition;
  teamPower: number;
  enemyPower: number;
  attemptIndex: 0;
  rngContext: RngContext;
  rngDrawIndex: number;
};

export type CombatSequenceChallengeRetryInput = Omit<
  CombatSequenceChallengeResolutionInput,
  'attemptIndex'
> & {
  attemptIndex: number;
  consumedSupplyItemId: ItemInstanceId;
};

export type AcceptedCombatSequenceChallengeExperience = {
  resultId: CombatSequenceChallengeResultId;
  attackExperienceBudget: number;
  defenseExperienceBudget: number;
};

export type CombatSequenceMasteryAllocationInput = {
  sequenceId: CombatSequenceId;
  rule: CombatSequenceRuleDefinition;
  allocationSnapshot: CombatSequenceAllocationSnapshot;
  acceptedChallenges: AcceptedCombatSequenceChallengeExperience[];
};

export type MasteryExperienceAmount = {
  characterId: CharacterId;
  masteryId: MasteryId;
  amount: number;
};

export type CombatSequenceSupportAward = {
  characterId: CharacterId;
  skillId: SkillDefinitionId;
  supportMasteryAwardRuleId: SupportMasteryAwardRuleId;
  creditedUseCount: number;
};

export type CombatSequenceMasteryAllocation = {
  attackAwards: MasteryExperienceAmount[];
  defenseAwards: MasteryExperienceAmount[];
  supportAwards: CombatSequenceSupportAward[];
};

export interface CombatSequenceChallengeResolver {
  resolveInitial(input: CombatSequenceChallengeResolutionInput): CombatSequenceRollResult;
  resolveRetry(input: CombatSequenceChallengeRetryInput): CombatSequenceRollResult;
}

export interface CombatSequenceMasteryAllocator {
  allocate(input: CombatSequenceMasteryAllocationInput): CombatSequenceMasteryAllocation;
}

// ── 補品重骰 Query（§6.2）─────────────────────────────────────────────
export type RetrySupplyCandidate = {
  itemId: ItemInstanceId;
  ownerCharacterId: CharacterId;
  availableQuantity: number;
  unitValue: number;
};

export interface CombatSequenceSupplyQuery {
  listEligibleRetrySupplies(input: {
    teamId: TeamId;
    participantCharacterIds: CharacterId[];
    policyId: RetrySupplyPolicyId;
  }): RetrySupplyCandidate[];
}

// ── 輸入 Internal Command（§6.1、§7）──────────────────────────────────
export type StartCombatSequence = {
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  source: CombatSequenceSource;
  ruleId: CombatSequenceRuleId;
  allocationSnapshot: CombatSequenceAllocationSnapshot;
  teamPowerSnapshot: TeamCombatPowerSnapshot;
  challenges: CombatSequenceChallengeSnapshot[];
  rngContext: RngContext;
};

export type ResolveNextCombatSequenceChallenge = {
  sequenceId: CombatSequenceId;
  expectedChallengeId: CombatSequenceChallengeId;
  attemptedOnDay: WorldDay;
};

export type SkipNextCombatSequenceChallenge = {
  sequenceId: CombatSequenceId;
  expectedChallengeId: CombatSequenceChallengeId;
  reason: 'sourceUnavailableBeforeAttempt';
};

export type CombatSequenceStopReason = 'allResolved' | 'challengeFailed' | 'hostStopped';

export type StopCombatSequence = {
  sequenceId: CombatSequenceId;
  reason: CombatSequenceStopReason;
};

export type CombatSequenceInvalidReason =
  | 'sourceInvalidated'
  | 'teamUnavailable'
  | 'snapshotRevisionConflict'
  | 'saveMigrationInvalidated';

export type InvalidateCombatSequence = {
  sequenceId: CombatSequenceId;
  reason: CombatSequenceInvalidReason;
};

export type ReleaseCombatSequence = {
  sequenceId: CombatSequenceId;
  expectedRevision: Revision;
};

export type CommitCombatSequenceSourceResults = {
  sequenceId: CombatSequenceId;
  acceptedSuccessfulResultIds: CombatSequenceChallengeResultId[];
  sourceCommitId: CombatSequenceSourceCommitId;
  committedOnDay: WorldDay;
};

// 輸出至 inventory（§6.3）；由 inventory 處理，於此完整定義以維持補品重骰契約。
export type ConsumeCombatSequenceRetrySupply = {
  sequenceId: CombatSequenceId;
  challengeId: CombatSequenceChallengeId;
  teamId: TeamId;
  itemId: ItemInstanceId;
  quantity: 1;
};

export type CombatSequenceInternalCommand =
  | ({ type: 'StartCombatSequence' } & StartCombatSequence)
  | ({ type: 'ResolveNextCombatSequenceChallenge' } & ResolveNextCombatSequenceChallenge)
  | ({ type: 'SkipNextCombatSequenceChallenge' } & SkipNextCombatSequenceChallenge)
  | ({ type: 'StopCombatSequence' } & StopCombatSequence)
  | ({ type: 'CommitCombatSequenceSourceResults' } & CommitCombatSequenceSourceResults)
  | ({ type: 'InvalidateCombatSequence' } & InvalidateCombatSequence)
  | ({ type: 'ReleaseCombatSequence' } & ReleaseCombatSequence);

// ── 單場掃蕩 Game Command（§9）───────────────────────────────────────
export type StartSingleBattleSweep = {
  type: 'startSingleBattleSweep';
  teamId: TeamId;
  sourceId: CombatSequenceSourceId;
  encounterGroupId: EncounterGroupDefinitionId;
  selectedWeaponSetIds?: Record<CharacterId, WeaponSetId>;
  expectedSourceRevision: Revision;
};

// ── 共用成長來源判別（§7.5）；detailed combat 亦引用此契約。──────────────
export type CombatMasterySource =
  | { kind: 'encounter'; encounterId: EncounterId }
  | { kind: 'combatSequence'; sequenceId: CombatSequenceId };

// ── 輸出事件 payload（§7.5）───────────────────────────────────────────
export type CombatSequenceChallengeResolvedPayload = {
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  challengeId: CombatSequenceChallengeId;
  resultId: CombatSequenceChallengeResultId;
  sourceRef: CombatSequenceChallengeSourceRef;
  outcome: CombatSequenceChallengeOutcome;
};

export type CombatSequenceReadyForSourceCommitPayload = {
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  terminationReason: Exclude<CombatSequenceTerminationReason, 'sourceInvalidated'>;
};

export type CombatSequenceSettledPayload = {
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  source: CombatSequenceSource;
  terminationReason: Exclude<CombatSequenceTerminationReason, 'sourceInvalidated'>;
  acceptedSuccessfulCount: number;
  totalAttackExperienceBudget: number;
  totalDefenseExperienceBudget: number;
};

export type CombatAttackMasteryEarnedPayload = {
  source: CombatMasterySource;
  characterAwards: MasteryExperienceAmount[];
};

export type CombatDefenseMasteryEarnedPayload = {
  source: CombatMasterySource;
  characterAwards: MasteryExperienceAmount[];
};

export type CombatSupportMasteryEarnedPayload = CombatSequenceSupportAward & {
  source: CombatMasterySource;
};

export type CombatSequenceInvalidatedPayload = {
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  reason: CombatSequenceInvalidReason;
};

export type CombatSequenceDomainEvent =
  | ({ type: 'CombatSequenceChallengeResolved' } & CombatSequenceChallengeResolvedPayload)
  | ({ type: 'CombatSequenceReadyForSourceCommit' } & CombatSequenceReadyForSourceCommitPayload)
  | ({ type: 'CombatSequenceSettled' } & CombatSequenceSettledPayload)
  | ({ type: 'CombatAttackMasteryEarned' } & CombatAttackMasteryEarnedPayload)
  | ({ type: 'CombatDefenseMasteryEarned' } & CombatDefenseMasteryEarnedPayload)
  | ({ type: 'CombatSupportMasteryEarned' } & CombatSupportMasteryEarnedPayload)
  | ({ type: 'CombatSequenceInvalidated' } & CombatSequenceInvalidatedPayload);
