// app/content/statistics-reader.test.ts
// 證明 data-runtime → StatisticsDefinitionReader 的 adapter 路徑：
//   1. 單元層——由記憶體內 content pack 建 DefinitionRegistry → createStatisticsDefinitionReader，
//      五個 getter 各自窄化到自己的 kind；未知 id / 跨 kind 存取明確拋錯；manifest hash 由 Registry 供給。
//   2. 端到端——把這個**真** reader 換進 Calculator，算出的快照與 fixture stub reader 逐位相同。
//      這才證明 adapter 不只型別對，欄位真的接上了公式（少一個欄位就會算出不同的數字）。
//
// 樣板：dungeon-reader.test.ts。

import type { ContentPackId, DefinitionId } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import {
  BALANCE,
  FIXTURE,
  ageModifierRule,
  carryCapacityRule,
  gripRule,
  makeInput,
  secondaryRules,
  statisticsRule,
  stubDefinitionReader,
  stubResolverPort,
} from '../../domain-services/statistics/fixtures';
import { createCharacterStatisticsCalculator } from '../../domain-services/statistics/statistics';

import { STATISTICS_DEFINITION_KINDS, createStatisticsDefinitionReader } from './statistics-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PACK = 'pack:statistics-bringup' as ContentPackId;

function def(id: string, kind: string, data: Record<string, unknown>): ContentDefinition {
  return {
    id: id as DefinitionId,
    kind,
    schemaVersion: 1,
    packId: PACK,
    enabled: true,
    sourcePath: `mem://${kind}/${id}`,
    data: data as ContentDefinition['data'],
  };
}

// 每筆 definition 的 `data` 只帶領域欄位；header（id/schemaVersion/packId/enabled）以 Registry 為權威。
// 值一律取自 domain-services/statistics/fixtures 的同一份定義，讓端到端案例能逐位比對。
function statisticsDefinitions(): readonly ContentDefinition[] {
  const secondary = secondaryRules.map((rule) =>
    def(String(rule.id), STATISTICS_DEFINITION_KINDS.secondaryAttribute, {
      output: rule.output,
      primaryCoefficients: rule.primaryCoefficients,
      equipmentCoefficientChannelIds: rule.equipmentCoefficientChannelIds,
      ...(rule.masteryCoefficientResolverId === undefined
        ? {}
        : { masteryCoefficientResolverId: rule.masteryCoefficientResolverId }),
      finalResolverId: rule.finalResolverId,
    }),
  );

  return [
    def(String(statisticsRule.id), STATISTICS_DEFINITION_KINDS.statisticsRule, {
      primaryAttributeCap: statisticsRule.primaryAttributeCap,
      secondaryRuleIds: statisticsRule.secondaryRuleIds,
      maxHealthSecondaryId: statisticsRule.maxHealthSecondaryId,
      maxManaSecondaryId: statisticsRule.maxManaSecondaryId,
      gripRuleId: statisticsRule.gripRuleId,
      carryCapacityRuleId: statisticsRule.carryCapacityRuleId,
      ageModifierRuleId: statisticsRule.ageModifierRuleId,
      reputationContributionRuleId: statisticsRule.reputationContributionRuleId,
    }),
    def(String(gripRule.id), STATISTICS_DEFINITION_KINDS.gripRule, {
      singleHandMultiplier: gripRule.singleHandMultiplier,
      twoHandMultiplier: gripRule.twoHandMultiplier,
      dualWieldMainHandMultiplier: gripRule.dualWieldMainHandMultiplier,
      dualWieldOffHandMultiplier: gripRule.dualWieldOffHandMultiplier,
    }),
    def(String(carryCapacityRule.id), STATISTICS_DEFINITION_KINDS.carryCapacityRule, {
      baseWeightCapacity: carryCapacityRule.baseWeightCapacity,
      strengthCapacityPerPoint: carryCapacityRule.strengthCapacityPerPoint,
    }),
    def(String(ageModifierRule.id), STATISTICS_DEFINITION_KINDS.ageModifierRule, {
      resolverId: ageModifierRule.resolverId,
    }),
    ...secondary,
  ];
}

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-bringup',
  manifestHash: 'statistics-bringup-hash',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'bringup' }],
};

function registry(): DefinitionRegistry {
  return createDefinitionRegistry(statisticsDefinitions(), IDENTITY);
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'getStatisticsRule 由 registry 投影出領域定義（header + 領域欄位）',
    run: () => {
      const reader = createStatisticsDefinitionReader(registry());
      const rule = reader.getStatisticsRule(FIXTURE.statisticsRuleId);
      assert(String(rule.id) === String(FIXTURE.statisticsRuleId), 'id 應為 registry 權威值');
      assert(rule.enabled === true, 'enabled 應取自 registry header');
      assert(String(rule.packId) === String(PACK), 'packId 應取自 registry header');
      assert(rule.primaryAttributeCap === 100, `primaryAttributeCap（實得 ${rule.primaryAttributeCap}）`);
      assert(rule.secondaryRuleIds.length === 5, `secondaryRuleIds 應有 5 筆（實得 ${rule.secondaryRuleIds.length}）`);
      assert(
        String(rule.maxHealthSecondaryId) === String(FIXTURE.maxHealth),
        'maxHealthSecondaryId 應取自 data（生命上限對照是資料）',
      );
      assert(
        String(rule.carryCapacityRuleId) === String(FIXTURE.carryCapacityRuleId),
        'carryCapacityRuleId 應取自 data',
      );
    },
  },
  {
    name: 'getGripRule / getCarryCapacityRule / getAgeModifierRule 各自窄化到自己的 kind',
    run: () => {
      const reader = createStatisticsDefinitionReader(registry());
      const grip = reader.getGripRule(FIXTURE.gripRuleId);
      assert(
        grip.dualWieldMainHandMultiplier === BALANCE.dualWieldMainHandMultiplier,
        `雙持主手倍率（實得 ${grip.dualWieldMainHandMultiplier}）`,
      );
      assert(
        grip.dualWieldOffHandMultiplier === BALANCE.dualWieldOffHandMultiplier,
        `雙持副手倍率（實得 ${grip.dualWieldOffHandMultiplier}）`,
      );
      const carry = reader.getCarryCapacityRule(FIXTURE.carryCapacityRuleId);
      assert(
        carry.baseWeightCapacity === BALANCE.baseWeightCapacity,
        `baseWeightCapacity（實得 ${carry.baseWeightCapacity}）`,
      );
      const age = reader.getAgeModifierRule(FIXTURE.ageModifierRuleId);
      assert(String(age.resolverId) === String(FIXTURE.ageResolverId), 'age resolverId 應取自 data');
    },
  },
  {
    name: 'getSecondaryAttributeRule 投影 primaryCoefficients / 通道 / Resolver，且選填欄位缺席就是缺席',
    run: () => {
      const reader = createStatisticsDefinitionReader(registry());
      const physical = reader.getSecondaryAttributeRule(FIXTURE.physicalDamage);
      assert(physical.primaryCoefficients.muscle === 1, '物理傷害應引用肌力');
      assert(physical.primaryCoefficients.coordination === 1, '物理傷害應引用協調');
      assert(physical.primaryCoefficients.intelligence === undefined, '物理傷害不得引用智力');
      assert(
        physical.equipmentCoefficientChannelIds.length === 1,
        `物理傷害應有 1 條裝備通道（實得 ${physical.equipmentCoefficientChannelIds.length}）`,
      );
      assert(
        String(physical.masteryCoefficientResolverId) === String(FIXTURE.masteryResolverId),
        'masteryCoefficientResolverId 應取自 data',
      );

      const magic = reader.getSecondaryAttributeRule(FIXTURE.magicDamage);
      assert(
        magic.masteryCoefficientResolverId === undefined,
        '魔法傷害沒有熟練度階段：選填欄位應為 undefined，不得被投影成任何預設值',
      );

      const health = reader.getSecondaryAttributeRule(FIXTURE.maxHealth);
      assert(
        health.equipmentCoefficientChannelIds.length === 0,
        '生命上限沒有裝備通道（整條公式在 finalResolver 的 params）',
      );
    },
  },
  {
    name: '未知 id 明確拋錯（不靜默回 undefined）',
    run: () => {
      const reader = createStatisticsDefinitionReader(registry());
      let threw = false;
      try {
        reader.getStatisticsRule('definition:statistics-rule:absent' as never);
      } catch {
        threw = true;
      }
      assert(threw, '未知 id 應拋錯');
    },
  },
  {
    name: '跨 kind 存取明確拋錯（statistics-rule reader 不得取到 grip-rule 定義）',
    run: () => {
      const reader = createStatisticsDefinitionReader(registry());
      let threw = false;
      try {
        reader.getStatisticsRule(FIXTURE.gripRuleId as never);
      } catch {
        threw = true;
      }
      assert(threw, '跨 kind 存取應拋錯');

      let secondaryThrew = false;
      try {
        reader.getSecondaryAttributeRule(FIXTURE.carryCapacityRuleId as never);
      } catch {
        secondaryThrew = true;
      }
      assert(secondaryThrew, '副屬 reader 不得取到負重規則');
    },
  },
  {
    name: 'getDefinitionManifestHash 取自 Registry 的 Manifest 身分（sourceRevisionKey 的來源之一）',
    run: () => {
      const reader = createStatisticsDefinitionReader(registry());
      assert(
        reader.getDefinitionManifestHash() === IDENTITY.manifestHash,
        `manifest hash（實得 ${reader.getDefinitionManifestHash()}）`,
      );
      const key = createCharacterStatisticsCalculator({
        definitions: reader,
        resolvers: stubResolverPort(),
      }).calculate(makeInput()).sourceRevisionKey;
      assert(key.includes(IDENTITY.manifestHash), `sourceRevisionKey 應含 registry 的 hash（實得 ${key}）`);
    },
  },
  {
    name: '端到端：真 reader 換進 Calculator，快照與 fixture stub reader 逐位相同（欄位真的接上公式）',
    run: () => {
      const input = makeInput();
      const fromRealReader = createCharacterStatisticsCalculator({
        definitions: createStatisticsDefinitionReader(registry()),
        resolvers: stubResolverPort(),
      }).calculate(input);
      const fromStubReader = createCharacterStatisticsCalculator({
        definitions: stubDefinitionReader(),
        resolvers: stubResolverPort(),
      }).calculate(input);

      // sourceRevisionKey 含 manifest hash，兩者的 hash 來源不同，因此逐位比對其餘欄位。
      const strip = (snapshot: typeof fromRealReader) => ({
        ...snapshot,
        sourceRevisionKey: snapshot.sourceRevisionKey.replace(/manifest=[^|]*/, 'manifest=*'),
      });
      assert(
        JSON.stringify(strip(fromRealReader)) === JSON.stringify(strip(fromStubReader)),
        `真 reader 與 stub reader 的快照必須相同\n  real=${JSON.stringify(fromRealReader)}\n  stub=${JSON.stringify(fromStubReader)}`,
      );
      // 具體釘住幾個由 reader 供給的量，避免「兩邊都壞成一樣」也算通過。
      assert(
        fromRealReader.maxHealth === BALANCE.maxHealthBias + BALANCE.maxHealthPerMuscle * 40,
        `生命上限（實得 ${fromRealReader.maxHealth}）`,
      );
      assert(
        fromRealReader.carryingCapacity ===
          BALANCE.baseWeightCapacity + BALANCE.strengthCapacityPerPoint * 40,
        `負重上限（實得 ${fromRealReader.carryingCapacity}）`,
      );
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
    throw new Error(`statistics-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
