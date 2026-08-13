// modules/inventory/inventory.test.ts
// 自足式（無外部測試框架、無 node/DOM 全域）Inventory 單元測試。
// runTests() 於任一案例失敗時 throw；runTestResults() 回傳逐案 pass/fail 供 harness。

import type {
  CombatItemUseCommitted,
  CreateItemInstance,
  EncumbranceResolutionOpened,
  InventoryTransferred,
  ItemRemoved,
  TransferItem,
} from '../../contracts/inventory';
import type { CharacterId, ItemInstanceId, WeaponSetId, WorldDay } from '../../contracts/core';
import { createInventoryQuery } from './queries';
import {
  commitCombatItemUse,
  createItemInstance,
  equipItem,
  evaluateTeamEncumbrance,
  removeItemInstance,
  reserveCraftingInputs,
  reserveQuestItem,
  transferItem,
  configureWeaponSet,
  type InventoryHandlerResult,
} from './system';
import { createFixtureDeps, createFixtureReader, createFixtureState, FIXTURE } from './fixtures';
import type { InventoryState } from './state';

// 預設武器組 0（getOrCreateLoadout 以 `${characterId}:ws{i}` 命名）。
const WS0 = `${FIXTURE.characterId}:ws0` as WeaponSetId;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectOk(r: InventoryHandlerResult, label: string): InventoryState {
  if (!r.ok) throw new Error(`${label}: expected accept, got reject ${r.rejection.code}`);
  return r.result.nextSlice;
}

function expectReject(r: InventoryHandlerResult, code: string, label: string): void {
  if (r.ok) throw new Error(`${label}: expected reject '${code}', got accept`);
  assert(r.rejection.code === code, `${label}: expected code '${code}', got '${r.rejection.code}'`);
}

function eventsOf(r: InventoryHandlerResult): readonly unknown[] {
  if (!r.ok) return [];
  return r.result.outgoingMessages.map((m) => (m as { event: unknown }).event);
}

type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: 'createItemInstance: creates active item + emits ItemInstanceCreated',
    run: () => {
      const deps = createFixtureDeps();
      const cmd: CreateItemInstance = { type: 'CreateItemInstance',
        definitionId: FIXTURE.paperDefId,
        quantity: 1,
        location: { kind: 'characterBag', characterId: FIXTURE.characterId },
        ownerCharacterId: FIXTURE.characterId,
        reason: 'test-create',
      };
      const r = createItemInstance(createFixtureState(), cmd, deps);
      const next = expectOk(r, 'create');
      const query = createInventoryQuery(next, deps.reader);
      // 恰好新增一件（相對 fixture 起始件數，避免硬編數字隨 fixture 增減而脆裂）。
      assert(
        Object.keys(next.items).length === Object.keys(createFixtureState().items).length + 1,
        'create: exactly one item added',
      );
      const evts = eventsOf(r);
      assert(evts.length === 1, 'create: one event');
      const created = evts[0] as { location: { kind: string } };
      assert(created.location.kind === 'characterBag', 'create: event location bag');
      void query;
    },
  },
  {
    name: 'createItemInstance: single-stack quantity>1 rejected',
    run: () => {
      const deps = createFixtureDeps();
      const cmd: CreateItemInstance = { type: 'CreateItemInstance',
        definitionId: FIXTURE.swordDefId, // single
        quantity: 2,
        location: { kind: 'mapContent', contentId: 'runtime:content-instance:x' as never },
        reason: 'bad',
      };
      expectReject(createItemInstance(createFixtureState(), cmd, deps), 'inventory/single-stack-quantity', 'single-stack');
    },
  },
  {
    name: 'transferItem: reassigns owner + location, emits InventoryTransferred',
    run: () => {
      const deps = createFixtureDeps();
      const cmd: TransferItem = { type: 'TransferItem',
        itemId: FIXTURE.swordItemId,
        to: { kind: 'characterBag', characterId: FIXTURE.otherCharacterId },
        newOwnerCharacterId: FIXTURE.otherCharacterId,
        reason: 'gift',
      };
      const r = transferItem(createFixtureState(), cmd, deps);
      const next = expectOk(r, 'transfer');
      const q = createInventoryQuery(next, deps.reader);
      assert(q.getOwningCharacter(FIXTURE.swordItemId) === FIXTURE.otherCharacterId, 'transfer: new owner');
      const loc = q.getLocation(FIXTURE.swordItemId);
      assert(loc?.kind === 'characterBag', 'transfer: location bag');
      const evt = eventsOf(r)[0] as InventoryTransferred;
      assert(evt.oldOwner === FIXTURE.characterId && evt.newOwner === FIXTURE.otherCharacterId, 'transfer: event owners');
      assert(q.getItem(FIXTURE.swordItemId)?.revision === 1, 'transfer: revision bumped');
    },
  },
  {
    name: 'transferItem: unknown item rejected',
    run: () => {
      const deps = createFixtureDeps();
      const cmd: TransferItem = { type: 'TransferItem',
        itemId: 'runtime:item-instance:nope' as ItemInstanceId,
        to: { kind: 'cityPermanentStock', cityId: 'definition:city:a' as never },
        reason: 'x',
      };
      expectReject(transferItem(createFixtureState(), cmd, deps), 'inventory/unknown-item', 'transfer-unknown');
    },
  },
  {
    name: 'reserveQuestItem: reserves, then transfer of reserved item rejected',
    run: () => {
      const deps = createFixtureDeps();
      const reserved = expectOk(
        reserveQuestItem(createFixtureState(), { type: 'ReserveQuestItem', itemId: FIXTURE.swordItemId, questId: 'runtime:quest:q1' as never }, deps),
        'reserve',
      );
      const q = createInventoryQuery(reserved, deps.reader);
      assert(q.isReserved(FIXTURE.swordItemId), 'reserve: isReserved true');
      const tr = transferItem(
        reserved,
        { type: 'TransferItem', itemId: FIXTURE.swordItemId, to: { kind: 'characterBag', characterId: FIXTURE.otherCharacterId }, newOwnerCharacterId: FIXTURE.otherCharacterId, reason: 'x' },
        deps,
      );
      expectReject(tr, 'inventory/item-reserved', 'reserve-then-transfer');
    },
  },
  {
    name: 'reserveCraftingInputs: atomic — one bad id rejects all, state unchanged',
    run: () => {
      const deps = createFixtureDeps();
      const state = createFixtureState();
      const bad = reserveCraftingInputs(
        state,
        { type: 'ReserveCraftingInputs', craftingAttemptId: 'runtime:crafting-attempt:c1' as never, itemIds: [FIXTURE.swordItemId, 'runtime:item-instance:ghost' as ItemInstanceId] },
        deps,
      );
      expectReject(bad, 'inventory/unknown-item', 'craft-atomic-reject');
      // sword must remain unreserved (handler is pure; original state untouched)
      const q = createInventoryQuery(state, deps.reader);
      assert(!q.isReserved(FIXTURE.swordItemId), 'craft-atomic: sword still unreserved');
      // valid set reserves all
      const good = expectOk(
        reserveCraftingInputs(state, { type: 'ReserveCraftingInputs', craftingAttemptId: 'runtime:crafting-attempt:c1' as never, itemIds: [FIXTURE.swordItemId, FIXTURE.potionItemId] }, deps),
        'craft-good',
      );
      const q2 = createInventoryQuery(good, deps.reader);
      assert(q2.isReserved(FIXTURE.swordItemId) && q2.isReserved(FIXTURE.potionItemId), 'craft-good: both reserved');
    },
  },
  {
    name: 'removeItemInstance: marks removed + emits ItemRemoved',
    run: () => {
      const deps = createFixtureDeps();
      const r = removeItemInstance(createFixtureState(), { type: 'RemoveItemInstance', itemId: FIXTURE.potionItemId, reason: 'consumed' }, deps);
      const next = expectOk(r, 'remove');
      const q = createInventoryQuery(next, deps.reader);
      assert(q.getItem(FIXTURE.potionItemId)?.state === 'removed', 'remove: state removed');
      assert(q.getLocation(FIXTURE.potionItemId)?.kind === 'removed', 'remove: location removed');
      const evt = eventsOf(r)[0] as ItemRemoved;
      assert(evt.previousLocation.kind === 'characterBag', 'remove: prev location bag');
    },
  },
  {
    name: 'removeItemInstance: equipped item rejected',
    run: () => {
      const deps = createFixtureDeps();
      // equip sword first
      const equipped = expectOk(
        equipItem(createFixtureState(), { type: 'equipItem', characterId: FIXTURE.characterId, itemId: FIXTURE.swordItemId, slotId: FIXTURE.mainHandSlot, weaponSetId: WS0 }, deps),
        'equip-for-remove',
      );
      expectReject(
        removeItemInstance(equipped, { type: 'RemoveItemInstance', itemId: FIXTURE.swordItemId, reason: 'other' }, deps),
        'inventory/item-equipped',
        'remove-equipped',
      );
    },
  },
  {
    name: 'commitCombatItemUse: decrements stack, passes delay rule from definition (no self-calc)',
    run: () => {
      const deps = createFixtureDeps();
      const r = commitCombatItemUse(createFixtureState(), { type: 'CommitCombatItemUse', itemId: FIXTURE.potionItemId, userId: FIXTURE.characterId }, deps);
      const next = expectOk(r, 'combat-use');
      const q = createInventoryQuery(next, deps.reader);
      assert(q.getItem(FIXTURE.potionItemId)?.quantity === 2, 'combat-use: qty 3→2');
      const evts = eventsOf(r);
      const committed = evts.find((e) => (e as CombatItemUseCommitted).useDelayRuleId !== undefined) as CombatItemUseCommitted;
      assert(committed !== undefined, 'combat-use: committed event present');
      // Inventory reads the delay-rule id from the Definition; does not compute a delay number.
      assert(String(committed.useDelayRuleId).includes('use-delay-rule:potion'), 'combat-use: delay rule id from definition');
      assert(committed.effectRefs.length === 1, 'combat-use: effect refs from definition');
    },
  },
  {
    name: 'commitCombatItemUse: non-combat item rejected',
    run: () => {
      const deps = createFixtureDeps();
      expectReject(
        commitCombatItemUse(createFixtureState(), { type: 'CommitCombatItemUse', itemId: FIXTURE.swordItemId, userId: FIXTURE.characterId }, deps),
        'inventory/not-combat-consumable',
        'combat-use-sword',
      );
    },
  },
  {
    name: 'equipItem: moves item to equipped + getEquippedItem reflects it',
    run: () => {
      const deps = createFixtureDeps();
      const r = equipItem(createFixtureState(), { type: 'equipItem', characterId: FIXTURE.characterId, itemId: FIXTURE.swordItemId, slotId: FIXTURE.mainHandSlot, weaponSetId: WS0 }, deps);
      const next = expectOk(r, 'equip');
      const q = createInventoryQuery(next, deps.reader);
      // 手部裝備屬於武器組，查詢必須帶 weaponSetId（location 也記著它）。
      const eq = q.getEquippedItem(FIXTURE.characterId, FIXTURE.mainHandSlot, WS0);
      assert(eq?.itemId === FIXTURE.swordItemId, 'equip: equipped item present');
      assert(q.getLocation(FIXTURE.swordItemId)?.kind === 'equipped', 'equip: location equipped');
    },
  },
  {
    name: 'equipItem: illegal slot (not in occupiedSlots) rejected',
    run: () => {
      const deps = createFixtureDeps();
      expectReject(
        equipItem(createFixtureState(), { type: 'equipItem', characterId: FIXTURE.characterId, itemId: FIXTURE.swordItemId, slotId: FIXTURE.bodySlot }, deps),
        'inventory/illegal-slot',
        'equip-illegal',
      );
    },
  },
  {
    name: 'evaluateTeamEncumbrance: overweight while stationary → awaitingPlayer + Opened',
    run: () => {
      // Tight capacity so hero (sword 30 + potion 6 = 36) is overweight.
      const deps = createFixtureDeps({ getCarryCapacity: (characterId) => ({ characterId, maximumWeight: 1, sourceRevisionKey: 'tight' }) });
      const r = evaluateTeamEncumbrance(createFixtureState(), { type: 'EvaluateTeamEncumbrance', teamId: FIXTURE.teamId }, deps);
      const next = expectOk(r, 'enc-open');
      const q = createInventoryQuery(next, deps.reader);
      const res = q.getEncumbranceResolution(FIXTURE.teamId);
      assert(res?.state === 'awaitingPlayer', 'enc: awaitingPlayer');
      assert(res?.overweightCharacterIds.includes(FIXTURE.characterId) === true, 'enc: hero listed');
      const evt = eventsOf(r)[0] as EncumbranceResolutionOpened;
      assert(evt.state === 'awaitingPlayer', 'enc: Opened event state');
    },
  },
  {
    name: 'evaluateTeamEncumbrance: is idempotent (second eval yields no messages, same resolution)',
    run: () => {
      const deps = createFixtureDeps({ getCarryCapacity: (characterId) => ({ characterId, maximumWeight: 1, sourceRevisionKey: 'tight' }) });
      const first = expectOk(evaluateTeamEncumbrance(createFixtureState(), { type: 'EvaluateTeamEncumbrance', teamId: FIXTURE.teamId }, deps), 'enc-1');
      const firstId = createInventoryQuery(first, deps.reader).getEncumbranceResolution(FIXTURE.teamId)?.resolutionId;
      const r2 = evaluateTeamEncumbrance(first, { type: 'EvaluateTeamEncumbrance', teamId: FIXTURE.teamId }, deps);
      const second = expectOk(r2, 'enc-2');
      assert(eventsOf(r2).length === 0, 'enc-idempotent: no messages on repeat');
      const secondId = createInventoryQuery(second, deps.reader).getEncumbranceResolution(FIXTURE.teamId)?.resolutionId;
      assert(firstId === secondId, 'enc-idempotent: same resolution id (no new mint)');
    },
  },
  {
    name: 'evaluateTeamEncumbrance: travelling defers, arrival transitions to awaitingPlayer',
    run: () => {
      let travelling = true;
      const deps = createFixtureDeps({
        getCarryCapacity: (characterId) => ({ characterId, maximumWeight: 1, sourceRevisionKey: 'tight' }),
        isTeamTravelling: () => travelling,
      });
      const deferred = expectOk(evaluateTeamEncumbrance(createFixtureState(), { type: 'EvaluateTeamEncumbrance', teamId: FIXTURE.teamId }, deps), 'enc-travel');
      assert(
        createInventoryQuery(deferred, deps.reader).getEncumbranceResolution(FIXTURE.teamId)?.state === 'deferredDuringTravel',
        'enc-travel: deferred while travelling',
      );
      // Arrive: workflow re-sends EvaluateTeamEncumbrance; still overweight → awaitingPlayer.
      travelling = false;
      const arrived = expectOk(evaluateTeamEncumbrance(deferred, { type: 'EvaluateTeamEncumbrance', teamId: FIXTURE.teamId }, deps), 'enc-arrive');
      assert(
        createInventoryQuery(arrived, deps.reader).getEncumbranceResolution(FIXTURE.teamId)?.state === 'awaitingPlayer',
        'enc-arrive: awaitingPlayer after arrival',
      );
    },
  },
  {
    name: 'evaluateTeamEncumbrance: not overweight closes existing resolution',
    run: () => {
      const tight = createFixtureDeps({ getCarryCapacity: (characterId) => ({ characterId, maximumWeight: 1, sourceRevisionKey: 'tight' }) });
      const opened = expectOk(evaluateTeamEncumbrance(createFixtureState(), { type: 'EvaluateTeamEncumbrance', teamId: FIXTURE.teamId }, tight), 'enc-open2');
      assert(createInventoryQuery(opened, tight.reader).getEncumbranceResolution(FIXTURE.teamId) !== undefined, 'enc-close: opened first');
      // Now generous capacity → close.
      const roomy = createFixtureDeps();
      const r = evaluateTeamEncumbrance(opened, { type: 'EvaluateTeamEncumbrance', teamId: FIXTURE.teamId }, roomy);
      const closed = expectOk(r, 'enc-close');
      assert(createInventoryQuery(closed, roomy.reader).getEncumbranceResolution(FIXTURE.teamId) === undefined, 'enc-close: resolution removed');
      assert(eventsOf(r).length === 1, 'enc-close: Closed event emitted');
    },
  },
  {
    // 迴歸：已裝備的物品不得被 TransferItem 直接搬走——裝備欄會留著舊 itemId，
    // 造成「物品在別處、裝備欄仍指著它」的永久不一致。
    name: 'transferItem: 已裝備物品被拒絕（不得繞過卸下）',
    run: () => {
      const deps = createFixtureDeps();
      const equipped = expectOk(
        equipItem(
          createFixtureState(),
          { type: 'equipItem', characterId: FIXTURE.characterId, itemId: FIXTURE.swordItemId, slotId: FIXTURE.mainHandSlot, weaponSetId: WS0 },
          deps,
        ),
        'equip',
      );
      expectReject(
        transferItem(
          equipped,
          { type: 'TransferItem', itemId: FIXTURE.swordItemId, to: { kind: 'characterBag', characterId: FIXTURE.characterId }, reason: 'test' },
          deps,
        ),
        'inventory/item-equipped',
        'transfer equipped',
      );
    },
  },
  {
    // 迴歸：裝上新物品必須把原槽位物品卸回背包。
    name: 'equipItem: 頂替時把原槽位物品卸回背包',
    run: () => {
      const deps = createFixtureDeps();
      const s1 = expectOk(
        equipItem(
          createFixtureState(),
          { type: 'equipItem', characterId: FIXTURE.characterId, itemId: FIXTURE.swordItemId, slotId: FIXTURE.mainHandSlot, weaponSetId: WS0 },
          deps,
        ),
        'equip sword',
      );
      assert(s1.items[FIXTURE.swordItemId]!.location.kind === 'equipped', '劍應為 equipped');

      const s2 = expectOk(
        equipItem(
          s1,
          { type: 'equipItem', characterId: FIXTURE.characterId, itemId: FIXTURE.greatswordItemId, slotId: FIXTURE.mainHandSlot, weaponSetId: WS0 },
          deps,
        ),
        'equip greatsword',
      );
      const sword = s2.items[FIXTURE.swordItemId]!;
      assert(
        sword.location.kind === 'characterBag',
        `舊主手物品應被卸回背包，實得 ${sword.location.kind}`,
      );
      assert(s2.items[FIXTURE.greatswordItemId]!.location.kind === 'equipped', '雙手劍應為 equipped');
      // 雙手武器同時占用主／副手（doc §282）。
      const set = s2.equipmentLoadouts[FIXTURE.characterId]!.weaponSets[0]!;
      assert(set.mainHandItemId === FIXTURE.greatswordItemId, '主手應為雙手劍');
      assert(set.offHandItemId === FIXTURE.greatswordItemId, '雙手武器應同時占用副手');
    },
  },
  {
    name: 'equipItem: 盾裝副手 → 寫進 offHandItemId（不再誤入 mainHand）',
    run: () => {
      const deps = createFixtureDeps();
      const s = expectOk(
        equipItem(
          createFixtureState(),
          { type: 'equipItem', characterId: FIXTURE.characterId, itemId: FIXTURE.shieldItemId, slotId: FIXTURE.offHandSlot, weaponSetId: WS0 },
          deps,
        ),
        'equip shield',
      );
      const set = s.equipmentLoadouts[FIXTURE.characterId]!.weaponSets[0]!;
      assert(set.offHandItemId === FIXTURE.shieldItemId, '盾應在副手');
      assert(set.mainHandItemId === undefined, '盾不應寫進主手');
    },
  },
  {
    name: 'equipItem: 頂替多格甲時清空其全部 slot（不殘留 head）',
    run: () => {
      const deps = createFixtureDeps();
      // 先穿多格袍（body + head）。
      const s1 = expectOk(
        equipItem(
          createFixtureState(),
          { type: 'equipItem', characterId: FIXTURE.characterId, itemId: FIXTURE.robeItemId, slotId: FIXTURE.bodySlot },
          deps,
        ),
        'equip robe',
      );
      const armor1 = s1.equipmentLoadouts[FIXTURE.characterId]!.armorSlots;
      assert(
        armor1[FIXTURE.bodySlot] === FIXTURE.robeItemId && armor1[FIXTURE.headSlot] === FIXTURE.robeItemId,
        '袍應同時占 body + head',
      );
      // 再穿單格胸甲（body）→ 頂掉袍；袍的 head slot 也應清空（不殘留）。
      const s2 = expectOk(
        equipItem(
          s1,
          { type: 'equipItem', characterId: FIXTURE.characterId, itemId: FIXTURE.chestItemId, slotId: FIXTURE.bodySlot },
          deps,
        ),
        'equip chest',
      );
      const armor2 = s2.equipmentLoadouts[FIXTURE.characterId]!.armorSlots;
      assert(armor2[FIXTURE.bodySlot] === FIXTURE.chestItemId, 'body 應為胸甲');
      assert(armor2[FIXTURE.headSlot] === undefined, '袍被頂掉後 head slot 不應殘留');
      assert(s2.items[FIXTURE.robeItemId]!.location.kind === 'characterBag', '袍應卸回背包');
    },
  },
  {
    name: 'configureWeaponSet: 拒絕不存在／非本人持有的物品',
    run: () => {
      const deps = createFixtureDeps();
      const state = createFixtureState();
      const weaponSetId = WS0;
      expectReject(
        configureWeaponSet(
          state,
          { type: 'configureWeaponSet', characterId: FIXTURE.characterId, weaponSetId, mainHandItemId: 'runtime:item-instance:ghost' as ItemInstanceId, selectedSkillIds: [undefined, undefined, undefined] },
          deps,
        ),
        'inventory/unknown-item',
        'ghost item',
      );
      expectReject(
        configureWeaponSet(
          state,
          { type: 'configureWeaponSet', characterId: 'runtime:character:other' as CharacterId, weaponSetId, mainHandItemId: FIXTURE.swordItemId, selectedSkillIds: [undefined, undefined, undefined] },
          deps,
        ),
        'inventory/unknown-weapon-set',
        'other character weapon set',
      );
    },
  },
  {
    name: 'configureWeaponSet: 雙手武器不得只占一手',
    run: () => {
      const deps = createFixtureDeps();
      const weaponSetId = WS0;
      expectReject(
        configureWeaponSet(
          createFixtureState(),
          { type: 'configureWeaponSet', characterId: FIXTURE.characterId, weaponSetId, mainHandItemId: FIXTURE.greatswordItemId, offHandItemId: FIXTURE.swordItemId, selectedSkillIds: [undefined, undefined, undefined] },
          deps,
        ),
        'inventory/two-handed-must-occupy-both-hands',
        'two-handed with different off-hand',
      );
    },
  },
  {
    name: 'configureWeaponSet: 盾牌不得放主手（手部位置合法性）',
    run: () => {
      const deps = createFixtureDeps();
      expectReject(
        configureWeaponSet(
          createFixtureState(),
          { type: 'configureWeaponSet', characterId: FIXTURE.characterId, weaponSetId: WS0, mainHandItemId: FIXTURE.shieldItemId, selectedSkillIds: [undefined, undefined, undefined] },
          deps,
        ),
        'inventory/illegal-hand',
        'shield in main hand',
      );
    },
  },
  {
    name: 'configureWeaponSet: 單手劍不得放副手（副手只收盾）',
    run: () => {
      const deps = createFixtureDeps();
      expectReject(
        configureWeaponSet(
          createFixtureState(),
          { type: 'configureWeaponSet', characterId: FIXTURE.characterId, weaponSetId: WS0, offHandItemId: FIXTURE.swordItemId, selectedSkillIds: [undefined, undefined, undefined] },
          deps,
        ),
        'inventory/illegal-hand',
        'sword in off hand',
      );
    },
  },
  {
    name: 'configureWeaponSet: 合法配置同步 ItemLocation（劍→主手、盾→副手皆 equipped，不留在背包）',
    run: () => {
      const deps = createFixtureDeps();
      const r = configureWeaponSet(
        createFixtureState(),
        { type: 'configureWeaponSet', characterId: FIXTURE.characterId, weaponSetId: WS0, mainHandItemId: FIXTURE.swordItemId, offHandItemId: FIXTURE.shieldItemId, selectedSkillIds: [undefined, undefined, undefined] },
        deps,
      );
      const next = expectOk(r, 'configure');
      const q = createInventoryQuery(next, deps.reader);
      const swordLoc = q.getLocation(FIXTURE.swordItemId);
      const shieldLoc = q.getLocation(FIXTURE.shieldItemId);
      assert(swordLoc?.kind === 'equipped', '劍 location 應 equipped');
      assert(shieldLoc?.kind === 'equipped', '盾 location 應 equipped（不得仍在背包）');
      assert(
        swordLoc?.kind === 'equipped' && swordLoc.weaponSetId === WS0,
        '劍 equipped location 應帶 WS0',
      );
    },
  },
  {
    name: 'configureWeaponSet: 同一件武器改配到另一組 → 從原組移除（single-location 不變量）',
    run: () => {
      const deps = createFixtureDeps();
      const WS1 = `${FIXTURE.characterId}:ws1` as WeaponSetId;
      const s1 = expectOk(
        configureWeaponSet(createFixtureState(), { type: 'configureWeaponSet', characterId: FIXTURE.characterId, weaponSetId: WS0, mainHandItemId: FIXTURE.swordItemId, selectedSkillIds: [undefined, undefined, undefined] }, deps),
        'ws0',
      );
      const s2 = expectOk(
        configureWeaponSet(s1, { type: 'configureWeaponSet', characterId: FIXTURE.characterId, weaponSetId: WS1, mainHandItemId: FIXTURE.swordItemId, selectedSkillIds: [undefined, undefined, undefined] }, deps),
        'ws1',
      );
      const loadout = s2.equipmentLoadouts[FIXTURE.characterId]!;
      const ws0 = loadout.weaponSets.find((w) => w.weaponSetId === WS0)!;
      const ws1 = loadout.weaponSets.find((w) => w.weaponSetId === WS1)!;
      assert(ws0.mainHandItemId === undefined, '原組 WS0 不應再引用該武器（否則一件同時在兩組）');
      assert(ws1.mainHandItemId === FIXTURE.swordItemId, '新組 WS1 應引用該武器');
      const loc = createInventoryQuery(s2, deps.reader).getLocation(FIXTURE.swordItemId);
      assert(loc?.kind === 'equipped' && loc.weaponSetId === WS1, '武器 location 應指向 WS1');
    },
  },
];

export type InventoryTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestResults(): readonly InventoryTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return { name: c.name, passed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

// 任一案例失敗即 throw（供最外層 harness 直接判定）。
export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const detail = failed.map((f) => ` - ${f.name}: ${f.error ?? 'unknown'}`).join('\n');
    throw new Error(`Inventory tests failed (${failed.length}/${results.length}):\n${detail}`);
  }
}

// 未使用型別匯入的靜態參照（避免 isolatedModules 下 unused 警告不影響型別檢查）。
export type _UnusedRefs = readonly [CharacterId, WeaponSetId, WorldDay];
