// data-runtime/kernels.ts
// §7.1 通用 Resolver kernel：「形狀＝程式、調校＝資料」。
//
// 三條紀律（§7.1）：
//  1. 零魔數：kernel 程式碼不得出現任何可調數值；所有係數、門檻、曲線點只能來自 params。
//     本檔僅出現數學結構常數（0/1 的加法／乘法單位元、logistic 的 1）——非可調參數。
//  2. 新形狀才動程式：新增 kernel kind 需比照 §6 增補型別／Schema／Validator／Fixture。
//  3. 純白名單：deterministic、同步、無 I/O、params 只吃 JSON、可重播；禁止 expression DSL。
//
// kernel 讀 params + inputs 回傳 number；需要機率判定者以注入的 rng／rngContext 擲骰，
// 回傳 RngStep（value + nextCursor），由呼叫端寫回 ResolverExecutionResult.nextRngCursor。

import type { DeterministicRng, RngContext, RngStep } from '../contracts/core';

export type KernelInputs = Readonly<Record<string, number>>;

// ── 共用小工具（皆為結構性，非可調數值）──────────────────────────────────────

function requireInput(inputs: KernelInputs, key: string): number {
  const v = inputs[key];
  if (v === undefined || !Number.isFinite(v)) {
    throw new Error(`kernel: missing or non-finite input "${key}"`);
  }
  return v;
}

function requireFiniteParam(value: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`kernel: param "${path}" must be a finite number`);
  }
  return value;
}

function requireNonNegativeParam(value: number, path: string): number {
  requireFiniteParam(value, path);
  if (value < 0) {
    throw new Error(`kernel: param "${path}" must be >= 0`);
  }
  return value;
}

function clamp(value: number, min: number | undefined, max: number | undefined): number {
  let out = value;
  if (min !== undefined) out = Math.max(out, min);
  if (max !== undefined) out = Math.min(out, max);
  return out;
}

// ── 1) weightedLinearProduct ────────────────────────────────────────────────
// 加權線性或乘積（物價、傷害微調）。
//  - linear : bias + Σ (weight_i · input_i)          （bias 缺省 = 加法單位元 0）
//  - product: bias · Π (input_i ^ exponent_i)         （bias 缺省 = 乘法單位元 1）

// 係數與次方**必填**，而且依 mode 分成兩種項。原本是單一 `{ weight?, exponent? }` 兩者皆選填，
// kernel 缺省補 1——但係數與次方就是調校量，跟本檔 LogisticCurveParams.bias 已經寫明的理由一樣
// （「曲線位置是調校量，不得由程式補預設」）。同一份 kernel 不能兩套標準：內容沒給係數，代表這條
// 公式還沒調校完，不是「係數是 1」。
//
// 分成兩型而不是把兩個欄位都設成必填：linear 用不到次方、product 用不到係數，要求作者填一個
// 不影響結果的欄位只會逼出隨便填的值——那跟預設值一樣糟，只是換人填。
export type LinearTerm = Readonly<{ inputKey: string; weight: number }>;
export type ProductTerm = Readonly<{ inputKey: string; exponent: number }>;

type ClampBounds = Readonly<{ bias?: number; clampMin?: number; clampMax?: number }>;

export type WeightedLinearProductParams = ClampBounds &
  (
    | Readonly<{ mode: 'linear'; terms: readonly LinearTerm[] }>
    | Readonly<{ mode: 'product'; terms: readonly ProductTerm[] }>
  );

export function weightedLinearProduct(
  params: WeightedLinearProductParams,
  inputs: KernelInputs,
): number {
  if (params.mode === 'linear') {
    let acc = params.bias === undefined ? 0 : requireFiniteParam(params.bias, 'bias');
    params.terms.forEach((term, i) => {
      const weight = requireFiniteParam(term.weight, `terms[${i}].weight`);
      acc += weight * requireInput(inputs, term.inputKey);
    });
    return clamp(acc, params.clampMin, params.clampMax);
  }
  // product
  let acc = params.bias === undefined ? 1 : requireFiniteParam(params.bias, 'bias');
  params.terms.forEach((term, i) => {
    const exponent = requireFiniteParam(term.exponent, `terms[${i}].exponent`);
    acc *= Math.pow(requireInput(inputs, term.inputKey), exponent);
  });
  return clamp(acc, params.clampMin, params.clampMax);
}

// ── 2) logisticCurve ────────────────────────────────────────────────────────
// S 形機率曲線（各種成功率／接受率）。
//   z = bias + Σ (weight_i · input_i)
//   p = 1 / (1 + e^(-z))
//   p ∈ [floor, ceil]（若提供）
// 回傳機率 number（純函式）。需要判定時用 rollBernoulli／logisticRoll。

export type LogisticTerm = Readonly<{ inputKey: string; weight: number }>;

export type LogisticCurveParams = Readonly<{
  bias: number; // 截距 b0（必填：曲線位置是調校量，不得由程式補預設）
  terms: readonly LogisticTerm[];
  floor?: number; // 機率下限夾限（0..1）
  ceil?: number; // 機率上限夾限（0..1）
}>;

export function logisticCurve(params: LogisticCurveParams, inputs: KernelInputs): number {
  let z = requireFiniteParam(params.bias, 'bias');
  params.terms.forEach((term, i) => {
    const weight = requireFiniteParam(term.weight, `terms[${i}].weight`);
    z += weight * requireInput(inputs, term.inputKey);
  });
  const p = 1 / (1 + Math.exp(-z));
  const floor = params.floor;
  const ceil = params.ceil;
  if (floor !== undefined) requireFiniteParam(floor, 'floor');
  if (ceil !== undefined) requireFiniteParam(ceil, 'ceil');
  return clamp(p, floor, ceil);
}

// ── 3) monotonicAdjust ──────────────────────────────────────────────────────
// 對某輸入單調遞增、對另一輸入單調遞減且有夾限（脫隊機率、好感變化）。
//   result = clamp(base + upWeight·up − downWeight·down, min, max)
//   upWeight/downWeight 皆須 >= 0，以保證單調性。

export type MonotonicAdjustParams = Readonly<{
  base: number;
  increasingInputKey: string;
  increasingWeight: number; // >= 0
  decreasingInputKey: string;
  decreasingWeight: number; // >= 0
  min: number;
  max: number;
}>;

export function monotonicAdjust(params: MonotonicAdjustParams, inputs: KernelInputs): number {
  const base = requireFiniteParam(params.base, 'base');
  const upWeight = requireNonNegativeParam(params.increasingWeight, 'increasingWeight');
  const downWeight = requireNonNegativeParam(params.decreasingWeight, 'decreasingWeight');
  const min = requireFiniteParam(params.min, 'min');
  const max = requireFiniteParam(params.max, 'max');
  if (min > max) {
    throw new Error('kernel monotonicAdjust: params.min must be <= params.max');
  }
  const up = requireInput(inputs, params.increasingInputKey);
  const down = requireInput(inputs, params.decreasingInputKey);
  return clamp(base + upWeight * up - downWeight * down, min, max);
}

// ── 4a) thresholdTable ──────────────────────────────────────────────────────
// 分段查表（依城市距離定期限、依等級定品級／產量）。
// entries 依 maxInclusive 升冪；取「第一個 input <= maxInclusive」的 value；否則 defaultValue。

export type ThresholdEntry = Readonly<{ maxInclusive: number; value: number }>;

export type ThresholdTableParams = Readonly<{
  inputKey: string;
  entries: readonly ThresholdEntry[];
  defaultValue: number; // 超過所有門檻時的值
}>;

export function thresholdTable(params: ThresholdTableParams, inputs: KernelInputs): number {
  const x = requireInput(inputs, params.inputKey);
  let previousBound = -Infinity;
  for (let i = 0; i < params.entries.length; i += 1) {
    const entry = params.entries[i];
    if (entry === undefined) continue; // noUncheckedIndexedAccess
    const bound = requireFiniteParam(entry.maxInclusive, `entries[${i}].maxInclusive`);
    if (bound < previousBound) {
      throw new Error(`kernel thresholdTable: entries[${i}].maxInclusive must be ascending`);
    }
    previousBound = bound;
    if (x <= bound) {
      return requireFiniteParam(entry.value, `entries[${i}].value`);
    }
  }
  return requireFiniteParam(params.defaultValue, 'defaultValue');
}

// ── 4b) piecewiseLookup ─────────────────────────────────────────────────────
// 分段線性內插查表。points 依 x 升冪；區間內線性內插。
// clampEnds=true（預設）時，範圍外夾到端點值；否則沿用端點斜率外推。

export type LookupPoint = Readonly<{ x: number; y: number }>;

export type PiecewiseLookupParams = Readonly<{
  inputKey: string;
  points: readonly LookupPoint[];
  clampEnds?: boolean;
}>;

export function piecewiseLookup(params: PiecewiseLookupParams, inputs: KernelInputs): number {
  const pts = params.points;
  if (pts.length === 0) {
    throw new Error('kernel piecewiseLookup: params.points must be non-empty');
  }
  const first = pts[0];
  if (first === undefined) throw new Error('kernel piecewiseLookup: invalid points');
  const x = requireInput(inputs, params.inputKey);
  const clampEnds = params.clampEnds ?? true;

  // 驗證升冪並找出所在區間。
  for (let i = 1; i < pts.length; i += 1) {
    const prev = pts[i - 1];
    const cur = pts[i];
    if (prev === undefined || cur === undefined) continue;
    if (cur.x <= prev.x) {
      throw new Error(`kernel piecewiseLookup: points[${i}].x must be strictly ascending`);
    }
  }

  const last = pts[pts.length - 1];
  if (last === undefined) throw new Error('kernel piecewiseLookup: invalid points');

  if (x <= first.x) {
    if (clampEnds || pts.length === 1) return requireFiniteParam(first.y, 'points[0].y');
    const second = pts[1];
    if (second === undefined) return first.y;
    return interpolate(first, second, x);
  }
  if (x >= last.x) {
    if (clampEnds) return requireFiniteParam(last.y, 'points[last].y');
    const penultimate = pts[pts.length - 2];
    if (penultimate === undefined) return last.y;
    return interpolate(penultimate, last, x);
  }
  for (let i = 1; i < pts.length; i += 1) {
    const lo = pts[i - 1];
    const hi = pts[i];
    if (lo === undefined || hi === undefined) continue;
    if (x >= lo.x && x <= hi.x) {
      return interpolate(lo, hi, x);
    }
  }
  // 理論上不可達（已涵蓋所有區間）。
  return requireFiniteParam(last.y, 'points[last].y');
}

function interpolate(a: LookupPoint, b: LookupPoint, x: number): number {
  const span = b.x - a.x;
  if (span === 0) return a.y;
  const t = (x - a.x) / span;
  return a.y + t * (b.y - a.y);
}

// ── 機率判定（roll）：以注入的 rng／rngContext 顯式串接 cursor ─────────────────
// 回傳 RngStep<boolean>：value=命中與否，nextCursor=顯式續接的最終 cursor。

export function rollBernoulli(
  rng: DeterministicRng,
  rngContext: RngContext,
  probability: number,
): RngStep<boolean> {
  const step = rng.nextFloat({
    worldSeed: rngContext.worldSeed,
    streamId: rngContext.streamId,
    cursor: rngContext.cursor,
  });
  return { value: step.value < probability, nextCursor: step.nextCursor };
}

// logisticCurve 的機率判定變體：算出 p 後以 rng 擲定成功／失敗。
export function logisticRoll(
  params: LogisticCurveParams,
  inputs: KernelInputs,
  rng: DeterministicRng,
  rngContext: RngContext,
): RngStep<boolean> {
  return rollBernoulli(rng, rngContext, logisticCurve(params, inputs));
}
