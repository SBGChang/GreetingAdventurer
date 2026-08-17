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
  Team,
  TeamCombatFormation,
  TeamMemberRetentionState,
  TeamState,
} from './state';
import { createTeamState, emptyWorkSettlement } from './state';
import type {
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

  return createTeamState({
    playerTeamId: PLAYER_TEAM_ID,
    teams: [playerTeam, npcTeam],
    combatFormations: [
      makeFormation(PLAYER_TEAM_ID, playerMembers),
      makeFormation(NPC_TEAM_ID, [NPC_LEADER_ID]),
    ],
    memberRetention: [retention],
  });
}

// ── Stub Definition Reader ─────────────────────────────────────────────────

function header(id: string) {
  return { id: id as never, schemaVersion: 1, packId: PACK_ID, enabled: true };
}

const PLAYER_MODES: Readonly<Record<string, PlayerTravelModeDefinition>> = {
  [TRAVEL_MODE_3]: {
    ...header(TRAVEL_MODE_3),
    durationDays: 3,
    segments: [1, 1, 1],
    travelExperienceRuleId: TRAVEL_XP_RULE,
    travelExperienceMultiplier: 0.5,
    travelEventWeightProfileId: TRAVEL_EVENT_PROFILE,
  },
  [TRAVEL_MODE_6]: {
    ...header(TRAVEL_MODE_6),
    durationDays: 6,
    segments: [2, 2, 2],
    travelExperienceRuleId: TRAVEL_XP_RULE,
    travelExperienceMultiplier: 1,
    travelEventWeightProfileId: TRAVEL_EVENT_PROFILE,
  },
  [TRAVEL_MODE_9]: {
    ...header(TRAVEL_MODE_9),
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
      kind: 'craft',
      requiredFreeDays: 3,
    }),
    // durationDays 依 fixture 的 plan rule id 給值：homeRest 365、其餘 1。
    // 正式路徑由 Content Pack 提供；fixture 在此代表「資料齊全」的那一側，
    // 缺資料那一側由 makeContext 的 teamPlanRuleIdByKind 留空來測試。
    getTeamPlanRule: (id): TeamPlanRuleDefinition =>
      String(id) === String(HOME_REST_PLAN_RULE)
        ? { ...header(id), kind: 'homeRest', durationDays: 365 }
        : { ...header(id), kind: 'cityFacilityAction', durationDays: 1 },
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

export function stubWorldReader(): TeamWorldReader {
  return {
    getAdventureSiteCity: () => CITY_A,
    getMapExitCity: () => CITY_A,
  };
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
    nextMapInstanceId: () => next('map') as MapInstanceId,
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
    ids: overrides.ids ?? makeIdAllocator(),
    resolvers: overrides.resolvers ?? stubResolverPort(),
    ...(overrides.rngContext ? { rngContext: overrides.rngContext } : {}),
  };
}
