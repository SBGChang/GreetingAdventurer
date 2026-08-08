// kernel/hash.ts
// 決定性 64-bit 雜湊基元（base utility）。
// 純函式、同步、無 I/O、不呼叫 Math.random／Date.now，不 import 任何領域模組。
// RNG（rng.ts）與 Runtime ID（runtime-id.ts）皆由此推導確定值。

const MASK64 = (1n << 64n) - 1n;

// FNV-1a 64-bit：把任意字串（worldSeed／streamId／entityKind）壓成一個 64-bit 種子。
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x00000100000001b3n;

export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash & MASK64;
}

// splitmix64 finalizer（bit-mixing）：把一個 64-bit state 打散成均勻分佈的 64-bit 輸出。
export function mix64(value: bigint): bigint {
  let z = value & MASK64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  z = (z ^ (z >> 31n)) & MASK64;
  return z;
}

// splitmix64 增量常數（golden gamma）；用來把離散 cursor 映到彼此獨立的 state。
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;

// 由 (seedHash, cursor) 決定性地取出第 cursor 個 64-bit 亂數區塊。
// 同 (seedHash, cursor) → 同輸出；cursor 前進即取下一個獨立區塊。
export function draw64(seedHash: bigint, cursor: number): bigint {
  const state = (seedHash + BigInt(cursor + 1) * GOLDEN_GAMMA) & MASK64;
  return mix64(state);
}

// 64-bit → 固定寬度小寫十六進位（16 字元），供 ID 字串使用。
export function toHex16(value: bigint): string {
  return (value & MASK64).toString(16).padStart(16, '0');
}
