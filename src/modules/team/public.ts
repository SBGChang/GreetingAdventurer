// modules/team/public.ts
// Team 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。
// Composition 只從這裡取得 state 工廠、handler、query、fixture，不深入子檔。

import type {
  ModuleContract,
  ModuleId,
  StateSliceName,
  ReaderPortId,
  EventSubscriptionId,
  InvariantId,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/team';

// ── State slice 與工廠 ────────────────────────────────────────────────────
export {
  createTeamState,
  emptyWorkSettlement,
  workNetOf,
  tryGetTeam,
  requireTeam,
  tryGetPlan,
  upsertTeam,
  removeTeam,
  upsertPlan,
  upsertFreeAction,
  upsertFormation,
  removeFormation,
  upsertRetention,
  setPendingSuccession,
} from './state';
export type {
  TeamState,
  Team,
  TeamCombatFormation,
  TeamMemberRetentionState,
  WorkSettlementLedger,
  TeamPlan,
  MemberFreeAction,
  RecentAdventurerActivity,
  PendingPlayerTravelInteraction,
  PendingSuccession,
} from './state';

// ── System（Handler + Job + Internal-Command 執行器 + 注入 Port）────────────
export {
  TEAM_MODULE_ID,
  MAX_FORMAL_MEMBERS,
  RETENTION_ACTIVATION_DAYS,
  HOME_YEAR_REST_DAYS,
  // 玩家 Command
  handleStartCityTravel,
  handleEnterAdventureMap,
  handleReturnToCity,
  handleRest,
  handleConfigureCombatFormation,
  handleRecruitTavernAdventurer,
  handleSelectPlayerSuccessor,
  handleBeginCityFreePeriod,
  getPlayerControlledCharacterId,
  openPlayerSuccession,
  validatePlacements,
  // Internal Command
  handleStartReturnFromDungeon,
  handleStartNpcTeamPlan,
  // Job
  handleTeamPlanDueJob,
} from './system';
export type {
  TeamHandlerContext,
  TeamHandlerResult,
  TeamIdAllocator,
  TeamWorldReader,
  TeamResolverPort,
  TeamDomainEventTagged,
  StartNpcDungeonRunCommand,
} from './system';

// ── Query ─────────────────────────────────────────────────────────────────
export { createTeamQuery, createTeamPresenceQuery } from './queries';

// ── Fixtures ────────────────────────────────────────────────────────────––
export {
  fixtureTeamState,
  makeFormation,
  makeContext,
  makeIdAllocator,
  stubDefinitionReader,
  stubWorldReader,
  stubResolverPort,
  PLAYER_TEAM_ID,
  NPC_TEAM_ID,
  PLAYER_LEADER_ID,
  PLAYER_MEMBER_ID,
  NPC_LEADER_ID,
  CITY_A,
  CITY_B,
  ROUTE_AB,
  TRAVEL_MODE_3,
  TRAVEL_MODE_6,
  TRAVEL_MODE_9,
  NPC_TRAVEL_RULE,
} from './fixtures';

// ── Tests ─────────────────────────────────────────────────────────────────
export { runTests, runTestResults } from './team.test';
export type { TeamTestResult } from './team.test';

// ── ModuleContract 宣告（事件綁定與執行順序由 Composition Manifest 唯一擁有）──
export const teamModuleContract: ModuleContract = {
  id: 'team' as ModuleId,
  owns: 'team' as StateSliceName,
  reads: [
    'reader:team-player-travel-mode' as ReaderPortId,
    'reader:team-npc-travel-rule' as ReaderPortId,
    'reader:team-free-action-rule' as ReaderPortId,
    'reader:team-recruitment-rule' as ReaderPortId,
    'reader:team-retention-rule' as ReaderPortId,
    'reader:team-formation-rule' as ReaderPortId,
    'reader:world-city-route' as ReaderPortId,
  ],
  handlesGameCommands: [
    'startCityTravel',
    'enterAdventureMap',
    'returnToCity',
    'chooseCityFreeAction',
    'beginCityFreePeriod',
    'rest',
    'selectPlayerSuccessor',
    'recruitTavernAdventurer',
    'dismissMember',
    'configureCombatFormation',
  ],
  handlesInternalCommands: [
    'StartReturnFromDungeon',
    'StartTimedCityAction',
    'StartChildStudyPlan',
    'CreateNpcTeam',
    'StartNpcTeamPlan',
    'OpenPlayerTravelInteraction',
    'CompletePlayerTravelSegmentWithoutEvent',
    'MarkPlayerTravelInteractionAwaitingCombat',
    'CompletePlayerTravelInteraction',
    'AssignNpcMemberFreeAction',
    'RecordTeamWorkSettlementValue',
    'AttachQuestTemporaryMember',
  ],
  handlesJobs: ['teamPlanDue', 'freeActionDue', 'nonPlayerMemberCityFreeDayTick'],
  subscriptionHandlerIds: [
    'sub:team/CharacterAvailabilityChanged' as EventSubscriptionId,
    'sub:team/CharacterRetired' as EventSubscriptionId,
    'sub:team/QuestSettled' as EventSubscriptionId,
    'sub:team/CombatEncounterResolved' as EventSubscriptionId,
    'sub:team/ItemConsumed' as EventSubscriptionId,
    'sub:team/RouteAccessChanged' as EventSubscriptionId,
  ],
  emits: [
    'TeamPlanChanged',
    'TeamPlanCompleted',
    'TeamLocationChanged',
    'FreeActionCompleted',
    'FreeActionChanged',
    'TravelCompleted',
    'TravelSegmentReached',
    'PlayerTravelEventResolved',
    'PlayerInteractionOpened',
    'HomeYearRestCompleted',
    'PlayerSuccessorSelected',
    'TeamMemberJoined',
    'TeamMemberDeparted',
    'TeamWorkSettlementChanged',
    'TeamCombatFormationChanged',
    'AdventurerActivityRecorded',
    'NonPlayerMemberFreeDaySocialPractice',
  ],
  invariants: [
    'team.formationCoversAllFormalMembers' as InvariantId,
    'team.formalMemberCountBetween1And9' as InvariantId,
    'team.playerTeamIsControlPlayer' as InvariantId,
    'team.leaderIsFormalMember' as InvariantId,
    'team.memberInAtMostOneTeam' as InvariantId,
  ],
};
