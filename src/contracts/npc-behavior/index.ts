// contracts/npc-behavior — public contract transcribed from docs/00_core/architecture/18_npc_behavior_module.md

import type {
  DefinitionHeader,
  DefinitionId,
  ResolverId,
  ConditionDefinitionId,
  AdventurerDecisionPolicyId,
  ActionChainTemplateId,
  NpcMarketPolicyId,
  NpcTravelRuleId,
  ActionChainId,
  ActionChainNodeId,
  NpcMarketIntentId,
  TeamPlanId,
  TeamId,
  CharacterId,
  CityId,
  RouteId,
  ShopOfferId,
  ItemInstanceId,
  HomeRuleId,
  QuestId,
  WorldDay,
  Revision,
  RngContext,
  JsonValue,
  ModuleId,
  ScheduledJobBase,
} from '../core';
// Cross-module: team owns FreeActionRuleId + FreeActionRuleDefinition (docs/.../02_team_module.md → src/contracts/team).
import type { FreeActionRuleId, FreeActionRuleDefinition } from '../team';

// Placeholder: NpcStopPolicyId is declared only in 00_shared_contracts.md and is not
// exported by core, and no module defines a NpcStopPolicyDefinition; defined here so this
// file typechecks. Belongs in core/shared (see report note).
export type NpcStopPolicyId = DefinitionId<'npc-stop-policy'>;

// ── 靜態資料契約（§2）─────────────────────────────────────────────────
export type NpcIntentKind = 'enterNearbyAdventureMap' | 'acceptNearbyQuest' | 'travelToCity';

export type NpcIntentCandidateRule = {
  intentKind: NpcIntentKind;
  chainTemplateId: ActionChainTemplateId;
  conditionId: ConditionDefinitionId;
  weightResolverId: ResolverId;
};

export type NpcMemberFreeActionKind =
  | 'craft'
  | 'train'
  | 'trade'
  | 'proposeToTeammate'
  | 'rest';

export type NpcMemberFreeActionCandidateRule = {
  actionKind: NpcMemberFreeActionKind;
  freeActionRuleId: FreeActionRuleId;
  conditionId: ConditionDefinitionId;
  weightResolverId: ResolverId;
};

export type AdventurerDecisionPolicyDefinition = DefinitionHeader & {
  reviewIntervalDays: number;
  candidates: NpcIntentCandidateRule[];
  memberFreeActionCandidates: NpcMemberFreeActionCandidateRule[];
  fallbackChainTemplateId: ActionChainTemplateId;
  forcedFreeDurationDays: { min: 2; max: 7 };
  npcTravelRuleId: NpcTravelRuleId;
  marketPolicyId: NpcMarketPolicyId;
};

export type ActionChainPurpose = 'free' | 'travel' | 'localAdventure' | 'quest';

export type ActionChainNodeTemplate =
  | { kind: 'cityFree' }
  | { kind: 'travelToCity'; destinationResolverId: ResolverId }
  | { kind: 'executeNearbyAdventure'; mapResolverId: ResolverId; stopPolicyId: NpcStopPolicyId }
  | { kind: 'acceptNearbyQuest'; questSelectorId: ResolverId }
  | { kind: 'travelToQuestTarget'; destinationResolverId: ResolverId }
  | { kind: 'enterQuestMap' }
  | { kind: 'startNpcDungeonRun'; objectiveStopPolicyId: NpcStopPolicyId }
  | { kind: 'returnFromQuestMap' }
  | { kind: 'settleAtPostingGuild' }
  | { kind: 'complete' };

export type ActionChainNodeKind = ActionChainNodeTemplate['kind'];

export type ActionChainTemplateDefinition = DefinitionHeader & {
  purpose: ActionChainPurpose;
  nodes: ActionChainNodeTemplate[];
};

export type NpcPurchaseNeedRule = {
  target: 'equipment' | 'combatConsumable' | 'nonCombatConsumable';
  needResolverId: ResolverId;
  offerSelectorId: ResolverId;
};

export type NpcSellRule = {
  itemSelectorId: ResolverId;
  sellWhenResolverId: ResolverId;
};

export type NpcMarketPolicyDefinition = DefinitionHeader & {
  budgetReserveRuleId: ResolverId;
  purchaseNeedRules: NpcPurchaseNeedRule[];
  sellRules: NpcSellRule[];
  homePurchaseRuleId?: ResolverId;
  maxTransactionsPerFreeCycle: number;
};

export interface NpcBehaviorDefinitionReader {
  getDecisionPolicy(id: AdventurerDecisionPolicyId): AdventurerDecisionPolicyDefinition;
  getActionChainTemplate(id: ActionChainTemplateId): ActionChainTemplateDefinition;
  getMarketPolicy(id: NpcMarketPolicyId): NpcMarketPolicyDefinition;
  getFreeActionRule(id: FreeActionRuleId): FreeActionRuleDefinition;
}

// ── 公開 Query 與 View（§3）───────────────────────────────────────────
export type NpcChainSource = 'autonomous' | 'acceptedQuest';
export type NpcChainStatus = 'active' | 'completed' | 'aborted';
export type NpcActionChainNodeStatus =
  | 'waiting'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'failed';

// Derived read model; doc names NpcActionChainView but never defines it (see report note).
export type NpcActionChainNodeView = Readonly<{
  nodeId: ActionChainNodeId;
  kind: ActionChainNodeKind;
  status: NpcActionChainNodeStatus;
  linkedPlanId?: TeamPlanId;
}>;

export type NpcActionChainView = Readonly<{
  chainId: ActionChainId;
  teamId: TeamId;
  source: NpcChainSource;
  templateId: ActionChainTemplateId;
  questId?: QuestId;
  status: NpcChainStatus;
  currentNodeIndex: number;
  nodes: readonly NpcActionChainNodeView[];
  targetUnavailableOnDay?: WorldDay;
  revision: Revision;
}>;

export type NpcMarketIntentKind = 'buyOffer' | 'sellItem' | 'buyHome';
export type NpcMarketIntentState = 'pending' | 'completed' | 'invalid';

// Derived read model; doc names NpcMarketIntentView but never defines it (see report note).
export type NpcMarketIntentView = Readonly<{
  intentId: NpcMarketIntentId;
  teamId: TeamId;
  memberId: CharacterId;
  kind: NpcMarketIntentKind;
  cityId: CityId;
  offerId?: ShopOfferId;
  itemId?: ItemInstanceId;
  homeRuleId?: HomeRuleId;
  createdOnDay: WorldDay;
  state: NpcMarketIntentState;
  revision: Revision;
}>;

export interface NpcBehaviorQuery {
  getActiveChain(teamId: TeamId): NpcActionChainView | undefined;
  getNextDecisionOnDay(teamId: TeamId): WorldDay | undefined;
  listMarketIntents(teamId: TeamId): NpcMarketIntentView[];
}

// ── ScheduledJob（§4.1）───────────────────────────────────────────────
export type NpcDecisionDueJobPayload = Readonly<{ policyId: AdventurerDecisionPolicyId }>;
export type NpcDecisionDueJob = ScheduledJobBase<
  'npcDecisionDue',
  ModuleId,
  TeamId,
  NpcDecisionDueJobPayload
>;

export type NpcChainAdvanceJobPayload = Readonly<{ chainId: ActionChainId }>;
export type NpcChainAdvanceJob = ScheduledJobBase<
  'npcChainAdvance',
  ModuleId,
  TeamId,
  NpcChainAdvanceJobPayload
>;

// ── 輸出至 team 的旅行 Plan payload（§3、§4.3）────────────────────────
// Handled by team; fully specified in this doc so kept here (see report note).
export type StartNpcTravelPlanPayload = {
  teamId: TeamId;
  chainId: ActionChainId;
  nodeId: ActionChainNodeId;
  fromCityId: CityId;
  toCityId: CityId;
  routeId: RouteId;
  npcTravelRuleId: NpcTravelRuleId;
};

// ── 輸出事件（§4.4）──────────────────────────────────────────────────
export type NpcIntentSelectedPayload = Readonly<{
  type: 'NpcIntentSelected';
  teamId: TeamId;
  intentKind: NpcIntentKind;
  chainId: ActionChainId;
  onDay: WorldDay;
}>;
export type NpcActionChainChangedPayload = Readonly<{
  type: 'NpcActionChainChanged';
  teamId: TeamId;
  chainId: ActionChainId;
  currentNodeIndex: number;
  status: NpcChainStatus;
}>;
export type NpcMarketIntentCreatedPayload = Readonly<{
  type: 'NpcMarketIntentCreated';
  intentId: NpcMarketIntentId;
  teamId: TeamId;
  memberId: CharacterId;
  kind: NpcMarketIntentKind;
}>;
export type NpcMarketIntentResolvedPayload = Readonly<{
  type: 'NpcMarketIntentResolved';
  intentId: NpcMarketIntentId;
  state: NpcMarketIntentState;
  reason?: string;
}>;

export type NpcBehaviorDomainEvent =
  | ({ type: 'NpcIntentSelected' } & NpcIntentSelectedPayload)
  | ({ type: 'NpcActionChainChanged' } & NpcActionChainChangedPayload)
  | ({ type: 'NpcMarketIntentCreated' } & NpcMarketIntentCreatedPayload)
  | ({ type: 'NpcMarketIntentResolved' } & NpcMarketIntentResolvedPayload);

// ── payload 承載（§3）：Chain 節點 payload 只存 ID／選定結果／Resolver 快照 ──
export type NpcActionChainNodePayload = Readonly<Record<string, JsonValue>>;
