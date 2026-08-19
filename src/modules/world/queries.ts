// modules/world/queries.ts
// WorldQuery（doc §4）在 Slice + 窄化 Definition Reader 上的純函式實作。
//
// WorldQuery 是全專案消費者最多的 Port（map／team／dungeon 都吃它），所以這裡的規則很硬：
//   * 只讀傳入的 WorldState 快照與 WorldDefinitionReader，不碰任何全域。
//   * World 擁有的事實缺失（例如某個 Region 沒有控制國）是**壞狀態**，明確拋錯——不回原生國、
//     不回第一個國家。doc §8 不變量 3 保證它一定存在，由 Bootstrap 建立。
//   * 別的模組擁有的 Runtime 實體（Map Instance）只能經注入 Port 取既存 ID；查不到就跳過該筆，
//     讓呼叫端看得見缺口（規範 §5 的 Query 側正解），World 絕不鑄造別人的 Runtime ID。
//   * 城市網路的走訪與排序完全由 Definition 決定，且與 JSON 列舉順序無關（doc §2.3／§8 不變量 4）。

import type {
  CityId,
  CultureId,
  JsonScalar,
  MapInstanceId,
  NationId,
  RegionId,
  RouteId,
  WorldFactId,
  AdventureSiteId,
} from '../../contracts/core';
import type {
  WorldState,
  WorldQuery,
  WorldDefinitionReader,
  ContentEventContext,
  EventWeightModifierView,
  EventWeightScope,
  MarketPressureView,
  MarketScope,
  RouteAccessView,
} from '../../contracts/world';
import type { WorldAdventureMapPort } from './system';
import {
  effectiveRouteAccess,
  listEventWeightModifierStates,
  listMarketPressureStates,
  otherEndOf,
  sameEventWeightScope,
  sameMarketScope,
} from './state';

// ── 決定性排序小工具 ────────────────────────────────────────────────────────

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type RoutePath = readonly RouteId[];

// 先比長度（Route 數＝城市距離），再逐段比 RouteId：doc §2.3「相同距離有多條路時，依 RouteId
// 固定排序選擇；不得受 JSON 或檔案列舉順序影響」。
function comparePaths(a: RoutePath, b: RoutePath): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i += 1) {
    const c = compareIds(String(a[i]), String(b[i]));
    if (c !== 0) return c;
  }
  return 0;
}

// 層同步 BFS：每層先算出該層所有候選路徑，同層同城取「RouteId 序列」最小者。因此結果只取決於
// Definition 內容，與走訪起點外的任何順序無關（可重播）。
function shortestPathsFrom(
  definitions: WorldDefinitionReader,
  origin: CityId,
  maxHops?: number,
): ReadonlyMap<CityId, RoutePath> {
  const best = new Map<CityId, RoutePath>();
  best.set(origin, []);
  let frontier: readonly CityId[] = [origin];
  let hops = 0;

  while (frontier.length > 0 && (maxHops === undefined || hops < maxHops)) {
    const level = new Map<CityId, RoutePath>();
    for (const city of [...frontier].sort((a, b) => compareIds(String(a), String(b)))) {
      const basePath = best.get(city);
      if (basePath === undefined) continue;
      const routes = [...definitions.listRoutesFrom(city)].sort((a, b) =>
        compareIds(String(a.id), String(b.id)),
      );
      for (const route of routes) {
        // 停用的 Route 定義不屬於這個世界的城市網路。
        if (!route.enabled) continue;
        const other = otherEndOf(route, city);
        if (other === undefined) continue;
        if (best.has(other)) continue;
        const candidate: RoutePath = [...basePath, route.id];
        const held = level.get(other);
        if (held === undefined || comparePaths(candidate, held) < 0) level.set(other, candidate);
      }
    }
    const nextFrontier: CityId[] = [];
    for (const [city, path] of level) {
      best.set(city, path);
      nextFrontier.push(city);
    }
    frontier = nextFrontier;
    hops += 1;
  }

  return best;
}

// ── Query 工廠 ──────────────────────────────────────────────────────────────

export function createWorldQuery(
  state: WorldState,
  definitions: WorldDefinitionReader,
  maps: WorldAdventureMapPort,
): WorldQuery {
  function requireController(regionId: RegionId): NationId {
    const control = state.regionControl[regionId];
    if (control === undefined) {
      // doc §8 不變量 3：每個 Region 恰好有一個控制國。讀不到＝Bootstrap 或存檔壞了。
      throw new Error(`WorldQuery: region "${String(regionId)}" has no controller state`);
    }
    return control.controllerNationId;
  }

  return {
    // ── WorldDistanceQuery（doc §2.3）──────────────────────────────────────
    getCityGapCount(from: CityId, to: CityId): number | undefined {
      const path = shortestPathsFrom(definitions, from).get(to);
      return path === undefined ? undefined : path.length;
    },

    getShortestRoute(from: CityId, to: CityId): RouteId[] | undefined {
      const path = shortestPathsFrom(definitions, from).get(to);
      return path === undefined ? undefined : [...path];
    },

    // maxHops 為「最多幾條 Route」；含起點自身（距離 0）。負值視為無任何城市在範圍內。
    listCitiesWithinHops(originCityId: CityId, maxHops: number): CityId[] {
      if (maxHops < 0) return [];
      return [...shortestPathsFrom(definitions, originCityId, maxHops).keys()].sort((a, b) =>
        compareIds(String(a), String(b)),
      );
    },

    // 冒險地的 Map Instance 由 map 模組擁有；這裡只取既存 ID。還沒建立實例的冒險地跳過，
    // 呼叫端看到的清單就會少一筆（缺口可見），不會拿到 World 自造的 MapInstanceId。
    listAdventureMapsForCities(cityIds: CityId[]): MapInstanceId[] {
      const out: MapInstanceId[] = [];
      const seen = new Set<MapInstanceId>();
      for (const cityId of cityIds) {
        for (const siteId of definitions.getCityNode(cityId).adventureSiteIds) {
          const mapId = maps.getAdventureMapId(siteId);
          if (mapId === undefined) continue;
          if (seen.has(mapId)) continue;
          seen.add(mapId);
          out.push(mapId);
        }
      }
      return out;
    },

    // ── 歸屬（純 Definition）──────────────────────────────────────────────
    getRegionForCity(cityId: CityId): RegionId {
      return definitions.getCityNode(cityId).regionId;
    },

    getRegionForSite(siteId: AdventureSiteId): RegionId {
      return definitions.getAdventureSite(siteId).regionId;
    },

    getAccessCityForSite(siteId: AdventureSiteId): CityId {
      return definitions.getAdventureSite(siteId).accessCityId;
    },

    // ── 文化（doc §4 的固定判定）──────────────────────────────────────────
    // 物品與非人類怪物 → Region.nativeCultureId（占領不改）。
    getNativeCulture(regionId: RegionId): CultureId {
      return definitions.getRegion(regionId).nativeCultureId;
    },

    getControllerNation(regionId: RegionId): NationId {
      return requireController(regionId);
    },

    // 人類敵人 → 目前控制國對應的 Culture。
    getHumanEnemyCulture(regionId: RegionId): CultureId {
      return definitions.getNation(requireController(regionId)).cultureId;
    },

    // ── 通行 ──────────────────────────────────────────────────────────────
    getRouteAccess(routeId: RouteId): RouteAccessView {
      const route = definitions.getRoute(routeId);
      const access = effectiveRouteAccess(state, route);
      return {
        routeId,
        accessState: access.accessState,
        reason: access.reason,
        passagePolicyId: route.passagePolicyId,
      };
    },

    // ── 世界級修正 ────────────────────────────────────────────────────────
    listMarketPressures(scope: MarketScope): MarketPressureView[] {
      return listMarketPressureStates(state)
        .filter((entry) => sameMarketScope(entry.scope, scope))
        .map((entry) => ({
          pressureId: entry.pressureId,
          scope: entry.scope,
          modifierRuleId: entry.modifierRuleId,
          activeFromDay: entry.activeFromDay,
          activeToDay: entry.activeToDay,
        }));
    },

    listEventWeightModifiers(
      scope: EventWeightScope,
      context: ContentEventContext,
    ): EventWeightModifierView[] {
      return listEventWeightModifierStates(state)
        .filter((entry) => entry.context === context && sameEventWeightScope(entry.scope, scope))
        .map((entry) => ({
          modifierId: entry.modifierId,
          scope: entry.scope,
          context: entry.context,
          weightModifierRuleId: entry.weightModifierRuleId,
          activeFromDay: entry.activeFromDay,
          activeToDay: entry.activeToDay,
        }));
    },

    // 沒有 Runtime 筆數時回 Definition 的 defaultValue——那是**內容作者提供的預設**，
    // 不是程式補的值：換一份 Pack 就會跟著改。
    getWorldFact(factId: WorldFactId): JsonScalar {
      const entry = state.facts[factId];
      if (entry !== undefined) return entry.value;
      return definitions.getWorldFact(factId).defaultValue;
    },
  };
}
