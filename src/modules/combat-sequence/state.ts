// modules/combat-sequence/state.ts
// Combat Sequence 模組執行期 State slice、Aggregate 型別與純結構 helper。
// 對應 docs/00_core/architecture/21_combat_sequence_module.md §1.1、§4。
//
// 契約（contracts/combat-sequence）刻意沒有轉寫 Aggregate——它是本模組唯一可寫的內部 State。
// 這裡是它的權威宣告：Challenge / Result / Allocation Snapshot 皆引用契約型別，只有「Sequence
// 本身」與「等待補品消耗的中繼狀態」屬於本檔。

import type {
  CharacterId,
  ItemInstanceId,
  Revision,
  RngContext,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type {
  CombatSequenceAllocationSnapshot,
  CombatSequenceChallengeId,
  CombatSequenceChallengeResult,
  CombatSequenceChallengeResultId,
  CombatSequenceChallengeSnapshot,
  CombatSequenceId,
  CombatSequenceRollResult,
  CombatSequenceRuleId,
  CombatSequenceSource,
  CombatSequenceSourceCommitId,
  CombatSequenceStatus,
  CombatSequenceTerminationReason,
} from '../../contracts/combat-sequence';

// ── 結算紀錄（doc §4 CombatSequenceSettlementRecord）────────────────────────
export type CombatSequenceSettlementRecord = Readonly<{
  sourceCommitId: CombatSequenceSourceCommitId;
  acceptedSuccessfulResultIds: readonly CombatSequenceChallengeResultId[];
  acceptedSuccessfulCount: number;
  totalAttackExperienceBudget: number;
  totalDefenseExperienceBudget: number;
  settledOnDay: WorldDay;
}>;

// ── 等待補品消耗的中繼狀態（doc §6.2／§6.3）─────────────────────────────────
//
// 為什麼需要它：跨模組不得同步呼叫（HANDOFF「慣例」：`CombatSequenceHostPort.resolveNext()` 已移除）。
// 所以「消耗補品後重骰」不能寫成一個函式呼叫，只能是
//   ResolveNext → 送 ConsumeCombatSequenceRetrySupply → inventory 發 CombatSequenceRetrySupplyConsumed
//   → 本模組訂閱者接手重骰
// 三段。中間那一段需要把「第一次擲骰已經發生」的事實帶過去，這就是 pendingRetry。
// doc §6.3 要求該事件與重骰位於同一 Engine Transaction，所以正常路徑下它不會存活到提交之後。
export type CombatSequencePendingRetry = Readonly<{
  challengeId: CombatSequenceChallengeId;
  resultId: CombatSequenceChallengeResultId;
  attemptedOnDay: WorldDay;
  // 已完成的擲骰（至少一次：第一次戰力骰）。
  attempts: readonly CombatSequenceRollResult[];
  consumedSupplyItemIds: readonly ItemInstanceId[];
  // 依 RetrySupplyPolicy 選出、已請 inventory 消耗的那一份補品與其擁有者。
  requestedItemId: ItemInstanceId;
  requestedOwnerCharacterId: CharacterId;
}>;

// ── Aggregate（doc §4）─────────────────────────────────────────────────────
export type CombatSequenceAggregate = Readonly<{
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  source: CombatSequenceSource;
  ruleId: CombatSequenceRuleId;

  allocationSnapshot: CombatSequenceAllocationSnapshot;
  teamPower: number;
  challengeOrder: readonly CombatSequenceChallengeId[];
  challenges: Readonly<Record<CombatSequenceChallengeId, CombatSequenceChallengeSnapshot>>;
  cursor: number;
  results: Readonly<Record<CombatSequenceChallengeId, CombatSequenceChallengeResult>>;

  status: CombatSequenceStatus;
  terminationReason?: CombatSequenceTerminationReason;
  settlement?: CombatSequenceSettlementRecord;
  pendingRetry?: CombatSequencePendingRetry;
  startedOnDay: WorldDay;
  endedOnDay?: WorldDay;
  rngContext: RngContext;
  rngDrawIndex: number;
  revision: Revision;
}>;

export type CombatSequenceModuleState = Readonly<{
  sequences: Readonly<Record<CombatSequenceId, CombatSequenceAggregate>>;
}>;

export function createInitialCombatSequenceState(): CombatSequenceModuleState {
  return { sequences: {} };
}

// ── 純讀取 accessor ────────────────────────────────────────────────────────

export function tryGetSequence(
  state: CombatSequenceModuleState,
  sequenceId: CombatSequenceId,
): CombatSequenceAggregate | undefined {
  return state.sequences[sequenceId];
}

// doc §4.1 不變量 1：一支 Team 同一時間最多一筆 active 或 awaitingSourceCommit。
// 「進行中」＝這兩個狀態的聯集；settled／invalid 可以並存多筆（等 Host release）。
export function isInFlight(sequence: CombatSequenceAggregate): boolean {
  return sequence.status === 'active' || sequence.status === 'awaitingSourceCommit';
}

export function findInFlightSequenceForTeam(
  state: CombatSequenceModuleState,
  teamId: TeamId,
): CombatSequenceAggregate | undefined {
  for (const key of Object.keys(state.sequences)) {
    const sequence = state.sequences[key as CombatSequenceId];
    if (sequence === undefined) continue;
    if (sequence.teamId === teamId && isInFlight(sequence)) return sequence;
  }
  return undefined;
}

// cursor 指向的 Challenge；cursor 已到尾端回 undefined。
export function currentChallengeOf(
  sequence: CombatSequenceAggregate,
): CombatSequenceChallengeSnapshot | undefined {
  const challengeId = sequence.challengeOrder[sequence.cursor];
  if (challengeId === undefined) return undefined;
  return sequence.challenges[challengeId];
}

export function listResults(
  sequence: CombatSequenceAggregate,
): readonly CombatSequenceChallengeResult[] {
  const out: CombatSequenceChallengeResult[] = [];
  for (const challengeId of sequence.challengeOrder) {
    const result = sequence.results[challengeId];
    if (result !== undefined) out.push(result);
  }
  return out;
}

export function listSuccessfulResults(
  sequence: CombatSequenceAggregate,
): readonly CombatSequenceChallengeResult[] {
  return listResults(sequence).filter((r) => r.outcome === 'success');
}

// ── 純結構寫入 ─────────────────────────────────────────────────────────────

export function upsertSequence(
  state: CombatSequenceModuleState,
  sequence: CombatSequenceAggregate,
): CombatSequenceModuleState {
  return { ...state, sequences: { ...state.sequences, [sequence.sequenceId]: sequence } };
}

export function removeSequence(
  state: CombatSequenceModuleState,
  sequenceId: CombatSequenceId,
): CombatSequenceModuleState {
  const next: Record<string, CombatSequenceAggregate> = {};
  for (const key of Object.keys(state.sequences)) {
    if (key === String(sequenceId)) continue;
    const sequence = state.sequences[key as CombatSequenceId];
    if (sequence !== undefined) next[key] = sequence;
  }
  return { ...state, sequences: next };
}

export function bumpRevision(revision: Revision): Revision {
  return (revision + 1) as Revision;
}

// pendingRetry 是「這一刻正在等 inventory」的中繼欄位；結算完必須真的消失（而不是留一個空物件），
// 否則 resolveNext 的 retryPending 守門會永久擋住這支 Sequence。
export function clearPendingRetry(sequence: CombatSequenceAggregate): CombatSequenceAggregate {
  if (sequence.pendingRetry === undefined) return sequence;
  const { pendingRetry: _dropped, ...rest } = sequence;
  return rest;
}

export function indexChallenges(
  challenges: readonly CombatSequenceChallengeSnapshot[],
): Readonly<Record<CombatSequenceChallengeId, CombatSequenceChallengeSnapshot>> {
  const out: Record<string, CombatSequenceChallengeSnapshot> = {};
  for (const challenge of challenges) out[challenge.challengeId] = challenge;
  return out;
}
