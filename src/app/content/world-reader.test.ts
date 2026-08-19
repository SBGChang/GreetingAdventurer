// app/content/world-reader.test.ts
// 證明 data-runtime → WorldDefinitionReader 的 adapter 路徑：
//   1. 由記憶體內 content pack 建 DefinitionRegistry → createWorldDefinitionReader，
//      九個 getter 各自窄化到自己的 kind；未知 id / 跨 kind 存取明確拋錯。
//   2. listRoutesFrom 走內容宣告的 adjacentRouteIds，並排除停用的 Route 定義。
//   3. 真 Reader 能直接驅動 World 的 Query 與 Handler（不只型別對得上）：
//      最短路線平手排序、占領後的人類敵人文化、SetWorldFact 的 valueKind 驗證。
//
// 內容 JSON 落地後只要 kind 欄位對上 WORLD_DEFINITION_KINDS，這條路徑就直接可用。

import type { ContentPackId, DefinitionId, WorldDay } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import {
  ADVENTURE_SITES,
  CITY_A,
  CITY_D,
  CITY_ISLAND,
  CITY_NODES,
  CONFLICT_RULE,
  CONFLICT_RULES,
  CULTURES,
  CULTURE_ALPHA,
  CULTURE_BETA,
  FACT_BORDER_SEALED,
  FACT_SOURCE_QUEST,
  FACT_TAX_LEVEL,
  NATIONS,
  NATION_ALPHA,
  NATION_BETA,
  PASSAGE_POLICIES,
  POLICY_BETA,
  QUEST_SOURCE,
  REGIONS,
  REGION_SOUTH,
  ROUTES,
  ROUTE_AB_1,
  ROUTE_AC,
  ROUTE_BD,
  SITE_NORTH,
  WORLD_DAY,
  WORLD_FACTS,
  fixtureWorldState,
  makeIdAllocator,
  stubAdventureMapPort,
  stubConflictResolver,
} from '../../modules/world/fixtures';
import {
  createWorldQuery,
  handleChangeRegionControl,
  handleSetWorldFact,
} from '../../modules/world/public';

import { createWorldDefinitionReader, WORLD_DEFINITION_KINDS } from './world-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PACK = 'pack:world-bringup' as ContentPackId;

type Headed = Readonly<{ id: string; enabled: boolean; schemaVersion: number }>;

function def(kind: string, definition: Headed): ContentDefinition {
  return {
    id: definition.id as DefinitionId,
    kind,
    schemaVersion: definition.schemaVersion,
    packId: PACK,
    enabled: definition.enabled,
    sourcePath: `mem://${kind}/${definition.id}`,
    data: definition as unknown as ContentDefinition['data'],
  };
}

function worldDefinitions(): readonly ContentDefinition[] {
  return [
    ...[...CULTURES].map((d) => def(WORLD_DEFINITION_KINDS.culture, d)),
    ...[...REGIONS].map((d) => def(WORLD_DEFINITION_KINDS.region, d)),
    ...[...CITY_NODES].map((d) => def(WORLD_DEFINITION_KINDS.cityNode, d)),
    ...[...ADVENTURE_SITES].map((d) => def(WORLD_DEFINITION_KINDS.adventureSite, d)),
    ...[...ROUTES].map((d) => def(WORLD_DEFINITION_KINDS.route, d)),
    ...[...CONFLICT_RULES].map((d) => def(WORLD_DEFINITION_KINDS.conflictRule, d)),
    ...[...PASSAGE_POLICIES].map((d) => def(WORLD_DEFINITION_KINDS.passagePolicy, d)),
    ...[...WORLD_FACTS].map((d) => def(WORLD_DEFINITION_KINDS.worldFact, d)),
    // Nation 刻意放最後：Reader 的 getter 不依賴任何列舉順序。
    ...[...NATIONS].map((d) => def(WORLD_DEFINITION_KINDS.nation, d)),
  ];
}

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-bringup',
  manifestHash: 'bringup',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'bringup' }],
};

function registry(): DefinitionRegistry {
  return createDefinitionRegistry(worldDefinitions(), IDENTITY);
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: '九個 getter 各自由 registry 投影出領域定義（header 取自 registry，領域欄位取自 data）',
    run: () => {
      const reader = createWorldDefinitionReader(registry());

      const nation = reader.getNation(NATION_ALPHA);
      assert(String(nation.id) === String(NATION_ALPHA), 'nation.id 應為 registry 權威值');
      assert(nation.enabled === true, 'enabled 應取自 registry header');
      assert(nation.cultureId === CULTURE_ALPHA, 'nation.cultureId 應取自 data');
      assert(nation.display.nameRef.key.length > 0, 'display 應原樣帶回');

      assert(reader.getCulture(CULTURE_BETA).itemPoolIds.length === 0, 'culture 池應原樣帶回');

      const region = reader.getRegion(REGION_SOUTH);
      assert(region.nativeCultureId === CULTURE_BETA, 'region 原生文化');
      assert(region.cityIds.length === 3, 'region 城市清單');

      const city = reader.getCityNode(CITY_A);
      assert(city.isCapital, 'city 首都旗標');
      assert(city.adjacentRouteIds.length === 4, 'city 鄰接路線');

      const site = reader.getAdventureSite(SITE_NORTH);
      assert(site.accessCityId === CITY_A, 'site 入口城市');
      assert(site.isNationalDungeon, 'site 國家迷宮旗標');

      const route = reader.getRoute(ROUTE_AC);
      assert(route.passagePolicyId === POLICY_BETA, 'route 通行政策');
      assert(route.enabledByDefault, 'route 預設開放');

      const rule = reader.getConflictRule(CONFLICT_RULE);
      assert(rule.checkCadenceDays > 0, 'conflict rule cadence');
      assert(rule.marketPressureEffectIds.length === 0, 'conflict rule effect 清單原樣帶回');

      assert(String(reader.getPassagePolicy(POLICY_BETA).requirementResolverId).length > 0, 'passage policy resolver');

      const fact = reader.getWorldFact(FACT_TAX_LEVEL);
      assert(fact.valueKind === 'number', 'fact valueKind');
      assert(fact.defaultValue === 1, 'fact defaultValue');
      assert(fact.allowedSourceKinds.length === 1, 'fact allowedSourceKinds');
    },
  },
  {
    name: '停用定義的 enabled 由 registry 帶出 false（World Handler 靠它拒絕）',
    run: () => {
      const reader = createWorldDefinitionReader(registry());
      assert(reader.getConflictRule(CONFLICT_RULES[1]!.id).enabled === false, '停用的 conflict rule 應為 false');
      assert(reader.getRoute(ROUTES[6]!.id).enabled === false, '停用的 route 應為 false');
    },
  },
  {
    name: 'listRoutesFrom 走內容宣告的 adjacentRouteIds，並排除停用的 Route 定義',
    run: () => {
      const reader = createWorldDefinitionReader(registry());
      const fromA = reader.listRoutesFrom(CITY_A).map((r) => String(r.id));
      // city-a 宣告 4 條，其中 route-disabled 的定義是停用的 → 只剩 3 條。
      assert(fromA.length === 3, `city-a 應有 3 條有效路線（實得 ${fromA.join(',')}）`);
      assert(!fromA.includes('route-disabled'), '停用路線不得出現');
      assert(reader.listRoutesFrom(CITY_ISLAND).length === 0, 'city-island 只鄰接停用路線 → 空');
    },
  },
  {
    name: '未知 id 明確拋錯；跨 kind 存取明確拋錯（不靜默回 undefined）',
    run: () => {
      const reader = createWorldDefinitionReader(registry());
      let unknownThrew = false;
      try {
        reader.getNation('nation-absent' as never);
      } catch {
        unknownThrew = true;
      }
      assert(unknownThrew, '未知 id 應拋錯');

      let crossKindThrew = false;
      try {
        // city-a 的 kind 是 city-node，不屬 nation reader 的 ownedKinds。
        reader.getNation(CITY_A as never);
      } catch {
        crossKindThrew = true;
      }
      assert(crossKindThrew, '跨 kind 存取應拋錯');
    },
  },
  {
    name: '真 Reader 驅動 WorldQuery：最短路線平手依 RouteId 排序、占領後人類敵人文化改變',
    run: () => {
      const reader = createWorldDefinitionReader(registry());
      const state = fixtureWorldState();
      const query = createWorldQuery(state, reader, stubAdventureMapPort());

      const path = query.getShortestRoute(CITY_A, CITY_D);
      assert(path !== undefined && path.length === 2, 'a→d 應為兩段');
      assert(
        path![0] === ROUTE_AB_1 && path![1] === ROUTE_BD,
        `平手應依 RouteId 序列取最小（實得 ${path!.map(String).join(',')}）`,
      );
      assert(query.getCityGapCount(CITY_A, CITY_ISLAND) === undefined, '停用路線不構成連通');
      assert(query.getHumanEnemyCulture(REGION_SOUTH) === CULTURE_BETA, '開局人類敵人文化＝原生國文化');

      const occupied = handleChangeRegionControl(
        { type: 'ChangeRegionControl', regionId: REGION_SOUTH, newNationId: NATION_ALPHA, sourceId: QUEST_SOURCE },
        state,
        { worldDay: WORLD_DAY, definitions: reader, ids: makeIdAllocator(), conflicts: stubConflictResolver() },
      );
      assert(occupied.ok, '占領命令應被接受');
      if (!occupied.ok) return;
      const after = createWorldQuery(occupied.result.nextSlice, reader, stubAdventureMapPort());
      assert(after.getHumanEnemyCulture(REGION_SOUTH) === CULTURE_ALPHA, '占領後人類敵人文化應為占領國文化');
      assert(after.getNativeCulture(REGION_SOUTH) === CULTURE_BETA, '原生文化不得因占領改變');
      assert(after.getControllerNation(REGION_SOUTH) === NATION_ALPHA, '控制國應為占領國');
      assert(String(NATION_BETA).length > 0, 'beta 常數存在（供對照）');
    },
  },
  {
    name: '真 Reader 驅動 SetWorldFact：valueKind 與 defaultValue 都來自內容',
    run: () => {
      const reader = createWorldDefinitionReader(registry());
      const ctx = {
        worldDay: WORLD_DAY,
        definitions: reader,
        ids: makeIdAllocator(),
        conflicts: stubConflictResolver(),
      };
      const ok = handleSetWorldFact(
        { type: 'SetWorldFact', factId: FACT_BORDER_SEALED, value: true, sourceId: QUEST_SOURCE, sourceKind: FACT_SOURCE_QUEST },
        fixtureWorldState(),
        ctx,
      );
      assert(ok.ok, 'boolean fact 應被接受');
      if (ok.ok) {
        const query = createWorldQuery(ok.result.nextSlice, reader, stubAdventureMapPort());
        assert(query.getWorldFact(FACT_BORDER_SEALED) === true, 'Runtime 值應可讀回');
        assert(query.getWorldFact(FACT_TAX_LEVEL) === 1, '未設定的 fact 回內容 defaultValue');
      }

      const bad = handleSetWorldFact(
        { type: 'SetWorldFact', factId: FACT_BORDER_SEALED, value: 3, sourceId: QUEST_SOURCE, sourceKind: FACT_SOURCE_QUEST },
        fixtureWorldState(),
        ctx,
      );
      assert(!bad.ok, '型別不符應被拒絕');
      if (!bad.ok) {
        assert(
          bad.rejection.code === 'world/fact-value-kind-mismatch',
          `拒絕碼應為 value-kind-mismatch（實得 ${bad.rejection.code}）`,
        );
      }
    },
  },
  {
    name: '世界日只從 ctx 讀：同一份 State 與 Reader 換世界日只影響 changedOnDay',
    run: () => {
      const reader = createWorldDefinitionReader(registry());
      const command = {
        type: 'SetWorldFact' as const,
        factId: FACT_BORDER_SEALED,
        value: true,
        sourceId: QUEST_SOURCE,
        sourceKind: FACT_SOURCE_QUEST,
      };
      const day = (WORLD_DAY + 5) as WorldDay;
      const res = handleSetWorldFact(command, fixtureWorldState(), {
        worldDay: day,
        definitions: reader,
        ids: makeIdAllocator(),
        conflicts: stubConflictResolver(),
      });
      assert(res.ok, '應被接受');
      if (!res.ok) return;
      assert(res.result.nextSlice.facts[FACT_BORDER_SEALED]!.changedOnDay === day, 'changedOnDay 應取自 ctx.worldDay');
      assert(res.result.kernelRequests === undefined, 'World 不得請求 Kernel 推進世界日');
    },
  },
];

export function runTestResults(): readonly ReaderTestResult[] {
  return CASES.map((c) => {
    try {
      c.run();
      return { name: c.name, pass: true };
    } catch (e) {
      return { name: c.name, pass: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? ''}`).join('\n');
    throw new Error(`world-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
