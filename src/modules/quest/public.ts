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
  // Internal Command handlers
  handleAcceptQuestForNpcTeam,
  handleClaimQuestForNpcTeam,
  handleReleaseNpcQuestClaim,
  // Job handler
  handleQuestDeadline,
  // Event subscribers
  onMapContentResolved,
  onTeamLocationChanged,
  onCombatEncounterResolved,
  onCharacterDied,
  onCharacterCreated,
} from './system';
export type {
  QuestHandlerContext,
  QuestHandlerResult,
  QuestTeamPort,
  QuestMapContentPort,
  QuestTemporaryCharacterPort,
} from './system';

// ── ModuleContract 宣告（doc §11 交接清單對照）───────────────────────────────
//
// 這裡宣告的是「對外開放什麼」，而不是「寫了什麼」。未閉合的能力不出現：
//
//   settleQuest / SettleQuestForNpcTeam
//       原公會結案必須在同一筆 EngineTransaction 內同步完成 equalCurrencyOnly 的 Asset
//       Distribution（doc §7、不變量 16），而 QuestSettlement.rewardDistributionId 是必填。
//       兩個資料缺口讓它現在寫不出來，且都不是「多寫幾行」能解決的：
//         1. StartAssetDistribution 要 AssetDistributionRuleId，但 Quest 的四個 Definition
//            家族都沒有欄位指向它——只能在 Handler 裡寫死一個內容 ID，而那正是門禁擋的東西。
//         2. AppendAssetDistributionResult 要**已解析**的 currencyInputs: MoneyValue[]，
//            而 Quest 不算錢（doc §2.5）。從 QuestRewardRuleDefinition.currencyRewardRuleId
//            到金額之間沒有 Quest 可用的命令／事件通道，同步 Port 又被慣例禁止。
//       兩者都要補 Schema／流程（見回報），故整條結案流程不註冊，Handler 也不撰寫。
//
//   委託生成（MapContentGenerated / CityStockItemAvailable / EscortCandidatesGenerated）
//       QuestDefinitionReader 沒有「依 sourceKind 找出適用 Reaction Rule」的入口；
//       guildResolver／actualEndResolver 需要城市距離（world／city Query），兩個模組都不在
//       註冊表。缺這些就只能在 Handler 裡自己決定公會與期限，那是把內容搬進程式。
//
//   CombatSequenceChallengeResolved（簡易戰鬥節點失敗 → 護衛到期，doc §5.3、不變量 18）
//       combat-sequence 模組不在註冊表，事件不存在於 GameDomainEvent 聯集。
//
//   ShopOfferSold / InventoryTransferred / ItemInstanceCreated（purchase／delivery／
//   exploration 的目標追蹤）
//       這三種 kind 的清理流程缺 Handler（見 system.ts 的 MISSING_ACCEPT_DEPENDENCY 與
//       MISSING_ACCEPTED_EXPIRY_CLEANUP），接取端已回 typed rejection，因此不需要也不應該
//       登記它們的目標追蹤訂閱。ShopOfferSold 另外還缺 city 模組的事件註冊。
export const questModuleContract: ModuleContract = {
  id: 'quest' as ModuleId<'quest'>,
  owns: 'quest' as StateSliceName,
  reads: [
    'reader:quest-definition' as ReaderPortId,
    'reader:team-query' as ReaderPortId,
    'reader:map-content-query' as ReaderPortId,
    'reader:character-temporary-origin' as ReaderPortId,
  ],
  handlesGameCommands: ['acceptQuest'],
  handlesInternalCommands: [
    'AcceptQuestForNpcTeam',
    'ClaimQuestForNpcTeam',
    'ReleaseNpcQuestClaim',
  ],
  handlesJobs: ['questDeadline'],
  // 只宣告**有 Owner** 的送出（registry 的「送出端 → Owner」交叉驗證）。
  sendsInternalCommands: ['ProtectMapContent', 'CreateQuestTemporaryCharacter'],
  subscriptionHandlerIds: [
    'subscription.MapContentResolved.quest' as EventSubscriptionId,
    'subscription.TeamLocationChanged.quest' as EventSubscriptionId,
    'subscription.CombatEncounterResolved.quest' as EventSubscriptionId,
    'subscription.CharacterDied.quest' as EventSubscriptionId,
    'subscription.CharacterCreated.quest' as EventSubscriptionId,
  ],
  // QuestCreated 由生成路徑發出、QuestSettled 由結案路徑發出；兩者都未註冊，故不宣告。
  emits: ['QuestAccepted', 'NpcQuestClaimChanged', 'QuestStateChanged', 'QuestObjectiveCompleted'],
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
