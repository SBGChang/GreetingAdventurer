// modules/progression/fixtures.ts
// 最小 Fixture：一個假 ProgressionDefinitionReader + 若干 Mastery/Curve/Rule，
// 供單元測試與快速手動驗證使用。純資料，無 I/O。

import type {
  ContentPackId,
  MasteryId,
  MasteryCurveId,
  ExperienceAwardRuleId,
  CharacterId,
  GatheringResolutionId,
} from '../../contracts/core';
import type {
  ProgressionDefinitionReader,
  MasteryDefinition,
  MasteryCurveDefinition,
  ExperienceAwardRuleDefinition,
  SocialMasteryBenefitDefinition,
} from '../../contracts/progression';
import type { GrantGatheringMasteryExperience } from '../../contracts/gathering';

const PACK = 'pack:progression-fixture' as ContentPackId;

// ── ID ──────────────────────────────────────────────────────────────────
export const SWORD_MASTERY = 'mastery:sword' as MasteryId;
export const ALCHEMY_MASTERY = 'mastery:alchemy' as MasteryId;
export const LINEAR_CURVE = 'mastery-curve:linear' as MasteryCurveId;
export const GATHER_RULE = 'experience-award-rule:gather-herb' as ExperienceAwardRuleId;
export const CRAFT_RULE = 'experience-award-rule:craft-potion' as ExperienceAwardRuleId;
export const HERO: CharacterId = 'runtime:character:hero' as CharacterId;
export const RESOLUTION_A = 'runtime:gathering-resolution:a' as GatheringResolutionId;

// ── Curve：Lv.0..Lv.10 累積門檻 ───────────────────────────────────────────
const LINEAR_THRESHOLDS: readonly number[] = [
  0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3250,
];

const linearCurve: MasteryCurveDefinition = {
  id: LINEAR_CURVE,
  schemaVersion: 1,
  packId: PACK,
  enabled: true,
  maxLevel: 10,
  cumulativeExperienceThresholds: LINEAR_THRESHOLDS,
};

// ── Mastery：sword 帶 muscle、alchemy 帶 intelligence；曲線後期較陡以測 clamp ──
const swordMastery: MasteryDefinition = {
  id: SWORD_MASTERY,
  schemaVersion: 1,
  packId: PACK,
  enabled: true,
  curveId: LINEAR_CURVE,
  // 各級 muscle 新增值（Lv.0..Lv.10 累加）；Lv.10 累計 = 120 → 觸發 clamp 100。
  primaryAttributeGainsByLevel: [
    { muscle: 2 },
    { muscle: 4 },
    { muscle: 6 },
    { muscle: 8 },
    { muscle: 10 },
    { muscle: 12 },
    { muscle: 14 },
    { muscle: 16 },
    { muscle: 18 },
    { muscle: 20 },
    { muscle: 10 },
  ],
  automaticKnowledgeUnlocks: [{ atLevel: 1, knowledgeId: 'skill:power-strike' as never }],
};

const alchemyMastery: MasteryDefinition = {
  id: ALCHEMY_MASTERY,
  schemaVersion: 1,
  packId: PACK,
  enabled: true,
  curveId: LINEAR_CURVE,
  primaryAttributeGainsByLevel: [
    { intelligence: 1 },
    { intelligence: 3 },
    { intelligence: 5 },
    { intelligence: 7 },
    { intelligence: 9 },
    { intelligence: 11 },
    { intelligence: 13 },
    { intelligence: 15 },
    { intelligence: 17 },
    { intelligence: 19 },
    { intelligence: 21 },
  ],
  automaticKnowledgeUnlocks: [],
};

// ── Experience Award Rule ─────────────────────────────────────────────────
const gatherRule: ExperienceAwardRuleDefinition = {
  id: GATHER_RULE,
  schemaVersion: 1,
  packId: PACK,
  enabled: true,
  masteryId: SWORD_MASTERY, // 採集示例仍指向一個受益 Mastery
  baseExperience: 150,
};

const craftRule: ExperienceAwardRuleDefinition = {
  id: CRAFT_RULE,
  schemaVersion: 1,
  packId: PACK,
  enabled: true,
  masteryId: ALCHEMY_MASTERY,
  baseExperience: 120,
};

const socialBenefit: SocialMasteryBenefitDefinition = {
  id: 'social-benefit:trade' as never,
  schemaVersion: 1,
  packId: PACK,
  enabled: true,
  masteryId: SWORD_MASTERY,
  personalTradeBonusGainsByLevel: [0.5, 0.5, 1, 1, 1.5, 1.5, 2, 3, 4, 5],
  inviteSuccessBonusGainsByLevel: [0.5, 0.5, 1, 1, 1.5, 1.5, 2, 2, 3, 3],
  memberDepartureResistanceGainsByLevel: [0.5, 0.5, 1, 1, 1.5, 1.5, 2, 2, 3, 3],
};

const masteries: Record<string, MasteryDefinition> = {
  [SWORD_MASTERY]: swordMastery,
  [ALCHEMY_MASTERY]: alchemyMastery,
};
const curves: Record<string, MasteryCurveDefinition> = { [LINEAR_CURVE]: linearCurve };
const awardRules: Record<string, ExperienceAwardRuleDefinition> = {
  [GATHER_RULE]: gatherRule,
  [CRAFT_RULE]: craftRule,
};

// ── 假 Reader：只實作測試會走到的方法；其餘拋出可定位錯誤 ─────────────────
export function makeFixtureReader(): ProgressionDefinitionReader {
  const notInFixture = (what: string): never => {
    throw new Error(`fixture reader: ${what} not provided`);
  };
  return {
    getMastery: (id) => masteries[id] ?? (notInFixture(`mastery ${id}`) as never),
    getMasteryCurve: (id) => curves[id] ?? (notInFixture(`curve ${id}`) as never),
    getExperienceAwardRule: (id) => awardRules[id] ?? (notInFixture(`award rule ${id}`) as never),
    listSocialMasteryBenefits: () => [socialBenefit],
    getSkill: (id) => notInFixture(`skill ${id}`) as never,
    getTeachingRule: (id) => notInFixture(`teaching rule ${id}`) as never,
    getAttackMasteryAwardRule: (id) => notInFixture(`attack rule ${id}`) as never,
    getDefenseMasteryRoutingRule: (id) => notInFixture(`defense routing ${id}`) as never,
    getSupportMasteryAwardRule: (id) => notInFixture(`support rule ${id}`) as never,
    getAgeExperienceRule: (id) => notInFixture(`age rule ${id}`) as never,
    getChildEducationRule: (id) => notInFixture(`child education ${id}`) as never,
  };
}

// 便利：一筆採集命令 fixture。
export function makeGatheringCommand(): GrantGatheringMasteryExperience {
  return {
    resolutionId: RESOLUTION_A,
    contributorCharacterId: HERO,
    masteryId: SWORD_MASTERY,
    experienceAwardRuleId: GATHER_RULE,
  };
}
