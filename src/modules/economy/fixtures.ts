// modules/economy/fixtures.ts
// 最小 Fixture：一種貨幣、一條買賣 Price Rule（含 add／multiply／strongest 三種疊加）、
// 一條 Reward Rule，加上四個帳戶（角色 ×2、system dungeonGoldSource、assetDistribution、city）
// 與決定性 stub Port（EconomyDefinitionReader / IdAllocator / Reward Resolver / Price Modifier
// Resolver / Price Source / Trade Bonus / Affinity）。
//
// 這裡出現的每一個數字都是**測試資料**，不是正式內容：正式路徑一律從 Content Pack 讀。
// 全部 stub 皆為決定性（無真 RNG、無時間、無 I/O）。

import type {
  AssetDistributionId,
  CharacterId,
  CityId,
  ContentPackId,
  CurrencyId,
  DefinitionId,
  EconomyAccountId,
  EconomyTransferId,
  EntitySourceRef,
  ItemInstanceId,
  PriceModifierRuleId,
  PriceRuleId,
  ResolverId,
  Revision,
  ShopOfferId,
  TransactionId,
  WorldDay,
} from '../../contracts/core';
import type {
  CurrencyDefinition,
  EconomyAccount,
  EconomyDefinitionReader,
  EconomyState,
  MoneyValue,
  PriceModifierRuleDefinition,
  PriceRuleDefinition,
  RewardRuleDefinition,
  RewardRuleId,
} from '../../contracts/economy';
import type {
  EconomyHandlerContext,
  EconomyIdAllocator,
  EconomyRewardResolverPort,
  RewardAmountResolverInput,
} from './system';
import type {
  EconomyAffinityPort,
  EconomyPriceModifierResolverPort,
  EconomyPriceSourcePort,
  EconomyQueryContext,
  EconomyTradeBonusPort,
  PriceModifierResolverInput,
  PriceSourceView,
} from './queries';
import { createEconomyState, createEmptyAccount, withBalanceDelta } from './state';

// ── ID 常數 ──────────────────────────────────────────────────────────────────

const PACK_ID = 'pack-test' as ContentPackId;

export const GOLD = 'currency-gold' as CurrencyId;
export const SILVER = 'currency-silver' as CurrencyId;
export const DISABLED_CURRENCY = 'currency-retired' as CurrencyId;
export const UNKNOWN_CURRENCY = 'currency-absent' as CurrencyId;

export const SHOP_PRICE_RULE = 'price-rule-shop' as PriceRuleId;
export const SERVICE_PRICE_RULE = 'price-rule-home-tutor' as PriceRuleId;

export const MOD_TRADE_BONUS = 'price-mod-trade-bonus' as PriceModifierRuleId;
export const MOD_WAR_SURCHARGE = 'price-mod-war-surcharge' as PriceModifierRuleId;
export const MOD_STRONGEST_SMALL = 'price-mod-strongest-small' as PriceModifierRuleId;
export const MOD_STRONGEST_BIG = 'price-mod-strongest-big' as PriceModifierRuleId;
export const MOD_AFFINITY = 'price-mod-affinity' as PriceModifierRuleId;
export const MOD_DISABLED = 'price-mod-disabled' as PriceModifierRuleId;
export const MOD_UNRESOLVABLE = 'price-mod-unresolvable' as PriceModifierRuleId;

export const REWARD_DUNGEON_GOLD = 'reward-rule-dungeon-gold' as RewardRuleId;
export const REWARD_WRONG_CURRENCY = 'reward-rule-wrong-currency' as RewardRuleId;
export const REWARD_UNRESOLVABLE = 'reward-rule-unresolvable' as RewardRuleId;
export const REWARD_NON_INTEGER = 'reward-rule-non-integer' as RewardRuleId;
export const REWARD_DISABLED = 'reward-rule-disabled' as RewardRuleId;
export const UNKNOWN_REWARD_RULE = 'reward-rule-absent' as RewardRuleId;

// 匯出：app/content/economy-reader.test.ts 用同一批 Resolver ID 建記憶體 content pack，
// 讓「真 Registry → 真 Reader → 真 Handler／Query」那條路徑能接上這裡的決定性 stub Resolver。
export const RESOLVER_TRADE_BONUS = 'resolver-trade-bonus' as ResolverId;
export const RESOLVER_WAR = 'resolver-war-surcharge' as ResolverId;
export const RESOLVER_STRONGEST_SMALL = 'resolver-strongest-small' as ResolverId;
export const RESOLVER_STRONGEST_BIG = 'resolver-strongest-big' as ResolverId;
export const RESOLVER_AFFINITY = 'resolver-affinity' as ResolverId;
export const RESOLVER_DISABLED = 'resolver-disabled' as ResolverId;
export const RESOLVER_UNRESOLVABLE = 'resolver-unresolvable' as ResolverId;
export const RESOLVER_REWARD_GOLD = 'resolver-reward-gold' as ResolverId;
export const RESOLVER_REWARD_SILVER = 'resolver-reward-silver' as ResolverId;
export const RESOLVER_REWARD_NONE = 'resolver-reward-none' as ResolverId;
export const RESOLVER_REWARD_FRACTION = 'resolver-reward-fraction' as ResolverId;

export const BUYER = 'char-buyer' as CharacterId;
export const SELLER = 'char-seller' as CharacterId;
export const TUTOR = 'char-tutor' as CharacterId;
export const POOR = 'char-poor' as CharacterId;
export const STRANGER = 'char-stranger' as CharacterId;

export const CITY = 'city-capital' as CityId;
export const DISTRIBUTION = 'dist-1' as AssetDistributionId;

export const ACC_BUYER = 'acc-buyer' as EconomyAccountId;
export const ACC_SELLER = 'acc-seller' as EconomyAccountId;
export const ACC_POOR = 'acc-poor' as EconomyAccountId;
export const ACC_CITY = 'acc-city' as EconomyAccountId;
export const ACC_DISTRIBUTION = 'acc-distribution' as EconomyAccountId;
export const ACC_DUNGEON_SOURCE = 'acc-dungeon-gold-source' as EconomyAccountId;
export const ACC_SILVER = 'acc-buyer-silver' as EconomyAccountId;
export const ACC_ABSENT = 'acc-absent' as EconomyAccountId;
export const ACC_NEW = 'acc-newly-allocated' as EconomyAccountId;

export const TRANSFER_1 = 'transfer-1' as EconomyTransferId;
export const TRANSFER_2 = 'transfer-2' as EconomyTransferId;
export const GRANT_1 = 'transfer-grant-1' as EconomyTransferId;
export const REMOVE_1 = 'transfer-remove-1' as EconomyTransferId;

export const TRANSACTION = 'txn-1' as TransactionId;
export const WORLD_DAY = 10 as WorldDay;
export const SOURCE_REF = SELLER as EntitySourceRef;

export const OFFER = 'offer-1' as ShopOfferId;
export const OFFER_STRONGEST = 'offer-strongest' as ShopOfferId;
export const OFFER_UNRESOLVABLE = 'offer-unresolvable' as ShopOfferId;
export const OFFER_MINIMUM = 'offer-minimum' as ShopOfferId;
export const OFFER_ABSENT = 'offer-absent' as ShopOfferId;
export const ITEM = 'item-1' as ItemInstanceId;
export const SERVICE_DEF = 'service-home-tutor' as DefinitionId;

// ── Definition Fixture ───────────────────────────────────────────────────────

function header<TId extends DefinitionId>(id: TId, enabled = true) {
  return { id, schemaVersion: 1, packId: PACK_ID, enabled } as const;
}

const gold: CurrencyDefinition = {
  ...header(GOLD),
  smallestUnit: 1,
  display: { nameRef: { key: 'currency.gold' } },
};

const silver: CurrencyDefinition = {
  ...header(SILVER),
  smallestUnit: 1,
  display: { nameRef: { key: 'currency.silver' } },
};

// enabled=false 的內容讀得到，但不得進入新遊戲生成池（共用契約 §4.2）——不得為它開新帳戶。
const retiredCurrency: CurrencyDefinition = {
  ...header(DISABLED_CURRENCY, false),
  smallestUnit: 1,
  display: { nameRef: { key: 'currency.retired' } },
};

// 買入套三筆修正：交流加成（multiply）、戰爭加價（add）、兩筆 strongest（只有較強者生效）。
// 賣出只套交流加成——賣價與買價用同一條規則的不同修正清單，正是「加成依付款／收款角色本人計算」。
const shopPriceRule: PriceRuleDefinition = {
  ...header(SHOP_PRICE_RULE),
  baseValueSource: 'itemDefinition',
  buyModifierIds: [MOD_TRADE_BONUS, MOD_WAR_SURCHARGE, MOD_DISABLED],
  sellModifierIds: [MOD_TRADE_BONUS],
  roundingPolicy: 'floor',
  minimumPrice: 5,
};

const strongestPriceRule: PriceRuleDefinition = {
  ...header('price-rule-strongest' as PriceRuleId),
  baseValueSource: 'itemDefinition',
  buyModifierIds: [MOD_STRONGEST_SMALL, MOD_STRONGEST_BIG],
  sellModifierIds: [],
  roundingPolicy: 'nearest',
  minimumPrice: 1,
};

// 只套一筆折扣、底價 5：用來證明 minimumPrice 這個**資料**欄位真的夾住結果。
const minimumPriceRule: PriceRuleDefinition = {
  ...header('price-rule-minimum' as PriceRuleId),
  baseValueSource: 'itemDefinition',
  buyModifierIds: [MOD_TRADE_BONUS],
  sellModifierIds: [],
  roundingPolicy: 'floor',
  minimumPrice: 5,
};

const unresolvablePriceRule: PriceRuleDefinition = {
  ...header('price-rule-unresolvable' as PriceRuleId),
  baseValueSource: 'itemDefinition',
  buyModifierIds: [MOD_UNRESOLVABLE],
  sellModifierIds: [],
  roundingPolicy: 'floor',
  minimumPrice: 1,
};

const servicePriceRule: PriceRuleDefinition = {
  ...header(SERVICE_PRICE_RULE),
  baseValueSource: 'serviceDefinition',
  buyModifierIds: [MOD_AFFINITY],
  sellModifierIds: [],
  roundingPolicy: 'ceil',
  minimumPrice: 1,
};

const modifierRules: readonly PriceModifierRuleDefinition[] = [
  { ...header(MOD_TRADE_BONUS), resolverId: RESOLVER_TRADE_BONUS, stackPolicy: 'multiply' },
  { ...header(MOD_WAR_SURCHARGE), resolverId: RESOLVER_WAR, stackPolicy: 'add' },
  { ...header(MOD_STRONGEST_SMALL), resolverId: RESOLVER_STRONGEST_SMALL, stackPolicy: 'strongest' },
  { ...header(MOD_STRONGEST_BIG), resolverId: RESOLVER_STRONGEST_BIG, stackPolicy: 'strongest' },
  { ...header(MOD_AFFINITY), resolverId: RESOLVER_AFFINITY, stackPolicy: 'multiply' },
  { ...header(MOD_DISABLED, false), resolverId: RESOLVER_DISABLED, stackPolicy: 'multiply' },
  { ...header(MOD_UNRESOLVABLE), resolverId: RESOLVER_UNRESOLVABLE, stackPolicy: 'multiply' },
];

const rewardRules: readonly RewardRuleDefinition[] = [
  { ...header(REWARD_DUNGEON_GOLD), resolverId: RESOLVER_REWARD_GOLD },
  { ...header(REWARD_WRONG_CURRENCY), resolverId: RESOLVER_REWARD_SILVER },
  { ...header(REWARD_UNRESOLVABLE), resolverId: RESOLVER_REWARD_NONE },
  { ...header(REWARD_NON_INTEGER), resolverId: RESOLVER_REWARD_FRACTION },
  { ...header(REWARD_DISABLED, false), resolverId: RESOLVER_REWARD_GOLD },
];

const priceRules: readonly PriceRuleDefinition[] = [
  shopPriceRule,
  strongestPriceRule,
  minimumPriceRule,
  unresolvablePriceRule,
  servicePriceRule,
];

export const MINIMUM_PRICE_FLOOR = 5;

export const REWARD_GOLD_AMOUNT = 120;
export const BASE_VALUE = 100;
export const STRONGEST_BASE_VALUE = 200;
export const MINIMUM_CASE_BASE_VALUE = 1;
export const TRADE_BONUS_BUYER = 4;
export const TRADE_BONUS_SELLER = 2;
export const HOME_TUTOR_MODIFIER = 3;
export const SERVICE_BASE_VALUE = 50;

function byId<T extends { id: DefinitionId }>(items: readonly T[], id: DefinitionId): T | undefined {
  return items.find((item) => item.id === id);
}

export function stubDefinitionReader(): EconomyDefinitionReader {
  const currencies: readonly CurrencyDefinition[] = [gold, silver, retiredCurrency];
  const requireOr = <T>(found: T | undefined, id: DefinitionId): T => {
    if (found === undefined) throw new Error(`fixture reader: unknown definition "${String(id)}"`);
    return found;
  };
  return {
    getCurrency: (id) => requireOr(byId(currencies, id), id),
    tryGetCurrency: (id) => byId(currencies, id),
    getPriceRule: (id) => requireOr(byId(priceRules, id), id),
    getPriceModifierRule: (id) => requireOr(byId(modifierRules, id), id),
    getRewardRule: (id) => requireOr(byId(rewardRules, id), id),
    tryGetRewardRule: (id) => byId(rewardRules, id),
  };
}

// ── Slice Fixture ────────────────────────────────────────────────────────────

function funded(
  accountId: EconomyAccountId,
  owner: EconomyAccount['owner'],
  currencyId: CurrencyId,
  balance: number,
): EconomyAccount {
  const empty = createEmptyAccount(accountId, owner, currencyId);
  return balance === 0 ? empty : { ...withBalanceDelta(empty, balance), revision: 0 as Revision };
}

export const BUYER_START_BALANCE = 1000;
export const SELLER_START_BALANCE = 40;
export const CITY_START_BALANCE = 500;

export function fixtureEconomyState(): EconomyState {
  return createEconomyState({
    accounts: [
      funded(ACC_BUYER, { kind: 'character', characterId: BUYER }, GOLD, BUYER_START_BALANCE),
      funded(ACC_SELLER, { kind: 'character', characterId: SELLER }, GOLD, SELLER_START_BALANCE),
      funded(ACC_POOR, { kind: 'character', characterId: POOR }, GOLD, 0),
      funded(ACC_SILVER, { kind: 'character', characterId: BUYER }, SILVER, 0),
      funded(ACC_CITY, { kind: 'city', cityId: CITY }, GOLD, CITY_START_BALANCE),
      funded(ACC_DISTRIBUTION, { kind: 'assetDistribution', distributionId: DISTRIBUTION }, GOLD, 0),
      funded(ACC_DUNGEON_SOURCE, { kind: 'system', purpose: 'dungeonGoldSource' }, GOLD, 0),
    ],
  });
}

// ── Handler Context ──────────────────────────────────────────────────────────

export function stubIdAllocator(): EconomyIdAllocator {
  return { nextEconomyAccountId: () => ACC_NEW };
}

export function stubRewardResolver(): EconomyRewardResolverPort {
  return {
    resolveRewardAmount: (input: RewardAmountResolverInput): MoneyValue | undefined => {
      switch (String(input.resolverId)) {
        case String(RESOLVER_REWARD_GOLD):
          return { currencyId: GOLD, amount: REWARD_GOLD_AMOUNT };
        case String(RESOLVER_REWARD_SILVER):
          return { currencyId: SILVER, amount: REWARD_GOLD_AMOUNT };
        case String(RESOLVER_REWARD_FRACTION):
          return { currencyId: GOLD, amount: 1.5 };
        default:
          return undefined;
      }
    },
  };
}

export function makeHandlerContext(
  overrides: Partial<EconomyHandlerContext> = {},
): EconomyHandlerContext {
  return {
    worldDay: WORLD_DAY,
    transactionId: TRANSACTION,
    definitions: stubDefinitionReader(),
    ids: stubIdAllocator(),
    resolvers: stubRewardResolver(),
    ...overrides,
  };
}

// ── Query Context ────────────────────────────────────────────────────────────

// 決定性 stub：每個 resolverId 一條固定公式形狀。正式實作會走 data-runtime 的 §7.1 kernel
// （weightedLinearProduct／thresholdTable…）+ Definition 的 params，形狀相同、係數來自內容。
export function stubPriceModifierResolver(): EconomyPriceModifierResolverPort {
  return {
    resolvePriceModifier: (input: PriceModifierResolverInput): number | undefined => {
      switch (String(input.resolverId)) {
        case String(RESOLVER_TRADE_BONUS):
          // 買入折扣／賣出加價都以「離 1 的偏移」表達；偏移量來自 personalTradeBonus。
          return input.direction === 'buy'
            ? 1 - input.personalTradeBonus / 100
            : 1 + input.personalTradeBonus / 100;
        case String(RESOLVER_WAR):
          return 10;
        case String(RESOLVER_STRONGEST_SMALL):
          return 1.1;
        case String(RESOLVER_STRONGEST_BIG):
          return 1.5;
        case String(RESOLVER_AFFINITY): {
          const affinity = input.homeTutorPriceModifier;
          return affinity === undefined ? undefined : 1 - affinity / 100;
        }
        default:
          return undefined;
      }
    },
  };
}

export function stubTradeBonusPort(): EconomyTradeBonusPort {
  return {
    getPersonalTradeBonus: (characterId) => {
      if (characterId === BUYER) return TRADE_BONUS_BUYER;
      if (characterId === SELLER) return TRADE_BONUS_SELLER;
      return 0;
    },
  };
}

export function stubAffinityPort(): EconomyAffinityPort {
  return { getHomeTutorPriceModifier: () => HOME_TUTOR_MODIFIER };
}

export const OFFER_REVISION = 7 as Revision;
export const ITEM_REVISION = 3 as Revision;
export const SERVICE_REVISION = 2 as Revision;

export function stubPriceSourcePort(): EconomyPriceSourcePort {
  const purchases: readonly Readonly<{ offerId: ShopOfferId; view: PriceSourceView }>[] = [
    {
      offerId: OFFER,
      view: {
        priceRuleId: SHOP_PRICE_RULE,
        currencyId: GOLD,
        baseValue: BASE_VALUE,
        sourceRevision: OFFER_REVISION,
      },
    },
    {
      offerId: OFFER_STRONGEST,
      view: {
        priceRuleId: strongestPriceRule.id,
        currencyId: GOLD,
        baseValue: STRONGEST_BASE_VALUE,
        sourceRevision: OFFER_REVISION,
      },
    },
    {
      offerId: OFFER_UNRESOLVABLE,
      view: {
        priceRuleId: unresolvablePriceRule.id,
        currencyId: GOLD,
        baseValue: BASE_VALUE,
        sourceRevision: OFFER_REVISION,
      },
    },
    {
      offerId: OFFER_MINIMUM,
      view: {
        priceRuleId: minimumPriceRule.id,
        currencyId: GOLD,
        baseValue: MINIMUM_CASE_BASE_VALUE,
        sourceRevision: OFFER_REVISION,
      },
    },
  ];

  return {
    tryGetPurchaseSource: (offerId) => purchases.find((p) => p.offerId === offerId)?.view,
    tryGetSellSource: ({ itemSourceId }) =>
      itemSourceId === ITEM
        ? {
            priceRuleId: SHOP_PRICE_RULE,
            currencyId: GOLD,
            baseValue: BASE_VALUE,
            sourceRevision: ITEM_REVISION,
          }
        : undefined,
    tryGetServiceSource: ({ serviceDefinitionId }) =>
      serviceDefinitionId === SERVICE_DEF
        ? {
            priceRuleId: SERVICE_PRICE_RULE,
            currencyId: GOLD,
            baseValue: SERVICE_BASE_VALUE,
            sourceRevision: SERVICE_REVISION,
          }
        : undefined,
  };
}

export function makeQueryContext(overrides: Partial<EconomyQueryContext> = {}): EconomyQueryContext {
  return {
    definitions: stubDefinitionReader(),
    priceSources: stubPriceSourcePort(),
    progression: stubTradeBonusPort(),
    social: stubAffinityPort(),
    resolvers: stubPriceModifierResolver(),
    ...overrides,
  };
}
