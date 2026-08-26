// modules/map/map.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。

import type {
  JobId,
  WorldDay,
  TeamId,
  DungeonMinute,
  GatheringResolutionId,
  AssetDistributionId,
  QuestId,
  ResolverId,
  NpcDungeonRunId,
  NpcDungeonTargetResolverId,
  TransactionMessageDraft,
} from '../../contracts/core';
import type {
  NpcSequenceRuleDefinition,
  MapRefreshCheckJob,
  OpenMapDoor,
  ResolveMapTrap,
  HarvestMapGatheringNode,
  ApplyNpcDungeonSettlement,
  SetMapRefreshLock,
  MapDomainEvent,
} from '../../contracts/map';
import type { PendingDungeonResult } from '../../contracts/dungeon';
import type { MapHandlerResult } from './system';
import {
  MAP_MODULE_ID,
  MapRefreshContentDataError,
  handleMapRefreshCheck,
  handleOpenMapDoor,
  handleResolveMapTrap,
  handleHarvestMapGatheringNode,
  handleApplyNpcDungeonSettlement,
  handleSetMapRefreshLock,
} from './system';
import { createMapQuery } from './queries';
import {
  fixtureMapState,
  makeContext,
  stubPresence,
  stubDefinitionReader,
  stubContentResolver,
  stubNpcSequenceRule,
  makeIdAllocator,
  CONTENT_DEFINITIONS,
  DEFAULT_GROUP_PRIORITY,
  MONSTER_CONTENT_DEF_ID,
  CHEST_CONTENT_DEF_ID,
  MAP_ID,
  LINK_RED,
  TRAP_ID,
  NODE_ID,
} from './fixtures';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────────
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eventsOf(messages: readonly TransactionMessageDraft[]): MapDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as MapDomainEvent);
}

function hasEvent(events: readonly MapDomainEvent[], type: MapDomainEvent['type']): boolean {
  return events.some((e) => e.type === type);
}

function findEvent<K extends MapDomainEvent['type']>(
  events: readonly MapDomainEvent[],
  type: K,
): Extract<MapDomainEvent, { type: K }> | undefined {
  return events.find((e) => e.type === type) as Extract<MapDomainEvent, { type: K }> | undefined;
}

function expectOk(r: MapHandlerResult, label: string) {
  if (!r.ok) throw new Error(`${label}: expected accept, got reject ${r.rejection.code}`);
  return r.result;
}

function expectReject(r: MapHandlerResult, code: string, label: string) {
  if (r.ok) throw new Error(`${label}: expected reject '${code}', got accept`);
  assert(r.rejection.code === code, `${label}: expected code '${code}', got '${r.rejection.code}'`);
}

// 內容／Resolver 不一致是「Content Pack 驗證失敗」的執行期補位：整筆交易必須失敗，
// 不得跳過該筆、也不得寫進違反不變量的內容。
function expectThrow(fn: () => unknown, label: string) {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  if (thrown === undefined) throw new Error(`${label}: 預期 MapRefreshContentDataError，卻順利完成`);
  assert(
    thrown instanceof MapRefreshContentDataError,
    `${label}: 預期 MapRefreshContentDataError，實得 ${String(thrown)}`,
  );
}

const TEAM_ID = 'team-1' as TeamId;
// 只在測試裡出現的替代 Resolver ID：用來證明 resolverId 真的是從 Definition 讀出來的。
const ALT_RESOLVER_ID = 'definition:npc-dungeon-target-resolver:alt' as NpcDungeonTargetResolverId;
const QUEST_ID = 'quest-1' as QuestId;

function regularJob(dueDay: number): MapRefreshCheckJob {
  return {
    jobId: 'job-regular' as JobId,
    type: 'mapRefreshCheck',
    dueDay: dueDay as WorldDay,
    ownerModule: MAP_MODULE_ID,
    targetId: MAP_ID,
    payload: { reason: 'regular' },
  };
}

function pendingJob(dueDay: number): MapRefreshCheckJob {
  return {
    jobId: 'job-pending' as JobId,
    type: 'mapRefreshCheck',
    dueDay: dueDay as WorldDay,
    ownerModule: MAP_MODULE_ID,
    targetId: MAP_ID,
    payload: { reason: 'pending' },
  };
}

// ── 測試案例 ─────────────────────────────────────────────────────────────────
type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: '#2：同日兩筆 Pending Job → 只刷一次（版本不連跳 1→2→3）',
    run: () => {
      // 先以「有人在圖內的固定刷新日」真正登記一次 Pending（pendingCheckScheduledFor=101）。
      const occupied = makeContext({ worldDay: 100 as WorldDay, presence: stubPresence({ teamsInside: 1 }) });
      const registered = handleMapRefreshCheck(regularJob(100), fixtureMapState(1), occupied);
      assert(
        registered.nextSlice.instances[MAP_ID]!.refresh.pendingCheckScheduledFor === 101,
        '應登記次日 101 的 Pending 檢查',
      );
      // 次日無人：同一天排到兩筆 Pending Job（重複），只有第一筆該刷。
      const empty = makeContext({ worldDay: 101 as WorldDay, presence: stubPresence({ teamsInside: 0 }) });
      const dup = (id: string): MapRefreshCheckJob => ({ ...pendingJob(101), jobId: id as JobId });
      const r1 = handleMapRefreshCheck(dup('j1'), registered.nextSlice, empty);
      assert(r1.nextSlice.instances[MAP_ID]!.currentVersion === 2, `首刷應到版本 2（實得 ${r1.nextSlice.instances[MAP_ID]!.currentVersion}）`);
      // 首刷已把 pendingCheckScheduledFor 清成 undefined → 第二筆對不上，no-op。
      const r2 = handleMapRefreshCheck(dup('j2'), r1.nextSlice, empty);
      assert(
        r2.nextSlice.instances[MAP_ID]!.currentVersion === 2,
        `重複的 Pending Job 不得再刷（版本應維持 2，實得 ${r2.nextSlice.instances[MAP_ID]!.currentVersion}）`,
      );
    },
  },
  {
    // R9 #2：R8 #2 拿 instance.revision 當存活判定，但開門/陷阱/採集都會 bump 它——排好次日檢查後
    // 只要有人開一扇門，Job 就永遠 no-op，且不再排下一次，地圖從此不刷新。
    name: '#2 迴歸：排好 Pending 檢查後開門（bump instance.revision）不得使該檢查失效',
    run: () => {
      const occupied = makeContext({ worldDay: 100 as WorldDay, presence: stubPresence({ teamsInside: 1 }) });
      const registered = handleMapRefreshCheck(regularJob(100), fixtureMapState(1), occupied);
      const revBefore = registered.nextSlice.instances[MAP_ID]!.revision;
      // 用**模組自己排出來的** Job，而不是手刻的：這樣不論模組把什麼存活欄位掛上去，這個測試都會驗到它。
      const scheduled = registered.scheduledJobs[0] as Omit<MapRefreshCheckJob, 'jobId'> | undefined;
      assert(scheduled !== undefined, '登記 Pending 時應排出一筆檢查 Job');
      const pendingFromModule: MapRefreshCheckJob = { ...scheduled!, jobId: 'job-pending-real' as JobId };

      // 隊伍在圖內開了一扇紅門：純粹的探索動作，卻會 bump instance.revision。
      const opened = expectOk(
        handleOpenMapDoor(
          {
            type: 'OpenMapDoor',
            teamId: TEAM_ID,
            mapId: MAP_ID,
            mapVersion: 1,
            linkId: LINK_RED,
            openedOnDungeonMinute: 5 as DungeonMinute,
          },
          registered.nextSlice,
          occupied,
        ),
        'open-door',
      );
      assert(
        opened.nextSlice.instances[MAP_ID]!.revision !== revBefore,
        '前提：開門確實會 bump instance.revision',
      );

      // 次日無人 → 這筆 Pending 檢查仍必須刷新。
      const empty = makeContext({ worldDay: 101 as WorldDay, presence: stubPresence({ teamsInside: 0 }) });
      const refreshed = handleMapRefreshCheck(pendingFromModule, opened.nextSlice, empty);
      assert(
        refreshed.nextSlice.instances[MAP_ID]!.currentVersion === 2,
        `開門不得讓 Pending 刷新永久失效（版本應為 2，實得 ${refreshed.nextSlice.instances[MAP_ID]!.currentVersion}）`,
      );
    },
  },
  {
    name: 'refresh: 版本 +1、空間重建、內容生成、NPC 序列全域不重複',
    run: () => {
      const state = fixtureMapState(1);
      const ctx = makeContext({ presence: stubPresence({ teamsInside: 0 }) });
      const res = handleMapRefreshCheck(regularJob(100), state, ctx);

      const inst = res.nextSlice.instances[MAP_ID]!;
      assert(inst.currentVersion === 2, `版本應為 2，實際 ${inst.currentVersion}`);
      assert(inst.spatialRuntime.mapVersion === 2, 'spatialRuntime 版本應與 currentVersion 一致');
      assert(
        Object.values(inst.spatialRuntime.doorStates).every((d) => d.state === 'closed'),
        '刷新後所有紅門應回到 closed',
      );
      assert(
        Object.values(inst.spatialRuntime.trapStates).every((t) => t.state === 'armed'),
        '刷新後所有陷阱應回到 armed',
      );
      assert(
        Object.values(inst.spatialRuntime.gatheringNodeStates).every((n) => n.state === 'available'),
        '刷新後所有採集點應回到 available',
      );

      const events = eventsOf(res.outgoingMessages);
      assert(hasEvent(events, 'MapRefreshed'), '應 emit MapRefreshed');
      const gen = findEvent(events, 'MapContentGenerated');
      assert(gen !== undefined, '應 emit MapContentGenerated');
      assert(gen!.contentIds.length === 1, `唯一可用房間應生成 1 筆內容，實際 ${gen!.contentIds.length}`);
      const refreshed = findEvent(events, 'MapRefreshed');
      assert(refreshed!.oldVersion === 1 && refreshed!.newVersion === 2, 'MapRefreshed 版本欄位應正確');

      // NPC 序列：動態內容（npcOrder 1）+ NPC-enabled 採集點（npcOrder 2），全域不重複。
      const seq = createMapQuery(res.nextSlice, stubDefinitionReader()).listNpcSequence(MAP_ID);
      assert(seq.length === 2, `NPC 序列應含 2 筆，實際 ${seq.length}`);
      assert(seq[0]!.npcOrder === 1 && seq[1]!.npcOrder === 2, 'npcOrder 應為 1,2 遞增');
      assert(seq[0]!.kind === 'mapContent', '第一筆應為 mapContent');
      assert(seq[1]!.kind === 'gatheringNode', '第二筆應為 gatheringNode');
      const orders = new Set(seq.map((e) => e.npcOrder));
      assert(orders.size === seq.length, 'npcOrder 不可重複');
    },
  },
  {
    name: 'OpenMapDoor: 同版本冪等、版本失效拒絕',
    run: () => {
      const state = fixtureMapState(1);
      const ctx = makeContext();
      const cmd: OpenMapDoor = {
        type: 'OpenMapDoor',
        teamId: TEAM_ID,
        mapId: MAP_ID,
        mapVersion: 1,
        linkId: LINK_RED,
        openedOnDungeonMinute: 5 as DungeonMinute,
      };
      const r1 = expectOk(handleOpenMapDoor(cmd, state, ctx), 'open#1');
      assert(
        r1.nextSlice.instances[MAP_ID]!.spatialRuntime.doorStates[LINK_RED]!.state === 'open',
        '門應為 open',
      );
      assert(hasEvent(eventsOf(r1.outgoingMessages), 'MapDoorOpened'), '首開應 emit MapDoorOpened');

      // 冪等：再開一次不變、不再發事件（同版本不重複收費）。
      const r2 = expectOk(handleOpenMapDoor(cmd, r1.nextSlice, ctx), 'open#2');
      assert(
        r2.nextSlice.instances[MAP_ID]!.spatialRuntime.doorStates[LINK_RED]!.state === 'open',
        '門仍應為 open',
      );
      assert(eventsOf(r2.outgoingMessages).length === 0, '冪等再開不應發事件');

      // 版本失效：拒絕。
      expectReject(
        handleOpenMapDoor({ ...cmd, mapVersion: 99 }, state, ctx),
        'map/stale-version',
        'open stale',
      );
    },
  },
  {
    name: 'ResolveMapTrap: armed → disarmed，同版本冪等不再觸發',
    run: () => {
      const state = fixtureMapState(1);
      const ctx = makeContext();
      const cmd: ResolveMapTrap = {
        type: 'ResolveMapTrap',
        teamId: TEAM_ID,
        mapId: MAP_ID,
        mapVersion: 1,
        trapId: TRAP_ID,
        resolution: { outcome: 'disarmed' },
        resolvedOnDungeonMinute: 3 as DungeonMinute,
      };
      const r1 = expectOk(handleResolveMapTrap(cmd, state, ctx), 'trap#1');
      assert(
        r1.nextSlice.instances[MAP_ID]!.spatialRuntime.trapStates[TRAP_ID]!.state === 'disarmed',
        '陷阱應為 disarmed',
      );
      assert(hasEvent(eventsOf(r1.outgoingMessages), 'MapTrapResolved'), '應 emit MapTrapResolved');

      const r2 = expectOk(handleResolveMapTrap(cmd, r1.nextSlice, ctx), 'trap#2');
      assert(
        r2.nextSlice.instances[MAP_ID]!.spatialRuntime.trapStates[TRAP_ID]!.state === 'disarmed',
        '陷阱仍應為 disarmed',
      );
      assert(eventsOf(r2.outgoingMessages).length === 0, '同版本已解決應冪等（不再發事件）');
    },
  },
  {
    name: 'HarvestMapGatheringNode: 首採成功、同 resolutionId 冪等、已消耗拒絕、不在圖內拒絕',
    run: () => {
      const state = fixtureMapState(1);
      const inside = makeContext({ presence: stubPresence({ teamIsInside: true }) });
      const cmd: HarvestMapGatheringNode = {
        type: 'HarvestMapGatheringNode',
        teamId: TEAM_ID,
        mapId: MAP_ID,
        mapVersion: 1,
        nodeId: NODE_ID,
        resolutionId: 'gres-1' as GatheringResolutionId,
        harvestedOnDungeonMinute: 2 as DungeonMinute,
      };
      const r1 = expectOk(handleHarvestMapGatheringNode(cmd, state, inside), 'harvest#1');
      const node1 = r1.nextSlice.instances[MAP_ID]!.spatialRuntime.gatheringNodeStates[NODE_ID]!;
      assert(node1.state === 'harvested', '節點應為 harvested');
      assert(node1.harvestedByTeamId === TEAM_ID, '應記錄 harvestedByTeamId');
      assert(hasEvent(eventsOf(r1.outgoingMessages), 'MapGatheringNodeHarvested'), '應 emit 事件');

      // 同 resolutionId 冪等成功（不再發事件）。
      const r2 = expectOk(handleHarvestMapGatheringNode(cmd, r1.nextSlice, inside), 'harvest#2');
      assert(eventsOf(r2.outgoingMessages).length === 0, '同 resolutionId 應冪等');

      // 不同 resolutionId 指向已消耗節點 → 拒絕。
      expectReject(
        handleHarvestMapGatheringNode(
          { ...cmd, resolutionId: 'gres-2' as GatheringResolutionId },
          r1.nextSlice,
          inside,
        ),
        'map/node-already-harvested',
        'harvest dup-node',
      );

      // Team 不在圖內 → 拒絕。
      expectReject(
        handleHarvestMapGatheringNode(cmd, state, makeContext({ presence: stubPresence({ teamIsInside: false }) })),
        'map/team-not-inside',
        'harvest not-inside',
      );
    },
  },
  {
    name: 'ApplyNpcDungeonSettlement: 有效內容套用一次；重送則進 skipped',
    run: () => {
      const refreshed = handleMapRefreshCheck(regularJob(100), fixtureMapState(1), makeContext()).nextSlice;
      const query = createMapQuery(refreshed, stubDefinitionReader());
      const content = query.listAvailableContent(MAP_ID)[0]!;

      const pending: PendingDungeonResult = {
        target: { kind: 'mapContent', contentId: content.contentId, contentRevision: content.revision },
        npcOrder: content.npcOrder ?? 1,
        attemptedOnDay: 100 as WorldDay,
        outcome: 'success',
        resolverId: content.npcResolverId!,
        pendingRewardRefs: [],
      };
      const cmd: ApplyNpcDungeonSettlement = {
        type: 'ApplyNpcDungeonSettlement',
        runId: 'run-1' as NpcDungeonRunId,
        mapId: MAP_ID,
        mapVersion: 2,
        distributionId: 'dist-1' as AssetDistributionId,
        pendingResults: [pending],
      };

      const r1 = expectOk(handleApplyNpcDungeonSettlement(cmd, refreshed, makeContext()), 'settle#1');
      const applied1 = findEvent(eventsOf(r1.outgoingMessages), 'NpcDungeonSettlementApplied');
      assert(applied1 !== undefined, '應 emit NpcDungeonSettlementApplied');
      assert(applied1!.appliedResults.length === 1, '第一次應套用 1 筆');
      assert(applied1!.skippedResults.length === 0, '第一次不應有 skipped');
      assert(
        r1.nextSlice.contents[content.contentId]!.state === 'resolved',
        '內容應被標記 resolved',
      );

      // 重送同一結果：內容已 resolved → 全部 skipped（只套用一次）。
      const r2 = expectOk(handleApplyNpcDungeonSettlement(cmd, r1.nextSlice, makeContext()), 'settle#2');
      const applied2 = findEvent(eventsOf(r2.outgoingMessages), 'NpcDungeonSettlementApplied');
      assert(applied2!.appliedResults.length === 0, '重送不應再套用');
      assert(applied2!.skippedResults.length === 1, '重送應全部進 skipped');
    },
  },
  {
    name: '#3：內容 revision 已變（委託保護 bump）→ 舊 NPC 結果進 skipped，不清掉受保護內容',
    run: () => {
      const refreshed = handleMapRefreshCheck(regularJob(100), fixtureMapState(1), makeContext()).nextSlice;
      const query = createMapQuery(refreshed, stubDefinitionReader());
      const contentView = query.listAvailableContent(MAP_ID)[0]!;
      const full = refreshed.contents[contentView.contentId]!;
      // NPC 結果以「產生當下」的 revision 記錄目標。
      const pending: PendingDungeonResult = {
        target: { kind: 'mapContent', contentId: full.contentId, contentRevision: full.revision },
        npcOrder: full.npcOrder ?? 1,
        attemptedOnDay: 100 as WorldDay,
        outcome: 'success',
        resolverId: full.npcResolverId!,
        pendingRewardRefs: [],
      };
      const cmd: ApplyNpcDungeonSettlement = {
        type: 'ApplyNpcDungeonSettlement',
        runId: 'run-1' as NpcDungeonRunId,
        mapId: MAP_ID,
        mapVersion: 2,
        distributionId: 'dist-1' as AssetDistributionId,
        pendingResults: [pending],
      };
      // 模擬 NPC 結果產生後、結算前，內容被委託保護 → content revision 前進。
      const protectedState = {
        ...refreshed,
        contents: {
          ...refreshed.contents,
          [full.contentId]: { ...full, revision: (full.revision + 1) as typeof full.revision, protectedByQuestIds: ['runtime:quest:q1' as never] },
        },
      };
      const r = expectOk(handleApplyNpcDungeonSettlement(cmd, protectedState, makeContext()), 'settle-stale');
      const applied = findEvent(eventsOf(r.outgoingMessages), 'NpcDungeonSettlementApplied');
      assert(applied!.appliedResults.length === 0, 'revision 已變 → 舊結果不得套用');
      assert(applied!.skippedResults.length === 1, '應進 skipped');
      assert(
        r.nextSlice.contents[full.contentId]!.state === 'available',
        '受保護內容應維持 available（不被舊 NPC 結果清掉）',
      );
    },
  },
  {
    name: 'Pending: 有隊伍在圖內不當日刷新、次日無人才刷新',
    run: () => {
      const state = fixtureMapState(1);
      const occupied = makeContext({ worldDay: 100 as WorldDay, presence: stubPresence({ teamsInside: 1 }) });

      // 固定刷新日有人 → 登記 Pending，不刷新，排次日檢查。
      const r1 = handleMapRefreshCheck(regularJob(100), state, occupied);
      assert(r1.nextSlice.instances[MAP_ID]!.currentVersion === 1, '有人時不應刷新');
      const reg = findEvent(eventsOf(r1.outgoingMessages), 'MapRefreshPendingRegistered');
      assert(reg !== undefined && reg.checkDay === 101, '應登記次日（101）Pending 檢查');
      assert(r1.scheduledJobs.length === 1, '應排一個 pending 檢查 Job');
      assert(r1.nextSlice.instances[MAP_ID]!.refresh.pendingSinceDay === 100, 'pendingSinceDay 應為 100');

      // 次日仍有人 → 保留 Pending，仍不刷新，並把檢查順延到 102（同時排出 102 的新 Job）。
      const stillOccupied = makeContext({ worldDay: 101 as WorldDay, presence: stubPresence({ teamsInside: 1 }) });
      const r2 = handleMapRefreshCheck(pendingJob(101), r1.nextSlice, stillOccupied);
      assert(r2.nextSlice.instances[MAP_ID]!.currentVersion === 1, '仍有人時不應刷新');
      assert(
        r2.nextSlice.instances[MAP_ID]!.refresh.pendingCheckScheduledFor === 102,
        '仍有人時應把 Pending 檢查順延到 102',
      );

      // 再次日無人 → 由順延出來的那筆 102 Job 刷新（101 那筆已被取代，不會再跑）。
      const empty = makeContext({ worldDay: 102 as WorldDay, presence: stubPresence({ teamsInside: 0 }) });
      const r3 = handleMapRefreshCheck(pendingJob(102), r2.nextSlice, empty);
      assert(r3.nextSlice.instances[MAP_ID]!.currentVersion === 2, '無人時應刷新到版本 2');
      assert(hasEvent(eventsOf(r3.outgoingMessages), 'MapRefreshed'), '應 emit MapRefreshed');
    },
  },
  {
    // R10 #6：GDD §183——鎖期間「跳過刷新日**且不建立 Pending**」。架構書原本寫成「保留 Pending
    // 並重排」，與 GDD 相反；實作會殘留一個永遠不會被重排的 marker。
    name: 'RefreshLock: 設鎖時清除既有 Pending 登記（GDD §183：鎖期間不建立 Pending）',
    run: () => {
      // 先製造一筆 Pending：固定刷新日有人在圖內。
      const occupied = makeContext({ worldDay: 100 as WorldDay, presence: stubPresence({ teamsInside: 1 }) });
      const pending = handleMapRefreshCheck(regularJob(100), fixtureMapState(1), occupied);
      assert(pending.nextSlice.instances[MAP_ID]!.refresh.pendingSinceDay === 100, '前提：應已登記 Pending');

      const locked = expectOk(
        handleSetMapRefreshLock(
          {
            type: 'SetMapRefreshLock',
            mapId: MAP_ID,
            mode: 'set',
            reason: 'suppression',
            releaseOnDay: 141 as WorldDay,
            sourceQuestId: QUEST_ID,
          },
          pending.nextSlice,
          occupied,
        ),
        'set-lock-over-pending',
      );
      const refresh = locked.nextSlice.instances[MAP_ID]!.refresh;
      assert(refresh.pendingSinceDay === undefined, '設鎖應清除 pendingSinceDay');
      assert(refresh.pendingCheckScheduledFor === undefined, '設鎖應清除 pendingCheckScheduledFor');
    },
  },
  {
    // R11 #4：原本任何 Quest 都能解掉別人下的鎖，等於一張無關委託就能讓鎮壓／討伐目標地圖提前恢復刷新。
    name: 'RefreshLock: 只有下鎖的那張委託能解鎖',
    run: () => {
      const ctx = makeContext();
      const setCmd: SetMapRefreshLock = {
        type: 'SetMapRefreshLock',
        mapId: MAP_ID,
        mode: 'set',
        reason: 'suppression',
        releaseOnDay: 141 as WorldDay,
        sourceQuestId: QUEST_ID,
      };
      const locked = expectOk(handleSetMapRefreshLock(setCmd, fixtureMapState(1), ctx), 'set-lock').nextSlice;

      // 別張委託想解 → 拒絕，鎖必須還在。
      const other = handleSetMapRefreshLock(
        { type: 'SetMapRefreshLock', mapId: MAP_ID, mode: 'release', sourceQuestId: 'quest-other' as QuestId },
        locked,
        ctx,
      );
      assert(!other.ok, '別張委託不得解鎖');
      assert(
        other.ok || other.rejection.code === 'map/refresh-lock-not-owned',
        `拒絕碼應為 map/refresh-lock-not-owned（實得 ${other.ok ? '-' : other.rejection.code}）`,
      );
      assert(locked.instances[MAP_ID]!.refresh.refreshLock !== undefined, '鎖必須仍在');

      // 下鎖的委託解 → 成功。
      const released = expectOk(
        handleSetMapRefreshLock(
          { type: 'SetMapRefreshLock', mapId: MAP_ID, mode: 'release', sourceQuestId: QUEST_ID },
          locked,
          ctx,
        ),
        'release-by-owner',
      );
      assert(released.nextSlice.instances[MAP_ID]!.refresh.refreshLock === undefined, '下鎖者應能解鎖');
    },
  },
  {
    // R12 #2：R11 #4 只擋了 release。別張委託直接用 set 覆蓋一樣會奪走所有權，而且覆蓋後原委託連
    // 自己下的鎖都解不掉（sourceQuestId 已被換掉），等於繞過 R11 #4。
    name: 'RefreshLock: 別張委託不得用 set 覆蓋現有鎖；原委託可重設',
    run: () => {
      const ctx = makeContext();
      const setBy = (questId: QuestId): SetMapRefreshLock => ({
        type: 'SetMapRefreshLock',
        mapId: MAP_ID,
        mode: 'set',
        reason: 'suppression',
        releaseOnDay: 141 as WorldDay,
        sourceQuestId: questId,
      });
      const locked = expectOk(handleSetMapRefreshLock(setBy(QUEST_ID), fixtureMapState(1), ctx), 'set-lock').nextSlice;

      const hijack = handleSetMapRefreshLock(setBy('quest-other' as QuestId), locked, ctx);
      assert(!hijack.ok, '別張委託不得覆蓋現有鎖');
      assert(
        hijack.ok || hijack.rejection.code === 'map/refresh-lock-not-owned',
        `拒絕碼應為 map/refresh-lock-not-owned（實得 ${hijack.ok ? '-' : hijack.rejection.code}）`,
      );
      assert(
        locked.instances[MAP_ID]!.refresh.refreshLock?.sourceQuestId === QUEST_ID,
        '鎖的所有權必須仍屬原委託',
      );

      // 同一張委託重設（延長期限）仍應允許。
      const extended = expectOk(
        handleSetMapRefreshLock({ ...setBy(QUEST_ID), releaseOnDay: 200 as WorldDay }, locked, ctx),
        'owner re-set',
      );
      assert(
        extended.nextSlice.instances[MAP_ID]!.refresh.refreshLock?.releaseOnDay === 200,
        '原委託應可重設自己的鎖',
      );
    },
  },
  {
    // R13 #2：刷新流程與 isRefreshLocked 都以 releaseOnDay <= worldDay 判定失效，set 卻只看鎖存不存在，
    // 於是舊委託的殘留鎖會永遠擋住新委託。
    name: 'RefreshLock: 已到期的舊鎖不得擋住新委託下鎖',
    run: () => {
      const setBy = (questId: QuestId, releaseOnDay: number): SetMapRefreshLock => ({
        type: 'SetMapRefreshLock',
        mapId: MAP_ID,
        mode: 'set',
        reason: 'suppression',
        releaseOnDay: releaseOnDay as WorldDay,
        sourceQuestId: questId,
      });
      // 舊委託在第 100 天下鎖，第 141 天到期。
      const locked = expectOk(
        handleSetMapRefreshLock(setBy(QUEST_ID, 141), fixtureMapState(1), makeContext({ worldDay: 100 as WorldDay })),
        'old lock',
      ).nextSlice;

      // 第 141 天已到期（releaseOnDay <= worldDay）→ 新委託應可下鎖。
      const renewed = expectOk(
        handleSetMapRefreshLock(setBy('quest-new' as QuestId, 182), locked, makeContext({ worldDay: 141 as WorldDay })),
        'new quest sets over an expired lock',
      );
      assert(
        renewed.nextSlice.instances[MAP_ID]!.refresh.refreshLock?.sourceQuestId === 'quest-new',
        '到期鎖應可被新委託取代',
      );

      // 對照：尚未到期時仍必須擋下。
      const tooEarly = handleSetMapRefreshLock(
        setBy('quest-new' as QuestId, 182), locked, makeContext({ worldDay: 140 as WorldDay }),
      );
      assert(!tooEarly.ok, '未到期的鎖仍不得被別張委託覆蓋');
    },
  },
  {
    name: 'RefreshLock: 沒有鎖時解鎖被拒（不靜默成功）',
    run: () => {
      const r = handleSetMapRefreshLock(
        { type: 'SetMapRefreshLock', mapId: MAP_ID, mode: 'release', sourceQuestId: QUEST_ID },
        fixtureMapState(1),
        makeContext(),
      );
      assert(!r.ok && r.rejection.code === 'map/no-refresh-lock', '無鎖可解應拒絕');
    },
  },
  {
    name: 'RefreshLock: 鎖定跨過固定刷新日不刷新；isRefreshLocked 依日判定',
    run: () => {
      const state = fixtureMapState(1);
      const lockCmd: SetMapRefreshLock = {
        type: 'SetMapRefreshLock',
        mapId: MAP_ID,
        mode: 'set',
        reason: 'suppression',
        releaseOnDay: 200 as WorldDay,
        sourceQuestId: QUEST_ID,
      };
      const setRes = expectOk(handleSetMapRefreshLock(lockCmd, state, makeContext()), 'set-lock');
      const locked = setRes.nextSlice;
      const lockEvent = findEvent(eventsOf(setRes.outgoingMessages), 'MapRefreshLockChanged');
      assert(lockEvent !== undefined && lockEvent.lock !== undefined, '應 emit 帶 lock 的 MapRefreshLockChanged');

      // 鎖定中（day 100 < releaseOnDay 200）：固定刷新日跳過，不刷新、不排 Job。
      const r = handleMapRefreshCheck(regularJob(100), locked, makeContext({ worldDay: 100 as WorldDay }));
      assert(r.nextSlice.instances[MAP_ID]!.currentVersion === 1, '鎖定中不應刷新');
      assert(!hasEvent(eventsOf(r.outgoingMessages), 'MapRefreshed'), '鎖定中不應 emit MapRefreshed');
      assert(r.scheduledJobs.length === 0, '鎖定中固定日曆不位移，不排 Job');

      const query = createMapQuery(locked, stubDefinitionReader());
      assert(query.isRefreshLocked(MAP_ID, 100 as WorldDay), 'day 100 應為鎖定中');
      assert(!query.isRefreshLocked(MAP_ID, 200 as WorldDay), 'releaseOnDay 當日應解除（>onDay 為 false）');
    },
  },

  // ── 【裁定 B／C】NPC 序列與 Map Content 定義的資料化 ────────────────────────
  {
    name: '裁定 C：npcPointCost／npcResolverId 取自 MapContentDefinition.npcPolicy（換定義就換值）',
    run: () => {
      const definitions = stubDefinitionReader({
        contentDefinitions: {
          ...CONTENT_DEFINITIONS,
          [MONSTER_CONTENT_DEF_ID]: {
            ...CONTENT_DEFINITIONS[MONSTER_CONTENT_DEF_ID]!,
            npcPolicy: { eligible: true, pointCost: 7, resolverId: ALT_RESOLVER_ID },
          },
        },
      });
      const res = handleMapRefreshCheck(
        regularJob(100),
        fixtureMapState(1),
        makeContext({ definitions, presence: stubPresence({ teamsInside: 0 }) }),
      );
      const entry = createMapQuery(res.nextSlice, definitions)
        .listNpcSequence(MAP_ID)
        .find((e) => e.kind === 'mapContent');
      assert(entry !== undefined, '應有一筆 mapContent 序列項');
      assert(entry!.pointCost === 7, `pointCost 應來自 Definition（7），實得 ${entry!.pointCost}`);
      assert(
        entry!.resolverId === ALT_RESOLVER_ID,
        'resolverId 應來自 Definition，而不是 SpawnDraft／程式常數',
      );
    },
  },
  {
    name: '裁定 C：npcPolicy.eligible=false 的內容仍生成，但不進 NPC 序列',
    run: () => {
      const definitions = stubDefinitionReader({
        contentDefinitions: {
          ...CONTENT_DEFINITIONS,
          [MONSTER_CONTENT_DEF_ID]: {
            ...CONTENT_DEFINITIONS[MONSTER_CONTENT_DEF_ID]!,
            npcPolicy: { eligible: false },
          },
        },
      });
      const res = handleMapRefreshCheck(
        regularJob(100),
        fixtureMapState(1),
        makeContext({ definitions, presence: stubPresence({ teamsInside: 0 }) }),
      );
      const query = createMapQuery(res.nextSlice, definitions);
      assert(query.listAvailableContent(MAP_ID).length === 1, '內容本身仍應生成');
      const seq = query.listNpcSequence(MAP_ID);
      assert(seq.length === 1, `不可處理的內容不得進序列（應只剩採集點 1 筆，實得 ${seq.length}）`);
      assert(seq[0]!.kind === 'gatheringNode', '剩下的那筆應為採集點');
      assert(seq[0]!.npcOrder === 1, '序列重新編號後應自 1 起');
    },
  },
  {
    name: '裁定 B：npcOrder 順序由 NpcSequenceRule.groupPriority 決定（換資料就換順序）',
    run: () => {
      const run = (rule: NpcSequenceRuleDefinition) => {
        const definitions = stubDefinitionReader({ npcSequenceRule: rule });
        const res = handleMapRefreshCheck(
          regularJob(100),
          fixtureMapState(1),
          makeContext({ definitions, presence: stubPresence({ teamsInside: 0 }) }),
        );
        return createMapQuery(res.nextSlice, definitions).listNpcSequence(MAP_ID);
      };

      const contentFirst = run(stubNpcSequenceRule());
      assert(contentFirst.length === 2, `序列應有 2 筆，實得 ${contentFirst.length}`);
      assert(contentFirst[0]!.kind === 'mapContent', '預設權重：動態內容在前');
      assert(contentFirst[1]!.kind === 'gatheringNode', '預設權重：採集點在後');

      // 只換資料：把採集點的權重調到所有內容家族之前。
      const nodeFirst = run(
        stubNpcSequenceRule({ ...DEFAULT_GROUP_PRIORITY, gatheringNode: 0 }),
      );
      assert(
        nodeFirst[0]!.kind === 'gatheringNode' && nodeFirst[0]!.npcOrder === 1,
        '採集點權重最小時應排第一（順序必須跟著資料走，不能是程式特例）',
      );
      assert(
        nodeFirst[1]!.kind === 'mapContent' && nodeFirst[1]!.npcOrder === 2,
        '動態內容應退到第二',
      );
    },
  },
  {
    name: '不變量：npcOrder 自 1 起、步進 1、跨動態內容與採集點全域唯一',
    run: () => {
      const definitions = stubDefinitionReader();
      const res = handleMapRefreshCheck(
        regularJob(100),
        fixtureMapState(1),
        makeContext({ definitions, presence: stubPresence({ teamsInside: 0 }) }),
      );
      const orders = createMapQuery(res.nextSlice, definitions)
        .listNpcSequence(MAP_ID)
        .map((e) => e.npcOrder);
      assert(new Set(orders).size === orders.length, 'npcOrder 不可重複（doc §3.3 不變量 4）');
      orders.forEach((o, i) => assert(o === i + 1, `npcOrder 應為 1..n 連續，第 ${i} 筆實得 ${o}`));
    },
  },
  {
    name: '拒絕：Spawn budget 要求的 kind 與 Definition 的 contentKind 不符 → 明確失敗，不寫入內容',
    run: () => {
      // Resolver 對 monsterGroup 的請求挑了一筆 chest 定義。
      const ctx = makeContext({
        presence: stubPresence({ teamsInside: 0 }),
        resolvers: stubContentResolver({
          monsterGroup: { definitionId: CHEST_CONTENT_DEF_ID, payload: { kind: 'chest', itemIds: [] } },
        }),
      });
      expectThrow(
        () => handleMapRefreshCheck(regularJob(100), fixtureMapState(1), ctx),
        'budget-kind-mismatch',
      );
    },
  },
  {
    name: '拒絕：payload.kind 與 Definition 的 contentKind 不符（doc §3.3 不變量 8）→ 明確失敗',
    run: () => {
      const ctx = makeContext({
        presence: stubPresence({ teamsInside: 0 }),
        resolvers: stubContentResolver({
          // 定義是 monsterGroup，payload 卻是 chest。
          monsterGroup: { definitionId: MONSTER_CONTENT_DEF_ID, payload: { kind: 'chest', itemIds: [] } },
        }),
      });
      expectThrow(
        () => handleMapRefreshCheck(regularJob(100), fixtureMapState(1), ctx),
        'payload-kind-mismatch',
      );
    },
  },
  {
    name: '拒絕：groupPriority 缺該目標家族 → 明確失敗（不得以預設值補、不得讓排序變 NaN）',
    run: () => {
      // 模擬壞內容：JSON 少了 gatheringNode 那一格。型別上是非 Partial Record，所以只能在測試裡
      // 以 Partial 建構再交給 stub——這正是外部資料可能長成的樣子。
      const brokenPriority = { ...DEFAULT_GROUP_PRIORITY } as Record<string, number>;
      delete brokenPriority['gatheringNode'];
      const definitions = stubDefinitionReader({
        npcSequenceRule: stubNpcSequenceRule(
          brokenPriority as NpcSequenceRuleDefinition['groupPriority'],
        ),
      });
      expectThrow(
        () =>
          handleMapRefreshCheck(
            regularJob(100),
            fixtureMapState(1),
            makeContext({ definitions, presence: stubPresence({ teamsInside: 0 }) }),
          ),
        'missing-group-priority',
      );
    },
  },
  {
    name: '不變量 4 迴歸：受委託保護而跨版本留存的內容不得帶著舊 npcOrder 留在序列裡',
    run: () => {
      const definitions = stubDefinitionReader();
      const first = handleMapRefreshCheck(
        regularJob(100),
        fixtureMapState(1),
        makeContext({ definitions, presence: stubPresence({ teamsInside: 0 }) }),
      );
      const generated = Object.values(first.nextSlice.contents).find((c) => c.state === 'available');
      assert(
        generated !== undefined && generated.npcOrder !== undefined,
        '前置條件：第一次刷新應產生一筆已進入 NPC 序列的內容',
      );

      // 委託保護該內容：一般刷新不得移除它（doc §3.3 不變量 7），於是它會**跨版本**留在圖上。
      const protectedState = {
        ...first.nextSlice,
        contents: {
          ...first.nextSlice.contents,
          [generated!.contentId]: { ...generated!, protectedByQuestIds: [QUEST_ID] },
        },
      };

      const second = handleMapRefreshCheck(
        regularJob(114),
        protectedState,
        makeContext({
          definitions,
          worldDay: 114 as WorldDay,
          presence: stubPresence({ teamsInside: 0 }),
          // 新版本的內容必須拿到新 ID，否則 upsert 會直接蓋掉受保護的那一筆，測不到共存。
          ids: makeIdAllocator('gen2'),
        }),
      );
      const query = createMapQuery(second.nextSlice, definitions);
      assert(
        query.getContent(generated!.contentId)?.state === 'available',
        '受保護內容應仍留在圖上（不變量 7）',
      );
      const seq = query.listNpcSequence(MAP_ID);
      const orders = seq.map((e) => e.npcOrder);
      assert(
        new Set(orders).size === orders.length,
        `同一張圖的 npcOrder 不得重複（doc §3.3 不變量 4），實得 ${JSON.stringify(orders)}`,
      );
      assert(
        !seq.some((e) => e.kind === 'mapContent' && e.contentId === generated!.contentId),
        '舊版本內容在 ApplyNpcDungeonSettlement 必被 skip（mapVersion 不符），不得占用 NPC 序列名額',
      );
    },
  },
  {
    name: '決定性：同一輸入兩次刷新產生完全相同的 NPC 序列',
    run: () => {
      const seqOf = () => {
        const definitions = stubDefinitionReader();
        const res = handleMapRefreshCheck(
          regularJob(100),
          fixtureMapState(1),
          makeContext({ definitions, presence: stubPresence({ teamsInside: 0 }) }),
        );
        return createMapQuery(res.nextSlice, definitions)
          .listNpcSequence(MAP_ID)
          .map((e) => `${e.kind}:${e.npcOrder}:${e.pointCost}:${String(e.resolverId)}`)
          .join('|');
      };
      assert(seqOf() === seqOf(), 'NPC 序列必須是決定性的（同輸入同輸出）');
    },
  },
];

export type MapTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

// 執行全部案例並回傳結果（供 harness 收集）。
export function runTestsVerbose(): readonly MapTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return { name: c.name, passed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

// 任一失敗即 throw（含所有失敗案例名稱）。
export function runTests(): void {
  const results = runTestsVerbose();
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const detail = failed.map((f) => `  - ${f.name}: ${f.error ?? 'failed'}`).join('\n');
    throw new Error(`map module: ${failed.length}/${results.length} tests failed\n${detail}`);
  }
}
