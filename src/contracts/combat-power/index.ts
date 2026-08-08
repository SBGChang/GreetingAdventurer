// contracts/combat-power — public contract transcribed from docs/00_core/architecture/22_combat_power_service.md
// 純計算 Domain Service（domain-services/combat-power）：無 State、無 I/O、無 RNG。

import type {
  CharacterId,
  MonsterDefinitionId,
  EncounterGroupDefinitionId,
  WeaponSetId,
  WeaponRequirementId,
  SkillDefinitionId,
  SkillTagId,
  EquipmentEffectDefinitionId,
  StatisticsRuleId,
  SecondaryAttributeId,
  TeamId,
  QuestId,
  ResolverId,
  DefinitionId,
  EphemeralId,
  WorldDay,
  Revision,
} from '../core';
import type { DefinitionHeader } from '../core';

// 跨模組（本模組擁有者以外）：
import type { PrimaryAttributeId } from '../progression';
import type { CharacterStatisticsSnapshot } from '../statistics';
// inventory / quest / map 尚未實作 —— 屬預期 unresolved import。
import type { CharacterEquipmentLoadoutView } from '../inventory';
import type { QuestObjectiveView } from '../quest';
import type { GridCell } from '../map';

// ── 本服務專屬 Definition／Ephemeral ID ─────────────────────────────────
export type CombatPowerRuleId = DefinitionId<'combat-power-rule'>;
export type CombatPowerFeatureRuleId = DefinitionId<'combat-power-feature-rule'>;
export type CombatPowerFeatureId = DefinitionId<'combat-power-feature'>;
export type CombatCapabilityId = DefinitionId<'combat-capability'>;
export type EquipmentLoadoutCandidateId = EphemeralId<'equipment-loadout-candidate'>;

// ── Definition Reader ───────────────────────────────────────────────────
export interface CombatPowerDefinitionReader {
  getRule(id: CombatPowerRuleId): CombatPowerRuleDefinition;
  getFeatureRule(id: CombatPowerFeatureRuleId): CombatPowerFeatureRuleDefinition;
  getSkillView(id: SkillDefinitionId): CombatPowerSkillDefinitionView;
  getEquipmentEffectView(id: EquipmentEffectDefinitionId): CombatPowerEquipmentEffectView;
}

// ── 戰力規則 ────────────────────────────────────────────────────────────
export type CombatPowerRuleDefinition = DefinitionHeader & {
  statisticsRuleId: StatisticsRuleId;
  featureRuleIds: CombatPowerFeatureRuleId[];
  unitAggregationResolverId: ResolverId;
  teamFormationResolverId: ResolverId;
  teamAggregation: 'sumMembersThenFormation';
  encounterAggregation: 'sumMembersThenFormation';
  minimumPower: number;
  rounding: 'roundHalfUpAtFinalOutput';
};

export type CombatPowerFeatureRuleDefinition = DefinitionHeader & {
  featureId: CombatPowerFeatureId;
  source: CombatPowerFeatureSource;
  coefficient: number;
  transformResolverId?: ResolverId;
};

export type CombatPowerFeatureSource =
  | { kind: 'primaryAttribute'; attributeId: PrimaryAttributeId }
  | { kind: 'secondaryAttribute'; attributeId: SecondaryAttributeId }
  | { kind: 'maximumResource'; resource: 'health' | 'mana' }
  | { kind: 'skillCapability'; capabilityId: CombatCapabilityId }
  | { kind: 'equipmentEffectCapability'; capabilityId: CombatCapabilityId };

// ── Skill／Equipment Effect 窄化 View ───────────────────────────────────
export type CombatPowerCapabilityContribution = {
  capabilityId: CombatCapabilityId;
  baseValue: number;
  scalingResolverId?: ResolverId;
};

export type CombatPowerSkillDefinitionView = {
  skillId: SkillDefinitionId;
  weaponRequirementIds: WeaponRequirementId[];
  capabilityContributions: CombatPowerCapabilityContribution[];
  sourceRevisionKey: string;
};

export type CombatPowerEquipmentEffectView = {
  equipmentEffectId: EquipmentEffectDefinitionId;
  triggerEligibility: 'alwaysWhileEquipped' | 'configuredSkillCompatible';
  requiredSkillTagIds: SkillTagId[];
  capabilityContributions: CombatPowerCapabilityContribution[];
  sourceRevisionKey: string;
};

// ── 純計算輸入與輸出 ────────────────────────────────────────────────────
export type CombatPowerUnitInput = {
  unitRef:
    | { kind: 'character'; characterId: CharacterId }
    | { kind: 'monster'; monsterDefinitionId: MonsterDefinitionId; memberIndex: number };
  statistics: CombatUnitStatisticsSnapshot;
  selectedWeaponSetId?: WeaponSetId;
  configuredSkills: CombatPowerSkillDefinitionView[];
  activeEquipmentEffects: CombatPowerEquipmentEffectView[];
  sourceRevisionKey: string;
};

export type CombatUnitStatisticsSnapshot = Pick<
  CharacterStatisticsSnapshot,
  | 'effectivePrimaryAttributes'
  | 'secondaryAttributes'
  | 'maxHealth'
  | 'maxMana'
  | 'sourceRevisionKey'
>;

export type CombatPowerUnitSnapshot = {
  unitRef: CombatPowerUnitInput['unitRef'];
  combatPowerRuleId: CombatPowerRuleId;
  totalPower: number;
  featureBreakdown: CombatPowerFeatureAmount[];
  sourceRevisionKey: string;
};

export type CombatPowerFeatureAmount = {
  featureId: CombatPowerFeatureId;
  amountBeforeCoefficient: number;
  coefficient: number;
  weightedAmount: number;
};

// ── 隊伍與敵方編組 ──────────────────────────────────────────────────────
export type CombatPowerFormationMember = {
  unit: CombatPowerUnitInput;
  anchorCell: GridCell;
  occupiedCells: GridCell[];
};

export type TeamCombatPowerCalculationInput = {
  teamId: TeamId;
  ruleId: CombatPowerRuleId;
  members: CombatPowerFormationMember[];
  formationRevision: Revision;
  sourceRevisionKey: string;
};

export type EncounterCombatPowerCalculationInput = {
  encounterGroupId: EncounterGroupDefinitionId;
  ruleId: CombatPowerRuleId;
  members: CombatPowerFormationMember[];
  encounterDefinitionRevisionKey: string;
};

export type TeamCombatPowerSnapshot = {
  teamId: TeamId;
  participantCharacterIds: CharacterId[];
  combatPowerRuleId: CombatPowerRuleId;
  memberPowers: CombatPowerUnitSnapshot[];
  formationModifier: number;
  totalPower: number;
  sourceRevisionKey: string;
};

export type EncounterCombatPowerSnapshot = {
  encounterGroupId: EncounterGroupDefinitionId;
  combatPowerRuleId: CombatPowerRuleId;
  memberPowers: CombatPowerUnitSnapshot[];
  formationModifier: number;
  totalPower: number;
  sourceRevisionKey: string;
};

// ── Calculator ──────────────────────────────────────────────────────────
export interface CombatPowerCalculator {
  calculateUnit(
    input: Readonly<CombatPowerUnitInput>,
    rule: Readonly<CombatPowerRuleDefinition>,
  ): CombatPowerUnitSnapshot;

  calculateTeam(
    input: Readonly<TeamCombatPowerCalculationInput>,
    rule: Readonly<CombatPowerRuleDefinition>,
  ): TeamCombatPowerSnapshot;

  calculateEncounter(
    input: Readonly<EncounterCombatPowerCalculationInput>,
    rule: Readonly<CombatPowerRuleDefinition>,
  ): EncounterCombatPowerSnapshot;
}

// ── Application Query Facade ────────────────────────────────────────────
export interface CombatPowerQuery {
  getCharacterPower(input: CharacterCombatPowerQueryInput): CombatPowerUnitSnapshot;
  getTeamPower(input: TeamCombatPowerInput): TeamCombatPowerSnapshot;
  getEncounterPower(input: EncounterCombatPowerQueryInput): EncounterCombatPowerSnapshot;
  assessQuestFeasibility(input: NpcQuestFeasibilityInput): NpcQuestFeasibility;
  compareLoadouts(input: EquipmentLoadoutPowerComparisonInput): EquipmentLoadoutPowerComparisonResult;
}

export type NpcQuestFeasibilityInput = {
  teamId: TeamId;
  questId: QuestId;
  objective: QuestObjectiveView;
  assessedOnDay: WorldDay;
  combatPowerRuleId: CombatPowerRuleId;
};

export type NpcQuestFeasibility = {
  canAttempt: boolean;
  powerScore: number;
  expectedSuccess: number; // 0..1；只供資料權重與 UI／debug
  riskBand: 'trivial' | 'favorable' | 'even' | 'dangerous' | 'impossible';
  reason?: 'insufficientPower' | 'noUsableMembers' | 'unsupportedObjective';
};

export type CharacterCombatPowerQueryInput = {
  characterId: CharacterId;
  selectedWeaponSetId: WeaponSetId;
  configuredSkillIds: SkillDefinitionId[];
  combatPowerRuleId: CombatPowerRuleId;
};

export type TeamCombatPowerInput = {
  teamId: TeamId;
  formationRevision: Revision;
  selectedWeaponSetIds: Record<CharacterId, WeaponSetId>;
  combatPowerRuleId: CombatPowerRuleId;
};

export type EncounterCombatPowerQueryInput = {
  encounterGroupId: EncounterGroupDefinitionId;
  combatPowerRuleId: CombatPowerRuleId;
};

export type EquipmentLoadoutPowerComparisonInput = {
  characterId: CharacterId;
  candidates: EquipmentLoadoutPowerCandidate[];
  combatPowerRuleId: CombatPowerRuleId;
};

export type EquipmentLoadoutPowerCandidate = {
  candidateId: EquipmentLoadoutCandidateId;
  equipmentLoadout: CharacterEquipmentLoadoutView;
  selectedWeaponSetId: WeaponSetId;
  configuredSkillIds: SkillDefinitionId[];
};

export type EquipmentLoadoutPowerComparisonResult = {
  candidates: Array<{
    candidateId: EquipmentLoadoutCandidateId;
    power: number;
    sourceRevisionKey: string;
  }>;
  highestPowerCandidateId?: EquipmentLoadoutCandidateId;
};
