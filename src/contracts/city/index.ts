// contracts/city — City 模組公開契約（純型別）。
// 來源：docs/00_core/architecture/09_city_module.md
// 僅含型別／介面：Definition、Query port、ScheduledJob、Game/Internal Command、DomainEvent payload。

import type {
  DefinitionId,
  DefinitionHeader,
  ModuleId,
  ScheduledJobBase,
  ResolverId,
  EffectDefinitionId,
  WorldDay,
  Revision,
  CityId,
  ShopOfferId,
  IntelLeadId,
  EscortCandidateId,
  HomeId,
  HomeTeachingPostId,
  FacilityDefinitionId,
  ItemInstanceId,
  QuestId,
  TeamId,
  CharacterId,
  ContentInstanceId,
  CharacterArchetypeId,
  PlayerCommerceUsageId,
  PriceRuleId,
  ShopRuleId,
  IntelRuleId,
  EscortGenerationRuleId,
  HomeRuleId,
  HomeUpgradeDefinitionId,
  CityActionRuleId,
  PopulationSupplyRuleId,
  PlayerCommerceDailyLimitId,
  PlayerCommercePracticeRuleId,
  ExperienceAwardRuleId,
  WorldAdventurerGenerationRuleId,
  MasteryId,
  CultureId,
  EntitySourceRef,
} from '../core';

// ── City 需要但未列於 contracts/core 的型別 ────────────────────────────────
// 物品池 ID：概念上由內容／inventory 模組擁有；contracts/core 尚未提供，provisional 本地宣告。
export type ItemPoolId = DefinitionId<'item-pool'>;

export type FacilityKind =
  | 'inn'
  | 'tavern'
  | 'adventurerGuild'
  | 'itemShop'
  | 'equipmentShop'
  | 'trainingGround'
  | 'bookstore'
  | 'adventureCheckpoint'
  | 'cityGate'
  | 'home';

export type ShopKind = 'item' | 'equipment' | 'book';

// ── §2 靜態資料契約 ────────────────────────────────────────────────────────

export type CityDefinition = DefinitionHeader & {
  worldCityId: CityId;
  facilityIds: FacilityDefinitionId[];
  shopRuleIds: ShopRuleId[];
  intelRuleId: IntelRuleId;
  escortGenerationRuleId: EscortGenerationRuleId;
  homeRuleId: HomeRuleId;
  populationSupplyRuleId: PopulationSupplyRuleId;
  playerCommerceDailyLimitId: PlayerCommerceDailyLimitId;
  playerCommercePracticeRuleId: PlayerCommercePracticeRuleId;
};

export type FacilityDefinition = DefinitionHeader<FacilityDefinitionId> & {
  kind: FacilityKind;
  actionRuleIds: CityActionRuleId[];
  teacherMasteryLevel?: number; // 城鎮教師第一版固定為 5
};

export type PlayerCommerceDailyLimitDefinition = DefinitionHeader<PlayerCommerceDailyLimitId> & {
  maxCommerceInteractionsPerDay: 6;
};

export type PlayerCommercePracticeRuleDefinition = DefinitionHeader<PlayerCommercePracticeRuleId> & {
  commerceExperienceRuleId: ExperienceAwardRuleId;
};

export type ShopRuleDefinition = DefinitionHeader<ShopRuleId> & {
  shopKind: ShopKind;
  refreshCadenceDays: number;
  refreshOffsetDays: number;
  permanentStockOfferCount: { min: number; max: number }; // 第一版 1..2
  baseCatalogPoolId?: ItemPoolId;
  priceRuleId: PriceRuleId;
  clearPlayerSoldOnRefresh: boolean;
};

export type EscortGenerationRuleDefinition = DefinitionHeader<EscortGenerationRuleId> & {
  cadenceDays: 7;
  cityOffsetDays: number; // 0..6
  candidateCount: { min: 0; max: 5 };
  allowedArchetypeIds: CharacterArchetypeId[];
  destinationResolverId: ResolverId;
  deadlineResolverId?: ResolverId;
};

export type PopulationSupplyRuleDefinition = DefinitionHeader<PopulationSupplyRuleId> & {
  cadenceDays: number;
  cityOffsetDays: number;
  targetCountResolverId: ResolverId;
  batchLimit: number;
  adventurerGenerationRuleId: WorldAdventurerGenerationRuleId;
};

export type CityActionRuleDefinition = DefinitionHeader<CityActionRuleId> & {
  kind: 'innRest' | 'masteryTraining' | 'homeRest' | 'homeYearRest';
  scope: 'member' | 'team';
  durationDays: number;
  requiredFacilityKind: FacilityKind;
  completionResolverId: ResolverId;
};

export type HomeRuleDefinition = DefinitionHeader<HomeRuleId> & {
  purchasableSlotCounts: number[];
  purchasePriceRuleIds: Record<number, PriceRuleId>;
  initialUpgradeIds: HomeUpgradeDefinitionId[]; // 房間、倉庫
  allowedUpgradeIds: HomeUpgradeDefinitionId[];
};

export type HomeUpgradeDefinition = DefinitionHeader<HomeUpgradeDefinitionId> & {
  kind:
    | 'room'
    | 'storage'
    | 'educationRoom'
    | 'forge'
    | 'medicineRoom'
    | 'receptionRoom'
    | 'displayRoom'
    | 'musicHall';
  slotCost: number;
  actionRuleIds: CityActionRuleId[];
  priceRuleId?: PriceRuleId;
};

export interface CityDefinitionReader {
  getCity(id: CityId): CityDefinition;
  getFacility(id: FacilityDefinitionId): FacilityDefinition;
  getShopRule(id: ShopRuleId): ShopRuleDefinition;
  getIntelRule(id: IntelRuleId): IntelRuleDefinition;
  getEscortGenerationRule(id: EscortGenerationRuleId): EscortGenerationRuleDefinition;
  getHomeRule(id: HomeRuleId): HomeRuleDefinition;
  getHomeUpgrade(id: HomeUpgradeDefinitionId): HomeUpgradeDefinition;
  getCityActionRule(id: CityActionRuleId): CityActionRuleDefinition;
  getPopulationSupplyRule(id: PopulationSupplyRuleId): PopulationSupplyRuleDefinition;
  getPlayerCommerceDailyLimit(id: PlayerCommerceDailyLimitId): PlayerCommerceDailyLimitDefinition;
  getPlayerCommercePracticeRule(id: PlayerCommercePracticeRuleId): PlayerCommercePracticeRuleDefinition;
}

// IntelRuleDefinition doc 未提供欄位形狀（僅由 reader 引用）；保留 Definition 標頭佔位。
export type IntelRuleDefinition = DefinitionHeader<IntelRuleId> & {
  resolverId: ResolverId;
};

// ── §3 Runtime State ───────────────────────────────────────────────────────

export type FacilityRuntimeState = {
  facilityId: FacilityDefinitionId;
  availability: 'open' | 'restricted' | 'closed';
  restrictionReason?: string;
  revision: Revision;
};

export type CityRuntimeState = {
  cityId: CityId;
  facilityStates: Record<FacilityDefinitionId, FacilityRuntimeState>;
  prosperity: number;
  safety: number;
  revision: Revision;
};

export type ShopOffer = {
  offerId: ShopOfferId;
  cityId: CityId;
  facilityId: FacilityDefinitionId;
  itemId: ItemInstanceId;
  source: 'permanentStock' | 'baseCatalog' | 'playerSold';
  priceRuleId: PriceRuleId;
  state: 'available' | 'sold' | 'expired';
  sourceQuestId?: QuestId;
  createdOnDay: WorldDay;
  expiresOnDay?: WorldDay;
  revision: Revision;
};

export type IntelLead = {
  intelId: IntelLeadId;
  cityId: CityId;
  sourceContentId: ContentInstanceId;
  kind: 'mapItem' | 'kidnap' | 'boss' | 'monsterControl' | 'other';
  state: 'available' | 'revealed' | 'obsolete';
  revealedToTeamIds: TeamId[];
  revision: Revision;
};

export type EscortCandidate = {
  candidateId: EscortCandidateId;
  originCityId: CityId;
  destinationCityId: CityId;
  archetypeId: CharacterArchetypeId;
  generatedOnDay: WorldDay;
  acceptDeadline: WorldDay;
  actualEndDeadline: WorldDay;
  state: 'available' | 'convertedToQuest' | 'expired';
  revision: Revision;
};

export type HomeInstance = {
  homeId: HomeId;
  cityId: CityId;
  ownerCharacterId: CharacterId;
  slotCapacity: number;
  installedUpgradeIds: HomeUpgradeDefinitionId[];
  state: 'owned' | 'inheritancePending' | 'transferred';
  revision: Revision;
};

export type HomeTeachingPost = {
  postId: HomeTeachingPostId;
  homeId: HomeId;
  teacherCharacterId: CharacterId;
  startedOnDay: WorldDay;
  minimumReleaseOnDay: WorldDay; // started + 28
  state: 'active' | 'released' | 'interrupted';
  revision: Revision;
};

export type PlayerDailyCommerceUsage = {
  usageId: PlayerCommerceUsageId;
  playerCharacterId: CharacterId;
  worldDay: WorldDay;
  commerceInteractionCount: number;
  revision: Revision;
};

export type CityState = {
  cities: Record<CityId, CityRuntimeState>;
  shopOffers: Record<ShopOfferId, ShopOffer>;
  intelLeads: Record<IntelLeadId, IntelLead>;
  escortCandidates: Record<EscortCandidateId, EscortCandidate>;
  homes: Record<HomeId, HomeInstance>;
  homeTeachingPosts: Record<HomeTeachingPostId, HomeTeachingPost>;
  playerCommerceUsage?: PlayerDailyCommerceUsage;
};

// ── §4 公開 Query ──────────────────────────────────────────────────────────
// 下列 View 為 read-model 投影，模組契約未完整指定形狀；以最小可辨識欄位佔位。
export type CityView = Readonly<{ cityId: CityId; prosperity: number; safety: number }>;
export type FacilityView = Readonly<{
  facilityId: FacilityDefinitionId;
  kind: FacilityKind;
  availability: 'open' | 'restricted' | 'closed';
}>;
export type ShopOfferView = Readonly<{
  offerId: ShopOfferId;
  cityId: CityId;
  itemId: ItemInstanceId;
  source: 'permanentStock' | 'baseCatalog' | 'playerSold';
  state: 'available' | 'sold' | 'expired';
}>;
export type IntelLeadView = Readonly<{
  intelId: IntelLeadId;
  cityId: CityId;
  kind: 'mapItem' | 'kidnap' | 'boss' | 'monsterControl' | 'other';
  state: 'available' | 'revealed' | 'obsolete';
}>;
export type HomeView = Readonly<{
  homeId: HomeId;
  cityId: CityId;
  ownerCharacterId: CharacterId;
  slotCapacity: number;
}>;

export type PlayerDailyCommerceUsageView = {
  playerCharacterId: CharacterId;
  worldDay: WorldDay;
  commerceInteractionCount: number;
  remainingCount: number;
};

export interface CityQuery {
  getCity(cityId: CityId): CityView;
  isFacilityAvailable(cityId: CityId, kind: FacilityKind): boolean;
  getFacility(cityId: CityId, kind: FacilityKind): FacilityView;
  listShopOffers(cityId: CityId, shopKind: ShopKind): ShopOfferView[];
  getOffer(offerId: ShopOfferId): ShopOfferView;
  listAvailableIntel(cityId: CityId, teamId: TeamId): IntelLeadView[];
  canUseTavern(cityId: CityId, teamId: TeamId): boolean;
  getPlayerCommerceUsage(playerCharacterId: CharacterId, worldDay: WorldDay): PlayerDailyCommerceUsageView;
  getHome(cityId: CityId, ownerId: CharacterId): HomeView | undefined;
  canUseRestaurant(cityId: CityId, characterId: CharacterId): boolean; // 第一版由 inn 提供基礎餐點入口
}

// ── §5.1 玩家 Game Command ─────────────────────────────────────────────────
// payload 欄位依前置條件／責任推定；doc 未提供完整結構。
export type BuyShopOfferCommand = Readonly<{
  type: 'buyShopOffer';
  offerId: ShopOfferId;
  payerCharacterId: CharacterId;
}>;

export type SellItemToShopCommand = Readonly<{
  type: 'sellItemToShop';
  itemId: ItemInstanceId;
  sellerCharacterId: CharacterId;
  cityId: CityId;
}>;

export type StartFacilityActionCommand = Readonly<{
  type: 'startFacilityAction';
  cityId: CityId;
  facilityId: FacilityDefinitionId;
  cityActionRuleId: CityActionRuleId;
  participantCharacterIds: readonly CharacterId[];
}>;

export type BuyOrUpgradeHomeCommand = Readonly<{
  type: 'buyOrUpgradeHome';
  cityId: CityId;
  homeId?: HomeId; // 升級既有房屋時提供
  upgradeId?: HomeUpgradeDefinitionId;
  payerCharacterId: CharacterId;
}>;

export type AssignHomeTeacherCommand = Readonly<{
  type: 'assignHomeTeacher';
  homeId: HomeId;
  teacherCharacterId: CharacterId;
}>;

export type ReleaseHomeTeacherCommand = Readonly<{
  type: 'releaseHomeTeacher';
  postId: HomeTeachingPostId;
}>;

export type CityGameCommand =
  | BuyShopOfferCommand
  | SellItemToShopCommand
  | StartFacilityActionCommand
  | BuyOrUpgradeHomeCommand
  | AssignHomeTeacherCommand
  | ReleaseHomeTeacherCommand;

// askTavernIntel 為 Application Workflow（分別送 RevealTavernIntel 與 Social 額度命令），非單一 City Command。

// ── §5.2 ScheduledJob ──────────────────────────────────────────────────────
type EmptyPayload = Readonly<Record<string, never>>;

export type ShopRefreshJob = ScheduledJobBase<'shopRefresh', ModuleId, ShopRuleId, EmptyPayload>;
export type EscortGenerationJob = ScheduledJobBase<'escortGeneration', ModuleId, CityId, EmptyPayload>;
export type CityPopulationReviewJob = ScheduledJobBase<'cityPopulationReview', ModuleId, CityId, EmptyPayload>;

export type CityScheduledJob = ShopRefreshJob | EscortGenerationJob | CityPopulationReviewJob;

// ── §5.3 Internal Command（City 為處理者）──────────────────────────────────
export type ReserveShopOfferForQuestCommand = Readonly<{
  type: 'ReserveShopOfferForQuest';
  offerId: ShopOfferId;
  sourceQuestId: QuestId;
}>;

export type ReleaseQuestShopOfferCommand = Readonly<{
  type: 'ReleaseQuestShopOffer';
  offerId: ShopOfferId;
  sourceQuestId: QuestId;
}>;

export type SetFacilityAvailabilityCommand = Readonly<{
  type: 'SetFacilityAvailability';
  cityId: CityId;
  facilityId: FacilityDefinitionId;
  availability: 'open' | 'restricted' | 'closed';
  restrictionReason?: string;
  sourceId: EntitySourceRef;
}>;

export type ApplyCityMetricEffectCommand = Readonly<{
  type: 'ApplyCityMetricEffect';
  cityId: CityId;
  effectId: EffectDefinitionId;
  sourceId: EntitySourceRef;
}>;

export type TransferHomeOwnershipCommand = Readonly<{
  type: 'TransferHomeOwnership';
  homeId: HomeId;
  fromCharacterId: CharacterId;
  toCharacterId: CharacterId;
  sourceId: EntitySourceRef;
}>;

export type InterruptHomeTeachingPostCommand = Readonly<{
  type: 'InterruptHomeTeachingPost';
  postId: HomeTeachingPostId;
  sourceId: EntitySourceRef;
}>;

export type RevealTavernIntelCommand = Readonly<{
  type: 'RevealTavernIntel';
  cityId: CityId;
  teamId: TeamId;
  intelId: IntelLeadId;
}>;

export type CityInternalCommand =
  | ReserveShopOfferForQuestCommand
  | ReleaseQuestShopOfferCommand
  | SetFacilityAvailabilityCommand
  | ApplyCityMetricEffectCommand
  | TransferHomeOwnershipCommand
  | InterruptHomeTeachingPostCommand
  | RevealTavernIntelCommand;

// ── §7 輸出事件（DomainEvent payload）──────────────────────────────────────
export type ShopRefreshed = Readonly<{
  type: 'ShopRefreshed';
  cityId: CityId;
  shopId: FacilityDefinitionId;
  offerIds: readonly ShopOfferId[];
}>;

export type ShopOfferCreated = Readonly<{
  type: 'ShopOfferCreated';
  offerId: ShopOfferId;
  itemId: ItemInstanceId;
  source: 'permanentStock' | 'baseCatalog' | 'playerSold';
}>;

export type ShopOfferSold = Readonly<{
  type: 'ShopOfferSold';
  offerId: ShopOfferId;
  itemId: ItemInstanceId;
  buyerCharacterId: CharacterId;
  buyerTeamId: TeamId;
}>;

export type CommerceInteractionCompleted = Readonly<{
  type: 'CommerceInteractionCompleted';
  actorKind: 'playerCharacter';
  teamId: TeamId;
  characterId: CharacterId;
  kind: 'buy' | 'sell';
  cityId: CityId;
  sourceId: EntitySourceRef;
  experienceAwardRuleId: ExperienceAwardRuleId;
}>;

export type CityStockItemAvailable = Readonly<{
  type: 'CityStockItemAvailable';
  cityId: CityId;
  itemId: ItemInstanceId;
}>;

export type IntelRevealed = Readonly<{
  type: 'IntelRevealed';
  intelId: IntelLeadId;
  teamId: TeamId;
  sourceContentId: ContentInstanceId;
}>;

export type EscortCandidatesGenerated = Readonly<{
  type: 'EscortCandidatesGenerated';
  cityId: CityId;
  candidateIds: readonly EscortCandidateId[];
}>;

export type FacilityRestCompleted = Readonly<{
  type: 'FacilityRestCompleted';
  cityId: CityId;
  characterIds: readonly CharacterId[];
  ruleId: CityActionRuleId;
}>;

export type CityTrainingCompleted = Readonly<{
  type: 'CityTrainingCompleted';
  characterId: CharacterId;
  masteryId: MasteryId;
  teacherLevel: 5;
}>;

export type HomeChanged = Readonly<{
  type: 'HomeChanged';
  homeId: HomeId;
  ownerId: CharacterId;
  change: string;
}>;

export type HomeTeachingPostChanged = Readonly<{
  type: 'HomeTeachingPostChanged';
  postId: HomeTeachingPostId;
  homeId: HomeId;
  teacherCharacterId: CharacterId;
  state: 'active' | 'released' | 'interrupted';
}>;

export type CityMetricsChanged = Readonly<{
  type: 'CityMetricsChanged';
  cityId: CityId;
  prosperity: number;
  safety: number;
  sourceId: EntitySourceRef;
}>;

export type AdventurerSupplyDemanded = Readonly<{
  type: 'AdventurerSupplyDemanded';
  cityId: CityId;
  cultureId: CultureId;
  count: number;
  adventurerGenerationRuleId: WorldAdventurerGenerationRuleId;
  reason: string;
}>;

export type CityDomainEvent =
  | ShopRefreshed
  | ShopOfferCreated
  | ShopOfferSold
  | CommerceInteractionCompleted
  | CityStockItemAvailable
  | IntelRevealed
  | EscortCandidatesGenerated
  | FacilityRestCompleted
  | CityTrainingCompleted
  | HomeChanged
  | HomeTeachingPostChanged
  | CityMetricsChanged
  | AdventurerSupplyDemanded;
