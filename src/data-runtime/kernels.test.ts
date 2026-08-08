// data-runtime/kernels.test.ts
// 自足式（無外部測試框架、無 node/DOM 全域）kernel 單元測試。
// 呼叫 runKernelTests() 取得每個案例的 pass/fail；供任何 harness 驅動。

import type {
  DeterministicRng,
  RngContext,
  RngCursor,
  RngStreamId,
  Seed,
} from '../contracts/core';
import {
  logisticCurve,
  logisticRoll,
  monotonicAdjust,
  piecewiseLookup,
  thresholdTable,
  weightedLinearProduct,
} from './kernels';

export type KernelTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function approx(a: number, b: number, epsilon: number, message: string): void {
  if (Math.abs(a - b) > epsilon) {
    throw new Error(`${message} (expected ≈ ${b}, got ${a})`);
  }
}

// 固定值的假 RNG：nextFloat 一律回傳注入的常數，cursor 顯式 +1。
function fakeRng(fixedFloat: number): DeterministicRng {
  return {
    nextFloat: (input) => ({
      value: fixedFloat,
      nextCursor: ((input.cursor as number) + 1) as RngCursor,
    }),
    nextInt: (input) => ({
      value: input.minInclusive,
      nextCursor: ((input.cursor as number) + 1) as RngCursor,
    }),
  };
}

function ctx(cursor: number): RngContext {
  return {
    worldSeed: 'seed-test' as Seed,
    streamId: 'stream-test' as RngStreamId,
    cursor: cursor as RngCursor,
  };
}

type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: 'weightedLinearProduct: linear sum with bias',
    run: () => {
      // 物價示例：base·… 這裡用純線性：0.5 + 2*a + 3*b
      const out = weightedLinearProduct(
        {
          mode: 'linear',
          bias: 0.5,
          terms: [
            { inputKey: 'a', weight: 2 },
            { inputKey: 'b', weight: 3 },
          ],
        },
        { a: 10, b: 1 },
      );
      approx(out, 0.5 + 20 + 3, 1e-9, 'linear result');
    },
  },
  {
    name: 'weightedLinearProduct: product mode with clamp',
    run: () => {
      // 物價：baseValue × 市場壓力 × 戰爭倍率，夾在 [0, 100]
      const out = weightedLinearProduct(
        {
          mode: 'product',
          bias: 1,
          clampMax: 100,
          terms: [
            { inputKey: 'baseValue', exponent: 1 },
            { inputKey: 'marketPressure', exponent: 1 },
            { inputKey: 'warMultiplier', exponent: 1 },
          ],
        },
        { baseValue: 40, marketPressure: 2, warMultiplier: 3 },
      );
      // 40*2*3 = 240 → clamp 100
      approx(out, 100, 1e-9, 'product clamp');
    },
  },
  {
    name: 'logisticCurve: z=0 → 0.5, monotone increasing',
    run: () => {
      const params = {
        bias: 0,
        terms: [{ inputKey: 'x', weight: 1 }],
      } as const;
      approx(logisticCurve(params, { x: 0 }), 0.5, 1e-9, 'p at z=0');
      const lo = logisticCurve(params, { x: -2 });
      const hi = logisticCurve(params, { x: 2 });
      assert(lo < 0.5 && hi > 0.5 && hi > lo, 'logistic monotonic increasing');
    },
  },
  {
    name: 'logisticCurve: floor/ceil clamp',
    run: () => {
      const p = logisticCurve(
        { bias: 0, terms: [{ inputKey: 'x', weight: 1 }], floor: 0.1, ceil: 0.9 },
        { x: 100 },
      );
      approx(p, 0.9, 1e-9, 'ceil clamp');
    },
  },
  {
    name: 'monotonicAdjust: up increases, down decreases, clamped',
    run: () => {
      // 脫隊機率：工作淨收益缺口↑、隊長 departureResistance↓
      const params = {
        base: 0.2,
        increasingInputKey: 'incomeGap',
        increasingWeight: 0.5,
        decreasingInputKey: 'resistance',
        decreasingWeight: 0.5,
        min: 0,
        max: 1,
      } as const;
      const mid = monotonicAdjust(params, { incomeGap: 0.4, resistance: 0.4 });
      approx(mid, 0.2, 1e-9, 'balanced adjust');
      const higher = monotonicAdjust(params, { incomeGap: 1, resistance: 0 });
      assert(higher > mid, 'increasing input raises result');
      const clampedLow = monotonicAdjust(params, { incomeGap: 0, resistance: 10 });
      approx(clampedLow, 0, 1e-9, 'clamp to min');
    },
  },
  {
    name: 'thresholdTable: piecewise bucket + default',
    run: () => {
      // 委託期限：城市相隔數 → 天數
      const params = {
        inputKey: 'distance',
        entries: [
          { maxInclusive: 1, value: 3 },
          { maxInclusive: 3, value: 6 },
        ],
        defaultValue: 9,
      } as const;
      approx(thresholdTable(params, { distance: 1 }), 3, 1e-9, 'bucket 1');
      approx(thresholdTable(params, { distance: 2 }), 6, 1e-9, 'bucket 2');
      approx(thresholdTable(params, { distance: 99 }), 9, 1e-9, 'default');
    },
  },
  {
    name: 'piecewiseLookup: linear interpolation + end clamp',
    run: () => {
      const params = {
        inputKey: 'level',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 100 },
        ],
      } as const;
      approx(piecewiseLookup(params, { level: 5 }), 50, 1e-9, 'midpoint interp');
      approx(piecewiseLookup(params, { level: -5 }), 0, 1e-9, 'clamp low');
      approx(piecewiseLookup(params, { level: 15 }), 100, 1e-9, 'clamp high');
    },
  },
  {
    name: 'logisticRoll: deterministic roll advances cursor',
    run: () => {
      const params = { bias: 0, terms: [{ inputKey: 'x', weight: 1 }] } as const;
      const p = logisticCurve(params, { x: 0 }); // 0.5
      // rng float 0.25 < 0.5 → 命中；cursor 0 → 1
      const hit = logisticRoll(params, { x: 0 }, fakeRng(0.25), ctx(0));
      assert(hit.value === true, 'roll below p is a hit');
      assert((hit.nextCursor as number) === 1, 'cursor advanced by 1');
      // rng float 0.75 >= 0.5 → 未命中
      const miss = logisticRoll(params, { x: 0 }, fakeRng(0.75), ctx(5));
      assert(miss.value === false, 'roll above p is a miss');
      assert((miss.nextCursor as number) === 6, 'cursor advanced from 5 to 6');
      // 同 input+seed+cursor 得同結果（可重播）
      const again = logisticRoll(params, { x: 0 }, fakeRng(0.25), ctx(0));
      assert(again.value === hit.value && again.nextCursor === hit.nextCursor, 'replayable');
      void p;
    },
  },
  {
    name: 'kernels reject missing inputs (locatable error)',
    run: () => {
      let threw = false;
      try {
        weightedLinearProduct(
          { mode: 'linear', terms: [{ inputKey: 'missing', weight: 1 }] },
          {},
        );
      } catch {
        threw = true;
      }
      assert(threw, 'missing input must throw');
    },
  },
];

export function runKernelTests(): readonly KernelTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { name: c.name, passed: false, error: message };
    }
  });
}

// 全通過回傳 true，供最外層 harness 直接判定。
export function allKernelTestsPass(): boolean {
  return runKernelTests().every((r) => r.passed);
}
