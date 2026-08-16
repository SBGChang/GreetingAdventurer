// contracts/core/messages.ts
// 四種訊息模型的共用信封、結果與 Draft。對應 00_shared_contracts.md §5。
// 具體的 GameCommand／GameInternalCommand／GameDomainEvent 聯集屬 app/composition，不在 core 定義。

import type { JsonValue } from './primitives';
import type { KernelRequest } from './module';
import type { WorldDay } from './primitives';
import type {
  ClientRequestId,
  CommandId,
  CorrelationId,
  EventId,
  JobId,
  ModuleId,
  MessageSourceId,
  TeamId,
  TransactionId,
} from './ids';

// ──────────────────────────────────────────────────────────────────────────
// 訊息判別欄約定（B.5 收斂，全專案唯一）
//
// 每一個 Game Command／Internal Command／Domain Event payload **必須**帶一個字面值
// `type` 欄位，值等於該訊息型別名（去掉 `Command`／`Event` 後綴）。理由：
//   1. TransactionMessageDraft 以 `unknown` 承載 payload（core 不得知道具體聯集），
//      因此 Router 只能靠 payload 自身的判別欄分派；沒有判別欄的 payload 無法路由。
//   2. 判別鍵曾出現 `kind:`／`type:`／無 三種寫法，導致收送兩端靜默對不上。
//      統一為 `type`，並保留 `kind` 給**領域模型**的變體（如 ItemLocation.kind、
//      CombatEncounterSource.kind）——兩者語意不同，不得混用。
//
// 註：`TaggedMessage` 只是宣告意圖用的輔助別名，contracts 內多數型別直接內嵌
// `type: 'X'` 欄位即可，不強制透過它建構。
// ──────────────────────────────────────────────────────────────────────────
export type TaggedMessage<TType extends string, TPayload> = Readonly<{ type: TType }> & TPayload;

// 任何可被 Router 分派的訊息的結構性下界。
export type AnyTaggedMessage = Readonly<{ type: string }>;

// 拒絕的來源可能是三種之一：擁有 Slice 的模組、組合層的 Workflow、或 Kernel 自己（例如 Job 未到期）。
// 原本只宣告 `sourceModule: ModuleId`，於是 Workflow 與 kernel 都得 `as unknown as ModuleId` 硬轉——
// 型別上不可信，UI 與日誌也無法安全區分是誰拒的（複審 R15 P1-3）。
export const KERNEL_REJECTION_SOURCE = 'kernel' as const;
export type KernelSourceId = typeof KERNEL_REJECTION_SOURCE;
export type RejectionSourceId = MessageSourceId | KernelSourceId;

export type CommandRejection = Readonly<{
  code: string;
  source: RejectionSourceId;
  details?: Readonly<Record<string, string | number | boolean>>;
}>;

// View 只建立不含核心 ID／世界日的 Request；GameSession 在交易私有 cursor 內建立 Envelope。
export type GameCommandRequest<TCommand> = Readonly<{
  clientRequestId?: ClientRequestId; // 只供 UI 對應 pending 狀態；不進 GameState／Outbox
  actorTeamId: TeamId;
  command: TCommand;
}>;

export type GameCommandEnvelope<TCommand> = Readonly<{
  commandId: CommandId;
  transactionId: TransactionId;
  correlationId: CorrelationId;
  issuedAtWorldDay: WorldDay;
  actorTeamId: TeamId;
  command: TCommand;
}>;

export type GameCommandResult<TResult> =
  | Readonly<{ accepted: true; result: TResult }>
  | Readonly<{ accepted: false; rejection: CommandRejection }>;

export type InternalCommandEnvelope<TCommand> = Readonly<{
  commandId: CommandId;
  transactionId: TransactionId;
  correlationId: CorrelationId;
  causationId: CommandId | EventId | JobId;
  source: MessageSourceId;
  targetModule: ModuleId;
  command: TCommand;
}>;

export type InternalCommandResult<TResult> =
  | Readonly<{ accepted: true; commandId: CommandId; result: TResult }>
  | Readonly<{ accepted: false; commandId: CommandId; rejection: CommandRejection }>;

// Draft 不含信封欄位；Transaction Runner 依當前因果來源與交易 cursor 統一補上。
export type InternalCommandDraft<TCommand> = Readonly<{
  targetModule: ModuleId;
  command: TCommand;
}>;

export type DomainEventDraft<TEvent> = Readonly<{
  event: TEvent;
}>;

// core 層以 unknown 承載尚未由 composition 收斂的具體聯集。
export type TransactionMessageDraft =
  | InternalCommandDraft<unknown>
  | DomainEventDraft<unknown>;

// 整筆引擎交易是否完成（不同於 Command Handler 的 GameCommandResult）。
// state 型別交由 app/composition 具體化（GameState）；core 以泛型 TState 表示。
export type CommandExecutionResult<TState, TResult extends JsonValue = JsonValue> =
  | Readonly<{
      accepted: true;
      state: TState;
      result: TResult;
      committedOutbox: CommittedOutbox;
      // 交易內累積的 Kernel 請求（目前僅 AdvanceWorldToDay）。刻意**不**在交易內執行：
      // advanceWorldToDay 會再開新交易，於交易內遞迴會破壞原子性。由 GameSession 於提交後執行。
      kernelRequests?: readonly KernelRequest[];
    }>
  | Readonly<{ accepted: false; state: TState; rejection: CommandRejection }>;

export type CommittedOutbox = Readonly<{
  transactionId: TransactionId;
  // events 與 notifications 的具體型別由 composition 帶入；core 只固定信封欄位存在。
  eventCount: number;
  notificationCount: number;
}>;
