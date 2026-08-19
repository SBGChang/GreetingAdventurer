// app/content/city-reader.ts
// CityDefinitionReader 的真實實作：由 data-runtime 的 DefinitionRegistry 組出來
// （樣板：dungeon-reader.ts —— 一個 kind 家族一個窄化 Reader，領域 getter 委派到對應的 `.get(id)`）。

import type { CityId } from '../../contracts/core';
import type {
  CityDefinition,
  CityDefinitionReader,
  FacilityDefinition,
  ShopRuleDefinition,
  IntelRuleDefinition,
  EscortGenerationRuleDefinition,
  HomeRuleDefinition,
  HomeUpgradeDefinition,
  CityActionRuleDefinition,
  PopulationSupplyRuleDefinition,
  PlayerCommerceDailyLimitDefinition,
  PlayerCommercePracticeRuleDefinition,
} from '../../contracts/city';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名（內容作者以此標注每筆 definition 的 kind 欄位）。
export const CITY_DEFINITION_KINDS = {
  city: 'city',
  facility: 'facility',
  shopRule: 'shop-rule',
  intelRule: 'intel-rule',
  escortGenerationRule: 'escort-generation-rule',
  homeRule: 'home-rule',
  homeUpgrade: 'home-upgrade',
  cityActionRule: 'city-action-rule',
  populationSupplyRule: 'population-supply-rule',
  playerCommerceDailyLimit: 'player-commerce-daily-limit',
  playerCommercePracticeRule: 'player-commerce-practice-rule',
} as const;

export function createCityDefinitionReader(registry: DefinitionRegistry): CityDefinitionReader {
  const city = narrowedDomainReader<CityDefinition>(registry, 'reader:city.city', [
    CITY_DEFINITION_KINDS.city,
  ]);
  const facility = narrowedDomainReader<FacilityDefinition>(registry, 'reader:city.facility', [
    CITY_DEFINITION_KINDS.facility,
  ]);
  const shopRule = narrowedDomainReader<ShopRuleDefinition>(registry, 'reader:city.shop-rule', [
    CITY_DEFINITION_KINDS.shopRule,
  ]);
  const intelRule = narrowedDomainReader<IntelRuleDefinition>(registry, 'reader:city.intel-rule', [
    CITY_DEFINITION_KINDS.intelRule,
  ]);
  const escortRule = narrowedDomainReader<EscortGenerationRuleDefinition>(
    registry,
    'reader:city.escort-generation-rule',
    [CITY_DEFINITION_KINDS.escortGenerationRule],
  );
  const homeRule = narrowedDomainReader<HomeRuleDefinition>(registry, 'reader:city.home-rule', [
    CITY_DEFINITION_KINDS.homeRule,
  ]);
  const homeUpgrade = narrowedDomainReader<HomeUpgradeDefinition>(
    registry,
    'reader:city.home-upgrade',
    [CITY_DEFINITION_KINDS.homeUpgrade],
  );
  const cityActionRule = narrowedDomainReader<CityActionRuleDefinition>(
    registry,
    'reader:city.city-action-rule',
    [CITY_DEFINITION_KINDS.cityActionRule],
  );
  const populationRule = narrowedDomainReader<PopulationSupplyRuleDefinition>(
    registry,
    'reader:city.population-supply-rule',
    [CITY_DEFINITION_KINDS.populationSupplyRule],
  );
  const commerceLimit = narrowedDomainReader<PlayerCommerceDailyLimitDefinition>(
    registry,
    'reader:city.player-commerce-daily-limit',
    [CITY_DEFINITION_KINDS.playerCommerceDailyLimit],
  );
  const commercePractice = narrowedDomainReader<PlayerCommercePracticeRuleDefinition>(
    registry,
    'reader:city.player-commerce-practice-rule',
    [CITY_DEFINITION_KINDS.playerCommercePracticeRule],
  );

  // `getCity` 以 **worldCityId** 定址（契約簽章是 `getCity(id: CityId)`），而 Registry 以 definition id
  // 定址；兩者不必相同（CityDefinition 同時帶自己的 id 與 worldCityId）。因此在此建一次索引。
  // 同一個 worldCityId 出現兩次是壞內容 —— 在建立 Reader 的當下（也就是 Bootstrap）就失敗，
  // 不留到查詢時才發現（規範五個合法出口的第一項）。
  const cityByWorldId = new Map<string, CityDefinition>();
  for (const definition of city.list()) {
    const key = String(definition.worldCityId);
    if (cityByWorldId.has(key)) {
      throw new Error(
        `city reader: duplicate CityDefinition for worldCityId "${key}" ` +
          `("${String(cityByWorldId.get(key)?.id)}" 與 "${String(definition.id)}")`,
      );
    }
    cityByWorldId.set(key, definition);
  }

  return {
    getCity: (id: CityId) => {
      const found = cityByWorldId.get(String(id));
      if (found === undefined) {
        throw new Error(`city reader: no CityDefinition for worldCityId "${String(id)}"`);
      }
      return found;
    },
    getFacility: (id) => facility.get(id),
    getShopRule: (id) => shopRule.get(id),
    getIntelRule: (id) => intelRule.get(id),
    getEscortGenerationRule: (id) => escortRule.get(id),
    getHomeRule: (id) => homeRule.get(id),
    getHomeUpgrade: (id) => homeUpgrade.get(id),
    getCityActionRule: (id) => cityActionRule.get(id),
    getPopulationSupplyRule: (id) => populationRule.get(id),
    getPlayerCommerceDailyLimit: (id) => commerceLimit.get(id),
    getPlayerCommercePracticeRule: (id) => commercePractice.get(id),
  };
}
