// modules/city/system.ts
// City 模組的純函式 Handler / Job（對應 docs/00_core/architecture/09_city_module.md §5–8）。
//
// 設計原則：
//   * 全部為決定性純函式：不做 I/O、不呼叫 Math.random / Date.now。
//   * 需要「當前世界日」「靜態資料」「其他模組事實」「新 ID」「RNG」時，一律經注入的
//     CityHandlerContext 取得；RNG 只以顯式 cursor 的 DeterministicRng 使用，且每次取用都前進 cursor。
//   * City 只寫自己的 Slice：金錢屬 economy、物品實體屬 inventory、隊伍與耗時行動屬 team。
//     這三者一律以 Internal Command 請求（引用接收模組契約的真實型別），不直接呼叫其 Handler。
//   * Game / Internal Command / Job root 一律回 ModuleOutcome<CityState>。

import type {
  WorldDay,
  Revision,
  ModuleId,
  CityId,
  CharacterId,
  TeamId,
  FacilityDefinitionId,
  HomeId,
  HomeUpgradeDefinitionId,
  ItemInstanceId,
  ShopOfferId,
  PriceRuleId,
  RegionId,
  CultureId,
  ResolverId,
  CurrencyId,
  EconomyAccountId,
  EconomyTransferId,
  EffectDefinitionId,
  ExperienceAwardRuleId,
  PlayerCommerceUsageId,
  IntelLeadId,
  EscortCandidateId,
  HomeTeachingPostId,
  CharacterArchetypeId,
  ModuleResult,
  ModuleOutcome,
  ScheduledJobDraft,
  AnyScheduledJob,
  TransactionMessageDraft,
  DeterministicRng,
  RngContext,
  RngCursor,
} from '../../contracts/core';
import type {
  CityState,
  CityRuntimeState,
  FacilityKind,
  FacilityRuntimeState,
  ShopRuleDefinition,
  ShopOffer,
  IntelLead,
  EscortCandidate,
  HomeInstance,
  HomeTeachingPost,
  PlayerDailyCommerceUsage,
  CityDefinitionReader,
  CityDomainEvent,
  CityOutboundInternalCommand,
  ShopRefreshJob,
  EscortGenerationJob,
  CityPopulationReviewJob,
  BuyShopOfferCommand,
  SellItemToShopCommand,
  BuyOrUpgradeHomeCommand,
  ReleaseHomeTeacherCommand,
  ReserveShopOfferForQuestCommand,
  ReleaseQuestShopOfferCommand,
  SetFacilityAvailabilityCommand,
  ApplyCityMetricEffectCommand,
  TransferHomeOwnershipCommand,
  InterruptHomeTeachingPostCommand,
  RevealTavernIntelCommand,
} from '../../contracts/city';

// 跨模組（僅型別 import）。
import type { ItemInstanceView, ItemLocationSelector } from '../../contracts/inventory';
import type { PriceQuote, SellQuoteInput } from '../../contracts/economy';

import {
  bumpRevision,
  tryGetCity,
  listCities,
  upsertCity,
  tryGetFacilityState,
  upsertFacilityState,
  tryGetOffer,
  upsertOffer,
  listOffersForFacility,
  findAvailableOfferForItemId,
  tryGetIntel,
  upsertIntel,
  upsertEscortCandidate,
  tryGetHome,
  upsertHome,
  findHomeInCityForOwner,
  tryGetTeachingPost,
  upsertTeachingPost,
  usageCountFor,
  setPlayerCommerceUsage,
  installedSlotCost,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組身分（規範 §4：Module ID 是程式身分，不是內容）
// ──────────────────────────────────────────────────────────────────────────

export const CITY_MODULE_ID = 'city' as ModuleId<'city'>;
const INVENTORY_MODULE_ID = 'inventory' as ModuleId<'inventory'>;
const ECONOMY_MODULE_ID = 'economy' as ModuleId<'economy'>;

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port（§7.1 慣例：模組宣告本地窄化 port 型別，實作由 Composition 注入）
// ──────────────────────────────────────────────────────────────────────────

// 交易私有的 ID 配發器。只含 **City 自己擁有的** Runtime 實體種類。
export interface CityIdAllocator {
  nextShopOfferId(): ShopOfferId;
  nextIntelLeadId(): IntelLeadId;
  nextEscortCandidateId(): EscortCandidateId;
  nextHomeId(): HomeId;
  nextHomeTeachingPostId(): HomeTeachingPostId;
  nextPlayerCommerceUsageId(): PlayerCommerceUsageId;
}

// team 的事實。三個方法都與 `TeamQuery` 同簽章（contracts/team），Composition 直接轉接即可。
export interface CityTeamPort {
  getPlayerControlledCharacterId(): CharacterId;
  listTeamsAtCity(cityId: CityId): TeamId[];
  listFormalMembers(teamId: TeamId): CharacterId[];
}

// inventory 的事實。前四個方法與 `InventoryQuery` 同簽章；`isTradable` 是投影
// （`ItemDefinition.tradePolicy.tradable`），由 Composition 以 inventory 的 Item Definition Reader 組出。
export interface CityInventoryPort {
  getItem(itemId: ItemInstanceId): ItemInstanceView | undefined;
  listAtLocation(location: ItemLocationSelector): readonly ItemInstanceView[];
  characterOwnsItem(characterId: CharacterId, itemId: ItemInstanceId): boolean;
  isReserved(itemId: ItemInstanceId): boolean;
  isTradable(itemId: ItemInstanceId): boolean;
}

// economy 的事實與 economy 擁有的 ID 家族。
// `nextTransferId` 刻意放在 economy port 而不是 CityIdAllocator：EconomyTransferId 屬於 economy，
// City 不鑄造它，只向 economy 的配發器索取（TransferCurrencyCommand 以它作冪等鍵）。
export interface CityEconomyPort {
  nextTransferId(): EconomyTransferId;
  getCharacterAccount(characterId: CharacterId, currencyId: CurrencyId): EconomyAccountId;
  // 店家收付款帳戶。`EconomyAccountOwner` 已有 `{ kind: 'city' }`，但 `EconomyQuery` 沒有對應 getter。
  getCityShopAccount(cityId: CityId, currencyId: CurrencyId): EconomyAccountId;
  // 以 ShopOfferId 定址的購買報價。`EconomyQuery.getPurchaseQuote` 的 `offerId` 宣告為
  // `EntitySourceRef`，而該聯集不含 ShopOfferId——傳物品 ID 會讓 `baseValueSource:'offerFixedValue'`
  // 靜默失效，所以此 port 用真正的型別宣告需求。
  getShopOfferPurchaseQuote(
    input: Readonly<{
      offerId: ShopOfferId;
      buyerCharacterId: CharacterId;
      sourceRevision: Revision;
    }>,
  ): PriceQuote;
  getSellQuote(input: SellQuoteInput): PriceQuote;
  // 以 Price Rule 定址的服務／資產報價（房屋購買與功能間升級）。`EconomyQuery` 目前只有
  // purchase／sell／service 三種入口，房屋走的是 `HomeRuleDefinition.purchasePriceRuleIds`。
  getPriceRuleQuote(
    input: Readonly<{
      priceRuleId: PriceRuleId;
      buyerCharacterId: CharacterId;
      cityId: CityId;
      sourceRevision: Revision;
    }>,
  ): PriceQuote;
}

// world 的事實。兩個方法都與 `WorldQuery` 同簽章。
export interface CityWorldPort {
  getRegionForCity(cityId: CityId): RegionId;
  getNativeCulture(regionId: RegionId): CultureId;
}

// 「這座城市目前的冒險者供給量」。人口批次要比較目標與現況才知道缺多少（doc §5.2），
// 而現況屬 character／team 的事實——沒有任何現有 Query 提供它，故以獨立 port 宣告需求，
// 不在 City 內用「城內隊伍人數」自行定義供給量（那會把人口設計決定藏進 City）。
export interface CityAdventurerSupplyPort {
  countAdventurerSupply(cityId: CityId): number;
}

// 資料調校 Resolver（§7.1 data-tuned kernel）。使用 RNG 者回傳最終 cursor，由 Handler 串接。
export type ResolvedWithRng<T> = Readonly<{ value: T; nextCursor: RngCursor }>;

export type EscortDeadlines = Readonly<{
  acceptDeadline: WorldDay;
  actualEndDeadline: WorldDay;
}>;

export interface CityResolverPort {
  resolveEscortDestination(
    input: Readonly<{
      resolverId: ResolverId;
      originCityId: CityId;
      archetypeId: CharacterArchetypeId;
      rng: RngContext;
    }>,
  ): ResolvedWithRng<CityId>;

  resolveEscortDeadlines(
    input: Readonly<{
      resolverId: ResolverId;
      originCityId: CityId;
      destinationCityId: CityId;
      generatedOnDay: WorldDay;
      rng: RngContext;
    }>,
  ): ResolvedWithRng<EscortDeadlines>;

  resolvePopulationTargetCount(
    input: Readonly<{
      resolverId: ResolverId;
      cityId: CityId;
      prosperity: number;
      safety: number;
      currentSupplyCount: number;
    }>,
  ): number;

  // 已驗證 Effect → 新的繁榮／安全值。上下限（doc §5.3）屬 Resolver 的 params，不在 Handler。
  resolveCityMetricEffect(
    input: Readonly<{
      resolverId: ResolverId;
      cityId: CityId;
      effectId: EffectDefinitionId;
      prosperity: number;
      safety: number;
    }>,
  ): Readonly<{ prosperity: number; safety: number }>;
}

export type CityHandlerContext = Readonly<{
  worldDay: WorldDay;
  definitions: CityDefinitionReader;
  team: CityTeamPort;
  inventory: CityInventoryPort;
  economy: CityEconomyPort;
  world: CityWorldPort;
  supply: CityAdventurerSupplyPort;
  ids: CityIdAllocator;
  rng: DeterministicRng;
  rngContext: RngContext;
  resolvers: CityResolverPort;
}>;

export type CityHandlerResult = ModuleOutcome<CityState>;

// ──────────────────────────────────────────────────────────────────────────
// 小工具
// ──────────────────────────────────────────────────────────────────────────

function emit(event: CityDomainEvent): TransactionMessageDraft {
  return { event };
}

function toInventory(command: CityOutboundInternalCommand): TransactionMessageDraft {
  return { targetModule: INVENTORY_MODULE_ID, command };
}

function toEconomy(command: CityOutboundInternalCommand): TransactionMessageDraft {
  return { targetModule: ECONOMY_MODULE_ID, command };
}

function makeResult(
  nextSlice: CityState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[] = [],
): ModuleResult<CityState> {
  return { nextSlice, outgoingMessages, scheduledJobs };
}

function accept(
  nextSlice: CityState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[] = [],
): CityHandlerResult {
  return { ok: true, result: makeResult(nextSlice, outgoingMessages, scheduledJobs) };
}

function reject(
  code: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): CityHandlerResult {
  return { ok: false, rejection: { code, source: CITY_MODULE_ID, details } };
}

// RNG 走訪器：每次取用都前進 cursor，同一 cursor 不會被兩個消費者使用（含 Resolver 呼叫）。
type RngWalk = { cursor: RngCursor };

function newWalk(ctx: CityHandlerContext): RngWalk {
  return { cursor: ctx.rngContext.cursor };
}

function walkContext(ctx: CityHandlerContext, walk: RngWalk): RngContext {
  return { worldSeed: ctx.rngContext.worldSeed, streamId: ctx.rngContext.streamId, cursor: walk.cursor };
}

function drawInt(
  ctx: CityHandlerContext,
  walk: RngWalk,
  minInclusive: number,
  maxInclusive: number,
): number {
  const step = ctx.rng.nextInt({
    worldSeed: ctx.rngContext.worldSeed,
    streamId: ctx.rngContext.streamId,
    cursor: walk.cursor,
    minInclusive,
    maxInclusive,
  });
  walk.cursor = step.nextCursor;
  return step.value;
}

// 找出「這位角色所屬、且目前位於該城市」的隊伍。City 不保存第二份隊伍位置真相（doc §1.2），
// 因此以 team 的兩個公開 Query 組出來：城內隊伍 × 正式成員名單。
function findTeamOfMemberAtCity(
  team: CityTeamPort,
  cityId: CityId,
  characterId: CharacterId,
): TeamId | undefined {
  const teams = [...team.listTeamsAtCity(cityId)].sort();
  return teams.find((teamId) => team.listFormalMembers(teamId).includes(characterId));
}

// 依 FacilityKind 在城市定義中找出設施 ID。FacilityKind 是 Schema 的變體標籤（十種固定場所，
// doc §2.2 / GDD §十二），不是內容 ID，因此以字面值比對是合法的。
export function findFacilityIdByKind(
  definitions: CityDefinitionReader,
  cityId: CityId,
  kind: FacilityKind,
): FacilityDefinitionId | undefined {
  const cityDefinition = definitions.getCity(cityId);
  return cityDefinition.facilityIds.find((id) => definitions.getFacility(id).facilityKind === kind);
}

function requireOpenFacility(
  city: CityRuntimeState,
  facilityId: FacilityDefinitionId,
): FacilityRuntimeState | undefined {
  const facility = tryGetFacilityState(city, facilityId);
  if (facility === undefined) return undefined;
  return facility.availability === 'open' ? facility : undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// 玩家主角每日交易額度（doc §2.2 / §3.6 / 不變量 6、8）
// ──────────────────────────────────────────────────────────────────────────

type CommerceGate = Readonly<{
  isPlayerCharacter: boolean;
  limitReached: boolean;
  experienceAwardRuleId: ExperienceAwardRuleId;
}>;

// 判定這筆買賣是否屬玩家主角、以及當日額度是否已滿。
// 上限值與交流 Experience Rule 都取自該城市定義所指的 Definition，Handler 不持有任何數字。
function commerceGate(
  ctx: CityHandlerContext,
  state: CityState,
  cityId: CityId,
  actorCharacterId: CharacterId,
): CommerceGate {
  const cityDefinition = ctx.definitions.getCity(cityId);
  const practice = ctx.definitions.getPlayerCommercePracticeRule(
    cityDefinition.playerCommercePracticeRuleId,
  );
  const playerCharacterId = ctx.team.getPlayerControlledCharacterId();
  if (actorCharacterId !== playerCharacterId) {
    return {
      isPlayerCharacter: false,
      limitReached: false,
      experienceAwardRuleId: practice.commerceExperienceRuleId,
    };
  }
  const limit = ctx.definitions.getPlayerCommerceDailyLimit(
    cityDefinition.playerCommerceDailyLimitId,
  );
  const used = usageCountFor(state, playerCharacterId, ctx.worldDay);
  return {
    isPlayerCharacter: true,
    limitReached: used >= limit.maxCommerceInteractionsPerDay,
    experienceAwardRuleId: practice.commerceExperienceRuleId,
  };
}

// 交易成功後才 +1（doc §5.1 / 不變量 7）。跨日或換主角時直接替換整筆記錄 → 自然歸零。
function recordCommerceInteraction(
  ctx: CityHandlerContext,
  state: CityState,
  playerCharacterId: CharacterId,
): CityState {
  const existing = state.playerCommerceUsage;
  const sameRecord =
    existing !== undefined &&
    existing.playerCharacterId === playerCharacterId &&
    existing.worldDay === ctx.worldDay;
  const next: PlayerDailyCommerceUsage = sameRecord
    ? {
        ...existing,
        commerceInteractionCount: existing.commerceInteractionCount + 1,
        revision: bumpRevision(existing.revision),
      }
    : {
        usageId: ctx.ids.nextPlayerCommerceUsageId(),
        playerCharacterId,
        worldDay: ctx.worldDay,
        commerceInteractionCount: 1,
        revision: 0 as Revision,
      };
  return setPlayerCommerceUsage(state, next);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 buyShopOffer
// ──────────────────────────────────────────────────────────────────────────

export function handleBuyShopOffer(
  command: BuyShopOfferCommand,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  const offer = tryGetOffer(state, command.offerId);
  if (offer === undefined) {
    return reject('city/offer-not-found', { offerId: String(command.offerId) });
  }
  if (offer.state !== 'available') {
    return reject('city/offer-not-available', { offerId: String(command.offerId), state: offer.state });
  }
  const city = tryGetCity(state, offer.cityId);
  if (city === undefined) return reject('city/unknown-city', { cityId: String(offer.cityId) });
  if (requireOpenFacility(city, offer.facilityId) === undefined) {
    return reject('city/facility-not-open', { facilityId: String(offer.facilityId) });
  }
  const buyerTeamId = findTeamOfMemberAtCity(ctx.team, offer.cityId, command.payerCharacterId);
  if (buyerTeamId === undefined) {
    return reject('city/buyer-not-formal-member-at-city', {
      characterId: String(command.payerCharacterId),
      cityId: String(offer.cityId),
    });
  }

  const gate = commerceGate(ctx, state, offer.cityId, command.payerCharacterId);
  if (gate.limitReached) {
    return reject('city/daily-commerce-limit-reached', {
      characterId: String(command.payerCharacterId),
      worldDay: ctx.worldDay,
    });
  }

  // 報價與帳戶都由 economy 決定；City 不計價、不持有餘額。
  const quote = ctx.economy.getShopOfferPurchaseQuote({
    offerId: offer.offerId,
    buyerCharacterId: command.payerCharacterId,
    sourceRevision: offer.revision,
  });
  const payerAccountId = ctx.economy.getCharacterAccount(command.payerCharacterId, quote.currencyId);
  const shopAccountId = ctx.economy.getCityShopAccount(offer.cityId, quote.currencyId);

  const messages: TransactionMessageDraft[] = [
    toEconomy({
      type: 'TransferCurrency',
      transferId: ctx.economy.nextTransferId(),
      fromAccountId: payerAccountId,
      toAccountId: shopAccountId,
      currencyId: quote.currencyId,
      amount: quote.amount,
      reason: 'city.shopPurchase',
      sourceId: offer.itemId,
    }),
  ];

  // 一般商品 Owner 轉給付款角色；Quest 指定品直接進 teamQuestCargo（doc §5.1）。
  if (offer.sourceQuestId === undefined) {
    messages.push(
      toInventory({
        type: 'TransferItem',
        itemId: offer.itemId,
        to: { kind: 'characterBag', characterId: command.payerCharacterId },
        newOwnerCharacterId: command.payerCharacterId,
        reason: 'city.shopPurchase',
      }),
    );
  } else {
    messages.push(
      toInventory({
        type: 'MoveItemToTeamQuestCargo',
        itemId: offer.itemId,
        questId: offer.sourceQuestId,
        teamId: buyerTeamId,
        carrierCharacterId: command.payerCharacterId,
      }),
    );
  }

  const soldOffer: ShopOffer = {
    ...offer,
    state: 'sold',
    revision: bumpRevision(offer.revision),
  };
  let next = upsertOffer(state, soldOffer);

  messages.push(
    emit({
      type: 'ShopOfferSold',
      offerId: offer.offerId,
      itemId: offer.itemId,
      buyerCharacterId: command.payerCharacterId,
      buyerTeamId,
    }),
  );

  if (gate.isPlayerCharacter) {
    next = recordCommerceInteraction(ctx, next, command.payerCharacterId);
    messages.push(
      emit({
        type: 'CommerceInteractionCompleted',
        actorKind: 'playerCharacter',
        teamId: buyerTeamId,
        characterId: command.payerCharacterId,
        kind: 'buy',
        cityId: offer.cityId,
        sourceId: offer.itemId,
        experienceAwardRuleId: gate.experienceAwardRuleId,
      }),
    );
  }

  return accept(next, messages);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 sellItemToShop
// ──────────────────────────────────────────────────────────────────────────

export function handleSellItemToShop(
  command: SellItemToShopCommand,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  const city = tryGetCity(state, command.cityId);
  if (city === undefined) return reject('city/unknown-city', { cityId: String(command.cityId) });
  if (requireOpenFacility(city, command.facilityId) === undefined) {
    return reject('city/facility-not-open', { facilityId: String(command.facilityId) });
  }
  const shopRule = findShopRuleForFacility(ctx.definitions, command.cityId, command.facilityId);
  if (shopRule === undefined) {
    return reject('city/facility-not-a-shop', { facilityId: String(command.facilityId) });
  }
  const sellerTeamId = findTeamOfMemberAtCity(ctx.team, command.cityId, command.sellerCharacterId);
  if (sellerTeamId === undefined) {
    return reject('city/seller-not-formal-member-at-city', {
      characterId: String(command.sellerCharacterId),
      cityId: String(command.cityId),
    });
  }

  const item = ctx.inventory.getItem(command.itemId);
  if (item === undefined || item.state !== 'active') {
    return reject('city/item-not-active', { itemId: String(command.itemId) });
  }
  if (!ctx.inventory.characterOwnsItem(command.sellerCharacterId, command.itemId)) {
    return reject('city/seller-not-item-owner', {
      itemId: String(command.itemId),
      characterId: String(command.sellerCharacterId),
    });
  }
  if (!ctx.inventory.isTradable(command.itemId)) {
    return reject('city/item-not-tradable', { itemId: String(command.itemId) });
  }
  if (ctx.inventory.isReserved(command.itemId)) {
    return reject('city/item-reserved', { itemId: String(command.itemId) });
  }
  // 不變量 3：同一 ItemInstance 同時最多對應一個 available Offer。
  if (findAvailableOfferForItemId(state, command.itemId) !== undefined) {
    return reject('city/item-already-offered', { itemId: String(command.itemId) });
  }

  const gate = commerceGate(ctx, state, command.cityId, command.sellerCharacterId);
  if (gate.limitReached) {
    return reject('city/daily-commerce-limit-reached', {
      characterId: String(command.sellerCharacterId),
      worldDay: ctx.worldDay,
    });
  }

  const quote = ctx.economy.getSellQuote({
    itemSourceId: command.itemId,
    sellerCharacterId: command.sellerCharacterId,
    cityId: command.cityId,
    sourceRevision: item.revision,
  });
  const sellerAccountId = ctx.economy.getCharacterAccount(
    command.sellerCharacterId,
    quote.currencyId,
  );
  const shopAccountId = ctx.economy.getCityShopAccount(command.cityId, quote.currencyId);

  const offer: ShopOffer = {
    offerId: ctx.ids.nextShopOfferId(),
    cityId: command.cityId,
    facilityId: command.facilityId,
    itemId: command.itemId,
    source: 'playerSold',
    priceRuleId: shopRule.priceRuleId,
    state: 'available',
    createdOnDay: ctx.worldDay,
    revision: 0 as Revision,
  };

  const messages: TransactionMessageDraft[] = [
    toEconomy({
      type: 'TransferCurrency',
      transferId: ctx.economy.nextTransferId(),
      fromAccountId: shopAccountId,
      toAccountId: sellerAccountId,
      currencyId: quote.currencyId,
      amount: quote.amount,
      reason: 'city.shopSale',
      sourceId: command.itemId,
    }),
    // 解除角色 Owner：移入城市永久庫存且不指定新 Owner（inventory 的 TransferItem 對非
    // owner-bound 位置會把 ownerCharacterId 設成 command 給的值，此處刻意不給）。
    toInventory({
      type: 'TransferItem',
      itemId: command.itemId,
      to: { kind: 'cityPermanentStock', cityId: command.cityId },
      reason: 'city.shopSale',
    }),
    emit({
      type: 'ShopOfferCreated',
      offerId: offer.offerId,
      itemId: offer.itemId,
      source: offer.source,
    }),
    emit({ type: 'CityStockItemAvailable', cityId: command.cityId, itemId: command.itemId }),
  ];

  let next = upsertOffer(state, offer);
  if (gate.isPlayerCharacter) {
    next = recordCommerceInteraction(ctx, next, command.sellerCharacterId);
    messages.push(
      emit({
        type: 'CommerceInteractionCompleted',
        actorKind: 'playerCharacter',
        teamId: sellerTeamId,
        characterId: command.sellerCharacterId,
        kind: 'sell',
        cityId: command.cityId,
        sourceId: command.itemId,
        experienceAwardRuleId: gate.experienceAwardRuleId,
      }),
    );
  }

  return accept(next, messages);
}

// 該設施是哪一條 Shop Rule 管的（ShopRuleDefinition.facilityId 的反向查詢）。
export function findShopRuleForFacility(
  definitions: CityDefinitionReader,
  cityId: CityId,
  facilityId: FacilityDefinitionId,
): ShopRuleDefinition | undefined {
  const cityDefinition = definitions.getCity(cityId);
  for (const shopRuleId of cityDefinition.shopRuleIds) {
    const rule = definitions.getShopRule(shopRuleId);
    if (rule.facilityId === facilityId) return rule;
  }
  return undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 buyOrUpgradeHome
// ──────────────────────────────────────────────────────────────────────────

export function handleBuyOrUpgradeHome(
  command: BuyOrUpgradeHomeCommand,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  const city = tryGetCity(state, command.cityId);
  if (city === undefined) return reject('city/unknown-city', { cityId: String(command.cityId) });

  const homeFacilityId = findFacilityIdByKind(ctx.definitions, command.cityId, 'home');
  if (homeFacilityId === undefined) {
    return reject('city/home-facility-not-present', { cityId: String(command.cityId) });
  }
  if (requireOpenFacility(city, homeFacilityId) === undefined) {
    return reject('city/facility-not-open', { facilityId: String(homeFacilityId) });
  }
  if (findTeamOfMemberAtCity(ctx.team, command.cityId, command.payerCharacterId) === undefined) {
    return reject('city/payer-not-formal-member-at-city', {
      characterId: String(command.payerCharacterId),
      cityId: String(command.cityId),
    });
  }

  const cityDefinition = ctx.definitions.getCity(command.cityId);
  const homeRule = ctx.definitions.getHomeRule(cityDefinition.homeRuleId);
  const slotCostOf = (id: HomeUpgradeDefinitionId): number =>
    ctx.definitions.getHomeUpgrade(id).slotCost;

  // 兩條分支互斥：購買（無 homeId／無 upgradeId）與升級（兩者皆有）。
  const targetHomeId = command.homeId;
  const targetUpgradeId = command.upgradeId;
  const isPurchase = targetHomeId === undefined && targetUpgradeId === undefined;
  if (!isPurchase && (targetHomeId === undefined || targetUpgradeId === undefined)) {
    return reject('city/home-command-shape-invalid', {
      hasHomeId: targetHomeId !== undefined,
      hasUpgradeId: targetUpgradeId !== undefined,
    });
  }

  if (targetHomeId === undefined || targetUpgradeId === undefined) {
    if (command.slotCount === undefined) {
      return reject('city/home-slot-count-required', { cityId: String(command.cityId) });
    }
    if (!homeRule.purchasableSlotCounts.includes(command.slotCount)) {
      return reject('city/home-slot-count-not-purchasable', { slotCount: command.slotCount });
    }
    const priceRuleId = homeRule.purchasePriceRuleIds[command.slotCount];
    if (priceRuleId === undefined) {
      return reject('city/home-purchase-price-rule-missing', { slotCount: command.slotCount });
    }
    if (findHomeInCityForOwner(state, command.cityId, command.payerCharacterId) !== undefined) {
      // GDD §八「一座城市限定一間房」＋ doc §3.6 同城唯一性。
      return reject('city/home-already-owned-in-city', {
        cityId: String(command.cityId),
        characterId: String(command.payerCharacterId),
      });
    }
    const initialSlotCost = homeRule.initialUpgradeIds.reduce(
      (sum, id) => sum + slotCostOf(id),
      0,
    );
    if (initialSlotCost > command.slotCount) {
      return reject('city/home-initial-upgrades-exceed-capacity', {
        slotCount: command.slotCount,
        required: initialSlotCost,
      });
    }

    const quote = ctx.economy.getPriceRuleQuote({
      priceRuleId,
      buyerCharacterId: command.payerCharacterId,
      cityId: command.cityId,
      sourceRevision: city.revision,
    });
    const home: HomeInstance = {
      homeId: ctx.ids.nextHomeId(),
      cityId: command.cityId,
      ownerCharacterId: command.payerCharacterId,
      slotCapacity: command.slotCount,
      installedUpgradeIds: [...homeRule.initialUpgradeIds],
      state: 'owned',
      revision: 0 as Revision,
    };
    return accept(upsertHome(state, home), [
      toEconomy({
        type: 'TransferCurrency',
        transferId: ctx.economy.nextTransferId(),
        fromAccountId: ctx.economy.getCharacterAccount(command.payerCharacterId, quote.currencyId),
        toAccountId: ctx.economy.getCityShopAccount(command.cityId, quote.currencyId),
        currencyId: quote.currencyId,
        amount: quote.amount,
        reason: 'city.homePurchase',
        sourceId: command.cityId,
      }),
      emit({
        type: 'HomeChanged',
        homeId: home.homeId,
        ownerId: home.ownerCharacterId,
        change: 'purchased',
      }),
    ]);
  }

  // 升級分支：兩個欄位都在（上面已排除混合形狀，型別也已收窄）。
  const homeId = targetHomeId;
  const upgradeId = targetUpgradeId;
  const home = tryGetHome(state, homeId);
  if (home === undefined) return reject('city/home-not-found', { homeId: String(homeId) });
  if (home.cityId !== command.cityId) {
    return reject('city/home-not-in-city', { homeId: String(homeId), cityId: String(command.cityId) });
  }
  if (home.ownerCharacterId !== command.payerCharacterId) {
    return reject('city/home-owner-mismatch', {
      homeId: String(homeId),
      owner: String(home.ownerCharacterId),
    });
  }
  if (home.state !== 'owned') {
    return reject('city/home-not-owned', { homeId: String(homeId), state: home.state });
  }
  if (!homeRule.allowedUpgradeIds.includes(upgradeId)) {
    return reject('city/home-upgrade-not-allowed', { upgradeId: String(upgradeId) });
  }
  if (home.installedUpgradeIds.includes(upgradeId)) {
    return reject('city/home-upgrade-already-installed', { upgradeId: String(upgradeId) });
  }
  const upgrade = ctx.definitions.getHomeUpgrade(upgradeId);
  const used = installedSlotCost(home, slotCostOf);
  if (used + upgrade.slotCost > home.slotCapacity) {
    return reject('city/home-slot-capacity-exceeded', {
      homeId: String(homeId),
      used,
      required: upgrade.slotCost,
      capacity: home.slotCapacity,
    });
  }

  const messages: TransactionMessageDraft[] = [];
  if (upgrade.priceRuleId !== undefined) {
    const quote = ctx.economy.getPriceRuleQuote({
      priceRuleId: upgrade.priceRuleId,
      buyerCharacterId: command.payerCharacterId,
      cityId: command.cityId,
      sourceRevision: home.revision,
    });
    messages.push(
      toEconomy({
        type: 'TransferCurrency',
        transferId: ctx.economy.nextTransferId(),
        fromAccountId: ctx.economy.getCharacterAccount(command.payerCharacterId, quote.currencyId),
        toAccountId: ctx.economy.getCityShopAccount(command.cityId, quote.currencyId),
        currencyId: quote.currencyId,
        amount: quote.amount,
        reason: 'city.homeUpgrade',
        // HomeId 不在 `EntitySourceRef` 聯集內（見報告：需要 contracts/core 補 ShopOfferId／HomeId），
        // 因此以城市作為來源實體——房屋升級的費用確實發生在該城市。
        sourceId: command.cityId,
      }),
    );
  }
  const nextHome: HomeInstance = {
    ...home,
    installedUpgradeIds: [...home.installedUpgradeIds, upgradeId],
    revision: bumpRevision(home.revision),
  };
  messages.push(
    emit({
      type: 'HomeChanged',
      homeId: nextHome.homeId,
      ownerId: nextHome.ownerCharacterId,
      change: 'upgradeInstalled',
    }),
  );
  return accept(upsertHome(state, nextHome), messages);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 releaseHomeTeacher
// ──────────────────────────────────────────────────────────────────────────

export function handleReleaseHomeTeacher(
  command: ReleaseHomeTeacherCommand,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  const post = tryGetTeachingPost(state, command.postId);
  if (post === undefined) {
    return reject('city/teaching-post-not-found', { postId: String(command.postId) });
  }
  // 冪等：已解除過。資料齊全時仍會走這條（同一崗位被重複解除），故為合法冪等。
  if (post.state === 'released') return accept(state);
  if (post.state === 'interrupted') {
    return reject('city/teaching-post-interrupted', { postId: String(command.postId) });
  }
  if (ctx.worldDay < post.minimumReleaseOnDay) {
    return reject('city/teaching-post-minimum-not-reached', {
      postId: String(command.postId),
      worldDay: ctx.worldDay,
      minimumReleaseOnDay: post.minimumReleaseOnDay,
    });
  }
  const next: HomeTeachingPost = {
    ...post,
    state: 'released',
    revision: bumpRevision(post.revision),
  };
  return accept(upsertTeachingPost(state, next), [
    emit({
      type: 'HomeTeachingPostChanged',
      postId: next.postId,
      homeId: next.homeId,
      teacherCharacterId: next.teacherCharacterId,
      state: 'released',
    }),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.3 Internal Command Handlers
// ──────────────────────────────────────────────────────────────────────────

// ReserveShopOfferForQuest：寫入 sourceQuestId，使該 Offer 不被一般刷新清理；仍可正常購買。
export function handleReserveShopOfferForQuest(
  command: ReserveShopOfferForQuestCommand,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  void ctx;
  const offer = tryGetOffer(state, command.offerId);
  if (offer === undefined) {
    return reject('city/offer-not-found', { offerId: String(command.offerId) });
  }
  // 冪等：同一張委託重複保留。
  if (offer.sourceQuestId === command.sourceQuestId) return accept(state);
  // 別張委託不得奪走既有保留（map 的刷新鎖同一課：只擋 release 會讓覆蓋者連原持有者都解不掉）。
  if (offer.sourceQuestId !== undefined) {
    return reject('city/offer-reserved-by-other-quest', {
      offerId: String(command.offerId),
      reservedBy: String(offer.sourceQuestId),
      requestedBy: String(command.sourceQuestId),
    });
  }
  if (offer.state !== 'available') {
    return reject('city/offer-not-available', { offerId: String(command.offerId), state: offer.state });
  }
  const next: ShopOffer = {
    ...offer,
    sourceQuestId: command.sourceQuestId,
    revision: bumpRevision(offer.revision),
  };
  return accept(upsertOffer(state, next));
}

// ReleaseQuestShopOffer：依 disposition 解除保留（release）或連帶關閉 Offer（expire）。
export function handleReleaseQuestShopOffer(
  command: ReleaseQuestShopOfferCommand,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  void ctx;
  const offer = tryGetOffer(state, command.offerId);
  if (offer === undefined) {
    return reject('city/offer-not-found', { offerId: String(command.offerId) });
  }
  if (offer.sourceQuestId !== undefined && offer.sourceQuestId !== command.sourceQuestId) {
    return reject('city/offer-reserved-by-other-quest', {
      offerId: String(command.offerId),
      reservedBy: String(offer.sourceQuestId),
      requestedBy: String(command.sourceQuestId),
    });
  }
  const targetState: ShopOffer['state'] = command.disposition === 'expire' ? 'expired' : offer.state;
  // 冪等：保留已解除且狀態已是目標狀態。
  if (offer.sourceQuestId === undefined && offer.state === targetState) return accept(state);
  const next: ShopOffer = {
    ...offer,
    sourceQuestId: undefined,
    state: targetState,
    revision: bumpRevision(offer.revision),
  };
  return accept(upsertOffer(state, next));
}

// SetFacilityAvailability：依 World／事件的合法來源改變設施開放狀態。
export function handleSetFacilityAvailability(
  command: SetFacilityAvailabilityCommand,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  void ctx;
  const city = tryGetCity(state, command.cityId);
  if (city === undefined) return reject('city/unknown-city', { cityId: String(command.cityId) });
  const facility = tryGetFacilityState(city, command.facilityId);
  if (facility === undefined) {
    return reject('city/facility-not-in-city', {
      cityId: String(command.cityId),
      facilityId: String(command.facilityId),
    });
  }
  // 冪等：已是同一狀態與同一理由。
  if (
    facility.availability === command.availability &&
    facility.restrictionReason === command.restrictionReason
  ) {
    return accept(state);
  }
  const nextFacility: FacilityRuntimeState = {
    facilityId: facility.facilityId,
    availability: command.availability,
    restrictionReason: command.restrictionReason,
    revision: bumpRevision(facility.revision),
  };
  return accept(upsertCity(state, upsertFacilityState(city, nextFacility)));
}

// ApplyCityMetricEffect：依已驗證 Effect 調整繁榮／安全。換算與上下限全在 Resolver 的 params。
export function handleApplyCityMetricEffect(
  command: ApplyCityMetricEffectCommand,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  const city = tryGetCity(state, command.cityId);
  if (city === undefined) return reject('city/unknown-city', { cityId: String(command.cityId) });
  const cityDefinition = ctx.definitions.getCity(command.cityId);
  const resolved = ctx.resolvers.resolveCityMetricEffect({
    resolverId: cityDefinition.cityMetricEffectResolverId,
    cityId: command.cityId,
    effectId: command.effectId,
    prosperity: city.prosperity,
    safety: city.safety,
  });
  // 冪等：Resolver 已把值夾在上下限，套用後與現值相同（資料齊全時仍會發生，故合法）。
  if (resolved.prosperity === city.prosperity && resolved.safety === city.safety) {
    return accept(state);
  }
  const nextCity: CityRuntimeState = {
    ...city,
    prosperity: resolved.prosperity,
    safety: resolved.safety,
    revision: bumpRevision(city.revision),
  };
  return accept(upsertCity(state, nextCity), [
    emit({
      type: 'CityMetricsChanged',
      cityId: command.cityId,
      prosperity: nextCity.prosperity,
      safety: nextCity.safety,
      sourceId: command.sourceId,
    }),
  ]);
}

// TransferHomeOwnership：驗證原所有者與同城唯一性後移轉房屋（doc §5.3、不變量 14）。
export function handleTransferHomeOwnership(
  command: TransferHomeOwnershipCommand,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  void ctx;
  const home = tryGetHome(state, command.homeId);
  if (home === undefined) return reject('city/home-not-found', { homeId: String(command.homeId) });
  // 冪等：已經是新所有者（同一筆繼承被重送）。
  if (home.ownerCharacterId === command.toCharacterId) return accept(state);
  if (home.ownerCharacterId !== command.fromCharacterId) {
    return reject('city/home-owner-mismatch', {
      homeId: String(command.homeId),
      owner: String(home.ownerCharacterId),
      claimed: String(command.fromCharacterId),
    });
  }
  if (findHomeInCityForOwner(state, home.cityId, command.toCharacterId) !== undefined) {
    return reject('city/home-already-owned-in-city', {
      cityId: String(home.cityId),
      characterId: String(command.toCharacterId),
    });
  }
  const next: HomeInstance = {
    ...home,
    ownerCharacterId: command.toCharacterId,
    state: 'owned',
    revision: bumpRevision(home.revision),
  };
  return accept(upsertHome(state, next), [
    emit({
      type: 'HomeChanged',
      homeId: next.homeId,
      ownerId: next.ownerCharacterId,
      change: 'ownershipTransferred',
    }),
  ]);
}

// InterruptHomeTeachingPost：教師不再可用時標為 interrupted，由事件通知 Child Study 立即部分結算。
export function handleInterruptHomeTeachingPost(
  command: InterruptHomeTeachingPostCommand,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  void ctx;
  const post = tryGetTeachingPost(state, command.postId);
  if (post === undefined) {
    return reject('city/teaching-post-not-found', { postId: String(command.postId) });
  }
  // 冪等：已中斷過。
  if (post.state === 'interrupted') return accept(state);
  if (post.state === 'released') {
    return reject('city/teaching-post-already-released', { postId: String(command.postId) });
  }
  const next: HomeTeachingPost = {
    ...post,
    state: 'interrupted',
    revision: bumpRevision(post.revision),
  };
  return accept(upsertTeachingPost(state, next), [
    emit({
      type: 'HomeTeachingPostChanged',
      postId: next.postId,
      homeId: next.homeId,
      teacherCharacterId: next.teacherCharacterId,
      state: 'interrupted',
    }),
  ]);
}

// RevealTavernIntel：驗證酒館、隊伍與 Intel Lead 後標記揭露（doc §5.3、§8.2）。
export function handleRevealTavernIntel(
  command: RevealTavernIntelCommand,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  const city = tryGetCity(state, command.cityId);
  if (city === undefined) return reject('city/unknown-city', { cityId: String(command.cityId) });
  const tavernId = findFacilityIdByKind(ctx.definitions, command.cityId, 'tavern');
  if (tavernId === undefined) {
    return reject('city/tavern-not-present', { cityId: String(command.cityId) });
  }
  if (requireOpenFacility(city, tavernId) === undefined) {
    return reject('city/facility-not-open', { facilityId: String(tavernId) });
  }
  if (!ctx.team.listTeamsAtCity(command.cityId).includes(command.teamId)) {
    return reject('city/team-not-at-city', {
      teamId: String(command.teamId),
      cityId: String(command.cityId),
    });
  }
  const intel = tryGetIntel(state, command.intelId);
  if (intel === undefined) {
    return reject('city/intel-not-found', { intelId: String(command.intelId) });
  }
  if (intel.cityId !== command.cityId) {
    return reject('city/intel-not-in-city', {
      intelId: String(command.intelId),
      cityId: String(command.cityId),
    });
  }
  if (intel.state === 'obsolete') {
    return reject('city/intel-obsolete', { intelId: String(command.intelId) });
  }
  // 冪等：這支隊伍已經知道了（資料齊全時仍會發生）。Social 額度是否消耗由 Workflow 決定。
  if (intel.revealedToTeamIds.includes(command.teamId)) return accept(state);

  const next: IntelLead = {
    ...intel,
    state: 'revealed',
    revealedToTeamIds: [...intel.revealedToTeamIds, command.teamId],
    revision: bumpRevision(intel.revision),
  };
  return accept(upsertIntel(state, next), [
    emit({
      type: 'IntelRevealed',
      intelId: next.intelId,
      teamId: command.teamId,
      sourceContentId: next.sourceContentId,
    }),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 Job：shopRefresh（doc §8.1）
// ──────────────────────────────────────────────────────────────────────────

export function handleShopRefresh(
  job: ShopRefreshJob,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  const rule = ctx.definitions.getShopRule(job.targetId);

  // 這條規則屬哪座城市：由 CityDefinition.shopRuleIds 反查（決定性走訪：listCities 已排序）。
  const owner = listCities(state).find((city) =>
    ctx.definitions.getCity(city.cityId).shopRuleIds.includes(job.targetId),
  );
  if (owner === undefined) {
    return reject('city/shop-rule-has-no-city', { shopRuleId: String(job.targetId) });
  }
  const facilityState = tryGetFacilityState(owner, rule.facilityId);
  if (facilityState === undefined) {
    return reject('city/facility-not-in-city', {
      cityId: String(owner.cityId),
      facilityId: String(rule.facilityId),
    });
  }
  // Base Catalog 的 Offer 必須引用真實 ItemInstance（doc §3.2、不變量 1），而 ItemInstanceId 只有
  // inventory 能鑄造，且本專案禁止跨模組同步取回（HANDOFF 慣例）。因此「建立實體 → 建立 Offer」
  // 是兩筆交易，必須由 Workflow 編排（doc §6 也把買賣歸給 Workflow）；City Handler 無法完成它。
  // 缺這條 Workflow 時明確拒絕，而不是靜靜略過 baseCatalogPoolId。
  if (rule.baseCatalogPoolId !== undefined) {
    return reject('city/base-catalog-refresh-needs-workflow', {
      shopRuleId: String(job.targetId),
      itemPoolId: String(rule.baseCatalogPoolId),
    });
  }

  const cityId = owner.cityId;
  let next = state;
  const messages: TransactionMessageDraft[] = [];
  const existing = listOffersForFacility(state, cityId, rule.facilityId);

  // 步驟 1–2：playerSold 舊 Offer 清除並移除實體；Quest 保留中的實體不可清（不變量 4）。
  if (rule.clearPlayerSoldOnRefresh) {
    for (const offer of existing) {
      if (offer.source !== 'playerSold' || offer.state !== 'available') continue;
      if (offer.sourceQuestId !== undefined) continue;
      next = upsertOffer(next, {
        ...offer,
        state: 'expired',
        revision: bumpRevision(offer.revision),
      });
      messages.push(
        toInventory({ type: 'RemoveItemInstance', itemId: offer.itemId, reason: 'refreshCleanup' }),
      );
    }
  }

  // 步驟 3：未售出的 permanentStock Offer 下架。實體本來就留在 cityPermanentStock（City 不把它搬到
  // 貨架——`ItemLocation.shopShelf` 需要一個沒有任何模組鑄造的 ShopId），因此「回到永久庫存、
  // 不得消失」（不變量 5）由「從未離開」滿足；下架後該實體重新成為抽取候選。
  for (const offer of existing) {
    if (offer.source !== 'permanentStock' || offer.state !== 'available') continue;
    if (offer.sourceQuestId !== undefined) continue;
    next = upsertOffer(next, {
      ...offer,
      state: 'expired',
      revision: bumpRevision(offer.revision),
    });
  }

  // 步驟 4–5：以永久庫存為候選，固定 RNG Stream 抽 permanentStockOfferCount 件建立新 Offer。
  const walk = newWalk(ctx);
  const candidates = ctx.inventory
    .listAtLocation({ kind: 'cityPermanentStock', cityId })
    .filter(
      (item) =>
        item.state === 'active' &&
        !ctx.inventory.isReserved(item.itemId) &&
        findAvailableOfferForItemId(next, item.itemId) === undefined,
    )
    .slice()
    .sort((a, b) => (String(a.itemId) < String(b.itemId) ? -1 : 1));

  const drawn = drawInt(
    ctx,
    walk,
    rule.permanentStockOfferCount.min,
    rule.permanentStockOfferCount.max,
  );
  const takeCount = Math.min(Math.max(drawn, 0), candidates.length);
  const pool = [...candidates];
  const createdOfferIds: ShopOfferId[] = [];
  for (let i = 0; i < takeCount; i += 1) {
    const index = drawInt(ctx, walk, 0, pool.length - 1);
    const picked = pool.splice(index, 1)[0];
    if (picked === undefined) break;
    const offer: ShopOffer = {
      offerId: ctx.ids.nextShopOfferId(),
      cityId,
      facilityId: rule.facilityId,
      itemId: picked.itemId,
      source: 'permanentStock',
      priceRuleId: rule.priceRuleId,
      state: 'available',
      createdOnDay: ctx.worldDay,
      revision: 0 as Revision,
    };
    next = upsertOffer(next, offer);
    createdOfferIds.push(offer.offerId);
    messages.push(
      emit({
        type: 'ShopOfferCreated',
        offerId: offer.offerId,
        itemId: offer.itemId,
        source: offer.source,
      }),
      emit({ type: 'CityStockItemAvailable', cityId, itemId: offer.itemId }),
    );
  }

  messages.push(
    emit({
      type: 'ShopRefreshed',
      cityId,
      shopId: rule.facilityId,
      offerIds: createdOfferIds,
    }),
  );

  // 下一次刷新：Job 於交易成功提交時就被 dequeue，不自行重排就再也不會刷新。
  const nextJob: ScheduledJobDraft<ShopRefreshJob> = {
    type: 'shopRefresh',
    dueDay: ctx.worldDay + rule.refreshCadenceDays,
    ownerModule: CITY_MODULE_ID,
    targetId: job.targetId,
    payload: {},
  };
  return accept(next, messages, [nextJob]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 Job：escortGeneration（doc §2.4）
// ──────────────────────────────────────────────────────────────────────────

export function handleEscortGeneration(
  job: EscortGenerationJob,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  const city = tryGetCity(state, job.targetId);
  if (city === undefined) return reject('city/unknown-city', { cityId: String(job.targetId) });
  const cityDefinition = ctx.definitions.getCity(job.targetId);
  const rule = ctx.definitions.getEscortGenerationRule(cityDefinition.escortGenerationRuleId);

  // doc §2.4：`deadlineResolverId` 可缺省，但缺省時不得啟用護衛候選生成。
  const deadlineResolverId = rule.deadlineResolverId;
  if (deadlineResolverId === undefined) {
    return reject('city/escort-deadline-resolver-missing', {
      escortGenerationRuleId: String(rule.id),
    });
  }
  if (rule.allowedArchetypeIds.length === 0) {
    return reject('city/escort-archetype-pool-empty', {
      escortGenerationRuleId: String(rule.id),
    });
  }

  const walk = newWalk(ctx);
  const count = drawInt(ctx, walk, rule.candidateCount.min, rule.candidateCount.max);

  let next = state;
  const candidateIds: EscortCandidateId[] = [];
  for (let i = 0; i < count; i += 1) {
    const archetypeIndex = drawInt(ctx, walk, 0, rule.allowedArchetypeIds.length - 1);
    const archetypeId = rule.allowedArchetypeIds[archetypeIndex];
    if (archetypeId === undefined) break;

    const destination = ctx.resolvers.resolveEscortDestination({
      resolverId: rule.destinationResolverId,
      originCityId: job.targetId,
      archetypeId,
      rng: walkContext(ctx, walk),
    });
    walk.cursor = destination.nextCursor;

    const deadlines = ctx.resolvers.resolveEscortDeadlines({
      resolverId: deadlineResolverId,
      originCityId: job.targetId,
      destinationCityId: destination.value,
      generatedOnDay: ctx.worldDay,
      rng: walkContext(ctx, walk),
    });
    walk.cursor = deadlines.nextCursor;

    // doc §3.4：EscortCandidate 不是 Character——沒有名字、生命與隊伍位置（不變量 10）。
    const candidate: EscortCandidate = {
      candidateId: ctx.ids.nextEscortCandidateId(),
      originCityId: job.targetId,
      destinationCityId: destination.value,
      archetypeId,
      generatedOnDay: ctx.worldDay,
      acceptDeadline: deadlines.value.acceptDeadline,
      actualEndDeadline: deadlines.value.actualEndDeadline,
      state: 'available',
      revision: 0 as Revision,
    };
    next = upsertEscortCandidate(next, candidate);
    candidateIds.push(candidate.candidateId);
  }

  const nextJob: ScheduledJobDraft<EscortGenerationJob> = {
    type: 'escortGeneration',
    dueDay: ctx.worldDay + rule.cadenceDays,
    ownerModule: CITY_MODULE_ID,
    targetId: job.targetId,
    payload: {},
  };
  return accept(
    next,
    [emit({ type: 'EscortCandidatesGenerated', cityId: job.targetId, candidateIds })],
    [nextJob],
  );
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 Job：cityPopulationReview（doc §2.4 / §5.2）
// ──────────────────────────────────────────────────────────────────────────

export function handleCityPopulationReview(
  job: CityPopulationReviewJob,
  state: CityState,
  ctx: CityHandlerContext,
): CityHandlerResult {
  const city = tryGetCity(state, job.targetId);
  if (city === undefined) return reject('city/unknown-city', { cityId: String(job.targetId) });
  const cityDefinition = ctx.definitions.getCity(job.targetId);
  const rule = ctx.definitions.getPopulationSupplyRule(cityDefinition.populationSupplyRuleId);

  const currentSupplyCount = ctx.supply.countAdventurerSupply(job.targetId);
  const targetCount = ctx.resolvers.resolvePopulationTargetCount({
    resolverId: rule.targetCountResolverId,
    cityId: job.targetId,
    prosperity: city.prosperity,
    safety: city.safety,
    currentSupplyCount,
  });
  const deficit = targetCount - currentSupplyCount;
  const demand = deficit > 0 ? Math.min(deficit, rule.batchLimit) : 0;

  const messages: TransactionMessageDraft[] = [];
  if (demand > 0) {
    const cultureId = ctx.world.getNativeCulture(ctx.world.getRegionForCity(job.targetId));
    messages.push(
      emit({
        type: 'AdventurerSupplyDemanded',
        cityId: job.targetId,
        cultureId,
        count: demand,
        adventurerGenerationRuleId: rule.adventurerGenerationRuleId,
        reason: 'populationReviewDeficit',
      }),
    );
  }

  const nextJob: ScheduledJobDraft<CityPopulationReviewJob> = {
    type: 'cityPopulationReview',
    dueDay: ctx.worldDay + rule.cadenceDays,
    ownerModule: CITY_MODULE_ID,
    targetId: job.targetId,
    payload: {},
  };
  // 沒有缺口時不改 Slice，但仍重排下一批次——這不是 no-op，而是「本批次結論是不需補充」。
  return accept(state, messages, [nextJob]);
}
