// modules/team/fixtures.ts
// 最小 Fixture：一支玩家隊伍（2 名成員，位於城市）+ 一支單人 NPC 隊伍。
// 另附測試用的決定性 stub Port（Definition Reader / World Reader / Resolver / ID 配發器 / Context）。
// 所有 stub 皆為決定性（無 RNG/時間）；RNG 只在 Resolver Port 內以注入結果模擬。

import type {
  TeamId,
  CharacterId,
  TeamPlanId,
  FreeActionId,
  InteractionId,
  ActivityRecordId,
  MapInstanceId,
  CityId,
  RouteId,
  TravelModeId,
  NpcTravelRuleId,
  ExperienceAwardRuleId,
  TeamPlanRuleId,
  MemberRetentionRuleId,
  ContentPackId,
  WorldDay,
  Revision,
  RngContext,
  RngStep,
  RngCursor,
} from '../../contracts/core';
import type {
  TeamDefinitionReader,
  PlayerTravelModeDefinition,
  NpcTravelRuleDefinition,
  FreeActionRuleDefinition,
  TeamPlanRuleDefinition,
  RecentActivityRuleDefinition,
  MemberRetentionRuleDefinition,
  RecruitmentRuleDefinition,
  TeamFormationRuleDefinition,
  NonPlayerMemberDailySocialPracticeRuleDefinition,
  PlayerTravelEventWeightProfileId,
  FreeActionRuleId,
  RecentActivityRuleId,
} from '../../contracts/team';
import type { GridCell } from '../../contracts/map';
import type {
  MemberFreeAction,
  Team,
  TeamCombatFormation,
  TeamMemberRetentionState,
  TeamState,
} from './state';
import { createTeamState, emptyWorkSettlement } from './state';
import type {
  TeamCombatStatusQuery,
  TeamCityFacilityQuery,
  TeamHandlerContext,
  TeamIdAllocator,
  TeamResolverPort,
  TeamWorldReader,
} from './system';

// ── 常數 ID ─────────────────────────────────────────────────────────────
const PACK_ID = 'pack-test' as ContentPackId;

export const PLAYER_TEAM_ID = 'team-player' as TeamId;
export const NPC_TEAM_ID = 'team-npc' as TeamId;

export const PLAYER_LEADER_ID = 'char-player' as CharacterId;
export const PLAYER_MEMBER_ID = 'char-companion' as CharacterId;
export const NPC_LEADER_ID = 'char-npc' as CharacterId;

export const CITY_A = 'city-a' as CityId;
// 冒險據點對應的 MapInstance——由 map 模組擁有、世界建立時就存在。Team 只查它。
export const SITE_MAP_INSTANCE = 'runtime:map-instance:site-1' as MapInstanceId;
export const CITY_B = 'city-b' as CityId;
export const ROUTE_AB = 'route-ab' as RouteId;

export const TRAVEL_MODE_3 = 'travel-3' as TravelModeId;
export const TRAVEL_MODE_6 = 'travel-6' as TravelModeId;
export const TRAVEL_MODE_9 = 'travel-9' as TravelModeId;
export const NPC_TRAVEL_RULE = 'npc-travel-6' as NpcTravelRuleId;

// 計畫與留隊規則：正式路徑由 Content Pack 供給，fixture 代表「資料齊全」的那一側。
export const HOME_REST_PLAN_RULE = 'plan-rule-home-rest' as TeamPlanRuleId;
export const CITY_FACILITY_PLAN_RULE = 'plan-rule-city-facility' as TeamPlanRuleId;
export const MEMBER_RETENTION_RULE = 'retention-rule-standard' as MemberRetentionRuleId;

const TRAVEL_XP_RULE = 'xp-travel' as ExperienceAwardRuleId;
const TRAVEL_EVENT_PROFILE = 'travel-events' as PlayerTravelEventWeightProfileId;

// 酒館可見性的資料側：NPC 正式成員的 tavernVisit 自由行動（doc §2.3）。fixture 代表「資料齊全」
// 的那一側；缺資料那一側由測試自己把這筆行動拿掉來製造。
export const TAVERN_VISIT_RULE = 'free-action-tavern-visit' as FreeActionRuleId;
export const NPC_TAVERN_FREE_ACTION = 'free-action-npc-tavern' as FreeActionId;
// NPC 隊的**暫時**成員（在 temporaryMemberIds、不在 memberIds）：用來釘住「只有正式成員上酒館名單」。
export const NPC_TEMPORARY_ID = 'char-npc-temporary' as CharacterId;
export const NPC_TEMPORARY_FREE_ACTION = 'free-action-npc-temporary' as FreeActionId;

// ── Fixture Slice ─────────────────────────────────────────────────────────

function cellRowMajor(index: number): GridCell {
  return { floor: 0, row: Math.floor(index / 3), col: index % 3 };
}

export function makeFormation(teamId: TeamId, memberIds: readonly CharacterId[]): TeamCombatFormation {
  const placements: Record<CharacterId, GridCell> = {};
  memberIds.forEach((id, i) => {
    placements[id] = cellRowMajor(i);
  });
  return { teamId, placements, revision: 0 as Revision };
}

// 玩家隊：leader + 1 名隊友，位於 CITY_A；NPC 隊：單人，位於 CITY_A。
export function fixtureTeamState(worldDay: WorldDay = 20000 as WorldDay): TeamState {
  const playerMembers = [PLAYER_LEADER_ID, PLAYER_MEMBER_ID];
  const playerTeam: Team = {
    teamId: PLAYER_TEAM_ID,
    control: 'player',
    memberIds: playerMembers,
    temporaryMemberIds: [],
    leaderId: PLAYER_LEADER_ID,
    location: { kind: 'city', cityId: CITY_A },
    revision: 0 as Revision,
  };
  const npcTeam: Team = {
    teamId: NPC_TEAM_ID,
    control: 'npc',
    memberIds: [NPC_LEADER_ID],
    temporaryMemberIds: [],
    leaderId: NPC_LEADER_ID,
    location: { kind: 'city', cityId: CITY_A },
    revision: 0 as Revision,
  };

  // 入隊日：leader 世界起點；隊友入隊已滿 60 日（供留隊測試）。
  const retention: TeamMemberRetentionState = {
    teamId: PLAYER_TEAM_ID,
    memberJoinedOnDay: {
      [PLAYER_LEADER_ID]: (worldDay - 1000) as WorldDay,
      [PLAYER_MEMBER_ID]: (worldDay - 200) as WorldDay,
    },
    currentWorkSettlement: emptyWorkSettlement((worldDay - 200) as WorldDay),
    revision: 0 as Revision,
  };

  // NPC 隊長正在 CITY_A 的酒館裡 → 他出現在 listTavernVisitorIds(CITY_A)，因此可被嘗試招募。
  const npcTavernVisit: MemberFreeAction = {
    freeActionId: NPC_TAVERN_FREE_ACTION,
    teamId: NPC_TEAM_ID,
    memberId: NPC_LEADER_ID,
    ruleId: TAVERN_VISIT_RULE,
    status: 'active',
    accumulatedFreeDays: 0,
    payload: { kind: 'tavernVisit' },
    revision: 0 as Revision,
  };

  return createTeamState({
    playerTeamId: PLAYER_TEAM_ID,
    teams: [playerTeam, npcTeam],
    freeActions: [npcTavernVisit],
    combatFormations: [
      makeFormation(PLAYER_TEAM_ID, playerMembers),
      makeFormation(NPC_TEAM_ID, [NPC_LEADER_ID]),
    ],
    memberRetention: [retention],
  });
}

// 改寫 NPC 隊長那筆自由行動的欄位（status / payload / memberId …），**保留這筆紀錄的存在**。
//
// 為什麼需要它而不是只有 withoutTavernVisitors：整筆拿掉只能證明「Slice 上沒有資料時看不到人」，
// 證不了可見性判準真的有在讀 status 與 payload.kind。少了這個入口，判準退化成「有沒有任何一筆
// 自由行動」也不會有任何測試變紅——已結束的酒館行程、甚至一筆 rest，都會被當成「人在酒館」。
export function withNpcLeaderFreeAction(
  state: TeamState,
  overrides: Partial<MemberFreeAction>,
): TeamState {
  const base = state.freeActions[NPC_TAVERN_FREE_ACTION];
  if (base === undefined) {
    throw new Error('fixture 前提不成立：NPC 隊長的自由行動不存在');
  }
  return {
    ...state,
    freeActions: { ...state.freeActions, [NPC_TAVERN_FREE_ACTION]: { ...base, ...overrides } },
  };
}

// 在 NPC 隊加一名**暫時**成員，並讓他也選了 tavernVisit。正式成員與暫時成員的差別只在
// memberIds／temporaryMemberIds，其餘欄位完全一樣——所以這是唯一能釘住「名單只收正式成員」的資料形狀。
export function withTemporaryMemberInTavern(state: TeamState): TeamState {
  const npcTeam = state.teams[NPC_TEAM_ID];
  if (npcTeam === undefined) throw new Error('fixture 前提不成立：NPC 隊不存在');
  const temporaryVisit: MemberFreeAction = {
    freeActionId: NPC_TEMPORARY_FREE_ACTION,
    teamId: NPC_TEAM_ID,
    memberId: NPC_TEMPORARY_ID,
    ruleId: TAVERN_VISIT_RULE,
    status: 'active',
    accumulatedFreeDays: 0,
    payload: { kind: 'tavernVisit' },
    revision: 0 as Revision,
  };
  return {
    ...state,
    teams: {
      ...state.teams,
      [NPC_TEAM_ID]: { ...npcTeam, temporaryMemberIds: [...npcTeam.temporaryMemberIds, NPC_TEMPORARY_ID] },
    },
    freeActions: { ...state.freeActions, [NPC_TEMPORARY_FREE_ACTION]: temporaryVisit },
  };
}

// 從 Slice 拿掉所有 tavernVisit 自由行動：代表「這座城的酒館裡沒有人」的那一側。
export function withoutTavernVisitors(state: TeamState): TeamState {
  const freeActions: Record<FreeActionId, MemberFreeAction> = {};
  for (const [key, action] of Object.entries(state.freeActions)) {
    if (action.payload.kind === 'tavernVisit') continue;
    freeActions[key as FreeActionId] = action;
  }
  return { ...state, freeActions };
}

// ── Stub Definition Reader ─────────────────────────────────────────────────

function header(id: string) {
  return { id: id as never, schemaVersion: 1, packId: PACK_ID, enabled: true };
}

const PLAYER_MODES: Readonly<Record<string, PlayerTravelModeDefinition>> = {
  [TRAVEL_MODE_3]: {
    ...header(TRAVEL_MODE_3),
    display: { nameRef: { key: `text.fixture.travel_mode_3.name` } },
    durationDays: 3,
    segments: [1, 1, 1],
    travelExperienceRuleId: TRAVEL_XP_RULE,
    travelExperienceMultiplier: 0.5,
    travelEventWeightProfileId: TRAVEL_EVENT_PROFILE,
  },
  [TRAVEL_MODE_6]: {
    ...header(TRAVEL_MODE_6),
    display: { nameRef: { key: `text.fixture.travel_mode_6.name` } },
    durationDays: 6,
    segments: [2, 2, 2],
    travelExperienceRuleId: TRAVEL_XP_RULE,
    travelExperienceMultiplier: 1,
    travelEventWeightProfileId: TRAVEL_EVENT_PROFILE,
  },
  [TRAVEL_MODE_9]: {
    ...header(TRAVEL_MODE_9),
    display: { nameRef: { key: `text.fixture.travel_mode_9.name` } },
    durationDays: 9,
    segments: [3, 3, 3],
    travelExperienceRuleId: TRAVEL_XP_RULE,
    travelExperienceMultiplier: 2,
    travelEventWeightProfileId: TRAVEL_EVENT_PROFILE,
  },
};

const NPC_TRAVEL: NpcTravelRuleDefinition = {
  ...header(NPC_TRAVEL_RULE),
  durationDays: 6,
  travelExperienceRuleId: TRAVEL_XP_RULE,
  travelExperienceMultiplier: 1,
  eventPolicy: 'none',
};

export function stubDefinitionReader(): TeamDefinitionReader {
  return {
    getPlayerTravelMode: (id): PlayerTravelModeDefinition => {
      const found = PLAYER_MODES[id];
      if (found === undefined) throw new Error(`stub: unknown travel mode "${String(id)}"`);
      return found;
    },
    getNpcTravelRule: (): NpcTravelRuleDefinition => NPC_TRAVEL,
    getFreeActionRule: (id: FreeActionRuleId): FreeActionRuleDefinition => ({
      ...header(id),
      freeActionKind: 'craft',
      requiredFreeDays: 3,
    }),
    // durationDays 依 fixture 的 plan rule id 給值：homeRest 365、其餘 1。
    // 正式路徑由 Content Pack 提供；fixture 在此代表「資料齊全」的那一側，
    // 缺資料那一側由 makeContext 的 teamPlanRuleIdByKind 留空來測試。
    getTeamPlanRule: (id): TeamPlanRuleDefinition =>
      String(id) === String(HOME_REST_PLAN_RULE)
        ? { ...header(id), planKind: 'homeRest', durationDays: 365 }
        : { ...header(id), planKind: 'cityFacilityAction', durationDays: 1 },
    getRecentActivityRule: (id: RecentActivityRuleId): RecentActivityRuleDefinition => ({
      ...header(id),
      maxRecordsPerCharacter: 10,
    }),
    getMemberRetentionRule: (id): MemberRetentionRuleDefinition => ({
      ...header(id),
      activationDaysAfterJoin: 60,
      expectedNetSettlementResolverId: 'resolver-expected-net' as never,
      departureChanceResolverId: 'resolver-departure' as never,
      excludedExpenseKinds: ['equipmentPurchase'],
      countedIncomeKinds: ['questReward', 'dungeonReward'],
      countedExpenseKinds: ['travelExpense', 'consumableUse'],
    }),
    getRecruitmentRule: (id): RecruitmentRuleDefinition => ({
      ...header(id),
      successChanceResolverId: 'resolver-recruit' as never,
      retryEligibilityResolverId: 'resolver-retry' as never,
    }),
    getTeamFormationRule: (id): TeamFormationRuleDefinition => ({
      ...header(id),
      defaultPlacementResolverId: 'resolver-placement' as never,
    }),
    getNonPlayerMemberDailySocialPracticeRule: (
      id,
    ): NonPlayerMemberDailySocialPracticeRuleDefinition => ({
      ...header(id),
      conversationExperienceRuleId: 'xp-conversation' as never,
      commerceExperienceRuleId: 'xp-commerce' as never,
    }),
  };
}

// ── Stub World Reader ───────────────────────────────────────────────────────

export function stubWorldReader(overrides: Partial<TeamWorldReader> = {}): TeamWorldReader {
  return {
    getAdventureSiteCity: () => CITY_A,
    getMapExitCity: () => CITY_A,
    // 世界裡本來就存在的 MapInstance（由 map 模組擁有）。Team 只查、不鑄。
    getAdventureSiteMapInstance: () => SITE_MAP_INSTANCE,
    ...overrides,
  };
}

// ── Stub Combat Status Query ────────────────────────────────────────────────

// 預設「沒有進行中的 Encounter」。要測戰鬥中的分支就覆寫 hasActiveEncounter。
export function stubCombatStatusQuery(
  overrides: Partial<TeamCombatStatusQuery> = {},
): TeamCombatStatusQuery {
  return { hasActiveEncounter: () => false, ...overrides };
}

// 單元測試預設「城市什麼設施都有」——設施門檻的**拒絕**路徑由明確覆寫這個 stub 來測，
// 而不是靠預設值碰巧為 false（那會讓每一條無關的測試都要先想起設施這回事）。
export function stubCityFacilityQuery(
  overrides: Partial<TeamCityFacilityQuery> = {},
): TeamCityFacilityQuery {
  return { hasOpenFacilityKind: () => true, ...overrides };
}

// ── Stub Resolver Port ──────────────────────────────────────────────────────

// 擲骰型 Resolver 的 RngStep 建構子：nextCursor = 入參 cursor + 1（模擬「消費一格」），讓串接迴圈可見
// 游標前進；無 rngContext 時以 0 起。stub 與測試覆寫共用，把品牌型別轉換集中於此。
export function rngStepBool(value: boolean, rngContext?: RngContext): RngStep<boolean> {
  return { value, nextCursor: (((rngContext?.cursor ?? 0) as number) + 1) as RngCursor };
}

// 預設：招募成功、成員不離隊、預設配置以 row-major 覆蓋全隊。
export function stubResolverPort(overrides: Partial<TeamResolverPort> = {}): TeamResolverPort {
  const base: TeamResolverPort = {
    resolveRecruitmentSuccess: ({ rngContext }) => rngStepBool(true, rngContext),
    resolveMemberDeparture: ({ rngContext }) => rngStepBool(false, rngContext),
    resolveDefaultPlacement: ({ memberIds }) => {
      const placements: Record<CharacterId, GridCell> = {};
      memberIds.forEach((id, i) => {
        placements[id] = cellRowMajor(i);
      });
      return placements;
    },
  };
  return { ...base, ...overrides };
}

// ── Stub ID 配發器 ────────────────────────────────────────────────────────

export function makeIdAllocator(prefix = 'gen'): TeamIdAllocator {
  let n = 0;
  const next = (kind: string): string => {
    n += 1;
    return `${prefix}-${kind}-${n}`;
  };
  return {
    nextTeamId: () => next('team') as TeamId,
    nextTeamPlanId: () => next('plan') as TeamPlanId,
    nextFreeActionId: () => next('free') as FreeActionId,
    nextInteractionId: () => next('interaction') as InteractionId,
    nextActivityRecordId: () => next('activity') as ActivityRecordId,
  };
}

// ── 一站式 Handler Context ───────────────────────────────────────────────────

export function makeContext(overrides: Partial<TeamHandlerContext> = {}): TeamHandlerContext {
  return {
    worldDay: overrides.worldDay ?? (20000 as WorldDay),
    definitions: overrides.definitions ?? stubDefinitionReader(),
    memberRetentionRuleId: overrides.memberRetentionRuleId ?? MEMBER_RETENTION_RULE,
    teamPlanRuleIdByKind: overrides.teamPlanRuleIdByKind ?? {
      homeRest: HOME_REST_PLAN_RULE,
      cityFacilityAction: CITY_FACILITY_PLAN_RULE,
    },
    world: overrides.world ?? stubWorldReader(),
    combat: overrides.combat ?? stubCombatStatusQuery(),
    city: overrides.city ?? stubCityFacilityQuery(),
    ids: overrides.ids ?? makeIdAllocator(),
    resolvers: overrides.resolvers ?? stubResolverPort(),
    ...(overrides.rngContext ? { rngContext: overrides.rngContext } : {}),
  };
}
