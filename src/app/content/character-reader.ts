// app/content/character-reader.ts
// CharacterDefinitionReader 的真實實作（由 data-runtime Registry 組出）。全部為單純委派。

import type { DefinitionId } from '../../contracts/core';
import type {
  BirthRuleDefinition,
  CharacterArchetypeDefinition,
  CharacterDefinitionReader,
  LifecycleRuleDefinition,
  StatusDefinition,
  TemporaryCharacterRuleDefinition,
  WorldAdventurerGenerationRuleDefinition,
} from '../../contracts/character';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

export const CHARACTER_DEFINITION_KINDS = {
  archetype: 'character-archetype',
  lifecycleRule: 'lifecycle-rule',
  status: 'character-status',
  birthRule: 'birth-rule',
  temporaryCharacterRule: 'temporary-character-rule',
  worldAdventurerGenerationRule: 'world-adventurer-generation-rule',
} as const;

export function createCharacterDefinitionReader(registry: DefinitionRegistry): CharacterDefinitionReader {
  const archetype = narrowedDomainReader<CharacterArchetypeDefinition>(
    registry,
    'reader:character.archetype',
    [CHARACTER_DEFINITION_KINDS.archetype],
  );
  const lifecycle = narrowedDomainReader<LifecycleRuleDefinition>(registry, 'reader:character.lifecycle-rule', [
    CHARACTER_DEFINITION_KINDS.lifecycleRule,
  ]);
  const status = narrowedDomainReader<StatusDefinition>(registry, 'reader:character.status', [
    CHARACTER_DEFINITION_KINDS.status,
  ]);
  const birth = narrowedDomainReader<BirthRuleDefinition>(registry, 'reader:character.birth-rule', [
    CHARACTER_DEFINITION_KINDS.birthRule,
  ]);
  const temporary = narrowedDomainReader<TemporaryCharacterRuleDefinition>(
    registry,
    'reader:character.temporary-character-rule',
    [CHARACTER_DEFINITION_KINDS.temporaryCharacterRule],
  );
  const worldAdventurer = narrowedDomainReader<WorldAdventurerGenerationRuleDefinition>(
    registry,
    'reader:character.world-adventurer-generation-rule',
    [CHARACTER_DEFINITION_KINDS.worldAdventurerGenerationRule],
  );

  return {
    getArchetype: (id) => archetype.get(id),
    getLifecycleRule: (id) => lifecycle.get(id),
    getStatusDefinition: (id) => status.get(id),
    getBirthRule: (id) => birth.get(id),
    getTemporaryCharacterRule: (id) => temporary.get(id),
    getWorldAdventurerGenerationRule: (id) => worldAdventurer.get(id),
  };
}
