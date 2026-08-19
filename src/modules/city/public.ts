// modules/city/public.ts
// City 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。
// Composition 只從這裡取得工廠、Handler、Query 與 ModuleContract；不得深入 import 內部檔案。

import type {
  ModuleContract,
  ModuleId,
  StateSliceName,
  ReaderPortId,
  EventSubscriptionId,
  InvariantId,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/city';

// ── State ────────────────────────────────────────────────────────────────────
export {
  emptyCityState,
  createCityState,
  createCityRuntimeState,
  bumpRevision,
  tryGetCity,
  requireCity,
  listCities,
  upsertCity,
  tryGetFacilityState,
  upsertFacilityState,
  tryGetOffer,
  upsertOffer,
  listOffers,
  listOffersForFacility,
  hasAvailableOfferForItem,
  findAvailableOfferForItemId,
  tryGetIntel,
  upsertIntel,
  listIntel,
  upsertEscortCandidate,
  listEscortCandidates,
  tryGetHome,
  upsertHome,
  listHomes,
  findHomeInCityForOwner,
  tryGetTeachingPost,
  upsertTeachingPost,
  listTeachingPosts,
  usageCountFor,
  setPlayerCommerceUsage,
  installedSlotCost,
} from './state';
export type { CityState } from './state';

// ── Query ────────────────────────────────────────────────────────────────────
export { createCityQuery } from './queries';

// ── System（Handler + Job + Port 型別）────────────────────────────────────────
export {
  CITY_MODULE_ID,
  findFacilityIdByKind,
  findShopRuleForFacility,
  // Game Command handlers
  handleBuyShopOffer,
  handleSellItemToShop,
  handleBuyOrUpgradeHome,
  handleReleaseHomeTeacher,
  // Internal Command handlers
  handleReserveShopOfferForQuest,
  handleReleaseQuestShopOffer,
  handleSetFacilityAvailability,
  handleApplyCityMetricEffect,
  handleTransferHomeOwnership,
  handleInterruptHomeTeachingPost,
  handleRevealTavernIntel,
  // Job handlers
  handleShopRefresh,
  handleEscortGeneration,
  handleCityPopulationReview,
} from './system';
export type {
  CityHandlerContext,
  CityHandlerResult,
  CityIdAllocator,
  CityTeamPort,
  CityInventoryPort,
  CityEconomyPort,
  CityWorldPort,
  CityAdventurerSupplyPort,
  CityResolverPort,
  EscortDeadlines,
  ResolvedWithRng,
} from './system';

// ── ModuleContract 宣告（doc §10 交接清單對照）────────────────────────────────
// 事件綁定與執行順序由 Composition Manifest 唯一擁有；此處只宣告本模組**已閉合**的 Handler。
//
// 刻意未登記（依規範 §10：沒閉合就不出現，也不寫「會 throw 尚未實作」的 handler）：
//   * `startFacilityAction`   —— 耗時行動由 team 建立，但 team 尚未提供 `StartTimedCityAction` handler。
//   * `assignHomeTeacher`     —— 三個缺口：崗位最短天數沒有任何 Definition 欄位承載（28 日寫在
//                                契約註解裡，不是資料）；教師 Team Plan 同樣需要 team 的
//                                `StartTimedCityAction`；家教服務報價需要一筆 home-tutor
//                                service Definition ID，city 契約沒有。
//   * 全部 DomainEvent Subscriber —— doc §5.4 的七組訂閱都需要別的模組先發出對應事件並提供
//                                    correlate 用欄位；本輪未實作任何 subscriber 函式。
export const cityModuleContract: ModuleContract = {
  id: 'city' as ModuleId<'city'>,
  owns: 'city' as StateSliceName,
  reads: [
    'reader:city-definition' as ReaderPortId,
    'reader:team-query' as ReaderPortId,
    'reader:inventory-query' as ReaderPortId,
    'reader:economy-query' as ReaderPortId,
    'reader:world-query' as ReaderPortId,
    'reader:adventurer-supply' as ReaderPortId,
    'reader:city-resolvers' as ReaderPortId,
  ],
  handlesGameCommands: ['buyShopOffer', 'sellItemToShop', 'buyOrUpgradeHome', 'releaseHomeTeacher'],
  handlesInternalCommands: [
    'ReserveShopOfferForQuest',
    'ReleaseQuestShopOffer',
    'SetFacilityAvailability',
    'ApplyCityMetricEffect',
    'TransferHomeOwnership',
    'InterruptHomeTeachingPost',
    'RevealTavernIntel',
  ],
  handlesJobs: ['shopRefresh', 'escortGeneration', 'cityPopulationReview'],
  sendsInternalCommands: [
    'RemoveItemInstance',
    'TransferItem',
    'MoveItemToTeamQuestCargo',
    'TransferCurrency',
  ],
  subscriptionHandlerIds: [] as readonly EventSubscriptionId[],
  emits: [
    'ShopRefreshed',
    'ShopOfferCreated',
    'ShopOfferSold',
    'CommerceInteractionCompleted',
    'CityStockItemAvailable',
    'IntelRevealed',
    'EscortCandidatesGenerated',
    'HomeChanged',
    'HomeTeachingPostChanged',
    'CityMetricsChanged',
    'AdventurerSupplyDemanded',
  ],
  invariants: [
    // doc §9 的不變量，逐條對應 city.test.ts 的案例。
    'city.offerReferencesOneActiveItem' as InvariantId,
    'city.oneAvailableOfferPerItem' as InvariantId,
    'city.playerSoldClearedOnRefresh' as InvariantId,
    'city.questReservedOfferSurvivesRefresh' as InvariantId,
    'city.playerCommerceDailyCap' as InvariantId,
    'city.nonPlayerCommerceDoesNotWriteUsage' as InvariantId,
    'city.escortCandidateIsNotCharacter' as InvariantId,
    'city.singleHomePerOwnerPerCity' as InvariantId,
  ],
};

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是模組的**正式對外面**；從這裡再匯出 fixtures 等於讓正式依賴圖可以走到測試資料
// （規範 §13 的判準是「只要正式程式**可以**引用就算違反」）。測試請直接 import './fixtures'。
