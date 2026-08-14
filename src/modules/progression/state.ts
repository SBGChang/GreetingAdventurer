// modules/progression/state.ts
// Progression 模組執行期 State slice 與初始工廠。
// 對應 docs/00_core/architecture/06_progression_module.md §1.1、§3。
//
// 契約 ProgressionState（progression/index.ts）是本模組「對外可見」的最小 slice：
//   characterProgress / teachingSessions / childStudySessions。
// 本檔的 ProgressionModuleState 是「具體擁有」的 slice：契約三欄 + 兩份模組私有帳本
//   - grantLedger：採集 MXP 冪等帳本（resolutionId+contributor+mastery）。
//   - dailyUsage ：玩家主角每日交流／買賣次數計數（doc §2.5 以 worldDay 為 key）。
// 兩份帳本是第一版把「冪等」與「每日上限」落到某處的最小實作；
// system.ts 的 handler 一律回傳 ModuleResult<ProgressionModuleState>，
// 其 nextSlice 結構性即滿足契約 ProgressionState。

import type { CharacterId, WorldDay } from '../../contracts/core';
import type {
  ProgressionState,
  CharacterProgression,
  MasteryProgress,
} from '../../contracts/progression';
import type { MasteryId } from '../../contracts/core';

// 採集冪等 key：`${resolutionId}|${contributorCharacterId}|${masteryId}`。
export type GatheringGrantKey = string;

// 玩家主角每日交流／買賣次數（doc §2.5：三種交流共用 6 次、買賣共用 6 次）。
export type DailyUsageCounters = Readonly<{
  conversationUses: number;
  commerceUses: number;
}>;

export const DAILY_CONVERSATION_CAP = 6;
export const DAILY_COMMERCE_CAP = 6;

// 具體擁有的 slice（契約 ProgressionState 的超集合）。
export type ProgressionModuleState = ProgressionState &
  Readonly<{
    grantLedger: Readonly<Record<GatheringGrantKey, true>>;
    dailyUsage: Readonly<Record<WorldDay, DailyUsageCounters>>;
    // 戰鬥熟練度事件冪等帳本：key = `${awardKind}:${CombatMasterySource}`。同一來源重放不再重複發放
    // （doc §7.5 要求以 CombatMasterySource 冪等）。attack/defense/support 各自成 key，同 encounter 三種不互擋。
    masteryLedger: Readonly<Record<string, true>>;
  }>;

// 空 slice：新局／新存檔起點。CharacterBorn 再逐一建立 characterProgress。
export function createInitialProgressionState(): ProgressionModuleState {
  return {
    characterProgress: {},
    teachingSessions: {},
    childStudySessions: {},
    grantLedger: {},
    dailyUsage: {},
    masteryLedger: {},
  };
}

// 新角色的空成長：所有 Mastery 為 0，主屬因此全為 0（推導值）。
export function createCharacterProgression(characterId: CharacterId): CharacterProgression {
  return {
    characterId,
    masteries: {},
    learnedKnowledgeIds: [],
    claimedExplorationRewards: [],
    revision: 0,
  };
}

// 新 Mastery 進度：Lv.0、經驗 0。
export function createMasteryProgress(masteryId: MasteryId): MasteryProgress {
  return {
    masteryId,
    experience: 0,
    level: 0,
    revision: 0,
  };
}

// 組合冪等 key。
export function gatheringGrantKey(
  resolutionId: string,
  contributorCharacterId: string,
  masteryId: string,
): GatheringGrantKey {
  return `${resolutionId}|${contributorCharacterId}|${masteryId}`;
}
