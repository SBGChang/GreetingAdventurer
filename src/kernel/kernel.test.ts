// kernel/kernel.test.ts
// 最小單元測試（無外部依賴：不用 node:assert，不碰 console，可在任何 TS runner / tsx / vitest 下執行）。
// 證明：(1) RNG 決定性與 cursor 前進；(2) Runtime ID cursor 單調性與重播一致。
// 執行方式：呼叫 runKernelTests()；失敗即 throw，成功回傳通過數。

import type {
  Seed,
  RngStreamId,
  RngCursor,
  RuntimeIdCursor,
  RuntimeEntityKind,
  ItemInstanceId,
} from '../contracts/core';
import { deterministicRng, nextRuntimeId } from './index';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const SEED = 'world-seed-A' as Seed;
const STREAM = 'rng-stream:test' as RngStreamId;

// ── (1) RNG 決定性 ─────────────────────────────────────────────────────────
function testRngDeterminism(): void {
  const at0 = { worldSeed: SEED, streamId: STREAM, cursor: 0 as RngCursor };

  // 同 seed／stream／cursor → 完全相同的 value 與 nextCursor。
  const a = deterministicRng.nextFloat(at0);
  const b = deterministicRng.nextFloat(at0);
  assert(a.value === b.value, 'same (seed,stream,cursor) yields same float');
  assert(a.nextCursor === b.nextCursor, 'same input yields same nextCursor');

  // value 落在 [0, 1)。
  assert(a.value >= 0 && a.value < 1, 'nextFloat value in [0,1)');

  // cursor 顯式前進 +1。
  assert((a.nextCursor as number) === 1, 'nextFloat advances cursor by 1');

  // 前進 cursor → 產出不同區塊（不同 value）。
  const c = deterministicRng.nextFloat({ ...at0, cursor: a.nextCursor });
  assert(c.value !== a.value, 'advancing cursor changes the drawn value');

  // 不同 stream → 不同結果（stream 隔離）。
  const other = deterministicRng.nextFloat({
    ...at0,
    streamId: 'rng-stream:other' as RngStreamId,
  });
  assert(other.value !== a.value, 'different stream yields different value');
}

function testRngIntRangeAndDeterminism(): void {
  const input = {
    worldSeed: SEED,
    streamId: STREAM,
    cursor: 5 as RngCursor,
    minInclusive: 1,
    maxInclusive: 6,
  };
  const r1 = deterministicRng.nextInt(input);
  const r2 = deterministicRng.nextInt(input);
  assert(r1.value === r2.value, 'nextInt is deterministic');
  assert(r1.value >= 1 && r1.value <= 6, 'nextInt value within [min,max]');
  assert(Number.isInteger(r1.value), 'nextInt value is integer');
  assert((r1.nextCursor as number) === 6, 'nextInt advances cursor by 1');

  // 退化區間 [n,n] 必回 n。
  const single = deterministicRng.nextInt({ ...input, minInclusive: 4, maxInclusive: 4 });
  assert(single.value === 4, 'degenerate range returns the single value');
}

// ── (2) Runtime ID cursor 單調性 / 重播 ─────────────────────────────────────
function testRuntimeIdMonotonicityAndReplay(): void {
  const kind = 'item-instance' as RuntimeEntityKind;

  const r0 = nextRuntimeId<ItemInstanceId>({ worldSeed: SEED, entityKind: kind, cursor: 0 as RuntimeIdCursor });
  const r1 = nextRuntimeId<ItemInstanceId>({ worldSeed: SEED, entityKind: kind, cursor: r0.nextCursor });

  // cursor 單調 +1。
  assert((r0.nextCursor as number) === 1, 'first allocation advances cursor to 1');
  assert((r1.nextCursor as number) === 2, 'second allocation advances cursor to 2');

  // 不同 cursor → 不同 ID。
  assert((r0.id as string) !== (r1.id as string), 'distinct cursors produce distinct ids');

  // 重播：相同輸入 → 相同 ID（純函式）。
  const r0replay = nextRuntimeId<ItemInstanceId>({
    worldSeed: SEED,
    entityKind: kind,
    cursor: 0 as RuntimeIdCursor,
  });
  assert((r0.id as string) === (r0replay.id as string), 'replay with same input yields same id');

  // 不同 kind、同 cursor → 不同 ID（種類命名空間隔離）。
  const teamId = nextRuntimeId({
    worldSeed: SEED,
    entityKind: 'team' as RuntimeEntityKind,
    cursor: 0 as RuntimeIdCursor,
  });
  assert((teamId.id as string) !== (r0.id as string), 'different kind with same cursor yields different id');

  // 不同 worldSeed → 不同 ID。
  const otherWorld = nextRuntimeId<ItemInstanceId>({
    worldSeed: 'world-seed-B' as Seed,
    entityKind: kind,
    cursor: 0 as RuntimeIdCursor,
  });
  assert((otherWorld.id as string) !== (r0.id as string), 'different worldSeed yields different id');
}

const CASES: readonly (readonly [string, () => void])[] = [
  ['rng determinism', testRngDeterminism],
  ['rng nextInt range', testRngIntRangeAndDeterminism],
  ['runtime id monotonicity/replay', testRuntimeIdMonotonicityAndReplay],
];

export function runKernelTests(): Readonly<{ passed: number; total: number }> {
  let passed = 0;
  for (const [name, fn] of CASES) {
    try {
      fn();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`[kernel test] "${name}" failed: ${detail}`);
    }
    passed += 1;
  }
  return { passed, total: CASES.length };
}
