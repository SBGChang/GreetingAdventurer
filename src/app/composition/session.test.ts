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
// cursor/路由/跨模組 Slice 變更全部是真的。

import type {
  AdventureSiteId,
  GameCommandRequest,
  MapInstanceId,
  MapTemplateId,
  Revision,
  RoomLinkId,
  TeamId,
} from '../../contracts/core';
import type { MapInstance } from '../../contracts/map';
import type { OpenDungeonDoor } from '../../contracts/dungeon';

import {
  FIXTURE,
  createFixtureState,
  createFixtureReader,
  createFixtureMapPort,
  createFixtureTeamPort,
} from '../../modules/dungeon/public';
import { createMapState, requireInstance, makeContext as mapMakeContext } from '../../modules/map/public';
import { createTeamState } from '../../modules/team/public';

import { runGameCommand, type ContextAssembler } from './session';
import type { ModuleContexts } from './router';
import type { GameCommand } from './messages';
import { createEmptyGameState, type GameState } from './state';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PLAYER_TEAM = FIXTURE.teamId;

// 未觸及的模組 Context 一律用會拋錯的 proxy：路由送錯模組時立刻爆，而非靜默通過。
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

// 對齊 dungeon FIXTURE 的 map Slice：一個 mapId=cave、v1、含一道「關閉的紅門」在 redDoorLink 的實例。
// 直接手建 spatialRuntime，避免與 map 自己 fixture 的 template ID 世界打架。
function alignedMapState(): GameState['map'] {
  const instance: MapInstance = {
    mapId: FIXTURE.mapId as MapInstanceId,
    adventureSiteId: 'runtime:adventure-site:cave' as AdventureSiteId,
    templateId: 'definition:map-template:cave' as MapTemplateId,
    currentVersion: FIXTURE.mapVersion,
    refresh: { offsetDays: 3 },
    spatialRuntime: {
      mapVersion: FIXTURE.mapVersion,
      doorStates: {
        [FIXTURE.redDoorLink as RoomLinkId]: {
          linkId: FIXTURE.redDoorLink as RoomLinkId,
          mapVersion: FIXTURE.mapVersion,
          state: 'closed',
          revision: 0 as Revision,
        },
      },
      trapStates: {},
      gatheringNodeStates: {},
    },
    revision: 0 as Revision,
  };
  return createMapState({ instances: [instance] });
}

// dungeon Slice：玩家隊伍在「中間房 R2」探索中（紅門連 R2↔R3，開門前置要求門連接目前房間）。
function dungeonAtMiddle(): GameState['dungeon'] {
  const base = createFixtureState();
  const session = base.playerSessions[FIXTURE.teamId]!;
  return {
    ...base,
    playerSessions: {
      ...base.playerSessions,
      [FIXTURE.teamId]: { ...session, currentRoomId: FIXTURE.roomMiddle },
    },
  };
}

function baseState(): GameState {
  return {
    ...createEmptyGameState({
      worldSeed: 'session-smoke-test',
      team: createTeamState({ playerTeamId: PLAYER_TEAM as TeamId }),
    }),
    dungeon: dungeonAtMiddle(),
    map: alignedMapState(),
  };
}

// ContextAssembler：dungeon 用 fixture 內容 + Session 注入的**真實** id/rng；map 只需能路由到即可
// （handleOpenMapDoor 不讀 ctx）。其餘模組不應被觸及。
const assembler: ContextAssembler = (runtime, _state): ModuleContexts => ({
  dungeon: {
    reader: createFixtureReader(),
    map: createFixtureMapPort(),
    team: createFixtureTeamPort(),
    worldDay: runtime.worldDay,
    minutesPerDungeonDay: 100,
    interactionRuleId: FIXTURE.interactionRuleId,
    lootDistributionRuleId: FIXTURE.lootDistributionRuleId,
    npcExplorationRuleId: FIXTURE.npcExplorationRuleId,
    rng: runtime.rngContextFor('dungeon'),
    nextInteractionId: runtime.ids.dungeon.nextInteractionId,
    nextKnowledgeId: runtime.ids.dungeon.nextKnowledgeId,
    nextRunId: runtime.ids.dungeon.nextRunId,
    nextDistributionId: runtime.ids.dungeon.nextDistributionId,
  },
  map: mapMakeContext({ worldDay: runtime.worldDay, ids: runtime.ids.map, rng: runtime.rng }),
  character: unusedContext('character'),
  inventory: unusedContext('inventory'),
  combat: unusedContext('combat'),
  team: unusedContext('team'),
  progression: unusedContext('progression'),
});

const openRedDoor: GameCommandRequest<GameCommand> = {
  actorTeamId: PLAYER_TEAM as TeamId,
  command: { type: 'openDungeonDoor', linkId: FIXTURE.redDoorLink } as OpenDungeonDoor,
};

export type SessionTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: '玩家 openDungeonDoor 的 OpenMapDoor 跨模組落到真實 map Slice，門被打開',
    run: () => {
      const s0 = baseState();
      // 前置：門一開始是關的。
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

      // dungeon 這邊：Session 前進 20 分鐘（redDoorOpenMinutes），且揭露門後 R3。
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
      assert(result.rejection.sourceModule === 'dungeon', '拒絕應來自 dungeon');
      // 回滾：map 的門仍為關閉、序號不變。
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
