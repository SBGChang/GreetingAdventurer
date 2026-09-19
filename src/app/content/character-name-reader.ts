import type { CultureDefinition } from '../../contracts/world';
import type { DefinitionRegistry, LocalizationCatalog } from '../../data-runtime';
import type { CultureId } from '../../contracts/core';
import type { NamePartDefinition, NamingRuleDefinition } from '../../contracts/character/names';
import type { CharacterNameReader } from '../../modules/character/public';
import { narrowedDomainReader } from './reader-adapter';

export const CHARACTER_NAME_KINDS = { part: 'character-name-part', rule: 'character-naming-rule' } as const;

export function createCharacterNameReader(registry: DefinitionRegistry): CharacterNameReader {
  const parts = narrowedDomainReader<NamePartDefinition>(registry, 'reader:character.name-part', [CHARACTER_NAME_KINDS.part]);
  const rules = narrowedDomainReader<NamingRuleDefinition>(registry, 'reader:character.naming-rule', [CHARACTER_NAME_KINDS.rule]);
  return {
    getPart: id => parts.get(id), getRule: id => rules.get(id),
    ruleForCulture: (cultureId: CultureId) => {
      const matches = rules.list().filter(r => r.cultureId === cultureId);
      if (matches.length !== 1) throw new Error(`character/naming-rule-not-unique: ${cultureId}`);
      return matches[0]!;
    },
  };
}

/** Validate actual loaded content and every supported locale before creating a world. */
export function validateCharacterNames(registry: DefinitionRegistry, catalog: LocalizationCatalog): void {
  const reader = createCharacterNameReader(registry);
  const rules = narrowedDomainReader<NamingRuleDefinition>(registry, 'reader:character.naming-validation', [CHARACTER_NAME_KINDS.rule]).list();
  for (const culture of narrowedDomainReader<CultureDefinition>(registry, 'reader:character.naming-cultures', ['culture']).list()) reader.ruleForCulture(culture.id);
  for (const rule of rules) {
    reader.ruleForCulture(rule.cultureId);
    if (registry.kindOf(rule.cultureId) !== 'culture') throw new Error('character/name-culture-missing');
    for (const [ids, usage] of [[rule.familyIds, 'family'], [rule.maleGivenIds, 'male'], [rule.femaleGivenIds, 'female']] as const) {
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('character/invalid-name-pool');
      for (const id of ids) {
        const part = reader.getPart(id);
        if (part.cultureId !== rule.cultureId || !(part.usage === usage || (usage !== 'family' && part.usage === 'unisex'))) throw new Error('character/name-part-mismatch');
        for (const locale of catalog.locales) {
          const value = catalog.resolve(locale, part.display.nameRef);
          if (!value?.trim() || /[{}]/.test(value)) throw new Error(`character/name-translation-missing: ${id}/${locale}`);
        }
      }
    }
    if (!Array.isArray(rule.reservedNames)) throw new Error('character/invalid-reserved-names');
    for (const reserved of rule.reservedNames) if (!rule.familyIds.includes(reserved.familyId) ||
      ![...rule.maleGivenIds, ...rule.femaleGivenIds].includes(reserved.givenId)) throw new Error('character/invalid-reserved-name');
    for (const pool of [rule.maleGivenIds, rule.femaleGivenIds]) if (rule.familyIds.every(f => pool.every(g => rule.reservedNames.some(n => n.familyId === f && n.givenId === g)))) throw new Error('character/name-pool-empty');
    for (const locale of catalog.locales) {
      const format = catalog.resolve(locale, { ...rule.display.nameRef, params: { family: '{family}', given: '{given}' } });
      if (!format || format.match(/\{family\}/g)?.length !== 1 || format.match(/\{given\}/g)?.length !== 1 || /\{(?!family\}|given\})/.test(format)) throw new Error('character/invalid-name-format');
    }
  }
}
