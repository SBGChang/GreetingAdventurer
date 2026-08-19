// domain-services/statistics/statistics.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。runTests() 執行全部案例；任一失敗即 throw。
//
// 覆蓋面對照 docs/00_core/architecture/16_derived_statistics.md §7 的十條不變量，加上每一種
// StatisticsCalculationErrorCode 至少一個案例。

import type { CharacterStatisticsSnapshot } from '../../contracts/statistics';
import type { EffectDefinitionId } from '../../contracts/core';
import {
  BALANCE,
  FIXTURE,
  defaultMasterySnapshots,
  loadout,
  makeInput,
  masteryProgress,
  primaries,
  stubDefinitionReader,
  stubResolverPort,
} from './fixtures';
import {
  StatisticsCalculationError,
  createCharacterStatisticsCalculator,
  type StatisticsCalculatorDeps,
} from './statistics';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────────

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// 副屬是浮點運算的結果；比對用容差，但容差要小到抓得出「少乘一個係數」。
function assertClose(actual: number, expected: number, msg: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${msg}（期望 ${expected}，實得 ${actual}）`);
  }
}

function deps(overrides?: Partial<StatisticsCalculatorDeps>): StatisticsCalculatorDeps {
  return {
    definitions: stubDefinitionReader(),
    resolvers: stubResolverPort(),
    ...overrides,
  };
}

function calculator(overrides?: Partial<StatisticsCalculatorDeps>) {
  return createCharacterStatisticsCalculator(deps(overrides));
}

function expectError(code: string, run: () => unknown): void {
  let thrown: unknown;
  try {
    run();
  } catch (e) {
    thrown = e;
  }
  if (!(thrown instanceof StatisticsCalculationError)) {
    throw new Error(`應拋 StatisticsCalculationError（實得 ${String(thrown)}）`);
  }
  if (thrown.code !== code) {
    throw new Error(`錯誤碼應為 ${code}（實得 ${thrown.code}）`);
  }
}

function physical(snapshot: CharacterStatisticsSnapshot): number {
  const value = snapshot.secondaryAttributes[FIXTURE.physicalDamage];
  if (value === undefined) throw new Error('物理傷害未算出');
  return value;
}

function magic(snapshot: CharacterStatisticsSnapshot): number {
  const value = snapshot.secondaryAttributes[FIXTURE.magicDamage];
  if (value === undefined) throw new Error('魔法傷害未算出');
  return value;
}

function reduction(snapshot: CharacterStatisticsSnapshot): number {
  const value = snapshot.secondaryAttributes[FIXTURE.generalReduction];
  if (value === undefined) throw new Error('一般減傷未算出');
  return value;
}

// 單手環首刀在基準主屬（肌 40、協 35）下的裝備項：1.25×40 + 0.95×35。
const RING_SABER_ATTRIBUTE_TERM = 1.25 * 40 + 0.95 * 35;
// 鐵骨扇：0.85×40 + 0.72×35。
const IRON_FAN_ATTRIBUTE_TERM = 0.85 * 40 + 0.72 * 35;
// 雙手劍：2.5×40 + 1.9×35。
const GREATSWORD_ATTRIBUTE_TERM = 2.5 * 40 + 1.9 * 35;
// 單手武器熟練 Lv.5 → balanceModel.masteryMultipliers[5]。
const MASTERY_LV5 = BALANCE.masteryMultipliers[5]!;

const cases: readonly Readonly<{ name: string; run: () => void }>[] = [
  // ── 不變量 1：五項主屬最終介於 0～cap ────────────────────────────────────
  {
    name: '不變量 1：熟練度給的主屬超出上限被 clamp 到 primaryAttributeCap（資料，非程式常數）',
    run: () => {
      const snapshot = calculator().calculate(
        makeInput({ primaryAttributesFromMastery: primaries({ muscle: 180, intelligence: -20 }) }),
      );
      assert(
        snapshot.effectivePrimaryAttributes.muscle === 100,
        `肌力應夾到 100（實得 ${snapshot.effectivePrimaryAttributes.muscle}）`,
      );
      assert(
        snapshot.effectivePrimaryAttributes.intelligence === 0,
        `智力應夾到 0（實得 ${snapshot.effectivePrimaryAttributes.intelligence}）`,
      );
    },
  },
  {
    name: '不變量 1：年齡修正之後仍再夾一次（老化不得把主屬壓到負值）',
    run: () => {
      // 年齡遠超衰退門檻 + 主屬本來就很低 → 修正後為負，必須被夾回 0。
      const snapshot = calculator().calculate(
        makeInput({
          ageDays: BALANCE.ageDeclineStartDays + BALANCE.ageDeclinePeriodDays * 40,
          primaryAttributesFromMastery: primaries({ muscle: 1, reaction: 1 }),
        }),
      );
      assert(
        snapshot.effectivePrimaryAttributes.muscle === 0,
        `肌力應夾回 0（實得 ${snapshot.effectivePrimaryAttributes.muscle}）`,
      );
    },
  },
  // ── 不變量 7：年齡修正由同一條 Age Rule 供給 ─────────────────────────────
  {
    name: '不變量 7：年齡修正走 AgeModifierRule 的 Resolver（同一條 Rule，量在資料）',
    run: () => {
      const young = calculator().calculate(makeInput({ ageDays: 365 * 20 }));
      const old = calculator().calculate(
        makeInput({ ageDays: BALANCE.ageDeclineStartDays + BALANCE.ageDeclinePeriodDays }),
      );
      assert(
        old.effectivePrimaryAttributes.muscle < young.effectivePrimaryAttributes.muscle,
        '高齡角色的有效肌力應低於年輕角色',
      );
      assert(
        old.effectivePrimaryAttributes.intelligence ===
          young.effectivePrimaryAttributes.intelligence,
        '年齡 Resolver 未列出的主屬不得被動到',
      );
    },
  },
  // ── 不變量 5：聲望不併入魅力 ─────────────────────────────────────────────
  {
    name: '不變量 5：聲望 Resolver 回傳 charisma delta → 明確拒絕（聲望不得併入魅力）',
    run: () => {
      expectError('statistics/reputation-must-not-contribute-to-charisma', () =>
        calculator({ resolvers: stubResolverPort({ reputationCharismaDelta: 5 }) }).calculate(
          makeInput({ reputation: 900 }),
        ),
      );
    },
  },
  {
    name: '聲望高低不改變魅力（合法的聲望 Resolver 不動主屬）',
    run: () => {
      const low = calculator().calculate(makeInput({ reputation: 0 }));
      const high = calculator().calculate(makeInput({ reputation: 5000 }));
      assert(
        low.effectivePrimaryAttributes.charisma === high.effectivePrimaryAttributes.charisma,
        '魅力純由熟練度帶動，不得隨聲望變動',
      );
    },
  },
  // ── 副屬公式：主屬 × 裝備係數 × 持握 × 熟練度 ─────────────────────────────
  {
    name: '單手：物理傷害 = 裝備主屬項 × 單手持握 × 熟練度係數（三個係數皆來自資料）',
    run: () => {
      const snapshot = calculator().calculate(makeInput());
      assertClose(
        physical(snapshot),
        RING_SABER_ATTRIBUTE_TERM * BALANCE.singleHandMultiplier * MASTERY_LV5,
        '單手物理傷害',
      );
    },
  },
  {
    name: '不變量 3（雙持）：主手 × 0.5 + 副手 × 0.35，總輸出為兩手相加',
    run: () => {
      const snapshot = calculator().calculate(
        makeInput({
          equipmentLoadout: loadout({
            set0: { mainHandItemId: FIXTURE.ringSaberItemId, offHandItemId: FIXTURE.ironFanItemId },
          }),
        }),
      );
      const expected =
        RING_SABER_ATTRIBUTE_TERM * BALANCE.dualWieldMainHandMultiplier * MASTERY_LV5 +
        IRON_FAN_ATTRIBUTE_TERM * BALANCE.dualWieldOffHandMultiplier * MASTERY_LV5;
      assertClose(physical(snapshot), expected, '雙持物理傷害');
    },
  },
  {
    name: '不變量 3（雙手）：兩手指向同一實例 → 只計一次，套雙手倍率',
    run: () => {
      const snapshot = calculator().calculate(
        makeInput({
          equipmentLoadout: loadout({
            set0: {
              mainHandItemId: FIXTURE.greatswordItemId,
              offHandItemId: FIXTURE.greatswordItemId,
            },
          }),
        }),
      );
      assertClose(
        physical(snapshot),
        GREATSWORD_ATTRIBUTE_TERM * BALANCE.twoHandMultiplier * MASTERY_LV5,
        '雙手劍物理傷害（不得算兩次）',
      );
    },
  },
  {
    name: '不變量 3（單手 + 盾）：副手是非武器 → 不構成雙持，主手仍是單手倍率',
    run: () => {
      const withShield = calculator().calculate(
        makeInput({
          equipmentLoadout: loadout({
            set0: { mainHandItemId: FIXTURE.ringSaberItemId, offHandItemId: FIXTURE.shieldItemId },
          }),
        }),
      );
      const soloWeapon = calculator().calculate(makeInput());
      assertClose(
        physical(withShield),
        physical(soloWeapon),
        '配盾不得把主手降成雙持倍率',
      );
    },
  },
  {
    name: 'GDD §511 守門：副手放單手武器只影響倍率分類，服務不做合法性判斷（不得拒絕）',
    run: () => {
      // 只有副手有一把單手武器：這是 inventory 的合法性問題，本服務只算數值。
      const offHandOnly = calculator().calculate(
        makeInput({
          equipmentLoadout: loadout({ set0: { offHandItemId: FIXTURE.ringSaberItemId } }),
        }),
      );
      assertClose(
        physical(offHandOnly),
        RING_SABER_ATTRIBUTE_TERM * BALANCE.singleHandMultiplier * MASTERY_LV5,
        '副手單手武器（單手倍率）',
      );
      // 同組混搭兩把不同武器同樣不得被拒絕。
      const mixed = calculator().calculate(
        makeInput({
          equipmentLoadout: loadout({
            set0: { mainHandItemId: FIXTURE.ironFanItemId, offHandItemId: FIXTURE.ringSaberItemId },
          }),
        }),
      );
      assert(physical(mixed) > 0, '混搭兩把單手武器應算出正值，不得拋錯');
    },
  },
  // ── 裝備係數通道 ─────────────────────────────────────────────────────────
  {
    name: '通道是資料：刀不供給魔法傷害通道 → 魔法傷害為 0（不是「預設係數 1」）',
    run: () => {
      const snapshot = calculator().calculate(makeInput());
      assertClose(magic(snapshot), 0, '持刀時的魔法傷害');
      assert(physical(snapshot) > 0, '持刀時的物理傷害應為正');
    },
  },
  {
    name: '通道是資料：換成法杖組 → 魔法傷害為正、物理傷害為 0',
    run: () => {
      const snapshot = calculator().calculate(
        makeInput({ selectedWeaponSetId: FIXTURE.weaponSet1 }),
      );
      assert(magic(snapshot) > 0, '持杖時的魔法傷害應為正');
      assertClose(physical(snapshot), 0, '持杖時的物理傷害');
    },
  },
  {
    name: 'masteryCoefficientResolverId 未給 → 少一個乘項，而不是補一個預設係數',
    run: () => {
      // 魔法傷害規則刻意沒有熟練度 Resolver；法杖熟練 Lv.3（倍率 != 1）。
      // 若程式用「沒有就當 1」以外的方式（例如誤用熟練度）會偏離這個值。
      const snapshot = calculator().calculate(
        makeInput({ selectedWeaponSetId: FIXTURE.weaponSet1 }),
      );
      assertClose(magic(snapshot), 1.4 * 30 * BALANCE.singleHandMultiplier, '魔法傷害（無熟練度乘項）');
      const staffMastery: number = BALANCE.masteryMultipliers[3]!;
      assert(staffMastery !== 1, 'fixture 前提：法杖熟練倍率不得為 1，否則本案例證明不了任何事');
    },
  },
  {
    name: '防具不套持握倍率；多格甲（body + head 同一件）只計一次係數',
    run: () => {
      const snapshot = calculator().calculate(makeInput());
      // 長袍 generalReduction 通道係數 2、主屬項 0.6 × 肌 40 = 24 → raw 48。
      const raw = 2 * (0.6 * 40);
      assertClose(reduction(snapshot), raw / (raw + BALANCE.reductionHalfPoint), '一般減傷（單件多格甲）');
    },
  },
  // ── safeRaw ─────────────────────────────────────────────────────────────
  {
    name: 'doc §4：負 raw 在進入遞減公式前一律 safeRaw = max(0, raw)（不得產生負減傷）',
    run: () => {
      const snapshot = calculator().calculate(
        makeInput({
          equipmentLoadout: loadout({
            set0: {},
            armorSlots: { [FIXTURE.bodySlot]: FIXTURE.cursedRobeItemId },
          }),
        }),
      );
      assertClose(reduction(snapshot), 0, '負係數防具的一般減傷應為 0');
    },
  },
  // ── 生命／魔力上限與負重 ────────────────────────────────────────────────
  {
    name: 'maxHealth／maxMana 取自 StatisticsRule 指名的副屬（對照是資料，不是寫死的 ID）',
    run: () => {
      const snapshot = calculator().calculate(makeInput());
      assertClose(snapshot.maxHealth, BALANCE.maxHealthBias + BALANCE.maxHealthPerMuscle * 40, '生命上限');
      assertClose(snapshot.maxMana, BALANCE.maxManaBias + BALANCE.maxManaPerIntelligence * 30, '魔力上限');
      assert(
        snapshot.secondaryAttributes[FIXTURE.maxHealth] === snapshot.maxHealth,
        'maxHealth 欄位與同名副屬必須一致',
      );
    },
  },
  {
    name: '不變量 9：負重上限只由 Carry Capacity Rule 與有效肌力決定',
    run: () => {
      const snapshot = calculator().calculate(makeInput());
      assertClose(
        snapshot.carryingCapacity,
        BALANCE.baseWeightCapacity + BALANCE.strengthCapacityPerPoint * 40,
        '負重上限',
      );
      // 換裝、換武器組、換熟練度都不得改變負重上限（只有有效肌力會）。
      const heavier = calculator().calculate(
        makeInput({
          equipmentLoadout: loadout({
            set0: {
              mainHandItemId: FIXTURE.greatswordItemId,
              offHandItemId: FIXTURE.greatswordItemId,
            },
          }),
        }),
      );
      assertClose(heavier.carryingCapacity, snapshot.carryingCapacity, '換裝後的負重上限');
    },
  },
  {
    name: 'calculateCarryCapacity 與完整快照的 carryingCapacity 逐位相同（inventory encumbrance 入口）',
    run: () => {
      const calc = calculator();
      const input = makeInput();
      const standalone = calc.calculateCarryCapacity({
        characterId: input.characterId,
        ageDays: input.ageDays,
        reputation: input.reputation,
        primaryAttributesFromMastery: input.primaryAttributesFromMastery,
        conditionModifierRefs: input.conditionModifierRefs,
        statisticsRuleId: input.statisticsRuleId,
      });
      assert(
        standalone === calc.calculate(input).carryingCapacity,
        `窄化入口與完整快照必須同值（實得 ${standalone}）`,
      );
    },
  },
  {
    name: 'calculateCarryCapacity 也吃年齡修正（與角色面板同一條 Age Rule）',
    run: () => {
      const calc = calculator();
      const base = {
        characterId: FIXTURE.characterId,
        reputation: 0,
        primaryAttributesFromMastery: primaries(),
        conditionModifierRefs: [],
        statisticsRuleId: FIXTURE.statisticsRuleId,
      } as const;
      const young = calc.calculateCarryCapacity({ ...base, ageDays: 365 * 20 });
      const old = calc.calculateCarryCapacity({
        ...base,
        ageDays: BALANCE.ageDeclineStartDays + BALANCE.ageDeclinePeriodDays * 4,
      });
      assert(old < young, `高齡的負重上限應較低（young ${young} / old ${old}）`);
    },
  },
  // ── 不變量 2／8：同輸入同結果，三個入口一致 ──────────────────────────────
  {
    name: '不變量 8：純函式——同一份輸入呼叫兩次得到逐位相同的 JSON',
    run: () => {
      const calc = calculator();
      const first = JSON.stringify(calc.calculate(makeInput()));
      const second = JSON.stringify(calc.calculate(makeInput()));
      assert(first === second, '同輸入必須逐位相同');
      // 不同的 Calculator 實例（同 deps 形狀）也必須相同：服務不得帶內部狀態。
      assert(first === JSON.stringify(calculator().calculate(makeInput())), '不得有跨呼叫的內部狀態');
    },
  },
  {
    name: '不變量 2：calculate / calculateAction / previewEquipment 對同一份輸入得到同一組基準副屬',
    run: () => {
      const calc = calculator();
      const input = makeInput();
      const fromCalculate = JSON.stringify(calc.calculate(input));
      const fromAction = JSON.stringify(calc.calculateAction(input));
      const fromPreview = JSON.stringify(calc.previewEquipment({ before: input, after: input }).before);
      assert(fromCalculate === fromAction, 'calculateAction 應與 calculate 同值');
      assert(fromCalculate === fromPreview, 'previewEquipment.before 應與 calculate 同值');
    },
  },
  {
    name: 'calculateAction 換武器組會改變結果（不是常數，也不是忽略輸入）',
    run: () => {
      const calc = calculator();
      const withSaber = calc.calculateAction(makeInput({ selectedWeaponSetId: FIXTURE.weaponSet0 }));
      const withStaff = calc.calculateAction(makeInput({ selectedWeaponSetId: FIXTURE.weaponSet1 }));
      assert(physical(withSaber) !== physical(withStaff), '換組後物理傷害應改變');
      assert(magic(withSaber) !== magic(withStaff), '換組後魔法傷害應改變');
    },
  },
  {
    name: 'previewEquipment 回傳 before / after 兩份快照，且反映配裝差異',
    run: () => {
      const before = makeInput();
      const after = makeInput({
        equipmentLoadout: loadout({
          set0: { mainHandItemId: FIXTURE.greatswordItemId, offHandItemId: FIXTURE.greatswordItemId },
          revision: 2,
        }),
      });
      const result = calculator().previewEquipment({ before, after });
      assert(physical(result.after) > physical(result.before), '換上雙手劍後物理傷害應提高');
      assert(
        result.before.sourceRevisionKey !== result.after.sourceRevisionKey,
        'Loadout revision 不同時 sourceRevisionKey 必須不同',
      );
    },
  },
  // ── sourceRevisionKey（doc §6）────────────────────────────────────────────
  {
    name: 'sourceRevisionKey 含 Statistics Rule ID 與 Definition Manifest Hash',
    run: () => {
      const key = calculator().calculate(makeInput()).sourceRevisionKey;
      assert(key.includes(String(FIXTURE.statisticsRuleId)), `key 應含 rule id（實得 ${key}）`);
      assert(key.includes(FIXTURE.manifestHash), `key 應含 manifest hash（實得 ${key}）`);
    },
  },
  {
    name: 'sourceRevisionKey 不隨 masterySnapshots 陣列順序改變（可重播）',
    run: () => {
      const calc = calculator();
      const forward = calc.calculate(makeInput({ masterySnapshots: [...defaultMasterySnapshots] }));
      const reversed = calc.calculate(
        makeInput({ masterySnapshots: [...defaultMasterySnapshots].reverse() }),
      );
      assert(
        forward.sourceRevisionKey === reversed.sourceRevisionKey,
        'key 不得依賴輸入陣列順序',
      );
    },
  },
  {
    name: 'sourceRevisionKey 隨角色 revision 前進而改變（Cache 會失效）',
    run: () => {
      const calc = calculator();
      const a = calc.calculate(makeInput({ characterRevision: 1 }));
      const b = calc.calculate(makeInput({ characterRevision: 2 }));
      assert(a.sourceRevisionKey !== b.sourceRevisionKey, 'character revision 改變時 key 必須改變');
    },
  },
  // ── 每一種 typed error ───────────────────────────────────────────────────
  {
    name: 'error：statisticsRule 沒把 maxHealth 副屬列進 secondaryRuleIds → 明確拒絕',
    run: () => {
      expectError('statistics/secondary-rule-not-in-statistics-rule', () =>
        calculator({
          definitions: stubDefinitionReader({
            secondaryRuleIds: [FIXTURE.physicalDamage, FIXTURE.magicDamage, FIXTURE.maxMana],
          }),
        }).calculate(makeInput()),
      );
    },
  },
  {
    name: 'error：selectedWeaponSetId 不在 Loadout 的三組裡 → 明確拒絕',
    run: () => {
      expectError('statistics/weapon-set-not-in-loadout', () =>
        calculator().calculate(makeInput({ selectedWeaponSetId: FIXTURE.absentWeaponSet })),
      );
    },
  },
  {
    name: 'error：裝備著的實例沒有對應的裝備定義 View → 明確拒絕（不得當成「沒有係數」）',
    run: () => {
      expectError('statistics/equipment-definition-view-missing', () =>
        calculator().calculate(
          makeInput({
            equipmentLoadout: loadout({ set0: { mainHandItemId: FIXTURE.absentItemId } }),
          }),
        ),
      );
    },
  },
  {
    name: 'error：裝備宣告的對應熟練度沒有進度快照 → 明確拒絕（不得當 Lv.0）',
    run: () => {
      expectError('statistics/mastery-snapshot-missing', () =>
        calculator().calculate(
          makeInput({ masterySnapshots: [masteryProgress(FIXTURE.staffMasteryId, 3)] }),
        ),
      );
    },
  },
  {
    name: 'error：帶狀態修正引用時明確拒絕（Reader 沒有 Effect getter，不得默默忽略）',
    run: () => {
      expectError('statistics/condition-modifier-view-unavailable', () =>
        calculator().calculate(
          makeInput({
            conditionModifierRefs: ['definition:effect:miasma' as EffectDefinitionId],
          }),
        ),
      );
    },
  },
  {
    name: 'error：previewEquipment 的 before / after 不是同一名角色 → 明確拒絕',
    run: () => {
      expectError('statistics/preview-character-mismatch', () =>
        calculator().previewEquipment({
          before: makeInput(),
          after: makeInput({ characterId: FIXTURE.otherCharacterId }),
        }),
      );
    },
  },
  {
    name: 'error：calculateCarryCapacity 同樣不接受未解析的狀態修正',
    run: () => {
      expectError('statistics/condition-modifier-view-unavailable', () =>
        calculator().calculateCarryCapacity({
          characterId: FIXTURE.characterId,
          ageDays: 365 * 20,
          reputation: 0,
          primaryAttributesFromMastery: primaries(),
          conditionModifierRefs: ['definition:effect:miasma' as EffectDefinitionId],
          statisticsRuleId: FIXTURE.statisticsRuleId,
        }),
      );
    },
  },
  // ── 不變量 10：不輸出移動速度 ────────────────────────────────────────────
  {
    name: '不變量 10：Snapshot 只含 StatisticsRule 列出的副屬，沒有移動速度這一項',
    run: () => {
      const snapshot = calculator().calculate(makeInput());
      const keys = Object.keys(snapshot.secondaryAttributes);
      assert(keys.length === 5, `副屬數量應等於 secondaryRuleIds 長度（實得 ${keys.length}）`);
      assert(
        !keys.some((k) => k.includes('movement') || k.includes('speed')),
        '第一版不得輸出移動速度副屬',
      );
      assert(
        snapshot.secondaryAttributes[FIXTURE.absentSecondary] === undefined,
        '未列入 secondaryRuleIds 的副屬不得出現在 Snapshot',
      );
    },
  },
];

export type StatisticsTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestsVerbose(): readonly StatisticsTestResult[] {
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
    throw new Error(`statistics service: ${failed.length}/${results.length} tests failed\n${detail}`);
  }
}
