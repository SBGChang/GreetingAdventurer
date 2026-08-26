// modules/progression/system.test.ts
// 自足式單元測試（無外部框架、無 node/DOM 全域）。呼叫 runTests() 取得逐案 pass/fail。
// 覆蓋核心成長行為：award MXP → 等級/主屬變化、採集 MXP 冪等、主屬 clamp 100、無升級時不發等級事件。

import type { DomainEventDraft, EncounterId, CharacterId } from '../../contracts/core';
import type { ProgressionDefinitionReader } from '../../contracts/progression';
import { createInitialProgressionState } from './state';
import {
  awardMasteryExperience,
  handleGrantGatheringMasteryExperience,
  handleCombatAttackMasteryEarned,
  handleCombatSupportMasteryEarned,
  resolveLevel,
  computeTeachingResult,
} from './system';
import {
  makeFixtureReader,
  makeFixtureAgeInput,
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

// fixture 的 award rule 沒指名 ageExperienceRuleId，所以倍率是 1（不隨年齡縮放的合法形狀）。
const ageInput = () => makeFixtureAgeInput();

const cases: readonly Case[] = [
  {
    // 先前 `resolveBaseExperience(reader, ruleId, ageMultiplier = 1)` 的倍率由呼叫端傳入而預設 1，
    // 全 repo 沒有任何呼叫端傳過別的值——倍率永遠是 1，`AgeExperienceRuleDefinition.stages` 與
    // `ExperienceAwardRuleDefinition.ageExperienceRuleId` 兩份資料從未被讀過。
    name: '年齡經驗倍率來自資料：換一個年齡段就換一個倍率',
    run: () => {
      const AGE_RULE = 'definition:age-experience-rule:standard' as never;
      const base = makeFixtureReader();
      const baseAward = base.getExperienceAwardRule(makeGatheringCommand().experienceAwardRuleId);

      // award rule 指名年齡規則；年齡規則分兩段：未成年 ×2，成年 ×1。
      const reader = {
        ...base,
        getExperienceAwardRule: () => ({ ...baseAward, ageExperienceRuleId: AGE_RULE }),
        getAgeExperienceRule: () => ({
          id: AGE_RULE,
          schemaVersion: 1,
          packId: 'pack:test' as never,
          enabled: true,
          stages: [
            { minAgeDays: 0, maxAgeDays: 5000, experienceMultiplier: 2 },
            { minAgeDays: 5001, experienceMultiplier: 1 },
          ],
        }),
      } as typeof base;

      const grantAt = (birthDay: number): number | undefined => {
        const age = makeFixtureAgeInput({
          definitions: reader,
          worldDay: 20000 as never,
          characters: { getBirthDay: () => birthDay as never },
        });
        const r = handleGrantGatheringMasteryExperience(
          createInitialProgressionState(),
          makeGatheringCommand(),
          reader,
          age,
        );
        return r.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY]?.experience;
      };

      // 出生於 18000 → 年齡 2000 天 → 落在第一段 ×2。
      const young = grantAt(18000);
      // 出生於 0 → 年齡 20000 天 → 落在第二段 ×1。
      const old = grantAt(0);
      if (young === undefined || old === undefined) {
        throw new Error(`兩次發放都應入帳（young=${String(young)} old=${String(old)}）`);
      }
      assert(young === old * 2, `未成年倍率應為成年的兩倍（實得 young=${young} old=${old}）`);
    },
  },
  {
    name: '年齡經驗倍率：年齡不在任何段落內 → 明確拋錯（不夾到最近的一段、不退回 1）',
    run: () => {
      const AGE_RULE = 'definition:age-experience-rule:gapped' as never;
      const base = makeFixtureReader();
      const baseAward = base.getExperienceAwardRule(makeGatheringCommand().experienceAwardRuleId);
      const reader = {
        ...base,
        getExperienceAwardRule: () => ({ ...baseAward, ageExperienceRuleId: AGE_RULE }),
        getAgeExperienceRule: () => ({
          id: AGE_RULE,
          schemaVersion: 1,
          packId: 'pack:test' as never,
          enabled: true,
          // 刻意留缺口：只涵蓋 0..100 天。
          stages: [{ minAgeDays: 0, maxAgeDays: 100, experienceMultiplier: 3 }],
        }),
      } as typeof base;

      let threw = false;
      try {
        handleGrantGatheringMasteryExperience(
          createInitialProgressionState(),
          makeGatheringCommand(),
          reader,
          makeFixtureAgeInput({
            definitions: reader,
            worldDay: 20000 as never,
            characters: { getBirthDay: () => 0 as never },
          }),
        );
      } catch {
        threw = true;
      }
      assert(threw, 'stages 有缺口時必須拋錯——缺口不得由程式補');
    },
  },

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
    // 先前這裡是「信任 payload.creditedUseCount 已由 Combat/Sequence 收斂」。信任的代價是上游算錯
    // 時 MXP 直接超發，而且沒有任何地方會失敗。doc §8.6：encounter 來源每場每技能上限 3（結構
    // 不變量 SUPPORT_USE_CAP），combatSequence 來源可等於成功場次。
    name: '支援 MXP：encounter 來源超過每場上限即拋錯；combatSequence 來源不受該上限',
    run: () => {
      const base = makeFixtureReader();
      const reader: ProgressionDefinitionReader = {
        ...base,
        getSupportMasteryAwardRule: () =>
          ({ fixedExperiencePerUse: 10, masterySplits: [{ masteryId: SWORD_MASTERY, ratio: 1 }] }) as never,
      };
      const payload = (source: unknown, creditedUseCount: number) =>
        ({
          source,
          characterId: HERO,
          skillId: 'skill-heal' as never,
          supportMasteryAwardRuleId: 'rule-support' as never,
          creditedUseCount,
        }) as never;
      const encounter = { kind: 'encounter' as const, encounterId: 'enc-cap' as EncounterId };
      const sequence = { kind: 'combatSequence' as const, sequenceId: 'seq-cap' as never };
      const s0 = createInitialProgressionState();

      // 上限內：照常入帳（3 × 10 = 30）。
      const ok3 = handleCombatSupportMasteryEarned(s0, payload(encounter, 3), reader);
      assert(
        ok3.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY]?.experience === 30,
        '每場 3 次仍在上限內，應入帳 30',
      );

      // 超過上限：拋錯（不夾值、不靜默略過）。
      let threwOverCap = false;
      try {
        handleCombatSupportMasteryEarned(s0, payload(encounter, 4), reader);
      } catch {
        threwOverCap = true;
      }
      assert(threwOverCap, 'encounter 來源超過每場上限 3 必須拋錯');

      // 非整數／負數同樣是程式錯誤。
      let threwNegative = false;
      try {
        handleCombatSupportMasteryEarned(s0, payload(encounter, -1), reader);
      } catch {
        threwNegative = true;
      }
      assert(threwNegative, '負數計次必須拋錯');

      // combatSequence 來源：計次等於成功場次，不受每場上限限制。
      const seq = handleCombatSupportMasteryEarned(s0, payload(sequence, 10), reader);
      assert(
        seq.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY]?.experience === 100,
        'combatSequence 來源不受每場上限，10 次應入帳 100',
      );
    },
  },
  {
    name: '#2：同場多名支援者各自入帳（key 含 characterId:skillId，不誤擋他人）',
    run: () => {
      const base = makeFixtureReader();
      const reader: ProgressionDefinitionReader = {
        ...base,
        getSupportMasteryAwardRule: () =>
          ({ fixedExperiencePerUse: 10, masterySplits: [{ masteryId: SWORD_MASTERY, ratio: 1 }] }) as never,
      };
      const other = 'runtime:character:mage' as CharacterId;
      const src = { kind: 'encounter' as const, encounterId: 'enc-1' as EncounterId };
      const payload = (characterId: CharacterId) => ({
        source: src,
        characterId,
        skillId: 'skill-heal' as never,
        supportMasteryAwardRuleId: 'rule-support' as never,
        creditedUseCount: 1,
      });
      const s0 = createInitialProgressionState();
      const r1 = handleCombatSupportMasteryEarned(s0, payload(HERO), reader);
      const r2 = handleCombatSupportMasteryEarned(r1.nextSlice, payload(other), reader);
      const heroExp = r2.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY]?.experience;
      const otherExp = r2.nextSlice.characterProgress[other]?.masteries[SWORD_MASTERY]?.experience;
      assert(heroExp === 10, `HERO 應得 10（實得 ${heroExp}）`);
      assert(otherExp === 10, `第二名支援者也應得 10（實得 ${otherExp}），不得被誤當重放`);
      // 同一 (character, skill) 重放 → no-op。
      const r3 = handleCombatSupportMasteryEarned(r2.nextSlice, payload(HERO), reader);
      assert(
        r3.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY]?.experience === 10,
        'HERO 重放不得再加',
      );
      assert(r3.outgoingMessages.length === 0, 'HERO 重放不應再 emit');
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

      const r1 = handleGrantGatheringMasteryExperience(s0, cmd, reader, ageInput());
      const exp1 = r1.nextSlice.characterProgress[HERO]?.masteries[SWORD_MASTERY]?.experience;
      assert(exp1 === 150, `first grant experience 150 (got ${exp1})`);
      assert(r1.outgoingMessages.length > 0, 'first grant emits events');

      // 重送同一 Resolution：state 不再變化、無事件。
      const r2 = handleGrantGatheringMasteryExperience(r1.nextSlice, cmd, reader, ageInput());
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
