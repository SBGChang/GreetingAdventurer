// modules/combat/public.ts
// Combat 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。

import type {
  ModuleContract,
  ModuleId,
  StateSliceName,
  ReaderPortId,
  EventSubscriptionId,
  InvariantId,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/combat';

// State slice、工廠與實體型別。
export type {
  CombatState,
  CombatEncounter,
  CombatantState,
  CombatGridState,
  CounterStanceInstance,
  CastingInstance,
  CombatantSource,
  DefenseFormationEntry,
} from './state';
export {
  createInitialCombatState,
  cellKey,
  localCell,
  emptyGrid,
  rebuildGrid,
  tryGetEncounter,
  requireEncounter,
  upsertEncounter,
} from './state';

// 純 handler / scheduler。
export {
  COMBAT_MODULE_ID,
  handleStartCombatEncounter,
  handleUseCombatSkill,
  handleUseCombatItem,
  handleCommandAlly,
  handleCombatRest,
  handleEnemyTurn,
  advanceToNextActor,
} from './system';
export type {
  CombatHandlerContext,
  CombatIdAllocator,
  CombatLoadoutQuery,
  CombatFormationQuery,
  CombatFormationSnapshot,
  CombatFormationMember,
  CombatResolverPort,
  CombatPowerInput,
  EnemyActionChoice,
} from './system';

// Query port。
export { makeCombatQuery } from './queries';

// ── ModuleContract 宣告（事件綁定順序由 Composition Manifest 決定；此處只登記能力）──
export const combatModuleContract: ModuleContract = {
  id: 'combat' as ModuleId,
  owns: 'combat' as StateSliceName,
  reads: [
    'reader:combat-definitions' as ReaderPortId,
    'reader:progression-query' as ReaderPortId,
    'reader:inventory-loadout' as ReaderPortId,
    'reader:combat-formation' as ReaderPortId,
    'reader:combat-power' as ReaderPortId,
  ],
  handlesGameCommands: ['useCombatSkill', 'useCombatItem', 'commandAlly', 'combatRest'],
  handlesInternalCommands: ['StartCombatEncounter'],
  handlesJobs: [],
  // Wave B 未實作任何 subscriber 函式（CombatItemUseCommitted / EquipmentChanged /
  // KnowledgeLearned / CharacterDied / CharacterAvailabilityChanged 皆待補）。
  // 只在實作後才登記，否則啟動驗證會放行一個不存在的 Handler。
  subscriptionHandlerIds: [] as readonly EventSubscriptionId[],
  emits: [
    'CombatEncounterStarted',
    'CombatActionResolved',
    'CombatEncounterResolved',
    'CombatTeamOutcome',
    'CombatAttackMasteryEarned',
    'CombatDefenseMasteryEarned',
    'CombatSupportMasteryEarned',
  ],
  invariants: [
    'combat.activeCombatantOccupiesFootprint' as InvariantId,
    'combat.bossImpliesLarge3x3' as InvariantId,
    'combat.allActionsAreSkillDriven' as InvariantId,
    'combat.ctbSubtractDownPlayerTiesFirst' as InvariantId,
    'combat.frontRowBackfillOnly' as InvariantId,
    'combat.counterResolvesOnceOnCondition' as InvariantId,
    'combat.resolveIsAtomicAndOnce' as InvariantId,
  ],
};
