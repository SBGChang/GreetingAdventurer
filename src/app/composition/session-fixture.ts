// app/composition/session-fixture.ts
// 引擎 Session 端到端測試的共用鷹架（非 production 內容，僅 bring-up/測試用）：
// 一個對齊 dungeon FIXTURE 的最小 map Slice、一個在中間房探索中的玩家 dungeon Slice、
// 以及一個可換入不同 DungeonDefinitionReader 的 ContextAssembler。
//
// 抽出來讓 session.test.ts（用 fixture reader）與 content/dungeon-reader.test.ts（換入 data-runtime
// 真 reader）共用同一條 openDungeonDoor→OpenMapDoor→真 map slice 路徑，不重複鋪設。

import type {
  AdventureSiteId,
  GameCommandRequest,
  MapInstanceId,
  MapTemplateId,
  Revision,
  RoomLinkId,
  TeamId,
} from '../../contracts/core';
import type { DungeonDefinitionReader, OpenDungeonDoor } from '../../contracts/dungeon';
import type { MapInstance } from '../../contracts/map';

import { FIXTURE, createFixtureState, createFixtureReader, createFixtureMapPort, createFixtureTeamPort } from '../../modules/dungeon/fixtures';
import { createMapState } from '../../modules/map/public';
import { makeContext as mapMakeContext } from '../../modules/map/fixtures';
import { createTeamState } from '../../modules/team/public';

import type { ContextAssembler } from './session';
import type { ModuleContexts } from './router';
import type { GameCommand } from './messages';
import { createEmptyGameState, type GameState } from './state';

export const PLAYER_TEAM = FIXTURE.teamId as TeamId;

// 未觸及的模組 Context 一律用會拋錯的 proxy：路由送錯模組時立刻爆，而非靜默通過。
export function unusedContext(name: string): never {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`本測試不應觸及 ${name} 的 Context`);
      },
    },
  ) as never;
}

// 對齊 dungeon FIXTURE 的 map Slice：mapId=cave、v1、含一道「關閉的紅門」在 redDoorLink。
// 直接手建 spatialRuntime，避免與 map 自己 fixture 的 template ID 世界打架。
export function alignedMapState(): GameState['map'] {
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
export function dungeonAtMiddle(): GameState['dungeon'] {
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

export function baseState(): GameState {
  return {
    ...createEmptyGameState({
      worldSeed: 'session-smoke-test',
      team: createTeamState({ playerTeamId: PLAYER_TEAM }),
    }),
    dungeon: dungeonAtMiddle(),
    map: alignedMapState(),
  };
}

// ContextAssembler：dungeon 用（可換的）reader + fixture 跨模組 port + Session 注入的**真實**
// id/rng；map 只需能路由到即可（handleOpenMapDoor 不讀 ctx）。其餘模組不應被觸及。
export function makeAssembler(
  opts: Readonly<{ dungeonReader?: DungeonDefinitionReader }> = {},
): ContextAssembler {
  const dungeonReader = opts.dungeonReader ?? createFixtureReader();
  return (runtime, _state): ModuleContexts => ({
    dungeon: {
      reader: dungeonReader,
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
}

export const openRedDoor: GameCommandRequest<GameCommand> = {
  actorTeamId: PLAYER_TEAM,
  command: { type: 'openDungeonDoor', linkId: FIXTURE.redDoorLink } as OpenDungeonDoor,
};
