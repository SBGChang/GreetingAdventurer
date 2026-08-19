// app/content/statistics-reader.ts
// StatisticsDefinitionReader 的真實實作：由 data-runtime 的 DefinitionRegistry 組出來。
// 樣式與 dungeon-reader.ts 相同——一個 kind 家族一個窄化 Reader，領域 getter 委派到對應的 `.get(id)`。

import type {
  AgeModifierRuleDefinition,
  CarryCapacityRuleDefinition,
  GripRuleDefinition,
  SecondaryAttributeRuleDefinition,
  StatisticsDefinitionReader,
  StatisticsRuleDefinition,
} from '../../contracts/statistics';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名（本專案定義；內容作者以此標注每筆 definition 的 kind 欄位）。
// 每個 kind 與定址它的 branded ID 的 tag 對齊：`StatisticsRuleId = DefinitionId<'statistics-rule'>`
// ↔ kind 'statistics-rule'，其餘同理。副屬規則以 `SecondaryAttributeId`（tag `secondary-attribute`）
// 定址，所以 kind 用 'secondary-attribute'：一筆副屬定義就是「這個副屬怎麼算」。
export const STATISTICS_DEFINITION_KINDS = {
  statisticsRule: 'statistics-rule',
  secondaryAttribute: 'secondary-attribute',
  gripRule: 'grip-rule',
  carryCapacityRule: 'carry-capacity-rule',
  ageModifierRule: 'age-modifier-rule',
} as const;

export function createStatisticsDefinitionReader(
  registry: DefinitionRegistry,
): StatisticsDefinitionReader {
  const statisticsRule = narrowedDomainReader<StatisticsRuleDefinition>(
    registry,
    'reader:statistics.statistics-rule',
    [STATISTICS_DEFINITION_KINDS.statisticsRule],
  );
  const secondary = narrowedDomainReader<SecondaryAttributeRuleDefinition>(
    registry,
    'reader:statistics.secondary-attribute',
    [STATISTICS_DEFINITION_KINDS.secondaryAttribute],
  );
  const grip = narrowedDomainReader<GripRuleDefinition>(
    registry,
    'reader:statistics.grip-rule',
    [STATISTICS_DEFINITION_KINDS.gripRule],
  );
  const carryCapacity = narrowedDomainReader<CarryCapacityRuleDefinition>(
    registry,
    'reader:statistics.carry-capacity-rule',
    [STATISTICS_DEFINITION_KINDS.carryCapacityRule],
  );
  const ageModifier = narrowedDomainReader<AgeModifierRuleDefinition>(
    registry,
    'reader:statistics.age-modifier-rule',
    [STATISTICS_DEFINITION_KINDS.ageModifierRule],
  );

  return {
    getStatisticsRule: (id) => statisticsRule.get(id),
    getSecondaryAttributeRule: (id) => secondary.get(id),
    getGripRule: (id) => grip.get(id),
    getCarryCapacityRule: (id) => carryCapacity.get(id),
    getAgeModifierRule: (id) => ageModifier.get(id),
    // doc §6：sourceRevisionKey 的三個來源之一。Registry 是 Manifest 身分的權威，
    // 由 Reader 轉出，避免每個呼叫端各自帶一份 hash 而算出不同的 key。
    getDefinitionManifestHash: () => registry.getManifestIdentity().manifestHash,
  };
}
