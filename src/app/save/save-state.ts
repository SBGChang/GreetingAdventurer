import type { GameState } from '../composition/state';
import type { CharacterId, SkillDefinitionId } from '../../contracts/core';
import type { CharacterEquipmentLoadoutView, WeaponSetLoadoutView } from '../../contracts/inventory';

// JSON has no undefined array element. Empty skill slots have an explicit null on disk.
type SavedWeaponSet = Omit<WeaponSetLoadoutView, 'selectedSkillIds'> & {
  selectedSkillIds: readonly [(SkillDefinitionId | null)?, (SkillDefinitionId | null)?, (SkillDefinitionId | null)?];
};
type SavedLoadout = Omit<CharacterEquipmentLoadoutView, 'weaponSets'> & {
  weaponSets: readonly [SavedWeaponSet, SavedWeaponSet, SavedWeaponSet];
};
export type SavedGameState = Omit<GameState, 'inventory'> & {
  inventory: Omit<GameState['inventory'], 'equipmentLoadouts'> & {
    equipmentLoadouts: Readonly<Record<CharacterId, SavedLoadout>>;
  };
};

export function restoreState(saved: SavedGameState): GameState {
  const loadouts: Record<CharacterId, CharacterEquipmentLoadoutView> = {};
  for (const [id, loadout] of Object.entries(saved.inventory.equipmentLoadouts)) {
    const restoreSet = (set: SavedWeaponSet): WeaponSetLoadoutView => ({
      ...set,
      selectedSkillIds: [set.selectedSkillIds[0] ?? undefined, set.selectedSkillIds[1] ?? undefined, set.selectedSkillIds[2] ?? undefined],
    });
    loadouts[id as CharacterId] = {
      ...loadout,
      weaponSets: [restoreSet(loadout.weaponSets[0]), restoreSet(loadout.weaponSets[1]), restoreSet(loadout.weaponSets[2])],
    };
  }
  return { ...saved, inventory: { ...saved.inventory, equipmentLoadouts: loadouts } };
}
