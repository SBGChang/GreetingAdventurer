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
  ModuleId,
  ScheduledJobBase,
} from '../core';
// Cross-module: team owns FreeActionRuleId / FreeActionRuleDefinition / NpcTravelRuleDefinition
// 與所有 NPC Plan 的接收型別（docs/.../02_team_module.md → src/contracts/team）。
import type {
  FreeActionRuleId,
  FreeActionRuleDefinition,
  NpcTravelRuleDefinition,
  StartNpcTeamPlanPayload,
} from '../team';

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
  // 域屬於型別、值屬於資料：原本宣告成字面值 `{ min: 2; max: 7 }`，等於把強制自由期的長度
  // 鎖進型別——換一份 Pack 想改成 3～10 日會直接編譯失敗。與 team 的
  // MemberRetentionRuleDefinition.activationDaysAfterJoin 同一裁定。
  forcedFreeDurationDays: { min: number; max: number };
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
  // 旅行節點必須把 arrivalDay 填進 team 的 CityTravelPlanPayload（`kind: 'npcTravel'` 必填欄位）。
  // 抵達日 = 出發日 + NpcTravelRuleDefinition.durationDays，所以天數必須從內容讀，
  // 不能由本模組寫一個 6。定義家族由 team 擁有；此處只是**窄化讀取**（同 getFreeActionRule）。
  getNpcTravelRule(id: NpcTravelRuleId): NpcTravelRuleDefinition;
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
// doc §3 完整列出了這個形狀，故保留。實際送出的 Internal Command 是 team 契約的
// `StartNpcTeamPlan`（見下方 NpcBehaviorOutboundInternalCommand）——旅行細節在它的
// `payload.travel`（`CityTravelPlanPayload` 的 `kind: 'npcTravel'` 變體）裡，由接收模組的
// 型別保證欄位一致；本型別對應的是同一組欄位在**節點快照**裡的存法
// （見 NpcActionChainNodePayload 的 travelToCity 變體）。
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
  // doc §4.4 列的是「最少 payload」。`aborted` 沒有理由碼時，UI／debug Projection 只看得到
  // 「這條 Chain 停了」而看不到為什麼——中止原因是本模組唯一知道的事實，不公告就沒有人能公告。
  // 與 NpcMarketIntentResolvedPayload.reason 同一形狀。
  reason?: string;
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
//
// doc §3 寫的是 `Record<string, JsonValue>`，但同一節又明確**禁止**旅行節點出現 `modeId`／
// `segmentIndex`／事件池／事件實例——一個開放的 Record 表達不出那條禁令，讀回來也只能靠
// 把 `JsonValue` 轉回 branded ID（規範 §7 的「Schema 不夠用」樣式）。因此收斂成判別聯集：
// 禁止的欄位在型別上就不存在，讀回來不需要任何轉型。`kind` 是領域模型變體判別欄（非訊息判別欄）。
//
// 只列**節點啟動路徑已閉合**的 kind；其餘 ActionChainNodeKind 的節點在啟動前一律是 `pending`。
export type NpcActionChainNodePayload =
  | Readonly<{ kind: 'pending' }>
  | Readonly<{ kind: 'cityFree' }>
  | Readonly<{
      kind: 'travelToCity';
      fromCityId: CityId;
      toCityId: CityId;
      routeId: RouteId;
      npcTravelRuleId: NpcTravelRuleId;
    }>
  | Readonly<{ kind: 'complete' }>;

// ── Runtime State（§3）───────────────────────────────────────────────
// doc §3 逐欄列出這四個型別，但 Wave A 契約只轉了它們的 View 投影。State 型別的權威應該在
// 契約（同 map 的 MapState、dungeon 的 DungeonState），否則 Slice 形狀只存在於模組內部檔案。
export type NpcActionChainNode = Readonly<{
  nodeId: ActionChainNodeId;
  kind: ActionChainNodeKind;
  status: NpcActionChainNodeStatus;
  linkedPlanId?: TeamPlanId;
  payload: NpcActionChainNodePayload;
}>;

export type NpcActionChain = Readonly<{
  chainId: ActionChainId;
  teamId: TeamId;
  source: NpcChainSource;
  templateId: ActionChainTemplateId;
  questId?: QuestId;
  status: NpcChainStatus;
  currentNodeIndex: number;
  nodes: readonly NpcActionChainNode[];
  targetUnavailableOnDay?: WorldDay;
  rngContext: RngContext; // Chain 跨日推進時保存下一次抽取位置
  revision: Revision;
}>;

export type NpcAdventurerController = Readonly<{
  teamId: TeamId;
  policyId: AdventurerDecisionPolicyId;
  activeChainId?: ActionChainId;
  nextDecisionOnDay: WorldDay;
  revision: Revision;
}>;

export type NpcMarketIntent = Readonly<{
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

export type NpcBehaviorState = Readonly<{
  controllers: Readonly<Record<TeamId, NpcAdventurerController>>;
  chains: Readonly<Record<ActionChainId, NpcActionChain>>;
  marketIntents: Readonly<Record<NpcMarketIntentId, NpcMarketIntent>>;
}>;

// ── 訊息聯集（供 app/composition 併入全遊戲聯集）───────────────────────
export type NpcBehaviorScheduledJob = NpcDecisionDueJob | NpcChainAdvanceJob;

// 外送 Internal Command 一律引用**接收模組**的真實型別（HANDOFF 慣例）：team 是
// `StartNpcTeamPlan` 的唯一處理者，欄位漂移由編譯器在發送端擋下。
export type NpcBehaviorOutboundInternalCommand = StartNpcTeamPlanPayload;
