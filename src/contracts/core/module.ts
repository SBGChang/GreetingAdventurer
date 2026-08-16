// contracts/core/module.ts
// Definition 共通標頭、模組註冊契約與模組回傳。對應 00_shared_contracts.md §4.2 與 §9。

import type { DefinitionId, WorldDay } from './primitives';
import type {
  ContentPackId,
  EventSubscriptionId,
  InvariantId,
  JobId,
  ModuleId,
  ReaderPortId,
  StateSliceName,
} from './ids';
import type { CommandRejection, TransactionMessageDraft } from './messages';
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
  // 本模組會**送出**哪些 Internal Command。
  //
  // 原本契約只宣告「接收什麼」（handles*）與「發出哪些事件」（emits），沒有任何地方宣告「送出哪些
  // Internal Command」。於是 Registry 無從檢查「送出去的命令有沒有人收」——dungeon 送
  // StartAssetDistribution／FinalizeAssetDistributionCollection，而 Distribution 模組根本不存在，
  // 啟動驗證卻完全看不到；要等玩家真的開始探索，才在交易中因找不到 Owner 而失敗（複審 R15 P1-5）。
  // 宣告了才驗得到：見 registry 的「送出端 → Owner」交叉驗證。
  sendsInternalCommands: readonly string[];
  // 只註冊本模組可提供的 handler；事件綁定與順序由 Composition Manifest 唯一擁有。
  subscriptionHandlerIds: readonly EventSubscriptionId[];
  emits: readonly string[];
  invariants: readonly InvariantId[];
}>;

// Kernel（而非任何領域模組）才能執行的請求。
//
// 背景：`CoreState.worldDay` 由 Kernel 獨占寫入，world 模組並不擁有它——world 契約的
// Internal Command 只有 ChangeRegionControl／SetRouteAccess／ApplyMarketPressure／
// ApplyEventWeightModifier／SetWorldFact 五筆。但 03_dungeon_module.md §140/§4 要求
// 「跨越午夜時，Dungeon 關閉目前分鐘片段並呼叫核心推進下一世界日」，而純函式 Handler
// 不能反向呼叫 Engine 入口 advanceWorldToDay()。ModuleResult 原本沒有表達這件事的通道，
// 導致實作端只好偽造一筆 world 模組命令。此欄位即該通道：Handler 只「請求」，
// 由 Transaction Runner／GameSession 在交易提交後執行。
export type KernelRequest = Readonly<{ type: 'AdvanceWorldToDay'; targetDay: WorldDay }>;

// Handler 純函式回傳；只含自己 Slice 的 nextSlice，不含其他模組 Slice patch。
export type ModuleResult<TSlice> = Readonly<{
  nextSlice: TSlice;
  outgoingMessages: readonly TransactionMessageDraft[];
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[];
  cancelledJobIds?: readonly JobId[];
  notifications?: readonly NotificationDraft[];
  kernelRequests?: readonly KernelRequest[];
}>;

// 全模組唯一的 Handler 回傳形狀（B.5 收斂）。
//
// 背景：Wave B 各模組自行選擇了兩種不相容的拒絕表示法——一種回傳 `{ok,result}|{ok,rejection}`，
// 另一種以「回傳未變 slice」當作 no-op。後者無法讓 Transaction Runner 區分「成功但無變化」與
// 「應回滾整筆交易」，也丟失了 CommandRejection.code。此型別是唯一許可的形狀：
//   - 可拒絕的 Handler（Game Command／Internal Command／Job root）一律回傳 ModuleOutcome。
//   - Event Subscriber 不得拒絕已發生事實（12_engine_runtime.md §7.2 rule 6），仍直接回傳 ModuleResult。
export type ModuleOutcome<TSlice> =
  | Readonly<{ ok: true; result: ModuleResult<TSlice> }>
  | Readonly<{ ok: false; rejection: CommandRejection }>;
