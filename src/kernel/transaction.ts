// kernel/transaction.ts
// 泛型 TransactionRunner 骨架（對應 12_engine_runtime.md §3 與 00_shared_contracts.md §5）。
//
// 職責：immutable baseState + 可變 workingState、訊息佇列、commit（產出 committed outbox）
//       或 reject（回傳原始 State）。
// 非職責：不放任何模組規則、不硬編任何具體模組。所有 slice-registry 與 handler map 皆由
//         呼叫者注入（route*／applyMutation），kernel 只負責路由順序、因果收斂與原子性。

import type {
  AnyScheduledJob,
  JobId,
  KernelRequest,
  ScheduledJobDraft,
  TransactionId,
  CommandRejection,
  CommittedOutbox,
  CommandExecutionResult,
  TransactionMessageDraft,
  InternalCommandDraft,
  DomainEventDraft,
  NotificationDraft,
  JsonValue,
} from '../contracts/core';

// 訊息數上限的安全預設（呼叫者可透過 EngineSafetyLimits 覆寫）。
const DEFAULT_MAX_MESSAGES = 100_000;

// Handler／Subscriber 只看到最新 workingState（同交易前段的暫定變更可被觀察，見 §3.1 rule 3）。
export type HandlerContext<TState> = Readonly<{ workingState: TState }>;

// Handler 只回傳「自己這一片 slice 的下一版」與可選通知；由 applyMutation 併回 workingState。
// slice 名稱僅為結構鍵，kernel 不解讀；跨 slice 寫入由 applyMutation 的實作阻擋。
//
// scheduledJobs / cancelledJobIds / kernelRequests 是 ModuleResult 的其餘三個輸出通道。
// 它們**不是** slice 寫入：Scheduler 與 worldDay 都屬 core，由 Kernel 獨占
// （00_shared_contracts.md §6.2），故 Runner 於此集中收集，不讓模組直接碰 core。
export type SliceMutation = Readonly<{
  sliceName: string;
  nextSlice: unknown;
  notifications?: readonly NotificationDraft[];
  scheduledJobs?: readonly ScheduledJobDraft<AnyScheduledJob>[];
  cancelledJobIds?: readonly JobId[];
  kernelRequests?: readonly KernelRequest[];
}>;

// 交易期間累積、提交時才落地的排程異動。
export type SchedulingEffects = Readonly<{
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[];
  cancelledJobIds: readonly JobId[];
}>;

export type HandlerAccepted = Readonly<{
  accepted: true;
  mutation: SliceMutation;
  // 產生的後續訊息；保留相對順序並優先於呼叫者尚未處理的訊息（§3.1 rule 8）。
  outgoing?: readonly TransactionMessageDraft[];
}>;

export type HandlerRejected = Readonly<{ accepted: false; rejection: CommandRejection }>;

// Root（Game Command 或到期 Job）入口 Handler：可接受或拒絕整筆交易。
export type RootHandler<TState> = (ctx: HandlerContext<TState>) => HandlerAccepted | HandlerRejected;

// Internal Command：唯一目標 Handler，可拒絕（Required 被拒 → 整筆交易回滾，見 §3.2）。
export type InternalCommandHandler<TState> = (
  command: unknown,
  ctx: HandlerContext<TState>,
) => HandlerAccepted | HandlerRejected;

// Domain Event Subscriber：不可拒絕已發生事實（§7.2 rule 6），只回傳自己 slice 的變更與後續訊息。
// mutation 可省略：Workflow 訂閱者只反應事件、送出後續 Internal Command，本身不擁有 Slice，故無 mutation。
export type EventSubscriber<TState> = (
  event: unknown,
  ctx: HandlerContext<TState>,
) => Readonly<{ mutation?: SliceMutation; outgoing?: readonly TransactionMessageDraft[] }>;

// 全部路由與狀態併合皆注入；kernel 不 import 任何具體模組或 GameState。
export type TransactionRunnerConfig<TState> = Readonly<{
  // 把單片 slice 變更併回完整 State（由 composition 保證只寫入宣告 slice）。
  applyMutation: (state: TState, mutation: SliceMutation) => TState;
  // Internal Command → 唯一 Handler；找不到 = 啟動／註冊錯誤。
  routeInternalCommand: (
    draft: InternalCommandDraft<unknown>,
  ) => InternalCommandHandler<TState> | undefined;
  // Domain Event → 依 Manifest 固定順序的零到多個 Subscriber。
  routeEventSubscribers: (draft: DomainEventDraft<unknown>) => readonly EventSubscriber<TState>[];
  // 交易接受時，把整筆累積的排程異動一次寫入 core.scheduler（配發 JobId 亦在此）。
  // 拒絕時完全不呼叫——排程與 slice 一樣是全有全無。
  applyScheduling: (state: TState, effects: SchedulingEffects) => TState;
  maxMessagesPerTransaction?: number;
}>;

function isInternalCommandDraft(
  draft: TransactionMessageDraft,
): draft is InternalCommandDraft<unknown> {
  return 'command' in draft;
}

function notificationCount(mutation: SliceMutation): number {
  return mutation.notifications?.length ?? 0;
}

// 執行一筆交易。baseState 永不改動；成功時回傳 committed workingState 與 outbox，
// 拒絕時原封回傳 baseState（不保留任何 slice／訊息／通知）。
export function runTransaction<TState, TResult extends JsonValue = JsonValue>(
  config: TransactionRunnerConfig<TState>,
  baseState: TState,
  transactionId: TransactionId,
  rootHandler: RootHandler<TState>,
  rootResult: TResult,
): CommandExecutionResult<TState, TResult> {
  const maxMessages = config.maxMessagesPerTransaction ?? DEFAULT_MAX_MESSAGES;

  const root = rootHandler({ workingState: baseState });
  if (!root.accepted) {
    return { accepted: false, state: baseState, rejection: root.rejection };
  }

  let workingState = config.applyMutation(baseState, root.mutation);
  let eventCount = 0;
  let notificationTally = notificationCount(root.mutation);

  // 排程異動與 Kernel 請求跨整筆交易累積；提交時才落地／回傳。
  const scheduledJobs: ScheduledJobDraft<AnyScheduledJob>[] = [];
  const cancelledJobIds: JobId[] = [];
  const kernelRequests: KernelRequest[] = [];
  const collect = (mutation: SliceMutation): void => {
    if (mutation.scheduledJobs) scheduledJobs.push(...mutation.scheduledJobs);
    if (mutation.cancelledJobIds) cancelledJobIds.push(...mutation.cancelledJobIds);
    if (mutation.kernelRequests) kernelRequests.push(...mutation.kernelRequests);
  };
  collect(root.mutation);

  // 佇列以「front = 下一個要處理」運作；新產生的訊息 unshift 到最前，達成直接因果先收斂。
  const queue: TransactionMessageDraft[] = root.outgoing ? [...root.outgoing] : [];
  let steps = 0;

  while (queue.length > 0) {
    steps += 1;
    if (steps > maxMessages) {
      throw new Error(`交易訊息數超過上限 ${maxMessages}（疑似無限因果迴圈）`);
    }
    const draft = queue.shift();
    if (draft === undefined) break;

    if (isInternalCommandDraft(draft)) {
      const handler = config.routeInternalCommand(draft);
      if (handler === undefined) {
        throw new Error(`找不到 Internal Command Handler，targetModule=${String(draft.targetModule)}`);
      }
      const outcome = handler(draft.command, { workingState });
      if (!outcome.accepted) {
        // Required Internal Command 被拒 → 整筆交易回滾至原始 State。
        return { accepted: false, state: baseState, rejection: outcome.rejection };
      }
      workingState = config.applyMutation(workingState, outcome.mutation);
      notificationTally += notificationCount(outcome.mutation);
      collect(outcome.mutation);
      if (outcome.outgoing && outcome.outgoing.length > 0) {
        queue.unshift(...outcome.outgoing);
      }
    } else {
      // Domain Event：先讓全部 Subscriber 依固定順序完成，再把它們的訊息作為下一層因果（§3.1 rule 9）。
      const subscribers = config.routeEventSubscribers(draft);
      const collected: TransactionMessageDraft[] = [];
      for (const subscriber of subscribers) {
        const reaction = subscriber(draft.event, { workingState });
        // Workflow 訂閱者可無 mutation（只送後續命令）；有 mutation 才併回 Working State。
        if (reaction.mutation !== undefined) {
          workingState = config.applyMutation(workingState, reaction.mutation);
          notificationTally += notificationCount(reaction.mutation);
          collect(reaction.mutation);
        }
        if (reaction.outgoing && reaction.outgoing.length > 0) {
          collected.push(...reaction.outgoing);
        }
      }
      eventCount += 1;
      if (collected.length > 0) {
        queue.unshift(...collected);
      }
    }
  }

  // 排程於提交時一次落地（core 由 Kernel 獨占寫入）。
  const committedState = config.applyScheduling(workingState, { scheduledJobs, cancelledJobIds });

  const committedOutbox: CommittedOutbox = {
    transactionId,
    eventCount,
    notificationCount: notificationTally,
  };
  return {
    accepted: true,
    state: committedState,
    result: rootResult,
    committedOutbox,
    // KernelRequest 刻意不在交易內執行：advanceWorldToDay 會再開新交易，
    // 於交易內遞迴會破壞原子性。由呼叫者（GameSession）於提交後執行。
    ...(kernelRequests.length > 0 ? { kernelRequests } : {}),
  };
}
