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

import type { CombatantId, ResolverBinding, ResolverId, ModuleId } from '../../contracts/core';
import type { CombatSkillTargetInput } from '../../modules/combat/system';
import { makeEncounter } from '../../modules/combat/fixtures';
import { loadContentFromDisk } from '../../platform/content-repository';
import { createProductionResolverRegistry } from './resolver-registrations';
import { resolverContext } from './resolver-adapter';

const CONTENT_ROOT = resolve(import.meta.dirname, '../../../content');
const COMBAT = 'combat' as ModuleId;

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
