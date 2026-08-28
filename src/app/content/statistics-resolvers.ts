// app/content/statistics-resolvers.ts
// 派生統計引擎的 resolver 家族：StatisticsResolverPort 的 4 個方法（age/reputation/mastery/final）
// 背後的 registry resolver。形狀＝程式、量＝內容（services.ts 的 RESOLVERS 指名這些 resolverId）。
//
// 富輸入（ageDays/primaryAttributes/safeRaw/effectivePrimaryAttributes/equippedWeight/masteryLevels）
// 由 statistics 服務帶入；各 shape 把它映射成 kernel 輸入或直接算。params 依 shape 而異：
//   * final max-health/max-mana/identity  → weighted-product-params（bias＋safeRaw×係數；identity=直出）
//   * final mitigation/block-absorption    → ratio-saturation-params（safeRaw/(safeRaw+K)）
//   * mastery-coefficient                  → mastery-multiplier-params（等級→倍率表）
//   * age-modifier/reputation-contribution → primary-attribute-modifier-params（第一版空曲線＝零 delta,待討論）
//   * final instrument-mitigation          → ratio-saturation-params（讀裝備總重,第一版沿用遞減曲線,待討論）

import {
  ratioSaturation,
  weightedLinearProduct,
  type AnyResolverRegistration,
  type RatioSaturationParams,
  type ResolverRegistration,
  type WeightedLinearProductParams,
} from '../../data-runtime';
import type { DefinitionId, ResolverBinding, SchemaId } from '../../contracts/core';
import type { PrimaryAttributeId } from '../../contracts/progression';
import type {
  AgeModifierResolverInput,
  FinalSecondaryResolverInput,
  MasteryCoefficientResolverInput,
  PrimaryAttributeDeltas,
  ReputationContributionResolverInput,
} from '../../domain-services/statistics/statistics';

const NUMBER_RESULT_SCHEMA = 'schema:number-result' as SchemaId;
const DELTAS_RESULT_SCHEMA = 'schema:primary-attribute-deltas' as SchemaId;
const STAT_INPUT_SCHEMA = 'schema:statistics-resolver-input' as SchemaId;

// ── 新增 params 形狀（內容側的表；作者層據此寫值）──────────────────────────────
// 等級→熟練度係數（BM masteryMultipliers，Lv.0..10）。index = 等級。
export type MasteryMultiplierParams = Readonly<{ multipliers: readonly number[] }>;
// 主屬修正曲線（年齡/聲望→各主屬 delta）。第一版為空（無修正）；entries 之後由設計填。
export type PrimaryAttributeModifierParams = Readonly<{
  // 每筆：某主屬在某條件下的加成。第一版空陣列＝零 delta。
  entries: readonly Readonly<{ attribute: PrimaryAttributeId; perUnit: number; inputKey: string }>[];
}>;

// 本家族各 shape 需要的窄化 params 讀取（Composition 注入；測試以 stub 提供）。
export type StatisticsParamsReader = Readonly<{
  getWeightedParams(id: DefinitionId): WeightedLinearProductParams;
  getRatioSaturationParams(id: DefinitionId): RatioSaturationParams;
  getMasteryMultiplierParams(id: DefinitionId): MasteryMultiplierParams;
  getAttributeModifierParams(id: DefinitionId): PrimaryAttributeModifierParams;
}>;

function requireParamsDefId(binding: ResolverBinding): DefinitionId {
  if (binding.paramsDefId === undefined) {
    throw new Error(`statistics shape「${binding.shape}」缺 paramsDefId（Resolver ${String(binding.resolverId)}）`);
  }
  return binding.paramsDefId;
}

function reg<TInput, TResult>(
  binding: ResolverBinding,
  resultSchemaId: SchemaId,
  resolve: ResolverRegistration<TInput, TResult>['resolve'],
): ResolverRegistration<TInput, TResult> {
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: STAT_INPUT_SCHEMA,
    resultSchemaId,
    resolve,
  };
}

// ── final：分數直出 ───────────────────────────────────────────────────────────
function identityRegistration(binding: ResolverBinding): AnyResolverRegistration {
  return reg<FinalSecondaryResolverInput, number>(binding, NUMBER_RESULT_SCHEMA, (input) => ({
    value: input.safeRaw,
  }));
}

// ── final：weighted-linear（max-health/max-mana：bias + safeRaw×係數）──────────
function weightedFinalRegistration(binding: ResolverBinding): AnyResolverRegistration {
  const paramsDefId = requireParamsDefId(binding);
  return reg<FinalSecondaryResolverInput, number>(binding, NUMBER_RESULT_SCHEMA, (input, ctx) => {
    const params = (ctx.definitions as StatisticsParamsReader).getWeightedParams(paramsDefId);
    return { value: weightedLinearProduct(params, { safeRaw: input.safeRaw }) };
  });
}

// ── final：飽和遞減（一般/魔法減傷、格擋吸收：safeRaw/(safeRaw+K)）──────────────
function saturationFinalRegistration(binding: ResolverBinding): AnyResolverRegistration {
  const paramsDefId = requireParamsDefId(binding);
  return reg<FinalSecondaryResolverInput, number>(binding, NUMBER_RESULT_SCHEMA, (input, ctx) => {
    const params = (ctx.definitions as StatisticsParamsReader).getRatioSaturationParams(paramsDefId);
    return { value: ratioSaturation(params, { safeRaw: input.safeRaw }) };
  });
}

// ── final：樂器減傷（讀裝備總重；第一版沿用飽和遞減，待討論）────────────────────
function instrumentMitigationRegistration(binding: ResolverBinding): AnyResolverRegistration {
  const paramsDefId = requireParamsDefId(binding);
  return reg<FinalSecondaryResolverInput, number>(binding, NUMBER_RESULT_SCHEMA, (input, ctx) => {
    const params = (ctx.definitions as StatisticsParamsReader).getRatioSaturationParams(paramsDefId);
    // 第一版：以裝備總重走同一條遞減曲線（GDD 要頭盔重量＋年紀，契約只給總重——差異記帳本待討論）。
    return { value: ratioSaturation(params, { equippedWeight: input.equippedWeight }) };
  });
}

// ── mastery：等級→倍率（取相關熟練度的最高等級）──────────────────────────────
function masteryCoefficientRegistration(binding: ResolverBinding): AnyResolverRegistration {
  const paramsDefId = requireParamsDefId(binding);
  return reg<MasteryCoefficientResolverInput, number>(binding, NUMBER_RESULT_SCHEMA, (input, ctx) => {
    const multipliers = (ctx.definitions as StatisticsParamsReader).getMasteryMultiplierParams(
      paramsDefId,
    ).multipliers;
    if (multipliers.length === 0) {
      throw new Error(`statistics mastery-coefficient: multipliers 為空（${String(paramsDefId)}）`);
    }
    // 取相關熟練度中最高等級的倍率；等級超出表長夾到表尾（最高階倍率）。
    let level = 0;
    for (const m of input.masteryLevels) if (m.level > level) level = m.level;
    const capped = Math.min(level, multipliers.length - 1);
    return { value: multipliers[capped]! };
  });
}

// ── age/reputation：主屬 delta 曲線（第一版空曲線＝零 delta）──────────────────
// 每筆 entry：該主屬 delta += perUnit × scalar（scalar＝年齡日數或聲望）。空 entries＝零 delta（第一版）。
function attributeModifierRegistration<TInput>(
  binding: ResolverBinding,
  scalarOf: (input: TInput) => number,
): AnyResolverRegistration {
  const paramsDefId = requireParamsDefId(binding);
  return reg<TInput, PrimaryAttributeDeltas>(binding, DELTAS_RESULT_SCHEMA, (input, ctx) => {
    const params = (ctx.definitions as StatisticsParamsReader).getAttributeModifierParams(paramsDefId);
    const scalar = scalarOf(input);
    const deltas: Partial<Record<PrimaryAttributeId, number>> = {};
    for (const entry of params.entries) {
      const prev = deltas[entry.attribute];
      deltas[entry.attribute] = (prev === undefined ? 0 : prev) + entry.perUnit * scalar;
    }
    return { value: deltas };
  });
}

function ageModifierRegistration(binding: ResolverBinding): AnyResolverRegistration {
  return attributeModifierRegistration<AgeModifierResolverInput>(binding, (input) => input.ageDays);
}
function reputationContributionRegistration(binding: ResolverBinding): AnyResolverRegistration {
  return attributeModifierRegistration<ReputationContributionResolverInput>(
    binding,
    (input) => input.reputation,
  );
}

// ── shape 代碼鍵 → 建構子 ─────────────────────────────────────────────────────
export const STATISTICS_SHAPE_BUILDERS: Readonly<
  Record<string, (binding: ResolverBinding) => AnyResolverRegistration>
> = {
  'statistics:final-identity': identityRegistration,
  'statistics:final-weighted': weightedFinalRegistration,
  'statistics:final-saturation': saturationFinalRegistration,
  'statistics:final-instrument-mitigation': instrumentMitigationRegistration,
  'statistics:mastery-coefficient': masteryCoefficientRegistration,
  'statistics:age-modifier': ageModifierRegistration,
  'statistics:reputation-contribution': reputationContributionRegistration,
};
