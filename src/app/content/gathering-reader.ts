// app/content/gathering-reader.ts
// GatheringDefinitionReader 的真實實作（由 data-runtime 的 DefinitionRegistry 組出）。
// 兩個 kind 家族、兩個窄化 Reader、兩個單純委派——樣板同 dungeon-reader.ts。
//
// 注意 kind 命名與既有兩處的關係（整合者要收斂的契約問題，見交接報告）：
//   - dungeon-reader.ts 的 DUNGEON_DEFINITION_KINDS.gatheringRule = 'gathering-rule'
//     （只投影 dungeonInteractionMinutes）
//   - map-reader.ts 的 MAP_DEFINITION_KINDS.gatheringRule = 'map-gathering-rule'
//     （只投影 npcPolicy）
// 這三個 Reader 讀的是**同一筆** Gathering Rule 定義的不同 View（正是 data-runtime readers.ts
// 開頭描述的「同一 Definition 被不同 Reader 以不同 mapView 編譯」）。本檔沿用 'gathering-rule'，
// 與 DefinitionId<'gathering-rule'> 的 brand tag 一致；map 那邊的 'map-gathering-rule' 是第二個
// kind 字串，同一筆內容無法同時滿足兩者。

import type {
  GatheringDefinitionReader,
  GatheringDestinationPolicyDefinition,
  GatheringRuleDefinition,
} from '../../contracts/gathering';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名（內容作者以此標注每筆 definition 的 kind 欄位）。
export const GATHERING_DEFINITION_KINDS = {
  rule: 'gathering-rule',
  destinationPolicy: 'gathering-destination-policy',
} as const;

export function createGatheringDefinitionReader(
  registry: DefinitionRegistry,
): GatheringDefinitionReader {
  const rule = narrowedDomainReader<GatheringRuleDefinition>(
    registry,
    'reader:gathering.rule',
    [GATHERING_DEFINITION_KINDS.rule],
  );
  const destinationPolicy = narrowedDomainReader<GatheringDestinationPolicyDefinition>(
    registry,
    'reader:gathering.destination-policy',
    [GATHERING_DEFINITION_KINDS.destinationPolicy],
  );

  return {
    getGatheringRule: (id) => rule.get(id),
    getGatheringDestinationPolicy: (id) => destinationPolicy.get(id),
  };
}
