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
// inventory / quest / map 的模組實作屬其他工作；此處只引用其公開契約型別。
import type { CharacterEquipmentLoadoutView } from '../inventory';
import type { QuestObjectiveView } from '../quest';
import type { GridCell } from '../map';

// ── 本服務專屬 Definition／Ephemeral ID ─────────────────────────────────
export type CombatPowerRuleId = DefinitionId<'combat-power-rule'>;
export type CombatPowerFeatureRuleId = DefinitionId<'combat-power-feature-rule'>;
export type CombatPowerFeatureId = DefinitionId<'combat-power-feature'>;
export type CombatCapabilityId = DefinitionId<'combat-capability'>;
// 任務可行性（門檻與安全邊際）的規則。doc §4 只給了 NpcQuestFeasibility 的輸出形狀，沒有給
// 「多少戰力算打得過」的來源；那些門檻是內容平衡量，必須有一份 Definition 承載（見交接報告）。
export type CombatPowerFeasibilityRuleId = DefinitionId<'combat-power-feasibility-rule'>;
export type EquipmentLoadoutCandidateId = EphemeralId<'equipment-loadout-candidate'>;

// ── Definition Reader ───────────────────────────────────────────────────
export interface CombatPowerDefinitionReader {
  getRule(id: CombatPowerRuleId): CombatPowerRuleDefinition;
  getFeatureRule(id: CombatPowerFeatureRuleId): CombatPowerFeatureRuleDefinition;
  getFeasibilityRule(id: CombatPowerFeasibilityRuleId): CombatPowerFeasibilityRuleDefinition;
  getSkillView(id: SkillDefinitionId): CombatPowerSkillDefinitionView;
  getEquipmentEffectView(id: EquipmentEffectDefinitionId): CombatPowerEquipmentEffectView;
}

// ── 戰力規則 ────────────────────────────────────────────────────────────
export type CombatPowerRuleDefinition = DefinitionHeader<CombatPowerRuleId> & {
  statisticsRuleId: StatisticsRuleId;
  featureRuleIds: CombatPowerFeatureRuleId[];
  feasibilityRuleId: CombatPowerFeasibilityRuleId;
  unitAggregationResolverId: ResolverId;
  teamFormationResolverId: ResolverId;
  teamAggregation: 'sumMembersThenFormation';
  encounterAggregation: 'sumMembersThenFormation';
  minimumPower: number;
  rounding: 'roundHalfUpAtFinalOutput';
};

export type CombatPowerFeatureRuleDefinition = DefinitionHeader<CombatPowerFeatureRuleId> & {
  featureId: CombatPowerFeatureId;
  source: CombatPowerFeatureSource;
  coefficient: number;
  transformResolverId?: ResolverId;
};

// 風險帶：doc §4 的 riskBand 字面值集合，抽成具名別名讓門檻資料可以引用它。
export type CombatPowerRiskBand = 'trivial' | 'favorable' | 'even' | 'dangerous' | 'impossible';

// 期望成功率 → 風險帶的升冪門檻。最後一筆的 maxExpectedSuccess 必須涵蓋 1，
// 否則高成功率會落在表外——那是壞內容，服務明確失敗而不補預設帶。
export type CombatPowerRiskBandThreshold = {
  maxExpectedSuccess: number;
  riskBand: CombatPowerRiskBand;
};

export type CombatPowerFeasibilityRuleDefinition = DefinitionHeader<CombatPowerFeasibilityRuleId> & {
  // 這份門檻只對同一條戰力規則有效；不相符即拒絕評估（跨規則戰力不可比較）。
  combatPowerRuleId: CombatPowerRuleId;
  // (teamPower, opposingPower) → 0..1 的純 Resolver。曲線本身是資料。
  expectedSuccessResolverId: ResolverId;
  riskBandThresholds: CombatPowerRiskBandThreshold[];
  // 安全邊際：期望成功率低於此值即不嘗試。
  minimumAttemptExpectedSuccess: number;
  // 一個目標對到多個對抗編組時如何取對抗戰力。
  opposingAggregation: 'sumEncounterGroups' | 'strongestEncounterGroup';
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
  // §7.5 要求「Equipment Effect 的觸發條件必須能由已選武器組與已配置技能完全判定」；
  // CombatPowerEquipmentEffectView.requiredSkillTagIds 要比對的正是技能自己的 Tag，
  // 沒有這個欄位那條規則在本服務內無法判定（見交接報告）。
  skillTagIds: SkillTagId[];
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
  // 已選武器組滿足哪些武器需求。Weapon Set 是 Runtime 實體、武器需求的判定屬 inventory／combat；
  // 純函式 Calculator 不能自己查，所以由組 Input 的一方（Query Facade）帶進來。
  // §8.3「未滿足武器條件的技能不得提供戰力」在 Calculator 內就是靠這個集合判定的。
  satisfiedWeaponRequirementIds: WeaponRequirementId[];
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

// 不變量：`reason === 'unsupportedObjective'` 時 expectedSuccess／riskBand **不存在**——
// 該目標沒有戰力對抗面，本服務無從評估，而回一個數字就是憑空造出一個機率（規範 §6）。
// 其餘情況（含 noUsableMembers：可用成員集合為空 → 戰力 0）兩者皆由 Resolver 與門檻資料算出。
export type NpcQuestFeasibility = {
  canAttempt: boolean;
  powerScore: number;
  expectedSuccess?: number; // 0..1；只供資料權重與 UI／debug
  riskBand?: CombatPowerRiskBand;
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
