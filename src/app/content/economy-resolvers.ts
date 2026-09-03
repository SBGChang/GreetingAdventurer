// app/content/economy-resolvers.ts
// 價格修正 Resolver 的 shape（F3：經濟報價鏈）。
//
// 內容裡有四條 `price-modifier-rule`，各指名一個 Resolver：買入加成、賣出加成、商店買回率、
// 家教好感修正。四者**共用同一個 shape**——它們的差別只有「看哪個來源」與「係數怎麼配」，
// 那是 params，不是四份程式。
//
// 計算形狀固定為 `係數 = base + weight × 來源值`，程式裡沒有任何可調數字：
//   * 買入加成：base 1、weight 負值 → 交流熟練越高買得越便宜
//   * 賣出加成：base 1、weight 正值 → 賣得越貴
//   * 商店買回：source `fixed`、weight 0 → 純固定率
//   * 家教好感：來源換成好感修正
//
// 回傳 `undefined` 代表這個 Resolver 在目前輸入下算不出修正——Quote 會明確失敗，
// 不會被當成「沒有修正」（economy/queries.ts 的契約明講這一點）。

import type { ResolverBinding, SchemaId } from '../../contracts/core';
import type { PriceModifierParamsDefinition } from '../../contracts/economy';
import type { AnyResolverRegistration, ResolverRegistration } from '../../data-runtime';
import type { PriceModifierResolverInput } from '../../modules/economy/public';

const MODIFIER_INPUT_SCHEMA = 'schema:economy-price-modifier-input' as SchemaId;
const NUMBER_RESULT_SCHEMA = 'schema:number' as SchemaId;

// Resolver 執行期讀 params 的窄門（由 economy context 在呼叫時提供）。
export type PriceModifierDefinitions = Readonly<{
  getPriceModifierParams(id: string): PriceModifierParamsDefinition;
}>;

function sourceValueOf(
  params: PriceModifierParamsDefinition,
  input: PriceModifierResolverInput,
): number | undefined {
  switch (params.source) {
    case 'personalTradeBonus':
      return input.personalTradeBonus;
    case 'homeTutorPriceModifier':
      // 只有 homeTutor 服務報價會帶這一項。一般買賣拿不到＝這條修正不該套在這種報價上，
      // 那是內容配置錯（把家教修正掛到商店規則上），必須明確失敗而不是當成 0。
      return input.homeTutorPriceModifier;
    case 'fixed':
      // 不看任何來源；weight 應為 0，實際係數就是 base。
      return 0;
  }
}

function coefficientRegistration(
  binding: ResolverBinding,
): ResolverRegistration<PriceModifierResolverInput, number | undefined> {
  const paramsDefId = binding.paramsDefId;
  if (paramsDefId === undefined) {
    throw new Error(
      `economy-price-modifier:coefficient 綁定缺 paramsDefId（Resolver ${String(binding.resolverId)}）——` +
        `係數住在一筆 price-modifier-params，binding 必須指向它。`,
    );
  }
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: MODIFIER_INPUT_SCHEMA,
    resultSchemaId: NUMBER_RESULT_SCHEMA,
    resolve: (input, ctx) => {
      const defs = ctx.definitions as PriceModifierDefinitions;
      const params = defs.getPriceModifierParams(String(paramsDefId));
      const sourceValue = sourceValueOf(params, input);
      if (sourceValue === undefined) return { value: undefined };
      return { value: params.base + params.weight * sourceValue };
    },
  };
}

export const ECONOMY_PRICE_MODIFIER_SHAPE_BUILDERS: Readonly<
  Record<string, (binding: ResolverBinding) => AnyResolverRegistration>
> = {
  'economy-price-modifier:coefficient': coefficientRegistration,
};
