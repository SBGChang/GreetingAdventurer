// modules/combat-sequence/public.ts
// Combat Sequence 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。
// Composition 只從這裡取得 state 工廠、handler、query、resolver/allocator 工廠，不深入子檔。

import type {
  EventSubscriptionId,
  InvariantId,
  ModuleContract,
  ModuleId,
  ReaderPortId,
  StateSliceName,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/combat-sequence';

// ── State slice 與工廠 ────────────────────────────────────────────────────
export {
  createInitialCombatSequenceState,
  tryGetSequence,
  isInFlight,
  findInFlightSequenceForTeam,
  currentChallengeOf,
  listResults,
  listSuccessfulResults,
  upsertSequence,
  removeSequence,
} from './state';
export type {
  CombatSequenceModuleState,
  CombatSequenceAggregate,
  CombatSequencePendingRetry,
  CombatSequenceSettlementRecord,
} from './state';

// ── System（Internal Command Handler + Event Subscriber + 純 Resolver/Allocator + 注入 Port）──
export {
  COMBAT_SEQUENCE_MODULE_ID,
  COMBAT_SEQUENCE_REJECTIONS,
  COMBAT_SEQUENCE_RETRY_SUPPLY_SUBSCRIPTION,
  // Internal Command
  handleStartCombatSequence,
  handleResolveNextCombatSequenceChallenge,
  handleSkipNextCombatSequenceChallenge,
  handleStopCombatSequence,
  handleCommitCombatSequenceSourceResults,
  handleInvalidateCombatSequence,
  handleReleaseCombatSequence,
  // Domain Event Subscriber
  onCombatSequenceRetrySupplyConsumed,
  // 純函式 Resolver / Allocator（doc §5）
  createCombatSequenceChallengeResolver,
  createCombatSequenceMasteryAllocator,
  defenseRowWeightOf,
  listChallengeResults,
} from './system';
export type {
  CombatSequenceContext,
  CombatSequenceHandlerResult,
  CombatSequenceSuccessChancePort,
  CombatSequenceRetrySupplyConsumedPayload,
} from './system';

// ── Query ─────────────────────────────────────────────────────────────────
export { createCombatSequenceQuery } from './queries';

// ── ModuleContract 宣告（doc §10 交接清單對照）─────────────────────────────
// 事件綁定與執行順序由 Composition Manifest 唯一擁有；此處只宣告本模組可提供的 Handler。
export const combatSequenceModuleContract: ModuleContract = {
  id: 'combat-sequence' as ModuleId<'combat-sequence'>,
  owns: 'combatSequence' as StateSliceName,
  reads: [
    'reader:combat-sequence-definition' as ReaderPortId,
    'reader:combat-sequence-retry-supply' as ReaderPortId,
    'reader:combat-sequence-success-chance' as ReaderPortId,
  ],
  // startSingleBattleSweep 的入口是 **Workflow**（doc §9：`app/workflows/single-battle-sweep`），
  // 不是本模組——它必須先組出 Allocation Snapshot（Team + Inventory + Progression + Combat Power），
  // 而那個組合刻意只存在 app/composition。本模組不得宣告接收它。
  handlesGameCommands: [],
  handlesInternalCommands: [
    'StartCombatSequence',
    'ResolveNextCombatSequenceChallenge',
    'SkipNextCombatSequenceChallenge',
    'StopCombatSequence',
    'CommitCombatSequenceSourceResults',
    'InvalidateCombatSequence',
    'ReleaseCombatSequence',
  ],
  // 本模組沒有每日 Job：由 Dungeon 或單場掃蕩 Workflow 驅動（doc §1.2）。
  handlesJobs: [],
  // 誠實宣告：補品重骰必須送這一筆給 inventory（doc §6.3）。inventory 目前**沒有**這個 Handler，
  // 所以 registry 的「送出端 → Owner」交叉驗證會擋下本模組的登記——那正是它存在的目的
  // （contracts/core/module.ts 記載的 R15 P1-5：未宣告的送出才是 bug）。
  // 解法是在 inventory 實作 ConsumeCombatSequenceRetrySupply，不是把這一行拿掉。
  sendsInternalCommands: ['ConsumeCombatSequenceRetrySupply'],
  subscriptionHandlerIds: [
    'subscription.CombatSequenceRetrySupplyConsumed.combat-sequence' as EventSubscriptionId,
  ],
  emits: [
    'CombatSequenceChallengeResolved',
    'CombatSequenceReadyForSourceCommit',
    'CombatSequenceSettled',
    'CombatAttackMasteryEarned',
    'CombatDefenseMasteryEarned',
    'CombatSupportMasteryEarned',
    'CombatSequenceInvalidated',
  ],
  invariants: [
    'combat-sequence/one-in-flight-per-team' as InvariantId,
    'combat-sequence/challenge-order-contiguous' as InvariantId,
    'combat-sequence/cursor-forward-only' as InvariantId,
    'combat-sequence/snapshot-immutable-during-run' as InvariantId,
    'combat-sequence/retry-requires-consumed-supply' as InvariantId,
    'combat-sequence/failure-stops-remaining-challenges' as InvariantId,
    'combat-sequence/only-accepted-success-grants-mastery' as InvariantId,
    'combat-sequence/settled-grants-exactly-once' as InvariantId,
    'combat-sequence/rng-draw-index-advances-per-roll' as InvariantId,
    'combat-sequence/release-requires-terminal-status' as InvariantId,
  ],
};

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是模組的**正式對外面**。從這裡再匯出 fixtures 或 test runner，等於讓正式依賴圖
// 可以走到測試資料——規範 §13 的判準是「只要正式程式**可以**引用就算違反」，不需要真的用到。
// 測試請直接 import './fixtures' 與 './combat-sequence.test'。
