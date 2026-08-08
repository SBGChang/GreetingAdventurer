// modules/character/public.ts
// Character 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。

import type {
  ModuleContract,
  ModuleId,
  StateSliceName,
  ReaderPortId,
  EventSubscriptionId,
  InvariantId,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/character';

// 執行期 API。
export {
  emptyCharacterState,
  createCharacterState,
  tryGetCharacter,
  requireCharacter,
  upsertCharacter,
  upsertFamilyLink,
  upsertRelationshipFact,
  ageDaysOf,
} from './state';

export { createCharacterQuery } from './queries';

export {
  CHARACTER_MODULE_ID,
  // Internal Command handlers
  handleApplyCombatCondition,
  handleApplyCharacterReputationEffect,
  handleCreatePartnerFamilyLink,
  handleOpenCharacterRelationshipFact,
  handleResolveCharacterRelationshipFact,
  handleCreateQuestTemporaryCharacter,
  handleCreateWorldAdventurerBatch,
  handleApplyContentEventStatus,
  handleApplyFoodStatusEffects,
  // Job handler
  handleCharacterLifecycleJob,
  // Event subscribers
  onFacilityRestCompleted,
  onHomeYearRestCompleted,
  onQuestStateChanged,
  onStatsCapacityChanged,
} from './system';

export type {
  CharacterHandlerContext,
  CharacterIdAllocator,
  CharacterResolverPort,
  CharacterDomainEvent,
  LifecycleDecision,
  BirthDecision,
  WorldAdventurerDraft,
} from './system';

// ── ModuleContract 宣告（handler／事件綁定順序由 Composition Manifest 決定，這裡只登記能力）──
export const characterModuleContract: ModuleContract = {
  id: CHARACTER_MODULE_ID_VALUE(),
  owns: 'character' as StateSliceName,
  reads: ['reader:character-stats' as ReaderPortId],
  handlesGameCommands: [],
  handlesInternalCommands: [
    'ApplyCombatCondition',
    'ApplyCharacterReputationEffect',
    'CreatePartnerFamilyLink',
    'OpenCharacterRelationshipFact',
    'ResolveCharacterRelationshipFact',
    'CreateQuestTemporaryCharacter',
    'CreateWorldAdventurerBatch',
    'ApplyContentEventStatus',
    'ApplyFoodStatusEffects',
  ],
  handlesJobs: ['characterLifecycleDue'],
  subscriptionHandlerIds: [
    'sub:character/FacilityRestCompleted' as EventSubscriptionId,
    'sub:character/HomeYearRestCompleted' as EventSubscriptionId,
    'sub:character/QuestStateChanged' as EventSubscriptionId,
    'sub:character/ProgressionCapacityChanged' as EventSubscriptionId,
    'sub:character/EquipmentChanged' as EventSubscriptionId,
  ],
  emits: [
    'CharacterCreated',
    'CharacterAvailabilityChanged',
    'CharacterConditionChanged',
    'CharacterDied',
    'CharacterBorn',
    'CharacterBecameAdult',
    'CharacterRetired',
    'TemporaryCharacterRecovered',
    'CharacterReputationChanged',
    'CharacterRelationshipChanged',
    'FamilyLinkChanged',
  ],
  invariants: [
    'character.birthAndParentsImmutable' as InvariantId,
    'character.deadImpliesUnavailable' as InvariantId,
    'character.singleActivePartner' as InvariantId,
    'character.conditionNonNegativeAndCapped' as InvariantId,
    'character.noFatigueResource' as InvariantId,
  ],
};

function CHARACTER_MODULE_ID_VALUE(): ModuleId {
  return 'character' as ModuleId;
}
