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
  NpcDungeonTargetResolverId,
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
// PlayerInteractionOpened 事件由 team 擁有（單一聯集，三個模組共發）；此處引用擁有者型別。
import type { StartReturnFromDungeonPayload, PlayerInteractionOpenedEvent } from '../team';

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

// 由 Gathering Service（module 19）擁有。原本此處只保留 3 個欄位的影子版，
// 與擁有者的完整結構（contributorCharacterId / masteryId / yields …）不同。
import type { GatheringResolution } from '../gathering';
export type { GatheringResolution };

// ── Combat Sequence（module 21）─────────────────────────────────────────
//
// 這一整組型別由 combat-sequence 擁有。此處原本是一份**影子契約**：自行宣告了
// ChallengeResultId（DefinitionId 而非 RuntimeId）、把 StopReason/InvalidReason 放寬成
// `string`、sourceCommitId 用普通 `string`，且 StartCombatSequence / ChallengeResult /
// CommitCombatSequenceSourceResults 的欄位與擁有者完全不同。因為 Host Port 至今沒有實作，
// 這些差異不會被編譯器發現，等真正接線時才會爆成型別衝突或被迫轉型。
// 一律改為引用擁有者的真實型別。
import type {
  CombatSequenceId,
  CombatSequenceChallengeId,
  CombatSequenceChallengeResultId,
  CombatSequenceStopReason,
  CombatSequenceInvalidReason,
  StartCombatSequence,
  ResolveNextCombatSequenceChallenge,
  SkipNextCombatSequenceChallenge,
  StopCombatSequence,
  InvalidateCombatSequence,
  CommitCombatSequenceSourceResults,
} from '../combat-sequence';

export type {
  CombatSequenceId,
  CombatSequenceChallengeId,
  CombatSequenceChallengeResultId,
  CombatSequenceStopReason,
  CombatSequenceInvalidReason,
  StartCombatSequence,
  ResolveNextCombatSequenceChallenge,
  SkipNextCombatSequenceChallenge,
  StopCombatSequence,
  InvalidateCombatSequence,
  CommitCombatSequenceSourceResults,
};

// ──────────────────────────────────────────────────────────────────────────
// 2. 靜態資料契約（owned Definition + Reader）
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
  getNpcResolver(id: NpcDungeonTargetResolverId): NpcDungeonTargetResolverDefinition;
  getDungeonInteractionRule(id: InteractionRuleId): DungeonInteractionRuleDefinition;
  getGatheringInteractionView(id: GatheringRuleId): Readonly<{
    ruleId: GatheringRuleId;
    dungeonInteractionMinutes: number;
  }>;
  // 內容事件的合法選項 ID 清單（供 resolveDungeonInteraction 驗證玩家送來的 optionId，不得信任 UI）。
  listContentEventOptionIds(definitionId: ContentEventDefinitionId): readonly ContentEventOptionId[];
}

// Combat Sequence 的互動走**交易模型**，不是同步 Host Port。
//
// 原本這裡有一個 `CombatSequenceHostPort`，其 `resolveNext()` **同步回傳** `CombatSequenceChallengeResult`。
// 那違反核心架構（00_shared_contracts.md §5）：跨模組不能同步呼叫並取回結果，否則繞過 Transaction
// Runner、Slice 所有權與交易回滾。正確流程是「命令草稿出、事件訂閱回」：
//   - Dungeon required `StartCombatSequence` / `ResolveNextCombatSequenceChallenge` / `SkipNext…` /
//     `StopCombatSequence` / `CommitCombatSequenceSourceResults` / `InvalidateCombatSequence`
//     （皆為 combat-sequence 契約的 Internal Command；見下方 DungeonOutboundInternalCommand）。
//   - combat-sequence 處理後**發布事件**：`CombatSequenceChallengeResolved`（單題結果）、
//     `CombatSequenceSettled`（整條結算）。Dungeon **訂閱**這些事件後才續行（見 §10 / handler）。
// sequenceId 由 Dungeon 以自己的交易 ID cursor 鑄造（StartCombatSequence 的輸入欄位），故無需回傳。

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
  // leaving  —— 正常從出口離場：等 Distribution 完成後關閉 Session、發完成經驗、返城。
  // defeated —— 全隊戰敗離場：同樣**等 Distribution 完成**（doc §443：競拍期間仍算位於冒險地，
  //             不可開始返城），但不算完成探索，不發 MapExplorationCompleted 的完成經驗。
  //             兩者分開才能既守住分配屏障、又不把戰敗當成通關。
  status: 'exploring' | 'inCombat' | 'leaving' | 'defeated' | 'closed';
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
  // 這筆結果是由哪個 **NPC 目標 Resolver Definition** 產生的（不是泛用 ResolverId）。
  resolverId: NpcDungeonTargetResolverId;
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
// doc §4 明文：「Dungeon Query 不公開其他隊伍的 RNG seed、未結算獎勵細節或可被玩家利用的
// NPC 隱藏結果；UI 只取得需要顯示的進度摘要。」
//
// 這個 View 原本寫成 `= NpcDungeonRun` 的別名，於是三件該遮的東西全部公開：
//   * `rngContext` —— 該隊的 RNG seed 與游標。拿到它就能預測那支 NPC 隊後續每一次擲骰。
//   * `pendingResults[].outcome` —— 尚未結算的成敗，正是「可被玩家利用的 NPC 隱藏結果」。
//   * `pendingResults[].pendingRewardRefs` —— 未結算獎勵細節。
//
// 別名的問題不只是「剛好多公開了幾個欄位」：它讓「投影」在型別上根本不存在，所以沒有任何東西
// 會在有人多讀一個欄位時失敗。改成真正的投影後，要洩漏就得先改這個型別。
//
// 未結算成果只以**筆數**出現：UI 看得到「這隊已經嘗試過幾個目標」（進度），看不到成敗與獎勵。
// 不要把 outcome 或 pendingRewardRefs 加回來——那是 §4 直接點名禁止的資訊。
export type NpcDungeonRunView = Readonly<
  Omit<NpcDungeonRun, 'rngContext' | 'pendingResults'> & {
    pendingResultCount: number;
  }
>;
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

// **Dungeon 整個模組目前不註冊任何能力。**
//
// 原因不是個別 Handler 沒寫，而是流程收斂不了：入場、NPC 探索結算、以及戰敗路徑都會送出
// StartAssetDistribution / FinalizeAssetDistributionCollection，而 Distribution 模組不存在
// （沒有 Slice、沒有 Handler、沒有 Owner）。任何真的跑起來的地牢流程都會在交易中失敗。
//
// 規範 §10：未閉合的 Capability 不進正式 Manifest、不註冊入口。移動／開門／互動／解析雖然
// 各自已實作且有模組測試，但它們是同一個未閉合流程的一部分——單獨開放只會讓玩家進到
// 一個結束不了的狀態。
//
// 已註冊的，只有下列四筆：它們已實作、有測試，且**只送出有 Owner 的命令**
// （OpenMapDoor / ResolvePlayerMapContent，皆由 map 接收）。
//
// 不註冊：startPlayerExploration、useDungeonExit（送 Distribution 命令）、gatherDungeonNode
// （Workflow 未實作）、StartNpcDungeonRun 與 npcDungeonDay（NPC 流程同樣送 Distribution），
// 以及全部 Event Subscriber（戰敗路徑會送 FinalizeAssetDistributionCollection）。
//
// 結果是玩家目前無法進入地牢——那正是「未閉合就不開放」該有的樣子。Handler 與測試都保留。
export type DungeonGameCommand =
  | MoveDungeonRoom
  | OpenDungeonDoor
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

// 同上：NPC 地牢流程也會送出 Distribution 命令，故不註冊。

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

// PlayerInteractionOpened 由 team 擁有（見檔首 import）；dungeon 以 kind: 'dungeonEvent' 發此事件。

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
  | PlayerInteractionOpenedEvent
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
  | StartReturnFromDungeonPayload
  // combat-sequence 命令（取代已移除的同步 Host Port）。combat-sequence 的個別命令型別不內嵌
  // 判別欄（在其自己的 union 才加），故此處比照 combat-sequence 的樣式以 `({ type } & payload)` 帶入。
  | ({ type: 'StartCombatSequence' } & StartCombatSequence)
  | ({ type: 'ResolveNextCombatSequenceChallenge' } & ResolveNextCombatSequenceChallenge)
  | ({ type: 'SkipNextCombatSequenceChallenge' } & SkipNextCombatSequenceChallenge)
  | ({ type: 'StopCombatSequence' } & StopCombatSequence)
  | ({ type: 'CommitCombatSequenceSourceResults' } & CommitCombatSequenceSourceResults)
  | ({ type: 'InvalidateCombatSequence' } & InvalidateCombatSequence);
