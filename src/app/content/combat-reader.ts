// app/content/combat-reader.ts
// CombatDefinitionReader 的真實實作（由 data-runtime Registry 組出）。
// 16 個單純委派 + getSkillView（投影 View：CombatSkillDefinitionView 用 skillId 而非 id、無 header，
// 故不套通用 domainDefinitionView，改自訂 mapView：skillId ← def.id，其餘欄位取自 data）。
//
// TODO(content)：戰鬥技能 View 與 progression 的 SkillDefinition 是否為同一筆定義（一份 skill 兩個
// 投影）或兩筆，待內容軌敲定。此處先給 combat 自己的 'combat-skill' kind，之後若共用再改 kind。

import type { DefinitionId, DefinitionReaderId } from '../../contracts/core';
import type {
  CombatAiPolicyDefinition,
  CombatCtbAdjustmentRuleDefinition,
  CombatDamageRuleDefinition,
  CombatDefinitionReader,
  CombatEffectDefinition,
  CombatHealRuleDefinition,
  CombatInterruptionRuleDefinition,
  CombatRuleDefinition,
  CombatSkillDefinitionView,
  CombatStatusDefinition,
  ActionDelayRuleDefinition,
  EncounterExperienceBudgetDefinition,
  EncounterGroupDefinition,
  EquipmentEffectDefinition,
  MonsterDefinition,
  MonsterExperienceProfileDefinition,
  OpeningCtbRuleDefinition,
} from '../../contracts/combat';
import { createDefinitionReader, type DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

export const COMBAT_DEFINITION_KINDS = {
  combatRule: 'combat-rule',
  encounterGroup: 'encounter-group',
  monster: 'monster',
  skill: 'combat-skill',
  openingCtbRule: 'opening-ctb-rule',
  actionDelayRule: 'action-delay-rule',
  status: 'combat-status',
  effect: 'combat-effect',
  damageRule: 'combat-damage-rule',
  healRule: 'combat-heal-rule',
  ctbAdjustmentRule: 'combat-ctb-adjustment-rule',
  interruptionRule: 'combat-interruption-rule',
  equipmentEffect: 'equipment-effect',
  aiPolicy: 'combat-ai-policy',
  experienceBudget: 'encounter-experience-budget',
  monsterExperienceProfile: 'monster-experience-profile',
} as const;

export function createCombatDefinitionReader(registry: DefinitionRegistry): CombatDefinitionReader {
  const combatRule = narrowedDomainReader<CombatRuleDefinition>(registry, 'reader:combat.rule', [
    COMBAT_DEFINITION_KINDS.combatRule,
  ]);
  const encounterGroup = narrowedDomainReader<EncounterGroupDefinition>(registry, 'reader:combat.encounter-group', [
    COMBAT_DEFINITION_KINDS.encounterGroup,
  ]);
  const monster = narrowedDomainReader<MonsterDefinition>(registry, 'reader:combat.monster', [
    COMBAT_DEFINITION_KINDS.monster,
  ]);
  // getSkillView 投影：CombatSkillDefinitionView 以 skillId 為鍵、不帶 DefinitionHeader，故自訂 mapView。
  const skill = createDefinitionReader<CombatSkillDefinitionView>(registry, {
    readerId: 'reader:combat.skill' as DefinitionReaderId,
    ownedKinds: [COMBAT_DEFINITION_KINDS.skill],
    mapView: (def) => ({ ...(def.data as object), skillId: def.id } as unknown as CombatSkillDefinitionView),
  });
  const openingCtb = narrowedDomainReader<OpeningCtbRuleDefinition>(registry, 'reader:combat.opening-ctb-rule', [
    COMBAT_DEFINITION_KINDS.openingCtbRule,
  ]);
  const actionDelay = narrowedDomainReader<ActionDelayRuleDefinition>(registry, 'reader:combat.action-delay-rule', [
    COMBAT_DEFINITION_KINDS.actionDelayRule,
  ]);
  const status = narrowedDomainReader<CombatStatusDefinition>(registry, 'reader:combat.status', [
    COMBAT_DEFINITION_KINDS.status,
  ]);
  const effect = narrowedDomainReader<CombatEffectDefinition>(registry, 'reader:combat.effect', [
    COMBAT_DEFINITION_KINDS.effect,
  ]);
  const damage = narrowedDomainReader<CombatDamageRuleDefinition>(registry, 'reader:combat.damage-rule', [
    COMBAT_DEFINITION_KINDS.damageRule,
  ]);
  const heal = narrowedDomainReader<CombatHealRuleDefinition>(registry, 'reader:combat.heal-rule', [
    COMBAT_DEFINITION_KINDS.healRule,
  ]);
  const ctbAdjust = narrowedDomainReader<CombatCtbAdjustmentRuleDefinition>(
    registry,
    'reader:combat.ctb-adjustment-rule',
    [COMBAT_DEFINITION_KINDS.ctbAdjustmentRule],
  );
  const interruption = narrowedDomainReader<CombatInterruptionRuleDefinition>(
    registry,
    'reader:combat.interruption-rule',
    [COMBAT_DEFINITION_KINDS.interruptionRule],
  );
  const equipmentEffect = narrowedDomainReader<EquipmentEffectDefinition>(
    registry,
    'reader:combat.equipment-effect',
    [COMBAT_DEFINITION_KINDS.equipmentEffect],
  );
  const aiPolicy = narrowedDomainReader<CombatAiPolicyDefinition>(registry, 'reader:combat.ai-policy', [
    COMBAT_DEFINITION_KINDS.aiPolicy,
  ]);
  const experienceBudget = narrowedDomainReader<EncounterExperienceBudgetDefinition>(
    registry,
    'reader:combat.experience-budget',
    [COMBAT_DEFINITION_KINDS.experienceBudget],
  );
  const monsterExperience = narrowedDomainReader<MonsterExperienceProfileDefinition>(
    registry,
    'reader:combat.monster-experience-profile',
    [COMBAT_DEFINITION_KINDS.monsterExperienceProfile],
  );

  return {
    getCombatRule: (id) => combatRule.get(id as unknown as DefinitionId),
    getEncounterGroup: (id) => encounterGroup.get(id as unknown as DefinitionId),
    getMonster: (id) => monster.get(id as unknown as DefinitionId),
    getSkillView: (id) => skill.get(id as unknown as DefinitionId),
    getOpeningCtbRule: (id) => openingCtb.get(id as unknown as DefinitionId),
    getActionDelayRule: (id) => actionDelay.get(id as unknown as DefinitionId),
    getCombatStatus: (id) => status.get(id as unknown as DefinitionId),
    getCombatEffect: (id) => effect.get(id as unknown as DefinitionId),
    getDamageRule: (id) => damage.get(id as unknown as DefinitionId),
    getHealRule: (id) => heal.get(id as unknown as DefinitionId),
    getCtbAdjustmentRule: (id) => ctbAdjust.get(id as unknown as DefinitionId),
    getCombatInterruptionRule: (id) => interruption.get(id as unknown as DefinitionId),
    getEquipmentEffect: (id) => equipmentEffect.get(id as unknown as DefinitionId),
    getAiPolicy: (id) => aiPolicy.get(id as unknown as DefinitionId),
    getExperienceBudget: (id) => experienceBudget.get(id as unknown as DefinitionId),
    getMonsterExperienceProfile: (id) => monsterExperience.get(id as unknown as DefinitionId),
  };
}
