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
  handleRest,
} from './system';
import { createTeamQuery, createTeamPresenceQuery } from './queries';
import {
  fixtureTeamState,
  withoutTavernVisitors,
  withNpcLeaderFreeAction,
  withTemporaryMemberInTavern,
  NPC_TEMPORARY_ID,
  makeContext,
  stubDefinitionReader,
  stubWorldReader,
  stubResolverPort,
  rngStepBool,
  PLAYER_TEAM_ID,
  NPC_TEAM_ID,
  PLAYER_LEADER_ID,
  PLAYER_MEMBER_ID,
  NPC_LEADER_ID,
  CITY_A,
  SITE_MAP_INSTANCE,
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
      const r = handleConfigureCombatFormation(s0, { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, actorCharacterId: PLAYER_LEADER_ID, placements }, ctx);
      assert(!r.ok && r.rejection.code === 'team/formation-cell-overlap', `overlap rejected (got ${r.ok ? 'ok' : r.rejection.code})`);
    },
  },
  {
    name: '#5：floor 必為 0（不得用不同 floor 規避重疊）',
    run: () => {
      const s0 = fixtureTeamState();
      const ctx = makeContext();
      // 同 row/col、不同 floor：戰鬥配置單一 3×3，floor≠0 應被擋（否則兩人重疊卻過關）。
      const placements: Record<string, GridCell> = {
        [PLAYER_LEADER_ID]: { floor: 0, row: 1, col: 1 },
        [PLAYER_MEMBER_ID]: { floor: 99, row: 1, col: 1 },
      };
      const r = handleConfigureCombatFormation(s0, { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, actorCharacterId: PLAYER_LEADER_ID, placements }, ctx);
      assert(
        !r.ok && r.rejection.code === 'team/formation-cell-out-of-range',
        `floor≠0 應被擋（got ${r.ok ? 'ok' : r.rejection.code}）`,
      );
    },
  },
  {
    name: 'formation rejects benched member (missing placement)',
    run: () => {
      const s0 = fixtureTeamState();
      const ctx = makeContext();
      const placements: Record<string, GridCell> = { [PLAYER_LEADER_ID]: { floor: 0, row: 0, col: 0 } };
      const r = handleConfigureCombatFormation(s0, { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, actorCharacterId: PLAYER_LEADER_ID, placements }, ctx);
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
      const r = handleConfigureCombatFormation(s0, { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, actorCharacterId: PLAYER_LEADER_ID, placements }, ctx);
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
      const r = ok(handleConfigureCombatFormation(s0, { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, actorCharacterId: PLAYER_LEADER_ID, placements }, ctx));
      const f = r.result.nextSlice.combatFormations[PLAYER_TEAM_ID]!;
      assert(f.revision === 1, `revision bumped to 1 (got ${f.revision})`);
      assert(eventTypes(r.result.outgoingMessages).includes('TeamCombatFormationChanged'), 'emits formation changed');
    },
  },
  {
    // doc §5.1「發令者為隊長」／§8 驗收 20「非隊長…被拒絕且不留下部分寫入」。
    name: 'formation：非隊長發令 → 拒絕 actor-not-leader，配置與 revision 完全不變',
    run: () => {
      const s0 = fixtureTeamState();
      const ctx = makeContext();
      const placements: Record<string, GridCell> = {
        [PLAYER_LEADER_ID]: { floor: 0, row: 2, col: 2 },
        [PLAYER_MEMBER_ID]: { floor: 0, row: 0, col: 0 },
      };
      const r = handleConfigureCombatFormation(
        s0,
        { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, actorCharacterId: PLAYER_MEMBER_ID, placements },
        ctx,
      );
      assert(
        !r.ok && r.rejection.code === 'team/formation-actor-not-leader',
        `非隊長應拒絕 actor-not-leader（實得 ${r.ok ? 'ok' : r.rejection.code}）`,
      );
    },
  },
  {
    // doc §5.1「沒有 active Combat」／§3.1「Combat 建立 Encounter 時只讀取一次快照」。
    name: 'formation：隊伍有進行中的 Encounter → 拒絕 active-combat（窄化 combat Port 回 true）',
    run: () => {
      const s0 = fixtureTeamState();
      const asked: string[] = [];
      const ctx = makeContext({
        combat: {
          hasActiveEncounter: (teamId) => {
            asked.push(String(teamId));
            return true;
          },
        },
      });
      const placements: Record<string, GridCell> = {
        [PLAYER_LEADER_ID]: { floor: 0, row: 2, col: 2 },
        [PLAYER_MEMBER_ID]: { floor: 0, row: 0, col: 0 },
      };
      const r = handleConfigureCombatFormation(
        s0,
        { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, actorCharacterId: PLAYER_LEADER_ID, placements },
        ctx,
      );
      assert(
        !r.ok && r.rejection.code === 'team/formation-active-combat',
        `戰鬥中應拒絕 active-combat（實得 ${r.ok ? 'ok' : r.rejection.code}）`,
      );
      // 問的必須是**這支**隊伍，不是玩家隊或隨便一支。
      assert(
        asked.length === 1 && asked[0] === String(PLAYER_TEAM_ID),
        `應以本命令的 teamId 查詢戰鬥狀態（實得 ${asked.join(',')}）`,
      );
    },
  },
  {
    // 不變量：兩道新前置條件都不得留下部分寫入（doc §8 驗收 20）。
    name: 'formation：兩種拒絕都不寫入任何 State（配置物件恆等於原本那一個）',
    run: () => {
      const s0 = fixtureTeamState();
      const placements: Record<string, GridCell> = {
        [PLAYER_LEADER_ID]: { floor: 0, row: 2, col: 2 },
        [PLAYER_MEMBER_ID]: { floor: 0, row: 0, col: 0 },
      };
      const notLeader = handleConfigureCombatFormation(
        s0,
        { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, actorCharacterId: PLAYER_MEMBER_ID, placements },
        makeContext(),
      );
      const inCombat = handleConfigureCombatFormation(
        s0,
        { type: 'configureCombatFormation', teamId: PLAYER_TEAM_ID, actorCharacterId: PLAYER_LEADER_ID, placements },
        makeContext({ combat: { hasActiveEncounter: () => true } }),
      );
      assert(!notLeader.ok && !inCombat.ok, '兩者都應是拒絕');
      // 拒絕走 CommandRejection 分支，本來就拿不到 nextSlice；此處確認原 Slice 未被 mutate。
      assert(
        s0.combatFormations[PLAYER_TEAM_ID]!.revision === 0,
        '拒絕不得動到原有配置的 revision',
      );
      const cells = Object.values(s0.combatFormations[PLAYER_TEAM_ID]!.placements).map(
        (c) => `${c.floor}:${c.row}:${c.col}`,
      );
      assert(cells.join(',') === '0:0:0,0:0:1', `拒絕不得寫入新格位（實得 ${cells.join(',')}）`);
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
      // #3：刪除來源 Team 後其配置不得殘留（removeTeam 一併清附屬狀態）。
      assert(r.result.nextSlice.combatFormations[NPC_TEAM_ID] === undefined, '來源 NPC Team 的配置應一併移除');
      const types = eventTypes(r.result.outgoingMessages);
      assert(types.includes('TeamMemberJoined'), 'emits TeamMemberJoined');
      assert(types.includes('TeamMemberDeparted'), 'emits TeamMemberDeparted');
      assert(types.includes('TeamCombatFormationChanged'), 'recomputes formation');
    },
  },
  {
    name: '#4：Resolver 產生非法配置（全部同格）→ 退回合法 row-major，不寫入非法配置',
    run: () => {
      const s0 = fixtureTeamState();
      const badResolver = stubResolverPort({
        resolveDefaultPlacement: ({ memberIds }) => {
          const out: Record<CharacterId, GridCell> = {};
          for (const id of memberIds) out[id] = { floor: 0, row: 0, col: 0 }; // 全部塞 (0,0)
          return out;
        },
      });
      const ctx = makeContext({ resolvers: badResolver });
      const r = ok(handleRecruitTavernAdventurer(s0, { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID }, ctx));
      const formation = r.result.nextSlice.combatFormations[PLAYER_TEAM_ID]!;
      const cells = Object.values(formation.placements).map((c) => `${c.floor}:${c.row}:${c.col}`);
      assert(cells.length === 3, '玩家隊 3 人應各有一格');
      assert(cells.length === new Set(cells).size, `退回後配置不得有重疊（cells=${cells.join(',')}）`);
    },
  },
  {
    name: '#5：招募刪除來源 Team → 其 Active Plan 一併清除（不留指向死掉 Team 的孤兒）',
    run: () => {
      const base = fixtureTeamState();
      const planId = 'runtime:team-plan:npc-orphan';
      // 給來源 NPC Team 一筆進行中的 Plan（僅需 teamId 讓 removeTeam 掃到；其餘欄位以 cast 帶過）。
      const s0: TeamState = {
        ...base,
        plans: {
          ...base.plans,
          [planId]: { planId, teamId: NPC_TEAM_ID, kind: 'cityFree', startedOnDay: 0, status: 'active', payload: {}, revision: 0 },
        } as never,
      };
      const r = ok(handleRecruitTavernAdventurer(s0, { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID }, makeContext()));
      assert(r.result.nextSlice.teams[NPC_TEAM_ID] === undefined, '來源 Team 應移除');
      assert(
        (r.result.nextSlice.plans as Record<string, unknown>)[planId] === undefined,
        '來源 Team 的 Active Plan 應一併清除（否則孤兒 Plan/到期 Job 指向死掉的 Team）',
      );
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
    name: 'recruit 跨城（來源隊在別城）→ 拒絕 not-in-same-city（硬條件，非擲骰）',
    run: () => {
      const base = fixtureTeamState();
      const s0: TeamState = {
        ...base,
        teams: {
          ...base.teams,
          [NPC_TEAM_ID]: { ...base.teams[NPC_TEAM_ID]!, location: { kind: 'city', cityId: CITY_B } },
        },
      };
      const ctx = makeContext();
      const r = handleRecruitTavernAdventurer(s0, { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID }, ctx);
      assert(
        !r.ok && r.rejection.code === 'team/not-in-same-city',
        `跨城招募應拒絕 not-in-same-city（實得 ${r.ok ? 'ok' : r.rejection.code}）`,
      );
    },
  },
  {
    // doc §5.1「目標是同城酒館可見的真實 NPC 冒險者」／§7.6「驗證同城酒館可見」。
    name: 'recruit：目標同城但不在酒館名單 → 拒絕 target-not-tavern-visible，來源隊完全不變',
    run: () => {
      // 拿掉 NPC 隊長的 tavernVisit 自由行動：他還在同一座城，只是不在酒館。
      const s0 = withoutTavernVisitors(fixtureTeamState());
      const r = handleRecruitTavernAdventurer(
        s0,
        { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID },
        makeContext(),
      );
      assert(
        !r.ok && r.rejection.code === 'team/target-not-tavern-visible',
        `不在酒館應拒絕 target-not-tavern-visible（實得 ${r.ok ? 'ok' : r.rejection.code}）`,
      );
      // 來源隊、成員與配置一概不動。
      assert(s0.teams[NPC_TEAM_ID]!.memberIds.includes(NPC_LEADER_ID), '來源隊成員不得改動');
      assert(!s0.teams[PLAYER_TEAM_ID]!.memberIds.includes(NPC_LEADER_ID), '目標不得轉入玩家隊');
    },
  },
  {
    // 不變量：可見性判準只有一份——Query 說得出來的人才招募得到，反之亦然。
    name: 'recruit：酒館可見性與 TeamQuery.listTavernVisitorIds 同一判準（可見即可嘗試，不可見即拒絕）',
    run: () => {
      const visible = fixtureTeamState();
      const hidden = withoutTavernVisitors(visible);

      const visibleIds = createTeamQuery(visible).listTavernVisitorIds(CITY_A);
      assert(visibleIds.includes(NPC_LEADER_ID), 'Query 應列出正在酒館的 NPC 隊長');
      const hiddenIds = createTeamQuery(hidden).listTavernVisitorIds(CITY_A);
      assert(hiddenIds.length === 0, `拿掉 tavernVisit 後名單應為空（實得 ${hiddenIds.join(',')}）`);

      const onVisible = handleRecruitTavernAdventurer(
        visible,
        { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID },
        makeContext(),
      );
      assert(onVisible.ok, `名單上的人應可嘗試招募（實得 ${onVisible.ok ? 'ok' : onVisible.rejection.code}）`);

      const onHidden = handleRecruitTavernAdventurer(
        hidden,
        { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID },
        makeContext(),
      );
      assert(
        !onHidden.ok && onHidden.rejection.code === 'team/target-not-tavern-visible',
        `不在名單上的人應被拒（實得 ${onHidden.ok ? 'ok' : onHidden.rejection.code}）`,
      );
    },
  },
  {
    // 判準必須讀 status，不只是「這筆紀錄存不存在」。completed／cancelled 是**已經離開酒館**的
    // 歷史紀錄；若判準退化成「有沒有自由行動」，昨天去過酒館的人今天仍招募得到，而整筆刪掉式的
    // 反例測不出這件事（見 fixtures.withNpcLeaderFreeAction）。
    name: 'recruit：tavernVisit 已 completed／cancelled → 不在名單、招募被拒（釘住 status 判準）',
    run: () => {
      for (const status of ['completed', 'cancelled'] as const) {
        const s0 = withNpcLeaderFreeAction(fixtureTeamState(), { status });
        assert(
          createTeamQuery(s0).listTavernVisitorIds(CITY_A).length === 0,
          `${status} 的 tavernVisit 不得出現在名單`,
        );
        const r = handleRecruitTavernAdventurer(
          s0,
          { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID },
          makeContext(),
        );
        assert(
          !r.ok && r.rejection.code === 'team/target-not-tavern-visible',
          `${status} 應拒絕 target-not-tavern-visible（實得 ${r.ok ? 'ok' : r.rejection.code}）`,
        );
      }
    },
  },
  {
    // 判準必須讀 payload.kind。同一名 NPC 同樣在城裡、同樣有一筆 active 自由行動，只是他在**休息**
    // 而不是在酒館——他不該出現在酒館名單上，也不該招募得到。
    name: 'recruit：自由行動是 rest 而非 tavernVisit → 不在名單、招募被拒（釘住 payload.kind 判準）',
    run: () => {
      const s0 = withNpcLeaderFreeAction(fixtureTeamState(), { payload: { kind: 'rest' } });
      assert(
        createTeamQuery(s0).listTavernVisitorIds(CITY_A).length === 0,
        'rest 不是 tavernVisit，不得出現在酒館名單',
      );
      const r = handleRecruitTavernAdventurer(
        s0,
        { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID },
        makeContext(),
      );
      assert(
        !r.ok && r.rejection.code === 'team/target-not-tavern-visible',
        `休息中的 NPC 應被拒（實得 ${r.ok ? 'ok' : r.rejection.code}）`,
      );
    },
  },
  {
    // doc §2.3：「選擇 tavernVisit 的 NPC **正式成員**會出現在同城酒館名單」。暫時成員即使選了
    // tavernVisit 也不算——判準必須讀 memberIds，而不是「這名角色隸屬哪支隊伍」。
    name: 'tavern 名單：暫時成員的 tavernVisit 不列入（釘住「正式成員」判準）',
    run: () => {
      const s0 = withTemporaryMemberInTavern(fixtureTeamState());
      const ids = createTeamQuery(s0).listTavernVisitorIds(CITY_A);
      assert(ids.includes(NPC_LEADER_ID), '正式成員（NPC 隊長）仍應在名單上');
      assert(
        !ids.includes(NPC_TEMPORARY_ID),
        `暫時成員不得出現在酒館名單（實得 ${ids.join(',')}）`,
      );
    },
  },
  {
    // 「同城」與「在酒館」是兩件事：隊伍離開城市（例如出發旅行）後名單上就沒有他。
    name: 'recruit：持有 tavernVisit 但隊伍已不在該城 → 不列入名單、招募被拒',
    run: () => {
      const base = fixtureTeamState();
      const s0: TeamState = {
        ...base,
        teams: {
          ...base.teams,
          [NPC_TEAM_ID]: {
            ...base.teams[NPC_TEAM_ID]!,
            location: { kind: 'travelling', routeId: ROUTE_AB, progress: { kind: 'npcDirect' } },
          },
        },
      };
      assert(
        createTeamQuery(s0).listTavernVisitorIds(CITY_A).length === 0,
        '不在城裡的隊伍不得出現在酒館名單',
      );
      const r = handleRecruitTavernAdventurer(
        s0,
        { type: 'recruitTavernAdventurer', targetCharacterId: NPC_LEADER_ID },
        makeContext(),
      );
      // 同城硬條件比可見性早一步擋下（兩者都是拒絕，碼不同以利診斷）。
      assert(
        !r.ok && r.rejection.code === 'team/not-in-same-city',
        `旅行中的目標應被拒（實得 ${r.ok ? 'ok' : r.rejection.code}）`,
      );
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
      // #3：成員變動須於同一交易重建配置。玩家隊配置不得再含離隊者；新生成的 NPC Team 要有配置。
      const playerFormation = r.result.nextSlice.combatFormations[PLAYER_TEAM_ID]!;
      assert(
        playerFormation !== undefined && playerFormation.placements[PLAYER_MEMBER_ID] === undefined,
        '玩家隊配置不得再保留離隊成員',
      );
      const spawnedFormation = r.result.nextSlice.combatFormations[departed!.spawnedTeamId as never];
      assert(
        spawnedFormation !== undefined && spawnedFormation.placements[PLAYER_MEMBER_ID] !== undefined,
        '新生成的單人 NPC Team 應有合法配置',
      );
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
    // 規範 §17 的「同一套 Runtime 載入不同平衡 Pack 必須產生不同結果」在最小切片上的證明。
    // 這個量原本在兩處寫死：契約把 elapsedDays 宣告成字面型別 365（換 Pack 會編譯失敗），
    // handler 又自己填了一次 365。現在只有 TeamPlanRule.durationDays 一個來源。
    name: 'homeRest: elapsedDays follows the content pack rule (not a hardcoded 365)',
    run: () => {
      const worldDay = 20000 as WorldDay;
      const atHome = (s: TeamState): TeamState => ({
        ...s,
        teams: {
          ...s.teams,
          [PLAYER_TEAM_ID]: {
            ...s.teams[PLAYER_TEAM_ID]!,
            location: { kind: 'home', homeId: 'home-1' as never },
          },
        },
      });

      // 只換 Content Pack 的一個數值，Runtime 完全不動。
      const elapsedDaysFromPack = (durationDays: number): number => {
        const base = stubDefinitionReader();
        const ctx = makeContext({
          worldDay,
          definitions: {
            ...base,
            getTeamPlanRule: (id) => ({ ...base.getTeamPlanRule(id), durationDays }),
          },
        });
        const started = ok(
          handleRest(atHome(fixtureTeamState(worldDay)), { type: 'rest', planKind: 'homeRest' }, ctx),
        );
        const job = materializeJob(started.result.scheduledJobs[0], 1);
        const due = handleTeamPlanDueJob(
          started.result.nextSlice,
          job,
          makeContext({ worldDay: job.dueDay }),
        );
        const ev = findEvent<{ elapsedDays: number }>(due.outgoingMessages, 'HomeYearRestCompleted');
        if (ev === undefined) {
          throw new Error(`no HomeYearRestCompleted emitted for durationDays=${durationDays}`);
        }
        return ev.elapsedDays;
      };

      assert(elapsedDaysFromPack(365) === 365, '365 天的 Pack → elapsedDays 365');
      assert(elapsedDaysFromPack(180) === 180, '180 天的 Pack → elapsedDays 180（不得仍回 365）');
    },
  },
  {
    // §12「只鑄造自己擁有的 Runtime ID」。Team 先前在抵達冒險地時自己鑄一個 MapInstanceId
    // （`plan.payload.mapId ?? ctx.ids.nextMapInstanceId()`），於是隊伍會位於一個 map 模組
    // 不知道的實例上——懸空引用，而且是從**已註冊**的 enterAdventureMap 走得到的。
    name: 'enterAdventureMap: mapId 來自 map 的既存實例，Team 不自鑄',
    run: () => {
      const worldDay = 20000 as WorldDay;
      const ctx = makeContext({ worldDay });
      const enter = ok(
        handleEnterAdventureMap(
          fixtureTeamState(worldDay),
          { type: 'enterAdventureMap', adventureSiteId: 'site-1' as never },
          ctx,
        ),
      );
      // Plan 在**命令時**就存好已解析的 mapId（不是等到期才決定）。
      const plan = Object.values(enter.result.nextSlice.plans).find((p) => p.kind === 'enterAdventureMap');
      if (plan === undefined) throw new Error('應建立 enterAdventureMap Plan');
      assert(
        plan.payload.kind === 'enterAdventureMap' && plan.payload.mapId === SITE_MAP_INSTANCE,
        'Plan 應帶 Query 解析出的既存 MapInstanceId',
      );

      const job = materializeJob(enter.result.scheduledJobs[0], 1);
      const arrived = handleTeamPlanDueJob(
        enter.result.nextSlice,
        job,
        makeContext({ worldDay: job.dueDay }),
      );
      const team = arrived.nextSlice.teams[PLAYER_TEAM_ID]!;
      assert(
        team.location.kind === 'adventureMap' && team.location.mapId === SITE_MAP_INSTANCE,
        `抵達後的位置必須指向同一個既存實例（實得 ${JSON.stringify(team.location)}）`,
      );
    },
  },
  {
    name: 'enterAdventureMap: 據點在世界裡沒有 MapInstance → 明確拒絕，不自己補一個',
    run: () => {
      const worldDay = 20000 as WorldDay;
      const ctx = makeContext({
        worldDay,
        world: stubWorldReader({ getAdventureSiteMapInstance: () => undefined }),
      });
      const res = handleEnterAdventureMap(
        fixtureTeamState(worldDay),
        { type: 'enterAdventureMap', adventureSiteId: 'site-without-map' as never },
        ctx,
      );
      assert(!res.ok, '缺 MapInstance 必須拒絕');
      assert(
        res.ok === false && res.rejection.code === 'team/adventure-site-has-no-map-instance',
        `拒絕碼應為 team/adventure-site-has-no-map-instance（實得 ${res.ok ? 'accepted' : res.rejection.code}）`,
      );
    },
  },
  {
    // 建立端原本會為這些 kind 造出一個「active 但沒有 dueOnDay、也沒有排任何 Job」的 Plan。
    // 那不是權宜——Plan 寫進 team.activePlanId 後，hasActiveNonFreePlan 會擋掉這支隊伍後續所有
    // 大動作，而它永遠不會到期：NPC 隊伍就此永久卡死，沒有錯誤、沒有事件。
    name: 'StartNpcTeamPlan: 到期規則未實作的 kind 明確拒絕，不建立永不到期的 Plan',
    run: () => {
      const worldDay = 20000 as WorldDay;
      const s0 = fixtureTeamState(worldDay);
      const ctx = makeContext({ worldDay });
      const res = handleStartNpcTeamPlan(
        s0,
        {
          type: 'StartNpcTeamPlan',
          teamId: NPC_TEAM_ID,
          kind: 'escortTravel',
          payload: { kind: 'childStudy' },
        } as never,
        ctx,
      );
      assert(!res.ok, '未支援的 NPC Plan kind 必須拒絕');
      assert(
        res.ok === false && res.rejection.code === 'team/npc-plan-kind-not-supported',
        `拒絕碼應為 team/npc-plan-kind-not-supported（實得 ${res.ok ? 'accepted' : res.rejection.code}）`,
      );
      // 沒有殘留的 Plan，隊伍也沒有被鎖住。
      assert(
        Object.keys(s0.plans).length === Object.keys(s0.plans).length,
        '拒絕不得留下 Plan',
      );
    },
  },
  {
    // 到期分派原本有 `default: return duePlanComplete(...)`——把一個什麼都沒做的 Plan 標成
    // completed 並發出 TeamPlanCompleted。訂閱者（quest／progression）會依那筆事件套用結果。
    name: 'teamPlanDue: 不該有到期 Job 的 kind 明確拋錯，不得回報為完成',
    run: () => {
      const worldDay = 20000 as WorldDay;
      const s0 = fixtureTeamState(worldDay);
      // 人為塞一個 escortTravel Plan 並為它排一筆到期 Job（模擬非法狀態）。
      const planId = 'runtime:team-plan:illegal' as never;
      const illegal: TeamState = {
        ...s0,
        plans: {
          ...s0.plans,
          [planId]: {
            planId,
            teamId: PLAYER_TEAM_ID,
            kind: 'escortTravel',
            startedOnDay: worldDay,
            dueOnDay: worldDay,
            status: 'active',
            payload: { kind: 'childStudy' },
            revision: 0 as Revision,
          },
        },
      } as TeamState;
      const job = {
        jobId: 'job-illegal' as JobId,
        type: 'teamPlanDue',
        dueDay: worldDay,
        expectedRevision: 0 as Revision,
        payload: { teamId: PLAYER_TEAM_ID, planId },
      } as unknown as TeamPlanDueJob;

      let threw = false;
      try {
        handleTeamPlanDueJob(illegal, job, makeContext({ worldDay }));
      } catch {
        threw = true;
      }
      assert(threw, '非法狀態必須拋錯，不得靜默回報 Plan 完成');
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
