// app/content/distribution-reader.ts
// AssetDistributionDefinitionReader 的真實實作：由 data-runtime 的 DefinitionRegistry 組出來
// （樣板同 dungeon-reader.ts：一個 kind 家族一個窄化 Reader，領域 getter 委派到 `.get(id)`）。
//
// 競拍的每一個可調量都住在這份定義裡：最低出價政策、流標直售倍率、Companion 出價 Resolver、
// 平手政策、NPC 收受者 Resolver、餘數政策。Handler 不持有任何一項。

import type {
  AssetDistributionDefinitionReader,
  AssetDistributionRuleDefinition,
} from '../../contracts/distribution';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名（本專案定義；內容作者以此標注每筆 definition 的 kind 欄位）。
export const DISTRIBUTION_DEFINITION_KINDS = {
  assetDistributionRule: 'asset-distribution-rule',
} as const;

export function createAssetDistributionDefinitionReader(
  registry: DefinitionRegistry,
): AssetDistributionDefinitionReader {
  const rules = narrowedDomainReader<AssetDistributionRuleDefinition>(
    registry,
    'reader:distribution.asset-distribution-rule',
    [DISTRIBUTION_DEFINITION_KINDS.assetDistributionRule],
  );

  return {
    getRule: (id) => rules.get(id),
  };
}
