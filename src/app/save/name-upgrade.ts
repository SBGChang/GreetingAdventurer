import type { SavedGameState } from './save-state';
import type { Character, CharacterName } from '../../contracts/character';
import type { CharacterId, CityId } from '../../contracts/core';
import type { DefinitionRegistry } from '../../data-runtime';
import { deterministicRng } from '../../kernel/rng';
import { generateCharacterName } from '../../modules/character/public';
import { createCharacterNameReader } from '../content/character-name-reader';
import { createWorldDefinitionReader } from '../content/world-reader';

export type UnnamedSavedGameState = Omit<SavedGameState, 'character'> & {
  character: Omit<SavedGameState['character'], 'characters'> & {
    characters: Readonly<Record<CharacterId, Omit<Character, 'name'>>>;
  };
};

/** Known predecessor saves did not record naming culture. Use their actual locality once, then persist it. */
export function upgradeCharacterNames(state: UnnamedSavedGameState, registry: DefinitionRegistry): SavedGameState {
  const world = createWorldDefinitionReader(registry);
  const reader = createCharacterNameReader(registry);
  const names: CharacterName[] = [];
  const characters: Record<CharacterId, Character> = {};
  for (const character of Object.values(state.character.characters).sort((a, b) => a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0)) {
    const team = Object.values(state.team.teams).find(t => [...t.memberIds, ...t.temporaryMemberIds].includes(character.characterId));
    let cityId: CityId | undefined;
    if (character.temporaryOrigin) cityId = state.quest.quests[character.temporaryOrigin.sourceQuestId]?.postingGuildCityId;
    else if (character.homeId) cityId = state.city.homes[character.homeId]?.cityId;
    if (cityId === undefined && team) {
      const location = team.location;
      switch (location.kind) {
        case 'city': cityId = location.cityId; break;
        case 'home': cityId = state.city.homes[location.homeId]?.cityId; break;
        case 'travelling': cityId = world.getRoute(location.routeId).fromCityId; break;
        case 'adventureMap': {
          const map = state.map.instances[location.mapId];
          if (map) cityId = world.getAdventureSite(map.adventureSiteId).accessCityId;
          break;
        }
      }
    }
    if (cityId === undefined) throw new Error(`save/name-origin-unavailable: ${character.characterId}`);
    const cultureId = world.getRegion(world.getCityNode(cityId).regionId).nativeCultureId;
    const name = generateCharacterName(reader, deterministicRng, { worldSeed: state.core.worldSeed,
      characterId: character.characterId, cultureId, sex: character.sex, existingNames: names });
    names.push(name);
    characters[character.characterId] = { ...character, name };
  }
  return { ...state, character: { ...state.character, characters } };
}
