// modules/quest/public.ts
// Quest 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。
// Composition 只從這裡取得工廠、Handler、Query 與 ModuleContract；不得深入 import 內部檔案。

import type {
  EventSubscriptionId,
  InvariantId,
  ModuleContract,
  ModuleId,
  ReaderPortId,
  StateSliceName,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/quest';

// ── State ─────────────────────────────────────────────────────────────────––
export {
  emptyQuestState,
  emptyObjectiveProgress,
  createInitialQuestState,
  sourceRefKey,
  tryGetQuest,
  requireQuest,
  insertQuest,
  updateQuest,
  listQuestIdsForSource,
  listQuestIdsAtGuild,
  listQuestsOrdered,
  tryGetClaim,
  setClaim,
  clearClaim,
  bumpRevision,
  objectiveMapId,
  objectiveContentIds,
  objectiveCompletionContentIds,
  objectiveCharacterId,
  withResolvedTarget,
  hasAllTargetsResolved,
  toQuestView,
  toNpcQuestClaimView,
} from './state';
export type {
  QuestState,
  QuestInstance,
  QuestObjectiveProgress,
  QuestSettlement,
  NpcQuestClaim,
} from './state';

// ── Query ─────────────────────────────────────────────────────────────────––
export { createQuestQuery } from './queries';

// ── System（Handler + Job + Subscriber + Deps）──────────────────────────────
export {
  QUEST_MODULE_ID,
  // Game Command handler
  handleAcceptQuest,
  handleSettleQuest,
  handleHandInQuestCargo,
  // Internal Command handlers
  handleAcceptQuestForNpcTeam,
  handleClaimQuestForNpcTeam,
  handleReleaseNpcQuestClaim,
  // Job handler
  handleQuestDeadline,
  // Event subscribers
  onMapContentGenerated,
  onCityStockItemAvailable,

  onMapContentResolved,
  onTeamLocationChanged,
  onCombatEncounterResolved,
  onCharacterDied,
  onCharacterCreated,
} from './system';
export type {
  QuestHandlerContext,
  QuestSettlementContext,
  QuestGenerationContext,
  QuestIdAllocator,
  QuestGenerationResolverPort,
  QuestCityPort,
  QuestHandlerResult,
  QuestTeamPort,
  QuestMapContentPort,
  QuestTemporaryCharacterPort,
} from './system';

// 公開能力與訊息登記。
export const questModuleContract: ModuleContract = {
  id: 'quest' as ModuleId<'quest'>,
  owns: 'quest' as StateSliceName,
  reads: ['reader:inventory-query' as ReaderPortId, 'reader:city-query' as ReaderPortId,
    'reader:quest-definition' as ReaderPortId,
    'reader:team-query' as ReaderPortId,
    'reader:map-content-query' as ReaderPortId,
    'reader:character-temporary-origin' as ReaderPortId,
  ],
  handlesGameCommands: ['acceptQuest', 'settleQuest', 'handInQuestCargo'],
  handlesInternalCommands: [
    'AcceptQuestForNpcTeam',
    'ClaimQuestForNpcTeam',
    'ReleaseNpcQuestClaim',
  ],
  handlesJobs: ['questDeadline'],
  // 只宣告**有 Owner** 的送出（registry 的「送出端 → Owner」交叉驗證）。
  sendsInternalCommands: ['AttachQuestTemporaryMember', 'ReserveShopOfferForQuest', 'ReleaseQuestShopOffer', 'MoveItemToTeamQuestCargo', 'TransferItem', 'RemoveItemInstance', 'ProtectMapContent', 'CreateQuestTemporaryCharacter', 'StartAssetDistribution', 'AppendAssetDistributionResult', 'FinalizeAssetDistributionCollection'],
  subscriptionHandlerIds: [
    'subscription.MapContentGenerated.quest' as EventSubscriptionId,
    'subscription.CityStockItemAvailable.quest' as EventSubscriptionId,
    'subscription.MapContentResolved.quest' as EventSubscriptionId,
    'subscription.TeamLocationChanged.quest' as EventSubscriptionId,
    'subscription.CombatEncounterResolved.quest' as EventSubscriptionId,
    'subscription.CharacterDied.quest' as EventSubscriptionId,
    'subscription.CharacterCreated.quest' as EventSubscriptionId,
  ],
  // 生成與結案事件皆由正式路徑發出。
  emits: [
    'QuestSettled',
    'QuestCreated',
    'QuestAccepted',
    'NpcQuestClaimChanged',
    'QuestStateChanged',
    'QuestObjectiveCompleted',
  ],
  invariants: [
    'quest.statusIsOneOfFour' as InvariantId,
    'quest.deadlinesImmutableAfterCreation' as InvariantId,
    'quest.actualEndNotBeforeAccept' as InvariantId,
    'quest.completedWithoutSettlementExpires' as InvariantId,
    'quest.noOrphanNpcClaim' as InvariantId,
    'quest.participantSnapshotExcludesQuestCharacters' as InvariantId,
    'quest.teamDefeatExpiresIncompleteEscorts' as InvariantId,
    'quest.playerTravelEscortQueryIsReadOnlyAndStable' as InvariantId,
  ],
};

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是模組的**正式對外面**。從這裡再匯出 fixtures 或 test runner，等於讓正式依賴圖
// 可以走到測試資料。測試請直接 import './fixtures' 與 './quest.test'。
