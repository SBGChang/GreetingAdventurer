import type { CultureId, DefinitionHeader, DefinitionId, DisplayDefinition, LocalizedTextRef } from '../core';

export type NamePartId = DefinitionId<'character-name-part'>;
export type NamingRuleId = DefinitionId<'character-naming-rule'>;

/** Persist identity, never translated display strings. Custom names retain the user's spelling. */
export type CharacterName = Readonly<{ cultureId: CultureId }> & (
  | Readonly<{ kind: 'generated'; ruleId: NamingRuleId; familyId: NamePartId; givenId: NamePartId }>
  | Readonly<{ kind: 'custom'; text: string }>
);
export type NamePartDefinition = DefinitionHeader<NamePartId> & Readonly<{
  cultureId: CultureId;
  usage: 'family' | 'male' | 'female' | 'unisex';
  display: DisplayDefinition;
}>;
export type NamingRuleDefinition = DefinitionHeader<NamingRuleId> & Readonly<{
  cultureId: CultureId;
  familyIds: readonly NamePartId[];
  maleGivenIds: readonly NamePartId[];
  femaleGivenIds: readonly NamePartId[];
  reservedNames: readonly Readonly<{ familyId: NamePartId; givenId: NamePartId }>[];
  /** Localized template controls order, whitespace and punctuation. */
  display: DisplayDefinition;
}>;

export type CharacterNameDisplay =
  | Readonly<{ kind: 'custom'; text: string }>
  | Readonly<{ kind: 'generated'; format: LocalizedTextRef; family: LocalizedTextRef; given: LocalizedTextRef }>;

export function renderCharacterName(name: CharacterNameDisplay, text: (ref: LocalizedTextRef) => string): string {
  if (name.kind === 'custom') return name.text;
  return text({ ...name.format, params: { family: text(name.family), given: text(name.given) } });
}
