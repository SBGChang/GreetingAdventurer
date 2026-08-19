// app/content/combat-sequence-reader.test.ts
// 證明 data-runtime → CombatSequenceDefinitionReader 的 adapter 路徑：
//   1. 單元層——由記憶體內 content pack 建 DefinitionRegistry → createCombatSequenceDefinitionReader，
//      四個 getter 各自投影正確；未知 id 與跨 kind 存取明確拋錯。
//   2. 模組層——把這個**真** reader 換進 combat-sequence 的 Handler Context 跑
//      StartCombatSequence：規則的 attackWeightScale、Challenge 的經驗預算、Skill 的
//      damage／fixedSupport 判定全部由 registry 供給，Start 的驗證仍通過。
//      證明 adapter 不只型別對得上，還真的能驅動 Handler。
//
// 尚無 content-pack JSON（整個 repo 零份），所以這裡的 definitions 是記憶體內的等價資料；
// 正式 pack 落地後只需把同樣的 kind 標在 JSON 上，不用改 reader。

import type { ContentPackId, DefinitionId } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import {
  FIXTURE,
  createFixtureContext,
  fixtureStartCommand,
} from '../../modules/combat-sequence/fixtures';
import {
  createInitialCombatSequenceState,
  handleStartCombatSequence,
} from '../../modules/combat-sequence/public';

import {
  COMBAT_SEQUENCE_DEFINITION_KINDS,
  createCombatSequenceDefinitionReader,
} from './combat-sequence-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PACK = 'pack:combat-sequence-bringup' as ContentPackId;

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

// 對齊 combat-sequence FIXTURE 的最小定義集（與 fixtures.createFixtureReader 同值）。
function combatSequenceDefinitions(): readonly ContentDefinition[] {
  return [
    def(FIXTURE.ruleId, COMBAT_SEQUENCE_DEFINITION_KINDS.rule, {
      combatPowerRuleId: FIXTURE.combatPowerRuleId,
      successChanceResolverId: FIXTURE.successChanceResolverId,
      successChanceParamsId: FIXTURE.successChanceParamsId,
      retryRelativePowerGapMaximum: 0.15,
      maxRetryCountPerChallenge: 1,
      retrySupplyPolicyId: FIXTURE.policyId,
      defenseMasteryRoutingRuleId: FIXTURE.defenseRoutingRuleId,
      attackWeightScale: 6,
      attackSkillAggregation: 'equalConfiguredAttackSkills',
      distributionRounding: 'largestRemainderStableId',
    }),
    def(FIXTURE.policyId, COMBAT_SEQUENCE_DEFINITION_KINDS.retrySupplyPolicy, {
      eligibleItemTagIds: [FIXTURE.potionTagId],
      selection: 'lowestValueThenStableId',
      quantityPerRetry: 1,
    }),
    def(FIXTURE.encounterGroupId, COMBAT_SEQUENCE_DEFINITION_KINDS.simplifiedCombatChallenge, {
      combatPowerRuleId: FIXTURE.combatPowerRuleId,
      combatPower: 100,
      sourceRevisionKey: FIXTURE.encounterSourceRevisionKey,
      attackExperienceBudget: 10,
      defenseExperienceBudget: 6,
    }),
    def(FIXTURE.skillBladeA, COMBAT_SEQUENCE_DEFINITION_KINDS.simplifiedCombatSkill, {
      masteryExperienceMode: 'damage',
      attackMasterySplits: [{ masteryId: FIXTURE.masteryBlade, ratio: 1 }],
    }),
    def(FIXTURE.skillBladeB, COMBAT_SEQUENCE_DEFINITION_KINDS.simplifiedCombatSkill, {
      masteryExperienceMode: 'damage',
      attackMasterySplits: [{ masteryId: FIXTURE.masteryBlade, ratio: 1 }],
    }),
    def(FIXTURE.skillChant, COMBAT_SEQUENCE_DEFINITION_KINDS.simplifiedCombatSkill, {
      masteryExperienceMode: 'fixedSupport',
      supportMasteryAwardRuleId: FIXTURE.chantAwardRuleId,
    }),
  ];
}

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-bringup',
  manifestHash: 'bringup',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'bringup' }],
};

function registry(): DefinitionRegistry {
  return createDefinitionRegistry(combatSequenceDefinitions(), IDENTITY);
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'getRule 由 registry 投影出領域定義（header + 全部規則欄位）',
    run: () => {
      const rule = createCombatSequenceDefinitionReader(registry()).getRule(FIXTURE.ruleId);
      assert(String(rule.id) === String(FIXTURE.ruleId), 'id 應為 registry 權威值');
      assert(rule.enabled === true, 'enabled 應取自 registry header');
      assert(rule.packId === PACK, 'packId 應取自 registry header');
      assert(
        rule.retryRelativePowerGapMaximum === 0.15,
        `retryRelativePowerGapMaximum（實得 ${rule.retryRelativePowerGapMaximum}）`,
      );
      assert(
        rule.maxRetryCountPerChallenge === 1,
        `maxRetryCountPerChallenge（實得 ${rule.maxRetryCountPerChallenge}）`,
      );
      assert(rule.attackWeightScale === 6, `attackWeightScale（實得 ${rule.attackWeightScale}）`);
      assert(
        String(rule.successChanceParamsId) === String(FIXTURE.successChanceParamsId),
        'successChanceParamsId 必須到得了 Handler，否則 kernel 沒有調校資料可讀',
      );
      assert(
        String(rule.retrySupplyPolicyId) === String(FIXTURE.policyId),
        'retrySupplyPolicyId 應取自 data',
      );
    },
  },
  {
    name: 'getRetrySupplyPolicy 投影補品政策（tag 清單、選法、每次數量）',
    run: () => {
      const policy = createCombatSequenceDefinitionReader(registry()).getRetrySupplyPolicy(
        FIXTURE.policyId,
      );
      assert(policy.selection === 'lowestValueThenStableId', `selection（實得 ${policy.selection}）`);
      assert(policy.quantityPerRetry === 1, `quantityPerRetry（實得 ${policy.quantityPerRetry}）`);
      assert(policy.eligibleItemTagIds.length === 1, `eligibleItemTagIds 應有 1 筆`);
      assert(
        String(policy.eligibleItemTagIds[0]) === String(FIXTURE.potionTagId),
        'eligibleItemTagIds 內容',
      );
    },
  },
  {
    name: 'getEncounterView 的 encounterGroupId 取自 registry 的 def.id（不信任 data 內的複本）',
    run: () => {
      const view = createCombatSequenceDefinitionReader(registry()).getEncounterView(
        FIXTURE.encounterGroupId,
      );
      assert(
        String(view.encounterGroupId) === String(FIXTURE.encounterGroupId),
        `encounterGroupId（實得 ${String(view.encounterGroupId)}）`,
      );
      assert(view.attackExperienceBudget === 10, `attackExperienceBudget（實得 ${view.attackExperienceBudget}）`);
      assert(view.defenseExperienceBudget === 6, `defenseExperienceBudget（實得 ${view.defenseExperienceBudget}）`);
      assert(view.combatPower === 100, `combatPower（實得 ${view.combatPower}）`);
      assert(
        String(view.combatPowerRuleId) === String(FIXTURE.combatPowerRuleId),
        'combatPowerRuleId 應與 Sequence 規則同一條公式',
      );
    },
  },
  {
    name: 'getSkillView 區分 damage 與 fixedSupport，skillId 取自 def.id',
    run: () => {
      const reader = createCombatSequenceDefinitionReader(registry());
      const damage = reader.getSkillView(FIXTURE.skillBladeA);
      assert(String(damage.skillId) === String(FIXTURE.skillBladeA), 'skillId 應為 def.id');
      assert(damage.masteryExperienceMode === 'damage', `實得 ${damage.masteryExperienceMode}`);
      assert(damage.attackMasterySplits?.length === 1, 'damage 技能必須帶 attackMasterySplits');
      assert(damage.supportMasteryAwardRuleId === undefined, 'damage 技能不得帶支援獎勵');
      const support = reader.getSkillView(FIXTURE.skillChant);
      assert(support.masteryExperienceMode === 'fixedSupport', `實得 ${support.masteryExperienceMode}`);
      assert(
        String(support.supportMasteryAwardRuleId) === String(FIXTURE.chantAwardRuleId),
        'fixedSupport 技能必須引用一筆 Support Mastery Award Rule',
      );
      assert(support.attackMasterySplits === undefined, 'fixedSupport 技能不納入攻擊分配');
    },
  },
  {
    name: '未知 id 明確拋錯（不靜默回 undefined、不回預設定義）',
    run: () => {
      const reader = createCombatSequenceDefinitionReader(registry());
      let threw = false;
      try {
        reader.getRule('definition:combat-sequence-rule:absent' as never);
      } catch {
        threw = true;
      }
      assert(threw, '未知 rule id 應拋錯');
      let skillThrew = false;
      try {
        reader.getSkillView('definition:skill:absent' as never);
      } catch {
        skillThrew = true;
      }
      assert(skillThrew, '未知 skill id 應拋錯');
    },
  },
  {
    name: '跨 kind 存取明確拋錯（rule reader 不得取到 retry-supply-policy 定義）',
    run: () => {
      const reader = createCombatSequenceDefinitionReader(registry());
      let threw = false;
      try {
        reader.getRule(FIXTURE.policyId as never);
      } catch {
        threw = true;
      }
      assert(threw, '跨 kind 存取應拋錯');
      let viewThrew = false;
      try {
        // skill 定義不屬 simplified-combat-challenge reader 的 ownedKinds。
        reader.getEncounterView(FIXTURE.skillBladeA as never);
      } catch {
        viewThrew = true;
      }
      assert(viewThrew, 'challenge reader 不得取到 skill 定義');
    },
  },
  {
    name: '模組層：真 reader 換進 Handler Context，StartCombatSequence 仍被接受',
    run: () => {
      const ctx = createFixtureContext({
        reader: createCombatSequenceDefinitionReader(registry()),
      });
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand(),
        ctx,
      );
      assert(outcome.ok, `Start 應被接受（實得 ${outcome.ok ? 'ok' : outcome.rejection.code}）`);
      if (!outcome.ok) return;
      const sequence = outcome.result.nextSlice.sequences[FIXTURE.sequenceId];
      assert(sequence !== undefined, 'Aggregate 應被建立');
      assert(sequence?.status === 'active', `status（實得 ${String(sequence?.status)}）`);
      assert(sequence?.challengeOrder.length === 5, '五個 Challenge 全部通過 Definition 交叉驗證');
    },
  },
  {
    name: '模組層：registry 的預算與 Challenge 快照不符時 Start 拒絕（reader 真的被讀）',
    run: () => {
      const mutated = combatSequenceDefinitions().map((d) =>
        d.kind === COMBAT_SEQUENCE_DEFINITION_KINDS.simplifiedCombatChallenge
          ? {
              ...d,
              data: {
                ...(d.data as Record<string, unknown>),
                attackExperienceBudget: 99,
              } as ContentDefinition['data'],
            }
          : d,
      );
      const ctx = createFixtureContext({
        reader: createCombatSequenceDefinitionReader(createDefinitionRegistry(mutated, IDENTITY)),
      });
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand(),
        ctx,
      );
      assert(!outcome.ok, 'Start 應被拒絕');
      if (outcome.ok) return;
      assert(
        outcome.rejection.code === 'combat-sequence.start.challengeDefinitionMismatch',
        `拒絕碼（實得 ${outcome.rejection.code}）`,
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
    throw new Error(
      `combat-sequence-reader tests failed (${failed.length}/${results.length}):\n${lines}`,
    );
  }
}
