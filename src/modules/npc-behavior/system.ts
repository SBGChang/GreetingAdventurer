// modules/npc-behavior/system.ts
// NPC Behavior 的純函式 Job / Subscriber（對應 docs/00_core/architecture/18_npc_behavior_module.md §4–§6）。
//
// 這個模組最容易變成「寫死的 AI」，所以本檔的分工是刻意的：
//
//   程式負責 **通用程序**：候選收集 → 條件過濾 → 權重取得 → 依 RNG cursor 加權抽選 →
//                          依模板展開節點 → 送 Internal Command 給節點的擁有者 → 依回來的事件推進。
//   資料負責 **全部內容**：哪些意圖存在（NpcIntentCandidateRule[]）、條件是什麼
//                          （ConditionDefinitionId）、權重多少（ResolverId → §7.1 kernel）、
//                          節點序列（ActionChainTemplateDefinition.nodes）、目的城市（ResolverId）、
//                          強制自由期長度（forcedFreeDurationDays）、複審週期（reviewIntervalDays）、
//                          旅行天數（NpcTravelRuleDefinition.durationDays）。
//
// 因此本檔沒有任何 intentKind 的 if-else、沒有任何權重係數、沒有任何天數字面值。
// 換一份 Content Pack（不同候選、不同條件、不同權重、不同模板）必然產生不同的 NPC 行為。
//
// 其他紀律：
//   * 全部決定性純函式；無 I/O、無 Math.random / Date.now。RNG 只走注入的 DeterministicRng +
//     顯式 cursor；每個抽選點 cursor 逐次前進，並把最終 cursor 寫進下一筆 Job 與 Chain 快照。
//   * 行動鏈只是**計畫**：節點的實際執行屬別的模組（旅行／自由活動 = team）。本模組只送
//     Internal Command 給擁有者，再由訂閱回來的 Domain Event 推進節點；不寫別人的 Slice。
//   * Job 於交易成功提交時即被 dequeue（no-op 也算成功）。因此每一個「這次先不動作」分支都要
//     自己重排下一筆 npcDecisionDue，否則該 NPC 永遠停止思考。見 rearmDecision 的使用點。

import type {
  ActionChainId,
  ActionChainNodeId,
  CharacterId,
  CityId,
  CommandRejection,
  ConditionDefinitionId,
  DeterministicRng,
  DomainEventDraft,
  InternalCommandDraft,
  ModuleId,
  ModuleOutcome,
  ModuleResult,
  ResolverId,
  RngContext,
  RngCursor,
  RouteId,
  ScheduledJobDraft,
  TeamId,
  TransactionMessageDraft,
  WorldDay,
} from '../../contracts/core';
import type {
  ActionChainNodeTemplate,
  AdventurerDecisionPolicyDefinition,
  NpcActionChain,
  NpcActionChainNode,
  NpcAdventurerController,
  NpcBehaviorDefinitionReader,
  NpcBehaviorDomainEvent,
  NpcBehaviorOutboundInternalCommand,
  NpcChainAdvanceJob,
  NpcDecisionDueJob,
  NpcIntentKind,
} from '../../contracts/npc-behavior';
// 跨模組（僅型別 import）：team 擁有 Plan 與 Free Action 的全部事實與接收型別。
import type {
  TeamPlanKind,
  TeamPlanCompletedEvent,
  TeamMemberDepartedEvent,
} from '../../contracts/team';

import type { NpcBehaviorState } from './state';
import {
  activeChainForTeam,
  addDays,
  bump,
  createChain,
  nextDay,
  nodeAt,
  tryGetChain,
  tryGetController,
  upsertChain,
  upsertController,
  withNode,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組身分
// ──────────────────────────────────────────────────────────────────────────

export const NPC_BEHAVIOR_MODULE_ID = 'npc-behavior' as ModuleId<'npc-behavior'>;

// 節點執行的擁有者：旅行、進圖、返城、城市自由活動的實際 Plan 都由 team 建立（doc §4.3）。
const TEAM_MODULE_ID = 'team' as ModuleId;

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port（§7.1 慣例：模組宣告本地窄化 port 型別，實作由 Composition 注入）
// ──────────────────────────────────────────────────────────────────────────

// Team 的窄化讀 Port。NPC Behavior 不擁有隊伍位置、成員名單或控制權，一律唯讀取得。
export interface NpcBehaviorTeamPort {
  // 隊伍目前所在城市；旅行中／在冒險地／在住家一律回 undefined（旅行節點的合法前置是「人在城裡」）。
  getCityLocation(teamId: TeamId): CityId | undefined;
  listFormalMembers(teamId: TeamId): readonly CharacterId[];
  // 不變量 1 的另一半：玩家 Team 不可持有 NPC Controller。
  isNpcControlled(teamId: TeamId): boolean;
}

// World 的窄化讀 Port（doc §2.2：相鄰範圍與路線必須向 World 取，不得以座標猜測）。
export interface NpcBehaviorWorldPort {
  listCitiesWithinHops(originCityId: CityId, maxHops: number): readonly CityId[];
  getShortestRoute(from: CityId, to: CityId): readonly RouteId[] | undefined;
}

// 決策主體的**結構性事實**。這裡刻意只放「誰、何時、幾個人」——權重公式要用的其他事實
// （財產、戰力、熟練度…）由 Resolver 自己的 ResolverContext.queries 取得，不從本模組轉運，
// 否則每加一項權重輸入就要改一次 Handler 簽章，內容也就改不動了。
export type NpcDecisionSubject = Readonly<{
  teamId: TeamId;
  onDay: WorldDay;
  formalMemberCount: number;
}>;

// 條件判定 Port：ConditionDefinition 由內容擁有，判定引擎不屬本模組。
export interface NpcBehaviorConditionPort {
  isSatisfied(conditionId: ConditionDefinitionId, subject: NpcDecisionSubject): boolean;
}

// Resolver 執行結果（形狀比照 data-runtime 的 ResolverExecutionResult）：
// 只有真的用了 RNG 的 Resolver 才回傳 nextRngCursor，呼叫端據此顯式續接 cursor。
export type NpcResolvedValue<T> = Readonly<{ value: T; nextRngCursor?: RngCursor }>;

// 資料調校 Resolver 的窄化呼叫面。權重公式的形狀與係數都不在本模組：
// resolveIntentWeight 背後是 §7.1 的 weightedLinearProduct／thresholdTable／monotonicAdjust
// 加上該 Resolver 的 params 定義（見 app/content/resolvers.ts）。本模組只消費一個 number。
export interface NpcBehaviorResolverPort {
  resolveIntentWeight(
    input: Readonly<{
      resolverId: ResolverId;
      subject: NpcDecisionSubject;
      rngContext: RngContext;
    }>,
  ): NpcResolvedValue<number>;

  // 目的城市由資料決定（ActionChainNodeTemplate.destinationResolverId）。候選集合由本模組依
  // World 的相鄰查詢供給，「挑哪一個」則是內容的事。無可用目的地回 undefined。
  resolveDestinationCity(
    input: Readonly<{
      resolverId: ResolverId;
      subject: NpcDecisionSubject;
      fromCityId: CityId;
      candidateCityIds: readonly CityId[];
      rngContext: RngContext;
    }>,
  ): NpcResolvedValue<CityId | undefined>;
}

// 交易私有的 ID 配發器（背後由 Kernel RuntimeIdGenerator + cursor 提供）。
// 只鑄造本 Slice 擁有的實體 ID；TeamPlanId／QuestId／NpcDungeonRunId 都不在此列。
export interface NpcBehaviorIdAllocator {
  nextActionChainId(): ActionChainId;
  nextActionChainNodeId(): ActionChainNodeId;
}

export type NpcBehaviorContext = Readonly<{
  worldDay: WorldDay;
  definitions: NpcBehaviorDefinitionReader;
  team: NpcBehaviorTeamPort;
  world: NpcBehaviorWorldPort;
  conditions: NpcBehaviorConditionPort;
  resolvers: NpcBehaviorResolverPort;
  ids: NpcBehaviorIdAllocator;
  rng: DeterministicRng;
  rngContext: RngContext; // 本次執行的起點；Job 帶進來的 cursor 由 Composition 填入
}>;

export type NpcBehaviorHandlerResult = ModuleOutcome<NpcBehaviorState>;

// ──────────────────────────────────────────────────────────────────────────
// ModuleResult / message 工具
// ──────────────────────────────────────────────────────────────────────────

function emit(event: NpcBehaviorDomainEvent): DomainEventDraft<unknown> {
  return { event };
}

// 外送命令以**接收模組契約的真實型別**為參數（HANDOFF 慣例），讓編譯器在發送端就攔下欄位不符。
function internal(
  targetModule: ModuleId,
  command: NpcBehaviorOutboundInternalCommand,
): InternalCommandDraft<unknown> {
  return { targetModule, command };
}

function makeResult(
  nextSlice: NpcBehaviorState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
  scheduledJobs: ModuleResult<NpcBehaviorState>['scheduledJobs'] = [],
): ModuleResult<NpcBehaviorState> {
  return { nextSlice, outgoingMessages, scheduledJobs };
}

function accept(
  nextSlice: NpcBehaviorState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
  scheduledJobs: ModuleResult<NpcBehaviorState>['scheduledJobs'] = [],
): NpcBehaviorHandlerResult {
  return { ok: true, result: makeResult(nextSlice, outgoingMessages, scheduledJobs) };
}

function rejection(
  code: string,
  details?: CommandRejection['details'],
): CommandRejection {
  return { code, source: NPC_BEHAVIOR_MODULE_ID, details };
}

// ──────────────────────────────────────────────────────────────────────────
// Job draft 建構
// ──────────────────────────────────────────────────────────────────────────
//
// 兩支 Job 的存活判定刻意**不**用 expectedRevision：Controller 與 Chain 的 revision 在每次推進
// 都會 bump，掛上去等於讓下一筆 Job 一定被判定為過期。存活判定在 Handler 內以「Controller／Chain
// 是否存在、status 是否仍 active」進行（見 npcDecisionDue／npcChainAdvance 開頭）。

// 每個 Controller 在任何時刻恰好有一筆存活的 npcDecisionDue（本模組的核心排程不變量）：
// npcDecisionDue 的**每一條**返回路徑都經過這裡重排一次，且只重排一次。Chain 完成時只寫
// nextDecisionOnDay（最早可再抽日），不另外排 Job——否則同一個 Controller 會有兩筆 Job 互相加倍。
export function decisionJobDraft(
  controller: NpcAdventurerController,
  policy: AdventurerDecisionPolicyDefinition,
  ctx: NpcBehaviorContext,
  cursor: RngCursor,
): ScheduledJobDraft<NpcDecisionDueJob> {
  const dueDay =
    controller.nextDecisionOnDay > ctx.worldDay
      ? controller.nextDecisionOnDay
      : addDays(ctx.worldDay, policy.reviewIntervalDays);
  return {
    type: 'npcDecisionDue',
    dueDay,
    ownerModule: NPC_BEHAVIOR_MODULE_ID,
    targetId: controller.teamId,
    rngContext: { ...ctx.rngContext, cursor },
    payload: { policyId: controller.policyId },
  };
}

// 節點完成 → 登記**次日**推進（doc §4.1）。
export function chainAdvanceJobDraft(
  chain: NpcActionChain,
  dueDay: WorldDay,
): ScheduledJobDraft<NpcChainAdvanceJob> {
  return {
    type: 'npcChainAdvance',
    dueDay,
    ownerModule: NPC_BEHAVIOR_MODULE_ID,
    targetId: chain.teamId,
    rngContext: chain.rngContext,
    payload: { chainId: chain.chainId },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 通用抽選程序（無任何內容知識）
// ──────────────────────────────────────────────────────────────────────────

type Weighted<T> = Readonly<{ item: T; weight: number }>;

// 依權重比例抽一項：cursor 前進一次，回傳抽中項與最終 cursor。
// 全部權重合計不為正數 → 沒有可抽項（呼叫端負責決定那代表什麼），不代填任何預設。
function weightedPick<T>(
  entries: readonly Weighted<T>[],
  ctx: NpcBehaviorContext,
  cursor: RngCursor,
): Readonly<{ item: T; nextCursor: RngCursor }> | undefined {
  let total = 0;
  for (const e of entries) total += e.weight;
  if (!(total > 0)) return undefined;

  const step = ctx.rng.nextFloat({
    worldSeed: ctx.rngContext.worldSeed,
    streamId: ctx.rngContext.streamId,
    cursor,
  });
  let threshold = step.value * total;
  for (const e of entries) {
    threshold -= e.weight;
    if (threshold < 0) return { item: e.item, nextCursor: step.nextCursor };
  }
  // 浮點累積誤差時取最後一項（權重為正者必然存在）。
  const last = entries[entries.length - 1];
  if (last === undefined) return undefined;
  return { item: last.item, nextCursor: step.nextCursor };
}

function subjectOf(teamId: TeamId, ctx: NpcBehaviorContext): NpcDecisionSubject {
  return {
    teamId,
    onDay: ctx.worldDay,
    formalMemberCount: ctx.team.listFormalMembers(teamId).length,
  };
}

type IntentDraw = Readonly<{
  intentKind: NpcIntentKind;
  chainTemplateId: AdventurerDecisionPolicyDefinition['fallbackChainTemplateId'];
}>;

// 模板 purpose → 意圖種類。兩個**契約 enum** 之間的對應是結構，不是內容：資料只挑模板，
// 事件要公告的 intentKind 則由該模板的 purpose 決定（候選規則自帶 intentKind，fallback 沒有）。
function intentKindForPurpose(purpose: string): NpcIntentKind | undefined {
  if (purpose === 'travel') return 'travelToCity';
  if (purpose === 'localAdventure') return 'enterNearbyAdventureMap';
  if (purpose === 'quest') return 'acceptNearbyQuest';
  return undefined; // 'free' 不是可抽選的工作（doc §2：資料驗證禁止 fallback 指向自由活動）
}

// 候選收集 → 條件過濾 → 權重取得 → 加權抽選。無可抽項時套用資料指定的 fallback 模板。
function drawIntent(
  policy: AdventurerDecisionPolicyDefinition,
  subject: NpcDecisionSubject,
  ctx: NpcBehaviorContext,
  startCursor: RngCursor,
): Readonly<{ draw: IntentDraw; nextCursor: RngCursor }> {
  let cursor = startCursor;
  const entries: Weighted<IntentDraw>[] = [];

  for (const rule of policy.candidates) {
    if (!ctx.conditions.isSatisfied(rule.conditionId, subject)) continue;
    const resolved = ctx.resolvers.resolveIntentWeight({
      resolverId: rule.weightResolverId,
      subject,
      rngContext: { ...ctx.rngContext, cursor },
    });
    const advanced = resolved.nextRngCursor;
    if (advanced !== undefined) cursor = advanced;
    if (!(resolved.value > 0)) continue; // 權重非正 = 這次不在池裡；不是「給它一點基礎權重」
    entries.push({
      item: { intentKind: rule.intentKind, chainTemplateId: rule.chainTemplateId },
      weight: resolved.value,
    });
  }

  const picked = weightedPick(entries, ctx, cursor);
  if (picked !== undefined) {
    return { draw: picked.item, nextCursor: picked.nextCursor };
  }

  // 無可用候選 → 強制套用資料指定的**非自由** fallback（doc §2）。
  const fallback = ctx.definitions.getActionChainTemplate(policy.fallbackChainTemplateId);
  const intentKind = intentKindForPurpose(fallback.purpose);
  if (intentKind === undefined) {
    // 內容錯誤（fallback 指向自由活動）。不代它挑一個工作，也不悄悄變成休息：
    // 這是 Content Pack 驗證該擋下的事，Runtime 只能明確失敗。
    throw new Error(
      `npc-behavior: fallbackChainTemplateId "${String(policy.fallbackChainTemplateId)}" 的 purpose 為 ` +
        `"${fallback.purpose}"，不是可抽選的非自由工作（doc §2 資料驗證規則）`,
    );
  }
  return {
    draw: { intentKind, chainTemplateId: policy.fallbackChainTemplateId },
    nextCursor: cursor,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 節點啟動：把「計畫」交給節點的擁有者執行
// ──────────────────────────────────────────────────────────────────────────

type NodeStart =
  | Readonly<{
      ok: true;
      node: NpcActionChainNode;
      messages: readonly TransactionMessageDraft[];
      // `complete` 這種純標記節點沒有執行者，啟動即完成，由推進迴圈繼續往下走。
      completedImmediately: boolean;
    }>
  | Readonly<{ ok: false; rejection: CommandRejection }>;

// 節點 kind → 要向 team 要求的 TeamPlanKind。這是本模組**自己送出什麼命令**的宣告，
// 屬程式結構；同一張表也用於認回 TeamPlanCompleted（見 onTeamPlanCompleted）。
function teamPlanKindForNode(kind: ActionChainNodeTemplate['kind']): TeamPlanKind | undefined {
  if (kind === 'cityFree') return 'cityFree';
  if (kind === 'travelToCity') return 'cityTravel';
  return undefined;
}

function startCityFreeNode(node: NpcActionChainNode, chain: NpcActionChain): NodeStart {
  return {
    ok: true,
    node: { ...node, status: 'running', payload: { kind: 'cityFree' } },
    messages: [
      internal(TEAM_MODULE_ID, {
        type: 'StartNpcTeamPlan',
        teamId: chain.teamId,
        kind: 'cityFree',
        payload: { kind: 'cityFree' },
      }),
    ],
    completedImmediately: false,
  };
}

function startTravelNode(
  node: NpcActionChainNode,
  chain: NpcActionChain,
  destinationResolverId: ResolverId,
  policy: AdventurerDecisionPolicyDefinition,
  ctx: NpcBehaviorContext,
): NodeStart {
  const fromCityId = ctx.team.getCityLocation(chain.teamId);
  if (fromCityId === undefined) {
    return {
      ok: false,
      rejection: rejection('npcBehavior.travelNode.teamNotInCity', {
        chainId: String(chain.chainId),
        nodeId: String(node.nodeId),
      }),
    };
  }

  // 相鄰一格城市（doc §2.2「城市圖上直接相鄰的一格」＝ 1 hop；不變量 11 要求單段直達 Plan，
  // 所以候選只能是有單一 Route 直達的城市）。1 是「相鄰」的定義，不是可調距離。
  const candidateCityIds = ctx.world
    .listCitiesWithinHops(fromCityId, 1)
    .filter((cityId) => cityId !== fromCityId);

  const resolved = ctx.resolvers.resolveDestinationCity({
    resolverId: destinationResolverId,
    subject: subjectOf(chain.teamId, ctx),
    fromCityId,
    candidateCityIds,
    rngContext: chain.rngContext,
  });
  const toCityId = resolved.value;
  if (toCityId === undefined) {
    return {
      ok: false,
      rejection: rejection('npcBehavior.travelNode.destinationUnavailable', {
        chainId: String(chain.chainId),
        fromCityId: String(fromCityId),
        candidateCount: candidateCityIds.length,
      }),
    };
  }
  if (!candidateCityIds.includes(toCityId)) {
    return {
      ok: false,
      rejection: rejection('npcBehavior.travelNode.destinationNotAdjacent', {
        chainId: String(chain.chainId),
        toCityId: String(toCityId),
      }),
    };
  }

  const route = ctx.world.getShortestRoute(fromCityId, toCityId);
  const routeId = route === undefined || route.length !== 1 ? undefined : route[0];
  if (routeId === undefined) {
    return {
      ok: false,
      rejection: rejection('npcBehavior.travelNode.routeUnavailable', {
        chainId: String(chain.chainId),
        fromCityId: String(fromCityId),
        toCityId: String(toCityId),
      }),
    };
  }

  const npcTravelRuleId = policy.npcTravelRuleId;
  const travelRule = ctx.definitions.getNpcTravelRule(npcTravelRuleId);
  const arrivalDay = addDays(ctx.worldDay, travelRule.durationDays);

  return {
    ok: true,
    node: {
      ...node,
      status: 'running',
      payload: { kind: 'travelToCity', fromCityId, toCityId, routeId, npcTravelRuleId },
    },
    messages: [
      internal(TEAM_MODULE_ID, {
        type: 'StartNpcTeamPlan',
        teamId: chain.teamId,
        kind: 'cityTravel',
        payload: {
          kind: 'cityTravel',
          // NPC 旅行 payload 的判別聯集本身就排除了 modeId／segmentIndex／事件欄位（不變量 11）。
          travel: { kind: 'npcTravel', fromCityId, toCityId, routeId, npcTravelRuleId, arrivalDay },
        },
      }),
    ],
    completedImmediately: false,
  };
}

// 節點啟動 dispatch。這裡的分支不是「AI 的決定」，而是「這一種節點的執行者是誰」——
// 對每一個 kind 只有一個正確答案，跟內容無關。
//
// 尚未閉合的 kind（執行者模組不存在，或其接收命令沒有 Owner）一律回明確 rejection：
// 呼叫端把它變成節點 failed + Chain aborted 並帶上理由碼，而不是假裝節點跑掉了。
function startNode(
  chain: NpcActionChain,
  index: number,
  policy: AdventurerDecisionPolicyDefinition,
  ctx: NpcBehaviorContext,
): NodeStart {
  const node = nodeAt(chain, index);
  if (node === undefined) {
    return {
      ok: false,
      rejection: rejection('npcBehavior.node.indexOutOfRange', {
        chainId: String(chain.chainId),
        index,
      }),
    };
  }

  const template = ctx.definitions.getActionChainTemplate(chain.templateId);
  const nodeTemplate = template.nodes[index];
  if (nodeTemplate === undefined || nodeTemplate.kind !== node.kind) {
    // Chain 快照與模板對不上：模板在 Chain 進行中被換掉（存檔 Migration／Pack 更換）。
    return {
      ok: false,
      rejection: rejection('npcBehavior.node.templateMismatch', {
        chainId: String(chain.chainId),
        templateId: String(chain.templateId),
        index,
        nodeKind: node.kind,
      }),
    };
  }

  if (nodeTemplate.kind === 'cityFree') return startCityFreeNode(node, chain);
  if (nodeTemplate.kind === 'travelToCity') {
    return startTravelNode(node, chain, nodeTemplate.destinationResolverId, policy, ctx);
  }
  if (nodeTemplate.kind === 'complete') {
    return {
      ok: true,
      node: { ...node, status: 'completed', payload: { kind: 'complete' } },
      messages: [],
      completedImmediately: true,
    };
  }

  return {
    ok: false,
    rejection: rejection('npcBehavior.node.kindNotAvailable', {
      chainId: String(chain.chainId),
      nodeId: String(node.nodeId),
      nodeKind: nodeTemplate.kind,
    }),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Chain 推進／收斂
// ──────────────────────────────────────────────────────────────────────────

type ChainStep = Readonly<{
  state: NpcBehaviorState;
  messages: readonly TransactionMessageDraft[];
  scheduledJobs: ModuleResult<NpcBehaviorState>['scheduledJobs'];
  cursor: RngCursor;
}>;

// 非自由 Chain 完成 → 抽 2～7 日（資料化 forcedFreeDurationDays）強制自由期，
// 建立 cityFree TeamPlan，並把最早可再抽日寫進 Controller（doc §5.1、不變量 10）。
function completeChain(
  state: NpcBehaviorState,
  chain: NpcActionChain,
  controller: NpcAdventurerController,
  policy: AdventurerDecisionPolicyDefinition,
  ctx: NpcBehaviorContext,
  cursor: RngCursor,
): ChainStep {
  const template = ctx.definitions.getActionChainTemplate(chain.templateId);
  const messages: TransactionMessageDraft[] = [];
  let nextCursor = cursor;
  let resumeOnDay = nextDay(ctx.worldDay);

  if (template.purpose !== 'free') {
    const range = policy.forcedFreeDurationDays;
    if (!(range.min >= 1) || range.max < range.min) {
      throw new Error(
        `npc-behavior: forcedFreeDurationDays 無效（min=${range.min}, max=${range.max}）——` +
          '強制自由期長度屬 Decision Policy 內容，須為 min >= 1 且 max >= min',
      );
    }
    const draw = ctx.rng.nextInt({
      worldSeed: ctx.rngContext.worldSeed,
      streamId: ctx.rngContext.streamId,
      cursor: nextCursor,
      minInclusive: range.min,
      maxInclusive: range.max,
    });
    nextCursor = draw.nextCursor;
    resumeOnDay = addDays(ctx.worldDay, draw.value);
    messages.push(
      internal(TEAM_MODULE_ID, {
        type: 'StartNpcTeamPlan',
        teamId: chain.teamId,
        kind: 'cityFree',
        payload: { kind: 'cityFree' },
      }),
    );
  }

  const completed: NpcActionChain = {
    ...chain,
    status: 'completed',
    revision: bump(chain.revision),
  };
  const nextController: NpcAdventurerController = {
    ...controller,
    activeChainId: undefined,
    nextDecisionOnDay: resumeOnDay,
    revision: bump(controller.revision),
  };
  messages.push(
    emit({
      type: 'NpcActionChainChanged',
      teamId: chain.teamId,
      chainId: chain.chainId,
      currentNodeIndex: completed.currentNodeIndex,
      status: 'completed',
    }),
  );

  return {
    state: upsertController(upsertChain(state, completed), nextController),
    messages,
    scheduledJobs: [],
    cursor: nextCursor,
  };
}

// Chain 中止：目前節點標 failed、Chain 標 aborted、Controller 解除鎖定並於次日重抽（doc §5.2）。
// 理由碼隨事件公告出去——中止原因是本模組唯一知道的事實。
function abortChain(
  state: NpcBehaviorState,
  chain: NpcActionChain,
  controller: NpcAdventurerController,
  reason: CommandRejection,
  ctx: NpcBehaviorContext,
  cursor: RngCursor,
): ChainStep {
  const node = nodeAt(chain, chain.currentNodeIndex);
  const withFailedNode =
    node === undefined
      ? chain
      : withNode(chain, chain.currentNodeIndex, { ...node, status: 'failed' });
  const aborted: NpcActionChain = {
    ...withFailedNode,
    status: 'aborted',
    revision: bump(withFailedNode.revision),
  };
  const nextController: NpcAdventurerController = {
    ...controller,
    activeChainId: undefined,
    nextDecisionOnDay: nextDay(ctx.worldDay),
    revision: bump(controller.revision),
  };
  return {
    state: upsertController(upsertChain(state, aborted), nextController),
    messages: [
      emit({
        type: 'NpcActionChainChanged',
        teamId: chain.teamId,
        chainId: chain.chainId,
        currentNodeIndex: aborted.currentNodeIndex,
        status: 'aborted',
        reason: reason.code,
      }),
    ],
    scheduledJobs: [],
    cursor,
  };
}

// 從 startIndex 起推進：啟動節點；啟動即完成者（`complete`）繼續往下；沒有下一節則收斂 Chain。
// 不變量 4：每一節都有完成／中止路徑——本迴圈的三個出口分別是 running（等事件）、completed、aborted。
function advanceChainFrom(
  state: NpcBehaviorState,
  chain: NpcActionChain,
  controller: NpcAdventurerController,
  policy: AdventurerDecisionPolicyDefinition,
  ctx: NpcBehaviorContext,
  startIndex: number,
  startCursor: RngCursor,
): ChainStep {
  let workingChain: NpcActionChain = { ...chain, currentNodeIndex: startIndex };
  let workingState = state;
  const messages: TransactionMessageDraft[] = [];
  let cursor = startCursor;

  // 節點索引嚴格遞增，故迴圈以節點數為上界。
  for (let guard = 0; guard <= workingChain.nodes.length; guard += 1) {
    const index = workingChain.currentNodeIndex;
    if (index >= workingChain.nodes.length) {
      const done = completeChain(workingState, workingChain, controller, policy, ctx, cursor);
      return {
        state: done.state,
        messages: [...messages, ...done.messages],
        scheduledJobs: done.scheduledJobs,
        cursor: done.cursor,
      };
    }

    const started = startNode(workingChain, index, policy, ctx);
    if (!started.ok) {
      const done = abortChain(
        workingState,
        workingChain,
        controller,
        started.rejection,
        ctx,
        cursor,
      );
      return {
        state: done.state,
        messages: [...messages, ...done.messages],
        scheduledJobs: done.scheduledJobs,
        cursor: done.cursor,
      };
    }

    workingChain = withNode(workingChain, index, started.node);
    messages.push(...started.messages);

    if (!started.completedImmediately) {
      // 節點交給執行者了；等它的 Domain Event 回來才推進（doc §4.1、§4.2）。
      const running: NpcActionChain = { ...workingChain };
      const nextController: NpcAdventurerController = {
        ...controller,
        activeChainId: running.chainId,
        revision: bump(controller.revision),
      };
      workingState = upsertController(upsertChain(workingState, running), nextController);
      messages.push(
        emit({
          type: 'NpcActionChainChanged',
          teamId: running.teamId,
          chainId: running.chainId,
          currentNodeIndex: index,
          status: 'active',
        }),
      );
      return { state: workingState, messages, scheduledJobs: [], cursor };
    }

    workingChain = { ...workingChain, currentNodeIndex: index + 1 };
  }

  throw new Error(
    `npc-behavior: Chain "${String(chain.chainId)}" 推進迴圈未收斂——節點索引必須嚴格遞增`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// §4.1 ScheduledJob：npcDecisionDue
// ──────────────────────────────────────────────────────────────────────────
//
// 只處理「沒有 active Chain 且已到最早可抽日」的 NPC Team；其餘一律 no-op **並重排**。
// 每一條返回路徑都必須回答「這筆 Job 還會再來嗎？」——除了「Controller 已不存在」（沒有可思考
// 的主體了）之外，答案都必須是「會」，否則該 NPC 從此停止思考。
export function npcDecisionDue(
  state: NpcBehaviorState,
  job: NpcDecisionDueJob,
  ctx: NpcBehaviorContext,
): NpcBehaviorHandlerResult {
  const teamId = job.targetId;
  const controller = tryGetController(state, teamId);

  // Controller 不存在（隊伍已解散／存檔已無此 NPC）→ 冪等 no-op，且**不**重排：
  // 沒有主體可以思考，重排只會製造永久空轉的 Job。
  if (controller === undefined) return accept(state);

  if (!ctx.team.isNpcControlled(teamId)) {
    // 不變量 1：玩家 Team 不可持有 NPC Controller。這是 Bootstrap／存檔錯誤，不是內容缺口——
    // 靜默 no-op 會讓玩家隊伍被自動代打，所以明確失敗。
    throw new Error(
      `npc-behavior: Team "${String(teamId)}" 不是 control: 'npc'，不得持有 NPC Controller（doc §6 不變量 1）`,
    );
  }

  const policy = ctx.definitions.getDecisionPolicy(controller.policyId);

  // Job payload 的 policyId 與 Controller 不符 → Job 相對 State 已過期（Policy 被換掉）。
  // State 是權威：以 Controller 的 Policy 重排一筆，本次不抽。
  if (job.payload.policyId !== controller.policyId) {
    return accept(state, [], [decisionJobDraft(controller, policy, ctx, ctx.rngContext.cursor)]);
  }

  // 已有 active Chain → 本次不抽（doc §4.1），但仍重排，讓 Chain 卡住時 NPC 不會永遠停止思考。
  if (activeChainForTeam(state, teamId) !== undefined) {
    return accept(state, [], [decisionJobDraft(controller, policy, ctx, ctx.rngContext.cursor)]);
  }

  // 強制自由期未結束（或 Job 早到）→ 本次不抽，重排到最早可抽日。
  if (ctx.worldDay < controller.nextDecisionOnDay) {
    return accept(state, [], [decisionJobDraft(controller, policy, ctx, ctx.rngContext.cursor)]);
  }

  const subject = subjectOf(teamId, ctx);
  if (subject.formalMemberCount === 0) {
    // 沒有合法正式成員 → 不抽工作，但保留 Controller 並重排（成員可能被補回）。
    return accept(state, [], [decisionJobDraft(controller, policy, ctx, ctx.rngContext.cursor)]);
  }

  const drawn = drawIntent(policy, subject, ctx, ctx.rngContext.cursor);
  const template = ctx.definitions.getActionChainTemplate(drawn.draw.chainTemplateId);

  const chainId = ctx.ids.nextActionChainId();
  const nodeIds = template.nodes.map(() => ctx.ids.nextActionChainNodeId());
  const chain = createChain({
    chainId,
    teamId,
    source: 'autonomous',
    templateId: drawn.draw.chainTemplateId,
    nodeKinds: template.nodes.map((n) => n.kind),
    nodeIds,
    rngContext: { ...ctx.rngContext, cursor: drawn.nextCursor },
  });

  const linkedController: NpcAdventurerController = {
    ...controller,
    activeChainId: chainId,
    revision: bump(controller.revision),
  };
  const seeded = upsertController(upsertChain(state, chain), linkedController);

  const intentEvent = emit({
    type: 'NpcIntentSelected',
    teamId,
    intentKind: drawn.draw.intentKind,
    chainId,
    onDay: ctx.worldDay,
  });

  const step = advanceChainFrom(
    seeded,
    chain,
    linkedController,
    policy,
    ctx,
    0,
    drawn.nextCursor,
  );

  // 重排以推進後的 Controller 為準（nextDecisionOnDay 可能已被 completeChain／abortChain 改寫）。
  // advanceChainFrom 的三條出口都會寫回 Controller，因此這裡拿不到就是推進路徑漏寫，不是缺資料。
  const afterController = tryGetController(step.state, teamId);
  if (afterController === undefined) {
    throw new Error(
      `npc-behavior: 推進後 Team "${String(teamId)}" 的 Controller 消失——每條推進出口都必須寫回 Controller`,
    );
  }
  return accept(
    step.state,
    [intentEvent, ...step.messages],
    [...step.scheduledJobs, decisionJobDraft(afterController, policy, ctx, step.cursor)],
  );
}

// ──────────────────────────────────────────────────────────────────────────
// §4.1 ScheduledJob：npcChainAdvance
// ──────────────────────────────────────────────────────────────────────────
//
// 由已完成的 Team Plan／任務狀態／地牢結果登記為**次日**處理；重新驗證並推進一個可立即啟動的節點。
// 這支 Job **不**負責讓 NPC 持續思考——那是 npcDecisionDue 的單一責任。因此 Chain 已收斂時
// 這裡不重排任何東西（重排會變成第二條時間線）。
export function npcChainAdvance(
  state: NpcBehaviorState,
  job: NpcChainAdvanceJob,
  ctx: NpcBehaviorContext,
): NpcBehaviorHandlerResult {
  const chain = tryGetChain(state, job.payload.chainId);

  // Chain 已不存在或已收斂（completed／aborted）→ 冪等 no-op。這件事**已經發生過了**：
  // 收斂路徑已經改寫 Controller.nextDecisionOnDay，npcDecisionDue 會接手。
  if (chain === undefined || chain.status !== 'active') return accept(state);

  const controller = tryGetController(state, chain.teamId);
  if (controller === undefined) {
    throw new Error(
      `npc-behavior: Chain "${String(chain.chainId)}" 的 Team "${String(chain.teamId)}" 沒有 Controller——` +
        'active Chain 必須由 Controller 持有（doc §6 不變量 1）',
    );
  }

  const policy = ctx.definitions.getDecisionPolicy(controller.policyId);

  // 隊伍已無合法正式成員 → 中止 Chain（doc §4.2 CharacterAvailabilityChanged／TeamMemberDeparted）。
  if (ctx.team.listFormalMembers(chain.teamId).length === 0) {
    const step = abortChain(
      state,
      chain,
      controller,
      rejection('npcBehavior.chain.noFormalMembers', { chainId: String(chain.chainId) }),
      ctx,
      chain.rngContext.cursor,
    );
    return accept(step.state, step.messages, step.scheduledJobs);
  }

  const node = nodeAt(chain, chain.currentNodeIndex);
  if (node === undefined) {
    const step = abortChain(
      state,
      chain,
      controller,
      rejection('npcBehavior.node.indexOutOfRange', {
        chainId: String(chain.chainId),
        index: chain.currentNodeIndex,
      }),
      ctx,
      chain.rngContext.cursor,
    );
    return accept(step.state, step.messages, step.scheduledJobs);
  }

  // 節點仍在執行中 → 這筆 Job 是重複登記；執行者的完成事件會再登記一次，故不重排。
  if (node.status === 'running') return accept(state);

  if (node.status === 'failed' || node.status === 'skipped') {
    const step = abortChain(
      state,
      chain,
      controller,
      rejection('npcBehavior.node.notAdvanceable', {
        chainId: String(chain.chainId),
        nodeId: String(node.nodeId),
        nodeStatus: node.status,
      }),
      ctx,
      chain.rngContext.cursor,
    );
    return accept(step.state, step.messages, step.scheduledJobs);
  }

  const startIndex = node.status === 'completed' ? chain.currentNodeIndex + 1 : chain.currentNodeIndex;
  const step = advanceChainFrom(
    state,
    chain,
    controller,
    policy,
    ctx,
    startIndex,
    chain.rngContext.cursor,
  );
  return accept(step.state, step.messages, step.scheduledJobs);
}

// ──────────────────────────────────────────────────────────────────────────
// §4.2 訂閱 DomainEvent
// ──────────────────────────────────────────────────────────────────────────
//
// Subscriber 回 ModuleResult（已發生的事實不可拒絕，12_engine_runtime.md §7.2 rule 6）。

export const NPC_BEHAVIOR_SUBSCRIPTION_TEAM_PLAN_COMPLETED =
  'subscription.TeamPlanCompleted.npc-behavior';
export const NPC_BEHAVIOR_SUBSCRIPTION_TEAM_MEMBER_DEPARTED =
  'subscription.TeamMemberDeparted.npc-behavior';

// Team Plan 完成 → 找到對應節點、標為完成、登記次日 npcChainAdvance（doc §4.2）。
//
// 節點與 Plan 的對應由「送出時選定的 TeamPlanKind」認回：一支隊伍同時只有一個 active Plan，
// 一條 Chain 同時只有一個 running 節點，兩者的 kind 必須一致才算是我們要的那筆。
// 不是本模組要求的 Plan（玩家隊伍、強制自由期的 cityFree Plan）→ 冪等 no-op。
export function onTeamPlanCompleted(
  state: NpcBehaviorState,
  event: TeamPlanCompletedEvent,
  ctx: NpcBehaviorContext,
): ModuleResult<NpcBehaviorState> {
  const chain = activeChainForTeam(state, event.teamId);
  if (chain === undefined) return makeResult(state);

  const node = nodeAt(chain, chain.currentNodeIndex);
  if (node === undefined || node.status !== 'running') return makeResult(state);
  if (teamPlanKindForNode(node.kind) !== event.kind) return makeResult(state);

  const completedNode: NpcActionChainNode = {
    ...node,
    status: 'completed',
    linkedPlanId: event.planId,
  };
  const advanced = withNode(chain, chain.currentNodeIndex, completedNode);
  return makeResult(
    upsertChain(state, advanced),
    [],
    [chainAdvanceJobDraft(advanced, nextDay(ctx.worldDay))],
  );
}

// 正式成員離隊 → 重新驗證隊伍可否繼續；無合法正式成員時中止 Chain（doc §4.2、§6 不變量）。
// 中止後 npcChainAdvance 對已收斂 Chain 冪等 no-op，因此不需要取消已排的 Job。
export function onTeamMemberDeparted(
  state: NpcBehaviorState,
  event: TeamMemberDepartedEvent,
  ctx: NpcBehaviorContext,
): ModuleResult<NpcBehaviorState> {
  const controller = tryGetController(state, event.teamId);
  if (controller === undefined) return makeResult(state);

  const chain = activeChainForTeam(state, event.teamId);
  if (chain === undefined) return makeResult(state);
  if (ctx.team.listFormalMembers(event.teamId).length > 0) return makeResult(state);

  const step = abortChain(
    state,
    chain,
    controller,
    rejection('npcBehavior.chain.noFormalMembers', {
      chainId: String(chain.chainId),
      departedCharacterId: String(event.characterId),
    }),
    ctx,
    chain.rngContext.cursor,
  );
  return makeResult(step.state, step.messages, step.scheduledJobs);
}
