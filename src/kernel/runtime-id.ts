// kernel/runtime-id.ts
// RuntimeIdGenerator 的具體實作（對應 contracts/core §7.2 與 12_engine_runtime.md §7.2）。
// 純函式：cursor 顯式傳入／傳回，無內部可變狀態、不直接改 CoreState。

import type {
  Seed,
  RuntimeId,
  RuntimeEntityKind,
  RuntimeIdCursor,
  RuntimeIdGenerator,
  RuntimeIdAllocation,
} from '../contracts/core';
import { fnv1a64, toHex16 } from './hash';

function assertRuntimeIdCursor(cursor: number): void {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new RangeError(`RuntimeIdCursor 必須為非負安全整數，收到 ${cursor}`);
  }
}

// ID 字串格式：`<entityKind>~<worldSeedTag>~<cursorBase36>`
//   - entityKind：以種類命名空間隔離，不同 kind 用同一 cursor 也不會相撞。
//   - worldSeedTag：worldSeed 的 64-bit 雜湊（每個世界固定），區分不同存檔／世界。
//   - cursorBase36：交易私有序號，保證同一 (world, kind) 內唯一且可重播。
// 三段皆為 (worldSeed, entityKind, cursor) 的注入函式 → 決定性、可重播、種類內永久唯一。
function formatRuntimeId(worldSeed: Seed, entityKind: RuntimeEntityKind, cursor: number): string {
  const worldSeedTag = toHex16(fnv1a64(worldSeed));
  return `${entityKind}~${worldSeedTag}~${cursor.toString(36)}`;
}

export function nextRuntimeId<TId extends RuntimeId>(
  input: Readonly<{ worldSeed: Seed; entityKind: RuntimeEntityKind; cursor: RuntimeIdCursor }>,
): RuntimeIdAllocation<TId> {
  assertRuntimeIdCursor(input.cursor);
  const id = formatRuntimeId(input.worldSeed, input.entityKind, input.cursor) as unknown as TId;
  return { id, nextCursor: (input.cursor + 1) as RuntimeIdCursor };
}

// EngineContext 直接注入的單例；無內部狀態，可安全共用。
export const runtimeIdGenerator: RuntimeIdGenerator = {
  next: nextRuntimeId,
};
