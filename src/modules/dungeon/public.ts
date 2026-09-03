// modules/dungeon/public.ts
// Dungeon 模組對外 Runtime API 的唯一入口（re-export）+ ModuleContract 宣告。
// Composition 只從這裡取得 state 工廠、handler、job、subscriber、query 與 fixture；不得深入子檔。

import type {
  EventSubscriptionId,
  InvariantId,
  ModuleContract,
  ModuleId,
  ReaderPortId,
  StateSliceName,
} from '../../contracts/core';

// ── State slice 與工廠 ───────────────────────────────────────────────────────
export type { DungeonModuleState } from './state';
export {
  createInitialDungeonState,
  getPlayerSession,
  findKnowledge,
  findNpcRunForTeam,
  findNpcRunByDistribution,
} from './state';

// ── System：注入 Port/Context + 玩家 handler + NPC job/command + 結算 subscriber ──
export type {
  DungeonContext,
  DungeonMapPort,
  DungeonTeamPort,
  DungeonResolverPort,
  DungeonCombatSequencePort,
  DungeonSweepMonsterTarget,
  DungeonSweepSequencePlan,
  DungeonHandlerResult,
} from './system';
export {
  DUNGEON_MODULE_ID,
  startPlayerExploration,
  moveDungeonRoom,
  openDungeonDoor,
  interactDungeonContent,
  resolveDungeonInteraction,
  useDungeonExit,
  consumeDungeonGatheringAction,
  startNpcDungeonRun,
  npcDungeonDay,
  handleNpcDungeonSettlementApplied,
  handleCombatSequenceChallengeResolved,
  handleCombatSequenceReadyForSourceCommit,
  handleCombatSequenceSettled,
  handleCombatSequenceInvalidated,
  handleAssetDistributionCompleted,
  handleCombatEncounterResolved,
  dungeonSubscribers,
} from './system';

// ── Query port ───────────────────────────────────────────────────────────────
export { makeDungeonQuery } from './queries';

// ── Fixtures ─────────────────────────────────────────────────────────────────


// ── Module contract（doc §10 交接清單對照）──────────────────────────────────
// 事件綁定與執行順序由 Composition Manifest 唯一擁有；此處只宣告本模組可提供的 Handler。
export const dungeonModuleContract: ModuleContract = {
  id: 'dungeon' as ModuleId,
  owns: 'dungeon' as StateSliceName,
  reads: [
    'dungeon-definition-reader' as ReaderPortId,
    'map-query' as ReaderPortId,
    'team-query' as ReaderPortId,
    'asset-distribution-query' as ReaderPortId,
    // combat-sequence 不是「讀」的 Port：改走 Internal Command（out）+ 事件訂閱（in），見 contracts/dungeon。
  ],
  // 這裡宣告的是「**由 dungeon 模組直接接收**什麼」。
  //
  // `resolveDungeonInteraction` 不在此列：它的入口是 content-event-resolution Workflow
  //（選項效果會作用到 inventory／character／world，dungeon 不得同步呼叫它們）。Workflow 驗過並
  // 派發效果後才委派 dungeon 寫自己的 Slice。§5.1 禁止一個 Game Command 同時有模組入口與
  // Workflow 入口——啟動驗證會擋下，別把它加回來。
  handlesGameCommands: [
    'startPlayerExploration',
    'moveDungeonRoom',
    'openDungeonDoor',
    'interactDungeonContent',
    'useDungeonExit',
  ],
  handlesInternalCommands: [],
  handlesJobs: [],
  // 本模組**會送出**的全部 Internal Command。這張表的用途是啟動時的「送出端 → Owner」交叉驗證：
  // 送出一個沒人接收的命令，等於保證那條流程跑不完。
  //
  // 先前這裡只有兩筆，因為 Distribution 與 Combat Sequence 都還不存在。兩者於 Wave D 落地後，
  // 下列每一筆都有 Owner；漏報反而讓交叉驗證看不到真正的送出面——`ResolveMapTrap` 與
  // `StartCombatEncounter` 就是例子：它們由**已註冊**的 moveDungeonRoom／interactDungeonContent
  // 送出，卻一直不在這張表上。
  sendsInternalCommands: [
    'OpenMapDoor',
    'ResolveMapTrap',
    'ResolvePlayerMapContent',
    'ApplyNpcDungeonSettlement',
    'StartCombatEncounter',
    'StartAssetDistribution',
    'FinalizeAssetDistributionCollection',
    'StartReturnFromDungeon',
    'StartCombatSequence',
    'ResolveNextCombatSequenceChallenge',
    'SkipNextCombatSequenceChallenge',
    'StopCombatSequence',
    'CommitCombatSequenceSourceResults',
    'InvalidateCombatSequence',
  ],
  // 只登記**已實作**的 subscriber（原本宣告 9 筆但只寫了 4 個函式；宣告卻沒有實作會讓啟動
  // 驗證誤放行、路由時才炸）。其餘待 combat-sequence / map 刷新反應實作後再加回。
  // 命名依 12_engine_runtime.md §5.2 的 `subscription.<eventType>.<subscriber>`。
  // 這兩筆的 Handler（handleCombatEncounterResolved / handleNpcDungeonSettlementApplied）一直都
  // 存在，但先前**刻意不宣告**：它們的收斂路徑會送 Distribution 命令，而 Distribution 模組不存在，
  // 訂閱者又不能拒絕已發生的事實——宣告了就是宣告一個走不完的流程。Wave D 讓 Distribution 落地，
  // 這條路才真的閉合，於是宣告回來。（combat-sequence 相關的 4 筆仍未宣告：那是缺 subscriber
  // 實作，不是缺別的模組。）
  //
  // Wave E：四筆 Combat Sequence 訂閱與 AssetDistributionCompleted 的 Handler 現在都存在
  //（handleCombatSequenceChallengeResolved / …ReadyForSourceCommit / …Settled / …Invalidated /
  // handleAssetDistributionCompleted），所以一併宣告。
  //
  // **這五筆必須由整合者同時加進 `manifest.ts` 的 EVENT_SUBSCRIPTIONS_BY_TYPE 與 `router.ts` 的
  // EVENT_SUBSCRIBERS。** 少了綁定，怪物內容送出的 ResolveNextCombatSequenceChallenge 會拿不到
  // 結果，NPC Run 會停在 `awaitingCombatChallengeId` 且不再排 Job——不會有任何測試失敗，
  // 那條 Run 只是安靜地不動了。（NPC 流程與玩家入場目前都未註冊，故沒有現行影響。）
  subscriptionHandlerIds: [
    'subscription.CombatEncounterResolved.dungeon' as EventSubscriptionId,
    'subscription.NpcDungeonSettlementApplied.dungeon' as EventSubscriptionId,
    'subscription.AssetDistributionCompleted.dungeon' as EventSubscriptionId,
    'subscription.CombatSequenceChallengeResolved.dungeon' as EventSubscriptionId,
    'subscription.CombatSequenceReadyForSourceCommit.dungeon' as EventSubscriptionId,
    'subscription.CombatSequenceSettled.dungeon' as EventSubscriptionId,
    'subscription.CombatSequenceInvalidated.dungeon' as EventSubscriptionId,
  ] as readonly EventSubscriptionId[],
  emits: [
    'PlayerDungeonSessionStarted',
    'PlayerDungeonTimeAdvanced',
    'PlayerInteractionOpened',
    'MapExplorationCompleted',
    'NpcDungeonRunProgressed',
    'NpcDungeonRunClosed',
  ],
  invariants: [
    'dungeon/one-active-run-per-team' as InvariantId,
    'dungeon/run-map-version-locked' as InvariantId,
    'dungeon/npc-order-strictly-increasing' as InvariantId,
    'dungeon/cursor-forward-only' as InvariantId,
    'dungeon/close-requires-triple-settlement' as InvariantId,
  ],
};

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是模組的**正式對外面**。從這裡再匯出 fixtures 或 test runner，等於讓正式依賴圖
// 可以走到測試資料——規範 §13 的判準是「只要正式程式**可以**引用就算違反」，不需要真的用到。
// 測試請直接 import './fixtures' 與 './<module>.test'。門禁：scripts/verify-runtime-discipline.ts
