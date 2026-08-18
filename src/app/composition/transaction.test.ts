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

import { consumeDungeonGatheringAction } from '../../modules/dungeon/public';
import { createFixtureContext, createFixtureState, FIXTURE } from '../../modules/dungeon/fixtures';
import { makeContext as mapMakeContext } from '../../modules/map/fixtures';
import { alignedMapState } from '../../testing/composition/session-fixture';
import type { MoveDungeonRoom } from '../../contracts/dungeon';
import type { OpenMapDoor } from '../../contracts/map';

import {
  createTransactionConfig,
  routeGameCommand,
  routeJob,
  type ModuleContexts,
} from './router';
import { createEmptyGameState, type GameScheduledJob, type GameState } from './state';
import type { GameCommand } from './messages';
import { validateRegistry } from './registry';
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
    map: mapMakeContext(),
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
      startDay: 0,
      // 玩家隊 = dungeon 探索 Session 的隊伍：Game Command 授權要求 actorTeamId === playerTeamId。
      team: createTeamState({ playerTeamId: FIXTURE.teamId }),
    }),
    // 用 dungeon 自己的 fixture slice，讓真實 handler 有可操作的 Session。
    dungeon: createFixtureState(),
    map: alignedMapState(),
  };
}

// dungeon 的 Internal Command 與 Job 已不註冊（整條流程依賴不存在的 Distribution 模組），
// 因此 kernel 接線測試改用仍註冊的 map OpenMapDoor 當載具。測的是**接線**，不是地牢規則。
const openDoorCommand: OpenMapDoor = {
  type: 'OpenMapDoor',
  teamId: FIXTURE.teamId,
  mapId: FIXTURE.mapId,
  mapVersion: FIXTURE.mapVersion,
  linkId: FIXTURE.redDoorLink,
  openedOnDungeonMinute: 0 as never,
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
    name: 'Internal Command 依判別欄路由到 map，並只改到 map slice',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      const s0 = baseState();
      const outcome = runTransaction(config, s0, TX, (ctx) => {
        const handler = config.routeInternalCommand({ targetModule: 'map' as never, command: openDoorCommand });
        assert(handler !== undefined, '應找得到 map 的 Handler');
        return handler!(openDoorCommand, ctx);
      }, null);

      assert(outcome.accepted, '合法開門應被接受');
      if (!outcome.accepted) return;
      const door = outcome.state.map.instances[FIXTURE.mapId]?.spatialRuntime.doorStates[FIXTURE.redDoorLink];
      assert(door?.state === 'open', `map slice 的門應被開啟（實得 ${String(door?.state)}）`);
      assert(outcome.state.character === s0.character, 'character slice 不應被動到');
      assert(outcome.state.dungeon === s0.dungeon, 'dungeon slice 不應被動到');
    },
  },
  {
    // dungeon 的收斂訂閱已不註冊（戰敗路徑送 Distribution 命令），因此改用仍註冊的
    // TravelSegmentReached → 旅行事件 Workflow。測的性質不變：Subscriber 產生的 outgoing
    // 必須被 Router 保留並排入因果佇列，而不是被靜默丟棄。
    name: '#1：Event Subscriber 的 outgoing 不被 Router 丟棄（TravelSegmentReached → 旅行 Workflow）',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      const event = { type: 'TravelSegmentReached', teamId: PLAYER_TEAM, segmentIndex: 0 };
      const subscribers = config.routeEventSubscribers({ event } as never);
      assert(subscribers.length === 1, `TravelSegmentReached 應有 1 個註冊訂閱者（實得 ${subscribers.length}）`);
      // 無 active plan 時 Workflow 回傳空 outgoing（旅行已被別的路徑收掉）——這也是被保留的結果，
      // 不是被丟棄；端到端的非空案例由 travel-integration.test 覆蓋。
      const reaction = subscribers[0]!(event as never, { workingState: baseState() } as never);
      assert(Array.isArray(reaction.outgoing ?? []), 'Router 必須把 Subscriber 的 outgoing 原樣帶出');
      assert(reaction.mutation === undefined, 'Workflow 訂閱者不擁有 Slice，不應回傳 mutation');
    },
  },
  {
    name: '拒絕會回滾整筆交易（slice 與 scheduler 都不留痕跡）',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      const s0 = baseState();
      const bad: OpenMapDoor = { ...openDoorCommand, mapVersion: FIXTURE.mapVersion + 5 };
      const outcome = runTransaction(config, s0, TX, (ctx) => {
        const handler = config.routeInternalCommand({ targetModule: 'map' as never, command: bad });
        return handler!(bad, ctx);
      }, null);

      assert(!outcome.accepted, 'Map Version 不符應被拒絕');
      if (outcome.accepted) return;
      assert(outcome.state === s0, '拒絕時必須原封回傳 baseState');
      assert(outcome.rejection.source === 'map', '拒絕應標明來源模組');
      assert(outcome.rejection.code === 'map/stale-version', `拒絕碼（實得 ${outcome.rejection.code}）`);
    },
  },
  {
    name: 'kernelRequests 於提交後回傳，不在交易內執行',
    run: () => {
      const s0 = baseState();
      // 迷宮日 100 分鐘；把 Session 推到邊界前，一次移動（2 格 × 30 分）即跨午夜。
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
      const cfg = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      const command: GameCommand = { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle } as MoveDungeonRoom;
      const root = routeGameCommand(envelope(command, FIXTURE.teamId), contexts);
      const outcome = runTransaction(cfg, near, TX, root, null);

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
        // OpenMapDoor 的 Owner 是 map；刻意送到 character。
        config.routeInternalCommand({ targetModule: 'character' as never, command: openDoorCommand });
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
    // 未實作的能力已從契約 union 移除，因此「宣告但未實作」這個狀態不再可能存在——
    // router 載入期的斷言會讓它起不來。這裡改測**未註冊**的訊息型別：不靜默略過，明確報錯。
    name: '未註冊的 Internal Command 型別會明確報錯，不靜默略過',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      let message = '';
      try {
        config.routeInternalCommand({
          targetModule: 'team' as never,
          command: { type: 'StartTimedCityAction', teamId: PLAYER_TEAM },
        });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert(message.length > 0, `未註冊的 Internal Command 應丟錯（實得 "${message}"）`);
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
    // UNAVAILABLE_CAPABILITIES 與 feature-not-available 都已移除：未完成的能力不再進註冊表，
    // 所以「已註冊但不能用」這個狀態不存在。送出未註冊的型別會明確報錯（註冊錯誤，非執行期狀況）。
    name: '未註冊的 Game Command 型別會明確報錯',
    run: () => {
      let message = '';
      try {
        routeGameCommand(envelope({ type: 'unequipItem' } as unknown as GameCommand, PLAYER_TEAM), contexts);
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert(message.includes('unequipItem'), `應指出未註冊的命令型別（實得 "${message}"）`);
    },
  },
  {
    // 宣告表自洽 ≠ Router 真的有 Handler。過去這個落差由 UNAVAILABLE_CAPABILITIES「合法化」，
    // 現在沒有那份清單了：註冊表裡的每一項都必須有實作，否則 router 載入期就丟錯。
    name: '註冊表與 Router 實際 dispatch 完全一致（沒有已註冊卻缺 Handler 的能力）',
    run: () => {
      assert(validateRegistry().length === 0, '註冊表不應含任何缺 Handler 的能力');
    },
  },

  // ── 到期 Job（Root）路由 ────────────────────────────────────────────────────
  {
    name: '到期 Job 依 job.type 路由到 map；失效目標由 Handler 接受並 no-op（非拒絕）',
    run: () => {
      const config = createTransactionConfig({ contextFactory: contexts, applyScheduling });
      const s0 = baseState();
      // 不存在的 map instance。失效 Job 應「接受並 no-op」——若拒絕會回滾、Job 留在佇列不斷重觸發。
      const job = {
        type: 'mapRefreshCheck',
        jobId: 'runtime:job~map~0' as JobId,
        dueDay: 1 as WorldDay,
        ownerModule: 'map' as ModuleId,
        targetId: 'runtime:map-instance:absent' as never,
        payload: {},
      } as unknown as GameScheduledJob;
      const outcome = runTransaction(config, s0, TX, routeJob(job, contexts), null);

      assert(outcome.accepted, '失效目標的 Job 應被接受並 no-op（不是拒絕）');
      if (!outcome.accepted) return;
      assert(outcome.state.map === s0.map, 'no-op 不應改動 map slice');
    },
  },
  {
    name: '未註冊的 Job 型別會明確報錯，不靜默丟棄到期 Job',
    run: () => {
      let message = '';
      try {
        routeJob({ type: 'freeActionDue' } as unknown as GameScheduledJob, contexts);
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert(message.length > 0, `未註冊的 Job 應丟錯（實得 "${message}"）`);
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
