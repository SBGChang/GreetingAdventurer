// contracts/core/scheduler.ts
// 排程 Job、Scheduler/Core State 與 Runtime ID 產生器。
// 對應 00_shared_contracts.md §6 與 12_engine_runtime.md §7.2（硬化後版）。

import type { RuntimeId, Revision, Seed, WorldDay } from './primitives';
import type { JobId, ModuleId, RuntimeEntityKind, RuntimeIdCursor } from './ids';
import type { RngContext } from './rng';

export type JobPhase =
  | 'completeAction'
  | 'closeDeadline'
  | 'worldCadence'
  | 'worldReaction'
  | 'scheduleNext';

// phase 不存入 Job Instance；由 ExecutionOrderManifest 依 Job Type 唯一決定。
export type ScheduledJobBase<
  TType extends string,
  TOwner extends ModuleId,
  TTarget extends string,
  TPayload,
> = Readonly<{
  jobId: JobId;
  type: TType;
  dueDay: WorldDay;
  ownerModule: TOwner;
  targetId: TTarget;
  expectedRevision?: Revision;
  rngContext?: RngContext; // 需要跨次執行延續 RNG 的 Job 保存完整 context
  payload: TPayload;
}>;

// 結構性基底：core 與 kernel 以此承載任意模組的 Job。
export type AnyScheduledJob = ScheduledJobBase<string, ModuleId, string, unknown>;

export type ScheduledJobDraft<TJob extends { jobId: JobId }> = Readonly<Omit<TJob, 'jobId'>>;

export type SchedulerState<TJob extends { jobId: JobId }> = Readonly<{
  jobsById: Readonly<Record<JobId, TJob>>;
  revision: Revision;
}>;

// core 由 Kernel 獨占寫入（worldDay／nextRuntimeSequence／scheduler）。
export type CoreState<TScheduledJob extends { jobId: JobId }> = Readonly<{
  worldDay: WorldDay;
  worldSeed: Seed;
  nextRuntimeSequence: RuntimeIdCursor;
  scheduler: SchedulerState<TScheduledJob>;
}>;

export type RuntimeIdAllocation<TId extends RuntimeId> = Readonly<{
  id: TId;
  nextCursor: RuntimeIdCursor;
}>;

// 純函式：無內部可變狀態、不直接改 CoreState。cursor 傳入、傳回，交易內逐次前進。
export interface RuntimeIdGenerator {
  next<TId extends RuntimeId>(
    input: Readonly<{ worldSeed: Seed; entityKind: RuntimeEntityKind; cursor: RuntimeIdCursor }>,
  ): RuntimeIdAllocation<TId>;
}
