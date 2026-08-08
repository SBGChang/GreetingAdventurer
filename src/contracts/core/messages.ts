// contracts/core/messages.ts
// 四種訊息模型的共用信封、結果與 Draft。對應 00_shared_contracts.md §5。
// 具體的 GameCommand／GameInternalCommand／GameDomainEvent 聯集屬 app/composition，不在 core 定義。

import type { JsonValue } from './primitives';
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

export type CommandRejection = Readonly<{
  code: string;
  sourceModule: ModuleId;
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
  | Readonly<{ accepted: true; state: TState; result: TResult; committedOutbox: CommittedOutbox }>
  | Readonly<{ accepted: false; state: TState; rejection: CommandRejection }>;

export type CommittedOutbox = Readonly<{
  transactionId: TransactionId;
  // events 與 notifications 的具體型別由 composition 帶入；core 只固定信封欄位存在。
  eventCount: number;
  notificationCount: number;
}>;
