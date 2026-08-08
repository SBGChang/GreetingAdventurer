// modules/character/state.ts
// Character 唯一可寫 Slice 的初始工廠與純函式讀寫小工具。
// Slice 型別權威在 contracts/character；此處不重新定義，只 re-export + 提供 immutable helper。

import type {
  CharacterId,
  FamilyLinkId,
  RelationshipFactId,
} from '../../contracts/core';
import type {
  Character,
  CharacterState,
  FamilyLink,
  CharacterRelationshipFact,
} from '../../contracts/character';

export type { CharacterState };

// 空 Slice（新世界或測試起點）。
export const emptyCharacterState: CharacterState = Object.freeze({
  characters: Object.freeze({}),
  familyLinks: Object.freeze({}),
  relationshipFacts: Object.freeze({}),
}) as CharacterState;

// 由既有實體集合建構 Slice（fixture／存檔載入）。
export function createCharacterState(
  input: Readonly<{
    characters?: readonly Character[];
    familyLinks?: readonly FamilyLink[];
    relationshipFacts?: readonly CharacterRelationshipFact[];
  }> = {},
): CharacterState {
  const characters: Record<CharacterId, Character> = {};
  for (const c of input.characters ?? []) characters[c.characterId] = c;

  const familyLinks: Record<FamilyLinkId, FamilyLink> = {};
  for (const l of input.familyLinks ?? []) familyLinks[l.familyLinkId] = l;

  const relationshipFacts: Record<RelationshipFactId, CharacterRelationshipFact> = {};
  for (const f of input.relationshipFacts ?? []) relationshipFacts[f.relationshipFactId] = f;

  return { characters, familyLinks, relationshipFacts };
}

// ── 純函式讀寫（皆回傳新物件，不 mutate 傳入 Slice）─────────────────────────

export function tryGetCharacter(
  state: CharacterState,
  id: CharacterId,
): Character | undefined {
  return state.characters[id];
}

export function requireCharacter(state: CharacterState, id: CharacterId): Character {
  const found = state.characters[id];
  if (found === undefined) {
    throw new Error(`CharacterState: unknown characterId "${String(id)}"`);
  }
  return found;
}

export function upsertCharacter(state: CharacterState, next: Character): CharacterState {
  return {
    ...state,
    characters: { ...state.characters, [next.characterId]: next },
  };
}

export function upsertFamilyLink(state: CharacterState, next: FamilyLink): CharacterState {
  return {
    ...state,
    familyLinks: { ...state.familyLinks, [next.familyLinkId]: next },
  };
}

export function upsertRelationshipFact(
  state: CharacterState,
  next: CharacterRelationshipFact,
): CharacterState {
  return {
    ...state,
    relationshipFacts: { ...state.relationshipFacts, [next.relationshipFactId]: next },
  };
}

// 年齡由世界日推導，不逐日掃描（§5.3）。
export function ageDaysOf(character: Character, onDay: number): number {
  return onDay - character.birthDay;
}
