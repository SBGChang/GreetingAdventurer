// modules/inventory/state.ts
// Inventory 唯一可寫的 State slice（對應 docs/00_core/architecture/05_inventory_module.md §1.1、§3）。
//
// 契約 (contracts/inventory) 只轉錄對外 View；內部可變記錄（ItemInstance / CharacterEquipmentLoadout /
// EncumbranceResolution）定義在這裡。實作以 Readonly 記錄 + immutable 更新維持決定性。

import type {
  CharacterId,
  EncumbranceResolutionId,
  EntitySourceRef,
  ItemDefinitionId,
  ItemInstanceId,
  Revision,
  SkillDefinitionId,
  TeamId,
  WeaponSetId,
  WorldDay,
} from '../../contracts/core';
import type {
  EncumbranceResolutionState,
  EquipmentSlotId,
  ItemInstanceData,
  ItemInstanceState,
  ItemLocation,
  ItemReservation,
} from '../../contracts/inventory';

// ── 內部實體記錄（doc §3.1 ItemInstance）────────────────────────────────────
export type ItemInstance = Readonly<{
  itemId: ItemInstanceId;
  definitionId: ItemDefinitionId;
  quantity: number;
  ownerCharacterId?: CharacterId;
  location: ItemLocation;
  reservation?: ItemReservation;
  state: ItemInstanceState;
  instanceData?: ItemInstanceData;
  revision: Revision;
}>;

// ── 角色裝備配置（doc §3.4）──────────────────────────────────────────────────
export type WeaponSetLoadout = Readonly<{
  weaponSetId: WeaponSetId;
  mainHandItemId?: ItemInstanceId;
  offHandItemId?: ItemInstanceId;
  selectedSkillIds: readonly [SkillDefinitionId?, SkillDefinitionId?, SkillDefinitionId?];
}>;

export type CharacterEquipmentLoadout = Readonly<{
  characterId: CharacterId;
  armorSlots: Readonly<Record<EquipmentSlotId, ItemInstanceId | undefined>>;
  weaponSets: readonly [WeaponSetLoadout, WeaponSetLoadout, WeaponSetLoadout];
  revision: Revision;
}>;

// ── 超載處理（doc §3.3）─────────────────────────────────────────────────────
export type EncumbranceResolution = Readonly<{
  resolutionId: EncumbranceResolutionId;
  teamId: TeamId;
  overweightCharacterIds: readonly CharacterId[];
  state: EncumbranceResolutionState;
  triggerSourceId: EntitySourceRef;
  openedOnDay?: WorldDay;
  revision: Revision;
}>;

// ── Slice 本體（doc §1.1）───────────────────────────────────────────────────
export type InventoryState = Readonly<{
  items: Readonly<Record<ItemInstanceId, ItemInstance>>;
  equipmentLoadouts: Readonly<Record<CharacterId, CharacterEquipmentLoadout>>;
  encumbranceResolutions: Readonly<Record<EncumbranceResolutionId, EncumbranceResolution>>;
}>;

// 初始工廠：空 slice。
export function createInitialInventoryState(): InventoryState {
  return {
    items: {},
    equipmentLoadouts: {},
    encumbranceResolutions: {},
  };
}
