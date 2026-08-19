// modules/combat-sequence/combat-sequence.test.ts
// 自足式單元測試（無外部框架、無 node/DOM 全域）。runTests() 逐案執行，任一失敗即 throw。
//
// 覆蓋（對照 docs/00_core/architecture/21_combat_sequence_module.md §10 驗收清單）：
//   1  一節點單場掃蕩成功／失敗並只結算一次
//   2  多節點串成功兩場、第三場失敗，後續節點不解析
//   3  相對戰力差恰為 15% 可重骰、超過 15% 不可重骰
//   4  每次重骰先成功消耗一份補品；消耗未發生時 RNG 不前進
//   5  同 seed／同 cursor 得到相同 roll
//   6  1／2／3 招技能組的 6、4、0 權重（含非整數刻度被拒）
//   7  全隊權重 6／4／0 時只由前兩人取得 6/10、4/10 攻擊預算
//   8  防禦 3／2／1 有人排權重與空排略過
//   9  五場 accepted success 令支援技能取得五次（不被 detailed 的三次上限截斷）
//   10 Map 只接受部分成功 Result 時只計 accepted 子集
//   11 同一 sourceCommitId 重送不重複發 MXP
//   13 多日呼叫與一日連續呼叫產生相同最終 Settlement
//   14 settled／invalid 後不能再解析或提交
//   15 Host 未 release 前保留 settled Sequence；active／awaiting 不可移除
// 外加：每個 typed rejection 至少一案、RNG 游標逐次串接、Query 投影不外洩 roll／機率。

import type {
  DomainEventDraft,
  InternalCommandDraft,
  ModuleResult,
  Revision,
  TransactionMessageDraft,
  WorldDay,
} from '../../contracts/core';
import { SUPPORT_USE_CAP } from '../../contracts/core';
import type { ConsumeCombatSequenceRetrySupply } from '../../contracts/inventory';
import type {
  CombatSequenceChallengeResultId,
  CombatSequenceDomainEvent,
  CombatSequenceInvalidReason,
  CombatSequenceMemberSnapshot,
  MasteryExperienceAmount,
} from '../../contracts/combat-sequence';
import { deterministicRng } from '../../kernel/rng';

import type { CombatSequenceAggregate, CombatSequenceModuleState } from './state';
import { createInitialCombatSequenceState, currentChallengeOf, tryGetSequence } from './state';
import type { CombatSequenceContext, CombatSequenceHandlerResult } from './system';
import {
  COMBAT_SEQUENCE_REJECTIONS,
  createCombatSequenceChallengeResolver,
  createCombatSequenceMasteryAllocator,
  defenseRowWeightOf,
  handleCommitCombatSequenceSourceResults,
  handleInvalidateCombatSequence,
  handleReleaseCombatSequence,
  handleResolveNextCombatSequenceChallenge,
  handleSkipNextCombatSequenceChallenge,
  handleStartCombatSequence,
  handleStopCombatSequence,
  listChallengeResults,
  onCombatSequenceRetrySupplyConsumed,
} from './system';
import { createCombatSequenceQuery } from './queries';
import {
  FIXTURE,
  challengeId,
  createFixedSuccessChancePort,
  createFixtureContext,
  createFixtureReader,
  createFixtureSupplyQuery,
  createLogisticSuccessChancePort,
  createScriptedRng,
  fixtureAllocationSnapshot,
  fixtureChallenges,
  fixtureMembers,
  fixtureRngContext,
  fixtureSingleBattleStartCommand,
  fixtureStartCommand,
  fixtureTeamPowerSnapshot,
  startedState,
  type ScriptedRng,
} from './fixtures';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function ok(outcome: CombatSequenceHandlerResult): ModuleResult<CombatSequenceModuleState> {
  if (!outcome.ok) throw new Error(`預期接受，實得拒絕 ${outcome.rejection.code}`);
  return outcome.result;
}

function rejectedWith(outcome: CombatSequenceHandlerResult, code: string): void {
  if (outcome.ok) throw new Error(`預期拒絕 ${code}，實得接受`);
  assert(
    outcome.rejection.code === code,
    `預期拒絕碼 ${code}，實得 ${outcome.rejection.code}（details ${JSON.stringify(outcome.rejection.details)}）`,
  );
}

function rejectionDetail(outcome: CombatSequenceHandlerResult, key: string): string {
  if (outcome.ok) throw new Error('預期拒絕，實得接受');
  return String(outcome.rejection.details?.[key]);
}

function eventsOf(messages: readonly TransactionMessageDraft[]): CombatSequenceDomainEvent[] {
  return messages
    .filter((m): m is DomainEventDraft<unknown> => 'event' in m)
    .map((m) => m.event as CombatSequenceDomainEvent);
}

function eventTypes(messages: readonly TransactionMessageDraft[]): string[] {
  return eventsOf(messages).map((e) => e.type);
}

function commandsOf(
  messages: readonly TransactionMessageDraft[],
): InternalCommandDraft<ConsumeCombatSequenceRetrySupply>[] {
  return messages
    .filter((m): m is InternalCommandDraft<unknown> => 'targetModule' in m)
    .map((m) => m as InternalCommandDraft<ConsumeCombatSequenceRetrySupply>);
}

function seqOf(state: CombatSequenceModuleState): CombatSequenceAggregate {
  const sequence = tryGetSequence(state, FIXTURE.sequenceId);
  if (sequence === undefined) throw new Error('fixture sequence 不存在');
  return sequence;
}

function resolveNext(
  state: CombatSequenceModuleState,
  ctx: CombatSequenceContext,
  attemptedOnDay: WorldDay = FIXTURE.worldDay,
): CombatSequenceHandlerResult {
  const sequence = seqOf(state);
  const challenge = currentChallengeOf(sequence);
  if (challenge === undefined) throw new Error('cursor 已到尾端，沒有可解析的 Challenge');
  return handleResolveNextCombatSequenceChallenge(
    state,
    {
      sequenceId: sequence.sequenceId,
      expectedChallengeId: challenge.challengeId,
      attemptedOnDay,
    },
    ctx,
  );
}

function skipNext(
  state: CombatSequenceModuleState,
  ctx: CombatSequenceContext,
): CombatSequenceHandlerResult {
  const sequence = seqOf(state);
  const challenge = currentChallengeOf(sequence);
  if (challenge === undefined) throw new Error('cursor 已到尾端，沒有可 skip 的 Challenge');
  return handleSkipNextCombatSequenceChallenge(
    state,
    {
      sequenceId: sequence.sequenceId,
      expectedChallengeId: challenge.challengeId,
      reason: 'sourceUnavailableBeforeAttempt',
    },
    ctx,
  );
}

// 每回都成功的 5 連解析用腳本（p=0.5，roll 0.1 命中）。
const HIT = 0.1;
const MISS = 0.9;

function contextWith(
  rolls: readonly number[],
  overrides?: Partial<CombatSequenceContext>,
): Readonly<{ ctx: CombatSequenceContext; scripted: ScriptedRng }> {
  const scripted = createScriptedRng(rolls);
  const ctx = createFixtureContext({
    scripted,
    successChance: createFixedSuccessChancePort(0.5),
    ...overrides,
  });
  return { ctx, scripted };
}

// 依序解析 count 個 Challenge（每次都必須被接受）。
function resolveMany(
  state: CombatSequenceModuleState,
  ctx: CombatSequenceContext,
  count: number,
  days?: readonly WorldDay[],
): Readonly<{ state: CombatSequenceModuleState; messages: TransactionMessageDraft[] }> {
  let current = state;
  const messages: TransactionMessageDraft[] = [];
  for (let index = 0; index < count; index += 1) {
    const day = days?.[index] ?? FIXTURE.worldDay;
    const r = ok(resolveNext(current, ctx, day));
    current = r.nextSlice;
    messages.push(...r.outgoingMessages);
  }
  return { state: current, messages };
}

function amountOf(awards: readonly MasteryExperienceAmount[], characterId: string): number {
  return awards
    .filter((award) => String(award.characterId) === characterId)
    .reduce((sum, award) => sum + award.amount, 0);
}

function settledEventsFromFullRun(
  days?: readonly WorldDay[],
): readonly CombatSequenceDomainEvent[] {
  const { ctx } = contextWith([HIT, HIT, HIT, HIT, HIT]);
  const started = startedState(fixtureStartCommand(), ctx);
  const resolved = resolveMany(started, ctx, 5, days);
  const sequence = seqOf(resolved.state);
  const acceptedIds = listChallengeResults(sequence).map((r) => r.resultId);
  const committed = ok(
    handleCommitCombatSequenceSourceResults(
      resolved.state,
      {
        sequenceId: sequence.sequenceId,
        acceptedSuccessfulResultIds: acceptedIds,
        sourceCommitId: FIXTURE.sourceCommitId,
        committedOnDay: (FIXTURE.worldDay + 9) as WorldDay,
      },
      ctx,
    ),
  );
  return eventsOf(committed.outgoingMessages);
}

const cases: readonly Readonly<{ name: string; run: () => void }>[] = [
  // ── Start ────────────────────────────────────────────────────────────────
  {
    name: 'start：建立 active Sequence（cursor 0、五個 Challenge、無事件）',
    run: () => {
      const ctx = createFixtureContext();
      const r = ok(handleStartCombatSequence(createInitialCombatSequenceState(), fixtureStartCommand(), ctx));
      const sequence = seqOf(r.nextSlice);
      assert(sequence.status === 'active', `status 應為 active，實得 ${sequence.status}`);
      assert(sequence.cursor === 0, `cursor 應為 0，實得 ${sequence.cursor}`);
      assert(sequence.challengeOrder.length === 5, `應有 5 個 Challenge，實得 ${sequence.challengeOrder.length}`);
      assert(sequence.teamPower === 100, `teamPower 應取自 snapshot.totalPower，實得 ${sequence.teamPower}`);
      assert(sequence.rngDrawIndex === 0, 'rngDrawIndex 起始為 0');
      assert(r.outgoingMessages.length === 0, 'Start 不發事件（doc §7.5 沒有 Started 事件）');
    },
  },
  {
    name: 'start 拒絕：同一 sequenceId 重複建立',
    run: () => {
      const ctx = createFixtureContext();
      const state = startedState(fixtureStartCommand(), ctx);
      rejectedWith(
        handleStartCombatSequence(state, fixtureStartCommand(), ctx),
        COMBAT_SEQUENCE_REJECTIONS.startSequenceExists,
      );
    },
  },
  {
    name: 'start 拒絕：同一 Team 已有進行中 Sequence（不變量 1）',
    run: () => {
      const ctx = createFixtureContext();
      const state = startedState(fixtureStartCommand(), ctx);
      const other = fixtureStartCommand({
        sequenceId: 'runtime:combat-sequence:sweep-2' as typeof FIXTURE.sequenceId,
      });
      rejectedWith(
        handleStartCombatSequence(state, other, ctx),
        COMBAT_SEQUENCE_REJECTIONS.startTeamBusy,
      );
    },
  },
  {
    name: 'start 拒絕：規則的重骰上限為負',
    run: () => {
      const ctx = createFixtureContext({
        reader: createFixtureReader({ rule: { maxRetryCountPerChallenge: -1 } }),
      });
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand(),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startRuleInvalid);
      assert(
        rejectionDetail(outcome, 'reason') === 'maxRetryCountPerChallenge',
        'reason 應指出是哪一個規則欄位',
      );
    },
  },
  {
    name: 'start 拒絕：空 Challenge 串（沒有怪物內容不建立空 Sequence）',
    run: () => {
      const ctx = createFixtureContext();
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand({ challenges: [] }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startChallengeSequenceInvalid);
      assert(rejectionDetail(outcome, 'reason') === 'empty', 'reason=empty');
    },
  },
  {
    name: 'start 拒絕：單場掃蕩不得有兩個 Challenge',
    run: () => {
      const ctx = createFixtureContext();
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureSingleBattleStartCommand({
          challenges: fixtureChallenges(2).map((c) => ({
            ...c,
            sourceRef: { kind: 'singleBattle' as const, sourceId: FIXTURE.sourceId },
          })),
        }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startChallengeSequenceInvalid);
      assert(
        rejectionDetail(outcome, 'reason') === 'singleBattleRequiresExactlyOneChallenge',
        `實得 ${rejectionDetail(outcome, 'reason')}`,
      );
    },
  },
  {
    name: 'start 拒絕：order 不從 0 連續遞增（不變量 2）',
    run: () => {
      const ctx = createFixtureContext();
      const challenges = fixtureChallenges(3).map((c, i) => ({ ...c, order: i === 1 ? 5 : c.order }));
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand({ challenges }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startChallengeSequenceInvalid);
      assert(rejectionDetail(outcome, 'reason') === 'orderNotContiguous', 'reason=orderNotContiguous');
    },
  },
  {
    name: 'start 拒絕：dungeonSweep 的 Challenge 帶 singleBattle sourceRef',
    run: () => {
      const ctx = createFixtureContext();
      const challenges = fixtureChallenges(1).map((c) => ({
        ...c,
        sourceRef: { kind: 'singleBattle' as const, sourceId: FIXTURE.sourceId },
      }));
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand({ challenges }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startChallengeSequenceInvalid);
      assert(rejectionDetail(outcome, 'reason') === 'sourceRefKindMismatch', 'reason=sourceRefKindMismatch');
    },
  },
  {
    name: 'start 拒絕：經驗預算非整數（最大餘數法要求整數預算）',
    run: () => {
      const ctx = createFixtureContext();
      const challenges = fixtureChallenges(1).map((c) => ({ ...c, attackExperienceBudget: 10.5 }));
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand({ challenges }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startChallengeSequenceInvalid);
      assert(
        rejectionDetail(outcome, 'reason') === 'experienceBudgetInvalid',
        'reason=experienceBudgetInvalid',
      );
    },
  },
  {
    name: 'start 拒絕：Challenge 的戰力公式與 Sequence 規則不同（doc §3.1）',
    run: () => {
      const ctx = createFixtureContext({
        reader: createFixtureReader({
          challengeView: { combatPowerRuleId: 'definition:combat-power-rule:other' as never },
        }),
      });
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand(),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startChallengeDefinitionMismatch);
      assert(rejectionDetail(outcome, 'reason') === 'combatPowerRuleId', 'reason=combatPowerRuleId');
    },
  },
  {
    name: 'start 拒絕：Challenge 快照的經驗預算與 Definition 不一致（不得有第二份怪物經驗表）',
    run: () => {
      const ctx = createFixtureContext({
        reader: createFixtureReader({ challengeView: { attackExperienceBudget: 12 } }),
      });
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand(),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startChallengeDefinitionMismatch);
      assert(rejectionDetail(outcome, 'reason') === 'experienceBudget', 'reason=experienceBudget');
    },
  },
  {
    name: 'start 拒絕：Team Power 參與者集合與 Allocation Snapshot 不同（不變量 12）',
    run: () => {
      const ctx = createFixtureContext();
      const members = fixtureMembers();
      const snapshot = fixtureTeamPowerSnapshot(members);
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand({
          teamPowerSnapshot: { ...snapshot, participantCharacterIds: [FIXTURE.hero] },
        }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startTeamPowerMismatch);
      assert(rejectionDetail(outcome, 'reason') === 'participants', 'reason=participants');
    },
  },
  {
    name: 'start 拒絕：Team Power 的 revision key 與快照不符',
    run: () => {
      const ctx = createFixtureContext();
      const snapshot = fixtureTeamPowerSnapshot();
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand({ teamPowerSnapshot: { ...snapshot, sourceRevisionKey: 'stale' } }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startTeamPowerMismatch);
      assert(rejectionDetail(outcome, 'reason') === 'revisionKey', 'reason=revisionKey');
    },
  },
  {
    name: 'start 拒絕：成員數為 0（1～9 人）',
    run: () => {
      const ctx = createFixtureContext();
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand({
          allocationSnapshot: fixtureAllocationSnapshot([]),
          teamPowerSnapshot: fixtureTeamPowerSnapshot([]),
        }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startAllocationSnapshotInvalid);
      assert(rejectionDetail(outcome, 'reason') === 'memberCount', 'reason=memberCount');
    },
  },
  {
    name: 'start 拒絕：站位超出 3×3 場地',
    run: () => {
      const ctx = createFixtureContext();
      const members = fixtureMembers().map((m, i) =>
        i === 0 ? { ...m, formationCell: { floor: 0, row: 7, col: 0 } } : m,
      );
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand({
          allocationSnapshot: fixtureAllocationSnapshot(members),
          teamPowerSnapshot: fixtureTeamPowerSnapshot(members),
        }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startAllocationSnapshotInvalid);
      assert(
        rejectionDetail(outcome, 'reason') === 'formationCellOutOfGrid',
        'reason=formationCellOutOfGrid',
      );
    },
  },
  {
    name: 'start 拒絕：attackWeightUnits 不等於資料刻度導出的整數值（doc §3.2）',
    run: () => {
      const ctx = createFixtureContext();
      const members = fixtureMembers().map((m, i) => (i === 0 ? { ...m, attackWeightUnits: 5 } : m));
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand({
          allocationSnapshot: fixtureAllocationSnapshot(members),
          teamPowerSnapshot: fixtureTeamPowerSnapshot(members),
        }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startAllocationSnapshotInvalid);
      assert(rejectionDetail(outcome, 'reason') === 'attackWeightUnits', 'reason=attackWeightUnits');
    },
  },
  {
    name: 'start 拒絕：attackSkillCount 與 Skill Definition 判定的 damage 技能數不符',
    run: () => {
      const ctx = createFixtureContext();
      // hero 只配一招 damage，卻自報 0 招（權重同步改 0 以避開權重檢查，逼出技能數檢查）。
      const members = fixtureMembers().map((m, i) =>
        i === 0 ? { ...m, attackSkillCount: 0, attackWeightUnits: 0, attackMasterySplits: [] } : m,
      );
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand({
          allocationSnapshot: fixtureAllocationSnapshot(members),
          teamPowerSnapshot: fixtureTeamPowerSnapshot(members),
        }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startAllocationSnapshotInvalid);
      assert(rejectionDetail(outcome, 'reason') === 'attackSkillCount', 'reason=attackSkillCount');
    },
  },
  {
    name: 'start 拒絕：支援技能集合與 Skill Definition 的 fixedSupport 集合不符',
    run: () => {
      const ctx = createFixtureContext();
      // hero 只配了 damage 技能，卻宣稱有一個支援技能。
      const members = fixtureMembers().map((m, i) =>
        i === 0
          ? {
              ...m,
              supportSkills: [{ skillId: FIXTURE.skillChant, awardRuleId: FIXTURE.chantAwardRuleId }],
            }
          : m,
      );
      const outcome = handleStartCombatSequence(
        createInitialCombatSequenceState(),
        fixtureStartCommand({
          allocationSnapshot: fixtureAllocationSnapshot(members),
          teamPowerSnapshot: fixtureTeamPowerSnapshot(members),
        }),
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.startAllocationSnapshotInvalid);
      assert(rejectionDetail(outcome, 'reason') === 'supportSkillSet', 'reason=supportSkillSet');
    },
  },
  {
    name: 'start 接受：1／2／3 招技能組分別導出 6／3／2 的整數權重（doc §10 驗收 6）',
    run: () => {
      const ctx = createFixtureContext();
      const base = fixtureMembers();
      const one = base[0];
      const three = base[1];
      if (one === undefined || three === undefined) throw new Error('fixture members 不足');
      // 2 招（1 攻 1 支）→ (1×6)/2 = 3；3 招（2 攻 1 支）→ (2×6)/3 = 4。
      const two: CombatSequenceMemberSnapshot = {
        ...three,
        configuredSkillIds: [FIXTURE.skillBladeA, FIXTURE.skillChant],
        attackSkillCount: 1,
        attackWeightUnits: 3,
      };
      const members = [one, two];
      ok(
        handleStartCombatSequence(
          createInitialCombatSequenceState(),
          fixtureStartCommand({
            allocationSnapshot: fixtureAllocationSnapshot(members),
            teamPowerSnapshot: fixtureTeamPowerSnapshot(members),
          }),
          ctx,
        ),
      );
      // 1 攻 / 2 招的組合若寫成 4 就不是資料刻度導出的值，必須被拒。
      const wrong = [one, { ...two, attackWeightUnits: 4 }];
      rejectedWith(
        handleStartCombatSequence(
          createInitialCombatSequenceState(),
          fixtureStartCommand({
            allocationSnapshot: fixtureAllocationSnapshot(wrong),
            teamPowerSnapshot: fixtureTeamPowerSnapshot(wrong),
          }),
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.startAllocationSnapshotInvalid,
      );
    },
  },

  // ── Resolve / RNG ────────────────────────────────────────────────────────
  {
    name: 'resolveNext：連續三場成功，RNG 游標逐次串接 [0,1,2]（不重用 cursor 0）',
    run: () => {
      const { ctx, scripted } = contextWith([HIT, HIT, HIT]);
      const state = startedState(fixtureStartCommand(), ctx);
      const r = resolveMany(state, ctx, 3);
      assert(
        scripted.seenCursors.join(',') === '0,1,2',
        `游標須逐次串接 [0,1,2]，實得 [${scripted.seenCursors.join(',')}]`,
      );
      const sequence = seqOf(r.state);
      assert(sequence.rngDrawIndex === 3, `rngDrawIndex 應為 3，實得 ${sequence.rngDrawIndex}`);
      assert(sequence.cursor === 3, `cursor 應為 3，實得 ${sequence.cursor}`);
      assert(sequence.status === 'active', '尚有 Challenge → 仍 active');
      assert(
        eventTypes(r.messages).join(',') ===
          'CombatSequenceChallengeResolved,CombatSequenceChallengeResolved,CombatSequenceChallengeResolved',
        `每場一筆 Resolved，實得 ${eventTypes(r.messages).join(',')}`,
      );
      const drawIndices = listChallengeResults(sequence).map((res) => res.attempts[0]?.rngDrawIndex);
      assert(drawIndices.join(',') === '0,1,2', `Result 也要記下實用的 drawIndex，實得 ${drawIndices.join(',')}`);
    },
  },
  {
    name: 'resolveNext：五場全成功 → 最後一場轉 awaitingSourceCommit(allResolved) 並發 ReadyForSourceCommit',
    run: () => {
      const { ctx } = contextWith([HIT, HIT, HIT, HIT, HIT]);
      const state = startedState(fixtureStartCommand(), ctx);
      const r = resolveMany(state, ctx, 5);
      const sequence = seqOf(r.state);
      assert(sequence.status === 'awaitingSourceCommit', `實得 ${sequence.status}`);
      assert(sequence.terminationReason === 'allResolved', `實得 ${String(sequence.terminationReason)}`);
      const ready = eventsOf(r.messages).filter((e) => e.type === 'CombatSequenceReadyForSourceCommit');
      assert(ready.length === 1, `ReadyForSourceCommit 只發一次，實得 ${ready.length}`);
    },
  },
  {
    name: '單場掃蕩：一個 Challenge 成功後立刻等待來源提交（doc §10 驗收 1）',
    run: () => {
      const { ctx } = contextWith([HIT]);
      const state = startedState(fixtureSingleBattleStartCommand(), ctx);
      const r = ok(resolveNext(state, ctx));
      const sequence = seqOf(r.nextSlice);
      assert(sequence.status === 'awaitingSourceCommit', `實得 ${sequence.status}`);
      assert(
        eventTypes(r.outgoingMessages).join(',') ===
          'CombatSequenceChallengeResolved,CombatSequenceReadyForSourceCommit',
        `實得 ${eventTypes(r.outgoingMessages).join(',')}`,
      );
    },
  },
  {
    name: '單場掃蕩：一個 Challenge 失敗（不可重骰）也只結算一次（doc §10 驗收 1）',
    run: () => {
      const { ctx } = contextWith([MISS], {
        reader: createFixtureReader({ rule: { maxRetryCountPerChallenge: 0 } }),
      });
      const state = startedState(fixtureSingleBattleStartCommand(), ctx);
      const r = ok(resolveNext(state, ctx));
      const sequence = seqOf(r.nextSlice);
      assert(sequence.terminationReason === 'challengeFailed', `實得 ${String(sequence.terminationReason)}`);
      const results = listChallengeResults(sequence);
      assert(results.length === 1 && results[0]?.outcome === 'failure', '恰一筆 failure Result');
    },
  },
  {
    name: '多節點：成功兩場、第三場失敗 → 後續節點不解析（不變量 7、驗收 2）',
    run: () => {
      const { ctx } = contextWith([HIT, HIT, MISS], {
        reader: createFixtureReader({ rule: { maxRetryCountPerChallenge: 0 } }),
      });
      const state = startedState(fixtureStartCommand(), ctx);
      const r = resolveMany(state, ctx, 3);
      const sequence = seqOf(r.state);
      assert(sequence.status === 'awaitingSourceCommit', `實得 ${sequence.status}`);
      assert(sequence.terminationReason === 'challengeFailed', `實得 ${String(sequence.terminationReason)}`);
      assert(listChallengeResults(sequence).length === 3, '只有三筆 Result');
      rejectedWith(
        handleResolveNextCombatSequenceChallenge(
          r.state,
          {
            sequenceId: sequence.sequenceId,
            expectedChallengeId: challengeId(3),
            attemptedOnDay: FIXTURE.worldDay,
          },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.notActive,
      );
    },
  },
  {
    name: 'resolveNext 拒絕：Sequence 不存在／expectedChallengeId 不是 cursor 指向的那一個',
    run: () => {
      const { ctx } = contextWith([HIT]);
      const state = startedState(fixtureStartCommand(), ctx);
      rejectedWith(
        handleResolveNextCombatSequenceChallenge(
          createInitialCombatSequenceState(),
          {
            sequenceId: FIXTURE.sequenceId,
            expectedChallengeId: challengeId(0),
            attemptedOnDay: FIXTURE.worldDay,
          },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.sequenceNotFound,
      );
      rejectedWith(
        handleResolveNextCombatSequenceChallenge(
          state,
          {
            sequenceId: FIXTURE.sequenceId,
            expectedChallengeId: challengeId(4),
            attemptedOnDay: FIXTURE.worldDay,
          },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.challengeMismatch,
      );
    },
  },
  {
    name: '決定論：同 seed／同 cursor 得到相同 roll，cursor 前進即得不同 roll（驗收 5）',
    run: () => {
      const resolver = createCombatSequenceChallengeResolver({
        rng: deterministicRng,
        successChance: createFixedSuccessChancePort(0.5),
      });
      const reader = createFixtureReader();
      const rule = reader.getRule(FIXTURE.ruleId);
      const input = {
        rule,
        teamPower: 100,
        enemyPower: 100,
        attemptIndex: 0 as const,
        rngContext: fixtureRngContext(0),
        rngDrawIndex: 0,
      };
      const a = resolver.resolveInitial(input);
      const b = resolver.resolveInitial(input);
      assert(a.roll === b.roll, `同 cursor 必得相同 roll（${a.roll} vs ${b.roll}）`);
      const c = resolver.resolveInitial({ ...input, rngContext: fixtureRngContext(1), rngDrawIndex: 1 });
      assert(a.roll !== c.roll, '不同 cursor 應得不同 roll（否則游標沒有真的參與雜湊）');
      assert(a.successProbability === 0.5, 'successProbability 由 Port 供給，不是程式常數');
    },
  },
  {
    name: 'resolver：Port 回傳超出 0..1 的機率時明確失敗（不夾限成看起來合理的值）',
    run: () => {
      const resolver = createCombatSequenceChallengeResolver({
        rng: deterministicRng,
        successChance: createFixedSuccessChancePort(1.5),
      });
      const rule = createFixtureReader().getRule(FIXTURE.ruleId);
      let threw = false;
      try {
        resolver.resolveInitial({
          rule,
          teamPower: 100,
          enemyPower: 100,
          attemptIndex: 0,
          rngContext: fixtureRngContext(0),
          rngDrawIndex: 0,
        });
      } catch {
        threw = true;
      }
      assert(threw, '機率 1.5 應拋錯');
    },
  },
  {
    name: '成功率走 §7.1 kernel：teamPower == enemyPower 時 logisticCurve 給 0.5（調校在 params）',
    run: () => {
      const port = createLogisticSuccessChancePort();
      const p = port.resolveSuccessChance({
        resolverId: FIXTURE.successChanceResolverId,
        paramsDefId: FIXTURE.successChanceParamsId,
        chance: { teamPower: 100, enemyPower: 100 },
      }).probability;
      assert(Math.abs(p - 0.5) < 1e-12, `實得 ${p}`);
      const stronger = port.resolveSuccessChance({
        resolverId: FIXTURE.successChanceResolverId,
        paramsDefId: FIXTURE.successChanceParamsId,
        chance: { teamPower: 200, enemyPower: 100 },
      }).probability;
      assert(stronger > 0.5, `戰力高應提高機率，實得 ${stronger}`);
    },
  },

  // ── Skip ─────────────────────────────────────────────────────────────────
  {
    name: 'skip：記 skippedBeforeAttempt、前進 cursor、不消耗 RNG（doc §6.4）',
    run: () => {
      const { ctx, scripted } = contextWith([]);
      const state = startedState(fixtureStartCommand(), ctx);
      const r = ok(skipNext(state, ctx));
      const sequence = seqOf(r.nextSlice);
      assert(scripted.rolls() === 0, 'skip 不得取任何 RNG 值');
      assert(sequence.rngDrawIndex === 0, 'rngDrawIndex 不前進');
      assert(sequence.cursor === 1, `cursor 應前進到 1，實得 ${sequence.cursor}`);
      const result = listChallengeResults(sequence)[0];
      assert(result?.outcome === 'skippedBeforeAttempt', `實得 ${String(result?.outcome)}`);
      assert(result?.attemptedOnDay === undefined, 'skip 沒有 attemptedOnDay');
      assert(sequence.status === 'active', '中途 skip 仍 active');
    },
  },
  {
    name: 'skip：跳到尾端同樣進入 awaitingSourceCommit(allResolved)',
    run: () => {
      const { ctx } = contextWith([]);
      let state = startedState(fixtureSingleBattleStartCommand(), ctx);
      const r = ok(skipNext(state, ctx));
      state = r.nextSlice;
      const sequence = seqOf(state);
      assert(sequence.status === 'awaitingSourceCommit', `實得 ${sequence.status}`);
      assert(sequence.terminationReason === 'allResolved', `實得 ${String(sequence.terminationReason)}`);
    },
  },

  // ── 補品重骰 ─────────────────────────────────────────────────────────────
  {
    name: '重骰資格：相對戰力差恰為 15% → 送出 ConsumeCombatSequenceRetrySupply 並選最低價補品（驗收 3、4）',
    run: () => {
      const members = fixtureMembers();
      const { ctx, scripted } = contextWith([MISS]);
      const state = startedState(
        fixtureStartCommand({ teamPowerSnapshot: fixtureTeamPowerSnapshot(members, 85) }),
        ctx,
      );
      const r = ok(resolveNext(state, ctx));
      const sequence = seqOf(r.nextSlice);
      assert(sequence.status === 'active', '等待補品期間仍 active');
      assert(sequence.cursor === 0, 'cursor 不前進（Challenge 還沒定案）');
      assert(sequence.pendingRetry !== undefined, 'pendingRetry 應已建立');
      assert(sequence.rngDrawIndex === 1, `只前進第一顆骰，實得 ${sequence.rngDrawIndex}`);
      assert(scripted.rolls() === 1, '重骰的那一顆尚未擲出（補品還沒扣）');
      assert(eventsOf(r.outgoingMessages).length === 0, '未定案前不發 Resolved');
      const commands = commandsOf(r.outgoingMessages);
      assert(commands.length === 1, `應送出一筆 Internal Command，實得 ${commands.length}`);
      const command = commands[0];
      assert(String(command?.targetModule) === 'inventory', `接收者應為 inventory，實得 ${String(command?.targetModule)}`);
      assert(
        command?.command.type === 'ConsumeCombatSequenceRetrySupply',
        `實得 ${String(command?.command.type)}`,
      );
      assert(
        command?.command.participantCharacterId === FIXTURE.ally,
        '應選中最低價補品（potionCheap，屬 ally）的擁有者',
      );
      assert(
        sequence.pendingRetry?.requestedItemId === FIXTURE.potionCheap,
        'selection=lowestValueThenStableId 必須挑最低價那一件',
      );
    },
  },
  {
    name: '重骰資格：相對戰力差超過 15% → 不重骰，Challenge 立即定案為 failure（驗收 3）',
    run: () => {
      const members = fixtureMembers();
      const { ctx } = contextWith([MISS]);
      const state = startedState(
        fixtureStartCommand({ teamPowerSnapshot: fixtureTeamPowerSnapshot(members, 84) }),
        ctx,
      );
      const r = ok(resolveNext(state, ctx));
      const sequence = seqOf(r.nextSlice);
      assert(sequence.pendingRetry === undefined, '不得建立 pendingRetry');
      assert(sequence.status === 'awaitingSourceCommit', `實得 ${sequence.status}`);
      assert(commandsOf(r.outgoingMessages).length === 0, '不得送出補品消耗命令');
      assert(listChallengeResults(sequence)[0]?.outcome === 'failure', '應記為 failure');
    },
  },
  {
    name: '重骰資格：規則上限為 0 時即使戰力接近也不重骰',
    run: () => {
      const { ctx } = contextWith([MISS], {
        reader: createFixtureReader({ rule: { maxRetryCountPerChallenge: 0 } }),
      });
      const state = startedState(fixtureStartCommand(), ctx);
      const r = ok(resolveNext(state, ctx));
      assert(seqOf(r.nextSlice).pendingRetry === undefined, '上限 0 → 沒有 pendingRetry');
      assert(commandsOf(r.outgoingMessages).length === 0, '不得送出補品消耗命令');
    },
  },
  {
    name: '重骰資格：沒有合法補品（Query 回空）時不重骰、不送命令',
    run: () => {
      const { ctx } = contextWith([MISS], { supply: createFixtureSupplyQuery([]) });
      const state = startedState(fixtureStartCommand(), ctx);
      const r = ok(resolveNext(state, ctx));
      assert(seqOf(r.nextSlice).status === 'awaitingSourceCommit', '沒有補品 → 直接失敗定案');
      assert(commandsOf(r.outgoingMessages).length === 0, '不得送出補品消耗命令');
    },
  },
  {
    name: '重骰資格：數量不足 quantityPerRetry 的候選被排除',
    run: () => {
      const { ctx } = contextWith([MISS], {
        supply: createFixtureSupplyQuery([
          { itemId: FIXTURE.potionCheap, ownerCharacterId: FIXTURE.ally, availableQuantity: 0, unitValue: 1 },
        ]),
      });
      const state = startedState(fixtureStartCommand(), ctx);
      const r = ok(resolveNext(state, ctx));
      assert(seqOf(r.nextSlice).pendingRetry === undefined, '數量 0 的候選不算合法補品');
    },
  },
  {
    name: 'resolveNext 拒絕：pendingRetry 未收斂前不得解析下一個 Challenge',
    run: () => {
      const { ctx } = contextWith([MISS]);
      const state = startedState(fixtureStartCommand(), ctx);
      const pending = ok(resolveNext(state, ctx)).nextSlice;
      rejectedWith(resolveNext(pending, ctx), COMBAT_SEQUENCE_REJECTIONS.retryPending);
      rejectedWith(skipNext(pending, ctx), COMBAT_SEQUENCE_REJECTIONS.retryPending);
    },
  },
  {
    name: '重骰：補品消耗事件回來後才擲第二顆（游標 [0,1]），成功則記 success 與已消耗道具',
    run: () => {
      const { ctx, scripted } = contextWith([MISS, HIT]);
      const state = startedState(fixtureStartCommand(), ctx);
      const pending = ok(resolveNext(state, ctx)).nextSlice;
      const after = onCombatSequenceRetrySupplyConsumed(
        pending,
        {
          type: 'CombatSequenceRetrySupplyConsumed',
          sequenceId: FIXTURE.sequenceId,
          challengeId: challengeId(0),
          itemId: FIXTURE.potionCheap,
          ownerCharacterId: FIXTURE.ally,
          quantity: 1,
        },
        ctx,
      );
      assert(
        scripted.seenCursors.join(',') === '0,1',
        `重骰須用同一 stream 的下一個游標 [0,1]，實得 [${scripted.seenCursors.join(',')}]`,
      );
      const sequence = seqOf(after.nextSlice);
      assert(sequence.pendingRetry === undefined, 'pendingRetry 必須被清掉');
      assert(sequence.cursor === 1, `cursor 應前進，實得 ${sequence.cursor}`);
      assert(sequence.rngDrawIndex === 2, `兩顆骰 → rngDrawIndex 2，實得 ${sequence.rngDrawIndex}`);
      const result = listChallengeResults(sequence)[0];
      assert(result?.outcome === 'success', `實得 ${String(result?.outcome)}`);
      assert(result?.attempts.length === 2, `應有兩次 attempt，實得 ${result?.attempts.length}`);
      assert(result?.attempts[1]?.attemptIndex === 1, 'attemptIndex 應為 1');
      assert(
        result?.consumedSupplyItemIds.join(',') === String(FIXTURE.potionCheap),
        '記錄的是事件回報的實際消耗道具',
      );
      assert(
        eventTypes(after.outgoingMessages).join(',') === 'CombatSequenceChallengeResolved',
        `實得 ${eventTypes(after.outgoingMessages).join(',')}`,
      );
    },
  },
  {
    name: '重骰：再次失敗且已達上限 → 記 failure 並進 awaitingSourceCommit',
    run: () => {
      const { ctx } = contextWith([MISS, MISS]);
      const state = startedState(fixtureStartCommand(), ctx);
      const pending = ok(resolveNext(state, ctx)).nextSlice;
      const after = onCombatSequenceRetrySupplyConsumed(
        pending,
        {
          type: 'CombatSequenceRetrySupplyConsumed',
          sequenceId: FIXTURE.sequenceId,
          challengeId: challengeId(0),
          itemId: FIXTURE.potionCheap,
          ownerCharacterId: FIXTURE.ally,
          quantity: 1,
        },
        ctx,
      );
      const sequence = seqOf(after.nextSlice);
      assert(sequence.status === 'awaitingSourceCommit', `實得 ${sequence.status}`);
      assert(sequence.terminationReason === 'challengeFailed', `實得 ${String(sequence.terminationReason)}`);
      assert(listChallengeResults(sequence)[0]?.attempts.length === 2, '兩次 attempt 都要留在 Result 裡');
    },
  },
  {
    name: '重骰訂閱者冪等：重播同一筆消耗事件不再擲骰、不改 state（已處理過的事件）',
    run: () => {
      const { ctx, scripted } = contextWith([MISS, HIT]);
      const state = startedState(fixtureStartCommand(), ctx);
      const pending = ok(resolveNext(state, ctx)).nextSlice;
      const payload = {
        type: 'CombatSequenceRetrySupplyConsumed' as const,
        sequenceId: FIXTURE.sequenceId,
        challengeId: challengeId(0),
        itemId: FIXTURE.potionCheap,
        ownerCharacterId: FIXTURE.ally,
        quantity: 1 as const,
      };
      const first = onCombatSequenceRetrySupplyConsumed(pending, payload, ctx);
      const rollsAfterFirst = scripted.rolls();
      const replay = onCombatSequenceRetrySupplyConsumed(first.nextSlice, payload, ctx);
      assert(replay.nextSlice === first.nextSlice, '重播必須回傳同一個 slice 參照（真 no-op）');
      assert(replay.outgoingMessages.length === 0, '重播不得再發事件');
      assert(scripted.rolls() === rollsAfterFirst, '重播不得再取 RNG 值');
    },
  },
  {
    name: '重骰訂閱者：未知 Sequence／別的 Challenge 的事件安全略過（不可拒絕已發生事實）',
    run: () => {
      const { ctx } = contextWith([MISS]);
      const state = startedState(fixtureStartCommand(), ctx);
      const pending = ok(resolveNext(state, ctx)).nextSlice;
      const unknown = onCombatSequenceRetrySupplyConsumed(
        createInitialCombatSequenceState(),
        {
          type: 'CombatSequenceRetrySupplyConsumed',
          sequenceId: FIXTURE.sequenceId,
          challengeId: challengeId(0),
          itemId: FIXTURE.potionCheap,
          ownerCharacterId: FIXTURE.ally,
          quantity: 1,
        },
        ctx,
      );
      assert(Object.keys(unknown.nextSlice.sequences).length === 0, '未知 Sequence → 不建立任何東西');
      const otherChallenge = onCombatSequenceRetrySupplyConsumed(
        pending,
        {
          type: 'CombatSequenceRetrySupplyConsumed',
          sequenceId: FIXTURE.sequenceId,
          challengeId: challengeId(3),
          itemId: FIXTURE.potionCheap,
          ownerCharacterId: FIXTURE.ally,
          quantity: 1,
        },
        ctx,
      );
      assert(otherChallenge.nextSlice === pending, '別的 Challenge 的事件 → no-op');
    },
  },

  // ── Stop ─────────────────────────────────────────────────────────────────
  {
    name: 'stop(hostStopped)：active → awaitingSourceCommit 並發 ReadyForSourceCommit',
    run: () => {
      const ctx = createFixtureContext();
      const state = startedState(fixtureStartCommand(), ctx);
      const r = ok(
        handleStopCombatSequence(state, { sequenceId: FIXTURE.sequenceId, reason: 'hostStopped' }, ctx),
      );
      const sequence = seqOf(r.nextSlice);
      assert(sequence.status === 'awaitingSourceCommit', `實得 ${sequence.status}`);
      assert(sequence.terminationReason === 'hostStopped', `實得 ${String(sequence.terminationReason)}`);
      assert(
        eventTypes(r.outgoingMessages).join(',') === 'CombatSequenceReadyForSourceCommit',
        `實得 ${eventTypes(r.outgoingMessages).join(',')}`,
      );
    },
  },
  {
    name: 'stop 冪等：同一原因重送 → 真 no-op（同 slice 參照、不再發事件）',
    run: () => {
      const ctx = createFixtureContext();
      const cmd = { sequenceId: FIXTURE.sequenceId, reason: 'hostStopped' } as const;
      const stopped = ok(handleStopCombatSequence(startedState(fixtureStartCommand(), ctx), cmd, ctx));
      const again = ok(handleStopCombatSequence(stopped.nextSlice, cmd, ctx));
      assert(again.nextSlice === stopped.nextSlice, '同一原因重送必須是真 no-op');
      assert(again.outgoingMessages.length === 0, '不得重複發 ReadyForSourceCommit');
    },
  },
  {
    name: 'stop 拒絕：已停下但原因不同（兩個呼叫端對事實有分歧）',
    run: () => {
      const ctx = createFixtureContext();
      const stopped = ok(
        handleStopCombatSequence(
          startedState(fixtureStartCommand(), ctx),
          { sequenceId: FIXTURE.sequenceId, reason: 'hostStopped' },
          ctx,
        ),
      );
      rejectedWith(
        handleStopCombatSequence(
          stopped.nextSlice,
          { sequenceId: FIXTURE.sequenceId, reason: 'challengeFailed' },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.stopReasonConflict,
      );
    },
  },
  {
    name: 'stop 拒絕：Sequence 不存在／已 invalid（終態）',
    run: () => {
      const ctx = createFixtureContext();
      rejectedWith(
        handleStopCombatSequence(
          createInitialCombatSequenceState(),
          { sequenceId: FIXTURE.sequenceId, reason: 'hostStopped' },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.sequenceNotFound,
      );
      const invalid = ok(
        handleInvalidateCombatSequence(
          startedState(fixtureStartCommand(), ctx),
          { sequenceId: FIXTURE.sequenceId, reason: 'teamUnavailable' },
          ctx,
        ),
      );
      rejectedWith(
        handleStopCombatSequence(
          invalid.nextSlice,
          { sequenceId: FIXTURE.sequenceId, reason: 'hostStopped' },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.stopAlreadyTerminal,
      );
    },
  },

  // ── Invalidate ───────────────────────────────────────────────────────────
  {
    name: 'invalidate：四種 InvalidReason 都有真實觸發路徑並發 CombatSequenceInvalidated',
    run: () => {
      const ctx = createFixtureContext();
      const reasons: readonly CombatSequenceInvalidReason[] = [
        'sourceInvalidated',
        'teamUnavailable',
        'snapshotRevisionConflict',
        'saveMigrationInvalidated',
      ];
      for (const reason of reasons) {
        const r = ok(
          handleInvalidateCombatSequence(
            startedState(fixtureStartCommand(), ctx),
            { sequenceId: FIXTURE.sequenceId, reason },
            ctx,
          ),
        );
        const sequence = seqOf(r.nextSlice);
        assert(sequence.status === 'invalid', `${reason}: 實得 ${sequence.status}`);
        assert(sequence.endedOnDay === FIXTURE.worldDay, `${reason}: endedOnDay 應由 ctx.worldDay 決定`);
        const events = eventsOf(r.outgoingMessages);
        assert(events.length === 1 && events[0]?.type === 'CombatSequenceInvalidated', `${reason}: 事件`);
        assert(
          events[0]?.type === 'CombatSequenceInvalidated' && events[0].reason === reason,
          `${reason}: payload.reason`,
        );
      }
    },
  },
  {
    name: 'invalidate 冪等：已 invalid 時重送 → 真 no-op（第一個成因不被覆寫）',
    run: () => {
      const ctx = createFixtureContext();
      const first = ok(
        handleInvalidateCombatSequence(
          startedState(fixtureStartCommand(), ctx),
          { sequenceId: FIXTURE.sequenceId, reason: 'teamUnavailable' },
          ctx,
        ),
      );
      const again = ok(
        handleInvalidateCombatSequence(
          first.nextSlice,
          { sequenceId: FIXTURE.sequenceId, reason: 'saveMigrationInvalidated' },
          ctx,
        ),
      );
      assert(again.nextSlice === first.nextSlice, '重送必須是真 no-op');
      assert(again.outgoingMessages.length === 0, '不得重複發 Invalidated');
    },
  },
  {
    name: 'invalidate 拒絕：Sequence 不存在／已 settled（不變量 9：不得撤回已發放的成長）',
    run: () => {
      const settled = settledStateForTests();
      const ctx = createFixtureContext();
      rejectedWith(
        handleInvalidateCombatSequence(
          createInitialCombatSequenceState(),
          { sequenceId: FIXTURE.sequenceId, reason: 'teamUnavailable' },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.sequenceNotFound,
      );
      rejectedWith(
        handleInvalidateCombatSequence(
          settled.state,
          { sequenceId: FIXTURE.sequenceId, reason: 'teamUnavailable' },
          settled.ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.invalidateAlreadySettled,
      );
    },
  },

  // ── Commit / 熟練度結算 ──────────────────────────────────────────────────
  {
    name: 'commit：五場全接受 → 攻擊 6/10 與 4/10、防禦 3/2/1、支援五次（驗收 7、8、9）',
    run: () => {
      const settled = settledStateForTests();
      const events = eventsOf(settled.messages);
      const attack = events.find((e) => e.type === 'CombatAttackMasteryEarned');
      const defense = events.find((e) => e.type === 'CombatDefenseMasteryEarned');
      const support = events.filter((e) => e.type === 'CombatSupportMasteryEarned');
      assert(attack?.type === 'CombatAttackMasteryEarned', '應發 CombatAttackMasteryEarned');
      assert(defense?.type === 'CombatDefenseMasteryEarned', '應發 CombatDefenseMasteryEarned');
      if (attack?.type !== 'CombatAttackMasteryEarned' || defense?.type !== 'CombatDefenseMasteryEarned') return;

      // 攻擊總預算 5×10 = 50；權重 6/4/0 → 30 / 20 / 0。
      assert(amountOf(attack.characterAwards, FIXTURE.hero) === 30, `hero 攻擊 30，實得 ${amountOf(attack.characterAwards, FIXTURE.hero)}`);
      assert(amountOf(attack.characterAwards, FIXTURE.ally) === 20, `ally 攻擊 20，實得 ${amountOf(attack.characterAwards, FIXTURE.ally)}`);
      assert(amountOf(attack.characterAwards, FIXTURE.bard) === 0, '無攻擊技能者不得分到攻擊預算');
      // 防禦總預算 5×6 = 30；列權重 3/2/1 → 15 / 10 / 5。
      assert(amountOf(defense.characterAwards, FIXTURE.hero) === 15, `hero 防禦 15，實得 ${amountOf(defense.characterAwards, FIXTURE.hero)}`);
      assert(amountOf(defense.characterAwards, FIXTURE.ally) === 10, `ally 防禦 10，實得 ${amountOf(defense.characterAwards, FIXTURE.ally)}`);
      assert(amountOf(defense.characterAwards, FIXTURE.bard) === 5, `bard 防禦 5，實得 ${amountOf(defense.characterAwards, FIXTURE.bard)}`);
      // 支援：兩名成員各一筆，creditedUseCount = 正式成功場次 5（不被 detailed 的三次上限截斷）。
      assert(support.length === 2, `支援事件應為 2 筆，實得 ${support.length}`);
      for (const e of support) {
        assert(
          e.type === 'CombatSupportMasteryEarned' && e.creditedUseCount === 5,
          `creditedUseCount 應為 5，實得 ${e.type === 'CombatSupportMasteryEarned' ? e.creditedUseCount : -1}`,
        );
        assert(
          e.type === 'CombatSupportMasteryEarned' && e.creditedUseCount > SUPPORT_USE_CAP,
          '簡易戰鬥串不套用 detailed 的每場三次上限',
        );
        assert(
          e.type === 'CombatSupportMasteryEarned' && e.supportMasteryAwardRuleId === FIXTURE.chantAwardRuleId,
          'supportMasteryAwardRuleId 須為快照裡的 Award Rule（progression 會據此讀 fixedExperiencePerUse）',
        );
      }
      // 成長事件的 source 必須是 combatSequence 判別（progression 的冪等 key 依賴它）。
      assert(
        attack.source.kind === 'combatSequence' && attack.source.sequenceId === FIXTURE.sequenceId,
        'source 應為 { kind: combatSequence, sequenceId }',
      );
      const settledEvent = events.find((e) => e.type === 'CombatSequenceSettled');
      assert(
        settledEvent?.type === 'CombatSequenceSettled' &&
          settledEvent.acceptedSuccessfulCount === 5 &&
          settledEvent.totalAttackExperienceBudget === 50 &&
          settledEvent.totalDefenseExperienceBudget === 30,
        'Settled payload 的場次與總預算',
      );
    },
  },
  {
    name: 'commit：來源只接受部分成功 Result 時只計 accepted 子集（驗收 10）',
    run: () => {
      const { ctx } = contextWith([HIT, HIT, HIT, HIT, HIT]);
      const started = startedState(fixtureStartCommand(), ctx);
      const resolved = resolveMany(started, ctx, 5);
      const sequence = seqOf(resolved.state);
      const allIds = listChallengeResults(sequence).map((r) => r.resultId);
      const accepted = allIds.slice(0, 2);
      const committed = ok(
        handleCommitCombatSequenceSourceResults(
          resolved.state,
          {
            sequenceId: sequence.sequenceId,
            acceptedSuccessfulResultIds: accepted,
            sourceCommitId: FIXTURE.sourceCommitId,
            committedOnDay: FIXTURE.worldDay,
          },
          ctx,
        ),
      );
      const events = eventsOf(committed.outgoingMessages);
      const attack = events.find((e) => e.type === 'CombatAttackMasteryEarned');
      const defense = events.find((e) => e.type === 'CombatDefenseMasteryEarned');
      if (attack?.type !== 'CombatAttackMasteryEarned' || defense?.type !== 'CombatDefenseMasteryEarned') {
        throw new Error('缺少成長事件');
      }
      // 攻擊 2×10 = 20 → 12 / 8；防禦 2×6 = 12 → 6 / 4 / 2。
      assert(amountOf(attack.characterAwards, FIXTURE.hero) === 12, `實得 ${amountOf(attack.characterAwards, FIXTURE.hero)}`);
      assert(amountOf(attack.characterAwards, FIXTURE.ally) === 8, `實得 ${amountOf(attack.characterAwards, FIXTURE.ally)}`);
      assert(amountOf(defense.characterAwards, FIXTURE.bard) === 2, `實得 ${amountOf(defense.characterAwards, FIXTURE.bard)}`);
      const support = events.filter((e) => e.type === 'CombatSupportMasteryEarned');
      for (const e of support) {
        assert(e.type === 'CombatSupportMasteryEarned' && e.creditedUseCount === 2, 'creditedUseCount 只算 accepted');
      }
    },
  },
  {
    name: 'commit 冪等：同一 sourceCommitId 重送不重複發 MXP（不變量 11、驗收 11）',
    run: () => {
      const settled = settledStateForTests();
      const again = ok(
        handleCommitCombatSequenceSourceResults(
          settled.state,
          {
            sequenceId: FIXTURE.sequenceId,
            acceptedSuccessfulResultIds: settled.acceptedIds,
            sourceCommitId: FIXTURE.sourceCommitId,
            committedOnDay: FIXTURE.worldDay,
          },
          settled.ctx,
        ),
      );
      assert(again.nextSlice === settled.state, '重送必須回傳既有 state（真 no-op）');
      assert(again.outgoingMessages.length === 0, '不得再次發出任何成長事件');
    },
  },
  {
    name: 'commit 拒絕：settled 後換一個 sourceCommitId 重送',
    run: () => {
      const settled = settledStateForTests();
      rejectedWith(
        handleCommitCombatSequenceSourceResults(
          settled.state,
          {
            sequenceId: FIXTURE.sequenceId,
            acceptedSuccessfulResultIds: settled.acceptedIds,
            sourceCommitId: FIXTURE.otherCommitId,
            committedOnDay: FIXTURE.worldDay,
          },
          settled.ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.commitIdConflict,
      );
    },
  },
  {
    name: 'commit 拒絕：Sequence 不存在／仍 active（尚未等待來源提交）',
    run: () => {
      const ctx = createFixtureContext();
      rejectedWith(
        handleCommitCombatSequenceSourceResults(
          createInitialCombatSequenceState(),
          {
            sequenceId: FIXTURE.sequenceId,
            acceptedSuccessfulResultIds: [],
            sourceCommitId: FIXTURE.sourceCommitId,
            committedOnDay: FIXTURE.worldDay,
          },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.sequenceNotFound,
      );
      rejectedWith(
        handleCommitCombatSequenceSourceResults(
          startedState(fixtureStartCommand(), ctx),
          {
            sequenceId: FIXTURE.sequenceId,
            acceptedSuccessfulResultIds: [],
            sourceCommitId: FIXTURE.sourceCommitId,
            committedOnDay: FIXTURE.worldDay,
          },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.commitNotAwaiting,
      );
    },
  },
  {
    name: 'commit 拒絕：accepted 清單含非本串成功 Result／重複 ID',
    run: () => {
      const { ctx } = contextWith([HIT, HIT, HIT, HIT, HIT]);
      const resolved = resolveMany(startedState(fixtureStartCommand(), ctx), ctx, 5);
      const sequence = seqOf(resolved.state);
      const ids = listChallengeResults(sequence).map((r) => r.resultId);
      const first = ids[0];
      if (first === undefined) throw new Error('缺少 Result');
      rejectedWith(
        handleCommitCombatSequenceSourceResults(
          resolved.state,
          {
            sequenceId: sequence.sequenceId,
            acceptedSuccessfulResultIds: [
              'runtime:combat-sequence-challenge-result:alien' as CombatSequenceChallengeResultId,
            ],
            sourceCommitId: FIXTURE.sourceCommitId,
            committedOnDay: FIXTURE.worldDay,
          },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.commitResultNotAccepted,
      );
      const dup = handleCommitCombatSequenceSourceResults(
        resolved.state,
        {
          sequenceId: sequence.sequenceId,
          acceptedSuccessfulResultIds: [first, first],
          sourceCommitId: FIXTURE.sourceCommitId,
          committedOnDay: FIXTURE.worldDay,
        },
        ctx,
      );
      rejectedWith(dup, COMBAT_SEQUENCE_REJECTIONS.commitResultNotAccepted);
      assert(rejectionDetail(dup, 'reason') === 'duplicate', 'reason=duplicate');
    },
  },
  {
    name: 'commit 拒絕：failure Result 不得出現在 accepted 清單（不變量 8）',
    run: () => {
      const { ctx } = contextWith([MISS], {
        reader: createFixtureReader({ rule: { maxRetryCountPerChallenge: 0 } }),
      });
      const failed = ok(resolveNext(startedState(fixtureStartCommand(), ctx), ctx)).nextSlice;
      const sequence = seqOf(failed);
      const failureId = listChallengeResults(sequence)[0]?.resultId;
      if (failureId === undefined) throw new Error('缺少 failure Result');
      const outcome = handleCommitCombatSequenceSourceResults(
        failed,
        {
          sequenceId: sequence.sequenceId,
          acceptedSuccessfulResultIds: [failureId],
          sourceCommitId: FIXTURE.sourceCommitId,
          committedOnDay: FIXTURE.worldDay,
        },
        ctx,
      );
      rejectedWith(outcome, COMBAT_SEQUENCE_REJECTIONS.commitResultNotAccepted);
      assert(
        rejectionDetail(outcome, 'reason') === 'notASuccessfulResultOfThisSequence',
        `實得 ${rejectionDetail(outcome, 'reason')}`,
      );
    },
  },
  {
    name: 'commit：來源一筆都不接受 → 只發 Settled，不發任何 MXP 事件',
    run: () => {
      const { ctx } = contextWith([MISS], {
        reader: createFixtureReader({ rule: { maxRetryCountPerChallenge: 0 } }),
      });
      const failed = ok(resolveNext(startedState(fixtureStartCommand(), ctx), ctx)).nextSlice;
      const committed = ok(
        handleCommitCombatSequenceSourceResults(
          failed,
          {
            sequenceId: FIXTURE.sequenceId,
            acceptedSuccessfulResultIds: [],
            sourceCommitId: FIXTURE.sourceCommitId,
            committedOnDay: FIXTURE.worldDay,
          },
          ctx,
        ),
      );
      assert(
        eventTypes(committed.outgoingMessages).join(',') === 'CombatSequenceSettled',
        `實得 ${eventTypes(committed.outgoingMessages).join(',')}`,
      );
      const sequence = seqOf(committed.nextSlice);
      assert(sequence.status === 'settled', `實得 ${sequence.status}`);
      assert(sequence.settlement?.acceptedSuccessfulCount === 0, 'acceptedSuccessfulCount 應為 0');
    },
  },
  {
    name: 'settled 後不得再解析（驗收 14）',
    run: () => {
      const settled = settledStateForTests();
      rejectedWith(
        handleResolveNextCombatSequenceChallenge(
          settled.state,
          {
            sequenceId: FIXTURE.sequenceId,
            expectedChallengeId: challengeId(0),
            attemptedOnDay: FIXTURE.worldDay,
          },
          settled.ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.notActive,
      );
    },
  },
  {
    name: '多日呼叫與一日連續呼叫得到相同最終 Settlement（驗收 13）',
    run: () => {
      const sameDay = settledEventsFromFullRun();
      const acrossDays = settledEventsFromFullRun([
        FIXTURE.worldDay,
        FIXTURE.worldDay,
        (FIXTURE.worldDay + 1) as WorldDay,
        (FIXTURE.worldDay + 1) as WorldDay,
        (FIXTURE.worldDay + 2) as WorldDay,
      ]);
      assert(
        JSON.stringify(sameDay) === JSON.stringify(acrossDays),
        '跨日解析不得改變最終結算（同 seed、同 accepted 集合）',
      );
    },
  },

  // ── Release ──────────────────────────────────────────────────────────────
  {
    name: 'release：settled 且 revision 相符 → 移除；不相符則拒絕（驗收 15）',
    run: () => {
      const settled = settledStateForTests();
      const sequence = seqOf(settled.state);
      rejectedWith(
        handleReleaseCombatSequence(
          settled.state,
          { sequenceId: FIXTURE.sequenceId, expectedRevision: (sequence.revision + 1) as Revision },
          settled.ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.releaseRevisionMismatch,
      );
      const released = ok(
        handleReleaseCombatSequence(
          settled.state,
          { sequenceId: FIXTURE.sequenceId, expectedRevision: sequence.revision },
          settled.ctx,
        ),
      );
      assert(
        tryGetSequence(released.nextSlice, FIXTURE.sequenceId) === undefined,
        'release 後 Aggregate 應被移除',
      );
    },
  },
  {
    name: 'release 拒絕：active／awaiting 不可移除；Sequence 不存在也拒絕（驗收 15）',
    run: () => {
      const ctx = createFixtureContext();
      const active = startedState(fixtureStartCommand(), ctx);
      const sequence = seqOf(active);
      rejectedWith(
        handleReleaseCombatSequence(
          active,
          { sequenceId: FIXTURE.sequenceId, expectedRevision: sequence.revision },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.releaseNotReleasable,
      );
      rejectedWith(
        handleReleaseCombatSequence(
          createInitialCombatSequenceState(),
          { sequenceId: FIXTURE.sequenceId, expectedRevision: 0 as Revision },
          ctx,
        ),
        COMBAT_SEQUENCE_REJECTIONS.sequenceNotFound,
      );
    },
  },

  // ── Allocator 單元 ───────────────────────────────────────────────────────
  {
    name: 'allocator：空排略過，第一／第二個有人排權重 3／2（驗收 8）',
    run: () => {
      // 只有列 1 與列 2 有人 → 排名 0 與 1 → 權重 3 與 2（不是 2 與 1）。
      const members = fixtureMembers()
        .slice(0, 2)
        .map((m, i) => ({ ...m, formationCell: { floor: 0, row: i + 1, col: 0 } }));
      const first = members[0];
      const second = members[1];
      if (first === undefined || second === undefined) throw new Error('fixture members 不足');
      assert(defenseRowWeightOf(members, first) === 3, `第一個有人排權重 3，實得 ${defenseRowWeightOf(members, first)}`);
      assert(defenseRowWeightOf(members, second) === 2, `第二個有人排權重 2，實得 ${defenseRowWeightOf(members, second)}`);
    },
  },
  {
    name: 'allocator：最大餘數法讓發放總量恰等於預算（3 / 7 而非 3 / 6）',
    run: () => {
      const allocator = createCombatSequenceMasteryAllocator();
      const base = fixtureMembers();
      const a = base[0];
      const b = base[1];
      if (a === undefined || b === undefined) throw new Error('fixture members 不足');
      // 權重 1 / 2、預算 10 → 精確 3.333 / 6.667 → 3 / 7。
      const members: CombatSequenceMemberSnapshot[] = [
        { ...a, attackSkillCount: 1, attackWeightUnits: 1, configuredSkillIds: [FIXTURE.skillBladeA] },
        { ...b, attackSkillCount: 1, attackWeightUnits: 2, configuredSkillIds: [FIXTURE.skillBladeA] },
      ];
      const allocation = allocator.allocate({
        sequenceId: FIXTURE.sequenceId,
        rule: createFixtureReader().getRule(FIXTURE.ruleId),
        allocationSnapshot: fixtureAllocationSnapshot(members),
        acceptedChallenges: [
          {
            resultId: 'runtime:combat-sequence-challenge-result:x' as CombatSequenceChallengeResultId,
            attackExperienceBudget: 10,
            defenseExperienceBudget: 0,
          },
        ],
      });
      const total = allocation.attackAwards.reduce((sum, award) => sum + award.amount, 0);
      assert(total === 10, `總發放量須等於預算 10，實得 ${total}`);
      assert(amountOf(allocation.attackAwards, String(a.characterId)) === 3, '低權重者取 3');
      assert(amountOf(allocation.attackAwards, String(b.characterId)) === 7, '高權重者取 7（最大餘數）');
      assert(allocation.defenseAwards.length === 0, '防禦預算為 0 → 不發防禦 MXP');
    },
  },
  {
    name: 'allocator：全隊攻擊權重為 0 時不發攻擊 MXP、不除以 0（doc §7.2）',
    run: () => {
      const allocator = createCombatSequenceMasteryAllocator();
      const bard = fixtureMembers()[2];
      if (bard === undefined) throw new Error('fixture members 不足');
      const allocation = allocator.allocate({
        sequenceId: FIXTURE.sequenceId,
        rule: createFixtureReader().getRule(FIXTURE.ruleId),
        allocationSnapshot: fixtureAllocationSnapshot([bard]),
        acceptedChallenges: [
          {
            resultId: 'runtime:combat-sequence-challenge-result:y' as CombatSequenceChallengeResultId,
            attackExperienceBudget: 10,
            defenseExperienceBudget: 6,
          },
        ],
      });
      assert(allocation.attackAwards.length === 0, '零權重 → 沒有攻擊 award');
      assert(amountOf(allocation.defenseAwards, String(bard.characterId)) === 6, '防禦仍照列權重全額發放');
    },
  },

  // ── Query ────────────────────────────────────────────────────────────────
  {
    name: 'queries：View 只投影公開欄位（不含 rng／roll／未提交經驗），progress 反映進度',
    run: () => {
      const { ctx } = contextWith([HIT, HIT]);
      const resolved = resolveMany(startedState(fixtureStartCommand(), ctx), ctx, 2);
      const query = createCombatSequenceQuery(resolved.state);
      const view = query.getSequence(FIXTURE.sequenceId);
      assert(view !== undefined, 'getSequence 應找到');
      if (view === undefined) return;
      assert(view.cursor === 2 && view.challengeCount === 5, `cursor/challengeCount 實得 ${view.cursor}/${view.challengeCount}`);
      const keys = Object.keys(view);
      assert(!keys.includes('rngContext') && !keys.includes('results'), 'View 不得外洩 RNG 與 Result 細節');
      const active = query.getActiveSequenceForTeam(FIXTURE.teamId);
      assert(active?.sequenceId === FIXTURE.sequenceId, 'getActiveSequenceForTeam 應回同一筆');
      const progress = query.getProgress(FIXTURE.sequenceId);
      assert(progress.resolvedCount === 2, `resolvedCount 實得 ${progress.resolvedCount}`);
      assert(progress.settledSuccessfulCount === undefined, '未結算前不得出現 settledSuccessfulCount');
      assert(
        query.getSequence('runtime:combat-sequence:absent' as typeof FIXTURE.sequenceId) === undefined,
        '未知 id 回 undefined',
      );
      let threw = false;
      try {
        query.getProgress('runtime:combat-sequence:absent' as typeof FIXTURE.sequenceId);
      } catch {
        threw = true;
      }
      assert(threw, 'getProgress 對未知 id 明確拋錯（契約回傳型別非可選）');
    },
  },
  {
    name: 'queries：settled 後 progress 帶出正式接受的成功場次',
    run: () => {
      const settled = settledStateForTests();
      const progress = createCombatSequenceQuery(settled.state).getProgress(FIXTURE.sequenceId);
      assert(progress.status === 'settled', `實得 ${progress.status}`);
      assert(progress.settledSuccessfulCount === 5, `實得 ${String(progress.settledSuccessfulCount)}`);
    },
  },
];

// 共用：五場全成功並已 commit 的 state（多個案例重用）。
function settledStateForTests(): Readonly<{
  state: CombatSequenceModuleState;
  ctx: CombatSequenceContext;
  messages: readonly TransactionMessageDraft[];
  acceptedIds: CombatSequenceChallengeResultId[];
}> {
  const { ctx } = contextWith([HIT, HIT, HIT, HIT, HIT]);
  const resolved = resolveMany(startedState(fixtureStartCommand(), ctx), ctx, 5);
  const sequence = seqOf(resolved.state);
  const acceptedIds = listChallengeResults(sequence).map((r) => r.resultId);
  const committed = ok(
    handleCommitCombatSequenceSourceResults(
      resolved.state,
      {
        sequenceId: sequence.sequenceId,
        acceptedSuccessfulResultIds: acceptedIds,
        sourceCommitId: FIXTURE.sourceCommitId,
        committedOnDay: FIXTURE.worldDay,
      },
      ctx,
    ),
  );
  return { state: committed.nextSlice, ctx, messages: committed.outgoingMessages, acceptedIds };
}

export type CombatSequenceTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestResults(): readonly CombatSequenceTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return { name: c.name, passed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    const lines = failures.map((f) => `  ✗ ${f.name}: ${f.error ?? 'failed'}`);
    throw new Error(
      `combat-sequence module: ${failures.length}/${results.length} test(s) failed\n${lines.join('\n')}`,
    );
  }
}
