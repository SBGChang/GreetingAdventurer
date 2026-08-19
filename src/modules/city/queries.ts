// modules/city/queries.ts
// City 自有 Query Port（CityQuery）在 Slice 快照上的純函式實作。
//
// 兩件事貫穿本檔：
//   1. **設施種類 → 設施 ID** 與 **shopKind → 店面** 都住在 Definition（CityDefinition.facilityIds、
//      ShopRuleDefinition.facilityId），所以 Query 需要窄化 Reader；City State 不保存第二份對照。
//   2. **防禦性讀取**：窄化 Reader 的 `.get()` 對未註冊 Definition 會拋。清單型 Query（listShopOffers、
//      listAvailableIntel）遇到壞引用時**跳過該筆**並讓呼叫端看得見缺口，不讓整個城市畫面炸掉；
//      單筆型 Query（getCity／getFacility／getOffer）沿用契約的非可選回傳，找不到就明確拋錯。

import type {
  CityId,
  CharacterId,
  TeamId,
  FacilityDefinitionId,
  ShopOfferId,
  WorldDay,
} from '../../contracts/core';
import type {
  CityState,
  CityQuery,
  CityView,
  FacilityKind,
  FacilityView,
  ShopKind,
  ShopOfferView,
  IntelLeadView,
  HomeView,
  PlayerDailyCommerceUsageView,
  CityDefinitionReader,
} from '../../contracts/city';
import {
  requireCity,
  tryGetCity,
  tryGetFacilityState,
  tryGetOffer,
  listOffers,
  listIntel,
  listHomes,
  usageCountFor,
} from './state';
import { findFacilityIdByKind, type CityTeamPort } from './system';

export function createCityQuery(
  state: CityState,
  definitions: CityDefinitionReader,
  team: CityTeamPort,
): CityQuery {
  // 該城市中某 shopKind 對應的店面集合（一種 shopKind 理論上可對多間店面）。
  const shopFacilityIds = (cityId: CityId, shopKind: ShopKind): ReadonlySet<FacilityDefinitionId> => {
    const out = new Set<FacilityDefinitionId>();
    const cityDefinition = definitions.getCity(cityId);
    for (const shopRuleId of cityDefinition.shopRuleIds) {
      const rule = definitions.getShopRule(shopRuleId);
      if (rule.shopKind === shopKind) out.add(rule.facilityId);
    }
    return out;
  };

  const isCharacterAtCity = (cityId: CityId, characterId: CharacterId): boolean =>
    [...team.listTeamsAtCity(cityId)].some((teamId) =>
      team.listFormalMembers(teamId).includes(characterId),
    );

  const facilityOpen = (cityId: CityId, kind: FacilityKind): boolean => {
    const city = tryGetCity(state, cityId);
    if (city === undefined) return false;
    const facilityId = findFacilityIdByKind(definitions, cityId, kind);
    if (facilityId === undefined) return false;
    return tryGetFacilityState(city, facilityId)?.availability === 'open';
  };

  return {
    getCity(cityId: CityId): CityView {
      const city = requireCity(state, cityId);
      return { cityId: city.cityId, prosperity: city.prosperity, safety: city.safety };
    },

    isFacilityAvailable(cityId: CityId, kind: FacilityKind): boolean {
      return facilityOpen(cityId, kind);
    },

    getFacility(cityId: CityId, kind: FacilityKind): FacilityView {
      const city = requireCity(state, cityId);
      const facilityId = findFacilityIdByKind(definitions, cityId, kind);
      const runtime = facilityId === undefined ? undefined : tryGetFacilityState(city, facilityId);
      if (facilityId === undefined || runtime === undefined) {
        throw new Error(
          `CityQuery: city "${String(cityId)}" has no facility of kind "${String(kind)}"`,
        );
      }
      return { facilityId, kind, availability: runtime.availability };
    },

    listShopOffers(cityId: CityId, shopKind: ShopKind): ShopOfferView[] {
      const facilityIds = shopFacilityIds(cityId, shopKind);
      return listOffers(state)
        .filter((o) => o.cityId === cityId && facilityIds.has(o.facilityId))
        .map((o) => ({
          offerId: o.offerId,
          cityId: o.cityId,
          itemId: o.itemId,
          source: o.source,
          state: o.state,
        }));
    },

    getOffer(offerId: ShopOfferId): ShopOfferView {
      const offer = tryGetOffer(state, offerId);
      if (offer === undefined) {
        throw new Error(`CityQuery: unknown shop offer "${String(offerId)}"`);
      }
      return {
        offerId: offer.offerId,
        cityId: offer.cityId,
        itemId: offer.itemId,
        source: offer.source,
        state: offer.state,
      };
    },

    // 「這支隊伍在這座城市還能打聽的情報」：來源尚未失效，且還沒對這支隊伍揭露過。
    listAvailableIntel(cityId: CityId, teamId: TeamId): IntelLeadView[] {
      return listIntel(state)
        .filter(
          (i) =>
            i.cityId === cityId && i.state !== 'obsolete' && !i.revealedToTeamIds.includes(teamId),
        )
        .map((i) => ({ intelId: i.intelId, cityId: i.cityId, kind: i.kind, state: i.state }));
    },

    canUseTavern(cityId: CityId, teamId: TeamId): boolean {
      if (!facilityOpen(cityId, 'tavern')) return false;
      return team.listTeamsAtCity(cityId).includes(teamId);
    },

    getPlayerCommerceUsage(
      cityId: CityId,
      playerCharacterId: CharacterId,
      worldDay: WorldDay,
    ): PlayerDailyCommerceUsageView {
      const cityDefinition = definitions.getCity(cityId);
      const limit = definitions.getPlayerCommerceDailyLimit(
        cityDefinition.playerCommerceDailyLimitId,
      );
      const used = usageCountFor(state, playerCharacterId, worldDay);
      return {
        playerCharacterId,
        worldDay,
        commerceInteractionCount: used,
        remainingCount: Math.max(limit.maxCommerceInteractionsPerDay - used, 0),
      };
    },

    getHome(cityId: CityId, ownerId: CharacterId): HomeView | undefined {
      const home = listHomes(state).find(
        (h) => h.cityId === cityId && h.ownerCharacterId === ownerId && h.state !== 'transferred',
      );
      if (home === undefined) return undefined;
      return {
        homeId: home.homeId,
        cityId: home.cityId,
        ownerCharacterId: home.ownerCharacterId,
        slotCapacity: home.slotCapacity,
      };
    },

    // doc §4：第一版基礎餐點入口由 inn 提供；角色必須實際位於該城。
    canUseRestaurant(cityId: CityId, characterId: CharacterId): boolean {
      if (!facilityOpen(cityId, 'inn')) return false;
      return isCharacterAtCity(cityId, characterId);
    },
  };
}
