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

import type { NpcDungeonRun } from '../../contracts/dungeon';

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
  handleCombatSequenceChallengeResolved,
  handleCombatSequenceReadyForSourceCommit,
  handleCombatSequenceSettled,
  handleCombatSequenceInvalidated,
} from './system';
import type { DungeonContext, DungeonHandlerResult, DungeonMapPort } from './system';
import {
  createFixtureState,
  createFixtureContext,
  createFixtureReader,
  createFixtureMapPort,
  createFixtureCombatSequencePort,
  challengeIdFor,
  monsterNpcSequence,
  FIXTURE,
} from './fixtures';
import { makeDungeonQuery } from './queries';

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

// 取出外送訊息中指定型別的 internal command 本體（草稿的 command 欄位是 unknown，讀取端自行窄化）。
function commandsOfType(messages: readonly unknown[], type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    const cmd = (m as { command?: Record<string, unknown> }).command;
    if (cmd !== undefined && cmd['type'] === type) out.push(cmd);
  }
  return out;
}

// ── 怪物序列（Combat Sequence）測試共用 ──────────────────────────────────────

// 走 monsterNpcSequence 的 Context：怪物 A（1 點）→ 寶箱（1 點）→ Boss B（4 點）。
function monsterContext(mapOverrides?: Partial<DungeonMapPort>, rest?: Partial<DungeonContext>): DungeonContext {
  return createFixtureContext({
    map: createFixtureMapPort({ listNpcSequence: () => monsterNpcSequence, ...mapOverrides }),
    ...rest,
  });
}

function startMonsterRun(ctx: DungeonContext) {
  return ok(
    startNpcDungeonRun(
      createInitialDungeonState(),
      { type: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
      ctx,
    ),
  );
}

function onlyRun(state: DungeonModuleState): NpcDungeonRun {
  const run = Object.values(state.npcRuns)[0];
  if (run === undefined) throw new Error('fixture: expected exactly one npc run');
  return run;
}

// combat-sequence 會發出的事件；challengeId 取自 Run 正在等的那一題。
function challengeResolvedEvent(
  run: NpcDungeonRun,
  outcome: 'success' | 'failure' | 'skippedBeforeAttempt',
  resultId: string,
): never {
  const challengeId = run.awaitingCombatChallengeId;
  if (challengeId === undefined) throw new Error('fixture: run is not awaiting a challenge');
  const contentId = run.combatSequenceChallenges.find((c) => c.challengeId === challengeId)?.contentId;
  return {
    type: 'CombatSequenceChallengeResolved',
    sequenceId: run.combatSequenceId,
    teamId: run.teamId,
    challengeId,
    resultId,
    sourceRef: {
      kind: 'mapContent',
      mapId: run.mapId,
      mapVersion: run.mapVersion,
      contentId,
      contentRevision: 0,
    },
    outcome,
  } as never;
}

type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: '#6/R9 #4：戰敗 → Session 轉 defeated（不回 exploring）+ 結束 Distribution，但**不**立刻返城',
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
      assert(after.status === 'defeated', `戰敗應轉 defeated，不得回 exploring（實得 ${after.status}）`);
      const cmds = r.outgoingMessages.map((m) => (m as { command?: { type?: string } }).command?.type);
      // R8 #5 迴歸：戰敗曾只關 Session，探索開始時建立的 Distribution 永遠停在 collecting。
      const finalize = r.outgoingMessages
        .map((m) => (m as { command?: { type?: string; distributionId?: string } }).command)
        .find((c) => c?.type === 'FinalizeAssetDistributionCollection');
      assert(finalize !== undefined, '戰敗應結束探索 Distribution 的收集，不得留下 collecting');
      assert(
        finalize?.distributionId === session.distributionId,
        '結束的必須是本次探索的 Distribution',
      );
      // R9 #4：doc §443——競拍期間仍算位於冒險地，不可開始返城。返城必須等 AssetDistributionCompleted。
      assert(
        !cmds.includes('StartReturnFromDungeon'),
        '戰敗當下不得開始返城（要等 Distribution 完成）',
      );
    },
  },
  {
    // R9 #4：R8 #5 讓戰敗直接 closed，AssetDistributionCompleted 的玩家分支只吃 leaving，
    // 競拍結束後那個事件就落空——Session 沒人關、返城沒人送。
    name: 'R9 #4：戰敗的 Distribution 完成 → 關閉 Session + 返城，且不得發完成經驗',
    run: () => {
      const base = createFixtureState();
      const session = base.playerSessions[FIXTURE.teamId]!;
      const inCombat: DungeonModuleState = {
        ...base,
        playerSessions: { ...base.playerSessions, [FIXTURE.teamId]: { ...session, status: 'inCombat' } },
      };
      const defeat = handleCombatEncounterResolved(inCombat, {
        teamId: FIXTURE.teamId,
        outcome: 'defeat',
        source: { kind: 'mapContent', mapId: FIXTURE.mapId, contentId: FIXTURE.eventContentId, encounterGroupId: 'grp' },
      } as never);

      const done = handleAssetDistributionCompleted(
        defeat.nextSlice,
        session.distributionId,
        createFixtureContext(),
      );
      const after = done.nextSlice.playerSessions[FIXTURE.teamId]!;
      assert(after.status === 'closed', `分配完成後才關 Session（實得 ${after.status}）`);
      const cmds = done.outgoingMessages.map((m) => (m as { command?: { type?: string } }).command?.type);
      assert(cmds.includes('StartReturnFromDungeon'), '分配完成後才返城');
      assert(
        !eventKinds(done.outgoingMessages).includes('MapExplorationCompleted'),
        '戰敗不算完成探索，不得發 MapExplorationCompleted（完成經驗）',
      );
    },
  },
  {
    name: 'R9 #4 對照：正常離場的 Distribution 完成 → 仍發 MapExplorationCompleted',
    run: () => {
      const base = createFixtureState();
      const session = base.playerSessions[FIXTURE.teamId]!;
      const leaving: DungeonModuleState = {
        ...base,
        playerSessions: { ...base.playerSessions, [FIXTURE.teamId]: { ...session, status: 'leaving' } },
      };
      const done = handleAssetDistributionCompleted(leaving, session.distributionId, createFixtureContext());
      assert(
        eventKinds(done.outgoingMessages).includes('MapExplorationCompleted'),
        '正常離場仍應發完成經驗',
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
        assert(r.rejection.source === 'dungeon', 'rejection names the source module');
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
    // doc §4 明文：「Dungeon Query 不公開其他隊伍的 RNG seed、未結算獎勵細節或可被玩家利用的
    // NPC 隱藏結果」。NpcDungeonRunView 先前是 NpcDungeonRun 的別名，三者全部公開。
    // 這個測試釘住投影：拿到 rngContext 就能預測那支 NPC 隊後續每一次擲骰。
    name: 'npc run query view shields rngContext and unsettled results (doc §4)',
    run: () => {
      const ctx = createFixtureContext();
      const start = ok(
        startNpcDungeonRun(
          createFixtureState(),
          { type: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
          ctx,
        ),
      );
      const runId = Object.keys(start.nextSlice.npcRuns)[0] as NpcDungeonRunId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const run = day.nextSlice.npcRuns[runId]!;
      assert(run.pendingResults.length > 0, 'fixture produced unsettled results to shield');

      const query = makeDungeonQuery(day.nextSlice, ctx.reader);
      const view = query.getNpcRun(runId);
      if (view === undefined) throw new Error('getNpcRun returned undefined for an existing run');
      const keys = Object.keys(view);
      assert(!keys.includes('rngContext'), `rngContext must not be exposed (keys: ${keys.join(',')})`);
      assert(!keys.includes('pendingResults'), `pendingResults must not be exposed (keys: ${keys.join(',')})`);
      assert(
        view.pendingResultCount === run.pendingResults.length,
        `only the count is exposed (got ${view.pendingResultCount}, run has ${run.pendingResults.length})`,
      );

      // 兩個 getter 必須共用同一份投影——先前 getNpcRunForTeam 也是直接回傳 state 的 Run。
      const byTeam = query.getNpcRunForTeam(FIXTURE.teamId);
      if (byTeam === undefined) throw new Error('getNpcRunForTeam returned undefined for an existing run');
      const teamKeys = Object.keys(byTeam);
      assert(!teamKeys.includes('rngContext'), 'getNpcRunForTeam must shield rngContext too');
      assert(!teamKeys.includes('pendingResults'), 'getNpcRunForTeam must shield pendingResults too');
    },
  },
  {
    // doc §8.3：進入房間即判定該房仍 armed 的固定陷阱。先前這裡只有一行 TODO，於是陷阱房
    // 永遠不會觸發任何事——玩家走過去什麼都不會發生。
    name: '進入陷阱房：required ResolveMapTrap，結果由 trapResolver 決定，並寫入 knownTrapIds',
    run: () => {
      const TRAP = 'template-local:fixed-trap:pit' as never;
      const baseMap = createFixtureMapPort();
      const ctx = createFixtureContext({
        map: {
          ...baseMap,
          listArmedTrapsInRoom: (_mapId, roomId) => (roomId === FIXTURE.roomMiddle ? [TRAP] : []),
        },
        resolvers: {
          resolveNpcTargetOutcome: () => ({ outcome: 'success' as const }),
          resolveTrap: () => ({ outcome: 'disarmed' as const }),
        },
      });
      const moved = ok(
        moveDungeonRoom(
          createFixtureState(),
          FIXTURE.teamId,
          { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle },
          ctx,
        ),
      );

      // 與同檔的 internalKinds 同一個取法：草稿的 command 欄位是 unknown，讀取端自行窄化。
      const traps: { type: string; resolution: { outcome: string } }[] = [];
      for (const m of moved.outgoingMessages) {
        const cmd = (m as { command?: { type?: string; resolution?: { outcome?: string } } }).command;
        if (cmd?.type === 'ResolveMapTrap' && cmd.resolution?.outcome !== undefined) {
          traps.push({ type: cmd.type, resolution: { outcome: cmd.resolution.outcome } });
        }
      }
      assert(traps.length === 1, `should send exactly one ResolveMapTrap, got ${traps.length}`);
      assert(
        traps[0]!.resolution.outcome === 'disarmed',
        `outcome should come from trapResolver, got ${traps[0]!.resolution.outcome}`,
      );

      const knowledge = Object.values(moved.nextSlice.playerMapKnowledge).find(
        (k) => k.teamId === FIXTURE.teamId,
      );
      if (knowledge === undefined) throw new Error('should have PlayerMapKnowledge');
      assert(
        knowledge.knownTrapIds.length === 1 && knowledge.knownTrapIds[0] === TRAP,
        `trap should be recorded in knownTrapIds, got ${JSON.stringify(knowledge.knownTrapIds)}`,
      );
    },
  },
  {
    name: '無陷阱房：不送 ResolveMapTrap（不得對每次移動都發一筆）',
    run: () => {
      const moved = ok(
        moveDungeonRoom(
          createFixtureState(),
          FIXTURE.teamId,
          { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle },
          createFixtureContext(),
        ),
      );
      assert(
        !internalKinds(moved.outgoingMessages).includes('ResolveMapTrap'),
        'default fixture has no trap room; must not send ResolveMapTrap',
      );
    },
  },
  {
    // npcDungeonDay 的迴圈原本把每一筆 pendingResult 寫成 `outcome: 'success'`（規範 §5
    // 「寫死事件成功或失敗」）：已扣掉的探索點數一律記成成功，NPC 隊伍永遠不會失手。
    // 現在成敗由 NpcDungeonTargetResolverDefinition.outcomeRuleId 指名的資料規則決定。
    name: 'npc run: 成敗由 Resolver 決定；失敗不留獎勵引用',
    run: () => {
      const ctx = createFixtureContext({
        resolvers: {
          resolveNpcTargetOutcome: () => ({ outcome: 'failure' }),
          resolveTrap: () => ({ outcome: 'triggered' as const }),
        },
      });
      const start = ok(
        startNpcDungeonRun(
          createFixtureState(),
          { type: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
          ctx,
        ),
      );
      const runId = Object.keys(start.nextSlice.npcRuns)[0] as NpcDungeonRunId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const run = day.nextSlice.npcRuns[runId]!;
      assert(run.pendingResults.length > 0, '應仍記錄嘗試過的目標');
      assert(
        run.pendingResults.every((r) => r.outcome === 'failure'),
        `Resolver 回 failure 就該全部是 failure（實得 ${run.pendingResults.map((r) => r.outcome).join(',')}）`,
      );
      assert(
        run.pendingResults.every((r) => r.pendingRewardRefs.length === 0),
        '失敗不得留下獎勵引用——否則結算會發出不存在的戰利品',
      );
    },
  },
  {
    name: "npc run: successBehavior='leave' 成功後立刻進入結算",
    run: () => {
      const base = createFixtureReader();
      const ctx = createFixtureContext({
        reader: {
          ...base,
          getNpcResolver: (id) => ({ ...base.getNpcResolver(id), successBehavior: 'leave' as const }),
        },
      });
      const start = ok(
        startNpcDungeonRun(
          createFixtureState(),
          { type: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
          ctx,
        ),
      );
      const runId = Object.keys(start.nextSlice.npcRuns)[0] as NpcDungeonRunId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const run = day.nextSlice.npcRuns[runId]!;
      assert(run.status === 'settling', `應立刻進入 settling（實得 ${run.status}）`);
      assert(
        run.pendingResults.length === 1,
        `leave 表示第一筆成功就停手，不該把整條序列走完（實得 ${run.pendingResults.length} 筆）`,
      );
    },
  },
  {
    name: 'npc run: Resolver 不支援該目標種類 → 整筆 Run 標為 invalid（不得當成失敗混進結果）',
    run: () => {
      const base = createFixtureReader();
      const ctx = createFixtureContext({
        reader: {
          ...base,
          // 只支援 mapContent，但 fixture 的序列是採集點——內容配置錯誤。
          getNpcResolver: (id) => ({
            ...base.getNpcResolver(id),
            supportedTargetKinds: [{ kind: 'mapContent' as const, contentKind: 'chest' as never }],
          }),
        },
      });
      const start = ok(
        startNpcDungeonRun(
          createFixtureState(),
          { type: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
          ctx,
        ),
      );
      const runId = Object.keys(start.nextSlice.npcRuns)[0] as NpcDungeonRunId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const run = day.nextSlice.npcRuns[runId]!;
      assert(run.status === 'invalid', `資料錯誤應標 invalid（實得 ${run.status}）`);
      assert(run.pendingResults.length === 0, '不得留下任何偽裝成遊戲事件的結果');
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
      const applied = handleNpcDungeonSettlementApplied(
        day.nextSlice,
        {
          type: 'NpcDungeonSettlementApplied',
          runId,
          distributionId,
          appliedResults: day.nextSlice.npcRuns[runId]!.pendingResults,
          skippedResults: [],
        },
        ctx,
      );
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

  // ── (A) 控制／綁架內容的守衛（01_map_module.md §3.2 controllerContentIds）────────
  {
    // 先前 control / kidnap 與 chest 走同一條直取路徑：守衛一個沒打，內容就被判定成功。
    name: '控制內容：守衛未解決 → typed rejection（不得靜默成功）',
    run: () => {
      const ctx = createFixtureContext();
      const inRoom = ok(
        moveDungeonRoom(
          createFixtureState(),
          FIXTURE.teamId,
          { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle },
          ctx,
        ),
      ).nextSlice;
      const r = interactDungeonContent(
        inRoom,
        FIXTURE.teamId,
        { type: 'interactDungeonContent', contentId: FIXTURE.controlContentId },
        ctx,
      );
      assert(!r.ok, '守衛還在時必須拒絕');
      if (!r.ok) {
        assert(
          r.rejection.code === 'dungeon.interactDungeonContent.guardsUnresolved',
          `rejection code (got ${r.rejection.code})`,
        );
        assert(
          r.rejection.details?.['nextGuardContentId'] === String(FIXTURE.guardContentId),
          '拒絕要說得出還卡在哪一個守衛',
        );
      }
    },
  },
  {
    name: '綁架內容：守衛全數解決後 → 走內容 Resolver（ResolvePlayerMapContent）',
    run: () => {
      const ctx = createFixtureContext({
        map: createFixtureMapPort({
          // 守衛已被打掉（map 標為 resolved）；其餘內容仍可用。
          isContentAvailable: (_mapId, contentId) => contentId !== FIXTURE.guardContentId,
        }),
      });
      const inRoom = ok(
        moveDungeonRoom(
          createFixtureState(),
          FIXTURE.teamId,
          { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle },
          ctx,
        ),
      ).nextSlice;
      const r = ok(
        interactDungeonContent(
          inRoom,
          FIXTURE.teamId,
          { type: 'interactDungeonContent', contentId: FIXTURE.kidnapContentId },
          ctx,
        ),
      );
      assert(
        internalKinds(r.outgoingMessages).includes('ResolvePlayerMapContent'),
        '守衛清空後才要求 map 處理內容',
      );
    },
  },
  {
    name: '控制內容：map 說不出守衛名單 → typed rejection（不得當成「沒有守衛」放行）',
    run: () => {
      const ctx = createFixtureContext({
        map: createFixtureMapPort({ listControllerContentIds: () => undefined }),
      });
      const inRoom = ok(
        moveDungeonRoom(
          createFixtureState(),
          FIXTURE.teamId,
          { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle },
          ctx,
        ),
      ).nextSlice;
      const r = interactDungeonContent(
        inRoom,
        FIXTURE.teamId,
        { type: 'interactDungeonContent', contentId: FIXTURE.controlContentId },
        ctx,
      );
      assert(!r.ok, '守衛名單缺失必須拒絕');
      if (!r.ok) {
        assert(
          r.rejection.code === 'dungeon.interactDungeonContent.controllerContentsMissing',
          `rejection code (got ${r.rejection.code})`,
        );
      }
    },
  },

  // ── (B) NPC 怪物內容走 Combat Sequence ─────────────────────────────────────
  {
    name: 'StartNpcDungeonRun：有怪物內容 → 送 StartCombatSequence(source=dungeonSweep) 並保存對照',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const starts = commandsOfType(start.outgoingMessages, 'StartCombatSequence');
      assert(starts.length === 1, `恰好開一條 Sequence（實得 ${starts.length}）`);
      const source = starts[0]!['source'] as { kind?: string; mapId?: string; mapVersion?: number };
      assert(source.kind === 'dungeonSweep', `source 必須是 dungeonSweep（實得 ${String(source.kind)}）`);
      assert(source.mapId === FIXTURE.mapId && source.mapVersion === FIXTURE.mapVersion, 'source 帶本圖與版本');

      const run = onlyRun(start.nextSlice);
      assert(run.combatSequenceId !== undefined, 'Run 必須保存 combatSequenceId');
      assert(
        starts[0]!['sequenceId'] === run.combatSequenceId,
        '送出的 sequenceId 必須就是 Run 保存的那一個',
      );
      // 只有兩筆怪物內容進戰鬥串（寶箱不進；21 §8）。
      assert(
        run.combatSequenceChallenges.map((c) => String(c.contentId)).join(',') ===
          `${FIXTURE.monsterContentA},${FIXTURE.monsterContentB}`,
        `對照表只含怪物內容且依 npcOrder 排序（實得 ${run.combatSequenceChallenges.map((c) => String(c.contentId)).join(',')}）`,
      );
      assert(
        run.settlementProgress.combatSequenceSettled === false,
        '有怪物時 combatSequenceSettled 必須從 false 開始',
      );
    },
  },
  {
    // 先前是 `sequence.some((e) => e.kind === 'mapContent')`：寶箱也被算成怪物，
    // 於是一張只有寶箱的圖會開一條沒有任何 Challenge 的 Sequence（違反不變量 §3.4.9）。
    name: 'StartNpcDungeonRun：只有寶箱的 mapContent 序列不算怪物 → 不建立空 Sequence',
    run: () => {
      const ctx = monsterContext({
        listNpcSequence: () => [
          {
            kind: 'mapContent',
            npcOrder: 0,
            pointCost: 1,
            resolverId: FIXTURE.resolverId,
            contentId: FIXTURE.chestContentId,
          },
        ],
      });
      const start = startMonsterRun(ctx);
      assert(
        commandsOfType(start.outgoingMessages, 'StartCombatSequence').length === 0,
        '沒有怪物就不得開 Sequence',
      );
      const run = onlyRun(start.nextSlice);
      assert(run.combatSequenceId === undefined, '沒有怪物就沒有 combatSequenceId');
      assert(run.settlementProgress.combatSequenceSettled === true, '沒有怪物時該旗標從開始即 true');
    },
  },
  {
    name: 'StartNpcDungeonRun：組不出開始快照 → typed rejection（不得退成「先不打仗」）',
    run: () => {
      const ctx = monsterContext(undefined, {
        combatSequence: createFixtureCombatSequencePort({ planDungeonSweep: () => undefined }),
      });
      const r = startNpcDungeonRun(
        createInitialDungeonState(),
        { type: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
        ctx,
      );
      assert(!r.ok, '快照組不出來必須拒絕');
      if (!r.ok) {
        assert(
          r.rejection.code === 'dungeon.startNpcDungeonRun.combatSequencePlanUnavailable',
          `rejection code (got ${r.rejection.code})`,
        );
      }
    },
  },
  {
    name: 'npcDungeonDay：走到怪物內容 → 扣點並送 ResolveNextCombatSequenceChallenge，該段不排 Job',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));

      const resolves = commandsOfType(day.outgoingMessages, 'ResolveNextCombatSequenceChallenge');
      assert(resolves.length === 1, `恰好推進一題（實得 ${resolves.length}）`);
      assert(
        resolves[0]!['expectedChallengeId'] === challengeIdFor(FIXTURE.monsterContentA),
        '推進的必須是游標指向的那一題',
      );
      assert(resolves[0]!['attemptedOnDay'] === ctx.worldDay, 'attemptedOnDay 是當前世界日');

      const run = day.nextSlice.npcRuns[runId]!;
      assert(
        run.awaitingCombatChallengeId === challengeIdFor(FIXTURE.monsterContentA),
        '送出後必須記住自己在等哪一題',
      );
      assert(run.cursorNpcOrder === 0, '結果還沒回來，游標不得前進');
      assert(run.remainingDailyPoints === 9, `怪物 1 點已扣（實得 ${run.remainingDailyPoints}）`);
      assert(run.pendingResults.length === 0, '成敗未知前不得寫入暫存結果');
      assert(day.scheduledJobs.length === 0, '今日尚未結束，這一段不得排明日 Job');
    },
  },
  {
    name: 'CombatSequenceChallengeResolved(success) → 記下怪物結果並續行今日剩餘點數',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const awaiting = day.nextSlice.npcRuns[runId]!;

      const resolved = handleCombatSequenceChallengeResolved(
        day.nextSlice,
        challengeResolvedEvent(awaiting, 'success', 'runtime:combat-sequence-challenge-result:r1'),
        ctx,
      );
      const run = resolved.nextSlice.npcRuns[runId]!;
      const first = run.pendingResults[0]!;
      assert(first.outcome === 'success', `成敗來自事件（實得 ${first.outcome}）`);
      assert(
        first.combatSequenceResultId === 'runtime:combat-sequence-challenge-result:r1',
        '怪物結果必須帶 Combat Sequence 的 Result ID（不變量 §3.4.10）',
      );
      assert(first.pendingRewardRefs.length === 1, '成功才留獎勵引用');

      // 續行：寶箱（1 點）由內容 Resolver 判定，接著 Boss（4 點）再送一題。
      assert(run.pendingResults.length === 2, `續行處理了寶箱（實得 ${run.pendingResults.length} 筆）`);
      const resolves = commandsOfType(resolved.outgoingMessages, 'ResolveNextCombatSequenceChallenge');
      assert(resolves.length === 1, '續行走到下一個怪物內容時再送一題');
      assert(
        resolves[0]!['expectedChallengeId'] === challengeIdFor(FIXTURE.monsterContentB),
        '第二題必須是序列上的下一個怪物',
      );
      assert(run.remainingDailyPoints === 4, `10 - 1 - 1 - 4 = 4（實得 ${run.remainingDailyPoints}）`);
    },
  },
  {
    name: 'CombatSequenceChallengeResolved(failure) → 立即進入 settling 並要求 Map 套用結果',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const awaiting = day.nextSlice.npcRuns[runId]!;

      const resolved = handleCombatSequenceChallengeResolved(
        day.nextSlice,
        challengeResolvedEvent(awaiting, 'failure', 'runtime:combat-sequence-challenge-result:r1'),
        ctx,
      );
      const run = resolved.nextSlice.npcRuns[runId]!;
      assert(run.status === 'settling', `失敗立刻結算（實得 ${run.status}）`);
      assert(run.pendingResults[0]!.outcome === 'failure', '失敗仍要記錄嘗試過的目標');
      assert(run.pendingResults[0]!.pendingRewardRefs.length === 0, '失敗不得留下獎勵引用');
      assert(
        internalKinds(resolved.outgoingMessages).includes('ApplyNpcDungeonSettlement'),
        '進入 settling 就要求 Map 套用',
      );
      assert(
        commandsOfType(resolved.outgoingMessages, 'ResolveNextCombatSequenceChallenge').length === 0,
        '失敗後不得再解析後續 Challenge',
      );
      // Sequence 自己已轉 awaitingSourceCommit，再送 Stop 會被拒 → 整筆交易回滾。
      assert(
        commandsOfType(resolved.outgoingMessages, 'StopCombatSequence').length === 0,
        '對已終止的 Sequence 不得再送 StopCombatSequence',
      );
    },
  },
  {
    name: '怪物內容在嘗試前已被處理 → SkipNextCombatSequenceChallenge 且不扣點',
    run: () => {
      const ctx = monsterContext({
        isContentAvailable: (_mapId, contentId) => contentId !== FIXTURE.monsterContentA,
      });
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));

      const skips = commandsOfType(day.outgoingMessages, 'SkipNextCombatSequenceChallenge');
      assert(skips.length === 1, `必須同步 Skip 保持兩邊游標一致（實得 ${skips.length}）`);
      assert(
        skips[0]!['expectedChallengeId'] === challengeIdFor(FIXTURE.monsterContentA),
        'Skip 的是游標指向的那一題',
      );
      const run = day.nextSlice.npcRuns[runId]!;
      assert(run.remainingDailyPoints === 10, `已處理的目標不扣點（實得 ${run.remainingDailyPoints}）`);

      // Skip 同樣以 CombatSequenceChallengeResolved 回來（21 §6.4）。
      const resolved = handleCombatSequenceChallengeResolved(
        day.nextSlice,
        challengeResolvedEvent(run, 'skippedBeforeAttempt', 'runtime:combat-sequence-challenge-result:s1'),
        ctx,
      );
      const after = resolved.nextSlice.npcRuns[runId]!;
      assert(after.pendingResults[0]!.outcome === 'skip', 'skippedBeforeAttempt 記為 skip');
      assert(after.pendingResults[0]!.npcOrder === 0, 'skip 記在被跳過的那一筆上');
      assert(after.pendingResults[0]!.pendingRewardRefs.length === 0, 'skip 不得留下獎勵引用');
      // skip 一樣把游標推過那一筆，並續行今日剩餘點數：寶箱（order 1）處理完後停在 Boss（order 2）。
      assert(after.cursorNpcOrder === 2, `續行後游標到 2（實得 ${after.cursorNpcOrder}）`);
      assert(
        after.awaitingCombatChallengeId === challengeIdFor(FIXTURE.monsterContentB),
        'skip 之後照常續行到下一個怪物',
      );
      assert(after.remainingDailyPoints === 5, `skip 不扣點：10 - 1(寶箱) - 4(Boss) = 5（實得 ${after.remainingDailyPoints}）`);
    },
  },
  {
    name: 'CombatSequenceChallengeResolved：別條 Sequence 的事件一律略過',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const before = day.nextSlice.npcRuns[runId]!;

      const foreign = handleCombatSequenceChallengeResolved(
        day.nextSlice,
        {
          type: 'CombatSequenceChallengeResolved',
          sequenceId: 'runtime:combat-sequence:single-battle',
          teamId: FIXTURE.teamId,
          challengeId: 'runtime:combat-sequence-challenge:other',
          resultId: 'runtime:combat-sequence-challenge-result:other',
          sourceRef: { kind: 'singleBattle', sourceId: 'runtime:combat-sequence-source:other' },
          outcome: 'success',
        } as never,
        ctx,
      );
      const after = foreign.nextSlice.npcRuns[runId]!;
      assert(after.revision === before.revision, '不屬本 Run 的事件不得改動 Run');
      assert(foreign.outgoingMessages.length === 0, '不屬本 Run 的事件不得送出任何命令');
    },
  },
  {
    name: 'NpcDungeonSettlementApplied → 只把 applied 的成功怪物 Result 送進 CommitCombatSequenceSourceResults',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;

      // 第一題成功 → 續行寶箱 → 送出第二題。
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const afterFirst = handleCombatSequenceChallengeResolved(
        day.nextSlice,
        challengeResolvedEvent(day.nextSlice.npcRuns[runId]!, 'success', 'runtime:combat-sequence-challenge-result:r1'),
        ctx,
      );
      // 第二題（最後一題）成功 → 序列走完 → settling。
      const afterSecond = handleCombatSequenceChallengeResolved(
        afterFirst.nextSlice,
        challengeResolvedEvent(afterFirst.nextSlice.npcRuns[runId]!, 'success', 'runtime:combat-sequence-challenge-result:r2'),
        ctx,
      );
      const settling = afterSecond.nextSlice.npcRuns[runId]!;
      assert(settling.status === 'settling', `序列走完 → settling（實得 ${settling.status}）`);
      // 最後一題已讓 Sequence 自己轉 awaitingSourceCommit，不得再送 Stop。
      assert(
        commandsOfType(afterSecond.outgoingMessages, 'StopCombatSequence').length === 0,
        '最後一題解出後 Sequence 已終止，不得再送 Stop',
      );

      // Map 只接受第一筆（第二筆被別隊搶先）。
      const applied = settling.pendingResults.filter(
        (r) => r.combatSequenceResultId === 'runtime:combat-sequence-challenge-result:r1',
      );
      const skipped = settling.pendingResults.filter(
        (r) => r.combatSequenceResultId === 'runtime:combat-sequence-challenge-result:r2',
      );
      const settled = handleNpcDungeonSettlementApplied(
        afterSecond.nextSlice,
        {
          type: 'NpcDungeonSettlementApplied',
          runId,
          distributionId: settling.distributionId,
          appliedResults: applied,
          skippedResults: skipped,
        },
        ctx,
      );
      const commits = commandsOfType(settled.outgoingMessages, 'CommitCombatSequenceSourceResults');
      assert(commits.length === 1, `恰好提交一次（實得 ${commits.length}）`);
      assert(
        JSON.stringify(commits[0]!['acceptedSuccessfulResultIds']) ===
          JSON.stringify(['runtime:combat-sequence-challenge-result:r1']),
        `只提交 Map 接受的成功 Result（實得 ${JSON.stringify(commits[0]!['acceptedSuccessfulResultIds'])}）`,
      );
      assert(commits[0]!['committedOnDay'] === ctx.worldDay, 'committedOnDay 是當前世界日');
      assert(
        settled.nextSlice.npcRuns[runId]!.settlementProgress.mapApplied === true,
        'mapApplied 已標記',
      );
    },
  },
  {
    name: 'CombatSequenceSettled → 標記 combatSequenceSettled（三方結算之一）',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const failed = handleCombatSequenceChallengeResolved(
        day.nextSlice,
        challengeResolvedEvent(day.nextSlice.npcRuns[runId]!, 'failure', 'runtime:combat-sequence-challenge-result:r1'),
        ctx,
      );
      const run = failed.nextSlice.npcRuns[runId]!;
      const settled = handleCombatSequenceSettled(failed.nextSlice, {
        sequenceId: run.combatSequenceId!,
        teamId: run.teamId,
        source: { kind: 'dungeonSweep', sourceId: FIXTURE.combatSequenceSourceId, mapId: run.mapId, mapVersion: run.mapVersion },
        terminationReason: 'challengeFailed',
        acceptedSuccessfulCount: 0,
        totalAttackExperienceBudget: 0,
        totalDefenseExperienceBudget: 0,
      });
      assert(
        settled.nextSlice.npcRuns[runId]!.settlementProgress.combatSequenceSettled === true,
        'combatSequenceSettled 必須被標記',
      );
    },
  },
  {
    name: 'CombatSequenceInvalidated → Run 標為 invalid 並發 NpcDungeonRunClosed',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const run = onlyRun(start.nextSlice);
      const invalidated = handleCombatSequenceInvalidated(
        start.nextSlice,
        {
          sequenceId: run.combatSequenceId!,
          teamId: run.teamId,
          reason: 'teamUnavailable',
        },
        ctx,
      );
      assert(invalidated.nextSlice.npcRuns[runId]!.status === 'invalid', 'Run 轉 invalid');
      const closed = invalidated.outgoingMessages
        .map((m) => (m as { event?: { type?: string; reason?: string } }).event)
        .find((e) => e?.type === 'NpcDungeonRunClosed');
      assert(closed?.reason === 'invalid', '以 invalid 原因關閉');
      // Sequence 已經是 invalid，再送一次只會被拒 → 整筆交易回滾。
      assert(
        commandsOfType(invalidated.outgoingMessages, 'InvalidateCombatSequence').length === 0,
        '不得回送 InvalidateCombatSequence',
      );
    },
  },
  {
    // 先前 getNpcProgress 回傳的是 Definition 的 dailyPointBudget——花掉 7 點也永遠顯示 10。
    name: 'getNpcProgress.remainingPoints 反映實際已花掉的點數',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const progress = makeDungeonQuery(day.nextSlice, ctx.reader).getNpcProgress(runId);
      assert(progress.remainingPoints === 9, `10 - 1 = 9（實得 ${progress.remainingPoints}）`);
    },
  },
  {
    name: 'NpcDungeonRunView 不公開怪物對照表與正在解的那一題（doc §4）',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const view = makeDungeonQuery(day.nextSlice, ctx.reader).getNpcRun(runId);
      if (view === undefined) throw new Error('getNpcRun returned undefined for an existing run');
      const keys = Object.keys(view);
      assert(!keys.includes('combatSequenceChallenges'), `怪物名單不得公開（keys: ${keys.join(',')}）`);
      assert(!keys.includes('awaitingCombatChallengeId'), `正在解的那一題不得公開（keys: ${keys.join(',')}）`);
    },
  },

  // ── 複核補洞 ───────────────────────────────────────────────────────────────
  {
    // map 的 isContentAvailable 對「已被打掉」與「這個 ID 根本不存在」回同一個 false，
    // 所以只靠它過濾守衛，一份壞掉的守衛名單會被當成「守衛都清光了」而放行。
    name: '控制內容：守衛名單指到不存在的內容 → typed rejection（不得當成守衛已清空）',
    run: () => {
      const ctx = createFixtureContext({
        map: createFixtureMapPort({
          // 守衛不存在：revision 查不到，isContentAvailable 也是 false（與「已解決」同形）。
          getContentRevision: (_mapId, contentId) =>
            contentId === FIXTURE.guardContentId ? undefined : (0 as never),
          isContentAvailable: (_mapId, contentId) => contentId !== FIXTURE.guardContentId,
        }),
      });
      const inRoom = ok(
        moveDungeonRoom(
          createFixtureState(),
          FIXTURE.teamId,
          { type: 'moveDungeonRoom', targetRoomId: FIXTURE.roomMiddle },
          ctx,
        ),
      ).nextSlice;
      const r = interactDungeonContent(
        inRoom,
        FIXTURE.teamId,
        { type: 'interactDungeonContent', contentId: FIXTURE.controlContentId },
        ctx,
      );
      assert(!r.ok, '指不到的守衛必須拒絕，不得放行內容');
      if (!r.ok) {
        assert(
          r.rejection.code === 'dungeon.interactDungeonContent.controllerContentsMissing',
          `rejection code (got ${r.rejection.code})`,
        );
        assert(
          r.rejection.details?.['unknownGuardContentId'] === String(FIXTURE.guardContentId),
          '拒絕要說得出是哪一個守衛指不到內容',
        );
      }
    },
  },
  {
    // 不變量 dungeon/one-active-run-per-team 一直宣告著，卻沒有任何程式擋。
    name: 'StartNpcDungeonRun：同隊已有未收斂 Run → typed rejection（不得多開一條）',
    run: () => {
      const ctx = monsterContext();
      const first = startMonsterRun(ctx);
      const second = startNpcDungeonRun(
        first.nextSlice,
        { type: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
        ctx,
      );
      assert(!second.ok, '同一隊不得同時有兩條 Run');
      if (!second.ok) {
        assert(
          second.rejection.code === 'dungeon.startNpcDungeonRun.runAlreadyActive',
          `rejection code (got ${second.rejection.code})`,
        );
      }
      assert(
        Object.keys(first.nextSlice.npcRuns).length === 1,
        '被拒絕的那一次不得留下任何 Run',
      );
    },
  },
  {
    // 反向釘住：守門只擋未收斂的 Run，跑完一趟之後必須還能再開一趟。
    name: 'StartNpcDungeonRun：舊 Run 已 closed → 同一隊可以再開一趟',
    run: () => {
      const ctx = monsterContext();
      const first = startMonsterRun(ctx);
      const runId = onlyRun(first.nextSlice).runId;
      const closedState: DungeonModuleState = {
        ...first.nextSlice,
        npcRuns: {
          ...first.nextSlice.npcRuns,
          [runId]: { ...first.nextSlice.npcRuns[runId]!, status: 'closed' },
        },
      };
      const second = startNpcDungeonRun(
        closedState,
        { type: 'StartNpcDungeonRun', teamId: FIXTURE.teamId, mapId: FIXTURE.mapId, planId: FIXTURE.planId },
        ctx,
      );
      assert(second.ok, `已收斂的舊 Run 不得擋住下一趟（${second.ok ? '' : second.rejection.code}）`);
    },
  },
  {
    // 同一筆事件重送會鑄出新的 sourceCommitId，combat-sequence 對已 settled 的 Sequence
    // 收到不同的 commit ID 一律拒絕 → Internal Command 被拒 = 整筆交易回滾。
    name: 'NpcDungeonSettlementApplied 重送 → 真正的 no-op（不得再送 Commit / Finalize）',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const failed = handleCombatSequenceChallengeResolved(
        day.nextSlice,
        challengeResolvedEvent(day.nextSlice.npcRuns[runId]!, 'failure', 'runtime:combat-sequence-challenge-result:r1'),
        ctx,
      );
      const settling = failed.nextSlice.npcRuns[runId]!;
      const payload = {
        type: 'NpcDungeonSettlementApplied',
        runId,
        distributionId: settling.distributionId,
        appliedResults: settling.pendingResults,
        skippedResults: [],
      } as const;

      const once = handleNpcDungeonSettlementApplied(failed.nextSlice, payload, ctx);
      assert(
        once.nextSlice.npcRuns[runId]!.settlementProgress.mapApplied === true,
        '第一次必須標記 mapApplied',
      );

      const twice = handleNpcDungeonSettlementApplied(once.nextSlice, payload, ctx);
      assert(
        twice.nextSlice === once.nextSlice,
        '重送必須回傳同一個 state 參考（真 no-op，不是碰巧相等）',
      );
      assert(twice.outgoingMessages.length === 0, '重送不得送出任何命令');
    },
  },
  {
    // 這個 Subscriber 先前完全沒有測試。正常路徑上 ChallengeResolved 會先把 Run 帶進 settling，
    // 所以它只在「那一筆沒對上」時才真的動作——那正是它作為第二道保險的意義。
    name: 'CombatSequenceReadyForSourceCommit(challengeFailed)：ChallengeResolved 沒對上時仍把 Run 帶進 settling',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const run = day.nextSlice.npcRuns[runId]!;

      const ready = handleCombatSequenceReadyForSourceCommit(
        day.nextSlice,
        {
          sequenceId: run.combatSequenceId!,
          teamId: run.teamId,
          terminationReason: 'challengeFailed',
        } as never,
        ctx,
      );
      const after = ready.nextSlice.npcRuns[runId]!;
      assert(after.status === 'settling', `必須進入 settling（實得 ${after.status}）`);
      assert(after.awaitingCombatChallengeId === undefined, '進 settling 就不再等任何一題');
      assert(
        internalKinds(ready.outgoingMessages).includes('ApplyNpcDungeonSettlement'),
        '進入 settling 就要求 Map 套用',
      );
      assert(
        commandsOfType(ready.outgoingMessages, 'StopCombatSequence').length === 0,
        'Sequence 已自行終止，不得再送 Stop',
      );

      // 冪等：Run 已 settling，第二次必須是真 no-op。
      const again = handleCombatSequenceReadyForSourceCommit(
        ready.nextSlice,
        {
          sequenceId: run.combatSequenceId!,
          teamId: run.teamId,
          terminationReason: 'challengeFailed',
        } as never,
        ctx,
      );
      assert(again.nextSlice === ready.nextSlice, '已 settling 的 Run 不得再被改動');
      assert(again.outgoingMessages.length === 0, '已 settling 不得再送命令');
    },
  },
  {
    // allResolved 只代表怪物打完了；寶箱與採集仍在序列上，不得就此結束探索。
    name: 'CombatSequenceReadyForSourceCommit(allResolved)：不得結束探索',
    run: () => {
      const ctx = monsterContext();
      const start = startMonsterRun(ctx);
      const runId = onlyRun(start.nextSlice).runId;
      const day = ok(npcDungeonDay(start.nextSlice, runId, ctx));
      const run = day.nextSlice.npcRuns[runId]!;

      const ready = handleCombatSequenceReadyForSourceCommit(
        day.nextSlice,
        {
          sequenceId: run.combatSequenceId!,
          teamId: run.teamId,
          terminationReason: 'allResolved',
        } as never,
        ctx,
      );
      assert(ready.nextSlice === day.nextSlice, 'allResolved 不得改動 Run');
      assert(ready.outgoingMessages.length === 0, 'allResolved 不得送出任何命令');
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
