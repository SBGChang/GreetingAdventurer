// app/composition/session.test.ts
// 第一個把「引擎 Session」整條跑起來的測試：一筆玩家 Game Command 經 runGameCommand →
// 真實 router → 真實 kernel Runtime ID cursor → 跨模組 Internal Command → **另一個真實模組的
// Handler 改到它自己的真實 Slice**，全在一筆原子交易內。
//
// 為什麼是 openDungeonDoor → OpenMapDoor：
//   - dungeon 玩家開一道「關閉的紅門」會 required OpenMapDoor 給 map；
//   - map 的 handleOpenMapDoor 只讀 map Slice（`void ctx`），故不依賴任何未實作模組或內容；
//   - 兩邊只需在 mapId + linkId + version 對齊，就能證明「跨模組級聯真的接上了」。
// 這是各模組自己的綠燈證明不了的東西（跨模組線）。內容仍用 fixture（內容軌另計），但 id/rng/
// cursor/路由/跨模組 Slice 變更全部是真的。鋪設共用於 session-fixture.ts。

import { requireInstance } from '../../modules/map/public';
import { FIXTURE, createFixtureState } from '../../modules/dungeon/fixtures';

import { runGameCommand, settleWorld, settlePlayerDecision, scheduleBootstrapJobs } from './session';
import { UnavailableCapabilityError } from './capability';
import { makeEncounter } from '../../modules/combat/fixtures';
import type { CombatantId } from '../../contracts/core';
import { baseState, makeAssembler, openRedDoor } from '../../testing/composition/session-fixture';
import type { GameState } from './state';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const assembler = makeAssembler();

export type SessionTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: '未接線 port 回傳 typed rejection 且不提交狀態／ID',
    run: () => {
      const state = baseState();
      const result = runGameCommand(state, openRedDoor, () => { throw new UnavailableCapabilityError('test.port'); });
      assert(!result.accepted && result.rejection.code === 'engine/capability-unavailable', '應明確拒絕');
      assert(result.state === state, '失敗不可提交任何狀態');
    },
  },
  {
    name: '敵方回合阻塞必須傳回 UI 使用的結算結果，不能繼續世界時間',
    run: () => {
      const base = baseState();
      const enemy = 'enemy' as CombatantId;
      const encounter = { ...makeEncounter([{ combatantId: enemy, side: 'enemy' }]),
        playerTeamId: base.team.playerTeamId, currentActorId: enemy };
      const state: GameState = { ...base, combat: { ...base.combat,
        encounters: { [encounter.encounterId]: encounter } } };
      const result = settlePlayerDecision(state, base.team.playerTeamId, () => { throw new UnavailableCapabilityError('enemy.ai'); });
      assert(result.blocked === 'engine/capability-unavailable', '敵方錯誤不得被丟掉');
      assert(result.state === state && result.steps.length === 0, '阻塞後不得結算世界');
    },
  },
  {
    name: '已到期工作不得把世界時鐘撥回過去',
    run: () => {
      const base = baseState();
      const state = scheduleBootstrapJobs({ ...base, core: { ...base.core, worldDay: 200 } }, [{
        type: 'mapRefreshCheck', ownerModule: 'map' as never, targetId: 'missing-map',
        dueDay: 100 as never, payload: { reason: 'regular' },
      }]);
      const result = settleWorld(state, state.team.playerTeamId, assembler);
      assert(result.state.core.worldDay === 200, '日期不得倒退');
      assert(Object.keys(result.state.core.scheduler.jobsById).length === 0, '到期失效工作應消耗');
    },
  },
  {
    name: '玩家 openDungeonDoor 的 OpenMapDoor 跨模組落到真實 map Slice，門被打開',
    run: () => {
      const s0 = baseState();
      assert(
        requireInstance(s0.map, FIXTURE.mapId).spatialRuntime.doorStates[FIXTURE.redDoorLink]!.state ===
          'closed',
        '前置：紅門應為關閉',
      );

      const result = runGameCommand(s0, openRedDoor, assembler);
      assert(result.accepted, `交易應被接受（實得 ${result.accepted ? 'accepted' : 'rejected'}）`);
      if (!result.accepted) return;

      const door = requireInstance(result.state.map, FIXTURE.mapId).spatialRuntime.doorStates[
        FIXTURE.redDoorLink
      ]!;
      assert(door.state === 'open', `紅門應被 map handler 開啟（實得 ${door.state}）`);

      const session = result.state.dungeon.playerSessions[FIXTURE.teamId]!;
      assert(session.elapsedDungeonMinutes === 20, `Session 應前進 20 分鐘（實得 ${session.elapsedDungeonMinutes}）`);
    },
  },
  {
    name: '§7.2：core.nextRuntimeSequence 於提交後前進（信封 3 個 ID：command/transaction/correlation）',
    run: () => {
      const s0 = baseState();
      assert(s0.core.nextRuntimeSequence === 0, '前置：起始序號為 0');
      const result = runGameCommand(s0, openRedDoor, assembler);
      assert(result.accepted, '交易應被接受');
      if (!result.accepted) return;
      // 信封配發 command→transaction→correlation 共 3 個；此路徑無 Handler 鑄 ID、無排程 Job。
      assert(
        (result.state.core.nextRuntimeSequence as unknown as number) === 3,
        `core.nextRuntimeSequence 應為 3（實得 ${result.state.core.nextRuntimeSequence}）`,
      );
    },
  },
  {
    name: '決定論：同 seed + 同命令 → 逐位元相同的提交狀態（可重播）',
    run: () => {
      const a = runGameCommand(baseState(), openRedDoor, assembler);
      const b = runGameCommand(baseState(), openRedDoor, assembler);
      assert(a.accepted && b.accepted, '兩次都應被接受');
      if (!a.accepted || !b.accepted) return;
      assert(
        JSON.stringify(a.state) === JSON.stringify(b.state),
        '兩次提交狀態應完全相同（決定性可重播）',
      );
    },
  },
  {
    name: '前置不符時整筆回滾：門不連接目前房間 → 拒絕，map Slice 不留痕跡',
    run: () => {
      // 玩家改在入口房 R1；紅門連 R2↔R3，不連 R1 → openDungeonDoor 前置失敗。
      const s0: GameState = { ...baseState(), dungeon: createFixtureState() };
      const result = runGameCommand(s0, openRedDoor, assembler);
      assert(!result.accepted, '門不連接目前房間應被拒絕');
      if (result.accepted) return;
      assert(result.rejection.source === 'dungeon', '拒絕應來自 dungeon');
      assert(
        requireInstance(result.state.map, FIXTURE.mapId).spatialRuntime.doorStates[FIXTURE.redDoorLink]!
          .state === 'closed',
        '拒絕後 map 門應仍為關閉',
      );
      assert(
        (result.state.core.nextRuntimeSequence as unknown as number) === 0,
        '拒絕後序號應完全不變（§7.2）',
      );
    },
  },
];

export function runTestResults(): readonly SessionTestResult[] {
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
    throw new Error(`session tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
