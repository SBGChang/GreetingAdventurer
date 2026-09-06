// modules/quest/system.ts
// Quest 模組的純函式 Handler / Job / Subscriber（docs/00_core/architecture/10_quest_module.md §5–§9）。
//
// 設計原則：
//   * 全部為決定性純函式：不做 I/O、不呼叫 Math.random / Date.now；世界日由注入的 ctx 取。
//   * Quest 只寫自己的 Slice；別的模組的狀態一律以 Internal Command 請求（doc §6）。
//   * 目標完成的判定**只來自 Domain Event**（doc §5.3）：Quest 不掃描別的模組 State，
//     而是把事件累計進自己的 QuestObjectiveProgress。
//   * Quest Handler 不算錢、不算 MXP、不發物品（doc §2.5）：報酬只保存 Reward Rule 引用。
//   * 期限天數、獎勵量、聲望效果全是 Definition 資料；本檔沒有任何玩法數值常數。
//
// 期限 Job 的存活判定刻意**不用** expectedRevision：接取會 bump Quest revision，但依 doc §2.4
// 接取不修改兩個 deadline，因此該筆 Job 仍然有效。掛一個會讓 Job 被判死的 expectedRevision，
// 等於讓「接取過的任務永遠不會到期」。Job 一律以當前 Slice 重新判斷該做什麼。

import type {
  CharacterId,
  CityId,
  ContentInstanceId,
  DeterministicRng,
  DomainEventDraft,
  MapInstanceId,
  ResolverId,
  RngContext,
  RngStep,
  InternalCommandDraft,
  ModuleId,
  ModuleOutcome,
  ModuleResult,
  QuestId,
  Revision,
  TeamId,
  WorldDay,
  FacilityDefinitionId,
} from '../../contracts/core';
import type {
  NpcQuestClaimState,
  QuestDefinitionReader,
  QuestDeadlineJob,
  QuestDomainEvent,
  QuestKind,
  QuestObjective,
  QuestReactionSourceKind,
  QuestStateChangeReason,
  QuestStatus,
  AcceptQuestCommand,
  AcceptQuestForNpcTeamCommand,
  ClaimQuestForNpcTeamCommand,
  ReleaseNpcQuestClaimCommand,
  QuestOutboundInternalCommand,
} from '../../contracts/quest';

// 跨模組引用（僅型別 import；外送命令一律用接收模組契約的真實型別）。
import type { CityStockItemAvailable } from '../../contracts/city';
import type {
  MapContentGenerated,
  MapContentKind,
  MapContentResolved,
  MapContentView,
} from '../../contracts/map';
import type { TeamLocation, TeamLocationChangedEvent } from '../../contracts/team';
import type { CombatEncounterResolvedPayload } from '../../contracts/combat';
import type { CharacterCreatedEvent, CharacterDiedEvent, TemporaryCharacterOrigin } from '../../contracts/character';

import {
  bumpRevision,
  clearClaim,
  emptyObjectiveProgress as EMPTY_OBJECTIVE_PROGRESS,
  hasAllTargetsResolved,
  listQuestsOrdered,
  objectiveCharacterId,
  objectiveCompletionContentIds,
  setClaim,
  tryGetClaim,
  tryGetQuest,
  updateQuest,
  withResolvedTarget,
  type NpcQuestClaim,
  type QuestInstance,
  type QuestState,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組身分（程式身分，不是內容 ID）
// ──────────────────────────────────────────────────────────────────────────

export const QUEST_MODULE_ID = 'quest' as ModuleId<'quest'>;

const MAP_MODULE_ID = 'map' as ModuleId;
const CHARACTER_MODULE_ID = 'character' as ModuleId;

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port（§7.1 慣例：模組宣告本地窄化型別，實作由 Composition 注入）
// ──────────────────────────────────────────────────────────────────────────

// Quest 不擁有隊伍位置與成員（doc §1.2）：接取前置與成員快照都經此唯讀 Port。
export interface QuestTeamPort {
  getLocation(teamId: TeamId): TeamLocation;
  listFormalMembers(teamId: TeamId): readonly CharacterId[];
}

// Quest 不擁有地圖內容（doc §1.2）：救援目標的被擄者原型住在 map 的 content payload。
export interface QuestMapContentPort {
  getContent(contentId: ContentInstanceId): MapContentView | undefined;
}

// 任務角色（護衛／救援）由 character 建立；Quest 只能反查「這個角色是為哪一筆 Quest 建的」，
// 才能把 Runtime CharacterId 綁回 Objective（doc §3.3：綁定 Runtime Instance ID）。
export interface QuestTemporaryCharacterPort {
  getTemporaryOrigin(characterId: CharacterId): TemporaryCharacterOrigin | undefined;
}

export type QuestHandlerContext = Readonly<{
  worldDay: WorldDay;
  definitions: QuestDefinitionReader;
  teams: QuestTeamPort;
  mapContents: QuestMapContentPort;
  characters: QuestTemporaryCharacterPort;
}>;

// 委託生成需要三件既有 Context 沒有的東西：鑄 QuestId、擲骰、以及兩個生成 Resolver。
// 它們只在生成這條路上用得到，所以擴充成一個獨立的 Context，而不是讓每個既有 Handler
// 都被迫接受四個它們永遠不讀的欄位。
export interface QuestIdAllocator {
  nextQuestId(): QuestId;
}

// 生成期的兩個 Resolver（都由內容的規則指名 resolverId）：
//   * guild        這筆委託貼在哪座城的公會（local-city／random-legal-city…）
//   * actualEnd    從接取期限起算，還有幾天可以完成
// 這座城的冒險者公會設施。送貨的收貨點要用它。窄到只回一個 id：quest 不需要知道城裡還有什麼。
export interface QuestCityPort {
  getGuildFacilityId(cityId: CityId): FacilityDefinitionId | undefined;
}

export interface QuestGenerationResolverPort {
  resolveGuildCity(
    input: Readonly<{ resolverId: ResolverId; mapId: MapInstanceId; rngContext: RngContext }>,
  ): RngStep<CityId>;
  resolveActualEndDays(
    input: Readonly<{ resolverId: ResolverId; rngContext: RngContext }>,
  ): RngStep<number>;
  // 送貨目的地：一座**不是出發地**的城。
  resolveDeliveryDestination(
    input: Readonly<{ resolverId: ResolverId; excludeCityId: CityId; rngContext: RngContext }>,
  ): RngStep<CityId>;
}

export type QuestGenerationContext = QuestHandlerContext &
  Readonly<{
    ids: QuestIdAllocator;
    rng: DeterministicRng;
    rngContext: RngContext;
    resolvers: QuestGenerationResolverPort;
    cities: QuestCityPort;
  }>;

export type QuestHandlerResult = ModuleOutcome<QuestState>;

// ──────────────────────────────────────────────────────────────────────────
// 訊息小工具
// ──────────────────────────────────────────────────────────────────────────

type Outgoing = DomainEventDraft<unknown> | InternalCommandDraft<unknown>;

function emit(event: QuestDomainEvent): DomainEventDraft<unknown> {
  return { event };
}

function internal(
  targetModule: ModuleId,
  command: QuestOutboundInternalCommand,
): InternalCommandDraft<unknown> {
  return { targetModule, command };
}

function makeResult(
  nextSlice: QuestState,
  outgoingMessages: readonly Outgoing[] = [],
): ModuleResult<QuestState> {
  return { nextSlice, outgoingMessages, scheduledJobs: [] };
}

function accept(
  nextSlice: QuestState,
  outgoingMessages: readonly Outgoing[] = [],
): QuestHandlerResult {
  return { ok: true, result: makeResult(nextSlice, outgoingMessages) };
}

function reject(
  code: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): QuestHandlerResult {
  return { ok: false, rejection: { code, source: QUEST_MODULE_ID, ...(details ? { details } : {}) } };
}

function stateChanged(
  questId: QuestId,
  oldStatus: QuestStatus,
  newStatus: QuestStatus,
  reason: QuestStateChangeReason,
): DomainEventDraft<unknown> {
  return emit({ type: 'QuestStateChanged', questId, oldStatus, newStatus, reason });
}

function claimChanged(
  questId: QuestId,
  state: NpcQuestClaimState,
  teamId?: TeamId,
  chainId?: NpcQuestClaim['chainId'],
): DomainEventDraft<unknown> {
  return emit({
    type: 'NpcQuestClaimChanged',
    questId,
    state,
    ...(teamId === undefined ? {} : { teamId }),
    ...(chainId === undefined ? {} : { chainId }),
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 能力邊界：哪些 QuestKind 的整條生命週期已閉合
//
// 一筆 Quest 從接取走到「完成結案」或「到期清理」會需要別的模組的 Internal Command Handler。
// 註冊表裡缺少的那幾筆，讓下列 kind 的**清理流程跑不完**——接了就會留下永久鎖在
// teamQuestCargo 的任務物或永久保留的商店 Offer。規範的五個合法出口裡沒有「先接了再說」，
// 所以這裡走出口四：回一個指名缺口的 typed rejection。
//
// 兩張表刻意分開：能不能接取、與到期時能不能清乾淨，是兩個不同的問題。
// 表變短的條件是那些 Handler 真的落地，不是改這裡的措辭。

// 接取端：接下去就會需要、但現在拿不到的東西。
const MISSING_ACCEPT_DEPENDENCY: Readonly<Partial<Record<QuestKind, string>>> = {
  // 指定 Offer 要在期限內保留／標示（doc §6、§9.1）。
  purchase: 'city.ReserveShopOfferForQuest',
  // 接取即把指定 Item 移入 teamQuestCargo，而到期時必須能把它交給團隊分配（不變量 13）。
  delivery: 'inventory.ReleaseExpiredQuestCargo',
  exploration: 'inventory.ReleaseExpiredQuestCargo',
  // 護衛候選的身分原型只有 city 的 EscortCandidate 知道；取不到就無法建立護衛角色（doc §6）。
  escort: 'city.EscortCandidateQuery',
};

// 期限端：到期時綁定的實體必須被處置，否則會永久卡住。
// 未接取的購買／送貨：Item 仍在保留位置／指定店面，需 ApplyQuestItemLifecycle(remove)（doc §9.1）。
const MISSING_UNACCEPTED_EXPIRY_CLEANUP: Readonly<Partial<Record<QuestKind, string>>> = {
  purchase: 'inventory.ApplyQuestItemLifecycle',
  delivery: 'inventory.ApplyQuestItemLifecycle',
};

// 已接取且仍鎖在 teamQuestCargo：需 ReleaseExpiredQuestCargo + Asset Distribution（不變量 13）。
const MISSING_ACCEPTED_EXPIRY_CLEANUP: Readonly<Partial<Record<QuestKind, string>>> = {
  purchase: 'inventory.ReleaseExpiredQuestCargo',
  delivery: 'inventory.ReleaseExpiredQuestCargo',
  exploration: 'inventory.ReleaseExpiredQuestCargo',
};

function missingAcceptDependency(kind: QuestKind): string | undefined {
  return MISSING_ACCEPT_DEPENDENCY[kind];
}

// 到期清理缺口依「有沒有被接取」分流：未接取的護衛／救援／鎮壓／討伐沒有任何綁定實體要清，
// 不該因為別的 kind 缺 Handler 就被一起擋下。
function missingExpiryCleanup(quest: QuestInstance): string | undefined {
  return quest.acceptedByTeamId === undefined
    ? MISSING_UNACCEPTED_EXPIRY_CLEANUP[quest.kind]
    : MISSING_ACCEPTED_EXPIRY_CLEANUP[quest.kind];
}

// ──────────────────────────────────────────────────────────────────────────
// 內部：狀態轉換
// ──────────────────────────────────────────────────────────────────────────

// 接取時要對別的模組發出的保護／建立請求（doc §5.1、§9.2）。
function acceptSideEffects(quest: QuestInstance): readonly Outgoing[] {
  if (quest.objective.kind === 'rescue') {
    return [
      internal(MAP_MODULE_ID, {
        type: 'ProtectMapContent',
        contentId: quest.objective.contentId,
        mode: 'protect',
        questId: quest.questId,
      }),
    ];
  }
  return [];
}

// 到期／目標死亡時解除接取當下建立的保護（doc §9.2：已到期即解除保護）。
function releaseProtection(quest: QuestInstance): readonly Outgoing[] {
  if (quest.acceptedByTeamId === undefined) return [];
  if (quest.objective.kind !== 'rescue') return [];
  return [
    internal(MAP_MODULE_ID, {
      type: 'ProtectMapContent',
      contentId: quest.objective.contentId,
      mode: 'release',
      questId: quest.questId,
    }),
  ];
}

// 到期是終止狀態（doc §3.2）：不發 QuestFailed，只改狀態 + 清理 + 不留孤兒 Claim。
function expireQuest(
  state: QuestState,
  quest: QuestInstance,
  reason: QuestStateChangeReason,
): Readonly<{ state: QuestState; messages: readonly Outgoing[] }> {
  const expired: QuestInstance = {
    ...quest,
    status: 'expired',
    revision: bumpRevision(quest.revision),
  };
  const claim = tryGetClaim(state, quest.questId);
  const withoutClaim = clearClaim(updateQuest(state, expired), quest.questId);
  const messages: Outgoing[] = [
    stateChanged(quest.questId, quest.status, 'expired', reason),
    ...releaseProtection(quest),
  ];
  if (claim !== undefined) {
    messages.push(claimChanged(quest.questId, 'released', claim.teamId, claim.chainId));
  }
  return { state: withoutClaim, messages };
}

// incomplete → completed（doc §8）。完成只代表達成條件，報酬仍須回原公會結案。
function completeQuest(
  state: QuestState,
  quest: QuestInstance,
  onDay: WorldDay,
  extraMessages: readonly Outgoing[] = [],
): Readonly<{ state: QuestState; messages: readonly Outgoing[] }> {
  const completed: QuestInstance = {
    ...quest,
    status: 'completed',
    completedOnDay: onDay,
    revision: bumpRevision(quest.revision),
  };
  return {
    state: updateQuest(state, completed),
    messages: [
      emit({ type: 'QuestObjectiveCompleted', questId: quest.questId, completedOnDay: onDay }),
      stateChanged(quest.questId, quest.status, 'completed', 'completedUnsettled'),
      ...extraMessages,
    ],
  };
}

// 接取的共同驗證與寫入（玩家與 NPC 共用，doc §5.1.1：不建立第二套 NPC 任務狀態）。
function applyAccept(
  state: QuestState,
  questId: QuestId,
  teamId: TeamId,
  ctx: QuestHandlerContext,
): QuestHandlerResult {
  const quest = tryGetQuest(state, questId);
  if (quest === undefined) return reject('quest/unknown-quest', { questId: String(questId) });
  if (quest.status !== 'unaccepted') {
    return reject('quest/not-unaccepted', { questId: String(questId), status: quest.status });
  }
  // 半開區間（doc §2.4）：currentDay < acceptDeadline 才合法。
  if (ctx.worldDay >= quest.acceptDeadline) {
    return reject('quest/accept-deadline-passed', {
      questId: String(questId),
      worldDay: ctx.worldDay,
      acceptDeadline: quest.acceptDeadline,
    });
  }
  const location = ctx.teams.getLocation(teamId);
  if (location.kind !== 'city' || location.cityId !== quest.postingGuildCityId) {
    return reject('quest/team-not-at-posting-guild', {
      questId: String(questId),
      teamId: String(teamId),
      postingGuildCityId: String(quest.postingGuildCityId),
      location: location.kind,
    });
  }
  const missing = missingAcceptDependency(quest.kind);
  if (missing !== undefined) {
    return reject('quest/lifecycle-dependency-unavailable', {
      questId: String(questId),
      kind: quest.kind,
      missing,
    });
  }
  const members = ctx.teams.listFormalMembers(teamId);
  // 貨幣報酬以接取當下的正式成員平均發放（不變量 11）；沒有正式成員就沒有受益人，不可接取。
  if (members.length === 0) {
    return reject('quest/no-formal-members', { questId: String(questId), teamId: String(teamId) });
  }
  // 缺報酬 Definition 是壞內容：接了也永遠拿不到報酬，因此在接取當下就拒絕（規範出口四）。
  // 這裡攔例外**不是**為了繼續成功，而是把 Reader 的「不存在」轉成呼叫端看得見的 rejection。
  try {
    ctx.definitions.getQuestRewardRule(quest.rewardRuleId);
  } catch {
    return reject('quest/reward-rule-unreadable', {
      questId: String(questId),
      rewardRuleId: String(quest.rewardRuleId),
    });
  }

  const accepted: QuestInstance = {
    ...quest,
    status: 'incomplete',
    acceptedByTeamId: teamId,
    acceptedOnDay: ctx.worldDay,
    participantCharacterIds: [...members],
    revision: bumpRevision(quest.revision),
  };

  // 任何合法接取都必須在同一交易移除舊 Claim 並公告釋放（doc §3.1：不留孤兒 Claim）。
  const claim = tryGetClaim(state, questId);
  const nextState = clearClaim(updateQuest(state, accepted), questId);
  const messages: Outgoing[] = [
    emit({ type: 'QuestAccepted', questId, teamId, acceptedOnDay: ctx.worldDay }),
    ...acceptSideEffects(accepted),
  ];
  if (claim !== undefined) {
    messages.push(claimChanged(questId, 'released', claim.teamId, claim.chainId));
  }
  return accept(nextState, messages);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 玩家 Game Command
// ──────────────────────────────────────────────────────────────────────────

// 城內零時間 Command。actorTeamId 由 Router 自信封帶入（不由 payload 提供）。
export function handleAcceptQuest(
  state: QuestState,
  command: AcceptQuestCommand,
  actorTeamId: TeamId,
  ctx: QuestHandlerContext,
): QuestHandlerResult {
  return applyAccept(state, command.questId, actorTeamId, ctx);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1.1 NPC Internal Command
// ──────────────────────────────────────────────────────────────────────────

// 重用接取驗證，發出同一種 QuestAccepted（doc §5.1.1）。另加一條 Claim 歸屬檢查：
// 別的 NPC 隊持有 Claim 時，這支 Chain 不得搶接（玩家不受此限，見 handleAcceptQuest）。
export function handleAcceptQuestForNpcTeam(
  state: QuestState,
  command: AcceptQuestForNpcTeamCommand,
  ctx: QuestHandlerContext,
): QuestHandlerResult {
  const claim = tryGetClaim(state, command.questId);
  if (claim !== undefined && claim.teamId !== command.teamId) {
    return reject('quest/claim-held-by-other-team', {
      questId: String(command.questId),
      teamId: String(command.teamId),
      claimTeamId: String(claim.teamId),
    });
  }
  if (claim !== undefined && claim.chainId !== command.chainId) {
    return reject('quest/claim-source-mismatch', {
      questId: String(command.questId),
      chainId: String(command.chainId),
      claimChainId: String(claim.chainId),
    });
  }
  return applyAccept(state, command.questId, command.teamId, ctx);
}

// 只供 NPC 抽樣排他；不得阻止玩家 acceptQuest（doc §5.1.1）。
// 排他即「重複 claim 一律拒絕」：同隊同 chain 再送一次也是 rejection，不是冪等成功——
// Claim 的意義是「這一輪抽樣已經被佔用」，靜默接受第二筆會讓佔用計數失真。
export function handleClaimQuestForNpcTeam(
  state: QuestState,
  command: ClaimQuestForNpcTeamCommand,
  ctx: QuestHandlerContext,
): QuestHandlerResult {
  const quest = tryGetQuest(state, command.questId);
  if (quest === undefined) {
    return reject('quest/unknown-quest', { questId: String(command.questId) });
  }
  if (quest.status !== 'unaccepted') {
    return reject('quest/not-unaccepted', {
      questId: String(command.questId),
      status: quest.status,
    });
  }
  if (ctx.worldDay >= quest.acceptDeadline) {
    return reject('quest/accept-deadline-passed', {
      questId: String(command.questId),
      worldDay: ctx.worldDay,
      acceptDeadline: quest.acceptDeadline,
    });
  }
  const existing = tryGetClaim(state, command.questId);
  if (existing !== undefined) {
    return reject('quest/already-claimed', {
      questId: String(command.questId),
      claimTeamId: String(existing.teamId),
    });
  }
  const claim: NpcQuestClaim = {
    questId: command.questId,
    teamId: command.teamId,
    chainId: command.chainId,
    claimedOnDay: ctx.worldDay,
    revision: 0 as Revision,
  };
  return accept(setClaim(state, claim), [
    claimChanged(command.questId, 'claimed', command.teamId, command.chainId),
  ]);
}

// 清除意向標記；不得改寫 Quest 期限、目標或狀態（doc §5.1.1）。
// 合法來源：Claim 的 team／chain 與命令相符，或 Quest 已不再 unaccepted（此時任何來源都可清）。
export function handleReleaseNpcQuestClaim(
  state: QuestState,
  command: ReleaseNpcQuestClaimCommand,
  ctx: QuestHandlerContext,
): QuestHandlerResult {
  void ctx;
  const claim = tryGetClaim(state, command.questId);
  if (claim === undefined) {
    return reject('quest/claim-not-found', { questId: String(command.questId) });
  }
  const quest = tryGetQuest(state, command.questId);
  if (quest === undefined) {
    return reject('quest/unknown-quest', { questId: String(command.questId) });
  }
  const sourceMatches = claim.teamId === command.teamId && claim.chainId === command.chainId;
  if (!sourceMatches && quest.status === 'unaccepted') {
    return reject('quest/claim-source-mismatch', {
      questId: String(command.questId),
      teamId: String(command.teamId),
      chainId: String(command.chainId),
    });
  }
  return accept(clearClaim(state, command.questId), [
    claimChanged(command.questId, 'released', claim.teamId, claim.chainId),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 ScheduledJob：questDeadline
//
// Job 於交易成功提交時就被 Scheduler dequeue（含「接受但無變化」），因此每一條分支都必須是
// **終局**：要嘛完成該筆期限該做的事，要嘛是有契約的冪等 no-op。這裡兩種 kind 的 no-op 都是
// 「這件事已經發生過了」——不是「這次先不處理」，所以不需要重排新 Job；本 Handler 也不排任何 Job。
// ──────────────────────────────────────────────────────────────────────────

export function handleQuestDeadline(
  state: QuestState,
  job: QuestDeadlineJob,
  ctx: QuestHandlerContext,
): QuestHandlerResult {
  void ctx;
  const quest = tryGetQuest(state, job.targetId);
  if (quest === undefined) {
    // Slice 與 Scheduler 不一致是註冊／存檔錯誤，不是缺資料：整筆交易回滾，讓它可見。
    return reject('quest/deadline-target-missing', { questId: String(job.targetId) });
  }

  if (job.payload.kind === 'accept') {
    // 接受期限只管「仍未接取」者（doc §5.2）。已接取／已完成／已到期都代表這條期限的職責
    // 已由別的路徑履行——冪等 no-op，資料齊全時同樣不動作。
    if (quest.status !== 'unaccepted') return accept(state);
    const missing = missingExpiryCleanup(quest);
    if (missing !== undefined) {
      // 未接取的購買／送貨到期要回收保留位置的 Item 並解除商店 Offer（doc §9.1）。
      // 少了那兩筆 Handler，只改狀態會讓 Item 與 Offer 永久卡住，所以整筆拒絕而不是略過。
      return reject('quest/lifecycle-dependency-unavailable', {
        questId: String(quest.questId),
        kind: quest.kind,
        missing,
      });
    }
    const expired = expireQuest(state, quest, 'acceptDeadline');
    return accept(expired.state, expired.messages);
  }

  // actualEnd：任何尚未在原公會合法結案的任務一律轉 expired，完成但未回報亦同（doc §5.2、不變量 4）。
  if (quest.status === 'expired') return accept(state); // 已到期：冪等
  if (quest.settlement !== undefined) return accept(state); // 已結案歸檔：冪等

  const missing = missingExpiryCleanup(quest);
  if (missing !== undefined) {
    // 已接取且仍鎖在 teamQuestCargo 的任務物必須全部進入團隊分配（不變量 13）。
    return reject('quest/lifecycle-dependency-unavailable', {
      questId: String(quest.questId),
      kind: quest.kind,
      missing,
    });
  }
  const expired = expireQuest(state, quest, 'actualEndDeadline');
  return accept(expired.state, expired.messages);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.3 DomainEvent Subscriber
//
// Subscriber 回 ModuleResult：已發生的事實不可拒絕（12_engine_runtime.md §7.2 rule 6）。
// ──────────────────────────────────────────────────────────────────────────

// 內容處理結果 → 鎮壓／討伐的目標累計、救援的被擄者救出（doc §5.3、§8）。
// ──────────────────────────────────────────────────────────────────────────
// §5.3 DomainEvent 訂閱：MapContentGenerated（委託的生成入口）
// ──────────────────────────────────────────────────────────────────────────
//
// 委託是**世界的反應**，不是憑空出現的清單（doc §2.1「QuestReactionRule：某種來源出現時，
// 以 creationChance 決定要不要生成一筆對應種類的委託」）。這一支把那句話接起來：
//
//   地圖刷新生成內容（怪群／Boss／綁架／地圖物品）
//     → 逐筆比對 `sourceKind` 相符的 QuestReactionRule
//     → 擲 creationChance
//     → 由 guildResolver 決定貼在哪座城的公會
//     → 由 deadlineRule 決定接取期限與實際結束期限
//     → 建立 QuestInstance（status 'open'）
//
// 一筆內容最多生成一筆委託：`sourceKind` 與內容種類是一對一（怪群→肅清、Boss→狩獵…），
// 而同一筆怪群同時是「肅清目標」又是「狩獵目標」在設計上沒有意義。內容有兩條規則指向它時
// 明確拋錯——那是內容配置矛盾，不是可以靠「取第一條」蓋過去的事。
export function onMapContentGenerated(
  event: MapContentGenerated,
  state: QuestState,
  ctx: QuestGenerationContext,
): ModuleResult<QuestState> {
  let working = state;
  const messages: Outgoing[] = [];
  let cursor = ctx.rngContext.cursor;

  for (const contentId of event.contentIds) {
    const content = ctx.mapContents.getContent(contentId);
    if (content === undefined) continue;
    const sourceKind = questSourceKindOf(content);
    if (sourceKind === undefined) continue; // 這種內容不是任何委託的來源（例如寶箱）

    const rules = ctx.definitions
      .listQuestReactionRules()
      .filter((rule) => rule.sourceKind === sourceKind);
    if (rules.length === 0) continue; // 這份 Pack 不為這種來源生成委託——一句宣告，不是遺漏
    if (rules.length > 1) {
      throw new Error(
        `quest：來源種類 "${sourceKind}" 有 ${rules.length} 條 quest-reaction-rule` +
          `（${rules.map((r) => String(r.id)).join(', ')}）——沒有人說得出該用哪一條。`,
      );
    }
    const rule = rules[0]!;

    // 生成擲骰。creationChance 1 代表必生（怪群與 Boss 就是這樣授權的），此時仍然消費一格
    // 游標——否則「這份內容改成 0.5」會讓之後所有委託的隨機結果整串位移。
    const chanceRoll = ctx.rng.nextFloat({ ...ctx.rngContext, cursor });
    cursor = chanceRoll.nextCursor;
    if (chanceRoll.value >= rule.creationChance) continue;

    const guild = ctx.resolvers.resolveGuildCity({
      resolverId: rule.guildResolverId,
      mapId: content.mapId,
      rngContext: { ...ctx.rngContext, cursor },
    });
    cursor = guild.nextCursor;

    const deadlineRule = ctx.definitions.getQuestDeadlineRule(rule.deadlineRuleId);
    const actualEnd = ctx.resolvers.resolveActualEndDays({
      resolverId: deadlineRule.actualEndResolverId,
      rngContext: { ...ctx.rngContext, cursor },
    });
    cursor = actualEnd.nextCursor;

    const objective = objectiveFor(rule.questKind, content);
    if (objective === undefined) {
      throw new Error(
        `quest：規則 "${String(rule.id)}" 的 questKind "${rule.questKind}" 接不上來源內容 ` +
          `"${String(contentId)}"（kind ${content.kind}）——內容配置把兩種不相干的東西綁在一起了。`,
      );
    }

    const acceptDeadline = (ctx.worldDay + deadlineRule.acceptDurationDays) as WorldDay;
    const quest: QuestInstance = {
      questId: ctx.ids.nextQuestId(),
      kind: rule.questKind,
      sourceRuleId: rule.id,
      // 來源實體是這張地圖實例（`EntitySourceRef` 是一個 ID 聯集，不是 tagged union）。
      sourceId: content.mapId,
      postingGuildCityId: guild.value,
      createdOnDay: ctx.worldDay,
      acceptDeadline,
      // 實際結束期限從**接取期限**起算：接取期內都還沒有人開工。
      actualEndDeadline: (acceptDeadline + actualEnd.value) as WorldDay,
      // 距離 RNG 在建立時一次確定（doc §2.4、不變量 2）：這裡存下這一筆的抽取結果，
      // 接取時不重抽、不延長。
      deadlineRolls: [actualEnd.value],
      // 尚未被任何隊伍接取。`QuestStatus` 沒有 'open' 這個值——公會板上「還能接」的條件是
      // `unaccepted` ＋ 未過接取期限（見 projectGuildBoard）。
      status: 'unaccepted',
      participantCharacterIds: [],
      objective,
      progress: EMPTY_OBJECTIVE_PROGRESS,
      rewardRuleId: rule.rewardRuleId,
      revision: 0 as Revision,
    };
    working = updateQuest(working, quest);
    messages.push(
      emit({
        type: 'QuestCreated',
        questId: quest.questId,
        kind: quest.kind,
        sourceId: quest.sourceId,
        deadlines: {
          acceptDeadline: quest.acceptDeadline,
          actualEndDeadline: quest.actualEndDeadline,
        },
      }),
    );
  }

  return makeResult(working, messages);
}

// 內容種類 → 委託來源種類。非 Partial 的 Record：map 新增一種內容卻沒說它是不是委託來源，
// 就是這一行的編譯錯誤。`undefined` 是明確的「這種內容不生成委託」。
const QUEST_SOURCE_KIND_BY_CONTENT: Readonly<
  Record<MapContentKind, QuestReactionSourceKind | undefined>
> = {
  monsterGroup: 'monsterGroup',
  boss: 'boss',
  kidnap: 'kidnap',
  chest: undefined,
  mapEvent: undefined,
  control: undefined,
};

function questSourceKindOf(content: MapContentView): QuestReactionSourceKind | undefined {
  return QUEST_SOURCE_KIND_BY_CONTENT[content.kind];
}

function objectiveFor(kind: QuestKind, content: MapContentView): QuestObjective | undefined {
  switch (kind) {
    case 'suppression':
      return { kind: 'suppression', mapId: content.mapId, targetContentIds: [content.contentId] };
    case 'hunt':
      return { kind: 'hunt', mapId: content.mapId, bossContentIds: [content.contentId] };
    case 'rescue':
      return { kind: 'rescue', contentId: content.contentId, mapId: content.mapId };
    // 其餘四種的來源不是地圖內容（購買／運送來自城市貨架、護衛來自護衛候選），
    // 走不到這條路徑；真的走到就是內容把不相干的規則綁在一起了，由呼叫端明確拋錯。
    case 'purchase':
    case 'delivery':
    case 'escort':
    case 'exploration':
      return undefined;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// §5.3 DomainEvent 訂閱：CityStockItemAvailable（採買／送貨委託的生成入口）
// ──────────────────────────────────────────────────────────────────────────
//
// doc §2.3「地圖或城市庫存物品：依資料機率形成探索、購買或送貨委託」。與地圖內容那條路
// 對稱：城市把一件東西擺上貨架 → 對 `sourceKind: 'cityStockItem'` 的每一條規則各擲一次骰。
//
// 為什麼是「每一條各擲一次」而不是「挑一條」：採買（0.3）與送貨（0.2）是**兩種不同的委託**，
// 同一件貨可以同時有人要買、有人要運。地圖內容那邊是一對一（一群怪不會同時是肅清又是狩獵），
// 所以那裡多於一條就拋錯；這裡不是。
export function onCityStockItemAvailable(
  event: CityStockItemAvailable,
  state: QuestState,
  ctx: QuestGenerationContext,
): ModuleResult<QuestState> {
  let working = state;
  const messages: Outgoing[] = [];
  let cursor = ctx.rngContext.cursor;

  for (const rule of ctx.definitions.listQuestReactionRules()) {
    if (rule.sourceKind !== 'cityStockItem') continue;

    const chanceRoll = ctx.rng.nextFloat({ ...ctx.rngContext, cursor });
    cursor = chanceRoll.nextCursor;
    if (chanceRoll.value >= rule.creationChance) continue;

    // 貨架委託貼在**這座城**的公會（guildResolverId 仍由內容指名；地圖那條路共用同一個 Port）。
    // 這裡沒有 mapId 可帶——`local-city` 這條規則只看地圖。所以貨架委託一律貼在貨所在的城：
    // 那正是 `local-city` 對「城市庫存」這個來源的自然解，而且不需要另造一個 Resolver。
    const postingCityId = event.cityId;

    const deadlineRule = ctx.definitions.getQuestDeadlineRule(rule.deadlineRuleId);
    const actualEnd = ctx.resolvers.resolveActualEndDays({
      resolverId: deadlineRule.actualEndResolverId,
      rngContext: { ...ctx.rngContext, cursor },
    });
    cursor = actualEnd.nextCursor;

    let objective: QuestObjective;
    if (rule.questKind === 'purchase') {
      objective = { kind: 'purchase', itemId: event.itemId, shopOfferId: event.offerId };
    } else if (rule.questKind === 'delivery') {
      const resolverId = rule.destinationResolverId;
      if (resolverId === undefined) {
        throw new Error(
          `quest：送貨規則 "${String(rule.id)}" 沒有 destinationResolverId——` +
            `「送到哪裡」沒有人決定，這筆委託建不出來。`,
        );
      }
      const destination = ctx.resolvers.resolveDeliveryDestination({
        resolverId,
        excludeCityId: postingCityId,
        rngContext: { ...ctx.rngContext, cursor },
      });
      cursor = destination.nextCursor;
      // 收貨地點＝目的城的冒險者公會。送貨的對口是公會而不是某間店：委託本來就是公會發的，
      // 而「哪一間店收貨」在資料裡沒有任何欄位承載（見 QuestObjective.delivery 的 facilityId）。
      const facilityId = ctx.cities.getGuildFacilityId(destination.value);
      if (facilityId === undefined) {
        throw new Error(
          `quest：城市 "${String(destination.value)}" 沒有冒險者公會設施——送貨委託沒有收貨點。`,
        );
      }
      objective = {
        kind: 'delivery',
        itemId: event.itemId,
        destinationCityId: destination.value,
        facilityId,
      };
    } else {
      throw new Error(
        `quest：規則 "${String(rule.id)}" 宣告 sourceKind='cityStockItem' 卻是 ` +
          `questKind='${rule.questKind}'——城市貨架只生得出採買與送貨。`,
      );
    }

    const acceptDeadline = (ctx.worldDay + deadlineRule.acceptDurationDays) as WorldDay;
    const quest: QuestInstance = {
      questId: ctx.ids.nextQuestId(),
      kind: rule.questKind,
      sourceRuleId: rule.id,
      // 來源實體是那件貨（`EntitySourceRef` 含 ItemInstanceId）。
      sourceId: event.itemId,
      postingGuildCityId: postingCityId,
      createdOnDay: ctx.worldDay,
      acceptDeadline,
      actualEndDeadline: (acceptDeadline + actualEnd.value) as WorldDay,
      deadlineRolls: [actualEnd.value],
      status: 'unaccepted',
      participantCharacterIds: [],
      objective,
      progress: EMPTY_OBJECTIVE_PROGRESS,
      rewardRuleId: rule.rewardRuleId,
      revision: 0 as Revision,
    };
    working = updateQuest(working, quest);
    messages.push(
      emit({
        type: 'QuestCreated',
        questId: quest.questId,
        kind: quest.kind,
        sourceId: quest.sourceId,
        deadlines: {
          acceptDeadline: quest.acceptDeadline,
          actualEndDeadline: quest.actualEndDeadline,
        },
      }),
    );
  }

  return makeResult(working, messages);
}

export function onMapContentResolved(
  event: MapContentResolved,
  state: QuestState,
  ctx: QuestHandlerContext,
): ModuleResult<QuestState> {
  // 失敗的處理不推進任何目標（doc §8：轉 completed 的唯一條件是目標已 resolved）。
  if (event.resolution.outcome !== 'success') return makeResult(state);

  let working = state;
  const messages: Outgoing[] = [];

  for (const quest of listQuestsOrdered(state)) {
    if (quest.status !== 'incomplete') continue;
    const current = tryGetQuest(working, quest.questId);
    if (current === undefined) continue;

    if (current.objective.kind === 'suppression' || current.objective.kind === 'hunt') {
      if (current.objective.mapId !== event.mapId) continue;
      if (!objectiveCompletionContentIds(current.objective).includes(event.contentId)) continue;
      const progressed: QuestInstance = {
        ...current,
        progress: withResolvedTarget(current.progress, event.contentId),
        revision: bumpRevision(current.revision),
      };
      working = updateQuest(working, progressed);
      if (!hasAllTargetsResolved(progressed)) continue;
      const done = completeQuest(working, progressed, ctx.worldDay);
      working = done.state;
      messages.push(...done.messages);
      continue;
    }

    if (current.objective.kind === 'rescue') {
      if (current.objective.contentId !== event.contentId) continue;
      if (current.progress.captiveRescuedOnDay !== undefined) continue; // 冪等：同一筆內容只算一次
      const content = ctx.mapContents.getContent(event.contentId);
      if (content === undefined || content.payload.kind !== 'kidnap') {
        // 綁定的內容不見了或不是綁架內容 → 目標永遠無法達成，依 doc §7 轉 expired。
        const gone = expireQuest(working, current, 'contentUnavailable');
        working = gone.state;
        messages.push(...gone.messages);
        continue;
      }
      const rescued: QuestInstance = {
        ...current,
        progress: { ...current.progress, captiveRescuedOnDay: ctx.worldDay },
        revision: bumpRevision(current.revision),
      };
      working = updateQuest(working, rescued);
      // 救出的人物才建立任務角色（doc §6、不變量 7）；原型取自 map 的 content payload。
      messages.push(
        internal(CHARACTER_MODULE_ID, {
          type: 'CreateQuestTemporaryCharacter',
          kind: 'rescue',
          archetypeId: content.payload.captiveArchetypeId,
          sourceQuestId: current.questId,
        }),
      );
    }
  }

  return makeResult(working, messages);
}

// 隊伍位置改變 → 護衛抵達目的城市、救援離開該地圖（doc §5.3、§8）。
export function onTeamLocationChanged(
  event: TeamLocationChangedEvent,
  state: QuestState,
  ctx: QuestHandlerContext,
): ModuleResult<QuestState> {
  let working = state;
  const messages: Outgoing[] = [];

  for (const quest of listQuestsOrdered(state)) {
    if (quest.status !== 'incomplete') continue;
    if (quest.acceptedByTeamId !== event.teamId) continue;
    const current = tryGetQuest(working, quest.questId);
    if (current === undefined) continue;

    if (current.objective.kind === 'escort') {
      // 護衛角色仍存活（死亡會先把任務轉 expired）且進入目的城市才算完成（doc §8）。
      if (current.objective.characterId === undefined) continue;
      if (event.to.kind !== 'city' || event.to.cityId !== current.objective.destinationCityId) continue;
      const done = completeQuest(working, current, ctx.worldDay);
      working = done.state;
      messages.push(...done.messages);
      continue;
    }

    if (current.objective.kind === 'rescue') {
      // 救到人物**且**離開該 Map 才算完成（doc §8）。
      if (current.progress.captiveRescuedOnDay === undefined) continue;
      if (event.from.kind !== 'adventureMap' || event.from.mapId !== current.objective.mapId) continue;
      const done = completeQuest(working, current, ctx.worldDay, releaseProtection(current));
      working = done.state;
      messages.push(...done.messages);
    }
  }

  return makeResult(working, messages);
}

// detailed 戰敗 → 該隊全部仍為 incomplete 的護衛委託立即到期（doc §5.3、不變量 18）。
// 已 completed／expired 的護衛與其他隊伍的護衛不受影響。
export function onCombatEncounterResolved(
  event: CombatEncounterResolvedPayload,
  state: QuestState,
  ctx: QuestHandlerContext,
): ModuleResult<QuestState> {
  void ctx;
  if (event.outcome !== 'defeat') return makeResult(state);

  let working = state;
  const messages: Outgoing[] = [];
  for (const quest of listQuestsOrdered(state)) {
    if (quest.objective.kind !== 'escort') continue;
    if (quest.status !== 'incomplete') continue;
    if (quest.acceptedByTeamId !== event.teamId) continue;
    const current = tryGetQuest(working, quest.questId);
    if (current === undefined) continue;
    const gone = expireQuest(working, current, 'combatDefeat');
    working = gone.state;
    messages.push(...gone.messages);
  }
  return makeResult(working, messages);
}

// 護衛／救援對象死亡 → 立即到期，原因 targetDied，並執行與期限到期相同的清理（doc §5.3）。
export function onCharacterDied(
  event: CharacterDiedEvent,
  state: QuestState,
  ctx: QuestHandlerContext,
): ModuleResult<QuestState> {
  void ctx;
  let working = state;
  const messages: Outgoing[] = [];
  for (const quest of listQuestsOrdered(state)) {
    if (quest.status !== 'incomplete') continue;
    if (objectiveCharacterId(quest.objective) !== event.characterId) continue;
    const current = tryGetQuest(working, quest.questId);
    if (current === undefined) continue;
    const gone = expireQuest(working, current, 'targetDied');
    working = gone.state;
    messages.push(...gone.messages);
  }
  return makeResult(working, messages);
}

// 任務角色建立完成 → 把 Runtime CharacterId 綁回 Objective（doc §3.3）。
// CharacterCreated 本身不帶 sourceQuestId，故以 character 的 getTemporaryOrigin 反查；
// 綁定後 CharacterDied 才認得出「這是我的護送／救援對象」。
export function onCharacterCreated(
  event: CharacterCreatedEvent,
  state: QuestState,
  ctx: QuestHandlerContext,
): ModuleResult<QuestState> {
  const origin = ctx.characters.getTemporaryOrigin(event.characterId);
  if (origin === undefined) return makeResult(state); // 非任務角色：與 Quest 無關
  const quest = tryGetQuest(state, origin.sourceQuestId);
  // origin 指向不存在的 Quest 是 character 側的資料錯誤。Subscriber 不得拒絕已發生的事實，
  // 而 Quest 這邊沒有任何可套用的對象——這不是「缺資料就給預設」，是真的無事可做。
  if (quest === undefined) return makeResult(state);
  if (quest.objective.kind !== origin.kind) return makeResult(state);
  // 冪等：已綁定就不覆寫（同一 Quest 不得換綁第二個角色）。
  if (quest.objective.characterId !== undefined) return makeResult(state);

  const objective: QuestObjective = { ...quest.objective, characterId: event.characterId };
  const bound: QuestInstance = {
    ...quest,
    objective,
    revision: bumpRevision(quest.revision),
  };
  return makeResult(updateQuest(state, bound));
}
