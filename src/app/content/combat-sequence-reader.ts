// app/content/combat-sequence-reader.ts
// CombatSequenceDefinitionReader 的真實實作（由 data-runtime DefinitionRegistry 組出）。
//
// 四個 getter 對應四個 kind 家族：
//   * combat-sequence-rule / retry-supply-policy —— 本模組擁有的規則，`DefinitionHeader & {…}` 形狀，
//     直接套通用 domainDefinitionView。
//   * simplified-combat-challenge / simplified-combat-skill —— doc §2.1 的**窄化 View**：
//     「原始 Monster／Encounter／Skill 資料仍分別只有一份；Data Runtime 將它們編譯成 Combat Sequence
//     所需的窄化 View」。因此它們是 Content Compiler 的**產出物**，不是第二份手寫來源資料：
//       simplified-combat-challenge ← encounter-group + encounter-experience-budget + monster-experience-profile
//                                     + combat-power rule 綁定
//       simplified-combat-skill     ← skill + attack-mastery-award-rule（→ masterySplits）
//                                     / support-mastery-award-rule
//     兩者都不帶 DefinitionHeader（View 以 encounterGroupId / skillId 為鍵），故自訂 mapView，
//     鍵一律取自 registry 權威的 `def.id`——與 combat-reader 的 getSkillView 同一種寫法。

import type { DefinitionReaderId } from '../../contracts/core';
import type {
  CombatSequenceDefinitionReader,
  CombatSequenceRuleDefinition,
  RetrySupplyPolicyDefinition,
  SimplifiedCombatChallengeDefinitionView,
  SimplifiedCombatSkillDefinitionView,
} from '../../contracts/combat-sequence';
import { createDefinitionReader, type DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名（內容作者以此標注每筆 definition 的 kind 欄位）。
export const COMBAT_SEQUENCE_DEFINITION_KINDS = {
  rule: 'combat-sequence-rule',
  retrySupplyPolicy: 'retry-supply-policy',
  simplifiedCombatChallenge: 'simplified-combat-challenge',
  simplifiedCombatSkill: 'simplified-combat-skill',
} as const;

export function createCombatSequenceDefinitionReader(
  registry: DefinitionRegistry,
): CombatSequenceDefinitionReader {
  const rule = narrowedDomainReader<CombatSequenceRuleDefinition>(
    registry,
    'reader:combat-sequence.rule',
    [COMBAT_SEQUENCE_DEFINITION_KINDS.rule],
  );
  const retrySupplyPolicy = narrowedDomainReader<RetrySupplyPolicyDefinition>(
    registry,
    'reader:combat-sequence.retry-supply-policy',
    [COMBAT_SEQUENCE_DEFINITION_KINDS.retrySupplyPolicy],
  );
  const challenge = createDefinitionReader<SimplifiedCombatChallengeDefinitionView>(registry, {
    readerId: 'reader:combat-sequence.simplified-challenge' as DefinitionReaderId,
    ownedKinds: [COMBAT_SEQUENCE_DEFINITION_KINDS.simplifiedCombatChallenge],
    mapView: (def) =>
      ({
        ...(def.data as Record<string, unknown>),
        encounterGroupId: def.id,
      }) as SimplifiedCombatChallengeDefinitionView,
  });
  const skill = createDefinitionReader<SimplifiedCombatSkillDefinitionView>(registry, {
    readerId: 'reader:combat-sequence.simplified-skill' as DefinitionReaderId,
    ownedKinds: [COMBAT_SEQUENCE_DEFINITION_KINDS.simplifiedCombatSkill],
    mapView: (def) =>
      ({
        ...(def.data as Record<string, unknown>),
        skillId: def.id,
      }) as SimplifiedCombatSkillDefinitionView,
  });

  return {
    getRule: (id) => rule.get(id),
    getRetrySupplyPolicy: (id) => retrySupplyPolicy.get(id),
    getEncounterView: (id) => challenge.get(id),
    getSkillView: (id) => skill.get(id),
  };
}
