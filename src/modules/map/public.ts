// modules/map/public.ts
// Map 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。
// Composition 只從這裡取得工廠、Handler、Query、Fixture 與 ModuleContract；不得深入 import 內部檔案。

import type {
  ModuleContract,
  ModuleId,
  StateSliceName,
  ReaderPortId,
  EventSubscriptionId,
  InvariantId,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/map';

// ── State ─────────────────────────────────────────────────────────────────––
export {
  emptyMapState,
  createMapState,
  tryGetInstance,
  requireInstance,
  upsertInstance,
  tryGetContent,
  upsertContent,
  listContentIdsForMap,
  listContentsForMap,
  buildSpatialRuntime,
  eligibleContentRoomIds,
  functionalRoomIds,
  isRedDoorLink,
} from './state';
export type { MapState } from './state';

// ── Query ─────────────────────────────────────────────────────────────────––
export { createMapQuery, isMapOccupied, isTeamOnMap } from './queries';

// ── System（Handler + Job + Subscriber + Deps）──────────────────────────────
export {
  MAP_MODULE_ID,
  // Job handler
  handleMapRefreshCheck,
  // Event subscriber
  onTeamLocationChanged,
  // Internal Command handlers
  handleOpenMapDoor,
  handleResolveMapTrap,
  handleHarvestMapGatheringNode,
  handleResolvePlayerMapContent,
  handleApplyNpcDungeonSettlement,
  handleProtectMapContent,
  handleSetMapRefreshLock,
} from './system';
export type {
  MapHandlerContext,
  MapHandlerResult,
  MapIdAllocator,
  MapContentResolver,
  SpawnDraft,
} from './system';



// ── ModuleContract 宣告（doc §9 交接清單對照）─────────────────────────────────
// 事件綁定與執行順序由 Composition Manifest 唯一擁有；此處只宣告本模組可提供的 Handler。
export const mapModuleContract: ModuleContract = {
  id: 'map' as ModuleId<'map'>,
  owns: 'map' as StateSliceName,
  reads: [
    'reader:map-definition' as ReaderPortId,
    'reader:world-query' as ReaderPortId,
    'reader:team-presence' as ReaderPortId,
  ],
  handlesGameCommands: [],
  handlesInternalCommands: [
    'SetMapRefreshLock',
    'ProtectMapContent',
    'ResolvePlayerMapContent',
    'ApplyNpcDungeonSettlement',
    'OpenMapDoor',
    'ResolveMapTrap',
    'HarvestMapGatheringNode',
  ],
  handlesJobs: ['mapRefreshCheck'],
  sendsInternalCommands: [],
  subscriptionHandlerIds: ['subscription.TeamLocationChanged.map' as EventSubscriptionId],
  emits: [
    'MapRefreshed',
    'MapContentGenerated',
    'MapContentResolved',
    'MapRefreshPendingRegistered',
    'NpcDungeonSettlementApplied',
    'MapRefreshLockChanged',
    'MapDoorOpened',
    'MapTrapResolved',
    'MapGatheringNodeHarvested',
  ],
  invariants: [
    'map.spatialVersionMatchesCurrent' as InvariantId,
    'map.doorStatesExactlyRedDoors' as InvariantId,
    'map.oneContentSlotPerRoom' as InvariantId,
    'map.npcOrderGloballyUnique' as InvariantId,
    'map.resolvedContentNotReResolvable' as InvariantId,
    'map.protectedContentSurvivesRefresh' as InvariantId,
  ],
};

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是模組的**正式對外面**。從這裡再匯出 fixtures 或 test runner，等於讓正式依賴圖
// 可以走到測試資料——規範 §13 的判準是「只要正式程式**可以**引用就算違反」，不需要真的用到。
// 測試請直接 import './fixtures' 與 './<module>.test'。門禁：scripts/verify-runtime-discipline.ts
