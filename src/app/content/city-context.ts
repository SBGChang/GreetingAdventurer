// app/content/city-context.ts
// `EconomyQuery` 與 `CityHandlerContext` 的正式組裝（f3_work_packages.md P8 ＋ 經濟報價鏈）。
//
// 這一檔是「主城能買東西」的落點。買一件商品要走完這條鏈，缺任何一環都買不了：
//
//   buyShopOffer（city Handler）
//     → CityEconomyPort.getShopOfferPurchaseQuote
//       → EconomyQuery.getPurchaseQuote
//         → EconomyPriceSourcePort   ：這筆 Offer 指向哪個物品、用哪條 Price Rule、基礎價多少
//         → EconomyTradeBonusPort    ：付款角色的交流熟練買賣加成（doc §2.2 要求必納）
//         → EconomyPriceModifierResolverPort ：每條修正的係數（shape 在 economy-resolvers.ts）
//     → TransferCurrency（economy 擁有金錢）＋ TransferItem（inventory 擁有物品）
//
// 三個 Port 都是**唯讀投影**：價格來源讀 city 的 ShopOffer 與 inventory 的 Item Definition，
// 交易加成讀 progression。Economy 自己不擁有商品，也不保存第二份好感值（不變量 13）。

import type {
  CharacterId,
  CityId,
  CurrencyId,
  DefinitionId,
  EconomyAccountId,
  ItemInstanceId,
  PriceRuleId,
  Revision,
  RngContext,
  ShopOfferId,
  WorldDay,
} from '../../contracts/core';
import type { PriceModifierParamsDefinition } from '../../contracts/economy';
import type { ItemDefinitionReader } from '../../contracts/inventory';
import type { ProgressionQuery } from '../../contracts/progression';
import type { DefinitionRegistry, ResolverRegistry } from '../../data-runtime';
import type { CityHandlerContext, CityIdAllocator } from '../../modules/city/public';
import type { CityState } from '../../modules/city/public';
import type {
  EconomyPriceModifierResolverPort,
  EconomyPriceSourcePort,
  EconomyQueryContext,
  EconomyState,
  PriceSourceView,
} from '../../modules/economy/public';
import { createEconomyQuery } from '../../modules/economy/public';
import type { InventoryState } from '../../modules/inventory/public';
import { createInventoryQuery } from '../../modules/inventory/public';
import type { TeamState } from '../../modules/team/public';
import { createTeamQuery } from '../../modules/team/public';
import type { DeterministicRng } from '../../contracts/core';
import { createEconomyDefinitionReader, ECONOMY_DEFINITION_KINDS } from './economy-reader';
import { createCityDefinitionReader } from './city-reader';
import { narrowedDomainReader } from './reader-adapter';
import { runResolver, resolverContext } from './resolver-adapter';

// 尚未接線的子 port：一被存取就拋並指名是誰（與 context-assembler 的 `pending()` 同一作法）。
function pendingPort<T>(path: string, why: string): T {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        throw new Error(`city-context："${path}" 尚未接線（存取 .${String(prop)}）——${why}`);
      },
    },
  ) as T;
}

// ──────────────────────────────────────────────────────────────────────────
// EconomyQuery
// ──────────────────────────────────────────────────────────────────────────

export type EconomyQueryDeps = Readonly<{
  registry: DefinitionRegistry;
  resolvers: ResolverRegistry;
  economyState: EconomyState;
  cityState: CityState;
  inventoryState: InventoryState;
  itemReader: ItemDefinitionReader;
  progression: ProgressionQuery;
}>;

export function createProductionEconomyQuery(deps: EconomyQueryDeps): ReturnType<typeof createEconomyQuery> {
  const economyDefs = createEconomyDefinitionReader(deps.registry);
  const cityDefs = createCityDefinitionReader(deps.registry);
  const inventory = createInventoryQuery(deps.inventoryState, deps.itemReader);
  const modifierParams = narrowedDomainReader<PriceModifierParamsDefinition>(
    deps.registry,
    'reader:economy.price-modifier-params',
    [ECONOMY_DEFINITION_KINDS.priceModifierParams],
  );

  // 價格來源。三種報價各有自己的來源擁有者，這裡只做投影。
  const priceSources: EconomyPriceSourcePort = {
    // 購買：city 的 ShopOffer 指名 priceRuleId，基礎價來自它指向的物品定義。
    tryGetPurchaseSource: (offerId): PriceSourceView | undefined => {
      const offer = deps.cityState.shopOffers[offerId];
      if (offer === undefined || offer.state !== 'available') return undefined;
      const item = inventory.getItem(offer.itemId);
      if (item === undefined) return undefined;
      const definition = deps.itemReader.getItem(item.definitionId);
      return {
        priceRuleId: offer.priceRuleId,
        currencyId: definition.intrinsicValue.currencyId,
        baseValue: definition.intrinsicValue.amount,
        sourceRevision: offer.revision,
      };
    },

    // 販售：基礎價是物品自己的 intrinsicValue；用哪一條 Price Rule 由該城的商店規則決定。
    tryGetSellSource: ({ itemSourceId, cityId }): PriceSourceView | undefined => {
      const item = inventory.getItem(itemSourceId);
      if (item === undefined) return undefined;
      const definition = deps.itemReader.getItem(item.definitionId);
      const city = Object.values(deps.cityState.cities).find((c) => c.cityId === cityId);
      if (city === undefined) return undefined;
      const cityDef = cityDefs.getCity(cityId);
      // 該城的第一條商店規則決定買賣用哪一條 Price Rule。四座城的三間店目前共用
      // `price-rule.core.shop-item`（見 content-source），所以取哪一條結果相同；
      // 內容日後分化時這裡自然跟著變。
      const shopRuleId = cityDef.shopRuleIds[0];
      if (shopRuleId === undefined) return undefined;
      return {
        priceRuleId: cityDefs.getShopRule(shopRuleId).priceRuleId,
        currencyId: definition.intrinsicValue.currencyId,
        baseValue: definition.intrinsicValue.amount,
        sourceRevision: city.revision,
      };
    },

    // 服務報價（家教）。服務定義的擁有者是 city 的 home teaching post，本版尚未開放，
    // 所以這裡回 undefined——Quote 會明確失敗，不會生出一個編造的價格。
    tryGetServiceSource: () => undefined,
  };

  const priceModifiers: EconomyPriceModifierResolverPort = {
    resolvePriceModifier: (input) =>
      runResolver<number | undefined>(
        deps.resolvers,
        input.resolverId,
        input,
        resolverContext({
          definitions: {
            getPriceModifierParams: (id: string) => modifierParams.get(id as never),
          },
        }),
      ).value,
  };

  const ctx: EconomyQueryContext = {
    definitions: economyDefs,
    priceSources,
    // 交流熟練的個人買賣加成（doc §2.2）。
    progression: {
      getPersonalTradeBonus: (characterId) =>
        deps.progression.getSocialMasteryBenefits(characterId).personalTradeBonus,
    },
    // 好感修正只有家教服務會用到，而服務報價本版不開放（見 tryGetServiceSource）。
    social: pendingPort(
      'economy.affinity',
      'social 模組尚未接線；家教服務報價本版不開放，一般買賣不套用好感修正（doc §4）。',
    ),
    resolvers: priceModifiers,
  };

  return createEconomyQuery(deps.economyState, ctx);
}

// ──────────────────────────────────────────────────────────────────────────
// CityHandlerContext
// ──────────────────────────────────────────────────────────────────────────

export type CityContextDeps = Readonly<{
  registry: DefinitionRegistry;
  resolvers: ResolverRegistry;
  economyState: EconomyState;
  cityState: CityState;
  inventoryState: InventoryState;
  itemReader: ItemDefinitionReader;
  teamState: TeamState;
  progression: ProgressionQuery;
  worldDay: WorldDay;
  rng: DeterministicRng;
  rngContext: RngContext;
  ids: CityIdAllocator;
  nextTransferId: () => import('../../contracts/core').EconomyTransferId;
  cityResolvers: CityHandlerContext['resolvers'];
  world: CityHandlerContext['world'];
  supply: CityHandlerContext['supply'];
}>;

export function createCityContext(deps: CityContextDeps): CityHandlerContext {
  const economyQuery = createProductionEconomyQuery(deps);
  const inventory = createInventoryQuery(deps.inventoryState, deps.itemReader);
  const teamQuery = createTeamQuery(deps.teamState);

  return {
    worldDay: deps.worldDay,
    definitions: createCityDefinitionReader(deps.registry),

    team: {
      // 玩家實際控制的角色＝玩家隊伍的隊長。
      getPlayerControlledCharacterId: () => {
        const team = deps.teamState.teams[deps.teamState.playerTeamId];
        if (team === undefined) throw new Error('city-context：GameState 沒有玩家隊伍');
        return team.leaderId;
      },
      listTeamsAtCity: (cityId) =>
        Object.values(deps.teamState.teams)
          .filter((t) => t.location.kind === 'city' && t.location.cityId === cityId)
          .map((t) => t.teamId),
      listFormalMembers: (teamId) => [...(deps.teamState.teams[teamId]?.memberIds ?? [])],
    },

    inventory: {
      getItem: (itemId) => inventory.getItem(itemId),
      listAtLocation: (location) => inventory.listAtLocation(location),
      characterOwnsItem: (characterId, itemId) => inventory.characterOwnsItem(characterId, itemId),
      isReserved: (itemId) => inventory.isReserved(itemId),
      // `ItemDefinition.tradePolicy.tradable` 的投影——是否可交易是**內容**的宣告。
      isTradable: (itemId) => {
        const item = inventory.getItem(itemId);
        if (item === undefined) return false;
        return deps.itemReader.getItem(item.definitionId).tradePolicy.tradable;
      },
    },

    economy: {
      nextTransferId: deps.nextTransferId,
      getCharacterAccount: (characterId, currencyId) =>
        economyQuery.getCharacterAccount(characterId, currencyId),
      getCityShopAccount: (cityId, currencyId) => findCityAccount(deps.economyState, cityId, currencyId),
      getShopOfferPurchaseQuote: ({ offerId, buyerCharacterId, sourceRevision }) =>
        // `PurchaseQuoteInput.offerId` 本來就是 ShopOfferId（contracts/economy 已修過那個缺口），
        // 所以這裡是直傳，不需要任何轉型。
        economyQuery.getPurchaseQuote({ offerId, buyerCharacterId, sourceRevision }),
      getSellQuote: (input) => economyQuery.getSellQuote(input),
      // 房屋購買／升級以 Price Rule 定址。`EconomyQuery.getPriceRuleQuote` 是為資產補的第四個
      // 報價入口（價格住在規則自己的 `baseAmount`，見 contracts/economy 的說明）。
      getPriceRuleQuote: (input) => economyQuery.getPriceRuleQuote(input),
    },

    world: deps.world,
    supply: deps.supply,
    ids: deps.ids,
    rng: deps.rng,
    rngContext: deps.rngContext,
    resolvers: deps.cityResolvers,
  };
}

// 城市商店的收付款帳戶。開局由 Bootstrap 建立；查不到＝世界建立時漏了它，明確失敗。
function findCityAccount(state: EconomyState, cityId: CityId, currencyId: CurrencyId): EconomyAccountId {
  const account = Object.values(state.accounts).find(
    (a) => a.currencyId === currencyId && a.owner.kind === 'city' && a.owner.cityId === cityId,
  );
  if (account === undefined) {
    throw new Error(
      `city-context：城市 "${String(cityId)}" 沒有 "${String(currencyId)}" 的商店帳戶——` +
        `世界建立時應為每座城建立它。`,
    );
  }
  return account.accountId;
}

export type { PriceSourceView, ItemInstanceId, ShopOfferId, PriceRuleId, Revision, CharacterId };

// CityWorldPort：兩個方法都是 world Definition 的投影。
export function createWorldQueryForCity(
  world: import('../../contracts/world').WorldDefinitionReader,
): CityHandlerContext['world'] {
  return {
    getRegionForCity: (cityId) => world.getCityNode(cityId).regionId,
    getNativeCulture: (regionId) => world.getRegion(regionId).nativeCultureId,
  };
}
