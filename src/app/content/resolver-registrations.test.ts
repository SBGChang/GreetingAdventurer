// app/content/resolver-registrations.test.ts
// Resolver 綁定 spine 的端到端測試。runTests() 逐案執行，任一失敗即 throw。
//
// 證兩件事：
//   1. 機制：createProductionResolverRegistry 依 binding.shape 查表註冊，resolve 走到正確的形狀實作；
//      未知 shape／重複 resolverId 明確拋錯。
//   2. 真實資料路徑：作者在 content-source 宣告的綁定，真的一路走到 content/**/pack.json → 載入器
//      匯總 → registry，且每筆綁定的 shape 在 src/ 都有實作（組裝不拋）。這條龍打通，才算「Resolver
//      ID 住內容、src/ 只認 shape」不是紙上設計。

import { resolve } from 'node:path';

import type { CharacterId, CombatantId, DefinitionId, ResolverBinding, ResolverId, ModuleId, TeamId } from '../../contracts/core';
import type { GridCell } from '../../contracts/map';
import type { CombatSkillTargetInput } from '../../modules/combat/system';
import { makeEncounter } from '../../modules/combat/fixtures';
import { loadContentFromDisk } from '../../platform/content-repository';
import { createProductionResolverRegistry } from './resolver-registrations';
import { resolverContext } from './resolver-adapter';

const CONTENT_ROOT = resolve(import.meta.dirname, '../../../content');
const COMBAT = 'combat' as ModuleId;
const TEAM = 'team' as ModuleId;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function eq(actual: readonly CombatantId[], expected: readonly string[], msg: string): void {
  const a = actual.map((x) => String(x)).join(',');
  assert(a === expected.join(','), `${msg}：預期 [${expected.join(',')}]，實際 [${a}]`);
}
function throws(fn: () => unknown, msg: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, msg);
}

// 一名玩家 p1(1,1) 對兩隻敵 e1(1,1) e2(1,2)——足以驗 single-hostile / whole-party。
function encounter() {
  return makeEncounter([
    { combatantId: 'p1', side: 'player', row: 1, col: 1 },
    { combatantId: 'p2', side: 'player', row: 1, col: 2 },
    { combatantId: 'e1', side: 'enemy', row: 1, col: 1 },
    { combatantId: 'e2', side: 'enemy', row: 1, col: 2 },
  ]);
}

function resolveTargets(
  registry: ReturnType<typeof createProductionResolverRegistry>,
  resolverId: ResolverId,
  requested: readonly CombatantId[],
): readonly CombatantId[] {
  const input: CombatSkillTargetInput = {
    resolverId,
    encounter: encounter(),
    actorId: 'p1' as CombatantId,
    requestedTargetIds: requested,
  };
  const out = registry.require(resolverId).resolve(input, resolverContext({}));
  return out.value as readonly CombatantId[];
}

type Case = readonly [name: string, run: () => void];

const cases: readonly Case[] = [
  // 機制：hand-made binding → 註冊 → resolve 走到 single-hostile 實作。
  ['機制：binding.shape 查表註冊並解析', () => {
    const rid = 'resolver:combat.target-single-hostile' as ResolverId;
    const bindings: readonly ResolverBinding[] = [
      { resolverId: rid, ownerModule: COMBAT, shape: 'combat-target:single-hostile' },
    ];
    const registry = createProductionResolverRegistry(bindings);
    assert(registry.has(rid), '應已註冊 single-hostile');
    eq(resolveTargets(registry, rid, ['e1' as CombatantId]), ['e1'], 'single-hostile 解析敵方錨點');
    eq(resolveTargets(registry, rid, ['p2' as CombatantId]), [], 'single-hostile 己方錨點無效');
  }],

  // 機制：未知 shape → 組裝時明確拋錯（內容綁了 src/ 沒實作的 shape）。
  ['機制：未知 shape 拋錯', () => {
    throws(
      () =>
        createProductionResolverRegistry([
          { resolverId: 'resolver:combat.nope' as ResolverId, ownerModule: COMBAT, shape: 'combat-target:does-not-exist' },
        ]),
      '未知 shape 應拋',
    );
  }],

  // 機制：同一 resolverId 綁兩次 → createResolverRegistry 拋錯（不後蓋前）。
  ['機制：重複 resolverId 拋錯', () => {
    const rid = 'resolver:combat.target-self' as ResolverId;
    throws(
      () =>
        createProductionResolverRegistry([
          { resolverId: rid, ownerModule: COMBAT, shape: 'combat-target:self' },
          { resolverId: rid, ownerModule: COMBAT, shape: 'combat-target:self' },
        ]),
      '重複 resolverId 應拋',
    );
  }],

  // team 純演算法：預設站位以 row-major 0-based 逐格填九宮格（不同 shape 家族走同一 spine）。
  ['機制：team 預設站位 resolver', () => {
    const rid = 'resolver:team.team-default-placement' as ResolverId;
    const registry = createProductionResolverRegistry([
      { resolverId: rid, ownerModule: TEAM, shape: 'team:default-placement' },
    ]);
    const input = {
      teamId: 'team-1' as TeamId,
      memberIds: ['c1', 'c2', 'c3', 'c4'] as CharacterId[],
      current: {} as Record<CharacterId, GridCell>,
    };
    const placement = registry.require(rid).resolve(input, resolverContext({})).value as Record<
      CharacterId,
      GridCell
    >;
    const at = (id: string): string => {
      const c = placement[id as CharacterId];
      return c === undefined ? 'none' : `${c.row},${c.col}`;
    };
    assert(at('c1') === '0,0', `c1 應在 0,0，實得 ${at('c1')}`);
    assert(at('c2') === '0,1', `c2 應在 0,1，實得 ${at('c2')}`);
    assert(at('c3') === '0,2', `c3 應在 0,2，實得 ${at('c3')}`);
    assert(at('c4') === '1,0', `c4 應換行到 1,0，實得 ${at('c4')}`);
  }],

  // combat 傷害：weighted-power shape 讀 params（我設計的數值）＋攤平主屬 → 算出傷害數字。
  ['機制：combat 傷害 resolver（公式×數值）', () => {
    const rid = 'resolver:combat.damage-power.physical' as ResolverId;
    const registry = createProductionResolverRegistry([
      {
        resolverId: rid,
        ownerModule: COMBAT,
        shape: 'combat:weighted-power',
        paramsDefId: 'weighted-product-params.core.damage-physical' as DefinitionId,
      },
    ]);
    // 兩名角色（都走 progression 屬性；不需 monster stub）。actor muscle 20、target muscle 10。
    const enc = makeEncounter([
      { combatantId: 'p1', side: 'player', row: 0, col: 0 },
      { combatantId: 'p2', side: 'player', row: 0, col: 1 },
    ]);
    const muscleById: Record<string, number> = { 'char-p1': 20, 'char-p2': 10, p1: 20, p2: 10 };
    const definitions = {
      // 回傳與內容同值的 params（bias5 + actor.muscle×1.5 − target.muscle×1，夾下限 1）。
      getPowerParams: () => ({
        mode: 'linear',
        bias: 5,
        terms: [
          { inputKey: 'actor.muscle', weight: 1.5 },
          { inputKey: 'target.muscle', weight: -1 },
        ],
        clampMin: 1,
      }),
      getMonster: () => {
        throw new Error('本測試皆為角色，不應呼叫 getMonster');
      },
    };
    const queries = {
      getPrimaryAttributes: (id: CharacterId) => ({
        muscle: muscleById[String(id)] ?? 0,
        intelligence: 0,
        reaction: 0,
        coordination: 0,
        charisma: 0,
      }),
    };
    const input = {
      resolverId: rid,
      encounter: enc,
      actorId: 'p1' as CombatantId,
      targetId: 'p2' as CombatantId,
    };
    const value = registry.require(rid).resolve(input, resolverContext({ definitions, queries })).value;
    assert(value === 25, `傷害應 25（5 + 1.5·20 − 10），實得 ${String(value)}`);
  }],

  // 真實資料路徑：content/** 的綁定匯總 → 全部 shape 都有實作（組裝不拋）→ 真 ID 可解析。
  ['真實內容：8 個 combat 目標綁定一路到 registry 並可解析', () => {
    const loaded = loadContentFromDisk(CONTENT_ROOT);
    if (!loaded.success) throw new Error('內容載入失敗');

    const combatTargets = loaded.resolverBindings.filter((b) => b.shape.startsWith('combat-target:'));
    assert(
      combatTargets.length === 8,
      `core 應宣告 8 個 combat 目標綁定，實得 ${combatTargets.length}`,
    );
    // 每筆綁定的 shape 在 src/ 都要有實作——組裝會對未知 shape 拋錯，故這行本身就是斷言。
    const registry = createProductionResolverRegistry(loaded.resolverBindings);

    const single = combatTargets.find((b) => b.shape === 'combat-target:single-hostile');
    assert(single !== undefined, '應有 single-hostile 綁定');
    // 用**內容裡真的那個 resolverId**（非測試字面值）解析，證明 ID 一路對得上。
    eq(resolveTargets(registry, single!.resolverId, ['e1' as CombatantId]), ['e1'], '真 ID 解析 single-hostile');

    const party = combatTargets.find((b) => b.shape === 'combat-target:whole-party');
    assert(party !== undefined, '應有 whole-party 綁定');
    eq(resolveTargets(registry, party!.resolverId, []), ['p1', 'p2'], '真 ID 解析 whole-party（忽略錨點）');
  }],
];

export function runTests(): void {
  for (const [name, run] of cases) {
    try {
      run();
    } catch (err) {
      throw new Error(`resolver-registrations: 案例「${name}」失敗 — ${(err as Error).message}`);
    }
  }
}
