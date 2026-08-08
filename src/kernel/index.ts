// kernel — 決定性引擎基元的唯一對外入口。
// 依賴規則：kernel 只依賴 contracts/core 與 base utilities（hash.ts）；不 import 任何領域模組。

export { deterministicRng, nextFloat, nextInt } from './rng';
export { runtimeIdGenerator, nextRuntimeId } from './runtime-id';
export { createScheduler } from './scheduler';
export type { Scheduler, SchedulerExecutionOrder, DueJobOptions } from './scheduler';
export { runTransaction } from './transaction';
export type {
  TransactionRunnerConfig,
  HandlerContext,
  SliceMutation,
  RootHandler,
  InternalCommandHandler,
  EventSubscriber,
} from './transaction';
