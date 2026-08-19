// modules/social/system.ts
// Social 模組的純函式 Handler（對應 docs/00_core/architecture/23_social_module.md §4）。
//
// 設計原則：
//   * 全部為決定性純函式：不做 I/O、不呼叫 Math.random / Date.now。
//   * 需要「當前世界日」「靜態資料」「Team 事實」「新 ID」「機率結果」時，一律經由注入的
//     SocialHandlerContext 取得；RNG 只藏在 Resolver Port 內，並以顯式 rngContext 傳入。
//   * 可拒絕的 Handler（Game Command／Internal Command）一律回傳 ModuleOutcome<SocialState>。
//   * Handler 不 mutate 傳入 state；一律回傳新物件。
//   * Handler 內沒有任何玩法數值：好感度上下限、初始值、每次交流變化量、求婚門檻、家教價格修正、
//     每日對話上限，全部來自 Definition 與 Rule 的 Resolver。
//
// 責任邊界（doc 首段「非責任」）：
//   * 家族／婚姻狀態屬 character。求婚接受時送 character 的 CreatePartnerFamilyLink，
//     引用 contracts/character 的真實型別；自我求婚、同性、未成年、已有配偶等硬條件由
//     character 的 handleCreatePartnerFamilyLink 判定，本模組不重複實作、不自建家族 State。
//   * 交流熟練度（MXP）屬 progression。本模組只發 PlayerConversationCompleted 並帶上
//     Rule 指定的 experienceAwardRuleId，不計算任何經驗值。

import type {
  CharacterId,
  InteractionId,
  ModuleId,
  ModuleOutcome,
  ModuleResult,
  ResolverId,
  Revision,
  RngContext,
  RngStep,
  CommandRejection,
  DomainEventDraft,
  InternalCommandDraft,
  TransactionMessageDraft,
  PlayerAffinityRuleId,
  PlayerConversationRuleId,
  PlayerConversationUsageId,
  SocialSystemDefinitionId,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type {
  SocialDefinitionReader,
  InteractWithAdventurerCommand,
  ProposeMarriageToTeamMemberCommand,
  ProvisionPlayerAffinityCommand,
  ConsumePlayerConversationAllowanceCommand,
  PlayerConversationKind,
  PlayerConversationCompletedPayload,
  PlayerAffinityChangedPayload,
  SocialDomainEvent,
} from '../../contracts/social';

// 跨模組引用（僅型別 import；接收端契約的真實型別，不自行複寫欄位）。
import type { TeamQuery } from '../../contracts/team';
import type { CreatePartnerFamilyLink } from '../../contracts/character';

import type { SocialState, PlayerConversationDailyUsage } from './state';
import {
  bump,
  clampAffinity,
  completedCountForDay,
  isInteractionApplied,
  setConversationUsage,
  tryGetAffinity,
  upsertAffinity,
  usageForDay,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組身分（規範明列的合法程式內常數：Module ID 是身分，不是量）
// ──────────────────────────────────────────────────────────────────────────

export const SOCIAL_MODULE_ID = 'social' as ModuleId<'social'>;
const CHARACTER_MODULE_ID = 'character' as ModuleId<'character'>;

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port：讓 Handler 保持純函式。真實組合由 Composition 注入；測試注入決定性 stub。
// ──────────────────────────────────────────────────────────────────────────

// 交易私有的 ID 配發器（背後由 Kernel RuntimeIdGenerator + 交易 cursor 提供）。
//
// InteractionId：一次交流／一次額度消耗就是一筆 Interaction，而好感度事件的 sourceId 與
// PlayerConversationCompleted 的 interactionId 都要求它。ProvisionPlayerAffinity 的命令沒有帶
// interactionId（contracts/social §4.2），所以 provisioning 事件的來源 ID 也在此配發。
export interface SocialIdAllocator {
  nextPlayerConversationUsageId(): PlayerConversationUsageId;
  nextInteractionId(): InteractionId;
}

// 窄化 team Port（§7.1 慣例：消費者只宣告自己要的方法）。以 Pick 直接取 contracts/team 的真實
// 方法簽章，而不是手抄一份同名介面——手抄的那份不會隨 TeamQuery 一起演化，型別檢查也看不出落差。
//
// 本模組需要的 team 事實：誰是目前玩家主角、玩家隊是哪一支、隊伍位置、正式成員名單、
// 同城酒館可見冒險者名單。全部唯讀。
export type SocialTeamQuery = Pick<
  TeamQuery,
  | 'getPlayerTeamId'
  | 'getPlayerControlledCharacterId'
  | 'getLocation'
  | 'listFormalMembers'
  | 'listTavernVisitorIds'
>;

// 資料調校 Resolver 的 deterministic 子集。Query 不得推進世界狀態，因此不得消耗 RNG——
// 求婚好感判定與家教價格修正兩者也**必須**是 deterministic（doc §2：低於條件時重送同一狀態
// 只會得到相同拒絕，不能靠零時間洗骰）。把它們獨立成介面，讓「不能擲骰」由型別表達。
export interface SocialDeterministicResolverPort {
  resolvePlayerProposalAcceptance(
    input: Readonly<{
      resolverId: ResolverId;
      ruleId: PlayerAffinityRuleId;
      adventurerId: CharacterId;
      affinityValue: number;
    }>,
  ): boolean;
  resolveHomeTutorPriceModifier(
    input: Readonly<{
      resolverId: ResolverId;
      ruleId: PlayerAffinityRuleId;
      adventurerId: CharacterId;
      affinityValue: number;
    }>,
  ): number;
}

// Handler 用的完整 Resolver Port。好感度初始值與每次交流變化量都是 Rule 資料；資料是否要在其中
// 擲骰由 Resolver 自己決定，所以回傳 RngStep<number>（value=本次數值、nextCursor=續接游標），
// 由呼叫端顯式串接。resolverId 一律由 Rule Definition 供給，不在程式內對照。
export interface SocialResolverPort extends SocialDeterministicResolverPort {
  resolveInitialAffinity(
    input: Readonly<{
      resolverId: ResolverId;
      ruleId: PlayerAffinityRuleId;
      adventurerId: CharacterId;
      rngContext?: RngContext;
    }>,
  ): RngStep<number>;
  resolveConversationDelta(
    input: Readonly<{
      resolverId: ResolverId;
      ruleId: PlayerAffinityRuleId;
      adventurerId: CharacterId;
      playerCharacterId: CharacterId;
      kind: PlayerConversationKind;
      currentValue: number;
      rngContext?: RngContext;
    }>,
  ): RngStep<number>;
}

export type SocialHandlerContext = Readonly<{
  worldDay: WorldDay;
  definitions: SocialDefinitionReader;
  // 目前生效的 Social System Definition（與 TeamHandlerContext.memberRetentionRuleId 同一慣例：
  // Composition 由內容供給，Handler 只負責帶入並讀取）。由它取得每日對話 Rule ID。
  socialSystemDefinitionId: SocialSystemDefinitionId;
  team: SocialTeamQuery;
  ids: SocialIdAllocator;
  resolvers: SocialResolverPort;
  rngContext?: RngContext;
}>;

// ──────────────────────────────────────────────────────────────────────────
// Handler 回傳型別
// ──────────────────────────────────────────────────────────────────────────

export type SocialHandlerResult = ModuleOutcome<SocialState>;

// ──────────────────────────────────────────────────────────────────────────
// 小工具
// ──────────────────────────────────────────────────────────────────────────

function emit(event: SocialDomainEvent): DomainEventDraft<unknown> {
  return { event };
}

function send(command: CreatePartnerFamilyLink): InternalCommandDraft<unknown> {
  return { targetModule: CHARACTER_MODULE_ID, command };
}

function makeResult(
  nextSlice: SocialState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
): ModuleResult<SocialState> {
  return { nextSlice, outgoingMessages, scheduledJobs: [] };
}

function accept(
  nextSlice: SocialState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
): SocialHandlerResult {
  return { ok: true, result: makeResult(nextSlice, outgoingMessages) };
}

function reject(
  code: string,
  details?: CommandRejection['details'],
): SocialHandlerResult {
  return { ok: false, rejection: { code, source: SOCIAL_MODULE_ID, details } };
}

// 一次互動實際套用的好感度變化總量。
//
// 為什麼是「一串變化的和」而不是一個數字欄位：打聽情報沒有交流對象（contracts/social 的
// targetCharacterId 是選填），因此**沒有任何**好感度被套用，而 PlayerConversationCompleted 的
// affinityDelta 仍是必填。空集合的和是加法單位元 0——那是算術性質，不是「缺資料時給個 0」。
type AffinityChange = Readonly<{ oldValue: number; newValue: number }>;

function totalAffinityDelta(changes: readonly AffinityChange[]): number {
  return changes.reduce((sum, c) => sum + (c.newValue - c.oldValue), 0);
}

// 當日用量 +1 並記下已套用的 Interaction ID；今天尚無記錄時建立新的一筆（整筆替換舊日）。
function advanceUsage(
  existing: PlayerConversationDailyUsage | undefined,
  input: Readonly<{
    playerCharacterId: CharacterId;
    worldDay: WorldDay;
    ruleId: PlayerConversationRuleId;
    interactionId: InteractionId;
    ids: SocialIdAllocator;
  }>,
): PlayerConversationDailyUsage {
  if (existing === undefined) {
    return {
      usageId: input.ids.nextPlayerConversationUsageId(),
      playerCharacterId: input.playerCharacterId,
      worldDay: input.worldDay,
      ruleId: input.ruleId,
      completedCount: 1,
      appliedInteractionIds: [input.interactionId],
      revision: 0 as Revision,
    };
  }
  return {
    ...existing,
    completedCount: existing.completedCount + 1,
    appliedInteractionIds: [...existing.appliedInteractionIds, input.interactionId],
    revision: bump(existing.revision),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// §4.1 玩家 Game Command — 交流
// ──────────────────────────────────────────────────────────────────────────
//
// 零時間完成一次交流、計數 +1、依資料調整目標對玩家的好感度，並發出一次玩家交流成長來源
// （PlayerConversationCompleted；MXP 由 progression 依該事件發放）。
export function handleInteractWithAdventurer(
  state: SocialState,
  cmd: InteractWithAdventurerCommand,
  ctx: SocialHandlerContext,
): SocialHandlerResult {
  const playerCharacterId = ctx.team.getPlayerControlledCharacterId();
  const target = cmd.targetCharacterId;

  // 玩家主角自己不建立可用好感度，也不能與自己交流（doc §1）。
  if (target === playerCharacterId) {
    return reject('social/target-is-player-character', { targetCharacterId: String(target) });
  }

  // 目標必須是已完成 Affinity Provisioning 的非玩家真實冒險者。缺記錄不是「好感度為 0」——
  // 是這個角色根本沒有對玩家的好感度可調整（Quest Temporary 角色、背景居民、Child Team 成員）。
  const affinity = tryGetAffinity(state, target);
  if (affinity === undefined) {
    return reject('social/affinity-not-provisioned', { targetCharacterId: String(target) });
  }

  // 同隊正式成員隨時可交流（不要求城市設施）；否則必須是玩家目前所在城的酒館可見冒險者。
  const teamId = ctx.team.getPlayerTeamId();
  const kind = conversationKindOf(ctx, teamId, target);
  if (kind === undefined) {
    return reject('social/target-not-reachable', { targetCharacterId: String(target) });
  }

  const system = ctx.definitions.getSocialSystem(ctx.socialSystemDefinitionId);
  const conversationRule = ctx.definitions.getPlayerConversationRule(system.playerConversationRuleId);
  const completed = completedCountForDay(state, playerCharacterId, ctx.worldDay);
  if (completed >= conversationRule.maxCompletedPerDay) {
    return reject('social/daily-conversation-limit-reached', {
      completedCount: completed,
      maxCompletedPerDay: conversationRule.maxCompletedPerDay,
    });
  }

  // 好感度規則取自該筆好感度自己的 ruleId（它是這筆記錄的治理規則），不是全域系統定義。
  const affinityRule = ctx.definitions.getPlayerAffinityRule(affinity.ruleId);
  const delta = ctx.resolvers.resolveConversationDelta({
    resolverId: affinityRule.conversationDeltaResolverId,
    ruleId: affinity.ruleId,
    adventurerId: target,
    playerCharacterId,
    kind,
    currentValue: affinity.value,
    ...(ctx.rngContext === undefined ? {} : { rngContext: ctx.rngContext }),
  });
  const newValue = clampAffinity(
    affinity.value + delta.value,
    affinityRule.minValue,
    affinityRule.maxValue,
  );

  const interactionId = ctx.ids.nextInteractionId();
  const change: AffinityChange = { oldValue: affinity.value, newValue };

  let next = upsertAffinity(state, {
    ...affinity,
    value: newValue,
    revision: bump(affinity.revision),
  });
  next = setConversationUsage(
    next,
    advanceUsage(usageForDay(state, playerCharacterId, ctx.worldDay), {
      playerCharacterId,
      worldDay: ctx.worldDay,
      ruleId: system.playerConversationRuleId,
      interactionId,
      ids: ctx.ids,
    }),
  );

  const completedEvent: PlayerConversationCompletedPayload = {
    type: 'PlayerConversationCompleted',
    interactionId,
    playerCharacterId,
    targetCharacterId: target,
    kind,
    worldDay: ctx.worldDay,
    experienceAwardRuleId: conversationRule.experienceAwardRuleId,
    affinityDelta: totalAffinityDelta([change]),
  };
  const affinityEvent: PlayerAffinityChangedPayload = {
    type: 'PlayerAffinityChanged',
    adventurerId: target,
    oldValue: change.oldValue,
    newValue: change.newValue,
    sourceId: interactionId,
    reason: 'conversation',
  };

  return accept(next, [emit(completedEvent), emit(affinityEvent)]);
}

// 目標與玩家的關係決定對話種類；兩者皆不成立時目標不可交流。
// 「哪一種關係對應哪一個 kind」是規則形狀（contracts/social 的 PlayerConversationKind 判別值），
// 不是可調數值。
function conversationKindOf(
  ctx: SocialHandlerContext,
  teamId: TeamId,
  target: CharacterId,
): PlayerConversationKind | undefined {
  if (ctx.team.listFormalMembers(teamId).includes(target)) return 'partyChat';
  const location = ctx.team.getLocation(teamId);
  if (location.kind !== 'city') return undefined;
  if (!ctx.team.listTavernVisitorIds(location.cityId).includes(target)) return undefined;
  return 'tavernChat';
}

// ──────────────────────────────────────────────────────────────────────────
// §4.1 玩家 Game Command — 求婚
// ──────────────────────────────────────────────────────────────────────────
//
// 本模組負責的是**好感度門檻**與求婚流程的收斂：接受時送 character 的 CreatePartnerFamilyLink，
// 拒絕時不改任何 State。求婚不消耗世界時間也不消耗每日對話次數（doc §4.1、§6.1）。
//
// 為什麼「好感度不足」用 reject 而不是「接受但不做事」：判定是 deterministic 的（doc §2 明訂
// 不得消耗 RNG），所以重送同一狀態必然得到同一結果——沒有 team 招募那種「拒絕會回滾交易 cursor
// 導致永遠擲同一顆骰」的問題。既然如此，把「沒有發生任何事」表達成拒絕才讓呼叫端看得見原因；
// 回傳未變 state 假裝成功是規範點名的偽裝。
export function handleProposeMarriageToTeamMember(
  state: SocialState,
  cmd: ProposeMarriageToTeamMemberCommand,
  ctx: SocialHandlerContext,
): SocialHandlerResult {
  const playerCharacterId = ctx.team.getPlayerControlledCharacterId();
  const target = cmd.targetCharacterId;
  if (target === playerCharacterId) {
    return reject('social/target-is-player-character', { targetCharacterId: String(target) });
  }

  // 隊友身分只在求婚當下是硬條件（doc §6.1）。這是 team 擁有的事實，走窄化 Query。
  const teamId = ctx.team.getPlayerTeamId();
  if (!ctx.team.listFormalMembers(teamId).includes(target)) {
    return reject('social/target-not-formal-member', { targetCharacterId: String(target) });
  }

  const affinity = tryGetAffinity(state, target);
  if (affinity === undefined) {
    return reject('social/affinity-not-provisioned', { targetCharacterId: String(target) });
  }

  const affinityRule = ctx.definitions.getPlayerAffinityRule(affinity.ruleId);
  const accepted = ctx.resolvers.resolvePlayerProposalAcceptance({
    resolverId: affinityRule.playerProposalAcceptanceResolverId,
    ruleId: affinity.ruleId,
    adventurerId: target,
    affinityValue: affinity.value,
  });
  if (!accepted) {
    return reject('social/proposal-affinity-too-low', {
      targetCharacterId: String(target),
      ruleId: String(affinity.ruleId),
    });
  }

  // 成年、存活、異性、雙方皆未婚等硬條件由 character 的 handleCreatePartnerFamilyLink 判定；
  // 這裡不重複實作，也不寫任何家族 State。Social Slice 因此不變——效果全在外送命令。
  const link: CreatePartnerFamilyLink = {
    type: 'CreatePartnerFamilyLink',
    characterIds: [playerCharacterId, target],
    sourceId: playerCharacterId,
  };
  return accept(state, [send(link)]);
}

// ──────────────────────────────────────────────────────────────────────────
// §4.2 Internal Command — Affinity Provisioning
// ──────────────────────────────────────────────────────────────────────────
//
// 由 new-game／character-provisioning／adulthood workflow 送出：對新建立或剛取得冒險者身分的
// 非玩家真實冒險者依 Rule 建立**唯一**初始值。重送必須冪等（doc §4.2、不變量 1／10）。
export function handleProvisionPlayerAffinity(
  command: ProvisionPlayerAffinityCommand,
  state: SocialState,
  ctx: SocialHandlerContext,
): SocialHandlerResult {
  const playerCharacterId = ctx.team.getPlayerControlledCharacterId();
  if (command.adventurerId === playerCharacterId) {
    return reject('social/target-is-player-character', {
      adventurerId: String(command.adventurerId),
    });
  }

  const existing = tryGetAffinity(state, command.adventurerId);
  if (existing !== undefined) {
    // 同一 Rule 重送：這件事已經發生過了，且資料齊全時仍然什麼都不該做——契約明訂的冪等
    // （doc §4.2「重送必須冪等」、不變量 1「至多一筆 PlayerAffinityState」）。
    if (existing.ruleId === command.ruleId) return accept(state);
    // 換了 Rule 重送不是冪等，而是兩份互相矛盾的治理規則。靜默保留舊值會讓內容作者以為新規則生效了。
    return reject('social/affinity-rule-conflict', {
      adventurerId: String(command.adventurerId),
      existingRuleId: String(existing.ruleId),
      requestedRuleId: String(command.ruleId),
    });
  }

  const rule = ctx.definitions.getPlayerAffinityRule(command.ruleId);
  const initial = ctx.resolvers.resolveInitialAffinity({
    resolverId: rule.initialValueResolverId,
    ruleId: command.ruleId,
    adventurerId: command.adventurerId,
    ...(ctx.rngContext === undefined ? {} : { rngContext: ctx.rngContext }),
  });
  const value = clampAffinity(initial.value, rule.minValue, rule.maxValue);

  const next = upsertAffinity(state, {
    adventurerId: command.adventurerId,
    ruleId: command.ruleId,
    value,
    revision: 0 as Revision,
  });

  // provisioning 沒有前值（oldValue 選填即代表「此前不存在」），sourceId 用本次配發的 Interaction ID。
  const event: PlayerAffinityChangedPayload = {
    type: 'PlayerAffinityChanged',
    adventurerId: command.adventurerId,
    newValue: value,
    sourceId: ctx.ids.nextInteractionId(),
    reason: 'provisioned',
  };
  return accept(next, [emit(event)]);
}

// ──────────────────────────────────────────────────────────────────────────
// §4.2 Internal Command — 情報額度消耗
// ──────────────────────────────────────────────────────────────────────────
//
// 由 City Intel Workflow 送出：驗證玩家主角與當日上限，計數 +1 並發出
// PlayerConversationCompleted(kind=intel)。City 的情報揭露失敗時整筆交易回滾——因此本 Handler
// 不需要補償路徑，只要保證「被拒絕就不改 State」。
//
// 打聽情報沒有交流對象，因此不套用任何好感度：affinityDelta 是空變化集合的和。
export function handleConsumePlayerConversationAllowance(
  command: ConsumePlayerConversationAllowanceCommand,
  state: SocialState,
  ctx: SocialHandlerContext,
): SocialHandlerResult {
  // 世界日由 Kernel 獨占，命令帶來的世界日只能與之相符；不符即為送錯世界日，不是可推導的重置。
  if (command.worldDay !== ctx.worldDay) {
    return reject('social/world-day-mismatch', {
      commandWorldDay: command.worldDay,
      currentWorldDay: ctx.worldDay,
    });
  }

  const playerCharacterId = ctx.team.getPlayerControlledCharacterId();
  if (command.playerCharacterId !== playerCharacterId) {
    return reject('social/not-player-character', {
      playerCharacterId: String(command.playerCharacterId),
    });
  }

  // 同一 Interaction ID 最多套用一次（不變量 2）：重送已套用過的那一筆是冪等，不再計數。
  if (isInteractionApplied(state, playerCharacterId, ctx.worldDay, command.interactionId)) {
    return accept(state);
  }

  const system = ctx.definitions.getSocialSystem(ctx.socialSystemDefinitionId);
  const conversationRule = ctx.definitions.getPlayerConversationRule(system.playerConversationRuleId);
  const completed = completedCountForDay(state, playerCharacterId, ctx.worldDay);
  if (completed >= conversationRule.maxCompletedPerDay) {
    return reject('social/daily-conversation-limit-reached', {
      completedCount: completed,
      maxCompletedPerDay: conversationRule.maxCompletedPerDay,
    });
  }

  const next = setConversationUsage(
    state,
    advanceUsage(usageForDay(state, playerCharacterId, ctx.worldDay), {
      playerCharacterId,
      worldDay: ctx.worldDay,
      ruleId: system.playerConversationRuleId,
      interactionId: command.interactionId,
      ids: ctx.ids,
    }),
  );

  const completedEvent: PlayerConversationCompletedPayload = {
    type: 'PlayerConversationCompleted',
    interactionId: command.interactionId,
    playerCharacterId,
    kind: 'intel',
    worldDay: ctx.worldDay,
    experienceAwardRuleId: conversationRule.experienceAwardRuleId,
    affinityDelta: totalAffinityDelta([]),
  };
  return accept(next, [emit(completedEvent)]);
}
