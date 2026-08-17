// app/content/team-reader.ts
// TeamDefinitionReader 的真實實作（由 data-runtime Registry 組出）。全部為單純委派。

import type { DefinitionId } from '../../contracts/core';
import type {
  FreeActionRuleDefinition,
  MemberRetentionRuleDefinition,
  NonPlayerMemberDailySocialPracticeRuleDefinition,
  NpcTravelRuleDefinition,
  PlayerTravelModeDefinition,
  RecentActivityRuleDefinition,
  RecruitmentRuleDefinition,
  TeamDefinitionReader,
  TeamFormationRuleDefinition,
  TeamPlanRuleDefinition,
} from '../../contracts/team';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

export const TEAM_DEFINITION_KINDS = {
  playerTravelMode: 'player-travel-mode',
  npcTravelRule: 'npc-travel-rule',
  freeActionRule: 'free-action-rule',
  teamPlanRule: 'team-plan-rule',
  recentActivityRule: 'recent-activity-rule',
  memberRetentionRule: 'member-retention-rule',
  recruitmentRule: 'recruitment-rule',
  teamFormationRule: 'team-formation-rule',
  nonPlayerMemberDailySocialPracticeRule: 'non-player-member-daily-social-practice-rule',
} as const;

export function createTeamDefinitionReader(registry: DefinitionRegistry): TeamDefinitionReader {
  const playerTravel = narrowedDomainReader<PlayerTravelModeDefinition>(
    registry,
    'reader:team.player-travel-mode',
    [TEAM_DEFINITION_KINDS.playerTravelMode],
  );
  const npcTravel = narrowedDomainReader<NpcTravelRuleDefinition>(registry, 'reader:team.npc-travel-rule', [
    TEAM_DEFINITION_KINDS.npcTravelRule,
  ]);
  const freeAction = narrowedDomainReader<FreeActionRuleDefinition>(registry, 'reader:team.free-action-rule', [
    TEAM_DEFINITION_KINDS.freeActionRule,
  ]);
  const teamPlan = narrowedDomainReader<TeamPlanRuleDefinition>(registry, 'reader:team.team-plan-rule', [
    TEAM_DEFINITION_KINDS.teamPlanRule,
  ]);
  const recentActivity = narrowedDomainReader<RecentActivityRuleDefinition>(
    registry,
    'reader:team.recent-activity-rule',
    [TEAM_DEFINITION_KINDS.recentActivityRule],
  );
  const memberRetention = narrowedDomainReader<MemberRetentionRuleDefinition>(
    registry,
    'reader:team.member-retention-rule',
    [TEAM_DEFINITION_KINDS.memberRetentionRule],
  );
  const recruitment = narrowedDomainReader<RecruitmentRuleDefinition>(registry, 'reader:team.recruitment-rule', [
    TEAM_DEFINITION_KINDS.recruitmentRule,
  ]);
  const teamFormation = narrowedDomainReader<TeamFormationRuleDefinition>(
    registry,
    'reader:team.team-formation-rule',
    [TEAM_DEFINITION_KINDS.teamFormationRule],
  );
  const socialPractice = narrowedDomainReader<NonPlayerMemberDailySocialPracticeRuleDefinition>(
    registry,
    'reader:team.non-player-member-daily-social-practice-rule',
    [TEAM_DEFINITION_KINDS.nonPlayerMemberDailySocialPracticeRule],
  );

  return {
    getPlayerTravelMode: (id) => playerTravel.get(id),
    getNpcTravelRule: (id) => npcTravel.get(id),
    getFreeActionRule: (id) => freeAction.get(id),
    getTeamPlanRule: (id) => teamPlan.get(id),
    getRecentActivityRule: (id) => recentActivity.get(id),
    getMemberRetentionRule: (id) => memberRetention.get(id),
    getRecruitmentRule: (id) => recruitment.get(id),
    getTeamFormationRule: (id) => teamFormation.get(id),
    getNonPlayerMemberDailySocialPracticeRule: (id) => socialPractice.get(id),
  };
}
