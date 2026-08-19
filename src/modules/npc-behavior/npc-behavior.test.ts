// modules/npc-behavior/npc-behavior.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。
//
// 覆蓋重點（依 WORKER_BRIEF §5）：
//   * 兩支已註冊 Job 與兩個 Subscriber 各至少一個 accept 案例。
//   * 每一種 typed rejection（節點啟動的五種拒絕碼 + Chain 中止）各一案例。
//   * 每一條宣稱的不變量各一案例。
//   * 冪等 no-op 逐一釘住「重跑一次結果相同」，而不只是斷言 accepted。
//   * **Job 重排**逐分支釘住：npcDecisionDue 的每一條返回路徑都恰好重排一筆（Controller 不存在
//     時例外，且該例外本身也有測試），否則該 NPC 會永遠停止思考。
//   * RNG：同 seed + 同 cursor → 同決策；cursor 逐次前進不重用 0。
//   * 資料驅動：同一份程式碼配 pack A / pack B 產生**不同**決策。

import type {
  RngCursor,
  TransactionMessageDraft,
  WorldDay,
} from '../../contracts/core';
import type {
  NpcActionChain,
  NpcBehaviorDomainEvent,
  NpcChainAdvanceJob,
  NpcDecisionDueJob,
} from '../../contracts/npc-behavior';
import type {
  StartNpcTeamPlanPayload,
  TeamMemberDepartedEvent,
  TeamPlanCompletedEvent,
} from '../../contracts/team';

import type { NpcBehaviorContext, NpcBehaviorHandlerResult } from './system';
import {
  NPC_BEHAVIOR_MODULE_ID,
  npcChainAdvance,
  npcDecisionDue,
  onTeamMemberDeparted,
  onTeamPlanCompleted,
} from './system';
import { createNpcBehaviorQuery } from './queries';
import { activeChainForTeam, createNpcBehaviorState, tryGetChain, tryGetController } from './state';
import type { FixtureDefinitions } from './fixtures';
import {
  FIXTURE,
  definitionsPackA,
  definitionsPackB,
  fixtureState,
  makeContext,
  overridePolicy,
  stubConditionPort,
  stubDefinitionReader,
  stubResolverPort,
  stubTeamPort,
  stubRngContext,
  withTravelDestinationResolver,
} from './fixtures';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────────
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eventsOf(messages: readonly TransactionMessageDraft[]): NpcBehaviorDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as NpcBehaviorDomainEvent);
}

function commandsOf(
  messages: readonly TransactionMessageDraft[],
): readonly StartNpcTeamPlanPayload[] {
  return messages
    .filter((m): m is { targetModule: never; command: unknown } => 'command' in m)
    .map((m) => m.command as StartNpcTeamPlanPayload);
}

function findEvent<T extends NpcBehaviorDomainEvent['type']>(
  events: readonly NpcBehaviorDomainEvent[],
  type: T,
): Extract<NpcBehaviorDomainEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<NpcBehaviorDomainEvent, { type: T }> => e.type === type);
}

function expectAccepted(result: NpcBehaviorHandlerResult, msg: string) {
  assert(result.ok, `${msg}（實得 rejection ${result.ok ? '' : result.rejection.code}）`);
  if (!result.ok) throw new Error(msg);
  return result.result;
}

function decisionJob(
  overrides: Partial<{ policyId: NpcDecisionDueJob['payload']['policyId']; dueDay: WorldDay }> = {},
): NpcDecisionDueJob {
  return {
    jobId: 'runtime:job:decision-1' as NpcDecisionDueJob['jobId'],
    type: 'npcDecisionDue',
    dueDay: overrides.dueDay ?? (100 as WorldDay),
    ownerModule: NPC_BEHAVIOR_MODULE_ID,
    targetId: FIXTURE.npcTeamId,
    payload: { policyId: overrides.policyId ?? FIXTURE.policyA },
  };
}

function advanceJob(chain: NpcActionChain): NpcChainAdvanceJob {
  return {
    jobId: 'runtime:job:advance-1' as NpcChainAdvanceJob['jobId'],
    type: 'npcChainAdvance',
    dueDay: 101 as WorldDay,
    ownerModule: NPC_BEHAVIOR_MODULE_ID,
    targetId: chain.teamId,
    rngContext: chain.rngContext,
    payload: { chainId: chain.chainId },
  };
}

function readerFor(defs: FixtureDefinitions) {
  return stubDefinitionReader(defs);
}

// 走一次「抽選 → 啟動旅行節點」，回傳結果與推進後的 state（多個案例共用的起點）。
function runFirstDecision(
  overrides: Partial<{ ctx: NpcBehaviorContext; state: ReturnType<typeof fixtureState> }> = {},
) {
  const ctx = overrides.ctx ?? makeContext();
  const state = overrides.state ?? fixtureState();
  const result = expectAccepted(npcDecisionDue(state, decisionJob(), ctx), '首次抽選應被接受');
  return { ctx, result };
}

// ── 案例 ─────────────────────────────────────────────────────────────────────

const cases: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'npcDecisionDue accept：pack A 依權重抽中 travelToCity，建立 Chain、啟動旅行 Plan、重排下一筆決策',
    run: () => {
      const { ctx, result } = runFirstDecision();
      const events = eventsOf(result.outgoingMessages);

      const intent = findEvent(events, 'NpcIntentSelected');
      assert(intent !== undefined, '應 emit NpcIntentSelected');
      assert(
        intent?.intentKind === 'travelToCity',
        `pack A 的 travel 權重最高，應抽中 travelToCity（實得 ${String(intent?.intentKind)}）`,
      );
      assert(intent?.onDay === 100, `onDay 應為當前世界日（實得 ${String(intent?.onDay)}）`);

      const changed = findEvent(events, 'NpcActionChainChanged');
      assert(changed?.status === 'active', `Chain 應為 active（實得 ${String(changed?.status)}）`);
      assert(changed?.currentNodeIndex === 0, '應停在第 0 節等執行者回報');

      const commands = commandsOf(result.outgoingMessages);
      assert(commands.length === 1, `應恰好送出一筆 Internal Command（實得 ${commands.length}）`);
      const plan = commands[0]!;
      assert(plan.type === 'StartNpcTeamPlan', 'Plan 命令應送給 team 的 StartNpcTeamPlan');
      assert(plan.kind === 'cityTravel', `Plan kind 應為 cityTravel（實得 ${plan.kind}）`);
      assert(plan.payload.kind === 'cityTravel', 'payload 判別欄應為 cityTravel');
      if (plan.payload.kind !== 'cityTravel') return;
      const travel = plan.payload.travel;
      assert(travel.kind === 'npcTravel', `旅行 payload 應為 npcTravel（實得 ${travel.kind}）`);
      if (travel.kind !== 'npcTravel') return;
      assert(travel.fromCityId === FIXTURE.cityHome, '出發城市應取自 TeamPort');
      assert(travel.toCityId === FIXTURE.cityNorth, 'pack A 的目的地 Resolver 指向北城');
      assert(travel.routeId === FIXTURE.routeNorth, '路線應取自 WorldPort 的最短路徑');
      assert(travel.npcTravelRuleId === FIXTURE.travelRule, 'npcTravelRuleId 應取自 Decision Policy');
      // durationDays=6 來自 NpcTravelRuleDefinition：抵達日 = 100 + 6。
      assert(travel.arrivalDay === 106, `抵達日應為 106（實得 ${travel.arrivalDay}）`);

      // 重排：每一條返回路徑恰好一筆 npcDecisionDue。
      const jobs = result.scheduledJobs;
      assert(jobs.length === 1, `應恰好重排一筆 Job（實得 ${jobs.length}）`);
      assert(jobs[0]!.type === 'npcDecisionDue', '重排的應是 npcDecisionDue');
      // reviewIntervalDays=30（pack A）→ 100 + 30。
      assert(jobs[0]!.dueDay === 130, `重排日應為 100 + reviewIntervalDays(30)（實得 ${jobs[0]!.dueDay}）`);

      const chain = activeChainForTeam(result.nextSlice, FIXTURE.npcTeamId);
      assert(chain !== undefined, 'Controller 應指向新建立的 active Chain');
      assert(chain?.nodes.length === 2, 'travel 模板有 2 節（travelToCity + complete）');
      assert(chain?.nodes[0]?.status === 'running', '第 0 節應為 running（等執行者）');
      assert(chain?.nodes[1]?.status === 'waiting', '第 1 節仍為 waiting');
      assert(chain?.source === 'autonomous', '自主抽選的 Chain source 應為 autonomous');
      assert(ctx.worldDay === 100, '前置：本案例以世界日 100 執行');
    },
  },
  {
    name: '不變量 11：NPC 旅行 payload 不含玩家旅行模式或事件欄位',
    run: () => {
      const { result } = runFirstDecision();
      const plan = commandsOf(result.outgoingMessages)[0]!;
      if (plan.payload.kind !== 'cityTravel') throw new Error('應為 cityTravel');
      const travel = plan.payload.travel as unknown as Record<string, unknown>;
      for (const forbidden of ['modeId', 'segmentIndex', 'nextSegmentDay', 'eventInstance']) {
        assert(!(forbidden in travel), `NPC 旅行 payload 不得含 ${forbidden}`);
      }
    },
  },
  {
    name: 'RNG 決定性：同 seed + 同 cursor 兩次執行得到完全相同的決策與抵達日',
    run: () => {
      const first = runFirstDecision({ ctx: makeContext() });
      const second = runFirstDecision({ ctx: makeContext() });
      const a = findEvent(eventsOf(first.result.outgoingMessages), 'NpcIntentSelected');
      const b = findEvent(eventsOf(second.result.outgoingMessages), 'NpcIntentSelected');
      assert(a?.intentKind === b?.intentKind, '同 seed/cursor 應抽中同一個意圖');
      const pa = commandsOf(first.result.outgoingMessages)[0]!;
      const pb = commandsOf(second.result.outgoingMessages)[0]!;
      assert(
        JSON.stringify(pa) === JSON.stringify(pb),
        '同 seed/cursor 應送出完全相同的 Plan 命令',
      );
      assert(
        first.result.scheduledJobs[0]!.dueDay === second.result.scheduledJobs[0]!.dueDay,
        '重排日也應相同',
      );
    },
  },
  {
    name: 'RNG cursor 逐次前進：Resolver 前進的 cursor 被顯式續接，重排 Job 與 Chain 快照都不重用 cursor 0',
    run: () => {
      const ctx = makeContext({
        resolvers: stubResolverPort({ weightUsesRng: true }),
        rngContext: stubRngContext(0),
      });
      const { result } = runFirstDecision({ ctx });
      const chain = activeChainForTeam(result.nextSlice, FIXTURE.npcTeamId);
      const chainCursor = chain?.rngContext.cursor as unknown as number;
      // 兩個候選各前進 1（weightUsesRng）＋ 加權抽選前進 1 → cursor 至少為 3。
      assert(chainCursor >= 3, `Chain 快照 cursor 應已前進（實得 ${String(chainCursor)}）`);
      const jobCursor = result.scheduledJobs[0]!.rngContext?.cursor as unknown as number;
      assert(jobCursor !== undefined && jobCursor > 0, '重排的 Job 不得回頭使用 cursor 0');
      assert(jobCursor >= chainCursor, '重排 Job 的 cursor 應延續本次執行的最終位置');
    },
  },
  {
    name: '資料驅動：pack B（權重相反）抽中的意圖與 pack A 不同——換 Content Pack 就換行為',
    run: () => {
      const ctxA = makeContext();
      const resultA = expectAccepted(
        npcDecisionDue(fixtureState({ policyId: FIXTURE.policyA }), decisionJob(), ctxA),
        'pack A 應被接受',
      );
      const intentA = findEvent(eventsOf(resultA.outgoingMessages), 'NpcIntentSelected');

      const ctxB = makeContext({ definitions: readerFor(definitionsPackB()) });
      const resultB = expectAccepted(
        npcDecisionDue(
          fixtureState({ policyId: FIXTURE.policyB }),
          decisionJob({ policyId: FIXTURE.policyB }),
          ctxB,
        ),
        'pack B 應被接受',
      );
      const intentB = findEvent(eventsOf(resultB.outgoingMessages), 'NpcIntentSelected');

      assert(intentA?.intentKind === 'travelToCity', 'pack A 應抽中 travelToCity');
      assert(
        intentB?.intentKind === 'enterNearbyAdventureMap',
        `pack B 應抽中 enterNearbyAdventureMap（實得 ${String(intentB?.intentKind)}）`,
      );
      // pack B 抽中的節點執行者尚未閉合 → Chain 立即中止 → 次日重抽（不是走複審週期）。
      assert(
        resultB.scheduledJobs[0]!.dueDay === 101,
        `pack B 的 Chain 中止後應次日重抽（實得 ${resultB.scheduledJobs[0]!.dueDay}）`,
      );

      // 複審週期也是資料：同一條「Job 過期 → 以 State 為權威重排」的路徑下，
      // pack A 排到 100+30，pack B 排到 100+10。
      const staleA = expectAccepted(
        npcDecisionDue(
          fixtureState({ policyId: FIXTURE.policyA }),
          decisionJob({ policyId: FIXTURE.policyB }),
          ctxA,
        ),
        '過期 Job 應被接受',
      );
      const staleB = expectAccepted(
        npcDecisionDue(
          fixtureState({ policyId: FIXTURE.policyB }),
          decisionJob({ policyId: FIXTURE.policyA }),
          ctxB,
        ),
        '過期 Job 應被接受',
      );
      assert(
        staleA.scheduledJobs[0]!.dueDay === 130,
        `pack A 的 reviewIntervalDays=30（實得 ${staleA.scheduledJobs[0]!.dueDay}）`,
      );
      assert(
        staleB.scheduledJobs[0]!.dueDay === 110,
        `pack B 的 reviewIntervalDays=10（實得 ${staleB.scheduledJobs[0]!.dueDay}）`,
      );
    },
  },
  {
    name: '資料驅動：條件不成立的候選被排除，改用資料指定的 fallback 模板（intentKind 由 purpose 導出）',
    run: () => {
      const ctx = makeContext({
        conditions: stubConditionPort([]), // 沒有任何條件成立 → 候選池為空
        definitions: readerFor(
          overridePolicy(definitionsPackA(), FIXTURE.policyA, {
            fallbackChainTemplateId: FIXTURE.templateTravelSouth,
          }),
        ),
      });
      const { result } = runFirstDecision({ ctx });
      const intent = findEvent(eventsOf(result.outgoingMessages), 'NpcIntentSelected');
      assert(intent?.intentKind === 'travelToCity', 'fallback 模板 purpose=travel → travelToCity');
      const plan = commandsOf(result.outgoingMessages)[0]!;
      if (plan.payload.kind !== 'cityTravel' || plan.payload.travel.kind !== 'npcTravel') {
        throw new Error('應為 npcTravel');
      }
      assert(
        plan.payload.travel.toCityId === FIXTURE.citySouth,
        'fallback 模板的目的地 Resolver 指向南城',
      );
    },
  },
  {
    name: '資料錯誤：fallback 模板 purpose=free（自由活動）→ 明確拋錯，不代它挑一個工作',
    run: () => {
      const ctx = makeContext({
        conditions: stubConditionPort([]),
        definitions: readerFor(
          overridePolicy(definitionsPackA(), FIXTURE.policyA, {
            fallbackChainTemplateId: FIXTURE.templateFree,
          }),
        ),
      });
      let threw = false;
      try {
        npcDecisionDue(fixtureState(), decisionJob(), ctx);
      } catch {
        threw = true;
      }
      assert(threw, 'fallback 指向自由活動是內容錯誤，應明確失敗');
    },
  },
  {
    name: '權重非正的候選不入池：唯一候選權重為 0 → 走 fallback',
    run: () => {
      const ctx = makeContext({
        resolvers: stubResolverPort({
          weights: {
            [FIXTURE.weightTravelHigh]: 0,
            [FIXTURE.weightAdventureLow]: 0,
          },
        }),
        definitions: readerFor(
          overridePolicy(definitionsPackA(), FIXTURE.policyA, {
            fallbackChainTemplateId: FIXTURE.templateTravelSouth,
          }),
        ),
      });
      const { result } = runFirstDecision({ ctx });
      const plan = commandsOf(result.outgoingMessages)[0]!;
      if (plan.payload.kind !== 'cityTravel' || plan.payload.travel.kind !== 'npcTravel') {
        throw new Error('應為 npcTravel');
      }
      assert(plan.payload.travel.toCityId === FIXTURE.citySouth, '權重全為 0 應落到 fallback 模板');
    },
  },
  {
    name: 'Job 重排：Controller 不存在 → 冪等 no-op 且**不**重排（沒有可思考的主體）',
    run: () => {
      const empty = createNpcBehaviorState();
      const first = expectAccepted(npcDecisionDue(empty, decisionJob(), makeContext()), '應被接受');
      assert(first.scheduledJobs.length === 0, 'Controller 不存在時不得重排');
      assert(first.outgoingMessages.length === 0, '不得送出任何訊息');
      // 冪等：再跑一次結果相同。
      const second = expectAccepted(
        npcDecisionDue(first.nextSlice, decisionJob(), makeContext()),
        '第二次仍應被接受',
      );
      assert(
        JSON.stringify(second.nextSlice) === JSON.stringify(first.nextSlice),
        'no-op 應為冪等（Slice 不變）',
      );
      assert(second.scheduledJobs.length === 0, '第二次也不得重排');
    },
  },
  {
    name: 'Job 重排：已有 active Chain → 本次不抽，但仍重排一筆（Chain 卡住時 NPC 不會停止思考）',
    run: () => {
      const { result: first } = runFirstDecision();
      const ctx = makeContext();
      const second = expectAccepted(
        npcDecisionDue(first.nextSlice, decisionJob(), ctx),
        '第二次應被接受',
      );
      assert(
        eventsOf(second.outgoingMessages).length === 0,
        '已有 active Chain 時不得再抽（不得 emit NpcIntentSelected）',
      );
      assert(commandsOf(second.outgoingMessages).length === 0, '不得再送 Plan 命令');
      assert(second.scheduledJobs.length === 1, '必須重排一筆 npcDecisionDue');
      assert(second.scheduledJobs[0]!.type === 'npcDecisionDue', '重排的應是 npcDecisionDue');
    },
  },
  {
    name: '不變量 1：一支 NPC Team 至多一個 active Chain（第二次抽選不會產生第二條）',
    run: () => {
      const { result: first } = runFirstDecision();
      const second = expectAccepted(
        npcDecisionDue(first.nextSlice, decisionJob(), makeContext()),
        '第二次應被接受',
      );
      const chainIds = Object.keys(second.nextSlice.chains);
      assert(chainIds.length === 1, `應只有一條 Chain（實得 ${chainIds.length}）`);
      const active = chainIds.filter(
        (id) => second.nextSlice.chains[id as keyof typeof second.nextSlice.chains]?.status === 'active',
      );
      assert(active.length === 1, `active Chain 應恰好一條（實得 ${active.length}）`);
    },
  },
  {
    name: 'Job 重排：強制自由期未結束（worldDay < nextDecisionOnDay）→ 不抽，重排到最早可抽日',
    run: () => {
      const state = fixtureState({ nextDecisionOnDay: 105 as WorldDay });
      const result = expectAccepted(
        npcDecisionDue(state, decisionJob(), makeContext({ worldDay: 100 as WorldDay })),
        '應被接受',
      );
      assert(eventsOf(result.outgoingMessages).length === 0, '自由期內不得抽選');
      assert(result.scheduledJobs.length === 1, '必須重排一筆');
      assert(
        result.scheduledJobs[0]!.dueDay === 105,
        `應重排到 nextDecisionOnDay=105（實得 ${result.scheduledJobs[0]!.dueDay}）`,
      );
    },
  },
  {
    name: 'Job 重排：Job payload 的 policyId 與 Controller 不符（Policy 被換掉）→ 以 State 為權威重排',
    run: () => {
      const state = fixtureState({ policyId: FIXTURE.policyA });
      const result = expectAccepted(
        npcDecisionDue(state, decisionJob({ policyId: FIXTURE.policyB }), makeContext()),
        '應被接受',
      );
      assert(eventsOf(result.outgoingMessages).length === 0, '過期 Job 不得抽選');
      assert(result.scheduledJobs.length === 1, '必須重排一筆');
      const rearmed = result.scheduledJobs[0]! as unknown as NpcDecisionDueJob;
      assert(
        rearmed.payload.policyId === FIXTURE.policyA,
        '重排的 Job 應帶 Controller 目前的 policyId',
      );
    },
  },
  {
    name: 'Job 重排：隊伍沒有正式成員 → 不抽工作，但保留 Controller 並重排',
    run: () => {
      const ctx = makeContext({
        team: stubTeamPort({ membersByTeam: { [FIXTURE.npcTeamId]: [] } }),
      });
      const result = expectAccepted(npcDecisionDue(fixtureState(), decisionJob(), ctx), '應被接受');
      assert(eventsOf(result.outgoingMessages).length === 0, '無成員時不得抽選');
      assert(result.scheduledJobs.length === 1, '必須重排一筆');
      assert(
        tryGetController(result.nextSlice, FIXTURE.npcTeamId) !== undefined,
        'Controller 應保留（成員可能被補回）',
      );
    },
  },
  {
    name: '不變量 1（另一半）：玩家 Team 持有 Controller → 明確失敗，不靜默代打',
    run: () => {
      const ctx = makeContext({ team: stubTeamPort({ npcTeamIds: [] }) });
      let threw = false;
      try {
        npcDecisionDue(fixtureState(), decisionJob(), ctx);
      } catch {
        threw = true;
      }
      assert(threw, '非 npc 控制的隊伍不得持有 Controller');
    },
  },
  {
    name: 'rejection：旅行節點在隊伍不在城市時 → teamNotInCity，Chain 以理由碼中止並次日重抽',
    run: () => {
      const ctx = makeContext({
        team: stubTeamPort({ cityByTeam: { [FIXTURE.npcTeamId]: undefined } }),
      });
      const result = expectAccepted(npcDecisionDue(fixtureState(), decisionJob(), ctx), '應被接受');
      const changed = findEvent(eventsOf(result.outgoingMessages), 'NpcActionChainChanged');
      assert(changed?.status === 'aborted', `Chain 應中止（實得 ${String(changed?.status)}）`);
      assert(
        changed?.reason === 'npcBehavior.travelNode.teamNotInCity',
        `理由碼應為 teamNotInCity（實得 ${String(changed?.reason)}）`,
      );
      assert(commandsOf(result.outgoingMessages).length === 0, '中止時不得送出 Plan 命令');
      const controller = tryGetController(result.nextSlice, FIXTURE.npcTeamId)!;
      assert(controller.activeChainId === undefined, '中止後應解除 Chain 鎖定');
      assert(controller.nextDecisionOnDay === 101, '中止後次日重抽');
      const chain = Object.values(result.nextSlice.chains)[0]!;
      assert(chain.nodes[0]!.status === 'failed', '失敗節點應標為 failed（不留永久 waiting）');
    },
  },
  {
    name: 'rejection：目的地 Resolver 無結果 → destinationUnavailable',
    run: () => {
      const ctx = makeContext({
        definitions: readerFor(withTravelDestinationResolver(definitionsPackA(), FIXTURE.destNone)),
      });
      const result = expectAccepted(npcDecisionDue(fixtureState(), decisionJob(), ctx), '應被接受');
      const changed = findEvent(eventsOf(result.outgoingMessages), 'NpcActionChainChanged');
      assert(
        changed?.reason === 'npcBehavior.travelNode.destinationUnavailable',
        `實得 ${String(changed?.reason)}`,
      );
    },
  },
  {
    name: 'rejection：目的地不在相鄰一格內 → destinationNotAdjacent（不變量 11 的單段直達前提）',
    run: () => {
      const ctx = makeContext({
        definitions: readerFor(withTravelDestinationResolver(definitionsPackA(), FIXTURE.destFar)),
      });
      const result = expectAccepted(npcDecisionDue(fixtureState(), decisionJob(), ctx), '應被接受');
      const changed = findEvent(eventsOf(result.outgoingMessages), 'NpcActionChainChanged');
      assert(
        changed?.reason === 'npcBehavior.travelNode.destinationNotAdjacent',
        `實得 ${String(changed?.reason)}`,
      );
    },
  },
  {
    name: 'rejection：相鄰城市但 World 查不到單一 Route → routeUnavailable',
    run: () => {
      const ctx = makeContext({
        definitions: readerFor(withTravelDestinationResolver(definitionsPackA(), FIXTURE.destNorth)),
        world: {
          listCitiesWithinHops: () => [FIXTURE.cityHome, FIXTURE.cityNorth],
          getShortestRoute: () => undefined,
        },
      });
      const result = expectAccepted(npcDecisionDue(fixtureState(), decisionJob(), ctx), '應被接受');
      const changed = findEvent(eventsOf(result.outgoingMessages), 'NpcActionChainChanged');
      assert(
        changed?.reason === 'npcBehavior.travelNode.routeUnavailable',
        `實得 ${String(changed?.reason)}`,
      );
    },
  },
  {
    name: 'rejection：節點 kind 的執行者尚未閉合（executeNearbyAdventure）→ kindNotAvailable，不假裝跑掉了',
    run: () => {
      const ctx = makeContext({ definitions: readerFor(definitionsPackB()) });
      const result = expectAccepted(
        npcDecisionDue(
          fixtureState({ policyId: FIXTURE.policyB }),
          decisionJob({ policyId: FIXTURE.policyB }),
          ctx,
        ),
        '應被接受',
      );
      const changed = findEvent(eventsOf(result.outgoingMessages), 'NpcActionChainChanged');
      assert(changed?.status === 'aborted', 'Chain 應中止');
      assert(
        changed?.reason === 'npcBehavior.node.kindNotAvailable',
        `理由碼應指出 kind 未閉合（實得 ${String(changed?.reason)}）`,
      );
      assert(commandsOf(result.outgoingMessages).length === 0, '不得送出任何 Plan 命令');
    },
  },
  {
    name: 'onTeamPlanCompleted accept：認回自己的 Plan → 節點標完成、記 linkedPlanId、登記次日 npcChainAdvance',
    run: () => {
      const { result: first } = runFirstDecision();
      const chain = activeChainForTeam(first.nextSlice, FIXTURE.npcTeamId)!;
      const event: TeamPlanCompletedEvent = {
        type: 'TeamPlanCompleted',
        teamId: FIXTURE.npcTeamId,
        planId: 'runtime:team-plan:travel-1' as TeamPlanCompletedEvent['planId'],
        kind: 'cityTravel',
        payload: { kind: 'cityFree' },
      };
      const res = onTeamPlanCompleted(first.nextSlice, event, makeContext({ worldDay: 106 as WorldDay }));
      const updated = tryGetChain(res.nextSlice, chain.chainId)!;
      assert(updated.nodes[0]!.status === 'completed', '旅行節點應標為 completed');
      assert(
        updated.nodes[0]!.linkedPlanId === event.planId,
        'linkedPlanId 應記下實際執行的 TeamPlanId',
      );
      assert(res.scheduledJobs.length === 1, '應登記一筆 npcChainAdvance');
      assert(res.scheduledJobs[0]!.type === 'npcChainAdvance', 'Job 型別應為 npcChainAdvance');
      assert(
        res.scheduledJobs[0]!.dueDay === 107,
        `應登記次日（106 + 1，實得 ${res.scheduledJobs[0]!.dueDay}）`,
      );
    },
  },
  {
    name: 'onTeamPlanCompleted 冪等 no-op：不是本模組要求的 Plan kind（cityFree 強制自由期）→ 不動 Slice',
    run: () => {
      const { result: first } = runFirstDecision();
      const event: TeamPlanCompletedEvent = {
        type: 'TeamPlanCompleted',
        teamId: FIXTURE.npcTeamId,
        planId: 'runtime:team-plan:free-1' as TeamPlanCompletedEvent['planId'],
        kind: 'cityFree',
        payload: { kind: 'cityFree' },
      };
      const ctx = makeContext();
      const once = onTeamPlanCompleted(first.nextSlice, event, ctx);
      assert(
        JSON.stringify(once.nextSlice) === JSON.stringify(first.nextSlice),
        '非本節點的 Plan 不得改動 Slice',
      );
      assert(once.scheduledJobs.length === 0, '不得登記推進 Job');
      const twice = onTeamPlanCompleted(once.nextSlice, event, ctx);
      assert(
        JSON.stringify(twice.nextSlice) === JSON.stringify(once.nextSlice),
        'no-op 應為冪等',
      );
    },
  },
  {
    name: 'onTeamPlanCompleted no-op：沒有 active Chain 的隊伍（玩家隊）→ 不動 Slice',
    run: () => {
      const state = createNpcBehaviorState();
      const event: TeamPlanCompletedEvent = {
        type: 'TeamPlanCompleted',
        teamId: FIXTURE.playerTeamId,
        planId: 'runtime:team-plan:player-1' as TeamPlanCompletedEvent['planId'],
        kind: 'cityTravel',
        payload: { kind: 'cityFree' },
      };
      const res = onTeamPlanCompleted(state, event, makeContext());
      assert(JSON.stringify(res.nextSlice) === JSON.stringify(state), '玩家隊的 Plan 不得影響本 Slice');
      assert(res.scheduledJobs.length === 0, '不得登記 Job');
    },
  },
  {
    name: 'npcChainAdvance accept：節點完成 → 推進到 complete 節點 → Chain 收斂 + 抽 2～7 日強制自由期 + cityFree Plan（不變量 10）',
    run: () => {
      const { result: first } = runFirstDecision();
      const chain = activeChainForTeam(first.nextSlice, FIXTURE.npcTeamId)!;
      const ctx = makeContext({ worldDay: 106 as WorldDay });
      const completed = onTeamPlanCompleted(
        first.nextSlice,
        {
          type: 'TeamPlanCompleted',
          teamId: FIXTURE.npcTeamId,
          planId: 'runtime:team-plan:travel-1' as TeamPlanCompletedEvent['planId'],
          kind: 'cityTravel',
          payload: { kind: 'cityFree' },
        },
        ctx,
      );
      const advanceCtx = makeContext({ worldDay: 107 as WorldDay });
      const chainNow = tryGetChain(completed.nextSlice, chain.chainId)!;
      const res = expectAccepted(
        npcChainAdvance(completed.nextSlice, advanceJob(chainNow), advanceCtx),
        '推進應被接受',
      );

      const final = tryGetChain(res.nextSlice, chain.chainId)!;
      assert(final.status === 'completed', `Chain 應完成（實得 ${final.status}）`);
      assert(final.nodes[1]!.status === 'completed', 'complete 節點應標為 completed');

      const changed = findEvent(eventsOf(res.outgoingMessages), 'NpcActionChainChanged');
      assert(changed?.status === 'completed', ' 應 emit status=completed');

      const commands = commandsOf(res.outgoingMessages);
      assert(commands.length === 1, `應送出一筆強制自由期 Plan（實得 ${commands.length}）`);
      assert(commands[0]!.kind === 'cityFree', '強制自由期應是 cityFree Plan');

      const controller = tryGetController(res.nextSlice, FIXTURE.npcTeamId)!;
      assert(controller.activeChainId === undefined, '完成後應解除 Chain 鎖定');
      const free = controller.nextDecisionOnDay - 107;
      assert(free >= 2 && free <= 7, `強制自由期應在資料範圍 2～7 日內（實得 ${free}）`);
      assert(res.scheduledJobs.length === 0, 'npcChainAdvance 不負責重排決策 Job（單一時間線）');
    },
  },
  {
    name: '不變量 10（資料化）：pack B 的 forcedFreeDurationDays={3,3} → 自由期恰為 3 日',
    run: () => {
      const defs = readerFor(
        overridePolicy(definitionsPackB(), FIXTURE.policyB, {
          candidates: [],
          fallbackChainTemplateId: FIXTURE.templateTravelSouth,
        }),
      );
      const ctx = makeContext({ definitions: defs, conditions: stubConditionPort([]) });
      const first = expectAccepted(
        npcDecisionDue(
          fixtureState({ policyId: FIXTURE.policyB }),
          decisionJob({ policyId: FIXTURE.policyB }),
          ctx,
        ),
        '應被接受',
      );
      const chain = activeChainForTeam(first.nextSlice, FIXTURE.npcTeamId)!;
      const completed = onTeamPlanCompleted(
        first.nextSlice,
        {
          type: 'TeamPlanCompleted',
          teamId: FIXTURE.npcTeamId,
          planId: 'runtime:team-plan:travel-b' as TeamPlanCompletedEvent['planId'],
          kind: 'cityTravel',
          payload: { kind: 'cityFree' },
        },
        makeContext({ definitions: defs, worldDay: 106 as WorldDay }),
      );
      const res = expectAccepted(
        npcChainAdvance(
          completed.nextSlice,
          advanceJob(tryGetChain(completed.nextSlice, chain.chainId)!),
          makeContext({ definitions: defs, worldDay: 107 as WorldDay }),
        ),
        '推進應被接受',
      );
      const controller = tryGetController(res.nextSlice, FIXTURE.npcTeamId)!;
      assert(
        controller.nextDecisionOnDay === 110,
        `pack B 的自由期固定 3 日 → 107 + 3（實得 ${controller.nextDecisionOnDay}）`,
      );
    },
  },
  {
    name: '多節點 Chain：cityFree → travelToCity 依序啟動，每節都送出對應的 Plan 命令',
    run: () => {
      const defs = overridePolicy(definitionsPackA(), FIXTURE.policyA, {
        fallbackChainTemplateId: FIXTURE.templateFreeThenTravel,
      });
      const ctx = makeContext({ definitions: readerFor(defs), conditions: stubConditionPort([]) });
      const first = expectAccepted(npcDecisionDue(fixtureState(), decisionJob(), ctx), '應被接受');
      const chain = activeChainForTeam(first.nextSlice, FIXTURE.npcTeamId)!;
      assert(chain.nodes.length === 3, 'free-then-travel 模板有 3 節');
      assert(chain.nodes[0]!.kind === 'cityFree', '第 0 節為 cityFree');
      assert(commandsOf(first.outgoingMessages)[0]!.kind === 'cityFree', '第 0 節應送 cityFree Plan');

      const advanceCtx = makeContext({ definitions: readerFor(defs), worldDay: 103 as WorldDay });
      const completed = onTeamPlanCompleted(
        first.nextSlice,
        {
          type: 'TeamPlanCompleted',
          teamId: FIXTURE.npcTeamId,
          planId: 'runtime:team-plan:free-a' as TeamPlanCompletedEvent['planId'],
          kind: 'cityFree',
          payload: { kind: 'cityFree' },
        },
        advanceCtx,
      );
      const res = expectAccepted(
        npcChainAdvance(
          completed.nextSlice,
          advanceJob(tryGetChain(completed.nextSlice, chain.chainId)!),
          makeContext({ definitions: readerFor(defs), worldDay: 104 as WorldDay }),
        ),
        '推進應被接受',
      );
      const updated = tryGetChain(res.nextSlice, chain.chainId)!;
      assert(updated.currentNodeIndex === 1, '游標應推進到第 1 節');
      assert(updated.nodes[1]!.status === 'running', '第 1 節（旅行）應為 running');
      const plan = commandsOf(res.outgoingMessages)[0]!;
      assert(plan.kind === 'cityTravel', '第 1 節應送 cityTravel Plan');
    },
  },
  {
    name: 'npcChainAdvance 冪等 no-op：Chain 已收斂 → 不動 Slice、不排任何 Job（重跑結果相同）',
    run: () => {
      const { result: first } = runFirstDecision({
        ctx: makeContext({ team: stubTeamPort({ cityByTeam: { [FIXTURE.npcTeamId]: undefined } }) }),
      });
      const chain = Object.values(first.nextSlice.chains)[0]!;
      assert(chain.status === 'aborted', '前置：Chain 已中止');
      const ctx = makeContext();
      const once = expectAccepted(npcChainAdvance(first.nextSlice, advanceJob(chain), ctx), '應被接受');
      assert(
        JSON.stringify(once.nextSlice) === JSON.stringify(first.nextSlice),
        '已收斂 Chain 不得再被改動',
      );
      assert(once.scheduledJobs.length === 0, '不得排 Job');
      const twice = expectAccepted(npcChainAdvance(once.nextSlice, advanceJob(chain), ctx), '應被接受');
      assert(JSON.stringify(twice.nextSlice) === JSON.stringify(once.nextSlice), 'no-op 應為冪等');
    },
  },
  {
    name: 'npcChainAdvance 冪等 no-op：節點仍在 running → 不動 Slice、不重排（等執行者的事件）',
    run: () => {
      const { result: first } = runFirstDecision();
      const chain = activeChainForTeam(first.nextSlice, FIXTURE.npcTeamId)!;
      const ctx = makeContext({ worldDay: 102 as WorldDay });
      const once = expectAccepted(npcChainAdvance(first.nextSlice, advanceJob(chain), ctx), '應被接受');
      assert(
        JSON.stringify(once.nextSlice) === JSON.stringify(first.nextSlice),
        'running 節點不得被推進',
      );
      assert(once.scheduledJobs.length === 0, '不得重排（否則會形成第二條時間線）');
      const twice = expectAccepted(npcChainAdvance(once.nextSlice, advanceJob(chain), ctx), '應被接受');
      assert(JSON.stringify(twice.nextSlice) === JSON.stringify(once.nextSlice), 'no-op 應為冪等');
    },
  },
  {
    name: 'npcChainAdvance rejection 路徑：隊伍已無正式成員 → Chain 以 noFormalMembers 中止',
    run: () => {
      const { result: first } = runFirstDecision();
      const chain = activeChainForTeam(first.nextSlice, FIXTURE.npcTeamId)!;
      const ctx = makeContext({
        worldDay: 106 as WorldDay,
        team: stubTeamPort({ membersByTeam: { [FIXTURE.npcTeamId]: [] } }),
      });
      const res = expectAccepted(npcChainAdvance(first.nextSlice, advanceJob(chain), ctx), '應被接受');
      const changed = findEvent(eventsOf(res.outgoingMessages), 'NpcActionChainChanged');
      assert(changed?.status === 'aborted', 'Chain 應中止');
      assert(
        changed?.reason === 'npcBehavior.chain.noFormalMembers',
        `實得 ${String(changed?.reason)}`,
      );
      const controller = tryGetController(res.nextSlice, FIXTURE.npcTeamId)!;
      assert(controller.nextDecisionOnDay === 107, '中止後次日重抽');
    },
  },
  {
    name: 'onTeamMemberDeparted accept：最後一名正式成員離隊 → 中止 Chain 並解除鎖定',
    run: () => {
      const { result: first } = runFirstDecision();
      const event: TeamMemberDepartedEvent = {
        type: 'TeamMemberDeparted',
        teamId: FIXTURE.npcTeamId,
        characterId: FIXTURE.memberA,
        reason: 'unavailable',
      };
      const ctx = makeContext({
        worldDay: 103 as WorldDay,
        team: stubTeamPort({ membersByTeam: { [FIXTURE.npcTeamId]: [] } }),
      });
      const res = onTeamMemberDeparted(first.nextSlice, event, ctx);
      const changed = findEvent(eventsOf(res.outgoingMessages), 'NpcActionChainChanged');
      assert(changed?.status === 'aborted', 'Chain 應中止');
      assert(
        changed?.reason === 'npcBehavior.chain.noFormalMembers',
        `實得 ${String(changed?.reason)}`,
      );
      assert(
        tryGetController(res.nextSlice, FIXTURE.npcTeamId)!.activeChainId === undefined,
        '應解除 Chain 鎖定',
      );
    },
  },
  {
    name: 'onTeamMemberDeparted 冪等 no-op：仍有正式成員 → 不動 Slice',
    run: () => {
      const { result: first } = runFirstDecision();
      const event: TeamMemberDepartedEvent = {
        type: 'TeamMemberDeparted',
        teamId: FIXTURE.npcTeamId,
        characterId: FIXTURE.memberB,
        reason: 'dismissed',
      };
      const ctx = makeContext();
      const once = onTeamMemberDeparted(first.nextSlice, event, ctx);
      assert(
        JSON.stringify(once.nextSlice) === JSON.stringify(first.nextSlice),
        '仍有成員時不得中止 Chain',
      );
      const twice = onTeamMemberDeparted(once.nextSlice, event, ctx);
      assert(JSON.stringify(twice.nextSlice) === JSON.stringify(once.nextSlice), 'no-op 應為冪等');
    },
  },
  {
    name: 'NpcBehaviorQuery：投影 active Chain、最早可抽日與（目前為空的）交易 Intent',
    run: () => {
      const { result: first } = runFirstDecision();
      const query = createNpcBehaviorQuery(first.nextSlice);
      const view = query.getActiveChain(FIXTURE.npcTeamId);
      assert(view !== undefined, '應取得 active Chain View');
      assert(view?.status === 'active', 'View 的 status 應為 active');
      assert(view?.nodes.length === 2, 'View 應含全部節點');
      assert(view?.nodes[0]?.status === 'running', '節點狀態應原樣投影');
      assert(
        query.getNextDecisionOnDay(FIXTURE.npcTeamId) === 100,
        'nextDecisionOnDay 應原樣投影',
      );
      assert(
        query.listMarketIntents(FIXTURE.npcTeamId).length === 0,
        '本輪沒有交易 Intent 的建立路徑，應為空陣列（事實，不是預設值）',
      );
      assert(
        query.getActiveChain(FIXTURE.playerTeamId) === undefined,
        '沒有 Controller 的隊伍應回 undefined',
      );
      assert(
        query.getNextDecisionOnDay(FIXTURE.playerTeamId) === undefined,
        '沒有 Controller 的隊伍應回 undefined',
      );
    },
  },
  {
    name: '不變量 4：中止與完成都不留 waiting 節點以外的懸空狀態（Chain 一定收斂到 completed 或 aborted）',
    run: () => {
      // 中止路徑。
      const ctxB = makeContext({ definitions: readerFor(definitionsPackB()) });
      const aborted = expectAccepted(
        npcDecisionDue(
          fixtureState({ policyId: FIXTURE.policyB }),
          decisionJob({ policyId: FIXTURE.policyB }),
          ctxB,
        ),
        '應被接受',
      );
      const abortedChain = Object.values(aborted.nextSlice.chains)[0]!;
      assert(abortedChain.status === 'aborted', '中止路徑：Chain 應為 aborted');
      assert(abortedChain.nodes[0]!.status === 'failed', '中止節點應為 failed');
      assert(
        !abortedChain.nodes.some((n, i) => i <= abortedChain.currentNodeIndex && n.status === 'waiting'),
        '游標走過的節點不得留在 waiting',
      );

      // 完成路徑（單節 travel-south 模板：旅行完成即整條完成）。
      const defs = readerFor(
        overridePolicy(definitionsPackA(), FIXTURE.policyA, {
          fallbackChainTemplateId: FIXTURE.templateTravelSouth,
        }),
      );
      const ctx = makeContext({ definitions: defs, conditions: stubConditionPort([]) });
      const started = expectAccepted(npcDecisionDue(fixtureState(), decisionJob(), ctx), '應被接受');
      const chain = activeChainForTeam(started.nextSlice, FIXTURE.npcTeamId)!;
      const done = onTeamPlanCompleted(
        started.nextSlice,
        {
          type: 'TeamPlanCompleted',
          teamId: FIXTURE.npcTeamId,
          planId: 'runtime:team-plan:travel-s' as TeamPlanCompletedEvent['planId'],
          kind: 'cityTravel',
          payload: { kind: 'cityFree' },
        },
        makeContext({ definitions: defs, worldDay: 106 as WorldDay }),
      );
      const advanced = expectAccepted(
        npcChainAdvance(
          done.nextSlice,
          advanceJob(tryGetChain(done.nextSlice, chain.chainId)!),
          makeContext({ definitions: defs, worldDay: 107 as WorldDay }),
        ),
        '推進應被接受',
      );
      const finalChain = tryGetChain(advanced.nextSlice, chain.chainId)!;
      assert(finalChain.status === 'completed', '完成路徑：Chain 應為 completed');
      assert(
        finalChain.nodes.every((n) => n.status === 'completed'),
        '完成路徑的所有節點都應收斂為 completed',
      );
    },
  },
  {
    name: '結構：cursor 型別為 RngCursor，Chain 快照保存完整 RngContext（可重播）',
    run: () => {
      const { result } = runFirstDecision();
      const chain = activeChainForTeam(result.nextSlice, FIXTURE.npcTeamId)!;
      assert(chain.rngContext.worldSeed === 'seed-npc-behavior', 'worldSeed 應原樣保存');
      assert(chain.rngContext.streamId === 'rng-stream:npc-behavior', 'streamId 應原樣保存');
      const cursor: RngCursor = chain.rngContext.cursor;
      assert(typeof cursor === 'number', 'cursor 應為數值 brand');
    },
  },
];

export type NpcBehaviorTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestsVerbose(): readonly NpcBehaviorTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return {
        name: c.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export function runTests(): void {
  const results = runTestsVerbose();
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const detail = failed.map((f) => `  - ${f.name}: ${f.error ?? 'failed'}`).join('\n');
    throw new Error(`npc-behavior module: ${failed.length}/${results.length} tests failed\n${detail}`);
  }
}
