// contracts/dungeon — Dungeon 模組公開契約（純型別）。
// 來源：docs/00_core/architecture/03_dungeon_module.md（硬化後版）。
// 只包含對外契約：owned Definition、Runtime State/View、Query/Host Port、ScheduledJob、
// Internal Command 與 DomainEvent payload。不含 Handler、Reducer 或任何邏輯。

import type {
  DefinitionHeader,
  DefinitionId,
  ModuleId,
  Revision,
  RngContext,
  ScheduledJobBase,
  WorldDay,
  DungeonMinute,
  // ID 家族（全部來自 core）
  TeamId,
  MapInstanceId,
  RoomId,
  RoomLinkId,
  FixedTrapId,
  GatheringNodeId,
  ContentInstanceId,
  ContentEventInstanceId,
  ContentEventDefinitionId,
  ContentEventOptionId,
  InteractionId,
  PlayerMapKnowledgeId,
  NpcDungeonRunId,
  TeamPlanId,
  CharacterId,
  AssetDistributionId,
  GatheringResolutionId,
  NpcExplorationRuleId,
  InteractionRuleId,
  ResolverId,
  GatheringRuleId,
  ExperienceAwardRuleId,
  EncounterGroupDefinitionId,
  RngStreamId,
} from '../core';

// 跨模組引用：Dungeon 的 NPC 目標種類沿用 Map 的內容種類與格座標。
import type { MapContentKind, GridCell } from '../map';
// 外送 Internal Command 一律引用接收模組契約的真實型別（見 §6.1）。
import type {
  OpenMapDoor,
  ResolvePlayerMapContent,
  ApplyNpcDungeonSettlement,
} from '../map';
import type { StartCombatEncounterCommand } from '../combat';
import type {
  StartAssetDistributionCommand,
  FinalizeAssetDistributionCollectionCommand,
} from '../distribution';
import type { StartReturnFromDungeonPayload } from '../team';

// ──────────────────────────────────────────────────────────────────────────
// 本地 ID / 外部占位型別
// ──────────────────────────────────────────────────────────────────────────

// [INVENTED] core 未提供；NpcExplorationRuleDefinition.stopPolicyId 使用。
export type NpcStopPolicyId = DefinitionId<'npc-stop-policy'>;

// [INVENTED] core 未提供；NpcDungeonTargetResolverDefinition.outcomeRuleId 使用。
export type OutcomeRuleId = DefinitionId<'outcome-rule'>;

// [EXTERNAL PLACEHOLDER] 由內容/事件模組擁有；此處給出最小可編譯結構。
export type ContentEventInstance = Readonly<{
  instanceId: ContentEventInstanceId;
  definitionId: ContentEventDefinitionId;
  rngStreamId: RngStreamId;
}>;

// [EXTERNAL PLACEHOLDER] 由 Gathering Service（module 19）擁有；僅保留文件引用的欄位。
export type GatheringResolution = Readonly<{
  resolutionId: GatheringResolutionId;
  gatheringRuleId: GatheringRuleId;
  participantCharacterIds: readonly CharacterId[];
}>;

// [EXTERNAL PLACEHOLDER] 由 Combat Sequence（module 21）擁有；此處僅供 Host Port 型別完備。
export type CombatSequenceId = DefinitionId<'combat-sequence'>;
export type CombatSequenceChallengeResultId = DefinitionId<'combat-sequence-challenge-result'>;
export type CombatSequenceStopReason = string;
export type CombatSequenceInvalidReason = string;
export type CombatSequenceChallengeResult = Readonly<{
  resultId: CombatSequenceChallengeResultId;
  contentId: ContentInstanceId;
  outcome: 'success' | 'failure';
}>;
export type StartCombatSequence = Readonly<{
  source: 'dungeonSweep';
  teamId: TeamId;
  challenges: readonly ContentInstanceId[];
}>;
export type CommitCombatSequenceSourceResults = Readonly<{
  sequenceId: CombatSequenceId;
  acceptedResultIds: readonly CombatSequenceChallengeResultId[];
  sourceCommitId: string;
}>;

// ──────────────────────────────────────────────────────────────────────────
// 2. 靜態資料契約（owned Definition + Reader / Host Port）
// ──────────────────────────────────────────────────────────────────────────

export type DungeonInteractionRuleDefinition = DefinitionHeader &
  Readonly<{
    traversalMinutesPerCell: number; // 第一版為 30
    redDoorOpenMinutes: number;
    trapResolverId: ResolverId;
  }>;

export type NpcDungeonTargetKind =
  | Readonly<{ kind: 'mapContent'; contentKind: MapContentKind }>
  | Readonly<{ kind: 'gatheringNode' }>;

export type NpcDungeonTargetResolverDefinition = DefinitionHeader &
  Readonly<{
    supportedTargetKinds: readonly NpcDungeonTargetKind[];
    outcomeRuleId: OutcomeRuleId;
    successBehavior: 'continue' | 'leave';
  }>;

export type NpcExplorationRuleDefinition = DefinitionHeader &
  Readonly<{
    dailyPointBudget: number; // 第一版基礎資料為 10
    stopPolicyId: NpcStopPolicyId;
  }>;

export interface DungeonDefinitionReader {
  getNpcExplorationRule(id: NpcExplorationRuleId): NpcExplorationRuleDefinition;
  getNpcResolver(id: ResolverId): NpcDungeonTargetResolverDefinition;
  getDungeonInteractionRule(id: InteractionRuleId): DungeonInteractionRuleDefinition;
  getGatheringInteractionView(id: GatheringRuleId): Readonly<{
    ruleId: GatheringRuleId;
    dungeonInteractionMinutes: number;
  }>;
}

// Combat Sequence 的命令 Port（非逐場戰鬥模擬器）。
export interface CombatSequenceHostPort {
  start(input: StartCombatSequence): CombatSequenceId;
  resolveNext(
    sequenceId: CombatSequenceId,
    expectedContentId: ContentInstanceId,
  ): CombatSequenceChallengeResult;
  skipNext(sequenceId: CombatSequenceId, expectedContentId: ContentInstanceId): void;
  stop(sequenceId: CombatSequenceId, reason: CombatSequenceStopReason): void;
  commitSourceResults(input: CommitCombatSequenceSourceResults): void;
  invalidate(sequenceId: CombatSequenceId, reason: CombatSequenceInvalidReason): void;
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Runtime State（Dungeon 唯一可寫）
// ──────────────────────────────────────────────────────────────────────────

export type PendingDungeonInteraction = Readonly<{
  interactionId: InteractionId;
  contentId: ContentInstanceId;
  contentEventInstance: ContentEventInstance;
  openedOnDungeonMinute: DungeonMinute;
  revision: Revision;
}>;

export type PlayerExplorationSession = Readonly<{
  teamId: TeamId;
  mapId: MapInstanceId;
  mapVersion: number;
  distributionId: AssetDistributionId;
  currentRoomId: RoomId;
  entryCell: GridCell;
  elapsedDungeonMinutes: DungeonMinute;
  status: 'exploring' | 'inCombat' | 'leaving' | 'closed';
  pendingInteraction?: PendingDungeonInteraction;
  revision: Revision;
}>;

export type PlayerMapKnowledge = Readonly<{
  knowledgeId: PlayerMapKnowledgeId;
  teamId: TeamId;
  mapId: MapInstanceId;
  revealedRoomIds: readonly RoomId[];
  discoveredLinkIds: readonly RoomLinkId[];
  knownTrapIds: readonly FixedTrapId[];
  revision: Revision;
}>;

// NPC 暫存結果的目標引用（怪物內容或採集點）。
export type NpcDungeonTargetRef =
  | Readonly<{ kind: 'mapContent'; contentId: ContentInstanceId; contentRevision: Revision }>
  | Readonly<{
      kind: 'gatheringNode';
      nodeId: GatheringNodeId;
      nodeRevision: Revision;
      gatheringResolution?: GatheringResolution;
    }>;

// [INVENTED] PendingDungeonResult.pendingRewardRefs 元素；文件僅稱 PendingRewardRef。
export type PendingRewardRef = Readonly<{
  contentId?: ContentInstanceId;
  nodeId?: GatheringNodeId;
}>;

export type PendingDungeonResult = Readonly<{
  target: NpcDungeonTargetRef;
  npcOrder: number;
  attemptedOnDay: WorldDay;
  outcome: 'success' | 'failure' | 'skip';
  resolverId: ResolverId;
  combatSequenceResultId?: CombatSequenceChallengeResultId;
  pendingRewardRefs: readonly PendingRewardRef[];
}>;

export type NpcDungeonRun = Readonly<{
  runId: NpcDungeonRunId;
  teamId: TeamId;
  teamPlanId: TeamPlanId;
  participantCharacterIds: readonly CharacterId[];
  mapId: MapInstanceId;
  mapVersion: number;
  explorationRuleId: NpcExplorationRuleId;
  distributionId: AssetDistributionId;
  combatSequenceId?: CombatSequenceId;
  cursorNpcOrder: number;
  pendingResults: readonly PendingDungeonResult[];
  settlementProgress: Readonly<{
    mapApplied: boolean;
    combatSequenceSettled: boolean;
    distributionCompleted: boolean;
  }>;
  status: 'exploring' | 'settling' | 'closed' | 'invalid';
  startedOnDay: WorldDay;
  lastProcessedOnDay?: WorldDay;
  revision: Revision;
  rngContext: RngContext;
}>;

export type DungeonState = Readonly<{
  playerSessions: Readonly<Record<TeamId, PlayerExplorationSession>>;
  playerMapKnowledge: Readonly<Record<PlayerMapKnowledgeId, PlayerMapKnowledge>>;
  npcRuns: Readonly<Record<NpcDungeonRunId, NpcDungeonRun>>;
}>;

// ──────────────────────────────────────────────────────────────────────────
// 4. 公開 Query
// ──────────────────────────────────────────────────────────────────────────

export type PlayerExplorationSessionView = PlayerExplorationSession;
export type PlayerMapKnowledgeView = PlayerMapKnowledge;
export type NpcDungeonRunView = NpcDungeonRun;
export type PendingDungeonInteractionView = PendingDungeonInteraction;

// [INVENTED] getNpcProgress 的摘要投影；文件未給出結構。
export type NpcDungeonProgressView = Readonly<{
  runId: NpcDungeonRunId;
  cursorNpcOrder: number;
  status: NpcDungeonRun['status'];
  remainingPoints: number;
}>;

export interface DungeonQuery {
  getPlayerSession(teamId: TeamId): PlayerExplorationSessionView | undefined;
  getPlayerMapKnowledge(
    teamId: TeamId,
    mapId: MapInstanceId,
  ): PlayerMapKnowledgeView | undefined;
  getNpcRun(runId: NpcDungeonRunId): NpcDungeonRunView | undefined;
  getNpcRunForTeam(teamId: TeamId): NpcDungeonRunView | undefined;
  getNpcProgress(runId: NpcDungeonRunId): NpcDungeonProgressView;
  getPendingInteraction(teamId: TeamId): PendingDungeonInteractionView | undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// 5.1 玩家 Command（Dungeon 為唯一 Handler）
// ──────────────────────────────────────────────────────────────────────────

// [INFERRED] 玩家 Command payload 由 §5.1 前置條件與責任描述推導；actorTeamId 由信封提供。
export type StartPlayerExploration = Readonly<{ type: 'startPlayerExploration' }>;
export type MoveDungeonRoom = Readonly<{ type: 'moveDungeonRoom'; targetRoomId: RoomId }>;
export type OpenDungeonDoor = Readonly<{ type: 'openDungeonDoor'; linkId: RoomLinkId }>;
export type GatherDungeonNode = Readonly<{ type: 'gatherDungeonNode'; nodeId: GatheringNodeId }>;
export type UseDungeonExit = Readonly<{ type: 'useDungeonExit'; exitRoomId: RoomId }>;
export type InteractDungeonContent = Readonly<{
  type: 'interactDungeonContent';
  contentId: ContentInstanceId;
}>;
export type ResolveDungeonInteraction = Readonly<{
  type: 'resolveDungeonInteraction';
  interactionId: InteractionId;
  optionId: ContentEventOptionId;
}>;

export type DungeonGameCommand =
  | StartPlayerExploration
  | MoveDungeonRoom
  | OpenDungeonDoor
  | GatherDungeonNode
  | UseDungeonExit
  | InteractDungeonContent
  | ResolveDungeonInteraction;

// ──────────────────────────────────────────────────────────────────────────
// 5.2 ScheduledJob
// ──────────────────────────────────────────────────────────────────────────

export type NpcDungeonDayJob = ScheduledJobBase<
  'npcDungeonDay',
  ModuleId<'dungeon'>,
  NpcDungeonRunId,
  Readonly<Record<string, never>>
>;

export type DungeonScheduledJob = NpcDungeonDayJob;

// ──────────────────────────────────────────────────────────────────────────
// 5.3 Internal Command（Dungeon 為唯一 Handler）
// ──────────────────────────────────────────────────────────────────────────

export type StartNpcDungeonRun = Readonly<{
  type: 'StartNpcDungeonRun';
  teamId: TeamId;
  mapId: MapInstanceId;
  planId: TeamPlanId;
}>;

// [INFERRED] 欄位由 §5.3 重新驗證描述推導。
export type ConsumeDungeonGatheringAction = Readonly<{
  type: 'ConsumeDungeonGatheringAction';
  teamId: TeamId;
  mapId: MapInstanceId;
  mapVersion: number;
  nodeId: GatheringNodeId;
}>;

export type DungeonInternalCommand = StartNpcDungeonRun | ConsumeDungeonGatheringAction;

// ──────────────────────────────────────────────────────────────────────────
// 6. 輸出 DomainEvent（最少 payload）
// ──────────────────────────────────────────────────────────────────────────

export type PlayerDungeonSessionStarted = Readonly<{
  type: 'PlayerDungeonSessionStarted';
  teamId: TeamId;
  mapId: MapInstanceId;
  mapVersion: number;
}>;

export type PlayerDungeonTimeAdvanced = Readonly<{
  type: 'PlayerDungeonTimeAdvanced';
  teamId: TeamId;
  minutes: DungeonMinute;
  worldDayCrossed?: boolean;
}>;

export type PlayerInteractionOpened = Readonly<{
  type: 'PlayerInteractionOpened';
  interactionId: InteractionId;
  teamId: TeamId;
  interactionKind: 'dungeonEvent';
}>;

export type MapExplorationCompleted = Readonly<{
  type: 'MapExplorationCompleted';
  teamId: TeamId;
  mapId: MapInstanceId;
  mapVersion: number;
  explorationKey: string;
  experienceRuleId: ExperienceAwardRuleId;
}>;

export type NpcDungeonRunProgressed = Readonly<{
  type: 'NpcDungeonRunProgressed';
  runId: NpcDungeonRunId;
  processedTargetRefs: readonly NpcDungeonTargetRef[];
  nextCursor: number;
  remainingPoints: number;
}>;

export type NpcDungeonRunClosed = Readonly<{
  type: 'NpcDungeonRunClosed';
  runId: NpcDungeonRunId;
  teamId: TeamId;
  reason: 'completed' | 'invalid' | 'stopped';
}>;

export type DungeonDomainEvent =
  | PlayerDungeonSessionStarted
  | PlayerDungeonTimeAdvanced
  | PlayerInteractionOpened
  | MapExplorationCompleted
  | NpcDungeonRunProgressed
  | NpcDungeonRunClosed;

// ──────────────────────────────────────────────────────────────────────────
// 6.1 輸出 Internal Command
//
// B.5：這裡原本自行宣告了一個 `StartCombatEncounter`，欄位與 combat 契約真正接收的
// StartCombatEncounterCommand 完全不同（缺 source/participantSnapshotRevision/rngContext），
// 而訊息在 TransactionMessageDraft 以 unknown 傳遞，tsc 抓不到。改為直接引用**接收模組的
// 真實型別**：發送端與接收端從此由編譯器保證一致。
// ──────────────────────────────────────────────────────────────────────────

export type DungeonOutboundInternalCommand =
  | OpenMapDoor
  | ResolvePlayerMapContent
  | ApplyNpcDungeonSettlement
  | StartCombatEncounterCommand
  | StartAssetDistributionCommand
  | FinalizeAssetDistributionCollectionCommand
  | StartReturnFromDungeonPayload;
