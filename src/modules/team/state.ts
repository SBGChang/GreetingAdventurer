// modules/team/state.ts
// Team 唯一可寫 Slice 的執行期型別、初始工廠與純函式讀寫小工具。
//
// 契約 contracts/team/index.ts 只定義「對外可見」的 View 投影與訊息 payload；
// 執行期 State 結構（Team / TeamPlan / MemberFreeAction / …）由 doc §3 描述，於此具體化。
// 各 Runtime 型別在結構上都是對應 View 的超集合，因此 queries.ts 可直接投影回傳。
//
// 全部 helper 皆回傳新物件，不 mutate 傳入 Slice（對齊 character/inventory/progression 慣例）。

import type {
  TeamId,
  CharacterId,
  TeamPlanId,
  FreeActionId,
  InteractionId,
  ActivityRecordId,
  ContentEventOptionId,
  EncounterId,
  EntitySourceRef,
  LocalizationKey,
  JsonScalar,
  WorldDay,
  Revision,
} from '../../contracts/core';
import type {
  TeamControl,
  TeamLocation,
  TeamPlanKind,
  TeamPlanStatus,
  TeamPlanPayload,
  MemberFreeActionStatus,
  FreeActionPayload,
  FreeActionRuleId,
  PlayerTravelEventInstance,
  PendingTravelInteractionState,
  RecentAdventurerActivityKind,
} from '../../contracts/team';
import type { GridCell } from '../../contracts/map';

// ── Runtime 實體（doc §3）─────────────────────────────────────────────────

export type Team = Readonly<{
  teamId: TeamId;
  control: TeamControl;
  memberIds: readonly CharacterId[]; // 正式成員（1..9，control=child 恰 1）
  temporaryMemberIds: readonly CharacterId[]; // 救援後隨隊角色；護衛不入列
  leaderId: CharacterId;
  location: TeamLocation;
  activePlanId?: TeamPlanId;
  revision: Revision;
}>;

export type TeamCombatFormation = Readonly<{
  teamId: TeamId;
  placements: Readonly<Record<CharacterId, GridCell>>;
  revision: Revision;
}>;

export type WorkSettlementLedger = Readonly<{
  cycleStartedOnDay: WorldDay;
  questRewardValue: number;
  dungeonRewardValue: number;
  travelExpenseValue: number;
  consumedItemExpenseValue: number;
}>;

export type TeamMemberRetentionState = Readonly<{
  teamId: TeamId;
  memberJoinedOnDay: Readonly<Record<CharacterId, WorldDay>>;
  currentWorkSettlement: WorkSettlementLedger;
  revision: Revision;
}>;

export type TeamPlan = Readonly<{
  planId: TeamPlanId;
  teamId: TeamId;
  kind: TeamPlanKind;
  startedOnDay: WorldDay;
  dueOnDay?: WorldDay;
  status: TeamPlanStatus;
  payload: TeamPlanPayload;
  revision: Revision;
}>;

export type MemberFreeAction = Readonly<{
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

export type RecentAdventurerActivity = Readonly<{
  activityId: ActivityRecordId;
  characterId: CharacterId;
  kind: RecentAdventurerActivityKind;
  startedOnDay?: WorldDay;
  completedOnDay: WorldDay;
  sourceId?: EntitySourceRef;
  summaryKey: LocalizationKey;
  summaryParams: Readonly<Record<string, JsonScalar>>;
}>;

export type PendingPlayerTravelInteraction = Readonly<{
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

export type PendingSuccession = Readonly<{
  interactionId: InteractionId;
  formerLeaderId: CharacterId;
  eligibleSuccessorIds: readonly CharacterId[];
  openedOnDay: WorldDay;
  reason: 'death' | 'retirement';
  revision: Revision;
}>;

// Team 唯一可寫 Slice（doc §1.1）。
export type TeamState = Readonly<{
  playerTeamId: TeamId;
  teams: Readonly<Record<TeamId, Team>>;
  plans: Readonly<Record<TeamPlanId, TeamPlan>>;
  freeActions: Readonly<Record<FreeActionId, MemberFreeAction>>;
  recentActivities: Readonly<Record<CharacterId, readonly RecentAdventurerActivity[]>>;
  pendingTravelInteractions: Readonly<Record<InteractionId, PendingPlayerTravelInteraction>>;
  pendingSuccession?: PendingSuccession;
  memberRetention: Readonly<Record<TeamId, TeamMemberRetentionState>>;
  combatFormations: Readonly<Record<TeamId, TeamCombatFormation>>;
}>;

// ── 工廠 ─────────────────────────────────────────────────────────────────

export function emptyWorkSettlement(onDay: WorldDay): WorkSettlementLedger {
  return {
    cycleStartedOnDay: onDay,
    questRewardValue: 0,
    dungeonRewardValue: 0,
    travelExpenseValue: 0,
    consumedItemExpenseValue: 0,
  };
}

export function createTeamState(
  input: Readonly<{
    playerTeamId: TeamId;
    teams?: readonly Team[];
    plans?: readonly TeamPlan[];
    freeActions?: readonly MemberFreeAction[];
    combatFormations?: readonly TeamCombatFormation[];
    memberRetention?: readonly TeamMemberRetentionState[];
    recentActivities?: Readonly<Record<CharacterId, readonly RecentAdventurerActivity[]>>;
    pendingSuccession?: PendingSuccession;
  }>,
): TeamState {
  const teams: Record<TeamId, Team> = {};
  for (const t of input.teams ?? []) teams[t.teamId] = t;

  const plans: Record<TeamPlanId, TeamPlan> = {};
  for (const p of input.plans ?? []) plans[p.planId] = p;

  const freeActions: Record<FreeActionId, MemberFreeAction> = {};
  for (const f of input.freeActions ?? []) freeActions[f.freeActionId] = f;

  const combatFormations: Record<TeamId, TeamCombatFormation> = {};
  for (const c of input.combatFormations ?? []) combatFormations[c.teamId] = c;

  const memberRetention: Record<TeamId, TeamMemberRetentionState> = {};
  for (const r of input.memberRetention ?? []) memberRetention[r.teamId] = r;

  return {
    playerTeamId: input.playerTeamId,
    teams,
    plans,
    freeActions,
    recentActivities: input.recentActivities ?? {},
    pendingTravelInteractions: {},
    ...(input.pendingSuccession ? { pendingSuccession: input.pendingSuccession } : {}),
    memberRetention,
    combatFormations,
  };
}

// ── 純函式讀寫 ──────────────────────────────────────────────────────────

export function tryGetTeam(state: TeamState, id: TeamId): Team | undefined {
  return state.teams[id];
}

export function requireTeam(state: TeamState, id: TeamId): Team {
  const found = state.teams[id];
  if (found === undefined) throw new Error(`TeamState: unknown teamId "${String(id)}"`);
  return found;
}

export function tryGetPlan(state: TeamState, id: TeamPlanId): TeamPlan | undefined {
  return state.plans[id];
}

export function upsertTeam(state: TeamState, next: Team): TeamState {
  return { ...state, teams: { ...state.teams, [next.teamId]: next } };
}

export function removeTeam(state: TeamState, id: TeamId): TeamState {
  const teams = { ...state.teams };
  delete teams[id];
  return { ...state, teams };
}

export function upsertPlan(state: TeamState, next: TeamPlan): TeamState {
  return { ...state, plans: { ...state.plans, [next.planId]: next } };
}

export function upsertFreeAction(state: TeamState, next: MemberFreeAction): TeamState {
  return { ...state, freeActions: { ...state.freeActions, [next.freeActionId]: next } };
}

export function upsertFormation(state: TeamState, next: TeamCombatFormation): TeamState {
  return {
    ...state,
    combatFormations: { ...state.combatFormations, [next.teamId]: next },
  };
}

export function removeFormation(state: TeamState, id: TeamId): TeamState {
  const combatFormations = { ...state.combatFormations };
  delete combatFormations[id];
  return { ...state, combatFormations };
}

export function upsertRetention(state: TeamState, next: TeamMemberRetentionState): TeamState {
  return {
    ...state,
    memberRetention: { ...state.memberRetention, [next.teamId]: next },
  };
}

export function setPendingSuccession(
  state: TeamState,
  pending: PendingSuccession | undefined,
): TeamState {
  const next = { ...state };
  if (pending === undefined) {
    delete next.pendingSuccession;
  } else {
    next.pendingSuccession = pending;
  }
  return next;
}

export function bump(r: Revision): Revision {
  return (r + 1) as Revision;
}

// 工作淨收益（doc §6.1）：任務 + 地牢 − 旅費 − 已消耗道具。
export function workNetOf(ledger: WorkSettlementLedger): number {
  return (
    ledger.questRewardValue +
    ledger.dungeonRewardValue -
    ledger.travelExpenseValue -
    ledger.consumedItemExpenseValue
  );
}
