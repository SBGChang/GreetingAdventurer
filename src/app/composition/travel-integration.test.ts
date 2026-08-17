// app/composition/travel-integration.test.ts
// 端到端證明玩家旅行**真的通**（回應複審 R3 #2）:不再由測試手動扮演旅行事件 Workflow，而是讓引擎
// 自己驅動——每個 teamPlanDue 交易裡,dueCityTravel 發 TravelSegmentReached → composition 的
// 旅行事件 Workflow 訂閱者送 CompletePlayerTravelSegmentWithoutEvent → team 推進下一段。整條只靠
// 反覆 runDueJob(引擎),沒有任何一行手動 CompleteSegment。
//
// 這驗證的是「整合接通」:manifest 的 workflow 訂閱 + kernel 的無 mutation 訂閱者 + router 的 workflow
// 分派,合起來讓旅行從「停在段落邊界」變成「自行推進至抵達」,而推進仍走可攔截的 Internal Command 路徑。

import type { JobId, WorldDay } from '../../contracts/core';
import { handleStartCityTravel, tryGetTeam, tryGetPlan, type TeamHandlerResult } from '../../modules/team/public';
import { fixtureTeamState, makeContext as teamMakeContext, stubDefinitionReader as teamStubReader, CITY_B, ROUTE_AB, TRAVEL_MODE_3 } from '../../modules/team/fixtures';

import { runDueJob, type ContextAssembler } from './session';
import { unusedContext } from '../../testing/composition/session-fixture';
import type { ModuleContexts } from './router';
import { createEmptyGameState, type GameScheduledJob, type GameState } from './state';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function okTeam(r: TeamHandlerResult): Extract<TeamHandlerResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok team result, got ${r.rejection.code}`);
  return r;
}

// team.definitions 提供旅行模式（dueCityTravel / handleCompleteSegment 需要）；其餘不觸及。
const assembler: ContextAssembler = (runtime): ModuleContexts => ({
  team: {
    worldDay: runtime.worldDay,
    ids: runtime.ids.team,
    definitions: teamStubReader(),
    world: unusedContext('team.world'),
    resolvers: unusedContext('team.resolvers'),
  },
  character: unusedContext('character'),
  inventory: unusedContext('inventory'),
  map: unusedContext('map'),
  dungeon: unusedContext('dungeon'),
  combat: unusedContext('combat'),
  progression: unusedContext('progression'),
});

// 起始:玩家隊在城,發 startCityTravel（team 模組直呼,建立旅行 Plan + 第一段 Job）。
function travelStartState(): { state: GameState; firstJobId: JobId } {
  const worldDay = 20000 as WorldDay;
  const teamCtx = teamMakeContext({ worldDay });
  const started = okTeam(
    handleStartCityTravel(
      fixtureTeamState(worldDay),
      { type: 'startCityTravel', toCityId: CITY_B, routeId: ROUTE_AB, modeId: TRAVEL_MODE_3 },
      teamCtx,
    ),
  );
  const firstJobId = 'runtime:job~travel~seg0' as JobId;
  const j0 = { ...(started.result.scheduledJobs[0] as object), jobId: firstJobId } as GameScheduledJob;

  const base = createEmptyGameState({
    worldSeed: 'travel-integration',
    startDay: worldDay,
    team: started.result.nextSlice,
  });
  const state: GameState = {
    ...base,
    core: {
      ...base.core,
      scheduler: { jobsById: { [firstJobId]: j0 }, revision: 1 as never },
    },
  };
  return { state, firstJobId };
}

export type TravelIntegrationTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: '一段推進:runDueJob(段0) → Workflow 送 CompleteSegment → 隊伍進到段1,段1 Job 已排,段0 已消耗',
    run: () => {
      const { state } = travelStartState();
      const job = Object.values(state.core.scheduler.jobsById)[0]!;
      // 世界時鐘推進到該 Job 到期日再執行（真實引擎快轉就是這樣；runDueJob 會擋未到期，見 #2）。
      const dueState = { ...state, core: { ...state.core, worldDay: job.dueDay } };
      const result = runDueJob(dueState, job, assembler);
      assert(result.accepted, '段0 Job 交易應被接受');
      if (!result.accepted) return;

      const team = tryGetTeam(result.state.team, tryGetTeam(state.team, state.team.playerTeamId)!.teamId)!;
      assert(team.location.kind === 'travelling', '推進後仍在 travelling');
      if (team.location.kind === 'travelling' && team.location.progress.kind === 'playerSegments') {
        assert(team.location.progress.segmentIndex === 1, `應進到段1（實得 ${team.location.progress.segmentIndex}）`);
      }
      const jobs = Object.values(result.state.core.scheduler.jobsById);
      assert(jobs.length === 1 && jobs[0]!.type === 'teamPlanDue', '段0 消耗後應只剩段1的 teamPlanDue');
    },
  },
  {
    name: '整條旅行端到端:反覆 runDueJob 直到抵達（引擎自驅,無手動 CompleteSegment）',
    run: () => {
      let { state } = travelStartState();
      const playerTeamId = state.team.playerTeamId;
      let segmentReachedTx = 0;
      let guard = 0;

      while (Object.keys(state.core.scheduler.jobsById).length > 0) {
        guard += 1;
        if (guard > 8) throw new Error('travel did not terminate');
        const job = Object.values(state.core.scheduler.jobsById)[0]!;
        // 世界時鐘推進到 Job 到期日（引擎快轉語意）再執行。
        state = { ...state, core: { ...state.core, worldDay: job.dueDay } };
        const result = runDueJob(state, job, assembler);
        assert(result.accepted, '每個旅行 Job 交易都應被接受');
        if (!result.accepted) return;
        segmentReachedTx += 1;
        state = result.state;
      }

      // 三段 → 三個 due-job 交易；抵達後 Plan 完成、隊伍在 CITY_B、Scheduler 清空。
      assert(segmentReachedTx === 3, `應跑 3 個旅行 due-job 交易（實得 ${segmentReachedTx}）`);
      const team = tryGetTeam(state.team, playerTeamId)!;
      assert(team.location.kind === 'city', `抵達後應在城市（實得 ${team.location.kind}）`);
      if (team.location.kind === 'city') {
        assert(String(team.location.cityId) === String(CITY_B), '應抵達 CITY_B');
      }
      assert(team.activePlanId === undefined, '抵達後 activePlanId 應清空');
      const plan = Object.values(state.team.plans)[0];
      assert(plan !== undefined && plan!.status === 'completed', '旅行 Plan 應為 completed');
    },
  },
];

export function runTestResults(): readonly TravelIntegrationTestResult[] {
  return CASES.map((c) => {
    try {
      c.run();
      return { name: c.name, pass: true };
    } catch (e) {
      return { name: c.name, pass: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? ''}`).join('\n');
    throw new Error(`travel-integration tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
