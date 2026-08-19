// domain-services/statistics/fixtures.ts
// 測試 Fixture：一組記憶體內 Statistics Definition、一個決定性的 StatisticsResolverPort stub，
// 以及可覆寫的 CharacterStatisticsInput 建構器。純資料／純函式，無外部依賴。
//
// 這裡的每一個數字都是**測試基準**，取自 docs/03_content/yunhua/yunhua_content.data.mjs 的
// balanceModel（生命 200 + 肌 × 20、魔力 120 + 智 × 14、熟練度倍率表、減傷 safeRaw/(safeRaw+120)）
// 與 GDD §250 的持握係數 1.0 / 1.0 / 0.5 / 0.35。正式路徑不得引用本檔——它們的正式歸屬是
// Definition JSON 與 Resolver params。

import type {
  AgeModifierRuleId,
  CarryCapacityRuleId,
  CharacterId,
  ContentPackId,
  CultureId,
  CurrencyId,
  GripRuleId,
  ItemDefinitionId,
  ItemInstanceId,
  MasteryId,
  ResolverId,
  SecondaryAttributeId,
  StatisticsRuleId,
  WeaponSetId,
} from '../../contracts/core';
import type {
  EquipmentCoefficientChannelId,
  EquipmentDefinition,
  EquipmentSlotId,
  ItemDefinition,
} from '../../contracts/inventory';
import type { MasteryProgressView, PrimaryAttributes } from '../../contracts/progression';
import type {
  AgeModifierRuleDefinition,
  CarryCapacityRuleDefinition,
  CharacterEquipmentLoadoutView,
  CharacterStatisticsInput,
  EquippedEquipmentView,
  GripRuleDefinition,
  SecondaryAttributeRuleDefinition,
  StatisticsDefinitionReader,
  StatisticsRuleDefinition,
} from '../../contracts/statistics';
import type { StatisticsResolverPort } from './statistics';

const PACK = 'pack:test' as ContentPackId;
const CULTURE = 'culture:yunhua' as CultureId;
const COPPER = 'currency:copper' as CurrencyId;

// ── 固定 ID ────────────────────────────────────────────────────────────────

export const FIXTURE = {
  characterId: 'runtime:character:hero' as CharacterId,
  otherCharacterId: 'runtime:character:ally' as CharacterId,

  statisticsRuleId: 'definition:statistics-rule:yunhua-v1' as StatisticsRuleId,
  gripRuleId: 'definition:grip-rule:yunhua-v1' as GripRuleId,
  carryCapacityRuleId: 'definition:carry-capacity-rule:yunhua-v1' as CarryCapacityRuleId,
  ageModifierRuleId: 'definition:age-modifier-rule:yunhua-v1' as AgeModifierRuleId,

  // 副屬（以 SecondaryAttributeId 定址）
  physicalDamage: 'definition:secondary-attribute:physical-damage' as SecondaryAttributeId,
  magicDamage: 'definition:secondary-attribute:magic-damage' as SecondaryAttributeId,
  generalReduction: 'definition:secondary-attribute:general-damage-reduction' as SecondaryAttributeId,
  maxHealth: 'definition:secondary-attribute:max-health' as SecondaryAttributeId,
  maxMana: 'definition:secondary-attribute:max-mana' as SecondaryAttributeId,
  absentSecondary: 'definition:secondary-attribute:instrument-damage' as SecondaryAttributeId,

  // 裝備係數通道
  physicalDamageChannel: 'definition:equipment-coefficient-channel:physical-damage' as EquipmentCoefficientChannelId,
  magicDamageChannel: 'definition:equipment-coefficient-channel:magic-damage' as EquipmentCoefficientChannelId,
  generalReductionChannel: 'definition:equipment-coefficient-channel:general-reduction' as EquipmentCoefficientChannelId,

  // Resolver
  ageResolverId: 'resolver:statistics.age-modifier' as ResolverId,
  reputationResolverId: 'resolver:statistics.reputation-contribution' as ResolverId,
  masteryResolverId: 'resolver:statistics.mastery-coefficient' as ResolverId,
  identityFinalResolverId: 'resolver:statistics.final.identity' as ResolverId,
  maxHealthFinalResolverId: 'resolver:statistics.final.max-health' as ResolverId,
  maxManaFinalResolverId: 'resolver:statistics.final.max-mana' as ResolverId,
  diminishingFinalResolverId: 'resolver:statistics.final.diminishing' as ResolverId,

  // Mastery
  oneHandMasteryId: 'definition:mastery:one-hand-weapon' as MasteryId,
  staffMasteryId: 'definition:mastery:one-hand-staff' as MasteryId,
  lightArmorMasteryId: 'definition:mastery:light-armor' as MasteryId,

  // 裝備定義
  ringSaberDefId: 'definition:item:ring-saber' as ItemDefinitionId,
  ironFanDefId: 'definition:item:iron-fan' as ItemDefinitionId,
  greatswordDefId: 'definition:item:greatsword' as ItemDefinitionId,
  shieldDefId: 'definition:item:shield' as ItemDefinitionId,
  staffDefId: 'definition:item:staff' as ItemDefinitionId,
  robeDefId: 'definition:item:robe' as ItemDefinitionId,
  cursedRobeDefId: 'definition:item:cursed-robe' as ItemDefinitionId,

  // 裝備實例
  ringSaberItemId: 'runtime:item-instance:ring-saber-1' as ItemInstanceId,
  ironFanItemId: 'runtime:item-instance:iron-fan-1' as ItemInstanceId,
  greatswordItemId: 'runtime:item-instance:greatsword-1' as ItemInstanceId,
  shieldItemId: 'runtime:item-instance:shield-1' as ItemInstanceId,
  staffItemId: 'runtime:item-instance:staff-1' as ItemInstanceId,
  robeItemId: 'runtime:item-instance:robe-1' as ItemInstanceId,
  cursedRobeItemId: 'runtime:item-instance:cursed-robe-1' as ItemInstanceId,
  absentItemId: 'runtime:item-instance:absent' as ItemInstanceId,

  // Slots
  mainHandSlot: 'definition:equipment-slot:mainHand' as EquipmentSlotId,
  offHandSlot: 'definition:equipment-slot:offHand' as EquipmentSlotId,
  bodySlot: 'definition:equipment-slot:body' as EquipmentSlotId,
  headSlot: 'definition:equipment-slot:head' as EquipmentSlotId,

  weaponSet0: 'runtime:weapon-set:0' as WeaponSetId,
  weaponSet1: 'runtime:weapon-set:1' as WeaponSetId,
  weaponSet2: 'runtime:weapon-set:2' as WeaponSetId,
  absentWeaponSet: 'runtime:weapon-set:absent' as WeaponSetId,

  manifestHash: 'manifest-hash-fixture',
} as const;

// ── 平衡基準（測試基準值；正式歸屬為 Definition／Resolver params）─────────────

export const BALANCE = {
  // GDD §250 持握係數
  singleHandMultiplier: 1.0,
  twoHandMultiplier: 1.0,
  dualWieldMainHandMultiplier: 0.5,
  dualWieldOffHandMultiplier: 0.35,
  // balanceModel.formulas：生命上限 200 + 肌 × 20；魔力上限 120 + 智 × 14
  maxHealthBias: 200,
  maxHealthPerMuscle: 20,
  maxManaBias: 120,
  maxManaPerIntelligence: 14,
  // balanceModel.formulas：一般減傷 safeRaw / (safeRaw + 120)
  reductionHalfPoint: 120,
  // balanceModel.masteryMultipliers（Lv.0～10）
  masteryMultipliers: [1.0, 1.03, 1.07, 1.12, 1.18, 1.25, 1.33, 1.42, 1.52, 1.63, 1.75],
  // 負重：基礎 30 + 肌 × 1.5
  baseWeightCapacity: 30,
  strengthCapacityPerPoint: 1.5,
  // 年齡修正：ageDays 超過門檻後每滿一個週期，反應與肌力各降一點
  ageDeclineStartDays: 365 * 40,
  ageDeclinePeriodDays: 365 * 5,
  ageDeclinePerPeriod: 1,
} as const;

// ── Definition ────────────────────────────────────────────────────────────

const header = { schemaVersion: 1, packId: PACK, enabled: true } as const;

export const statisticsRule: StatisticsRuleDefinition = {
  ...header,
  id: FIXTURE.statisticsRuleId,
  primaryAttributeCap: 100,
  secondaryRuleIds: [
    FIXTURE.physicalDamage,
    FIXTURE.magicDamage,
    FIXTURE.generalReduction,
    FIXTURE.maxHealth,
    FIXTURE.maxMana,
  ],
  maxHealthSecondaryId: FIXTURE.maxHealth,
  maxManaSecondaryId: FIXTURE.maxMana,
  gripRuleId: FIXTURE.gripRuleId,
  carryCapacityRuleId: FIXTURE.carryCapacityRuleId,
  ageModifierRuleId: FIXTURE.ageModifierRuleId,
  reputationContributionRuleId: FIXTURE.reputationResolverId,
};

export const gripRule: GripRuleDefinition = {
  ...header,
  id: FIXTURE.gripRuleId,
  singleHandMultiplier: BALANCE.singleHandMultiplier,
  twoHandMultiplier: BALANCE.twoHandMultiplier,
  dualWieldMainHandMultiplier: BALANCE.dualWieldMainHandMultiplier,
  dualWieldOffHandMultiplier: BALANCE.dualWieldOffHandMultiplier,
};

export const carryCapacityRule: CarryCapacityRuleDefinition = {
  ...header,
  id: FIXTURE.carryCapacityRuleId,
  baseWeightCapacity: BALANCE.baseWeightCapacity,
  strengthCapacityPerPoint: BALANCE.strengthCapacityPerPoint,
};

export const ageModifierRule: AgeModifierRuleDefinition = {
  ...header,
  id: FIXTURE.ageModifierRuleId,
  resolverId: FIXTURE.ageResolverId,
};

// 物理傷害：肌＋協（GDD 副屬性對應主屬性表），走裝備的 physical-damage 通道，有熟練度階段。
export const physicalDamageRule: SecondaryAttributeRuleDefinition = {
  ...header,
  id: FIXTURE.physicalDamage,
  output: FIXTURE.physicalDamage,
  primaryCoefficients: { muscle: 1, coordination: 1 },
  equipmentCoefficientChannelIds: [FIXTURE.physicalDamageChannel],
  masteryCoefficientResolverId: FIXTURE.masteryResolverId,
  finalResolverId: FIXTURE.identityFinalResolverId,
};

// 魔法傷害：只引用智。刻意**不給** masteryCoefficientResolverId，用來釘「選填欄位不存在時
// 少一個乘項」而不是「補一個預設係數」。
export const magicDamageRule: SecondaryAttributeRuleDefinition = {
  ...header,
  id: FIXTURE.magicDamage,
  output: FIXTURE.magicDamage,
  primaryCoefficients: { intelligence: 1 },
  equipmentCoefficientChannelIds: [FIXTURE.magicDamageChannel],
  finalResolverId: FIXTURE.identityFinalResolverId,
};

// 一般減傷：肌＋防具，最終走遞減公式。
export const generalReductionRule: SecondaryAttributeRuleDefinition = {
  ...header,
  id: FIXTURE.generalReduction,
  output: FIXTURE.generalReduction,
  primaryCoefficients: { muscle: 1 },
  equipmentCoefficientChannelIds: [FIXTURE.generalReductionChannel],
  finalResolverId: FIXTURE.diminishingFinalResolverId,
};

// 生命／魔力上限：沒有裝備通道，整條公式住在 finalResolver 的 params 裡。
export const maxHealthRule: SecondaryAttributeRuleDefinition = {
  ...header,
  id: FIXTURE.maxHealth,
  output: FIXTURE.maxHealth,
  primaryCoefficients: {},
  equipmentCoefficientChannelIds: [],
  finalResolverId: FIXTURE.maxHealthFinalResolverId,
};

export const maxManaRule: SecondaryAttributeRuleDefinition = {
  ...header,
  id: FIXTURE.maxMana,
  output: FIXTURE.maxMana,
  primaryCoefficients: {},
  equipmentCoefficientChannelIds: [],
  finalResolverId: FIXTURE.maxManaFinalResolverId,
};

export const secondaryRules: readonly SecondaryAttributeRuleDefinition[] = [
  physicalDamageRule,
  magicDamageRule,
  generalReductionRule,
  maxHealthRule,
  maxManaRule,
];

// ── 裝備 Definition ────────────────────────────────────────────────────────

const zeroCoefficients = {
  muscle: 0,
  intelligence: 0,
  reaction: 0,
  coordination: 0,
  charisma: 0,
} as const;

function baseItem(id: ItemDefinitionId, unitWeight: number): ItemDefinition {
  return {
    id,
    ...header,
    originCultureId: CULTURE,
    itemTagIds: [],
    kind: 'equipment',
    stackPolicy: 'single',
    unitWeight,
    tradePolicy: { tradable: true },
    display: { nameRef: { key: `item.${String(id)}` } },
    intrinsicValue: { currencyId: COPPER, amount: 10 },
    unresolvedMapDisposition: 'toCityPermanentStock',
  };
}

// 環首刀（單手物理）：yunhua_content.data.mjs 的 physical(1.25, 0.95)。
export const ringSaberDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.ringSaberDefId, 6),
  kind: 'equipment',
  equipmentKind: 'weapon',
  rarity: 'common',
  relatedMasteryIds: [FIXTURE.oneHandMasteryId],
  occupiedSlots: [FIXTURE.mainHandSlot],
  handSlots: { mainHand: FIXTURE.mainHandSlot, offHand: FIXTURE.offHandSlot },
  primaryAttributeCoefficients: { ...zeroCoefficients, muscle: 1.25, coordination: 0.95 },
  secondaryAttributeCoefficients: [{ channelId: FIXTURE.physicalDamageChannel, coefficient: 1 }],
  skillEffectRefs: [],
};

// 鐵骨扇（第二把單手物理武器，供雙持測試）：physical(0.85, 0.72)。
export const ironFanDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.ironFanDefId, 3),
  kind: 'equipment',
  equipmentKind: 'weapon',
  rarity: 'common',
  relatedMasteryIds: [FIXTURE.oneHandMasteryId],
  occupiedSlots: [FIXTURE.mainHandSlot],
  handSlots: { mainHand: FIXTURE.mainHandSlot, offHand: FIXTURE.offHandSlot },
  primaryAttributeCoefficients: { ...zeroCoefficients, muscle: 0.85, coordination: 0.72 },
  secondaryAttributeCoefficients: [{ channelId: FIXTURE.physicalDamageChannel, coefficient: 1 }],
  skillEffectRefs: [],
};

// 雙手劍：占滿兩手。
export const greatswordDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.greatswordDefId, 14),
  kind: 'equipment',
  equipmentKind: 'weapon',
  rarity: 'fine',
  relatedMasteryIds: [FIXTURE.oneHandMasteryId],
  occupiedSlots: [FIXTURE.mainHandSlot, FIXTURE.offHandSlot],
  handSlots: { mainHand: FIXTURE.mainHandSlot, offHand: FIXTURE.offHandSlot },
  primaryAttributeCoefficients: { ...zeroCoefficients, muscle: 2.5, coordination: 1.9 },
  secondaryAttributeCoefficients: [{ channelId: FIXTURE.physicalDamageChannel, coefficient: 1 }],
  skillEffectRefs: [],
};

// 盾：副手、非 weapon。與單手武器同組時不構成雙持。
export const shieldDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.shieldDefId, 9),
  kind: 'equipment',
  equipmentKind: 'shield',
  rarity: 'common',
  relatedMasteryIds: [FIXTURE.lightArmorMasteryId],
  occupiedSlots: [FIXTURE.offHandSlot],
  handSlots: { offHand: FIXTURE.offHandSlot },
  primaryAttributeCoefficients: { ...zeroCoefficients, muscle: 0.4 },
  secondaryAttributeCoefficients: [{ channelId: FIXTURE.generalReductionChannel, coefficient: 1 }],
  skillEffectRefs: [],
};

// 單手法杖：只供魔法傷害通道；用來釘「劍不貢獻魔傷、杖不貢獻物傷」。
export const staffDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.staffDefId, 5),
  kind: 'equipment',
  equipmentKind: 'weapon',
  rarity: 'common',
  relatedMasteryIds: [FIXTURE.staffMasteryId],
  occupiedSlots: [FIXTURE.mainHandSlot],
  handSlots: { mainHand: FIXTURE.mainHandSlot, offHand: FIXTURE.offHandSlot },
  primaryAttributeCoefficients: { ...zeroCoefficients, intelligence: 1.4 },
  secondaryAttributeCoefficients: [{ channelId: FIXTURE.magicDamageChannel, coefficient: 1 }],
  skillEffectRefs: [],
};

// 多格甲：body + head 同一件。不占手，因此不套持握倍率。
export const robeDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.robeDefId, 25),
  kind: 'equipment',
  equipmentKind: 'armor',
  rarity: 'common',
  relatedMasteryIds: [FIXTURE.lightArmorMasteryId],
  occupiedSlots: [FIXTURE.bodySlot, FIXTURE.headSlot],
  handSlots: {},
  primaryAttributeCoefficients: { ...zeroCoefficients, muscle: 0.6 },
  secondaryAttributeCoefficients: [{ channelId: FIXTURE.generalReductionChannel, coefficient: 2 }],
  skillEffectRefs: [],
};

// 負係數防具：用來釘 doc §4 的 safeRaw = max(0, raw)。負 raw 不得穿過遞減公式（那會產生
// 負減傷與 −120 奇異點），也不得隱式變成易傷。
export const cursedRobeDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.cursedRobeDefId, 25),
  kind: 'equipment',
  equipmentKind: 'armor',
  rarity: 'common',
  relatedMasteryIds: [FIXTURE.lightArmorMasteryId],
  occupiedSlots: [FIXTURE.bodySlot],
  handSlots: {},
  primaryAttributeCoefficients: { ...zeroCoefficients, muscle: 0.6 },
  secondaryAttributeCoefficients: [{ channelId: FIXTURE.generalReductionChannel, coefficient: -1 }],
  skillEffectRefs: [],
};

export const equipmentViews: readonly EquippedEquipmentView[] = [
  { itemInstanceId: FIXTURE.cursedRobeItemId, definition: cursedRobeDef },
  { itemInstanceId: FIXTURE.ringSaberItemId, definition: ringSaberDef },
  { itemInstanceId: FIXTURE.ironFanItemId, definition: ironFanDef },
  { itemInstanceId: FIXTURE.greatswordItemId, definition: greatswordDef },
  { itemInstanceId: FIXTURE.shieldItemId, definition: shieldDef },
  { itemInstanceId: FIXTURE.staffItemId, definition: staffDef },
  { itemInstanceId: FIXTURE.robeItemId, definition: robeDef },
];

// ── Definition Reader stub ────────────────────────────────────────────────

export function stubDefinitionReader(
  overrides?: Partial<Pick<StatisticsRuleDefinition, 'secondaryRuleIds' | 'maxHealthSecondaryId' | 'maxManaSecondaryId'>>,
): StatisticsDefinitionReader {
  const rule: StatisticsRuleDefinition = { ...statisticsRule, ...overrides };
  const secondaryById = new Map(secondaryRules.map((r) => [String(r.id), r]));
  return {
    getStatisticsRule: (id) => {
      if (String(id) !== String(rule.id)) throw new Error(`unknown statistics rule ${String(id)}`);
      return rule;
    },
    getSecondaryAttributeRule: (id) => {
      const found = secondaryById.get(String(id));
      if (found === undefined) throw new Error(`unknown secondary rule ${String(id)}`);
      return found;
    },
    getGripRule: (id) => {
      if (String(id) !== String(gripRule.id)) throw new Error(`unknown grip rule ${String(id)}`);
      return gripRule;
    },
    getCarryCapacityRule: (id) => {
      if (String(id) !== String(carryCapacityRule.id)) {
        throw new Error(`unknown carry capacity rule ${String(id)}`);
      }
      return carryCapacityRule;
    },
    getAgeModifierRule: (id) => {
      if (String(id) !== String(ageModifierRule.id)) {
        throw new Error(`unknown age modifier rule ${String(id)}`);
      }
      return ageModifierRule;
    },
    getDefinitionManifestHash: () => FIXTURE.manifestHash,
  };
}

// ── Resolver Port stub（決定性；params 即上方 BALANCE）─────────────────────

export type ResolverStubOptions = Readonly<{
  // 讓測試能注入一個違反不變量 5 的聲望 Resolver（回傳 charisma delta）。
  reputationCharismaDelta?: number;
}>;

export function stubResolverPort(options?: ResolverStubOptions): StatisticsResolverPort {
  return {
    resolveAgeModifier: (resolverId, input) => {
      if (String(resolverId) !== String(FIXTURE.ageResolverId)) {
        throw new Error(`unregistered resolver ${String(resolverId)}`);
      }
      const excess = input.ageDays - BALANCE.ageDeclineStartDays;
      if (excess <= 0) return {};
      const periods = Math.floor(excess / BALANCE.ageDeclinePeriodDays) + 1;
      const decline = -periods * BALANCE.ageDeclinePerPeriod;
      return { muscle: decline, reaction: decline };
    },
    resolveReputationContribution: (resolverId, _input) => {
      if (String(resolverId) !== String(FIXTURE.reputationResolverId)) {
        throw new Error(`unregistered resolver ${String(resolverId)}`);
      }
      const charisma = options?.reputationCharismaDelta;
      return charisma === undefined ? {} : { charisma };
    },
    resolveMasteryCoefficient: (resolverId, input) => {
      if (String(resolverId) !== String(FIXTURE.masteryResolverId)) {
        throw new Error(`unregistered resolver ${String(resolverId)}`);
      }
      const levels = input.masteryLevels.map((m) => m.level);
      const level = levels.length === 0 ? 0 : Math.max(...levels);
      const multiplier = BALANCE.masteryMultipliers[level];
      if (multiplier === undefined) throw new Error(`mastery level out of range: ${level}`);
      return multiplier;
    },
    resolveFinalSecondaryValue: (resolverId, input) => {
      const id = String(resolverId);
      if (id === String(FIXTURE.identityFinalResolverId)) return input.safeRaw;
      if (id === String(FIXTURE.maxHealthFinalResolverId)) {
        return (
          BALANCE.maxHealthBias +
          BALANCE.maxHealthPerMuscle * input.effectivePrimaryAttributes.muscle +
          input.safeRaw
        );
      }
      if (id === String(FIXTURE.maxManaFinalResolverId)) {
        return (
          BALANCE.maxManaBias +
          BALANCE.maxManaPerIntelligence * input.effectivePrimaryAttributes.intelligence +
          input.safeRaw
        );
      }
      if (id === String(FIXTURE.diminishingFinalResolverId)) {
        return input.safeRaw / (input.safeRaw + BALANCE.reductionHalfPoint);
      }
      throw new Error(`unregistered resolver ${id}`);
    },
  };
}

// ── 輸入建構器 ─────────────────────────────────────────────────────────────

export function primaries(overrides?: Partial<PrimaryAttributes>): PrimaryAttributes {
  return {
    muscle: 40,
    intelligence: 30,
    reaction: 25,
    coordination: 35,
    charisma: 20,
    ...overrides,
  };
}

export function masteryProgress(masteryId: MasteryId, level: number, revision = 1): MasteryProgressView {
  return { masteryId, experience: level * 100, level, revision };
}

export const defaultMasterySnapshots: readonly MasteryProgressView[] = [
  masteryProgress(FIXTURE.oneHandMasteryId, 5),
  masteryProgress(FIXTURE.staffMasteryId, 3),
  masteryProgress(FIXTURE.lightArmorMasteryId, 2),
];

export type WeaponSetSpec = Readonly<{
  mainHandItemId?: ItemInstanceId;
  offHandItemId?: ItemInstanceId;
}>;

export function loadout(
  spec?: Readonly<{
    set0?: WeaponSetSpec;
    armorSlots?: Readonly<Record<EquipmentSlotId, ItemInstanceId | undefined>>;
    revision?: number;
  }>,
): CharacterEquipmentLoadoutView {
  const set0 = spec?.set0 === undefined ? { mainHandItemId: FIXTURE.ringSaberItemId } : spec.set0;
  const armorSlots =
    spec?.armorSlots === undefined
      ? { [FIXTURE.bodySlot]: FIXTURE.robeItemId, [FIXTURE.headSlot]: FIXTURE.robeItemId }
      : spec.armorSlots;
  const revision = spec?.revision === undefined ? 1 : spec.revision;
  return {
    characterId: FIXTURE.characterId,
    armorSlots,
    weaponSets: [
      { weaponSetId: FIXTURE.weaponSet0, ...set0, selectedSkillIds: [undefined, undefined, undefined] },
      { weaponSetId: FIXTURE.weaponSet1, mainHandItemId: FIXTURE.staffItemId, selectedSkillIds: [undefined, undefined, undefined] },
      { weaponSetId: FIXTURE.weaponSet2, selectedSkillIds: [undefined, undefined, undefined] },
    ],
    revision,
  };
}

export function makeInput(
  overrides?: Partial<CharacterStatisticsInput>,
): CharacterStatisticsInput {
  return {
    characterId: FIXTURE.characterId,
    characterRevision: 1,
    ageDays: 365 * 20,
    reputation: 0,
    primaryAttributesFromMastery: primaries(),
    masterySnapshots: [...defaultMasterySnapshots],
    conditionModifierRefs: [],
    equipmentLoadout: loadout(),
    equipmentDefinitionViews: [...equipmentViews],
    selectedWeaponSetId: FIXTURE.weaponSet0,
    statisticsRuleId: FIXTURE.statisticsRuleId,
    ...overrides,
  };
}
