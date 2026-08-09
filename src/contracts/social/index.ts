// contracts/social — public contract transcribed from docs/00_core/architecture/23_social_module.md

import type {
  DefinitionHeader,
  ResolverId,
  SocialSystemDefinitionId,
  PlayerAffinityRuleId,
  PlayerConversationRuleId,
  NpcMarriageRuleId,
  ExperienceAwardRuleId,
  CharacterId,
  InteractionId,
  WorldDay,
} from '../core';

// ── 靜態資料契約（§2）─────────────────────────────────────────────────
export type SocialSystemDefinition = DefinitionHeader & {
  playerAffinityRuleId: PlayerAffinityRuleId;
  playerConversationRuleId: PlayerConversationRuleId;
};

export type PlayerAffinityRuleDefinition = DefinitionHeader & {
  minValue: number;
  maxValue: number;
  initialValueResolverId: ResolverId;
  conversationDeltaResolverId: ResolverId;
  playerProposalAcceptanceResolverId: ResolverId;
  homeTutorPriceModifierResolverId: ResolverId;
};

export type PlayerConversationRuleDefinition = DefinitionHeader & {
  maxCompletedPerDay: 6;
  experienceAwardRuleId: ExperienceAwardRuleId;
};

export type NpcMarriageRuleDefinition = DefinitionHeader & {
  acceptanceChanceResolverId: ResolverId;
};

export interface SocialDefinitionReader {
  getSocialSystem(id: SocialSystemDefinitionId): SocialSystemDefinition;
  getPlayerAffinityRule(id: PlayerAffinityRuleId): PlayerAffinityRuleDefinition;
  getPlayerConversationRule(id: PlayerConversationRuleId): PlayerConversationRuleDefinition;
  getNpcMarriageRule(id: NpcMarriageRuleId): NpcMarriageRuleDefinition;
}

// ── 公開 Query（§3）───────────────────────────────────────────────────
export type PlayerProposalAffinityResult = {
  acceptedByAffinity: boolean;
  ruleId: PlayerAffinityRuleId;
};

export type PlayerConversationUsageView = {
  playerCharacterId: CharacterId;
  worldDay: WorldDay;
  completedCount: number;
  remainingCount: number;
};

export interface SocialQuery {
  getPlayerAffinity(adventurerId: CharacterId): number | undefined;
  getPlayerConversationUsage(
    playerCharacterId: CharacterId,
    worldDay: WorldDay,
  ): PlayerConversationUsageView;
  getPlayerProposalAffinityResult(adventurerId: CharacterId): PlayerProposalAffinityResult;
  getHomeTutorPriceModifier(adventurerId: CharacterId): number;
}

// ── 輸入：玩家 Game Command（§4.1）───────────────────────────────────
export type InteractWithAdventurerCommand = Readonly<{
  type: 'interactWithAdventurer';
  targetCharacterId: CharacterId;
}>;
export type ProposeMarriageToTeamMemberCommand = Readonly<{
  type: 'proposeMarriageToTeamMember';
  targetCharacterId: CharacterId;
}>;
export type SocialGameCommand =
  | InteractWithAdventurerCommand
  | ProposeMarriageToTeamMemberCommand;

// ── 輸入：Internal Command（§4.2）────────────────────────────────────
export type ProvisionPlayerAffinityCommand = Readonly<{
  type: 'ProvisionPlayerAffinity';
  adventurerId: CharacterId;
  ruleId: PlayerAffinityRuleId;
}>;
export type ConsumePlayerConversationAllowanceCommand = Readonly<{
  type: 'ConsumePlayerConversationAllowance';
  playerCharacterId: CharacterId;
  worldDay: WorldDay;
  interactionId: InteractionId;
}>;
export type SocialInternalCommand =
  | ProvisionPlayerAffinityCommand
  | ConsumePlayerConversationAllowanceCommand;

// ── 輸出事件（§5）─────────────────────────────────────────────────────
export type PlayerConversationKind = 'partyChat' | 'tavernChat' | 'intel';
export type PlayerAffinityChangeReason = 'provisioned' | 'conversation';

export type PlayerConversationCompletedPayload = Readonly<{
  type: 'PlayerConversationCompleted';
  interactionId: InteractionId;
  playerCharacterId: CharacterId;
  targetCharacterId?: CharacterId;
  kind: PlayerConversationKind;
  worldDay: WorldDay;
  experienceAwardRuleId: ExperienceAwardRuleId;
  affinityDelta: number;
}>;
export type PlayerAffinityChangedPayload = Readonly<{
  type: 'PlayerAffinityChanged';
  adventurerId: CharacterId;
  oldValue?: number;
  newValue: number;
  sourceId: InteractionId;
  reason: PlayerAffinityChangeReason;
}>;

export type SocialDomainEvent =
  | ({ type: 'PlayerConversationCompleted' } & PlayerConversationCompletedPayload)
  | ({ type: 'PlayerAffinityChanged' } & PlayerAffinityChangedPayload);
