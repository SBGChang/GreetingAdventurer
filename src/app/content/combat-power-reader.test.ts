// app/content/combat-power-reader.test.ts
// data-runtime DefinitionRegistry → CombatPowerDefinitionReader 的 adapter 測試。
//
// 三件事要證明：
//   1. 三種**自有**規則（rule / feature-rule / feasibility-rule）投影出 header + 領域欄位。
//   2. 兩種**別人擁有**的 kind（skill / equipment-effect）經自訂 mapView 得到 combat-power 的窄化
//      View：以 skillId／equipmentEffectId 為鍵、並補上與 Calculator 同格式的 sourceRevisionKey。
//   3. 未知 id 與跨 kind 存取一律明確拋錯——缺內容不得靜默變成「這個東西沒有子項」。
//
// 另外釘住一件會被忽略的事：Feature 係數真的是從 registry 讀出來的，不是程式裡的常數。
// 同一組 Feature Rule ID、不同 pack 變體，reader 必須交出不同的 coefficient。

import type { ContentDefinition } from '../../data-runtime';
import { combatPowerDefinitionRevisionKey } from '../../domain-services/combat-power/public';
import {
  FIXTURE,
  combatPowerDefinitions,
  createFixtureRegistry,
  definition,
} from '../../domain-services/combat-power/fixtures';
import {
  COMBAT_POWER_DEFINITION_KINDS,
  COMBAT_POWER_OWNED_DEFINITION_KINDS,
  createCombatPowerDefinitionReader,
} from './combat-power-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectThrow(run: () => unknown, label: string): void {
  try {
    run();
  } catch {
    return;
  }
  throw new Error(`${label}：預期拋錯，但成功回傳了`);
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'getRule 投影 header + 領域欄位（含 feasibilityRuleId 與 Resolver 引用）',
    run: () => {
      const reader = createCombatPowerDefinitionReader(createFixtureRegistry());
      const rule = reader.getRule(FIXTURE.ruleId);
      assert(String(rule.id) === String(FIXTURE.ruleId), 'id 應為 registry 權威值');
      assert(rule.enabled === true, 'enabled 應取自 registry header');
      assert(rule.schemaVersion === 1, `schemaVersion（實得 ${rule.schemaVersion}）`);
      assert(String(rule.packId) === String(FIXTURE.packId), 'packId 應取自 registry header');
      assert(rule.featureRuleIds.length === 6, `featureRuleIds 應有 6 筆（實得 ${rule.featureRuleIds.length}）`);
      assert(
        String(rule.feasibilityRuleId) === String(FIXTURE.feasibilityRuleId),
        'feasibilityRuleId 應取自 data',
      );
      assert(
        String(rule.unitAggregationResolverId) === String(FIXTURE.resolverIds.unitAggregation),
        'unitAggregationResolverId 應取自 data',
      );
      assert(rule.teamAggregation === 'sumMembersThenFormation', 'teamAggregation 應取自 data');
      assert(rule.rounding === 'roundHalfUpAtFinalOutput', 'rounding 應取自 data');
      assert(rule.minimumPower === 1, `minimumPower（實得 ${rule.minimumPower}）`);
    },
  },
  {
    name: 'getFeatureRule：coefficient 來自 registry——換 pack 變體就換係數',
    run: () => {
      const muscleHeavy = createCombatPowerDefinitionReader(createFixtureRegistry('muscleHeavy'));
      const mindHeavy = createCombatPowerDefinitionReader(createFixtureRegistry('mindHeavy'));
      const a = muscleHeavy.getFeatureRule(FIXTURE.featureRuleIds.muscle);
      const b = mindHeavy.getFeatureRule(FIXTURE.featureRuleIds.muscle);
      assert(a.coefficient === 2, `muscleHeavy 的 muscle 係數應為 2（實得 ${a.coefficient}）`);
      assert(b.coefficient === 0.5, `mindHeavy 的 muscle 係數應為 0.5（實得 ${b.coefficient}）`);
      assert(String(a.id) === String(b.id), '兩份變體使用同一個 Feature Rule ID');
      assert(a.source.kind === 'primaryAttribute', `source.kind（實得 ${a.source.kind}）`);
    },
  },
  {
    name: 'getFeatureRule：五種 source kind 與選填 transformResolverId 都能投影',
    run: () => {
      const reader = createCombatPowerDefinitionReader(createFixtureRegistry());
      const health = reader.getFeatureRule(FIXTURE.featureRuleIds.health);
      assert(health.source.kind === 'maximumResource', 'health 應為 maximumResource');
      assert(
        String(health.transformResolverId) === String(FIXTURE.resolverIds.halveTransform),
        'transformResolverId 應取自 data',
      );
      const muscle = reader.getFeatureRule(FIXTURE.featureRuleIds.muscle);
      assert(muscle.transformResolverId === undefined, '沒有 transform 的 Feature 不應憑空出現一個');
      const healing = reader.getFeatureRule(FIXTURE.featureRuleIds.healing);
      assert(healing.source.kind === 'skillCapability', 'healing 應為 skillCapability');
      const ward = reader.getFeatureRule(FIXTURE.featureRuleIds.ward);
      assert(ward.source.kind === 'equipmentEffectCapability', 'ward 應為 equipmentEffectCapability');
      const attackPower = reader.getFeatureRule(FIXTURE.featureRuleIds.attackPower);
      assert(attackPower.source.kind === 'secondaryAttribute', 'attackPower 應為 secondaryAttribute');
    },
  },
  {
    name: 'getFeasibilityRule：門檻表與安全邊際全部來自 data',
    run: () => {
      const reader = createCombatPowerDefinitionReader(createFixtureRegistry());
      const feasibility = reader.getFeasibilityRule(FIXTURE.feasibilityRuleId);
      assert(
        String(feasibility.combatPowerRuleId) === String(FIXTURE.ruleId),
        'combatPowerRuleId 應取自 data',
      );
      assert(feasibility.riskBandThresholds.length === 5, '五段風險帶');
      assert(feasibility.minimumAttemptExpectedSuccess === 0.4, '安全邊際應為 0.4');
      assert(feasibility.opposingAggregation === 'sumEncounterGroups', 'opposingAggregation 應取自 data');
      const last = feasibility.riskBandThresholds[feasibility.riskBandThresholds.length - 1];
      if (last === undefined) throw new Error('門檻表不應為空');
      assert(last.maxExpectedSuccess === 1, '最後一段必須涵蓋 1');
    },
  },
  {
    name: 'getSkillView：skillId ← def.id，sourceRevisionKey 與 Calculator 同格式',
    run: () => {
      const reader = createCombatPowerDefinitionReader(createFixtureRegistry());
      const view = reader.getSkillView(FIXTURE.skillIds.arcane);
      assert(String(view.skillId) === String(FIXTURE.skillIds.arcane), 'skillId 應為 def.id');
      assert(view.skillTagIds.length === 2, `skillTagIds 應有 2 筆（實得 ${view.skillTagIds.length}）`);
      assert(view.weaponRequirementIds.length === 1, 'weaponRequirementIds 應有 1 筆');
      assert(view.capabilityContributions.length === 1, 'capabilityContributions 應有 1 筆');
      const contribution = view.capabilityContributions[0];
      if (contribution === undefined) throw new Error('capabilityContributions 應有內容');
      assert(contribution.baseValue === 5, `baseValue（實得 ${contribution.baseValue}）`);
      assert(
        String(contribution.scalingResolverId) === String(FIXTURE.resolverIds.capabilityScaling),
        'scalingResolverId 應取自 data',
      );
      assert(
        view.sourceRevisionKey ===
          combatPowerDefinitionRevisionKey({
            id: FIXTURE.skillIds.arcane,
            schemaVersion: 1,
            packId: FIXTURE.packId,
          }),
        `sourceRevisionKey 格式應與 Calculator 一致（實得 ${view.sourceRevisionKey}）`,
      );
      // 沒有額外 Capability 的技能使用空陣列，不用缺值代表錯誤（§7.4）。
      const slash = reader.getSkillView(FIXTURE.skillIds.slash);
      assert(slash.capabilityContributions.length === 0, 'slash 應有空的 capabilityContributions');
    },
  },
  {
    name: 'getEquipmentEffectView：equipmentEffectId ← def.id，觸發條件與 Tag 需求取自 data',
    run: () => {
      const reader = createCombatPowerDefinitionReader(createFixtureRegistry());
      const always = reader.getEquipmentEffectView(FIXTURE.equipmentEffectIds.wardAlways);
      assert(
        String(always.equipmentEffectId) === String(FIXTURE.equipmentEffectIds.wardAlways),
        'equipmentEffectId 應為 def.id',
      );
      assert(always.triggerEligibility === 'alwaysWhileEquipped', 'triggerEligibility 應取自 data');
      assert(always.requiredSkillTagIds.length === 0, 'alwaysWhileEquipped 不需要 Tag');
      const bound = reader.getEquipmentEffectView(FIXTURE.equipmentEffectIds.wardFireBound);
      assert(bound.triggerEligibility === 'configuredSkillCompatible', 'triggerEligibility 應取自 data');
      assert(bound.requiredSkillTagIds.length === 2, 'requiredSkillTagIds 應有 2 筆');
      assert(bound.sourceRevisionKey.includes(String(FIXTURE.packId)), 'sourceRevisionKey 應含 packId');
    },
  },
  {
    name: '未知 id 明確拋錯（不靜默回 undefined）',
    run: () => {
      const reader = createCombatPowerDefinitionReader(createFixtureRegistry());
      expectThrow(() => reader.getRule('definition:combat-power-rule:absent' as never), '未知 Rule');
      expectThrow(
        () => reader.getFeatureRule('definition:combat-power-feature-rule:absent' as never),
        '未知 Feature Rule',
      );
      expectThrow(() => reader.getSkillView('definition:skill:absent' as never), '未知 Skill');
      expectThrow(
        () => reader.getEquipmentEffectView('definition:equipment-effect:absent' as never),
        '未知 Equipment Effect',
      );
    },
  },
  {
    name: '跨 kind 存取明確拋錯（rule reader 不得取到 feature-rule／skill 定義）',
    run: () => {
      const reader = createCombatPowerDefinitionReader(createFixtureRegistry());
      expectThrow(() => reader.getRule(FIXTURE.featureRuleIds.muscle as never), 'rule ← feature-rule');
      expectThrow(() => reader.getRule(FIXTURE.skillIds.slash as never), 'rule ← skill');
      expectThrow(
        () => reader.getFeatureRule(FIXTURE.feasibilityRuleId as never),
        'feature-rule ← feasibility-rule',
      );
      expectThrow(
        () => reader.getSkillView(FIXTURE.equipmentEffectIds.wardAlways as never),
        'skill ← equipment-effect',
      );
    },
  },
  {
    name: 'enabled=false 的定義仍可由 id 取得，但 enabled 忠實反映 registry（呼叫端自行判斷）',
    run: () => {
      const disabled: ContentDefinition = {
        ...definition('definition:combat-power-rule:disabled', COMBAT_POWER_DEFINITION_KINDS.rule, {
          statisticsRuleId: FIXTURE.statisticsRuleId,
          featureRuleIds: [],
          feasibilityRuleId: FIXTURE.feasibilityRuleId,
          unitAggregationResolverId: FIXTURE.resolverIds.unitAggregation,
          teamFormationResolverId: FIXTURE.resolverIds.teamFormation,
          teamAggregation: 'sumMembersThenFormation',
          encounterAggregation: 'sumMembersThenFormation',
          minimumPower: 0,
          rounding: 'roundHalfUpAtFinalOutput',
        }),
        enabled: false,
      };
      const reader = createCombatPowerDefinitionReader(createFixtureRegistry('muscleHeavy', [disabled]));
      const rule = reader.getRule('definition:combat-power-rule:disabled' as never);
      assert(rule.enabled === false, 'enabled 應忠實為 false（reader 不代為過濾）');
    },
  },
  {
    name: 'kind 命名：自有 kind 三種；skill／equipment-effect 是讀別人的 kind（不宣告擁有）',
    run: () => {
      assert(COMBAT_POWER_OWNED_DEFINITION_KINDS.length === 3, '自有 kind 應為 3 種');
      assert(
        !COMBAT_POWER_OWNED_DEFINITION_KINDS.includes(COMBAT_POWER_DEFINITION_KINDS.skill),
        'skill 的擁有者不是 combat-power',
      );
      assert(
        !COMBAT_POWER_OWNED_DEFINITION_KINDS.includes(COMBAT_POWER_DEFINITION_KINDS.equipmentEffect),
        'equipment-effect 的擁有者不是 combat-power',
      );
      // fixture 的 kind 字串與 reader 的 kind 常數必須一致，否則整條讀取路徑是斷的。
      const kinds = new Set(combatPowerDefinitions().map((def) => def.kind));
      for (const kind of Object.values(COMBAT_POWER_DEFINITION_KINDS)) {
        assert(kinds.has(kind), `fixture 應含 kind=${kind} 的定義`);
      }
    },
  },
];

export function runTestResults(): readonly ReaderTestResult[] {
  return CASES.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, pass: true };
    } catch (error) {
      return {
        name: testCase.name,
        pass: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((result) => !result.pass);
  if (failed.length > 0) {
    const lines = failed.map((result) => `  - ${result.name}: ${result.error ?? ''}`).join('\n');
    throw new Error(`combat-power-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
