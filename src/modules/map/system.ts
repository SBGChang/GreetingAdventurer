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
  ContentEventInstanceId,
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
  NpcSequenceRuleDefinition,
  NpcSequenceGroupKey,
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
  // MapInstance 的擁有者是 map，所以它的 ID 也只能由 map 的配發器鑄造（§12）。
  // 世界建立時由 Bootstrap 依 adventure-site 逐一鑄出；team 不得自己鑄
  //（見 TeamWorldPort.getAdventureSiteMapInstance 的說明——那正是它取代的違規）。
  nextMapInstanceId(): MapInstanceId;
  // 事件內容實例的身分（見 MapContentPayload 的 mapEvent 分支）。
  nextContentEventInstanceId(): ContentEventInstanceId;
}

// 由資料 Resolver 決定的**本局**內容：挑中哪一筆 Map Content 定義，以及那一筆在本次刷新的
// payload（encounterGroup／chest items／event def 等，皆由 Spawn Rule 的候選池抽出）。
//
// 【裁定 C 之後】原本 draft 還帶 `kind` 與 `npcEligible`/`npcPointCost`/`npcResolverId`——
// 那三個 NPC 欄位是**內容**（doc §3.3 不變量 5：成本由 Definition 指定），卻只存在於這個本地
// port，於是 fixture 只能手打 `kind === 'boss' ? 4 : 1`。現在它們住在
// `MapContentDefinition.npcPolicy`，Map 由 `definitionId` 讀回來；`kind` 同理改由 Definition 宣告，
// 這樣 draft 也不可能與 Definition 互相矛盾。
export type SpawnDraft = Readonly<{
  definitionId: DefinitionId;
  payload: MapContentPayload;
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

// 生成階段偵測到的「Resolver 挑的定義」與「Spawn Rule／payload 說的」對不上時丟出的錯誤。
//
// 為什麼是 throw 而不是回傳拒絕：`mapRefreshCheck` 是 Job（`ModuleResult`，契約上不可拒絕），
// 而這種不一致不是玩法情境，是**內容／Resolver 註冊本身壞了**。五個合法出口裡對應的是
// 「Content Pack 驗證失敗」——正式解法是在載入階段擋下（見交接回報的未閉合項目）。在那之前，
// 唯一不說謊的執行期反應是讓整筆交易回滾：既不能跳過該筆（那是規範 §6 點名的偽裝），
// 也不能寫進一筆違反 doc §3.3 不變量 8 的內容。窄化 Reader 對未註冊定義本來就是 throw，
// 這裡與它同型。
export class MapRefreshContentDataError extends Error {
  readonly definitionId: DefinitionId;

  constructor(message: string, definitionId: DefinitionId) {
    super(message);
    this.name = 'MapRefreshContentDataError';
    this.definitionId = definitionId;
  }
}

// NPC 序列候選：動態內容與固定採集點共用一條序列（doc §3.3 不變量 4），所以兩者在排序前
// 必須先變成同一種形狀。`groupKey` 決定排序權重來自 NpcSequenceRule 的哪一格。
type NpcSequenceCandidate = Readonly<{
  groupKey: NpcSequenceGroupKey;
  pointCost: number;
  resolverId: NpcDungeonTargetResolverId;
  target:
    | Readonly<{ kind: 'mapContent'; contentId: ContentInstanceId }>
    | Readonly<{ kind: 'gatheringNode'; nodeId: GatheringNodeId }>;
}>;

// 指派完成後寫進 Runtime 的三欄。doc §3.1 空間不變量 4 要求它們**同時存在**，所以它們是一組，
// 不是三個各自選填的欄位。
type NpcRuntimeFields = Readonly<{
  npcOrder: number;
  npcPointCost: number;
  npcResolverId: NpcDungeonTargetResolverId;
}>;

type GeneratedContent = Readonly<{
  contents: readonly MapContentInstance[];
  candidates: readonly NpcSequenceCandidate[];
}>;

// 依 Spawn Rule 的 spawnBudgets 生成本版本動態內容：
//   * 每個 budget 以注入 RNG 決定 count ∈ [minCount, maxCount]（決定性）。
//   * 一房一內容（不變量 3）：依 eligibleContentRoomIds 順序配置，房間耗盡即停止。
//   * 內容的 kind 與 NPC Policy 一律取自 `MapContentDefinition`（【裁定 C】），
//     本函式不再決定任何玩法數值；`npcOrder` 於 assignNpcSequence 統一指派（不變量 4）。
function generateMapContent(
  mapId: MapInstanceId,
  mapVersion: number,
  template: MapTemplateDefinition,
  spawnRule: MapSpawnRuleDefinition,
  ctx: MapHandlerContext,
): GeneratedContent {
  const rooms = eligibleContentRoomIds(template);
  const contents: MapContentInstance[] = [];
  const candidates: NpcSequenceCandidate[] = [];
  let cursor = ctx.rngContext.cursor;
  let roomIdx = 0;

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
      const definition = ctx.definitions.getContentDefinition(draft.definitionId);

      // Resolver 是「依 budget 要求挑一筆定義」，挑錯家族時整份 spawnBudgets 的語意就失效了。
      if (definition.contentKind !== budget.contentKind) {
        throw new MapRefreshContentDataError(
          `map: spawn budget 要求 "${budget.contentKind}"，Resolver 卻挑了 contentKind "${definition.contentKind}" 的定義 "${String(draft.definitionId)}"`,
          draft.definitionId,
        );
      }
      // doc §3.3 不變量 8：`payload.kind` 必須與外層 kind 相容。
      if (draft.payload.kind !== definition.contentKind) {
        throw new MapRefreshContentDataError(
          `map: 定義 "${String(draft.definitionId)}" 的 contentKind 為 "${definition.contentKind}"，Resolver 卻給了 payload.kind "${draft.payload.kind}"`,
          draft.definitionId,
        );
      }

      const contentId = ctx.ids.nextContentInstanceId();
      contents.push({
        contentId,
        mapId,
        mapVersion,
        kind: definition.contentKind,
        definitionId: draft.definitionId,
        position: { roomId },
        payload: draft.payload,
        state: 'available',
        protectedByQuestIds: [],
        revision: 0 as Revision,
      });

      if (definition.npcPolicy.eligible) {
        candidates.push({
          groupKey: definition.contentKind,
          pointCost: definition.npcPolicy.pointCost,
          resolverId: definition.npcPolicy.resolverId,
          target: { kind: 'mapContent', contentId },
        });
      }
    }
  }

  return { contents, candidates };
}

// 固定採集點的 NPC 候選（doc §2.2 末條：啟用 NPC Policy 的採集點與動態內容一起取得唯一 npcOrder）。
// 資格與成本屬 Gathering Rule（19_gathering_service.md §2），Map 只讀窄化 View。
function gatheringNpcCandidates(
  template: MapTemplateDefinition,
  ctx: MapHandlerContext,
): readonly NpcSequenceCandidate[] {
  const candidates: NpcSequenceCandidate[] = [];
  for (const node of template.gatheringNodes) {
    const policy = ctx.definitions.getGatheringMapView(node.gatheringRuleId).npcPolicy;
    if (policy === undefined || !policy.eligible) continue;
    candidates.push({
      groupKey: 'gatheringNode',
      pointCost: policy.pointCost,
      resolverId: policy.resolverId,
      target: { kind: 'gatheringNode', nodeId: node.nodeId },
    });
  }
  return candidates;
}

// 【裁定 B】依 NpcSequenceRule 的 groupPriority 指派唯一 npcOrder。
//
// 排序只用 `groupPriority`（權重小者先）。同權重時的先後由**建構順序**決定（動態內容依生成
// 順序、採集點依 Template 宣告順序），而 `Array.prototype.sort` 在 ES2019 起保證穩定——
// 所以結果仍是決定性的，且不需要再發明第二個排序依據。
//
// `npcOrder` 從 1 起、步進 1：那是序數本身（結構），不是可調內容。
function assignNpcSequence(
  rule: NpcSequenceRuleDefinition,
  candidates: readonly NpcSequenceCandidate[],
): readonly Readonly<{ candidate: NpcSequenceCandidate; npcOrder: number }>[] {
  for (const candidate of candidates) {
    const priority = rule.groupPriority[candidate.groupKey];
    // 型別上 groupPriority 是非 Partial Record，但它來自外部 JSON：缺格時排序比較會變成 NaN，
    // 而 NaN 比較會讓順序不再決定性。不得以 `?? 0` 補（規範 §6），只能明確失敗。
    if (!Number.isFinite(priority)) {
      throw new MapRefreshContentDataError(
        `map: NPC 序列規則 "${String(rule.id)}" 缺少目標家族 "${candidate.groupKey}" 的 groupPriority`,
        rule.id,
      );
    }
  }
  return [...candidates]
    .sort((a, b) => rule.groupPriority[a.groupKey] - rule.groupPriority[b.groupKey])
    .map((candidate, index) => ({ candidate, npcOrder: index + 1 }));
}

// 把一筆內容移出 NPC 序列：三欄同進同出（doc §3.1 要求 npcOrder／npcPointCost／npcResolverId
// 同時存在，所以也必須同時消失，不能留下一個孤兒 npcOrder）。
// 本來就不在序列上時回 undefined —— 沒變的東西不寫回，也不 bump revision。
function withdrawnFromNpcSequence(content: MapContentInstance): MapContentInstance | undefined {
  if (
    content.npcOrder === undefined &&
    content.npcPointCost === undefined &&
    content.npcResolverId === undefined
  ) {
    return undefined;
  }
  const {
    npcOrder: _npcOrder,
    npcPointCost: _npcPointCost,
    npcResolverId: _npcResolverId,
    ...rest
  } = content;
  return { ...rest, revision: bump(content.revision) };
}

// ──────────────────────────────────────────────────────────────────────────
// §7.1 固定刷新（核心：版本 +1、空間重建、內容生成）
// ──────────────────────────────────────────────────────────────────────────

// 匯出給 Composition：世界建立時每張圖都要跑一次，才會有第一版內容。
// 刻意**不另寫一條 bootstrap 專用生成路徑**——那會讓「開局的圖」與「刷新後的圖」變成兩套規則，
// 而兩套規則遲早會不一致。Bootstrap 把實例建在版本 0，跑這支就得到版本 1 ＋ 內容，
// 與日後每一次刷新走完全相同的程式。
export function refreshMapInstance(
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
    if (content.protectedByQuestIds.length > 0) {
      // 保留者跨到新版本後仍然 available，但它的 mapVersion 停在舊版本，而
      // ApplyNpcDungeonSettlement 對 `content.mapVersion !== instance.currentVersion` 一律 skip
      // （見 handleApplyNpcDungeonSettlement）——它已經不可能被 NPC 結算。若讓它留著舊的
      // npcOrder，listNpcSequence 會同時吐出它與新版本的 1..n，兩者相撞，doc §3.3 不變量 4
      // （npcOrder 不可重複）當場破掉；NPC 還會為一個必定 skip 的目標付掉每日點數。
      // 因此受保護內容一併退出 NPC 序列。玩家路徑不受影響：handleResolvePlayerMapContent
      // 不看版本，受保護內容仍可由玩家處理完成委託。
      const withdrawn = withdrawnFromNpcSequence(content);
      if (withdrawn !== undefined) nextState = upsertContent(nextState, withdrawn);
      continue;
    }
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

  // 3. 生成新內容（kind／NPC Policy 皆取自 MapContentDefinition，見【裁定 C】）。
  const generated = generateMapContent(instance.mapId, newVersion, template, spawnRule, ctx);

  // 4. 動態內容與 NPC-enabled 採集點合成**同一條**序列，依 NpcSequenceRule 指派 npcOrder
  //    （doc §2.2 末條／§3.3 不變量 4；【裁定 B】）。
  const sequenceRule = ctx.definitions.getNpcSequenceRule(spawnRule.npcSequenceRuleId);
  const sequenced = assignNpcSequence(sequenceRule, [
    ...generated.candidates,
    ...gatheringNpcCandidates(template, ctx),
  ]);

  const npcFieldsByContentId = new Map<ContentInstanceId, NpcRuntimeFields>();
  const npcFieldsByNodeId = new Map<GatheringNodeId, NpcRuntimeFields>();
  for (const { candidate, npcOrder } of sequenced) {
    const fields: NpcRuntimeFields = {
      npcOrder,
      npcPointCost: candidate.pointCost,
      npcResolverId: candidate.resolverId,
    };
    if (candidate.target.kind === 'mapContent') {
      npcFieldsByContentId.set(candidate.target.contentId, fields);
    } else {
      npcFieldsByNodeId.set(candidate.target.nodeId, fields);
    }
  }

  for (const content of generated.contents) {
    const fields = npcFieldsByContentId.get(content.contentId);
    nextState = upsertContent(nextState, fields === undefined ? content : { ...content, ...fields });
  }

  const gatheringNodeStates: Record<GatheringNodeId, GatheringNodeRuntimeState> = {
    ...baseSpatial.gatheringNodeStates,
  };
  for (const [nodeId, fields] of npcFieldsByNodeId) {
    const base = gatheringNodeStates[nodeId];
    if (base === undefined) continue; // Template 的採集點與 baseSpatial 同源，理論上必存在
    gatheringNodeStates[nodeId] = { ...base, ...fields };
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
  const result = applyMapRefreshCheck(job, state, ctx);
  const instance = tryGetInstance(result.nextSlice, job.targetId);
  if (instance === undefined || job.payload.reason !== 'regular') return result;
  const template = ctx.definitions.getMapTemplate(instance.templateId);
  return {
    ...result,
    scheduledJobs: [...result.scheduledJobs, nextMapRefreshJob(instance.mapId, template, ctx.worldDay)],
  };
}

export function nextMapRefreshJob(
  mapId: MapInstanceId,
  template: MapTemplateDefinition,
  afterDay: number,
): ScheduledJobDraft<MapRefreshCheckJob> {
  const cadence = template.refreshCadenceDays;
  const offset = template.refreshOffsetDays;
  if (!Number.isSafeInteger(cadence) || cadence <= 0 || !Number.isSafeInteger(offset) || offset < 0 || offset >= cadence) {
    throw new Error('map/invalid-refresh-calendar');
  }
  return {
    type: 'mapRefreshCheck', ownerModule: MAP_MODULE_ID, targetId: mapId,
    dueDay: (offset + (Math.floor((afterDay - offset) / cadence) + 1) * cadence) as WorldDay,
    payload: { reason: 'regular' },
  };
}

function applyMapRefreshCheck(
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
