// modules/dungeon/dungeon.test.ts
// 自足式單元測試（無外部框架、無 node/DOM 全域）。runTests() 於任一案例失敗時 throw；
// runTestResults() 回傳逐案 pass/fail 供 harness。
//
// 覆蓋 doc §9 最低驗收的核心行為：
//   - 玩家跨房間移動：實際小格距離 × 30 分鐘累加（§9.1）。
//   - 玩家跨午夜：固定分鐘片段並送出一次推進世界日請求（§9.2）。
//   - 玩家採集：ConsumeDungeonGatheringAction 依資料增加分鐘（§9.16）。
//   - NPC Run：npcDungeonDay 依序列推進游標並在全清後進入 settling，三方結算後關閉（§9.3、§9.14、§9.22）。

import type { AssetDistributionId, NpcDungeonRunId } from '../../contracts/core';
import type { MoveDungeonRoom, ConsumeDungeonGatheringAction, StartNpcDungeonRun } from '../../contracts/dungeon';

import { createInitialDungeonState } from './state';
import {
  moveDungeonRoom,
  consumeDungeonGatheringAction,
  startNpcDungeonRun,
  npcDungeonDay,
  handleNpcDungeonSettlementApplied,
  handleAssetDistributionCompleted,
} from './system';
import { createFixtureState, createFixtureContext, FIXTURE } from './fixtures';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// 取出外送訊息中的 event.kind 清單。
function eventKinds(messages: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    const ev = (m as { event?: { kind?: string } }).event;
    if (ev && typeof ev.kind === 'string') out.push(ev.kind);
  }
  return out;
}

// 取出外送訊息中的 internal command.kind 清單。
function internalKinds(messages: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    const cmd = (m as { targetModule?: unknown; command?: { kind?: string } });
    if (cmd.targetModule !== undefined && cmd.command && typeof cmd.command.kind === 'string') {
      out.push(cmd.command.kind);
    }
  }
  return out;
}

type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: 'moveDungeonRoom accrues cells × 30 minutes and reveals the entered room',
    run: () => {
      const ctx = createFixtureContext();
      const s0 = createFixtureState();
      const cmd: MoveDungeonRoom = { kind: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle };
      const r = moveDungeonRoom(s0, FIXTURE.teamId, cmd, ctx);
      const session = r.nextSlice.playerSessions[FIXTURE.teamId];
      assert(session !== undefined, 'session exists');
      // R1→R2 = 2 cells × 30 = 60 分鐘。
      assert(session!.elapsedDungeonMinutes === 60, `elapsed 60 (got ${session!.elapsedDungeonMinutes})`);
      assert(session!.currentRoomId === FIXTURE.roomMiddle, 'moved into R2');
      const kinds = eventKinds(r.outgoingMessages);
      assert(kinds.includes('PlayerDungeonTimeAdvanced'), 'emits PlayerDungeonTimeAdvanced');
      // 60 < 100（迷宮日長）→ 未跨午夜。
      assert(!internalKinds(r.outgoingMessages).includes('AdvanceWorldToDay'), 'no world advance yet');
      // R2 揭露。
      const knowledge = Object.values(r.nextSlice.playerMapKnowledge)[0];
      assert(knowledge?.revealedRoomIds.includes(FIXTURE.roomMiddle) === true, 'R2 revealed');
    },
  },
  {
    name: 'second move crosses midnight and requests exactly one world-day advance',
    run: () => {
      const ctx = createFixtureContext();
      const s0 = createFixtureState();
      // 第一步 R1→R2（elapsed 60）。
      const r1 = moveDungeonRoom(
        s0,
        FIXTURE.teamId,
        { kind: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle },
        ctx,
      );
      // 第二步 R2→R3（+60 → 120 跨越 100 邊界）。
      const r2 = moveDungeonRoom(
        r1.nextSlice,
        FIXTURE.teamId,
        { kind: 'moveDungeonRoom', targetRoomId: FIXTURE.roomExit },
        ctx,
      );
      const session = r2.nextSlice.playerSessions[FIXTURE.teamId];
      assert(session!.elapsedDungeonMinutes === 120, `elapsed 120 (got ${session!.elapsedDungeonMinutes})`);
      const advances = internalKinds(r2.outgoingMessages).filter((k) => k === 'AdvanceWorldToDay');
      assert(advances.length === 1, `exactly one world advance (got ${advances.length})`);
      // 事件標記跨午夜。
      const timeEvent = r2.outgoingMessages
        .map((m) => (m as { event?: { kind?: string; worldDayCrossed?: boolean } }).event)
        .find((e) => e?.kind === 'PlayerDungeonTimeAdvanced');
      assert(timeEvent?.worldDayCrossed === true, 'worldDayCrossed=true');
    },
  },
  {
    name: 'ConsumeDungeonGatheringAction adds data-defined interaction minutes',
    run: () => {
      const ctx = createFixtureContext();
      const s0 = createFixtureState();
      const cmd: ConsumeDungeonGatheringAction = {
        kind: 'ConsumeDungeonGatheringAction',
        teamId: FIXTURE.teamId,
        mapId: FIXTURE.mapId,
        mapVersion: FIXTURE.mapVersion,
        nodeId: FIXTURE.gatherNodePlayer,
      };
      const r = consumeDungeonGatheringAction(s0, cmd, ctx);
      const session = r.nextSlice.playerSessions[FIXTURE.teamId];
      // 玩家採集規則 = 15 分鐘。
      assert(session!.elapsedDungeonMinutes === 15, `elapsed 15 (got ${session!.elapsedDungeonMinutes})`);
      assert(eventKinds(r.outgoingMessages).includes('PlayerDungeonTimeAdvanced'), 'emits time advanced');
    },
  },
  {
    name: 'ConsumeDungeonGatheringAction rejects (no-op) on Map Version mismatch',
    run: () => {
      const ctx = createFixtureContext();
      const s0 = createFixtureState();
      const cmd: ConsumeDungeonGatheringAction = {
        kind: 'ConsumeDungeonGatheringAction',
        teamId: FIXTURE.teamId,
        mapId: FIXTURE.mapId,
        mapVersion: FIXTURE.mapVersion + 5, // 版本不符。
        nodeId: FIXTURE.gatherNodePlayer,
      };
      const r = consumeDungeonGatheringAction(s0, cmd, ctx);
      assert(r.nextSlice === s0, 'state unchanged on mismatch');
      assert(r.outgoingMessages.length === 0, 'no messages on mismatch');
    },
  },
  {
    name: 'npcDungeonDay processes full sequence within 10 points and enters settling',
    run: () => {
      const ctx = createFixtureContext();
      const start = startNpcDungeonRun(
        createInitialDungeonState(),
        { kind: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
        ctx,
        FIXTURE.npcExplorationRuleId,
      );
      // Start 應排一個 npcDungeonDay Job 並開一個 collecting Distribution。
      assert(start.scheduledJobs.length === 1, 'one npcDungeonDay job scheduled');
      assert(internalKinds(start.outgoingMessages).includes('StartAssetDistribution'), 'starts distribution');

      const runId = Object.keys(start.nextSlice.npcRuns)[0] as NpcDungeonRunId;
      const runBefore = start.nextSlice.npcRuns[runId]!;
      // 無怪物序列 → combatSequenceSettled 從開始即 true（不變量 §3.4.9）。
      assert(runBefore.settlementProgress.combatSequenceSettled === true, 'combat settled from start (no monsters)');

      const day = npcDungeonDay(start.nextSlice, runId, ctx);
      const run = day.nextSlice.npcRuns[runId]!;
      // 3+3+4 = 10 點，全序列同日處理 → cursor 前進到 3、進入 settling。
      assert(run.cursorNpcOrder === 3, `cursor advanced to 3 (got ${run.cursorNpcOrder})`);
      assert(run.pendingResults.length === 3, `3 pending results (got ${run.pendingResults.length})`);
      assert(run.status === 'settling', `status settling (got ${run.status})`);
      const kinds = eventKinds(day.outgoingMessages);
      assert(kinds.includes('NpcDungeonRunProgressed'), 'emits NpcDungeonRunProgressed');
      assert(internalKinds(day.outgoingMessages).includes('ApplyNpcDungeonSettlement'), 'requests map settlement');
    },
  },
  {
    name: 'npc run closes only after Map + Distribution settlement complete',
    run: () => {
      const ctx = createFixtureContext();
      const start = startNpcDungeonRun(
        createInitialDungeonState(),
        { kind: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
        ctx,
        FIXTURE.npcExplorationRuleId,
      );
      const runId = Object.keys(start.nextSlice.npcRuns)[0] as NpcDungeonRunId;
      const distributionId = start.nextSlice.npcRuns[runId]!.distributionId as AssetDistributionId;

      const day = npcDungeonDay(start.nextSlice, runId, ctx);
      assert(day.nextSlice.npcRuns[runId]!.status === 'settling', 'settling after day');

      // Map 套用結算 → mapApplied，但仍未關閉（distribution 未完成）。
      const applied = handleNpcDungeonSettlementApplied(day.nextSlice, { runId, distributionId });
      const afterMap = applied.nextSlice.npcRuns[runId]!;
      assert(afterMap.settlementProgress.mapApplied === true, 'mapApplied true');
      assert(afterMap.status === 'settling', 'still settling (distribution pending)');

      // Distribution 完成 → 三項齊備 → 關閉 Run。
      const done = handleAssetDistributionCompleted(applied.nextSlice, distributionId, ctx);
      const closed = done.nextSlice.npcRuns[runId]!;
      assert(closed.status === 'closed', `run closed (got ${closed.status})`);
      assert(eventKinds(done.outgoingMessages).includes('NpcDungeonRunClosed'), 'emits NpcDungeonRunClosed');
    },
  },
  {
    name: 'npc run fails safely (invalid) when team left the map',
    run: () => {
      const ctx = createFixtureContext({
        team: { ...createFixtureContext().team, isTeamInMap: () => false },
      });
      const start = startNpcDungeonRun(
        createInitialDungeonState(),
        { kind: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
        ctx,
        FIXTURE.npcExplorationRuleId,
      );
      const runId = Object.keys(start.nextSlice.npcRuns)[0] as NpcDungeonRunId;
      const day = npcDungeonDay(start.nextSlice, runId, ctx);
      const run = day.nextSlice.npcRuns[runId]!;
      assert(run.status === 'invalid', `status invalid (got ${run.status})`);
      const closed = day.outgoingMessages
        .map((m) => (m as { event?: { kind?: string; reason?: string } }).event)
        .find((e) => e?.kind === 'NpcDungeonRunClosed');
      assert(closed?.reason === 'invalid', 'closed with reason invalid');
    },
  },
];

export type DungeonTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestResults(): readonly DungeonTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { name: c.name, passed: false, error: message };
    }
  });
}

// 於任一案例失敗時 throw（供 CI/harness 直接使用）。
export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? 'unknown'}`).join('\n');
    throw new Error(`dungeon tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}

export function allTestsPass(): boolean {
  return runTestResults().every((r) => r.passed);
}
