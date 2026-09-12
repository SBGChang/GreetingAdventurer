// app/composition/session.ts
// 引擎 Session：把「一筆玩家命令 / 一個到期 Job」跑成一筆交易，並落實 §7.2 的 Runtime ID 規程。
//
// kernel 的 runTransaction 只做路由 / 因果收斂 / 原子性；它不知道 Runtime ID cursor，也不會把
// core.nextRuntimeSequence 寫回。那是「交易私有 cursor」的責任，屬於 Session 這一層：
//   - 交易開始：本地 cursor = state.core.nextRuntimeSequence（12_engine_runtime.md §7.2）。
//   - 玩家命令依序配發 CommandId → TransactionId → CorrelationId，再建 GameCommandEnvelope；
//     到期 Job 已有 JobId，只配發 TransactionId → CorrelationId。
//   - Handler 每鑄一個實體 ID 就以 kernel RuntimeIdGenerator 從**同一** cursor 取下一個並前進。
//   - 排程落地時，JobId 也由同一 cursor 配發（不再是測試用的本地計數器）。
//   - 提交：core.nextRuntimeSequence = 本地 cursor。拒絕：丟棄 cursor，原序號完全不變。
//
// §7.1 invocationRngContext：Root Command／Job 的 rng stream 由其訊息 ID（commandId／jobId）+ 用途 tag
// 派生（見 runRoot），故不同交易得不同 stream。尚待細化：Event Subscriber 的 eventId+subscriptionId
// 子 stream、以及交易內各 Internal Command 的獨立 sub-stream（目前同一交易共用 root 調用 stream）。
//
// 尚未涵蓋（刻意，待後續）：把 Internal Command / Domain Event Draft 物化為帶 CommandId/EventId 的
// 完整信封（Outbox / 存檔平台需要，但與 State 正確性無關）。

import type {
  CommandId,
  CommandRejection,
  CorrelationId,
  DeterministicRng,
  GameCommandEnvelope,
  GameCommandRequest,
  KernelRequest,
  RngContext,
  RngCursor,
  RngStreamId,
  RuntimeEntityKind,
  RuntimeId,
  ModuleId,
  RuntimeIdCursor,
  Seed,
  TransactionId,
  WorldDay,
  // 各 id allocator 的 branded 目標型別
  ActivityRecordId,
  AssetDistributionId,
  CharacterId,
  CharacterStatusInstanceId,
  CombatStatusInstanceId,
  CombatantId,
  ContentInstanceId,
  ContentEventInstanceId,
  EncounterId,
  EncumbranceResolutionId,
  FamilyLinkId,
  FreeActionId,
  ShopOfferId,
  IntelLeadId,
  EscortCandidateId,
  HomeId,
  HomeTeachingPostId,
  PlayerCommerceUsageId,
  EconomyAccountId,
  EconomyTransferId,
  InteractionId,
  ItemInstanceId,
  WeaponSetId,
  JobId,
  MapInstanceId,
  MapRefreshLockId,
  NpcDungeonRunId,
  PlayerMapKnowledgeId,
  RelationshipFactId,
  RuntimeEnemyId,
  TeamId,
  QuestId,
  TeamPlanId,
} from '../../contracts/core';
// 這兩個 ID 家族由 combat-sequence 擁有；dungeon 依 03_dungeon_module.md §2.3 鑄造它們。
import type {
  CombatSequenceId,
  CombatSequenceSourceCommitId,
} from '../../contracts/combat-sequence';
import { KERNEL_REJECTION_SOURCE, MAX_SETTLE_STEPS, MAX_WORLD_SETTLE_STEPS } from '../../contracts/core';
import { createScheduler } from '../../kernel/scheduler';
import { JOB_TYPE_ORDER_BY_PHASE } from './manifest';
import { UnavailableCapabilityError } from './capability';
import { deterministicRng, nextRuntimeId, runTransaction, type SchedulingEffects } from '../../kernel';

import type { CharacterIdAllocator } from '../../modules/character/public';
import type { MapIdAllocator } from '../../modules/map/public';
import type { CityIdAllocator } from '../../modules/city/public';
import type { CombatIdAllocator } from '../../modules/combat/public';
import type { TeamIdAllocator } from '../../modules/team/public';

import {
  createTransactionConfig,
  routeEnemyTurn,
  routeGameCommand,
  routeJob,
  type ModuleContextFactory,
  type ModuleContexts,
} from './router';
import type { GameCommand } from './messages';
import type { GameScheduledJob, GameState } from './state';
import type { AnyScheduledJob, ScheduledJobDraft } from '../../contracts/core';

export function scheduleBootstrapJobs(state: GameState, jobs: readonly ScheduledJobDraft<AnyScheduledJob>[]): GameState {
  const holder: CursorHolder = { cursor: state.core.nextRuntimeSequence };
  const next = makeApplyScheduling(state.core.worldSeed as Seed, holder)(state, {
    scheduledJobs: jobs, cancelledJobIds: [],
  });
  return commitCursor(next, holder.cursor);
}

// ──────────────────────────────────────────────────────────────────────────
// 交易私有 cursor（§7.2）
// ──────────────────────────────────────────────────────────────────────────

type CursorHolder = { cursor: RuntimeIdCursor };

// 從共用 cursor 取下一個 Runtime ID 並就地前進（kernel 產生器為純函式；可變的只有 holder）。
function mintId<TId extends RuntimeId>(
  worldSeed: Seed,
  holder: CursorHolder,
  kind: RuntimeEntityKind,
): TId {
  const alloc = nextRuntimeId<TId>({ worldSeed, entityKind: kind, cursor: holder.cursor });
  holder.cursor = alloc.nextCursor;
  return alloc.id;
}

// ──────────────────────────────────────────────────────────────────────────
// ID Port：各模組的 id allocator（entity-kind ↔ id 的唯一對照表就在這）
// ──────────────────────────────────────────────────────────────────────────

// inventory / dungeon 的 id allocator 是 Context 上的扁平欄位（無具名型別），此處補上型別。
export type InventoryIdAllocator = Readonly<{
  nextItemInstanceId: () => ItemInstanceId;
  nextEncumbranceResolutionId: () => EncumbranceResolutionId;
  nextWeaponSetId: () => WeaponSetId;
}>;
export type DungeonIdAllocator = Readonly<{
  nextInteractionId: () => InteractionId;
  nextKnowledgeId: () => PlayerMapKnowledgeId;
  nextRunId: () => NpcDungeonRunId;
  nextDistributionId: () => AssetDistributionId;
  nextCombatSequenceId: () => CombatSequenceId;
  nextCombatSequenceSourceCommitId: () => CombatSequenceSourceCommitId;
}>;

export type EngineIdPorts = Readonly<{
  character: CharacterIdAllocator;
  inventory: InventoryIdAllocator;
  map: MapIdAllocator;
  combat: CombatIdAllocator;
  team: TeamIdAllocator;
  dungeon: DungeonIdAllocator;
  city: CityIdAllocator;
  // 委託實例的身分。委託由世界生成（地圖刷新出怪群 → 貼一筆肅清委託），所以鑄造點在 quest。
  quest: Readonly<{ nextQuestId: () => QuestId }>;
  // economy 擁有 transfer 的身分。distribution 的 `AssetDistributionIdAllocator` 契約明文要求
  // `nextEconomyTransferId()`——轉帳是由分配流程發動的，所以由它一次結算鑄一枚。
  economy: Readonly<{
    nextEconomyTransferId: () => EconomyTransferId;
    nextEconomyAccountId: () => EconomyAccountId;
  }>;
}>;

function createIdPorts(worldSeed: Seed, holder: CursorHolder): EngineIdPorts {
  // next<K>('kind') 綁定 (worldSeed, holder)；每次呼叫都推進同一 cursor。
  const next =
    <TId extends RuntimeId>(kind: RuntimeEntityKind) =>
    (): TId =>
      mintId<TId>(worldSeed, holder, kind);
  return {
    character: {
      nextCharacterId: next<CharacterId>('character'),
      nextFamilyLinkId: next<FamilyLinkId>('family-link'),
      nextRelationshipFactId: next<RelationshipFactId>('relationship-fact'),
      nextStatusInstanceId: next<CharacterStatusInstanceId>('character-status-instance'),
    },
    quest: { nextQuestId: next<QuestId>('quest') },
    inventory: {
      nextItemInstanceId: next<ItemInstanceId>('item-instance'),
      nextEncumbranceResolutionId: next<EncumbranceResolutionId>('encumbrance-resolution'),
      nextWeaponSetId: next<WeaponSetId>('weapon-set'),
    },
    map: {
      nextContentInstanceId: next<ContentInstanceId>('content-instance'),
      nextMapRefreshLockId: next<MapRefreshLockId>('map-refresh-lock'),
      nextMapInstanceId: next<MapInstanceId>('map-instance'),
      nextContentEventInstanceId: next<ContentEventInstanceId>('content-event-instance'),
    },
    combat: {
      nextEncounterId: next<EncounterId>('encounter'),
      nextCombatantId: next<CombatantId>('combatant'),
      nextRuntimeEnemyId: next<RuntimeEnemyId>('enemy'),
      nextStatusInstanceId: next<CombatStatusInstanceId>('combat-status-instance'),
    },
    team: {
      nextTeamId: next<TeamId>('team'),
      nextTeamPlanId: next<TeamPlanId>('team-plan'),
      nextFreeActionId: next<FreeActionId>('free-action'),
      nextInteractionId: next<InteractionId>('interaction'),
      nextActivityRecordId: next<ActivityRecordId>('activity-record'),
    },
    city: {
      nextShopOfferId: next<ShopOfferId>('shop-offer'),
      nextIntelLeadId: next<IntelLeadId>('intel-lead'),
      nextEscortCandidateId: next<EscortCandidateId>('escort-candidate'),
      nextHomeId: next<HomeId>('home'),
      nextHomeTeachingPostId: next<HomeTeachingPostId>('home-teaching-post'),
      nextPlayerCommerceUsageId: next<PlayerCommerceUsageId>('player-commerce-usage'),
    },
    economy: {
      nextEconomyTransferId: next<EconomyTransferId>('economy-transfer'),
      nextEconomyAccountId: next<EconomyAccountId>('economy-account'),
    },
    dungeon: {
      nextInteractionId: next<InteractionId>('interaction'),
      nextKnowledgeId: next<PlayerMapKnowledgeId>('player-map-knowledge'),
      nextRunId: next<NpcDungeonRunId>('npc-dungeon-run'),
      nextDistributionId: next<AssetDistributionId>('asset-distribution'),
      // Wave E：地牢掃蕩改為真的走 Combat Sequence。這兩枚 ID 由 **dungeon** 鑄造是刻意的
      // （03_dungeon_module.md §2.3）：sequenceId 當成 StartCombatSequence 的輸入欄位帶進去，
      // 所以不需要同步回傳值，也就不需要一條會繞過 Transaction Runner 的 Host Port。
      // sourceCommitId 則是「來源正式提交」這個動作本身的身分——同 ID 重送冪等、不同 ID 重送
      // 會被 combat-sequence 拒絕，所以必須由發動提交的宿主一次結算鑄一枚。
      nextCombatSequenceId: next<CombatSequenceId>('combat-sequence'),
      nextCombatSequenceSourceCommitId: next<CombatSequenceSourceCommitId>(
        'combat-sequence-source-commit',
      ),
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// EngineRuntime + ContextAssembler
//
// Session 擁有「跨呼叫延續」的部分（cursor 派生的 id ports、RNG 產生器）；「內容相依」的部分
// （definition readers、resolvers、跨模組 Query）由呼叫者以 ContextAssembler 注入。Session 因此
// 與內容無關：換上真正的 Yunhua content pack 時，只換 Assembler，不動 Session。
// ──────────────────────────────────────────────────────────────────────────

export type EngineRuntime = Readonly<{
  worldSeed: Seed;
  worldDay: WorldDay; // 當前 workingState 的世界日（每次重建 Context 時帶入）
  // 本次交易的身分。`EconomyTransferRecord.transactionId` 是契約必填欄位（可重播的帳本要指回
  // 開啟它的那筆交易），而它是**每筆交易**的值、不是建置期常數——所以它住在 EngineRuntime，
  // 由 runRoot 在開交易時帶入。（docs/00_core/technical_architecture.md 把這一項列為整合者的決定。）
  transactionId: TransactionId;
  ids: EngineIdPorts;
  rng: DeterministicRng;
  // §7.1 invocationRngContext 工廠：傳入用途 tag，回傳以「本次調用訊息 ID + tag」派生的一次性 stream。
  rngContextFor: (tag: string) => RngContext;
}>;

// 以「EngineRuntime + 當前 workingState」組出完整 ModuleContexts。
export type ContextAssembler = (runtime: EngineRuntime, state: GameState) => ModuleContexts;

// ──────────────────────────────────────────────────────────────────────────
// 交易驅動
// ──────────────────────────────────────────────────────────────────────────

export type GameStepResult =
  | Readonly<{ accepted: true; state: GameState; kernelRequests?: readonly KernelRequest[] }>
  | Readonly<{ accepted: false; state: GameState; rejection: CommandRejection }>;

// 排程落地：cancelled 先移除、scheduled 各鑄一個 JobId（走同一交易 cursor），寫入 core.scheduler。
function makeApplyScheduling(worldSeed: Seed, holder: CursorHolder) {
  return (state: GameState, effects: SchedulingEffects): GameState => {
    if (effects.scheduledJobs.length === 0 && effects.cancelledJobIds.length === 0) return state;
    const jobsById: Record<JobId, GameScheduledJob> = { ...state.core.scheduler.jobsById };
    for (const id of effects.cancelledJobIds) delete jobsById[id];
    for (const draft of effects.scheduledJobs) {
      const jobId = mintId<JobId>(worldSeed, holder, 'job');
      jobsById[jobId] = { ...(draft as object), jobId } as GameScheduledJob;
    }
    return {
      ...state,
      core: {
        ...state.core,
        scheduler: { jobsById, revision: (state.core.scheduler.revision + 1) as never },
      },
    };
  };
}

function commitCursor(state: GameState, cursor: RuntimeIdCursor): GameState {
  return { ...state, core: { ...state.core, nextRuntimeSequence: cursor } };
}

// Scheduler 於 Job 交易**成功提交**時才 dequeue（一次性；見 runDueJob）。拒絕則回滾、Job 留在佇列——
// 失效 Job 由 Handler「接受並 no-op」而被消耗（見 dungeon npcDungeonDay），不會殘留重複觸發。交易若重排
// 新 Job，走 applyScheduling 另配新 JobId。
function dequeueJob(state: GameState, jobId: JobId): GameState {
  if (state.core.scheduler.jobsById[jobId] === undefined) return state;
  const jobsById: Record<JobId, GameScheduledJob> = { ...state.core.scheduler.jobsById };
  delete jobsById[jobId];
  return {
    ...state,
    core: {
      ...state.core,
      scheduler: { jobsById, revision: (state.core.scheduler.revision + 1) as never },
    },
  };
}

// 共用的交易外殼：建 cursor holder（seed 自 core.nextRuntimeSequence）、id ports、context 工廠，
// 跑 runTransaction，接受則寫回 cursor，拒絕則原封回傳。
function runRoot(
  state: GameState,
  worldSeed: Seed,
  holder: CursorHolder,
  transactionId: TransactionId,
  invocationId: string,
  makeRoot: (contextFactory: ModuleContextFactory) => ReturnType<typeof routeGameCommand>,
  assembler: ContextAssembler,
): GameStepResult {
  const idPorts = createIdPorts(worldSeed, holder);
  // §7.1 invocationRngContext：stream 由「本次調用的訊息 ID（commandId／jobId）+ 用途 tag」派生，
  // 故不同交易得不同 stream——同一種判定不再跨交易恆得相同結果。cursor 由 0 起（一次性 stream；
  // 若同一調用要多次抽取，由 Resolver 顯式回傳並串接 nextRngCursor）。
  const rngContextFor = (tag: string): RngContext => ({
    worldSeed,
    streamId: `rng:${invocationId}:${tag}` as RngStreamId,
    cursor: 0 as RngCursor,
  });
  const contextFactory: ModuleContextFactory = (working) =>
    assembler(
      {
        worldSeed,
        worldDay: working.core.worldDay,
        transactionId,
        ids: idPorts,
        rng: deterministicRng,
        rngContextFor,
      },
      working,
    );

  const config = createTransactionConfig({
    contextFactory,
    applyScheduling: makeApplyScheduling(worldSeed, holder),
  });
  let outcome;
  try {
    outcome = runTransaction(config, state, transactionId, makeRoot(contextFactory), null);
  } catch (error) {
    if (!(error instanceof UnavailableCapabilityError)) throw error;
    return {
      accepted: false, state,
      rejection: { code: 'engine/capability-unavailable', source: KERNEL_REJECTION_SOURCE,
        details: { capability: error.capability } },
    };
  }
  if (!outcome.accepted) {
    // §7.2 拒絕：丟棄 cursor，原序號不變（回傳的 baseState 本就未改 core.nextRuntimeSequence）。
    return { accepted: false, state: outcome.state, rejection: outcome.rejection };
  }
  // §7.2 提交：core.nextRuntimeSequence = 交易私有 cursor 的終值。
  const committed = commitCursor(outcome.state, holder.cursor);
  return outcome.kernelRequests
    ? { accepted: true, state: committed, kernelRequests: outcome.kernelRequests }
    : { accepted: true, state: committed };
}

// 跑一筆玩家命令。envelope 的 CommandId → TransactionId → CorrelationId 依 §7.2 由交易 cursor 起頭
// 配發，之後 Handler 鑄的實體 ID 從同一 cursor 續接。
export function runGameCommand(
  state: GameState,
  request: GameCommandRequest<GameCommand>,
  assembler: ContextAssembler,
): GameStepResult {
  const worldSeed = state.core.worldSeed as Seed;
  const holder: CursorHolder = { cursor: state.core.nextRuntimeSequence };
  const commandId = mintId<CommandId>(worldSeed, holder, 'command');
  const transactionId = mintId<TransactionId>(worldSeed, holder, 'transaction');
  const correlationId = mintId<CorrelationId>(worldSeed, holder, 'correlation');
  const envelope: GameCommandEnvelope<GameCommand> = {
    commandId,
    transactionId,
    correlationId,
    issuedAtWorldDay: state.core.worldDay,
    actorTeamId: request.actorTeamId,
    command: request.command,
  };
  // invocation 身分＝commandId（§7.1：Root Command 的 rng 由訊息 ID + 接收者派生）。
  return runRoot(
    state,
    worldSeed,
    holder,
    transactionId,
    commandId as string,
    (cf) => routeGameCommand(envelope, cf),
    assembler,
  );
}

// 跑一個到期 Job。Job 已有 JobId，只配發 TransactionId → CorrelationId（§7.2）。
export function runDueJob(
  state: GameState,
  job: GameScheduledJob,
  assembler: ContextAssembler,
): GameStepResult {
  // 以 jobId 從**目前** Scheduler 取權威 Job，並用它（非呼叫者傳入的快照）執行。呼叫者常持有同日到期
  // 快照，但前一筆交易可能已取消／消耗其中某筆；若照舊快照重跑，NPC 地牢、刷新等 Job 會被重複結算。
  // 不在佇列（已完成或被取消）→ 不開交易、不推進 cursor，回傳原封狀態。
  const authoritative = state.core.scheduler.jobsById[job.jobId];
  if (authoritative === undefined) {
    return {
      accepted: false,
      state,
      rejection: {
        code: 'engine/job-not-scheduled',
        source: KERNEL_REJECTION_SOURCE,
        details: { jobId: String(job.jobId) },
      },
    };
  }
  // 尚未到期的 Job 不得執行：到期日在未來 → 不開交易、不推進 cursor。Scheduler 是「已排定」而非「已到期」，
  // 呼叫者須自行判斷 dueDay；此處是最後防線，避免提前結算未來工作。
  if (authoritative.dueDay > state.core.worldDay) {
    return {
      accepted: false,
      state,
      rejection: {
        code: 'engine/job-not-due',
        source: KERNEL_REJECTION_SOURCE,
        details: { jobId: String(job.jobId), dueDay: Number(authoritative.dueDay), worldDay: Number(state.core.worldDay) },
      },
    };
  }
  const worldSeed = state.core.worldSeed as Seed;
  const holder: CursorHolder = { cursor: state.core.nextRuntimeSequence };
  const transactionId = mintId<TransactionId>(worldSeed, holder, 'transaction');
  mintId<CorrelationId>(worldSeed, holder, 'correlation');
  // invocation 身分＝jobId（§7.1：Job 的 rng 由 jobId + 擁有者派生）。
  const result = runRoot(
    state,
    worldSeed,
    holder,
    transactionId,
    authoritative.jobId as string,
    (cf) => routeJob(authoritative, cf),
    assembler,
  );
  // Job 於交易**成功提交**時才消耗（Scheduler dequeue）；拒絕則原始 State 完全不變（Job 留著，
  // §7.2 回滾）。失效 Job 應由 Handler「接受並 no-op」（見 dungeon npcDungeonDay），故正常也會走
  // accept 這條被消耗，不會殘留重複觸發。真正的 reject 代表下游必要命令失敗，屬錯誤，Job 不消耗。
  if (!result.accepted) return result;
  return { ...result, state: dequeueJob(result.state, job.jobId) };
}

// 只曝出 id ports（供 Bootstrapper 在交易外預先鑄 ID，例如建立初始玩家隊伍時）。
// 注意：交易外鑄 ID 也要推進 core.nextRuntimeSequence，呼叫者負責寫回。
export function createIdPortsForBootstrap(
  worldSeed: Seed,
  startCursor: RuntimeIdCursor,
): Readonly<{ ids: EngineIdPorts; currentCursor: () => RuntimeIdCursor }> {
  const holder: CursorHolder = { cursor: startCursor };
  return { ids: createIdPorts(worldSeed, holder), currentCursor: () => holder.cursor };
}

// ──────────────────────────────────────────────────────────────────────────
// 世界結算：把時間變成「動作的後果」而不是玩家的一個指令
// ──────────────────────────────────────────────────────────────────────────
//
// `docs/02_systems/time_and_mastery_progression.md` §一 把每個動作的時長都定死了：
// 城內免費操作 0 日、旅行 3／6／9 日、去冒險點 1 日、返城 1 日、住宿 ≥1 日、
// 熟練度訓練 28 日、休息一年 365 日、迷宮以分鐘累積（1,440 分＝1 日）。
// 也就是說**世界日是動作的後果**，呼叫端不該提供「推進時間」這種操作——那等於把 Scheduler
// 掀給玩家看，而且會讓「旅行要 6 天」變成「玩家按 3 次」。
//
// 判斷世界該走到哪裡的依據是**該隊伍有沒有進行中的 Plan**：
//   * 有 → 隊伍正在忙（旅行途中、前往冒險地、住宿中），世界繼續走，沿途到期的 Job 依序執行
//     （NPC、地圖刷新、角色年齡都在這時候推進，正是文件那一段講的）。
//   * 沒有 → 呼叫端自由了，世界停下來等下一個決定。城裡閒晃與地牢裡逐房移動都屬這一類，
//     所以它們不會讓日期亂跑（迷宮的時間走的是分鐘，由 dungeon 在交易內推進世界日）。
//
// 停止條件另有兩個：Job 被拒（把原因交回，不硬推）與安全上限（Plan 若因 bug 永不結束，
// 寧可停下來也不要無限迴圈）。
export type SettleStep = Readonly<{ toDay: number; jobType: string }>;

export type SettleResult = Readonly<{
  state: GameState;
  steps: readonly SettleStep[];
  // 有值代表結算提前中止；呼叫端應呈現它，不得當成「正常走完」。
  blocked: string | undefined;
}>;

export function settleWorld(
  initial: GameState,
  teamId: TeamId,
  assembler: ContextAssembler,
): SettleResult {
  let state = initial;
  const steps: SettleStep[] = [];
  let blocked: string | undefined;
  let guard = 0;
  const scheduler = createScheduler<GameScheduledJob>({ jobTypeOrderByPhase: JOB_TYPE_ORDER_BY_PHASE });

  while (true) {
    const hasPlan = state.team.teams[teamId]?.activePlanId !== undefined;
    const hasDueJobs = Object.values(state.core.scheduler.jobsById).some(job => job.dueDay <= state.core.worldDay);
    if (!hasPlan && !hasDueJobs) break;
    guard += 1;
    if (guard > MAX_WORLD_SETTLE_STEPS) {
      blocked = 'engine/settle-step-limit';
      break;
    }
    const jobs = Object.values(state.core.scheduler.jobsById);
    if (jobs.length === 0) {
      // 有 Plan 但沒有 Job：那是開放式 Plan（cityFree 由玩家自己結束）。世界不替他決定。
      break;
    }

    // 開放式 Plan（沒有 dueOnDay，實務上就是 cityFree）不能驅動世界時鐘：世界永遠有下一批
    // 日曆 Job（商店刷新、地圖刷新、NPC 決策…），照著跑會一路跑到步數上限，等於玩家一按
    // 「開始自由活動」就被推走幾百天。
    //
    // 但也不能一律停：28 日鍛鍊正是在自由期裡完成的，停在原地就永遠練不完。
    // 折衷是**跑到這支隊伍自己的下一個到期日為止**——世界會把中間的日曆 Job 照常結算
    // （不跳過，順序不變），玩家自己的事情一完成就把控制權交還。沒有屬於這支隊伍的待辦時
    // 就停在今天：那才是真正的「自由」。
    const activePlanId = state.team.teams[teamId]?.activePlanId;
    const activePlan = activePlanId === undefined ? undefined : state.team.plans[activePlanId];
    if (activePlan !== undefined && activePlan.dueOnDay === undefined) {
      const ownDueDays = jobs
        .filter((j) => String(j.targetId) === String(teamId))
        .map((j) => Number(j.dueDay));
      if (ownDueDays.length === 0 && !hasDueJobs) break;
    }

    const earliest = jobs.reduce((a, b) => scheduler.compare(a, b) <= 0 ? a : b);
    // worldDay 由 Kernel 擁有；呼叫端負責把時鐘撥到到期日再 runDueJob
    //（與 travel-integration.test 的自驅迴圈同法）。
    const atDueDay: GameState = {
      ...state,
      core: { ...state.core, worldDay: Math.max(state.core.worldDay, earliest.dueDay) },
    };
    const result = runDueJob(atDueDay, earliest, assembler);
    if (!result.accepted) {
      // 被拒：不撥動時鐘（Job 留在佇列），把原因交給呼叫端。
      blocked = result.rejection.code;
      break;
    }
    state = result.state;
    steps.push({ toDay: Number(state.core.worldDay), jobType: earliest.type });
  }

  return { state, steps, blocked };
}

// ──────────────────────────────────────────────────────────────────────────
// 敵方回合推進
// ──────────────────────────────────────────────────────────────────────────

// 跑一次敵方回合。與 runDueJob 同形狀的引擎 root：自己的 transaction／invocation stream。
export function runEnemyTurn(
  state: GameState,
  encounterId: EncounterId,
  assembler: ContextAssembler,
): GameStepResult {
  const worldSeed = state.core.worldSeed as Seed;
  const holder: CursorHolder = { cursor: state.core.nextRuntimeSequence };
  const transactionId = mintId<TransactionId>(worldSeed, holder, 'transaction');
  return runRoot(
    state,
    worldSeed,
    holder,
    transactionId,
    transactionId as string,
    (cf) => routeEnemyTurn(encounterId, cf),
    assembler,
  );
}

// 一次戰鬥推進的紀錄：誰動了、之後這場遭遇還在不在。
//
// `encounterState` 是**選填**：遭遇在這一步之後可能已經從 Slice 移除（結算完成），那時沒有狀態
// 可讀。給 `undefined` 而不是補一個 'resolved'——後者是猜的，而且會把「已移除」與「真的
// resolved」兩件事混成同一個字。
export type CombatStep = Readonly<{ actorId: CombatantId; encounterState?: string }>;

export type CombatSettleResult = Readonly<{
  state: GameState;
  steps: readonly CombatStep[];
  blockedBy?: string;
}>;

export function settlePlayerDecision(state: GameState, teamId: TeamId, assembler: ContextAssembler): SettleResult {
  const encounter = Object.values(state.combat.encounters).find(e => e.playerTeamId === teamId && e.state !== 'resolved');
  if (encounter !== undefined) {
    const combat = settleCombat(state, encounter.encounterId, assembler);
    if (combat.blockedBy !== undefined) return { state: combat.state, steps: [], blocked: combat.blockedBy };
    state = combat.state;
  }
  return settleWorld(state, teamId, assembler);
}

// 把遭遇推進到「輪到玩家」為止。
//
// 為什麼需要這一支：CTB 決定誰先動，而先動的常常是敵方（8 隻獾的 CTB 都是 0，玩家 9.15）。
// 玩家下完一招之後也一樣——輪到誰是結算的結果，不是玩家能決定的。沒有這個迴圈，畫面會停在
// 「目前行動者是一隻怪」而沒有任何人去動它。
//
// 停止條件三選一：
//   1. 遭遇不再是 active（全滅／隊伍戰敗）——這一場結束了。
//   2. 目前行動者是**玩家側**——把控制權交還玩家。
//   3. 被拒（例如缺內容）——把原因交給呼叫端，不吞掉。
//
// 上限用 Kernel 的 `MAX_SETTLE_STEPS`（與 settleWorld 同一個安全閥）：那是結構性的防跑飛，
// 不是平衡量。
export function settleCombat(
  initial: GameState,
  encounterId: EncounterId,
  assembler: ContextAssembler,
): CombatSettleResult {
  let state = initial;
  const steps: CombatStep[] = [];
  let blocked: string | undefined;

  for (let guard = 0; guard <= MAX_SETTLE_STEPS; guard += 1) {
    if (guard === MAX_SETTLE_STEPS) {
      blocked = 'engine/settle-step-limit';
      break;
    }
    const encounter = state.combat.encounters[encounterId];
    if (encounter === undefined) break;
    if (encounter.state !== 'active') break;
    const actorId = encounter.currentActorId;
    if (actorId === undefined) break;
    const actor = encounter.combatants[actorId];
    if (actor === undefined) break;
    if (actor.side !== 'enemy') break; // 輪到玩家了

    const result = runEnemyTurn(state, encounterId, assembler);
    if (!result.accepted) {
      blocked = result.rejection.code;
      break;
    }
    state = result.state;
    const after = state.combat.encounters[encounterId];
    steps.push({ actorId, ...(after !== undefined ? { encounterState: after.state } : {}) });
  }

  return { state, steps, ...(blocked !== undefined ? { blockedBy: blocked } : {}) };
}
