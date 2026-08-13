// modules/inventory/system.ts
// Inventory 純函式 Command Handler 與 Subscriber（對應 docs/00_core/architecture/05_inventory_module.md §5–7）。
//
// 每個 Handler 皆為決定性純函式 (state, command, deps) → InventoryHandlerResult：
//   - 接受：回傳 ModuleResult<InventoryState>（只含自己 slice 的 nextSlice 與外送訊息）。
//   - 拒絕：回傳具型別 CommandRejection（doc §6：Internal Command 失敗不發 *Rejected 事件）。
// 所有實體 ID／超載處理 ID 由 deps 注入（真實 Composition 由 Transaction 的 runtime-id cursor 提供；
// 測試可注入計數器），使 Handler 保持純粹可重播。

import type {
  CharacterId,
  CommandRejection,
  DomainEventDraft,
  EncumbranceResolutionId,
  ItemInstanceId,
  ModuleId,
  ModuleResult,
  ModuleOutcome,
  TeamId,
  WeaponSetId,
  WorldDay,
} from '../../contracts/core';
import type {
  CarryCapacitySnapshot,
  CommitCombatItemUse,
  ConfigureWeaponSet,
  CreateItemInstance,
  EquipItem,
  EvaluateTeamEncumbrance,
  EquipmentSlotId,
  InventoryDomainEvent,
  ItemDefinitionReader,
  ItemLocation,
  ItemReservation,
  MoveItemToTeamQuestCargo,
  RemoveItemInstance,
  ReserveCraftingInputs,
  ReserveQuestItem,
  TransferItem,
} from '../../contracts/inventory';
import { createInventoryQuery } from './queries';
import type {
  EncumbranceResolution,
  InventoryState,
  ItemInstance,
  WeaponSetLoadout,
} from './state';

export const INVENTORY_MODULE_ID = 'inventory' as ModuleId;

// ── Handler 回傳型別 ────────────────────────────────────────────────────────
// B.5：形狀改由 contracts/core 的 ModuleOutcome 單一定義（原本三個模組各自複寫同一形狀）。
export type InventoryHandlerResult = ModuleOutcome<InventoryState>;

// ── 注入依賴（讀 Port + ID 產生器 + 世界時鐘）───────────────────────────────
export type InventoryDeps = Readonly<{
  reader: ItemDefinitionReader;
  nextItemInstanceId: () => ItemInstanceId;
  nextEncumbranceResolutionId: () => EncumbranceResolutionId;
  worldDay: WorldDay;
  // 超載評估輸入（由 team / derived-statistics 擁有，Inventory 只讀）。
  getTeamMembers: (teamId: TeamId) => readonly CharacterId[];
  getCarryCapacity: (characterId: CharacterId) => CarryCapacitySnapshot;
  isTeamTravelling: (teamId: TeamId) => boolean;
}>;

// ── 小工具 ──────────────────────────────────────────────────────────────────
function reject(
  code: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): InventoryHandlerResult {
  return { ok: false, rejection: { code, sourceModule: INVENTORY_MODULE_ID, details } };
}

function accept(
  nextSlice: InventoryState,
  outgoingMessages: readonly DomainEventDraft<unknown>[],
): InventoryHandlerResult {
  return { ok: true, result: { nextSlice, outgoingMessages, scheduledJobs: [] } };
}

function emit(event: InventoryDomainEvent): DomainEventDraft<unknown> {
  return { event };
}

function withItem(state: InventoryState, inst: ItemInstance): InventoryState {
  return { ...state, items: { ...state.items, [inst.itemId]: inst } };
}

// characterBag / homeStorage / equipped 的物品 Owner 必須等於位置上的角色（doc §3.2）。
function ownerBoundCharacter(loc: ItemLocation): CharacterId | undefined {
  switch (loc.kind) {
    case 'characterBag':
    case 'homeStorage':
    case 'equipped':
      return loc.characterId;
    default:
      return undefined;
  }
}

function isReservedActive(inst: ItemInstance): boolean {
  return inst.reservation !== undefined && inst.reservation.reservedQuantity > 0;
}

function sameCharacterSet(a: readonly CharacterId[], b: readonly CharacterId[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set<string>(a as readonly string[]);
  for (const c of b) if (!sa.has(c as unknown as string)) return false;
  return true;
}

// ── CreateItemInstance（doc §5.2）───────────────────────────────────────────
export function createItemInstance(
  state: InventoryState,
  cmd: CreateItemInstance,
  deps: InventoryDeps,
): InventoryHandlerResult {
  if (!Number.isInteger(cmd.quantity) || cmd.quantity <= 0) {
    return reject('inventory/invalid-quantity', { quantity: cmd.quantity });
  }
  const def = deps.reader.getItem(cmd.definitionId);
  // stackPolicy=single 的實體 quantity 必須為 1（doc 不變量 3）。
  if (def.stackPolicy === 'single' && cmd.quantity !== 1) {
    return reject('inventory/single-stack-quantity', { quantity: cmd.quantity });
  }

  const bound = ownerBoundCharacter(cmd.location);
  let owner: CharacterId | undefined;
  if (bound !== undefined) {
    if (cmd.ownerCharacterId !== undefined && cmd.ownerCharacterId !== bound) {
      return reject('inventory/owner-location-mismatch');
    }
    owner = bound;
  } else if (cmd.location.kind === 'teamQuestCargo') {
    // teamQuestCargo 物品無角色 Owner（doc 不變量 12）。
    if (cmd.ownerCharacterId !== undefined) return reject('inventory/quest-cargo-owner');
    owner = undefined;
  } else {
    // map / city / shop / questEscrow / assetDistributionEscrow：可暫無 Owner。
    owner = cmd.ownerCharacterId;
  }

  const itemId = deps.nextItemInstanceId();
  const inst: ItemInstance = {
    itemId,
    definitionId: cmd.definitionId,
    quantity: cmd.quantity,
    ownerCharacterId: owner,
    location: cmd.location,
    state: 'active',
    revision: 0,
  };

  // TODO: 進入角色攜帶範圍的建立須在同一交易評估超載（doc §2.2）。此觸發由
  // encumbrance-transition-workflow 及各建立來源 Workflow 負責，Inventory 不自建第二套重算。
  return accept(withItem(state, inst), [
    emit({ type: 'ItemInstanceCreated', itemId, definitionId: cmd.definitionId, ownerCharacterId: owner, location: cmd.location }),
  ]);
}

// ── TransferItem（doc §5.2）─────────────────────────────────────────────────
export function transferItem(
  state: InventoryState,
  cmd: TransferItem,
  _deps: InventoryDeps,
): InventoryHandlerResult {
  const inst = state.items[cmd.itemId];
  if (!inst) return reject('inventory/unknown-item', { itemId: String(cmd.itemId) });
  if (inst.state !== 'active') return reject('inventory/item-not-active');
  // 保留中的物品不可任意換位置（doc 不變量 5）；pendingTransfer 是進行中的移轉，放行。
  if (isReservedActive(inst) && inst.reservation?.kind !== 'pendingTransfer') {
    return reject('inventory/item-reserved');
  }
  // 已裝備的物品不可直接被搬走：裝備欄（armorSlots / weaponSets）仍會保留該 itemId，
  // 造成「物品在背包、裝備欄卻還指著它」的不一致，違反不變量 inventory/single-location。
  // 必須先卸下（UnequipItem）再移動。
  if (inst.location.kind === 'equipped') {
    return reject('inventory/item-equipped', { itemId: String(cmd.itemId) });
  }

  const bound = ownerBoundCharacter(cmd.to);
  let newOwner: CharacterId | undefined;
  if (bound !== undefined) {
    if (cmd.newOwnerCharacterId !== undefined && cmd.newOwnerCharacterId !== bound) {
      return reject('inventory/owner-location-mismatch');
    }
    newOwner = bound;
  } else if (cmd.to.kind === 'teamQuestCargo') {
    newOwner = undefined; // 移入任務物資空間清除個人 Owner（doc §3.2）。
  } else {
    newOwner = cmd.newOwnerCharacterId;
  }

  const from = inst.location;
  const oldOwner = inst.ownerCharacterId;
  const next: ItemInstance = {
    ...inst,
    location: cmd.to,
    ownerCharacterId: newOwner,
    revision: inst.revision + 1,
  };
  return accept(withItem(state, next), [
    emit({ type: 'InventoryTransferred', itemId: cmd.itemId, from, to: cmd.to, oldOwner, newOwner, reason: cmd.reason }),
  ]);
}

// ── RemoveItemInstance（doc §5.2）───────────────────────────────────────────
export function removeItemInstance(
  state: InventoryState,
  cmd: RemoveItemInstance,
  _deps: InventoryDeps,
): InventoryHandlerResult {
  const inst = state.items[cmd.itemId];
  if (!inst) return reject('inventory/unknown-item', { itemId: String(cmd.itemId) });
  if (inst.state === 'removed') return reject('inventory/already-removed');
  // 拒絕仍被非法保留或裝備的 Item（doc §5.2）。
  if (isReservedActive(inst)) return reject('inventory/item-reserved');
  if (inst.location.kind === 'equipped') return reject('inventory/item-equipped');

  const previousLocation = inst.location;
  const next: ItemInstance = {
    ...inst,
    state: 'removed',
    location: { kind: 'removed', reason: cmd.reason },
    revision: inst.revision + 1,
  };
  return accept(withItem(state, next), [
    emit({ type: 'ItemRemoved', itemId: cmd.itemId, previousLocation, reason: cmd.reason }),
  ]);
}

// ── ReserveQuestItem（doc §5.2、§7.3）───────────────────────────────────────
export function reserveQuestItem(
  state: InventoryState,
  cmd: ReserveQuestItem,
  _deps: InventoryDeps,
): InventoryHandlerResult {
  const inst = state.items[cmd.itemId];
  if (!inst) return reject('inventory/unknown-item', { itemId: String(cmd.itemId) });
  if (inst.state !== 'active') return reject('inventory/item-not-active');
  if (isReservedActive(inst)) return reject('inventory/already-reserved');
  // 委託目標綁定實際 ItemInstance（doc 不變量 4）。reservation.ownerId 表示保留歸屬的個人。
  const owner = inst.ownerCharacterId;
  if (owner === undefined) {
    // TODO: 店面貨架等無角色 Owner 的委託目標需要以 AssetDistribution/Team 表述 ownerId；
    // 第一版主路徑要求委託目標已由角色持有。
    return reject('inventory/quest-reserve-needs-owner', { questId: String(cmd.questId) });
  }
  const reservation: ItemReservation = {
    kind: 'questTarget',
    ownerId: owner,
    reservedQuantity: inst.quantity,
  };
  const next: ItemInstance = { ...inst, reservation, revision: inst.revision + 1 };
  return accept(withItem(state, next), [emit({ type: 'ItemReservationChanged', itemId: cmd.itemId, reservation })]);
}

// ── ReserveCraftingInputs（原子；任一不合法全部拒絕，doc §5.2）───────────────
export function reserveCraftingInputs(
  state: InventoryState,
  cmd: ReserveCraftingInputs,
  _deps: InventoryDeps,
): InventoryHandlerResult {
  if (cmd.itemIds.length === 0) return reject('inventory/empty-crafting-inputs');
  let owner: CharacterId | undefined;
  for (const id of cmd.itemIds) {
    const inst = state.items[id];
    if (!inst) return reject('inventory/unknown-item', { itemId: String(id) });
    if (inst.state !== 'active') return reject('inventory/item-not-active', { itemId: String(id) });
    if (isReservedActive(inst)) return reject('inventory/already-reserved', { itemId: String(id) });
    if (inst.ownerCharacterId === undefined) return reject('inventory/crafting-input-unowned', { itemId: String(id) });
    if (owner === undefined) owner = inst.ownerCharacterId;
    else if (owner !== inst.ownerCharacterId) return reject('inventory/crafting-input-owner-mismatch');
  }
  if (owner === undefined) return reject('inventory/empty-crafting-inputs');

  let items = state.items;
  const messages: DomainEventDraft<unknown>[] = [];
  for (const id of cmd.itemIds) {
    const inst = items[id];
    if (!inst) return reject('inventory/unknown-item', { itemId: String(id) });
    const reservation: ItemReservation = {
      kind: 'craftingInput',
      ownerId: owner,
      reservedQuantity: inst.quantity,
    };
    const next: ItemInstance = { ...inst, reservation, revision: inst.revision + 1 };
    items = { ...items, [id]: next };
    messages.push(emit({ type: 'ItemReservationChanged', itemId: id, reservation }));
  }
  return accept({ ...state, items }, messages);
}

// ── MoveItemToTeamQuestCargo（doc §5.2、§3.2）───────────────────────────────
export function moveItemToTeamQuestCargo(
  state: InventoryState,
  cmd: MoveItemToTeamQuestCargo,
  _deps: InventoryDeps,
): InventoryHandlerResult {
  const inst = state.items[cmd.itemId];
  if (!inst) return reject('inventory/unknown-item', { itemId: String(cmd.itemId) });
  if (inst.state !== 'active') return reject('inventory/item-not-active');
  if (isReservedActive(inst) && inst.reservation?.kind !== 'questTarget') {
    return reject('inventory/item-reserved');
  }
  const from = inst.location;
  const oldOwner = inst.ownerCharacterId;
  const to: ItemLocation = {
    kind: 'teamQuestCargo',
    teamId: cmd.teamId,
    questId: cmd.questId,
    carrierCharacterId: cmd.carrierCharacterId,
  };
  // TODO: 驗證攜帶者重量上限（doc §5.2）；需 CarryCapacitySnapshot，交由建立來源 Workflow 於同交易評估。
  const next: ItemInstance = {
    ...inst,
    location: to,
    ownerCharacterId: undefined,
    revision: inst.revision + 1,
  };
  return accept(withItem(state, next), [
    emit({ type: 'InventoryTransferred', itemId: cmd.itemId, from, to, oldOwner, newOwner: undefined, reason: 'moveToTeamQuestCargo' }),
  ]);
}

// ── CommitCombatItemUse（doc §5.3）──────────────────────────────────────────
export function commitCombatItemUse(
  state: InventoryState,
  cmd: CommitCombatItemUse,
  deps: InventoryDeps,
): InventoryHandlerResult {
  const inst = state.items[cmd.itemId];
  if (!inst) return reject('inventory/unknown-item', { itemId: String(cmd.itemId) });
  if (inst.state !== 'active') return reject('inventory/item-not-active');
  if (inst.location.kind !== 'characterBag' || inst.location.characterId !== cmd.userId) {
    return reject('inventory/combat-item-not-in-bag');
  }
  if (inst.ownerCharacterId !== cmd.userId) return reject('inventory/not-owner');
  if (isReservedActive(inst)) return reject('inventory/item-reserved');
  const def = deps.reader.getItem(inst.definitionId);
  if (def.kind !== 'combatConsumable') return reject('inventory/not-combat-consumable');

  const remaining = inst.quantity - 1;
  const next: ItemInstance =
    remaining <= 0
      ? {
          ...inst,
          quantity: 0,
          state: 'consumed',
          location: { kind: 'removed', reason: 'consumed' },
          revision: inst.revision + 1,
        }
      : { ...inst, quantity: remaining, revision: inst.revision + 1 };

  // Inventory 不自算延遲，只回傳 Definition 的 useDelayRuleId 與效果（doc §2.4、§5.3）。
  const messages: DomainEventDraft<unknown>[] = [
    emit({ type: 'CombatItemUseCommitted',
      itemId: cmd.itemId,
      userId: cmd.userId,
      useDelayRuleId: def.combatUseDelayRuleId,
      effectRefs: def.useEffectIds ?? [],
    }),
    emit({ type: 'ItemConsumed', itemId: cmd.itemId, quantity: 1, reason: 'combatUse' }),
  ];
  return accept(withItem(state, next), messages);
}

// ── EquipItem（Player Command，doc §5.1、§3.4–3.5）──────────────────────────
export function equipItem(
  state: InventoryState,
  cmd: EquipItem,
  deps: InventoryDeps,
): InventoryHandlerResult {
  const inst = state.items[cmd.itemId];
  if (!inst) return reject('inventory/unknown-item', { itemId: String(cmd.itemId) });
  if (inst.state !== 'active') return reject('inventory/item-not-active');
  if (inst.ownerCharacterId !== cmd.characterId) return reject('inventory/not-owner');
  if (isReservedActive(inst)) return reject('inventory/item-reserved');
  const def = deps.reader.getItem(inst.definitionId);
  if (def.kind !== 'equipment') return reject('inventory/not-equipment');
  const equip = deps.reader.getEquipment(inst.definitionId);
  // occupiedSlots 以資料表達合法位置（doc §2.3、§3.5 不變量 6）。
  if (!equip.occupiedSlots.includes(cmd.slotId)) {
    return reject('inventory/illegal-slot', { slotId: String(cmd.slotId) });
  }

  // 手部裝備屬於武器組（doc §282：三組武器各自持有主／副手），必須指名 weaponSetId；
  // 否則會被寫進共用的 armorSlots，武器組永遠看不到它。反之鎧甲不得帶 weaponSetId（不變量 9）。
  const isHandHeld = equip.equipmentKind === 'weapon' || equip.equipmentKind === 'shield';
  if (isHandHeld && cmd.weaponSetId === undefined) {
    return reject('inventory/weapon-requires-weapon-set');
  }
  if (!isHandHeld && cmd.weaponSetId !== undefined) {
    return reject('inventory/non-weapon-must-not-target-weapon-set');
  }

  const loadout = getOrCreateLoadout(state, cmd.characterId);
  // 雙手裝備以 occupiedSlots 同時占用主／副手（doc §282），不複製第二件 Item。
  const isTwoHanded = equip.occupiedSlots.length > 1;

  let nextLoadout = loadout;
  let working = state;
  const events: DomainEventDraft<unknown>[] = [];
  // 被頂掉的舊裝備：必須真的卸回背包，否則舊物品的 location 仍是 equipped，
  // 裝備欄與物品位置就此永久不一致（違反 inventory/single-location）。
  const displaced: ItemInstanceId[] = [];

  if (cmd.weaponSetId !== undefined) {
    const idx = loadout.weaponSets.findIndex((w) => w.weaponSetId === cmd.weaponSetId);
    if (idx < 0) return reject('inventory/unknown-weapon-set', { weaponSetId: String(cmd.weaponSetId) });
    const set = loadout.weaponSets[idx]!;

    // 目標手:雙手武器占滿主+副;盾牌屬副手;其餘單手武器屬主手。原本一律寫進主手,導致裝副手(盾)
    // 被錯放到主手(offHand→mainHand bug)。[限制] 單手武器的「雙持副手」需 slot→hand 訊號,資料模型
    // 目前未提供,故單手武器一律主手。
    const previousMainIsTwoHanded =
      set.mainHandItemId !== undefined && set.offHandItemId === set.mainHandItemId;
    const goesOffHand = !isTwoHanded && equip.equipmentKind === 'shield';

    let nextMain = set.mainHandItemId;
    let nextOff = set.offHandItemId;

    if (isTwoHanded) {
      if (set.mainHandItemId !== undefined && set.mainHandItemId !== cmd.itemId) displaced.push(set.mainHandItemId);
      if (set.offHandItemId !== undefined && set.offHandItemId !== cmd.itemId && !displaced.includes(set.offHandItemId)) {
        displaced.push(set.offHandItemId);
      }
      nextMain = cmd.itemId;
      nextOff = cmd.itemId; // 雙手：主副手指向同一件
    } else if (goesOffHand) {
      // 頂掉原副手（若非同一件、且不是被雙手武器共用的佔位）。
      if (set.offHandItemId !== undefined && set.offHandItemId !== cmd.itemId && set.offHandItemId !== set.mainHandItemId) {
        displaced.push(set.offHandItemId);
      }
      // 原主手是雙手武器 → 佔用副手，換上盾牌前必須把它卸下、清主手。
      if (previousMainIsTwoHanded && set.mainHandItemId !== undefined) {
        if (!displaced.includes(set.mainHandItemId)) displaced.push(set.mainHandItemId);
        nextMain = undefined;
      }
      nextOff = cmd.itemId;
    } else {
      if (set.mainHandItemId !== undefined && set.mainHandItemId !== cmd.itemId) displaced.push(set.mainHandItemId);
      if (previousMainIsTwoHanded) nextOff = undefined; // 原雙手武器的副手佔位解除
      nextMain = cmd.itemId;
    }

    const updated: WeaponSetLoadout = { ...set, mainHandItemId: nextMain, offHandItemId: nextOff };
    nextLoadout = {
      ...loadout,
      weaponSets: replaceWeaponSet(loadout.weaponSets, idx, updated),
      revision: loadout.revision + 1,
    };
  } else {
    // 鎧甲等共用裝備位置（doc 不變量 9：不得有 weaponSetId）。一件裝備可占用多個 slot。
    const nextArmor: Record<EquipmentSlotId, ItemInstanceId | undefined> = { ...loadout.armorSlots };
    // 先蒐集所有被本次占用 slot 頂掉的舊物品。
    for (const slot of equip.occupiedSlots) {
      const previous = nextArmor[slot];
      if (previous !== undefined && previous !== cmd.itemId && !displaced.includes(previous)) {
        displaced.push(previous);
      }
    }
    // 被頂掉的物品可能是**多格**裝備：把它占用的**每一個** slot 都清掉,否則其他格會殘留指向已卸下的
    // 物品(multi-slot armor 殘留 slot bug)。
    for (const key of Object.keys(nextArmor) as EquipmentSlotId[]) {
      const occupant = nextArmor[key];
      if (occupant !== undefined && displaced.includes(occupant)) nextArmor[key] = undefined;
    }
    for (const slot of equip.occupiedSlots) nextArmor[slot] = cmd.itemId;
    nextLoadout = { ...loadout, armorSlots: nextArmor, revision: loadout.revision + 1 };
  }

  // 卸下被頂掉的物品：回到該角色背包。
  for (const oldItemId of displaced) {
    const old = working.items[oldItemId];
    if (old === undefined) continue;
    working = withItem(working, {
      ...old,
      location: { kind: 'characterBag', characterId: cmd.characterId },
      revision: old.revision + 1,
    });
    events.push(
      emit({
        type: 'EquipmentChanged',
        characterId: cmd.characterId,
        slotId: cmd.slotId,
        weaponSetId: cmd.weaponSetId,
        itemId: undefined, // 該位置已清空
      }),
    );
  }

  const equippedLocation: ItemLocation = {
    kind: 'equipped',
    characterId: cmd.characterId,
    slotId: cmd.slotId,
    weaponSetId: cmd.weaponSetId,
  };
  const movedItem: ItemInstance = {
    ...inst,
    location: equippedLocation,
    revision: inst.revision + 1,
  };
  const nextState: InventoryState = {
    ...working,
    items: { ...working.items, [movedItem.itemId]: movedItem },
    equipmentLoadouts: { ...working.equipmentLoadouts, [cmd.characterId]: nextLoadout },
  };
  events.push(
    emit({ type: 'EquipmentChanged', characterId: cmd.characterId, slotId: cmd.slotId, weaponSetId: cmd.weaponSetId, itemId: cmd.itemId }),
  );
  return accept(nextState, events);
}

// ── ConfigureWeaponSet（Player Command，doc §5.1、§3.4）──────────────────────
export function configureWeaponSet(
  state: InventoryState,
  cmd: ConfigureWeaponSet,
  deps: InventoryDeps,
): InventoryHandlerResult {
  const loadout = getOrCreateLoadout(state, cmd.characterId);
  const idx = loadout.weaponSets.findIndex((w) => w.weaponSetId === cmd.weaponSetId);
  if (idx < 0) return reject('inventory/unknown-weapon-set', { weaponSetId: String(cmd.weaponSetId) });

  // doc §349 前置條件：「裝備由角色持有、slot 相容」。原本完全沒驗證，任意 itemId
  // ——包含不存在的、別人的、非裝備的——都會被寫進武器組。
  const hands = [
    ['mainHand', cmd.mainHandItemId] as const,
    ['offHand', cmd.offHandItemId] as const,
  ];
  for (const [hand, itemId] of hands) {
    if (itemId === undefined) continue;
    const item = state.items[itemId];
    if (item === undefined) return reject('inventory/unknown-item', { hand, itemId: String(itemId) });
    if (item.state !== 'active') return reject('inventory/item-not-active', { hand });
    if (item.ownerCharacterId !== cmd.characterId) return reject('inventory/not-owner', { hand });
    if (deps.reader.getItem(item.definitionId).kind !== 'equipment') {
      return reject('inventory/not-equipment', { hand });
    }
  }

  const equipOf = (itemId: ItemInstanceId | undefined) =>
    itemId === undefined ? undefined : deps.reader.getEquipment(state.items[itemId]!.definitionId);
  const mainEquip = equipOf(cmd.mainHandItemId);
  const offEquip = equipOf(cmd.offHandItemId);

  // 雙手裝備同時占用主／副手（doc §282）：兩手必須是同一件；反之單手不得占滿兩手。
  const mainTwoHanded = mainEquip !== undefined && mainEquip.occupiedSlots.length > 1;
  const offTwoHanded = offEquip !== undefined && offEquip.occupiedSlots.length > 1;
  if ((mainTwoHanded || offTwoHanded) && cmd.mainHandItemId !== cmd.offHandItemId) {
    return reject('inventory/two-handed-must-occupy-both-hands');
  }
  // 手部位置合法性（原本完全沒驗，故盾可放主手、單手劍可放副手）：主手須為武器；副手須為盾，或與主手
  // 同一件的雙手武器。[限制] 單手武器的「雙持副手」需 slot→hand 訊號，資料模型未提供，故副手只收盾。
  if (mainEquip !== undefined && mainEquip.equipmentKind !== 'weapon') {
    return reject('inventory/illegal-hand', { hand: 'mainHand', kind: mainEquip.equipmentKind });
  }
  if (offEquip !== undefined && cmd.offHandItemId !== cmd.mainHandItemId && offEquip.equipmentKind !== 'shield') {
    return reject('inventory/illegal-hand', { hand: 'offHand', kind: offEquip.equipmentKind });
  }

  // 技能合法性（角色是否學會）由組裝 Workflow 透過 Progression Query 驗證，Inventory 只存配置（doc §1.2）。
  // ── 原子同步：loadout + 受影響 item 的 location + 清掉其他武器組對同一件的舊引用（single-location）──
  const rawNew = [cmd.mainHandItemId, cmd.offHandItemId].filter(
    (x): x is ItemInstanceId => x !== undefined,
  );
  const newItemSet = new Set<string>(rawNew.map(String));
  const newItemIds = rawNew.filter((id, i) => rawNew.indexOf(id) === i); // 去重（雙手武器 main===off）
  const prevSet = loadout.weaponSets[idx]!;
  // 本組原本的手部物品，若不再被引用 → 稍後卸回背包（否則 location 永遠停在 equipped）。
  const displaced = [prevSet.mainHandItemId, prevSet.offHandItemId].filter(
    (x): x is ItemInstanceId => x !== undefined && !newItemSet.has(String(x)),
  );

  const updated: WeaponSetLoadout = {
    weaponSetId: cmd.weaponSetId,
    mainHandItemId: cmd.mainHandItemId,
    offHandItemId: cmd.offHandItemId,
    selectedSkillIds: cmd.selectedSkillIds,
  };
  // 其餘各組若引用了本次要裝上的任一件 → 清掉（一件不可同時在兩組；原本可被多組同時引用）。
  const clearFrom = (ws: WeaponSetLoadout): WeaponSetLoadout => {
    const m = ws.mainHandItemId !== undefined && newItemSet.has(String(ws.mainHandItemId)) ? undefined : ws.mainHandItemId;
    const o = ws.offHandItemId !== undefined && newItemSet.has(String(ws.offHandItemId)) ? undefined : ws.offHandItemId;
    return m === ws.mainHandItemId && o === ws.offHandItemId ? ws : { ...ws, mainHandItemId: m, offHandItemId: o };
  };
  const s = loadout.weaponSets;
  const nextSets: readonly [WeaponSetLoadout, WeaponSetLoadout, WeaponSetLoadout] = [
    idx === 0 ? updated : clearFrom(s[0]),
    idx === 1 ? updated : clearFrom(s[1]),
    idx === 2 ? updated : clearFrom(s[2]),
  ];
  const nextLoadout = { ...loadout, weaponSets: nextSets, revision: loadout.revision + 1 };
  let working: InventoryState = {
    ...state,
    equipmentLoadouts: { ...state.equipmentLoadouts, [cmd.characterId]: nextLoadout },
  };
  // 卸下的舊物品 → 回本角色背包。
  for (const oldId of displaced) {
    const old = working.items[oldId];
    if (old === undefined) continue;
    working = withItem(working, {
      ...old,
      location: { kind: 'characterBag', characterId: cmd.characterId },
      revision: old.revision + 1,
    });
  }
  // 裝上的物品 → equipped（slotId 取裝備自身 occupiedSlots[0]，帶 weaponSetId）；同步 ItemLocation。
  for (const newId of newItemIds) {
    const inst = working.items[newId];
    if (inst === undefined) continue;
    const eq = deps.reader.getEquipment(inst.definitionId);
    const location: ItemLocation = {
      kind: 'equipped',
      characterId: cmd.characterId,
      slotId: eq.occupiedSlots[0]!,
      weaponSetId: cmd.weaponSetId,
    };
    working = withItem(working, { ...inst, location, revision: inst.revision + 1 });
  }

  const skillIds = cmd.selectedSkillIds.filter((x): x is NonNullable<typeof x> => x !== undefined);
  return accept(working, [
    emit({ type: 'WeaponSetConfigured', characterId: cmd.characterId, weaponSetId: cmd.weaponSetId, itemIds: newItemIds, skillIds }),
  ]);
}

// ── EvaluateTeamEncumbrance（冪等，doc §3.3、§5.2）───────────────────────────
export function evaluateTeamEncumbrance(
  state: InventoryState,
  cmd: EvaluateTeamEncumbrance,
  deps: InventoryDeps,
): InventoryHandlerResult {
  const query = createInventoryQuery(state, deps.reader);
  const members = deps.getTeamMembers(cmd.teamId);
  const overweight = members.filter(
    (c) => query.getCarriedWeight(c) > deps.getCarryCapacity(c).maximumWeight,
  );
  const existing = findResolutionByTeam(state, cmd.teamId);

  if (overweight.length === 0) {
    // 全隊不超載：關閉既有 Resolution 並恢復一般操作（doc §3.3）。
    if (!existing) return accept(state, []); // 冪等 no-op。
    const nextResolutions = { ...state.encumbranceResolutions };
    delete (nextResolutions as Record<string, EncumbranceResolution>)[existing.resolutionId as unknown as string];
    return accept({ ...state, encumbranceResolutions: nextResolutions }, [
      emit({ type: 'EncumbranceResolutionClosed', resolutionId: existing.resolutionId, teamId: cmd.teamId }),
    ]);
  }

  const targetState = deps.isTeamTravelling(cmd.teamId) ? 'deferredDuringTravel' : 'awaitingPlayer';

  if (existing) {
    // 冪等：目標狀態與超載名單皆未變 → 無事發生。
    if (existing.state === targetState && sameCharacterSet(existing.overweightCharacterIds, overweight)) {
      return accept(state, []);
    }
    const updated: EncumbranceResolution = {
      ...existing,
      overweightCharacterIds: overweight,
      state: targetState,
      revision: existing.revision + 1,
    };
    return accept(
      { ...state, encumbranceResolutions: { ...state.encumbranceResolutions, [existing.resolutionId]: updated } },
      [emit({ type: 'EncumbranceResolutionOpened', resolutionId: existing.resolutionId, teamId: cmd.teamId, overweightCharacterIds: overweight, state: targetState })],
    );
  }

  // 新開 Resolution（同隊至多一筆，doc §3.3）。
  const resolutionId = deps.nextEncumbranceResolutionId();
  const created: EncumbranceResolution = {
    resolutionId,
    teamId: cmd.teamId,
    overweightCharacterIds: overweight,
    state: targetState,
    triggerSourceId: cmd.teamId,
    openedOnDay: deps.worldDay,
    revision: 0,
  };
  return accept(
    { ...state, encumbranceResolutions: { ...state.encumbranceResolutions, [resolutionId]: created } },
    [emit({ type: 'EncumbranceResolutionOpened', resolutionId, teamId: cmd.teamId, overweightCharacterIds: overweight, state: targetState })],
  );
}

// ── Loadout 輔助 ───────────────────────────────────────────────────────────
function getOrCreateLoadout(state: InventoryState, characterId: CharacterId) {
  const existing = state.equipmentLoadouts[characterId];
  if (existing) return existing;
  const ws = (i: number): WeaponSetLoadout => ({
    weaponSetId: `${characterId}:ws${i}` as WeaponSetId,
    selectedSkillIds: [undefined, undefined, undefined],
  });
  return {
    characterId,
    armorSlots: {} as Readonly<Record<EquipmentSlotId, ItemInstanceId | undefined>>,
    weaponSets: [ws(0), ws(1), ws(2)] as readonly [WeaponSetLoadout, WeaponSetLoadout, WeaponSetLoadout],
    revision: 0,
  };
}

function replaceWeaponSet(
  sets: readonly [WeaponSetLoadout, WeaponSetLoadout, WeaponSetLoadout],
  idx: number,
  next: WeaponSetLoadout,
): readonly [WeaponSetLoadout, WeaponSetLoadout, WeaponSetLoadout] {
  const arr: [WeaponSetLoadout, WeaponSetLoadout, WeaponSetLoadout] = [sets[0], sets[1], sets[2]];
  arr[idx] = next;
  return arr;
}

function findResolutionByTeam(state: InventoryState, teamId: TeamId): EncumbranceResolution | undefined {
  for (const key of Object.keys(state.encumbranceResolutions)) {
    const res = state.encumbranceResolutions[key as EncumbranceResolutionId];
    if (res && res.teamId === teamId) return res;
  }
  return undefined;
}

// ── Subscribers（doc §3.3 明確禁止 Inventory 自訂事件重算）─────────────────────
// 超載「抵達後重算」由 encumbrance-transition-workflow 訂閱 TeamLocationChanged 後送出
// EvaluateTeamEncumbrance；Inventory 不得再自建第二套事件重算邏輯，故不註冊任何 Domain Event
// Subscriber。此處以空清單明示該設計決策（供 Composition 驗證 subscriptionHandlerIds 為空）。
export const inventorySubscribers: readonly never[] = [];
