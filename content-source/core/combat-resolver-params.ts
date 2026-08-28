// content-source/core/combat-resolver-params.ts
// 傷害／治療／CTB Resolver 的**調校量**（我設計的第一版數值，待討論）+ 它們的 shape 綁定。
//
// 這裡是 docs/first_version_design_ledger.html 「戰鬥傷害/治療/CTB」三張卡的**落地**：
//   * 公式（程式、固定）：weightedLinearProduct kernel（shape `combat:weighted-power`）。
//   * 數值（內容、我發明、可調）：下面每一筆 weighted-product-params 的 bias / terms / clampMin。
// terms 的 inputKey 用 `actor.<主屬>` / `target.<主屬>`——與 src/app/content/combat-power-resolvers.ts
// 攤平 KernelInputs 的鍵一致。傷害含「− target」減項＝防禦；治療只有「+ actor」；CTB 只有常數 bias。
//
// 通道→屬性（我定的第一版對應）：physical→muscle、magic→intelligence、instrument→charisma。
// 主屬 0–100，早期 ~20–40：單擊約 20–40，對 ~100 HP 合理；平衡數字全部集中在本檔，改這裡即可。

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
const damage = (attr: string): WeightedLinearProductParams => ({
  mode: 'linear',
  bias: 5,
  terms: [
    { inputKey: `actor.${attr}`, weight: 1.5 },
    { inputKey: `target.${attr}`, weight: -1 },
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
  { resolverId: RESOLVER.damagePhysical, local: 'damage-physical', params: damage('muscle') },
  { resolverId: RESOLVER.damageMagic, local: 'damage-magic', params: damage('intelligence') },
  { resolverId: RESOLVER.damageInstrument, local: 'damage-instrument', params: damage('charisma') },
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
