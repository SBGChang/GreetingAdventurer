// modules/city/fixtures.ts
// 最小 Fixture：一座城市（旅館／酒館／道具店／家四個設施）+ 一條道具店 Shop Rule + 房屋規則
// + 護衛與人口規則，另附決定性 stub Port 與一站式 CityHandlerContext。
//
// 全部 stub 皆為決定性（無真 RNG／時間）；RNG 以顯式 cursor 的雜湊模擬。
// 正式路徑不得引用本檔（門禁：scripts/verify-runtime-discipline.ts）。

import type {
  CityId,
  CharacterId,
  TeamId,
  ContentPackId,
  ContentInstanceId,
  CultureId,
  CurrencyId,
  DefinitionId,
  EconomyAccountId,
  EconomyTransferId,
  EscortCandidateId,
  ExperienceAwardRuleId,
  FacilityDefinitionId,
  HomeId,
  HomeRuleId,
  HomeTeachingPostId,
  HomeUpgradeDefinitionId,
  IntelLeadId,
  IntelRuleId,
  ItemInstanceId,
  ItemDefinitionId,
  EscortGenerationRuleId,
  PopulationSupplyRuleId,
  PlayerCommerceDailyLimitId,
  PlayerCommercePracticeRuleId,
  PlayerCommerceUsageId,
  PriceRuleId,
  PriceQuoteId,
  RegionId,
  ResolverId,
  Revision,
  RngCursor,
  RngStreamId,
  Seed,
  ShopOfferId,
  ShopRuleId,
  CityActionRuleId,
  CharacterArchetypeId,
  WorldAdventurerGenerationRuleId,
  WorldDay,
  DeterministicRng,
} from '../../contracts/core';
import type {
  CityState,
  CityDefinition,
  CityDefinitionReader,
  FacilityDefinition,
  ShopRuleDefinition,
  IntelRuleDefinition,
  EscortGenerationRuleDefinition,
  PopulationSupplyRuleDefinition,
  HomeRuleDefinition,
  HomeUpgradeDefinition,
  CityActionRuleDefinition,
  ItemPoolId,
  PlayerCommerceDailyLimitDefinition,
  PlayerCommercePracticeRuleDefinition,
  ShopOffer,
  IntelLead,
  HomeInstance,
  HomeTeachingPost,
} from '../../contracts/city';
import type { ItemInstanceView, ItemLocation } from '../../contracts/inventory';
import type { PriceQuote } from '../../contracts/economy';

import { createCityState, createCityRuntimeState } from './state';
import type {
  CityHandlerContext,
  CityIdAllocator,
  CityTeamPort,
  CityInventoryPort,
  CityEconomyPort,
  CityWorldPort,
  CityAdventurerSupplyPort,
  CityResolverPort,
} from './system';

// ── ID 常數 ──────────────────────────────────────────────────────────────────
const PACK_ID = 'pack-test' as ContentPackId;

export const CITY_ID = 'city-fixture' as CityId;
export const OTHER_CITY_ID = 'city-other' as CityId;
export const REGION_ID = 'region-fixture' as RegionId;
export const CULTURE_ID = 'culture-fixture' as CultureId;

export const FACILITY_INN = 'facility-inn' as FacilityDefinitionId;
export const FACILITY_TAVERN = 'facility-tavern' as FacilityDefinitionId;
export const FACILITY_ITEM_SHOP = 'facility-item-shop' as FacilityDefinitionId;
export const FACILITY_HOME = 'facility-home' as FacilityDefinitionId;

export const SHOP_RULE_ITEM = 'shop-rule-item' as ShopRuleId;
export const SHOP_RULE_BOOK_WITH_CATALOG = 'shop-rule-book' as ShopRuleId;
export const PRICE_RULE_ID = 'price-rule-generic' as PriceRuleId;
export const HOME_PRICE_RULE_ID = 'price-rule-home' as PriceRuleId;
export const UPGRADE_PRICE_RULE_ID = 'price-rule-upgrade' as PriceRuleId;
export const INTEL_RULE_ID = 'intel-rule-fixture' as IntelRuleId;
export const ESCORT_RULE_ID = 'escort-rule-fixture' as EscortGenerationRuleId;
export const ESCORT_RULE_NO_DEADLINE_ID = 'escort-rule-no-deadline' as EscortGenerationRuleId;
export const POPULATION_RULE_ID = 'population-rule-fixture' as PopulationSupplyRuleId;
export const HOME_RULE_ID = 'home-rule-fixture' as HomeRuleId;
export const COMMERCE_LIMIT_ID = 'commerce-limit-fixture' as PlayerCommerceDailyLimitId;
export const COMMERCE_PRACTICE_ID = 'commerce-practice-fixture' as PlayerCommercePracticeRuleId;
export const COMMERCE_EXP_RULE_ID = 'exp-rule-commerce' as ExperienceAwardRuleId;
export const CITY_ACTION_INN_REST = 'city-action-inn-rest' as CityActionRuleId;
export const METRIC_RESOLVER_ID = 'resolver:city-metric' as ResolverId;
export const ESCORT_DESTINATION_RESOLVER_ID = 'resolver:escort-destination' as ResolverId;
export const ESCORT_DEADLINE_RESOLVER_ID = 'resolver:escort-deadline' as ResolverId;
export const POPULATION_RESOLVER_ID = 'resolver:population-target' as ResolverId;
export const INTEL_RESOLVER_ID = 'resolver:intel' as ResolverId;
export const ADVENTURER_GENERATION_RULE_ID =
  'world-adventurer-gen-fixture' as WorldAdventurerGenerationRuleId;
export const ARCHETYPE_ID = 'archetype-escort-merchant' as CharacterArchetypeId;
export const ITEM_POOL_ID = 'item-pool-basic-books' as ItemPoolId;

export const UPGRADE_ROOM = 'home-upgrade-room' as HomeUpgradeDefinitionId;
export const UPGRADE_STORAGE = 'home-upgrade-storage' as HomeUpgradeDefinitionId;
export const UPGRADE_FORGE = 'home-upgrade-forge' as HomeUpgradeDefinitionId;
export const UPGRADE_UNLISTED = 'home-upgrade-unlisted' as HomeUpgradeDefinitionId;

export const PLAYER_CHARACTER_ID = 'char-player' as CharacterId;
export const COMPANION_CHARACTER_ID = 'char-companion' as CharacterId;
export const OUTSIDER_CHARACTER_ID = 'char-outsider' as CharacterId;
export const HEIR_CHARACTER_ID = 'char-heir' as CharacterId;
export const PLAYER_TEAM_ID = 'team-player' as TeamId;
export const OTHER_TEAM_ID = 'team-other' as TeamId;

export const STOCK_ITEM_A = 'item-stock-a' as ItemInstanceId;
export const STOCK_ITEM_B = 'item-stock-b' as ItemInstanceId;
export const STOCK_ITEM_C = 'item-stock-c' as ItemInstanceId;
export const PLAYER_ITEM_ID = 'item-player-sword' as ItemInstanceId;
const ITEM_DEFINITION_ID = 'item-def-generic' as ItemDefinitionId;

export const OFFER_AVAILABLE = 'offer-available' as ShopOfferId;
export const OFFER_PLAYER_SOLD = 'offer-player-sold' as ShopOfferId;
export const INTEL_ID = 'intel-fixture' as IntelLeadId;
export const INTEL_SOURCE_CONTENT_ID = 'content-instance-fixture' as ContentInstanceId;
export const HOME_ID = 'home-fixture' as HomeId;
export const POST_ID = 'teaching-post-fixture' as HomeTeachingPostId;

const CURRENCY_ID = 'currency-gold' as CurrencyId;
const PAYER_ACCOUNT_ID = 'account-payer' as EconomyAccountId;
const SHOP_ACCOUNT_ID = 'account-shop' as EconomyAccountId;
const QUOTE_ID = 'quote-fixture' as PriceQuoteId;

// ── Definition ───────────────────────────────────────────────────────────────

function header<TId extends DefinitionId>(id: TId) {
  return { id, schemaVersion: 1, packId: PACK_ID, enabled: true } as const;
}

export const CITY_DEFINITION: CityDefinition = {
  ...header(CITY_ID as DefinitionId),
  worldCityId: CITY_ID,
  facilityIds: [FACILITY_INN, FACILITY_TAVERN, FACILITY_ITEM_SHOP, FACILITY_HOME],
  shopRuleIds: [SHOP_RULE_ITEM],
  intelRuleId: INTEL_RULE_ID,
  escortGenerationRuleId: ESCORT_RULE_ID,
  homeRuleId: HOME_RULE_ID,
  populationSupplyRuleId: POPULATION_RULE_ID,
  playerCommerceDailyLimitId: COMMERCE_LIMIT_ID,
  playerCommercePracticeRuleId: COMMERCE_PRACTICE_ID,
  cityMetricEffectResolverId: METRIC_RESOLVER_ID,
};

const FACILITIES: readonly FacilityDefinition[] = [
  { ...header(FACILITY_INN), facilityKind: 'inn', actionRuleIds: [CITY_ACTION_INN_REST] },
  { ...header(FACILITY_TAVERN), facilityKind: 'tavern', actionRuleIds: [] },
  { ...header(FACILITY_ITEM_SHOP), facilityKind: 'itemShop', actionRuleIds: [] },
  { ...header(FACILITY_HOME), facilityKind: 'home', actionRuleIds: [] },
];

export const SHOP_RULE: ShopRuleDefinition = {
  ...header(SHOP_RULE_ITEM),
  shopKind: 'item',
  facilityId: FACILITY_ITEM_SHOP,
  refreshCadenceDays: 30,
  refreshOffsetDays: 3,
  permanentStockOfferCount: { min: 2, max: 2 },
  priceRuleId: PRICE_RULE_ID,
  clearPlayerSoldOnRefresh: true,
};

// 帶 baseCatalogPoolId 的規則：用來釘住「基礎目錄刷新需要 Workflow」的明確拒絕。
export const SHOP_RULE_WITH_CATALOG: ShopRuleDefinition = {
  ...header(SHOP_RULE_BOOK_WITH_CATALOG),
  shopKind: 'book',
  facilityId: FACILITY_ITEM_SHOP,
  refreshCadenceDays: 30,
  refreshOffsetDays: 3,
  permanentStockOfferCount: { min: 1, max: 1 },
  baseCatalogPoolId: ITEM_POOL_ID,
  priceRuleId: PRICE_RULE_ID,
  clearPlayerSoldOnRefresh: true,
};

const INTEL_RULE: IntelRuleDefinition = {
  ...header(INTEL_RULE_ID),
  resolverId: INTEL_RESOLVER_ID,
};

export const ESCORT_RULE: EscortGenerationRuleDefinition = {
  ...header(ESCORT_RULE_ID),
  cadenceDays: 7,
  cityOffsetDays: 2,
  candidateCount: { min: 0, max: 5 },
  allowedArchetypeIds: [ARCHETYPE_ID],
  destinationResolverId: ESCORT_DESTINATION_RESOLVER_ID,
  deadlineResolverId: ESCORT_DEADLINE_RESOLVER_ID,
};

export const ESCORT_RULE_NO_DEADLINE: EscortGenerationRuleDefinition = {
  ...ESCORT_RULE,
  ...header(ESCORT_RULE_NO_DEADLINE_ID),
  deadlineResolverId: undefined,
};

export const POPULATION_RULE: PopulationSupplyRuleDefinition = {
  ...header(POPULATION_RULE_ID),
  cadenceDays: 30,
  cityOffsetDays: 1,
  targetCountResolverId: POPULATION_RESOLVER_ID,
  batchLimit: 3,
  adventurerGenerationRuleId: ADVENTURER_GENERATION_RULE_ID,
};

export const HOME_RULE: HomeRuleDefinition = {
  ...header(HOME_RULE_ID),
  purchasableSlotCounts: [4, 8],
  purchasePriceRuleIds: { 4: HOME_PRICE_RULE_ID, 8: HOME_PRICE_RULE_ID },
  initialUpgradeIds: [UPGRADE_ROOM, UPGRADE_STORAGE],
  allowedUpgradeIds: [UPGRADE_FORGE],
};

const HOME_UPGRADES: readonly HomeUpgradeDefinition[] = [
  { ...header(UPGRADE_ROOM), upgradeKind: 'room', slotCost: 1, actionRuleIds: [] },
  { ...header(UPGRADE_STORAGE), upgradeKind: 'storage', slotCost: 1, actionRuleIds: [] },
  {
    ...header(UPGRADE_FORGE),
    upgradeKind: 'forge',
    slotCost: 2,
    actionRuleIds: [],
    priceRuleId: UPGRADE_PRICE_RULE_ID,
  },
  { ...header(UPGRADE_UNLISTED), upgradeKind: 'musicHall', slotCost: 1, actionRuleIds: [] },
];

const CITY_ACTION_RULES: readonly CityActionRuleDefinition[] = [
  {
    ...header(CITY_ACTION_INN_REST),
    kind: 'innRest',
    scope: 'team',
    durationDays: 1,
    requiredFacilityKind: 'inn',
    completionResolverId: INTEL_RESOLVER_ID,
  },
];

export const COMMERCE_LIMIT: PlayerCommerceDailyLimitDefinition = {
  ...header(COMMERCE_LIMIT_ID),
  maxCommerceInteractionsPerDay: 6,
};

const COMMERCE_PRACTICE: PlayerCommercePracticeRuleDefinition = {
  ...header(COMMERCE_PRACTICE_ID),
  commerceExperienceRuleId: COMMERCE_EXP_RULE_ID,
};

// ── Stub Definition Reader ───────────────────────────────────────────────────

function byId<TId extends DefinitionId, TDef extends { id: TId }>(
  defs: readonly TDef[],
  label: string,
): (id: TId) => TDef {
  const map = new Map<string, TDef>(defs.map((d) => [String(d.id), d]));
  return (id) => {
    const found = map.get(String(id));
    if (found === undefined) throw new Error(`${label}: unknown definition "${String(id)}"`);
    return found;
  };
}

export function stubDefinitionReader(
  overrides: Partial<CityDefinitionReader> = {},
): CityDefinitionReader {
  const base: CityDefinitionReader = {
    getCity: (id: CityId) => {
      if (String(id) !== String(CITY_ID)) throw new Error(`city: unknown city "${String(id)}"`);
      return CITY_DEFINITION;
    },
    getFacility: byId(FACILITIES, 'facility'),
    getShopRule: byId([SHOP_RULE, SHOP_RULE_WITH_CATALOG], 'shopRule'),
    getIntelRule: byId([INTEL_RULE], 'intelRule'),
    getEscortGenerationRule: byId([ESCORT_RULE, ESCORT_RULE_NO_DEADLINE], 'escortRule'),
    getHomeRule: byId([HOME_RULE], 'homeRule'),
    getHomeUpgrade: byId(HOME_UPGRADES, 'homeUpgrade'),
    getCityActionRule: byId(CITY_ACTION_RULES, 'cityActionRule'),
    getPopulationSupplyRule: byId([POPULATION_RULE], 'populationRule'),
    getPlayerCommerceDailyLimit: byId([COMMERCE_LIMIT], 'commerceLimit'),
    getPlayerCommercePracticeRule: byId([COMMERCE_PRACTICE], 'commercePractice'),
  };
  return { ...base, ...overrides };
}

// ── State ────────────────────────────────────────────────────────────────────

export function fixtureCityRuntime(
  overrides: Partial<Parameters<typeof createCityRuntimeState>[0]> = {},
) {
  return createCityRuntimeState({
    cityId: CITY_ID,
    facilityIds: CITY_DEFINITION.facilityIds,
    prosperity: 40,
    safety: 50,
    ...overrides,
  });
}

export function fixtureOffer(overrides: Partial<ShopOffer> = {}): ShopOffer {
  return {
    offerId: OFFER_AVAILABLE,
    cityId: CITY_ID,
    facilityId: FACILITY_ITEM_SHOP,
    itemId: STOCK_ITEM_A,
    source: 'permanentStock',
    priceRuleId: PRICE_RULE_ID,
    state: 'available',
    createdOnDay: 10 as WorldDay,
    revision: 0 as Revision,
    ...overrides,
  };
}

export function fixtureIntel(overrides: Partial<IntelLead> = {}): IntelLead {
  return {
    intelId: INTEL_ID,
    cityId: CITY_ID,
    sourceContentId: INTEL_SOURCE_CONTENT_ID,
    kind: 'mapItem',
    state: 'available',
    revealedToTeamIds: [],
    revision: 0 as Revision,
    ...overrides,
  };
}

export function fixtureHome(overrides: Partial<HomeInstance> = {}): HomeInstance {
  return {
    homeId: HOME_ID,
    cityId: CITY_ID,
    ownerCharacterId: PLAYER_CHARACTER_ID,
    slotCapacity: 4,
    installedUpgradeIds: [UPGRADE_ROOM, UPGRADE_STORAGE],
    state: 'owned',
    revision: 0 as Revision,
    ...overrides,
  };
}

export function fixtureTeachingPost(overrides: Partial<HomeTeachingPost> = {}): HomeTeachingPost {
  return {
    postId: POST_ID,
    homeId: HOME_ID,
    teacherCharacterId: COMPANION_CHARACTER_ID,
    startedOnDay: 10 as WorldDay,
    minimumReleaseOnDay: 38 as WorldDay,
    state: 'active',
    revision: 0 as Revision,
    ...overrides,
  };
}

export function fixtureCityState(
  input: Parameters<typeof createCityState>[0] = {},
): CityState {
  return createCityState({ cities: [fixtureCityRuntime()], ...input });
}

// ── Stub Port ────────────────────────────────────────────────────────────────

export function stubTeamPort(
  opts: Readonly<{
    playerCharacterId?: CharacterId;
    teamsByCity?: Readonly<Record<string, readonly TeamId[]>>;
    membersByTeam?: Readonly<Record<string, readonly CharacterId[]>>;
  }> = {},
): CityTeamPort {
  const teamsByCity = opts.teamsByCity ?? { [String(CITY_ID)]: [PLAYER_TEAM_ID] };
  const membersByTeam =
    opts.membersByTeam ?? {
      [String(PLAYER_TEAM_ID)]: [PLAYER_CHARACTER_ID, COMPANION_CHARACTER_ID],
      [String(OTHER_TEAM_ID)]: [OUTSIDER_CHARACTER_ID],
    };
  return {
    getPlayerControlledCharacterId: () => opts.playerCharacterId ?? PLAYER_CHARACTER_ID,
    listTeamsAtCity: (cityId) => [...(teamsByCity[String(cityId)] ?? [])],
    listFormalMembers: (teamId) => [...(membersByTeam[String(teamId)] ?? [])],
  };
}

function itemView(itemId: ItemInstanceId, location: ItemLocation): ItemInstanceView {
  return {
    itemId,
    definitionId: ITEM_DEFINITION_ID,
    quantity: 1,
    location,
    state: 'active',
    revision: 0 as Revision,
  };
}

export function stubInventoryPort(
  opts: Readonly<{
    permanentStock?: readonly ItemInstanceId[];
    ownerOf?: Readonly<Record<string, CharacterId>>;
    reserved?: readonly ItemInstanceId[];
    tradable?: boolean;
  }> = {},
): CityInventoryPort {
  const stock = opts.permanentStock ?? [STOCK_ITEM_A, STOCK_ITEM_B, STOCK_ITEM_C];
  const ownerOf = opts.ownerOf ?? { [String(PLAYER_ITEM_ID)]: PLAYER_CHARACTER_ID };
  const reserved = new Set((opts.reserved ?? []).map(String));
  const known = new Map<string, ItemInstanceView>();
  for (const id of stock) known.set(String(id), itemView(id, { kind: 'cityPermanentStock', cityId: CITY_ID }));
  for (const [itemId, characterId] of Object.entries(ownerOf)) {
    known.set(itemId, {
      ...itemView(itemId as ItemInstanceId, { kind: 'characterBag', characterId }),
      ownerCharacterId: characterId,
    });
  }
  return {
    getItem: (itemId) => known.get(String(itemId)),
    listAtLocation: (location) =>
      location.kind === 'cityPermanentStock'
        ? stock.map((id) => itemView(id, { kind: 'cityPermanentStock', cityId: location.cityId }))
        : [],
    characterOwnsItem: (characterId, itemId) => ownerOf[String(itemId)] === characterId,
    isReserved: (itemId) => reserved.has(String(itemId)),
    isTradable: () => opts.tradable ?? true,
  };
}

export function stubEconomyPort(
  opts: Readonly<{ amount?: number; transferIdPrefix?: string }> = {},
): CityEconomyPort {
  let transferSeq = 0;
  const quote = (): PriceQuote => ({
    quoteId: QUOTE_ID,
    currencyId: CURRENCY_ID,
    amount: opts.amount ?? 100,
    priceRuleId: PRICE_RULE_ID,
    modifierBreakdown: [],
    validFor: { sourceRevision: 0 as Revision, pricingEpochs: {} },
  });
  return {
    nextTransferId: () => {
      transferSeq += 1;
      return `${opts.transferIdPrefix ?? 'transfer'}-${transferSeq}` as EconomyTransferId;
    },
    getCharacterAccount: () => PAYER_ACCOUNT_ID,
    getCityShopAccount: () => SHOP_ACCOUNT_ID,
    getShopOfferPurchaseQuote: quote,
    getSellQuote: quote,
    getPriceRuleQuote: quote,
  };
}

export function stubWorldPort(): CityWorldPort {
  return {
    getRegionForCity: () => REGION_ID,
    getNativeCulture: () => CULTURE_ID,
  };
}

export function stubSupplyPort(count = 5): CityAdventurerSupplyPort {
  return { countAdventurerSupply: () => count };
}

export function makeIdAllocator(prefix = 'gen'): CityIdAllocator {
  let n = 0;
  const next = (kind: string): string => {
    n += 1;
    return `${prefix}-${kind}-${n}`;
  };
  return {
    nextShopOfferId: () => next('offer') as ShopOfferId,
    nextIntelLeadId: () => next('intel') as IntelLeadId,
    nextEscortCandidateId: () => next('escort') as EscortCandidateId,
    nextHomeId: () => next('home') as HomeId,
    nextHomeTeachingPostId: () => next('post') as HomeTeachingPostId,
    nextPlayerCommerceUsageId: () => next('usage') as PlayerCommerceUsageId,
  };
}

// 決定性 RNG：以 cursor 雜湊產生 [0,1) 值；nextInt 夾入 [min,max]。
export function stubRng(): DeterministicRng {
  const hash = (n: number): number => {
    let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 0x100000000;
  };
  const asNumber = (cursor: RngCursor): number => Number(cursor);
  return {
    nextFloat: ({ cursor }) => ({
      value: hash(asNumber(cursor)),
      nextCursor: (asNumber(cursor) + 1) as RngCursor,
    }),
    nextInt: ({ cursor, minInclusive, maxInclusive }) => {
      const span = maxInclusive - minInclusive + 1;
      const value =
        span <= 0 ? minInclusive : minInclusive + Math.floor(hash(asNumber(cursor)) * span);
      return { value, nextCursor: (asNumber(cursor) + 1) as RngCursor };
    },
  };
}

export function stubRngContext(cursor = 0) {
  return {
    worldSeed: 'seed-test' as Seed,
    streamId: 'rng-city' as RngStreamId,
    cursor: cursor as RngCursor,
  };
}

// 決定性 Resolver stub。RNG 型別的 Resolver 回傳 cursor + 1，模擬「Resolver 內部擲過一次」。
export function stubResolverPort(
  opts: Readonly<{
    destinationCityId?: CityId;
    acceptDeadlineOffset?: number;
    actualEndOffset?: number;
    populationTarget?: number;
    metric?: Readonly<{ prosperity: number; safety: number }>;
  }> = {},
): CityResolverPort {
  const bump = (cursor: RngCursor): RngCursor => (Number(cursor) + 1) as RngCursor;
  return {
    resolveEscortDestination: ({ rng }) => ({
      value: opts.destinationCityId ?? OTHER_CITY_ID,
      nextCursor: bump(rng.cursor),
    }),
    resolveEscortDeadlines: ({ generatedOnDay, rng }) => ({
      value: {
        acceptDeadline: (generatedOnDay + (opts.acceptDeadlineOffset ?? 7)) as WorldDay,
        actualEndDeadline: (generatedOnDay + (opts.actualEndOffset ?? 30)) as WorldDay,
      },
      nextCursor: bump(rng.cursor),
    }),
    resolvePopulationTargetCount: () => opts.populationTarget ?? 5,
    resolveCityMetricEffect: ({ prosperity, safety }) =>
      opts.metric ?? { prosperity: prosperity + 1, safety },
  };
}

// 一站式 Handler Context（測試預設）。
export function makeContext(overrides: Partial<CityHandlerContext> = {}): CityHandlerContext {
  return {
    worldDay: 100 as WorldDay,
    definitions: stubDefinitionReader(),
    team: stubTeamPort(),
    inventory: stubInventoryPort(),
    economy: stubEconomyPort(),
    world: stubWorldPort(),
    supply: stubSupplyPort(),
    ids: makeIdAllocator(),
    rng: stubRng(),
    rngContext: stubRngContext(),
    resolvers: stubResolverPort(),
    ...overrides,
  };
}
