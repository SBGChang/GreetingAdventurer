// modules/character/queries.ts
// Character 模組自有 Query Port（CharacterQuery）在 Slice 上的純函式實作。
//
// 註：CharacterStatsQuery 是 Character 的「消費 Port」，由 Composition Adapter（Derived
// Statistics）實作，不在此模組實作；本檔只實作模組自有的讀取投影。

import type { CharacterId, WorldDay, CharacterTraitDefinitionId } from '../../contracts/core';
import type {
  CharacterState,
  CharacterQuery,
  CharacterView,
  CharacterConditionView,
  CharacterRelationshipFactView,
  Sex,
  TemporaryCharacterOrigin,
} from '../../contracts/character';
import { requireCharacter, tryGetCharacter, ageDaysOf } from './state';

export function createCharacterQuery(state: CharacterState): CharacterQuery {
  return {
    getCharacter(id: CharacterId): CharacterView {
      return requireCharacter(state, id);
    },

    isAvailable(id: CharacterId): boolean {
      const c = tryGetCharacter(state, id);
      return c !== undefined && c.lifeState === 'alive' && c.availability === 'available';
    },

    getCondition(id: CharacterId): CharacterConditionView {
      return requireCharacter(state, id).condition;
    },

    getAgeDays(id: CharacterId, onDay: WorldDay): number {
      return ageDaysOf(requireCharacter(state, id), onDay);
    },

    getSex(id: CharacterId): Sex {
      return requireCharacter(state, id).sex;
    },

    getActivePartner(id: CharacterId): CharacterId | undefined {
      for (const link of Object.values(state.familyLinks)) {
        if (link.kind !== 'partner' || link.activeToDay !== undefined) continue;
        if (!link.characterIds.includes(id)) continue;
        const other = link.characterIds.find((cid) => cid !== id);
        if (other !== undefined) return other;
      }
      return undefined;
    },

    listChildren(id: CharacterId): readonly CharacterId[] {
      return requireCharacter(state, id).childIds;
    },

    getInnateTraits(id: CharacterId): readonly CharacterTraitDefinitionId[] {
      return requireCharacter(state, id).innateTraitIds;
    },

    listUnresolvedRelationships(id: CharacterId): readonly CharacterRelationshipFactView[] {
      return Object.values(state.relationshipFacts).filter(
        (f) => f.subjectCharacterId === id && f.state === 'unresolved',
      );
    },

    getTemporaryOrigin(id: CharacterId): TemporaryCharacterOrigin | undefined {
      return tryGetCharacter(state, id)?.temporaryOrigin;
    },
  };
}
