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
export {
  FIXTURE,
  createFixtureReader,
  createFixtureMapPort,
  createFixtureTeamPort,
  createFixtureContext,
  createFixtureState,
} from './fixtures';

// ── Tests ──────────────────────────────────────────────────────────────────––
export { runTests, runTestResults, allTestsPass } from './dungeon.test';
export type { DungeonTestResult } from './dungeon.test';

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
  handlesGameCommands: [
    'startPlayerExploration',
    'moveDungeonRoom',
    'openDungeonDoor',
    'interactDungeonContent',
    'resolveDungeonInteraction',
    'useDungeonExit',
    // gatherDungeonNode 不直接路由到 Dungeon Handler（doc §5.1）；由 gathering workflow 轉為
    // ConsumeDungeonGatheringAction。
  ],
  handlesInternalCommands: ['StartNpcDungeonRun', 'ConsumeDungeonGatheringAction'],
  handlesJobs: ['npcDungeonDay'],
  // 送出端宣告：其中兩筆（Distribution）目前**無人接收**，見 UNAVAILABLE_CAPABILITIES。
  sendsInternalCommands: [
    'OpenMapDoor',
    'ResolvePlayerMapContent',
    'ApplyNpcDungeonSettlement',
    'StartCombatEncounter',
    'StartReturnFromDungeon',
    'StartAssetDistribution',
    'FinalizeAssetDistributionCollection',
  ],
  // 只登記**已實作**的 subscriber（原本宣告 9 筆但只寫了 4 個函式；宣告卻沒有實作會讓啟動
  // 驗證誤放行、路由時才炸）。其餘待 combat-sequence / map 刷新反應實作後再加回。
  // 命名依 12_engine_runtime.md §5.2 的 `subscription.<eventType>.<subscriber>`。
  subscriptionHandlerIds: [
    'subscription.NpcDungeonSettlementApplied.dungeon',
    'subscription.CombatSequenceSettled.dungeon',
    'subscription.AssetDistributionCompleted.dungeon',
    'subscription.CombatEncounterResolved.dungeon',
  ] as readonly string[] as readonly EventSubscriptionId[],
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
