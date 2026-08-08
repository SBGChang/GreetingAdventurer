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
  TransactionMessageDraft,
} from '../../contracts/core';
import type {
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

function hasEvent(events: readonly MapDomainEvent[], kind: MapDomainEvent['kind']): boolean {
  return events.some((e) => e.kind === kind);
}

function findEvent<K extends MapDomainEvent['kind']>(
  events: readonly MapDomainEvent[],
  kind: K,
): Extract<MapDomainEvent, { kind: K }> | undefined {
  return events.find((e) => e.kind === kind) as Extract<MapDomainEvent, { kind: K }> | undefined;
}

function expectOk(r: MapHandlerResult, label: string) {
  if (!r.ok) throw new Error(`${label}: expected accept, got reject ${r.rejection.code}`);
  return r.result;
}

function expectReject(r: MapHandlerResult, code: string, label: string) {
  if (r.ok) throw new Error(`${label}: expected reject '${code}', got accept`);
  assert(r.rejection.code === code, `${label}: expected code '${code}', got '${r.rejection.code}'`);
}

const TEAM_ID = 'team-1' as TeamId;
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
        kind: 'OpenMapDoor',
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
        kind: 'ResolveMapTrap',
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
        kind: 'HarvestMapGatheringNode',
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
        resolverId: content.npcResolverId as ResolverId,
        pendingRewardRefs: [],
      };
      const cmd: ApplyNpcDungeonSettlement = {
        kind: 'ApplyNpcDungeonSettlement',
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

      // 次日仍有人 → 保留 Pending，仍不刷新。
      const stillOccupied = makeContext({ worldDay: 101 as WorldDay, presence: stubPresence({ teamsInside: 1 }) });
      const r2 = handleMapRefreshCheck(pendingJob(101), r1.nextSlice, stillOccupied);
      assert(r2.nextSlice.instances[MAP_ID]!.currentVersion === 1, '仍有人時不應刷新');

      // 次日無人 → 刷新。
      const empty = makeContext({ worldDay: 101 as WorldDay, presence: stubPresence({ teamsInside: 0 }) });
      const r3 = handleMapRefreshCheck(pendingJob(101), r2.nextSlice, empty);
      assert(r3.nextSlice.instances[MAP_ID]!.currentVersion === 2, '無人時應刷新到版本 2');
      assert(hasEvent(eventsOf(r3.outgoingMessages), 'MapRefreshed'), '應 emit MapRefreshed');
    },
  },
  {
    name: 'RefreshLock: 鎖定跨過固定刷新日不刷新；isRefreshLocked 依日判定',
    run: () => {
      const state = fixtureMapState(1);
      const lockCmd: SetMapRefreshLock = {
        kind: 'SetMapRefreshLock',
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
