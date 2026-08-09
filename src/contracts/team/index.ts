// contracts/team — public contract transcribed from docs/00_core/architecture/02_team_module.md

import type {
  TeamId,
  CharacterId,
  TeamPlanId,
  FreeActionId,
  InteractionId,
  CityId,
  RouteId,
  MapInstanceId,
  HomeId,
  AdventureSiteId,
  TravelModeId,
  NpcTravelRuleId,
  TeamPlanRuleId,
  MemberRetentionRuleId,
  RecruitmentRuleId,
  TeamFormationRuleId,
  NonPlayerMemberDailySocialPracticeRuleId,
  ExperienceAwardRuleId,
  ResolverId,
  NpcMarriageRuleId,
  CraftingRecipeId,
  MasteryId,
  HomeTeachingPostId,
  NpcMarketIntentId,
  NpcDungeonRunId,
  QuestId,
  EncounterId,
  ContentEventOptionId,
  PlayerTravelEventInstanceId,
  ContentEventInstanceId,
  ActivityRecordId,
  EntitySourceRef,
  RngStreamId,
  ModuleId,
  DefinitionId,
  LocalizationKey,
  JsonScalar,
  WorldDay,
  Revision,
} from '../core';
import type { DefinitionHeader, ScheduledJobBase } from '../core';

// 跨模組：GridCell 由 map 擁有（未實作，屬預期 unresolved import）。
import type { GridCell } from '../map';
// 外送 Internal Command 引用接收模組契約的真實型別（見下方 TeamOutboundInternalCommand）。
import type { StartNpcDungeonRun } from '../dungeon';

// ── 本模組專屬／未定案 Definition ID（core 未列出）──────────────────────
export type FreeActionRuleId = DefinitionId<'free-action-rule'>;
export type RecentActivityRuleId = DefinitionId<'recent-activity-rule'>;
export type PlayerTravelEventWeightProfileId = DefinitionId<'player-travel-event-weight-profile'>;

// FacilityKind：城市設施種類（擁有者為 city，值集由內容資料決定；此處佔位）。
export type FacilityKind = string;

// ContentEventInstance：內容事件實例基底（擁有者待定，此處以佔位定義；見交接報告）。
export type ContentEventInstance = Readonly<{
  instanceId: ContentEventInstanceId;
  rngStreamId: RngStreamId;
}>;

// ── Definition Reader ───────────────────────────────────────────────────
export interface TeamDefinitionReader {
  getPlayerTravelMode(id: TravelModeId): PlayerTravelModeDefinition;
  getNpcTravelRule(id: NpcTravelRuleId): NpcTravelRuleDefinition;
  getFreeActionRule(id: FreeActionRuleId): FreeActionRuleDefinition;
  getTeamPlanRule(id: TeamPlanRuleId): TeamPlanRuleDefinition;
  getRecentActivityRule(id: RecentActivityRuleId): RecentActivityRuleDefinition;
  getMemberRetentionRule(id: MemberRetentionRuleId): MemberRetentionRuleDefinition;
  getRecruitmentRule(id: RecruitmentRuleId): RecruitmentRuleDefinition;
  getTeamFormationRule(id: TeamFormationRuleId): TeamFormationRuleDefinition;
  getNonPlayerMemberDailySocialPracticeRule(
    id: NonPlayerMemberDailySocialPracticeRuleId,
  ): NonPlayerMemberDailySocialPracticeRuleDefinition;
}

// TeamPlanRuleDefinition（doc 於 Reader 引用但未定義；此處推導，見交接報告）。
export type TeamPlanRuleDefinition = DefinitionHeader & {
  kind: TeamPlanKind;
};

// ── 玩家／NPC 旅行規則 ──────────────────────────────────────────────────
export type PlayerTravelModeDefinition = DefinitionHeader & {
  durationDays: 3 | 6 | 9;
  segments: [number, number, number]; // 1/1/1、2/2/2、3/3/3
  travelExperienceRuleId: ExperienceAwardRuleId;
  travelExperienceMultiplier: number; // 0.5、1、2
  travelEventWeightProfileId: PlayerTravelEventWeightProfileId;
};

export type NpcTravelRuleDefinition = DefinitionHeader & {
  durationDays: 6;
  travelExperienceRuleId: ExperienceAwardRuleId;
  travelExperienceMultiplier: 1;
  eventPolicy: 'none';
};

// ── FreeActionRuleDefinition ────────────────────────────────────────────
export type FreeActionKind =
  | 'craft'
  | 'train'
  | 'teach'
  | 'trade'
  | 'tavernVisit'
  | 'proposeToTeammate'
  | 'rest';

export type FreeActionRuleDefinition = DefinitionHeader & {
  kind: FreeActionKind;
  requiredFreeDays?: number;
  completionResolverId?: ResolverId;
  requiresCityFacilityKind?: FacilityKind;
  npcMarriageRuleId?: NpcMarriageRuleId;
};

export type RecentActivityRuleDefinition = DefinitionHeader & {
  maxRecordsPerCharacter: number;
};

export type MemberRetentionRuleDefinition = DefinitionHeader & {
  activationDaysAfterJoin: 60;
  expectedNetSettlementResolverId: ResolverId;
  departureChanceResolverId: ResolverId;
  excludedExpenseKinds: ['equipmentPurchase'];
  countedIncomeKinds: ['questReward', 'dungeonReward'];
  countedExpenseKinds: ['travelExpense', 'consumableUse'];
};

export type RecruitmentRuleDefinition = DefinitionHeader & {
  successChanceResolverId: ResolverId;
  retryEligibilityResolverId: ResolverId;
};

export type TeamFormationRuleDefinition = DefinitionHeader & {
  defaultPlacementResolverId: ResolverId;
};

export type NonPlayerMemberDailySocialPracticeRuleDefinition = DefinitionHeader & {
  conversationExperienceRuleId: ExperienceAwardRuleId;
  commerceExperienceRuleId: ExperienceAwardRuleId;
};

// ── Runtime 支援型別（Query 直接回傳 / 事件 payload / View 投影所需）────
export type TeamControl = 'player' | 'npc' | 'child';

export type TeamLocation =
  | { kind: 'city'; cityId: CityId }
  | { kind: 'adventureMap'; mapId: MapInstanceId }
  | {
      kind: 'travelling';
      routeId: RouteId;
      progress:
        | { kind: 'playerSegments'; segmentIndex: 0 | 1 | 2 }
        | { kind: 'npcDirect' };
    }
  | { kind: 'home'; homeId: HomeId };

// 玩家可控制（非 travelling）位置：抵達時觸發強制超載重算。
export type ControllableTeamLocation =
  | { kind: 'city'; cityId: CityId }
  | { kind: 'adventureMap'; mapId: MapInstanceId }
  | { kind: 'home'; homeId: HomeId };

export type TeamPlanKind =
  | 'cityFree'
  | 'cityFacilityAction'
  | 'cityTravel'
  | 'enterAdventureMap'
  | 'returnToCity'
  | 'npcDungeonExploration'
  | 'escortTravel'
  | 'homeRest'
  | 'homeTeachingPost'
  | 'childStudy';

export type TeamPlanStatus = 'active' | 'completed' | 'cancelled';

// 城市旅行 payload：判別聯集（NPC payload 不得出現 modeId/segmentIndex/事件欄位）。
export type CityTravelPlanPayload =
  | {
      kind: 'playerTravel';
      fromCityId: CityId;
      toCityId: CityId;
      routeId: RouteId;
      modeId: TravelModeId;
      segmentIndex: 0 | 1 | 2;
      nextSegmentDay: WorldDay;
    }
  | {
      kind: 'npcTravel';
      fromCityId: CityId;
      toCityId: CityId;
      routeId: RouteId;
      npcTravelRuleId: NpcTravelRuleId;
      arrivalDay: WorldDay;
    };

// TeamPlanPayload：只保存此大動作所需 ID 與資料（各 kind 內容不同；此處以判別聯集推導）。
export type TeamPlanPayload =
  | { kind: 'cityFree' }
  | { kind: 'cityFacilityAction'; facilityKind: FacilityKind }
  | { kind: 'cityTravel'; travel: CityTravelPlanPayload }
  | { kind: 'enterAdventureMap'; adventureSiteId: AdventureSiteId; mapId?: MapInstanceId }
  | { kind: 'returnToCity'; toCityId: CityId }
  | { kind: 'npcDungeonExploration'; mapId: MapInstanceId; runId: NpcDungeonRunId }
  | { kind: 'escortTravel'; questId: QuestId; travel: CityTravelPlanPayload }
  | { kind: 'homeRest'; homeId: HomeId }
  | { kind: 'homeTeachingPost'; postId: HomeTeachingPostId }
  | { kind: 'childStudy' };

export type MemberFreeActionStatus = 'active' | 'resting' | 'completed' | 'cancelled';

export type FreeActionPayload =
  | { kind: 'craft'; recipeId: CraftingRecipeId }
  | { kind: 'train'; masteryId: MasteryId }
  | { kind: 'teach'; postId: HomeTeachingPostId }
  | { kind: 'trade'; marketIntentId: NpcMarketIntentId }
  | {
      kind: 'proposeToTeammate';
      targetCharacterId: CharacterId;
      marriageRuleId: NpcMarriageRuleId;
    }
  | { kind: 'tavernVisit' }
  | { kind: 'rest' };

export type PlayerTravelEventInstance = ContentEventInstance & {
  instanceId: PlayerTravelEventInstanceId;
  context: 'playerTravel';
  actorCharacterId: CharacterId; // 固定為目前玩家主角
  routeId: RouteId;
  segmentIndex: 0 | 1 | 2;
  selectedEscortQuestId?: QuestId;
};

export type PendingTravelInteractionState = 'awaitingChoice' | 'awaitingCombatResult';

export type RecentAdventurerActivityKind =
  | 'craft'
  | 'train'
  | 'teach'
  | 'social'
  | 'tavernVisit'
  | 'rest'
  | 'travel'
  | 'quest'
  | 'dungeon'
  | 'combat';

// ── 公開 Query 回傳 View（doc 具名但未定義；以唯讀投影推導）─────────────
export type TeamView = Readonly<{
  teamId: TeamId;
  control: TeamControl;
  memberIds: readonly CharacterId[];
  temporaryMemberIds: readonly CharacterId[];
  leaderId: CharacterId;
  location: TeamLocation;
  activePlanId?: TeamPlanId;
  revision: Revision;
}>;

export type TeamPlanView = Readonly<{
  planId: TeamPlanId;
  teamId: TeamId;
  kind: TeamPlanKind;
  startedOnDay: WorldDay;
  dueOnDay?: WorldDay;
  status: TeamPlanStatus;
  payload: TeamPlanPayload;
  revision: Revision;
}>;

export type MemberFreeActionView = Readonly<{
  freeActionId: FreeActionId;
  teamId: TeamId;
  memberId: CharacterId;
  ruleId: FreeActionRuleId;
  status: MemberFreeActionStatus;
  requiredFreeDays?: number;
  accumulatedFreeDays: number;
  activeSinceDay?: WorldDay;
  nextDueDay?: WorldDay;
  payload: FreeActionPayload;
  revision: Revision;
}>;

export type TeamCombatFormationView = Readonly<{
  teamId: TeamId;
  placements: Readonly<Record<CharacterId, GridCell>>;
  revision: Revision;
}>;

export type RecentAdventurerActivityView = Readonly<{
  activityId: ActivityRecordId;
  characterId: CharacterId;
  kind: RecentAdventurerActivityKind;
  startedOnDay?: WorldDay;
  completedOnDay: WorldDay;
  sourceId?: EntitySourceRef;
  summaryKey: LocalizationKey;
  summaryParams: Readonly<Record<string, JsonScalar>>;
}>;

export type PendingPlayerTravelInteractionView = Readonly<{
  interactionId: InteractionId;
  teamId: TeamId;
  planId: TeamPlanId;
  segmentIndex: 0 | 1 | 2;
  eventInstance: PlayerTravelEventInstance;
  state: PendingTravelInteractionState;
  selectedOptionId?: ContentEventOptionId;
  encounterId?: EncounterId;
  openedOnDay: WorldDay;
  revision: Revision;
}>;

export type PendingSuccessionView = Readonly<{
  interactionId: InteractionId;
  formerLeaderId: CharacterId;
  eligibleSuccessorIds: readonly CharacterId[];
  openedOnDay: WorldDay;
  reason: 'death' | 'retirement';
  revision: Revision;
}>;

// ── 公開 Query ──────────────────────────────────────────────────────────
export interface TeamQuery {
  getTeam(teamId: TeamId): TeamView;
  getPlayerTeamId(): TeamId;
  getPlayerControlledCharacterId(): CharacterId;
  getLocation(teamId: TeamId): TeamLocation;
  listTeamsAtCity(cityId: CityId): TeamId[];
  countTeamsInside(mapId: MapInstanceId): number;
  isTeamInside(mapId: MapInstanceId, teamId: TeamId): boolean;
  getActivePlan(teamId: TeamId): TeamPlanView | undefined;
  listFreeActions(teamId: TeamId): MemberFreeActionView[];
  listFormalMembers(teamId: TeamId): CharacterId[];
  getFormalMemberJoinedOnDay(teamId: TeamId, characterId: CharacterId): WorldDay | undefined;
  getCombatFormation(teamId: TeamId): TeamCombatFormationView;
  listTavernVisitorIds(cityId: CityId): CharacterId[];
  getRecentAdventurerActivity(characterId: CharacterId): RecentAdventurerActivityView[];
  getPendingPlayerTravelInteraction(
    teamId: TeamId,
  ): PendingPlayerTravelInteractionView | undefined;
  getPendingSuccession(): PendingSuccessionView | undefined;
}

// ── 玩家 Command payload（doc 只列前置條件；欄位依 prose 推導）──────────
export type StartCityTravelCommand = Readonly<{
  type: 'startCityTravel';
  toCityId: CityId;
  routeId: RouteId;
  modeId: TravelModeId;
}>;

export type EnterAdventureMapCommand = Readonly<{
  type: 'enterAdventureMap';
  adventureSiteId: AdventureSiteId;
}>;

export type ReturnToCityCommand = Readonly<{
  type: 'returnToCity';
  teamId: TeamId;
}>;

export type ChooseCityFreeActionCommand = Readonly<{
  type: 'chooseCityFreeAction';
  memberId: CharacterId;
  ruleId: FreeActionRuleId;
  payload: FreeActionPayload;
}>;

export type BeginCityFreePeriodCommand = Readonly<Record<string, never>>;

export type RestCommand = Readonly<{
  type: 'rest';
  planKind: Extract<TeamPlanKind, 'homeRest'> | 'cityFacilityAction';
}>;

export type SelectPlayerSuccessorCommand = Readonly<{
  type: 'selectPlayerSuccessor';
  interactionId: InteractionId;
  successorId: CharacterId;
}>;

export type RecruitTavernAdventurerCommand = Readonly<{
  type: 'recruitTavernAdventurer';
  targetCharacterId: CharacterId;
}>;

export type DismissMemberCommand = Readonly<{
  type: 'dismissMember';
  memberId: CharacterId;
}>;

export type ConfigureCombatFormationCommand = Readonly<{
  type: 'configureCombatFormation';
  teamId: TeamId;
  placements: Readonly<Record<CharacterId, GridCell>>;
}>;

export type TeamGameCommand =
  | StartCityTravelCommand
  | EnterAdventureMapCommand
  | ReturnToCityCommand
  | ChooseCityFreeActionCommand
  | BeginCityFreePeriodCommand
  | RestCommand
  | SelectPlayerSuccessorCommand
  | RecruitTavernAdventurerCommand
  | DismissMemberCommand
  | ConfigureCombatFormationCommand;

// ── ScheduledJob ────────────────────────────────────────────────────────
export type TeamModuleId = ModuleId<'team'>;

export type TeamPlanDueJobPayload = Readonly<{
  planId: TeamPlanId;
}>;
export type TeamPlanDueJob = ScheduledJobBase<'teamPlanDue', TeamModuleId, TeamId, TeamPlanDueJobPayload>;

export type FreeActionDueJobPayload = Readonly<{
  freeActionId: FreeActionId;
  memberId: CharacterId;
}>;
export type FreeActionDueJob = ScheduledJobBase<
  'freeActionDue',
  TeamModuleId,
  TeamId,
  FreeActionDueJobPayload
>;

export type NonPlayerMemberCityFreeDayTickJobPayload = Readonly<{
  teamId: TeamId;
}>;
export type NonPlayerMemberCityFreeDayTickJob = ScheduledJobBase<
  'nonPlayerMemberCityFreeDayTick',
  TeamModuleId,
  TeamId,
  NonPlayerMemberCityFreeDayTickJobPayload
>;

export type TeamScheduledJob =
  | TeamPlanDueJob
  | FreeActionDueJob
  | NonPlayerMemberCityFreeDayTickJob;

// ── Internal Command payload（inbound；欄位依 prose 推導）─────────────────
export type StartReturnFromDungeonPayload = Readonly<{
  type: 'StartReturnFromDungeon';
  teamId: TeamId;
  mapId: MapInstanceId;
}>;

export type StartTimedCityActionPayload = Readonly<{
  type: 'StartTimedCityAction';
  teamId: TeamId;
  scope: 'team' | 'member';
  facilityId?: DefinitionId;
  ruleId?: FreeActionRuleId;
  memberId?: CharacterId;
  payload?: FreeActionPayload;
}>;

export type StartChildStudyPlanPayload = Readonly<{
  type: 'StartChildStudyPlan';
  teamId: TeamId;
}>;

export type CreateNpcTeamPayload = Readonly<{
  type: 'CreateNpcTeam';
  memberIds: readonly CharacterId[];
  leaderId: CharacterId;
  cityId: CityId;
}>;

export type StartNpcTeamPlanPayload = Readonly<{
  type: 'StartNpcTeamPlan';
  teamId: TeamId;
  kind: TeamPlanKind;
  payload: TeamPlanPayload;
}>;

export type OpenPlayerTravelInteractionPayload = Readonly<{
  type: 'OpenPlayerTravelInteraction';
  teamId: TeamId;
  planId: TeamPlanId;
  segmentIndex: 0 | 1 | 2;
  eventInstance: PlayerTravelEventInstance;
}>;

export type CompletePlayerTravelSegmentWithoutEventPayload = Readonly<{
  type: 'CompletePlayerTravelSegmentWithout';
  teamId: TeamId;
  planId: TeamPlanId;
  segmentIndex: 0 | 1 | 2;
}>;

export type MarkPlayerTravelInteractionAwaitingCombatPayload = Readonly<{
  type: 'MarkPlayerTravelInteractionAwaitingCombat';
  interactionId: InteractionId;
  selectedOptionId: ContentEventOptionId;
  encounterId: EncounterId;
}>;

export type CompletePlayerTravelInteractionPayload = Readonly<{
  type: 'CompletePlayerTravelInteraction';
  interactionId: InteractionId;
}>;

export type AssignNpcMemberFreeActionPayload = Readonly<{
  type: 'AssignNpcMemberFreeAction';
  teamId: TeamId;
  memberId: CharacterId;
  ruleId: FreeActionRuleId;
  payload: FreeActionPayload;
}>;

export type TeamWorkSettlementEntryKind =
  | 'questReward'
  | 'dungeonReward'
  | 'travelExpense'
  | 'consumableUse';

export type RecordTeamWorkSettlementValuePayload = Readonly<{
  type: 'RecordTeamWorkSettlementValue';
  teamId: TeamId;
  entryId: string; // 冪等鍵
  kind: TeamWorkSettlementEntryKind;
  amount: number;
}>;

export type AttachQuestTemporaryMemberPayload = Readonly<{
  type: 'AttachQuestTemporaryMember';
  teamId: TeamId;
  characterId: CharacterId;
  questId: QuestId;
}>;

export type TeamInboundInternalCommand =
  | StartReturnFromDungeonPayload
  | StartTimedCityActionPayload
  | StartChildStudyPlanPayload
  | CreateNpcTeamPayload
  | StartNpcTeamPlanPayload
  | OpenPlayerTravelInteractionPayload
  | CompletePlayerTravelSegmentWithoutEventPayload
  | MarkPlayerTravelInteractionAwaitingCombatPayload
  | CompletePlayerTravelInteractionPayload
  | AssignNpcMemberFreeActionPayload
  | RecordTeamWorkSettlementValuePayload
  | AttachQuestTemporaryMemberPayload;

// 輸出 Internal Command（唯一處理者：dungeon）。
// B.5：不再自行複寫欄位，直接引用 dungeon 契約的真實型別——兩份宣告一旦漂移，
// 送出的命令就會被接收端拒絕，而訊息以 unknown 傳遞時編譯器看不到。
export type StartNpcDungeonRunPayload = StartNpcDungeonRun;

export type TeamOutboundInternalCommand = StartNpcDungeonRunPayload;

// ── 輸出 DomainEvent payload ────────────────────────────────────────────
export type TeamPlanChangedEvent = Readonly<{
  type: 'TeamPlanChanged';
  teamId: TeamId;
  planId: TeamPlanId;
  oldKind?: TeamPlanKind;
  newKind: TeamPlanKind;
}>;

export type TeamPlanCompletedEvent = Readonly<{
  type: 'TeamPlanCompleted';
  teamId: TeamId;
  planId: TeamPlanId;
  kind: TeamPlanKind;
  payload: TeamPlanPayload;
}>;

export type TeamLocationChangedEvent = Readonly<{
  type: 'TeamLocationChanged';
  teamId: TeamId;
  from: TeamLocation;
  to: TeamLocation;
}>;

export type FreeActionCompletedEvent = Readonly<{
  type: 'FreeActionCompleted';
  teamId: TeamId;
  memberId: CharacterId;
  ruleId: FreeActionRuleId;
  payload: FreeActionPayload;
}>;

export type FreeActionChangedEvent = Readonly<{
  type: 'FreeActionChanged';
  freeActionId: FreeActionId;
  status: MemberFreeActionStatus;
  progress: number;
}>;

export type TravelCompletedEvent = Readonly<{
  type: 'TravelCompleted';
  teamId: TeamId;
  fromCityId: CityId;
  toCityId: CityId;
  travelKind: 'player' | 'npc';
  modeId?: TravelModeId;
  experienceRuleId: ExperienceAwardRuleId;
  experienceMultiplier: number;
}>;

export type TravelSegmentReachedEvent = Readonly<{
  type: 'TravelSegmentReached';
  teamId: TeamId;
  routeId: RouteId;
  segmentIndex: 0 | 1 | 2;
  eventProfileId: PlayerTravelEventWeightProfileId;
}>;

export type PlayerTravelEventResolvedEvent = Readonly<{
  type: 'PlayerTravelEventResolved';
  interactionId?: InteractionId;
  eventInstanceId?: PlayerTravelEventInstanceId;
  optionId?: ContentEventOptionId;
  outcome: 'noEvent' | 'immediate' | 'combatVictory' | 'combatDefeat';
}>;

export type PlayerInteractionOpenedEvent = Readonly<{
  type: 'PlayerInteractionOpened';
  interactionId: InteractionId;
  teamId: TeamId;
  kind: 'travelEvent' | 'succession';
}>;

export type HomeYearRestCompletedEvent = Readonly<{
  type: 'HomeYearRestCompleted';
  teamId: TeamId;
  memberIds: readonly CharacterId[];
  elapsedDays: 365;
}>;

export type PlayerSuccessorSelectedEvent = Readonly<{
  type: 'PlayerSuccessorSelected';
  teamId: TeamId;
  formerLeaderId: CharacterId;
  successorId: CharacterId;
  reason: 'death' | 'retirement';
}>;

export type TeamMemberJoinedEvent = Readonly<{
  type: 'TeamMemberJoined';
  teamId: TeamId;
  characterId: CharacterId;
  reason: 'recruited' | 'succession';
}>;

export type TeamMemberDepartedEvent = Readonly<{
  type: 'TeamMemberDeparted';
  teamId: TeamId;
  characterId: CharacterId;
  reason: 'recruitedAway' | 'dismissed' | 'unavailable' | 'economicDeparture';
  spawnedTeamId?: TeamId;
}>;

export type TeamWorkSettlementChangedEvent = Readonly<{
  type: 'TeamWorkSettlementChanged';
  teamId: TeamId;
  entryId: string;
  kind: TeamWorkSettlementEntryKind;
  amount: number;
}>;

export type TeamCombatFormationChangedEvent = Readonly<{
  type: 'TeamCombatFormationChanged';
  teamId: TeamId;
  placements: Readonly<Record<CharacterId, GridCell>>;
  revision: Revision;
}>;

export type AdventurerActivityRecordedEvent = Readonly<{
  type: 'AdventurerActivityRecorded';
  characterId: CharacterId;
  kind: RecentAdventurerActivityKind;
  completedOnDay: WorldDay;
  summaryKey: LocalizationKey;
}>;

export type NonPlayerMemberFreeDaySocialPracticeEvent = Readonly<{
  type: 'NonPlayerMemberFreeDaySocialPractice';
  teamId: TeamId;
  characterId: CharacterId;
  worldDay: WorldDay;
  conversationExperienceRuleId: ExperienceAwardRuleId;
  commerceExperienceRuleId: ExperienceAwardRuleId;
}>;

export type TeamDomainEvent =
  | TeamPlanChangedEvent
  | TeamPlanCompletedEvent
  | TeamLocationChangedEvent
  | FreeActionCompletedEvent
  | FreeActionChangedEvent
  | TravelCompletedEvent
  | TravelSegmentReachedEvent
  | PlayerTravelEventResolvedEvent
  | PlayerInteractionOpenedEvent
  | HomeYearRestCompletedEvent
  | PlayerSuccessorSelectedEvent
  | TeamMemberJoinedEvent
  | TeamMemberDepartedEvent
  | TeamWorkSettlementChangedEvent
  | TeamCombatFormationChangedEvent
  | AdventurerActivityRecordedEvent
  | NonPlayerMemberFreeDaySocialPracticeEvent;
