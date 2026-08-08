// contracts/core/module.ts
// Definition 共通標頭、模組註冊契約與模組回傳。對應 00_shared_contracts.md §4.2 與 §9。

import type { DefinitionId } from './primitives';
import type {
  ContentPackId,
  EventSubscriptionId,
  InvariantId,
  JobId,
  ModuleId,
  ReaderPortId,
  StateSliceName,
} from './ids';
import type { TransactionMessageDraft } from './messages';
import type { NotificationDraft } from './values';
import type { AnyScheduledJob, ScheduledJobDraft } from './scheduler';

export type DefinitionHeader<TId extends DefinitionId = DefinitionId> = Readonly<{
  id: TId;
  schemaVersion: number;
  packId: ContentPackId;
  enabled: boolean;
}>;

export type ModuleContract = Readonly<{
  id: ModuleId;
  owns: StateSliceName;
  reads: readonly ReaderPortId[];
  handlesGameCommands: readonly string[];
  handlesInternalCommands: readonly string[];
  handlesJobs: readonly string[];
  // 只註冊本模組可提供的 handler；事件綁定與順序由 Composition Manifest 唯一擁有。
  subscriptionHandlerIds: readonly EventSubscriptionId[];
  emits: readonly string[];
  invariants: readonly InvariantId[];
}>;

// Handler 純函式回傳；只含自己 Slice 的 nextSlice，不含其他模組 Slice patch。
export type ModuleResult<TSlice> = Readonly<{
  nextSlice: TSlice;
  outgoingMessages: readonly TransactionMessageDraft[];
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[];
  cancelledJobIds?: readonly JobId[];
  notifications?: readonly NotificationDraft[];
}>;
