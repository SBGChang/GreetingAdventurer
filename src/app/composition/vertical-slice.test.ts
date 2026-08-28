// app/composition/vertical-slice.test.ts
// F3 的里程碑證據：**真實 Content Pack → NewGameBootstrapper → GameSession → Router → 模組 Handler**
// 一路跑通一個真實 Game Command，而且結果由內容決定。
//
// 在這支之前，session.test / transaction.test 都用 fixture content 與 fixture context。這一支換上
// 磁碟上的 core + yunhua pack、正式 NewGameBootstrapper、正式 ContextAssembler——第一次證明
// 「開一個新遊戲，下一個指令，它真的用作者寫的資料算出結果」。

import { resolve } from 'node:path';

import type { CharacterArchetypeId, CityId } from '../../contracts/core';
import type { GameCommandRequest } from '../../contracts/core';
import { loadContentFromDisk } from '../../platform/content-repository';
import { createResolverRegistry } from '../../data-runtime';
import { createProductionContextAssembler } from '../content/context-assembler';
import { createNewGame, type NewGameConfig } from './new-game-bootstrap';
import { runGameCommand } from './session';
import type { GameCommand } from './messages';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const CONTENT_ROOT = resolve(import.meta.dirname, '../../../content');
const PLAYER_LINEAGE = 'character-archetype.core.player-lineage' as CharacterArchetypeId;
const CAPITAL = 'city-node.yunhua.yunjing' as CityId;

const CONFIG: NewGameConfig = {
  worldSeed: 'f3-vertical-slice',
  startDay: 8000,
  startingArchetypeId: PLAYER_LINEAGE,
  startCityId: CAPITAL,
  leaderSex: 'female',
  leaderBirthDay: 0,
};

type Case = Readonly<{ name: string; run: () => void }>;

const CASES: readonly Case[] = [
  {
    name: '開新遊戲 → 下 rest 指令 → 引擎用真實 team-plan-rule 排出計畫',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error('內容載入失敗');

      const game = createNewGame(CONFIG, loaded.registry);
      assert(game.success, '開新遊戲應成功');
      if (!game.success) return;

      // 開局排程器是空的。
      const jobsBefore = Object.keys(game.state.core.scheduler.jobsById).length;
      assert(jobsBefore === 0, `開局排程器應為空，實得 ${jobsBefore}`);

      const assembler = createProductionContextAssembler(loaded.registry, createResolverRegistry());
      const request: GameCommandRequest<GameCommand> = {
        actorTeamId: game.playerTeamId,
        // 隊伍開局在城市 → cityFacilityAction 的休息合法；天數由 team-plan-rule 內容決定。
        command: { type: 'rest', planKind: 'cityFacilityAction' },
      };

      const result = runGameCommand(game.state, request, assembler);
      assert(
        result.accepted,
        `rest 應被接受，實得 ${result.accepted ? '' : `${result.rejection.code}`}`,
      );
      if (!result.accepted) return;

      // 引擎排出了一筆到期 Job（計畫的到期日由內容的 durationDays 推導，不是寫死）。
      const jobsAfter = Object.values(result.state.core.scheduler.jobsById);
      assert(jobsAfter.length === 1, `rest 後應排出 1 筆 Job，實得 ${jobsAfter.length}`);
      assert(
        jobsAfter[0]!.type === 'teamPlanDue',
        `應為 teamPlanDue，實得 ${jobsAfter[0]!.type}`,
      );
      // 到期日 > 開局日（真的排到未來，天數來自內容）。
      assert(
        jobsAfter[0]!.dueDay > result.state.core.worldDay,
        `到期日應在未來，實得 due=${jobsAfter[0]!.dueDay} now=${result.state.core.worldDay}`,
      );
    },
  },
  {
    name: '第二個指令：startCityTravel 也用真實 travel-mode 排出旅行計畫',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error('內容載入失敗');
      const game = createNewGame(CONFIG, loaded.registry);
      if (!game.success) throw new Error('開新遊戲失敗');
      const assembler = createProductionContextAssembler(loaded.registry, createResolverRegistry());

      // 取一個真實的 player-travel-mode 與一條從雲京出發的路線／目的城。用內容裡真的有的。
      const modes = loaded.registry.list({ kinds: ['player-travel-mode'] });
      assert(modes.length > 0, '應至少有一個 player-travel-mode');
      // routeId / toCityId 只要是合法城市即可（handleStartCityTravel 不驗路線存在，那屬 world 層）。
      const request: GameCommandRequest<GameCommand> = {
        actorTeamId: game.playerTeamId,
        command: {
          type: 'startCityTravel',
          toCityId: 'city-node.yunhua.qingcen' as CityId,
          routeId: 'route.yunhua.yunjing-qingcen' as never,
          modeId: modes[0]!.id as never,
        },
      };
      const result = runGameCommand(game.state, request, assembler);
      assert(result.accepted, `startCityTravel 應被接受，實得 ${result.accepted ? '' : result.rejection.code}`);
    },
  },
  {
    name: '未接線的模組被觸及時明確拋錯（pending proxy 不靜默）',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error('內容載入失敗');
      const game = createNewGame(CONFIG, loaded.registry);
      if (!game.success) throw new Error('開新遊戲失敗');
      const assembler = createProductionContextAssembler(loaded.registry, createResolverRegistry());
      // 已接線的 context（team/combat/inventory）建置時會讀真實 Slice，故傳真實開局狀態；dummyRuntime
      // 只佔位（這些 context 只把 runtime.ids.<module>/rng 當屬性引用，不在建置時呼叫）。ids 用 Proxy 對
      // 任何模組鍵都回一個空 allocator 物件——這樣每接一個新 context 都不必回頭補這個 dummy。
      const dummyRuntime = {
        worldSeed: 'x' as never,
        worldDay: 0 as never,
        ids: new Proxy({}, { get: () => ({}) }) as never,
        rng: {} as never,
        rngContextFor: () => ({}) as never,
      };
      const contexts = assembler(dummyRuntime, game.state);
      let threw = false;
      try {
        // city 尚未接線；存取任一屬性應拋。
        void (contexts.city as { anything?: unknown }).anything;
      } catch {
        threw = true;
      }
      assert(threw, '未接線模組被存取時應拋錯，不得靜默回 undefined');
    },
  },
];

export type VerticalSliceResult = Readonly<{ name: string; pass: boolean; error?: string }>;

export function runTestResults(): readonly VerticalSliceResult[] {
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
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? 'unknown'}`).join('\n');
    throw new Error(`vertical-slice tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
