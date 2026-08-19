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

// 為什麼 getPlayerProposalAffinityResult 與 getHomeTutorPriceModifier 回傳 `| undefined`
// （doc §3 的原始簽章是非選填）：
//
// 兩者都需要「該冒險者對玩家的好感度」當輸入，而 doc §1 明訂三類角色**沒有**可用好感度——
// 玩家主角自己、Quest Temporary 角色與 Child Team 成員，加上尚未完成 Affinity Provisioning 的角色。
// 對這些角色，非選填的簽章只剩兩條路：回一個固定結果（`acceptedByAffinity: false`／價格修正 1），
// 或整個拋錯。前者正是規範點名的「Resolver 不在就用固定結果」——它會讓「沒有好感度」與
// 「好感度真的不足」在呼叫端無法區分，也會在換上真內容後行為不變；後者則讓一次正常的
// UI 投影（例如角色互動畫面詢問「這個人能不能求婚」）因為對象是任務角色而炸掉。
//
// 因此改為「查無此事實 → undefined」，由呼叫端（Marriage 流程／Economy Quote）自行決定
// 是拒絕還是不顯示該選項。`getPlayerAffinity` 原本就是這個形狀，此處只是讓另外兩個方法一致。
export interface SocialQuery {
  getPlayerAffinity(adventurerId: CharacterId): number | undefined;
  getPlayerConversationUsage(
    playerCharacterId: CharacterId,
    worldDay: WorldDay,
  ): PlayerConversationUsageView;
  getPlayerProposalAffinityResult(
    adventurerId: CharacterId,
  ): PlayerProposalAffinityResult | undefined;
  getHomeTutorPriceModifier(adventurerId: CharacterId): number | undefined;
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
