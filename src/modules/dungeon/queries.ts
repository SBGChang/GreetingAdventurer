// modules/dungeon/queries.ts
// Dungeon 公開 Query port 實作（doc §4）。
// 純讀取：以目前 slice（+ Reader 取每日點數）投影 View，不改動 state。
//
// Dungeon Query 不公開其他隊伍的 RNG seed、未結算獎勵細節或可被玩家利用的 NPC 隱藏結果；
// getNpcProgress 只回傳需要顯示的進度摘要（doc §4）。getNpcRun/getNpcRunForTeam 回傳的
// NpcDungeonRunView 是**真正的投影**（契約已不再是 NpcDungeonRun 的別名）：rngContext 不存在，
// 未結算成果只剩筆數。投影集中在下方 npcRunView()，兩個 getter 共用同一份——不要在任一個
// getter 裡直接回傳 state 的 Run。

import type { MapInstanceId, NpcDungeonRunId, TeamId } from '../../contracts/core';
import type {
  DungeonQuery,
  DungeonDefinitionReader,
  NpcDungeonRun,
  PlayerExplorationSessionView,
  PlayerMapKnowledgeView,
  NpcDungeonRunView,
  NpcDungeonProgressView,
  PendingDungeonInteractionView,
} from '../../contracts/dungeon';

import type { DungeonModuleState } from './state';
import { getPlayerSession, findKnowledge, findNpcRunForTeam } from './state';

// NPC Run → 對外投影。**逐欄位列舉，不用 `{ ...run }` 去掉兩個欄位**：spread 的話，日後有人往
// NpcDungeonRun 加一個敏感欄位就會自動變成公開的，而且不會有任何東西失敗。逐欄位列舉是 fail-closed
// ——Run 多一個欄位時 NpcDungeonRunView（= Omit<...>）也會多一個，這個物件字面值就少一個屬性，
// tsc 立刻擋下，強迫作者決定它該不該公開。
function npcRunView(run: NpcDungeonRun): NpcDungeonRunView {
  return {
    runId: run.runId,
    teamId: run.teamId,
    teamPlanId: run.teamPlanId,
    participantCharacterIds: run.participantCharacterIds,
    mapId: run.mapId,
    mapVersion: run.mapVersion,
    explorationRuleId: run.explorationRuleId,
    distributionId: run.distributionId,
    combatSequenceId: run.combatSequenceId,
    cursorNpcOrder: run.cursorNpcOrder,
    settlementProgress: run.settlementProgress,
    status: run.status,
    startedOnDay: run.startedOnDay,
    lastProcessedOnDay: run.lastProcessedOnDay,
    revision: run.revision,
    // 只有筆數：成敗（outcome）與獎勵引用（pendingRewardRefs）都是 §4 禁止公開的未結算資訊。
    pendingResultCount: run.pendingResults.length,
  };
}

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
      const run = state.npcRuns[runId];
      return run === undefined ? undefined : npcRunView(run);
    },

    getNpcRunForTeam(teamId: TeamId): NpcDungeonRunView | undefined {
      const run = findNpcRunForTeam(state, teamId);
      return run === undefined ? undefined : npcRunView(run);
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
