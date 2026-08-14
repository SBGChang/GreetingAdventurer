// modules/dungeon/system.ts
// Dungeon 純函式 handler／job／subscriber 與探索核心。
// 對應 docs/00_core/architecture/03_dungeon_module.md §5–§8。
//
// 所有函式皆為 deterministic pure：只讀入參數（state / payload / ctx），回傳新的 slice
// 與待送訊息，不做 I/O、不改動輸入。每個 handler 回傳 ModuleResult<DungeonModuleState>；
// 其 nextSlice 結構性即滿足契約 DungeonState。
//
// 注入的 Host Port（MapQuery/TeamQuery/AssetDistribution/CombatSequence 的窄化子集）、
// ID 產生器、worldDay 與 RNG context 全部由 DungeonContext 提供，使 handler 保持可重播。
// 精確戰鬥、戰利品實體、貨幣、經驗與地圖真相皆非本模組擁有：Dungeon 只送出對應 Internal
// Command，由各接收模組於自身交易套用。

import type {
  ModuleId,
  ModuleResult,
  ModuleOutcome,
  KernelRequest,
  TransactionMessageDraft,
  DomainEventDraft,
  InternalCommandDraft,
  WorldDay,
  Revision,
  DungeonMinute,
  RngContext,
  TeamId,
  MapInstanceId,
  RoomId,
  RoomLinkId,
  GatheringNodeId,
  GatheringRuleId,
  ContentInstanceId,
  ContentEventInstanceId,
  ContentEventOptionId,
  InteractionId,
  InteractionRuleId,
  ResolverId,
  PlayerMapKnowledgeId,
  NpcDungeonRunId,
  TeamPlanId,
  CharacterId,
  AssetDistributionId,
  EncounterGroupDefinitionId,
  ExperienceAwardRuleId,
} from '../../contracts/core';
import type {
  DungeonDefinitionReader,
  PlayerExplorationSession,
  PlayerMapKnowledge,
  PendingDungeonInteraction,
  ContentEventInstance,
  NpcDungeonRun,
  PendingDungeonResult,
  NpcDungeonTargetRef,
  MoveDungeonRoom,
  OpenDungeonDoor,
  UseDungeonExit,
  InteractDungeonContent,
  ResolveDungeonInteraction,
  ConsumeDungeonGatheringAction,
  StartNpcDungeonRun,
  DungeonOutboundInternalCommand,
} from '../../contracts/dungeon';
import type { MapContentKind, GridCell, NpcSequenceEntryView } from '../../contracts/map';
// AssetDistributionRuleId 由 distribution 契約擁有（非 core）。
import type { AssetDistributionRuleId } from '../../contracts/distribution';
import type { CombatEncounterResolvedPayload } from '../../contracts/combat';

import type { DungeonModuleState } from './state';
import {
  getPlayerSession,
  withPlayerSession,
  findKnowledge,
  withKnowledge,
  withNpcRun,
  createKnowledge,
} from './state';

export const DUNGEON_MODULE_ID = 'dungeon' as ModuleId;

// 目標接收模組 ID（Internal Command 送出對象）。
const MAP_MODULE_ID = 'map' as ModuleId;
const COMBAT_MODULE_ID = 'combat' as ModuleId;
const DISTRIBUTION_MODULE_ID = 'distribution' as ModuleId;
const TEAM_MODULE_ID = 'team' as ModuleId;
// world 模組不再是跨午夜的接收者：世界日推進改走 ModuleResult.kernelRequests（見 advanceSessionTime）。

// ──────────────────────────────────────────────────────────────────────────
// 注入 Host Port（窄化 Query／Command port）與 Context
// ──────────────────────────────────────────────────────────────────────────

// Map 的窄化讀 Port：Dungeon 只讀需要的地形／內容真相，不擁有 Map State。
export interface DungeonMapPort {
  getMapVersion(mapId: MapInstanceId): number;
  // 入口房間與其入口小格（進場立即揭露）。
  getEntranceRoom(mapId: MapInstanceId): Readonly<{ roomId: RoomId; entryCell: GridCell }>;
  isExitRoom(mapId: MapInstanceId, roomId: RoomId): boolean;
  // 房間→房間可通行時回傳實際小格距離與落點入口格；不可通行回傳 undefined。
  getRoomTraversal(
    mapId: MapInstanceId,
    fromRoomId: RoomId,
    fromEntryCell: GridCell,
    toRoomId: RoomId,
  ): Readonly<{ cells: number; entryCell: GridCell }> | undefined;
  // 紅門／通道連線；不存在回傳 undefined。
  getDoorLink(
    mapId: MapInstanceId,
    linkId: RoomLinkId,
  ):
    | Readonly<{
        fromRoomId: RoomId;
        toRoomId: RoomId;
        kind: 'passage' | 'redDoor';
        state: 'closed' | 'open';
      }>
    | undefined;
  // 固定採集點。
  getGatheringNodeRuleId(mapId: MapInstanceId, nodeId: GatheringNodeId): GatheringRuleId | undefined;
  isGatheringNodeAvailable(mapId: MapInstanceId, nodeId: GatheringNodeId): boolean;
  // 動態內容。
  getContentKind(mapId: MapInstanceId, contentId: ContentInstanceId): MapContentKind | undefined;
  isContentAvailable(mapId: MapInstanceId, contentId: ContentInstanceId): boolean;
  // 內容所在房間（互動前置：玩家必須人在該房；不存在回 undefined）。
  getContentRoomId(mapId: MapInstanceId, contentId: ContentInstanceId): RoomId | undefined;
  getEncounterGroupId(
    mapId: MapInstanceId,
    contentId: ContentInstanceId,
  ): EncounterGroupDefinitionId | undefined;
  getContentEventInstance(
    mapId: MapInstanceId,
    contentId: ContentInstanceId,
  ): ContentEventInstance | undefined;
  // NPC 依 npcOrder 排序的探索序列（含 pointCost / resolverId）。
  listNpcSequence(mapId: MapInstanceId): readonly NpcSequenceEntryView[];
  // 全清後的探索完成投影（experienceRuleId + explorationKey）。
  getExplorationCompletion(
    mapId: MapInstanceId,
  ): Readonly<{ explorationKey: string; experienceRuleId: ExperienceAwardRuleId }>;
}

// Team 的窄化讀 Port：Dungeon 以 Team Plan 與位置作為 Session／Run 前置條件。
export interface DungeonTeamPort {
  // 隊伍目前所在冒險地地圖（不在冒險地回傳 undefined）。
  getAdventureMap(teamId: TeamId): MapInstanceId | undefined;
  isTeamInMap(teamId: TeamId, mapId: MapInstanceId): boolean;
  getMembers(teamId: TeamId): readonly CharacterId[];
}

// ID 產生器 + 世界時鐘 + RNG。真實 Composition 由交易 runtime-id cursor 提供；測試注入計數器。
export type DungeonContext = Readonly<{
  reader: DungeonDefinitionReader;
  map: DungeonMapPort;
  team: DungeonTeamPort;
  worldDay: WorldDay;
  // 迷宮日長度（分鐘）；跨越此邊界即跨午夜。[INVENTED] 文件未給出常數，第一版由資料／Context 提供。
  minutesPerDungeonDay: number;
  // 目前生效的迷宮互動規則（traversalMinutesPerCell / redDoorOpenMinutes / trapResolverId）。
  interactionRuleId: InteractionRuleId;
  // 迷宮戰利品分配規則（distribution 契約的 StartAssetDistribution 必填 ruleId；
  // controllerPolicy/itemPolicy 由該 rule 定義，dungeon 只負責帶入綁定值）。
  lootDistributionRuleId: AssetDistributionRuleId;
  // NPC 探索規則（原本由 startNpcDungeonRun 的第四個參數傳入，與其他兩筆同類的資料綁定，
  // 移入 Context 讓所有 handler 簽章一致：(state, cmd, ctx)）。
  npcExplorationRuleId: NpcDungeonRun['explorationRuleId'];
  // RNG context（NPC Run 快照用）。
  rng: RngContext;
  // ID 產生器。
  nextInteractionId: () => InteractionId;
  nextKnowledgeId: () => PlayerMapKnowledgeId;
  nextRunId: () => NpcDungeonRunId;
  nextDistributionId: () => AssetDistributionId;
}>;

// ──────────────────────────────────────────────────────────────────────────
// ModuleResult / message 工具
// ──────────────────────────────────────────────────────────────────────────

function event<T>(payload: T): DomainEventDraft<T> {
  return { event: payload };
}

// B.5：外送命令以接收模組契約的真實型別為參數，讓編譯器在發送端就攔下 payload 不匹配。
function internal(
  targetModule: ModuleId,
  command: DungeonOutboundInternalCommand,
): InternalCommandDraft<unknown> {
  return { targetModule, command };
}

function result(
  nextSlice: DungeonModuleState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
  scheduledJobs: ModuleResult<DungeonModuleState>['scheduledJobs'] = [],
  kernelRequests: readonly KernelRequest[] = [],
): ModuleResult<DungeonModuleState> {
  return { nextSlice, outgoingMessages, scheduledJobs, kernelRequests };
}

// Subscriber 專用：已發生事實不可拒絕（12_engine_runtime.md §7.2 rule 6），
// 條件不符時安全略過並回傳未變 slice。可拒絕的 Handler 請用 reject()。
function noop(state: DungeonModuleState): ModuleResult<DungeonModuleState> {
  return result(state);
}

// ── 可拒絕 Handler 的回傳（B.5：全模組統一為 contracts/core 的 ModuleOutcome）──
//
// 原本 dungeon 以「回傳未變 slice」表示前置條件不符，Transaction Runner 無法區分
// 「成功但無變化」與「應拒絕並回滾」，玩家送出非法指令會被當成成功。改為顯式拒絕。
export type DungeonHandlerResult = ModuleOutcome<DungeonModuleState>;

function accept(
  nextSlice: DungeonModuleState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
  scheduledJobs: ModuleResult<DungeonModuleState>['scheduledJobs'] = [],
  kernelRequests: readonly KernelRequest[] = [],
): DungeonHandlerResult {
  return { ok: true, result: result(nextSlice, outgoingMessages, scheduledJobs, kernelRequests) };
}

function reject(
  code: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): DungeonHandlerResult {
  return {
    ok: false,
    rejection: { code, sourceModule: DUNGEON_MODULE_ID, ...(details ? { details } : {}) },
  };
}

function bump(revision: Revision): Revision {
  return (revision + 1) as Revision;
}

// ──────────────────────────────────────────────────────────────────────────
// 迷宮分鐘推進 + 跨午夜（doc §3.1、§8）
// ──────────────────────────────────────────────────────────────────────────

// 純計算：把 addMinutes 累加到 session，回傳新 session、本次跨越的世界日數與事件／請求。
// 跨越午夜時：固定目前分鐘片段，送出「推進下一世界日」請求（doc §8）。
function advanceSessionTime(
  session: PlayerExplorationSession,
  addMinutes: number,
  ctx: DungeonContext,
): Readonly<{
  session: PlayerExplorationSession;
  messages: readonly TransactionMessageDraft[];
  kernelRequests: readonly KernelRequest[];
}> {
  const before = session.elapsedDungeonMinutes;
  const after = (before + addMinutes) as DungeonMinute;
  const dayLen = ctx.minutesPerDungeonDay;
  const dayBefore = Math.floor(before / dayLen);
  const dayAfter = Math.floor(after / dayLen);
  const crossed = dayAfter > dayBefore;

  const nextSession: PlayerExplorationSession = {
    ...session,
    elapsedDungeonMinutes: after,
    revision: bump(session.revision),
  };

  const messages: TransactionMessageDraft[] = [
    event({
      type: 'PlayerDungeonTimeAdvanced',
      teamId: session.teamId,
      minutes: addMinutes as DungeonMinute,
      worldDayCrossed: crossed ? true : undefined,
    }),
  ];

  // 跨午夜：doc §3.1/§8「關閉目前分鐘片段並呼叫核心推進下一世界日」。
  // 世界日由 Kernel 獨占寫入，world 模組不擁有它，故此處走 ModuleResult.kernelRequests，
  // 不偽造 world 模組的 Internal Command。跨越多日時一次帶出目標日。
  const kernelRequests: readonly KernelRequest[] = crossed
    ? [
        {
          type: 'AdvanceWorldToDay',
          targetDay: (ctx.worldDay + (dayAfter - dayBefore)) as WorldDay,
        },
      ]
    : [];

  return { session: nextSession, messages, kernelRequests };
}

// 揭露一個房間到 Knowledge（若尚未揭露）；回傳新 state（含新建 Knowledge）。
function revealRoom(
  state: DungeonModuleState,
  ctx: DungeonContext,
  teamId: TeamId,
  mapId: MapInstanceId,
  roomId: RoomId,
  entranceRoomId: RoomId,
): DungeonModuleState {
  let knowledge = findKnowledge(state, teamId, mapId);
  if (knowledge === undefined) {
    knowledge = createKnowledge(ctx.nextKnowledgeId(), teamId, mapId, entranceRoomId);
  }
  if (knowledge.revealedRoomIds.includes(roomId)) {
    return withKnowledge(state, knowledge); // 已揭露：確保 Knowledge 存在即可。
  }
  const next: PlayerMapKnowledge = {
    ...knowledge,
    revealedRoomIds: [...knowledge.revealedRoomIds, roomId],
    revision: bump(knowledge.revision),
  };
  return withKnowledge(state, next);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 玩家 Command
// ──────────────────────────────────────────────────────────────────────────

// startPlayerExploration：玩家 Team 位於冒險地、沒有既有 Session。
export function startPlayerExploration(
  state: DungeonModuleState,
  teamId: TeamId,
  ctx: DungeonContext,
): DungeonHandlerResult {
  if (getPlayerSession(state, teamId) !== undefined) return reject('dungeon.startPlayerExploration.preconditionFailed'); // 已有 Session。
  const mapId = ctx.team.getAdventureMap(teamId);
  if (mapId === undefined) return reject('dungeon.startPlayerExploration.preconditionFailed'); // 不在冒險地。

  const mapVersion = ctx.map.getMapVersion(mapId);
  const entrance = ctx.map.getEntranceRoom(mapId);
  const distributionId = ctx.nextDistributionId();
  const members = ctx.team.getMembers(teamId);

  const session: PlayerExplorationSession = {
    teamId,
    mapId,
    mapVersion,
    distributionId,
    currentRoomId: entrance.roomId,
    entryCell: entrance.entryCell,
    elapsedDungeonMinutes: 0 as DungeonMinute,
    status: 'exploring',
    revision: 0 as Revision,
  };

  // 進場立即揭露入口房間（doc §3.2.3）。
  const revealed = revealRoom(
    withPlayerSession(state, session),
    ctx,
    teamId,
    mapId,
    entrance.roomId,
    entrance.roomId,
  );

  const messages: TransactionMessageDraft[] = [
    event({ type: 'PlayerDungeonSessionStarted', teamId, mapId, mapVersion }),
    // 以正式成員快照建立 collecting 的玩家地牢 Distribution（doc §5.1、§8.2）。
    internal(DISTRIBUTION_MODULE_ID, {
      type: 'StartAssetDistribution',
      distributionId,
      source: { kind: 'dungeonLoot', mapId },
      teamId,
      participantCharacterIds: members,
      ruleId: ctx.lootDistributionRuleId,
    }),
  ];

  return accept(revealed, messages);
}

// moveDungeonRoom：Session 為 exploring、目標房間可通行。計算分鐘、更新房間與入口小格、
// 必要時推進世界日（doc §5.1、§8）。
export function moveDungeonRoom(
  state: DungeonModuleState,
  teamId: TeamId,
  cmd: MoveDungeonRoom,
  ctx: DungeonContext,
): DungeonHandlerResult {
  const session = getPlayerSession(state, teamId);
  if (session === undefined || session.status !== 'exploring') return reject('dungeon.moveDungeonRoom.preconditionFailed');
  if (session.pendingInteraction !== undefined) return reject('dungeon.moveDungeonRoom.preconditionFailed'); // 內容互動中不可移動。
  if (ctx.map.getMapVersion(session.mapId) !== session.mapVersion) return reject('dungeon.moveDungeonRoom.preconditionFailed');

  const traversal = ctx.map.getRoomTraversal(
    session.mapId,
    session.currentRoomId,
    session.entryCell,
    cmd.targetRoomId,
  );
  if (traversal === undefined) return reject('dungeon.moveDungeonRoom.preconditionFailed'); // 不可通行。

  const rule = ctx.reader.getDungeonInteractionRule(ctx.interactionRuleId);
  const minutes = traversal.cells * rule.traversalMinutesPerCell;

  const moved: PlayerExplorationSession = {
    ...session,
    currentRoomId: cmd.targetRoomId,
    entryCell: traversal.entryCell,
  };
  const timed = advanceSessionTime(moved, minutes, ctx);

  // 成功移入新房間 → 永久揭露該房間（doc §3.2.3、§8）。
  const entrance = ctx.map.getEntranceRoom(session.mapId);
  const revealed = revealRoom(
    withPlayerSession(state, timed.session),
    ctx,
    teamId,
    session.mapId,
    cmd.targetRoomId,
    entrance.roomId,
  );

  // TODO: 進入 armed 固定陷阱房間時，於同一交易 required ResolveMapTrap + 陷阱效果命令，
  //       並寫入 knownTrapIds（doc §8、§8.3）。第一版主路徑不含陷阱房。
  return accept(revealed, timed.messages, [], timed.kernelRequests);
}

// openDungeonDoor：門連接目前房間、Map Version 相符。門仍關閉時支付一次開門分鐘並 required
// OpenMapDoor、永久揭露門後房間；已開門時不再收費（doc §5.1、§8.3）。
export function openDungeonDoor(
  state: DungeonModuleState,
  teamId: TeamId,
  cmd: OpenDungeonDoor,
  ctx: DungeonContext,
): DungeonHandlerResult {
  const session = getPlayerSession(state, teamId);
  if (session === undefined || session.status !== 'exploring') return reject('dungeon.openDungeonDoor.preconditionFailed');
  if (ctx.map.getMapVersion(session.mapId) !== session.mapVersion) return reject('dungeon.openDungeonDoor.preconditionFailed');

  const link = ctx.map.getDoorLink(session.mapId, cmd.linkId);
  if (link === undefined) return reject('dungeon.openDungeonDoor.preconditionFailed');
  // 門必須連接目前房間。
  const connectsCurrent =
    link.fromRoomId === session.currentRoomId || link.toRoomId === session.currentRoomId;
  if (!connectsCurrent) return reject('dungeon.openDungeonDoor.preconditionFailed');

  const otherRoomId =
    link.fromRoomId === session.currentRoomId ? link.toRoomId : link.fromRoomId;

  // 已開啟的門：直接依一般移動規則通行，不再收開門費（此 handler 只負責「查看／開門」）。
  if (link.kind !== 'redDoor' || link.state === 'open') {
    // 通道或已開紅門：揭露門後房間（若尚未），不扣分鐘。
    const entrance = ctx.map.getEntranceRoom(session.mapId);
    const revealed = revealRoom(state, ctx, teamId, session.mapId, otherRoomId, entrance.roomId);
    return accept(revealed);
  }

  // 關閉的紅門：支付一次開門分鐘、required OpenMapDoor、永久揭露門後房間與連線（doc §8.3）。
  const rule = ctx.reader.getDungeonInteractionRule(ctx.interactionRuleId);
  const timed = advanceSessionTime(session, rule.redDoorOpenMinutes, ctx);

  const entrance = ctx.map.getEntranceRoom(session.mapId);
  let next = withPlayerSession(state, timed.session);
  next = revealRoom(next, ctx, teamId, session.mapId, otherRoomId, entrance.roomId);
  // 記錄已發現的連線。
  const knowledge = findKnowledge(next, teamId, session.mapId);
  if (knowledge !== undefined && !knowledge.discoveredLinkIds.includes(cmd.linkId)) {
    next = withKnowledge(next, {
      ...knowledge,
      discoveredLinkIds: [...knowledge.discoveredLinkIds, cmd.linkId],
      revision: bump(knowledge.revision),
    });
  }

  const messages: TransactionMessageDraft[] = [
    ...timed.messages,
    internal(MAP_MODULE_ID, {
      type: 'OpenMapDoor',
      teamId,
      mapId: session.mapId,
      mapVersion: session.mapVersion,
      linkId: cmd.linkId,
      openedOnDungeonMinute: timed.session.elapsedDungeonMinutes,
    }),
  ];
  return accept(next, messages, [], timed.kernelRequests);
}

// interactDungeonContent：玩家位於合法位置且內容可用。依互動類型建立 combat／內容處理 Internal
// Command（doc §5.1）。
export function interactDungeonContent(
  state: DungeonModuleState,
  teamId: TeamId,
  cmd: InteractDungeonContent,
  ctx: DungeonContext,
): DungeonHandlerResult {
  const session = getPlayerSession(state, teamId);
  if (session === undefined || session.status !== 'exploring') return reject('dungeon.interactDungeonContent.preconditionFailed');
  if (session.pendingInteraction !== undefined) return reject('dungeon.interactDungeonContent.preconditionFailed');
  if (!ctx.map.isContentAvailable(session.mapId, cmd.contentId)) return reject('dungeon.interactDungeonContent.preconditionFailed');
  // 內容必須就在玩家目前所在房間——只檢查「內容存在」會讓玩家隔空互動別房的內容（doc §8）。
  if (ctx.map.getContentRoomId(session.mapId, cmd.contentId) !== session.currentRoomId) {
    return reject('dungeon.interactDungeonContent.preconditionFailed');
  }

  const kind = ctx.map.getContentKind(session.mapId, cmd.contentId);
  if (kind === undefined) return reject('dungeon.interactDungeonContent.preconditionFailed');

  if (kind === 'monsterGroup' || kind === 'boss') {
    // 玩家詳細戰鬥交由 combat；Session 轉 inCombat（戰鬥本身不消耗迷宮分鐘，doc §8）。
    const encounterGroupId = ctx.map.getEncounterGroupId(session.mapId, cmd.contentId);
    if (encounterGroupId === undefined) return reject('dungeon.interactDungeonContent.preconditionFailed');
    const inCombat: PlayerExplorationSession = {
      ...session,
      status: 'inCombat',
      revision: bump(session.revision),
    };
    const messages: TransactionMessageDraft[] = [
      internal(COMBAT_MODULE_ID, {
        type: 'StartCombatEncounter',
        teamId,
        // combat 以 CombatEncounterSource 承載來源（不是攤平的 mapId/contentId）。
        source: {
          kind: 'mapContent',
          mapId: session.mapId,
          contentId: cmd.contentId,
          encounterGroupId,
        },
        // 開戰站位快照版本：以 Session revision 作為本次進戰的快照序（combat 只用於冪等比對）。
        participantSnapshotRevision: session.revision,
        rngContext: ctx.rng,
      }),
    ];
    return accept(withPlayerSession(state, inCombat), messages);
  }

  if (kind === 'mapEvent') {
    // 事件內容：建立 Pending Interaction，等待玩家選項（doc §5.1、§3.1）。
    const contentEventInstance = ctx.map.getContentEventInstance(session.mapId, cmd.contentId);
    if (contentEventInstance === undefined) return reject('dungeon.interactDungeonContent.preconditionFailed');
    const interactionId = ctx.nextInteractionId();
    const pending: PendingDungeonInteraction = {
      interactionId,
      contentId: cmd.contentId,
      contentEventInstance,
      openedOnDungeonMinute: session.elapsedDungeonMinutes,
      revision: 0 as Revision,
    };
    const nextSession: PlayerExplorationSession = {
      ...session,
      pendingInteraction: pending,
      revision: bump(session.revision),
    };
    const messages: TransactionMessageDraft[] = [
      event({
        type: 'PlayerInteractionOpened',
        interactionId,
        teamId,
        kind: 'dungeonEvent',
      }),
    ];
    return accept(withPlayerSession(state, nextSession), messages);
  }

  // chest / control / kidnap 等：直接要求 Map 處理內容（doc §6.1 ResolvePlayerMapContent）。
  // TODO: control / kidnap 需先解決守衛內容；第一版主路徑只處理直接可取的 chest。
  const messages: TransactionMessageDraft[] = [
    internal(MAP_MODULE_ID, {
      type: 'ResolvePlayerMapContent',
      teamId,
      mapId: session.mapId,
      contentId: cmd.contentId,
      distributionId: session.distributionId,
      resolution: { resolverId: defaultResolverId(), outcome: 'success' },
    }),
  ];
  return accept(state, messages);
}

// resolveDungeonInteraction：Session 有匹配 Pending Interaction、選項仍合法。套用資料化結果、
// 清除互動並恢復探索（doc §5.1）。
export function resolveDungeonInteraction(
  state: DungeonModuleState,
  teamId: TeamId,
  cmd: ResolveDungeonInteraction,
  ctx: DungeonContext,
): DungeonHandlerResult {
  const session = getPlayerSession(state, teamId);
  if (session === undefined) return reject('dungeon.resolveDungeonInteraction.preconditionFailed');
  const pending = session.pendingInteraction;
  if (pending === undefined || pending.interactionId !== cmd.interactionId) return reject('dungeon.resolveDungeonInteraction.preconditionFailed');

  // optionId 必須是本事件定義的合法選項——不得信任 UI 傳入。偽造的 optionId 先前會清掉 Pending 並固定回報
  // 成功；現在一律拒絕（不動 Session）。TODO: 依選項解析資料化結果（分支效果／戰鬥／物品）仍待內容軌。
  const legalOptions = ctx.reader.listContentEventOptionIds(pending.contentEventInstance.definitionId);
  if (!legalOptions.includes(cmd.optionId)) {
    return reject('dungeon.resolveDungeonInteraction.illegalOption', { optionId: String(cmd.optionId) });
  }
  const restored: PlayerExplorationSession = {
    ...session,
    pendingInteraction: undefined,
    status: 'exploring',
    revision: bump(session.revision),
  };
  const messages: TransactionMessageDraft[] = [
    internal(MAP_MODULE_ID, {
      type: 'ResolvePlayerMapContent',
      teamId,
      mapId: session.mapId,
      contentId: pending.contentId,
      distributionId: session.distributionId,
      resolution: {
        resolverId: defaultResolverId(),
        outcome: 'success',
        details: { optionId: String(cmd.optionId) as unknown as string },
      },
    }),
  ];
  return accept(withPlayerSession(state, restored), messages);
}

// useDungeonExit：Session 位於合法出口房間、無戰鬥或內容互動。轉 leaving 並關閉 Distribution
// 收集；等 AssetDistributionCompleted 後才關閉 Session 並返城（doc §5.1、§8.2）。
export function useDungeonExit(
  state: DungeonModuleState,
  teamId: TeamId,
  cmd: UseDungeonExit,
  ctx: DungeonContext,
): DungeonHandlerResult {
  const session = getPlayerSession(state, teamId);
  if (session === undefined || session.status !== 'exploring') return reject('dungeon.useDungeonExit.preconditionFailed');
  if (session.pendingInteraction !== undefined) return reject('dungeon.useDungeonExit.preconditionFailed');
  if (session.currentRoomId !== cmd.exitRoomId) return reject('dungeon.useDungeonExit.preconditionFailed');
  if (!ctx.map.isExitRoom(session.mapId, cmd.exitRoomId)) return reject('dungeon.useDungeonExit.preconditionFailed');

  const leaving: PlayerExplorationSession = {
    ...session,
    status: 'leaving',
    revision: bump(session.revision),
  };
  const messages: TransactionMessageDraft[] = [
    internal(DISTRIBUTION_MODULE_ID, {
      type: 'FinalizeAssetDistributionCollection',
      distributionId: session.distributionId,
    }),
  ];
  return accept(withPlayerSession(state, leaving), messages);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.3 Internal Command：ConsumeDungeonGatheringAction（採集互動分鐘）
// ──────────────────────────────────────────────────────────────────────────

// dungeon-gathering-workflow 先送此命令讓 Dungeon 重新驗證 Session／房間／Map Version／阻塞狀態
// 並增加迷宮分鐘；其餘（Resolver、物品、MXP）由 Workflow 共用其他模組命令原子完成（doc §5.3、§8.1）。
export function consumeDungeonGatheringAction(
  state: DungeonModuleState,
  cmd: ConsumeDungeonGatheringAction,
  ctx: DungeonContext,
): DungeonHandlerResult {
  const session = getPlayerSession(state, cmd.teamId);
  if (session === undefined || session.status !== 'exploring') return reject('dungeon.consumeDungeonGatheringAction.preconditionFailed');
  if (session.mapId !== cmd.mapId) return reject('dungeon.consumeDungeonGatheringAction.preconditionFailed');
  if (session.mapVersion !== cmd.mapVersion) return reject('dungeon.consumeDungeonGatheringAction.preconditionFailed');
  if (ctx.map.getMapVersion(cmd.mapId) !== cmd.mapVersion) return reject('dungeon.consumeDungeonGatheringAction.preconditionFailed');
  if (session.pendingInteraction !== undefined) return reject('dungeon.consumeDungeonGatheringAction.preconditionFailed'); // 阻塞狀態。
  if (!ctx.map.isGatheringNodeAvailable(cmd.mapId, cmd.nodeId)) return reject('dungeon.consumeDungeonGatheringAction.preconditionFailed');

  const ruleId = ctx.map.getGatheringNodeRuleId(cmd.mapId, cmd.nodeId);
  if (ruleId === undefined) return reject('dungeon.consumeDungeonGatheringAction.preconditionFailed');
  const minutes = ctx.reader.getGatheringInteractionView(ruleId).dungeonInteractionMinutes;

  const timed = advanceSessionTime(session, minutes, ctx);
  return accept(withPlayerSession(state, timed.session), timed.messages, [], timed.kernelRequests);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.3 Internal Command：StartNpcDungeonRun
// ──────────────────────────────────────────────────────────────────────────

// 建立 NPC Run、collecting 的 NPC 地牢 Distribution，以及（有怪物內容時）引用所有怪物內容的
// dungeonSweep Combat Sequence；排入下一日 npcDungeonDay（doc §5.3、§3.4）。
export function startNpcDungeonRun(
  state: DungeonModuleState,
  cmd: StartNpcDungeonRun,
  ctx: DungeonContext,
): DungeonHandlerResult {
  const explorationRuleId = ctx.npcExplorationRuleId;
  const mapVersion = ctx.map.getMapVersion(cmd.mapId);
  const sequence = ctx.map.listNpcSequence(cmd.mapId);
  const hasMonster = sequence.some((e) => e.kind === 'mapContent');
  const distributionId = ctx.nextDistributionId();
  const runId = ctx.nextRunId();
  const members = ctx.team.getMembers(cmd.teamId);

  // 無怪物內容時不建立空 Sequence，combatSequenceSettled 從開始即 true（不變量 §3.4.9）。
  // TODO: 有怪物內容時 required StartCombatSequence(source=dungeonSweep) 並保存 combatSequenceId；
  //       第一版測試路徑使用無怪物序列。
  const run: NpcDungeonRun = {
    runId,
    teamId: cmd.teamId,
    teamPlanId: cmd.planId,
    participantCharacterIds: members,
    mapId: cmd.mapId,
    mapVersion,
    explorationRuleId,
    distributionId,
    cursorNpcOrder: 0,
    pendingResults: [],
    settlementProgress: {
      mapApplied: false,
      combatSequenceSettled: !hasMonster,
      distributionCompleted: false,
    },
    status: 'exploring',
    startedOnDay: ctx.worldDay,
    revision: 0 as Revision,
    rngContext: ctx.rng,
  };

  const messages: TransactionMessageDraft[] = [
    internal(DISTRIBUTION_MODULE_ID, {
      type: 'StartAssetDistribution',
      distributionId,
      source: { kind: 'dungeonLoot', mapId: cmd.mapId, runId },
      teamId: cmd.teamId,
      participantCharacterIds: members,
      ruleId: ctx.lootDistributionRuleId,
    }),
  ];

  // 排入下一日 npcDungeonDay（doc §5.3）。
  const jobs: ModuleResult<DungeonModuleState>['scheduledJobs'] = [
    {
      type: 'npcDungeonDay',
      dueDay: (ctx.worldDay + 1) as WorldDay,
      ownerModule: DUNGEON_MODULE_ID as ModuleId<'dungeon'>,
      targetId: runId,
      expectedRevision: run.revision,
      rngContext: ctx.rng,
      payload: {},
    },
  ];

  return accept(withNpcRun(state, run), messages, jobs);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 ScheduledJob：npcDungeonDay（每日 N 點探索，doc §7）
// ──────────────────────────────────────────────────────────────────────────

function targetRefForEntry(entry: NpcSequenceEntryView): NpcDungeonTargetRef {
  if (entry.kind === 'mapContent') {
    return { kind: 'mapContent', contentId: entry.contentId, contentRevision: 0 as Revision };
  }
  return { kind: 'gatheringNode', nodeId: entry.nodeId, nodeRevision: 0 as Revision };
}

// 取 1 日探索點，依 Map NPC 序列從游標往後嘗試內容（doc §7 流程）。
export function npcDungeonDay(
  state: DungeonModuleState,
  runId: NpcDungeonRunId,
  ctx: DungeonContext,
): DungeonHandlerResult {
  const run = state.npcRuns[runId];
  // 失效/過期 Job（Run 不存在，或已 settling/closed）→ **接受並 no-op**（不是拒絕）：到期 Job 於交易
  // 提交時被 Scheduler 消耗，若在此拒絕會讓交易回滾、Job 留在佇列而不斷重觸發（見 session.runDueJob）。
  if (run === undefined || run.status !== 'exploring') return accept(state); // settling/closed 不再排（§3.4.6）。

  // 驗證 Team 仍在 Map 且版本相符；否則安全失效（doc §7.2、§5.4 TeamLocationChanged/MapRefreshed）。
  if (!ctx.team.isTeamInMap(run.teamId, run.mapId) || ctx.map.getMapVersion(run.mapId) !== run.mapVersion) {
    const invalid: NpcDungeonRun = { ...run, status: 'invalid', lastProcessedOnDay: ctx.worldDay, revision: bump(run.revision) };
    const messages: TransactionMessageDraft[] = [
      event({ type: 'NpcDungeonRunClosed', runId, teamId: run.teamId, reason: 'invalid' }),
    ];
    return accept(withNpcRun(state, invalid), messages);
  }

  const rule = ctx.reader.getNpcExplorationRule(run.explorationRuleId);
  let points = rule.dailyPointBudget; // 每日重新取得，不跨日累積（不變量 §3.4.5）。

  const sequence = [...ctx.map.listNpcSequence(run.mapId)].sort((a, b) => a.npcOrder - b.npcOrder);

  let cursor = run.cursorNpcOrder;
  const newResults: PendingDungeonResult[] = [];
  const processedRefs: NpcDungeonTargetRef[] = [];
  let enterSettling = false;

  for (const entry of sequence) {
    if (entry.npcOrder < cursor) continue; // 已處理：游標前進（doc §7 flow「已處理→游標前進」）。
    if (points < entry.pointCost) {
      // 點數不足：保留 Run（cursor / pendingResults 不動）、排明日 Job（doc §7 flow「保留」）。
      break;
    }
    // TODO: 怪物內容需扣點並解析下一個 Combat Sequence Challenge（ResolveNextCombatSequenceChallenge）；
    //       成功繼續、失敗立即 settling（doc §7、§7.2）。第一版路徑以非怪物 resolver 成功推進。
    points -= entry.pointCost;
    const ref = targetRefForEntry(entry);
    processedRefs.push(ref);
    newResults.push({
      target: ref,
      npcOrder: entry.npcOrder,
      attemptedOnDay: ctx.worldDay,
      outcome: 'success',
      resolverId: entry.resolverId,
      pendingRewardRefs:
        ref.kind === 'mapContent'
          ? [{ contentId: ref.contentId }]
          : [{ nodeId: ref.nodeId }],
    });
    cursor = entry.npcOrder + 1; // 游標只可向前（不變量 §3.4.4）。
    // TODO: resolver.successBehavior==='leave' 或目標達成時 enterSettling = true（doc §7.2）。
  }

  // 序列已全部走完（無下一筆可處理）→ settling（doc §7 flow）。
  const nothingLeft = sequence.every((e) => e.npcOrder < cursor);
  if (nothingLeft) enterSettling = true;

  const mergedResults = [...run.pendingResults, ...newResults];
  const remainingPoints = points;

  if (!enterSettling) {
    // 保留 Run 並排明日 Job（doc §7 flow「保留 Run；排明日 Job」）。
    const progressed: NpcDungeonRun = {
      ...run,
      cursorNpcOrder: cursor,
      pendingResults: mergedResults,
      lastProcessedOnDay: ctx.worldDay,
      revision: bump(run.revision),
    };
    const messages: TransactionMessageDraft[] = [
      event({
        type: 'NpcDungeonRunProgressed',
        runId,
        processedTargetRefs: processedRefs,
        nextCursor: cursor,
        remainingPoints,
      }),
    ];
    const jobs: ModuleResult<DungeonModuleState>['scheduledJobs'] = [
      {
        type: 'npcDungeonDay',
        dueDay: (ctx.worldDay + 1) as WorldDay,
        ownerModule: DUNGEON_MODULE_ID as ModuleId<'dungeon'>,
        targetId: runId,
        expectedRevision: progressed.revision,
        rngContext: run.rngContext,
        payload: {},
      },
    ];
    return accept(withNpcRun(state, progressed), messages, jobs);
  }

  // 進入 settling：停止（無）Combat Sequence 後 required ApplyNpcDungeonSettlement（doc §7、§7.1）。
  const settling: NpcDungeonRun = {
    ...run,
    cursorNpcOrder: cursor,
    pendingResults: mergedResults,
    status: 'settling',
    lastProcessedOnDay: ctx.worldDay,
    revision: bump(run.revision),
  };
  const messages: TransactionMessageDraft[] = [
    event({
      type: 'NpcDungeonRunProgressed',
      runId,
      processedTargetRefs: processedRefs,
      nextCursor: cursor,
      remainingPoints,
    }),
    internal(MAP_MODULE_ID, {
      type: 'ApplyNpcDungeonSettlement',
      runId,
      mapId: run.mapId,
      mapVersion: run.mapVersion,
      distributionId: run.distributionId,
      pendingResults: mergedResults,
    }),
  ];
  return accept(withNpcRun(state, settling), messages);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.4 訂閱 DomainEvent：三方結算收斂（Map / Combat Sequence / Distribution）
// ──────────────────────────────────────────────────────────────────────────

// 若三項 Settlement 都完成則關閉 Run 並 emit NpcDungeonRunClosed（不變量 §3.4.11）。
function tryCloseRun(
  state: DungeonModuleState,
  run: NpcDungeonRun,
): ModuleResult<DungeonModuleState> {
  const p = run.settlementProgress;
  if (p.mapApplied && p.combatSequenceSettled && p.distributionCompleted && run.status !== 'closed') {
    const closed: NpcDungeonRun = { ...run, status: 'closed', revision: bump(run.revision) };
    const messages: TransactionMessageDraft[] = [
      event({ type: 'NpcDungeonRunClosed', runId: run.runId, teamId: run.teamId, reason: 'completed' }),
    ];
    // TODO: Run 關閉後才送出 ReleaseCombatSequence（doc §6.1）。
    return result(withNpcRun(state, closed), messages);
  }
  return result(withNpcRun(state, run));
}

// NpcDungeonSettlementApplied：只將 appliedResults 追加至 Distribution、關閉收集、令 Run 等待
// 自動分配（doc §5.4）。此處標記 mapApplied 並 required Finalize/Append。
export function handleNpcDungeonSettlementApplied(
  state: DungeonModuleState,
  payload: Readonly<{ runId: NpcDungeonRunId; distributionId: AssetDistributionId }>,
): ModuleResult<DungeonModuleState> {
  const run = state.npcRuns[payload.runId];
  if (run === undefined || run.status !== 'settling') return noop(state);
  const next: NpcDungeonRun = {
    ...run,
    settlementProgress: { ...run.settlementProgress, mapApplied: true },
    revision: bump(run.revision),
  };
  // TODO: 依 appliedResults 逐筆 AppendAssetDistributionResult（正式 Item/Currency）；此處只關閉收集。
  const messages: TransactionMessageDraft[] = [
    internal(DISTRIBUTION_MODULE_ID, {
      type: 'FinalizeAssetDistributionCollection',
      distributionId: run.distributionId,
    }),
  ];
  return { ...tryCloseRun(state, next), outgoingMessages: messages };
}

// CombatSequenceSettled：標記戰鬥串結算完成；三項都完成時才關閉 Run（doc §5.4）。
export function handleCombatSequenceSettled(
  state: DungeonModuleState,
  runId: NpcDungeonRunId,
): ModuleResult<DungeonModuleState> {
  const run = state.npcRuns[runId];
  if (run === undefined) return noop(state);
  const next: NpcDungeonRun = {
    ...run,
    settlementProgress: { ...run.settlementProgress, combatSequenceSettled: true },
    revision: bump(run.revision),
  };
  return tryCloseRun(state, next);
}

// AssetDistributionCompleted：NPC Run 正在 settling → 標記 distributionCompleted 並嘗試關閉；
// 玩家 Session 正在 leaving → 關閉 Session 並開始返城（doc §5.4、§8.2）。
export function handleAssetDistributionCompleted(
  state: DungeonModuleState,
  distributionId: AssetDistributionId,
  ctx: DungeonContext,
): ModuleResult<DungeonModuleState> {
  // NPC Run 分支。
  for (const key of Object.keys(state.npcRuns)) {
    const run = state.npcRuns[key as keyof typeof state.npcRuns];
    if (run !== undefined && run.distributionId === distributionId && run.status === 'settling') {
      const next: NpcDungeonRun = {
        ...run,
        settlementProgress: { ...run.settlementProgress, distributionCompleted: true },
        revision: bump(run.revision),
      };
      return tryCloseRun(state, next);
    }
  }

  // 玩家 Session 分支。
  for (const key of Object.keys(state.playerSessions)) {
    const session = state.playerSessions[key as TeamId];
    if (session !== undefined && session.distributionId === distributionId && session.status === 'leaving') {
      const closed: PlayerExplorationSession = {
        ...session,
        status: 'closed',
        revision: bump(session.revision),
      };
      const completion = ctx.map.getExplorationCompletion(session.mapId);
      const messages: TransactionMessageDraft[] = [
        event({
          type: 'MapExplorationCompleted',
          teamId: session.teamId,
          mapId: session.mapId,
          mapVersion: session.mapVersion,
          explorationKey: completion.explorationKey,
          experienceRuleId: completion.experienceRuleId,
        }),
        // team 契約的 StartReturnFromDungeon 只吃 teamId + mapId；離場城市由 team 自行
        // 以 TeamWorldReader.getMapExitCity(mapId) 解析，不由 dungeon 傳出口房間。
        internal(TEAM_MODULE_ID, {
          type: 'StartReturnFromDungeon',
          teamId: session.teamId,
          mapId: session.mapId,
        }),
      ];
      return result(withPlayerSession(state, closed), messages);
    }
  }

  return noop(state);
}

// ──────────────────────────────────────────────────────────────────────────
// 內部工具
// ──────────────────────────────────────────────────────────────────────────

// 第一版預設 resolver 佔位；真實 resolver 由內容 Definition 指定（doc §2）。
function defaultResolverId(): ResolverId {
  return 'resolver:dungeon-default' as ResolverId;
}

// ──────────────────────────────────────────────────────────────────────────
// CombatEncounterResolved 訂閱者（doc §5.4 表：「對玩家內容處理結果發出 Map 請求，
// 或將 Session 從 inCombat 恢復」）
//
// B.5：11_combat_module.md §432 寫「combat 送 ResolvePlayerMapContent」，但該命令必填
// `distributionId`，而 distributionId 屬於 Dungeon Session（combat 無從取得），
// 03_dungeon_module.md §310 也把這筆列為 dungeon 的外送命令。兩份文件衝突，取
// 「擁有資料的一方發送」：combat 只發已發生事實 CombatEncounterResolved，dungeon 在此收斂。
// 本模組原本宣告了這個訂閱卻沒有實作，玩家戰鬥勝利後地圖內容永遠不會被標記為已處理。
// ──────────────────────────────────────────────────────────────────────────

export function handleCombatEncounterResolved(
  state: DungeonModuleState,
  event: CombatEncounterResolvedPayload,
): ModuleResult<DungeonModuleState> {
  const session = getPlayerSession(state, event.teamId);
  if (session === undefined || session.status !== 'inCombat') return noop(state);

  // 戰敗：探索**結束**——不得回到 exploring（否則全隊戰敗仍能繼續走地牢）。收掉 Session（closed）並請 team
  // 結束地牢 Plan + 返城。[架構待做] 完整版應由 CombatTeamOutcome(canContinue=false) 統一驅動 Team+Dungeon
  // 的退出（該事件與其 Team/Dungeon 訂閱尚未接入 Manifest，見 HANDOFF）。
  if (event.outcome !== 'victory') {
    const closed: PlayerExplorationSession = {
      ...session,
      status: 'closed',
      revision: bump(session.revision),
    };
    return result(withPlayerSession(state, closed), [
      internal(TEAM_MODULE_ID, { type: 'StartReturnFromDungeon', teamId: event.teamId, mapId: session.mapId }),
    ]);
  }

  // 勝利：回到探索狀態。
  const restored: PlayerExplorationSession = {
    ...session,
    status: 'exploring',
    revision: bump(session.revision),
  };
  const next = withPlayerSession(state, restored);

  // 只有「來源為本圖內容」才正式處理該內容（doc §5.4 與 11 §432 的同一條件）。
  const source = event.source;
  if (source.kind !== 'mapContent' || source.mapId !== session.mapId) return result(next);

  return result(next, [
    internal(MAP_MODULE_ID, {
      type: 'ResolvePlayerMapContent',
      teamId: event.teamId,
      mapId: session.mapId,
      contentId: source.contentId,
      distributionId: session.distributionId,
      resolution: { resolverId: defaultResolverId(), outcome: 'success' },
    }),
  ]);
}

// Dungeon 不自訂事件重算以外的 Subscriber；此清單供 Composition 驗證訂閱綁定。
export const dungeonSubscribers = [
  'NpcDungeonSettlementApplied',
  'AssetDistributionCompleted',
  'CombatSequenceSettled',
  'CombatSequenceChallengeResolved',
  'CombatSequenceReadyForSourceCommit',
  'CombatSequenceInvalidated',
  'TeamLocationChanged',
  'CombatEncounterResolved',
  'MapRefreshed',
] as const;
