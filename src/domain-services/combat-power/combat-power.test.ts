// domain-services/combat-power/combat-power.test.ts
// `export function runTests(): void`；任一案例失敗即 throw。
//
// 這套測試的重心不是「函式會不會跑」，而是四件會在換內容時出事的性質：
//
//   1. **戰力排序由資料決定。** 同一組單位、同一份程式，只換 Feature Rule 的 coefficient，
//      排名必須反轉。這是本服務最重要的驗收條件（案例「換 rule params → 排序反轉」）。
//   2. **資格條件真的會擋。** 武器需求不符的技能、Tag 條件不成立的裝備效果一律不計分。
//   3. **缺資料明確失敗。** 每一種拒絕碼至少一個案例；沒有任何一條路徑靠預設值撐過去。
//   4. **決定性。** 同 Input／Rule／Revision 得到逐位相同的 Snapshot 與 Breakdown。
//
// Reader 用的是 app/content 的**真** adapter（不是手刻的 fixture reader），所以「Definition 從
// registry 讀出來的形狀」與正式路徑同一條。

import type {
  CombatPowerFormationMember,
  CombatPowerRuleDefinition,
  CombatPowerSkillDefinitionView,
  CombatPowerUnitInput,
  CombatUnitStatisticsSnapshot,
  EquipmentLoadoutPowerCandidate,
} from '../../contracts/combat-power';
import type {
  CharacterId,
  EquipmentEffectDefinitionId,
  Revision,
  SkillDefinitionId,
  WeaponRequirementId,
} from '../../contracts/core';
import { createCombatPowerDefinitionReader } from '../../app/content/combat-power-reader';
import {
  CombatPowerRejection,
  CombatPowerRejectionCode,
  createCombatPowerCalculator,
  createCombatPowerQuery,
  type CombatPowerRejectionCodeValue,
} from './combat-power';
import {
  BRAWLER_STATISTICS,
  EMPTY_LOADOUT,
  FIXTURE,
  HUNT_OBJECTIVE,
  PURCHASE_OBJECTIVE,
  SCHOLAR_STATISTICS,
  cell,
  configurationKey,
  createFixturePorts,
  createFixtureRegistry,
  createFixtureResolverPort,
  defaultEncounterComposition,
  defaultFixtureWorld,
  defaultTeamComposition,
  statisticsSnapshot,
  weaponSetConfiguration,
  type FixtureContentVariant,
  type FixtureWorld,
} from './fixtures';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectRejection(run: () => unknown, code: CombatPowerRejectionCodeValue, label: string): void {
  try {
    run();
  } catch (error) {
    if (error instanceof CombatPowerRejection) {
      assert(error.code === code, `${label}：預期 ${code}，實得 ${error.code}`);
      return;
    }
    throw new Error(`${label}：預期 CombatPowerRejection(${code})，實得 ${String(error)}`);
  }
  throw new Error(`${label}：預期被拒絕，但成功回傳了`);
}

function expectThrow(run: () => unknown, label: string): void {
  try {
    run();
  } catch {
    return;
  }
  throw new Error(`${label}：預期拋錯，但成功回傳了`);
}

// ── 測試用組裝 ────────────────────────────────────────────────────────────────

function harness(variant: FixtureContentVariant = 'muscleHeavy') {
  const reader = createCombatPowerDefinitionReader(createFixtureRegistry(variant));
  const resolvers = createFixtureResolverPort();
  const calculator = createCombatPowerCalculator({ definitions: reader, resolvers });
  return { reader, resolvers, calculator, rule: reader.getRule(FIXTURE.ruleId) };
}

function queryHarness(
  world: FixtureWorld = defaultFixtureWorld(),
  variant: FixtureContentVariant = 'muscleHeavy',
) {
  const base = harness(variant);
  const ports = createFixturePorts(world);
  const query = createCombatPowerQuery({
    definitions: base.reader,
    calculator: base.calculator,
    resolvers: base.resolvers,
    statistics: ports.statistics,
    loadout: ports.loadout,
    team: ports.team,
    encounter: ports.encounter,
    questOpposition: ports.questOpposition,
  });
  return { ...base, query };
}

function characterUnitInput(
  reader: ReturnType<typeof createCombatPowerDefinitionReader>,
  params: Readonly<{
    characterId: CharacterId;
    statistics: CombatUnitStatisticsSnapshot;
    satisfiedWeaponRequirementIds: readonly WeaponRequirementId[];
    skillIds: readonly SkillDefinitionId[];
    equipmentEffectIds: readonly EquipmentEffectDefinitionId[];
    sourceRevisionKey?: string;
  }>,
): CombatPowerUnitInput {
  return {
    unitRef: { kind: 'character', characterId: params.characterId },
    statistics: params.statistics,
    selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
    satisfiedWeaponRequirementIds: [...params.satisfiedWeaponRequirementIds],
    configuredSkills: params.skillIds.map((id) => reader.getSkillView(id)),
    activeEquipmentEffects: params.equipmentEffectIds.map((id) => reader.getEquipmentEffectView(id)),
    sourceRevisionKey:
      params.sourceRevisionKey === undefined ? 'input@base@1' : params.sourceRevisionKey,
  };
}

function member(unit: CombatPowerUnitInput, row: number, col: number): CombatPowerFormationMember {
  return { unit, anchorCell: cell(row, col), occupiedCells: [cell(row, col)] };
}

function featureAmount(
  snapshot: Readonly<{ featureBreakdown: readonly { featureId: unknown; weightedAmount: number }[] }>,
  featureId: unknown,
): number {
  const found = snapshot.featureBreakdown.find(
    (entry) => String(entry.featureId) === String(featureId),
  );
  if (found === undefined) throw new Error(`breakdown 缺 feature ${String(featureId)}`);
  return found.weightedAmount;
}

// brawler（muscle 40 / int 10 / attackPower 12 / maxHealth 100），配 slash + heal、滿足單手劍需求、
// 帶 wardAlways 效果，在 muscleHeavy 變體下的逐項：
//   muscle        40 × 2   = 80
//   intelligence  10 × 0.5 = 5
//   attackPower   12 × 1   = 12
//   health        (100 × 0.5 transform) × 1 = 50
//   healing       heal 的 10 × 1 = 10   （slash 沒有 capability 貢獻）
//   ward          wardAlways 的 7 × 1 = 7
//   合計 164；minimumPower=1 不生效；roundHalfUp 對整數無變化。
const BRAWLER_EXPECTED_POWER = 164;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  // ══ Calculator：單位 ══════════════════════════════════════════════════════
  {
    name: 'calculateUnit：六項 Feature 各自加權，總和為單位戰力（權重全來自 registry 的 Definition）',
    run: () => {
      const { reader, calculator, rule } = harness();
      const snapshot = calculator.calculateUnit(
        characterUnitInput(reader, {
          characterId: FIXTURE.characterIds.brawler,
          statistics: BRAWLER_STATISTICS,
          satisfiedWeaponRequirementIds: [FIXTURE.weaponRequirementIds.sword],
          skillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
          equipmentEffectIds: [FIXTURE.equipmentEffectIds.wardAlways],
        }),
        rule,
      );
      assert(snapshot.featureBreakdown.length === 6, `應有 6 項 breakdown（實得 ${snapshot.featureBreakdown.length}）`);
      assert(featureAmount(snapshot, FIXTURE.featureIds.muscle) === 80, 'muscle 應為 40×2');
      assert(featureAmount(snapshot, FIXTURE.featureIds.intelligence) === 5, 'intelligence 應為 10×0.5');
      assert(featureAmount(snapshot, FIXTURE.featureIds.attackPower) === 12, 'attackPower 應為 12×1');
      assert(featureAmount(snapshot, FIXTURE.featureIds.health) === 50, 'health 應為 transform 後 50');
      assert(featureAmount(snapshot, FIXTURE.featureIds.healing) === 10, 'healing 應為 heal 的 10');
      assert(featureAmount(snapshot, FIXTURE.featureIds.ward) === 7, 'ward 應為 wardAlways 的 7');
      assert(
        snapshot.totalPower === BRAWLER_EXPECTED_POWER,
        `totalPower 應為 ${BRAWLER_EXPECTED_POWER}（實得 ${snapshot.totalPower}）`,
      );
      assert(String(snapshot.combatPowerRuleId) === String(FIXTURE.ruleId), 'combatPowerRuleId 應為 rule.id');
    },
  },
  {
    name: 'calculateUnit：amountBeforeCoefficient × coefficient === weightedAmount（breakdown 自洽）',
    run: () => {
      const { reader, calculator, rule } = harness();
      const snapshot = calculator.calculateUnit(
        characterUnitInput(reader, {
          characterId: FIXTURE.characterIds.brawler,
          statistics: BRAWLER_STATISTICS,
          satisfiedWeaponRequirementIds: [FIXTURE.weaponRequirementIds.sword],
          skillIds: [FIXTURE.skillIds.heal],
          equipmentEffectIds: [],
        }),
        rule,
      );
      for (const entry of snapshot.featureBreakdown) {
        assert(
          Math.abs(entry.amountBeforeCoefficient * entry.coefficient - entry.weightedAmount) < 1e-9,
          `breakdown 不自洽：${String(entry.featureId)}`,
        );
      }
    },
  },
  {
    name: '換 rule params → 排序反轉（同一組單位、同一份程式，只換 coefficient）',
    run: () => {
      // 兩個單位除了主屬性分布外完全相同；唯一的差異來源是 Feature Rule 的 coefficient。
      const build = (variant: FixtureContentVariant) => {
        const { reader, calculator, rule } = harness(variant);
        const common = {
          satisfiedWeaponRequirementIds: [FIXTURE.weaponRequirementIds.sword],
          skillIds: [FIXTURE.skillIds.heal],
          equipmentEffectIds: [FIXTURE.equipmentEffectIds.wardAlways],
        } as const;
        return {
          brawler: calculator.calculateUnit(
            characterUnitInput(reader, {
              characterId: FIXTURE.characterIds.brawler,
              statistics: BRAWLER_STATISTICS,
              ...common,
            }),
            rule,
          ).totalPower,
          scholar: calculator.calculateUnit(
            characterUnitInput(reader, {
              characterId: FIXTURE.characterIds.scholar,
              statistics: SCHOLAR_STATISTICS,
              ...common,
            }),
            rule,
          ).totalPower,
        };
      };
      const muscleHeavy = build('muscleHeavy');
      const mindHeavy = build('mindHeavy');
      assert(
        muscleHeavy.brawler > muscleHeavy.scholar,
        `muscleHeavy 下 brawler 應較強（${muscleHeavy.brawler} vs ${muscleHeavy.scholar}）`,
      );
      assert(
        mindHeavy.scholar > mindHeavy.brawler,
        `mindHeavy 下 scholar 應較強（${mindHeavy.scholar} vs ${mindHeavy.brawler}）`,
      );
    },
  },
  {
    name: '決定性：同 Input／Rule／Revision → 逐位相同的 Snapshot 與 Breakdown',
    run: () => {
      const { reader, calculator, rule } = harness();
      const input = characterUnitInput(reader, {
        characterId: FIXTURE.characterIds.brawler,
        statistics: BRAWLER_STATISTICS,
        satisfiedWeaponRequirementIds: [FIXTURE.weaponRequirementIds.sword],
        skillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
        equipmentEffectIds: [FIXTURE.equipmentEffectIds.wardAlways],
      });
      const first = calculator.calculateUnit(input, rule);
      const second = calculator.calculateUnit(input, rule);
      assert(JSON.stringify(first) === JSON.stringify(second), '兩次計算的快照應逐位相同');
    },
  },
  {
    name: 'sourceRevisionKey：帶入的 Revision 片段改變 → 快照鍵改變（Cache 會失效）',
    run: () => {
      const { reader, calculator, rule } = harness();
      const base = characterUnitInput(reader, {
        characterId: FIXTURE.characterIds.brawler,
        statistics: BRAWLER_STATISTICS,
        satisfiedWeaponRequirementIds: [],
        skillIds: [],
        equipmentEffectIds: [],
        sourceRevisionKey: 'input@base@1',
      });
      const bumped: CombatPowerUnitInput = { ...base, sourceRevisionKey: 'input@base@2' };
      const keyA = calculator.calculateUnit(base, rule).sourceRevisionKey;
      const keyB = calculator.calculateUnit(bumped, rule).sourceRevisionKey;
      assert(keyA !== keyB, 'Revision 片段不同時 sourceRevisionKey 必須不同');
      assert(keyA.includes(String(FIXTURE.ruleId)), 'sourceRevisionKey 應含 Rule 版本片段');
      assert(
        keyA.includes(BRAWLER_STATISTICS.sourceRevisionKey),
        'sourceRevisionKey 應含 Statistics 快照的版本片段',
      );
    },
  },
  {
    name: '武器需求不符的技能不提供戰力（§8.3）',
    run: () => {
      const { reader, calculator, rule } = harness();
      const withStaff = calculator.calculateUnit(
        characterUnitInput(reader, {
          characterId: FIXTURE.characterIds.scholar,
          statistics: SCHOLAR_STATISTICS,
          satisfiedWeaponRequirementIds: [FIXTURE.weaponRequirementIds.staff],
          skillIds: [FIXTURE.skillIds.arcane],
          equipmentEffectIds: [],
        }),
        rule,
      );
      const withoutStaff = calculator.calculateUnit(
        characterUnitInput(reader, {
          characterId: FIXTURE.characterIds.scholar,
          statistics: SCHOLAR_STATISTICS,
          satisfiedWeaponRequirementIds: [],
          skillIds: [FIXTURE.skillIds.arcane],
          equipmentEffectIds: [],
        }),
        rule,
      );
      // arcane 的 healing 貢獻 baseValue 5 經 scaling Resolver ×2 = 10。
      assert(featureAmount(withStaff, FIXTURE.featureIds.healing) === 10, 'arcane 可用時 healing 應為 10');
      assert(
        featureAmount(withoutStaff, FIXTURE.featureIds.healing) === 0,
        'arcane 不可用時 healing 應為 0',
      );
      assert(withStaff.totalPower > withoutStaff.totalPower, '可用技能應讓戰力更高');
    },
  },
  {
    name: 'Tag 條件不成立的裝備效果不提供戰力；alwaysWhileEquipped 不受影響（§2.3／§7.5）',
    run: () => {
      const { reader, calculator, rule } = harness();
      const bound = (satisfied: readonly WeaponRequirementId[]) =>
        calculator.calculateUnit(
          characterUnitInput(reader, {
            characterId: FIXTURE.characterIds.scholar,
            statistics: SCHOLAR_STATISTICS,
            satisfiedWeaponRequirementIds: satisfied,
            skillIds: [FIXTURE.skillIds.arcane],
            equipmentEffectIds: [FIXTURE.equipmentEffectIds.wardFireBound],
          }),
          rule,
        );
      assert(
        featureAmount(bound([FIXTURE.weaponRequirementIds.staff]), FIXTURE.featureIds.ward) === 11,
        'arcane（fire+attack）可用時 wardFireBound 應計 11',
      );
      assert(
        featureAmount(bound([]), FIXTURE.featureIds.ward) === 0,
        'arcane 不可用時 wardFireBound 不得計分',
      );
      const always = calculator.calculateUnit(
        characterUnitInput(reader, {
          characterId: FIXTURE.characterIds.scholar,
          statistics: SCHOLAR_STATISTICS,
          satisfiedWeaponRequirementIds: [],
          skillIds: [],
          equipmentEffectIds: [FIXTURE.equipmentEffectIds.wardAlways],
        }),
        rule,
      );
      assert(
        featureAmount(always, FIXTURE.featureIds.ward) === 7,
        'alwaysWhileEquipped 不需要任何可用技能',
      );
    },
  },
  {
    name: 'Tag 只滿足一部分的技能無法觸發效果（requiredSkillTagIds 是「全都要」）',
    run: () => {
      const { reader, calculator, rule } = harness();
      // 造一個只帶 attack（缺 fire）的技能 View：不改內容，直接窄化既有 View 的 Tag 清單。
      const slashOnly: CombatPowerSkillDefinitionView = {
        ...reader.getSkillView(FIXTURE.skillIds.slash),
        weaponRequirementIds: [],
      };
      const input: CombatPowerUnitInput = {
        unitRef: { kind: 'character', characterId: FIXTURE.characterIds.brawler },
        statistics: BRAWLER_STATISTICS,
        satisfiedWeaponRequirementIds: [],
        configuredSkills: [slashOnly],
        activeEquipmentEffects: [reader.getEquipmentEffectView(FIXTURE.equipmentEffectIds.wardFireBound)],
        sourceRevisionKey: 'input@partial-tag@1',
      };
      const snapshot = calculator.calculateUnit(input, rule);
      assert(featureAmount(snapshot, FIXTURE.featureIds.ward) === 0, '缺 fire Tag 時效果不得生效');
    },
  },
  {
    name: '重複 Feature ID → duplicate-feature（§7.2）',
    run: () => {
      const { calculator, rule } = harness();
      const { reader } = harness();
      const duplicated: CombatPowerRuleDefinition = {
        ...rule,
        featureRuleIds: [...rule.featureRuleIds, FIXTURE.featureRuleIds.duplicateMuscle],
      };
      expectRejection(
        () =>
          calculator.calculateUnit(
            characterUnitInput(reader, {
              characterId: FIXTURE.characterIds.brawler,
              statistics: BRAWLER_STATISTICS,
              satisfiedWeaponRequirementIds: [],
              skillIds: [],
              equipmentEffectIds: [],
            }),
            duplicated,
          ),
        CombatPowerRejectionCode.DuplicateFeature,
        '重複 Feature ID',
      );
    },
  },
  {
    name: 'Statistics 快照缺該副屬性 → invalid-content（不補 0）',
    run: () => {
      const { reader, calculator, rule } = harness();
      expectRejection(
        () =>
          calculator.calculateUnit(
            characterUnitInput(reader, {
              characterId: FIXTURE.characterIds.brawler,
              statistics: statisticsSnapshot({
                muscle: 40,
                intelligence: 10,
                attackPower: 0,
                maxHealth: 100,
                maxMana: 20,
                revisionKey: 'stats@broken@1',
                omitAttackPower: true,
              }),
              satisfiedWeaponRequirementIds: [],
              skillIds: [],
              equipmentEffectIds: [],
            }),
            rule,
          ),
        CombatPowerRejectionCode.InvalidContent,
        '缺副屬性',
      );
    },
  },
  {
    name: '缺 Feature Rule Definition → Reader 明確拋錯（不回預設規則）',
    run: () => {
      const { calculator, reader, rule } = harness();
      const missing: CombatPowerRuleDefinition = {
        ...rule,
        featureRuleIds: [FIXTURE.featureRuleIds.muscle, 'definition:combat-power-feature-rule:absent' as never],
      };
      expectThrow(
        () =>
          calculator.calculateUnit(
            characterUnitInput(reader, {
              characterId: FIXTURE.characterIds.brawler,
              statistics: BRAWLER_STATISTICS,
              satisfiedWeaponRequirementIds: [],
              skillIds: [],
              equipmentEffectIds: [],
            }),
            missing,
          ),
        '缺 Feature Rule',
      );
    },
  },
  {
    name: 'minimumPower 是下限，rounding 是最終輸出的取整（皆為資料指定）',
    run: () => {
      const { reader, calculator, rule } = harness();
      const weak = statisticsSnapshot({
        muscle: 0,
        intelligence: 0,
        attackPower: 0,
        maxHealth: 0,
        maxMana: 0,
        revisionKey: 'stats@weak@1',
      });
      const snapshot = calculator.calculateUnit(
        characterUnitInput(reader, {
          characterId: FIXTURE.characterIds.brawler,
          statistics: weak,
          satisfiedWeaponRequirementIds: [],
          skillIds: [],
          equipmentEffectIds: [],
        }),
        rule,
      );
      assert(snapshot.totalPower === rule.minimumPower, `全 0 單位應被夾到 minimumPower（實得 ${snapshot.totalPower}）`);

      // 0.5 進位到較大值：maxHealth=1 經 transform 減半 → 0.5，其餘為 0 → 取整為 1。
      const halfPoint = calculator.calculateUnit(
        characterUnitInput(reader, {
          characterId: FIXTURE.characterIds.brawler,
          statistics: statisticsSnapshot({
            muscle: 0,
            intelligence: 0,
            attackPower: 0,
            maxHealth: 1,
            maxMana: 0,
            revisionKey: 'stats@half@1',
          }),
          satisfiedWeaponRequirementIds: [],
          skillIds: [],
          equipmentEffectIds: [],
        }),
        { ...rule, minimumPower: 0 },
      );
      assert(halfPoint.totalPower === 1, `0.5 應進位為 1（實得 ${halfPoint.totalPower}）`);
    },
  },

  // ══ Calculator：隊伍與 Encounter ══════════════════════════════════════════
  {
    name: 'calculateTeam：成員快照與單獨計算逐位相同，再套 Formation Resolver',
    run: () => {
      const { reader, calculator, rule } = harness();
      const brawler = characterUnitInput(reader, {
        characterId: FIXTURE.characterIds.brawler,
        statistics: BRAWLER_STATISTICS,
        satisfiedWeaponRequirementIds: [FIXTURE.weaponRequirementIds.sword],
        skillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
        equipmentEffectIds: [FIXTURE.equipmentEffectIds.wardAlways],
      });
      const scholar = characterUnitInput(reader, {
        characterId: FIXTURE.characterIds.scholar,
        statistics: SCHOLAR_STATISTICS,
        satisfiedWeaponRequirementIds: [FIXTURE.weaponRequirementIds.staff],
        skillIds: [FIXTURE.skillIds.arcane, FIXTURE.skillIds.heal],
        equipmentEffectIds: [FIXTURE.equipmentEffectIds.wardFireBound],
      });
      const solo = calculator.calculateUnit(brawler, rule);
      const team = calculator.calculateTeam(
        {
          teamId: FIXTURE.teamId,
          ruleId: FIXTURE.ruleId,
          members: [member(brawler, 0, 0), member(scholar, 1, 1)],
          formationRevision: 7 as Revision,
          sourceRevisionKey: 'team@player@7',
        },
        rule,
      );
      assert(team.memberPowers.length === 2, '應有 2 個成員快照');
      assert(
        JSON.stringify(team.memberPowers[0]) === JSON.stringify(solo),
        '隊伍內的成員快照應與單獨計算逐位相同',
      );
      // fixture Formation params：1 + 0.1 × 成員數 → 2 人 = 1.2。
      assert(Math.abs(team.formationModifier - 1.2) < 1e-9, `formationModifier 應為 1.2（實得 ${team.formationModifier}）`);
      const summed = team.memberPowers.reduce((sum, snapshot) => sum + snapshot.totalPower, 0);
      assert(
        team.totalPower === Math.round(summed * team.formationModifier),
        `totalPower 應為 round(加總×陣形係數)（實得 ${team.totalPower}）`,
      );
      assert(team.participantCharacterIds.length === 2, 'participantCharacterIds 應涵蓋兩名成員');
    },
  },
  {
    name: '大型單位占九格仍只計一個 Unit（§8.4）',
    run: () => {
      const { reader, calculator, rule } = harness();
      const boss = characterUnitInput(reader, {
        characterId: FIXTURE.characterIds.brawler,
        statistics: BRAWLER_STATISTICS,
        satisfiedWeaponRequirementIds: [],
        skillIds: [],
        equipmentEffectIds: [],
      });
      const occupiedCells = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => cell(row, col)));
      const team = calculator.calculateTeam(
        {
          teamId: FIXTURE.teamId,
          ruleId: FIXTURE.ruleId,
          members: [{ unit: boss, anchorCell: cell(1, 1), occupiedCells }],
          formationRevision: 1 as Revision,
          sourceRevisionKey: 'team@boss@1',
        },
        rule,
      );
      assert(team.memberPowers.length === 1, '占九格的單位仍只有一個成員快照');
      const solo = calculator.calculateUnit(boss, rule).totalPower;
      assert(
        team.totalPower === Math.round(solo * team.formationModifier),
        '不得因占九格而把同一單位加總九次',
      );
    },
  },
  {
    name: '隊伍人數與成員唯一性：0 人、超過 9 人、重複成員皆拒絕（§7.8）',
    run: () => {
      const { reader, calculator, rule } = harness();
      const unit = characterUnitInput(reader, {
        characterId: FIXTURE.characterIds.brawler,
        statistics: BRAWLER_STATISTICS,
        satisfiedWeaponRequirementIds: [],
        skillIds: [],
        equipmentEffectIds: [],
      });
      const base = {
        teamId: FIXTURE.teamId,
        ruleId: FIXTURE.ruleId,
        formationRevision: 1 as Revision,
        sourceRevisionKey: 'team@size@1',
      } as const;
      expectRejection(
        () => calculator.calculateTeam({ ...base, members: [] }, rule),
        CombatPowerRejectionCode.InvalidTeamSize,
        '0 名成員',
      );
      const tooMany: CombatPowerFormationMember[] = Array.from({ length: 10 }, (_value, index) =>
        member(unit, Math.floor(index / 3), index % 3),
      );
      expectRejection(
        () => calculator.calculateTeam({ ...base, members: tooMany }, rule),
        CombatPowerRejectionCode.InvalidTeamSize,
        '10 名成員',
      );
      expectRejection(
        () =>
          calculator.calculateTeam(
            { ...base, members: [member(unit, 0, 0), member(unit, 0, 1)] },
            rule,
          ),
        CombatPowerRejectionCode.InvalidTeamSize,
        '重複成員',
      );
    },
  },
  {
    name: '站位不成立：兩單位同格、anchor 不在占格內、占格為空皆拒絕',
    run: () => {
      const { reader, calculator, rule } = harness();
      const brawler = characterUnitInput(reader, {
        characterId: FIXTURE.characterIds.brawler,
        statistics: BRAWLER_STATISTICS,
        satisfiedWeaponRequirementIds: [],
        skillIds: [],
        equipmentEffectIds: [],
      });
      const scholar = characterUnitInput(reader, {
        characterId: FIXTURE.characterIds.scholar,
        statistics: SCHOLAR_STATISTICS,
        satisfiedWeaponRequirementIds: [],
        skillIds: [],
        equipmentEffectIds: [],
      });
      const base = {
        teamId: FIXTURE.teamId,
        ruleId: FIXTURE.ruleId,
        formationRevision: 1 as Revision,
        sourceRevisionKey: 'team@placement@1',
      } as const;
      expectRejection(
        () =>
          calculator.calculateTeam(
            { ...base, members: [member(brawler, 0, 0), member(scholar, 0, 0)] },
            rule,
          ),
        CombatPowerRejectionCode.InvalidFormation,
        '兩單位同格',
      );
      expectRejection(
        () =>
          calculator.calculateTeam(
            {
              ...base,
              members: [{ unit: brawler, anchorCell: cell(2, 2), occupiedCells: [cell(0, 0)] }],
            },
            rule,
          ),
        CombatPowerRejectionCode.InvalidFormation,
        'anchor 不在占格內',
      );
      expectRejection(
        () =>
          calculator.calculateTeam(
            { ...base, members: [{ unit: brawler, anchorCell: cell(0, 0), occupiedCells: [] }] },
            rule,
          ),
        CombatPowerRejectionCode.InvalidFormation,
        '占格為空',
      );
    },
  },
  {
    name: '單位種類放錯邊：隊伍收到 Monster、Encounter 收到 Character 皆拒絕',
    run: () => {
      const { reader, calculator, rule } = harness();
      const monster: CombatPowerUnitInput = {
        unitRef: {
          kind: 'monster',
          monsterDefinitionId: FIXTURE.monsterDefinitionId,
          memberIndex: 0,
        },
        statistics: BRAWLER_STATISTICS,
        satisfiedWeaponRequirementIds: [],
        configuredSkills: [],
        activeEquipmentEffects: [],
        sourceRevisionKey: 'input@monster@1',
      };
      expectRejection(
        () =>
          calculator.calculateTeam(
            {
              teamId: FIXTURE.teamId,
              ruleId: FIXTURE.ruleId,
              members: [member(monster, 0, 0)],
              formationRevision: 1 as Revision,
              sourceRevisionKey: 'team@kind@1',
            },
            rule,
          ),
        CombatPowerRejectionCode.InvalidUnitKind,
        '隊伍收到 Monster',
      );
      const character = characterUnitInput(reader, {
        characterId: FIXTURE.characterIds.brawler,
        statistics: BRAWLER_STATISTICS,
        satisfiedWeaponRequirementIds: [],
        skillIds: [],
        equipmentEffectIds: [],
      });
      expectRejection(
        () =>
          calculator.calculateEncounter(
            {
              encounterGroupId: FIXTURE.encounterGroupId,
              ruleId: FIXTURE.ruleId,
              members: [member(character, 0, 0)],
              encounterDefinitionRevisionKey: 'encounter@kind@1',
            },
            rule,
          ),
        CombatPowerRejectionCode.InvalidUnitKind,
        'Encounter 收到 Character',
      );
    },
  },
  {
    name: 'Encounter：同 Definition 的重複 memberIndex 拒絕；不同 memberIndex 各自成立',
    run: () => {
      const { calculator, rule } = harness();
      const monster = (memberIndex: number): CombatPowerUnitInput => ({
        unitRef: {
          kind: 'monster',
          monsterDefinitionId: FIXTURE.monsterDefinitionId,
          memberIndex,
        },
        statistics: BRAWLER_STATISTICS,
        satisfiedWeaponRequirementIds: [],
        configuredSkills: [],
        activeEquipmentEffects: [],
        sourceRevisionKey: `input@ogre@${memberIndex}`,
      });
      const base = {
        encounterGroupId: FIXTURE.encounterGroupId,
        ruleId: FIXTURE.ruleId,
        encounterDefinitionRevisionKey: 'encounter@ogre@1',
      } as const;
      const ok = calculator.calculateEncounter(
        { ...base, members: [member(monster(0), 0, 0), member(monster(1), 1, 0)] },
        rule,
      );
      assert(ok.memberPowers.length === 2, 'Encounter 應有兩個成員快照');
      expectRejection(
        () =>
          calculator.calculateEncounter(
            { ...base, members: [member(monster(0), 0, 0), member(monster(0), 1, 0)] },
            rule,
          ),
        CombatPowerRejectionCode.InvalidUnitKind,
        '重複 memberIndex',
      );
    },
  },
  {
    name: 'Input 的 ruleId 與傳入的 Rule 不同 → rule-mismatch（跨規則戰力不可比較）',
    run: () => {
      const { reader, calculator, rule } = harness();
      expectRejection(
        () =>
          calculator.calculateTeam(
            {
              teamId: FIXTURE.teamId,
              ruleId: FIXTURE.otherRuleId,
              members: [
                member(
                  characterUnitInput(reader, {
                    characterId: FIXTURE.characterIds.brawler,
                    statistics: BRAWLER_STATISTICS,
                    satisfiedWeaponRequirementIds: [],
                    skillIds: [],
                    equipmentEffectIds: [],
                  }),
                  0,
                  0,
                ),
              ],
              formationRevision: 1 as Revision,
              sourceRevisionKey: 'team@mismatch@1',
            },
            rule,
          ),
        CombatPowerRejectionCode.RuleMismatch,
        'ruleId 不符',
      );
    },
  },

  // ══ Query Facade ═════════════════════════════════════════════════════════
  {
    name: 'getCharacterPower：組出的 Input 與手動組裝一致',
    run: () => {
      const { query } = queryHarness();
      const snapshot = query.getCharacterPower({
        characterId: FIXTURE.characterIds.brawler,
        selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
        configuredSkillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
        combatPowerRuleId: FIXTURE.ruleId,
      });
      assert(
        snapshot.totalPower === BRAWLER_EXPECTED_POWER,
        `totalPower 應為 ${BRAWLER_EXPECTED_POWER}（實得 ${snapshot.totalPower}）`,
      );
      assert(snapshot.unitRef.kind === 'character', 'unitRef 應為 character');
    },
  },
  {
    name: 'getCharacterPower 拒絕：未配置的技能／不可參戰／缺 Statistics／取不到武器組',
    run: () => {
      const world = defaultFixtureWorld();
      const { query } = queryHarness(world);
      expectRejection(
        () =>
          query.getCharacterPower({
            characterId: FIXTURE.characterIds.brawler,
            selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
            configuredSkillIds: [FIXTURE.skillIds.arcane],
            combatPowerRuleId: FIXTURE.ruleId,
          }),
        CombatPowerRejectionCode.SkillNotConfigured,
        '技能不在該武器組的合法配置內',
      );
      expectRejection(
        () =>
          query.getCharacterPower({
            characterId: FIXTURE.characterIds.brawler,
            selectedWeaponSetId: FIXTURE.weaponSetIds.staff,
            configuredSkillIds: [],
            combatPowerRuleId: FIXTURE.ruleId,
          }),
        CombatPowerRejectionCode.WeaponSetUnavailable,
        '取不到武器組配置',
      );

      const notReady = queryHarness({
        ...world,
        configurationByKey: {
          ...world.configurationByKey,
          [configurationKey(FIXTURE.characterIds.brawler, FIXTURE.weaponSetIds.sword)]:
            weaponSetConfiguration({
              characterId: FIXTURE.characterIds.brawler,
              selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
              configuredSkillIds: [],
              satisfiedWeaponRequirementIds: [],
              activeEquipmentEffectIds: [],
              battleReady: false,
            }),
        },
      });
      expectRejection(
        () =>
          notReady.query.getCharacterPower({
            characterId: FIXTURE.characterIds.brawler,
            selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
            configuredSkillIds: [],
            combatPowerRuleId: FIXTURE.ruleId,
          }),
        CombatPowerRejectionCode.CharacterNotBattleReady,
        '角色不可參戰',
      );

      const noStatistics = queryHarness({ ...world, statisticsByCharacterId: {} });
      expectRejection(
        () =>
          noStatistics.query.getCharacterPower({
            characterId: FIXTURE.characterIds.brawler,
            selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
            configuredSkillIds: [],
            combatPowerRuleId: FIXTURE.ruleId,
          }),
        CombatPowerRejectionCode.StatisticsUnavailable,
        '缺 Statistics 快照',
      );
    },
  },
  {
    name: 'getTeamPower：正式成員全員參與，武器組清單必須恰好涵蓋該批成員（§7.8）',
    run: () => {
      const { query } = queryHarness();
      const snapshot = query.getTeamPower({
        teamId: FIXTURE.teamId,
        formationRevision: 7 as Revision,
        selectedWeaponSetIds: {
          [FIXTURE.characterIds.brawler]: FIXTURE.weaponSetIds.sword,
          [FIXTURE.characterIds.scholar]: FIXTURE.weaponSetIds.staff,
        },
        combatPowerRuleId: FIXTURE.ruleId,
      });
      assert(snapshot.memberPowers.length === 2, '應涵蓋兩名正式成員');
      assert(snapshot.totalPower > 0, 'totalPower 應為正');

      // 少一名：只給一個武器組。
      expectRejection(
        () =>
          query.getTeamPower({
            teamId: FIXTURE.teamId,
            formationRevision: 7 as Revision,
            selectedWeaponSetIds: {
              [FIXTURE.characterIds.brawler]: FIXTURE.weaponSetIds.sword,
            },
            combatPowerRuleId: FIXTURE.ruleId,
          }),
        CombatPowerRejectionCode.TeamMemberSetMismatch,
        '少一名成員',
      );
      // 多一名非成員（護衛／救援等任務暫時角色不屬正式成員）。
      expectRejection(
        () =>
          query.getTeamPower({
            teamId: FIXTURE.teamId,
            formationRevision: 7 as Revision,
            selectedWeaponSetIds: {
              [FIXTURE.characterIds.brawler]: FIXTURE.weaponSetIds.sword,
              [FIXTURE.characterIds.scholar]: FIXTURE.weaponSetIds.staff,
              [FIXTURE.characterIds.outsider]: FIXTURE.weaponSetIds.sword,
            },
            combatPowerRuleId: FIXTURE.ruleId,
          }),
        CombatPowerRejectionCode.TeamMemberSetMismatch,
        '混入非成員',
      );
      // 陣形版本過期。
      expectRejection(
        () =>
          query.getTeamPower({
            teamId: FIXTURE.teamId,
            formationRevision: 6 as Revision,
            selectedWeaponSetIds: {
              [FIXTURE.characterIds.brawler]: FIXTURE.weaponSetIds.sword,
              [FIXTURE.characterIds.scholar]: FIXTURE.weaponSetIds.staff,
            },
            combatPowerRuleId: FIXTURE.ruleId,
          }),
        CombatPowerRejectionCode.FormationRevisionMismatch,
        '陣形版本不符',
      );
    },
  },
  {
    name: 'getTeamPower：取不到隊伍組成 → team-composition-unavailable',
    run: () => {
      const { query } = queryHarness({ ...defaultFixtureWorld(), teamComposition: undefined });
      expectRejection(
        () =>
          query.getTeamPower({
            teamId: FIXTURE.teamId,
            formationRevision: 7 as Revision,
            selectedWeaponSetIds: {},
            combatPowerRuleId: FIXTURE.ruleId,
          }),
        CombatPowerRejectionCode.TeamCompositionUnavailable,
        '取不到隊伍組成',
      );
    },
  },
  {
    name: 'getEncounterPower：Monster 走與角色相同形狀的快照；未知編組明確拒絕',
    run: () => {
      const { query } = queryHarness();
      const snapshot = query.getEncounterPower({
        encounterGroupId: FIXTURE.encounterGroupId,
        combatPowerRuleId: FIXTURE.ruleId,
      });
      assert(snapshot.memberPowers.length === 2, 'Encounter 應有兩個成員');
      assert(
        snapshot.memberPowers.every((member_) => member_.featureBreakdown.length === 6),
        'Monster 也走同一組 Feature Rule（§7.7 禁止陣營專用倍率）',
      );
      const empty = queryHarness({ ...defaultFixtureWorld(), encounterComposition: undefined });
      expectRejection(
        () =>
          empty.query.getEncounterPower({
            encounterGroupId: FIXTURE.encounterGroupId,
            combatPowerRuleId: FIXTURE.ruleId,
          }),
        CombatPowerRejectionCode.EncounterCompositionUnavailable,
        '未知 Encounter Group',
      );
    },
  },
  {
    name: 'assessQuestFeasibility：戰力對抗目標 → 門檻與安全邊際全部來自 Feasibility Rule',
    run: () => {
      const { query } = queryHarness();
      const strong = query.getTeamPower({
        teamId: FIXTURE.teamId,
        formationRevision: 7 as Revision,
        selectedWeaponSetIds: {
          [FIXTURE.characterIds.brawler]: FIXTURE.weaponSetIds.sword,
          [FIXTURE.characterIds.scholar]: FIXTURE.weaponSetIds.staff,
        },
        combatPowerRuleId: FIXTURE.ruleId,
      }).totalPower;

      const twoOgres = query.assessQuestFeasibility({
        teamId: FIXTURE.teamId,
        questId: FIXTURE.questId,
        objective: HUNT_OBJECTIVE,
        assessedOnDay: 10,
        combatPowerRuleId: FIXTURE.ruleId,
      });
      assert(twoOgres.powerScore === strong, 'powerScore 應等於同一條 Rule 下的隊伍戰力');
      assert(twoOgres.expectedSuccess !== undefined, '有對抗面時必須有 expectedSuccess');
      assert(twoOgres.riskBand !== undefined, '有對抗面時必須有 riskBand');
      const expected = twoOgres.expectedSuccess;
      if (expected === undefined) throw new Error('expectedSuccess 應存在');
      assert(expected >= 0 && expected <= 1, `expectedSuccess 應在 0..1（實得 ${expected}）`);
      assert(
        twoOgres.canAttempt === (expected >= 0.4),
        'canAttempt 應由 minimumAttemptExpectedSuccess（0.4）決定',
      );
      if (!twoOgres.canAttempt) {
        assert(twoOgres.reason === 'insufficientPower', `未達安全邊際時 reason 應為 insufficientPower（實得 ${String(twoOgres.reason)}）`);
      }

      // 對抗變弱（只剩一隻）→ 期望成功率必須單調上升。
      const encounterComposition = defaultEncounterComposition();
      const first = encounterComposition.members[0];
      if (first === undefined) throw new Error('fixture encounter 應有成員');
      const weaker = queryHarness({
        ...defaultFixtureWorld(),
        encounterComposition: { ...encounterComposition, members: [first] },
      });
      const oneOgre = weaker.query.assessQuestFeasibility({
        teamId: FIXTURE.teamId,
        questId: FIXTURE.questId,
        objective: HUNT_OBJECTIVE,
        assessedOnDay: 10,
        combatPowerRuleId: FIXTURE.ruleId,
      });
      const weakerExpected = oneOgre.expectedSuccess;
      if (weakerExpected === undefined) throw new Error('expectedSuccess 應存在');
      assert(weakerExpected > expected, `對抗變弱時期望成功率應上升（${weakerExpected} vs ${expected}）`);
      assert(oneOgre.canAttempt, '對抗變弱後應可嘗試');
      assert(oneOgre.reason === undefined, '可嘗試時不應帶 reason');
      assert(oneOgre.riskBand !== undefined, 'riskBand 應由門檻表決定');
    },
  },
  {
    name: 'assessQuestFeasibility：沒有戰力對抗面的目標 → unsupportedObjective，且不憑空給機率',
    run: () => {
      const { query } = queryHarness();
      const result = query.assessQuestFeasibility({
        teamId: FIXTURE.teamId,
        questId: FIXTURE.questId,
        objective: PURCHASE_OBJECTIVE,
        assessedOnDay: 10,
        combatPowerRuleId: FIXTURE.ruleId,
      });
      assert(result.reason === 'unsupportedObjective', `reason 應為 unsupportedObjective（實得 ${String(result.reason)}）`);
      assert(result.canAttempt === false, '未評估的目標不得回 canAttempt=true');
      assert(result.expectedSuccess === undefined, '未評估時不得給 expectedSuccess');
      assert(result.riskBand === undefined, '未評估時不得給 riskBand');
      assert(result.powerScore > 0, 'powerScore 仍是真實的隊伍戰力');
    },
  },
  {
    name: 'assessQuestFeasibility：有成員但無人可參戰 → noUsableMembers，powerScore 為 0',
    run: () => {
      const world = defaultFixtureWorld();
      const { query } = queryHarness({
        ...world,
        configurationByKey: {
          ...world.configurationByKey,
          [configurationKey(FIXTURE.characterIds.brawler, FIXTURE.weaponSetIds.sword)]:
            weaponSetConfiguration({
              characterId: FIXTURE.characterIds.brawler,
              selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
              configuredSkillIds: [],
              satisfiedWeaponRequirementIds: [],
              activeEquipmentEffectIds: [],
              battleReady: false,
            }),
        },
      });
      const result = query.assessQuestFeasibility({
        teamId: FIXTURE.teamId,
        questId: FIXTURE.questId,
        objective: HUNT_OBJECTIVE,
        assessedOnDay: 10,
        combatPowerRuleId: FIXTURE.ruleId,
      });
      assert(result.reason === 'noUsableMembers', `reason 應為 noUsableMembers（實得 ${String(result.reason)}）`);
      assert(result.canAttempt === false, '無人可參戰不得回 canAttempt=true');
      assert(result.powerScore === 0, `powerScore 應為 0（實得 ${result.powerScore}）`);
      assert(result.expectedSuccess !== undefined, '有對抗面時 expectedSuccess 仍由 Resolver 算出');
    },
  },
  {
    name: 'assessQuestFeasibility：Feasibility Rule 綁到別條 Combat Power Rule → rule-mismatch',
    run: () => {
      const registry = createFixtureRegistry('muscleHeavy');
      // 直接改掉 reader 回傳的 feasibility rule 綁定（模擬內容綁錯規則）。
      const reader = createCombatPowerDefinitionReader(registry);
      const resolvers = createFixtureResolverPort();
      const calculator = createCombatPowerCalculator({ definitions: reader, resolvers });
      const ports = createFixturePorts(defaultFixtureWorld());
      const query = createCombatPowerQuery({
        definitions: {
          ...reader,
          getFeasibilityRule: (id) => ({
            ...reader.getFeasibilityRule(id),
            combatPowerRuleId: FIXTURE.otherRuleId,
          }),
        },
        calculator,
        resolvers,
        statistics: ports.statistics,
        loadout: ports.loadout,
        team: ports.team,
        encounter: ports.encounter,
        questOpposition: ports.questOpposition,
      });
      expectRejection(
        () =>
          query.assessQuestFeasibility({
            teamId: FIXTURE.teamId,
            questId: FIXTURE.questId,
            objective: HUNT_OBJECTIVE,
            assessedOnDay: 10,
            combatPowerRuleId: FIXTURE.ruleId,
          }),
        CombatPowerRejectionCode.RuleMismatch,
        'Feasibility Rule 綁錯',
      );
    },
  },
  {
    name: 'compareLoadouts：同一 Calculator 重算候選，戰力高者勝',
    run: () => {
      const { query } = queryHarness();
      const candidates: EquipmentLoadoutPowerCandidate[] = [
        {
          candidateId: FIXTURE.candidateIds.current,
          equipmentLoadout: EMPTY_LOADOUT,
          selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
          configuredSkillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
        },
        {
          candidateId: FIXTURE.candidateIds.alternate,
          equipmentLoadout: EMPTY_LOADOUT,
          selectedWeaponSetId: FIXTURE.weaponSetIds.staff,
          configuredSkillIds: [FIXTURE.skillIds.arcane],
        },
      ];
      const result = query.compareLoadouts({
        characterId: FIXTURE.characterIds.brawler,
        candidates,
        combatPowerRuleId: FIXTURE.ruleId,
      });
      assert(result.candidates.length === 2, '應回兩個候選結果');
      const best = result.candidates.reduce((a, b) => (a.power >= b.power ? a : b));
      assert(
        String(result.highestPowerCandidateId) === String(best.candidateId),
        '應選出戰力最高的候選',
      );
      assert(
        result.candidates.every((candidate) => candidate.sourceRevisionKey.length > 0),
        '每個候選都要帶 sourceRevisionKey',
      );
    },
  },
  {
    name: 'compareLoadouts：同分以 Candidate ID 穩定排序；空清單不給第一名；重複 ID 拒絕',
    run: () => {
      const world = defaultFixtureWorld();
      const swordKey = configurationKey(FIXTURE.characterIds.brawler, FIXTURE.weaponSetIds.sword);
      const { query } = queryHarness(world);

      // 兩個候選使用完全相同的配置與統計 → 同分。
      const tie = query.compareLoadouts({
        characterId: FIXTURE.characterIds.brawler,
        candidates: [
          {
            candidateId: FIXTURE.candidateIds.current,
            equipmentLoadout: EMPTY_LOADOUT,
            selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
            configuredSkillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
          },
          {
            candidateId: FIXTURE.candidateIds.tieBreaker,
            equipmentLoadout: EMPTY_LOADOUT,
            selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
            configuredSkillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
          },
        ],
        combatPowerRuleId: FIXTURE.ruleId,
      });
      assert(world.candidateConfigurationByKey[swordKey] !== undefined, 'fixture 應提供 sword 候選配置');
      const [first, second] = tie.candidates;
      if (first === undefined || second === undefined) throw new Error('應有兩個候選');
      assert(first.power === second.power, '兩個候選應同分');
      assert(
        String(tie.highestPowerCandidateId) === String(FIXTURE.candidateIds.tieBreaker),
        '同分時應取 Candidate ID 較小者（升冪第一）',
      );

      const empty = query.compareLoadouts({
        characterId: FIXTURE.characterIds.brawler,
        candidates: [],
        combatPowerRuleId: FIXTURE.ruleId,
      });
      assert(empty.candidates.length === 0, '空清單應回空結果');
      assert(empty.highestPowerCandidateId === undefined, '沒有候選就沒有第一名（不編一個出來）');

      expectRejection(
        () =>
          query.compareLoadouts({
            characterId: FIXTURE.characterIds.brawler,
            candidates: [
              {
                candidateId: FIXTURE.candidateIds.current,
                equipmentLoadout: EMPTY_LOADOUT,
                selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
                configuredSkillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
              },
              {
                candidateId: FIXTURE.candidateIds.current,
                equipmentLoadout: EMPTY_LOADOUT,
                selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
                configuredSkillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
              },
            ],
            combatPowerRuleId: FIXTURE.ruleId,
          }),
        CombatPowerRejectionCode.DuplicateLoadoutCandidate,
        '重複 candidateId',
      );
    },
  },
  {
    name: 'NPC 換裝、任務評估與 Encounter 評估在同一條 Rule 下取得一致戰力（§8.6）',
    run: () => {
      const { query } = queryHarness();
      const direct = query.getCharacterPower({
        characterId: FIXTURE.characterIds.brawler,
        selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
        configuredSkillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
        combatPowerRuleId: FIXTURE.ruleId,
      }).totalPower;
      const compared = query.compareLoadouts({
        characterId: FIXTURE.characterIds.brawler,
        candidates: [
          {
            candidateId: FIXTURE.candidateIds.current,
            equipmentLoadout: EMPTY_LOADOUT,
            selectedWeaponSetId: FIXTURE.weaponSetIds.sword,
            configuredSkillIds: [FIXTURE.skillIds.slash, FIXTURE.skillIds.heal],
          },
        ],
        combatPowerRuleId: FIXTURE.ruleId,
      }).candidates[0];
      if (compared === undefined) throw new Error('應有一個候選結果');
      assert(compared.power === direct, `換裝比較與直接查詢應一致（${compared.power} vs ${direct}）`);

      const teamTotal = query.getTeamPower({
        teamId: FIXTURE.teamId,
        formationRevision: defaultTeamComposition().formationRevision,
        selectedWeaponSetIds: {
          [FIXTURE.characterIds.brawler]: FIXTURE.weaponSetIds.sword,
          [FIXTURE.characterIds.scholar]: FIXTURE.weaponSetIds.staff,
        },
        combatPowerRuleId: FIXTURE.ruleId,
      });
      const brawlerInTeam = teamTotal.memberPowers.find(
        (snapshot) =>
          snapshot.unitRef.kind === 'character' &&
          String(snapshot.unitRef.characterId) === String(FIXTURE.characterIds.brawler),
      );
      if (brawlerInTeam === undefined) throw new Error('隊伍快照應含 brawler');
      assert(brawlerInTeam.totalPower === direct, '隊伍內成員戰力應與單獨查詢一致');
    },
  },
];

export type CombatPowerTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

export function runTestResults(): readonly CombatPowerTestResult[] {
  return CASES.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, pass: true };
    } catch (error) {
      return {
        name: testCase.name,
        pass: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((result) => !result.pass);
  if (failed.length > 0) {
    const lines = failed.map((result) => `  - ${result.name}: ${result.error ?? ''}`).join('\n');
    throw new Error(`combat-power tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
