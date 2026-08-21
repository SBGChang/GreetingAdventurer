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
  ConsumeCombatSequenceRetrySupply,
  ConfigureWeaponSet,
  CreateItemInstance,
  EquipItem,
  EvaluateTeamEncumbrance,
  EquipmentSlotId,
  InventoryDomainEvent,
  ItemDefinitionReader,
  ItemLocation,
  EquipmentHand,
  ItemReservation,
  MoveItemToTeamQuestCargo,
  RemoveItemInstance,
  ReserveCraftingInputs,
  ReserveQuestItem,
  TransferItem,
} from '../../contracts/inventory';
import { createInventoryQuery } from './queries';
import type {
  CharacterEquipmentLoadout,
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
  // 由核心 Runtime ID 產生器配發（每呼叫推進 core.nextRuntimeSequence）。建立 Loadout 時鑄三個武器組 ID，
  // 不再以 `${characterId}:ws${i}` 偽造（違反「所有 Runtime ID 由核心產生器建立」）。
  nextWeaponSetId: () => WeaponSetId;
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
  return { ok: false, rejection: { code, source: INVENTORY_MODULE_ID, details } };
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

// 兩條裝備入口共用的**事件產生**：比對整份 Loadout 前後差異，對每一個佔用者有變的位置各發一筆
// EquipmentChanged。
//
// 為什麼要比對整份而不是各路徑自己發：手寫的發送點永遠會漏。R11 #1 補了 configureWeaponSet 的本組、
// R12 #1 補了它清空的其他組，而 equipItem 依然漏了跨組清空；更糟的是 equipItem 對每一件被頂掉的物品
// 都套用 `cmd.slotId`，於是被替換的雙手武器或別格鎧甲會被回報成「這次命令的那個 slot」清空了
// （複審 R13 #1）。差異比對沒有這種漏法：位置變了就一定會發，slot 一定取自該位置本身。
function equipmentChangeEvents(
  characterId: CharacterId,
  before: CharacterEquipmentLoadout,
  after: CharacterEquipmentLoadout,
  items: InventoryState['items'],
  deps: InventoryDeps,
): DomainEventDraft<unknown>[] {
  const events: DomainEventDraft<unknown>[] = [];
  const handSlotOf = (itemId: ItemInstanceId | undefined, hand: EquipmentHand): EquipmentSlotId | undefined => {
    if (itemId === undefined) return undefined;
    const inst = items[itemId];
    return inst === undefined ? undefined : deps.reader.getEquipment(inst.definitionId).handSlots[hand];
  };

  for (let index = 0; index < after.weaponSets.length; index += 1) {
    const prevSet = before.weaponSets[index];
    const nextSet = after.weaponSets[index];
    if (prevSet === undefined || nextSet === undefined) continue;
    for (const hand of ['mainHand', 'offHand'] as const) {
      const prevId = hand === 'mainHand' ? prevSet.mainHandItemId : prevSet.offHandItemId;
      const nextId = hand === 'mainHand' ? nextSet.mainHandItemId : nextSet.offHandItemId;
      if (prevId === nextId) continue;
      // 清空時 slot 取自**被移走的那一件**在該手的 slot，不是命令帶的 slot。
      const slotId = handSlotOf(nextId, hand) ?? handSlotOf(prevId, hand);
      if (slotId === undefined) continue;
      events.push(
        emit({
          type: 'EquipmentChanged',
          characterId,
          slotId,
          weaponSetId: nextSet.weaponSetId,
          itemId: nextId,
        }),
      );
    }
  }

  // 鎧甲等共用位置：逐 slot 比對（多格鎧甲每格各發一筆，因為每格的佔用者都變了）。
  const slotIds = new Set<string>([...Object.keys(before.armorSlots), ...Object.keys(after.armorSlots)]);
  for (const slot of slotIds) {
    const slotId = slot as EquipmentSlotId;
    const prevId = before.armorSlots[slotId];
    const nextId = after.armorSlots[slotId];
    if (prevId === nextId) continue;
    events.push(emit({ type: 'EquipmentChanged', characterId, slotId, itemId: nextId }));
  }
  return events;
}

// 兩條裝備入口（equipItem / configureWeaponSet）共用的合法性判定。回傳 rejection code，合法則 undefined。
//
// 原本兩邊各驗各的：configureWeaponSet 只驗 Owner，於是 homeStorage 裡的裝備可以直接穿上（繞過住宅取物與
// 攜帶重量），被 Quest 保留的物品也照收（違反「任務物不可裝備」）。Owner 是「誰的東西」，location 才是
// 「東西在哪」——兩者不能互相代替（複審 R10 #2）。
function equipLegalityRejection(
  inst: ItemInstance,
  characterId: CharacterId,
  deps: InventoryDeps,
): string | undefined {
  if (inst.state !== 'active') return 'inventory/item-not-active';
  if (inst.ownerCharacterId !== characterId) return 'inventory/not-owner';
  if (deps.reader.getItem(inst.definitionId).kind !== 'equipment') return 'inventory/not-equipment';
  // 只接受「這名角色背包裡」或「這名角色身上既有裝備」：homeStorage／商店／任務託管／清算託管／
  // 地圖內容都必須先經各自的取物流程搬進背包。
  const loc = inst.location;
  const carried =
    (loc.kind === 'characterBag' && loc.characterId === characterId) ||
    (loc.kind === 'equipped' && loc.characterId === characterId);
  if (!carried) return 'inventory/item-not-carried';
  // 任何 active reservation 都擋：任務目標物、製作素材、待轉移物都不得裝備。
  if (isReservedActive(inst)) return 'inventory/item-reserved';
  return undefined;
}

function sameCharacterSet(a: readonly CharacterId[], b: readonly CharacterId[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set<CharacterId>(a);
  for (const c of b) if (!sa.has(c)) return false;
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
  if (cmd.inputs.length === 0) return reject('inventory/empty-crafting-inputs');
  let owner: CharacterId | undefined;
  const seen = new Set<string>();
  for (const input of cmd.inputs) {
    const id = input.itemId;
    // 重複 ID 原本會被接受，同一實體被 bump 兩次 revision、發兩次事件，第二筆還會覆蓋第一筆的保留量。
    if (seen.has(String(id))) return reject('inventory/duplicate-crafting-input', { itemId: String(id) });
    seen.add(String(id));
    const inst = state.items[id];
    if (!inst) return reject('inventory/unknown-item', { itemId: String(id) });
    if (inst.state !== 'active') return reject('inventory/item-not-active', { itemId: String(id) });
    if (isReservedActive(inst)) return reject('inventory/already-reserved', { itemId: String(id) });
    if (inst.ownerCharacterId === undefined) return reject('inventory/crafting-input-unowned', { itemId: String(id) });
    // 位置防線（doc 05 §367 本就要求驗「位置」）：已裝備的劍原本可以直接當素材，等 Transform 實作後
    // 會消耗掉它卻在 Loadout 留下引用。素材只能來自背包或同一角色的住宅存放（複審 R10 #5）。
    const loc = inst.location;
    const usableAsMaterial =
      (loc.kind === 'characterBag' && loc.characterId === inst.ownerCharacterId) ||
      (loc.kind === 'homeStorage' && loc.characterId === inst.ownerCharacterId);
    if (!usableAsMaterial) {
      return reject('inventory/crafting-input-not-available', { itemId: String(id), location: loc.kind });
    }
    // 數量必須是正整數且不超過該實體持有量；原本一律整疊保留，3 瓶藥水只用 1 瓶也會全鎖。
    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      return reject('inventory/invalid-crafting-input-quantity', { itemId: String(id), quantity: input.quantity });
    }
    if (input.quantity > inst.quantity) {
      return reject('inventory/insufficient-crafting-input', {
        itemId: String(id),
        requested: input.quantity,
        available: inst.quantity,
      });
    }
    if (owner === undefined) owner = inst.ownerCharacterId;
    else if (owner !== inst.ownerCharacterId) return reject('inventory/crafting-input-owner-mismatch');
  }
  if (owner === undefined) return reject('inventory/empty-crafting-inputs');

  let items = state.items;
  const messages: DomainEventDraft<unknown>[] = [];
  for (const input of cmd.inputs) {
    const inst = items[input.itemId];
    if (!inst) return reject('inventory/unknown-item', { itemId: String(input.itemId) });
    const reservation: ItemReservation = {
      kind: 'craftingInput',
      ownerId: owner,
      reservedQuantity: input.quantity,
      // 完整的素材需求身分：哪一次製作、哪個配方、哪一格。消耗端（TransformCraftingItems，尚未實作）
      // 據此比對素材確實是為這次製作的這一格保留的。
      craftingAttemptId: cmd.craftingAttemptId,
      recipeId: cmd.recipeId,
      slotId: input.slotId,
    };
    const next: ItemInstance = { ...inst, reservation, revision: inst.revision + 1 };
    items = { ...items, [input.itemId]: next };
    messages.push(emit({ type: 'ItemReservationChanged', itemId: input.itemId, reservation }));
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
  // 若原本裝備中，同步從 Loadout 卸掉，否則 Loadout 仍把它當主手/裝甲（破壞 single-location）。
  const working = clearLoadoutRefIfEquipped(withItem(state, next), from, cmd.itemId);
  const events: DomainEventDraft<unknown>[] = [
    emit({ type: 'InventoryTransferred', itemId: cmd.itemId, from, to, oldOwner, newOwner: undefined, reason: 'moveToTeamQuestCargo' }),
  ];
  // 自動卸裝也必須發 EquipmentChanged，否則 character 能力上限、Combat Power、UI、快取都不知道裝備已卸下
  // （若該裝提供生命上限，角色可能暫時保留高於新上限的 HP）。itemId: undefined 表示該 slot 已清空。
  if (from.kind === 'equipped') {
    events.push(
      emit({ type: 'EquipmentChanged', characterId: from.characterId, slotId: from.slotId, weaponSetId: from.weaponSetId, itemId: undefined }),
    );
  }
  return accept(working, events);
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

// ── ConsumeCombatSequenceRetrySupply（Internal Command，來自 combat-sequence）─────
//
// 這是 combat-sequence「重骰資格成立 → 消耗一份補給 → 重骰」那條路的中段。它先前**沒有實作**，
// 於是 combat-sequence 送出的命令沒有任何 Owner——registry 的「送出端 → Owner」交叉驗證因此
// 在整合時報 `registry.internalCommand.noOwner`。
//
// 契約兩端本來就備齊了：命令（ConsumeCombatSequenceRetrySupply）與**收尾事件**
// （CombatSequenceRetrySupplyConsumed，combat-sequence 已註冊訂閱者）都在 contracts/inventory
// 裡。缺的只有中間這段消耗。補上它，整條路才閉合——不然這個能力只能整條關掉。
//
// 紀律要點：
//   * 「用哪一件補給」由 combat-sequence 依 `RetrySupplyPolicyDefinition` 選好（它負責挑最低價
//     等策略），這裡**不重做選擇**；命令帶 `itemTagId` 時只當成必須滿足的條件驗證。
//   * 找不到符合條件的補給是 typed rejection，不是「當作沒消耗然後照樣重骰」。
//   * 挑選候選時以 itemId 排序，讓同一份 State 永遠選到同一件（決定性重播）。
export function consumeCombatSequenceRetrySupply(
  state: InventoryState,
  cmd: ConsumeCombatSequenceRetrySupply,
  deps: InventoryDeps,
): InventoryHandlerResult {
  const candidates = Object.values(state.items)
    .filter((inst): inst is ItemInstance => inst !== undefined)
    .filter(
      (inst) =>
        inst.state === 'active' &&
        inst.quantity > 0 &&
        inst.ownerCharacterId === cmd.participantCharacterId &&
        inst.location.kind === 'characterBag' &&
        inst.location.characterId === cmd.participantCharacterId &&
        !isReservedActive(inst),
    )
    .filter((inst) => {
      if (cmd.itemTagId === undefined) return true;
      // 壞內容引用不得變成「這件不符合」而靜默跳過：讀不到定義是內容問題，讓它拋出來。
      return deps.reader.getItem(inst.definitionId).itemTagIds.includes(cmd.itemTagId);
    })
    // 決定性：同一份 State 必須永遠選到同一件補給。
    .sort((a, b) => (String(a.itemId) < String(b.itemId) ? -1 : 1));

  const chosen = candidates[0];
  if (chosen === undefined) {
    return reject('inventory/retry-supply-unavailable', {
      participantCharacterId: String(cmd.participantCharacterId),
      ...(cmd.itemTagId === undefined ? {} : { itemTagId: String(cmd.itemTagId) }),
    });
  }

  const remaining = chosen.quantity - 1;
  const next: ItemInstance =
    remaining <= 0
      ? {
          ...chosen,
          quantity: 0,
          state: 'consumed',
          location: { kind: 'removed', reason: 'consumed' },
          revision: chosen.revision + 1,
        }
      : { ...chosen, quantity: remaining, revision: chosen.revision + 1 };

  const messages: DomainEventDraft<unknown>[] = [
    emit({
      type: 'CombatSequenceRetrySupplyConsumed',
      sequenceId: cmd.sequenceId,
      challengeId: cmd.challengeId,
      itemId: chosen.itemId,
      // `ItemInstance.ownerCharacterId` 是選填的，事件的欄位不是。上面的篩選已要求
      // `inst.ownerCharacterId === cmd.participantCharacterId`，所以這裡取**命令帶的**那個值：
      // 它與 chosen 的擁有者是同一個，而且型別上非選填。不用轉型去騙過選填性。
      ownerCharacterId: cmd.participantCharacterId,
      quantity: 1,
    }),
    emit({ type: 'ItemConsumed', itemId: chosen.itemId, quantity: 1, reason: 'combatUse' }),
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
  // 與 configureWeaponSet 共用同一個合法性函式（見 equipLegalityRejection）。
  const bad = equipLegalityRejection(inst, cmd.characterId, deps);
  if (bad !== undefined) return reject(bad, { itemId: String(cmd.itemId) });
  const equip = deps.reader.getEquipment(inst.definitionId);
  // 目標手由**玩家指名的 slotId** 解析，而不是從 equipmentKind 猜：單手武器兩手皆為合法手（雙持），
  // 猜法表達不出「這把劍要放副手」。
  const handForSlot: EquipmentHand | undefined =
    equip.handSlots.mainHand === cmd.slotId
      ? 'mainHand'
      : equip.handSlots.offHand === cmd.slotId
        ? 'offHand'
        : undefined;
  // 合法位置（doc §2.3、§3.5 不變量 6）：鎧甲／飾品看 occupiedSlots，手持裝備看 handSlots。
  // 單手武器的 occupiedSlots 只有 [mainHandSlot]，光看它會擋掉合法的副手雙持。
  if (handForSlot === undefined && !equip.occupiedSlots.includes(cmd.slotId)) {
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

  const loadout = requireLoadout(state, cmd.characterId);
  if (loadout === undefined) return reject('inventory/loadout-not-initialized', { characterId: String(cmd.characterId) });
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

    // 目標手：雙手武器占滿主+副；其餘依玩家指名的 slot 解析出的 handForSlot。單手武器指名副手 slot 即
    // 雙持副手（GDD §511），不再一律塞主手。
    const previousMainIsTwoHanded =
      set.mainHandItemId !== undefined && set.offHandItemId === set.mainHandItemId;
    const goesOffHand = !isTwoHanded && handForSlot === 'offHand';

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
      // 頂掉原副手（若非同一件、且不是被雙手武器共用佔用的那一件）。
      if (set.offHandItemId !== undefined && set.offHandItemId !== cmd.itemId && set.offHandItemId !== set.mainHandItemId) {
        displaced.push(set.offHandItemId);
      }
      // 原主手是雙手武器 → 佔用副手，換上盾牌前必須把它卸下、清主手。
      if (previousMainIsTwoHanded && set.mainHandItemId !== undefined) {
        if (!displaced.includes(set.mainHandItemId)) displaced.push(set.mainHandItemId);
        nextMain = undefined;
      }
      // 同一件從主手改裝到副手：必須清掉主手引用，否則兩手指向同一實體而 ItemLocation 只能指一手
      //（複審 R10 #1）。
      if (nextMain === cmd.itemId) nextMain = undefined;
      nextOff = cmd.itemId;
    } else {
      if (set.mainHandItemId !== undefined && set.mainHandItemId !== cmd.itemId) displaced.push(set.mainHandItemId);
      if (previousMainIsTwoHanded) nextOff = undefined; // 原雙手武器對副手的佔用解除
      // 同一件從副手改裝到主手：同理清掉副手引用。
      if (nextOff === cmd.itemId) nextOff = undefined;
      nextMain = cmd.itemId;
    }

    const updated: WeaponSetLoadout = { ...set, mainHandItemId: nextMain, offHandItemId: nextOff };
    // 跨組唯一（single-location）：本次裝上的武器若被**其他**武器組引用，一併清掉——否則同一把武器會
    // 同時掛在多組，只有 ItemLocation 指向最後一組（configureWeaponSet 已修，equipItem 先前漏修）。
    const clearOther = (ws: WeaponSetLoadout): WeaponSetLoadout => {
      const m = ws.mainHandItemId === cmd.itemId ? undefined : ws.mainHandItemId;
      const o = ws.offHandItemId === cmd.itemId ? undefined : ws.offHandItemId;
      return m === ws.mainHandItemId && o === ws.offHandItemId ? ws : { ...ws, mainHandItemId: m, offHandItemId: o };
    };
    const ws0 = loadout.weaponSets;
    nextLoadout = {
      ...loadout,
      weaponSets: [
        idx === 0 ? updated : clearOther(ws0[0]),
        idx === 1 ? updated : clearOther(ws0[1]),
        idx === 2 ? updated : clearOther(ws0[2]),
      ],
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
    ...equipmentChangeEvents(cmd.characterId, loadout, nextLoadout, state.items, deps),
  );
  return accept(nextState, events);
}

// ── ConfigureWeaponSet（Player Command，doc §5.1、§3.4）──────────────────────
export function configureWeaponSet(
  state: InventoryState,
  cmd: ConfigureWeaponSet,
  deps: InventoryDeps,
): InventoryHandlerResult {
  const loadout = requireLoadout(state, cmd.characterId);
  if (loadout === undefined) return reject('inventory/loadout-not-initialized', { characterId: String(cmd.characterId) });
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
    // 與 equipItem 共用同一個合法性函式（位置、保留、Owner、種類），兩條入口不得再各驗各的。
    const bad = equipLegalityRejection(item, cmd.characterId, deps);
    if (bad !== undefined) return reject(bad, { hand, itemId: String(itemId) });
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
  // 反向：只有雙手武器可以兩手同一件。單手武器 main===off 會讓 Loadout 兩手都指向同一實體，但
  // ItemLocation 只能指向其中一手——雙持是**兩把**武器，不是一把佔兩次（複審 R10 #1）。
  if (
    cmd.mainHandItemId !== undefined &&
    cmd.mainHandItemId === cmd.offHandItemId &&
    !mainTwoHanded
  ) {
    return reject('inventory/one-handed-cannot-fill-both-hands', { itemId: String(cmd.mainHandItemId) });
  }
  // 手部位置合法性一律問裝備自己的 handSlots（見契約 EquipmentHandSlots）：單手武器兩手皆可（雙持），
  // 盾只有副手，鎧甲／飾品兩手皆無。不再用 equipmentKind 推導——R8 #1 那版把副手限定成盾，等於再次禁掉
  // GDD §511 的同組雙持（R5 #5 已修過一次）。
  if (mainEquip !== undefined && mainEquip.handSlots.mainHand === undefined) {
    return reject('inventory/illegal-hand', { hand: 'mainHand', kind: mainEquip.equipmentKind });
  }
  if (offEquip !== undefined && offEquip.handSlots.offHand === undefined) {
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
  // **去重**：雙手武器的 main===off，不去重會對同一實體跑兩次卸下迴圈，revision 白跳兩次（複審 R11 #3）。
  const displacedRaw = [prevSet.mainHandItemId, prevSet.offHandItemId].filter(
    (x): x is ItemInstanceId => x !== undefined && !newItemSet.has(String(x)),
  );
  const displaced = displacedRaw.filter((id, i) => displacedRaw.indexOf(id) === i);

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
  // 裝上的物品 → equipped，slotId 取**實際配置的那隻手**對應的 slot（不是定義的 occupiedSlots[0]）。
  // 同一把單手武器放主手或副手，location 必須分別落在主手／副手 slot，否則雙持兩把武器會同時宣稱占主手。
  // 雙手武器 main===off，去重後以主手為錨（其 occupiedSlots 本就同時涵蓋兩格）。
  for (const newId of newItemIds) {
    const inst = working.items[newId];
    if (inst === undefined) continue;
    const eq = deps.reader.getEquipment(inst.definitionId);
    const hand: EquipmentHand = newId === cmd.mainHandItemId ? 'mainHand' : 'offHand';
    const slotId = eq.handSlots[hand];
    if (slotId === undefined) return reject('inventory/illegal-hand', { hand, kind: eq.equipmentKind });
    const location: ItemLocation = {
      kind: 'equipped',
      characterId: cmd.characterId,
      slotId,
      weaponSetId: cmd.weaponSetId,
    };
    working = withItem(working, { ...inst, location, revision: inst.revision + 1 });
  }

  const skillIds = cmd.selectedSkillIds.filter((x): x is NonNullable<typeof x> => x !== undefined);
  return accept(working, [
    emit({ type: 'WeaponSetConfigured', characterId: cmd.characterId, weaponSetId: cmd.weaponSetId, itemIds: newItemIds, skillIds }),
    // 整份 Loadout 差異比對：本組、被清空的其他組、以及任何位置變動一律涵蓋（見 equipmentChangeEvents）。
    ...equipmentChangeEvents(cmd.characterId, loadout, nextLoadout, state.items, deps),
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
    delete nextResolutions[existing.resolutionId];
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
// **單一**建立入口：建立角色初始 Loadout（三個空武器組），ID 由核心產生器（nextWeaponSetId）鑄。正式的
// 角色建立流程（角色誕生）應呼叫此函式，使 Loadout 在任何 equip/config 或 Query 之前就存在。這樣 Query 與
// Handler 讀到**同一份真實 ID**——不再各自偽造（Query 曾以 `${char}:ws0` 偽造、Handler 另配核心 ID → UI
// 拿到的 ID 送出即 unknown-weapon-set 的 split-brain）。
export function createInitialLoadout(
  characterId: CharacterId,
  nextWeaponSetId: () => WeaponSetId,
): CharacterEquipmentLoadout {
  const ws = (): WeaponSetLoadout => ({
    weaponSetId: nextWeaponSetId(),
    selectedSkillIds: [undefined, undefined, undefined],
  });
  return {
    characterId,
    armorSlots: {} as Readonly<Record<EquipmentSlotId, ItemInstanceId | undefined>>,
    weaponSets: [ws(), ws(), ws()],
    revision: 0,
  };
}

// 讀取已存在的 Loadout；不存在回 undefined（呼叫端以 loadout-not-initialized 拒絕）。**不惰性建立**——否則
// Handler 會鑄出與 Query 不同的 ID（split-brain）。Loadout 由 createInitialLoadout 於角色建立時預先鑄好。
function requireLoadout(
  state: InventoryState,
  characterId: CharacterId,
): CharacterEquipmentLoadout | undefined {
  return state.equipmentLoadouts[characterId];
}

// 從 Loadout 卸掉某物品的所有引用（各武器組主/副手 + 各裝甲格）。當一件**裝備中**物品被移到別處
// （任務貨物、轉移、移除…）時呼叫，避免 Loadout 懸空指向已離開 equipped 位置的物品（破壞 single-location）。
function clearItemFromLoadout(
  loadout: CharacterEquipmentLoadout,
  itemId: ItemInstanceId,
): CharacterEquipmentLoadout {
  const clear = (ws: WeaponSetLoadout): WeaponSetLoadout => {
    const m = ws.mainHandItemId === itemId ? undefined : ws.mainHandItemId;
    const o = ws.offHandItemId === itemId ? undefined : ws.offHandItemId;
    return m === ws.mainHandItemId && o === ws.offHandItemId ? ws : { ...ws, mainHandItemId: m, offHandItemId: o };
  };
  const s = loadout.weaponSets;
  const weaponSets: readonly [WeaponSetLoadout, WeaponSetLoadout, WeaponSetLoadout] = [
    clear(s[0]),
    clear(s[1]),
    clear(s[2]),
  ];
  const armorSlots: Record<EquipmentSlotId, ItemInstanceId | undefined> = { ...loadout.armorSlots };
  let armorChanged = false;
  for (const key of Object.keys(armorSlots) as EquipmentSlotId[]) {
    if (armorSlots[key] === itemId) {
      armorSlots[key] = undefined;
      armorChanged = true;
    }
  }
  const weaponChanged = weaponSets.some((ws, i) => ws !== loadout.weaponSets[i]);
  if (!weaponChanged && !armorChanged) return loadout;
  return { ...loadout, weaponSets, armorSlots, revision: loadout.revision + 1 };
}

// 若物品原本在某角色的 equipped 位置，回傳同步卸下該引用後的 State；否則原樣回傳。移出 equipped 的各路徑
// （任務貨物、轉移、移除）共用，確保 Loadout 與 ItemLocation 一致。
function clearLoadoutRefIfEquipped(
  state: InventoryState,
  from: ItemLocation,
  itemId: ItemInstanceId,
): InventoryState {
  if (from.kind !== 'equipped') return state;
  const loadout = state.equipmentLoadouts[from.characterId];
  if (loadout === undefined) return state;
  return {
    ...state,
    equipmentLoadouts: {
      ...state.equipmentLoadouts,
      [from.characterId]: clearItemFromLoadout(loadout, itemId),
    },
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
