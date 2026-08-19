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

// 跨模組外送命令：引用接收模組契約的真實型別（B.5 慣例）。
import type {
  CreateItemInstance,
  RemoveItemInstance,
  TransferItem,
  MoveItemToTeamQuestCargo,
} from '../inventory';
import type { TransferCurrencyCommand } from '../economy';

// ── City 需要但未列於 contracts/core 的型別 ────────────────────────────────
// 物品池 ID：概念上由內容／inventory 模組擁有；contracts/core 尚未提供，本地宣告。
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
  // `ApplyCityMetricEffect` 只帶 EffectDefinitionId，沒有帶「怎麼把該 Effect 換成繁榮／安全數值」。
  // 那個換算（含資料上下限，doc §5.3）是資料調校，必須由 Resolver 提供；由哪一個 Resolver 提供
  // 則是城市資料的宣告。缺這個欄位時 Handler 只能自己決定增減量，而增減量是內容（規範 §3）。
  cityMetricEffectResolverId: ResolverId;
};

// `kind` 這個欄位名**不能**用來裝領域變體：Content Pack 的每一筆 Definition 都以 `kind` 宣告
// 自己屬於哪個 Definition 家族，窄化 Reader 也以它判斷所有權（見 `app/content/reader-adapter.ts`
// 的 `domainDefinitionView`——它覆寫 id/schemaVersion/packId/enabled，但**刻意不覆寫 kind**，
// 因為 registry 的 kind 與作者資料的 kind 本來就是同一個欄位）。
//
// 原本這裡是 `kind: FacilityKind`，於是一筆設施定義同時被要求是 `'facility'`（給 Reader 窄化）
// 和 `'inn'`（給領域判斷）——JSON 裡只有一個 kind 欄位，兩者不可能同時成立。inventory 早就踩過
// 同一顆雷（item reader 窄化在 `'item'`，而 `ItemDefinition.kind` 是六個 ItemKind 之一）。
//
// 專案裡已經有正確樣式：`EquipmentDefinition` 同時帶 `kind: 'equipment'`（registry 家族）與
// `equipmentKind: EquipmentKind`（領域變體）。這裡照它改成 `facilityKind`。
export type FacilityDefinition = DefinitionHeader<FacilityDefinitionId> & {
  facilityKind: FacilityKind;
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
  // 這條規則管的是哪一間店面。`ShopOffer` 必須帶 facilityId、`ShopRefreshed` 必須帶 shopId，而
  // shopRefresh Job 只以 ShopRuleId 定址；沒有這個欄位時唯一的替代是在 Handler 裡寫一張
  // shopKind → FacilityKind 的對照表，而跨資料對照屬於資料（規範 §3）。
  facilityId: FacilityDefinitionId;
  refreshCadenceDays: number;
  refreshOffsetDays: number;
  permanentStockOfferCount: { min: number; max: number };
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

// `upgradeKind` 而非 `kind`，理由同 FacilityDefinition：`kind` 屬 Content Pack 的家族宣告。
// 這裡的變體名（room／storage／forge…）若當成 registry kind 還會污染全域 kind 命名空間——
// `'room'` 作為一個全遊戲唯一的 Definition kind 顯然不對。
export type HomeUpgradeDefinition = DefinitionHeader<HomeUpgradeDefinitionId> & {
  upgradeKind:
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

// doc 只說明 Intel Rule 由 reader 引用，未給欄位；以「揭露判定交給 Resolver」的最小形狀宣告。
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
  // `remainingCount` 需要上限值，而上限值只存在於某個 CityDefinition 指向的
  // PlayerCommerceDailyLimitDefinition。doc §4 的簽章沒有 cityId，Query 就只能在城市之間猜一個
  // （或聚合），因此補上 cityId。上限本身仍是每玩家每日、不是每城市（doc §2.2）。
  getPlayerCommerceUsage(
    cityId: CityId,
    playerCharacterId: CharacterId,
    worldDay: WorldDay,
  ): PlayerDailyCommerceUsageView;
  getHome(cityId: CityId, ownerId: CharacterId): HomeView | undefined;
  // 餐點入口由 inn 的可用性提供（doc §4）。
  canUseRestaurant(cityId: CityId, characterId: CharacterId): boolean;
}

// ── §5.1 玩家 Game Command ─────────────────────────────────────────────────
// payload 欄位依 doc §5.1 的前置條件與責任欄推導。
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
  // 賣給「哪一間店」。doc §5.1 的前置條件含「設施開放」，而販售會建立一筆 playerSold Offer
  // （§3.2 source、§8.1 步驟 1），Offer 必須帶 facilityId。少了這個欄位就只能由 Handler 依
  // 物品種類推店家，那是一張 ItemKind → ShopKind 對照表，屬於資料。
  facilityId: FacilityDefinitionId;
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
  // 購買（未帶 homeId／upgradeId）時必填：從 HomeRuleDefinition.purchasableSlotCounts 選一個。
  // GDD §八「買房時決定 Slot 數量（越大越貴）」是玩家的選擇，價格由 purchasePriceRuleIds[slotCount]
  // 決定；Handler 不得自行挑一個 slot 數。
  slotCount?: number;
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
  // doc §5.3 要求「釋放、到期或關閉」三種結果，§8.1 也寫「只由 Quest 的明確生命週期命令**解除標記或
  // 清理**」——那是兩件不同的事，原本的 payload 表達不出第二件。
  //   release：只解除保留，Offer 仍可購買、之後受一般刷新規則處理。
  //   expire ：解除保留並關閉 Offer（state → expired）。
  disposition: 'release' | 'expire';
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

// `change` 原本是自由字串（規範 §7 點名的「用字串欄位暫時承載未定義資料」）。訂閱者是
// character／inventory／ui（doc §7），它們必須能分辨「換了主人」與「多了一間功能間」。
export type HomeChangeKind = 'purchased' | 'upgradeInstalled' | 'ownershipTransferred';

export type HomeChanged = Readonly<{
  type: 'HomeChanged';
  homeId: HomeId;
  ownerId: CharacterId;
  change: HomeChangeKind;
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

// 同上：`reason` 收斂成具名原因，訂閱端（character／team population workflow）才分辨得出來源。
export type AdventurerSupplyReason = 'populationReviewDeficit';

export type AdventurerSupplyDemanded = Readonly<{
  type: 'AdventurerSupplyDemanded';
  cityId: CityId;
  cultureId: CultureId;
  count: number;
  adventurerGenerationRuleId: WorldAdventurerGenerationRuleId;
  reason: AdventurerSupplyReason;
}>;

// ── §6 輸出 Internal Command（City 為送出端）────────────────────────────────
// B.5 慣例：引用接收模組契約的真實型別，不自行複寫欄位——兩份宣告一旦漂移，送出的命令會被接收端
// 拒絕，而訊息以 unknown 傳遞時編譯器看不到。
export type CityOutboundInternalCommand =
  | CreateItemInstance // inventory：為 Base Catalog 建立真實商品實體
  | RemoveItemInstance // inventory：清除到期的 playerSold 實體
  | TransferItem // inventory：買家取得物品、賣出時解除角色 Owner
  | MoveItemToTeamQuestCargo // inventory：Quest 指定品直接進 teamQuestCargo
  | TransferCurrencyCommand; // economy：購買、販售、房屋費用

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
