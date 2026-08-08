// contracts/statistics — public contract transcribed from docs/00_core/architecture/16_derived_statistics.md
// 技術元件：domain-services/statistics。無 State 的純計算 Domain Service。

import type {
  StatisticsRuleId,
  SecondaryAttributeId,
  GripRuleId,
  CarryCapacityRuleId,
  AgeModifierRuleId,
  ResolverId,
  CharacterId,
  EffectDefinitionId,
  DefinitionId,
  DefinitionHeader,
} from '../core';
import type { PrimaryAttributes, PrimaryAttributeId, MasteryProgressView } from '../progression';

// ── core 未列出的共用 ID（於此定義；見交接報告）─────────────────────────
// EquipmentCoefficientChannelId 屬共用核心契約（00_shared_contracts.md），core .ts 尚未匯出。
export type EquipmentCoefficientChannelId = DefinitionId<'equipment-coefficient-channel'>;

// ── 跨模組占位型別（inventory 契約尚未建立；見交接報告）──────────────────
// EquipmentDefinition／CharacterEquipmentLoadoutView 由 inventory 擁有（05_inventory_module.md）。
export type EquipmentDefinition = Readonly<Record<string, unknown>>;
export type CharacterEquipmentLoadoutView = Readonly<Record<string, unknown>>;

// ── §2 Definition 契約 ──────────────────────────────────────────────────
export interface StatisticsDefinitionReader {
  getStatisticsRule(id: StatisticsRuleId): StatisticsRuleDefinition;
  getSecondaryAttributeRule(id: SecondaryAttributeId): SecondaryAttributeRuleDefinition;
  getGripRule(id: GripRuleId): GripRuleDefinition;
  getCarryCapacityRule(id: CarryCapacityRuleId): CarryCapacityRuleDefinition;
  getAgeModifierRule(id: AgeModifierRuleId): AgeModifierRuleDefinition;
}

export type StatisticsRuleDefinition = DefinitionHeader & {
  primaryAttributeCap: 100;
  secondaryRuleIds: SecondaryAttributeId[];
  gripRuleId: GripRuleId;
  carryCapacityRuleId: CarryCapacityRuleId;
  ageModifierRuleId: AgeModifierRuleId;
  reputationContributionRuleId: ResolverId;
};

export type CarryCapacityRuleDefinition = DefinitionHeader & {
  baseWeightCapacity: number;
  strengthCapacityPerPoint: number;
};

export type SecondaryAttributeRuleDefinition = DefinitionHeader & {
  output: SecondaryAttributeId;
  primaryCoefficients: Partial<Record<PrimaryAttributeId, number>>;
  equipmentCoefficientChannelIds: EquipmentCoefficientChannelId[];
  masteryCoefficientResolverId?: ResolverId;
  finalResolverId: ResolverId;
};

// GripRuleDefinition：doc §4 具名但未給 Schema；依 §4 描述的持握倍率推導（見交接報告）。
// 單手／雙手 1.0；雙持左手 0.5；雙持右手 0.35；雙持總輸出為兩手相加。
export type GripRuleDefinition = DefinitionHeader & {
  singleHandMultiplier: number;
  twoHandMultiplier: number;
  dualWieldLeftHandMultiplier: number;
  dualWieldRightHandMultiplier: number;
};

// AgeModifierRuleDefinition：doc 具名但未給 Schema；以資料化 Resolver 推導（見交接報告）。
export type AgeModifierRuleDefinition = DefinitionHeader & {
  resolverId: ResolverId;
};

// ── §3 輸入與輸出 DTO ───────────────────────────────────────────────────
export type CharacterStatisticsInput = {
  characterId: CharacterId;
  ageDays: number;
  reputation: number;
  primaryAttributesFromMastery: PrimaryAttributes;
  masterySnapshots: MasteryProgressView[];
  conditionModifierRefs: EffectDefinitionId[];
  equipmentLoadout: CharacterEquipmentLoadoutView;
  equipmentDefinitionViews: EquipmentDefinition[];
  statisticsRuleId: StatisticsRuleId;
};

export type CharacterStatisticsSnapshot = {
  effectivePrimaryAttributes: PrimaryAttributes;
  secondaryAttributes: Record<SecondaryAttributeId, number>;
  maxHealth: number;
  maxMana: number;
  carryingCapacity: number;
  sourceRevisionKey: string;
};

// ActionStatisticsInput／Snapshot 與 EquipmentPreviewInput／Result：Calculator 介面引用，
// 但 doc 未提供 Schema；以最小占位型別承載（見交接報告）。
export type ActionStatisticsInput = CharacterStatisticsInput;
export type ActionStatisticsSnapshot = CharacterStatisticsSnapshot;
export type EquipmentPreviewInput = CharacterStatisticsInput;
export type EquipmentPreviewResult = Readonly<{
  before: CharacterStatisticsSnapshot;
  after: CharacterStatisticsSnapshot;
}>;

export interface CharacterStatisticsCalculator {
  calculate(input: Readonly<CharacterStatisticsInput>): CharacterStatisticsSnapshot;
  calculateAction(input: Readonly<ActionStatisticsInput>): ActionStatisticsSnapshot;
  previewEquipment(input: Readonly<EquipmentPreviewInput>): EquipmentPreviewResult;
}
