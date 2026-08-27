// modules/combat/target-shapes.test.ts
// 純目標形狀（target-shapes.ts）的自足式單元測試。runTests() 逐案執行，任一失敗即 throw。
//
// 這些形狀是「換一份 Content Pack 就換一種打法」的落實點之一：範圍／形狀由資料選定的 resolver
// 決定，而每個 resolver 的格陣邏輯必須逐案釘死，否則「單體技能傳九個目標全中」這類洞會無聲存在。

import type { CombatantId } from '../../contracts/core';
import type { CombatEncounter, CombatantState } from './state';
import { makeEncounter } from './fixtures';
import type { TargetShapeInput } from './target-shapes';
import { PURE_TARGET_SHAPES } from './target-shapes';

// ── 迷你斷言 ────────────────────────────────────────────────────────────────
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function eq(actual: readonly CombatantId[], expected: readonly string[], msg: string): void {
  const a = actual.map((x) => String(x)).join(',');
  const e = expected.join(',');
  assert(a === e, `${msg}：預期 [${e}]，實際 [${a}]`);
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

// ── 佐料 ────────────────────────────────────────────────────────────────────
const P1 = 'p1' as CombatantId;
const P2 = 'p2' as CombatantId;
const P3 = 'p3' as CombatantId;
const E1 = 'e1' as CombatantId;
const E2 = 'e2' as CombatantId;
const E3 = 'e3' as CombatantId;

// players：p1(1,1) p2(1,2) p3(2,1)；enemies：e1(1,1) e2(1,2) e3(2,1)。actor 預設 p1。
function baseEncounter(): CombatEncounter {
  return makeEncounter([
    { combatantId: 'p1', side: 'player', row: 1, col: 1 },
    { combatantId: 'p2', side: 'player', row: 1, col: 2 },
    { combatantId: 'p3', side: 'player', row: 2, col: 1 },
    { combatantId: 'e1', side: 'enemy', row: 1, col: 1 },
    { combatantId: 'e2', side: 'enemy', row: 1, col: 2 },
    { combatantId: 'e3', side: 'enemy', row: 2, col: 1 },
  ]);
}

function patch(
  enc: CombatEncounter,
  id: CombatantId,
  p: Partial<CombatantState>,
): CombatEncounter {
  const c = enc.combatants[id];
  if (c === undefined) throw new Error(`patch: 無 ${String(id)}`);
  return { ...enc, combatants: { ...enc.combatants, [id]: { ...c, ...p } } };
}

function input(
  enc: CombatEncounter,
  requested: readonly CombatantId[],
  actorId: CombatantId = P1,
): TargetShapeInput {
  return { encounter: enc, actorId, requestedTargetIds: requested };
}

// ── 案例 ────────────────────────────────────────────────────────────────────
type Case = readonly [name: string, run: () => void];

const cases: readonly Case[] = [
  // self：永遠回行動者本人，忽略錨點。
  ['self 忽略錨點回自己', () => {
    const enc = baseEncounter();
    eq(PURE_TARGET_SHAPES.self(input(enc, [])), ['p1'], 'self 空錨點');
    eq(PURE_TARGET_SHAPES.self(input(enc, [E1, P2])), ['p1'], 'self 有錨點');
  }],

  // single-ally：一名己方，排除自己、排除敵方、排除死者，取請求順序第一個。
  ['single-ally 取第一名存活隊友（不含自己）', () => {
    const enc = baseEncounter();
    const f = PURE_TARGET_SHAPES['single-ally'];
    eq(f(input(enc, [P2])), ['p2'], '隊友');
    eq(f(input(enc, [P1])), [], '自己不算隊友');
    eq(f(input(enc, [E1])), [], '敵方不算隊友');
    eq(f(input(enc, [E1, P3, P2])), ['p3'], '略過敵方取第一名隊友');
    eq(f(input(patch(enc, P2, { state: 'dead' }), [P2, P3])), ['p3'], '略過死者');
  }],

  // self-or-single-ally：同 single-ally 但允許自己。
  ['self-or-single-ally 允許自己', () => {
    const enc = baseEncounter();
    const f = PURE_TARGET_SHAPES['self-or-single-ally'];
    eq(f(input(enc, [P1])), ['p1'], '自己合法');
    eq(f(input(enc, [P2])), ['p2'], '隊友合法');
    eq(f(input(enc, [E2])), [], '敵方不合法');
  }],

  // whole-party：全體己方存活（含自己），決定性排序，忽略錨點。
  ['whole-party 全隊存活含自己', () => {
    const enc = baseEncounter();
    const f = PURE_TARGET_SHAPES['whole-party'];
    eq(f(input(enc, [])), ['p1', 'p2', 'p3'], '全隊排序');
    eq(f(input(patch(enc, P3, { state: 'dead' }), [E1])), ['p1', 'p2'], '排除死者、忽略錨點');
  }],

  // own-front-row：己方最前一排（row 最小）的存活單位。
  ['own-front-row 最前排', () => {
    const enc = baseEncounter();
    const f = PURE_TARGET_SHAPES['own-front-row'];
    eq(f(input(enc, [])), ['p1', 'p2'], 'row 1 兩人');
    const front = patch(patch(enc, P1, { state: 'dead' }), P2, { state: 'dead' });
    eq(f(input(front, [])), ['p3'], '前排全滅後改 row 2');
  }],

  // single-hostile：一名敵方，不限距離。
  ['single-hostile 取第一名存活敵方', () => {
    const enc = baseEncounter();
    const f = PURE_TARGET_SHAPES['single-hostile'];
    eq(f(input(enc, [E1])), ['e1'], '敵方');
    eq(f(input(enc, [P2])), [], '己方不算敵方');
    eq(f(input(patch(enc, E1, { state: 'dead' }), [E1, E2])), ['e2'], '略過死者');
  }],

  // single-hostile-casting：一名正在讀條的敵方。
  ['single-hostile-casting 只取讀條中的敵方', () => {
    const enc = patch(baseEncounter(), E1, {
      casting: { skillId: 'sk' as never, actionKind: 'cast', targetCombatantIds: [], remainingDelay: 5 },
    });
    const f = PURE_TARGET_SHAPES['single-hostile-casting'];
    eq(f(input(enc, [E2, E1])), ['e1'], '略過未讀條的 e2');
    eq(f(input(enc, [E2])), [], '無讀條目標');
  }],

  // same-column-hostiles：以敵方錨點決定欄，回該欄所有存活敵方（含錨點），含大體型跨欄。
  ['same-column-hostiles 展開同欄敵方', () => {
    const enc = baseEncounter();
    const f = PURE_TARGET_SHAPES['same-column-hostiles'];
    eq(f(input(enc, [E1])), ['e1', 'e3'], 'col 1 = e1,e3');
    eq(f(input(enc, [E2])), ['e2'], 'col 2 = e2');
    eq(f(input(enc, [E1, E2])), ['e1', 'e2', 'e3'], 'col 1+2 聯集排序');
    eq(f(input(enc, [P2])), [], '己方錨點無效');
    eq(f(input(patch(enc, E3, { state: 'dead' }), [E1])), ['e1'], 'col 1 死一個');
    // 大體型敵方（width 3）覆蓋三欄：以 col2 錨點也能命中它。
    const big = patch(enc, E1, { footprint: { width: 3, height: 1 } });
    eq(f(input(big, [E2])), ['e1', 'e2'], '寬體 e1 覆蓋 col2 故被 col2 錨點納入');
  }],

  // 結構不變量：行動者不在遭遇中 → 拋錯（不得偽裝成「沒有合法目標」）。
  ['行動者缺失即拋錯', () => {
    const enc = baseEncounter();
    throws(() => PURE_TARGET_SHAPES['whole-party'](input(enc, [], 'ghost' as CombatantId)), 'whole-party 應拋');
    throws(() => PURE_TARGET_SHAPES['single-ally'](input(enc, [P2], 'ghost' as CombatantId)), 'single-ally 應拋');
  }],
];

export function runTests(): void {
  for (const [name, run] of cases) {
    try {
      run();
    } catch (err) {
      throw new Error(`target-shapes: 案例「${name}」失敗 — ${(err as Error).message}`);
    }
  }
}
