// app/content/economy-reader.ts
// EconomyDefinitionReader 的真實實作（由 data-runtime Registry 組出）。
// 四個 kind 家族各一個窄化 Reader；領域 getter 委派到對應的 `.get(id)` / `.tryGet(id)`。
//
// 為什麼同時有 get 與 tryGet：Internal Command 帶進來的 currencyId／rewardRuleId 是**呼叫端**
// 給的（city、distribution、workflow），不是內容之間的引用，Content Pack 的 reference 驗證擋不到。
// Handler 必須能對「命令引用了不存在的定義」回 typed rejection，所以需要非拋出版本。
// 內容→內容的引用（PriceRule 的 buy/sellModifierIds）仍只用拋出版：那種缺漏是壞內容，該炸。

import type {
  CurrencyDefinition,
  EconomyDefinitionReader,
  PriceModifierRuleDefinition,
  PriceRuleDefinition,
  RewardRuleDefinition,
} from '../../contracts/economy';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名（本專案定義；內容作者以此標注每筆 definition 的 kind 欄位）。
// 與 contracts/core 的 brand tag 一致：CurrencyId = DefinitionId<'currency'> 等。
export const ECONOMY_DEFINITION_KINDS = {
  currency: 'currency',
  priceRule: 'price-rule',
  priceModifierRule: 'price-modifier-rule',
  rewardRule: 'reward-rule',
} as const;

export function createEconomyDefinitionReader(registry: DefinitionRegistry): EconomyDefinitionReader {
  const currency = narrowedDomainReader<CurrencyDefinition>(registry, 'reader:economy.currency', [
    ECONOMY_DEFINITION_KINDS.currency,
  ]);
  const priceRule = narrowedDomainReader<PriceRuleDefinition>(registry, 'reader:economy.price-rule', [
    ECONOMY_DEFINITION_KINDS.priceRule,
  ]);
  const priceModifierRule = narrowedDomainReader<PriceModifierRuleDefinition>(
    registry,
    'reader:economy.price-modifier-rule',
    [ECONOMY_DEFINITION_KINDS.priceModifierRule],
  );
  const rewardRule = narrowedDomainReader<RewardRuleDefinition>(registry, 'reader:economy.reward-rule', [
    ECONOMY_DEFINITION_KINDS.rewardRule,
  ]);

  return {
    getCurrency: (id) => currency.get(id),
    tryGetCurrency: (id) => currency.tryGet(id),
    getPriceRule: (id) => priceRule.get(id),
    getPriceModifierRule: (id) => priceModifierRule.get(id),
    getRewardRule: (id) => rewardRule.get(id),
    tryGetRewardRule: (id) => rewardRule.tryGet(id),
  };
}
