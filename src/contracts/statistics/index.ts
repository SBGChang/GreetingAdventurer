// contracts/statistics — public contract transcribed from docs/00_core/architecture/16_derived_statistics.md
// 技術元件：domain-services/statistics。無 State 的純計算 Domain Service。

import type {
  StatisticsRuleId,
  SecondaryAttributeId,
  GripRuleId,
  CarryCapacityRuleId,
  AgeModifierRuleId,
  ResolverId,
  CharacterId,
  ItemInstanceId,
  WeaponSetId,
  EffectDefinitionId,
  Revision,
  DefinitionHeader,
} from '../core';
import type { PrimaryAttributes, PrimaryAttributeId, MasteryProgressView } from '../progression';

// ── 跨模組型別：由 inventory 擁有（05_inventory_module.md）──────────────────
// 早期版本在此以 `Readonly<Record<string, unknown>>` 承載這三個型別，因為 inventory 契約還不存在。
// 它現在存在了，所以一律改為引用擁有者的真實型別：Calculator 需要讀 `primaryAttributeCoefficients`
// 與 `secondaryAttributeCoefficients`，用 unknown 袋子讀就必須靠強制轉型，而那正是規範 §7 要擋的。
import type {
  CharacterEquipmentLoadoutView,
  EquipmentCoefficientChannelId,
  EquipmentDefinition,
} from '../inventory';

export type { CharacterEquipmentLoadoutView, EquipmentCoefficientChannelId, EquipmentDefinition };

// ── §2 Definition 契約 ──────────────────────────────────────────────────
export interface StatisticsDefinitionReader {
  getStatisticsRule(id: StatisticsRuleId): StatisticsRuleDefinition;
  getSecondaryAttributeRule(id: SecondaryAttributeId): SecondaryAttributeRuleDefinition;
  getGripRule(id: GripRuleId): GripRuleDefinition;
  getCarryCapacityRule(id: CarryCapacityRuleId): CarryCapacityRuleDefinition;
  getAgeModifierRule(id: AgeModifierRuleId): AgeModifierRuleDefinition;
  // doc §6：`sourceRevisionKey` 由「輸入 Entity Revision + Definition Manifest Hash + Statistics Rule ID」
  // 決定。Manifest Hash 是內容側的事實，只有持有 Registry 的 Reader 拿得到，因此在此開一個 getter，
  // 而不是要求呼叫端自己把 hash 塞進 DTO（那會讓兩個呼叫端算出不同的 key）。
  getDefinitionManifestHash(): string;
}

export type StatisticsRuleDefinition = DefinitionHeader & {
  primaryAttributeCap: 100;
  secondaryRuleIds: SecondaryAttributeId[];
  // doc §2 要求第一版就能定義「最大生命、最大魔力與攜帶重量上限」，而 §3 的 Snapshot 把
  // maxHealth／maxMana 列為獨立欄位。兩者之間需要一條對照：哪一個 Secondary 是生命上限。
  // 沒有這兩個欄位，Calculator 只能在程式裡寫死 `'secondary.max-health'` —— 那正是門禁
  // 「無硬編碼內容 ID」要擋的東西，所以對照必須是資料。
  maxHealthSecondaryId: SecondaryAttributeId;
  maxManaSecondaryId: SecondaryAttributeId;
  gripRuleId: GripRuleId;
  carryCapacityRuleId: CarryCapacityRuleId;
  ageModifierRuleId: AgeModifierRuleId;
  reputationContributionRuleId: ResolverId;
};

export type CarryCapacityRuleDefinition = DefinitionHeader & {
  baseWeightCapacity: number;
  strengthCapacityPerPoint: number;
};

export type SecondaryAttributeRuleDefinition = DefinitionHeader & {
  output: SecondaryAttributeId;
  // 「這個副屬走哪幾項主屬」的方向向量（GDD「副屬性對應主屬性」表）。Partial：未列出的主屬不成項，
  // 那是加總的單位元，不是「係數預設 1」。
  primaryCoefficients: Partial<Record<PrimaryAttributeId, number>>;
  // 這個副屬吃裝備的哪幾條係數通道。通道存在與否是資料；程式不對通道做 enum 分支。
  equipmentCoefficientChannelIds: EquipmentCoefficientChannelId[];
  masteryCoefficientResolverId?: ResolverId;
  finalResolverId: ResolverId;
};

// GripRuleDefinition：doc §4 具名但未給 Schema；依 §4 描述的持握倍率推導（見交接報告）。
// 單手／雙手 1.0；雙持主手 0.5；雙持副手 0.35；雙持總輸出為兩手相加。
//
// 欄位名由「左手／右手」改成「主手／副手」：`CharacterEquipmentLoadoutView` 唯一表達得出的手別是
// `EquipmentHand = 'mainHand' | 'offHand'`（inventory 擁有）。留著左右手命名，就得在 Calculator 裡
// 決定「左手＝主手還是副手」——那是一條沒有任何契約支撐的對照。GDD §250 的 0.5 / 0.35 依大小
// 對應主手 / 副手。
export type GripRuleDefinition = DefinitionHeader & {
  singleHandMultiplier: number;
  twoHandMultiplier: number;
  dualWieldMainHandMultiplier: number;
  dualWieldOffHandMultiplier: number;
};

// AgeModifierRuleDefinition：doc 具名但未給 Schema；以資料化 Resolver 推導（見交接報告）。
export type AgeModifierRuleDefinition = DefinitionHeader & {
  resolverId: ResolverId;
};

// ── §3 輸入與輸出 DTO ───────────────────────────────────────────────────

// 已裝備的一件裝備：實例 ID → 定義 View。
// doc §3 只寫 `equipmentDefinitionViews: EquipmentDefinition[]`，但 `CharacterEquipmentLoadoutView`
// 的每個 slot 存的是 `ItemInstanceId`。少了這條對應，Calculator 就算不出「主手那件是什麼」——
// 持握倍率與裝備係數通道都取決於它。
export type EquippedEquipmentView = Readonly<{
  itemInstanceId: ItemInstanceId;
  definition: EquipmentDefinition;
}>;

export type CharacterStatisticsInput = {
  characterId: CharacterId;
  // doc §6：Entity Revision 進 sourceRevisionKey。角色側（年齡／聲望／狀態）的 revision 由 character
  // 擁有，Loadout 與 Mastery 的 revision 已在各自的 View 裡。
  characterRevision: Revision;
  ageDays: number;
  reputation: number;
  primaryAttributesFromMastery: PrimaryAttributes;
  masterySnapshots: MasteryProgressView[];
  conditionModifierRefs: EffectDefinitionId[];
  equipmentLoadout: CharacterEquipmentLoadoutView;
  equipmentDefinitionViews: EquippedEquipmentView[];
  // Loadout 有三組武器組（inventory 契約的 tuple）；持握倍率只對「這次採用的那一組」成立。
  // 與 contracts/combat-power 的 `selectedWeaponSetId` 同一慣例。
  selectedWeaponSetId: WeaponSetId;
  statisticsRuleId: StatisticsRuleId;
};

export type CharacterStatisticsSnapshot = {
  effectivePrimaryAttributes: PrimaryAttributes;
  secondaryAttributes: Record<SecondaryAttributeId, number>;
  maxHealth: number;
  maxMana: number;
  carryingCapacity: number;
  sourceRevisionKey: string;
};

// 一次技能動作的能力快照：技能威力／命中／效果不屬本服務（doc「非責任」），動作之間真正的差異是
// 「這次用哪一組武器」，因此輸入形狀與角色快照相同、由呼叫端指定 selectedWeaponSetId。
export type ActionStatisticsInput = CharacterStatisticsInput;
export type ActionStatisticsSnapshot = CharacterStatisticsSnapshot;

// 裝備預覽要兩份輸入才有 before / after 可比。單一 CharacterStatisticsInput 只描述得出一種配裝。
export type EquipmentPreviewInput = Readonly<{
  before: CharacterStatisticsInput;
  after: CharacterStatisticsInput;
}>;

export type EquipmentPreviewResult = Readonly<{
  before: CharacterStatisticsSnapshot;
  after: CharacterStatisticsSnapshot;
}>;

// 負重上限的窄化輸入（doc §7 不變量 9：只由 Carry Capacity Rule 與有效肌力決定）。
// inventory 的 encumbrance 只需要這一個數字，不必組出整份裝備 View —— 用完整的
// CharacterStatisticsInput 當入口，會逼 inventory 去取它根本用不到的 Loadout 與裝備定義。
export type CarryCapacityInput = Readonly<{
  characterId: CharacterId;
  ageDays: number;
  reputation: number;
  primaryAttributesFromMastery: PrimaryAttributes;
  conditionModifierRefs: readonly EffectDefinitionId[];
  statisticsRuleId: StatisticsRuleId;
}>;

// 計算服務沒有 ModuleOutcome 可用（不擁有 Slice、不在交易裡）。缺資料時的唯一誠實出口是拋出
// 帶碼的例外，讓呼叫端（Query Adapter／Workflow）決定要拒絕交易還是跳過該筆。
export type StatisticsCalculationErrorCode =
  | 'statistics/secondary-rule-not-in-statistics-rule'
  | 'statistics/weapon-set-not-in-loadout'
  | 'statistics/equipment-definition-view-missing'
  | 'statistics/mastery-snapshot-missing'
  | 'statistics/reputation-must-not-contribute-to-charisma'
  | 'statistics/condition-modifier-view-unavailable'
  | 'statistics/preview-character-mismatch';

export interface CharacterStatisticsCalculator {
  calculate(input: Readonly<CharacterStatisticsInput>): CharacterStatisticsSnapshot;
  calculateAction(input: Readonly<ActionStatisticsInput>): ActionStatisticsSnapshot;
  previewEquipment(input: Readonly<EquipmentPreviewInput>): EquipmentPreviewResult;
  // world/derived-statistics 供給 inventory encumbrance 的入口（HANDOFF 記載的缺口）。
  calculateCarryCapacity(input: Readonly<CarryCapacityInput>): number;
}
