// contracts/world — World 模組公開契約（純型別）。
// 來源：docs/00_core/architecture/07_world_module.md
// 僅含型別／介面：Definition、Query port、ScheduledJob、Internal Command、DomainEvent payload。

import type {
  Brand,
  DefinitionId,
  RuntimeId,
  DefinitionHeader,
  LocalizedTextRef,
  JsonScalar,
  WorldDay,
  Revision,
  RngContext,
  ModuleId,
  ResolverId,
  EffectDefinitionId,
  PriceModifierRuleId,
  NationId,
  CultureId,
  RegionId,
  CityId,
  RouteId,
  AdventureSiteId,
  MapTemplateId,
  MapInstanceId,
  WorldFactId,
  MarketPressureId,
  WorldEventWeightModifierId,
  EntitySourceRef,
  ScheduledJobBase,
} from '../core';

// ── World 擁有但未列於 contracts/core 的 ID ────────────────────────────────
export type ConflictId = RuntimeId<'conflict'>;
export type ConflictRuleId = DefinitionId<'conflict-rule'>;
export type PassagePolicyId = DefinitionId<'passage-policy'>;
export type WeightModifierRuleId = DefinitionId<'weight-modifier-rule'>;

// 內容池 ID：概念上由內容／map 模組擁有，contracts/core 尚未提供；此處為 provisional 本地宣告。
export type ContentPoolId = DefinitionId<'content-pool'>;
export type PlayerTravelEventPoolId = DefinitionId<'player-travel-event-pool'>;

// ── 共用列舉／輔助型別 ─────────────────────────────────────────────────────
export type RouteAccessState = 'open' | 'restricted' | 'closed';

// 事件權重修正的內容脈絡（doc §3.3 內嵌註解）。
export type ContentEventContext = 'playerTravel' | 'dungeon' | 'city';

// doc 未列舉具體值；以字串佔位並待資料規則收斂。
export type WorldFactSourceKind = string;
export type RouteAccessReason = string;

// 顯示資料為 UI 投影，模組契約未指定完整形狀；此處給最小佔位。
export type NationDisplayDefinition = Readonly<{ nameRef: LocalizedTextRef }>;

// 衝突結案結果由 outcomeResolver 決定，doc 未指定欄位；佔位型別。
export type ConflictOutcome = Readonly<{
  winnerNationId?: NationId;
  loserNationId?: NationId;
  affectedRegionIds: readonly RegionId[];
}>;

// ── §2 靜態資料契約 ────────────────────────────────────────────────────────

export type NationDefinition = DefinitionHeader<NationId> & {
  cultureId: CultureId;
  passagePolicyId: PassagePolicyId;
  display: NationDisplayDefinition;
};

export type CultureDefinition = DefinitionHeader<CultureId> & {
  itemPoolIds: readonly ContentPoolId[];
  nonHumanMonsterPoolIds: readonly ContentPoolId[];
  humanEnemyPoolIds: readonly ContentPoolId[];
  equipmentPoolIds: readonly ContentPoolId[];
  skillPoolIds: readonly ContentPoolId[];
};

export type RegionDefinition = DefinitionHeader<RegionId> & {
  nativeNationId: NationId;
  nativeCultureId: CultureId;
  cityIds: readonly CityId[];
  adventureSiteIds: readonly AdventureSiteId[];
};

export type CityNodeDefinition = DefinitionHeader<CityId> & {
  regionId: RegionId;
  adjacentRouteIds: readonly RouteId[];
  adventureSiteIds: readonly AdventureSiteId[];
  isCapital: boolean;
};

export type AdventureSiteDefinition = DefinitionHeader<AdventureSiteId> & {
  regionId: RegionId;
  accessCityId: CityId;
  mapTemplateId: MapTemplateId;
  isNationalDungeon: boolean;
};

export type RouteDefinition = DefinitionHeader<RouteId> & {
  fromCityId: CityId;
  toCityId: CityId;
  playerTravelEventPoolId: PlayerTravelEventPoolId;
  passagePolicyId?: PassagePolicyId;
  enabledByDefault: boolean;
};

export type ConflictRuleDefinition = DefinitionHeader<ConflictRuleId> & {
  checkCadenceDays: number;
  eligibilityResolverId: ResolverId;
  outcomeResolverId: ResolverId;
  marketPressureEffectIds: readonly EffectDefinitionId[];
  eventWeightEffectIds: readonly EffectDefinitionId[];
  passageEffectIds: readonly EffectDefinitionId[];
};

export type PassagePolicyDefinition = DefinitionHeader<PassagePolicyId> & {
  requirementResolverId: ResolverId;
};

export type WorldFactDefinition = DefinitionHeader<WorldFactId> & {
  valueKind: 'boolean' | 'number' | 'string';
  defaultValue: JsonScalar;
  allowedSourceKinds: readonly WorldFactSourceKind[];
};

export interface WorldDefinitionReader {
  getNation(id: NationId): NationDefinition;
  getCulture(id: CultureId): CultureDefinition;
  getRegion(id: RegionId): RegionDefinition;
  getCityNode(id: CityId): CityNodeDefinition;
  getAdventureSite(id: AdventureSiteId): AdventureSiteDefinition;
  getRoute(id: RouteId): RouteDefinition;
  getConflictRule(id: ConflictRuleId): ConflictRuleDefinition;
  // doc §2.4 定義了 PassagePolicyDefinition，但 §2.1 的 Reader 沒有對應 getter——於是那個型別
  // 在整個 Runtime 裡沒有任何讀取路徑，Route/Nation 的 passagePolicyId 只能指向讀不到的東西。
  // 通行判定（doc §7.2）需要它才能取得 requirementResolverId，故補上。
  getPassagePolicy(id: PassagePolicyId): PassagePolicyDefinition;
  getWorldFact(id: WorldFactId): WorldFactDefinition;
  listRoutesFrom(cityId: CityId): readonly RouteDefinition[];
}

// ── §3 Runtime State ───────────────────────────────────────────────────────

export type RegionControlState = {
  regionId: RegionId;
  controllerNationId: NationId;
  controlledSinceDay: WorldDay;
  sourceConflictId?: ConflictId;
  revision: Revision;
};

export type RouteRuntimeState = {
  routeId: RouteId;
  accessState: RouteAccessState;
  reason?: RouteAccessReason;
  changedOnDay: WorldDay;
  revision: Revision;
};

export type MarketScope = Readonly<{
  kind: 'nation' | 'region' | 'city';
  id: NationId | RegionId | CityId;
}>;

export type EventWeightScope = Readonly<{
  kind: 'nation' | 'region' | 'route' | 'city';
  id: NationId | RegionId | RouteId | CityId;
}>;

export type ConflictState = {
  conflictId: ConflictId;
  // doc §3.3 的 State 沒有帶規則來源，但 §5.1 的 worldConflictResolve 只以 ConflictId 定址，
  // 而結案要用的 outcomeResolverId 只存在於 ConflictRuleDefinition 上。少了這個欄位，
  // 結案 Job 沒有任何合法途徑找到自己該用哪個 Resolver（只能寫死一個 ID＝規範 §5 違規）。
  conflictRuleId: ConflictRuleId;
  attackerNationId: NationId;
  defenderNationId: NationId;
  affectedRegionIds: RegionId[];
  state: 'active' | 'resolved';
  startedOnDay: WorldDay;
  resolvedOnDay?: WorldDay;
  rngContext: RngContext; // 衝突跨日解析使用；每次成功解析後保存 nextCursor
  revision: Revision;
};

export type MarketPressureState = {
  pressureId: MarketPressureId;
  scope: MarketScope;
  modifierRuleId: PriceModifierRuleId;
  activeFromDay: WorldDay;
  activeToDay?: WorldDay;
  sourceConflictId?: ConflictId;
};

export type WorldEventWeightModifierState = {
  modifierId: WorldEventWeightModifierId;
  scope: EventWeightScope;
  context: ContentEventContext;
  weightModifierRuleId: WeightModifierRuleId;
  activeFromDay: WorldDay;
  activeToDay?: WorldDay;
  sourceConflictId?: ConflictId;
};

export type WorldFactState = {
  factId: WorldFactId;
  value: JsonScalar;
  sourceId: EntitySourceRef;
  changedOnDay: WorldDay;
  revision: Revision;
};

export type WorldState = {
  regionControl: Record<RegionId, RegionControlState>;
  routeStates: Record<RouteId, RouteRuntimeState>;
  conflicts: Record<ConflictId, ConflictState>;
  marketPressures: Record<MarketPressureId, MarketPressureState>;
  eventWeightModifiers: Record<WorldEventWeightModifierId, WorldEventWeightModifierState>;
  facts: Record<WorldFactId, WorldFactState>;
};

// ── §4 公開 Query ──────────────────────────────────────────────────────────
// 下列 View 為 read-model 投影，模組契約未完整指定形狀；以最小可辨識欄位佔位。
export type RouteAccessView = Readonly<{
  routeId: RouteId;
  accessState: RouteAccessState;
  reason?: RouteAccessReason;
  // doc §7.2：「WorldQuery 取得 Route 與 Passage Policy → InventoryQuery 提供通行證 → Passage
  // Resolver 判定」。原本的 View 只有 accessState，通行流程拿不到 Policy，Team 就只能自己猜一個
  // Resolver。此欄位是該流程的 World 側輸出：取自 RouteDefinition.passagePolicyId，沒有就是沒有
  //（World 不代替內容決定要不要有通行政策）。
  passagePolicyId?: PassagePolicyId;
}>;

export type MarketPressureView = Readonly<{
  pressureId: MarketPressureId;
  scope: MarketScope;
  modifierRuleId: PriceModifierRuleId;
  activeFromDay: WorldDay;
  activeToDay?: WorldDay;
}>;

export type EventWeightModifierView = Readonly<{
  modifierId: WorldEventWeightModifierId;
  scope: EventWeightScope;
  context: ContentEventContext;
  weightModifierRuleId: WeightModifierRuleId;
  activeFromDay: WorldDay;
  activeToDay?: WorldDay;
}>;

export interface WorldDistanceQuery {
  getCityGapCount(from: CityId, to: CityId): number | undefined;
  getShortestRoute(from: CityId, to: CityId): RouteId[] | undefined;
}

export interface WorldQuery extends WorldDistanceQuery {
  listCitiesWithinHops(originCityId: CityId, maxHops: number): CityId[];
  listAdventureMapsForCities(cityIds: CityId[]): MapInstanceId[];
  getRegionForCity(cityId: CityId): RegionId;
  getRegionForSite(siteId: AdventureSiteId): RegionId;
  getAccessCityForSite(siteId: AdventureSiteId): CityId;
  getNativeCulture(regionId: RegionId): CultureId;
  getControllerNation(regionId: RegionId): NationId;
  getHumanEnemyCulture(regionId: RegionId): CultureId;
  getRouteAccess(routeId: RouteId): RouteAccessView;
  listMarketPressures(scope: MarketScope): MarketPressureView[];
  listEventWeightModifiers(scope: EventWeightScope, context: ContentEventContext): EventWeightModifierView[];
  getWorldFact(factId: WorldFactId): JsonScalar;
}

// ── §5.1 ScheduledJob ──────────────────────────────────────────────────────
// payload 形狀 doc 未指定；以最小 payload 佔位，target 依語意推定。
type EmptyPayload = Readonly<Record<string, never>>;

export type WorldConflictCheckJob = ScheduledJobBase<'worldConflictCheck', ModuleId, ConflictRuleId, EmptyPayload>;
export type WorldConflictResolveJob = ScheduledJobBase<'worldConflictResolve', ModuleId, ConflictId, EmptyPayload>;
export type MarketPressureExpireJob = ScheduledJobBase<'marketPressureExpire', ModuleId, MarketPressureId, EmptyPayload>;
export type EventWeightModifierExpireJob = ScheduledJobBase<'eventWeightModifierExpire', ModuleId, WorldEventWeightModifierId, EmptyPayload>;

export type WorldScheduledJob =
  | WorldConflictCheckJob
  | WorldConflictResolveJob
  | MarketPressureExpireJob
  | EventWeightModifierExpireJob;

// ── §5.2 Internal Command ──────────────────────────────────────────────────
// 欄位依 State 形狀與 doc 語意推定；World 第一版沒有玩家直接修改國界的 Game Command。
export type ChangeRegionControlCommand = Readonly<{
  type: 'ChangeRegionControl';
  regionId: RegionId;
  newNationId: NationId;
  sourceConflictId?: ConflictId;
  sourceId: EntitySourceRef;
}>;

export type SetRouteAccessCommand = Readonly<{
  type: 'SetRouteAccess';
  routeId: RouteId;
  accessState: RouteAccessState;
  reason?: RouteAccessReason;
}>;

export type ApplyMarketPressureCommand = Readonly<{
  type: 'ApplyMarketPressure';
  pressureId: MarketPressureId;
  scope: MarketScope;
  modifierRuleId: PriceModifierRuleId;
  activeFromDay: WorldDay;
  activeToDay?: WorldDay;
  sourceConflictId?: ConflictId;
  active: boolean; // 建立或結束
}>;

export type ApplyEventWeightModifierCommand = Readonly<{
  type: 'ApplyEventWeightModifier';
  modifierId: WorldEventWeightModifierId;
  scope: EventWeightScope;
  context: ContentEventContext;
  weightModifierRuleId: WeightModifierRuleId;
  activeFromDay: WorldDay;
  activeToDay?: WorldDay;
  sourceConflictId?: ConflictId;
  active: boolean;
}>;

export type SetWorldFactCommand = Readonly<{
  type: 'SetWorldFact';
  factId: WorldFactId;
  value: JsonScalar;
  sourceId: EntitySourceRef;
  // doc §5.2 要求 SetWorldFact「驗證 Fact Definition、值型別與**來源**後更新旗標」，而
  // WorldFactDefinition.allowedSourceKinds 是那道驗證的資料。EntitySourceRef 是一串 branded ID
  // 的 union，執行期分不出種類（要分只能剖字串前綴＝把 ID 格式當契約用）。所以送出端必須自己
  // 宣告來源種類，World 才驗得到 allowedSourceKinds。
  sourceKind: WorldFactSourceKind;
}>;

export type WorldInternalCommand =
  | ChangeRegionControlCommand
  | SetRouteAccessCommand
  | ApplyMarketPressureCommand
  | ApplyEventWeightModifierCommand
  | SetWorldFactCommand;

// ── §6 輸出事件（DomainEvent payload）──────────────────────────────────────
export type RegionControlChanged = Readonly<{
  type: 'RegionControlChanged';
  regionId: RegionId;
  oldNationId: NationId;
  newNationId: NationId;
}>;

export type HumanEnemyCultureChanged = Readonly<{
  type: 'HumanEnemyCultureChanged';
  regionId: RegionId;
  cultureId: CultureId;
}>;

export type RouteAccessChanged = Readonly<{
  type: 'RouteAccessChanged';
  routeId: RouteId;
  accessState: RouteAccessState;
  reason?: RouteAccessReason;
}>;

// conflictRuleId 是 doc §6「最少 payload」以外的追加欄位。理由：戰爭的市場／事件權重／通行後果是
// ConflictRuleDefinition 上的三組 EffectDefinitionId，而 World 不擁有 Effect 語意（見 07 doc §1.2 與
// §5.2 的命令清單——World 只收「已決定好的」ApplyMarketPressure/SetRouteAccess）。要把 Effect 展開成
// 那些命令的是一條編排 Workflow；沒有規則來源，訂閱者無從查到自己該展開哪些 Effect。
export type ConflictStarted = Readonly<{
  type: 'ConflictStarted';
  conflictId: ConflictId;
  conflictRuleId: ConflictRuleId;
  nationIds: readonly NationId[];
  regionIds: readonly RegionId[];
}>;

export type ConflictResolved = Readonly<{
  type: 'ConflictResolved';
  conflictId: ConflictId;
  conflictRuleId: ConflictRuleId;
  outcome: ConflictOutcome;
}>;

export type MarketPressureChanged = Readonly<{
  type: 'MarketPressureChanged';
  scope: MarketScope;
  modifierRuleId: PriceModifierRuleId;
  active: boolean;
}>;

export type EventWeightModifierChanged = Readonly<{
  type: 'EventWeightModifierChanged';
  scope: EventWeightScope;
  context: ContentEventContext;
  modifierRuleId: WeightModifierRuleId;
  active: boolean;
}>;

export type WorldFactChanged = Readonly<{
  type: 'WorldFactChanged';
  factId: WorldFactId;
  oldValue: JsonScalar;
  newValue: JsonScalar;
  sourceId: EntitySourceRef;
}>;

export type WorldDomainEvent =
  | RegionControlChanged
  | HumanEnemyCultureChanged
  | RouteAccessChanged
  | ConflictStarted
  | ConflictResolved
  | MarketPressureChanged
  | EventWeightModifierChanged
  | WorldFactChanged;
