// modules/world/state.ts
// World 唯一可寫 Slice 的初始工廠與純函式讀寫小工具。
// Slice 型別權威在 contracts/world；此處不重新定義，只 re-export + 提供 immutable helper。
//
// 設計原則：
//   * 全部為決定性純函式；不 mutate 傳入 Slice，一律回傳新物件。
//   * 不含任何內容 ID 字面值、不含玩法數值：World 的每一筆 State 都由 Definition 或命令 payload 帶入。
//   * `CoreState.worldDay` 由 Kernel 獨占寫入；本檔任何函式都只**接收**世界日，不推進它。

import type {
  CityId,
  NationId,
  RegionId,
  RouteId,
  WorldFactId,
  MarketPressureId,
  WorldEventWeightModifierId,
  Revision,
  RngCursor,
  RngContext,
  RngStreamId,
  Seed,
  WorldDay,
} from '../../contracts/core';
import type {
  WorldState,
  RegionControlState,
  RouteRuntimeState,
  RouteAccessState,
  RouteAccessReason,
  ConflictState,
  ConflictId,
  MarketPressureState,
  MarketScope,
  EventWeightScope,
  WorldEventWeightModifierState,
  WorldFactState,
  RegionDefinition,
  RouteDefinition,
} from '../../contracts/world';

export type { WorldState };

// 空 Slice（新世界或測試起點）。
export const emptyWorldState: WorldState = Object.freeze({
  regionControl: Object.freeze({}),
  routeStates: Object.freeze({}),
  conflicts: Object.freeze({}),
  marketPressures: Object.freeze({}),
  eventWeightModifiers: Object.freeze({}),
  facts: Object.freeze({}),
}) as WorldState;

// 由既有實體集合建構 Slice（Bootstrap／存檔載入／fixture）。
export function createWorldState(
  input: Readonly<{
    regionControl?: readonly RegionControlState[];
    routeStates?: readonly RouteRuntimeState[];
    conflicts?: readonly ConflictState[];
    marketPressures?: readonly MarketPressureState[];
    eventWeightModifiers?: readonly WorldEventWeightModifierState[];
    facts?: readonly WorldFactState[];
  }> = {},
): WorldState {
  const regionControl: Record<RegionId, RegionControlState> = {};
  for (const entry of input.regionControl ?? []) regionControl[entry.regionId] = entry;

  const routeStates: Record<RouteId, RouteRuntimeState> = {};
  for (const entry of input.routeStates ?? []) routeStates[entry.routeId] = entry;

  const conflicts: Record<ConflictId, ConflictState> = {};
  for (const entry of input.conflicts ?? []) conflicts[entry.conflictId] = entry;

  const marketPressures: Record<MarketPressureId, MarketPressureState> = {};
  for (const entry of input.marketPressures ?? []) marketPressures[entry.pressureId] = entry;

  const eventWeightModifiers: Record<WorldEventWeightModifierId, WorldEventWeightModifierState> = {};
  for (const entry of input.eventWeightModifiers ?? []) eventWeightModifiers[entry.modifierId] = entry;

  const facts: Record<WorldFactId, WorldFactState> = {};
  for (const entry of input.facts ?? []) facts[entry.factId] = entry;

  return { regionControl, routeStates, conflicts, marketPressures, eventWeightModifiers, facts };
}

export function bumpRevision(r: Revision): Revision {
  return (r + 1) as Revision;
}

// ── 地區控制 ────────────────────────────────────────────────────────────────
//
// doc §8 不變量 3：每個 Region 恰好有一個目前控制國。開局的那一個由 Bootstrap 依
// RegionDefinition.nativeNationId 建立（見 initialRegionControl）；Runtime 只會**替換**控制國，
// 不會新增第二筆，也不會刪除。Query 讀不到控制筆數時是壞狀態，不是「還沒有人控制」。

export function tryGetRegionControl(
  state: WorldState,
  regionId: RegionId,
): RegionControlState | undefined {
  return state.regionControl[regionId];
}

export function upsertRegionControl(state: WorldState, next: RegionControlState): WorldState {
  return { ...state, regionControl: { ...state.regionControl, [next.regionId]: next } };
}

// Bootstrap 用：把內容列舉出來的 Region 轉成開局控制狀態（原生國即開局控制國）。
// World 模組自己讀不到「所有 Region」（Reader 只有 per-id getter），故列舉由 Bootstrap 負責。
export function initialRegionControl(
  regions: readonly RegionDefinition[],
  onDay: WorldDay,
): readonly RegionControlState[] {
  return regions.map((region) => ({
    regionId: region.id,
    controllerNationId: region.nativeNationId,
    controlledSinceDay: onDay,
    revision: 0 as Revision,
  }));
}

// ── 路線通行狀態 ────────────────────────────────────────────────────────────
//
// RouteRuntimeState 是**稀疏**的：只有被 SetRouteAccess 改過的路線才有一筆。沒有 Runtime 筆數時
// 的通行狀態由 RouteDefinition.enabledByDefault 決定（換一份 Pack 就會跟著改）。Definition 只能
// 表達 open／closed 兩態；'restricted' 是 Runtime 轉移，只能由帶著資料決定值的 SetRouteAccess 產生
//（轉移規則來自 PassagePolicyDefinition／ConflictRuleDefinition，不是這裡的判斷）。
export function definitionRouteAccess(route: RouteDefinition): RouteAccessState {
  return route.enabledByDefault ? 'open' : 'closed';
}

export function tryGetRouteState(state: WorldState, routeId: RouteId): RouteRuntimeState | undefined {
  return state.routeStates[routeId];
}

// 目前生效的通行狀態與理由：有 Runtime 筆數用它，否則回 Definition 的預設（無理由）。
export function effectiveRouteAccess(
  state: WorldState,
  route: RouteDefinition,
): Readonly<{ accessState: RouteAccessState; reason?: RouteAccessReason }> {
  const runtime = state.routeStates[route.id];
  if (runtime === undefined) return { accessState: definitionRouteAccess(route) };
  return { accessState: runtime.accessState, reason: runtime.reason };
}

export function upsertRouteState(state: WorldState, next: RouteRuntimeState): WorldState {
  return { ...state, routeStates: { ...state.routeStates, [next.routeId]: next } };
}

// 路線的另一端（城市網路視為無向：CityNodeDefinition.adjacentRouteIds 兩端都會列出同一條 Route）。
export function otherEndOf(route: RouteDefinition, cityId: CityId): CityId | undefined {
  if (route.fromCityId === cityId) return route.toCityId;
  if (route.toCityId === cityId) return route.fromCityId;
  return undefined;
}

// ── 衝突 ────────────────────────────────────────────────────────────────────

export function tryGetConflict(state: WorldState, conflictId: ConflictId): ConflictState | undefined {
  return state.conflicts[conflictId];
}

export function upsertConflict(state: WorldState, next: ConflictState): WorldState {
  return { ...state, conflicts: { ...state.conflicts, [next.conflictId]: next } };
}

// 衝突跨日解析的長期 RNG Stream：依 12_engine_runtime.md §7.1「一次性 Job 可由自身 ID 派生 Stream
// 並從零 cursor 開始」，Stream 由該 Conflict 自己的 Runtime ID 派生，因此可重播且互不干擾。
// 這裡不是內容 ID：streamId 的 brand 是 rng-stream（程式身分），且值完全由 conflictId 決定。
export function conflictRngStream(worldSeed: Seed, conflictId: ConflictId): RngContext {
  return {
    worldSeed,
    streamId: `conflict/${String(conflictId)}` as RngStreamId,
    cursor: 0 as RngCursor,
  };
}

export function advanceRngCursor(context: RngContext, nextCursor: RngCursor): RngContext {
  return { ...context, cursor: nextCursor };
}

// ── 市場壓力 ────────────────────────────────────────────────────────────────

export function sameMarketScope(a: MarketScope, b: MarketScope): boolean {
  return a.kind === b.kind && String(a.id) === String(b.id);
}

export function tryGetMarketPressure(
  state: WorldState,
  pressureId: MarketPressureId,
): MarketPressureState | undefined {
  return state.marketPressures[pressureId];
}

export function upsertMarketPressure(state: WorldState, next: MarketPressureState): WorldState {
  return { ...state, marketPressures: { ...state.marketPressures, [next.pressureId]: next } };
}

export function removeMarketPressure(state: WorldState, pressureId: MarketPressureId): WorldState {
  const marketPressures: Record<MarketPressureId, MarketPressureState> = { ...state.marketPressures };
  delete marketPressures[pressureId];
  return { ...state, marketPressures };
}

export function listMarketPressureStates(state: WorldState): readonly MarketPressureState[] {
  return Object.values(state.marketPressures).sort((a, b) =>
    String(a.pressureId) < String(b.pressureId) ? -1 : String(a.pressureId) > String(b.pressureId) ? 1 : 0,
  );
}

// 同一筆壓力的內容是否完全相同（重送同一筆命令＝冪等，不再發事件）。
export function sameMarketPressure(a: MarketPressureState, b: MarketPressureState): boolean {
  return (
    sameMarketScope(a.scope, b.scope) &&
    a.modifierRuleId === b.modifierRuleId &&
    a.activeFromDay === b.activeFromDay &&
    a.activeToDay === b.activeToDay &&
    a.sourceConflictId === b.sourceConflictId
  );
}

// ── 事件權重修正 ────────────────────────────────────────────────────────────

export function sameEventWeightScope(a: EventWeightScope, b: EventWeightScope): boolean {
  return a.kind === b.kind && String(a.id) === String(b.id);
}

export function tryGetEventWeightModifier(
  state: WorldState,
  modifierId: WorldEventWeightModifierId,
): WorldEventWeightModifierState | undefined {
  return state.eventWeightModifiers[modifierId];
}

export function upsertEventWeightModifier(
  state: WorldState,
  next: WorldEventWeightModifierState,
): WorldState {
  return {
    ...state,
    eventWeightModifiers: { ...state.eventWeightModifiers, [next.modifierId]: next },
  };
}

export function removeEventWeightModifier(
  state: WorldState,
  modifierId: WorldEventWeightModifierId,
): WorldState {
  const eventWeightModifiers: Record<WorldEventWeightModifierId, WorldEventWeightModifierState> = {
    ...state.eventWeightModifiers,
  };
  delete eventWeightModifiers[modifierId];
  return { ...state, eventWeightModifiers };
}

export function listEventWeightModifierStates(
  state: WorldState,
): readonly WorldEventWeightModifierState[] {
  return Object.values(state.eventWeightModifiers).sort((a, b) =>
    String(a.modifierId) < String(b.modifierId) ? -1 : String(a.modifierId) > String(b.modifierId) ? 1 : 0,
  );
}

export function sameEventWeightModifier(
  a: WorldEventWeightModifierState,
  b: WorldEventWeightModifierState,
): boolean {
  return (
    sameEventWeightScope(a.scope, b.scope) &&
    a.context === b.context &&
    a.weightModifierRuleId === b.weightModifierRuleId &&
    a.activeFromDay === b.activeFromDay &&
    a.activeToDay === b.activeToDay &&
    a.sourceConflictId === b.sourceConflictId
  );
}

// ── World Fact ──────────────────────────────────────────────────────────────

export function tryGetFact(state: WorldState, factId: WorldFactId): WorldFactState | undefined {
  return state.facts[factId];
}

export function upsertFact(state: WorldState, next: WorldFactState): WorldState {
  return { ...state, facts: { ...state.facts, [next.factId]: next } };
}

// ── 純結構判斷 ──────────────────────────────────────────────────────────────

// 控制國是否已是目標國（冪等判斷用）。
export function isControlledBy(
  state: WorldState,
  regionId: RegionId,
  nationId: NationId,
): boolean {
  return state.regionControl[regionId]?.controllerNationId === nationId;
}
