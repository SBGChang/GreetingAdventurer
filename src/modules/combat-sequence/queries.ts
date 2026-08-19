// modules/combat-sequence/queries.ts
// CombatSequenceQuery 在 slice 上的純函式實作（doc §5）。
//
// doc §5 的硬規則：公開 Query **不得**回傳未揭露內容、RNG roll、機率或未提交經驗。
// 因此這裡把 Aggregate 投影成 CombatSequenceView / CombatSequenceProgressView 兩個窄化 View，
// 不是把 Aggregate 原樣轉出去——rngContext、rngDrawIndex、results[].attempts 全部留在模組內。

import type { TeamId } from '../../contracts/core';
import type {
  CombatSequenceId,
  CombatSequenceProgressView,
  CombatSequenceQuery,
  CombatSequenceView,
} from '../../contracts/combat-sequence';

import type { CombatSequenceAggregate, CombatSequenceModuleState } from './state';
import { findInFlightSequenceForTeam, listResults, tryGetSequence } from './state';

function toView(sequence: CombatSequenceAggregate): CombatSequenceView {
  return {
    sequenceId: sequence.sequenceId,
    teamId: sequence.teamId,
    source: sequence.source,
    ruleId: sequence.ruleId,
    status: sequence.status,
    ...(sequence.terminationReason !== undefined
      ? { terminationReason: sequence.terminationReason }
      : {}),
    challengeCount: sequence.challengeOrder.length,
    cursor: sequence.cursor,
    startedOnDay: sequence.startedOnDay,
    ...(sequence.endedOnDay !== undefined ? { endedOnDay: sequence.endedOnDay } : {}),
    revision: sequence.revision,
  };
}

function toProgressView(sequence: CombatSequenceAggregate): CombatSequenceProgressView {
  return {
    sequenceId: sequence.sequenceId,
    status: sequence.status,
    resolvedCount: listResults(sequence).length,
    challengeCount: sequence.challengeOrder.length,
    // 只有 settled 才有「正式接受的成功場次」；在那之前那個數字還不存在（不是 0）。
    ...(sequence.settlement !== undefined
      ? { settledSuccessfulCount: sequence.settlement.acceptedSuccessfulCount }
      : {}),
  };
}

export function createCombatSequenceQuery(state: CombatSequenceModuleState): CombatSequenceQuery {
  return {
    getSequence(id: CombatSequenceId): CombatSequenceView | undefined {
      const sequence = tryGetSequence(state, id);
      return sequence === undefined ? undefined : toView(sequence);
    },

    // doc §4.1 不變量 1 把 active 與 awaitingSourceCommit 視為同一個「進行中」名額，
    // Host 要問的正是這個名額被誰佔著，所以兩種狀態都回。
    getActiveSequenceForTeam(teamId: TeamId): CombatSequenceView | undefined {
      const sequence = findInFlightSequenceForTeam(state, teamId);
      return sequence === undefined ? undefined : toView(sequence);
    },

    getProgress(id: CombatSequenceId): CombatSequenceProgressView {
      const sequence = tryGetSequence(state, id);
      if (sequence === undefined) {
        // 契約回傳型別非可選：查不到是呼叫端的錯（Host 已 release 卻還在問），明確拋錯而不編一個空進度。
        throw new Error(`CombatSequenceQuery: unknown sequence "${String(id)}"`);
      }
      return toProgressView(sequence);
    },
  };
}
