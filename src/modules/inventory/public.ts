// modules/inventory/public.ts
// Inventory 模組對外 Runtime API（唯一入口）。Composition 只從這裡取得工廠、Handler、
// Query、Fixture 與 ModuleContract；不得深入 import 內部檔案。

import type {
  EventSubscriptionId,
  InvariantId,
  ModuleContract,
  ModuleId,
  ReaderPortId,
  StateSliceName,
} from '../../contracts/core';

// ── State ───────────────────────────────────────────────────────────────────
export { createInitialInventoryState } from './state';
export type {
  InventoryState,
  ItemInstance,
  CharacterEquipmentLoadout,
  WeaponSetLoadout,
  EncumbranceResolution,
} from './state';

// ── Query ─────────────────────────────────────────────────────────────────––
export { createInventoryQuery } from './queries';

// ── System（Handler + Subscriber + Deps）────────────────────────────────────
export {
  INVENTORY_MODULE_ID,
  createItemInstance,
  transferItem,
  removeItemInstance,
  reserveQuestItem,
  reserveCraftingInputs,
  moveItemToTeamQuestCargo,
  commitCombatItemUse,
  equipItem,
  configureWeaponSet,
  createInitialLoadout,
  evaluateTeamEncumbrance,
  inventorySubscribers,
} from './system';
export type { InventoryDeps, InventoryHandlerResult } from './system';

// ── Fixtures ──────────────────────────────────────────────────────────────––
export { FIXTURE, createFixtureReader, createFixtureState, createFixtureDeps } from './fixtures';

// ── Tests ─────────────────────────────────────────────────────────────────––
export { runTests, runTestResults } from './inventory.test';
export type { InventoryTestResult } from './inventory.test';

// ── Module contract（doc §9 交接清單對照）────────────────────────────────────
// 事件綁定與執行順序由 Composition Manifest 唯一擁有；此處只宣告本模組可提供的 Handler。
export const INVENTORY_MODULE_CONTRACT: ModuleContract = {
  id: 'inventory' as ModuleId,
  owns: 'inventory' as StateSliceName,
  reads: [
    'item-definition-reader' as ReaderPortId,
    'team-membership-reader' as ReaderPortId,
    'carry-capacity-reader' as ReaderPortId,
  ],
  // Game Command 判別值一律 camelCase（core messages.ts 的訊息判別欄約定）。
  handlesGameCommands: [
    'equipItem',
    'unequipItem',
    'configureWeaponSet',
    'useItem',
    'splitStack',
    'transferItemForEncumbrance',
    'storeItemForEncumbrance',
    'abandonItemForEncumbrance',
    'reassignQuestCargoCarrierForEncumbrance',
  ],
  handlesInternalCommands: [
    'CreateItemInstance',
    'RemoveItemInstance',
    'TransferItem',
    'ReserveQuestItem',
    'ReserveCraftingInputs',
    'ApplyQuestItemLifecycle',
    'MoveItemToTeamQuestCargo',
    'ReleaseExpiredQuestCargo',
    'ConsumeBookForLearning',
    'TransformCraftingItems',
    'ConsumeCuisineIngredients',
    'CommitCombatItemUse',
    'ConsumeCombatSequenceRetrySupply',
    'EvaluateTeamEncumbrance',
  ],
  handlesJobs: [],
  // Inventory 不自訂事件重算（doc §3.3）；超載抵達後重算由 encumbrance-transition-workflow 觸發。
  subscriptionHandlerIds: [] as readonly EventSubscriptionId[],
  emits: [
    'ItemInstanceCreated',
    'InventoryTransferred',
    'ItemReservationChanged',
    'ItemConsumed',
    'ItemRemoved',
    'EquipmentChanged',
    'WeaponSetConfigured',
    'CombatItemUseCommitted',
    'CombatSequenceRetrySupplyConsumed',
    'BookUseCommittedForLearning',
    'CraftingItemsTransformed',
    'EncumbranceResolutionOpened',
    'EncumbranceResolutionClosed',
  ],
  invariants: [
    'inventory/unique-item-instance' as InvariantId,
    'inventory/single-location' as InvariantId,
    'inventory/reservation-not-movable' as InvariantId,
    'inventory/owner-matches-location' as InvariantId,
    'inventory/team-not-owner' as InvariantId,
  ],
};
