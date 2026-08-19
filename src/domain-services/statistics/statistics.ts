// domain-services/statistics/statistics.ts
// Derived Statistics 的唯一公式實作（docs/00_core/architecture/16_derived_statistics.md）。
//
// 這個服務沒有 State、沒有 Save、不在交易裡：它吃 immutable input，回傳可重建結果。
// 因此本檔的紀律重點不是 Slice 所有權，而是**係數一律是資料**：
//
//   程式提供「形狀」——clamp → 年齡／聲望修正 → 裝備係數矩陣 → 持握係數 → 熟練度係數 →
//                       副屬專用 Resolver 與上下限（doc §4 的既定合成順序）。
//   資料提供「量」——每一個係數、倍率、上下限與曲線都來自 Definition 的欄位或 Resolver 的 params。
//
// 本檔不得出現任何係數字面值。判準：換一份 Content Pack，同一份輸入必須算出不同的數字。
// 唯一寫在程式裡的量是「非負」與「主屬上限」——前者是 doc §4 明訂的 safeRaw 結構規則（負 raw
// 不得隱式產生易傷），後者取自 Definition 的 primaryAttributeCap，不是本檔的常數。

import type {
  AgeModifierRuleDefinition,
  CarryCapacityInput,
  CarryCapacityRuleDefinition,
  CharacterStatisticsCalculator,
  CharacterStatisticsInput,
  CharacterStatisticsSnapshot,
  ActionStatisticsInput,
  ActionStatisticsSnapshot,
  EquipmentCoefficientChannelId,
  EquipmentDefinition,
  EquipmentPreviewInput,
  EquipmentPreviewResult,
  EquippedEquipmentView,
  GripRuleDefinition,
  SecondaryAttributeRuleDefinition,
  StatisticsCalculationErrorCode,
  StatisticsDefinitionReader,
  StatisticsRuleDefinition,
} from '../../contracts/statistics';
import type {
  ItemInstanceId,
  MasteryId,
  ResolverId,
  SecondaryAttributeId,
} from '../../contracts/core';
import type { EquipmentHand, WeaponSetLoadoutView } from '../../contracts/inventory';
import type {
  MasteryProgressView,
  PrimaryAttributeId,
  PrimaryAttributes,
} from '../../contracts/progression';
import { weightedLinearProduct, type LinearTerm } from '../../data-runtime';

// ──────────────────────────────────────────────────────────────────────────
// 主屬性列舉（結構，不是內容）
// ──────────────────────────────────────────────────────────────────────────
//
// PrimaryAttributeId 是 progression 擁有的 5 個字面值聯集。要對「五項主屬」逐項運算就必須能列舉
// 它們；`Object.keys` 拿回來的是 string，接回聯集需要強制轉型。所以改成明寫清單 + 編譯期
// 完備性檢查：progression 若新增一項主屬，下面那行會編譯失敗，而不是安靜地少算一項。
export const PRIMARY_ATTRIBUTE_IDS = [
  'muscle',
  'intelligence',
  'reaction',
  'coordination',
  'charisma',
] as const satisfies readonly PrimaryAttributeId[];

type MissingPrimaryAttributeId = Exclude<
  PrimaryAttributeId,
  (typeof PRIMARY_ATTRIBUTE_IDS)[number]
>;
// 若 progression 新增主屬，MissingPrimaryAttributeId 不再是 never，這個宣告就編不過。
export const primaryAttributeListIsComplete: MissingPrimaryAttributeId extends never
  ? true
  : never = true;

// ──────────────────────────────────────────────────────────────────────────
// 錯誤：計算服務沒有 ModuleOutcome，缺資料的誠實出口是帶碼例外
// ──────────────────────────────────────────────────────────────────────────

export class StatisticsCalculationError extends Error {
  readonly code: StatisticsCalculationErrorCode;
  readonly details: Readonly<Record<string, string | number>>;

  constructor(
    code: StatisticsCalculationErrorCode,
    details: Readonly<Record<string, string | number>>,
  ) {
    super(`${code}: ${JSON.stringify(details)}`);
    this.name = 'StatisticsCalculationError';
    this.code = code;
    this.details = details;
  }
}

function fail(
  code: StatisticsCalculationErrorCode,
  details: Readonly<Record<string, string | number>>,
): never {
  throw new StatisticsCalculationError(code, details);
}

// ──────────────────────────────────────────────────────────────────────────
// 本地 Resolver Port（§7.1 慣例：模組宣告型別，Composition 由 ResolverRegistry 注入實作）
// ──────────────────────────────────────────────────────────────────────────

export type PrimaryAttributeDeltas = Readonly<Partial<Record<PrimaryAttributeId, number>>>;

export type MasteryLevelView = Readonly<{ masteryId: MasteryId; level: number }>;

// AgeModifierRuleDefinition.resolverId 的輸入：doc §7 不變量 7 要求角色面板與 Combat 共用同一條
// Age Rule，所以老化曲線（GDD「六、角色生命週期／年紀與屬性」）整條住在 Resolver params 裡。
export type AgeModifierResolverInput = Readonly<{
  ageDays: number;
  primaryAttributes: PrimaryAttributes;
}>;

// StatisticsRuleDefinition.reputationContributionRuleId 的輸入。
// doc §7 不變量 5：聲望**不得**併入魅力（魅力純由社交熟練帶動）。因此本服務對這個 Resolver 的
// 回傳有一條結構性守門：帶 charisma 的 delta 一律拒絕。
export type ReputationContributionResolverInput = Readonly<{
  reputation: number;
  primaryAttributes: PrimaryAttributes;
}>;

// SecondaryAttributeRuleDefinition.masteryCoefficientResolverId 的輸入。
// 「對應熟練度」由裝備自己宣告（EquipmentDefinition.relatedMasteryIds）；等級由 progression 供給。
export type MasteryCoefficientResolverInput = Readonly<{
  secondaryAttributeId: SecondaryAttributeId;
  masteryLevels: readonly MasteryLevelView[];
}>;

// SecondaryAttributeRuleDefinition.finalResolverId 的輸入。
//
// 為什麼要帶 effectivePrimaryAttributes / ageDays / equippedWeight 而不只帶 safeRaw：
// 有些副屬**沒有裝備通道**（生命上限＝基礎 + 肌力×係數、魔力上限＝基礎 + 智力×係數），有些副屬
// 的輸入根本不是主屬（樂器減傷讀裝備重量與年紀，doc §4）。只餵 safeRaw 的話，這兩類副屬的
// 基礎項就無處可放，最後一定會被寫成程式裡的 bias —— 而 bias 是調校量。
// 全部交給 finalResolver 的 params，形狀在程式、量在資料。
export type FinalSecondaryResolverInput = Readonly<{
  secondaryAttributeId: SecondaryAttributeId;
  safeRaw: number;
  effectivePrimaryAttributes: PrimaryAttributes;
  ageDays: number;
  equippedWeight: number;
}>;

export interface StatisticsResolverPort {
  resolveAgeModifier(
    resolverId: ResolverId,
    input: AgeModifierResolverInput,
  ): PrimaryAttributeDeltas;
  resolveReputationContribution(
    resolverId: ResolverId,
    input: ReputationContributionResolverInput,
  ): PrimaryAttributeDeltas;
  resolveMasteryCoefficient(
    resolverId: ResolverId,
    input: MasteryCoefficientResolverInput,
  ): number;
  resolveFinalSecondaryValue(
    resolverId: ResolverId,
    input: FinalSecondaryResolverInput,
  ): number;
}

export type StatisticsCalculatorDeps = Readonly<{
  definitions: StatisticsDefinitionReader;
  resolvers: StatisticsResolverPort;
}>;

// ──────────────────────────────────────────────────────────────────────────
// 有效主屬（doc §4 步驟 1～3）
// ──────────────────────────────────────────────────────────────────────────

function clampPrimary(value: number, cap: number): number {
  // 下界 0 與上界 cap：cap 來自 StatisticsRuleDefinition.primaryAttributeCap（資料）；
  // 0 是主屬定義域的下界，屬結構（doc §7 不變量 1）。
  return Math.min(Math.max(value, 0), cap);
}

function addDeltas(base: PrimaryAttributes, deltas: PrimaryAttributeDeltas): PrimaryAttributes {
  const out: PrimaryAttributes = { ...base };
  for (const id of PRIMARY_ATTRIBUTE_IDS) {
    const delta = deltas[id];
    if (delta === undefined) continue; // 未列出 = 這條修正不動這一項（加總單位元）
    out[id] = base[id] + delta;
  }
  return out;
}

function clampAll(attributes: PrimaryAttributes, cap: number): PrimaryAttributes {
  const out: PrimaryAttributes = { ...attributes };
  for (const id of PRIMARY_ATTRIBUTE_IDS) out[id] = clampPrimary(attributes[id], cap);
  return out;
}

type EffectivePrimaryInput = Readonly<{
  ageDays: number;
  reputation: number;
  primaryAttributesFromMastery: PrimaryAttributes;
  conditionModifierRefs: readonly unknown[];
}>;

function effectivePrimaryAttributes(
  deps: StatisticsCalculatorDeps,
  rule: StatisticsRuleDefinition,
  input: EffectivePrimaryInput,
): PrimaryAttributes {
  // 狀態修正（conditionModifierRefs）指向 EffectDefinition，而 StatisticsDefinitionReader 沒有
  // 讀 Effect 的 getter —— 這個服務因此**算不出**帶狀態的有效主屬。收下 refs 卻不套用，會讓
  // 呼叫端拿到一份看起來完整、實際少了狀態的快照，所以在這裡明確失敗。
  if (input.conditionModifierRefs.length > 0) {
    fail('statistics/condition-modifier-view-unavailable', {
      conditionModifierCount: input.conditionModifierRefs.length,
      statisticsRuleId: String(rule.id),
    });
  }

  const cap = rule.primaryAttributeCap;
  // doc §4：熟練度提供的五項主屬 → 各項 clamp → 年齡／聲望修正。
  const clamped = clampAll(input.primaryAttributesFromMastery, cap);

  const ageRule: AgeModifierRuleDefinition = deps.definitions.getAgeModifierRule(
    rule.ageModifierRuleId,
  );
  const aged = addDeltas(
    clamped,
    deps.resolvers.resolveAgeModifier(ageRule.resolverId, {
      ageDays: input.ageDays,
      primaryAttributes: clamped,
    }),
  );

  const reputationDeltas = deps.resolvers.resolveReputationContribution(
    rule.reputationContributionRuleId,
    { reputation: input.reputation, primaryAttributes: aged },
  );
  // doc §7 不變量 5：聲望是獨立的 RNG／條件因子，不得併入魅力。
  if (reputationDeltas.charisma !== undefined) {
    fail('statistics/reputation-must-not-contribute-to-charisma', {
      resolverId: String(rule.reputationContributionRuleId),
      charismaDelta: reputationDeltas.charisma,
    });
  }
  const withReputation = addDeltas(aged, reputationDeltas);

  // 不變量 1：最終五項主屬都落在 0～cap。
  return clampAll(withReputation, cap);
}

// ──────────────────────────────────────────────────────────────────────────
// 裝備與持握（doc §4 步驟 4～5）
// ──────────────────────────────────────────────────────────────────────────

// 一件已裝備的裝備 + 它這一次適用的持握倍率。防具不持握，倍率為乘法單位元的來源說明見 armorPieces。
type WeightedPiece = Readonly<{
  itemInstanceId: ItemInstanceId;
  definition: EquipmentDefinition;
  gripMultiplier: number | undefined; // undefined = 不套用持握（防具）
}>;

function viewIndex(
  views: readonly EquippedEquipmentView[],
): ReadonlyMap<ItemInstanceId, EquippedEquipmentView> {
  const map = new Map<ItemInstanceId, EquippedEquipmentView>();
  for (const view of views) map.set(view.itemInstanceId, view);
  return map;
}

function requireView(
  index: ReadonlyMap<ItemInstanceId, EquippedEquipmentView>,
  itemInstanceId: ItemInstanceId,
): EquippedEquipmentView {
  const view = index.get(itemInstanceId);
  if (view === undefined) {
    // 裝備著一件我拿不到定義的東西：那是壞掉的輸入，不是「這件裝備沒有係數」。
    fail('statistics/equipment-definition-view-missing', { itemInstanceId: String(itemInstanceId) });
  }
  return view;
}

function selectedWeaponSet(
  loadout: CharacterStatisticsInput['equipmentLoadout'],
  weaponSetId: CharacterStatisticsInput['selectedWeaponSetId'],
): WeaponSetLoadoutView {
  const found = loadout.weaponSets.find((set) => set.weaponSetId === weaponSetId);
  if (found === undefined) {
    fail('statistics/weapon-set-not-in-loadout', {
      weaponSetId: String(weaponSetId),
      characterId: String(loadout.characterId),
    });
  }
  return found;
}

// 這裡**只分類、不判定合法性**。GDD §511 要求同一組可混搭兩把武器；副手放什麼、能不能放，
// 是 inventory 的裝備合法性規則。本服務看到什麼就依什麼算倍率。
//
// 分類依據全部來自 inventory 契約既有的事實：
//   - 雙手武器同時占兩手 → Loadout 的 mainHandItemId 與 offHandItemId 指向**同一個實例**。
//   - 兩手各一件且兩件都是 weapon → 雙持（主手／副手各自的倍率，總輸出為兩手相加）。
//   - 其餘（單手 + 盾、只有一手有東西）→ 單手倍率。
function heldPieces(
  set: WeaponSetLoadoutView,
  index: ReadonlyMap<ItemInstanceId, EquippedEquipmentView>,
  grip: GripRuleDefinition,
): readonly WeightedPiece[] {
  const mainId = set.mainHandItemId;
  const offId = set.offHandItemId;

  const piece = (itemInstanceId: ItemInstanceId, gripMultiplier: number): WeightedPiece => {
    const view = requireView(index, itemInstanceId);
    return { itemInstanceId, definition: view.definition, gripMultiplier };
  };

  if (mainId !== undefined && offId !== undefined) {
    if (mainId === offId) return [piece(mainId, grip.twoHandMultiplier)];
    const mainIsWeapon = requireView(index, mainId).definition.equipmentKind === 'weapon';
    const offIsWeapon = requireView(index, offId).definition.equipmentKind === 'weapon';
    if (mainIsWeapon && offIsWeapon) {
      return [
        piece(mainId, grip.dualWieldMainHandMultiplier),
        piece(offId, grip.dualWieldOffHandMultiplier),
      ];
    }
    return [piece(mainId, grip.singleHandMultiplier), piece(offId, grip.singleHandMultiplier)];
  }
  if (mainId !== undefined) return [piece(mainId, grip.singleHandMultiplier)];
  if (offId !== undefined) return [piece(offId, grip.singleHandMultiplier)];
  return [];
}

function armorPieces(
  loadout: CharacterStatisticsInput['equipmentLoadout'],
  index: ReadonlyMap<ItemInstanceId, EquippedEquipmentView>,
): readonly WeightedPiece[] {
  const out: WeightedPiece[] = [];
  const seen = new Set<ItemInstanceId>();
  for (const itemInstanceId of Object.values(loadout.armorSlots)) {
    if (itemInstanceId === undefined) continue;
    // 多格甲一件占數個 slot，Loadout 會在每個 slot 都指向同一個實例；係數只能算一次。
    if (seen.has(itemInstanceId)) continue;
    seen.add(itemInstanceId);
    out.push({
      itemInstanceId,
      definition: requireView(index, itemInstanceId).definition,
      gripMultiplier: undefined,
    });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// 副屬（doc §4 步驟 4～7）
// ──────────────────────────────────────────────────────────────────────────

function channelScalar(
  definition: EquipmentDefinition,
  channelIds: readonly EquipmentCoefficientChannelId[],
): number {
  // 這件裝備在「這個副屬所吃的通道」上的係數總和。裝備沒宣告該通道 = 不成項（加總單位元 0），
  // 不是「通道值預設 1」—— 劍對魔法減傷本來就不該有貢獻。
  let sum = 0;
  for (const entry of definition.secondaryAttributeCoefficients) {
    if (channelIds.includes(entry.channelId)) sum += entry.coefficient;
  }
  return sum;
}

// 這件裝備把「副屬規則的主屬方向」× 「裝備自己的主屬係數」合成後，餵給 weightedLinearProduct。
// 兩個因子都是資料；相乘是形狀。
function equipmentPrimaryTerms(
  rule: SecondaryAttributeRuleDefinition,
  definition: EquipmentDefinition,
): readonly LinearTerm[] {
  const terms: LinearTerm[] = [];
  for (const id of PRIMARY_ATTRIBUTE_IDS) {
    const ruleWeight = rule.primaryCoefficients[id];
    if (ruleWeight === undefined) continue; // 這個副屬不走這一項主屬
    terms.push({ inputKey: id, weight: ruleWeight * definition.primaryAttributeCoefficients[id] });
  }
  return terms;
}

function masteryLevelsFor(
  definition: EquipmentDefinition,
  snapshots: readonly MasteryProgressView[],
): readonly MasteryLevelView[] {
  return definition.relatedMasteryIds.map((masteryId) => {
    const snapshot = snapshots.find((s) => s.masteryId === masteryId);
    if (snapshot === undefined) {
      // 熟練度等級是 progression 擁有的事實。這件裝備宣告了對應熟練度，但輸入沒帶它的進度——
      // 把它當 Lv.0 就是替 progression 決定「沒紀錄等於零」，而那條規則不屬這裡。
      fail('statistics/mastery-snapshot-missing', {
        masteryId: String(masteryId),
        equipmentDefinitionId: String(definition.id),
      });
    }
    return { masteryId, level: snapshot.level };
  });
}

function primaryInputs(attributes: PrimaryAttributes): Readonly<Record<string, number>> {
  const inputs: Record<string, number> = {};
  for (const id of PRIMARY_ATTRIBUTE_IDS) inputs[id] = attributes[id];
  return inputs;
}

function secondaryRawValue(
  deps: StatisticsCalculatorDeps,
  rule: SecondaryAttributeRuleDefinition,
  pieces: readonly WeightedPiece[],
  effective: PrimaryAttributes,
  masterySnapshots: readonly MasteryProgressView[],
): number {
  const inputs = primaryInputs(effective);
  let raw = 0;
  for (const piece of pieces) {
    const scalar = channelScalar(piece.definition, rule.equipmentCoefficientChannelIds);
    // 這件裝備不供給這個副屬的任何通道 → 不成項。也因此不會為它解析熟練度係數。
    if (scalar === 0) continue;

    const terms = equipmentPrimaryTerms(rule, piece.definition);
    const attributeTerm = weightedLinearProduct({ mode: 'linear', terms }, inputs);

    const gripMultiplier = piece.gripMultiplier;
    // 防具不持握：少一個乘項，不是「持握倍率預設 1」。
    let contribution =
      gripMultiplier === undefined ? scalar * attributeTerm : scalar * gripMultiplier * attributeTerm;

    // masteryCoefficientResolverId 是選填的：這條副屬規則有熟練度階段才多一個乘項。
    // 這裡刻意不寫「沒有就當 1」——沒有就是沒有這一步，不是有一個預設係數。
    const masteryResolverId = rule.masteryCoefficientResolverId;
    if (masteryResolverId !== undefined) {
      contribution *= deps.resolvers.resolveMasteryCoefficient(masteryResolverId, {
        secondaryAttributeId: rule.output,
        masteryLevels: masteryLevelsFor(piece.definition, masterySnapshots),
      });
    }
    raw += contribution;
  }
  return raw;
}

// ──────────────────────────────────────────────────────────────────────────
// sourceRevisionKey（doc §6）
// ──────────────────────────────────────────────────────────────────────────
//
// 由「輸入 Entity Revision + Definition Manifest Hash + Statistics Rule ID」決定。
// Mastery 依 masteryId 排序後串接，讓同一組進度不因陣列順序算出不同 key（doc §6 要求同輸入
// 逐位相同）。
function sourceRevisionKey(
  manifestHash: string,
  input: Readonly<CharacterStatisticsInput>,
): string {
  const masteryPart = [...input.masterySnapshots]
    .map((s) => `${String(s.masteryId)}@${s.revision}`)
    .sort()
    .join(',');
  return [
    `rule=${String(input.statisticsRuleId)}`,
    `manifest=${manifestHash}`,
    `character=${String(input.characterId)}@${input.characterRevision}`,
    `loadout=${input.equipmentLoadout.revision}`,
    `weaponSet=${String(input.selectedWeaponSetId)}`,
    `mastery=[${masteryPart}]`,
  ].join('|');
}

// ──────────────────────────────────────────────────────────────────────────
// Calculator
// ──────────────────────────────────────────────────────────────────────────

function carryCapacityOf(
  carryRule: CarryCapacityRuleDefinition,
  effective: PrimaryAttributes,
): number {
  // 不變量 9：只由 Carry Capacity Rule 與有效肌力決定。
  return weightedLinearProduct(
    {
      mode: 'linear',
      bias: carryRule.baseWeightCapacity,
      terms: [{ inputKey: 'muscle', weight: carryRule.strengthCapacityPerPoint }],
    },
    { muscle: effective.muscle },
  );
}

export function createCharacterStatisticsCalculator(
  deps: StatisticsCalculatorDeps,
): CharacterStatisticsCalculator {
  function computeSnapshot(
    input: Readonly<CharacterStatisticsInput>,
  ): CharacterStatisticsSnapshot {
    const rule = deps.definitions.getStatisticsRule(input.statisticsRuleId);
    const effective = effectivePrimaryAttributes(deps, rule, input);

    const index = viewIndex(input.equipmentDefinitionViews);
    const grip = deps.definitions.getGripRule(rule.gripRuleId);
    const set = selectedWeaponSet(input.equipmentLoadout, input.selectedWeaponSetId);
    const pieces = [...heldPieces(set, index, grip), ...armorPieces(input.equipmentLoadout, index)];

    // doc §4：樂器減傷讀裝備重量與年紀，因此重量要進 finalResolver 的輸入。
    // 同一件裝備占數個 slot 或同時占兩手時只計一次重量。
    const weighed = new Set<ItemInstanceId>();
    let equippedWeight = 0;
    for (const piece of pieces) {
      if (weighed.has(piece.itemInstanceId)) continue;
      weighed.add(piece.itemInstanceId);
      equippedWeight += piece.definition.unitWeight;
    }

    const secondaryAttributes: Record<SecondaryAttributeId, number> = {};
    for (const secondaryId of rule.secondaryRuleIds) {
      const secondaryRule = deps.definitions.getSecondaryAttributeRule(secondaryId);
      const raw = secondaryRawValue(
        deps,
        secondaryRule,
        pieces,
        effective,
        input.masterySnapshots,
      );
      // doc §4：進入遞減公式前一律 safeRaw = max(0, raw)。負 raw 不得隱式產生易傷，
      // 也不得讓遞減公式的分母走到 0 或負值。
      const safeRaw = Math.max(raw, 0);
      secondaryAttributes[secondaryId] = deps.resolvers.resolveFinalSecondaryValue(
        secondaryRule.finalResolverId,
        {
          secondaryAttributeId: secondaryId,
          safeRaw,
          effectivePrimaryAttributes: effective,
          ageDays: input.ageDays,
          equippedWeight,
        },
      );
    }

    const maxHealth = requireComputedSecondary(
      secondaryAttributes,
      rule,
      rule.maxHealthSecondaryId,
      'maxHealth',
    );
    const maxMana = requireComputedSecondary(
      secondaryAttributes,
      rule,
      rule.maxManaSecondaryId,
      'maxMana',
    );

    return {
      effectivePrimaryAttributes: effective,
      secondaryAttributes,
      maxHealth,
      maxMana,
      carryingCapacity: carryCapacityOf(
        deps.definitions.getCarryCapacityRule(rule.carryCapacityRuleId),
        effective,
      ),
      sourceRevisionKey: sourceRevisionKey(deps.definitions.getDefinitionManifestHash(), input),
    };
  }

  return {
    calculate: (input) => computeSnapshot(input),

    // 一次技能動作的能力快照。技能威力／命中／效果明確**不屬**本服務（doc「非責任」），動作之間
    // 真正改變能力的是「這次用哪一組武器」——呼叫端指定 selectedWeaponSetId，這裡照同一套公式算。
    calculateAction: (input: Readonly<ActionStatisticsInput>): ActionStatisticsSnapshot =>
      computeSnapshot(input),

    previewEquipment: (input: Readonly<EquipmentPreviewInput>): EquipmentPreviewResult => {
      if (input.before.characterId !== input.after.characterId) {
        fail('statistics/preview-character-mismatch', {
          before: String(input.before.characterId),
          after: String(input.after.characterId),
        });
      }
      return { before: computeSnapshot(input.before), after: computeSnapshot(input.after) };
    },

    calculateCarryCapacity: (input: Readonly<CarryCapacityInput>): number => {
      const rule = deps.definitions.getStatisticsRule(input.statisticsRuleId);
      const effective = effectivePrimaryAttributes(deps, rule, input);
      return carryCapacityOf(
        deps.definitions.getCarryCapacityRule(rule.carryCapacityRuleId),
        effective,
      );
    },
  };
}

// maxHealth／maxMana 是 Snapshot 的獨立欄位，但它們的值是副屬之一。取不到 = StatisticsRule 沒把
// 那個副屬列進 secondaryRuleIds（它是唯一的計算來源），所以只有這一種診斷，沒有第二種。
function requireComputedSecondary(
  values: Readonly<Record<SecondaryAttributeId, number>>,
  rule: StatisticsRuleDefinition,
  secondaryId: SecondaryAttributeId,
  field: string,
): number {
  const value = values[secondaryId];
  if (value === undefined) {
    fail('statistics/secondary-rule-not-in-statistics-rule', {
      field,
      secondaryAttributeId: String(secondaryId),
      statisticsRuleId: String(rule.id),
    });
  }
  return value;
}
