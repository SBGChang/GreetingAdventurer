// contracts/core/rng.ts
// 顯式 cursor 的純函式 RNG。對應 00_shared_contracts.md §2.2 與 12_engine_runtime.md §7.1。

import type { Brand, Seed } from './primitives';
import type { RngStreamId } from './ids';

export type RngCursor = Brand<number, 'RngCursor'>; // 顯式傳入／傳回，不存內部可變狀態

export type RngContext = Readonly<{
  worldSeed: Seed;
  streamId: RngStreamId;
  cursor: RngCursor;
}>;

export type RngStep<T> = Readonly<{ value: T; nextCursor: RngCursor }>;

// 無狀態 RNG 取值基元：cursor 顯式傳入／傳回；禁止把有內部狀態的 RNG 物件存入 State 或跨 Handler 共用。
export interface DeterministicRng {
  nextFloat(
    input: Readonly<{ worldSeed: Seed; streamId: RngStreamId; cursor: RngCursor }>,
  ): RngStep<number>; // value ∈ [0, 1)
  nextInt(
    input: Readonly<{
      worldSeed: Seed;
      streamId: RngStreamId;
      cursor: RngCursor;
      minInclusive: number;
      maxInclusive: number;
    }>,
  ): RngStep<number>;
}
