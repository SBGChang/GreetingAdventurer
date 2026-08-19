// modules/quest/state.ts
// Quest 唯一可寫 Slice 的型別、初始工廠與純函式結構 helper（docs/00_core/architecture/10_quest_module.md §1.1、§3）。
//
// 設計原則：
//   * 全部為決定性純函式；不 mutate 傳入 Slice，一律回傳新物件。
//   * 三個索引（公會佈告／來源內容／NPC Claim）與 quests 同時維護，讀取端不重算。
//   * Slice 型別住在模組而非 contracts：contracts/quest 只宣告公開讀模型（QuestView…），
//     QuestInstance 的內部欄位（deadlineRolls／progress／settlement）不對外。

import type {
  ActionChainId,
  CharacterId,
  CityId,
  ContentInstanceId,
  EntitySourceRef,
  MapInstanceId,
  QuestId,
  QuestReactionRuleId,
  QuestRewardRuleId,
  Revision,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type {
  NpcQuestClaimView,
  QuestKind,
  QuestObjective,
  QuestSettlementView,
  QuestStatus,
  QuestView,
} from '../../contracts/quest';

// ──────────────────────────────────────────────────────────────────────────
// Slice 型別（doc §1.1、§3.1）
// ──────────────────────────────────────────────────────────────────────────

// 目標達成的累計。判定一律來自 Domain Event（doc §5.3），不查別的模組 State，
// 因此「已經打倒哪幾隻／人救出來了沒有」必須存在 Quest 自己的 Slice 裡。
export type QuestObjectiveProgress = Readonly<{
  // suppression／hunt：已 resolved 的目標內容（去重、依 ContentInstanceId 排序，決定性）。
  resolvedTargetContentIds: readonly ContentInstanceId[];
  // rescue：綁定的被擄內容已被處理成功的那一日；離圖後才轉 completed（doc §8）。
  captiveRescuedOnDay?: WorldDay;
}>;

export const emptyObjectiveProgress: QuestObjectiveProgress = Object.freeze({
  resolvedTargetContentIds: Object.freeze([]) as readonly ContentInstanceId[],
});

// doc §3.2：settlement 不是第五種狀態；結案後 status 仍為 completed。
export type QuestSettlement = QuestSettlementView;

export type QuestInstance = Readonly<{
  questId: QuestId;
  kind: QuestKind;
  sourceRuleId: QuestReactionRuleId;
  sourceId: EntitySourceRef;
  postingGuildCityId: CityId;

  createdOnDay: WorldDay;
  acceptDeadline: WorldDay;
  actualEndDeadline: WorldDay;
  // 距離 RNG 在建立時一次確定（doc §2.4）；接取不重抽、不延長（不變量 2）。
  deadlineRolls: readonly number[];

  status: QuestStatus;
  acceptedByTeamId?: TeamId;
  acceptedOnDay?: WorldDay;
  // 接取時的正式成員快照；不含任務角色（不變量 11、17）。
  participantCharacterIds: readonly CharacterId[];
  completedOnDay?: WorldDay;
  settlement?: QuestSettlement;

  objective: QuestObjective;
  progress: QuestObjectiveProgress;
  rewardRuleId: QuestRewardRuleId;
  revision: Revision;
}>;

export type NpcQuestClaim = Readonly<{
  questId: QuestId;
  teamId: TeamId;
  chainId: ActionChainId;
  claimedOnDay: WorldDay;
  revision: Revision;
}>;

export type QuestState = Readonly<{
  quests: Readonly<Record<QuestId, QuestInstance>>;
  guildPostingIndex: Readonly<Record<CityId, readonly QuestId[]>>;
  // key 為 EntitySourceRef 序列化字串（doc §1.1）。
  sourceContentIndex: Readonly<Record<string, readonly QuestId[]>>;
  npcClaims: Readonly<Record<QuestId, NpcQuestClaim>>;
}>;

// ──────────────────────────────────────────────────────────────────────────
// 建構
// ──────────────────────────────────────────────────────────────────────────

export const emptyQuestState: QuestState = Object.freeze({
  quests: Object.freeze({}),
  guildPostingIndex: Object.freeze({}),
  sourceContentIndex: Object.freeze({}),
  npcClaims: Object.freeze({}),
}) as QuestState;

// EntitySourceRef 是多種 branded string 的聯集；索引鍵取其字串值即可唯一。
export function sourceRefKey(sourceId: EntitySourceRef): string {
  return String(sourceId);
}

// 由既有實體集合建構 Slice（存檔載入／測試 fixture）。索引一律由 quests 推導，不另外傳入，
// 避免「索引與本體不一致」這種只在特定讀取路徑才顯現的壞狀態。
export function createInitialQuestState(
  input: Readonly<{
    quests?: readonly QuestInstance[];
    npcClaims?: readonly NpcQuestClaim[];
  }> = {},
): QuestState {
  const quests: Record<QuestId, QuestInstance> = {};
  const guildPostingIndex: Record<CityId, QuestId[]> = {};
  const sourceContentIndex: Record<string, QuestId[]> = {};

  for (const quest of input.quests ?? []) {
    quests[quest.questId] = quest;
    (guildPostingIndex[quest.postingGuildCityId] ??= []).push(quest.questId);
    (sourceContentIndex[sourceRefKey(quest.sourceId)] ??= []).push(quest.questId);
  }

  const npcClaims: Record<QuestId, NpcQuestClaim> = {};
  for (const claim of input.npcClaims ?? []) npcClaims[claim.questId] = claim;

  return { quests, guildPostingIndex, sourceContentIndex, npcClaims };
}

// ──────────────────────────────────────────────────────────────────────────
// Quest 純函式讀寫
// ──────────────────────────────────────────────────────────────────────────

export function tryGetQuest(state: QuestState, questId: QuestId): QuestInstance | undefined {
  return state.quests[questId];
}

export function requireQuest(state: QuestState, questId: QuestId): QuestInstance {
  const found = state.quests[questId];
  if (found === undefined) {
    throw new Error(`QuestState: unknown questId "${String(questId)}"`);
  }
  return found;
}

// 既有 Quest 的更新（不建立索引項；建立走 insertQuest）。
export function updateQuest(state: QuestState, next: QuestInstance): QuestState {
  return { ...state, quests: { ...state.quests, [next.questId]: next } };
}

// 新 Quest 進入 Slice：同時登記兩個索引。
export function insertQuest(state: QuestState, next: QuestInstance): QuestState {
  const postings = state.guildPostingIndex[next.postingGuildCityId] ?? [];
  const sourceKey = sourceRefKey(next.sourceId);
  const sourced = state.sourceContentIndex[sourceKey] ?? [];
  return {
    ...state,
    quests: { ...state.quests, [next.questId]: next },
    guildPostingIndex: postings.includes(next.questId)
      ? state.guildPostingIndex
      : { ...state.guildPostingIndex, [next.postingGuildCityId]: [...postings, next.questId] },
    sourceContentIndex: sourced.includes(next.questId)
      ? state.sourceContentIndex
      : { ...state.sourceContentIndex, [sourceKey]: [...sourced, next.questId] },
  };
}

export function listQuestIdsForSource(
  state: QuestState,
  sourceId: EntitySourceRef,
): readonly QuestId[] {
  return state.sourceContentIndex[sourceRefKey(sourceId)] ?? [];
}

export function listQuestIdsAtGuild(state: QuestState, cityId: CityId): readonly QuestId[] {
  return state.guildPostingIndex[cityId] ?? [];
}

// 全表掃描的唯一入口：一律以 QuestId 排序輸出，讓 Query 與 Subscriber 的走訪順序穩定
// （不變量 19 要求相同 State／Day 下輸出順序穩定；Object.values 的插入序不是契約）。
export function listQuestsOrdered(state: QuestState): readonly QuestInstance[] {
  return Object.keys(state.quests)
    .sort()
    .map((id) => state.quests[id as QuestId])
    .filter((q): q is QuestInstance => q !== undefined);
}

export function bumpRevision(revision: Revision): Revision {
  return (revision + 1) as Revision;
}

// ──────────────────────────────────────────────────────────────────────────
// NPC Claim 純函式讀寫（doc §3.1：一筆 unaccepted Quest 最多一筆 Claim）
// ──────────────────────────────────────────────────────────────────────────

export function tryGetClaim(state: QuestState, questId: QuestId): NpcQuestClaim | undefined {
  return state.npcClaims[questId];
}

export function setClaim(state: QuestState, claim: NpcQuestClaim): QuestState {
  return { ...state, npcClaims: { ...state.npcClaims, [claim.questId]: claim } };
}

export function clearClaim(state: QuestState, questId: QuestId): QuestState {
  if (state.npcClaims[questId] === undefined) return state;
  const npcClaims = { ...state.npcClaims };
  delete npcClaims[questId];
  return { ...state, npcClaims };
}

// ──────────────────────────────────────────────────────────────────────────
// Objective 純結構小工具（doc §3.3）
// ──────────────────────────────────────────────────────────────────────────

// 目標綁定的地圖（購買／送貨沒有地圖）。
export function objectiveMapId(objective: QuestObjective): MapInstanceId | undefined {
  switch (objective.kind) {
    case 'rescue':
    case 'suppression':
    case 'hunt':
      return objective.mapId;
    default:
      return undefined;
  }
}

// 目標綁定的全部內容 ID（保護與「這筆事件是不是我的目標」判定共用）。
export function objectiveContentIds(objective: QuestObjective): readonly ContentInstanceId[] {
  switch (objective.kind) {
    case 'rescue':
      return [objective.contentId];
    case 'exploration':
      return [objective.contentId];
    case 'suppression':
      return objective.targetContentIds;
    case 'hunt':
      return objective.bossContentIds;
    default:
      return [];
  }
}

// 需要全部 resolved 才算完成的目標內容（doc §8：鎮壓＝全部怪群、討伐＝全部 Boss）。
export function objectiveCompletionContentIds(
  objective: QuestObjective,
): readonly ContentInstanceId[] {
  switch (objective.kind) {
    case 'suppression':
      return objective.targetContentIds;
    case 'hunt':
      return objective.bossContentIds;
    default:
      return [];
  }
}

// 護衛／救援綁定的任務角色（Quest 擁有的關聯，不是 Team Member；doc §3.3）。
export function objectiveCharacterId(objective: QuestObjective): CharacterId | undefined {
  switch (objective.kind) {
    case 'escort':
    case 'rescue':
      return objective.characterId;
    default:
      return undefined;
  }
}

// 把已 resolved 的目標內容併入 progress（去重 + 排序，重播結果一致）。
export function withResolvedTarget(
  progress: QuestObjectiveProgress,
  contentId: ContentInstanceId,
): QuestObjectiveProgress {
  if (progress.resolvedTargetContentIds.includes(contentId)) return progress;
  const merged = [...progress.resolvedTargetContentIds, contentId].sort();
  return { ...progress, resolvedTargetContentIds: merged };
}

export function hasAllTargetsResolved(quest: QuestInstance): boolean {
  const required = objectiveCompletionContentIds(quest.objective);
  if (required.length === 0) return false;
  return required.every((id) => quest.progress.resolvedTargetContentIds.includes(id));
}

// ──────────────────────────────────────────────────────────────────────────
// 公開讀模型投影（doc §4：UI 不自行重算）
// ──────────────────────────────────────────────────────────────────────────

export function toQuestView(quest: QuestInstance): QuestView {
  return {
    questId: quest.questId,
    kind: quest.kind,
    sourceRuleId: quest.sourceRuleId,
    sourceId: quest.sourceId,
    postingGuildCityId: quest.postingGuildCityId,
    createdOnDay: quest.createdOnDay,
    acceptDeadline: quest.acceptDeadline,
    actualEndDeadline: quest.actualEndDeadline,
    status: quest.status,
    ...(quest.acceptedByTeamId === undefined ? {} : { acceptedByTeamId: quest.acceptedByTeamId }),
    ...(quest.acceptedOnDay === undefined ? {} : { acceptedOnDay: quest.acceptedOnDay }),
    participantCharacterIds: quest.participantCharacterIds,
    ...(quest.completedOnDay === undefined ? {} : { completedOnDay: quest.completedOnDay }),
    objective: quest.objective,
    rewardRuleId: quest.rewardRuleId,
    revision: quest.revision,
  };
}

export function toNpcQuestClaimView(claim: NpcQuestClaim): NpcQuestClaimView {
  return {
    questId: claim.questId,
    teamId: claim.teamId,
    chainId: claim.chainId,
    claimedOnDay: claim.claimedOnDay,
    revision: claim.revision,
  };
}
