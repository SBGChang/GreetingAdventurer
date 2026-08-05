# World 模組契約

> **模組 ID：** `world`
>
> **依賴：** [共用核心契約](00_shared_contracts.md)。
>
> **責任：** 管理國度、文化、地區、城市網路、冒險地歸屬、目前控制國、國境通行狀態與戰爭造成的世界級修正。World 是「地點原生文化」與「目前占領文化」的唯一真相來源。
>
> **非責任：** 不擁有城市商店、地圖內容、旅行中的隊伍、敵人實體、物價交易或通行證物品。

---

## 1. 邊界與所有權

### 1.1 World 唯一可寫的 State

```ts
type WorldState = {
  regionControl: Record<RegionId, RegionControlState>;
  routeStates: Record<RouteId, RouteRuntimeState>;
  conflicts: Record<ConflictId, ConflictState>;
  marketPressures: Record<MarketPressureId, MarketPressureState>;
  eventWeightModifiers: Record<WorldEventWeightModifierId, WorldEventWeightModifierState>;
  facts: Record<WorldFactId, WorldFactState>;
};
```

### 1.2 World 不擁有的事

| 事實 | 所有者 | World 的角色 |
|---|---|---|
| 城市設施、繁榮、安全與商店 | city | 提供城市所屬地區、控制國與戰爭修正。 |
| 地圖內容與怪物群 | map | 提供原生文化與人類敵人使用的目前控制文化。 |
| 隊伍位置與旅行進度 | team | 提供路線、距離與通行判定 Query。 |
| 通行證、貨物與裝備實體 | inventory | 只提出通行需求，不保存玩家持有物。 |
| 實際支付與物價帳本 | economy | 提供戰爭／地區的市場壓力，不直接改餘額。 |
| 戰鬥中的人類敵人 | combat | 提供應讀取哪個文化池，不生成 Encounter。 |

---

## 2. 靜態資料契約

### 2.1 WorldDefinitionReader

```ts
interface WorldDefinitionReader {
  getNation(id: NationId): NationDefinition;
  getCulture(id: CultureId): CultureDefinition;
  getRegion(id: RegionId): RegionDefinition;
  getCityNode(id: CityId): CityNodeDefinition;
  getAdventureSite(id: AdventureSiteId): AdventureSiteDefinition;
  getRoute(id: RouteId): RouteDefinition;
  getConflictRule(id: ConflictRuleId): ConflictRuleDefinition;
  getWorldFact(id: WorldFactId): WorldFactDefinition;
  listRoutesFrom(cityId: CityId): RouteDefinition[];
}
```

### 2.2 國度、文化與地區

```ts
type NationDefinition = DefinitionHeader & {
  cultureId: CultureId;
  passagePolicyId: PassagePolicyId;
  display: NationDisplayDefinition;
};

type CultureDefinition = DefinitionHeader & {
  itemPoolIds: ContentPoolId[];
  nonHumanMonsterPoolIds: ContentPoolId[];
  humanEnemyPoolIds: ContentPoolId[];
  equipmentPoolIds: ContentPoolId[];
  skillPoolIds: ContentPoolId[];
};

type RegionDefinition = DefinitionHeader & {
  nativeNationId: NationId;
  nativeCultureId: CultureId;
  cityIds: CityId[];
  adventureSiteIds: AdventureSiteId[];
};
```

`nativeCultureId` 建立新遊戲後不可因占領改寫。文化池只保存 Definition ID；實際內容由 Map／Combat 的窄化 Reader 取得。

### 2.3 城市網路與冒險地

```ts
type CityNodeDefinition = DefinitionHeader & {
  regionId: RegionId;
  adjacentRouteIds: RouteId[];
  adventureSiteIds: AdventureSiteId[];
  isCapital: boolean;
};

type AdventureSiteDefinition = DefinitionHeader & {
  regionId: RegionId;
  accessCityId: CityId;
  mapTemplateId: MapTemplateId;
  isNationalDungeon: boolean;
};

type RouteDefinition = DefinitionHeader & {
  fromCityId: CityId;
  toCityId: CityId;
  playerTravelEventPoolId: PlayerTravelEventPoolId;
  passagePolicyId?: PassagePolicyId;
  enabledByDefault: boolean;
};
```

`playerTravelEventPoolId` 只供 Player Travel Event Workflow 使用，讓不同路線可共用或各自配置事件池。NPC 旅行只讀 Route 的兩端與通行狀態，禁止讀取、複製或解析這個事件池。

城市距離使用城市網路的最短 Route 數量：

```ts
interface WorldDistanceQuery {
  getCityGapCount(from: CityId, to: CityId): number | undefined;
  getShortestRoute(from: CityId, to: CityId): RouteId[] | undefined;
}
```

相同距離有多條路時，依 `RouteId` 固定排序選擇；不得受 JSON 或檔案列舉順序影響。

### 2.4 戰爭與通行資料

```ts
type ConflictRuleDefinition = DefinitionHeader & {
  checkCadenceDays: number;
  eligibilityResolverId: ResolverId;
  outcomeResolverId: ResolverId;
  marketPressureEffectIds: EffectDefinitionId[];
  eventWeightEffectIds: EffectDefinitionId[];
  passageEffectIds: EffectDefinitionId[];
};

type PassagePolicyDefinition = DefinitionHeader & {
  requirementResolverId: ResolverId;
};
```

戰爭觸發條件、力量差、占領結果與市場修正尚未定數值時，可以沒有啟用中的 Conflict Rule；架構不得自行補公式。

### 2.5 World Fact

```ts
type WorldFactDefinition = DefinitionHeader & {
  valueKind: 'boolean' | 'number' | 'string';
  defaultValue: JsonScalar;
  allowedSourceKinds: WorldFactSourceKind[];
};

type WorldFactState = {
  factId: WorldFactId;
  value: JsonScalar;
  sourceId: GameId;
  changedOnDay: WorldDay;
  revision: Revision;
};
```

World Fact 只保存已在資料中註冊的有限世界旗標，不能當任意 key/value 垃圾桶。事件的後續 Effect 可以改變 Fact，但仍須走 World Internal Command。

---

## 3. Runtime State

### 3.1 地區控制

```ts
type RegionControlState = {
  regionId: RegionId;
  controllerNationId: NationId;
  controlledSinceDay: WorldDay;
  sourceConflictId?: ConflictId;
  revision: Revision;
};
```

### 3.2 路線與國境

```ts
type RouteRuntimeState = {
  routeId: RouteId;
  accessState: 'open' | 'restricted' | 'closed';
  reason?: RouteAccessReason;
  changedOnDay: WorldDay;
  revision: Revision;
};
```

限制狀態只說明路線規則；玩家是否持有有效通行證由 Inventory Query 與 Passage Resolver 判定。

### 3.3 衝突與市場壓力

```ts
type ConflictState = {
  conflictId: ConflictId;
  attackerNationId: NationId;
  defenderNationId: NationId;
  affectedRegionIds: RegionId[];
  state: 'active' | 'resolved';
  startedOnDay: WorldDay;
  resolvedOnDay?: WorldDay;
  rngStreamId: string;
  revision: Revision;
};

type MarketPressureState = {
  pressureId: MarketPressureId;
  scope: { kind: 'nation' | 'region' | 'city'; id: GameId };
  modifierRuleId: PriceModifierRuleId;
  activeFromDay: WorldDay;
  activeToDay?: WorldDay;
  sourceConflictId?: ConflictId;
};

type WorldEventWeightModifierState = {
  modifierId: WorldEventWeightModifierId;
  scope: { kind: 'nation' | 'region' | 'route' | 'city'; id: GameId };
  context: ContentEventContext; // 'playerTravel' | 'dungeon' | 'city'
  weightModifierRuleId: WeightModifierRuleId;
  activeFromDay: WorldDay;
  activeToDay?: WorldDay;
  sourceConflictId?: ConflictId;
};
```

---

## 4. 公開 Query

```ts
interface WorldQuery extends WorldDistanceQuery {
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
```

文化判定固定為：

```text
物品與非人類怪物 → Region.nativeCultureId
人類敵人          → controllerNationId 對應的 Culture
```

Map 與 Combat 不得自行推測占領文化，也不能把目前控制國寫回 Map Definition。

---

## 5. 輸入契約

### 5.1 ScheduledJob

| Job | World 的反應 |
|---|---|
| `worldConflictCheck` | 僅在啟用 Conflict Rule 時，檢查符合條件的接壤國家並依固定 RNG Stream 判定。 |
| `worldConflictResolve` | 依既有 Conflict 的結果資料改變控制、路線與市場壓力。 |
| `marketPressureExpire` | 移除已到期的世界市場修正。 |
| `eventWeightModifierExpire` | 移除已到期的事件權重修正。 |

### 5.2 Internal Command

| Internal Command | World 的反應 |
|---|---|
| `ChangeRegionControl` | 驗證來源、國家與地區後更新控制國。 |
| `SetRouteAccess` | 更新路線開放、限制或關閉狀態。 |
| `ApplyMarketPressure` | 建立或結束資料指定的市場壓力。 |
| `ApplyEventWeightModifier` | 建立或結束資料指定的旅行／地圖／城市事件權重修正。 |
| `SetWorldFact` | 驗證 Fact Definition、值型別與來源後更新旗標。 |

第一版沒有玩家直接修改國界的 Game Command。

---

## 6. 輸出事件

| Event | 最少 payload | 訂閱者 |
|---|---|---|
| `RegionControlChanged` | `regionId`、`oldNationId`、`newNationId` | map、city、combat、ui/app。 |
| `HumanEnemyCultureChanged` | `regionId`、`cultureId` | map、combat。 |
| `RouteAccessChanged` | `routeId`、`accessState`、`reason?` | team、quest、ui/app。 |
| `ConflictStarted` | `conflictId`、`nationIds`、`regionIds` | city、quest、ui/app。 |
| `ConflictResolved` | `conflictId`、`outcome` | city、quest、ui/app。 |
| `MarketPressureChanged` | `scope`、`modifierRuleId`、`active` | economy、city、ui/app。 |
| `EventWeightModifierChanged` | `scope`、`context`、`modifierRuleId`、`active` | team、map、city、content-event workflow。 |
| `WorldFactChanged` | `factId`、`oldValue`、`newValue`、`sourceId` | content-event workflow、quest、city、ui/app。 |

---

## 7. 核心流程

### 7.1 占領後的內容

```text
ChangeRegionControl
  → World 更新 controllerNationId
  → RegionControlChanged + HumanEnemyCultureChanged
  → Map 下一次生成仍讀 nativeCulture 的物品／非人怪池
  → Map／Combat 生成新的人類敵人時讀 controller Culture
```

已存在的 Item Instance 不因占領換文化；已生成的人類 Encounter 是否立即替換由內容規則決定，預設只影響後續生成。

### 7.2 路線通行

```text
Team 試圖開始城市旅行
  → WorldQuery 取得 Route 與 Passage Policy
  → InventoryQuery 提供通行證實體
  → Passage Resolver 判定
  → 合法才由 Team 建立 Travel Plan
```

World 不消耗通行證；若資料規則要求消耗，旅行 Workflow 另送 Inventory Internal Command。

---

## 8. 不變量與測試

1. 每個城市與冒險地恰好屬於一個 Region。
2. 非首都城市恰好連到一個冒險地；首都恰好連到兩個，其中一個必須是該國國家迷宮。
3. 每個 Region 永遠保留原生文化，且恰好有一個目前控制國。
4. Route 的兩端城市與玩家旅行事件池必須存在；城市網路最短距離結果必須可重播。NPC Route Query 不得因此建立事件流程。
5. 占領只改人類敵人文化，不改原生物品與非人類怪物文化。
6. 關閉路線不能被 Team 建立新旅行 Plan；既有旅程的處理政策由 Route Rule 明確定義。
7. 戰爭未啟用時，不建立空白 Conflict Job。
8. 相同 State、Definition 與 Seed 的戰爭檢查結果一致。

---

## 9. World 模組交接清單

- [ ] Nation、Culture、Region、City Graph、Adventure Site、Route Schema。
- [ ] RegionControl、RouteState、Conflict、MarketPressure State。
- [ ] `WorldQuery`、距離、文化與通行查詢。
- [ ] Conflict／Route／Market Job 與 Internal Command Handler。
- [ ] 占領文化、最短路線、通行與戰爭 deterministic 測試。
