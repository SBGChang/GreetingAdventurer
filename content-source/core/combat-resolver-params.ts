// 傷害／治療／CTB 的首版調校數值。角色武器副屬加入威力；減傷比例由 damage-rule 的 mitigationSecondaryId 指定。

import type { WeightedLinearProductParams } from '../../src/data-runtime';
import type { DefinitionHeader, DefinitionId, ModuleId, ResolverBinding } from '../../src/contracts/core';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';
import { RESOLVER } from './combat-rules';

const core = cultureIds('core');
const COMBAT_MODULE = 'combat' as ModuleId;
const KIND = 'weighted-product-params';
const SHAPE = 'combat:weighted-power';

// weighted-product-params 定義 = 標頭 + kernel 的 params 形狀。
type WeightedProductParamsDefinition = DefinitionHeader & WeightedLinearProductParams;

// 一筆：resolver（誰用）↔ 內容 local（params 住哪）↔ params（我設計的數值）。
type PowerSpec = Readonly<{
  resolverId: ResolverBinding['resolverId'];
  local: string;
  params: WeightedLinearProductParams;
}>;

// 傷害：bias 5 + 行動者屬 ×1.5 − 目標同屬 ×1.0，夾下限 1。三通道只差取哪個主屬。
const damage = (attr: string, channel: string): WeightedLinearProductParams => ({
  mode: 'linear',
  bias: 5,
  terms: [
    { inputKey: `actor.${attr}`, weight: 1.5 },
    { inputKey: `target.${attr}`, weight: -1 },
    { inputKey: `actor.secondary.secondary-attribute.core.${channel}-damage`, weight: 1 },
  ],
  clampMin: 1,
});

// 治療：bias + 行動者 intelligence ×係數，夾下限 1（不吃目標屬）。
const heal = (bias: number, weight: number): WeightedLinearProductParams => ({
  mode: 'linear',
  bias,
  terms: [{ inputKey: 'actor.intelligence', weight }],
  clampMin: 1,
});

// CTB 調整量：常數 bias（不吃屬性）；夾下限 0。控制抗性折算在 combat 主路另行處理。
const ctb = (bias: number): WeightedLinearProductParams => ({ mode: 'linear', bias, terms: [], clampMin: 0 });

const POWER_SPECS: readonly PowerSpec[] = [
  { resolverId: RESOLVER.damagePhysical, local: 'damage-physical', params: damage('muscle', 'physical') },
  { resolverId: RESOLVER.damageMagic, local: 'damage-magic', params: damage('intelligence', 'magic') },
  { resolverId: RESOLVER.damageInstrument, local: 'damage-instrument', params: damage('charisma', 'instrument') },
  { resolverId: RESOLVER.healStandard, local: 'heal-standard', params: heal(5, 1.2) },
  { resolverId: RESOLVER.healPotent, local: 'heal-potent', params: heal(10, 1.6) },
  { resolverId: RESOLVER.ctbLight, local: 'ctb-light', params: ctb(10) },
  { resolverId: RESOLVER.ctbStandard, local: 'ctb-standard', params: ctb(20) },
  { resolverId: RESOLVER.ctbHeavy, local: 'ctb-heavy', params: ctb(35) },
];

const paramsDefId = (local: string): DefinitionId => core.id<DefinitionId>(KIND, local);

export const combatResolverParamsDomain: AuthoredDomain = {
  domain: 'combat-resolver-params',
  definitions: POWER_SPECS.map(
    (spec): Authored<WeightedProductParamsDefinition> => ({
      kind: KIND,
      id: paramsDefId(spec.local),
      ...spec.params,
    }),
  ),
};

// core 標頭要宣告的傷害/治療/CTB 綁定：每個 resolver → `combat:weighted-power` + 自己的 params 定義。
export function combatPowerBindings(): readonly ResolverBinding[] {
  return POWER_SPECS.map((spec) => ({
    resolverId: spec.resolverId,
    ownerModule: COMBAT_MODULE,
    shape: SHAPE,
    paramsDefId: paramsDefId(spec.local),
  }));
}
