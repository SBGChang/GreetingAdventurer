// app/content/progression-reader.ts
// ProgressionDefinitionReader 的真實實作（由 data-runtime Registry 組出）。
// 單純委派 + listSocialMasteryBenefits（無 id：用窄化 Reader 的 .list() 取整個 kind 家族）。

import type { DefinitionId } from '../../contracts/core';
import type {
  AgeExperienceRuleDefinition,
  AttackMasteryAwardRuleDefinition,
  ChildEducationRuleDefinition,
  DefenseMasteryRoutingRuleDefinition,
  ExperienceAwardRuleDefinition,
  MasteryCurveDefinition,
  MasteryDefinition,
  ProgressionDefinitionReader,
  SkillDefinition,
  SocialMasteryBenefitDefinition,
  SupportMasteryAwardRuleDefinition,
  TeachingRuleDefinition,
} from '../../contracts/progression';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

export const PROGRESSION_DEFINITION_KINDS = {
  mastery: 'mastery',
  masteryCurve: 'mastery-curve',
  skill: 'skill',
  teachingRule: 'teaching-rule',
  experienceAwardRule: 'experience-award-rule',
  socialMasteryBenefit: 'social-mastery-benefit',
  attackMasteryAwardRule: 'attack-mastery-award-rule',
  defenseMasteryRoutingRule: 'defense-mastery-routing-rule',
  supportMasteryAwardRule: 'support-mastery-award-rule',
  ageExperienceRule: 'age-experience-rule',
  childEducationRule: 'child-education-rule',
} as const;

export function createProgressionDefinitionReader(
  registry: DefinitionRegistry,
): ProgressionDefinitionReader {
  const mastery = narrowedDomainReader<MasteryDefinition>(registry, 'reader:progression.mastery', [
    PROGRESSION_DEFINITION_KINDS.mastery,
  ]);
  const masteryCurve = narrowedDomainReader<MasteryCurveDefinition>(registry, 'reader:progression.mastery-curve', [
    PROGRESSION_DEFINITION_KINDS.masteryCurve,
  ]);
  const skill = narrowedDomainReader<SkillDefinition>(registry, 'reader:progression.skill', [
    PROGRESSION_DEFINITION_KINDS.skill,
  ]);
  const teaching = narrowedDomainReader<TeachingRuleDefinition>(registry, 'reader:progression.teaching-rule', [
    PROGRESSION_DEFINITION_KINDS.teachingRule,
  ]);
  const experienceAward = narrowedDomainReader<ExperienceAwardRuleDefinition>(
    registry,
    'reader:progression.experience-award-rule',
    [PROGRESSION_DEFINITION_KINDS.experienceAwardRule],
  );
  const socialBenefit = narrowedDomainReader<SocialMasteryBenefitDefinition>(
    registry,
    'reader:progression.social-mastery-benefit',
    [PROGRESSION_DEFINITION_KINDS.socialMasteryBenefit],
  );
  const attackAward = narrowedDomainReader<AttackMasteryAwardRuleDefinition>(
    registry,
    'reader:progression.attack-mastery-award-rule',
    [PROGRESSION_DEFINITION_KINDS.attackMasteryAwardRule],
  );
  const defenseRouting = narrowedDomainReader<DefenseMasteryRoutingRuleDefinition>(
    registry,
    'reader:progression.defense-mastery-routing-rule',
    [PROGRESSION_DEFINITION_KINDS.defenseMasteryRoutingRule],
  );
  const supportAward = narrowedDomainReader<SupportMasteryAwardRuleDefinition>(
    registry,
    'reader:progression.support-mastery-award-rule',
    [PROGRESSION_DEFINITION_KINDS.supportMasteryAwardRule],
  );
  const ageExperience = narrowedDomainReader<AgeExperienceRuleDefinition>(
    registry,
    'reader:progression.age-experience-rule',
    [PROGRESSION_DEFINITION_KINDS.ageExperienceRule],
  );
  const childEducation = narrowedDomainReader<ChildEducationRuleDefinition>(
    registry,
    'reader:progression.child-education-rule',
    [PROGRESSION_DEFINITION_KINDS.childEducationRule],
  );

  return {
    getMastery: (id) => mastery.get(id),
    getMasteryCurve: (id) => masteryCurve.get(id),
    getSkill: (id) => skill.get(id),
    getTeachingRule: (id) => teaching.get(id),
    getExperienceAwardRule: (id) => experienceAward.get(id),
    listSocialMasteryBenefits: () => socialBenefit.list(),
    getAttackMasteryAwardRule: (id) => attackAward.get(id),
    getDefenseMasteryRoutingRule: (id) => defenseRouting.get(id),
    getSupportMasteryAwardRule: (id) => supportAward.get(id),
    getAgeExperienceRule: (id) => ageExperience.get(id),
    getChildEducationRule: (id) => childEducation.get(id),
  };
}
