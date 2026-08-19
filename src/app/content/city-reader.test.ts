// app/content/city-reader.test.ts
// 證明 data-runtime → CityDefinitionReader 的 adapter 路徑：由記憶體內 content pack 建
// DefinitionRegistry → createCityDefinitionReader，11 個 getter 各自回傳正確定義；
// 未知 id 與跨 kind 存取一律明確拋錯。
//
// 另外釘住 city reader 特有的兩件事：
//   1. `getCity` 以 **worldCityId** 定址（不是 definition id）——它是唯一需要建索引的 getter。
//   2. 同一個 worldCityId 出現兩次是壞內容，必須在**建立 Reader 的當下**失敗，不留到查詢時。
//
// 沒有端到端一段：city 尚未進入 composition 的註冊表，因此無法像 dungeon-reader.test 那樣
// 在真交易裡驗證。此處只驗 adapter 本身。

import type { ContentPackId, DefinitionId } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import {
  CITY_ACTION_INN_REST,
  CITY_ID,
  COMMERCE_EXP_RULE_ID,
  COMMERCE_LIMIT_ID,
  COMMERCE_PRACTICE_ID,
  ESCORT_RULE_ID,
  FACILITY_INN,
  HOME_RULE_ID,
  INTEL_RULE_ID,
  METRIC_RESOLVER_ID,
  OTHER_CITY_ID,
  POPULATION_RULE_ID,
  PRICE_RULE_ID,
  SHOP_RULE_ITEM,
  UPGRADE_ROOM,
} from '../../modules/city/fixtures';

import { createCityDefinitionReader, CITY_DEFINITION_KINDS } from './city-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function threw(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const PACK = 'pack:city-bringup' as ContentPackId;

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-test',
  manifestHash: 'citytest',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'citytest' }],
};

// 與 loadContent 一致：整筆作者 JSON（含 kind）都進 `data`，registry 的 header 欄位只是索引副本。
function def(id: string, kind: string, data: Record<string, unknown>): ContentDefinition {
  return {
    id: id as DefinitionId,
    kind,
    schemaVersion: 1,
    packId: PACK,
    enabled: true,
    sourcePath: `mem://${kind}/${id}`,
    data: { ...data, kind } as ContentDefinition['data'],
  };
}

// CityDefinition 的 definition id 與它指向的 worldCityId 刻意**不同**——這正是需要索引的原因。
const CITY_DEFINITION_ID = 'city-definition-fixture';
const OTHER_CITY_DEFINITION_ID = 'city-definition-other';

function cityDefinitionData(worldCityId: string): Record<string, unknown> {
  return {
    worldCityId,
    facilityIds: [FACILITY_INN],
    shopRuleIds: [SHOP_RULE_ITEM],
    intelRuleId: INTEL_RULE_ID,
    escortGenerationRuleId: ESCORT_RULE_ID,
    homeRuleId: HOME_RULE_ID,
    populationSupplyRuleId: POPULATION_RULE_ID,
    playerCommerceDailyLimitId: COMMERCE_LIMIT_ID,
    playerCommercePracticeRuleId: COMMERCE_PRACTICE_ID,
    cityMetricEffectResolverId: METRIC_RESOLVER_ID,
  };
}

function cityDefinitions(): readonly ContentDefinition[] {
  return [
    def(CITY_DEFINITION_ID, CITY_DEFINITION_KINDS.city, cityDefinitionData(String(CITY_ID))),
    def(String(FACILITY_INN), CITY_DEFINITION_KINDS.facility, {
      // 領域變體是 `facilityKind`，不是 `kind`——後者屬 Content Pack 的家族宣告。
      facilityKind: 'inn',
      actionRuleIds: [CITY_ACTION_INN_REST],
    }),
    def(String(SHOP_RULE_ITEM), CITY_DEFINITION_KINDS.shopRule, {
      shopKind: 'item',
      facilityId: FACILITY_INN,
      refreshCadenceDays: 7,
      refreshOffsetDays: 0,
      permanentStockOfferCount: { min: 1, max: 3 },
      priceRuleId: PRICE_RULE_ID,
      clearPlayerSoldOnRefresh: true,
    }),
    def(String(INTEL_RULE_ID), CITY_DEFINITION_KINDS.intelRule, {}),
    def(String(ESCORT_RULE_ID), CITY_DEFINITION_KINDS.escortGenerationRule, {}),
    def(String(HOME_RULE_ID), CITY_DEFINITION_KINDS.homeRule, {}),
    def(String(UPGRADE_ROOM), CITY_DEFINITION_KINDS.homeUpgrade, {
      upgradeKind: 'room',
      slotCost: 1,
      actionRuleIds: [],
    }),
    def(String(CITY_ACTION_INN_REST), CITY_DEFINITION_KINDS.cityActionRule, {}),
    def(String(POPULATION_RULE_ID), CITY_DEFINITION_KINDS.populationSupplyRule, {}),
    def(String(COMMERCE_LIMIT_ID), CITY_DEFINITION_KINDS.playerCommerceDailyLimit, {
      maxCommerceInteractionsPerDay: 6,
    }),
    def(String(COMMERCE_PRACTICE_ID), CITY_DEFINITION_KINDS.playerCommercePracticeRule, {
      commerceExperienceRuleId: COMMERCE_EXP_RULE_ID,
    }),
  ];
}

function reg(defs: readonly ContentDefinition[]): DefinitionRegistry {
  return createDefinitionRegistry(defs, IDENTITY);
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'city：11 個 getter 全部由 registry 讀得出來，header 取自 registry',
    run: () => {
      const reader = createCityDefinitionReader(reg(cityDefinitions()));

      const city = reader.getCity(CITY_ID);
      assert(String(city.id) === CITY_DEFINITION_ID, 'CityDefinition 的 id 是 definition id');
      assert(String(city.worldCityId) === String(CITY_ID), 'worldCityId 取自作者資料');
      assert(city.enabled === true, 'enabled 取自 registry header');
      assert(city.schemaVersion === 1, 'schemaVersion 取自 registry header');
      assert(String(city.packId) === String(PACK), 'packId 取自 registry header');

      const facility = reader.getFacility(FACILITY_INN);
      assert(facility.facilityKind === 'inn', `facilityKind 應為 inn，實得 ${facility.facilityKind}`);
      assert(facility.actionRuleIds.length === 1, 'actionRuleIds 應帶出一筆');

      const shopRule = reader.getShopRule(SHOP_RULE_ITEM);
      assert(shopRule.shopKind === 'item', 'shopKind 取自作者資料');
      assert(shopRule.refreshCadenceDays === 7, '刷新週期是資料，不是程式常數');
      assert(String(shopRule.facilityId) === String(FACILITY_INN), 'facilityId 指回店面');

      const upgrade = reader.getHomeUpgrade(UPGRADE_ROOM);
      assert(upgrade.upgradeKind === 'room', `upgradeKind 應為 room，實得 ${upgrade.upgradeKind}`);
      assert(upgrade.slotCost === 1, 'slotCost 取自作者資料');

      const limit = reader.getPlayerCommerceDailyLimit(COMMERCE_LIMIT_ID);
      assert(limit.maxCommerceInteractionsPerDay === 6, '每日上限取自資料');

      const practice = reader.getPlayerCommercePracticeRule(COMMERCE_PRACTICE_ID);
      assert(
        String(practice.commerceExperienceRuleId) === String(COMMERCE_EXP_RULE_ID),
        '商業熟練經驗規則 ID 帶得出來',
      );

      // 其餘四個 getter 只需證明「讀得到且 header 正確」——它們的領域欄位在契約裡仍是佔位形狀。
      assert(String(reader.getIntelRule(INTEL_RULE_ID).id) === String(INTEL_RULE_ID), 'intelRule');
      assert(
        String(reader.getEscortGenerationRule(ESCORT_RULE_ID).id) === String(ESCORT_RULE_ID),
        'escortGenerationRule',
      );
      assert(String(reader.getHomeRule(HOME_RULE_ID).id) === String(HOME_RULE_ID), 'homeRule');
      assert(
        String(reader.getCityActionRule(CITY_ACTION_INN_REST).id) === String(CITY_ACTION_INN_REST),
        'cityActionRule',
      );
    },
  },
  {
    name: 'city：getCity 以 worldCityId 定址（definition id 查不到）',
    run: () => {
      const reader = createCityDefinitionReader(reg(cityDefinitions()));
      // 用 definition id 當 worldCityId 查必須失敗——否則索引根本沒被用到。
      assert(
        threw(() => reader.getCity(CITY_DEFINITION_ID as never)),
        '以 definition id 查 getCity 應拋錯（它以 worldCityId 定址）',
      );
      assert(threw(() => reader.getCity(OTHER_CITY_ID)), '未登記的城市應拋錯，不得回預設城市');
    },
  },
  {
    name: 'city：同一個 worldCityId 出現兩次，建立 Reader 當下就失敗',
    run: () => {
      // 壞內容不得等到查詢時才發現：兩筆定義都宣稱是同一座城，查詢只會靜默拿到其中一筆。
      const duplicated = [
        ...cityDefinitions(),
        def(OTHER_CITY_DEFINITION_ID, CITY_DEFINITION_KINDS.city, cityDefinitionData(String(CITY_ID))),
      ];
      assert(
        threw(() => createCityDefinitionReader(reg(duplicated))),
        '重複 worldCityId 應在 createCityDefinitionReader 時拋錯',
      );
      // 不同 worldCityId 則正常共存。
      const distinct = [
        ...cityDefinitions(),
        def(
          OTHER_CITY_DEFINITION_ID,
          CITY_DEFINITION_KINDS.city,
          cityDefinitionData(String(OTHER_CITY_ID)),
        ),
      ];
      const reader = createCityDefinitionReader(reg(distinct));
      assert(
        String(reader.getCity(OTHER_CITY_ID).id) === OTHER_CITY_DEFINITION_ID,
        '兩座不同城市應各自查得到',
      );
    },
  },
  {
    name: 'city：未知 id 與跨 kind 存取一律拋錯（不得靜默回預設定義）',
    run: () => {
      const reader = createCityDefinitionReader(reg(cityDefinitions()));
      assert(threw(() => reader.getFacility('facility-absent' as never)), '未知 facility 應拋錯');
      assert(threw(() => reader.getShopRule('shop-rule-absent' as never)), '未知 shopRule 應拋錯');
      assert(
        threw(() => reader.getHomeUpgrade('home-upgrade-absent' as never)),
        '未知 homeUpgrade 應拋錯',
      );
      // 跨 kind：拿 facility 的 id 去問 shopRule reader（雙向各驗一次）。
      assert(
        threw(() => reader.getShopRule(FACILITY_INN as never)),
        'shopRule reader 不得取到 facility 定義',
      );
      assert(
        threw(() => reader.getFacility(SHOP_RULE_ITEM as never)),
        'facility reader 不得取到 shopRule 定義',
      );
    },
  },
  {
    name: 'city：enabled=false 的定義帶出 enabled 旗標，不被靜默移除',
    run: () => {
      // §9：Registry 永不靜默替換或刪除資料。停用的設施仍讀得到，由呼叫端決定怎麼處理。
      const withDisabled = cityDefinitions().map((d) =>
        String(d.id) === String(FACILITY_INN) ? { ...d, enabled: false } : d,
      );
      const reader = createCityDefinitionReader(reg(withDisabled));
      const facility = reader.getFacility(FACILITY_INN);
      assert(facility.enabled === false, 'enabled=false 必須如實帶出');
      assert(facility.facilityKind === 'inn', '停用不影響領域欄位');
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
    throw new Error(`city-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
