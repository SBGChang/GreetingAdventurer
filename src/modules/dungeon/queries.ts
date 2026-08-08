// modules/dungeon/queries.ts
// Dungeon 公開 Query port 實作（doc §4）。
// 純讀取：以目前 slice（+ Reader 取每日點數）投影 View，不改動 state。
//
// Dungeon Query 不公開其他隊伍的 RNG seed、未結算獎勵細節或可被玩家利用的 NPC 隱藏結果；
// getNpcProgress 只回傳需要顯示的進度摘要（doc §4）。getNpcRun/getNpcRunForTeam 之 View
// 型別由契約固定為完整 Run；生產投影會進一步遮蔽 rngContext/pendingResults（見 TODO）。

import type { MapInstanceId, NpcDungeonRunId, TeamId } from '../../contracts/core';
import type {
  DungeonQuery,
  DungeonDefinitionReader,
  PlayerExplorationSessionView,
  PlayerMapKnowledgeView,
  NpcDungeonRunView,
  NpcDungeonProgressView,
  PendingDungeonInteractionView,
} from '../../contracts/dungeon';

import type { DungeonModuleState } from './state';
import { getPlayerSession, findKnowledge, findNpcRunForTeam } from './state';

export function makeDungeonQuery(
  state: DungeonModuleState,
  reader: DungeonDefinitionReader,
): DungeonQuery {
  return {
    getPlayerSession(teamId: TeamId): PlayerExplorationSessionView | undefined {
      return getPlayerSession(state, teamId);
    },

    getPlayerMapKnowledge(
      teamId: TeamId,
      mapId: MapInstanceId,
    ): PlayerMapKnowledgeView | undefined {
      return findKnowledge(state, teamId, mapId);
    },

    getNpcRun(runId: NpcDungeonRunId): NpcDungeonRunView | undefined {
      // TODO: 對外投影應遮蔽 rngContext 與未結算 pendingResults 細節；契約 View 型別目前與 Run 同構。
      return state.npcRuns[runId];
    },

    getNpcRunForTeam(teamId: TeamId): NpcDungeonRunView | undefined {
      return findNpcRunForTeam(state, teamId);
    },

    getNpcProgress(runId: NpcDungeonRunId): NpcDungeonProgressView {
      const run = state.npcRuns[runId];
      if (run === undefined) {
        throw new Error(`dungeon query: unknown npc run ${String(runId)}`);
      }
      // 探索中才顯示尚可用點數（每日重取，非跨日累積）；其餘狀態顯示 0。
      const remainingPoints =
        run.status === 'exploring'
          ? reader.getNpcExplorationRule(run.explorationRuleId).dailyPointBudget
          : 0;
      return {
        runId: run.runId,
        cursorNpcOrder: run.cursorNpcOrder,
        status: run.status,
        remainingPoints,
      };
    },

    getPendingInteraction(teamId: TeamId): PendingDungeonInteractionView | undefined {
      return getPlayerSession(state, teamId)?.pendingInteraction;
    },
  };
}
