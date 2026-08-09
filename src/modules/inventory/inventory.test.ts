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
  type InventoryHandlerResult,
} from './system';
import { createFixtureDeps, createFixtureReader, createFixtureState, FIXTURE } from './fixtures';
import type { InventoryState } from './state';

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
      // exactly one new item added
      assert(Object.keys(next.items).length === 3, 'create: item count 3');
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
        equipItem(createFixtureState(), { type: 'equipItem', characterId: FIXTURE.characterId, itemId: FIXTURE.swordItemId, slotId: FIXTURE.mainHandSlot }, deps),
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
      const r = equipItem(createFixtureState(), { type: 'equipItem', characterId: FIXTURE.characterId, itemId: FIXTURE.swordItemId, slotId: FIXTURE.mainHandSlot }, deps);
      const next = expectOk(r, 'equip');
      const q = createInventoryQuery(next, deps.reader);
      const eq = q.getEquippedItem(FIXTURE.characterId, FIXTURE.mainHandSlot);
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
