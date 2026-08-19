// contracts/quest — public contract transcribed from docs/00_core/architecture/10_quest_module.md

import type {
  DefinitionHeader,
  ResolverId,
  ExperienceAwardRuleId,
  EffectDefinitionId,
  QuestReactionRuleId,
  QuestDeadlineRuleId,
  QuestObjectiveRuleId,
  QuestRewardRuleId,
  QuestId,
  CityId,
  TeamId,
  CharacterId,
  ItemInstanceId,
  ShopOfferId,
  FacilityDefinitionId,
  EscortCandidateId,
  ContentInstanceId,
  MapInstanceId,
  AssetDistributionId,
  ActionChainId,
  EntitySourceRef,
  WorldDay,
  Revision,
  ModuleId,
  ScheduledJobBase,
} from '../core';
// Cross-module: economy owns RewardRuleId (docs/.../08_economy_module.md → src/contracts/economy).
import type { RewardRuleId } from '../economy';
// Cross-module outbound commands: 引用接收模組契約的真實型別（doc §6）。
import type { ProtectMapContent } from '../map';
import type { CreateQuestTemporaryCharacter } from '../character';

// ── 委託類型（§2.2）───────────────────────────────────────────────────
export type QuestKind =
  | 'purchase'
  | 'delivery'
  | 'escort'
  | 'rescue'
  | 'exploration'
  | 'suppression'
  | 'hunt';

// ── 靜態資料契約（§2）─────────────────────────────────────────────────
export type QuestReactionSourceKind =
  | 'monsterGroup'
  | 'boss'
  | 'kidnap'
  | 'mapItem'
  | 'cityStockItem'
  | 'escortCandidate';

export type QuestReactionRuleDefinition = DefinitionHeader & {
  sourceKind: QuestReactionSourceKind;
  questKind: QuestKind;
  creationChance: number;
  guildResolverId: ResolverId;
  deadlineRuleId: QuestDeadlineRuleId;
  objectiveRuleId: QuestObjectiveRuleId;
  rewardRuleId: QuestRewardRuleId;
};

export type QuestDeadlineRuleDefinition = DefinitionHeader & {
  acceptDurationDays: number;
  actualEndResolverId: ResolverId;
  maxCityGapCount?: number;
};

export type QuestRewardRuleDefinition = DefinitionHeader & {
  currencyRewardRuleId?: RewardRuleId; // economy
  masteryExperienceRuleId: ExperienceAwardRuleId; // progression
  reputationEffectIds?: EffectDefinitionId[]; // character
};

// Derived: doc references getQuestObjectiveRule(id): QuestObjectiveRuleDefinition
// but never specifies its body. Minimal DefinitionHeader projection with the
// owning quest kind; see report note.
export type QuestObjectiveRuleDefinition = DefinitionHeader & {
  questKind: QuestKind;
};

export interface QuestDefinitionReader {
  getQuestReactionRule(id: QuestReactionRuleId): QuestReactionRuleDefinition;
  getQuestDeadlineRule(id: QuestDeadlineRuleId): QuestDeadlineRuleDefinition;
  getQuestRewardRule(id: QuestRewardRuleId): QuestRewardRuleDefinition;
  getQuestObjectiveRule(id: QuestObjectiveRuleId): QuestObjectiveRuleDefinition;
}

// ── 狀態與目標（§3）───────────────────────────────────────────────────
export type QuestStatus = 'unaccepted' | 'incomplete' | 'completed' | 'expired';

export type QuestObjective =
  | { kind: 'purchase'; itemId: ItemInstanceId; shopOfferId: ShopOfferId }
  | {
      kind: 'delivery';
      itemId: ItemInstanceId;
      destinationCityId: CityId;
      facilityId: FacilityDefinitionId;
    }
  | {
      kind: 'escort';
      candidateId: EscortCandidateId;
      characterId?: CharacterId;
      destinationCityId: CityId;
    }
  | { kind: 'rescue'; contentId: ContentInstanceId; characterId?: CharacterId; mapId: MapInstanceId }
  | { kind: 'exploration'; itemId: ItemInstanceId; contentId: ContentInstanceId }
  | { kind: 'suppression'; mapId: MapInstanceId; targetContentIds: ContentInstanceId[] }
  | { kind: 'hunt'; mapId: MapInstanceId; bossContentIds: ContentInstanceId[] };

// Owned by quest; consumed cross-module by combat-power assessQuestFeasibility.
// Readonly projection of QuestObjective (see report note).
export type QuestObjectiveView = Readonly<QuestObjective>;

export type QuestDeadlines = Readonly<{
  acceptDeadline: WorldDay;
  actualEndDeadline: WorldDay;
}>;

// ── 公開 Query（§4）───────────────────────────────────────────────────
// Derived read model mirroring QuestInstance public prose fields (see report note).
export type QuestView = Readonly<{
  questId: QuestId;
  kind: QuestKind;
  sourceRuleId: QuestReactionRuleId;
  sourceId: EntitySourceRef;
  postingGuildCityId: CityId;
  createdOnDay: WorldDay;
  acceptDeadline: WorldDay;
  actualEndDeadline: WorldDay;
  status: QuestStatus;
  acceptedByTeamId?: TeamId;
  acceptedOnDay?: WorldDay;
  participantCharacterIds: readonly CharacterId[];
  completedOnDay?: WorldDay;
  objective: QuestObjectiveView;
  rewardRuleId: QuestRewardRuleId;
  revision: Revision;
}>;

// Derived read model mirroring NpcQuestClaim (see report note).
export type NpcQuestClaimView = Readonly<{
  questId: QuestId;
  teamId: TeamId;
  chainId: ActionChainId;
  claimedOnDay: WorldDay;
  revision: Revision;
}>;

// Derived narrow ref for the Player Travel Event escort Query port (see report note).
export type PlayerTravelEscortQuestRef = Readonly<{
  questId: QuestId;
  teamId: TeamId;
  candidateId: EscortCandidateId;
  characterId?: CharacterId;
  destinationCityId: CityId;
  actualEndDeadline: WorldDay;
}>;

export interface QuestQuery {
  getQuest(id: QuestId): QuestView;
  listGuildPostings(cityId: CityId): QuestView[];
  listTeamActiveQuests(teamId: TeamId): QuestView[];
  listTeamCompletedUnsettled(teamId: TeamId): QuestView[];
  listIncompleteEscortQuestsForPlayerTravel(
    teamId: TeamId,
    onDay: WorldDay,
  ): PlayerTravelEscortQuestRef[];
  listNpcClaimablePostings(cityId: CityId, onDay: WorldDay): QuestView[];
  getNpcClaim(questId: QuestId): NpcQuestClaimView | undefined;
  isMapReservedForAcceptedQuest(mapId: MapInstanceId): boolean;
  isContentProtected(contentId: ContentInstanceId): boolean;
  getQuestIdsForSource(sourceId: EntitySourceRef): QuestId[];
  canSettle(questId: QuestId, teamId: TeamId, cityId: CityId, onDay: WorldDay): boolean;
}

// ── 輸入契約：玩家 Game Command（§5.1）─────────────────────────────────
export type AcceptQuestCommand = Readonly<{ type: 'acceptQuest'; questId: QuestId }>;
export type SettleQuestCommand = Readonly<{ type: 'settleQuest'; questId: QuestId }>;

// 只列**已註冊**的入口（同 contracts/dungeon、contracts/inventory 的作法）。
// `settleQuest` 不在此聯集：doc §7 要求 `equalCurrencyOnly` 的 Asset Distribution 在同一筆
// EngineTransaction 內同步完成，且 QuestSettlement.rewardDistributionId 是必填欄位——沒有
// Distribution 模組就無法在不違反不變量 16 的前提下寫入 settlement。Handler 不存在、入口不出現。
export type QuestGameCommand = AcceptQuestCommand;

// ── 輸入契約：NPC Internal Command（§5.1.1）──────────────────────────────
export type AcceptQuestForNpcTeamCommand = Readonly<{
  type: 'AcceptQuestForNpcTeam';
  questId: QuestId;
  teamId: TeamId;
  chainId: ActionChainId;
}>;
export type SettleQuestForNpcTeamCommand = Readonly<{
  type: 'SettleQuestForNpcTeam';
  questId: QuestId;
  teamId: TeamId;
  chainId: ActionChainId;
}>;
export type ClaimQuestForNpcTeamCommand = Readonly<{
  type: 'ClaimQuestForNpcTeam';
  questId: QuestId;
  teamId: TeamId;
  chainId: ActionChainId;
}>;
export type ReleaseNpcQuestClaimCommand = Readonly<{
  type: 'ReleaseNpcQuestClaim';
  questId: QuestId;
  teamId: TeamId;
  chainId: ActionChainId;
}>;
// 只列**已註冊**的接收能力。`SettleQuestForNpcTeam` 與玩家的 `settleQuest` 同一條結案流程，
// 因此同樣不出現（見上方說明）。
export type QuestInternalCommand =
  | AcceptQuestForNpcTeamCommand
  | ClaimQuestForNpcTeamCommand
  | ReleaseNpcQuestClaimCommand;

// Quest **送出**的 Internal Command：一律引用接收模組契約的真實型別，不自行複寫欄位。
// 只列已註冊 Handler 送得出去的那幾筆——送一個沒有 Owner 的命令等於保證那條流程跑不完
// （registry 的「送出端 → Owner」交叉驗證會擋）。
export type QuestOutboundInternalCommand = ProtectMapContent | CreateQuestTemporaryCharacter;

// ── ScheduledJob（§5.2）───────────────────────────────────────────────
export type QuestDeadlineJobKind = 'accept' | 'actualEnd';
export type QuestDeadlineJobPayload = Readonly<{ kind: QuestDeadlineJobKind }>;
export type QuestDeadlineJob = ScheduledJobBase<
  'questDeadline',
  ModuleId,
  QuestId,
  QuestDeadlineJobPayload
>;

// 全模組 Job 聯集（app/composition/state.ts 的 GameScheduledJob 引用此別名）。
export type QuestScheduledJob = QuestDeadlineJob;

// ── 輸出事件（§7）─────────────────────────────────────────────────────
export type NpcQuestClaimState = 'claimed' | 'released';
export type QuestStateChangeReason =
  | 'acceptDeadline'
  | 'actualEndDeadline'
  | 'combatDefeat'
  | 'targetDied'
  | 'completedUnsettled'
  | 'contentUnavailable';

export type QuestCreatedPayload = Readonly<{
  type: 'QuestCreated';
  questId: QuestId;
  kind: QuestKind;
  sourceId: EntitySourceRef;
  deadlines: QuestDeadlines;
}>;
export type QuestAcceptedPayload = Readonly<{
  type: 'QuestAccepted';
  questId: QuestId;
  teamId: TeamId;
  acceptedOnDay: WorldDay;
}>;
export type NpcQuestClaimChangedPayload = Readonly<{
  type: 'NpcQuestClaimChanged';
  questId: QuestId;
  teamId?: TeamId;
  chainId?: ActionChainId;
  state: NpcQuestClaimState;
}>;
export type QuestStateChangedPayload = Readonly<{
  type: 'QuestStateChanged';
  questId: QuestId;
  oldStatus: QuestStatus;
  newStatus: QuestStatus;
  reason: QuestStateChangeReason;
}>;
export type QuestObjectiveCompletedPayload = Readonly<{
  type: 'QuestObjectiveCompleted';
  questId: QuestId;
  completedOnDay: WorldDay;
}>;
export type QuestSettledPayload = Readonly<{
  type: 'QuestSettled';
  questId: QuestId;
  teamId: TeamId;
  beneficiaryCharacterIds: readonly CharacterId[];
  guildCityId: CityId;
  kind: QuestKind;
  masteryExperienceRuleId: ExperienceAwardRuleId;
}>;

export type QuestDomainEvent =
  | ({ type: 'QuestCreated' } & QuestCreatedPayload)
  | ({ type: 'QuestAccepted' } & QuestAcceptedPayload)
  | ({ type: 'NpcQuestClaimChanged' } & NpcQuestClaimChangedPayload)
  | ({ type: 'QuestStateChanged' } & QuestStateChangedPayload)
  | ({ type: 'QuestObjectiveCompleted' } & QuestObjectiveCompletedPayload)
  | ({ type: 'QuestSettled' } & QuestSettledPayload);

// ── 結案歸檔（§3.2）───────────────────────────────────────────────────
export type QuestSettlementView = Readonly<{
  settledOnDay: WorldDay;
  settledAtCityId: CityId;
  settledByTeamId: TeamId;
  beneficiaryCharacterIds: readonly CharacterId[];
  rewardDistributionId: AssetDistributionId;
}>;
