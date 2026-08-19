// modules/city/city.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。
//
// 覆蓋原則：每個登記進 ModuleContract 的 Handler 至少一個 accept；每一種 typed rejection 至少一例；
// doc §9 每條宣稱的不變量至少一例；每個冪等 no-op 都被釘住是冪等（不是碰巧沒變）；
// 有 RNG 的路徑同時驗「同 cursor 同結果」與「cursor 逐次前進」。

import type {
  CharacterId,
  JobId,
  QuestId,
  Revision,
  TeamId,
  TransactionMessageDraft,
  WorldDay,
  EffectDefinitionId,
} from '../../contracts/core';
import type {
  CityDomainEvent,
  CityState,
  ShopRefreshJob,
  EscortGenerationJob,
  CityPopulationReviewJob,
} from '../../contracts/city';
import type { TransferCurrencyCommand } from '../../contracts/economy';
import type { CityHandlerResult } from './system';
import {
  CITY_MODULE_ID,
  handleBuyShopOffer,
  handleSellItemToShop,
  handleBuyOrUpgradeHome,
  handleReleaseHomeTeacher,
  handleReserveShopOfferForQuest,
  handleReleaseQuestShopOffer,
  handleSetFacilityAvailability,
  handleApplyCityMetricEffect,
  handleTransferHomeOwnership,
  handleInterruptHomeTeachingPost,
  handleRevealTavernIntel,
  handleShopRefresh,
  handleEscortGeneration,
  handleCityPopulationReview,
} from './system';
import { createCityQuery } from './queries';
import { createCityState, listEscortCandidates, listOffers } from './state';
import {
  CITY_ID,
  OTHER_CITY_ID,
  FACILITY_ITEM_SHOP,
  FACILITY_TAVERN,
  FACILITY_HOME,
  SHOP_RULE_ITEM,
  SHOP_RULE_BOOK_WITH_CATALOG,
  ESCORT_RULE_NO_DEADLINE,
  ESCORT_RULE_ID,
  UPGRADE_FORGE,
  UPGRADE_UNLISTED,
  UPGRADE_ROOM,
  PLAYER_CHARACTER_ID,
  COMPANION_CHARACTER_ID,
  OUTSIDER_CHARACTER_ID,
  HEIR_CHARACTER_ID,
  PLAYER_TEAM_ID,
  OTHER_TEAM_ID,
  STOCK_ITEM_A,
  STOCK_ITEM_B,
  PLAYER_ITEM_ID,
  OFFER_AVAILABLE,
  INTEL_ID,
  HOME_ID,
  POST_ID,
  CULTURE_ID,
  fixtureCityState,
  fixtureCityRuntime,
  fixtureOffer,
  fixtureIntel,
  fixtureHome,
  fixtureTeachingPost,
  makeContext,
  makeIdAllocator,
  stubDefinitionReader,
  stubEconomyPort,
  stubInventoryPort,
  stubResolverPort,
  stubRngContext,
  stubSupplyPort,
  stubTeamPort,
  CITY_DEFINITION,
} from './fixtures';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────────
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eventsOf(messages: readonly TransactionMessageDraft[]): CityDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as CityDomainEvent);
}

function commandsOf(messages: readonly TransactionMessageDraft[]): { type: string }[] {
  return messages
    .filter((m): m is { targetModule: never; command: unknown } => 'command' in m)
    .map((m) => m.command as { type: string });
}

function findEvent<TType extends CityDomainEvent['type']>(
  events: readonly CityDomainEvent[],
  type: TType,
): Extract<CityDomainEvent, { type: TType }> | undefined {
  return events.find((e): e is Extract<CityDomainEvent, { type: TType }> => e.type === type);
}

function expectAccept(result: CityHandlerResult, msg: string) {
  assert(result.ok, `${msg}（實得 rejection: ${result.ok ? '' : result.rejection.code}）`);
  if (!result.ok) throw new Error(msg);
  return result.result;
}

function expectReject(result: CityHandlerResult, code: string, msg: string) {
  assert(!result.ok, `${msg}：應被拒絕`);
  if (result.ok) throw new Error(msg);
  assert(
    result.rejection.code === code,
    `${msg}：拒絕碼應為 ${code}（實得 ${result.rejection.code}）`,
  );
  assert(result.rejection.source === CITY_MODULE_ID, `${msg}：rejection.source 應為 city`);
  return result.rejection;
}

const QUEST_A = 'quest-a' as QuestId;
const QUEST_B = 'quest-b' as QuestId;
const EFFECT_ID = 'effect-city-prosperity' as EffectDefinitionId;

function shopRefreshJob(targetId = SHOP_RULE_ITEM): ShopRefreshJob {
  return {
    jobId: 'job-shop-refresh' as JobId,
    type: 'shopRefresh',
    dueDay: 100 as WorldDay,
    ownerModule: CITY_MODULE_ID,
    targetId,
    payload: {},
  };
}

function escortJob(): EscortGenerationJob {
  return {
    jobId: 'job-escort' as JobId,
    type: 'escortGeneration',
    dueDay: 100 as WorldDay,
    ownerModule: CITY_MODULE_ID,
    targetId: CITY_ID,
    payload: {},
  };
}

function populationJob(): CityPopulationReviewJob {
  return {
    jobId: 'job-population' as JobId,
    type: 'cityPopulationReview',
    dueDay: 100 as WorldDay,
    ownerModule: CITY_MODULE_ID,
    targetId: CITY_ID,
    payload: {},
  };
}

// 一座含一筆 available Offer 的城市。
function stateWithOffer(overrides: Parameters<typeof fixtureOffer>[0] = {}): CityState {
  return fixtureCityState({ shopOffers: [fixtureOffer(overrides)] });
}

const cases: readonly Readonly<{ name: string; run: () => void }>[] = [
  // ────────────────────────────────────────────────────────────────────────
  // buyShopOffer
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'buyShopOffer：接受 → Offer 轉 sold、送 TransferCurrency + TransferItem、發 ShopOfferSold',
    run: () => {
      const state = stateWithOffer();
      const res = expectAccept(
        handleBuyShopOffer(
          { type: 'buyShopOffer', offerId: OFFER_AVAILABLE, payerCharacterId: PLAYER_CHARACTER_ID },
          state,
          makeContext(),
        ),
        'buyShopOffer 應被接受',
      );
      assert(res.nextSlice.shopOffers[OFFER_AVAILABLE]!.state === 'sold', 'Offer 應轉為 sold');
      const outgoing = commandsOf(res.outgoingMessages).map((c) => c.type);
      assert(outgoing.includes('TransferCurrency'), '應送出 economy 的 TransferCurrency');
      assert(outgoing.includes('TransferItem'), '應送出 inventory 的 TransferItem');
      const sold = findEvent(eventsOf(res.outgoingMessages), 'ShopOfferSold');
      assert(sold !== undefined && sold.buyerTeamId === PLAYER_TEAM_ID, 'ShopOfferSold 應帶買方隊伍');
      // 金額與幣別必須來自 economy 的報價，不是 City 自己算的。
      const transfer = commandsOf(res.outgoingMessages).find(
        (c): c is TransferCurrencyCommand => c.type === 'TransferCurrency',
      );
      assert(transfer !== undefined && transfer.amount === 100, '轉帳金額應取自 economy 報價');
    },
  },
  {
    name: 'buyShopOffer：玩家主角買賣才寫 usage 並發 CommerceInteractionCompleted（不變量 8）',
    run: () => {
      const state = stateWithOffer();
      const playerRes = expectAccept(
        handleBuyShopOffer(
          { type: 'buyShopOffer', offerId: OFFER_AVAILABLE, payerCharacterId: PLAYER_CHARACTER_ID },
          state,
          makeContext(),
        ),
        '玩家主角購買應被接受',
      );
      assert(
        playerRes.nextSlice.playerCommerceUsage?.commerceInteractionCount === 1,
        '玩家主角購買後計數應為 1',
      );
      assert(
        findEvent(eventsOf(playerRes.outgoingMessages), 'CommerceInteractionCompleted') !== undefined,
        '玩家主角購買應發 CommerceInteractionCompleted',
      );

      const companionRes = expectAccept(
        handleBuyShopOffer(
          {
            type: 'buyShopOffer',
            offerId: OFFER_AVAILABLE,
            payerCharacterId: COMPANION_CHARACTER_ID,
          },
          state,
          makeContext(),
        ),
        '隊友購買應被接受',
      );
      assert(
        companionRes.nextSlice.playerCommerceUsage === undefined,
        '隊友購買不得寫入 playerCommerceUsage（不變量 8）',
      );
      assert(
        findEvent(eventsOf(companionRes.outgoingMessages), 'CommerceInteractionCompleted') ===
          undefined,
        '隊友購買不得發玩家交流完成事件',
      );
    },
  },
  {
    name: 'buyShopOffer：Quest 指定品走 MoveItemToTeamQuestCargo 而非 TransferItem',
    run: () => {
      const state = stateWithOffer({ sourceQuestId: QUEST_A });
      const res = expectAccept(
        handleBuyShopOffer(
          { type: 'buyShopOffer', offerId: OFFER_AVAILABLE, payerCharacterId: PLAYER_CHARACTER_ID },
          state,
          makeContext(),
        ),
        'Quest 指定品購買應被接受',
      );
      const outgoing = commandsOf(res.outgoingMessages).map((c) => c.type);
      assert(outgoing.includes('MoveItemToTeamQuestCargo'), '應送 MoveItemToTeamQuestCargo');
      assert(!outgoing.includes('TransferItem'), '不應同時送一般 TransferItem');
    },
  },
  {
    name: 'buyShopOffer：每日 6 筆上限 → 第 7 筆 typed rejection（不變量 6，上限值取自 Definition）',
    run: () => {
      const ctx = makeContext();
      const limit = ctx.definitions.getPlayerCommerceDailyLimit(
        CITY_DEFINITION.playerCommerceDailyLimitId,
      ).maxCommerceInteractionsPerDay;
      const state = createCityState({
        cities: [fixtureCityRuntime()],
        shopOffers: [fixtureOffer()],
        playerCommerceUsage: {
          usageId: 'usage-existing' as never,
          playerCharacterId: PLAYER_CHARACTER_ID,
          worldDay: 100 as WorldDay,
          commerceInteractionCount: limit,
          revision: 0 as Revision,
        },
      });
      expectReject(
        handleBuyShopOffer(
          { type: 'buyShopOffer', offerId: OFFER_AVAILABLE, payerCharacterId: PLAYER_CHARACTER_ID },
          state,
          ctx,
        ),
        'city/daily-commerce-limit-reached',
        '額度已滿',
      );
      // 隊友不受額度限制（doc §5.1）。
      expectAccept(
        handleBuyShopOffer(
          {
            type: 'buyShopOffer',
            offerId: OFFER_AVAILABLE,
            payerCharacterId: COMPANION_CHARACTER_ID,
          },
          state,
          ctx,
        ),
        '隊友不受玩家額度限制',
      );
    },
  },
  {
    name: 'buyShopOffer：跨世界日與換主角時計數自然歸零（不排歸零 Job）',
    run: () => {
      const staleUsage = createCityState({
        cities: [fixtureCityRuntime()],
        shopOffers: [fixtureOffer()],
        playerCommerceUsage: {
          usageId: 'usage-yesterday' as never,
          playerCharacterId: PLAYER_CHARACTER_ID,
          worldDay: 99 as WorldDay,
          commerceInteractionCount: 6,
          revision: 0 as Revision,
        },
      });
      const res = expectAccept(
        handleBuyShopOffer(
          { type: 'buyShopOffer', offerId: OFFER_AVAILABLE, payerCharacterId: PLAYER_CHARACTER_ID },
          staleUsage,
          makeContext({ worldDay: 100 as WorldDay }),
        ),
        '昨天的 6 筆不應阻擋今天的第 1 筆',
      );
      const usage = res.nextSlice.playerCommerceUsage;
      assert(
        usage !== undefined && usage.worldDay === 100 && usage.commerceInteractionCount === 1,
        `跨日應整筆替換為今天的第 1 筆（實得 day=${String(usage?.worldDay)} count=${String(usage?.commerceInteractionCount)}）`,
      );
      // 換主角同理：Query 對不同主角回 0。
      const query = createCityQuery(staleUsage, stubDefinitionReader(), stubTeamPort());
      const other = query.getPlayerCommerceUsage(CITY_ID, HEIR_CHARACTER_ID, 99 as WorldDay);
      assert(other.commerceInteractionCount === 0, '換主角後計數應為 0');
    },
  },
  {
    name: 'buyShopOffer：四種前置條件拒絕（Offer 不存在／已售出／設施未開／買方不在城）',
    run: () => {
      expectReject(
        handleBuyShopOffer(
          { type: 'buyShopOffer', offerId: OFFER_AVAILABLE, payerCharacterId: PLAYER_CHARACTER_ID },
          fixtureCityState(),
          makeContext(),
        ),
        'city/offer-not-found',
        'Offer 不存在',
      );
      expectReject(
        handleBuyShopOffer(
          { type: 'buyShopOffer', offerId: OFFER_AVAILABLE, payerCharacterId: PLAYER_CHARACTER_ID },
          stateWithOffer({ state: 'sold' }),
          makeContext(),
        ),
        'city/offer-not-available',
        'Offer 已售出',
      );

      const closedCity = fixtureCityRuntime();
      const closed = createCityState({
        cities: [
          {
            ...closedCity,
            facilityStates: {
              ...closedCity.facilityStates,
              [FACILITY_ITEM_SHOP]: {
                facilityId: FACILITY_ITEM_SHOP,
                availability: 'closed',
                revision: 0 as Revision,
              },
            },
          },
        ],
        shopOffers: [fixtureOffer()],
      });
      expectReject(
        handleBuyShopOffer(
          { type: 'buyShopOffer', offerId: OFFER_AVAILABLE, payerCharacterId: PLAYER_CHARACTER_ID },
          closed,
          makeContext(),
        ),
        'city/facility-not-open',
        '設施關閉',
      );
      expectReject(
        handleBuyShopOffer(
          { type: 'buyShopOffer', offerId: OFFER_AVAILABLE, payerCharacterId: OUTSIDER_CHARACTER_ID },
          stateWithOffer(),
          makeContext(),
        ),
        'city/buyer-not-formal-member-at-city',
        '買方不是城內隊伍的正式成員',
      );
      expectReject(
        handleBuyShopOffer(
          { type: 'buyShopOffer', offerId: OFFER_AVAILABLE, payerCharacterId: PLAYER_CHARACTER_ID },
          createCityState({ shopOffers: [fixtureOffer()] }),
          makeContext(),
        ),
        'city/unknown-city',
        '城市不在 State',
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // sellItemToShop
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'sellItemToShop：接受 → 建立 playerSold Offer、收款、解除角色 Owner',
    run: () => {
      const res = expectAccept(
        handleSellItemToShop(
          {
            type: 'sellItemToShop',
            itemId: PLAYER_ITEM_ID,
            sellerCharacterId: PLAYER_CHARACTER_ID,
            cityId: CITY_ID,
            facilityId: FACILITY_ITEM_SHOP,
          },
          fixtureCityState(),
          makeContext(),
        ),
        'sellItemToShop 應被接受',
      );
      const offers = listOffers(res.nextSlice);
      assert(offers.length === 1, `應建立 1 筆 Offer（實得 ${offers.length}）`);
      assert(offers[0]!.source === 'playerSold', 'Offer source 應為 playerSold');
      assert(offers[0]!.itemId === PLAYER_ITEM_ID, 'Offer 應引用真實 ItemInstance（不變量 1）');
      const transfer = commandsOf(res.outgoingMessages).find(
        (c): c is TransferCurrencyCommand => c.type === 'TransferCurrency',
      );
      assert(transfer !== undefined, '應送出 TransferCurrency');
      const events = eventsOf(res.outgoingMessages).map((e) => e.type);
      assert(events.includes('ShopOfferCreated'), '應發 ShopOfferCreated');
      assert(events.includes('CityStockItemAvailable'), '應發 CityStockItemAvailable');
      assert(events.includes('CommerceInteractionCompleted'), '玩家主角賣出應發交流完成事件');
    },
  },
  {
    name: 'sellItemToShop：非店面／非 Owner／不可交易／已保留／已上架 皆 typed rejection',
    run: () => {
      const base = {
        type: 'sellItemToShop' as const,
        itemId: PLAYER_ITEM_ID,
        sellerCharacterId: PLAYER_CHARACTER_ID,
        cityId: CITY_ID,
        facilityId: FACILITY_ITEM_SHOP,
      };
      expectReject(
        handleSellItemToShop({ ...base, facilityId: FACILITY_TAVERN }, fixtureCityState(), makeContext()),
        'city/facility-not-a-shop',
        '酒館不是店面',
      );
      expectReject(
        handleSellItemToShop(
          { ...base, sellerCharacterId: COMPANION_CHARACTER_ID },
          fixtureCityState(),
          makeContext(),
        ),
        'city/seller-not-item-owner',
        '賣方不是 Owner',
      );
      expectReject(
        handleSellItemToShop(
          base,
          fixtureCityState(),
          makeContext({ inventory: stubInventoryPort({ tradable: false }) }),
        ),
        'city/item-not-tradable',
        '物品不可交易',
      );
      expectReject(
        handleSellItemToShop(
          base,
          fixtureCityState(),
          makeContext({ inventory: stubInventoryPort({ reserved: [PLAYER_ITEM_ID] }) }),
        ),
        'city/item-reserved',
        '物品被保留',
      );
      // 不變量 3：同一 ItemInstance 同時最多一個 available Offer。
      expectReject(
        handleSellItemToShop(
          base,
          stateWithOffer({ itemId: PLAYER_ITEM_ID }),
          makeContext(),
        ),
        'city/item-already-offered',
        '同一物品已有 available Offer',
      );
      expectReject(
        handleSellItemToShop(
          base,
          fixtureCityState(),
          makeContext({
            inventory: stubInventoryPort({ ownerOf: {} }),
          }),
        ),
        'city/item-not-active',
        '物品不存在',
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // buyOrUpgradeHome
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'buyOrUpgradeHome（購買）：接受 → 建立房屋、裝上 initialUpgradeIds、發 HomeChanged(purchased)',
    run: () => {
      const res = expectAccept(
        handleBuyOrUpgradeHome(
          {
            type: 'buyOrUpgradeHome',
            cityId: CITY_ID,
            payerCharacterId: PLAYER_CHARACTER_ID,
            slotCount: 4,
          },
          fixtureCityState(),
          makeContext(),
        ),
        '購買房屋應被接受',
      );
      const homes = Object.values(res.nextSlice.homes);
      assert(homes.length === 1, '應建立 1 間房');
      assert(homes[0]!.slotCapacity === 4, 'slotCapacity 應取自命令選定的 slotCount');
      assert(homes[0]!.installedUpgradeIds.length === 2, '應裝上 initialUpgradeIds（房間 + 倉庫）');
      const changed = findEvent(eventsOf(res.outgoingMessages), 'HomeChanged');
      assert(changed !== undefined && changed.change === 'purchased', 'HomeChanged 應為 purchased');
      assert(
        commandsOf(res.outgoingMessages).some((c) => c.type === 'TransferCurrency'),
        '購屋應送 TransferCurrency',
      );
    },
  },
  {
    name: 'buyOrUpgradeHome（購買）：同城唯一性、未提供 slotCount、非可購 slot 數 皆 typed rejection',
    run: () => {
      const owned = fixtureCityState({ homes: [fixtureHome()] });
      expectReject(
        handleBuyOrUpgradeHome(
          {
            type: 'buyOrUpgradeHome',
            cityId: CITY_ID,
            payerCharacterId: PLAYER_CHARACTER_ID,
            slotCount: 4,
          },
          owned,
          makeContext(),
        ),
        'city/home-already-owned-in-city',
        '同城已有一間房（GDD §八）',
      );
      expectReject(
        handleBuyOrUpgradeHome(
          { type: 'buyOrUpgradeHome', cityId: CITY_ID, payerCharacterId: PLAYER_CHARACTER_ID },
          fixtureCityState(),
          makeContext(),
        ),
        'city/home-slot-count-required',
        '未提供 slotCount',
      );
      expectReject(
        handleBuyOrUpgradeHome(
          {
            type: 'buyOrUpgradeHome',
            cityId: CITY_ID,
            payerCharacterId: PLAYER_CHARACTER_ID,
            slotCount: 5,
          },
          fixtureCityState(),
          makeContext(),
        ),
        'city/home-slot-count-not-purchasable',
        'slotCount 不在 purchasableSlotCounts',
      );
      expectReject(
        handleBuyOrUpgradeHome(
          {
            type: 'buyOrUpgradeHome',
            cityId: CITY_ID,
            payerCharacterId: OUTSIDER_CHARACTER_ID,
            slotCount: 4,
          },
          fixtureCityState(),
          makeContext(),
        ),
        'city/payer-not-formal-member-at-city',
        '付款者不在城內',
      );
    },
  },
  {
    name: 'buyOrUpgradeHome（升級）：接受一筆合法功能間；容量不足／未允許／已安裝／形狀錯誤 皆拒絕',
    run: () => {
      const bigHome = fixtureCityState({ homes: [fixtureHome({ slotCapacity: 8 })] });
      const res = expectAccept(
        handleBuyOrUpgradeHome(
          {
            type: 'buyOrUpgradeHome',
            cityId: CITY_ID,
            homeId: HOME_ID,
            upgradeId: UPGRADE_FORGE,
            payerCharacterId: PLAYER_CHARACTER_ID,
          },
          bigHome,
          makeContext(),
        ),
        '升級應被接受',
      );
      assert(
        res.nextSlice.homes[HOME_ID]!.installedUpgradeIds.includes(UPGRADE_FORGE),
        '應裝上鍛造間',
      );
      const changed = findEvent(eventsOf(res.outgoingMessages), 'HomeChanged');
      assert(changed !== undefined && changed.change === 'upgradeInstalled', 'HomeChanged 應為 upgradeInstalled');

      // slotCapacity 4，已用 2（房間 + 倉庫），鍛造間 slotCost 2 → 剛好塞得下；改 3 就不夠。
      expectReject(
        handleBuyOrUpgradeHome(
          {
            type: 'buyOrUpgradeHome',
            cityId: CITY_ID,
            homeId: HOME_ID,
            upgradeId: UPGRADE_FORGE,
            payerCharacterId: PLAYER_CHARACTER_ID,
          },
          fixtureCityState({ homes: [fixtureHome({ slotCapacity: 3 })] }),
          makeContext(),
        ),
        'city/home-slot-capacity-exceeded',
        'Slot 容量不足',
      );
      expectReject(
        handleBuyOrUpgradeHome(
          {
            type: 'buyOrUpgradeHome',
            cityId: CITY_ID,
            homeId: HOME_ID,
            upgradeId: UPGRADE_UNLISTED,
            payerCharacterId: PLAYER_CHARACTER_ID,
          },
          bigHome,
          makeContext(),
        ),
        'city/home-upgrade-not-allowed',
        '功能間不在 allowedUpgradeIds',
      );
      expectReject(
        handleBuyOrUpgradeHome(
          {
            type: 'buyOrUpgradeHome',
            cityId: CITY_ID,
            homeId: HOME_ID,
            upgradeId: UPGRADE_ROOM,
            payerCharacterId: PLAYER_CHARACTER_ID,
          },
          bigHome,
          makeContext(),
        ),
        'city/home-upgrade-not-allowed',
        '已安裝的 room 不在 allowedUpgradeIds',
      );
      expectReject(
        handleBuyOrUpgradeHome(
          {
            type: 'buyOrUpgradeHome',
            cityId: CITY_ID,
            homeId: HOME_ID,
            payerCharacterId: PLAYER_CHARACTER_ID,
          },
          bigHome,
          makeContext(),
        ),
        'city/home-command-shape-invalid',
        '只給 homeId 沒給 upgradeId',
      );
      expectReject(
        handleBuyOrUpgradeHome(
          {
            type: 'buyOrUpgradeHome',
            cityId: CITY_ID,
            homeId: HOME_ID,
            upgradeId: UPGRADE_FORGE,
            payerCharacterId: COMPANION_CHARACTER_ID,
          },
          bigHome,
          makeContext(),
        ),
        'city/home-owner-mismatch',
        '非所有者不得升級',
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // releaseHomeTeacher / InterruptHomeTeachingPost
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'releaseHomeTeacher：達最短 28 日才可解除；未達→拒絕；已解除→冪等 no-op',
    run: () => {
      const state = fixtureCityState({ homeTeachingPosts: [fixtureTeachingPost()] });
      expectReject(
        handleReleaseHomeTeacher(
          { type: 'releaseHomeTeacher', postId: POST_ID },
          state,
          makeContext({ worldDay: 37 as WorldDay }),
        ),
        'city/teaching-post-minimum-not-reached',
        '未達 minimumReleaseOnDay',
      );
      const res = expectAccept(
        handleReleaseHomeTeacher(
          { type: 'releaseHomeTeacher', postId: POST_ID },
          state,
          makeContext({ worldDay: 38 as WorldDay }),
        ),
        '達最短天數應可解除',
      );
      assert(res.nextSlice.homeTeachingPosts[POST_ID]!.state === 'released', 'Post 應轉 released');
      const changed = findEvent(eventsOf(res.outgoingMessages), 'HomeTeachingPostChanged');
      assert(changed !== undefined && changed.state === 'released', '應發 HomeTeachingPostChanged');

      // 冪等：對已 released 的 Post 再送一次 → 接受且**Slice 物件不變**（不是碰巧欄位相同）。
      const again = expectAccept(
        handleReleaseHomeTeacher(
          { type: 'releaseHomeTeacher', postId: POST_ID },
          res.nextSlice,
          makeContext({ worldDay: 50 as WorldDay }),
        ),
        '重複解除應冪等接受',
      );
      assert(again.nextSlice === res.nextSlice, '冪等時應回傳同一個 Slice 參考');
      assert(again.outgoingMessages.length === 0, '冪等時不得重複發事件');
      expectReject(
        handleReleaseHomeTeacher(
          { type: 'releaseHomeTeacher', postId: POST_ID },
          fixtureCityState(),
          makeContext(),
        ),
        'city/teaching-post-not-found',
        'Post 不存在',
      );
    },
  },
  {
    name: 'InterruptHomeTeachingPost：active→interrupted 並發事件；已中斷冪等；已解除拒絕',
    run: () => {
      const state = fixtureCityState({ homeTeachingPosts: [fixtureTeachingPost()] });
      const res = expectAccept(
        handleInterruptHomeTeachingPost(
          { type: 'InterruptHomeTeachingPost', postId: POST_ID, sourceId: COMPANION_CHARACTER_ID },
          state,
          makeContext(),
        ),
        '中斷應被接受',
      );
      assert(res.nextSlice.homeTeachingPosts[POST_ID]!.state === 'interrupted', 'Post 應轉 interrupted');
      const again = expectAccept(
        handleInterruptHomeTeachingPost(
          { type: 'InterruptHomeTeachingPost', postId: POST_ID, sourceId: COMPANION_CHARACTER_ID },
          res.nextSlice,
          makeContext(),
        ),
        '重複中斷應冪等接受',
      );
      assert(again.nextSlice === res.nextSlice, '冪等時應回傳同一個 Slice 參考');
      expectReject(
        handleInterruptHomeTeachingPost(
          { type: 'InterruptHomeTeachingPost', postId: POST_ID, sourceId: COMPANION_CHARACTER_ID },
          fixtureCityState({ homeTeachingPosts: [fixtureTeachingPost({ state: 'released' })] }),
          makeContext(),
        ),
        'city/teaching-post-already-released',
        '已解除的 Post 不可中斷',
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Quest 保留 / 釋放
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'ReserveShopOfferForQuest：保留成功；同一委託冪等；別的委託不得奪走',
    run: () => {
      const state = stateWithOffer();
      const res = expectAccept(
        handleReserveShopOfferForQuest(
          { type: 'ReserveShopOfferForQuest', offerId: OFFER_AVAILABLE, sourceQuestId: QUEST_A },
          state,
          makeContext(),
        ),
        '保留應被接受',
      );
      assert(
        res.nextSlice.shopOffers[OFFER_AVAILABLE]!.sourceQuestId === QUEST_A,
        '應寫入 sourceQuestId',
      );
      assert(
        res.nextSlice.shopOffers[OFFER_AVAILABLE]!.state === 'available',
        '保留中的 Offer 仍可購買（doc §8.1）',
      );
      const again = expectAccept(
        handleReserveShopOfferForQuest(
          { type: 'ReserveShopOfferForQuest', offerId: OFFER_AVAILABLE, sourceQuestId: QUEST_A },
          res.nextSlice,
          makeContext(),
        ),
        '同一委託重複保留應冪等',
      );
      assert(again.nextSlice === res.nextSlice, '冪等時應回傳同一個 Slice 參考');
      expectReject(
        handleReserveShopOfferForQuest(
          { type: 'ReserveShopOfferForQuest', offerId: OFFER_AVAILABLE, sourceQuestId: QUEST_B },
          res.nextSlice,
          makeContext(),
        ),
        'city/offer-reserved-by-other-quest',
        '別的委託不得覆蓋既有保留',
      );
      expectReject(
        handleReserveShopOfferForQuest(
          { type: 'ReserveShopOfferForQuest', offerId: OFFER_AVAILABLE, sourceQuestId: QUEST_A },
          stateWithOffer({ state: 'sold' }),
          makeContext(),
        ),
        'city/offer-not-available',
        '已售出的 Offer 不可保留',
      );
    },
  },
  {
    name: 'ReleaseQuestShopOffer：release 只解除標記、expire 連帶關閉；他人保留拒絕；重複釋放冪等',
    run: () => {
      const reserved = stateWithOffer({ sourceQuestId: QUEST_A });
      const released = expectAccept(
        handleReleaseQuestShopOffer(
          {
            type: 'ReleaseQuestShopOffer',
            offerId: OFFER_AVAILABLE,
            sourceQuestId: QUEST_A,
            disposition: 'release',
          },
          reserved,
          makeContext(),
        ),
        'release 應被接受',
      );
      const afterRelease = released.nextSlice.shopOffers[OFFER_AVAILABLE]!;
      assert(afterRelease.sourceQuestId === undefined, 'release 應清除 sourceQuestId');
      assert(afterRelease.state === 'available', 'release 不得關閉 Offer');

      const expired = expectAccept(
        handleReleaseQuestShopOffer(
          {
            type: 'ReleaseQuestShopOffer',
            offerId: OFFER_AVAILABLE,
            sourceQuestId: QUEST_A,
            disposition: 'expire',
          },
          reserved,
          makeContext(),
        ),
        'expire 應被接受',
      );
      assert(
        expired.nextSlice.shopOffers[OFFER_AVAILABLE]!.state === 'expired',
        'expire 應把 Offer 關閉',
      );

      const again = expectAccept(
        handleReleaseQuestShopOffer(
          {
            type: 'ReleaseQuestShopOffer',
            offerId: OFFER_AVAILABLE,
            sourceQuestId: QUEST_A,
            disposition: 'release',
          },
          released.nextSlice,
          makeContext(),
        ),
        '重複 release 應冪等',
      );
      assert(again.nextSlice === released.nextSlice, '冪等時應回傳同一個 Slice 參考');
      expectReject(
        handleReleaseQuestShopOffer(
          {
            type: 'ReleaseQuestShopOffer',
            offerId: OFFER_AVAILABLE,
            sourceQuestId: QUEST_B,
            disposition: 'release',
          },
          reserved,
          makeContext(),
        ),
        'city/offer-reserved-by-other-quest',
        '不得釋放別張委託的保留',
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // SetFacilityAvailability / ApplyCityMetricEffect
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'SetFacilityAvailability：改變開放狀態；同狀態冪等；未知設施拒絕',
    run: () => {
      const state = fixtureCityState();
      const res = expectAccept(
        handleSetFacilityAvailability(
          {
            type: 'SetFacilityAvailability',
            cityId: CITY_ID,
            facilityId: FACILITY_ITEM_SHOP,
            availability: 'restricted',
            restrictionReason: 'siege',
            sourceId: CITY_ID,
          },
          state,
          makeContext(),
        ),
        '設施狀態變更應被接受',
      );
      const facility = res.nextSlice.cities[CITY_ID]!.facilityStates[FACILITY_ITEM_SHOP]!;
      assert(facility.availability === 'restricted', '應轉為 restricted');
      assert(facility.restrictionReason === 'siege', '應保留限制理由');
      const again = expectAccept(
        handleSetFacilityAvailability(
          {
            type: 'SetFacilityAvailability',
            cityId: CITY_ID,
            facilityId: FACILITY_ITEM_SHOP,
            availability: 'restricted',
            restrictionReason: 'siege',
            sourceId: CITY_ID,
          },
          res.nextSlice,
          makeContext(),
        ),
        '同狀態應冪等',
      );
      assert(again.nextSlice === res.nextSlice, '冪等時應回傳同一個 Slice 參考');
      expectReject(
        handleSetFacilityAvailability(
          {
            type: 'SetFacilityAvailability',
            cityId: CITY_ID,
            facilityId: 'facility-absent' as typeof FACILITY_ITEM_SHOP,
            availability: 'closed',
            sourceId: CITY_ID,
          },
          state,
          makeContext(),
        ),
        'city/facility-not-in-city',
        '未知設施',
      );
    },
  },
  {
    name: 'ApplyCityMetricEffect：值由 Resolver 決定並發 CityMetricsChanged；夾在上下限時冪等',
    run: () => {
      const state = fixtureCityState();
      const res = expectAccept(
        handleApplyCityMetricEffect(
          {
            type: 'ApplyCityMetricEffect',
            cityId: CITY_ID,
            effectId: EFFECT_ID,
            sourceId: CITY_ID,
          },
          state,
          makeContext({ resolvers: stubResolverPort({ metric: { prosperity: 77, safety: 12 } }) }),
        ),
        '套用 Effect 應被接受',
      );
      assert(res.nextSlice.cities[CITY_ID]!.prosperity === 77, '繁榮值應取自 Resolver');
      const changed = findEvent(eventsOf(res.outgoingMessages), 'CityMetricsChanged');
      assert(changed !== undefined && changed.safety === 12, '應發 CityMetricsChanged');

      const clamped = expectAccept(
        handleApplyCityMetricEffect(
          {
            type: 'ApplyCityMetricEffect',
            cityId: CITY_ID,
            effectId: EFFECT_ID,
            sourceId: CITY_ID,
          },
          state,
          makeContext({ resolvers: stubResolverPort({ metric: { prosperity: 40, safety: 50 } }) }),
        ),
        'Resolver 夾回原值時應冪等接受',
      );
      assert(clamped.nextSlice === state, '無變化時應回傳同一個 Slice 參考');
      assert(clamped.outgoingMessages.length === 0, '無變化時不得發 CityMetricsChanged');
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // TransferHomeOwnership
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'TransferHomeOwnership：移轉成功並發事件；原所有者不符拒絕；同城唯一性拒絕；重送冪等',
    run: () => {
      const state = fixtureCityState({ homes: [fixtureHome()] });
      const res = expectAccept(
        handleTransferHomeOwnership(
          {
            type: 'TransferHomeOwnership',
            homeId: HOME_ID,
            fromCharacterId: PLAYER_CHARACTER_ID,
            toCharacterId: HEIR_CHARACTER_ID,
            sourceId: PLAYER_CHARACTER_ID,
          },
          state,
          makeContext(),
        ),
        '移轉應被接受',
      );
      assert(
        res.nextSlice.homes[HOME_ID]!.ownerCharacterId === HEIR_CHARACTER_ID,
        '所有者應改為繼承人',
      );
      const changed = findEvent(eventsOf(res.outgoingMessages), 'HomeChanged');
      assert(
        changed !== undefined && changed.change === 'ownershipTransferred',
        'HomeChanged 應為 ownershipTransferred',
      );
      const again = expectAccept(
        handleTransferHomeOwnership(
          {
            type: 'TransferHomeOwnership',
            homeId: HOME_ID,
            fromCharacterId: PLAYER_CHARACTER_ID,
            toCharacterId: HEIR_CHARACTER_ID,
            sourceId: PLAYER_CHARACTER_ID,
          },
          res.nextSlice,
          makeContext(),
        ),
        '同一筆繼承重送應冪等',
      );
      assert(again.nextSlice === res.nextSlice, '冪等時應回傳同一個 Slice 參考');
      expectReject(
        handleTransferHomeOwnership(
          {
            type: 'TransferHomeOwnership',
            homeId: HOME_ID,
            fromCharacterId: COMPANION_CHARACTER_ID,
            toCharacterId: HEIR_CHARACTER_ID,
            sourceId: COMPANION_CHARACTER_ID,
          },
          state,
          makeContext(),
        ),
        'city/home-owner-mismatch',
        '原所有者不符',
      );
      // 不變量：同城對同一所有者最多一間房。
      const twoHomes = fixtureCityState({
        homes: [
          fixtureHome(),
          fixtureHome({ homeId: 'home-second' as typeof HOME_ID, ownerCharacterId: HEIR_CHARACTER_ID }),
        ],
      });
      expectReject(
        handleTransferHomeOwnership(
          {
            type: 'TransferHomeOwnership',
            homeId: HOME_ID,
            fromCharacterId: PLAYER_CHARACTER_ID,
            toCharacterId: HEIR_CHARACTER_ID,
            sourceId: PLAYER_CHARACTER_ID,
          },
          twoHomes,
          makeContext(),
        ),
        'city/home-already-owned-in-city',
        '繼承人在該城已有一間房',
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // RevealTavernIntel
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'RevealTavernIntel：揭露成功並發 IntelRevealed；同隊重複揭露冪等；四種前置條件拒絕',
    run: () => {
      const state = fixtureCityState({ intelLeads: [fixtureIntel()] });
      const res = expectAccept(
        handleRevealTavernIntel(
          { type: 'RevealTavernIntel', cityId: CITY_ID, teamId: PLAYER_TEAM_ID, intelId: INTEL_ID },
          state,
          makeContext(),
        ),
        '揭露應被接受',
      );
      const intel = res.nextSlice.intelLeads[INTEL_ID]!;
      assert(intel.state === 'revealed', 'Intel 應轉 revealed');
      assert(intel.revealedToTeamIds.includes(PLAYER_TEAM_ID), '應記錄已揭露的隊伍');
      assert(
        findEvent(eventsOf(res.outgoingMessages), 'IntelRevealed') !== undefined,
        '應發 IntelRevealed',
      );
      const again = expectAccept(
        handleRevealTavernIntel(
          { type: 'RevealTavernIntel', cityId: CITY_ID, teamId: PLAYER_TEAM_ID, intelId: INTEL_ID },
          res.nextSlice,
          makeContext(),
        ),
        '同隊重複揭露應冪等',
      );
      assert(again.nextSlice === res.nextSlice, '冪等時應回傳同一個 Slice 參考');
      // 已對 A 隊揭露的情報，B 隊仍可揭露。
      const teamB = expectAccept(
        handleRevealTavernIntel(
          { type: 'RevealTavernIntel', cityId: CITY_ID, teamId: OTHER_TEAM_ID, intelId: INTEL_ID },
          res.nextSlice,
          makeContext({
            team: stubTeamPort({ teamsByCity: { [String(CITY_ID)]: [OTHER_TEAM_ID] } }),
          }),
        ),
        '另一支隊伍仍可揭露同一情報',
      );
      assert(
        teamB.nextSlice.intelLeads[INTEL_ID]!.revealedToTeamIds.length === 2,
        '兩支隊伍都應被記錄',
      );

      expectReject(
        handleRevealTavernIntel(
          { type: 'RevealTavernIntel', cityId: CITY_ID, teamId: OTHER_TEAM_ID, intelId: INTEL_ID },
          state,
          makeContext(),
        ),
        'city/team-not-at-city',
        '隊伍不在該城',
      );
      expectReject(
        handleRevealTavernIntel(
          { type: 'RevealTavernIntel', cityId: CITY_ID, teamId: PLAYER_TEAM_ID, intelId: INTEL_ID },
          fixtureCityState({ intelLeads: [fixtureIntel({ state: 'obsolete' })] }),
          makeContext(),
        ),
        'city/intel-obsolete',
        '來源已失效的情報不得揭露',
      );
      expectReject(
        handleRevealTavernIntel(
          { type: 'RevealTavernIntel', cityId: CITY_ID, teamId: PLAYER_TEAM_ID, intelId: INTEL_ID },
          fixtureCityState({ intelLeads: [fixtureIntel({ cityId: OTHER_CITY_ID })] }),
          makeContext(),
        ),
        'city/intel-not-in-city',
        '情報不屬於該城',
      );
      const closedTavern = fixtureCityRuntime();
      expectReject(
        handleRevealTavernIntel(
          { type: 'RevealTavernIntel', cityId: CITY_ID, teamId: PLAYER_TEAM_ID, intelId: INTEL_ID },
          createCityState({
            cities: [
              {
                ...closedTavern,
                facilityStates: {
                  ...closedTavern.facilityStates,
                  [FACILITY_TAVERN]: {
                    facilityId: FACILITY_TAVERN,
                    availability: 'closed',
                    revision: 0 as Revision,
                  },
                },
              },
            ],
            intelLeads: [fixtureIntel()],
          }),
          makeContext(),
        ),
        'city/facility-not-open',
        '酒館未開放',
      );
      expectReject(
        handleRevealTavernIntel(
          { type: 'RevealTavernIntel', cityId: CITY_ID, teamId: PLAYER_TEAM_ID, intelId: INTEL_ID },
          fixtureCityState(),
          makeContext(),
        ),
        'city/intel-not-found',
        '情報不存在',
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // shopRefresh
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'shopRefresh：playerSold 清除 + 永久庫存抽取 + 發 ShopRefreshed + 自行重排下一次',
    run: () => {
      const state = fixtureCityState({
        shopOffers: [
          fixtureOffer({
            offerId: 'offer-old-player-sold' as typeof OFFER_AVAILABLE,
            source: 'playerSold',
            itemId: PLAYER_ITEM_ID,
          }),
          fixtureOffer({ source: 'permanentStock', itemId: STOCK_ITEM_A }),
        ],
      });
      const res = expectAccept(
        handleShopRefresh(shopRefreshJob(), state, makeContext()),
        'shopRefresh 應被接受',
      );
      const offers = res.nextSlice.shopOffers;
      assert(
        offers['offer-old-player-sold' as typeof OFFER_AVAILABLE]!.state === 'expired',
        'playerSold 舊 Offer 應下架（不變量 4）',
      );
      assert(
        commandsOf(res.outgoingMessages).some((c) => c.type === 'RemoveItemInstance'),
        '應送 RemoveItemInstance 清除 playerSold 實體',
      );
      assert(offers[OFFER_AVAILABLE]!.state === 'expired', '未售出的 permanentStock Offer 應下架');
      const refreshed = findEvent(eventsOf(res.outgoingMessages), 'ShopRefreshed');
      assert(refreshed !== undefined, '應發 ShopRefreshed');
      assert(refreshed!.shopId === FACILITY_ITEM_SHOP, 'ShopRefreshed.shopId 應取自 ShopRule.facilityId');
      assert(refreshed!.offerIds.length === 2, `應建立 2 筆新 Offer（實得 ${refreshed!.offerIds.length}）`);
      assert(
        eventsOf(res.outgoingMessages).filter((e) => e.type === 'ShopOfferCreated').length === 2,
        '每筆新 Offer 都應發 ShopOfferCreated',
      );
      assert(res.scheduledJobs.length === 1, '應重排下一次刷新（Job 提交即被 dequeue）');
      assert(
        res.scheduledJobs[0]!.dueDay === 130,
        `下一次刷新日應為 worldDay + refreshCadenceDays（實得 ${res.scheduledJobs[0]!.dueDay}）`,
      );
      // 不變量 3：新 Offer 不得指向已有 available Offer 的實體。
      const availableItemIds = listOffers(res.nextSlice)
        .filter((o) => o.state === 'available')
        .map((o) => String(o.itemId));
      assert(
        new Set(availableItemIds).size === availableItemIds.length,
        '同一實體不得同時有兩筆 available Offer',
      );
    },
  },
  {
    name: 'shopRefresh：Quest 保留中的 Offer 不受一般刷新清除（不變量 4 例外）',
    run: () => {
      const state = fixtureCityState({
        shopOffers: [
          fixtureOffer({
            offerId: 'offer-quest-held' as typeof OFFER_AVAILABLE,
            source: 'playerSold',
            itemId: PLAYER_ITEM_ID,
            sourceQuestId: QUEST_A,
          }),
        ],
      });
      const res = expectAccept(
        handleShopRefresh(shopRefreshJob(), state, makeContext()),
        'shopRefresh 應被接受',
      );
      assert(
        res.nextSlice.shopOffers['offer-quest-held' as typeof OFFER_AVAILABLE]!.state === 'available',
        'Quest 保留中的 Offer 應保持 available',
      );
      assert(
        !commandsOf(res.outgoingMessages).some((c) => c.type === 'RemoveItemInstance'),
        'Quest 保留中的實體不可被清除',
      );
    },
  },
  {
    name: 'shopRefresh：決定性（同 cursor 同結果）+ cursor 逐次前進（不重用 cursor 0）',
    run: () => {
      const state = fixtureCityState();
      const first = expectAccept(
        handleShopRefresh(shopRefreshJob(), state, makeContext({ rngContext: stubRngContext(0) })),
        '第一次刷新應被接受',
      );
      const repeat = expectAccept(
        handleShopRefresh(shopRefreshJob(), state, makeContext({ rngContext: stubRngContext(0) })),
        '同 cursor 重跑應被接受',
      );
      const itemsOf = (r: typeof first): string =>
        listOffers(r.nextSlice)
          .filter((o) => o.state === 'available')
          .map((o) => String(o.itemId))
          .sort()
          .join(',');
      assert(itemsOf(first) === itemsOf(repeat), '同 cursor 應得到相同抽取結果（決定性）');

      const shifted = expectAccept(
        handleShopRefresh(shopRefreshJob(), state, makeContext({ rngContext: stubRngContext(7) })),
        '不同 cursor 應被接受',
      );
      // 抽 2 件、庫存 3 件：cursor 前進代表第二次抽取沒有重用第一次的 cursor，
      // 否則兩次都會抽到同一件（Set 大小會變成 1）。
      const distinct = new Set(
        listOffers(shifted.nextSlice)
          .filter((o) => o.state === 'available')
          .map((o) => String(o.itemId)),
      );
      assert(distinct.size === 2, `兩筆新 Offer 應指向兩個不同實體（實得 ${distinct.size}）`);
    },
  },
  {
    name: 'shopRefresh：基礎目錄需要 Workflow → 明確拒絕；規則無主城市 → 明確拒絕',
    run: () => {
      // 帶 baseCatalogPoolId 的規則：Offer 必須引用真實 ItemInstance，而 ItemInstanceId 只有
      // inventory 能鑄造且不得同步取回 → 不能在 City Handler 內完成，拒絕而非略過。
      const withCatalog = fixtureCityState();
      const definitions = stubDefinitionReader({
        getCity: () => ({ ...CITY_DEFINITION, shopRuleIds: [SHOP_RULE_BOOK_WITH_CATALOG] }),
      });
      expectReject(
        handleShopRefresh(
          shopRefreshJob(SHOP_RULE_BOOK_WITH_CATALOG),
          withCatalog,
          makeContext({ definitions }),
        ),
        'city/base-catalog-refresh-needs-workflow',
        '基礎目錄刷新',
      );
      expectReject(
        handleShopRefresh(shopRefreshJob(), createCityState({}), makeContext()),
        'city/shop-rule-has-no-city',
        '找不到擁有這條 Shop Rule 的城市',
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // escortGeneration
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'escortGeneration：生成候選、發 EscortCandidatesGenerated、重排下一批；候選不是 Character',
    run: () => {
      const res = expectAccept(
        handleEscortGeneration(escortJob(), fixtureCityState(), makeContext()),
        'escortGeneration 應被接受',
      );
      const generated = findEvent(eventsOf(res.outgoingMessages), 'EscortCandidatesGenerated');
      assert(generated !== undefined, '應發 EscortCandidatesGenerated');
      const candidates = listEscortCandidates(res.nextSlice);
      assert(
        candidates.length === generated!.candidateIds.length,
        '事件的候選數應等於實際寫入數',
      );
      for (const c of candidates) {
        // 不變量 10：EscortCandidate 不是 Character——只有 archetype、目的地與兩個期限。
        assert(c.originCityId === CITY_ID, '候選的起點應為本城');
        assert(c.destinationCityId === OTHER_CITY_ID, '目的地應由 Resolver 決定');
        assert(c.acceptDeadline === 107 && c.actualEndDeadline === 130, '兩個期限應由 Resolver 決定');
        assert(c.state === 'available', '新候選應為 available');
      }
      assert(res.scheduledJobs.length === 1, '應重排下一批（7 日節奏）');
      assert(res.scheduledJobs[0]!.dueDay === 107, '下一批應為 worldDay + cadenceDays');
    },
  },
  {
    name: 'escortGeneration：缺 deadlineResolverId → 不啟用（typed rejection，doc §2.4）',
    run: () => {
      const definitions = stubDefinitionReader({
        getCity: () => ({ ...CITY_DEFINITION, escortGenerationRuleId: ESCORT_RULE_NO_DEADLINE.id }),
      });
      expectReject(
        handleEscortGeneration(escortJob(), fixtureCityState(), makeContext({ definitions })),
        'city/escort-deadline-resolver-missing',
        '缺期限 Resolver',
      );
      const emptyPool = stubDefinitionReader({
        getEscortGenerationRule: () => ({
          ...stubDefinitionReader().getEscortGenerationRule(ESCORT_RULE_ID),
          allowedArchetypeIds: [],
        }),
      });
      expectReject(
        handleEscortGeneration(escortJob(), fixtureCityState(), makeContext({ definitions: emptyPool })),
        'city/escort-archetype-pool-empty',
        'archetype 池為空',
      );
      expectReject(
        handleEscortGeneration(escortJob(), createCityState({}), makeContext()),
        'city/unknown-city',
        '城市不在 State',
      );
    },
  },
  {
    name: 'escortGeneration：決定性（同 cursor 同數量）且 cursor 前進到 Resolver 不重用',
    run: () => {
      const runWith = (cursor: number) =>
        expectAccept(
          handleEscortGeneration(
            escortJob(),
            fixtureCityState(),
            makeContext({ rngContext: stubRngContext(cursor) }),
          ),
          'escortGeneration 應被接受',
        );
      const a = runWith(3);
      const b = runWith(3);
      assert(
        listEscortCandidates(a.nextSlice).length === listEscortCandidates(b.nextSlice).length,
        '同 cursor 應得到相同候選數（決定性）',
      );
      // archetype 抽取每筆各一次 + 兩個 Resolver 各前進一次：候選 ID 必須全不同（ID 配發器逐次前進）。
      const ids = new Set(listEscortCandidates(a.nextSlice).map((c) => String(c.candidateId)));
      assert(ids.size === listEscortCandidates(a.nextSlice).length, '候選 ID 不得重複');
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // cityPopulationReview
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'cityPopulationReview：缺口 → 發 AdventurerSupplyDemanded（受 batchLimit 夾住）並重排',
    run: () => {
      const res = expectAccept(
        handleCityPopulationReview(
          populationJob(),
          fixtureCityState(),
          makeContext({
            supply: stubSupplyPort(1),
            resolvers: stubResolverPort({ populationTarget: 20 }),
          }),
        ),
        'cityPopulationReview 應被接受',
      );
      const demanded = findEvent(eventsOf(res.outgoingMessages), 'AdventurerSupplyDemanded');
      assert(demanded !== undefined, '應發 AdventurerSupplyDemanded');
      assert(demanded!.count === 3, `count 應被 batchLimit 夾住（實得 ${demanded!.count}）`);
      assert(demanded!.cultureId === CULTURE_ID, 'cultureId 應取自 world 的原生文化');
      assert(demanded!.reason === 'populationReviewDeficit', 'reason 應為具名原因');
      assert(res.scheduledJobs.length === 1, '應重排下一批次');
      assert(res.scheduledJobs[0]!.dueDay === 130, '下一批次應為 worldDay + cadenceDays');
    },
  },
  {
    name: 'cityPopulationReview：無缺口 → 不發事件但仍重排（不是 no-op）；未知城市拒絕',
    run: () => {
      const res = expectAccept(
        handleCityPopulationReview(
          populationJob(),
          fixtureCityState(),
          makeContext({
            supply: stubSupplyPort(9),
            resolvers: stubResolverPort({ populationTarget: 5 }),
          }),
        ),
        '無缺口時仍應被接受',
      );
      assert(res.outgoingMessages.length === 0, '無缺口不得發補充需求');
      assert(res.scheduledJobs.length === 1, '無缺口仍必須重排下一批次');
      expectReject(
        handleCityPopulationReview(populationJob(), createCityState({}), makeContext()),
        'city/unknown-city',
        '城市不在 State',
      );
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // CityQuery
  // ────────────────────────────────────────────────────────────────────────
  {
    name: 'CityQuery：設施／Offer／情報／房屋／額度投影正確；未知單筆查詢明確拋錯',
    run: () => {
      const state = fixtureCityState({
        shopOffers: [fixtureOffer(), fixtureOffer({ offerId: 'offer-b' as typeof OFFER_AVAILABLE, itemId: STOCK_ITEM_B })],
        intelLeads: [fixtureIntel()],
        homes: [fixtureHome()],
      });
      const query = createCityQuery(state, stubDefinitionReader(), stubTeamPort());

      assert(query.getCity(CITY_ID).prosperity === 40, 'getCity 應投影繁榮值');
      assert(query.isFacilityAvailable(CITY_ID, 'itemShop'), '道具店應可用');
      assert(query.getFacility(CITY_ID, 'tavern').facilityId === FACILITY_TAVERN, 'getFacility 依 kind 找設施');
      assert(query.listShopOffers(CITY_ID, 'item').length === 2, 'listShopOffers 依 shopKind 過濾');
      assert(query.listShopOffers(CITY_ID, 'book').length === 0, '沒有書店規則時應為空');
      assert(query.getOffer(OFFER_AVAILABLE).itemId === STOCK_ITEM_A, 'getOffer 應投影 itemId');
      assert(query.listAvailableIntel(CITY_ID, PLAYER_TEAM_ID).length === 1, '未揭露情報應列出');
      assert(query.canUseTavern(CITY_ID, PLAYER_TEAM_ID), '城內隊伍可用酒館');
      assert(!query.canUseTavern(CITY_ID, OTHER_TEAM_ID), '不在城的隊伍不可用酒館');
      assert(query.canUseRestaurant(CITY_ID, PLAYER_CHARACTER_ID), '城內成員可用餐點入口');
      assert(!query.canUseRestaurant(CITY_ID, OUTSIDER_CHARACTER_ID), '不在城的角色不可用餐點入口');
      assert(query.getHome(CITY_ID, PLAYER_CHARACTER_ID)?.slotCapacity === 4, 'getHome 應投影容量');
      assert(query.getHome(CITY_ID, HEIR_CHARACTER_ID) === undefined, '沒有房屋應回 undefined');
      const usage = query.getPlayerCommerceUsage(CITY_ID, PLAYER_CHARACTER_ID, 100 as WorldDay);
      assert(usage.remainingCount === 6, `未使用時剩餘應為上限（實得 ${usage.remainingCount}）`);

      // 已揭露給該隊的情報不再列出（避免重複打聽）。
      const revealed = createCityState({
        cities: [fixtureCityRuntime()],
        intelLeads: [fixtureIntel({ state: 'revealed', revealedToTeamIds: [PLAYER_TEAM_ID] })],
      });
      const q2 = createCityQuery(revealed, stubDefinitionReader(), stubTeamPort());
      assert(q2.listAvailableIntel(CITY_ID, PLAYER_TEAM_ID).length === 0, '已揭露情報不再列出');

      let threw = false;
      try {
        query.getOffer('offer-absent' as typeof OFFER_AVAILABLE);
      } catch {
        threw = true;
      }
      assert(threw, '未知 Offer 應明確拋錯（不靜默回假資料）');

      threw = false;
      try {
        createCityQuery(createCityState({}), stubDefinitionReader(), stubTeamPort()).getCity(CITY_ID);
      } catch {
        threw = true;
      }
      assert(threw, '未知城市應明確拋錯');
    },
  },
  {
    name: 'State：同城同所有者唯一性 helper 忽略已移轉的舊記錄；playerCommerceUsage 只認同人同日',
    run: () => {
      const transferred = fixtureCityState({
        homes: [fixtureHome({ state: 'transferred' })],
      });
      const query = createCityQuery(transferred, stubDefinitionReader(), stubTeamPort());
      assert(
        query.getHome(CITY_ID, PLAYER_CHARACTER_ID) === undefined,
        '已移轉的房屋不再屬於原所有者',
      );
      const res = expectAccept(
        handleBuyOrUpgradeHome(
          {
            type: 'buyOrUpgradeHome',
            cityId: CITY_ID,
            payerCharacterId: PLAYER_CHARACTER_ID,
            slotCount: 4,
          },
          transferred,
          makeContext({ ids: makeIdAllocator('second') }),
        ),
        '已移轉的舊記錄不應擋住重新購屋',
      );
      assert(Object.keys(res.nextSlice.homes).length === 2, '應新增一間房');
    },
  },
];

export type CityTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestsVerbose(): readonly CityTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return { name: c.name, passed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function runTests(): void {
  const results = runTestsVerbose();
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const detail = failed.map((f) => `  - ${f.name}: ${f.error ?? 'failed'}`).join('\n');
    throw new Error(`city module: ${failed.length}/${results.length} tests failed\n${detail}`);
  }
}

// （此處原有一段「未使用的 import 保護」：`void (CharacterId as unknown)` 等三行。
//  它把 `CharacterId` / `TeamId` 這兩個**型別**當成值使用，是 tsc 錯誤而不是保護；
//  而且三個符號在本檔各已被引用 41／6／2 次，本來就不需要保護。整段移除。）
