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
// MAX_FORMAL_MEMBERS 改由 contracts/core/invariants.ts 提供（結構不變量集中處）；
// RETENTION_ACTIVATION_DAYS / HOME_YEAR_REST_DAYS 已改為 Rule Definition 的資料，不再是常數。
export {
  TEAM_MODULE_ID,
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
  handleCompletePlayerTravelSegmentWithoutEvent,
  // Job
  handleTeamPlanDueJob,
} from './system';
export type {
  TeamHandlerContext,
  TeamHandlerResult,
  TeamIdAllocator,
  TeamWorldReader,
  TeamResolverPort,
  TeamDomainEvent,
  StartNpcDungeonRunCommand,
} from './system';

// ── Query ─────────────────────────────────────────────────────────────────
export { createTeamQuery, createTeamPresenceQuery } from './queries';



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
    'beginCityFreePeriod',
    'rest',
    'selectPlayerSuccessor',
    'recruitTavernAdventurer',
    'configureCombatFormation',
  ],
  handlesInternalCommands: [
    'StartReturnFromDungeon',
    'StartNpcTeamPlan',
    'CompletePlayerTravelSegmentWithoutEvent',
  ],
  // 只宣告**已實作**的 Job。freeActionDue / nonPlayerMemberCityFreeDayTick 的 Handler 未撰寫，
  // 宣告它們會讓 Manifest 排入相位順序、Registry 也認為可用。
  handlesJobs: ['teamPlanDue'],
  // StartNpcDungeonRun 的接收端（dungeon）目前不註冊任何能力，故此處也不宣告送出。
  sendsInternalCommands: [],
  // Wave B 未實作任何 subscriber 函式（CharacterAvailabilityChanged / CharacterRetired /
  // QuestSettled / CombatEncounterResolved / ItemConsumed / RouteAccessChanged 皆待補）。
  subscriptionHandlerIds: [] as readonly EventSubscriptionId[],
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

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是模組的**正式對外面**。從這裡再匯出 fixtures 或 test runner，等於讓正式依賴圖
// 可以走到測試資料——規範 §13 的判準是「只要正式程式**可以**引用就算違反」，不需要真的用到。
// 測試請直接 import './fixtures' 與 './<module>.test'。門禁：scripts/verify-runtime-discipline.ts
