// modules/team/system.ts
// Team 模組的純函式 Handler / Job / Internal-Command 執行器。
//
// 設計原則（對應 docs/00_core/architecture/02_team_module.md，並對齊 character/inventory 慣例）：
//   * 全部為決定性純函式：不做 I/O、不呼叫 Math.random / Date.now。
//   * 需要「當前世界日」「靜態資料」「窄化跨模組 Reader」「新 ID」「RNG 結果」時，
//     一律經由注入的 TeamHandlerContext 取得；RNG 只藏在 Resolver Port 內（以 rngContext 顯式串接）。
//   * 可拒絕的 Command handler 回傳判別式 TeamHandlerResult（ok:true → ModuleResult；ok:false → CommandRejection）。
//   * Job handler 直接回傳 ModuleResult<TeamState>（Job 失配 revision 時安全跳過、回傳未變 Slice）。
//   * Handler 不 mutate 傳入 state；一律回傳新物件。

import type {
  TeamId,
  CharacterId,
  TeamPlanId,
  FreeActionId,
  InteractionId,
  ActivityRecordId,
  MapInstanceId,
  CityId,
  ModuleId,
  WorldDay,
  Revision,
  RngContext,
  RngCursor,
  RngStep,
  ModuleResult,
  ModuleOutcome,
  CommandRejection,
  TransactionMessageDraft,
  DomainEventDraft,
  InternalCommandDraft,
  ScheduledJobDraft,
  AnyScheduledJob,
  MemberRetentionRuleId,
  TeamPlanRuleId,
} from '../../contracts/core';
import { MAX_FORMAL_MEMBERS, GRID_MIN, GRID_MAX } from '../../contracts/core';
import type {
  TeamDefinitionReader,
  // Player Command payloads
  StartCityTravelCommand,
  EnterAdventureMapCommand,
  ReturnToCityCommand,
  RestCommand,
  SelectPlayerSuccessorCommand,
  RecruitTavernAdventurerCommand,
  ConfigureCombatFormationCommand,
  // Job / internal payloads
  TeamPlanDueJob,
  TeamModuleId,
  StartReturnFromDungeonPayload,
  StartNpcTeamPlanPayload,
  CompletePlayerTravelSegmentWithoutEventPayload,
  // Event payloads
  TeamPlanCompletedEvent,
  TeamLocationChangedEvent,
  TravelCompletedEvent,
  TravelSegmentReachedEvent,
  PlayerSuccessorSelectedEvent,
  TeamMemberJoinedEvent,
  TeamMemberDepartedEvent,
  TeamCombatFormationChangedEvent,
  HomeYearRestCompletedEvent,
  // Support types
  TeamLocation,
  TeamPlanPayload,
  TeamPlanKind,
  StartNpcDungeonRunPayload,
} from '../../contracts/team';
import type { GridCell } from '../../contracts/map';

import type {
  Team,
  TeamState,
  TeamPlan,
  TeamCombatFormation,
  PendingSuccession,
} from './state';
import {
  requireTeam,
  tryGetTeam,
  tryGetPlan,
  upsertTeam,
  removeTeam,
  upsertPlan,
  upsertFormation,
  upsertRetention,
  setPendingSuccession,
  emptyWorkSettlement,
  workNetOf,
  bump,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組常數
// ──────────────────────────────────────────────────────────────────────────

export const TEAM_MODULE_ID = 'team' as ModuleId;
const TEAM_OWNER_MODULE = 'team' as TeamModuleId;
const DUNGEON_MODULE_ID = 'dungeon' as ModuleId;

// MAX_FORMAL_MEMBERS / GRID_MIN / GRID_MAX 已移入 contracts/core/invariants.ts（結構不變量集中處）。
// RETENTION_ACTIVATION_DAYS 與 HOME_YEAR_REST_DAYS 是**可調內容**，改由 Rule Definition 提供——見下方 TeamRuleReader。

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port（讓 Handler 保持純函式；真實組合由 Composition 注入，測試注入決定性 stub）
// ──────────────────────────────────────────────────────────────────────────

// 交易私有 ID 配發器（背後由 Kernel RuntimeIdGenerator + cursor 提供）。
export interface TeamIdAllocator {
  nextTeamId(): TeamId;
  nextTeamPlanId(): TeamPlanId;
  nextFreeActionId(): FreeActionId;
  nextInteractionId(): InteractionId;
  nextActivityRecordId(): ActivityRecordId;
  // [MISMATCH] 冒險地 Map 實例 ID 的真正擁有者是 map 模組；此處為 foundation 自足所需。
  nextMapInstanceId(): MapInstanceId;
}

// 窄化跨模組 Reader（doc §9：Map／World／City 的窄化 Reader）。
export interface TeamWorldReader {
  // 由冒險據點解析所屬城市（進入地圖前隊伍所在城）。
  getAdventureSiteCity(siteId: string): CityId;
  // 由地圖實例解析離場後抵達的城市。
  getMapExitCity(mapId: MapInstanceId): CityId;
}

// 資料調諧 Resolver（RNG 藏於其內；Handler 不含機率/公式，只消費結果）。
// 擲骰型方法回傳 RngStep<boolean>（value=判定、nextCursor=續接游標），呼叫端須把 nextCursor 顯式串接到
// 下一次抽取（見 12_engine_runtime.md §7.1、settleRetentionAndDepartures 的離隊迴圈）。只回 boolean 會丟失
// 游標，使同一調用內的連續抽取全部落在同一 cursor → 相同結果。
export interface TeamResolverPort {
  // 招募擲骰：至少接收招募者、目標、玩家隊目前正式人數（doc §2.3）。
  resolveRecruitmentSuccess(
    input: Readonly<{
      recruiterLeaderId: CharacterId;
      targetCharacterId: CharacterId;
      currentFormalCount: number;
      rngContext?: RngContext;
    }>,
  ): RngStep<boolean>;
  // 留隊擲骰：接收工作淨收益缺口與隊長抵抗；缺口↑機率↑、抵抗↑機率↓（doc §2.3/§6.1）。
  resolveMemberDeparture(
    input: Readonly<{
      teamId: TeamId;
      memberId: CharacterId;
      leaderId: CharacterId;
      workNet: number;
      rngContext?: RngContext;
    }>,
  ): RngStep<boolean>;
  // 預設戰鬥配置：以目前配置 + 全體正式成員產生合法且不重疊的九宮格站位（doc §3.1）。
  resolveDefaultPlacement(
    input: Readonly<{
      teamId: TeamId;
      memberIds: readonly CharacterId[];
      current: Readonly<Record<CharacterId, GridCell>>;
    }>,
  ): Readonly<Record<CharacterId, GridCell>>;
}

export type TeamHandlerContext = Readonly<{
  worldDay: WorldDay;
  definitions: TeamDefinitionReader;
  // 目前生效的規則 ID（與 DungeonContext.interactionRuleId 同一慣例：Composition 由內容供給，
  // Handler 只負責帶入並讀取）。缺對應規則時一律 typed rejection，不得回退成寫死的天數。
  memberRetentionRuleId: MemberRetentionRuleId;
  teamPlanRuleIdByKind: Readonly<Partial<Record<TeamPlanKind, TeamPlanRuleId>>>;
  world: TeamWorldReader;
  ids: TeamIdAllocator;
  resolvers: TeamResolverPort;
  rngContext?: RngContext;
}>;

// ──────────────────────────────────────────────────────────────────────────
// 輸出 DomainEvent
// B.5 起判別欄由 contracts/team 的 payload 自身攜帶（core messages.ts 的訊息判別欄約定），
// 本地不再包一層 tagged wrapper。
// ──────────────────────────────────────────────────────────────────────────

export type TeamDomainEvent =
  | TeamPlanCompletedEvent
  | TeamLocationChangedEvent
  | TravelCompletedEvent
  | TravelSegmentReachedEvent
  | PlayerSuccessorSelectedEvent
  | TeamMemberJoinedEvent
  | TeamMemberDepartedEvent
  | TeamCombatFormationChangedEvent
  | HomeYearRestCompletedEvent;

// 輸出 Internal Command（唯一處理者：dungeon）。
export type StartNpcDungeonRunCommand = StartNpcDungeonRunPayload;

// ──────────────────────────────────────────────────────────────────────────
// Handler 回傳型別（對齊 inventory 慣例）
// ──────────────────────────────────────────────────────────────────────────

// B.5：形狀改由 contracts/core 的 ModuleOutcome 單一定義。
export type TeamHandlerResult = ModuleOutcome<TeamState>;

function reject(
  code: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): TeamHandlerResult {
  return { ok: false, rejection: { code, source: TEAM_MODULE_ID, ...(details ? { details } : {}) } };
}

function accept(
  nextSlice: TeamState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[] = [],
): TeamHandlerResult {
  return { ok: true, result: { nextSlice, outgoingMessages, scheduledJobs } };
}

function emit(event: TeamDomainEvent): DomainEventDraft<unknown> {
  return { event };
}

function emitStartNpcDungeonRun(payload: StartNpcDungeonRunPayload): InternalCommandDraft<unknown> {
  return { targetModule: DUNGEON_MODULE_ID, command: payload };
}

function planDueJob(
  teamId: TeamId,
  planId: TeamPlanId,
  dueDay: WorldDay,
  expectedRevision: Revision,
): ScheduledJobDraft<AnyScheduledJob> {
  const draft: ScheduledJobDraft<TeamPlanDueJob> = {
    type: 'teamPlanDue',
    dueDay,
    ownerModule: TEAM_OWNER_MODULE,
    targetId: teamId,
    expectedRevision,
    payload: { planId },
  };
  return draft;
}

// ── 小工具 ─────────────────────────────────────────────────────────────────

function cityOf(location: TeamLocation): CityId | undefined {
  return location.kind === 'city' ? location.cityId : undefined;
}

function findTeamOfMember(state: TeamState, memberId: CharacterId): Team | undefined {
  for (const t of Object.values(state.teams)) {
    if (t.memberIds.includes(memberId)) return t;
  }
  return undefined;
}

function hasActiveNonFreePlan(state: TeamState, team: Team): boolean {
  if (team.activePlanId === undefined) return false;
  const plan = tryGetPlan(state, team.activePlanId);
  return plan !== undefined && plan.status === 'active' && plan.kind !== 'cityFree';
}

// ──────────────────────────────────────────────────────────────────────────
// 5.1 玩家 Command — 城際旅行（玩家三段）
// ──────────────────────────────────────────────────────────────────────────

// startCityTravel：玩家隊伍在城市 → 建立 playerTravel 的 cityTravel Plan 與第一段 Job。
export function handleStartCityTravel(
  state: TeamState,
  cmd: StartCityTravelCommand,
  ctx: TeamHandlerContext,
): TeamHandlerResult {
  const team = tryGetTeam(state, state.playerTeamId);
  if (team === undefined) return reject('team/unknown-player-team');
  const fromCityId = cityOf(team.location);
  if (fromCityId === undefined) return reject('team/not-in-city');
  if (hasActiveNonFreePlan(state, team)) return reject('team/busy');

  const mode = ctx.definitions.getPlayerTravelMode(cmd.modeId);
  const firstLeg = mode.segments[0];
  const nextSegmentDay = (ctx.worldDay + firstLeg) as WorldDay;

  const planId = ctx.ids.nextTeamPlanId();
  const payload: TeamPlanPayload = {
    kind: 'cityTravel',
    travel: {
      kind: 'playerTravel',
      fromCityId,
      toCityId: cmd.toCityId,
      routeId: cmd.routeId,
      modeId: cmd.modeId,
      segmentIndex: 0,
      nextSegmentDay,
    },
  };
  const plan: TeamPlan = {
    planId,
    teamId: team.teamId,
    kind: 'cityTravel',
    startedOnDay: ctx.worldDay,
    dueOnDay: nextSegmentDay,
    status: 'active',
    payload,
    revision: 0 as Revision,
  };

  const to: TeamLocation = {
    kind: 'travelling',
    routeId: cmd.routeId,
    progress: { kind: 'playerSegments', segmentIndex: 0 },
  };
  const nextTeam: Team = { ...team, location: to, activePlanId: planId, revision: bump(team.revision) };

  let next = upsertPlan(state, plan);
  next = upsertTeam(next, nextTeam);

  const locationChanged: TeamLocationChangedEvent = { type: 'TeamLocationChanged', teamId: team.teamId, from: team.location, to };
  return accept(
    next,
    [emit(locationChanged)],
    [planDueJob(team.teamId, planId, nextSegmentDay, plan.revision)],
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 5.1 玩家 Command — 進出冒險地
// ──────────────────────────────────────────────────────────────────────────

// enterAdventureMap：玩家隊伍在城市 → 建立 1 日 enterAdventureMap Plan。
export function handleEnterAdventureMap(
  state: TeamState,
  cmd: EnterAdventureMapCommand,
  ctx: TeamHandlerContext,
): TeamHandlerResult {
  const team = tryGetTeam(state, state.playerTeamId);
  if (team === undefined) return reject('team/unknown-player-team');
  if (team.location.kind !== 'city') return reject('team/not-in-city');
  if (hasActiveNonFreePlan(state, team)) return reject('team/busy');

  const dueDay = (ctx.worldDay + 1) as WorldDay;
  const planId = ctx.ids.nextTeamPlanId();
  const plan: TeamPlan = {
    planId,
    teamId: team.teamId,
    kind: 'enterAdventureMap',
    startedOnDay: ctx.worldDay,
    dueOnDay: dueDay,
    status: 'active',
    payload: { kind: 'enterAdventureMap', adventureSiteId: cmd.adventureSiteId },
    revision: 0 as Revision,
  };
  let next = upsertPlan(state, plan);
  next = upsertTeam(next, { ...team, activePlanId: planId, revision: bump(team.revision) });
  return accept(next, [], [planDueJob(team.teamId, planId, dueDay, plan.revision)]);
}

// returnToCity：玩家隊伍位於冒險地圖 → 建立 1 日 returnToCity Plan。
export function handleReturnToCity(
  state: TeamState,
  cmd: ReturnToCityCommand,
  ctx: TeamHandlerContext,
): TeamHandlerResult {
  const team = tryGetTeam(state, cmd.teamId);
  if (team === undefined) return reject('team/unknown-team');
  if (team.location.kind !== 'adventureMap') return reject('team/not-in-adventure-map');
  const toCityId = ctx.world.getMapExitCity(team.location.mapId);
  return startReturnToCityPlan(state, team, toCityId, ctx);
}

// StartReturnFromDungeon（Internal；來源 dungeon）：驗證後建立 1 日返城 Plan。
export function handleStartReturnFromDungeon(
  state: TeamState,
  payload: StartReturnFromDungeonPayload,
  ctx: TeamHandlerContext,
): TeamHandlerResult {
  const team = tryGetTeam(state, payload.teamId);
  if (team === undefined) return reject('team/unknown-team');
  if (team.location.kind !== 'adventureMap' || team.location.mapId !== payload.mapId) {
    return reject('team/map-mismatch');
  }
  const toCityId = ctx.world.getMapExitCity(payload.mapId);
  return startReturnToCityPlan(state, team, toCityId, ctx);
}

function startReturnToCityPlan(
  state: TeamState,
  team: Team,
  toCityId: CityId,
  ctx: TeamHandlerContext,
): TeamHandlerResult {
  const dueDay = (ctx.worldDay + 1) as WorldDay;
  const planId = ctx.ids.nextTeamPlanId();
  const plan: TeamPlan = {
    planId,
    teamId: team.teamId,
    kind: 'returnToCity',
    startedOnDay: ctx.worldDay,
    dueOnDay: dueDay,
    status: 'active',
    payload: { kind: 'returnToCity', toCityId },
    revision: 0 as Revision,
  };
  let next = upsertPlan(state, plan);
  next = upsertTeam(next, { ...team, activePlanId: planId, revision: bump(team.revision) });
  return accept(next, [], [planDueJob(team.teamId, planId, dueDay, plan.revision)]);
}

// ──────────────────────────────────────────────────────────────────────────
// 5.1 玩家 Command — 休息（隊伍級 Plan）
// ──────────────────────────────────────────────────────────────────────────

export function handleRest(
  state: TeamState,
  cmd: RestCommand,
  ctx: TeamHandlerContext,
): TeamHandlerResult {
  const team = tryGetTeam(state, state.playerTeamId);
  if (team === undefined) return reject('team/unknown-player-team');
  if (hasActiveNonFreePlan(state, team)) return reject('team/busy');

  if (cmd.planKind === 'homeRest') {
    if (team.location.kind !== 'home') return reject('team/not-at-home');
  } else {
    // cityFacilityAction
    if (team.location.kind !== 'city') return reject('team/not-in-city');
  }

  // 休息天數由 TeamPlanRule 提供（原本是寫死的 365 / 1）。沒有對應規則＝內容沒給，明確拒絕。
  const planRuleId = ctx.teamPlanRuleIdByKind[cmd.planKind];
  if (planRuleId === undefined) {
    return reject('team/plan-rule-missing', { planKind: cmd.planKind });
  }
  const planRule = ctx.definitions.getTeamPlanRule(planRuleId);
  if (planRule.kind !== cmd.planKind) {
    return reject('team/plan-rule-kind-mismatch', {
      planKind: cmd.planKind,
      ruleKind: planRule.kind,
    });
  }
  const days = planRule.durationDays;
  const dueDay = (ctx.worldDay + days) as WorldDay;
  const planId = ctx.ids.nextTeamPlanId();
  const plan: TeamPlan = {
    planId,
    teamId: team.teamId,
    kind: cmd.planKind,
    startedOnDay: ctx.worldDay,
    dueOnDay: dueDay,
    status: 'active',
    payload:
      cmd.planKind === 'homeRest'
        ? { kind: 'homeRest', homeId: team.location.kind === 'home' ? team.location.homeId : (undefined as never) }
        : { kind: 'cityFacilityAction', facilityKind: 'inn' },
    revision: 0 as Revision,
  };
  let next = upsertPlan(state, plan);
  next = upsertTeam(next, { ...team, activePlanId: planId, revision: bump(team.revision) });
  return accept(next, [], [planDueJob(team.teamId, planId, dueDay, plan.revision)]);
}

// ──────────────────────────────────────────────────────────────────────────
// 5.1 玩家 Command — 戰鬥配置（原子替換，不消耗世界時間）
// ──────────────────────────────────────────────────────────────────────────

export function handleConfigureCombatFormation(
  state: TeamState,
  cmd: ConfigureCombatFormationCommand,
  _ctx: TeamHandlerContext,
): TeamHandlerResult {
  const team = tryGetTeam(state, cmd.teamId);
  if (team === undefined) return reject('team/unknown-team');
  if (team.control === 'child') return reject('team/child-no-combat');
  // TODO: 「發令者為隊長」與「無 active Combat」需 actor/combat 狀態；本模組尚未持有，暫接受。

  const validation = validatePlacements(team.memberIds, cmd.placements);
  if (!validation.ok) return reject(validation.code, validation.details);

  const prev = state.combatFormations[cmd.teamId];
  const revision = prev !== undefined ? bump(prev.revision) : (0 as Revision);
  const formation: TeamCombatFormation = { teamId: cmd.teamId, placements: cmd.placements, revision };
  const next = upsertFormation(state, formation);
  const changed: TeamCombatFormationChangedEvent = {
    type: 'TeamCombatFormationChanged',
    teamId: cmd.teamId,
    placements: cmd.placements,
    revision,
  };
  return accept(next, [emit(changed)]);
}

type PlacementValidation =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: string; details?: Readonly<Record<string, string | number | boolean>> }>;

// 每名正式成員恰占一格；格位合法（3×3）且不重疊；無候補、無遺漏、無非正式成員（doc §3.1）。
export function validatePlacements(
  memberIds: readonly CharacterId[],
  placements: Readonly<Record<CharacterId, GridCell>>,
): PlacementValidation {
  const placedIds = Object.keys(placements) as CharacterId[];
  const memberSet = new Set<CharacterId>(memberIds);

  // 非正式成員被配置。
  for (const id of placedIds) {
    if (!memberSet.has(id)) {
      return { ok: false, code: 'team/formation-non-member', details: { characterId: String(id) } };
    }
  }
  // 漏配正式成員（bench）。
  for (const id of memberIds) {
    if (placements[id] === undefined) {
      return { ok: false, code: 'team/formation-benched-member', details: { characterId: String(id) } };
    }
  }
  // 格位合法性 + 重疊。
  const occupied = new Set<string>();
  for (const id of placedIds) {
    const cell = placements[id];
    if (cell === undefined) continue;
    if (
      cell.floor !== 0 || // 戰鬥配置只有單一 3×3，floor 必固定為 0；否則可用不同 floor 規避下方重疊檢查
      !Number.isInteger(cell.row) ||
      !Number.isInteger(cell.col) ||
      cell.row < GRID_MIN ||
      cell.row > GRID_MAX ||
      cell.col < GRID_MIN ||
      cell.col > GRID_MAX
    ) {
      return { ok: false, code: 'team/formation-cell-out-of-range', details: { characterId: String(id) } };
    }
    const key = `${cell.floor}:${cell.row}:${cell.col}`;
    if (occupied.has(key)) {
      return { ok: false, code: 'team/formation-cell-overlap', details: { cell: key } };
    }
    occupied.add(key);
  }
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// 5.1 玩家 Command — 招募
// ──────────────────────────────────────────────────────────────────────────

export function handleRecruitTavernAdventurer(
  state: TeamState,
  cmd: RecruitTavernAdventurerCommand,
  ctx: TeamHandlerContext,
): TeamHandlerResult {
  const playerTeam = tryGetTeam(state, state.playerTeamId);
  if (playerTeam === undefined) return reject('team/unknown-player-team');
  if (playerTeam.memberIds.length >= MAX_FORMAL_MEMBERS) return reject('team/team-full');

  const target = cmd.targetCharacterId;
  if (playerTeam.memberIds.includes(target)) return reject('team/already-own-member');

  const sourceTeam = findTeamOfMember(state, target);
  if (sourceTeam === undefined) return reject('team/target-not-in-team');
  // 多人 Team 的任何成員一律以 alreadyInTeam 拒絕（doc §7.6）。
  if (sourceTeam.memberIds.length !== 1 || sourceTeam.leaderId !== target) {
    return reject('team/already-in-team');
  }
  // 硬條件：同城才可招募（酒館冒險者在玩家**目前所在城**）。旅行中或跨城一律拒絕——這是資格判定，不是
  // 擲骰結果，故用 reject。[仍缺（見 HANDOFF）] 酒館可見性（該 NPC 是否真的在此城酒館出現）需 city/content。
  const playerLoc = playerTeam.location;
  const targetLoc = sourceTeam.location;
  if (playerLoc.kind !== 'city' || targetLoc.kind !== 'city' || playerLoc.cityId !== targetLoc.cityId) {
    return reject('team/not-in-same-city');
  }

  // 只有 Resolver 擲骰成功才轉移成員；失敗不得改動任何成員或資產。單次抽取，nextCursor 不需再串接
  // （本調用 stream 一次性；招募與離隊結算分屬不同調用/tag）。
  const recruitment = ctx.resolvers.resolveRecruitmentSuccess({
    recruiterLeaderId: playerTeam.leaderId,
    targetCharacterId: target,
    currentFormalCount: playerTeam.memberIds.length,
    ...(ctx.rngContext ? { rngContext: ctx.rngContext } : {}),
  });
  // 機率判定「這次沒中」是**正常玩法結果**，不是非法指令：以**接受**（提交、不轉移角色）表達，而非拒絕。
  // 拒絕會回滾 §7.2 交易 cursor，下一次招募命令因此取得**相同的 CommandId → 相同 RNG stream/cursor →
  // 相同骰值**，永遠無法靠重試改變結果。接受則推進序號，下一次得新 stream、重新擲。資格不符（隊滿、
  // 已是成員、目標非單人隊…）才是拒絕。
  // 註：目前不 emit 事件（契約無 RecruitmentResolved）；UI 觀察性事件是後續契約擴充,不在本修正範圍。
  if (!recruitment.value) return accept(state);

  // 關閉來源 Team、加入玩家正式成員、建立涵蓋全隊的新合法配置。
  const nextMembers = [...playerTeam.memberIds, target];
  let next = removeTeam(state, sourceTeam.teamId);
  next = upsertTeam(next, { ...playerTeam, memberIds: nextMembers, revision: bump(playerTeam.revision) });

  // 留隊帳本：新成員入隊日 = 今天。
  const retention = next.memberRetention[playerTeam.teamId];
  if (retention !== undefined) {
    next = upsertRetention(next, {
      ...retention,
      memberJoinedOnDay: { ...retention.memberJoinedOnDay, [target]: ctx.worldDay },
      revision: bump(retention.revision),
    });
  }

  const messages = recomputeFormation(next, playerTeam.teamId, nextMembers, ctx);
  next = messages.next;

  const departed: TeamMemberDepartedEvent = { type: 'TeamMemberDeparted', teamId: sourceTeam.teamId, characterId: target, reason: 'recruitedAway' };
  const joined: TeamMemberJoinedEvent = { type: 'TeamMemberJoined', teamId: playerTeam.teamId, characterId: target, reason: 'recruited' };
  return accept(next, [
    emit(departed),
    emit(joined),
    ...messages.events,
  ]);
}

// 模組自算的 row-major 合法配置：memberIds[i] → (row=⌊i/3⌋, col=i%3, floor=0)。≤9 名成員恆合法（無重疊、
// 不越界），供 Resolver 產生非法配置時的退路。
function rowMajorPlacements(memberIds: readonly CharacterId[]): Record<CharacterId, GridCell> {
  const cols = GRID_MAX + 1;
  const out: Record<CharacterId, GridCell> = {};
  memberIds.forEach((id, i) => {
    out[id] = { floor: 0, row: Math.floor(i / cols), col: i % cols };
  });
  return out;
}

// 以 Resolver 產生涵蓋全隊的預設配置並替換（不在 Handler 寫死格位順序）。
function recomputeFormation(
  state: TeamState,
  teamId: TeamId,
  memberIds: readonly CharacterId[],
  ctx: TeamHandlerContext,
): Readonly<{ next: TeamState; events: readonly DomainEventDraft<unknown>[] }> {
  const prev = state.combatFormations[teamId];
  const resolved = ctx.resolvers.resolveDefaultPlacement({
    teamId,
    memberIds,
    current: prev?.placements ?? {},
  });
  // Team 的配置不變量由 Team 自己守：資料化 Resolver 若產生非法配置（重疊/越界/漏配/floor≠0），退回模組
  // 自算的 row-major 合法配置——絕不把非法配置寫進 State（Resolver 無權破壞本模組不變量）。
  const placements: Readonly<Record<CharacterId, GridCell>> =
    validatePlacements(memberIds, resolved).ok === true ? resolved : rowMajorPlacements(memberIds);
  const revision = prev !== undefined ? bump(prev.revision) : (0 as Revision);
  const next = upsertFormation(state, { teamId, placements, revision });
  const changed: TeamCombatFormationChangedEvent = { type: 'TeamCombatFormationChanged', teamId, placements, revision };
  return { next, events: [emit(changed)] };
}

// ──────────────────────────────────────────────────────────────────────────
// 5.1 玩家 Command — 繼承
// ──────────────────────────────────────────────────────────────────────────

export function handleSelectPlayerSuccessor(
  state: TeamState,
  cmd: SelectPlayerSuccessorCommand,
  _ctx: TeamHandlerContext,
): TeamHandlerResult {
  const pending = state.pendingSuccession;
  if (pending === undefined || pending.interactionId !== cmd.interactionId) {
    return reject('team/no-succession');
  }
  if (!pending.eligibleSuccessorIds.includes(cmd.successorId)) {
    return reject('team/ineligible-successor');
  }

  const playerTeam = requireTeam(state, state.playerTeamId);
  let next = state;

  // 候選若目前位於單人 NPC Team，選定時合法轉入玩家隊。
  const sourceTeam = findTeamOfMember(state, cmd.successorId);
  const events: DomainEventDraft<unknown>[] = [];
  let members = playerTeam.memberIds;
  if (sourceTeam !== undefined && sourceTeam.teamId !== playerTeam.teamId) {
    next = removeTeam(next, sourceTeam.teamId);
    if (!members.includes(cmd.successorId)) members = [...members, cmd.successorId];
    const joined: TeamMemberJoinedEvent = {
    type: 'TeamMemberJoined',
      teamId: playerTeam.teamId,
      characterId: cmd.successorId,
      reason: 'succession',
    };
    events.push(emit(joined));
  }

  next = upsertTeam(next, {
    ...playerTeam,
    memberIds: members,
    leaderId: cmd.successorId,
    revision: bump(playerTeam.revision),
  });
  next = setPendingSuccession(next, undefined);

  const selected: PlayerSuccessorSelectedEvent = {
    type: 'PlayerSuccessorSelected',
    teamId: playerTeam.teamId,
    formerLeaderId: pending.formerLeaderId,
    successorId: cmd.successorId,
    reason: pending.reason,
  };
  events.push(emit(selected));
  return accept(next, events);
}

// getPlayerControlledCharacterId 的唯一真相 = 玩家隊 leaderId（見 queries.ts）。
export function getPlayerControlledCharacterId(state: TeamState): CharacterId {
  return requireTeam(state, state.playerTeamId).leaderId;
}

// ──────────────────────────────────────────────────────────────────────────
// 5.1 玩家 Command — 開始城鎮自由活動（先結算留隊 → 擲離隊骰 → 建立 cityFree）
// ──────────────────────────────────────────────────────────────────────────

export function handleBeginCityFreePeriod(
  state: TeamState,
  ctx: TeamHandlerContext,
): TeamHandlerResult {
  const team = tryGetTeam(state, state.playerTeamId);
  if (team === undefined) return reject('team/unknown-player-team');
  const cityId = cityOf(team.location);
  if (cityId === undefined) return reject('team/not-in-city');
  if (hasActiveNonFreePlan(state, team)) return reject('team/busy');

  const settled = settleRetentionAndDepartures(state, team, cityId, ctx);
  let next = settled.next;
  const currentTeam = requireTeam(next, team.teamId);

  // 建立 cityFree Plan（開放式；自由日累積由 freeAction / tick 驅動，本 foundation 只建立 Plan）。
  const planId = ctx.ids.nextTeamPlanId();
  const plan: TeamPlan = {
    planId,
    teamId: team.teamId,
    kind: 'cityFree',
    startedOnDay: ctx.worldDay,
    status: 'active',
    payload: { kind: 'cityFree' },
    revision: 0 as Revision,
  };
  next = upsertPlan(next, plan);
  next = upsertTeam(next, { ...currentTeam, activePlanId: planId, revision: bump(currentTeam.revision) });
  return accept(next, settled.events, []);
}

// 留隊判定（doc §6.1）：入隊滿指定日數的非隊長正式成員，依 workNet 擲離隊骰。
// 日數由 MemberRetentionRule 提供（原本是 Handler 裡的 RETENTION_ACTIVATION_DAYS = 60，
// 而契約的 activationDaysAfterJoin 早就存在——程式等於又抄了一份資料）。
// 擲中者立即離隊，並在目前城市成為自己為隊長的一人 NPC Team。之後 Ledger 以新 cycle 歸零。
function settleRetentionAndDepartures(
  state: TeamState,
  team: Team,
  cityId: CityId,
  ctx: TeamHandlerContext,
): Readonly<{ next: TeamState; events: readonly DomainEventDraft<unknown>[] }> {
  const retention = state.memberRetention[team.teamId];
  const events: DomainEventDraft<unknown>[] = [];
  let next = state;
  let members = team.memberIds;

  if (retention !== undefined) {
    const activationDays = ctx.definitions.getMemberRetentionRule(
      ctx.memberRetentionRuleId,
    ).activationDaysAfterJoin;
    const workNet = workNetOf(retention.currentWorkSettlement);
    const departed: CharacterId[] = [];
    // 顯式串接游標：每名成員從前一擲的 nextCursor 續抽，否則全體共用 cursor 0 → 相同結果（全走或全留）。
    // 被 continue 略過的成員不抽、不前進游標。無 rngContext（純單元 stub）時不串接。
    let cursor: RngCursor | undefined = ctx.rngContext?.cursor;
    for (const memberId of team.memberIds) {
      if (memberId === team.leaderId) continue; // 隊長不參與
      const joinedOn = retention.memberJoinedOnDay[memberId];
      if (joinedOn === undefined) continue;
      if (ctx.worldDay - joinedOn < activationDays) continue; // 未達留隊判定生效日數（由規則提供）
      const rngContext =
        ctx.rngContext !== undefined && cursor !== undefined ? { ...ctx.rngContext, cursor } : undefined;
      const roll = ctx.resolvers.resolveMemberDeparture({
        teamId: team.teamId,
        memberId,
        leaderId: team.leaderId,
        workNet,
        ...(rngContext ? { rngContext } : {}),
      });
      if (rngContext !== undefined) cursor = roll.nextCursor; // 續接：下一名成員從此抽起
      if (roll.value) departed.push(memberId);
    }

    for (const memberId of departed) {
      members = members.filter((m) => m !== memberId);
      const spawnedTeamId = ctx.ids.nextTeamId();
      const npcTeam: Team = {
        teamId: spawnedTeamId,
        control: 'npc',
        memberIds: [memberId],
        temporaryMemberIds: [],
        leaderId: memberId,
        location: { kind: 'city', cityId },
        revision: 0 as Revision,
      };
      next = upsertTeam(next, npcTeam);
      // 新生成的單人 NPC Team 也必須有合法配置（成員變動須於同一交易產生配置）。
      const npcFormation = recomputeFormation(next, spawnedTeamId, [memberId], ctx);
      next = npcFormation.next;
      events.push(...npcFormation.events);
      const ev: TeamMemberDepartedEvent = {
    type: 'TeamMemberDeparted',
        teamId: team.teamId,
        characterId: memberId,
        reason: 'economicDeparture',
        spawnedTeamId,
      };
      events.push(emit(ev));
    }

    // 玩家隊成員變動 → 於同一交易重建其配置（移除離隊者，否則配置仍保留已離隊成員）。
    if (departed.length > 0) {
      const playerFormation = recomputeFormation(next, team.teamId, members, ctx);
      next = playerFormation.next;
      events.push(...playerFormation.events);
    }

    // Ledger 以新 cycleStartedOnDay 歸零；留隊成員的 joinedOn 保留。
    const nextJoined: Record<CharacterId, WorldDay> = {};
    for (const m of members) {
      const j = retention.memberJoinedOnDay[m];
      if (j !== undefined) nextJoined[m] = j;
    }
    next = upsertRetention(next, {
      teamId: team.teamId,
      memberJoinedOnDay: nextJoined,
      currentWorkSettlement: emptyWorkSettlement(ctx.worldDay),
      revision: bump(retention.revision),
    });
  }

  if (members.length !== team.memberIds.length) {
    next = upsertTeam(next, { ...requireTeam(next, team.teamId), memberIds: members, revision: bump(team.revision) });
  }
  return { next, events };
}

// ──────────────────────────────────────────────────────────────────────────
// 5.4 Internal Command — NPC Team Plan（僅接受 NPC Behavior；此處接受其 payload 形狀）
// ──────────────────────────────────────────────────────────────────────────

export function handleStartNpcTeamPlan(
  state: TeamState,
  payload: StartNpcTeamPlanPayload,
  ctx: TeamHandlerContext,
): TeamHandlerResult {
  const team = tryGetTeam(state, payload.teamId);
  if (team === undefined) return reject('team/unknown-team');
  if (team.control !== 'npc') return reject('team/not-npc-team');

  const planId = ctx.ids.nextTeamPlanId();

  // NPC 城際旅行：固定 6 日直達，無段落、無事件、無 Pending（doc §7.4）。
  if (payload.kind === 'cityTravel' && payload.payload.kind === 'cityTravel') {
    const travel = payload.payload.travel;
    if (travel.kind !== 'npcTravel') return reject('team/npc-travel-shape');
    const arrivalDay = travel.arrivalDay;
    const plan: TeamPlan = {
      planId,
      teamId: team.teamId,
      kind: 'cityTravel',
      startedOnDay: ctx.worldDay,
      dueOnDay: arrivalDay,
      status: 'active',
      payload: payload.payload,
      revision: 0 as Revision,
    };
    const to: TeamLocation = {
      kind: 'travelling',
      routeId: travel.routeId,
      progress: { kind: 'npcDirect' },
    };
    let next = upsertPlan(state, plan);
    next = upsertTeam(next, { ...team, location: to, activePlanId: planId, revision: bump(team.revision) });
    const locationChanged: TeamLocationChangedEvent = { type: 'TeamLocationChanged', teamId: team.teamId, from: team.location, to };
    return accept(
      next,
      [emit(locationChanged)],
      [planDueJob(team.teamId, planId, arrivalDay, plan.revision)],
    );
  }

  // 其他 kind：建立即時或短期 Plan（foundation 版：無到期 Job 的通用 Plan）。
  // TODO: enterAdventureMap / npcDungeonExploration / escortTravel 等 NPC 專屬到期規則。
  const plan: TeamPlan = {
    planId,
    teamId: team.teamId,
    kind: payload.kind,
    startedOnDay: ctx.worldDay,
    status: 'active',
    payload: payload.payload,
    revision: 0 as Revision,
  };
  let next = upsertPlan(state, plan);
  next = upsertTeam(next, { ...team, activePlanId: planId, revision: bump(team.revision) });
  return accept(next, [], []);
}

// ──────────────────────────────────────────────────────────────────────────
// 5.2 ScheduledJob — teamPlanDue（依 plan revision 安全跳過 stale job）
// ──────────────────────────────────────────────────────────────────────────

export function handleTeamPlanDueJob(
  state: TeamState,
  job: TeamPlanDueJob,
  ctx: TeamHandlerContext,
): ModuleResult<TeamState> {
  const noop: ModuleResult<TeamState> = { nextSlice: state, outgoingMessages: [], scheduledJobs: [] };
  const plan = tryGetPlan(state, job.payload.planId);
  if (plan === undefined) return noop;
  if (plan.status !== 'active') return noop;
  // 舊 Plan Job 因 revision 不符而安全跳過（doc §5.2 / 測試 7）。
  if (job.expectedRevision !== undefined && plan.revision !== job.expectedRevision) return noop;

  switch (plan.kind) {
    case 'cityTravel':
      return dueCityTravel(state, plan, ctx);
    case 'enterAdventureMap':
      return dueEnterAdventureMap(state, plan, ctx);
    case 'returnToCity':
      return dueReturnToCity(state, plan);
    case 'homeRest':
      return dueHomeRest(state, plan);
    case 'cityFacilityAction':
      return duePlanComplete(state, plan, []);
    default:
      // TODO: npcDungeonExploration / escortTravel / homeTeachingPost / childStudy 到期規則。
      return duePlanComplete(state, plan, []);
  }
}

// 完成 Plan 的共通收尾：標記 completed、清空 team.activePlanId、遞增 revision，並補 TeamPlanCompleted。
function duePlanComplete(
  state: TeamState,
  plan: TeamPlan,
  extraMessages: readonly TransactionMessageDraft[],
  teamOverride?: Team,
): ModuleResult<TeamState> {
  const team = teamOverride ?? requireTeam(state, plan.teamId);
  const completedPlan: TeamPlan = { ...plan, status: 'completed', revision: bump(plan.revision) };
  let next = upsertPlan(state, completedPlan);
  const clearedTeam: Team = { ...team, revision: bump(team.revision) };
  delete (clearedTeam as { activePlanId?: TeamPlanId }).activePlanId;
  next = upsertTeam(next, clearedTeam);
  const completed: TeamPlanCompletedEvent = {
    type: 'TeamPlanCompleted',
    teamId: plan.teamId,
    planId: plan.planId,
    kind: plan.kind,
    payload: plan.payload,
  };
  return {
    nextSlice: next,
    outgoingMessages: [emit(completed), ...extraMessages],
    scheduledJobs: [],
  };
}

function dueCityTravel(
  state: TeamState,
  plan: TeamPlan,
  ctx: TeamHandlerContext,
): ModuleResult<TeamState> {
  if (plan.payload.kind !== 'cityTravel') {
    return { nextSlice: state, outgoingMessages: [], scheduledJobs: [] };
  }
  const travel = plan.payload.travel;
  const team = requireTeam(state, plan.teamId);

  if (travel.kind === 'playerTravel') {
    // 玩家旅行：teamPlanDue 只「抵達本段」並發布 TravelSegmentReached，然後**停下等旅行事件 Workflow
    // 決定**（doc §2.3）——不在同一交易自行推進，否則旅行事件/護衛刺殺/Pending 選擇都攔不住旅程。
    //   - 無事件 → CompletePlayerTravelSegmentWithoutEvent → handleCompletePlayerTravelSegmentWithoutEvent 推進
    //   - 有事件 → OpenPlayerTravelInteraction → 開 Pending 互動、等玩家（待實作）
    const mode = ctx.definitions.getPlayerTravelMode(travel.modeId);
    const segmentReached: TravelSegmentReachedEvent = {
      type: 'TravelSegmentReached',
      teamId: plan.teamId,
      routeId: travel.routeId,
      segmentIndex: travel.segmentIndex,
      eventProfileId: mode.travelEventWeightProfileId,
    };
    return { nextSlice: state, outgoingMessages: [emit(segmentReached)], scheduledJobs: [] };
  }

  // NPC 旅行：第 6 日直接抵達，一次旅行 MXP ×1，無段落事件。
  const rule = ctx.definitions.getNpcTravelRule(travel.npcTravelRuleId);
  const to: TeamLocation = { kind: 'city', cityId: travel.toCityId };
  const arrivalTeam: Team = { ...team, location: to, revision: bump(team.revision) };
  const locationChanged: TeamLocationChangedEvent = { type: 'TeamLocationChanged', teamId: plan.teamId, from: team.location, to };
  const travelCompleted: TravelCompletedEvent = {
    type: 'TravelCompleted',
    teamId: plan.teamId,
    fromCityId: travel.fromCityId,
    toCityId: travel.toCityId,
    travelKind: 'npc',
    experienceRuleId: rule.travelExperienceRuleId,
    experienceMultiplier: rule.travelExperienceMultiplier,
  };
  return duePlanComplete(
    state,
    plan,
    [
      emit(locationChanged),
      emit(travelCompleted),
    ],
    arrivalTeam,
  );
}

// 旅行事件 Workflow 判定「本段無事件」→ 推進下一段（或第三段後抵達）。與 dueCityTravel 分工：後者只
// 「抵達本段 + 發 TravelSegmentReached」後停下，推進一律由此 Internal Command 觸發，讓旅行事件、護衛
// 刺殺與 Pending 選擇能攔在段落之間。日期沿用 plan 儲存的 nextSegmentDay（＝本段到期日）+ 下一段里程，
// 與舊 dueCityTravel 的 `job.dueDay + leg` 等價。
export function handleCompletePlayerTravelSegmentWithoutEvent(
  state: TeamState,
  cmd: CompletePlayerTravelSegmentWithoutEventPayload,
  ctx: TeamHandlerContext,
): TeamHandlerResult {
  const plan = tryGetPlan(state, cmd.planId);
  if (plan === undefined || plan.status !== 'active') return reject('team/no-active-travel-plan');
  if (cmd.teamId !== plan.teamId) return reject('team/travel-team-mismatch');
  if (plan.kind !== 'cityTravel' || plan.payload.kind !== 'cityTravel') return reject('team/not-city-travel');
  const travel = plan.payload.travel;
  if (travel.kind !== 'playerTravel') return reject('team/not-player-travel');
  // segmentIndex 必須對上目前所在段落——防重放/過期命令重複推進（Plan payload 的段落即狀態游標）。
  if (travel.segmentIndex !== cmd.segmentIndex) return reject('team/travel-segment-mismatch');
  const team = requireTeam(state, plan.teamId);
  const mode = ctx.definitions.getPlayerTravelMode(travel.modeId);

  if (travel.segmentIndex < 2) {
    const nextIndex = (travel.segmentIndex + 1) as 1 | 2;
    const nextSegmentDay = (travel.nextSegmentDay + mode.segments[nextIndex]) as WorldDay;
    const nextPlan: TeamPlan = {
      ...plan,
      dueOnDay: nextSegmentDay,
      payload: { kind: 'cityTravel', travel: { ...travel, segmentIndex: nextIndex, nextSegmentDay } },
      revision: bump(plan.revision),
    };
    const to: TeamLocation = {
      kind: 'travelling',
      routeId: travel.routeId,
      progress: { kind: 'playerSegments', segmentIndex: nextIndex },
    };
    let next = upsertPlan(state, nextPlan);
    next = upsertTeam(next, { ...team, location: to, revision: bump(team.revision) });
    return accept(next, [], [planDueJob(plan.teamId, plan.planId, nextSegmentDay, nextPlan.revision)]);
  }

  // 第三段完成 → 抵達目的城。
  const to: TeamLocation = { kind: 'city', cityId: travel.toCityId };
  const arrivalTeam: Team = { ...team, location: to, revision: bump(team.revision) };
  const locationChanged: TeamLocationChangedEvent = {
    type: 'TeamLocationChanged',
    teamId: plan.teamId,
    from: team.location,
    to,
  };
  const travelCompleted: TravelCompletedEvent = {
    type: 'TravelCompleted',
    teamId: plan.teamId,
    fromCityId: travel.fromCityId,
    toCityId: travel.toCityId,
    travelKind: 'player',
    modeId: travel.modeId,
    experienceRuleId: mode.travelExperienceRuleId,
    experienceMultiplier: mode.travelExperienceMultiplier,
  };
  const completed = duePlanComplete(state, plan, [emit(locationChanged), emit(travelCompleted)], arrivalTeam);
  return accept(completed.nextSlice, completed.outgoingMessages, completed.scheduledJobs);
}

function dueEnterAdventureMap(
  state: TeamState,
  plan: TeamPlan,
  ctx: TeamHandlerContext,
): ModuleResult<TeamState> {
  if (plan.payload.kind !== 'enterAdventureMap') {
    return { nextSlice: state, outgoingMessages: [], scheduledJobs: [] };
  }
  const team = requireTeam(state, plan.teamId);
  // [MISMATCH] mapId 真正由 map 模組於進入時建立；foundation 以 payload.mapId 或本地配發。
  const mapId = plan.payload.mapId ?? ctx.ids.nextMapInstanceId();
  const to: TeamLocation = { kind: 'adventureMap', mapId };
  const arrivalTeam: Team = { ...team, location: to, revision: bump(team.revision) };
  const locationChanged: TeamLocationChangedEvent = { type: 'TeamLocationChanged', teamId: plan.teamId, from: team.location, to };

  const extras: TransactionMessageDraft[] = [emit(locationChanged)];
  // NPC 隊伍進圖後送出 StartNpcDungeonRun（唯一處理者 dungeon）。
  if (team.control === 'npc') {
    extras.push(
      emitStartNpcDungeonRun({
        type: 'StartNpcDungeonRun',
        teamId: plan.teamId,
        mapId,
        planId: plan.planId,
      }),
    );
  }
  return duePlanComplete(state, plan, extras, arrivalTeam);
}

function dueReturnToCity(state: TeamState, plan: TeamPlan): ModuleResult<TeamState> {
  if (plan.payload.kind !== 'returnToCity') {
    return { nextSlice: state, outgoingMessages: [], scheduledJobs: [] };
  }
  const team = requireTeam(state, plan.teamId);
  const to: TeamLocation = { kind: 'city', cityId: plan.payload.toCityId };
  const arrivalTeam: Team = { ...team, location: to, revision: bump(team.revision) };
  const locationChanged: TeamLocationChangedEvent = { type: 'TeamLocationChanged', teamId: plan.teamId, from: team.location, to };
  return duePlanComplete(
    state,
    plan,
    [emit(locationChanged)],
    arrivalTeam,
  );
}

function dueHomeRest(state: TeamState, plan: TeamPlan): ModuleResult<TeamState> {
  const team = requireTeam(state, plan.teamId);
  const yearRest: HomeYearRestCompletedEvent = {
    type: 'HomeYearRestCompleted',
    teamId: plan.teamId,
    memberIds: team.memberIds,
    elapsedDays: 365,
  };
  return duePlanComplete(state, plan, [emit(yearRest)]);
}

// ──────────────────────────────────────────────────────────────────────────
// 繼承 Interaction 建立（供 CharacterRetired/AvailabilityChanged 訂閱者使用；此處提供純建立器）
// ──────────────────────────────────────────────────────────────────────────

// 玩家 Leader 死亡/退休時建立 PendingSuccession（doc §7.5）。NPC 隊不建立玩家互動。
export function openPlayerSuccession(
  state: TeamState,
  input: Readonly<{
    formerLeaderId: CharacterId;
    eligibleSuccessorIds: readonly CharacterId[];
    reason: 'death' | 'retirement';
  }>,
  ctx: TeamHandlerContext,
): TeamHandlerResult {
  const pending: PendingSuccession = {
    interactionId: ctx.ids.nextInteractionId(),
    formerLeaderId: input.formerLeaderId,
    eligibleSuccessorIds: input.eligibleSuccessorIds,
    openedOnDay: ctx.worldDay,
    reason: input.reason,
    revision: 0 as Revision,
  };
  const next = setPendingSuccession(state, pending);
  return accept(next, []);
}
