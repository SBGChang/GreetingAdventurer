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
export type { DungeonContext, DungeonMapPort, DungeonTeamPort, DungeonHandlerResult } from './system';
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
  handleCombatSequenceSettled,
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
  // **不註冊任何能力**：整條流程依賴不存在的 Distribution 模組（見 contracts/dungeon 的說明）。
  // Handler 與測試都還在，這裡宣告的是「對外開放什麼」，答案目前是「沒有」。
  handlesGameCommands: [
    'moveDungeonRoom',
    'openDungeonDoor',
    'interactDungeonContent',
    'resolveDungeonInteraction',
  ],
  handlesInternalCommands: [],
  handlesJobs: [],
  // 只宣告**有 Owner** 的送出。Distribution 三筆無人接收，因此送出它們的流程
  // （入場／離場／NPC 結算／戰敗收斂）一律不註冊——宣告送出一個沒人收的命令，
  // 等於保證那條流程跑不完。
  sendsInternalCommands: ['OpenMapDoor', 'ResolvePlayerMapContent'],
  // 只登記**已實作**的 subscriber（原本宣告 9 筆但只寫了 4 個函式；宣告卻沒有實作會讓啟動
  // 驗證誤放行、路由時才炸）。其餘待 combat-sequence / map 刷新反應實作後再加回。
  // 命名依 12_engine_runtime.md §5.2 的 `subscription.<eventType>.<subscriber>`。
  // 這兩筆的 Handler（handleCombatEncounterResolved / handleNpcDungeonSettlementApplied）一直都
  // 存在，但先前**刻意不宣告**：它們的收斂路徑會送 Distribution 命令，而 Distribution 模組不存在，
  // 訂閱者又不能拒絕已發生的事實——宣告了就是宣告一個走不完的流程。Wave D 讓 Distribution 落地，
  // 這條路才真的閉合，於是宣告回來。（combat-sequence 相關的 4 筆仍未宣告：那是缺 subscriber
  // 實作，不是缺別的模組。）
  subscriptionHandlerIds: [
    'subscription.CombatEncounterResolved.dungeon' as EventSubscriptionId,
    'subscription.NpcDungeonSettlementApplied.dungeon' as EventSubscriptionId,
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
