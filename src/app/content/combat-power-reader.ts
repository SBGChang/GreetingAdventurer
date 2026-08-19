// app/content/combat-power-reader.ts
// CombatPowerDefinitionReader 的真實實作（由 data-runtime Registry 組出，樣板見 dungeon-reader.ts）。
//
// 兩類 getter，兩種投影方式：
//
//  1. 本服務**擁有**的三種規則（combat-power-rule / -feature-rule / -feasibility-rule）是
//     `DefinitionHeader & {…}` 形狀，直接套通用 domainDefinitionView。
//
//  2. Skill 與 Equipment Effect 的**擁有者是 combat 與 inventory**，不是 combat-power。這裡不 deep-import
//     那兩個模組的實作，也不複製作者資料：走 data-runtime §5 明訂的機制——同一筆原始 Definition 由
//     不同 Reader 以不同 mapView 編譯成不同 View。combat-power 的 View 只要武器需求、技能 Tag 與
//     Capability 貢獻，不看傷害或效果細節。
//     kind 取 `skill` / `equipment-effect`，與 `SkillDefinitionId = DefinitionId<'skill'>`、
//     `EquipmentEffectDefinitionId = DefinitionId<'equipment-effect'>` 的 brand 對齊。
//     （combat-reader.ts 目前把技能標為 `combat-skill`；那一筆 kind 命名的收斂屬 combat 與內容軌，
//     不在本檔的所有權範圍內——見交接報告。）
//
// 兩個窄化 View 的 sourceRevisionKey 由 combatPowerDefinitionRevisionKey 產生，與 Calculator 串
// Revision 用的是同一個格式函式，不是各拼一套。

import type { DefinitionReaderId } from '../../contracts/core';
import type {
  CombatPowerDefinitionReader,
  CombatPowerEquipmentEffectView,
  CombatPowerFeasibilityRuleDefinition,
  CombatPowerFeatureRuleDefinition,
  CombatPowerRuleDefinition,
  CombatPowerSkillDefinitionView,
} from '../../contracts/combat-power';
import { createDefinitionReader, type DefinitionRegistry } from '../../data-runtime';
import { combatPowerDefinitionRevisionKey } from '../../domain-services/combat-power/public';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名。前三個由 combat-power 擁有（內容軌的施工單）；
// 後兩個是**讀**別人擁有的 kind，本服務不宣告擁有它們。
export const COMBAT_POWER_DEFINITION_KINDS = {
  rule: 'combat-power-rule',
  featureRule: 'combat-power-feature-rule',
  feasibilityRule: 'combat-power-feasibility-rule',
  skill: 'skill',
  equipmentEffect: 'equipment-effect',
} as const;

export const COMBAT_POWER_OWNED_DEFINITION_KINDS: readonly string[] = [
  COMBAT_POWER_DEFINITION_KINDS.rule,
  COMBAT_POWER_DEFINITION_KINDS.featureRule,
  COMBAT_POWER_DEFINITION_KINDS.feasibilityRule,
];

export function createCombatPowerDefinitionReader(
  registry: DefinitionRegistry,
): CombatPowerDefinitionReader {
  const rule = narrowedDomainReader<CombatPowerRuleDefinition>(registry, 'reader:combat-power.rule', [
    COMBAT_POWER_DEFINITION_KINDS.rule,
  ]);
  const featureRule = narrowedDomainReader<CombatPowerFeatureRuleDefinition>(
    registry,
    'reader:combat-power.feature-rule',
    [COMBAT_POWER_DEFINITION_KINDS.featureRule],
  );
  const feasibilityRule = narrowedDomainReader<CombatPowerFeasibilityRuleDefinition>(
    registry,
    'reader:combat-power.feasibility-rule',
    [COMBAT_POWER_DEFINITION_KINDS.feasibilityRule],
  );
  // 窄化 View：以 skillId／equipmentEffectId 為鍵、不帶 DefinitionHeader，並補上版本鍵，
  // 故不套通用 domainDefinitionView。逐欄位驗證屬正式 Content Pack 的 schema 驗證，不在投影這一行。
  const skill = createDefinitionReader<CombatPowerSkillDefinitionView>(registry, {
    readerId: 'reader:combat-power.skill' as DefinitionReaderId,
    ownedKinds: [COMBAT_POWER_DEFINITION_KINDS.skill],
    mapView: (def) =>
      ({
        ...(def.data as Record<string, unknown>),
        skillId: def.id,
        sourceRevisionKey: combatPowerDefinitionRevisionKey(def),
      }) as CombatPowerSkillDefinitionView,
  });
  const equipmentEffect = createDefinitionReader<CombatPowerEquipmentEffectView>(registry, {
    readerId: 'reader:combat-power.equipment-effect' as DefinitionReaderId,
    ownedKinds: [COMBAT_POWER_DEFINITION_KINDS.equipmentEffect],
    mapView: (def) =>
      ({
        ...(def.data as Record<string, unknown>),
        equipmentEffectId: def.id,
        sourceRevisionKey: combatPowerDefinitionRevisionKey(def),
      }) as CombatPowerEquipmentEffectView,
  });

  return {
    getRule: (id) => rule.get(id),
    getFeatureRule: (id) => featureRule.get(id),
    getFeasibilityRule: (id) => feasibilityRule.get(id),
    getSkillView: (id) => skill.get(id),
    getEquipmentEffectView: (id) => equipmentEffect.get(id),
  };
}
