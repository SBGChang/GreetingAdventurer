// app/composition/bootstrap.test.ts
// bring-up 切片端到端：createBringUpFixture 組出最小 GameState → 引擎 Session 跑一筆玩家命令 → 提交 →
// **執行到期 Job** → 同 seed + 同命令逐位元重播（golden）。全程只碰已實作模組（fixture 造 team+
// character+progression；`rest` 命令只動 team、零跨模組外送）。
//
// 這證明的是**引擎迴圈**（bootstrap→命令→§7.2 ID 配發→排程→執行 Job→提交→決定性重播），**不是**
// 完整可玩性——正式開局 Gate 與各模組玩法規則仍見 bootstrap.ts 檔首與各模組 backlog。
//
// 為什麼挑 `rest`（cityFacilityAction）：它只用 worldDay + team id allocator，鑄一個 TeamPlanId、排一個
// teamPlanDue Job、不外送任何 Internal Command；其到期 Job 也自足（duePlanComplete，只發無訂閱者的
// TeamPlanCompleted）。故整條鏈不依賴任何未實作模組或內容。

import type {
  CityId,
  GameCommandRequest,
  JobId,
  ModuleId,
  NpcDungeonRunId,
  TeamId,
} from '../../contracts/core';
import type { RestCommand } from '../../contracts/team';

import { createBringUpFixture, type BringUpFixtureInput } from './bring-up-bootstrap';
import { runGameCommand, runDueJob, type ContextAssembler } from '../../app/composition/session';
import { unusedContext } from './session-fixture';
import type { ModuleContexts } from '../../app/composition/router';
import type { GameCommand } from '../../app/composition/messages';
import type { GameScheduledJob, GameState } from '../../app/composition/state';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const INPUT: BringUpFixtureInput = {
  worldSeed: 'bootable-slice',
  startCityId: 'definition:city:home' as CityId,
};

// `rest` 與其到期 Job 都只需 team 的 worldDay + ids；其餘 team port 與其他模組 context 都不應被觸及。
const assembler: ContextAssembler = (runtime): ModuleContexts => ({
  team: {
    worldDay: runtime.worldDay,
    ids: runtime.ids.team,
    definitions: unusedContext('team.definitions'),
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

const restRequest = (actorTeamId: TeamId): GameCommandRequest<GameCommand> => ({
  actorTeamId,
  command: { type: 'rest', planKind: 'cityFacilityAction' } as RestCommand,
});

export type BootstrapTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'createBringUpFixture 組出最小合法 State：玩家隊在城、隊長就位+有成長檔、序號 = 2',
    run: () => {
      const g = createBringUpFixture(INPUT);
      const team = g.state.team.teams[g.playerTeamId];
      assert(team !== undefined, '應有玩家隊');
      assert(team!.control === 'player', '玩家隊 control 應為 player');
      assert(team!.leaderId === g.leaderId, 'leaderId 應為隊長');
      assert(team!.memberIds.length === 1 && team!.memberIds[0] === g.leaderId, '正式成員應只有隊長');
      assert(team!.location.kind === 'city', '開局應在城市');
      const leader = g.state.character.characters[g.leaderId];
      assert(leader !== undefined && leader!.lifeState === 'alive', '應有存活的隊長角色');
      assert(g.state.team.combatFormations[g.playerTeamId] !== undefined, '應有涵蓋隊長的戰鬥站位');
      assert(g.state.progression.characterProgress[g.leaderId] !== undefined, '隊長應有成長檔（非 undefined）');
      // bootstrap 鑄了 2 個 Runtime ID（隊長 + 隊伍）→ 序號落在 2。
      assert(
        (g.state.core.nextRuntimeSequence as unknown as number) === 2,
        `core.nextRuntimeSequence 應為 2（實得 ${g.state.core.nextRuntimeSequence}）`,
      );
    },
  },
  {
    name: '輸入驗證：空 seed / 負 startDay / birthDay 晚於 startDay 皆拋錯',
    run: () => {
      const threw = (fn: () => unknown): boolean => {
        try { fn(); return false; } catch { return true; }
      };
      assert(threw(() => createBringUpFixture({ ...INPUT, worldSeed: '' })), '空 seed 應拋錯');
      assert(threw(() => createBringUpFixture({ ...INPUT, startDay: -1 })), '負 startDay 應拋錯');
      assert(
        threw(() => createBringUpFixture({ ...INPUT, startDay: 10, leaderBirthDay: 20 })),
        'birthDay 晚於 startDay 應拋錯',
      );
    },
  },
  {
    name: 'Bootstrap 決定性：同輸入 → 逐位元相同的初始 State',
    run: () => {
      const a = createBringUpFixture(INPUT);
      const b = createBringUpFixture(INPUT);
      assert(JSON.stringify(a.state) === JSON.stringify(b.state), '同 seed 應得相同初始 State');
    },
  },
  {
    name: 'bring-up 切片：rest 命令建立 Plan + 排 teamPlanDue Job（零跨模組外送）',
    run: () => {
      const g = createBringUpFixture(INPUT);
      const result = runGameCommand(g.state, restRequest(g.playerTeamId), assembler);
      assert(result.accepted, `rest 應被接受（實得 ${result.accepted ? 'accepted' : 'rejected'}）`);
      if (!result.accepted) return;

      const team = result.state.team.teams[g.playerTeamId]!;
      assert(team.activePlanId !== undefined, 'rest 後玩家隊應有 activePlanId');
      const plan = result.state.team.plans[team.activePlanId!];
      assert(plan !== undefined && plan!.kind === 'cityFacilityAction', '應建立 cityFacilityAction Plan');

      const jobs = Object.values(result.state.core.scheduler.jobsById);
      assert(jobs.length === 1 && jobs[0]!.type === 'teamPlanDue', '應排 1 個 teamPlanDue Job');
    },
  },
  {
    name: '執行到期 teamPlanDue Job：Plan 完成 + Job 被 Scheduler 消耗（不再殘留，避免快轉重複取得）',
    run: () => {
      const g = createBringUpFixture(INPUT);
      const afterRest = runGameCommand(g.state, restRequest(g.playerTeamId), assembler);
      assert(afterRest.accepted, 'rest 應被接受');
      if (!afterRest.accepted) return;

      const job = Object.values(afterRest.state.core.scheduler.jobsById)[0];
      assert(job !== undefined && job.type === 'teamPlanDue', '應有一個 teamPlanDue Job 可執行');

      // 時間前進到 Job 到期日才可執行（runDueJob 以 job-not-due 擋未到期，見 #2）。
      const dueState: GameState = { ...afterRest.state, core: { ...afterRest.state.core, worldDay: job!.dueDay } };
      const afterJob = runDueJob(dueState, job!, assembler);
      assert(afterJob.accepted, 'Job 交易應被接受');
      if (!afterJob.accepted) return;

      // #1 修正：到期 Job 執行後被 Scheduler dequeue，不再殘留。
      assert(
        Object.keys(afterJob.state.core.scheduler.jobsById).length === 0,
        'teamPlanDue 執行後應從 Scheduler 移除（實得仍有殘留）',
      );
      const team = afterJob.state.team.teams[g.playerTeamId]!;
      assert(team.activePlanId === undefined, 'Plan 完成後 activePlanId 應清空');
      const plans = Object.values(afterJob.state.team.plans);
      assert(plans.length === 1 && plans[0]!.status === 'completed', 'Plan 應標記 completed');
    },
  },
  {
    name: '#1(R3)：過期 Job 經 runDueJob → 接受並 no-op，且被消耗（不因拒絕而違反回滾）',
    run: () => {
      const g = createBringUpFixture(INPUT);
      const jobId = 'runtime:job~npc~absent' as JobId;
      // dungeon slice 為空 → 這個 NPC Run 不存在 → npcDungeonDay 應「接受並 no-op」。
      const job = {
        type: 'npcDungeonDay',
        jobId,
        dueDay: g.state.core.worldDay,
        ownerModule: 'dungeon' as ModuleId,
        targetId: 'runtime:npc-dungeon-run:absent' as NpcDungeonRunId,
        payload: {},
      } as GameScheduledJob;
      // 把過期 Job 放進 Scheduler（模擬它是排定的到期工作）。
      const state: GameState = {
        ...g.state,
        core: { ...g.state.core, scheduler: { jobsById: { [jobId]: job }, revision: 1 as never } },
      };
      const result = runDueJob(state, job, assembler);
      assert(result.accepted, '過期 Job 應被接受並 no-op（不是拒絕）');
      if (!result.accepted) return;
      assert(
        Object.keys(result.state.core.scheduler.jobsById).length === 0,
        '過期 Job 於提交時應被消耗（dequeue）',
      );
    },
  },
  {
    name: '#1(R4)：已消耗的 Job 再次 runDueJob → 不開交易、拒絕、序號不變（不得重放結算）',
    run: () => {
      const g = createBringUpFixture(INPUT);
      const afterRest = runGameCommand(g.state, restRequest(g.playerTeamId), assembler);
      assert(afterRest.accepted, 'rest 應被接受');
      if (!afterRest.accepted) return;
      const job = Object.values(afterRest.state.core.scheduler.jobsById)[0]!;

      // 時間前進到到期日再執行（見 #2 job-not-due）。
      const dueState: GameState = { ...afterRest.state, core: { ...afterRest.state.core, worldDay: job.dueDay } };
      const afterJob = runDueJob(dueState, job, assembler);
      assert(afterJob.accepted, 'Job 首次執行應被接受並消耗');
      if (!afterJob.accepted) return;
      const seqAfter = afterJob.state.core.nextRuntimeSequence as unknown as number;

      // 拿同一筆（已被消耗的）Job 快照，對「消耗後」的狀態再跑一次。
      const replay = runDueJob(afterJob.state, job, assembler);
      assert(!replay.accepted, '已不在 Scheduler 的 Job 不得再次執行');
      if (replay.accepted) return;
      assert(
        replay.rejection.code === 'engine/job-not-scheduled',
        `拒絕碼應為 job-not-scheduled（實得 ${replay.rejection.code}）`,
      );
      assert(
        (replay.state.core.nextRuntimeSequence as unknown as number) === seqAfter,
        '重放被擋 → 不得推進 runtime 序號（根本未開交易）',
      );
      assert(replay.state === afterJob.state, '被擋時應原封回傳輸入狀態');
    },
  },
  {
    name: '#2(R5)：尚未到期的 Job 經 runDueJob → 不執行、拒絕 job-not-due、序號不變',
    run: () => {
      const g = createBringUpFixture(INPUT);
      const jobId = 'runtime:job~future' as JobId;
      const future = {
        type: 'npcDungeonDay',
        jobId,
        dueDay: (g.state.core.worldDay as unknown as number) + 1, // 明日到期
        ownerModule: 'dungeon' as ModuleId,
        targetId: 'runtime:npc-dungeon-run:x' as NpcDungeonRunId,
        payload: {},
      } as unknown as GameScheduledJob;
      const state: GameState = {
        ...g.state,
        core: { ...g.state.core, scheduler: { jobsById: { [jobId]: future }, revision: 1 as never } },
      };
      const seqBefore = state.core.nextRuntimeSequence as unknown as number;
      const result = runDueJob(state, future, assembler);
      assert(!result.accepted, '未到期 Job 不得執行');
      if (result.accepted) return;
      assert(
        result.rejection.code === 'engine/job-not-due',
        `拒絕碼應為 job-not-due（實得 ${result.rejection.code}）`,
      );
      assert(
        (result.state.core.nextRuntimeSequence as unknown as number) === seqBefore,
        '未到期被擋 → 不得推進 runtime 序號',
      );
    },
  },
  {
    name: '授權（#4）：以非玩家隊的 actorTeamId 下命令 → 拒絕，且不動任何 Slice',
    run: () => {
      const g = createBringUpFixture(INPUT);
      const intruder = 'runtime:team:intruder' as TeamId;
      const result = runGameCommand(g.state, restRequest(intruder), assembler);
      assert(!result.accepted, '非玩家隊的 actorTeamId 應被拒絕');
      if (result.accepted) return;
      assert(
        result.rejection.code.includes('actorNotPlayerTeam'),
        `拒絕碼應為授權失敗（實得 ${result.rejection.code}）`,
      );
      // 授權在 dispatch 前擋下 → 全回滾：不建立 Plan、序號不變。
      assert(result.state.team.teams[g.playerTeamId]!.activePlanId === undefined, '拒絕後不應建立 Plan');
      assert(
        (result.state.core.nextRuntimeSequence as unknown as number) === 2,
        '拒絕後序號應維持 bootstrap 值（§7.2）',
      );
    },
  },
  {
    name: 'Golden 重播：同 seed + 同命令 → 逐位元相同的提交 State',
    run: () => {
      const teamId = createBringUpFixture(INPUT).playerTeamId;
      const a = runGameCommand(createBringUpFixture(INPUT).state, restRequest(teamId), assembler);
      const b = runGameCommand(createBringUpFixture(INPUT).state, restRequest(teamId), assembler);
      assert(a.accepted && b.accepted, '兩次都應被接受');
      if (!a.accepted || !b.accepted) return;
      assert(JSON.stringify(a.state) === JSON.stringify(b.state), '兩次提交 State 應完全相同');
    },
  },
];

export function runTestResults(): readonly BootstrapTestResult[] {
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
    throw new Error(`bootstrap tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
