// modules/map/system.ts
// Map 模組的純函式 Handler / Job / Subscriber（對應 docs/00_core/architecture/01_map_module.md §5–7）。
//
// 設計原則：
//   * 全部為決定性純函式：不做 I/O、不呼叫 Math.random / Date.now。
//   * 需要「當前世界日」「靜態資料」「World 讀取」「Team 佔用」「新 ID」「RNG 結果」時，
//     一律經由注入的 MapHandlerContext 取得；RNG 只以顯式 cursor 的 DeterministicRng 使用。
//   * Internal Command Handler 簽章 (command, state, ctx) → MapHandlerResult：
//       - 接受：ModuleResult<MapState>（只含自己 Slice 的 nextSlice 與外送訊息）。
//       - 拒絕：具型別 CommandRejection（doc §5.2：命令可因版本／狀態／引用失效而拒絕）。
//   * Job / Subscriber 直接回傳 ModuleResult<MapState>（不拒絕）。
//   * Handler 不 mutate 傳入 state；一律回傳新物件。

import type {
  WorldDay,
  Revision,
  ModuleId,
  ContentInstanceId,
  MapInstanceId,
  GatheringNodeId,
  MapRefreshLockId,
  ResolverId,
  DefinitionId,
  ModuleResult,
  ModuleOutcome,
  ScheduledJobDraft,
  AnyScheduledJob,
  DomainEventDraft,
  CommandRejection,
  DeterministicRng,
  RngContext,
  NpcDungeonTargetResolverId,
} from '../../contracts/core';
import type {
  MapState,
  MapInstance,
  MapContentInstance,
  MapContentPayload,
  MapContentKind,
  MapSpatialRuntime,
  GatheringNodeRuntimeState,
  MapTemplateDefinition,
  MapSpawnRuleDefinition,
  MapDefinitionReader,
  TeamPresenceQuery,
  RefreshLock,
  MapDomainEvent,
  MapRefreshCheckJob,
  // Internal Command payloads
  OpenMapDoor,
  ResolveMapTrap,
  HarvestMapGatheringNode,
  ResolvePlayerMapContent,
  ApplyNpcDungeonSettlement,
  ProtectMapContent,
  SetMapRefreshLock,
} from '../../contracts/map';

// 跨模組引用（僅型別 import）。
import type { WorldQuery } from '../../contracts/world';
import type { PendingDungeonResult } from '../../contracts/dungeon';
import type { TeamLocationChangedEvent } from '../../contracts/team';

import {
  tryGetInstance,
  upsertInstance,
  tryGetContent,
  upsertContent,
  listContentsForMap,
  buildSpatialRuntime,
  eligibleContentRoomIds,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組常數
// ──────────────────────────────────────────────────────────────────────────

export const MAP_MODULE_ID = 'map' as ModuleId<'map'>;

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port：讓 Handler 保持純函式。真實組合由 Composition 注入；測試注入決定性 stub。
// ──────────────────────────────────────────────────────────────────────────

// 交易私有的 ID 配發器（背後由 Kernel RuntimeIdGenerator + cursor 提供）。
export interface MapIdAllocator {
  nextContentInstanceId(): ContentInstanceId;
  nextMapRefreshLockId(): MapRefreshLockId;
}

// 由資料 Resolver 決定的內容 payload（encounterGroup / chest items / event def 等）與 NPC Policy。
// Kernel 只負責決定「幾筆、放哪個房間、npcOrder 序列」；具體 payload 由資料 Resolver 供給
// （data-tuned kernel 慣例）。
export type SpawnDraft = Readonly<{
  kind: MapContentKind;
  definitionId: DefinitionId;
  payload: MapContentPayload;
  npcEligible: boolean;
  npcPointCost?: number;
  npcResolverId?: NpcDungeonTargetResolverId;
}>;

export interface MapContentResolver {
  resolveSpawnPayload(
    input: Readonly<{
      mapId: MapInstanceId;
      spawnRule: MapSpawnRuleDefinition;
      kind: MapContentKind;
      index: number;
      rng: RngContext;
    }>,
  ): SpawnDraft;
}

export type MapHandlerContext = Readonly<{
  worldDay: WorldDay;
  definitions: MapDefinitionReader;
  world: WorldQuery; // 刷新生成時取得地點文化／控制國（doc §2.3）；本版主路由 Resolver 供給 payload。
  presence: TeamPresenceQuery;
  ids: MapIdAllocator;
  rng: DeterministicRng;
  rngContext: RngContext;
  resolvers: MapContentResolver;
}>;

// ──────────────────────────────────────────────────────────────────────────
// Handler 回傳型別（接受／拒絕）
// ──────────────────────────────────────────────────────────────────────────

// B.5：形狀改由 contracts/core 的 ModuleOutcome 單一定義。
export type MapHandlerResult = ModuleOutcome<MapState>;

// ──────────────────────────────────────────────────────────────────────────
// 小工具
// ──────────────────────────────────────────────────────────────────────────

function bump(r: Revision): Revision {
  return (r + 1) as Revision;
}

function emit(event: MapDomainEvent): DomainEventDraft<unknown> {
  return { event };
}

function makeResult(
  nextSlice: MapState,
  outgoingMessages: readonly DomainEventDraft<unknown>[] = [],
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[] = [],
): ModuleResult<MapState> {
  return { nextSlice, outgoingMessages, scheduledJobs };
}

function accept(
  nextSlice: MapState,
  outgoingMessages: readonly DomainEventDraft<unknown>[] = [],
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[] = [],
): MapHandlerResult {
  return { ok: true, result: makeResult(nextSlice, outgoingMessages, scheduledJobs) };
}

function reject(
  code: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): MapHandlerResult {
  return { ok: false, rejection: { code, source: MAP_MODULE_ID, details } };
}

// 不帶 expectedRevision：Pending 檢查的存活判定是 `refresh.pendingCheckScheduledFor`（見
// handleMapRefreshCheck）。掛一個不會被讀的 expectedRevision 只會讓下一個人以為它是防線。
function pendingCheckJobDraft(
  mapId: MapInstanceId,
  dueDay: WorldDay,
): ScheduledJobDraft<MapRefreshCheckJob> {
  return {
    type: 'mapRefreshCheck',
    dueDay,
    ownerModule: MAP_MODULE_ID,
    targetId: mapId,
    payload: { reason: 'pending' },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 內容生成（決定性；RNG 只在此以顯式 cursor 使用）
// ──────────────────────────────────────────────────────────────────────────

type GeneratedContent = Readonly<{
  contents: readonly MapContentInstance[];
  nextNpcOrder: number;
}>;

// 依 Spawn Rule 的 spawnBudgets 生成本版本動態內容：
//   * 每個 budget 以注入 RNG 決定 count ∈ [minCount, maxCount]（決定性）。
//   * 一房一內容（不變量 3）：依 eligibleContentRoomIds 順序配置，房間耗盡即停止。
//   * NPC-可處理內容取得遞增 npcOrder（與採集點共用序列，不變量 4）。
function generateMapContent(
  mapId: MapInstanceId,
  mapVersion: number,
  template: MapTemplateDefinition,
  spawnRule: MapSpawnRuleDefinition,
  ctx: MapHandlerContext,
): GeneratedContent {
  const rooms = eligibleContentRoomIds(template);
  const contents: MapContentInstance[] = [];
  let cursor = ctx.rngContext.cursor;
  let roomIdx = 0;
  let npcOrder = 1;

  for (const budget of spawnRule.spawnBudgets) {
    const draw = ctx.rng.nextInt({
      worldSeed: ctx.rngContext.worldSeed,
      streamId: ctx.rngContext.streamId,
      cursor,
      minInclusive: budget.minCount,
      maxInclusive: budget.maxCount,
    });
    cursor = draw.nextCursor;
    const count = draw.value;

    for (let i = 0; i < count; i += 1) {
      if (roomIdx >= rooms.length) break; // 房間耗盡：一房一內容
      const roomId = rooms[roomIdx]!;
      roomIdx += 1;

      const draft = ctx.resolvers.resolveSpawnPayload({
        mapId,
        spawnRule,
        kind: budget.contentKind,
        index: contents.length,
        rng: {
          worldSeed: ctx.rngContext.worldSeed,
          streamId: ctx.rngContext.streamId,
          cursor,
        },
      });
      const contentId = ctx.ids.nextContentInstanceId();

      const npcEligible =
        draft.npcEligible &&
        draft.npcPointCost !== undefined &&
        draft.npcResolverId !== undefined;
      const npcFields = npcEligible
        ? {
            npcOrder: npcOrder++,
            npcPointCost: draft.npcPointCost,
            npcResolverId: draft.npcResolverId,
          }
        : {};

      contents.push({
        contentId,
        mapId,
        mapVersion,
        kind: draft.kind,
        definitionId: draft.definitionId,
        position: { roomId },
        payload: draft.payload,
        ...npcFields,
        state: 'available',
        protectedByQuestIds: [],
        revision: 0 as Revision,
      });
    }
  }

  return { contents, nextNpcOrder: npcOrder };
}

// ──────────────────────────────────────────────────────────────────────────
// §7.1 固定刷新（核心：版本 +1、空間重建、內容生成）
// ──────────────────────────────────────────────────────────────────────────

function refreshMapInstance(
  instance: MapInstance,
  state: MapState,
  ctx: MapHandlerContext,
): ModuleResult<MapState> {
  const template = ctx.definitions.getMapTemplate(instance.templateId);
  const spawnRule = ctx.definitions.getMapSpawnRule(template.spawnRuleId);
  const oldVersion = instance.currentVersion;
  const newVersion = oldVersion + 1;

  let nextState = state;

  // 1. 舊內容：受 Quest 保護者保留（不變量 7）；其餘標記 removedByRefresh 作為歷史。
  for (const content of listContentsForMap(state, instance.mapId)) {
    if (content.protectedByQuestIds.length > 0) continue;
    if (content.state === 'removedByRefresh') continue;
    nextState = upsertContent(nextState, {
      ...content,
      state: 'removedByRefresh',
      revision: bump(content.revision),
    });
    // TODO: 未處理的非卷軸道具移入城市永久庫存（送 TransferItem Internal Command）— 本版省略。
  }

  // 2. 空間重建：門全關、陷阱 armed、採集點 available（doc §3.1）。
  const baseSpatial = buildSpatialRuntime(template, newVersion);

  // 3. 生成新內容，並為可處理內容取得 npcOrder。
  const generated = generateMapContent(instance.mapId, newVersion, template, spawnRule, ctx);
  for (const content of generated.contents) nextState = upsertContent(nextState, content);

  // 4. 為 NPC-enabled 採集點接續同一條 npcOrder 序列（不變量 4）。
  let npcOrder = generated.nextNpcOrder;
  const gatheringNodeStates: Record<GatheringNodeId, GatheringNodeRuntimeState> = {
    ...baseSpatial.gatheringNodeStates,
  };
  for (const node of template.gatheringNodes) {
    const view = ctx.definitions.getGatheringMapView(node.gatheringRuleId);
    if (view.npcPolicy !== undefined && view.npcPolicy.eligible) {
      const base = gatheringNodeStates[node.nodeId];
      if (base !== undefined) {
        gatheringNodeStates[node.nodeId] = {
          ...base,
          npcOrder: npcOrder++,
          npcPointCost: view.npcPolicy.pointCost,
          npcResolverId: view.npcPolicy.resolverId,
        };
      }
    }
  }
  const spatialRuntime: MapSpatialRuntime = { ...baseSpatial, gatheringNodeStates };

  // 5. 更新 instance：版本 +1、清 Pending、記錄刷新日。
  const nextInstance: MapInstance = {
    ...instance,
    currentVersion: newVersion,
    refresh: {
      ...instance.refresh,
      pendingSinceDay: undefined,
      pendingCheckScheduledFor: undefined,
      lastRefreshedOnDay: ctx.worldDay,
    },
    spatialRuntime,
    revision: bump(instance.revision),
  };
  nextState = upsertInstance(nextState, nextInstance);

  const contentIds = generated.contents.map((c) => c.contentId);
  return makeResult(nextState, [
    emit({ type: 'MapRefreshed', mapId: instance.mapId, oldVersion, newVersion }),
    emit({ type: 'MapContentGenerated', mapId: instance.mapId, mapVersion: newVersion, contentIds }),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 Job Handler：mapRefreshCheck（regular / pending）
// ──────────────────────────────────────────────────────────────────────────

export function handleMapRefreshCheck(
  job: MapRefreshCheckJob,
  state: MapState,
  ctx: MapHandlerContext,
): ModuleResult<MapState> {
  const instance = tryGetInstance(state, job.targetId);
  if (instance === undefined) return makeResult(state); // 過期 Job：安靜丟棄

  // 過期 Pending Job 的判定用**刷新自己的 token**——`refresh.pendingCheckScheduledFor`——而不是
  // `instance.revision`。R8 #2 拿整個 instance.revision 比對，但開門(§5.2)、陷阱、採集、內容結算都會
  // bump 它：排好次日檢查後只要有人開一扇門，這筆 Job 就永遠變成 no-op，而且它不會再排下一次，地圖
  // 從此不再刷新。pendingCheckScheduledFor 只由 Pending 登記/刷新本身改動，正常探索動作碰不到它。
  //
  // 這同時仍然擋掉 R8 #2 的原始情境（同日兩筆 Pending Job → 版本連跳）：第一筆跑完若刷新則把它清成
  // undefined、若順延則改成新的一天，第二筆的 dueDay 兩種都對不上。
  // regular（固定節奏）Job 不受此限——它由日曆推導，本來就沒有 pending token。
  if (job.payload.reason === 'pending' && job.dueDay !== instance.refresh.pendingCheckScheduledFor) {
    return makeResult(state);
  }

  // 鎖定中：跳過，固定日曆不位移（doc §7.1 / §5.1）。
  const lock = instance.refresh.refreshLock;
  if (lock !== undefined && lock.releaseOnDay > ctx.worldDay) {
    return makeResult(state);
  }

  // 有隊伍在圖內：登記／保留 Pending，並排次日檢查（doc §7.2）。
  if (ctx.presence.countTeamsInside(instance.mapId) > 0) {
    const checkDay = (ctx.worldDay + 1) as WorldDay;
    const nextInstance: MapInstance = {
      ...instance,
      refresh: {
        ...instance.refresh,
        pendingSinceDay: instance.refresh.pendingSinceDay ?? ctx.worldDay,
        pendingCheckScheduledFor: checkDay,
      },
      revision: bump(instance.revision),
    };
    return makeResult(
      upsertInstance(state, nextInstance),
      [emit({ type: 'MapRefreshPendingRegistered', mapId: instance.mapId, checkDay })],
      [pendingCheckJobDraft(instance.mapId, checkDay)],
    );
  }

  // 無人、未鎖定：正式刷新。
  return refreshMapInstance(instance, state, ctx);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.3 DomainEvent Subscriber：TeamLocationChanged → 登記次日 Pending 檢查
// ──────────────────────────────────────────────────────────────────────────

export function onTeamLocationChanged(
  event: TeamLocationChangedEvent,
  state: MapState,
  ctx: MapHandlerContext,
): ModuleResult<MapState> {
  // 只在隊伍離開某張 adventureMap 時考慮。
  if (event.from.kind !== 'adventureMap') return makeResult(state);
  const mapId = event.from.mapId;
  const instance = tryGetInstance(state, mapId);
  if (instance === undefined) return makeResult(state);
  // 沒有 Pending 就不需要次日檢查（固定節奏由 regular Job 推導）。
  if (instance.refresh.pendingSinceDay === undefined) return makeResult(state);
  // 仍有人：不排次日檢查（doc §1.1：Map 不維護第二份位置真相）。
  if (ctx.presence.countTeamsInside(mapId) > 0) return makeResult(state);

  const checkDay = (ctx.worldDay + 1) as WorldDay;
  const nextInstance: MapInstance = {
    ...instance,
    refresh: { ...instance.refresh, pendingCheckScheduledFor: checkDay },
    revision: bump(instance.revision),
  };
  return makeResult(
    upsertInstance(state, nextInstance),
    [emit({ type: 'MapRefreshPendingRegistered', mapId, checkDay })],
    [pendingCheckJobDraft(mapId, checkDay)],
  );
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 Internal Command Handlers
// ──────────────────────────────────────────────────────────────────────────

// OpenMapDoor：紅門本版本永久開啟；已開啟時冪等成功（doc §5.2）。
export function handleOpenMapDoor(
  command: OpenMapDoor,
  state: MapState,
  ctx: MapHandlerContext,
): MapHandlerResult {
  void ctx;
  const instance = tryGetInstance(state, command.mapId);
  if (instance === undefined) return reject('map/unknown-instance', { mapId: String(command.mapId) });
  if (command.mapVersion !== instance.currentVersion) {
    return reject('map/stale-version', {
      expected: instance.currentVersion,
      actual: command.mapVersion,
    });
  }
  const door = instance.spatialRuntime.doorStates[command.linkId];
  if (door === undefined) return reject('map/not-red-door', { linkId: String(command.linkId) });
  if (door.state === 'open') return accept(state); // 冪等：不再收開門成本

  const nextDoor = {
    ...door,
    state: 'open' as const,
    openedOnDungeonMinute: command.openedOnDungeonMinute,
    revision: bump(door.revision),
  };
  const nextInstance: MapInstance = {
    ...instance,
    spatialRuntime: {
      ...instance.spatialRuntime,
      doorStates: { ...instance.spatialRuntime.doorStates, [command.linkId]: nextDoor },
    },
    revision: bump(instance.revision),
  };
  return accept(upsertInstance(state, nextInstance), [
    emit({
      type: 'MapDoorOpened',
      mapId: instance.mapId,
      mapVersion: instance.currentVersion,
      linkId: command.linkId,
    }),
  ]);
}

// ResolveMapTrap：armed → triggered/disarmed；已解除時冪等成功（doc §5.2）。
export function handleResolveMapTrap(
  command: ResolveMapTrap,
  state: MapState,
  ctx: MapHandlerContext,
): MapHandlerResult {
  void ctx;
  const instance = tryGetInstance(state, command.mapId);
  if (instance === undefined) return reject('map/unknown-instance', { mapId: String(command.mapId) });
  if (command.mapVersion !== instance.currentVersion) {
    return reject('map/stale-version', {
      expected: instance.currentVersion,
      actual: command.mapVersion,
    });
  }
  const trap = instance.spatialRuntime.trapStates[command.trapId];
  if (trap === undefined) return reject('map/unknown-trap', { trapId: String(command.trapId) });
  if (trap.state !== 'armed') return accept(state); // 冪等：同版本不再觸發

  const nextTrap = {
    ...trap,
    state: command.resolution.outcome,
    resolvedOnDungeonMinute: command.resolvedOnDungeonMinute,
    revision: bump(trap.revision),
  };
  const nextInstance: MapInstance = {
    ...instance,
    spatialRuntime: {
      ...instance.spatialRuntime,
      trapStates: { ...instance.spatialRuntime.trapStates, [command.trapId]: nextTrap },
    },
    revision: bump(instance.revision),
  };
  return accept(upsertInstance(state, nextInstance), [
    emit({
      type: 'MapTrapResolved',
      mapId: instance.mapId,
      mapVersion: instance.currentVersion,
      trapId: command.trapId,
      resolution: command.resolution,
    }),
  ]);
}

// HarvestMapGatheringNode：available + Team 在圖內 + resolutionId 未用 → harvested（doc §5.2）。
export function handleHarvestMapGatheringNode(
  command: HarvestMapGatheringNode,
  state: MapState,
  ctx: MapHandlerContext,
): MapHandlerResult {
  const instance = tryGetInstance(state, command.mapId);
  if (instance === undefined) return reject('map/unknown-instance', { mapId: String(command.mapId) });
  if (command.mapVersion !== instance.currentVersion) {
    return reject('map/stale-version', {
      expected: instance.currentVersion,
      actual: command.mapVersion,
    });
  }
  const node = instance.spatialRuntime.gatheringNodeStates[command.nodeId];
  if (node === undefined) return reject('map/unknown-node', { nodeId: String(command.nodeId) });
  if (!ctx.presence.isTeamInside(command.mapId, command.teamId)) {
    return reject('map/team-not-inside', { teamId: String(command.teamId) });
  }
  if (node.state === 'harvested') {
    // 同一 resolutionId 冪等成功；不同來源指向已消耗節點則拒絕（doc §8 測試 11）。
    if (node.harvestResolutionId === command.resolutionId) return accept(state);
    return reject('map/node-already-harvested', { nodeId: String(command.nodeId) });
  }
  const resolutionUsed = Object.values(instance.spatialRuntime.gatheringNodeStates).some(
    (n) => n.harvestResolutionId === command.resolutionId,
  );
  if (resolutionUsed) {
    return reject('map/resolution-id-used', { resolutionId: String(command.resolutionId) });
  }

  const nextNode: GatheringNodeRuntimeState = {
    ...node,
    state: 'harvested',
    harvestResolutionId: command.resolutionId,
    harvestedByTeamId: command.teamId,
    harvestedOnDay: ctx.worldDay,
    ...(command.harvestedOnDungeonMinute !== undefined
      ? { harvestedOnDungeonMinute: command.harvestedOnDungeonMinute }
      : {}),
    revision: bump(node.revision),
  };
  const nextInstance: MapInstance = {
    ...instance,
    spatialRuntime: {
      ...instance.spatialRuntime,
      gatheringNodeStates: {
        ...instance.spatialRuntime.gatheringNodeStates,
        [command.nodeId]: nextNode,
      },
    },
    revision: bump(instance.revision),
  };
  return accept(upsertInstance(state, nextInstance), [
    emit({
      type: 'MapGatheringNodeHarvested',
      mapId: instance.mapId,
      mapVersion: instance.currentVersion,
      nodeId: command.nodeId,
      teamId: command.teamId,
      resolutionId: command.resolutionId,
    }),
  ]);
}

// ResolvePlayerMapContent：驗證內容仍 available 後正式改為 resolved（doc §5.2）。
export function handleResolvePlayerMapContent(
  command: ResolvePlayerMapContent,
  state: MapState,
  ctx: MapHandlerContext,
): MapHandlerResult {
  const content = tryGetContent(state, command.contentId);
  if (content === undefined) return reject('map/unknown-content', { contentId: String(command.contentId) });
  if (content.mapId !== command.mapId) {
    return reject('map/content-map-mismatch', { contentId: String(command.contentId) });
  }
  if (content.state !== 'available') {
    return reject('map/content-not-available', { state: content.state }); // 不變量 6
  }
  const next: MapContentInstance = {
    ...content,
    state: 'resolved',
    resolvedOnDay: ctx.worldDay,
    revision: bump(content.revision),
  };
  return accept(upsertContent(state, next), [
    emit({
      type: 'MapContentResolved',
      mapId: command.mapId,
      contentId: command.contentId,
      distributionId: command.distributionId,
      resolution: command.resolution,
    }),
  ]);
}

// ApplyNpcDungeonSettlement：對暫存結果原子驗證，套用仍有效者；失效者寫入 skipped（doc §7.3）。
export function handleApplyNpcDungeonSettlement(
  command: ApplyNpcDungeonSettlement,
  state: MapState,
  ctx: MapHandlerContext,
): MapHandlerResult {
  const instance = tryGetInstance(state, command.mapId);
  if (instance === undefined) return reject('map/unknown-instance', { mapId: String(command.mapId) });

  // 依 npcOrder 順序套用（doc §7.3 步驟 3）。
  const ordered = [...command.pendingResults].sort((a, b) => a.npcOrder - b.npcOrder);

  let nextState = state;
  const messages: DomainEventDraft<unknown>[] = [];
  const applied: PendingDungeonResult[] = [];
  const skipped: PendingDungeonResult[] = [];

  const versionMatches = command.mapVersion === instance.currentVersion;

  for (const result of ordered) {
    if (!versionMatches || result.outcome !== 'success') {
      skipped.push(result);
      continue;
    }
    const target = result.target;
    if (target.kind === 'mapContent') {
      const content = tryGetContent(nextState, target.contentId);
      if (
        content === undefined ||
        content.mapId !== command.mapId || // 內容須屬本次結算的地圖（不得跨圖結算）
        content.mapVersion !== instance.currentVersion ||
        content.revision !== target.contentRevision || // 內容自 NPC 產生結果後已變（如委託 ProtectMapContent
        // bump revision、或被玩家處理）→ 舊結果失效，不得再結算（否則舊 NPC 結果可清掉已受保護的內容）
        content.npcResolverId !== result.resolverId || // Resolver 須與內容宣告的 npcResolverId 一致
        content.state !== 'available'
      ) {
        skipped.push(result); // 已被玩家或其他結算處理、或內容已變／受保護（doc §6 skippedResults）
        continue;
      }
      const resolved: MapContentInstance = {
        ...content,
        state: 'resolved',
        resolvedOnDay: ctx.worldDay,
        revision: bump(content.revision),
      };
      nextState = upsertContent(nextState, resolved);
      applied.push(result);
      messages.push(
        emit({
          type: 'MapContentResolved',
          mapId: command.mapId,
          contentId: target.contentId,
          distributionId: command.distributionId,
          resolution: { kind: 'npcTargetResolver', resolverId: result.resolverId, outcome: 'success' },
        }),
      );
    } else {
      // TODO: NPC 採集點結算（node result → GatheringNodeRuntimeState.harvested）本版未實作；
      // 目前一律歸入 skipped。玩家採集主路由 HarvestMapGatheringNode 承擔。
      skipped.push(result);
    }
  }

  messages.push(
    emit({
      type: 'NpcDungeonSettlementApplied',
      runId: command.runId,
      distributionId: command.distributionId,
      appliedResults: applied,
      skippedResults: skipped,
    }),
  );
  return accept(nextState, messages);
}

// ProtectMapContent：依 mode 更新 Quest 對內容的保護（doc §5.2；無對應 DomainEvent）。
export function handleProtectMapContent(
  command: ProtectMapContent,
  state: MapState,
  ctx: MapHandlerContext,
): MapHandlerResult {
  void ctx;
  const content = tryGetContent(state, command.contentId);
  if (content === undefined) return reject('map/unknown-content', { contentId: String(command.contentId) });

  const set = new Set(content.protectedByQuestIds);
  if (command.mode === 'protect') set.add(command.questId);
  else set.delete(command.questId);
  const protectedByQuestIds = [...set];

  if (protectedByQuestIds.length === content.protectedByQuestIds.length) {
    return accept(state); // 冪等：無實質變化
  }
  const next: MapContentInstance = {
    ...content,
    protectedByQuestIds,
    revision: bump(content.revision),
  };
  return accept(upsertContent(state, next));
}

// SetMapRefreshLock：為鎮壓／討伐建立或解除刷新鎖（doc §5.2）。
export function handleSetMapRefreshLock(
  command: SetMapRefreshLock,
  state: MapState,
  ctx: MapHandlerContext,
): MapHandlerResult {
  const instance = tryGetInstance(state, command.mapId);
  if (instance === undefined) return reject('map/unknown-instance', { mapId: String(command.mapId) });

  if (command.mode === 'set') {
    if (command.reason === undefined || command.releaseOnDay === undefined) {
      return reject('map/invalid-lock', { mode: command.mode });
    }
    // 現存鎖屬於別張委託時不得覆蓋。R11 #4 只擋了 release，但 set 一樣會奪走所有權——別張委託直接
    // 覆蓋後，原委託連自己下的鎖都解不掉（sourceQuestId 已被換成新的），等於繞過 R11 #4（複審 R12 #2）。
    // 同一張委託重設（延長／改 reason）仍允許。
    // 只有**仍生效**的鎖才算被持有。`releaseOnDay <= worldDay` 已到期——刷新流程（§371）與
    // `isRefreshLocked`（queries）都是這樣判定的，set 卻只看鎖存不存在，於是舊委託的殘留鎖會一直
    // 擋住新委託下鎖（複審 R13 #2）。到期鎖視同不存在，直接由新委託覆蓋。
    const existingLock = instance.refresh.refreshLock;
    const held = existingLock !== undefined && existingLock.releaseOnDay > ctx.worldDay ? existingLock : undefined;
    if (held !== undefined && held.sourceQuestId !== command.sourceQuestId) {
      return reject('map/refresh-lock-not-owned', {
        mapId: String(command.mapId),
        lockOwner: String(held.sourceQuestId),
        requestedBy: String(command.sourceQuestId),
      });
    }
    const lock: RefreshLock = {
      lockId: ctx.ids.nextMapRefreshLockId(),
      reason: command.reason,
      releaseOnDay: command.releaseOnDay,
      sourceQuestId: command.sourceQuestId,
    };
    const nextInstance: MapInstance = {
      ...instance,
      refresh: {
        ...instance.refresh,
        refreshLock: lock,
        // GDD §183：鎮壓／討伐鎖期間「皆跳過刷新日**且不建立 Pending**」，解除後等下一個固定刷新日
        // ——不補算、不累積。所以設鎖時要一併清掉既有的 Pending 登記，否則會殘留一個永遠不會被重排的
        // marker（複審 R10 #6；01_map_module.md §5.1 原本寫成「保留 Pending 並重排」，與 GDD 相反，
        // 已一併更正）。
        pendingSinceDay: undefined,
        pendingCheckScheduledFor: undefined,
      },
      revision: bump(instance.revision),
    };
    return accept(upsertInstance(state, nextInstance), [
      emit({ type: 'MapRefreshLockChanged', mapId: command.mapId, lock }),
    ]);
  }

  // release：清除刷新鎖。**只有下鎖的那張委託能解自己的鎖**——原本任何 Quest 都能解掉別人的鎖，
  // 等於一張無關委託就能讓鎮壓／討伐目標地圖提前恢復刷新，把已固定的目標狀態洗掉（複審 R11 #4）。
  const existing = instance.refresh.refreshLock;
  if (existing === undefined) {
    return reject('map/no-refresh-lock', { mapId: String(command.mapId) });
  }
  if (existing.sourceQuestId !== command.sourceQuestId) {
    return reject('map/refresh-lock-not-owned', {
      mapId: String(command.mapId),
      lockOwner: String(existing.sourceQuestId),
      requestedBy: String(command.sourceQuestId),
    });
  }
  const nextInstance: MapInstance = {
    ...instance,
    refresh: { ...instance.refresh, refreshLock: undefined },
    revision: bump(instance.revision),
  };
  return accept(upsertInstance(state, nextInstance), [
    emit({ type: 'MapRefreshLockChanged', mapId: command.mapId }),
  ]);
}
