import type { CharacterId, CultureId, DeterministicRng, RngCursor, RngStreamId, Seed } from '../../contracts/core';
import type { Sex } from '../../contracts/character';
import type { CharacterName, CharacterNameDisplay, NamePartDefinition, NamePartId, NamingRuleDefinition, NamingRuleId } from '../../contracts/character/names';

export interface CharacterNameReader {
  getRule(id: NamingRuleId): NamingRuleDefinition;
  getPart(id: NamePartId): NamePartDefinition;
  ruleForCulture(cultureId: CultureId): NamingRuleDefinition;
}

export function generateCharacterName(reader: CharacterNameReader, rng: DeterministicRng, input: Readonly<{
  worldSeed: Seed; characterId: CharacterId; cultureId: CultureId; sex: Sex; existingNames: readonly CharacterName[];
}>): CharacterName {
  const rule = reader.ruleForCulture(input.cultureId);
  const givenIds = input.sex === 'male' ? rule.maleGivenIds : rule.femaleGivenIds;
  const reserved = new Set(rule.reservedNames.map(n => `${n.familyId}/${n.givenId}`));
  const candidates = rule.familyIds.flatMap(familyId => givenIds.map(givenId => ({ familyId, givenId })))
    .filter(n => !reserved.has(`${n.familyId}/${n.givenId}`))
    .map(n => ({ ...n, uses: input.existingNames.filter(existing => existing.kind === 'generated' && existing.familyId === n.familyId && existing.givenId === n.givenId).length }));
  if (!candidates.length) throw new Error('character/name-pool-empty');
  // Prefer unused full names; when finite pools fill up, spread repeats evenly. No random retry loop.
  const leastUsed = Math.min(...candidates.map(n => n.uses));
  const available = candidates.filter(n => (n.uses) === leastUsed);
  const pick = rng.nextInt({ worldSeed: input.worldSeed, streamId: `character-name:${input.characterId}` as RngStreamId,
    cursor: 0 as RngCursor, minInclusive: 0, maxInclusive: available.length - 1 });
  return { kind: 'generated', cultureId: input.cultureId, ruleId: rule.id, familyId: available[pick.value]!.familyId, givenId: available[pick.value]!.givenId };
}

export function characterNameDisplay(reader: CharacterNameReader, name: CharacterName): CharacterNameDisplay {
  if (name.kind === 'custom') {
    if (!name.text.trim()) throw new Error('character/empty-custom-name');
    reader.ruleForCulture(name.cultureId);
    return { kind: 'custom', text: name.text };
  }
  const rule = reader.getRule(name.ruleId);
  if (rule.cultureId !== name.cultureId || !rule.familyIds.includes(name.familyId) ||
      ![...rule.maleGivenIds, ...rule.femaleGivenIds].includes(name.givenId)) throw new Error('character/invalid-name-reference');
  return { kind: 'generated', format: rule.display.nameRef,
    family: reader.getPart(name.familyId).display.nameRef, given: reader.getPart(name.givenId).display.nameRef };
}
