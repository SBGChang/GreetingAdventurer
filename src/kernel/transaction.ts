// kernel/transaction.ts
// 泛型 TransactionRunner 骨架（對應 12_engine_runtime.md §3 與 00_shared_contracts.md §5）。
//
// 職責：immutable baseState + 可變 workingState、訊息佇列、commit（產出 committed outbox）
//       或 reject（回傳原始 State）。
// 非職責：不放任何模組規則、不硬編任何具體模組。所有 slice-registry 與 handler map 皆由
//         呼叫者注入（route*／applyMutation），kernel 只負責路由順序、因果收斂與原子性。

import type {
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
export type SliceMutation = Readonly<{
  sliceName: string;
  nextSlice: unknown;
  notifications?: readonly NotificationDraft[];
}>;

type Accepted = Readonly<{
  accepted: true;
  mutation: SliceMutation;
  // 產生的後續訊息；保留相對順序並優先於呼叫者尚未處理的訊息（§3.1 rule 8）。
  outgoing?: readonly TransactionMessageDraft[];
}>;

type Rejected = Readonly<{ accepted: false; rejection: CommandRejection }>;

// Root（Game Command 或到期 Job）入口 Handler：可接受或拒絕整筆交易。
export type RootHandler<TState> = (ctx: HandlerContext<TState>) => Accepted | Rejected;

// Internal Command：唯一目標 Handler，可拒絕（Required 被拒 → 整筆交易回滾，見 §3.2）。
export type InternalCommandHandler<TState> = (
  command: unknown,
  ctx: HandlerContext<TState>,
) => Accepted | Rejected;

// Domain Event Subscriber：不可拒絕已發生事實（§7.2 rule 6），只回傳自己 slice 的變更與後續訊息。
export type EventSubscriber<TState> = (
  event: unknown,
  ctx: HandlerContext<TState>,
) => Readonly<{ mutation: SliceMutation; outgoing?: readonly TransactionMessageDraft[] }>;

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
      if (outcome.outgoing && outcome.outgoing.length > 0) {
        queue.unshift(...outcome.outgoing);
      }
    } else {
      // Domain Event：先讓全部 Subscriber 依固定順序完成，再把它們的訊息作為下一層因果（§3.1 rule 9）。
      const subscribers = config.routeEventSubscribers(draft);
      const collected: TransactionMessageDraft[] = [];
      for (const subscriber of subscribers) {
        const reaction = subscriber(draft.event, { workingState });
        workingState = config.applyMutation(workingState, reaction.mutation);
        notificationTally += notificationCount(reaction.mutation);
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

  const committedOutbox: CommittedOutbox = {
    transactionId,
    eventCount,
    notificationCount: notificationTally,
  };
  return { accepted: true, state: workingState, result: rootResult, committedOutbox };
}
