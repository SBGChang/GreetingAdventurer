// modules/world/public.ts
// World 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。
// Composition 只從這裡取得工廠、Handler、Query 與 ModuleContract；不得深入 import 內部檔案。

import type {
  ModuleContract,
  ModuleId,
  StateSliceName,
  ReaderPortId,
  InvariantId,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/world';

// ── State ─────────────────────────────────────────────────────────────────––
export {
  emptyWorldState,
  createWorldState,
  initialRegionControl,
  definitionRouteAccess,
  effectiveRouteAccess,
  tryGetRegionControl,
  tryGetRouteState,
  tryGetConflict,
  tryGetMarketPressure,
  tryGetEventWeightModifier,
  tryGetFact,
  listMarketPressureStates,
  listEventWeightModifierStates,
  isControlledBy,
  otherEndOf,
  conflictRngStream,
} from './state';
export type { WorldState } from './state';

// ── Query ─────────────────────────────────────────────────────────────────––
export { createWorldQuery } from './queries';

// ── System（Internal Command + Job Handler + Deps）──────────────────────────
export {
  WORLD_MODULE_ID,
  // Internal Command handlers
  handleChangeRegionControl,
  handleSetRouteAccess,
  handleApplyMarketPressure,
  handleApplyEventWeightModifier,
  handleSetWorldFact,
  // Job handlers
  handleWorldConflictCheck,
  handleWorldConflictResolve,
  handleMarketPressureExpire,
  handleEventWeightModifierExpire,
} from './system';
export type {
  WorldHandlerContext,
  WorldHandlerResult,
  WorldIdAllocator,
  WorldAdventureMapPort,
  WorldConflictResolverPort,
  ConflictStartDraft,
  ConflictEligibilityResult,
  ConflictOutcomeResult,
} from './system';

// ── ModuleContract 宣告（doc §9 交接清單對照）─────────────────────────────────
// 事件綁定與執行順序由 Composition Manifest 唯一擁有；此處只宣告本模組可提供的 Handler。
//
// handlesGameCommands 為空：doc §5.2「第一版沒有玩家直接修改國界的 Game Command」。
// subscriptionHandlerIds 為空：doc §6 只列 World 的**輸出**事件，World 不訂閱任何模組事件。
// sendsInternalCommands 為空：World 的所有後果都落在自己的 Slice；戰爭的 Effect 展開屬於一條
//   還不存在的編排 Workflow（見 system.ts 的 worldConflictResolve 註解），不是 World 自己送命令。
export const worldModuleContract: ModuleContract = {
  id: 'world' as ModuleId<'world'>,
  owns: 'world' as StateSliceName,
  reads: [
    'reader:world-definition' as ReaderPortId,
    'reader:world-adventure-map' as ReaderPortId,
    'reader:world-conflict-resolver' as ReaderPortId,
  ],
  handlesGameCommands: [],
  handlesInternalCommands: [
    'ChangeRegionControl',
    'SetRouteAccess',
    'ApplyMarketPressure',
    'ApplyEventWeightModifier',
    'SetWorldFact',
  ],
  handlesJobs: [
    'worldConflictCheck',
    'worldConflictResolve',
    'marketPressureExpire',
    'eventWeightModifierExpire',
  ],
  sendsInternalCommands: [],
  subscriptionHandlerIds: [],
  emits: [
    'RegionControlChanged',
    'HumanEnemyCultureChanged',
    'RouteAccessChanged',
    'ConflictStarted',
    'ConflictResolved',
    'MarketPressureChanged',
    'EventWeightModifierChanged',
    'WorldFactChanged',
  ],
  invariants: [
    // doc §8-3：每個 Region 恰好一個目前控制國（Runtime 只替換，不新增第二筆、不刪除）。
    'world.regionExactlyOneController' as InvariantId,
    // doc §8-5：占領只改人類敵人文化，不改原生物品／非人怪文化。
    'world.nativeCultureImmutableUnderOccupation' as InvariantId,
    // doc §8-4：城市網路最短距離可重播，平手依 RouteId 固定排序。
    'world.shortestRouteDeterministic' as InvariantId,
    // doc §2.5：World Fact 只接受已註冊 Fact、符合 valueKind 且來源種類被允許的值。
    'world.worldFactMatchesDefinition' as InvariantId,
    // doc §8-7：戰爭未啟用（Conflict Rule disabled）時不處理空白 Conflict Job。
    'world.conflictOnlyUnderEnabledRule' as InvariantId,
    // doc §8-8：相同 State、Definition 與 Seed 的戰爭檢查結果一致（cursor 顯式前進）。
    'world.conflictCheckDeterministic' as InvariantId,
    // 00_shared_contracts §3：worldDay 由 Kernel 獨占；World 不得請求推進世界日。
    'world.worldDayNotOwned' as InvariantId,
  ],
};

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是模組的**正式對外面**。從這裡再匯出 fixtures 或 test runner，等於讓正式依賴圖
// 可以走到測試資料。測試請直接 import './fixtures' 與 './world.test'。
// 門禁：scripts/verify-runtime-discipline.ts
