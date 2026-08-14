// modules/dungeon/dungeon.test.ts
// 自足式單元測試（無外部框架、無 node/DOM 全域）。runTests() 於任一案例失敗時 throw；
// runTestResults() 回傳逐案 pass/fail 供 harness。
//
// 覆蓋 doc §9 最低驗收的核心行為：
//   - 玩家跨房間移動：實際小格距離 × 30 分鐘累加（§9.1）。
//   - 玩家跨午夜：固定分鐘片段並送出一次推進世界日請求（§9.2）。
//   - 玩家採集：ConsumeDungeonGatheringAction 依資料增加分鐘（§9.16）。
//   - NPC Run：npcDungeonDay 依序列推進游標並在全清後進入 settling，三方結算後關閉（§9.3、§9.14、§9.22）。

import type {
  AssetDistributionId,
  ContentEventOptionId,
  InteractionId,
  ModuleResult,
  NpcDungeonRunId,
} from '../../contracts/core';
import type {
  MoveDungeonRoom,
  ConsumeDungeonGatheringAction,
  StartNpcDungeonRun,
  InteractDungeonContent,
  ResolveDungeonInteraction,
} from '../../contracts/dungeon';

import type { DungeonModuleState } from './state';
import { createInitialDungeonState, getPlayerSession } from './state';
import {
  moveDungeonRoom,
  interactDungeonContent,
  resolveDungeonInteraction,
  consumeDungeonGatheringAction,
  startNpcDungeonRun,
  npcDungeonDay,
  handleNpcDungeonSettlementApplied,
  handleAssetDistributionCompleted,
  handleCombatEncounterResolved,
} from './system';
import type { DungeonHandlerResult } from './system';
import { createFixtureState, createFixtureContext, FIXTURE } from './fixtures';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// 可拒絕 Handler 現在回傳 ModuleOutcome；測試主路徑一律預期 accept。
function ok(r: DungeonHandlerResult): ModuleResult<DungeonModuleState> {
  if (!r.ok) throw new Error(`expected accept, got rejection: ${r.rejection.code}`);
  return r.result;
}

// 走到「事件 Pending Interaction 已開啟」的狀態：移進內容所在房 R2 後互動。
function openPendingEvent(): { state: DungeonModuleState; interactionId: InteractionId } {
  const ctx = createFixtureContext();
  const moved = ok(
    moveDungeonRoom(
      createFixtureState(),
      FIXTURE.teamId,
      { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle },
      ctx,
    ),
  );
  const opened = ok(
    interactDungeonContent(
      moved.nextSlice,
      FIXTURE.teamId,
      { type: 'interactDungeonContent', contentId: FIXTURE.eventContentId },
      ctx,
    ),
  );
  const interactionId = getPlayerSession(opened.nextSlice, FIXTURE.teamId)?.pendingInteraction?.interactionId;
  if (interactionId === undefined) throw new Error('fixture: expected a pending interaction');
  return { state: opened.nextSlice, interactionId };
}

// 取出外送訊息中的 event.type 清單。
function eventKinds(messages: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    const ev = (m as { event?: { type?: string } }).event;
    if (ev && typeof ev.type === 'string') out.push(ev.type);
  }
  return out;
}

// 取出外送訊息中的 internal command.type 清單。
function internalKinds(messages: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    const cmd = (m as { targetModule?: unknown; command?: { type?: string } });
    if (cmd.targetModule !== undefined && cmd.command && typeof cmd.command.type === 'string') {
      out.push(cmd.command.type);
    }
  }
  return out;
}

type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: '#6：戰敗 → Session 收為 closed（不回 exploring）+ 送 StartReturnFromDungeon + 結束 Distribution',
    run: () => {
      const base = createFixtureState();
      const session = base.playerSessions[FIXTURE.teamId]!;
      const inCombat: DungeonModuleState = {
        ...base,
        playerSessions: { ...base.playerSessions, [FIXTURE.teamId]: { ...session, status: 'inCombat' } },
      };
      const event = {
        teamId: FIXTURE.teamId,
        outcome: 'defeat',
        source: { kind: 'mapContent', mapId: FIXTURE.mapId, contentId: FIXTURE.eventContentId, encounterGroupId: 'grp' },
      };
      const r = handleCombatEncounterResolved(inCombat, event as never);
      const after = r.nextSlice.playerSessions[FIXTURE.teamId]!;
      assert(after.status === 'closed', `戰敗應收為 closed，不得回 exploring（實得 ${after.status}）`);
      const cmds = r.outgoingMessages.map((m) => (m as { command?: { type?: string } }).command?.type);
      assert(cmds.includes('StartReturnFromDungeon'), '戰敗應請 team 結束地牢 Plan + 返城');
      // R8 #5 迴歸：戰敗曾只關 Session，探索開始時建立的 Distribution 永遠停在 collecting。
      const finalize = r.outgoingMessages
        .map((m) => (m as { command?: { type?: string; distributionId?: string } }).command)
        .find((c) => c?.type === 'FinalizeAssetDistributionCollection');
      assert(finalize !== undefined, '戰敗應結束探索 Distribution 的收集，不得留下 collecting');
      assert(
        finalize?.distributionId === session.distributionId,
        '結束的必須是本次探索的 Distribution',
      );
    },
  },
  {
    name: '#6 對照：戰勝 → Session 回 exploring',
    run: () => {
      const base = createFixtureState();
      const session = base.playerSessions[FIXTURE.teamId]!;
      const inCombat: DungeonModuleState = {
        ...base,
        playerSessions: { ...base.playerSessions, [FIXTURE.teamId]: { ...session, status: 'inCombat' } },
      };
      const event = {
        teamId: FIXTURE.teamId,
        outcome: 'victory',
        source: { kind: 'mapContent', mapId: FIXTURE.mapId, contentId: FIXTURE.eventContentId, encounterGroupId: 'grp' },
      };
      const r = handleCombatEncounterResolved(inCombat, event as never);
      assert(
        r.nextSlice.playerSessions[FIXTURE.teamId]!.status === 'exploring',
        '戰勝應回到 exploring',
      );
    },
  },
  {
    name: 'moveDungeonRoom accrues cells × 30 minutes and reveals the entered room',
    run: () => {
      const ctx = createFixtureContext();
      const s0 = createFixtureState();
      const cmd: MoveDungeonRoom = { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle };
      const r = ok(moveDungeonRoom(s0, FIXTURE.teamId, cmd, ctx));
      const session = r.nextSlice.playerSessions[FIXTURE.teamId];
      assert(session !== undefined, 'session exists');
      // R1→R2 = 2 cells × 30 = 60 分鐘。
      assert(session!.elapsedDungeonMinutes === 60, `elapsed 60 (got ${session!.elapsedDungeonMinutes})`);
      assert(session!.currentRoomId === FIXTURE.roomMiddle, 'moved into R2');
      const kinds = eventKinds(r.outgoingMessages);
      assert(kinds.includes('PlayerDungeonTimeAdvanced'), 'emits PlayerDungeonTimeAdvanced');
      // 60 < 100（迷宮日長）→ 未跨午夜。
      assert((r.kernelRequests ?? []).length === 0, 'no world advance yet');
      // R2 揭露。
      const knowledge = Object.values(r.nextSlice.playerMapKnowledge)[0];
      assert(knowledge?.revealedRoomIds.includes(FIXTURE.roomMiddle) === true, 'R2 revealed');
    },
  },
  {
    name: 'interactDungeonContent rejects when the content is not in the player current room',
    run: () => {
      const ctx = createFixtureContext();
      const s0 = createFixtureState(); // session 在入口房 R1；事件內容在 R2。
      const cmd: InteractDungeonContent = { type: 'interactDungeonContent', contentId: FIXTURE.eventContentId };
      const r = interactDungeonContent(s0, FIXTURE.teamId, cmd, ctx);
      assert(!r.ok, 'interact from a different room must reject');
    },
  },
  {
    name: 'interactDungeonContent proceeds when the player stands in the content room',
    run: () => {
      const ctx = createFixtureContext();
      // 先移到內容所在房 R2。
      const moved = ok(
        moveDungeonRoom(
          createFixtureState(),
          FIXTURE.teamId,
          { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle },
          ctx,
        ),
      );
      const cmd: InteractDungeonContent = { type: 'interactDungeonContent', contentId: FIXTURE.eventContentId };
      const r = interactDungeonContent(moved.nextSlice, FIXTURE.teamId, cmd, ctx);
      assert(r.ok, 'interact from the content room proceeds');
    },
  },
  {
    // R8 #4 迴歸：偽造的 optionId 曾清掉 Pending 並固定回報成功。
    name: 'resolveDungeonInteraction rejects a forged optionId and keeps the pending interaction',
    run: () => {
      const { state, interactionId } = openPendingEvent();
      const cmd: ResolveDungeonInteraction = {
        type: 'resolveDungeonInteraction',
        interactionId,
        optionId: 'template-local:content-event-option:forged' as ContentEventOptionId,
      };
      const r = resolveDungeonInteraction(state, FIXTURE.teamId, cmd, createFixtureContext());
      assert(!r.ok, 'a forged optionId must reject');
      assert(
        r.ok || r.rejection.code === 'dungeon.resolveDungeonInteraction.illegalOption',
        'rejection names the illegal option',
      );
      // Session 不得被動到：Pending 仍在，玩家可以重送合法選項。
      const session = getPlayerSession(state, FIXTURE.teamId);
      assert(session?.pendingInteraction?.interactionId === interactionId, 'pending interaction survives');
    },
  },
  {
    name: 'resolveDungeonInteraction accepts the option declared by the content event definition',
    run: () => {
      const { state, interactionId } = openPendingEvent();
      const cmd: ResolveDungeonInteraction = {
        type: 'resolveDungeonInteraction',
        interactionId,
        optionId: FIXTURE.eventOptionId,
      };
      const r = ok(resolveDungeonInteraction(state, FIXTURE.teamId, cmd, createFixtureContext()));
      const session = getPlayerSession(r.nextSlice, FIXTURE.teamId);
      assert(session?.pendingInteraction === undefined, 'pending interaction cleared');
      assert(session?.status === 'exploring', 'exploration resumes');
    },
  },
  {
    name: 'second move crosses midnight and requests exactly one world-day advance',
    run: () => {
      const ctx = createFixtureContext();
      const s0 = createFixtureState();
      // 第一步 R1→R2（elapsed 60）。
      const r1 = ok(
        moveDungeonRoom(
          s0,
          FIXTURE.teamId,
          { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle },
          ctx,
        ),
      );
      // 第二步 R2→R3（+60 → 120 跨越 100 邊界）。
      const r2 = ok(
        moveDungeonRoom(
          r1.nextSlice,
          FIXTURE.teamId,
          { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomExit },
          ctx,
        ),
      );
      const session = r2.nextSlice.playerSessions[FIXTURE.teamId];
      assert(session!.elapsedDungeonMinutes === 120, `elapsed 120 (got ${session!.elapsedDungeonMinutes})`);
      // 跨午夜走 ModuleResult.kernelRequests（world 模組不擁有世界日）。
      const advances = (r2.kernelRequests ?? []).filter((k) => k.type === 'AdvanceWorldToDay');
      assert(advances.length === 1, `exactly one world advance (got ${advances.length})`);
      assert(advances[0]!.targetDay === ctx.worldDay + 1, 'advances exactly one day');
      // 事件標記跨午夜。
      const timeEvent = r2.outgoingMessages
        .map((m) => (m as { event?: { type?: string; worldDayCrossed?: boolean } }).event)
        .find((e) => e?.type === 'PlayerDungeonTimeAdvanced');
      assert(timeEvent?.worldDayCrossed === true, 'worldDayCrossed=true');
    },
  },
  {
    name: 'ConsumeDungeonGatheringAction adds data-defined interaction minutes',
    run: () => {
      const ctx = createFixtureContext();
      const s0 = createFixtureState();
      const cmd: ConsumeDungeonGatheringAction = {
        type: 'ConsumeDungeonGatheringAction',
        teamId: FIXTURE.teamId,
        mapId: FIXTURE.mapId,
        mapVersion: FIXTURE.mapVersion,
        nodeId: FIXTURE.gatherNodePlayer,
      };
      const r = ok(consumeDungeonGatheringAction(s0, cmd, ctx));
      const session = r.nextSlice.playerSessions[FIXTURE.teamId];
      // 玩家採集規則 = 15 分鐘。
      assert(session!.elapsedDungeonMinutes === 15, `elapsed 15 (got ${session!.elapsedDungeonMinutes})`);
      assert(eventKinds(r.outgoingMessages).includes('PlayerDungeonTimeAdvanced'), 'emits time advanced');
    },
  },
  {
    name: 'ConsumeDungeonGatheringAction rejects on Map Version mismatch',
    run: () => {
      const ctx = createFixtureContext();
      const s0 = createFixtureState();
      const cmd: ConsumeDungeonGatheringAction = {
        type: 'ConsumeDungeonGatheringAction',
        teamId: FIXTURE.teamId,
        mapId: FIXTURE.mapId,
        mapVersion: FIXTURE.mapVersion + 5, // 版本不符。
        nodeId: FIXTURE.gatherNodePlayer,
      };
      // B.5 起前置條件不符是明確拒絕，不再是「回傳未變 slice」的靜默成功。
      const r = consumeDungeonGatheringAction(s0, cmd, ctx);
      assert(!r.ok, 'mismatch must be rejected, not silently accepted');
      if (!r.ok) {
        assert(
          r.rejection.code === 'dungeon.consumeDungeonGatheringAction.preconditionFailed',
          `rejection code (got ${r.rejection.code})`,
        );
        assert(r.rejection.sourceModule === 'dungeon', 'rejection names the source module');
      }
    },
  },
  {
    name: 'npcDungeonDay processes full sequence within 10 points and enters settling',
    run: () => {
      const ctx = createFixtureContext();
      const start = ok(
        startNpcDungeonRun(
          createInitialDungeonState(),
          { type: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
          ctx,
        ),
      );
      // Start 應排一個 npcDungeonDay Job 並開一個 collecting Distribution。
      assert(start.scheduledJobs.length === 1, 'one npcDungeonDay job scheduled');
      assert(internalKinds(start.outgoingMessages).includes('StartAssetDistribution'), 'starts distribution');

      const runId = Object.keys(start.nextSlice.npcRuns)[0] as NpcDungeonRunId;
      const runBefore = start.nextSlice.npcRuns[runId]!;
      // 無怪物序列 → combatSequenceSettled 從開始即 true（不變量 §3.4.9）。
      assert(runBefore.settlementProgress.combatSequenceSettled === true, 'combat settled from start (no monsters)');

      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
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
      const start = ok(
        startNpcDungeonRun(
          createInitialDungeonState(),
          { type: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
          ctx,
        ),
      );
      const runId = Object.keys(start.nextSlice.npcRuns)[0] as NpcDungeonRunId;
      const distributionId = start.nextSlice.npcRuns[runId]!.distributionId as AssetDistributionId;

      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
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
      const start = ok(
        startNpcDungeonRun(
          createInitialDungeonState(),
          { type: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
          ctx,
        ),
      );
      const runId = Object.keys(start.nextSlice.npcRuns)[0] as NpcDungeonRunId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const run = day.nextSlice.npcRuns[runId]!;
      assert(run.status === 'invalid', `status invalid (got ${run.status})`);
      const closed = day.outgoingMessages
        .map((m) => (m as { event?: { type?: string; reason?: string } }).event)
        .find((e) => e?.type === 'NpcDungeonRunClosed');
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
