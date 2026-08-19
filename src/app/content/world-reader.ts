// app/content/world-reader.ts
// WorldDefinitionReader 的真實實作：由 data-runtime 的 DefinitionRegistry 組出來。
// 一個 kind 家族一個窄化 Reader，領域 getter 委派到對應的 `.get(id)`（樣板見 dungeon-reader.ts）。
//
// listRoutesFrom 走 CityNodeDefinition.adjacentRouteIds——鄰接是**內容宣告的**，不是掃全表推出來的。
// 停用（enabled: false）的 Route 定義不算在城市網路內，故過濾掉；引用到不存在的 RouteId 則由
// 窄化 Reader 拋錯（壞內容引用要在讀的當下就看得見，不是靜默少一條路）。

import type { CityId } from '../../contracts/core';
import type {
  AdventureSiteDefinition,
  CityNodeDefinition,
  ConflictRuleDefinition,
  CultureDefinition,
  NationDefinition,
  PassagePolicyDefinition,
  RegionDefinition,
  RouteDefinition,
  WorldDefinitionReader,
  WorldFactDefinition,
} from '../../contracts/world';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名（本專案定義；內容作者以此標注每筆 definition 的 kind 欄位）。
export const WORLD_DEFINITION_KINDS = {
  nation: 'nation',
  culture: 'culture',
  region: 'region',
  cityNode: 'city-node',
  adventureSite: 'adventure-site',
  route: 'route',
  conflictRule: 'conflict-rule',
  passagePolicy: 'passage-policy',
  worldFact: 'world-fact',
} as const;

export function createWorldDefinitionReader(registry: DefinitionRegistry): WorldDefinitionReader {
  const nation = narrowedDomainReader<NationDefinition>(registry, 'reader:world.nation', [
    WORLD_DEFINITION_KINDS.nation,
  ]);
  const culture = narrowedDomainReader<CultureDefinition>(registry, 'reader:world.culture', [
    WORLD_DEFINITION_KINDS.culture,
  ]);
  const region = narrowedDomainReader<RegionDefinition>(registry, 'reader:world.region', [
    WORLD_DEFINITION_KINDS.region,
  ]);
  const cityNode = narrowedDomainReader<CityNodeDefinition>(registry, 'reader:world.city-node', [
    WORLD_DEFINITION_KINDS.cityNode,
  ]);
  const adventureSite = narrowedDomainReader<AdventureSiteDefinition>(
    registry,
    'reader:world.adventure-site',
    [WORLD_DEFINITION_KINDS.adventureSite],
  );
  const route = narrowedDomainReader<RouteDefinition>(registry, 'reader:world.route', [
    WORLD_DEFINITION_KINDS.route,
  ]);
  const conflictRule = narrowedDomainReader<ConflictRuleDefinition>(
    registry,
    'reader:world.conflict-rule',
    [WORLD_DEFINITION_KINDS.conflictRule],
  );
  const passagePolicy = narrowedDomainReader<PassagePolicyDefinition>(
    registry,
    'reader:world.passage-policy',
    [WORLD_DEFINITION_KINDS.passagePolicy],
  );
  const worldFact = narrowedDomainReader<WorldFactDefinition>(registry, 'reader:world.world-fact', [
    WORLD_DEFINITION_KINDS.worldFact,
  ]);

  return {
    getNation: (id) => nation.get(id),
    getCulture: (id) => culture.get(id),
    getRegion: (id) => region.get(id),
    getCityNode: (id) => cityNode.get(id),
    getAdventureSite: (id) => adventureSite.get(id),
    getRoute: (id) => route.get(id),
    getConflictRule: (id) => conflictRule.get(id),
    getPassagePolicy: (id) => passagePolicy.get(id),
    getWorldFact: (id) => worldFact.get(id),
    listRoutesFrom: (cityId: CityId) =>
      cityNode
        .get(cityId)
        .adjacentRouteIds.map((routeId) => route.get(routeId))
        .filter((def) => def.enabled),
  };
}
