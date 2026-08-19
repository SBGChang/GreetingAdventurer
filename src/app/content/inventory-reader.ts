// app/content/inventory-reader.ts
// ItemDefinitionReader 的真實實作（由 data-runtime Registry 組出）。照 dungeon-reader.ts 樣板：
// 一個 kind 家族一個窄化 Reader，領域 getter 委派 `.get(id)`。全部為單純 `DefinitionHeader & {…}`。

import type { DefinitionId } from '../../contracts/core';
import type {
  BookDefinition,
  EquipmentDefinition,
  ItemDefinition,
  ItemDefinitionReader,
  ItemKind,
  NonCombatUseRuleDefinition,
  UseDelayRuleDefinition,
} from '../../contracts/inventory';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Registry 的 `kind` 與 `ItemDefinition.kind` 是**同一個欄位**（`domainDefinitionView` 覆寫
// id/schemaVersion/packId/enabled 四個 header 欄位，但不覆寫 kind），所以物品的 registry kind
// 就是 `ItemKind` 的六個值之一。
//
// 這裡原本寫 `item: 'item'`：一個沒有任何真實 Definition 會帶的 kind。它之所以沒被抓到，是因為
// 唯一的消費者是 readers.test 自己authored 一筆 `kind: 'item'` 的記憶體 Definition——fixture 剛好
// 長成程式期待的樣子，於是雙方一起錯。接上真實 Content Pack 的第一天就會發現 getItem 永遠找不到
// 任何物品：pack 裡的消耗品是 `combatConsumable`，素材是 `material`，沒有一筆是 `'item'`。
//
// `getItem` 必須解得出**所有**物品，包含裝備與書籍：`inventory/system.ts` 以
// `getItem(id).kind !== 'equipment'` 判斷是否為裝備，`queries.ts` 以 `.kind === 'book'` 判斷書籍。
// 因此 item reader 擁有全部六個 kind，equipment / book reader 各自窄化到自己那一個。
const ITEM_KINDS = [
  'equipment',
  'combatConsumable',
  'nonCombatConsumable',
  'generalItem',
  'book',
  'material',
] as const satisfies readonly ItemKind[];

// 契約新增 ItemKind 時，這個型別檢查會失敗（新 kind 不在陣列裡 → 聯集無法賦值），
// 迫使這份清單一起更新。少了它，新 kind 的物品會安靜地讀不到。
type AssertAllItemKindsOwned = ItemKind extends (typeof ITEM_KINDS)[number] ? true : never;
const _allItemKindsOwned: AssertAllItemKindsOwned = true;
void _allItemKindsOwned;

export const INVENTORY_DEFINITION_KINDS = {
  // 內容作者標 `kind` 的參照：物品的 kind 是 ItemKind 之一（見上），不是單一字串。
  itemKinds: ITEM_KINDS,
  equipment: 'equipment',
  useDelayRule: 'use-delay-rule',
  nonCombatUseRule: 'non-combat-use-rule',
  book: 'book',
} as const;

export function createItemDefinitionReader(registry: DefinitionRegistry): ItemDefinitionReader {
  const item = narrowedDomainReader<ItemDefinition>(
    registry,
    'reader:inventory.item',
    INVENTORY_DEFINITION_KINDS.itemKinds,
  );
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
