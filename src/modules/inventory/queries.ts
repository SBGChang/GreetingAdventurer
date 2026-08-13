// modules/inventory/queries.ts
// InventoryQuery Port 實作（對應 docs/00_core/architecture/05_inventory_module.md §4）。
// 純讀取：對 InventoryState 做 Readonly 投影，重量／價值以 ItemDefinitionReader 查表。
// Inventory 對外提供「目前重量」；最大重量（Carry Capacity）由 Derived Statistics 產生，不在此計算。

import type { CharacterId, ItemInstanceId, TeamId, WeaponSetId } from '../../contracts/core';
import type { MoneyValue } from '../../contracts/economy';
import type {
  CharacterEquipmentLoadoutView,
  EncumbranceResolutionView,
  EquipmentSlotId,
  InventoryQuery,
  ItemDefinitionReader,
  ItemInstanceView,
  ItemLocation,
  ItemLocationSelector,
  WeaponSetLoadoutView,
} from '../../contracts/inventory';
import type { CharacterEquipmentLoadout, InventoryState, ItemInstance } from './state';

// ── 投影輔助 ────────────────────────────────────────────────────────────────
function toView(inst: ItemInstance): ItemInstanceView {
  return {
    itemId: inst.itemId,
    definitionId: inst.definitionId,
    quantity: inst.quantity,
    ownerCharacterId: inst.ownerCharacterId,
    location: inst.location,
    reservation: inst.reservation,
    state: inst.state,
    instanceData: inst.instanceData,
    revision: inst.revision,
  };
}

// 角色攜帶重量只計 characterBag、equipped，以及 teamQuestCargo.carrierCharacterId 指向自己（doc 不變量 13）。
function isCarriedBy(inst: ItemInstance, characterId: CharacterId): boolean {
  if (inst.state !== 'active') return false;
  const loc = inst.location;
  switch (loc.kind) {
    case 'characterBag':
      return loc.characterId === characterId;
    case 'equipped':
      return loc.characterId === characterId;
    case 'teamQuestCargo':
      return loc.carrierCharacterId === characterId;
    default:
      return false;
  }
}

// listAtLocation 的位置比對：依 kind 及該 kind 的識別欄位精確比對。
function locationMatches(sel: ItemLocationSelector, loc: ItemLocation): boolean {
  if (sel.kind !== loc.kind) return false;
  switch (sel.kind) {
    case 'characterBag':
      return loc.kind === 'characterBag' && sel.characterId === loc.characterId;
    case 'homeStorage':
      return loc.kind === 'homeStorage' && sel.homeId === loc.homeId && sel.characterId === loc.characterId;
    case 'cityPermanentStock':
      return loc.kind === 'cityPermanentStock' && sel.cityId === loc.cityId;
    case 'shopShelf':
      return loc.kind === 'shopShelf' && sel.cityId === loc.cityId && sel.shopId === loc.shopId;
    case 'mapContent':
      return loc.kind === 'mapContent' && sel.contentId === loc.contentId;
    case 'equipped':
      return (
        loc.kind === 'equipped' &&
        sel.characterId === loc.characterId &&
        sel.slotId === loc.slotId &&
        sel.weaponSetId === loc.weaponSetId
      );
    case 'questEscrow':
      return loc.kind === 'questEscrow' && sel.questId === loc.questId;
    case 'teamQuestCargo':
      return (
        loc.kind === 'teamQuestCargo' &&
        sel.teamId === loc.teamId &&
        sel.questId === loc.questId &&
        sel.carrierCharacterId === loc.carrierCharacterId
      );
    case 'assetDistributionEscrow':
      return loc.kind === 'assetDistributionEscrow' && sel.distributionId === loc.distributionId;
    case 'removed':
      return loc.kind === 'removed';
    default:
      return false;
  }
}

// 尚未建立 Loadout 的角色（正式流程應在角色誕生時就以 createInitialLoadout 鑄好三個武器組）。此 fallback
// 只是占位顯示：weaponSetId 用**明顯的哨兵前綴**，不再偽造 `${char}:ws0` 那種看似真實的 ID——先前 UI 拿它
// 去 equip 會撞 unknown-weapon-set（split-brain）。現在 Handler 對未建 Loadout 一律回 loadout-not-initialized，
// UI 也能由此前綴判定「尚未初始化」而不提供裝備操作。
// TODO: 一旦角色建立流程一律預先鑄 Loadout，此 fallback 可移除。
function uninitializedLoadoutView(characterId: CharacterId): CharacterEquipmentLoadoutView {
  const ws = (i: number): WeaponSetLoadoutView => ({
    weaponSetId: `uninitialized-loadout:${characterId}:ws${i}` as WeaponSetId,
    mainHandItemId: undefined,
    offHandItemId: undefined,
    selectedSkillIds: [undefined, undefined, undefined],
  });
  return {
    characterId,
    armorSlots: {},
    weaponSets: [ws(0), ws(1), ws(2)],
    revision: 0,
  };
}

function loadoutToView(loadout: CharacterEquipmentLoadout): CharacterEquipmentLoadoutView {
  return {
    characterId: loadout.characterId,
    armorSlots: loadout.armorSlots,
    weaponSets: [loadout.weaponSets[0], loadout.weaponSets[1], loadout.weaponSets[2]],
    revision: loadout.revision,
  };
}

// ── Query 工廠 ──────────────────────────────────────────────────────────────
export function createInventoryQuery(
  state: InventoryState,
  reader: ItemDefinitionReader,
): InventoryQuery {
  const items = state.items;

  const query: InventoryQuery = {
    getItem(itemId: ItemInstanceId): ItemInstanceView | undefined {
      const inst = items[itemId];
      return inst ? toView(inst) : undefined;
    },

    getLocation(itemId: ItemInstanceId): ItemLocation | undefined {
      return items[itemId]?.location;
    },

    getOwningCharacter(itemId: ItemInstanceId): CharacterId | undefined {
      return items[itemId]?.ownerCharacterId;
    },

    getIntrinsicValue(itemId: ItemInstanceId): MoneyValue {
      const inst = items[itemId];
      if (!inst) throw new Error(`getIntrinsicValue: unknown item ${String(itemId)}`);
      const def = reader.getItem(inst.definitionId);
      // 內部競拍／八折直售只讀 intrinsicValue，不套商店報價（doc §2.2）。
      return { currencyId: def.intrinsicValue.currencyId, amount: def.intrinsicValue.amount };
    },

    getItemWeight(itemId: ItemInstanceId): number {
      const inst = items[itemId];
      if (!inst) return 0;
      const def = reader.getItem(inst.definitionId);
      // 堆疊總重 = unitWeight × quantity（doc §2.2）。
      return def.unitWeight * inst.quantity;
    },

    getCarriedWeight(characterId: CharacterId): number {
      let total = 0;
      for (const key of Object.keys(items)) {
        const inst = items[key as ItemInstanceId];
        if (inst && isCarriedBy(inst, characterId)) {
          total += reader.getItem(inst.definitionId).unitWeight * inst.quantity;
        }
      }
      return total;
    },

    listAtLocation(location: ItemLocationSelector): readonly ItemInstanceView[] {
      const out: ItemInstanceView[] = [];
      for (const key of Object.keys(items)) {
        const inst = items[key as ItemInstanceId];
        if (inst && locationMatches(location, inst.location)) out.push(toView(inst));
      }
      return out;
    },

    characterOwnsItem(characterId: CharacterId, itemId: ItemInstanceId): boolean {
      return items[itemId]?.ownerCharacterId === characterId;
    },

    characterHasBook(characterId: CharacterId, bookId: ItemInstanceId): boolean {
      const inst = items[bookId];
      if (!inst || inst.state !== 'active' || inst.ownerCharacterId !== characterId) return false;
      return reader.getItem(inst.definitionId).kind === 'book';
    },

    isReserved(itemId: ItemInstanceId): boolean {
      const r = items[itemId]?.reservation;
      return r !== undefined && r.reservedQuantity > 0;
    },

    getEquippedItem(
      characterId: CharacterId,
      slotId: EquipmentSlotId,
      weaponSetId?: WeaponSetId,
    ): ItemInstanceView | undefined {
      for (const key of Object.keys(items)) {
        const inst = items[key as ItemInstanceId];
        if (!inst || inst.location.kind !== 'equipped') continue;
        const loc = inst.location;
        if (loc.characterId === characterId && loc.slotId === slotId && loc.weaponSetId === weaponSetId) {
          return toView(inst);
        }
      }
      return undefined;
    },

    getEquipmentLoadout(characterId: CharacterId): CharacterEquipmentLoadoutView {
      const loadout = state.equipmentLoadouts[characterId];
      return loadout ? loadoutToView(loadout) : uninitializedLoadoutView(characterId);
    },

    getEncumbranceResolution(teamId: TeamId): EncumbranceResolutionView | undefined {
      for (const key of Object.keys(state.encumbranceResolutions)) {
        const res = state.encumbranceResolutions[key as keyof typeof state.encumbranceResolutions];
        if (res && res.teamId === teamId) {
          return {
            resolutionId: res.resolutionId,
            teamId: res.teamId,
            overweightCharacterIds: res.overweightCharacterIds,
            state: res.state,
            triggerSourceId: res.triggerSourceId,
            openedOnDay: res.openedOnDay,
            revision: res.revision,
          };
        }
      }
      return undefined;
    },
  };

  return query;
}
