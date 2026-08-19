// modules/quest/queries.ts
// QuestQuery 在 Slice 快照上的純函式實作（docs/00_core/architecture/10_quest_module.md §4）。
//
// UI 不自行重算完成、期限或結案資格——所有判定集中在此。
// 輸出順序一律以 QuestId 排序（不變量 19：相同 State／Day 下順序穩定），不依賴物件插入序。

import type {
  CityId,
  ContentInstanceId,
  EntitySourceRef,
  MapInstanceId,
  QuestId,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type {
  NpcQuestClaimView,
  PlayerTravelEscortQuestRef,
  QuestQuery,
  QuestView,
} from '../../contracts/quest';
import {
  listQuestIdsAtGuild,
  listQuestIdsForSource,
  listQuestsOrdered,
  objectiveContentIds,
  objectiveMapId,
  requireQuest,
  toNpcQuestClaimView,
  toQuestView,
  tryGetClaim,
  tryGetQuest,
  type QuestInstance,
  type QuestState,
} from './state';

function sortedIds(ids: readonly QuestId[]): readonly QuestId[] {
  return [...ids].sort();
}

// 索引項指向不存在的 Quest 是壞狀態：Query 跳過該筆而不整個炸掉，但也不代它編一筆出來
// （規範 §6：讀取端可以跳過並回報，不得代它決定內容）。
function resolveAll(state: QuestState, ids: readonly QuestId[]): readonly QuestInstance[] {
  const out: QuestInstance[] = [];
  for (const id of sortedIds(ids)) {
    const quest = tryGetQuest(state, id);
    if (quest !== undefined) out.push(quest);
  }
  return out;
}

// 「已接取且尚未歸檔」——地圖保留與內容保護的判定基礎（doc §9.2、§9.3）。
function isLiveAcceptedQuest(quest: QuestInstance): boolean {
  if (quest.acceptedByTeamId === undefined) return false;
  if (quest.settlement !== undefined) return false;
  return quest.status === 'incomplete' || quest.status === 'completed';
}

export function createQuestQuery(state: QuestState): QuestQuery {
  return {
    getQuest(id: QuestId): QuestView {
      return toQuestView(requireQuest(state, id));
    },

    // 公會佈告板：仍可接取者（doc §3.2：到期即從公會撤下）。
    listGuildPostings(cityId: CityId): QuestView[] {
      return resolveAll(state, listQuestIdsAtGuild(state, cityId))
        .filter((q) => q.status === 'unaccepted')
        .map(toQuestView);
    },

    // 進行中 + 已完成未結案；已歸檔者從 journal 移除（doc §3.2）。
    listTeamActiveQuests(teamId: TeamId): QuestView[] {
      return listQuestsOrdered(state)
        .filter((q) => q.acceptedByTeamId === teamId && isLiveAcceptedQuest(q))
        .map(toQuestView);
    },

    listTeamCompletedUnsettled(teamId: TeamId): QuestView[] {
      return listQuestsOrdered(state)
        .filter(
          (q) =>
            q.acceptedByTeamId === teamId && q.status === 'completed' && q.settlement === undefined,
        )
        .map(toQuestView);
    },

    // Player Travel Event Workflow 的窄化唯讀 Port（doc §4）：只回傳指定玩家隊目前為 incomplete、
    // 護衛角色仍存在且 onDay < actualEndDeadline 的護衛任務。Query 不建立事件、不改寫 State。
    listIncompleteEscortQuestsForPlayerTravel(
      teamId: TeamId,
      onDay: WorldDay,
    ): PlayerTravelEscortQuestRef[] {
      const out: PlayerTravelEscortQuestRef[] = [];
      for (const quest of listQuestsOrdered(state)) {
        if (quest.objective.kind !== 'escort') continue;
        if (quest.status !== 'incomplete') continue;
        if (quest.acceptedByTeamId !== teamId) continue;
        if (quest.objective.characterId === undefined) continue;
        if (onDay >= quest.actualEndDeadline) continue;
        out.push({
          questId: quest.questId,
          teamId,
          candidateId: quest.objective.candidateId,
          characterId: quest.objective.characterId,
          destinationCityId: quest.objective.destinationCityId,
          actualEndDeadline: quest.actualEndDeadline,
        });
      }
      return out;
    },

    // NPC 抽樣用：未接取、接受期限未到、且尚無其他 NPC 隊的 Claim（doc §5.1.1）。
    listNpcClaimablePostings(cityId: CityId, onDay: WorldDay): QuestView[] {
      return resolveAll(state, listQuestIdsAtGuild(state, cityId))
        .filter((q) => q.status === 'unaccepted')
        .filter((q) => onDay < q.acceptDeadline)
        .filter((q) => tryGetClaim(state, q.questId) === undefined)
        .map(toQuestView);
    },

    getNpcClaim(questId: QuestId): NpcQuestClaimView | undefined {
      const claim = tryGetClaim(state, questId);
      return claim === undefined ? undefined : toNpcQuestClaimView(claim);
    },

    // 鎮壓／討伐／救援已接取時，該地圖不得被一般刷新換掉（doc §9.2、§9.3）。
    isMapReservedForAcceptedQuest(mapId: MapInstanceId): boolean {
      return listQuestsOrdered(state).some(
        (q) => isLiveAcceptedQuest(q) && objectiveMapId(q.objective) === mapId,
      );
    },

    isContentProtected(contentId: ContentInstanceId): boolean {
      return listQuestsOrdered(state).some(
        (q) => isLiveAcceptedQuest(q) && objectiveContentIds(q.objective).includes(contentId),
      );
    },

    getQuestIdsForSource(sourceId: EntitySourceRef): QuestId[] {
      return [...sortedIds(listQuestIdsForSource(state, sourceId))];
    },

    // 結案資格（doc §5.1、不變量 4／5）：已完成、尚未歸檔、實際期限未到、同一支隊伍、原發布公會。
    canSettle(questId: QuestId, teamId: TeamId, cityId: CityId, onDay: WorldDay): boolean {
      const quest = tryGetQuest(state, questId);
      if (quest === undefined) return false;
      if (quest.status !== 'completed') return false;
      if (quest.settlement !== undefined) return false;
      if (quest.acceptedByTeamId !== teamId) return false;
      if (quest.postingGuildCityId !== cityId) return false;
      return onDay < quest.actualEndDeadline;
    },
  };
}
