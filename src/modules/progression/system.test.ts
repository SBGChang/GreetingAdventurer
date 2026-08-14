// modules/progression/system.test.ts
// 自足式單元測試（無外部框架、無 node/DOM 全域）。呼叫 runTests() 取得逐案 pass/fail。
// 覆蓋核心成長行為：award MXP → 等級/主屬變化、採集 MXP 冪等、主屬 clamp 100、無升級時不發等級事件。

import type { DomainEventDraft, EncounterId } from '../../contracts/core';
import { createInitialProgressionState } from './state';
import {
  awardMasteryExperience,
  handleGrantGatheringMasteryExperience,
  handleCombatAttackMasteryEarned,
  resolveLevel,
  computeTeachingResult,
} from './system';
import {
  makeFixtureReader,
  makeGatheringCommand,
  HERO,
  SWORD_MASTERY,
  LINEAR_CURVE,
} from './fixtures';

export type TestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// 從 outgoingMessages 取出事件 type 清單（core union 由 composition 收斂，此處以結構讀取）。
function eventTypes(messages: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    const draft = m as DomainEventDraft<{ type?: string }>;
    if (draft.event && typeof draft.event.type === 'string') out.push(draft.event.type);
  }
  return out;
}

type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: '#1：CombatAttackMasteryEarned 依 CombatMasterySource 冪等（重放不重複發放、不再 emit）',
    run: () => {
      const reader = makeFixtureReader();
      const s0 = createInitialProgressionState();
      const payload = {
        source: { kind: 'encounter' as const, encounterId: 'enc-1' as EncounterId },
        characterAwards: [{ characterId: HERO, masteryId: SWORD_MASTERY, amount: 50 }],
      };
      const r1 = handleCombatAttackMasteryEarned(s0, payload, reader);
      const exp1 = r1.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY]?.experience;
      assert(exp1 === 50, `首次應 +50，實得 ${exp1}`);
      assert(eventTypes(r1.outgoingMessages).length > 0, '首次應 emit 事件');

      // 重放同一 source → 不加、不 emit。
      const r2 = handleCombatAttackMasteryEarned(r1.nextSlice, payload, reader);
      const exp2 = r2.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY]?.experience;
      assert(exp2 === 50, `重放不得再加（應維持 50，實得 ${exp2}）`);
      assert(r2.outgoingMessages.length === 0, '重放不應再 emit 事件');

      // 不同 source 仍會發放。
      const r3 = handleCombatAttackMasteryEarned(
        r2.nextSlice,
        { ...payload, source: { kind: 'encounter' as const, encounterId: 'enc-2' as EncounterId } },
        reader,
      );
      const exp3 = r3.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY]?.experience;
      assert(exp3 === 100, `不同 source 應再 +50（應 100，實得 ${exp3}）`);
    },
  },
  {
    name: 'award MXP raises experience, level and derived attribute',
    run: () => {
      const reader = makeFixtureReader();
      const s0 = createInitialProgressionState();
      const r = awardMasteryExperience(
        s0,
        { characterId: HERO, masteryId: SWORD_MASTERY, amount: 150, source: 'test' },
        reader,
      );
      const mp = r.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY];
      assert(mp !== undefined, 'mastery progress created');
      assert(mp!.experience === 150, `experience 150 (got ${mp!.experience})`);
      assert(mp!.level === 1, `level 1 (got ${mp!.level})`);

      const types = eventTypes(r.outgoingMessages);
      assert(types.includes('MasteryExperienceGranted'), 'emits MasteryExperienceGranted');
      assert(types.includes('MasteryLevelChanged'), 'emits MasteryLevelChanged');
      assert(types.includes('PrimaryAttributesChanged'), 'emits PrimaryAttributesChanged');
      assert(types.includes('ProgressionCapacityChanged'), 'emits ProgressionCapacityChanged');
      // Lv.1 sword muscle 累加 = 2 + 4 = 6。
      const attrDraft = r.outgoingMessages.find(
        (m) => (m as DomainEventDraft<{ type?: string }>).event?.type === 'PrimaryAttributesChanged',
      ) as DomainEventDraft<{ attributes: { muscle: number } }> | undefined;
      assert(attrDraft?.event.attributes.muscle === 6, 'muscle derived = 6');
    },
  },
  {
    name: 'level up emits AutomaticKnowledgeUnlocked and records knowledge',
    run: () => {
      const reader = makeFixtureReader();
      const s0 = createInitialProgressionState();
      const r = awardMasteryExperience(
        s0,
        { characterId: HERO, masteryId: SWORD_MASTERY, amount: 150, source: 'test' },
        reader,
      );
      const types = eventTypes(r.outgoingMessages);
      assert(types.includes('AutomaticKnowledgeUnlocked'), 'emits AutomaticKnowledgeUnlocked at Lv.1');
      const learned = r.nextSlice.characterProgress[HERO]?.learnedKnowledgeIds ?? [];
      assert(learned.length === 1, `one knowledge learned (got ${learned.length})`);
    },
  },
  {
    name: 'gathering MXP is idempotent on resolution+contributor+mastery',
    run: () => {
      const reader = makeFixtureReader();
      const cmd = makeGatheringCommand();
      const s0 = createInitialProgressionState();

      const r1 = handleGrantGatheringMasteryExperience(s0, cmd, reader);
      const exp1 = r1.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY]?.experience;
      assert(exp1 === 150, `first grant experience 150 (got ${exp1})`);
      assert(r1.outgoingMessages.length > 0, 'first grant emits events');

      // 重送同一 Resolution：state 不再變化、無事件。
      const r2 = handleGrantGatheringMasteryExperience(r1.nextSlice, cmd, reader);
      const exp2 = r2.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY]?.experience;
      assert(exp2 === 150, `replay keeps experience 150 (got ${exp2})`);
      assert(r2.outgoingMessages.length === 0, 'replay emits no events');
      assert(r2.nextSlice === r1.nextSlice, 'replay returns unchanged slice reference');
    },
  },
  {
    name: 'derived attribute clamps at 100 when total gains exceed 100',
    run: () => {
      const reader = makeFixtureReader();
      const s0 = createInitialProgressionState();
      // 直接灌到 Lv.10（門檻 3250）：sword muscle 累加 = 120 → clamp 100。
      const r = awardMasteryExperience(
        s0,
        { characterId: HERO, masteryId: SWORD_MASTERY, amount: 3300, source: 'test' },
        reader,
      );
      const mp = r.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY];
      assert(mp!.level === 10, `level 10 (got ${mp!.level})`);
      const attrDraft = r.outgoingMessages.find(
        (m) => (m as DomainEventDraft<{ type?: string }>).event?.type === 'PrimaryAttributesChanged',
      ) as DomainEventDraft<{ attributes: { muscle: number } }> | undefined;
      assert(attrDraft?.event.attributes.muscle === 100, `muscle clamped to 100 (got ${attrDraft?.event.attributes.muscle})`);
    },
  },
  {
    name: 'sub-threshold award changes experience but not level (no level event)',
    run: () => {
      const reader = makeFixtureReader();
      const s0 = createInitialProgressionState();
      const r = awardMasteryExperience(
        s0,
        { characterId: HERO, masteryId: SWORD_MASTERY, amount: 50, source: 'test' },
        reader,
      );
      const mp = r.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY];
      assert(mp!.experience === 50 && mp!.level === 0, 'exp 50 at level 0');
      const types = eventTypes(r.outgoingMessages);
      assert(types.includes('MasteryExperienceGranted'), 'still emits MXP granted');
      assert(!types.includes('MasteryLevelChanged'), 'no level change event');
      assert(!types.includes('PrimaryAttributesChanged'), 'no attribute change event');
    },
  },
  {
    name: 'resolveLevel matches curve thresholds',
    run: () => {
      const reader = makeFixtureReader();
      const curve = reader.getMasteryCurve(LINEAR_CURVE);
      assert(resolveLevel(curve, 0) === 0, 'exp 0 → Lv.0');
      assert(resolveLevel(curve, 99) === 0, 'exp 99 → Lv.0');
      assert(resolveLevel(curve, 100) === 1, 'exp 100 → Lv.1');
      assert(resolveLevel(curve, 3250) === 10, 'exp 3250 → Lv.10');
      assert(resolveLevel(curve, 999999) === 10, 'exp huge → clamp Lv.10');
    },
  },
  {
    name: 'teaching result caps at most one cross-level (N+2 threshold - 1)',
    run: () => {
      const reader = makeFixtureReader();
      const curve = reader.getMasteryCurve(LINEAR_CURVE);
      // 學員 Lv.0（exp 0），教師 MXP 極高，年齡比例 1 → 原始 MXP 巨大，但上限 = 進入 Lv.2 門檻 − 1 = 249。
      const result = computeTeachingResult(curve, 0, 0, 999999, 1);
      assert(result === 249, `capped to 249 (got ${result})`);
      // 教師不高於學員 → 原始 MXP 0，維持學員目前 MXP。
      const noGain = computeTeachingResult(curve, 100, 1, 100, 1);
      assert(noGain === 100, `no gain keeps 100 (got ${noGain})`);
    },
  },
];

export function runTests(): readonly TestResult[] {
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

export function allTestsPass(): boolean {
  return runTests().every((r) => r.passed);
}
