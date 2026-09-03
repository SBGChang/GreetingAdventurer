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
  ResolveMapTrap,
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

// NpcStopPolicyId 的擁有者是 npc-behavior（NPC 何時停止探索是它的決策規則）。這裡曾經有一份
// 同名宣告——同一個 DefinitionId 兩個來源，跨模組傳遞時編譯器看不出不匹配。
import type { NpcStopPolicyId } from '../npc-behavior';
export type { NpcStopPolicyId };

// 本模組專屬的 Definition ID。它只被 dungeon 自己的 NpcDungeonTargetResolverDefinition 使用，
// 所以 dungeon **就是**擁有者——模組專屬 ID 不需要出現在 core（同 team 的 FreeActionRuleId 等）。
export type OutcomeRuleId = DefinitionId<'outcome-rule'>;

// ContentEventInstance 住在 contracts/core（沒有模組擁有它——dungeon 與 team 都只是消費者）。
// 這裡曾經有一份本地宣告，team 也有一份形狀不同的，跨模組傳遞時編譯器看不出不匹配。
import type {
  ContentEventDefinition,
  ContentEventInstance,
  ContentEventOptionDefinition,
} from '../core';
export type { ContentEventInstance, ContentEventDefinition, ContentEventOptionDefinition };

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
    traversalMinutesPerCell: number;
    redDoorOpenMinutes: number;
    trapResolverId: ResolverId;
    // 一個迷宮日有多少分鐘（跨越此邊界即跨午夜）。原本這個量住在 DungeonContext 上、由組合層
    // 傳入，於是它的真正來源是「誰組裝 Context」而不是內容——改探索節奏得改程式。它與同一條
    // 規則裡的移動／開門分鐘是同一組可調量，所以住在一起。
    minutesPerDungeonDay: number;
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
  // 單一選項的完整定義（含 effectIds）。回 undefined 表示這個事件定義沒有這個選項——
  // 呼叫端必須拒絕，不得當成「沒有效果的合法選項」。
  getContentEventOption(
    definitionId: ContentEventDefinitionId,
    optionId: ContentEventOptionId,
  ): ContentEventOptionDefinition | undefined;
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

// 這筆結果會產出獎勵的來源（03_dungeon_module.md §4）。兩個欄位都選填且**互斥**——來源是地圖
// 內容或採集點，不會同時是兩者。
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

// 怪物內容 ↔ Combat Sequence Challenge 的對照（03_dungeon_module.md §3.4.9：「兩邊怪物游標必須
// 指向同一個下一個 Content」）。Run 開始時依 npcOrder 一次建立，之後只讀不改。
//
// 為什麼宿主必須自己記住這份對照：`ResolveNextCombatSequenceChallenge` 與
// `SkipNextCombatSequenceChallenge` 都必填 `expectedChallengeId`（那是兩邊游標一致的檢查），
// 而 `CombatSequenceQuery` 刻意不公開 challengeId。跨模組同步查詢又是被禁止的，
// 所以唯一正確的作法是把開始時拿到的對照留在自己的 Slice 裡。
export type NpcDungeonCombatChallengeRef = Readonly<{
  npcOrder: number;
  contentId: ContentInstanceId;
  challengeId: CombatSequenceChallengeId;
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
  // 依 npcOrder 遞增，與 StartCombatSequence 帶出的 challenges 同序。地圖沒有怪物內容時為空陣列
  // ——不變量 §3.4.9 明訂「沒有怪物時不得建立空 Sequence」，所以空陣列必然伴隨
  // `combatSequenceId === undefined` 與 `settlementProgress.combatSequenceSettled === true`。
  combatSequenceChallenges: readonly NpcDungeonCombatChallengeRef[];
  // 已送出 Resolve/Skip、正在等 `CombatSequenceChallengeResolved` 的那一題。
  // 怪物內容的成敗要等事件回來才知道，所以當日剩餘流程在 Subscriber 續行；這個欄位讓續行只認
  // 自己送出的那一題，別條 Sequence（例如單場掃蕩）的事件一律略過。
  awaitingCombatChallengeId?: CombatSequenceChallengeId;
  // 今日剩餘探索點數。每次 `npcDungeonDay` 重新取得，不跨日累積（不變量 §3.4.5）。
  //
  // 它原本只是 `npcDungeonDay` 的區域變數，因為一天的處理不會中斷。接上 Combat Sequence 後，
  // 一天會被切成「送命令 → 收事件 → 續行」數段，區域變數活不到續行的那一刻——把剩餘點數
  // 重新推導出來需要「哪些結果算今天的、各花幾點」兩份資料的交叉比對，而那正是這個欄位。
  remainingDailyPoints: number;
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
//
// `combatSequenceChallenges` 與 `awaitingCombatChallengeId` 同樣不公開：前者是「這張圖還剩哪幾個
// 怪物內容沒打」的完整名單，後者是「這一刻正在打哪一個」，兩者都落在 §4 的「可被玩家利用的
// NPC 隱藏結果」。玩家需要的進度摘要由 `cursorNpcOrder` 與 `NpcDungeonProgressView` 提供。
export type NpcDungeonRunView = Readonly<
  Omit<
    NpcDungeonRun,
    'rngContext' | 'pendingResults' | 'combatSequenceChallenges' | 'awaitingCombatChallengeId'
  > & {
    pendingResultCount: number;
  }
>;
export type PendingDungeonInteractionView = PendingDungeonInteraction;

// getNpcProgress 的回傳（03_dungeon_module.md §4）。只有進度，沒有任何逐筆成敗——doc 明文要求
// 「UI 只取得需要顯示的進度摘要」。remainingPoints 只在探索中有意義，其餘狀態為 0。
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

// 玩家 Command payload（03_dungeon_module.md §5.1）。只帶「要對哪一個目標動作」所需的 ID；
// 操作者不入 payload，由 GameCommandEnvelope.actorTeamId 提供（玩家不得指定別隊）。
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

// **這個 union 只列已閉合的能力**（規範 §10：沒閉合的 Capability 不進正式 Manifest、不註冊入口）。
//
// ── 舊理由已經過期 ────────────────────────────────────────────────────────
// 這段話原本寫「Distribution 模組不存在（沒有 Slice、沒有 Handler、沒有 Owner），所以送出
// StartAssetDistribution 的流程一定跑不完」。Wave D 之後那不再成立：distribution 模組已實作並
// 註冊，`StartAssetDistribution` / `AppendAssetDistributionResult` /
// `FinalizeAssetDistributionCollection` 三筆都有 Owner，`StartReturnFromDungeon`（team）、
// `StartCombatEncounter`（combat）與六筆 combat-sequence 命令也都有。**送出面已經不是阻塞理由。**
//
// ── 重新判定的結果：入場與離場仍然不加回來 ────────────────────────────────
// 玩家進到地牢之後，地牢裡的東西必須**每一種都判定得出來**。目前還做不到，具體缺在四處：
//
// 1. `AssetDistributionCompleted → dungeon` 這筆訂閱在 `manifest.ts` 與 `router.ts` 都還沒有綁定
//    （模組這側的 Handler `handleAssetDistributionCompleted` 存在，也已列進
//    `dungeonModuleContract.subscriptionHandlerIds`）。沒有那個綁定，`useDungeonExit` 把 Session
//    轉成 `leaving` 之後就停在那裡：Session 不會關閉、不會返城，而且不會有任何錯誤——
//    §8.2 的離場流程少了最後一段。
//
// 2. 固定採集點沒有玩家入口。`gatherDungeonNode` 的入口依 §5.1 是
//    `dungeon-gathering-workflow`，而 `app/workflows` 底下沒有這個 Workflow，所以它連
//    `GameCommand` union 都進不來。採集點獨占一個房間的內容槽（01_map_module.md §2.2），
//    玩家站在 available 節點前沒有任何合法指令可下。
//
// 3. 玩家路徑的內容解析 Resolver 沒有資料。`MapContentInstance.playerResolverId` 是選填的，
//    正式 Content Pack 目前沒有任何一筆填了它，於是寶箱、以及守衛清空後的控制／綁架，
//    一律得到 `dungeon.interactDungeonContent.contentResolverMissing`。typed rejection 是合法
//    出口，但那說的正是「這種內容現在判定不出來」。
//
// 4. `DungeonMapPort` 沒有生產實作（`app/content/cross-module-ports.ts` 目前只組得出
//    `DungeonTeamPort`；房間拓樸、內容種類、守衛名單、陷阱與 NPC 序列都還沒有真實來源）。
//
// 第 1 點整合者補一筆綁定就好；2、3、4 是別的軌上的工作。四點沒有全部完成之前，
// `startPlayerExploration` 與 `useDungeonExit` 不加回這個 union——**寧可不讓玩家進來，
// 也不要讓他進到一個內容判定不完整的地牢。**
//
// ── NPC 側同樣不註冊 ──────────────────────────────────────────────────────
// `StartNpcDungeonRun`（Internal Command）與 `npcDungeonDay`（Job）現在會為怪物內容開一條
// dungeonSweep Combat Sequence，並由 `CombatSequenceChallengeResolved` 推進。兩件事還不成立：
//   * 21_combat_sequence_module.md §3.2 指名由 `app/composition` 的
//     `CombatSequenceSnapshotAssembler` 組出 allocation／teamPower／challenge 快照，那個
//     Assembler 不存在，所以 `DungeonCombatSequencePort.planDungeonSweep` 沒有生產實作——
//     任何有怪物的圖都會得到 `dungeon.startNpcDungeonRun.combatSequencePlanUnavailable`。
//   * 四筆 combat-sequence 訂閱（ChallengeResolved / ReadyForSourceCommit / Settled /
//     Invalidated）在 Manifest 與 Router 都還沒有綁定。少了綁定，送出去的
//     `ResolveNextCombatSequenceChallenge` 拿不到結果，Run 會停在 `awaitingCombatChallengeId`
//     且不再排 Job——不會有任何錯誤，那條 Run 只是安靜地不動了。
//
// ── 已註冊的四筆 ──────────────────────────────────────────────────────────
// 移動、開門、互動與（經 content-event-resolution Workflow 入口的）選項解析。它們送出的
// OpenMapDoor / ResolveMapTrap / ResolvePlayerMapContent / StartCombatEncounter 都有 Owner。
// ── 2026-08-30：入場與離場加回來 ──────────────────────────────────────────
// 上面列的四個阻塞點現況：
//   1. `AssetDistributionCompleted → dungeon` 訂閱：**已綁**（manifest.ts 的 EVENT_SUBSCRIPTIONS
//      與 router.ts 的 'AssetDistributionCompleted::dungeon' 都在），離場流程收得了尾。
//   2. 固定採集點沒有玩家入口：仍然沒有，但**現行內容沒有任何採集點**
//      （雲華九張地圖 gatheringNodes 全為空），所以它擋不到任何一格。gatherDungeonNode
//      仍然不進 union——沒有入口就是沒有入口，等 Workflow 寫好再加。
//   3. 玩家內容解析 Resolver 沒有資料：仍然沒有，但**現行內容沒有任何 map content**
//      （內容生成 resolver 尚未接線），所以沒有任何一筆寶箱／控制內容可以被互動到。
//      interactDungeonContent 早就在 union 裡，缺資料時回 typed rejection——合法出口。
//   4. `DungeonMapPort` 沒有生產實作：**已補**（app/content/dungeon-map-port.ts）。
//
// 也就是說：探索迴圈本身（進場 → 移動 → 開門 → 揭露 → 走到出口 → 返城）現在每一步都有
// 真實來源，沒有任何一步需要靠預設值走完。所以入場與離場加回來。
export type DungeonGameCommand =
  | StartPlayerExploration
  | MoveDungeonRoom
  | OpenDungeonDoor
  | InteractDungeonContent
  | UseDungeonExit
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

// 欄位就是 03_dungeon_module.md §5.3 那句「重新驗證 Session、目前房間、Map Version、探索參與者
// 快照與阻塞狀態」需要的輸入。mapVersion 與 Session 快照比對，刷新過就整筆回滾。
export type ConsumeDungeonGatheringAction = Readonly<{
  type: 'ConsumeDungeonGatheringAction';
  teamId: TeamId;
  mapId: MapInstanceId;
  mapVersion: number;
  nodeId: GatheringNodeId;
}>;

// 這兩筆（連同 `npcDungeonDay` Job）**沒有**收進任何 Internal Command / Job union：理由見上方
// §5.1 的「NPC 側同樣不註冊」。原因已不是「Distribution 沒有 Owner」——那是舊的、過期的理由。

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
  // 進入房間時判定該房仍 armed 的固定陷阱（doc §8.3）；陷阱狀態的擁有者是 map。
  | ResolveMapTrap
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
