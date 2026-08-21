// modules/world/fixtures.ts
// 測試專用：一份最小但完整的世界內容（2 文化／3 國／2 地區／6 城市／7 路線／衝突規則／通行政策／
// World Fact）＋ 決定性 stub Port（WorldDefinitionReader / WorldAdventureMapPort / IdAllocator /
// ConflictResolver）＋ 一站式 WorldHandlerContext。
//
// 正式路徑不得引用本檔（門禁 scripts/verify-runtime-discipline.ts 檢查 1）。
//
// 城市網路刻意做出兩種平手，用來釘住 doc §2.3「相同距離依 RouteId 固定排序」：
//   city-a ─ route-ab-1 ─ city-b        （與 route-ab-2 平行，1 跳平手）
//   city-a ─ route-ab-2 ─ city-b
//   city-a ─ route-ac  ─ city-c
//   city-b ─ route-bd  ─ city-d         （a→d 經 b：[route-ab-1, route-bd]）
//   city-c ─ route-cd  ─ city-d         （a→d 經 c：[route-ac,  route-cd] ← 序列較大，不選）
//   city-d ─ route-de  ─ city-e         （enabledByDefault: false → 預設通行狀態 closed）
//   city-a ─ route-disabled ─ city-island（Definition enabled: false → 不在城市網路內）

import type {
  ModuleId,
  AdventureSiteId,
  CityId,
  ContentPackId,
  CultureId,
  NationId,
  PriceModifierRuleId,
  RegionId,
  Revision,
  RngContext,
  RngCursor,
  RngStreamId,
  RouteId,
  Seed,
  WorldDay,
  WorldFactId,
  MapTemplateId,
  MapInstanceId,
  MarketPressureId,
  WorldEventWeightModifierId,
  ResolverId,
  QuestId,
} from '../../contracts/core';
import type {
  AdventureSiteDefinition,
  CityNodeDefinition,
  ConflictId,
  ConflictOutcome,
  ConflictRuleDefinition,
  ConflictRuleId,
  ConflictState,
  CultureDefinition,
  NationDefinition,
  PassagePolicyDefinition,
  PassagePolicyId,
  PlayerTravelEventPoolId,
  RegionDefinition,
  RouteDefinition,
  WeightModifierRuleId,
  WorldDefinitionReader,
  WorldFactDefinition,
  WorldState,
} from '../../contracts/world';
import type {
  ConflictStartDraft,
  WorldAdventureMapPort,
  WorldConflictResolverPort,
  WorldHandlerContext,
  WorldIdAllocator,
} from './system';
import { createWorldState, initialRegionControl } from './state';

// ── ID ──────────────────────────────────────────────────────────────────────

const PACK_ID = 'pack-world-test' as ContentPackId;

export const NATION_ALPHA = 'nation-alpha' as NationId;
export const NATION_BETA = 'nation-beta' as NationId;
export const NATION_GAMMA = 'nation-gamma' as NationId; // 與 alpha 同文化
export const NATION_OFF = 'nation-off' as NationId; // enabled: false

export const CULTURE_ALPHA = 'culture-alpha' as CultureId;
export const CULTURE_BETA = 'culture-beta' as CultureId;

export const REGION_NORTH = 'region-north' as RegionId;
export const REGION_SOUTH = 'region-south' as RegionId;
export const REGION_OFF = 'region-off' as RegionId; // enabled: false

export const CITY_A = 'city-a' as CityId;
export const CITY_B = 'city-b' as CityId;
export const CITY_C = 'city-c' as CityId;
export const CITY_D = 'city-d' as CityId;
export const CITY_E = 'city-e' as CityId;
export const CITY_ISLAND = 'city-island' as CityId;

export const ROUTE_AB_1 = 'route-ab-1' as RouteId;
export const ROUTE_AB_2 = 'route-ab-2' as RouteId;
export const ROUTE_AC = 'route-ac' as RouteId;
export const ROUTE_BD = 'route-bd' as RouteId;
export const ROUTE_CD = 'route-cd' as RouteId;
export const ROUTE_DE = 'route-de' as RouteId; // enabledByDefault: false
export const ROUTE_OFF = 'route-disabled' as RouteId; // Definition enabled: false

export const SITE_NORTH = 'site-north' as AdventureSiteId;
export const SITE_SOUTH = 'site-south' as AdventureSiteId;
const MAP_TEMPLATE = 'map-template-1' as MapTemplateId;
export const MAP_NORTH = 'map-instance-north' as MapInstanceId;

export const POLICY_ALPHA = 'passage-policy-alpha' as PassagePolicyId;
export const POLICY_BETA = 'passage-policy-beta' as PassagePolicyId;

export const CONFLICT_RULE = 'conflict-rule-standard' as ConflictRuleId;
export const CONFLICT_RULE_OFF = 'conflict-rule-off' as ConflictRuleId;
export const CONFLICT_RULE_BAD_CADENCE = 'conflict-rule-bad-cadence' as ConflictRuleId;

export const FACT_BORDER_SEALED = 'fact-border-sealed' as WorldFactId;
export const FACT_TAX_LEVEL = 'fact-tax-level' as WorldFactId;
export const FACT_OFF = 'fact-off' as WorldFactId;

// World Fact 的來源種類＝子系統身分（ModuleId | WorkflowId），不是自由字串。
export const FACT_SOURCE_QUEST = 'quest' as ModuleId;
export const FACT_SOURCE_CITY = 'city' as ModuleId;
export const QUEST_SOURCE = 'quest-1' as QuestId;

export const PRICE_RULE_WAR = 'price-modifier-war' as PriceModifierRuleId;
export const WEIGHT_RULE_WAR = 'weight-modifier-war' as WeightModifierRuleId;
export const PRESSURE_WAR = 'pressure-war-1' as MarketPressureId;
export const MODIFIER_WAR = 'modifier-war-1' as WorldEventWeightModifierId;

const ELIGIBILITY_RESOLVER = 'resolver:conflict-eligibility' as ResolverId;
const OUTCOME_RESOLVER = 'resolver:conflict-outcome' as ResolverId;
const PASSAGE_RESOLVER = 'resolver:passage-requirement' as ResolverId;

export const CHECK_CADENCE_DAYS = 7;
export const CONFLICT_DURATION_DAYS = 10;
export const WORLD_DAY = 100 as WorldDay;
export const WORLD_SEED = 'seed-world-test' as Seed;
export const CHECK_STREAM = 'rng-world-conflict-check' as RngStreamId;

function header<T extends string>(id: T, enabled = true) {
  return { id, schemaVersion: 1, packId: PACK_ID, enabled } as const;
}

// ── Definition ──────────────────────────────────────────────────────────────

export const NATIONS: readonly NationDefinition[] = [
  { ...header(NATION_ALPHA), cultureId: CULTURE_ALPHA, passagePolicyId: POLICY_ALPHA, display: { nameRef: { key: 'nation.alpha' } } },
  { ...header(NATION_BETA), cultureId: CULTURE_BETA, passagePolicyId: POLICY_BETA, display: { nameRef: { key: 'nation.beta' } } },
  { ...header(NATION_GAMMA), cultureId: CULTURE_ALPHA, passagePolicyId: POLICY_ALPHA, display: { nameRef: { key: 'nation.gamma' } } },
  { ...header(NATION_OFF, false), cultureId: CULTURE_BETA, passagePolicyId: POLICY_BETA, display: { nameRef: { key: 'nation.off' } } },
];

export const CULTURES: readonly CultureDefinition[] = [
  { ...header(CULTURE_ALPHA), itemPoolIds: [], nonHumanMonsterPoolIds: [], humanEnemyPoolIds: [], equipmentPoolIds: [], skillPoolIds: [] },
  { ...header(CULTURE_BETA), itemPoolIds: [], nonHumanMonsterPoolIds: [], humanEnemyPoolIds: [], equipmentPoolIds: [], skillPoolIds: [] },
];

export const REGIONS: readonly RegionDefinition[] = [
  {
    ...header(REGION_NORTH),
    nativeNationId: NATION_ALPHA,
    nativeCultureId: CULTURE_ALPHA,
    cityIds: [CITY_A, CITY_B],
    adventureSiteIds: [SITE_NORTH],
  },
  {
    ...header(REGION_SOUTH),
    nativeNationId: NATION_BETA,
    nativeCultureId: CULTURE_BETA,
    cityIds: [CITY_C, CITY_D, CITY_E],
    adventureSiteIds: [SITE_SOUTH],
  },
  {
    ...header(REGION_OFF, false),
    nativeNationId: NATION_BETA,
    nativeCultureId: CULTURE_BETA,
    cityIds: [],
    adventureSiteIds: [],
  },
];

export const CITY_NODES: readonly CityNodeDefinition[] = [
  { ...header(CITY_A), regionId: REGION_NORTH, adjacentRouteIds: [ROUTE_AB_1, ROUTE_AB_2, ROUTE_AC, ROUTE_OFF], adventureSiteIds: [SITE_NORTH], isCapital: true },
  { ...header(CITY_B), regionId: REGION_NORTH, adjacentRouteIds: [ROUTE_AB_1, ROUTE_AB_2, ROUTE_BD], adventureSiteIds: [], isCapital: false },
  { ...header(CITY_C), regionId: REGION_SOUTH, adjacentRouteIds: [ROUTE_AC, ROUTE_CD], adventureSiteIds: [SITE_SOUTH], isCapital: false },
  { ...header(CITY_D), regionId: REGION_SOUTH, adjacentRouteIds: [ROUTE_BD, ROUTE_CD, ROUTE_DE], adventureSiteIds: [], isCapital: false },
  { ...header(CITY_E), regionId: REGION_SOUTH, adjacentRouteIds: [ROUTE_DE], adventureSiteIds: [], isCapital: false },
  { ...header(CITY_ISLAND), regionId: REGION_SOUTH, adjacentRouteIds: [ROUTE_OFF], adventureSiteIds: [], isCapital: false },
];

export const ADVENTURE_SITES: readonly AdventureSiteDefinition[] = [
  { ...header(SITE_NORTH), regionId: REGION_NORTH, accessCityId: CITY_A, mapTemplateId: MAP_TEMPLATE, isNationalDungeon: true },
  { ...header(SITE_SOUTH), regionId: REGION_SOUTH, accessCityId: CITY_C, mapTemplateId: MAP_TEMPLATE, isNationalDungeon: false },
];

const TRAVEL_POOL = 'player-travel-pool-1' as PlayerTravelEventPoolId;

export const ROUTES: readonly RouteDefinition[] = [
  { ...header(ROUTE_AB_1), fromCityId: CITY_A, toCityId: CITY_B, playerTravelEventPoolId: TRAVEL_POOL, enabledByDefault: true },
  { ...header(ROUTE_AB_2), fromCityId: CITY_A, toCityId: CITY_B, playerTravelEventPoolId: TRAVEL_POOL, enabledByDefault: true },
  { ...header(ROUTE_AC), fromCityId: CITY_A, toCityId: CITY_C, playerTravelEventPoolId: TRAVEL_POOL, passagePolicyId: POLICY_BETA, enabledByDefault: true },
  { ...header(ROUTE_BD), fromCityId: CITY_B, toCityId: CITY_D, playerTravelEventPoolId: TRAVEL_POOL, enabledByDefault: true },
  { ...header(ROUTE_CD), fromCityId: CITY_C, toCityId: CITY_D, playerTravelEventPoolId: TRAVEL_POOL, enabledByDefault: true },
  { ...header(ROUTE_DE), fromCityId: CITY_D, toCityId: CITY_E, playerTravelEventPoolId: TRAVEL_POOL, enabledByDefault: false },
  { ...header(ROUTE_OFF, false), fromCityId: CITY_A, toCityId: CITY_ISLAND, playerTravelEventPoolId: TRAVEL_POOL, enabledByDefault: true },
];

export const CONFLICT_RULES: readonly ConflictRuleDefinition[] = [
  {
    ...header(CONFLICT_RULE),
    checkCadenceDays: CHECK_CADENCE_DAYS,
    eligibilityResolverId: ELIGIBILITY_RESOLVER,
    outcomeResolverId: OUTCOME_RESOLVER,
    marketPressureEffectIds: [],
    eventWeightEffectIds: [],
    passageEffectIds: [],
  },
  {
    ...header(CONFLICT_RULE_OFF, false),
    checkCadenceDays: CHECK_CADENCE_DAYS,
    eligibilityResolverId: ELIGIBILITY_RESOLVER,
    outcomeResolverId: OUTCOME_RESOLVER,
    marketPressureEffectIds: [],
    eventWeightEffectIds: [],
    passageEffectIds: [],
  },
  {
    ...header(CONFLICT_RULE_BAD_CADENCE),
    checkCadenceDays: 0,
    eligibilityResolverId: ELIGIBILITY_RESOLVER,
    outcomeResolverId: OUTCOME_RESOLVER,
    marketPressureEffectIds: [],
    eventWeightEffectIds: [],
    passageEffectIds: [],
  },
];

export const PASSAGE_POLICIES: readonly PassagePolicyDefinition[] = [
  { ...header(POLICY_ALPHA), requirementResolverId: PASSAGE_RESOLVER },
  { ...header(POLICY_BETA), requirementResolverId: PASSAGE_RESOLVER },
];

export const WORLD_FACTS: readonly WorldFactDefinition[] = [
  { ...header(FACT_BORDER_SEALED), valueKind: 'boolean', defaultValue: false, allowedSourceKinds: [FACT_SOURCE_QUEST] },
  { ...header(FACT_TAX_LEVEL), valueKind: 'number', defaultValue: 1, allowedSourceKinds: [FACT_SOURCE_CITY] },
  { ...header(FACT_OFF, false), valueKind: 'boolean', defaultValue: false, allowedSourceKinds: [FACT_SOURCE_QUEST] },
];

// ── stub Port ───────────────────────────────────────────────────────────────

function index<TId extends string, TDef extends { id: TId }>(
  defs: readonly TDef[],
): ReadonlyMap<string, TDef> {
  return new Map(defs.map((d) => [String(d.id), d]));
}

// 未知 ID 一律拋錯（與 data-runtime 的窄化 Reader 行為一致：讀不到就是壞內容引用）。
export function stubDefinitionReader(): WorldDefinitionReader {
  const nations = index(NATIONS);
  const cultures = index(CULTURES);
  const regions = index(REGIONS);
  const cities = index(CITY_NODES);
  const sites = index(ADVENTURE_SITES);
  const routes = index(ROUTES);
  const rules = index(CONFLICT_RULES);
  const policies = index(PASSAGE_POLICIES);
  const facts = index(WORLD_FACTS);

  function must<T>(table: ReadonlyMap<string, T>, id: string, what: string): T {
    const found = table.get(id);
    if (found === undefined) throw new Error(`world fixture reader: unknown ${what} "${id}"`);
    return found;
  }

  return {
    getNation: (id) => must(nations, String(id), 'nation'),
    getCulture: (id) => must(cultures, String(id), 'culture'),
    getRegion: (id) => must(regions, String(id), 'region'),
    getCityNode: (id) => must(cities, String(id), 'city-node'),
    getAdventureSite: (id) => must(sites, String(id), 'adventure-site'),
    getRoute: (id) => must(routes, String(id), 'route'),
    getConflictRule: (id) => must(rules, String(id), 'conflict-rule'),
    getPassagePolicy: (id) => must(policies, String(id), 'passage-policy'),
    getWorldFact: (id) => must(facts, String(id), 'world-fact'),
    listRoutesFrom: (cityId) =>
      must(cities, String(cityId), 'city-node').adjacentRouteIds.map((routeId) =>
        must(routes, String(routeId), 'route'),
      ),
  };
}

// 只有 SITE_NORTH 有既存 Map Instance；SITE_SOUTH 沒有（用來釘住 Query 跳過而非自造 ID）。
export function stubAdventureMapPort(
  overrides: Readonly<Partial<Record<string, MapInstanceId>>> = {},
): WorldAdventureMapPort {
  const table: Readonly<Partial<Record<string, MapInstanceId>>> = {
    [String(SITE_NORTH)]: MAP_NORTH,
    ...overrides,
  };
  return { getAdventureMapId: (siteId) => table[String(siteId)] };
}

export function makeIdAllocator(prefix = 'conflict'): WorldIdAllocator {
  let n = 0;
  return {
    nextConflictId: () => {
      n += 1;
      return `${prefix}-${n}` as ConflictId;
    },
  };
}

// 決定性衝突 Resolver：所有判定都由 cursor 決定（偶數 cursor → 開一場戰爭，奇數 → 不開），
// 期間與結果由此 stub 的資料位置提供。這模擬「資料調校 Resolver」，讓測試能同時驗
// 「同 cursor 同結果」與「cursor 逐次前進」。
export function stubConflictResolver(
  overrides: Readonly<{
    starts?: readonly ConflictStartDraft[];
    outcome?: ConflictOutcome;
    cursorStep?: number;
  }> = {},
): WorldConflictResolverPort {
  const step = overrides.cursorStep ?? 1;
  return {
    resolveConflictEligibility: (input) => {
      const cursor: number = input.rng.cursor;
      const starts =
        overrides.starts ??
        (cursor % 2 === 0
          ? [
              {
                attackerNationId: NATION_ALPHA,
                defenderNationId: NATION_BETA,
                affectedRegionIds: [REGION_SOUTH],
                resolveOnDay: (input.worldDay + CONFLICT_DURATION_DAYS) as WorldDay,
              },
            ]
          : []);
      return { starts, nextRngCursor: (cursor + step) as RngCursor };
    },
    resolveConflictOutcome: (input) => {
      const cursor: number = input.rng.cursor;
      return {
        outcome:
          overrides.outcome ?? {
            winnerNationId: input.attackerNationId,
            loserNationId: input.defenderNationId,
            affectedRegionIds: [...input.affectedRegionIds],
          },
        nextRngCursor: (cursor + step) as RngCursor,
      };
    },
  };
}

export function checkJobRngContext(cursor = 0): RngContext {
  return { worldSeed: WORLD_SEED, streamId: CHECK_STREAM, cursor: cursor as RngCursor };
}

// ── State ───────────────────────────────────────────────────────────────────

// 開局狀態：每個啟用的 Region 由其原生國控制（doc §8 不變量 3 的來源）。
export function fixtureWorldState(overrides: Partial<WorldState> = {}): WorldState {
  const base = createWorldState({
    regionControl: initialRegionControl(
      REGIONS.filter((r) => r.enabled),
      0 as WorldDay,
    ),
  });
  return { ...base, ...overrides };
}

export function activeConflict(
  input: Readonly<{
    conflictId?: string;
    revision?: Revision;
    state?: 'active' | 'resolved';
    affectedRegionIds?: readonly RegionId[];
  }> = {},
): ConflictState {
  const conflictId = (input.conflictId ?? 'conflict-1') as ConflictId;
  return {
    conflictId,
    conflictRuleId: CONFLICT_RULE,
    attackerNationId: NATION_ALPHA,
    defenderNationId: NATION_BETA,
    affectedRegionIds: [...(input.affectedRegionIds ?? [REGION_SOUTH])],
    state: input.state ?? 'active',
    startedOnDay: WORLD_DAY,
    rngContext: { worldSeed: WORLD_SEED, streamId: `conflict/${conflictId}` as RngStreamId, cursor: 0 as RngCursor },
    revision: input.revision ?? (0 as Revision),
  };
}

// ── 一站式 Context ──────────────────────────────────────────────────────────

export function makeContext(overrides: Partial<WorldHandlerContext> = {}): WorldHandlerContext {
  return {
    worldDay: overrides.worldDay ?? WORLD_DAY,
    definitions: overrides.definitions ?? stubDefinitionReader(),
    ids: overrides.ids ?? makeIdAllocator(),
    conflicts: overrides.conflicts ?? stubConflictResolver(),
  };
}
