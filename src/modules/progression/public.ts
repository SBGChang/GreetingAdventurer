// modules/progression/public.ts
// Progression 模組 runtime API 的唯一對外入口（re-export）。
// Composition 只從這裡取得 state 工廠、handler、query，不深入子檔。

import type {
  EventSubscriptionId,
  InvariantId,
  ModuleContract,
  ModuleId,
  ReaderPortId,
  StateSliceName,
} from '../../contracts/core';

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

// ── ModuleContract 宣告 ────────────────────────────────────────────────
// Wave B 漏了這份宣告，composition 的啟動驗證因此看不到 progression 的能力。
// 事件綁定與執行順序由 Composition Manifest 唯一擁有；此處只登記本模組可提供的 Handler。
export const progressionModuleContract: ModuleContract = {
  id: 'progression' as ModuleId,
  owns: 'progression' as StateSliceName,
  reads: ['reader:progression-definition' as ReaderPortId],
  handlesGameCommands: ['learnFromBook', 'startTeaching'],
  handlesInternalCommands: [],
  handlesJobs: [],
  sendsInternalCommands: [],
  subscriptionHandlerIds: [
    'subscription.CombatAttackMasteryEarned.progression' as EventSubscriptionId,
    'subscription.CombatDefenseMasteryEarned.progression' as EventSubscriptionId,
    'subscription.CombatSupportMasteryEarned.progression' as EventSubscriptionId,
    'subscription.CharacterBorn.progression' as EventSubscriptionId,
  ],
  emits: [
    'MasteryExperienceGranted',
    'MasteryLevelChanged',
    'PrimaryAttributesChanged',
    'ProgressionCapacityChanged',
    'AutomaticKnowledgeUnlocked',
    'KnowledgeLearned',
    'TeachingSessionChanged',
  ],
  invariants: [
    'progression.levelDerivableFromCurve' as InvariantId,
    'progression.experienceMonotonic' as InvariantId,
    'progression.gatheringGrantIdempotent' as InvariantId,
  ],
};
