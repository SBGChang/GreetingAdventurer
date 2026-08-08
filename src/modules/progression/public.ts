// modules/progression/public.ts
// Progression 模組 runtime API 的唯一對外入口（re-export）。
// Composition 只從這裡取得 state 工廠、handler、query，不深入子檔。

// State slice 與工廠。
export type {
  ProgressionModuleState,
  DailyUsageCounters,
  GatheringGrantKey,
} from './state';
export {
  createInitialProgressionState,
  createCharacterProgression,
  createMasteryProgress,
  gatheringGrantKey,
  DAILY_CONVERSATION_CAP,
  DAILY_COMMERCE_CAP,
} from './state';

// 純 handler／subscriber 與成長核心。
export type { ApplyMasteryExperienceInput } from './system';
export {
  awardMasteryExperience,
  handleGrantGatheringMasteryExperience,
  handleCombatAttackMasteryEarned,
  handleCombatDefenseMasteryEarned,
  handleCombatSupportMasteryEarned,
  handleCraftingCompleted,
  handleCharacterBorn,
  computeTeachingResult,
  resolveLevel,
  masteryAttributeContribution,
  derivePrimaryAttributes,
} from './system';

// Query port。
export type { ProgressionCapacityView } from './queries';
export { makeProgressionQuery, getProgressionCapacity } from './queries';
