// modules/map/fixtures.ts
// 最小 Fixture：一張小型內部圖 Template（含紅門、固定陷阱、NPC-enabled 採集點與一個內容槽房間）
// + 一個 v1 MapInstance，另附決定性 stub Port（MapDefinitionReader / WorldQuery / TeamPresenceQuery /
// MapContentResolver / IdAllocator / DeterministicRng）與一站式 MapHandlerContext。
// 所有 stub 皆為決定性（無真 RNG／時間）；RNG 以顯式 cursor 的雜湊模擬。

import type {
  MapTemplateId,
  MapSpawnRuleId,
  NpcSequenceRuleId,
  GatheringRuleId,
  ExperienceAwardRuleId,
  CultureContentRuleId,
  ChestPoolId,
  MapEventPoolId,
  ResolverId,
  RoomId,
  RoomLinkId,
  FixedTrapId,
  TrapDefinitionId,
  GatheringNodeId,
  MapInstanceId,
  ContentInstanceId,
  MapRefreshLockId,
  AdventureSiteId,
  EncounterGroupDefinitionId,
  ContentEventDefinitionId,
  DefinitionId,
  ContentPackId,
  Revision,
  WorldDay,
  Seed,
  RngStreamId,
  RngCursor,
  CityId,
  RegionId,
  NationId,
  CultureId,
  RouteId,
  DeterministicRng,
} from '../../contracts/core';
import type {
  MapState,
  MapInstance,
  MapTemplateDefinition,
  MapSpawnRuleDefinition,
  NpcSequenceRuleDefinition,
  MapContentDefinition,
  MapDefinitionReader,
  TeamPresenceQuery,
} from '../../contracts/map';
import type {
  WorldQuery,
  RouteAccessView,
  MarketPressureView,
  EventWeightModifierView,
} from '../../contracts/world';
import type {
  MapHandlerContext,
  MapIdAllocator,
  MapContentResolver,
  SpawnDraft,
} from './system';
import { createMapState, buildSpatialRuntime } from './state';

// ── ID 常數 ──────────────────────────────────────────────────────────────────
const PACK_ID = 'pack-test' as ContentPackId;

export const TEMPLATE_ID = 'tmpl-interior-1' as MapTemplateId;
export const SPAWN_RULE_ID = 'spawn-1' as MapSpawnRuleId;
export const NPC_SEQ_RULE_ID = 'npc-seq-1' as NpcSequenceRuleId;
export const GATHERING_RULE_ID = 'gather-rule-1' as GatheringRuleId;
export const EXP_RULE_ID = 'exp-rule-1' as ExperienceAwardRuleId;

export const ROOM_ENTRANCE = 'room-entrance' as RoomId;
export const ROOM_CONTENT = 'room-content' as RoomId; // 唯一可承載內容的房間
export const ROOM_BEHIND_DOOR = 'room-behind' as RoomId; // 出口
export const ROOM_GATHER = 'room-gather' as RoomId;
export const ROOM_TRAP = 'room-trap' as RoomId;

export const LINK_PASSAGE = 'link-passage' as RoomLinkId;
export const LINK_RED = 'link-red' as RoomLinkId; // 紅門
export const TRAP_ID = 'trap-1' as FixedTrapId;
const TRAP_DEF_ID = 'trapdef-spike' as TrapDefinitionId;
export const NODE_ID = 'node-1' as GatheringNodeId;

export const MAP_ID = 'map-1' as MapInstanceId;
export const ADVENTURE_SITE_ID = 'site-1' as AdventureSiteId;

const CHEST_POOL_ID = 'chest-pool-1' as ChestPoolId;
const EVENT_POOL_ID = 'event-pool-1' as MapEventPoolId;
const LOCAL_CULTURE_RULE_ID = 'culture-local-1' as CultureContentRuleId;
const HUMAN_CULTURE_RULE_ID = 'culture-human-1' as CultureContentRuleId;

const MONSTER_RESOLVER_ID = 'resolver-monster' as ResolverId;
const CHEST_RESOLVER_ID = 'resolver-chest' as ResolverId;
const GATHER_RESOLVER_ID = 'resolver-gather' as ResolverId;
const ENCOUNTER_GROUP_ID = 'enc-group-1' as EncounterGroupDefinitionId;
const EVENT_DEF_ID = 'content-event-1' as ContentEventDefinitionId;
const MONSTER_CONTENT_DEF_ID = 'def-monster' as DefinitionId;
const CHEST_CONTENT_DEF_ID = 'def-chest' as DefinitionId;
const EVENT_CONTENT_DEF_ID = 'def-event' as DefinitionId;
const MISC_CONTENT_DEF_ID = 'def-misc' as DefinitionId;

// ── Template / Spawn Rule ────────────────────────────────────────────────────

function cell(floor: number, row: number, col: number) {
  return { floor, row, col };
}

export const TEMPLATE: MapTemplateDefinition = {
  id: TEMPLATE_ID,
  schemaVersion: 1,
  packId: PACK_ID,
  enabled: true,
  kind: 'interior',
  refreshOffsetDays: 3,
  floors: [{ floor: 0, rows: 3, cols: 3 }],
  rooms: [
    { roomId: ROOM_ENTRANCE, floor: 0, cells: [cell(0, 0, 0)] },
    { roomId: ROOM_CONTENT, floor: 0, cells: [cell(0, 0, 1), cell(0, 0, 2)] }, // 多格房間，仍只一個內容槽
    { roomId: ROOM_BEHIND_DOOR, floor: 0, cells: [cell(0, 1, 1)] },
    { roomId: ROOM_GATHER, floor: 0, cells: [cell(0, 2, 2)] },
    { roomId: ROOM_TRAP, floor: 0, cells: [cell(0, 2, 0)] },
  ],
  links: [
    {
      linkId: LINK_PASSAGE,
      fromRoomId: ROOM_ENTRANCE,
      toRoomId: ROOM_CONTENT,
      fromCell: cell(0, 0, 0),
      toCell: cell(0, 0, 1),
      kind: 'passage',
    },
    {
      linkId: LINK_RED,
      fromRoomId: ROOM_CONTENT,
      toRoomId: ROOM_BEHIND_DOOR,
      fromCell: cell(0, 0, 1),
      toCell: cell(0, 1, 1),
      kind: 'redDoor',
      guardedPreferenceKinds: ['largeEnemy'],
    },
  ],
  fixedTraps: [{ trapId: TRAP_ID, roomId: ROOM_TRAP, cell: cell(0, 2, 0), trapDefinitionId: TRAP_DEF_ID }],
  gatheringNodes: [
    { nodeId: NODE_ID, roomId: ROOM_GATHER, cell: cell(0, 2, 2), gatheringRuleId: GATHERING_RULE_ID },
  ],
  entranceRoomIds: [ROOM_ENTRANCE],
  exitRoomIds: [ROOM_BEHIND_DOOR],
  spawnRuleId: SPAWN_RULE_ID,
  explorationExperienceRuleId: EXP_RULE_ID,
};

export const SPAWN_RULE: MapSpawnRuleDefinition = {
  id: SPAWN_RULE_ID,
  schemaVersion: 1,
  packId: PACK_ID,
  enabled: true,
  localCultureContentRuleId: LOCAL_CULTURE_RULE_ID,
  humanCultureContentRuleId: HUMAN_CULTURE_RULE_ID,
  chestPoolId: CHEST_POOL_ID,
  mapEventPoolId: EVENT_POOL_ID,
  spawnBudgets: [{ contentKind: 'monsterGroup', minCount: 1, maxCount: 1 }],
  npcSequenceRuleId: NPC_SEQ_RULE_ID,
};

// ── MapInstance / State ──────────────────────────────────────────────────────

export function fixtureMapInstance(currentVersion = 1): MapInstance {
  return {
    mapId: MAP_ID,
    adventureSiteId: ADVENTURE_SITE_ID,
    templateId: TEMPLATE_ID,
    currentVersion,
    refresh: { offsetDays: TEMPLATE.refreshOffsetDays },
    spatialRuntime: buildSpatialRuntime(TEMPLATE, currentVersion),
    revision: 0 as Revision,
  };
}

export function fixtureMapState(currentVersion = 1): MapState {
  return createMapState({ instances: [fixtureMapInstance(currentVersion)] });
}

// ── Stub Port ────────────────────────────────────────────────────────────────

function header<TId extends DefinitionId>(id: TId) {
  return { id, schemaVersion: 1, packId: PACK_ID, enabled: true };
}

export function stubDefinitionReader(): MapDefinitionReader {
  return {
    getMapTemplate: () => TEMPLATE,
    getMapSpawnRule: () => SPAWN_RULE,
    getNpcSequenceRule: (id): NpcSequenceRuleDefinition => ({
      ...header(id as unknown as DefinitionId),
      id: id as unknown as DefinitionId,
      npcSequenceRuleId: id,
    }),
    getContentDefinition: (id): MapContentDefinition => ({
      ...header(id),
      contentKind: 'monsterGroup',
    }),
    getGatheringMapView: (id) => ({
      ruleId: id,
      npcPolicy: { eligible: true, pointCost: 1, resolverId: GATHER_RESOLVER_ID },
    }),
  };
}

// 完整 WorldQuery stub：文化／控制國回傳固定值，其餘查詢回傳最小合法結果。
export function stubWorldQuery(): WorldQuery {
  const REGION_ID = 'region-1' as RegionId;
  const CITY_ID = 'city-1' as CityId;
  const NATION_ID = 'nation-1' as NationId;
  const CULTURE_ID = 'culture-1' as CultureId;
  return {
    getCityGapCount: () => undefined,
    getShortestRoute: () => undefined,
    listCitiesWithinHops: () => [] as CityId[],
    listAdventureMapsForCities: () => [] as MapInstanceId[],
    getRegionForCity: () => REGION_ID,
    getRegionForSite: () => REGION_ID,
    getAccessCityForSite: () => CITY_ID,
    getNativeCulture: () => CULTURE_ID,
    getControllerNation: () => NATION_ID,
    getHumanEnemyCulture: () => CULTURE_ID,
    getRouteAccess: (routeId: RouteId): RouteAccessView => ({ routeId, accessState: 'open' }),
    listMarketPressures: () => [] as MarketPressureView[],
    listEventWeightModifiers: () => [] as EventWeightModifierView[],
    getWorldFact: () => 0,
  };
}

// 可設定佔用行為的 TeamPresenceQuery stub。預設：無人在圖內、指定隊伍視為在圖內。
export function stubPresence(
  opts: Readonly<{ teamsInside?: number; teamIsInside?: boolean }> = {},
): TeamPresenceQuery {
  return {
    countTeamsInside: () => opts.teamsInside ?? 0,
    isTeamInside: () => opts.teamIsInside ?? true,
  };
}

// 決定性 ID 配發器（前綴 + 遞增計數；模擬交易私有 cursor）。
export function makeIdAllocator(prefix = 'gen'): MapIdAllocator {
  let n = 0;
  const next = (kind: string): string => {
    n += 1;
    return `${prefix}-${kind}-${n}`;
  };
  return {
    nextContentInstanceId: () => next('content') as ContentInstanceId,
    nextMapRefreshLockId: () => next('lock') as MapRefreshLockId,
  };
}

// 決定性 RNG：以 cursor 雜湊產生 [0,1) 值；nextInt 夾入 [min,max]。
export function stubRng(): DeterministicRng {
  const hash = (n: number): number => {
    let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 0x100000000;
  };
  return {
    nextFloat: ({ cursor }) => ({
      value: hash(cursor as unknown as number),
      nextCursor: ((cursor as unknown as number) + 1) as RngCursor,
    }),
    nextInt: ({ cursor, minInclusive, maxInclusive }) => {
      const f = hash(cursor as unknown as number);
      const span = maxInclusive - minInclusive + 1;
      return {
        value: minInclusive + Math.floor(f * span),
        nextCursor: ((cursor as unknown as number) + 1) as RngCursor,
      };
    },
  };
}

export function stubRngContext(): { worldSeed: Seed; streamId: RngStreamId; cursor: RngCursor } {
  return {
    worldSeed: 'seed-test' as Seed,
    streamId: 'rng-map' as RngStreamId,
    cursor: 0 as RngCursor,
  };
}

// 資料 Resolver stub：依 contentKind 供給 payload / definitionId / NPC Policy。
export function stubContentResolver(): MapContentResolver {
  return {
    resolveSpawnPayload: ({ kind }): SpawnDraft => {
      switch (kind) {
        case 'monsterGroup':
        case 'boss':
          return {
            kind,
            definitionId: MONSTER_CONTENT_DEF_ID,
            payload: { kind, encounterGroupId: ENCOUNTER_GROUP_ID },
            npcEligible: true,
            npcPointCost: kind === 'boss' ? 4 : 1,
            npcResolverId: MONSTER_RESOLVER_ID,
          };
        case 'chest':
          return {
            kind,
            definitionId: CHEST_CONTENT_DEF_ID,
            payload: { kind: 'chest', itemIds: [] },
            npcEligible: true,
            npcPointCost: 1,
            npcResolverId: CHEST_RESOLVER_ID,
          };
        case 'mapEvent':
          return {
            kind,
            definitionId: EVENT_CONTENT_DEF_ID,
            payload: { kind: 'mapEvent', contentEventDefinitionId: EVENT_DEF_ID },
            npcEligible: false,
          };
        default:
          // TODO: kidnap / control 內容生成未實作；以空控制者 payload 佔位。
          return {
            kind,
            definitionId: MISC_CONTENT_DEF_ID,
            payload: { kind: 'control', controllerContentIds: [] },
            npcEligible: false,
          };
      }
    },
  };
}

// 一站式 Handler Context（測試預設）。
export function makeContext(
  overrides: Partial<MapHandlerContext> = {},
): MapHandlerContext {
  return {
    worldDay: (overrides.worldDay ?? (100 as WorldDay)) as WorldDay,
    definitions: overrides.definitions ?? stubDefinitionReader(),
    world: overrides.world ?? stubWorldQuery(),
    presence: overrides.presence ?? stubPresence(),
    ids: overrides.ids ?? makeIdAllocator(),
    rng: overrides.rng ?? stubRng(),
    rngContext: overrides.rngContext ?? stubRngContext(),
    resolvers: overrides.resolvers ?? stubContentResolver(),
  };
}
