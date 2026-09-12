// content-source/core/statistics-resolver-params.ts
// 派生統計引擎的**調校量**（params）＋ shape 綁定。落地 services.ts 的 RESOLVERS 那 9 個 statistics
// resolverId。多數是**真實平衡模型（BM）值**、非發明：
//   * max-health = 200 + safeRaw×20、max-mana = 120 + safeRaw×14（BM）
//   * 一般/魔法減傷 raw/(raw+120)、格擋吸收 raw/(raw+80)（BM）
//   * mastery 倍率 1.00..1.75（BM masteryMultipliers）
// 第一版（待討論）僅：樂器減傷的 K（BM 只給「頭盔重量+年紀」無 K，暫用飽和 K=100 讀總重）、
//   年齡/聲望修正曲線（空＝零 delta，待設計）。final-identity 無 params（分數直出）。

import type { RatioSaturationParams, WeightedLinearProductParams } from '../../src/data-runtime';
import type {
  MasteryMultiplierParams,
  PrimaryAttributeModifierParams,
} from '../../src/app/content/statistics-resolvers';
import type {
  DefinitionHeader,
  DefinitionId,
  ModuleId,
  ResolverBinding,
  ResolverId,
} from '../../src/contracts/core';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';

const core = cultureIds('core');
const STATISTICS_MODULE = 'statistics' as ModuleId;
const resolverId = (local: string): ResolverId => `resolver:statistics.${local}` as ResolverId;
const paramsId = (kind: string, local: string): DefinitionId => core.id<DefinitionId>(kind, local);

const WEIGHTED = 'weighted-product-params';
const SATURATION = 'ratio-saturation-params';
const MASTERY = 'mastery-multiplier-params';
const ATTR_MOD = 'primary-attribute-modifier-params';

type WeightedDef = DefinitionHeader & WeightedLinearProductParams;
type SaturationDef = DefinitionHeader & RatioSaturationParams;
type MasteryDef = DefinitionHeader & MasteryMultiplierParams;
type AttrModDef = DefinitionHeader & PrimaryAttributeModifierParams;

// ── params 定義（值大多照 BM）────────────────────────────────────────────────
const weightedDefs: readonly Authored<WeightedDef>[] = [
  // 生命上限 = 200 + safeRaw×20（safeRaw = 肌×1 ＋裝備）。
  { kind: WEIGHTED, id: paramsId(WEIGHTED, 'stat-max-health'), mode: 'linear', bias: 200, terms: [{ inputKey: 'muscle', weight: 20 }, { inputKey: 'safeRaw', weight: 20 }] },
  // 魔力上限 = 120 + safeRaw×14。
  { kind: WEIGHTED, id: paramsId(WEIGHTED, 'stat-max-mana'), mode: 'linear', bias: 120, terms: [{ inputKey: 'intelligence', weight: 14 }, { inputKey: 'safeRaw', weight: 14 }] },
];

const saturationDefs: readonly Authored<SaturationDef>[] = [
  { kind: SATURATION, id: paramsId(SATURATION, 'mitigation'), inputKey: 'safeRaw', halfSaturation: 120 },
  { kind: SATURATION, id: paramsId(SATURATION, 'block-absorption'), inputKey: 'safeRaw', halfSaturation: 80 },
  // 樂器減傷：第一版以裝備總重走飽和曲線（K=100，待討論）。
  { kind: SATURATION, id: paramsId(SATURATION, 'instrument-mitigation'), inputKey: 'equippedWeight', halfSaturation: 100 },
];

// BM masteryMultipliers（Lv.0..10）。
const masteryDefs: readonly Authored<MasteryDef>[] = [
  {
    kind: MASTERY,
    id: paramsId(MASTERY, 'standard'),
    multipliers: [1.0, 1.03, 1.07, 1.12, 1.18, 1.25, 1.33, 1.42, 1.52, 1.63, 1.75],
  },
];

// 年齡/聲望：第一版空曲線＝零 delta（待討論——年齡曲線與聲望貢獻另行設計）。
const attrModDefs: readonly Authored<AttrModDef>[] = [
  { kind: ATTR_MOD, id: paramsId(ATTR_MOD, 'age'), entries: [] },
  { kind: ATTR_MOD, id: paramsId(ATTR_MOD, 'reputation'), entries: [] },
];

export const statisticsResolverParamsDomain: AuthoredDomain = {
  domain: 'statistics-resolver-params',
  definitions: [...weightedDefs, ...saturationDefs, ...masteryDefs, ...attrModDefs],
};

// ── 綁定：9 個 statistics resolverId → shape ＋ params ─────────────────────────
export function statisticsResolverBindings(): readonly ResolverBinding[] {
  const bind = (local: string, shape: string, paramsDefId?: DefinitionId): ResolverBinding => ({
    resolverId: resolverId(local),
    ownerModule: STATISTICS_MODULE,
    shape,
    ...(paramsDefId === undefined ? {} : { paramsDefId }),
  });
  return [
    bind('final.identity', 'statistics:final-identity'), // 分數直出，無 params
    bind('final.max-health', 'statistics:final-weighted', paramsId(WEIGHTED, 'stat-max-health')),
    bind('final.max-mana', 'statistics:final-weighted', paramsId(WEIGHTED, 'stat-max-mana')),
    bind('final.mitigation', 'statistics:final-saturation', paramsId(SATURATION, 'mitigation')),
    bind('final.block-absorption', 'statistics:final-saturation', paramsId(SATURATION, 'block-absorption')),
    bind('final.instrument-mitigation', 'statistics:final-instrument-mitigation', paramsId(SATURATION, 'instrument-mitigation')),
    bind('mastery-coefficient', 'statistics:mastery-coefficient', paramsId(MASTERY, 'standard')),
    bind('age-modifier', 'statistics:age-modifier', paramsId(ATTR_MOD, 'age')),
    bind('reputation-contribution', 'statistics:reputation-contribution', paramsId(ATTR_MOD, 'reputation')),
  ];
}
