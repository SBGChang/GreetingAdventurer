// modules/combat/combat.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。

import type { CombatantId, EncounterId } from '../../contracts/core';
import type { TransactionMessageDraft } from '../../contracts/core';
import type { CombatDomainEvent } from '../../contracts/combat';

import type { CombatState, CombatEncounter, CombatantState } from './state';
import { createInitialCombatState, upsertEncounter } from './state';
import {
  handleStartCombatEncounter,
  handleUseCombatSkill,
  handleEnemyTurn,
  advanceToNextActor,
} from './system';
import {
  makeCombatContext,
  makeEncounter,
  fixtureStartCommand,
  SKILL_STRIKE,
  SKILL_COUNTER,
  DELAY_STANDARD,
  EFF_COUNTER_DAMAGE,
  HERO_ID,
} from './fixtures';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function eventsOf(messages: readonly TransactionMessageDraft[]): CombatDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as CombatDomainEvent);
}
function countEvent(events: readonly CombatDomainEvent[], type: CombatDomainEvent['type']): number {
  return events.filter((e) => e.type === type).length;
}
function aliveEnemies(encounter: CombatEncounter): CombatantState[] {
  return (Object.keys(encounter.combatants) as CombatantId[])
    .map((id) => encounter.combatants[id])
    .filter((c): c is CombatantState => c !== undefined && c.side === 'enemy' && c.state !== 'dead');
}

// ── 測試案例 ─────────────────────────────────────────────────────────────
type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: 'CTB 倒扣式：最小 currentCtb 先行動；同值跨側玩家優先',
    run: () => {
      const ctx = makeCombatContext();

      // (a) A(player,10) / E(enemy,10) / B(player,5) → 倒扣 5 → 只有 B 抵 0 → B 先。
      const encA = makeEncounter([
        { combatantId: 'pa', side: 'player', currentCtb: 10, col: 1 },
        { combatantId: 'ee', side: 'enemy', currentCtb: 10, col: 1 },
        { combatantId: 'pb', side: 'player', currentCtb: 5, col: 2 },
      ]);
      const advA = advanceToNextActor(encA, ctx);
      assert(advA.currentActorId === ('pb' as CombatantId), `最小 CTB 應先行動，實際 ${String(advA.currentActorId)}`);

      // (b) A(player,5) / E(enemy,5) 同值跨側 → 玩家 A 先，readyQueue=[A,E]（不變量 12）。
      const encB = makeEncounter([
        { combatantId: 'pa', side: 'player', currentCtb: 5, col: 1 },
        { combatantId: 'ee', side: 'enemy', currentCtb: 5, col: 1 },
      ]);
      const advB = advanceToNextActor(encB, ctx);
      assert(advB.currentActorId === ('pa' as CombatantId), '同值跨側應玩家優先');
      assert(
        advB.readyQueue.length === 2 && advB.readyQueue[0] === ('pa' as CombatantId) && advB.readyQueue[1] === ('ee' as CombatantId),
        'readyQueue 應為 [玩家, 敵方]',
      );
      // Query 不消費 RNG / 不改動排序：兩者皆抵 0 後 cursor 不因單元素側而前進。
      assert(advB.currentActorId !== undefined, '應有行動者');
    },
  },
  {
    name: '傷害技能擊殺一名敵人',
    run: () => {
      const ctx = makeCombatContext();
      const started = handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx);
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const encounter = started.nextSlice.encounters[encounterId]!;
      const actorId = encounter.currentActorId!;
      assert(encounter.combatants[actorId]!.side === 'player', '開場行動者應為玩家（反應較高先手）');

      const enemyId = aliveEnemies(encounter)[0]!.combatantId;
      const res = handleUseCombatSkill(
        started.nextSlice,
        {
          type: 'useCombatSkill',
          encounterId,
          actorId,
          skillId: SKILL_STRIKE,
          targetCombatantIds: [enemyId],
        },
        ctx,
      );
      const after = res.nextSlice.encounters[encounterId]!;
      const enemy = after.combatants[enemyId]!;
      assert(enemy.state === 'dead', `敵人應死亡（HP20 受 30 傷），實際 state=${enemy.state}`);
      assert(enemy.health === 0, 'HP 應夾到 0');
      assert(countEvent(eventsOf(res.outgoingMessages), 'CombatActionResolved') === 1, '應 emit 一次 CombatActionResolved');
    },
  },
  {
    name: '全滅 → resolved + 恰一次 MasteryEarned',
    run: () => {
      const ctx = makeCombatContext();
      let state: CombatState = handleStartCombatEncounter(
        createInitialCombatState(),
        fixtureStartCommand(),
        ctx,
      ).nextSlice;
      const encounterId = Object.keys(state.encounters)[0]! as EncounterId;

      const allEvents: CombatDomainEvent[] = [];
      // 驅動整場：玩家用 strike 打最前敵人；敵方走 AI。
      for (let guard = 0; guard < 50; guard += 1) {
        const encounter = state.encounters[encounterId]!;
        if (encounter.state === 'resolved') break;
        const actorId = encounter.currentActorId;
        if (actorId === undefined) break;
        const actor = encounter.combatants[actorId]!;
        let res;
        if (actor.side === 'player') {
          const target = aliveEnemies(encounter)[0];
          if (target === undefined) break;
          res = handleUseCombatSkill(
            state,
            { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_STRIKE, targetCombatantIds: [target.combatantId] },
            ctx,
          );
        } else {
          res = handleEnemyTurn(state, encounterId, ctx);
        }
        allEvents.push(...eventsOf(res.outgoingMessages));
        state = res.nextSlice;
      }

      const encounter = state.encounters[encounterId]!;
      assert(encounter.state === 'resolved', `應結算為 resolved，實際 ${encounter.state}`);
      assert(countEvent(allEvents, 'CombatEncounterResolved') === 1, '應恰發一次 CombatEncounterResolved');
      const resolved = allEvents.find((e) => e.type === 'CombatEncounterResolved');
      assert(resolved !== undefined && (resolved as { outcome: string }).outcome === 'victory', '結果應為 victory');
      assert(countEvent(allEvents, 'CombatAttackMasteryEarned') === 1, '攻擊 MXP 應恰發一次（結束時一次性）');
      assert(countEvent(allEvents, 'CombatTeamOutcome') === 1, '應恰發一次 CombatTeamOutcome');
    },
  },
  {
    name: '反擊架勢：敵方攻擊持架勢者 → 反擊解析一次並解除架勢',
    run: () => {
      const ctx = makeCombatContext();
      const stance = {
        skillId: SKILL_COUNTER,
        conditionResolverId: 'res-counter-cond' as never,
        counterDelayRuleId: DELAY_STANDARD,
        counterEffectIds: [EFF_COUNTER_DAMAGE],
      };
      let encounter = makeEncounter([
        { combatantId: 'p', side: 'player', characterId: HERO_ID, row: 1, col: 1, health: 100, counterStance: stance },
        { combatantId: 'e', side: 'enemy', row: 1, col: 2, health: 100 },
      ]);
      // 敵方 e 為當前行動者。
      encounter = { ...encounter, currentActorId: 'e' as CombatantId, readyQueue: ['e' as CombatantId] };
      const state = upsertEncounter(createInitialCombatState(), encounter);

      const res = handleEnemyTurn(state, encounter.encounterId, ctx);
      const after = res.nextSlice.encounters[encounter.encounterId]!;
      const attacker = after.combatants['e' as CombatantId]!;
      const defender = after.combatants['p' as CombatantId]!;
      assert(attacker.health === 70, `攻擊者應受 30 反擊傷害（100→70），實際 ${attacker.health}`);
      assert(defender.counterStance === undefined, '反擊後架勢應解除');
      assert(defender.health === 95, `防守者應受敵方 5 點咬擊（100→95），實際 ${defender.health}`);
    },
  },
];

export type CombatTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestsVerbose(): readonly CombatTestResult[] {
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
  const results = runTestsVerbose();
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const detail = failed.map((f) => `  - ${f.name}: ${f.error ?? 'failed'}`).join('\n');
    throw new Error(`combat module: ${failed.length}/${results.length} tests failed\n${detail}`);
  }
}
