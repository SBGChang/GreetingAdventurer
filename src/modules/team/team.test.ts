// modules/team/team.test.ts
// 自足式單元測試（無外部框架、無 node/DOM 全域）。runTests() 逐案執行，任一失敗即 throw。
//
// 覆蓋（對照 doc §8 驗收）：
//   * 玩家 3/6/9 日旅行各自恰有三段 + 一次 TravelCompleted，且抵達發出 TeamLocationChanged(非 travelling)。
//   * NPC 旅行恰一筆抵達、無段落事件、travelKind=npc、×1。
//   * 戰鬥配置：重疊、漏配（bench）、非成員被拒；合法配置遞增 revision。
//   * 招募：單人 Team 依 Resolver 擲骰成功轉入；失敗與多人 Team 拒絕且來源不變。
//   * 留隊：入隊滿 60 日的非隊長成員擲中離隊，生成單人 NPC Team。
//   * 繼承：選定合法候選 → PlayerSuccessorSelected 並改 Leader；不合法被拒。
//   * 舊 Plan Job 因 revision 不符安全跳過。

import type {
  JobId,
  WorldDay,
  Revision,
  DomainEventDraft,
  CharacterId,
  Seed,
  RngStreamId,
  RngCursor,
} from '../../contracts/core';
import type {
  TeamPlanDueJob,
  StartNpcTeamPlanPayload,
  TravelCompletedEvent,
  TravelSegmentReachedEvent,
} from '../../contracts/team';
import type { GridCell } from '../../contracts/map';
import type { TeamState } from './state';
import { requireTeam, tryGetPlan } from './state';
import type { TeamHandlerResult } from './system';
import {
  handleStartCityTravel,
  handleEnterAdventureMap,
  handleReturnToCity,
  handleConfigureCombatFormation,
  handleRecruitTavernAdventurer,
  handleSelectPlayerSuccessor,
  handleBeginCityFreePeriod,
  handleStartNpcTeamPlan,
  handleTeamPlanDueJob,
  handleCompletePlayerTravelSegmentWithoutEvent,
} from './system';
import { createTeamQuery, createTeamPresenceQuery } from './queries';
import {
  fixtureTeamState,
  makeContext,
  stubResolverPort,
  rngStepBool,
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
import type { TravelModeId } from '../../contracts/core';

// ── 測試小工具 ──────────────────────────────────────────────────────────
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function ok(r: TeamHandlerResult): Extract<TeamHandlerResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got rejection ${r.rejection.code}`);
  return r;
}

function eventTypes(messages: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    const draft = m as DomainEventDraft<{ type?: string }>;
    if (draft.event && typeof draft.event.type === 'string') out.push(draft.event.type);
  }
  return out;
}

function findEvent<T = Record<string, unknown>>(
  messages: readonly unknown[],
  type: string,
): (T & { type: string }) | undefined {
  for (const m of messages) {
    const draft = m as DomainEventDraft<{ type?: string }>;
    if (draft.event && draft.event.type === type) return draft.event as T & { type: string };
  }
  return undefined;
}

// 把 handler 產出的 job draft 具現成完整 TeamPlanDueJob（補 jobId）。
function materializeJob(draft: unknown, seq: number): TeamPlanDueJob {
  return { ...(draft as Omit<TeamPlanDueJob, 'jobId'>), jobId: `job-${seq}` as JobId };
}

// ── 旅行模擬：反覆執行 teamPlanDue 直到無後續 Job ──────────────────────────
type TravelTally = Readonly<{
  segmentReached: number;
  travelCompleted: number;
  nonTravellingArrival: number;
  finalState: TeamState;
  travelKind?: string;
}>;

function runTravel(state0: TeamState, firstJobs: readonly unknown[], worldDay0: number): TravelTally {
  let state = state0;
  let jobs = firstJobs;
  let segmentReached = 0;
  let travelCompleted = 0;
  let nonTravellingArrival = 0;
  let travelKind: string | undefined;
  let seq = 0;

  const tally = (messages: readonly unknown[]): void => {
    for (const t of eventTypes(messages)) {
      if (t === 'TravelSegmentReached') segmentReached += 1;
      if (t === 'TravelCompleted') travelCompleted += 1;
    }
    const loc = findEvent<{ to: { kind: string } }>(messages, 'TeamLocationChanged');
    if (loc !== undefined && loc.to.kind !== 'travelling') nonTravellingArrival += 1;
    const tc = findEvent<TravelCompletedEvent>(messages, 'TravelCompleted');
    if (tc !== undefined) travelKind = tc.travelKind;
  };

  while (jobs.length > 0) {
    seq += 1;
    if (seq > 12) throw new Error('travel did not terminate');
    const job = materializeJob(jobs[0], seq);
    const ctx = makeContext({ worldDay: job.dueDay });
    const due = handleTeamPlanDueJob(state, job, ctx);
    state = due.nextSlice;
    tally(due.outgoingMessages);
    jobs = due.scheduledJobs;

    // 玩家旅行：teamPlanDue 只「抵達本段 + 發 TravelSegmentReached」後停下，推進由旅行事件 Workflow 決定。
    // 測試扮演「本段無事件」的 Workflow：對每個 TravelSegmentReached 送 CompletePlayerTravelSegmentWithoutEvent。
    const seg = findEvent<TravelSegmentReachedEvent>(due.outgoingMessages, 'TravelSegmentReached');
    if (seg !== undefined) {
      const activePlanId = requireTeam(state, seg.teamId).activePlanId;
      const plan = activePlanId !== undefined ? tryGetPlan(state, activePlanId) : undefined;
      if (plan === undefined) throw new Error('travel: no active plan to complete segment');
      const complete = ok(
        handleCompletePlayerTravelSegmentWithoutEvent(
          state,
          {
            type: 'CompletePlayerTravelSegmentWithoutEvent',
            teamId: seg.teamId,
            planId: plan.planId,
            segmentIndex: seg.segmentIndex,
          },
          ctx,
        ),
      );
      state = complete.result.nextSlice;
      tally(complete.result.outgoingMessages);
      jobs = complete.result.scheduledJobs;
    }
  }
  void worldDay0;
  return { segmentReached, travelCompleted, nonTravellingArrival, finalState: state, travelKind };
}

function playerTravel(modeId: TravelModeId): TravelTally {
  const worldDay = 20000;
  const s0 = fixtureTeamState(worldDay as WorldDay);
  const ctx = makeContext({ worldDay: worldDay as WorldDay });
  const r = ok(handleStartCityTravel(s0, { type: 'startCityTravel', toCityId: CITY_B, routeId: ROUTE_AB, modeId }, ctx));
  return runTravel(r.result.nextSlice, r.result.scheduledJobs, worldDay);
}

type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: 'player 3-day travel = exactly 3 segments + 1 TravelCompleted + arrival at CITY_B',
    run: () => {
      const t = playerTravel(TRAVEL_MODE_3);
      assert(t.segmentReached === 3, `3 segments (got ${t.segmentReached})`);
      assert(t.travelCompleted === 1, `1 TravelCompleted (got ${t.travelCompleted})`);
      assert(t.nonTravellingArrival === 1, `1 non-travelling arrival (got ${t.nonTravellingArrival})`);
      assert(t.travelKind === 'player', `travelKind player (got ${t.travelKind})`);
      const team = t.finalState.teams[PLAYER_TEAM_ID]!;
      assert(team.location.kind === 'city', 'arrived in a city');
      assert(team.location.kind === 'city' && team.location.cityId === CITY_B, 'arrived at CITY_B');
      assert(team.activePlanId === undefined, 'plan cleared after arrival');
    },
  },
  {
    name: 'player 6-day and 9-day travel also produce exactly 3 segments + 1 TravelCompleted',
    run: () => {
      for (const mode of [TRAVEL_MODE_6, TRAVEL_MODE_9]) {
        const t = playerTravel(mode);
        assert(t.segmentReached === 3, `mode ${String(mode)}: 3 segments (got ${t.segmentReached})`);
        assert(t.travelCompleted === 1, `mode ${String(mode)}: 1 TravelCompleted (got ${t.travelCompleted})`);
      }
    },
  },
  {
    name: 'NPC travel = 1 arrival, no TravelSegmentReached, travelKind npc',
    run: () => {
      const worldDay = 20000;
      const s0 = fixtureTeamState(worldDay as WorldDay);
      const ctx = makeContext({ worldDay: worldDay as WorldDay });
      const arrivalDay = (worldDay + 6) as WorldDay;
      const payload: StartNpcTeamPlanPayload = { type: 'StartNpcTeamPlan',
        teamId: NPC_TEAM_ID,
        kind: 'cityTravel',
        payload: {
          kind: 'cityTravel',
          travel: {
            kind: 'npcTravel',
            fromCityId: CITY_A,
            toCityId: CITY_B,
            routeId: ROUTE_AB,
            npcTravelRuleId: NPC_TRAVEL_RULE,
            arrivalDay,
          },
        },
      };
      const r = ok(handleStartNpcTeamPlan(s0, payload, ctx));
      const t = runTravel(r.result.nextSlice, r.result.scheduledJobs, worldDay);
      assert(t.segmentReached === 0, `no segment events (got ${t.segmentReached})`);
      assert(t.travelCompleted === 1, `1 TravelCompleted (got ${t.travelCompleted})`);
      assert(t.travelKind === 'npc', `travelKind npc (got ${t.travelKind})`);
      const npc = t.finalState.teams[NPC_TEAM_ID]!;
      assert(npc.location.kind === 'city' && npc.location.cityId === CITY_B, 'NPC arrived at CITY_B');
    },
  },
  {
    name: 'formation rejects overlapping cells',
    run: () => {
      const s0 = fixtureTeamState();
      const ctx = makeContext();
      const same: GridCell = { floor: 0, row: 0, col: 0 };
      const placements: Record<string, GridCell> = {
        [PLAYER_LEADER_ID]: same,
        [PLAYER_MEMBER_ID]: same,
      };
      const r = handleConfigureCombatFormation(s0, { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, placements }, ctx);
      assert(!r.ok && r.rejection.code === 'team/formation-cell-overlap', `overlap rejected (got ${r.ok ? 'ok' : r.rejection.code})`);
    },
  },
  {
    name: 'formation rejects benched member (missing placement)',
    run: () => {
      const s0 = fixtureTeamState();
      const ctx = makeContext();
      const placements: Record<string, GridCell> = { [PLAYER_LEADER_ID]: { floor: 0, row: 0, col: 0 } };
      const r = handleConfigureCombatFormation(s0, { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, placements }, ctx);
      assert(!r.ok && r.rejection.code === 'team/formation-benched-member', `bench rejected (got ${r.ok ? 'ok' : r.rejection.code})`);
    },
  },
  {
    name: 'formation rejects non-member placement',
    run: () => {
      const s0 = fixtureTeamState();
      const ctx = makeContext();
      const placements: Record<string, GridCell> = {
        [PLAYER_LEADER_ID]: { floor: 0, row: 0, col: 0 },
        [PLAYER_MEMBER_ID]: { floor: 0, row: 0, col: 1 },
        ['char-stranger']: { floor: 0, row: 1, col: 0 },
      };
      const r = handleConfigureCombatFormation(s0, { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, placements }, ctx);
      assert(!r.ok && r.rejection.code === 'team/formation-non-member', `non-member rejected (got ${r.ok ? 'ok' : r.rejection.code})`);
    },
  },
  {
    name: 'valid formation replaces placements and bumps revision, emits TeamCombatFormationChanged',
    run: () => {
      const s0 = fixtureTeamState();
      const ctx = makeContext();
      const placements: Record<string, GridCell> = {
        [PLAYER_LEADER_ID]: { floor: 0, row: 2, col: 2 },
        [PLAYER_MEMBER_ID]: { floor: 0, row: 0, col: 0 },
      };
      const r = ok(handleConfigureCombatFormation(s0, { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, placements }, ctx));
      const f = r.result.nextSlice.combatFormations[PLAYER_TEAM_ID]!;
      assert(f.revision === 1, `revision bumped to 1 (got ${f.revision})`);
      assert(eventTypes(r.result.outgoingMessages).includes('TeamCombatFormationChanged'), 'emits formation changed');
    },
  },
  {
    name: 'recruit single-member NPC team succeeds: joins player, source team removed',
    run: () => {
      const s0 = fixtureTeamState();
      const ctx = makeContext();
      const r = ok(handleRecruitTavernAdventurer(s0, { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID }, ctx));
      const player = r.result.nextSlice.teams[PLAYER_TEAM_ID]!;
      assert(player.memberIds.includes(NPC_LEADER_ID), 'target joined player team');
      assert(player.memberIds.length === 3, `player now 3 members (got ${player.memberIds.length})`);
      assert(r.result.nextSlice.teams[NPC_TEAM_ID] === undefined, 'source NPC team removed');
      const types = eventTypes(r.result.outgoingMessages);
      assert(types.includes('TeamMemberJoined'), 'emits TeamMemberJoined');
      assert(types.includes('TeamMemberDeparted'), 'emits TeamMemberDeparted');
      assert(types.includes('TeamCombatFormationChanged'), 'recomputes formation');
    },
  },
  {
    name: 'recruit 擲敗 → 接受（正常玩法結果、不轉移角色），非拒絕（拒絕會回滾 cursor 使重試恆同結果）',
    run: () => {
      const s0 = fixtureTeamState();
      const ctx = makeContext({
        resolvers: stubResolverPort({ resolveRecruitmentSuccess: ({ rngContext }) => rngStepBool(false, rngContext) }),
      });
      const r = handleRecruitTavernAdventurer(s0, { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID }, ctx);
      assert(r.ok, `擲敗應接受（非拒絕），實得 ${r.ok ? 'ok' : r.rejection.code}`);
      if (!r.ok) return;
      const player = r.result.nextSlice.teams[PLAYER_TEAM_ID]!;
      assert(!player.memberIds.includes(NPC_LEADER_ID), '擲敗不得把目標轉入玩家隊');
      const source = r.result.nextSlice.teams[NPC_TEAM_ID]!;
      assert(source.memberIds.includes(NPC_LEADER_ID), '擲敗不得改動來源隊');
      assert(r.result.outgoingMessages.length === 0, '擲敗不應 emit 任何轉移事件');
    },
  },
  {
    name: 'recruit 資格不符（隊已滿）→ 拒絕（與擲敗不同，這是非法指令）',
    run: () => {
      const base = fixtureTeamState();
      // 把玩家隊塞到滿員，招募任何人都應「資格不符」而拒絕。
      const full = Array.from({ length: 9 }, (_, i) => `char-fill-${i}` as CharacterId);
      const s0: TeamState = {
        ...base,
        teams: {
          ...base.teams,
          [PLAYER_TEAM_ID]: { ...base.teams[PLAYER_TEAM_ID]!, memberIds: full },
        },
      };
      const ctx = makeContext();
      const r = handleRecruitTavernAdventurer(s0, { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID }, ctx);
      assert(!r.ok, '隊滿時招募應拒絕');
    },
  },
  {
    name: 'recruit multi-member team member rejected as alreadyInTeam',
    run: () => {
      // 建立含 NPC_LEADER 的 2 人隊。
      const base = fixtureTeamState();
      const multi = {
        ...base,
        teams: {
          ...base.teams,
          [NPC_TEAM_ID]: {
            ...base.teams[NPC_TEAM_ID]!,
            memberIds: [NPC_LEADER_ID, 'char-other' as never],
          },
        },
      } as TeamState;
      const ctx = makeContext();
      const r = handleRecruitTavernAdventurer(multi, { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID }, ctx);
      assert(!r.ok && r.rejection.code === 'team/already-in-team', `already-in-team (got ${r.ok ? 'ok' : r.rejection.code})`);
    },
  },
  {
    name: 'retention: 60+ day non-leader member rolls to depart, spawns single NPC team',
    run: () => {
      const worldDay = 20000 as WorldDay;
      const s0 = fixtureTeamState(worldDay);
      const ctx = makeContext({
        worldDay,
        resolvers: stubResolverPort({
          resolveMemberDeparture: ({ memberId, rngContext }) =>
            rngStepBool(memberId === PLAYER_MEMBER_ID, rngContext),
        }),
      });
      const r = ok(handleBeginCityFreePeriod(s0, ctx));
      const player = r.result.nextSlice.teams[PLAYER_TEAM_ID]!;
      assert(!player.memberIds.includes(PLAYER_MEMBER_ID), 'departing member removed from player team');
      const departed = findEvent<{ reason: string; spawnedTeamId?: string }>(r.result.outgoingMessages, 'TeamMemberDeparted');
      assert(departed !== undefined && departed.reason === 'economicDeparture', 'economicDeparture emitted');
      assert(departed?.spawnedTeamId !== undefined, 'spawned a single NPC team');
      const spawned = r.result.nextSlice.teams[departed!.spawnedTeamId as never];
      assert(spawned !== undefined && spawned.leaderId === PLAYER_MEMBER_ID && spawned.memberIds.length === 1, 'spawned team is single-member led by departer');
      // cityFree plan established.
      assert(player.activePlanId !== undefined, 'cityFree plan created');
    },
  },
  {
    name: 'retention: 離隊迴圈逐名串接游標（cursor 0,1 不重用 → 同機率不再恆同結果）',
    run: () => {
      const worldDay = 20000 as WorldDay;
      const companion2 = 'char-companion-2' as CharacterId;
      const base = fixtureTeamState(worldDay);
      const playerTeam = base.teams[PLAYER_TEAM_ID]!;
      const retention = base.memberRetention[PLAYER_TEAM_ID]!;
      // 兩名非隊長成員皆滿 60 日 → 兩次擲骰。
      const s0: TeamState = {
        ...base,
        teams: {
          ...base.teams,
          [PLAYER_TEAM_ID]: { ...playerTeam, memberIds: [...playerTeam.memberIds, companion2] },
        },
        memberRetention: {
          ...base.memberRetention,
          [PLAYER_TEAM_ID]: {
            ...retention,
            memberJoinedOnDay: {
              ...retention.memberJoinedOnDay,
              [companion2]: (worldDay - 200) as WorldDay,
            },
          },
        },
      };
      // 記錄每名成員擲骰時看到的 cursor（皆回留隊，只驗游標串接，不擾動狀態）。
      const seen: number[] = [];
      const ctx = makeContext({
        worldDay,
        rngContext: {
          worldSeed: 'seed-test' as Seed,
          streamId: 'rng:test:departure' as RngStreamId,
          cursor: 0 as RngCursor,
        },
        resolvers: stubResolverPort({
          resolveMemberDeparture: ({ rngContext }) => {
            seen.push(rngContext?.cursor ?? -1);
            return rngStepBool(false, rngContext);
          },
        }),
      });
      ok(handleBeginCityFreePeriod(s0, ctx));
      assert(seen.length === 2, `兩名合格成員各擲一次，實得 ${seen.length}`);
      assert(seen[0] === 0 && seen[1] === 1, `游標須逐名串接 [0,1]，實得 [${seen.join(',')}]`);
      assert(seen[0] !== seen[1], '兩名成員不得共用同一 cursor（否則同機率恆得相同結果）');
    },
  },
  {
    name: 'begin city free without departures keeps members and creates cityFree plan',
    run: () => {
      const s0 = fixtureTeamState();
      const ctx = makeContext();
      const r = ok(handleBeginCityFreePeriod(s0, ctx));
      const player = r.result.nextSlice.teams[PLAYER_TEAM_ID]!;
      assert(player.memberIds.length === 2, 'both members retained');
      const plan = r.result.nextSlice.plans[player.activePlanId as never];
      assert(plan !== undefined && plan.kind === 'cityFree', 'cityFree plan active');
    },
  },
  {
    name: 'succession: selecting eligible successor sets new leader and emits PlayerSuccessorSelected',
    run: () => {
      const base = fixtureTeamState();
      const state = {
        ...base,
        pendingSuccession: {
          interactionId: 'int-1' as never,
          formerLeaderId: PLAYER_LEADER_ID,
          eligibleSuccessorIds: [PLAYER_MEMBER_ID],
          openedOnDay: 20000 as WorldDay,
          reason: 'death' as const,
          revision: 0 as Revision,
        },
      } as TeamState;
      const ctx = makeContext();
      const r = ok(handleSelectPlayerSuccessor(state, { type: 'selectPlayerSuccessor', interactionId: 'int-1' as never, successorId: PLAYER_MEMBER_ID }, ctx));
      const player = r.result.nextSlice.teams[PLAYER_TEAM_ID]!;
      assert(player.leaderId === PLAYER_MEMBER_ID, 'leader replaced');
      assert(r.result.nextSlice.pendingSuccession === undefined, 'pending cleared');
      assert(eventTypes(r.result.outgoingMessages).includes('PlayerSuccessorSelected'), 'emits PlayerSuccessorSelected');
    },
  },
  {
    name: 'succession: ineligible successor rejected, leader unchanged',
    run: () => {
      const base = fixtureTeamState();
      const state = {
        ...base,
        pendingSuccession: {
          interactionId: 'int-1' as never,
          formerLeaderId: PLAYER_LEADER_ID,
          eligibleSuccessorIds: [PLAYER_MEMBER_ID],
          openedOnDay: 20000 as WorldDay,
          reason: 'death' as const,
          revision: 0 as Revision,
        },
      } as TeamState;
      const ctx = makeContext();
      const r = handleSelectPlayerSuccessor(state, { type: 'selectPlayerSuccessor', interactionId: 'int-1' as never, successorId: NPC_LEADER_ID }, ctx);
      assert(!r.ok && r.rejection.code === 'team/ineligible-successor', `ineligible rejected (got ${r.ok ? 'ok' : r.rejection.code})`);
    },
  },
  {
    name: 'stale teamPlanDue job (revision mismatch) is safely skipped',
    run: () => {
      const worldDay = 20000 as WorldDay;
      const s0 = fixtureTeamState(worldDay);
      const ctx = makeContext({ worldDay });
      const r = ok(handleStartCityTravel(s0, { type: 'startCityTravel', toCityId: CITY_B, routeId: ROUTE_AB, modeId: TRAVEL_MODE_3 }, ctx));
      const job = materializeJob(r.result.scheduledJobs[0], 1); // expectedRevision 0
      // 人為推進 plan.revision，使排定 Job 失配。
      const planId = job.payload.planId;
      const bumped = {
        ...r.result.nextSlice,
        plans: {
          ...r.result.nextSlice.plans,
          [planId]: { ...r.result.nextSlice.plans[planId]!, revision: 5 as Revision },
        },
      } as TeamState;
      const out = handleTeamPlanDueJob(bumped, job, ctx);
      assert(out.outgoingMessages.length === 0, 'stale job emits nothing');
      assert(out.nextSlice === bumped, 'stale job returns unchanged slice reference');
    },
  },
  {
    name: 'enterAdventureMap then arrival emits TeamLocationChanged(adventureMap); returnToCity restores city',
    run: () => {
      const worldDay = 20000 as WorldDay;
      const s0 = fixtureTeamState(worldDay);
      const ctx = makeContext({ worldDay });
      const enter = ok(handleEnterAdventureMap(s0, { type: 'enterAdventureMap', adventureSiteId: 'site-1' as never }, ctx));
      const job = materializeJob(enter.result.scheduledJobs[0], 1);
      const ctx2 = makeContext({ worldDay: job.dueDay });
      const arrived = handleTeamPlanDueJob(enter.result.nextSlice, job, ctx2);
      const loc = findEvent<{ to: { kind: string } }>(arrived.outgoingMessages, 'TeamLocationChanged');
      assert(loc !== undefined && loc.to.kind === 'adventureMap', 'arrival is adventureMap');
      const team = arrived.nextSlice.teams[PLAYER_TEAM_ID]!;
      assert(team.location.kind === 'adventureMap', 'team now on adventure map');

      // return to city.
      const ret = ok(handleReturnToCity(arrived.nextSlice, { type: 'returnToCity', teamId: PLAYER_TEAM_ID }, ctx2));
      const rjob = materializeJob(ret.result.scheduledJobs[0], 2);
      const back = handleTeamPlanDueJob(ret.result.nextSlice, rjob, makeContext({ worldDay: rjob.dueDay }));
      const backTeam = back.nextSlice.teams[PLAYER_TEAM_ID]!;
      assert(backTeam.location.kind === 'city', 'returned to a city');
    },
  },
  {
    name: 'queries: player-controlled character = player team leaderId; presence reflects adventureMap',
    run: () => {
      const s0 = fixtureTeamState();
      const q = createTeamQuery(s0);
      assert(q.getPlayerControlledCharacterId() === PLAYER_LEADER_ID, 'controlled = leader');
      assert(q.getPlayerTeamId() === PLAYER_TEAM_ID, 'player team id');
      assert(q.listTeamsAtCity(CITY_A).length === 2, 'two teams at CITY_A');
      const presence = createTeamPresenceQuery(s0);
      assert(presence.countTeamsInside('map-x' as never) === 0, 'no teams inside empty map');
    },
  },
];

export type TeamTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestResults(): readonly TeamTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return { name: c.name, passed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

// runTests()：逐案執行，任一失敗即 throw（彙整全部失敗訊息）。
export function runTests(): void {
  const results = runTestResults();
  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    const lines = failures.map((f) => `  ✗ ${f.name}: ${f.error ?? 'failed'}`);
    throw new Error(`team module: ${failures.length}/${results.length} test(s) failed\n${lines.join('\n')}`);
  }
}
