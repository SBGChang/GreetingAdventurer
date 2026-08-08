// kernel/scheduler.ts
// Scheduler 基元（對應 12_engine_runtime.md §6 與 00_shared_contracts.md §6.2）。
// 純函式：不保存 callback／Promise，只持有可序列化 SchedulerState。
// 跨模組排序由注入的 ExecutionOrderManifest 決定；kernel 只把它編譯為內部索引，
// 不自行決定 Job Phase、事件綁定或跨模組順序（那是 app/composition 的唯一真相）。

import type {
  JobId,
  JobPhase,
  WorldDay,
  Revision,
  SchedulerState,
  AnyScheduledJob,
} from '../contracts/core';

// JobPhase 的固定執行順序（對應 contracts/core JobPhase union 與 §6.2 相位表）。
const PHASE_ORDER: readonly JobPhase[] = [
  'completeAction',
  'closeDeadline',
  'worldCadence',
  'worldReaction',
  'scheduleNext',
];

// Scheduler 只需要 ExecutionOrderManifest 的排序面向；泛型 over job-type 字串，不綁定任何模組。
export type SchedulerExecutionOrder = Readonly<{
  jobTypeOrderByPhase: Readonly<Record<JobPhase, readonly string[]>>;
}>;

// 由 Manifest 編譯出的內部索引：job type → 其 phase 序與同 phase 內的 type 序。
type JobTypeRank = Readonly<{ phaseIndex: number; typeIndex: number }>;

// 可注入的存活判定：expectedRevision 是否仍與目標實體目前 revision 相符，
// 由呼叫者（Runner）讀取 working state 判斷；Scheduler 本身不持有領域狀態。
// 省略時視為全部存活。
export type DueJobOptions<TJob extends AnyScheduledJob> = Readonly<{
  isLive?: (job: TJob) => boolean;
}>;

export interface Scheduler<TJob extends AnyScheduledJob> {
  add(state: SchedulerState<TJob>, job: TJob): SchedulerState<TJob>;
  cancel(state: SchedulerState<TJob>, jobId: JobId): SchedulerState<TJob>;
  // 下一個「有存活 Job」的到期日；快轉時直接跳到此日。
  peekNextDueDay(state: SchedulerState<TJob>, options?: DueJobOptions<TJob>): WorldDay | undefined;
  // 指定日的存活 Job，已依 phase → job-type → ownerModule → targetId → jobId 排序。
  dueJobs(
    state: SchedulerState<TJob>,
    worldDay: WorldDay,
    options?: DueJobOptions<TJob>,
  ): readonly TJob[];
  // 對外暴露排序比較器（相同 dueDay 內），供測試與除錯。
  compare(a: TJob, b: TJob): number;
}

function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function createScheduler<TJob extends AnyScheduledJob>(
  order: SchedulerExecutionOrder,
): Scheduler<TJob> {
  // 編譯 Manifest → job type rank 索引。
  const rankByType = new Map<string, JobTypeRank>();
  for (let phaseIndex = 0; phaseIndex < PHASE_ORDER.length; phaseIndex += 1) {
    const phase = PHASE_ORDER[phaseIndex];
    if (phase === undefined) continue;
    const types = order.jobTypeOrderByPhase[phase] ?? [];
    for (let typeIndex = 0; typeIndex < types.length; typeIndex += 1) {
      const type = types[typeIndex];
      if (type === undefined) continue;
      if (rankByType.has(type)) {
        throw new Error(`Job type 在 ExecutionOrderManifest 中重複出現：${type}`);
      }
      rankByType.set(type, { phaseIndex, typeIndex });
    }
  }

  function rankOf(type: string): JobTypeRank {
    const rank = rankByType.get(type);
    if (rank === undefined) {
      // Bootstrap 應保證每個已註冊 Job Type 恰好出現一次；缺漏視為註冊錯誤。
      throw new Error(`Job type 未在 ExecutionOrderManifest 中註冊：${type}`);
    }
    return rank;
  }

  function compare(a: TJob, b: TJob): number {
    if (a.dueDay !== b.dueDay) return a.dueDay - b.dueDay;
    const ra = rankOf(a.type);
    const rb = rankOf(b.type);
    if (ra.phaseIndex !== rb.phaseIndex) return ra.phaseIndex - rb.phaseIndex;
    if (ra.typeIndex !== rb.typeIndex) return ra.typeIndex - rb.typeIndex;
    const byOwner = compareString(a.ownerModule, b.ownerModule);
    if (byOwner !== 0) return byOwner;
    const byTarget = compareString(a.targetId, b.targetId);
    if (byTarget !== 0) return byTarget;
    return compareString(a.jobId, b.jobId);
  }

  function isLive(job: TJob, options?: DueJobOptions<TJob>): boolean {
    return options?.isLive ? options.isLive(job) : true;
  }

  return {
    add(state, job) {
      return {
        jobsById: { ...state.jobsById, [job.jobId]: job },
        revision: (state.revision + 1) as Revision,
      };
    },

    cancel(state, jobId) {
      if (!(jobId in state.jobsById)) return state;
      const nextJobs = { ...state.jobsById };
      delete nextJobs[jobId];
      return { jobsById: nextJobs, revision: (state.revision + 1) as Revision };
    },

    peekNextDueDay(state, options) {
      let next: WorldDay | undefined;
      for (const job of Object.values(state.jobsById)) {
        if (!isLive(job, options)) continue;
        if (next === undefined || job.dueDay < next) next = job.dueDay;
      }
      return next;
    },

    dueJobs(state, worldDay, options) {
      const due = Object.values(state.jobsById).filter(
        (job) => job.dueDay === worldDay && isLive(job, options),
      );
      return due.sort(compare);
    },

    compare,
  };
}
