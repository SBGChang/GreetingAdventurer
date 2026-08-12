// modules/inventory/fixtures.ts
// 最小測試 Fixture（對應 docs/00_core/architecture/05_inventory_module.md §8）：
// 一名角色持有數件物品，加上一個 ItemDefinitionReader stub 與可注入的 InventoryDeps。
// 純資料/純函式，無外部依賴。

import type {
  CharacterId,
  ContentPackId,
  CultureId,
  CurrencyId,
  EffectDefinitionId,
  EncumbranceResolutionId,
  ItemDefinitionId,
  ItemInstanceId,
  TeamId,
  UseDelayRuleId,
  WorldDay,
} from '../../contracts/core';
import type {
  BookDefinition,
  CarryCapacitySnapshot,
  EquipmentDefinition,
  EquipmentSlotId,
  ItemDefinition,
  ItemDefinitionReader,
  NonCombatUseRuleDefinition,
  UseDelayRuleDefinition,
} from '../../contracts/inventory';
import type { InventoryState, ItemInstance } from './state';
import type { InventoryDeps } from './system';

// ── 固定 ID ────────────────────────────────────────────────────────────────
const PACK = 'pack:test' as ContentPackId;
const CULTURE = 'culture:han' as CultureId;
const COPPER = 'currency:copper' as CurrencyId;

export const FIXTURE = {
  characterId: 'runtime:character:hero' as CharacterId,
  otherCharacterId: 'runtime:character:ally' as CharacterId,
  teamId: 'runtime:team:player' as TeamId,
  // Definition IDs
  swordDefId: 'definition:item:sword' as ItemDefinitionId,
  greatswordDefId: 'definition:item:greatsword' as ItemDefinitionId,
  shieldDefId: 'definition:item:shield' as ItemDefinitionId,
  robeDefId: 'definition:item:robe' as ItemDefinitionId, // 多格甲：body + head
  chestDefId: 'definition:item:chest' as ItemDefinitionId, // 單格甲：body
  potionDefId: 'definition:item:potion' as ItemDefinitionId,
  bookDefId: 'definition:item:book-basic' as ItemDefinitionId,
  paperDefId: 'definition:item:paper' as ItemDefinitionId,
  // Item instance IDs
  swordItemId: 'runtime:item-instance:sword-1' as ItemInstanceId,
  greatswordItemId: 'runtime:item-instance:greatsword-1' as ItemInstanceId,
  shieldItemId: 'runtime:item-instance:shield-1' as ItemInstanceId,
  robeItemId: 'runtime:item-instance:robe-1' as ItemInstanceId,
  chestItemId: 'runtime:item-instance:chest-1' as ItemInstanceId,
  potionItemId: 'runtime:item-instance:potion-1' as ItemInstanceId,
  // Equipment slots
  mainHandSlot: 'definition:equipment-slot:mainHand' as EquipmentSlotId,
  offHandSlot: 'definition:equipment-slot:offHand' as EquipmentSlotId,
  bodySlot: 'definition:equipment-slot:body' as EquipmentSlotId,
  headSlot: 'definition:equipment-slot:head' as EquipmentSlotId,
} as const;

// ── Definition base helpers ─────────────────────────────────────────────────
function baseItem(id: ItemDefinitionId, kind: ItemDefinition['kind'], unitWeight: number): ItemDefinition {
  return {
    id,
    schemaVersion: 1,
    packId: PACK,
    enabled: true,
    originCultureId: CULTURE,
    itemTagIds: [],
    kind,
    stackPolicy: kind === 'combatConsumable' || kind === 'material' ? 'stackable' : 'single',
    unitWeight,
    tradePolicy: { tradable: true },
    display: { nameRef: { key: `item.${String(id)}` } },
    intrinsicValue: { currencyId: COPPER, amount: 10 },
    unresolvedMapDisposition: 'toCityPermanentStock',
  };
}

const swordDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.swordDefId, 'equipment', 30),
  kind: 'equipment',
  equipmentKind: 'weapon',
  rarity: 'common',
  relatedMasteryIds: [],
  occupiedSlots: [FIXTURE.mainHandSlot], // 單手
  // 五個主屬性係數必須齊全（PrimaryAttributeId 是 progression 的 5 字面值聯集，不是任意 ID）。
  primaryAttributeCoefficients: { muscle: 0, intelligence: 0, reaction: 0, coordination: 0, charisma: 0 },
  secondaryAttributeCoefficients: [],
  skillEffectRefs: [],
};

const greatswordDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.greatswordDefId, 'equipment', 60),
  kind: 'equipment',
  equipmentKind: 'weapon',
  rarity: 'fine',
  relatedMasteryIds: [],
  occupiedSlots: [FIXTURE.mainHandSlot, FIXTURE.offHandSlot], // 雙手占主/副
  // 五個主屬性係數必須齊全（PrimaryAttributeId 是 progression 的 5 字面值聯集，不是任意 ID）。
  primaryAttributeCoefficients: { muscle: 0, intelligence: 0, reaction: 0, coordination: 0, charisma: 0 },
  secondaryAttributeCoefficients: [],
  skillEffectRefs: [],
};

const noCoeff = { muscle: 0, intelligence: 0, reaction: 0, coordination: 0, charisma: 0 } as const;

const shieldDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.shieldDefId, 'equipment', 20),
  kind: 'equipment',
  equipmentKind: 'shield',
  rarity: 'common',
  relatedMasteryIds: [],
  occupiedSlots: [FIXTURE.offHandSlot], // 盾屬副手
  primaryAttributeCoefficients: noCoeff,
  secondaryAttributeCoefficients: [],
  skillEffectRefs: [],
};

const robeDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.robeDefId, 'equipment', 25),
  kind: 'equipment',
  equipmentKind: 'armor',
  rarity: 'common',
  relatedMasteryIds: [],
  occupiedSlots: [FIXTURE.bodySlot, FIXTURE.headSlot], // 多格甲：body + head
  primaryAttributeCoefficients: noCoeff,
  secondaryAttributeCoefficients: [],
  skillEffectRefs: [],
};

const chestDef: EquipmentDefinition = {
  ...baseItem(FIXTURE.chestDefId, 'equipment', 15),
  kind: 'equipment',
  equipmentKind: 'armor',
  rarity: 'common',
  relatedMasteryIds: [],
  occupiedSlots: [FIXTURE.bodySlot], // 單格甲：body
  primaryAttributeCoefficients: noCoeff,
  secondaryAttributeCoefficients: [],
  skillEffectRefs: [],
};

const POTION_DELAY_RULE = 'definition:use-delay-rule:potion' as UseDelayRuleId;

const potionDef: ItemDefinition = {
  ...baseItem(FIXTURE.potionDefId, 'combatConsumable', 2),
  combatUseDelayRuleId: POTION_DELAY_RULE,
  useEffectIds: ['definition:effect:heal' as EffectDefinitionId],
};

const bookDef: BookDefinition = {
  ...baseItem(FIXTURE.bookDefId, 'book', 5),
  kind: 'book',
  tier: 'basic',
  teaches: [],
  learningPolicy: 'retainAfterLearning',
};

const paperDef: ItemDefinition = {
  ...baseItem(FIXTURE.paperDefId, 'generalItem', 1),
  generalItemCategoryId: undefined,
};

const useDelayRule: UseDelayRuleDefinition = {
  id: POTION_DELAY_RULE,
  schemaVersion: 1,
  packId: PACK,
  enabled: true,
  baseDelay: 50,
  reductions: [],
  minimumDelay: 10,
};

// ── ItemDefinitionReader stub ───────────────────────────────────────────────
export function createFixtureReader(): ItemDefinitionReader {
  const defs: Record<string, ItemDefinition> = {
    [FIXTURE.swordDefId]: swordDef,
    [FIXTURE.greatswordDefId]: greatswordDef,
    [FIXTURE.shieldDefId]: shieldDef,
    [FIXTURE.robeDefId]: robeDef,
    [FIXTURE.chestDefId]: chestDef,
    [FIXTURE.potionDefId]: potionDef,
    [FIXTURE.bookDefId]: bookDef,
    [FIXTURE.paperDefId]: paperDef,
  };
  return {
    getItem(id) {
      const d = defs[id];
      if (!d) throw new Error(`fixture reader: unknown item ${String(id)}`);
      return d;
    },
    getEquipment(id) {
      const d = defs[id];
      if (!d || d.kind !== 'equipment') throw new Error(`fixture reader: not equipment ${String(id)}`);
      return d as EquipmentDefinition;
    },
    getUseDelayRule(id) {
      if (id === useDelayRule.id) return useDelayRule;
      throw new Error(`fixture reader: unknown use-delay-rule ${String(id)}`);
    },
    getNonCombatUseRule(_id): NonCombatUseRuleDefinition {
      throw new Error('fixture reader: no non-combat use rules defined');
    },
    getBook(id) {
      const d = defs[id];
      if (!d || d.kind !== 'book') throw new Error(`fixture reader: not a book ${String(id)}`);
      return d as BookDefinition;
    },
  };
}

// ── Seeded state：hero 持有 1 把劍 + 3 瓶戰鬥藥水（皆在背包）───────────────────
export function createFixtureState(): InventoryState {
  const sword: ItemInstance = {
    itemId: FIXTURE.swordItemId,
    definitionId: FIXTURE.swordDefId,
    quantity: 1,
    ownerCharacterId: FIXTURE.characterId,
    location: { kind: 'characterBag', characterId: FIXTURE.characterId },
    state: 'active',
    revision: 0,
  };
  const potion: ItemInstance = {
    itemId: FIXTURE.potionItemId,
    definitionId: FIXTURE.potionDefId,
    quantity: 3,
    ownerCharacterId: FIXTURE.characterId,
    location: { kind: 'characterBag', characterId: FIXTURE.characterId },
    state: 'active',
    revision: 0,
  };
  // 雙手武器實例：供「雙手佔位／頂替卸下」測試使用。
  const greatsword: ItemInstance = {
    itemId: FIXTURE.greatswordItemId,
    definitionId: FIXTURE.greatswordDefId,
    quantity: 1,
    ownerCharacterId: FIXTURE.characterId,
    location: { kind: 'characterBag', characterId: FIXTURE.characterId },
    state: 'active',
    revision: 0,
  };
  const bagItem = (itemId: ItemInstanceId, definitionId: ItemDefinitionId): ItemInstance => ({
    itemId,
    definitionId,
    quantity: 1,
    ownerCharacterId: FIXTURE.characterId,
    location: { kind: 'characterBag', characterId: FIXTURE.characterId },
    state: 'active',
    revision: 0,
  });
  return {
    items: {
      [FIXTURE.swordItemId]: sword,
      [FIXTURE.potionItemId]: potion,
      [FIXTURE.greatswordItemId]: greatsword,
      [FIXTURE.shieldItemId]: bagItem(FIXTURE.shieldItemId, FIXTURE.shieldDefId),
      [FIXTURE.robeItemId]: bagItem(FIXTURE.robeItemId, FIXTURE.robeDefId),
      [FIXTURE.chestItemId]: bagItem(FIXTURE.chestItemId, FIXTURE.chestDefId),
    },
    equipmentLoadouts: {},
    encumbranceResolutions: {},
  };
}

// ── Deps：可注入的 ID 產生器 + Team/Capacity/Travel 讀 Port ───────────────────
export function createFixtureDeps(overrides?: Partial<InventoryDeps>): InventoryDeps {
  let itemCounter = 100;
  let resolutionCounter = 0;
  const base: InventoryDeps = {
    reader: createFixtureReader(),
    nextItemInstanceId: () => `runtime:item-instance:gen-${(itemCounter += 1)}` as ItemInstanceId,
    nextEncumbranceResolutionId: () =>
      `runtime:encumbrance-resolution:gen-${(resolutionCounter += 1)}` as EncumbranceResolutionId,
    worldDay: 1 as WorldDay,
    getTeamMembers: () => [FIXTURE.characterId],
    getCarryCapacity: (characterId): CarryCapacitySnapshot => ({
      characterId,
      maximumWeight: 1000,
      sourceRevisionKey: 'fixture-capacity-v1',
    }),
    isTeamTravelling: () => false,
  };
  return { ...base, ...overrides };
}
