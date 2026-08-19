// modules/social/state.ts
// Social 唯一可寫 Slice 的型別、初始工廠與純函式讀寫小工具（對應
// docs/00_core/architecture/23_social_module.md §1）。
//
// 設計原則：
//   * 全部為決定性純函式；不 mutate 傳入 Slice，一律回傳新物件。
//   * `playerAffinities` 不是 pair map：Key 永遠只有「非玩家真實冒險者 CharacterId」，
//     Value 永遠只代表該角色**對玩家**的好感度。不存 NPC→NPC、隊友彼此或居民關係。
//   * `playerConversationUsage` 只保留一筆：目前玩家主角在目前世界日的計數。世界日或玩家主角
//     改變時整筆替換，不累積每日歷史（doc §1 與不變量 3）。
//
// 註：contracts/social 目前只宣告靜態資料、Query、Command 與 Event，未宣告 State Slice 型別
// （與 contracts/team 相同的分工）。因此 Slice 型別權威在本檔，由 public.ts 對外轉出，
// 供 app/composition/state.ts 組成 GameState。

import type {
  CharacterId,
  InteractionId,
  PlayerAffinityRuleId,
  PlayerConversationRuleId,
  PlayerConversationUsageId,
  Revision,
  WorldDay,
} from '../../contracts/core';

export type PlayerAffinityState = Readonly<{
  adventurerId: CharacterId;
  ruleId: PlayerAffinityRuleId;
  value: number;
  revision: Revision;
}>;

export type PlayerConversationDailyUsage = Readonly<{
  usageId: PlayerConversationUsageId;
  playerCharacterId: CharacterId;
  worldDay: WorldDay;
  ruleId: PlayerConversationRuleId;
  completedCount: number;
  // 已套用過的 Interaction ID（doc 不變量 2「同一 Interaction ID 最多套用一次」、
  // 不變量 4「被拒絕、回滾或未提交的互動不消耗次數」）。
  //
  // 為什麼放在**每日用量**而不是好感度記錄上：這份帳本必須有界，否則就是一個隨遊戲長度線性成長的
  // 存檔負擔。每日完成數的上限由 Rule 給定（六次是目前的資料值），而這筆用量記錄本身就隨世界日
  // 整筆替換，所以帳本的大小天然被「一天能完成幾次對話」夾住，並在跨日時歸零。
  // Interaction ID 由交易私有 cursor 單調配發，跨日不會重現，因此歸零不會讓舊 ID 重新可套用。
  appliedInteractionIds: readonly InteractionId[];
  revision: Revision;
}>;

export type SocialState = Readonly<{
  playerAffinities: Readonly<Record<CharacterId, PlayerAffinityState>>;
  playerConversationUsage?: PlayerConversationDailyUsage;
}>;

// 空 Slice（新世界或測試起點）。好感度由 ProvisionPlayerAffinity 逐一建立。
export function createInitialSocialState(): SocialState {
  return { playerAffinities: {} };
}

// 由既有實體集合建構 Slice（fixture／存檔載入）。
export function createSocialState(
  input: Readonly<{
    affinities?: readonly PlayerAffinityState[];
    conversationUsage?: PlayerConversationDailyUsage;
  }> = {},
): SocialState {
  const playerAffinities: Record<CharacterId, PlayerAffinityState> = {};
  for (const a of input.affinities ?? []) playerAffinities[a.adventurerId] = a;
  return input.conversationUsage === undefined
    ? { playerAffinities }
    : { playerAffinities, playerConversationUsage: input.conversationUsage };
}

export function bump(r: Revision): Revision {
  return (r + 1) as Revision;
}

// ── 好感度純函式讀寫 ─────────────────────────────────────────────────────────

export function tryGetAffinity(
  state: SocialState,
  adventurerId: CharacterId,
): PlayerAffinityState | undefined {
  return state.playerAffinities[adventurerId];
}

export function upsertAffinity(state: SocialState, next: PlayerAffinityState): SocialState {
  return {
    ...state,
    playerAffinities: { ...state.playerAffinities, [next.adventurerId]: next },
  };
}

export function listAffinities(state: SocialState): readonly PlayerAffinityState[] {
  return Object.values(state.playerAffinities);
}

// 夾在 Rule 的 min／max 之間（doc 不變量 2）。min／max 皆為 Rule 資料，本函式只做結構性夾取。
export function clampAffinity(value: number, minValue: number, maxValue: number): number {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

// ── 每日對話用量純函式讀寫 ───────────────────────────────────────────────────

// 重置點由世界日（與目前玩家主角）推導，不排 Job、不存每日歷史：只有「同一玩家主角 + 同一世界日」
// 的那一筆才算今天的用量；否則今天尚無用量記錄。
export function usageForDay(
  state: SocialState,
  playerCharacterId: CharacterId,
  worldDay: WorldDay,
): PlayerConversationDailyUsage | undefined {
  const usage = state.playerConversationUsage;
  if (usage === undefined) return undefined;
  if (usage.playerCharacterId !== playerCharacterId) return undefined;
  if (usage.worldDay !== worldDay) return undefined;
  return usage;
}

// 今天尚無用量記錄 ⇒ 今天尚未完成任何對話。這是計數的起點，不是替代缺失內容的預設值
// （寫成顯式 undefined 分支而不是 `?? 0`：後者在語法上與「缺資料給預設玩法值」無法區分）。
export function completedCountForDay(
  state: SocialState,
  playerCharacterId: CharacterId,
  worldDay: WorldDay,
): number {
  const usage = usageForDay(state, playerCharacterId, worldDay);
  return usage === undefined ? 0 : usage.completedCount;
}

export function isInteractionApplied(
  state: SocialState,
  playerCharacterId: CharacterId,
  worldDay: WorldDay,
  interactionId: InteractionId,
): boolean {
  const usage = usageForDay(state, playerCharacterId, worldDay);
  return usage !== undefined && usage.appliedInteractionIds.includes(interactionId);
}

// 整筆替換當日用量（世界日或玩家主角改變時即為替換，不累積歷史）。
export function setConversationUsage(
  state: SocialState,
  usage: PlayerConversationDailyUsage,
): SocialState {
  return { ...state, playerConversationUsage: usage };
}
