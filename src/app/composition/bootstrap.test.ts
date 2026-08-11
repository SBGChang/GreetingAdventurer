// app/composition/bootstrap.test.ts
// 第一個「開機骨架」端到端：NewGameBootstrapper 組出合法初始 GameState → 引擎 Session 跑一筆玩家命令
// → 提交 → 同 seed + 同命令逐位元重播（golden）。全程只碰已實作模組（bootstrap 造 team+character；
// `rest` 命令只動 team、零跨模組外送）。這就是驗收目標「基本可以玩的架構」的最小證明。
//
// 為什麼挑 `rest`（cityFacilityAction）：它只用 worldDay + team id allocator，鑄一個 TeamPlanId、排一個
// teamPlanDue Job、不外送任何 Internal Command——完整走過 bootstrap→命令→§7.2 ID 配發→排程→提交，
// 又不依賴任何尚未實作的模組或內容。

import type { CityId, GameCommandRequest } from '../../contracts/core';
import type { RestCommand } from '../../contracts/team';

import { createNewGame, type NewGameInput } from './bootstrap';
import { runGameCommand, type ContextAssembler } from './session';
import { unusedContext } from './session-fixture';
import type { ModuleContexts } from './router';
import type { GameCommand } from './messages';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const INPUT: NewGameInput = {
  worldSeed: 'bootable-slice',
  startCityId: 'definition:city:home' as CityId,
};

// `rest` 只需 team 的 worldDay + ids；其餘 team port 與其他模組 context 都不應被觸及。
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

const restRequest = (actorTeamId: NewGame['playerTeamId']): GameCommandRequest<GameCommand> => ({
  actorTeamId,
  command: { type: 'rest', planKind: 'cityFacilityAction' } as RestCommand,
});

type NewGame = ReturnType<typeof createNewGame>;

export type BootstrapTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'NewGameBootstrapper 組出合法初始 State：玩家隊在城、隊長就位、序號 = 2',
    run: () => {
      const g = createNewGame(INPUT);
      const team = g.state.team.teams[g.playerTeamId];
      assert(team !== undefined, '應有玩家隊');
      assert(team!.control === 'player', '玩家隊 control 應為 player');
      assert(team!.leaderId === g.leaderId, 'leaderId 應為隊長');
      assert(team!.memberIds.length === 1 && team!.memberIds[0] === g.leaderId, '正式成員應只有隊長');
      assert(team!.location.kind === 'city', '開局應在城市');
      const leader = g.state.character.characters[g.leaderId];
      assert(leader !== undefined && leader!.lifeState === 'alive', '應有存活的隊長角色');
      assert(g.state.team.combatFormations[g.playerTeamId] !== undefined, '應有涵蓋隊長的戰鬥站位');
      // bootstrap 鑄了 2 個 Runtime ID（隊長 + 隊伍）→ 序號落在 2。
      assert(
        (g.state.core.nextRuntimeSequence as unknown as number) === 2,
        `core.nextRuntimeSequence 應為 2（實得 ${g.state.core.nextRuntimeSequence}）`,
      );
    },
  },
  {
    name: 'Bootstrap 決定性：同輸入 → 逐位元相同的初始 State',
    run: () => {
      const a = createNewGame(INPUT);
      const b = createNewGame(INPUT);
      assert(JSON.stringify(a.state) === JSON.stringify(b.state), '同 seed 應得相同初始 State');
    },
  },
  {
    name: '開機切片：bootstrap → rest 命令 → 建立 Plan + 排 teamPlanDue Job（零跨模組外送）',
    run: () => {
      const g = createNewGame(INPUT);
      const result = runGameCommand(g.state, restRequest(g.playerTeamId), assembler);
      assert(result.accepted, `rest 應被接受（實得 ${result.accepted ? 'accepted' : 'rejected'}）`);
      if (!result.accepted) return;

      const team = result.state.team.teams[g.playerTeamId]!;
      assert(team.activePlanId !== undefined, 'rest 後玩家隊應有 activePlanId');
      const plan = result.state.team.plans[team.activePlanId!];
      assert(plan !== undefined && plan!.kind === 'cityFacilityAction', '應建立 cityFacilityAction Plan');

      const jobs = Object.values(result.state.core.scheduler.jobsById);
      assert(jobs.length === 1, `應排 1 個 Job（實得 ${jobs.length}）`);
      assert(jobs[0]!.type === 'teamPlanDue', `Job 應為 teamPlanDue（實得 ${jobs[0]!.type}）`);

      // 提交推進了序號（§7.2）：信封 3 + TeamPlanId 1 + JobId 1。
      assert(
        (result.state.core.nextRuntimeSequence as unknown as number) >
          (g.state.core.nextRuntimeSequence as unknown as number),
        'core.nextRuntimeSequence 應於提交後前進',
      );
    },
  },
  {
    name: 'Golden 重播：同 seed + 同命令 → 逐位元相同的提交 State',
    run: () => {
      const teamId = createNewGame(INPUT).playerTeamId;
      const a = runGameCommand(createNewGame(INPUT).state, restRequest(teamId), assembler);
      const b = runGameCommand(createNewGame(INPUT).state, restRequest(teamId), assembler);
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
