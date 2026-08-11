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
// 尚未涵蓋（刻意，待後續）：把 Internal Command / Domain Event Draft 物化為帶 CommandId/EventId 的
// 完整信封（Outbox / 存檔平台需要，但與 State 正確性無關）；§7.1 的 invocationRngContext 完整推導
// （目前提供以 streamId 派生、cursor 從 0 起的簡化版；決定性由 worldSeed + streamId 保證）。

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
  EncounterId,
  EncumbranceResolutionId,
  FamilyLinkId,
  FreeActionId,
  InteractionId,
  ItemInstanceId,
  JobId,
  MapInstanceId,
  MapRefreshLockId,
  NpcDungeonRunId,
  PlayerMapKnowledgeId,
  RelationshipFactId,
  RuntimeEnemyId,
  TeamId,
  TeamPlanId,
} from '../../contracts/core';
import { deterministicRng, nextRuntimeId, runTransaction, type SchedulingEffects } from '../../kernel';

import type { CharacterIdAllocator } from '../../modules/character/public';
import type { MapIdAllocator } from '../../modules/map/public';
import type { CombatIdAllocator } from '../../modules/combat/public';
import type { TeamIdAllocator } from '../../modules/team/public';

import {
  createTransactionConfig,
  routeGameCommand,
  routeJob,
  type ModuleContextFactory,
  type ModuleContexts,
} from './router';
import type { GameCommand } from './messages';
import type { GameScheduledJob, GameState } from './state';

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
}>;
export type DungeonIdAllocator = Readonly<{
  nextInteractionId: () => InteractionId;
  nextKnowledgeId: () => PlayerMapKnowledgeId;
  nextRunId: () => NpcDungeonRunId;
  nextDistributionId: () => AssetDistributionId;
}>;

export type EngineIdPorts = Readonly<{
  character: CharacterIdAllocator;
  inventory: InventoryIdAllocator;
  map: MapIdAllocator;
  combat: CombatIdAllocator;
  team: TeamIdAllocator;
  dungeon: DungeonIdAllocator;
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
    inventory: {
      nextItemInstanceId: next<ItemInstanceId>('item-instance'),
      nextEncumbranceResolutionId: next<EncumbranceResolutionId>('encumbrance-resolution'),
    },
    map: {
      nextContentInstanceId: next<ContentInstanceId>('content-instance'),
      nextMapRefreshLockId: next<MapRefreshLockId>('map-refresh-lock'),
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
      nextMapInstanceId: next<MapInstanceId>('map-instance'),
    },
    dungeon: {
      nextInteractionId: next<InteractionId>('interaction'),
      nextKnowledgeId: next<PlayerMapKnowledgeId>('player-map-knowledge'),
      nextRunId: next<NpcDungeonRunId>('npc-dungeon-run'),
      nextDistributionId: next<AssetDistributionId>('asset-distribution'),
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
  ids: EngineIdPorts;
  rng: DeterministicRng;
  // §7.1 invocationRngContext 的簡化工廠：以 streamId 派生、cursor 從 0 起。
  rngContextFor: (streamId: string) => RngContext;
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

// 共用的交易外殼：建 cursor holder（seed 自 core.nextRuntimeSequence）、id ports、context 工廠，
// 跑 runTransaction，接受則寫回 cursor，拒絕則原封回傳。
function runRoot(
  state: GameState,
  worldSeed: Seed,
  holder: CursorHolder,
  transactionId: TransactionId,
  makeRoot: (contextFactory: ModuleContextFactory) => ReturnType<typeof routeGameCommand>,
  assembler: ContextAssembler,
): GameStepResult {
  const idPorts = createIdPorts(worldSeed, holder);
  const rngContextFor = (streamId: string): RngContext => ({
    worldSeed,
    streamId: streamId as RngStreamId,
    cursor: 0 as RngCursor,
  });
  const contextFactory: ModuleContextFactory = (working) =>
    assembler(
      { worldSeed, worldDay: working.core.worldDay, ids: idPorts, rng: deterministicRng, rngContextFor },
      working,
    );

  const config = createTransactionConfig({
    contextFactory,
    applyScheduling: makeApplyScheduling(worldSeed, holder),
  });
  const outcome = runTransaction(config, state, transactionId, makeRoot(contextFactory), null);
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
  return runRoot(state, worldSeed, holder, transactionId, (cf) => routeGameCommand(envelope, cf), assembler);
}

// 跑一個到期 Job。Job 已有 JobId，只配發 TransactionId → CorrelationId（§7.2）。
export function runDueJob(
  state: GameState,
  job: GameScheduledJob,
  assembler: ContextAssembler,
): GameStepResult {
  const worldSeed = state.core.worldSeed as Seed;
  const holder: CursorHolder = { cursor: state.core.nextRuntimeSequence };
  const transactionId = mintId<TransactionId>(worldSeed, holder, 'transaction');
  mintId<CorrelationId>(worldSeed, holder, 'correlation');
  return runRoot(state, worldSeed, holder, transactionId, (cf) => routeJob(job, cf), assembler);
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
