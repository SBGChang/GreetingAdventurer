// content-source/core/economy-price-params.ts
// 四條價格修正的係數（F3：經濟報價鏈的內容側）。
//
// resolverId **必須恰好是內容既有的那四個**（`price-modifier-rule.core.*` 已經指名它們），
// 不是這裡發明的：買入加成、賣出加成、商店買回率、家教好感修正。
//
// ── 數字的出處 ────────────────────────────────────────────────────────────
//
// 【第一版方案（待討論）】GDD 只寫「最終公式與再次嘗試間隔另行定案」，沒有給任何係數。
// 下面四筆是可玩的第一版，全部住在內容——改它們不需要動任何程式：
//   * 買入 `1 - 0.2 × bonus`：交流熟練加成越高買得越便宜，加成 1.0 時打八折。
//   * 賣出 `1 + 0.2 × bonus`：對稱。
//   * 商店買回 `0.5`：賣給商店拿回半價。這是「賣東西不該等於買東西」的基本手感，
//     `price-rule.core.shop-item` 的 sellModifierIds 已經把它排在個人加成之前。
//   * 家教好感 `1 - 1.0 × modifier`：好感修正直接當折扣係數，換算本身由 social 的
//     `homeTutorPriceModifierResolver` 決定（那一條仍未接線，見 cleanup-backlog）。

import type { ResolverBinding, ResolverId, ModuleId } from '../../src/contracts/core';
import type { PriceModifierParamsDefinition } from '../../src/contracts/economy';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';

const core = cultureIds('core');
const ECONOMY_MODULE = 'economy' as ModuleId;
const KIND = 'price-modifier-params';

type Row = Readonly<{
  // params 的 local 名，同時決定綁哪一個既有 resolverId（見下方 RESOLVER_BY_LOCAL）。
  local: string;
  resolverId: string;
  source: PriceModifierParamsDefinition['source'];
  base: number;
  weight: number;
}>;

const ROWS: readonly Row[] = [
  {
    local: 'personal-trade-bonus-buy',
    resolverId: 'resolver:economy.personal-trade-bonus.buy',
    source: 'personalTradeBonus',
    base: 1,
    weight: -0.2,
  },
  {
    local: 'personal-trade-bonus-sell',
    resolverId: 'resolver:economy.personal-trade-bonus.sell',
    source: 'personalTradeBonus',
    base: 1,
    weight: 0.2,
  },
  {
    local: 'shop-buyback',
    resolverId: 'resolver:economy.shop-buyback',
    source: 'fixed',
    base: 0.5,
    weight: 0,
  },
  {
    local: 'home-tutor-affinity',
    resolverId: 'resolver:economy.home-tutor-affinity',
    source: 'homeTutorPriceModifier',
    base: 1,
    weight: -1,
  },
];

function params(row: Row): Authored<PriceModifierParamsDefinition> {
  return {
    kind: KIND,
    id: core.id(KIND, row.local),
    source: row.source,
    base: row.base,
    weight: row.weight,
  };
}

export function economyPriceModifierBindings(): readonly ResolverBinding[] {
  return ROWS.map((row) => ({
    resolverId: row.resolverId as ResolverId,
    ownerModule: ECONOMY_MODULE,
    shape: 'economy-price-modifier:coefficient',
    paramsDefId: core.id(KIND, row.local),
  }));
}

export const economyPriceParamsDomain: AuthoredDomain = {
  domain: 'economy-price-params',
  definitions: ROWS.map(params),
};

export const ECONOMY_PRICE_PARAMS_DECLARED_KINDS: readonly string[] = [KIND];
