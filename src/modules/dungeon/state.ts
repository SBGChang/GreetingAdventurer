// modules/dungeon/state.ts
// Dungeon 模組執行期 State slice 與初始工廠。
// 對應 docs/00_core/architecture/03_dungeon_module.md §1.1、§3。
//
// 契約 DungeonState（dungeon/index.ts）已是本模組「唯一可寫」的最小 slice：
//   playerSessions / playerMapKnowledge / npcRuns。
// 本模組具體擁有的 slice 與契約同構（不需額外私有帳本）；system.ts 的每個 handler
// 一律回傳 ModuleResult<DungeonState>，其 nextSlice 結構性即滿足契約。

import type {
  MapInstanceId,
  PlayerMapKnowledgeId,
  RoomId,
  TeamId,
  Revision,
} from '../../contracts/core';
import type {
  DungeonState,
  PlayerExplorationSession,
  PlayerMapKnowledge,
  NpcDungeonRun,
} from '../../contracts/dungeon';

// 模組具體擁有的 slice 型別即契約 DungeonState（第一版同構）。
export type DungeonModuleState = DungeonState;

// 空 slice：新局／新存檔起點。玩家 Session、Knowledge、NPC Run 皆按需建立。
export function createInitialDungeonState(): DungeonModuleState {
  return {
    playerSessions: {},
    playerMapKnowledge: {},
    npcRuns: {},
  };
}

// ── 便利 accessor（純讀取；index 存取一律回傳 undefined-safe）──────────────

export function getPlayerSession(
  state: DungeonModuleState,
  teamId: TeamId,
): PlayerExplorationSession | undefined {
  return state.playerSessions[teamId];
}

export function withPlayerSession(
  state: DungeonModuleState,
  session: PlayerExplorationSession,
): DungeonModuleState {
  return {
    ...state,
    playerSessions: { ...state.playerSessions, [session.teamId]: session },
  };
}

export function findKnowledge(
  state: DungeonModuleState,
  teamId: TeamId,
  mapId: MapInstanceId,
): PlayerMapKnowledge | undefined {
  for (const key of Object.keys(state.playerMapKnowledge)) {
    const k = state.playerMapKnowledge[key as PlayerMapKnowledgeId];
    if (k !== undefined && k.teamId === teamId && k.mapId === mapId) return k;
  }
  return undefined;
}

export function withKnowledge(
  state: DungeonModuleState,
  knowledge: PlayerMapKnowledge,
): DungeonModuleState {
  return {
    ...state,
    playerMapKnowledge: {
      ...state.playerMapKnowledge,
      [knowledge.knowledgeId]: knowledge,
    },
  };
}

export function withNpcRun(
  state: DungeonModuleState,
  run: NpcDungeonRun,
): DungeonModuleState {
  return { ...state, npcRuns: { ...state.npcRuns, [run.runId]: run } };
}

export function findNpcRunForTeam(
  state: DungeonModuleState,
  teamId: TeamId,
): NpcDungeonRun | undefined {
  for (const key of Object.keys(state.npcRuns)) {
    const r = state.npcRuns[key as keyof typeof state.npcRuns];
    if (r !== undefined && r.teamId === teamId) return r;
  }
  return undefined;
}

// 依 distributionId 反查 Run（結算日 AssetDistributionCompleted 收斂用）。
export function findNpcRunByDistribution(
  state: DungeonModuleState,
  distributionId: NpcDungeonRun['distributionId'],
): NpcDungeonRun | undefined {
  for (const key of Object.keys(state.npcRuns)) {
    const r = state.npcRuns[key as keyof typeof state.npcRuns];
    if (r !== undefined && r.distributionId === distributionId) return r;
  }
  return undefined;
}

// 建立一筆已揭露入口房間的空 Knowledge。
export function createKnowledge(
  knowledgeId: PlayerMapKnowledgeId,
  teamId: TeamId,
  mapId: MapInstanceId,
  entranceRoomId: RoomId,
): PlayerMapKnowledge {
  return {
    knowledgeId,
    teamId,
    mapId,
    revealedRoomIds: [entranceRoomId],
    discoveredLinkIds: [],
    knownTrapIds: [],
    revision: 0 as Revision,
  };
}
