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
export type { DungeonContext, DungeonMapPort, DungeonTeamPort } from './system';
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
    'combat-sequence-host-port' as ReaderPortId,
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
  subscriptionHandlerIds: [
    'dungeon/on-npc-settlement-applied',
    'dungeon/on-combat-sequence-settled',
    'dungeon/on-asset-distribution-completed',
    'dungeon/on-combat-sequence-challenge-resolved',
    'dungeon/on-combat-sequence-ready-for-source-commit',
    'dungeon/on-combat-sequence-invalidated',
    'dungeon/on-team-location-changed',
    'dungeon/on-combat-encounter-resolved',
    'dungeon/on-map-refreshed',
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
