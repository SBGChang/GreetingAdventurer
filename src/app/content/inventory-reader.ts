// app/content/inventory-reader.ts
// ItemDefinitionReader 的真實實作（由 data-runtime Registry 組出）。照 dungeon-reader.ts 樣板：
// 一個 kind 家族一個窄化 Reader，領域 getter 委派 `.get(id)`。全部為單純 `DefinitionHeader & {…}`。

import type { DefinitionId } from '../../contracts/core';
import type {
  BookDefinition,
  EquipmentDefinition,
  ItemDefinition,
  ItemDefinitionReader,
  NonCombatUseRuleDefinition,
  UseDelayRuleDefinition,
} from '../../contracts/inventory';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

export const INVENTORY_DEFINITION_KINDS = {
  item: 'item',
  equipment: 'equipment',
  useDelayRule: 'use-delay-rule',
  nonCombatUseRule: 'non-combat-use-rule',
  book: 'book',
} as const;

export function createItemDefinitionReader(registry: DefinitionRegistry): ItemDefinitionReader {
  const item = narrowedDomainReader<ItemDefinition>(registry, 'reader:inventory.item', [
    INVENTORY_DEFINITION_KINDS.item,
  ]);
  const equipment = narrowedDomainReader<EquipmentDefinition>(registry, 'reader:inventory.equipment', [
    INVENTORY_DEFINITION_KINDS.equipment,
  ]);
  const useDelay = narrowedDomainReader<UseDelayRuleDefinition>(registry, 'reader:inventory.use-delay-rule', [
    INVENTORY_DEFINITION_KINDS.useDelayRule,
  ]);
  const nonCombatUse = narrowedDomainReader<NonCombatUseRuleDefinition>(
    registry,
    'reader:inventory.non-combat-use-rule',
    [INVENTORY_DEFINITION_KINDS.nonCombatUseRule],
  );
  const book = narrowedDomainReader<BookDefinition>(registry, 'reader:inventory.book', [
    INVENTORY_DEFINITION_KINDS.book,
  ]);

  return {
    getItem: (id) => item.get(id),
    getEquipment: (id) => equipment.get(id),
    getUseDelayRule: (id) => useDelay.get(id),
    getNonCombatUseRule: (id) => nonCombatUse.get(id),
    getBook: (id) => book.get(id),
  };
}
