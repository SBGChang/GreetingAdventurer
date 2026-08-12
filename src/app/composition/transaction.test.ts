// app/composition/transaction.test.ts
// 第一個真正把 kernel TransactionRunner 接上真實模組 Handler 的測試。
//
// Wave B 的每個模組都只在自己的 stub 裡被呼叫過；沒有任何測試走過
// 「Handler → ModuleResult → kernel mutation → GameState」這條實際路徑。
// 本檔驗證的是**接線**，不是領域規則（那由各模組自己的測試覆蓋）：
//   - Internal Command 依 `type` 判別欄路由到正確模組，並真的改到該模組的 Slice。
//   - 拒絕會讓整筆交易回滾，slice 與排程都不留痕跡（§11 第 1 項）。
//   - ModuleResult.scheduledJobs 真的落到 core.scheduler（Runner 原本會丟掉它）。
//   - ModuleResult.kernelRequests 於提交後回傳給呼叫者，不在交易內遞迴執行。
//   - 契約宣告卻未實作的 Handler 會明確報錯，不是靜默成功。

import type {
  CommandId,
  CorrelationId,
  GameCommandEnvelope,
  JobId,
  ModuleId,
  NpcDungeonRunId,
  TeamId,
  TransactionId,
  WorldDay,
} from '../../contracts/core';
import { runTransaction, type SchedulingEffects } from '../../kernel';

import {
  createFixtureContext,
  createFixtureState,
  FIXTURE,
  consumeDungeonGatheringAction,
} from '../../modules/dungeon/public';
import type { ConsumeDungeonGatheringAction, MoveDungeonRoom } from '../../contracts/dungeon';

import {
  createTransactionConfig,
  routeGameCommand,
  routeJob,
  PENDING_GAME_COMMANDS,
  PENDING_INTERNAL_COMMANDS,
  PENDING_JOBS,
  type ModuleContexts,
} from './router';
import { createEmptyGameState, type GameScheduledJob, type GameState } from './state';
import type { GameCommand } from './messages';
import { createTeamState } from '../../modules/team/public';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const TX = 'runtime:transaction~test~0' as TransactionId;
const PLAYER_TEAM = 'runtime:team~test~0' as TeamId;

// 未被本檔使用的 Context 一律用會拋錯的 proxy：若路由把訊息送錯模組，測試會立刻爆而非靜默通過。
function unusedContext(name: string): never {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`本測試不應觸及 ${name} 的 Context`);
      },
    },
  ) as never;
}

function contexts(): ModuleContexts {
  return {
    dungeon: createFixtureContext(),
    character: unusedContext('character'),
    inventory: unusedContext('inventory'),
    map: unusedContext('map'),
    combat: unusedContext('combat'),
    team: unusedContext('team'),
    progression: unusedContext('progression'),
  };
}

// 測試用 applyScheduling：以遞增序號配發 JobId，並寫入 core.scheduler。
// 真實 Composition 會改用 kernel 的 RuntimeIdGenerator + core.nextRuntimeSequence。
function applyScheduling(state: GameState, effects: SchedulingEffects): GameState {
  if (effects.scheduledJobs.length === 0 && effects.cancelledJobIds.length === 0) return state;
  const jobsById: Record<JobId, GameScheduledJob> = { ...state.core.scheduler.jobsById };
  for (const id of effects.cancelledJobIds) delete jobsById[id];
  effects.scheduledJobs.forEach((draft, index) => {
    const jobId = `runtime:job~test~${Object.keys(jobsById).length + index}` as JobId;
    jobsById[jobId] = { ...(draft as object), jobId } as GameScheduledJob;
  });
  return {
    ...state,
    core: {
      ...state.core,
      scheduler: { jobsById, revision: state.core.scheduler.revision + 1 },
    },
  };
}

function baseState(): GameState {
  return {
    ...createEmptyGameState({
      worldSeed: 'transaction-test',
      // 玩家隊 = dungeon 探索 Session 的隊伍：Game Command 授權要求 actorTeamId === playerTeamId。
      team: createTeamState({ playerTeamId: FIXTURE.teamId }),
    }),
    // 用 dungeon 自己的 fixture slice，讓真實 handler 有可操作的 Session。
    dungeon: createFixtureState(),
  };
}

const gatherCommand: ConsumeDungeonGatheringAction = {
  type: 'ConsumeDungeonGatheringAction',
  teamId: FIXTURE.teamId,
  mapId: FIXTURE.mapId,
  mapVersion: FIXTURE.mapVersion,
  nodeId: FIXTURE.gatherNodePlayer,
};

// 建一個最小 GameCommandEnvelope（核心 ID 於真實 Composition 由交易 cursor 配發；測試以固定值代入）。
function envelope(command: GameCommand, actorTeamId: TeamId): GameCommandEnvelope<GameCommand> {
  return {
    commandId: 'runtime:command~test~0' as CommandId,
    transactionId: TX,
    correlationId: 'runtime:correlation~test~0' as CorrelationId,
    issuedAtWorldDay: 0 as WorldDay,
    actorTeamId,
    command,
  };
}

export type TransactionTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'Internal Command 依判別欄路由到 dungeon，並只改到 dungeon slice',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      const s0 = baseState();
      const outcome = runTransaction(config, s0, TX, (ctx) => {
        const handler = config.routeInternalCommand({ targetModule: 'dungeon' as never, command: gatherCommand });
        assert(handler !== undefined, '應找得到 dungeon 的 Handler');
        return handler!(gatherCommand, ctx);
      }, null);

      assert(outcome.accepted, '合法採集應被接受');
      if (!outcome.accepted) return;
      const session = outcome.state.dungeon.playerSessions[FIXTURE.teamId];
      assert(session?.elapsedDungeonMinutes === 15, `dungeon slice 應前進 15 分鐘（實得 ${session?.elapsedDungeonMinutes}）`);
      assert(outcome.state.character === s0.character, 'character slice 不應被動到');
      assert(outcome.state.map === s0.map, 'map slice 不應被動到');
    },
  },
  {
    name: '拒絕會回滾整筆交易（slice 與 scheduler 都不留痕跡）',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      const s0 = baseState();
      const bad: ConsumeDungeonGatheringAction = { ...gatherCommand, mapVersion: FIXTURE.mapVersion + 5 };
      const outcome = runTransaction(config, s0, TX, (ctx) => {
        const handler = config.routeInternalCommand({ targetModule: 'dungeon' as never, command: bad });
        return handler!(bad, ctx);
      }, null);

      assert(!outcome.accepted, 'Map Version 不符應被拒絕');
      if (outcome.accepted) return;
      assert(outcome.state === s0, '拒絕時必須原封回傳 baseState');
      assert(outcome.rejection.sourceModule === 'dungeon', '拒絕應標明來源模組');
      assert(
        outcome.rejection.code === 'dungeon.consumeDungeonGatheringAction.preconditionFailed',
        `拒絕碼（實得 ${outcome.rejection.code}）`,
      );
    },
  },
  {
    name: 'kernelRequests 於提交後回傳，不在交易內執行',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      const s0 = baseState();
      // 迷宮日 100 分鐘；採集 15 分鐘 × 7 次會跨午夜。此處直接把 Session 推到邊界前。
      const ctxs = contexts();
      const near: GameState = {
        ...s0,
        dungeon: {
          ...s0.dungeon,
          playerSessions: {
            ...s0.dungeon.playerSessions,
            [FIXTURE.teamId]: {
              ...s0.dungeon.playerSessions[FIXTURE.teamId]!,
              elapsedDungeonMinutes: 95 as never,
            },
          },
        },
      };
      const cfg = createTransactionConfig({ contextFactory: () => ctxs, applyScheduling });
      const outcome = runTransaction(cfg, near, TX, (ctx) => {
        const handler = cfg.routeInternalCommand({ targetModule: 'dungeon' as never, command: gatherCommand });
        return handler!(gatherCommand, ctx);
      }, null);

      assert(outcome.accepted, '應被接受');
      if (!outcome.accepted) return;
      const requests = outcome.kernelRequests ?? [];
      assert(requests.length === 1, `應累積 1 筆 KernelRequest（實得 ${requests.length}）`);
      assert(requests[0]!.type === 'AdvanceWorldToDay', 'KernelRequest 應為 AdvanceWorldToDay');
      // 交易本身不得推進世界日——那要由 GameSession 於提交後另開交易處理。
      assert(outcome.state.core.worldDay === near.core.worldDay, '交易內不得改動 worldDay');
    },
  },
  {
    name: '送錯 targetModule 會明確報錯，不會被靜默改投',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      let message = '';
      try {
        config.routeInternalCommand({ targetModule: 'map' as never, command: gatherCommand });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert(message.includes('應送往'), `應報出 targetModule 不符（實得 "${message}"）`);
    },
  },
  {
    name: '缺少判別欄的訊息無法路由，且錯誤訊息指向判別欄約定',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      let message = '';
      try {
        config.routeInternalCommand({ targetModule: 'dungeon' as never, command: { teamId: 'x' } });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert(message.includes('type'), `錯誤訊息應提到判別欄（實得 "${message}"）`);
    },
  },
  {
    name: '契約宣告但未實作的 Internal Command 會明確報錯',
    run: () => {
      assert(
        PENDING_INTERNAL_COMMANDS.length > 0,
        'Wave B 確實有宣告未實作的 Internal Command，此測試才有意義',
      );
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      // StartTimedCityAction 由 team 宣告處理，但 Wave B 沒有寫這個 Handler。
      let message = '';
      try {
        config.routeInternalCommand({
          targetModule: 'team' as never,
          command: { type: 'StartTimedCityAction', teamId: PLAYER_TEAM },
        });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert(message.includes('未實作'), `應指出 Handler 未實作（實得 "${message}"）`);
    },
  },

  // ── Game Command（Root）路由 ────────────────────────────────────────────────
  {
    name: 'Game Command 依 actorTeamId 路由到 dungeon Handler，並真的改到 dungeon slice',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      const s0 = baseState();
      // 玩家隊在入口房 R1 探索中；moveDungeonRoom → R2 走 2 格 × 30 分/格。
      const command: GameCommand = { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle } as MoveDungeonRoom;
      const root = routeGameCommand(envelope(command, FIXTURE.teamId), contexts);
      const outcome = runTransaction(config, s0, TX, root, null);

      assert(outcome.accepted, '合法移動應被接受');
      if (!outcome.accepted) return;
      const session = outcome.state.dungeon.playerSessions[FIXTURE.teamId];
      assert(session?.currentRoomId === FIXTURE.roomMiddle, `應移入 R2（實得 ${String(session?.currentRoomId)}）`);
      assert(session?.elapsedDungeonMinutes === 60, `應前進 60 分鐘（實得 ${session?.elapsedDungeonMinutes}）`);
      assert(outcome.state.team === s0.team, 'team slice 不應被動到');
    },
  },
  {
    name: '入口為 Workflow 的 Game Command（gatherDungeonNode）不直接路由，明確報錯',
    run: () => {
      let message = '';
      try {
        routeGameCommand(
          envelope({ type: 'gatherDungeonNode', nodeId: FIXTURE.gatherNodePlayer } as GameCommand, FIXTURE.teamId),
          contexts,
        );
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert(message.includes('Workflow'), `應指出入口是 Workflow（實得 "${message}"）`);
    },
  },
  {
    name: '契約宣告但未實作的 Game Command 會明確報錯',
    run: () => {
      assert(PENDING_GAME_COMMANDS.includes('unequipItem'), 'unequipItem 應在未實作清單');
      let message = '';
      try {
        // unequipItem 由 inventory 宣告接收，但 Wave B 沒有寫 Handler。
        routeGameCommand(
          envelope({ type: 'unequipItem' } as unknown as GameCommand, PLAYER_TEAM),
          contexts,
        );
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert(message.includes('未實作'), `應指出 Handler 未實作（實得 "${message}"）`);
    },
  },

  // ── 到期 Job（Root）路由 ────────────────────────────────────────────────────
  {
    name: '到期 Job 依 job.type 路由到 dungeon，過期 Run 由 dungeon Handler 拒絕',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      const s0 = baseState();
      // fixture 沒有這個 NPC Run → dungeon.npcDungeonDay 回 preconditionFailed，
      // 足以證明「routeJob 真的分派到 dungeon 的 Job Handler」。
      const job = {
        type: 'npcDungeonDay',
        jobId: 'runtime:job~npc~0' as JobId,
        dueDay: 1 as WorldDay,
        ownerModule: 'dungeon' as ModuleId,
        targetId: 'runtime:npc-dungeon-run:absent' as NpcDungeonRunId,
        payload: {},
      } as GameScheduledJob;
      const outcome = runTransaction(config, s0, TX, routeJob(job, contexts), null);

      assert(!outcome.accepted, '過期 Run 的 Job 應被拒絕（回滾）');
      if (outcome.accepted) return;
      assert(
        outcome.rejection.code === 'dungeon.npcDungeonDay.preconditionFailed',
        `拒絕碼應來自 dungeon（實得 ${outcome.rejection.code}）`,
      );
    },
  },
  {
    name: 'Manifest 註冊但未實作的 Job（freeActionDue）會明確報錯',
    run: () => {
      assert(PENDING_JOBS.includes('freeActionDue'), 'freeActionDue 應在未實作清單');
      let message = '';
      try {
        routeJob({ type: 'freeActionDue' } as unknown as GameScheduledJob, contexts);
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert(message.includes('未實作'), `應指出 Job Handler 未實作（實得 "${message}"）`);
    },
  },
];

export function runTestResults(): readonly TransactionTestResult[] {
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
    throw new Error(`transaction wiring tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
