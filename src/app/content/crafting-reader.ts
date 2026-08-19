// app/content/crafting-reader.ts
// CraftingDefinitionReader 的真實實作：由 data-runtime 的 DefinitionRegistry 組出來
// （樣板同 dungeon-reader.ts：一個 kind 家族一個窄化 Reader，領域 getter 委派到 `.get(id)`）。

import type {
  CharacterStatusDefinitionId,
  EffectDefinitionId,
  ItemDefinitionId,
} from '../../contracts/core';
import type {
  CraftQualityRuleDefinition,
  CraftingDefinitionReader,
  CraftingItemView,
  CraftingRecipeDefinition,
  CuisineRecipeDefinition,
  FoodAffixDefinition,
  FoodEffectDefinition,
  MaterialAffixDefinition,
  NpcCuisineDecisionRuleDefinition,
  RestaurantMenuDefinition,
} from '../../contracts/crafting';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名（本專案定義；內容作者以此標注每筆 definition 的 kind 欄位）。
//
// 註：`craftingIngredientSlot` / `cuisineIngredientSlot` **不是**獨立 kind——素材槽內嵌在
// CraftingRecipeDefinition.ingredientSlots / CuisineRecipeDefinition.ingredientSlots 裡，
// 沒有 DefinitionHeader，slotId 也只是 TemplateLocalId（配方內唯一）。
export const CRAFTING_DEFINITION_KINDS = {
  craftingRecipe: 'crafting-recipe',
  materialAffix: 'material-affix',
  craftQualityRule: 'craft-quality-rule',
  cuisineRecipe: 'cuisine-recipe',
  foodAffix: 'food-affix',
  restaurantMenu: 'restaurant-menu',
  npcCuisineDecisionRule: 'npc-cuisine-decision-rule',
  // Effect → Character Status 的對照來源（清理清單 A1）。Effect 定義本身由內容軌擁有；
  // Crafting 只投影「這個效果對應哪個角色狀態」這一面。
  effect: 'effect',
  // Item Definition 由 inventory 擁有（kind 與 inventory-reader.ts 的 `item` 相同）；
  // Crafting 只投影素材標籤／候選詞條／文化這三個事實。
  item: 'item',
} as const;

// effect 定義是共用家族（戰鬥、內容事件、料理都用它），所以 characterStatusId 在原始資料裡是選填。
// 讀取端要的是「一定有對照」，因此在此處驗證：缺欄位是壞內容，不是「這個效果沒有狀態」。
type RawEffectStatusView = Readonly<{
  id: EffectDefinitionId;
  schemaVersion: number;
  packId: FoodEffectDefinition['packId'];
  enabled: boolean;
  characterStatusId?: CharacterStatusDefinitionId;
}>;

// item 定義的完整形狀由 inventory 擁有；此處只投影 crafting 需要的欄位。
type RawCraftingItemView = Readonly<{
  originCultureId?: CraftingItemView['originCultureId'];
  materialTagIds?: CraftingItemView['materialTagIds'];
  materialAffixId?: CraftingItemView['materialAffixId'];
}>;

export function createCraftingDefinitionReader(
  registry: DefinitionRegistry,
): CraftingDefinitionReader {
  const craftingRecipe = narrowedDomainReader<CraftingRecipeDefinition>(
    registry,
    'reader:crafting.crafting-recipe',
    [CRAFTING_DEFINITION_KINDS.craftingRecipe],
  );
  const materialAffix = narrowedDomainReader<MaterialAffixDefinition>(
    registry,
    'reader:crafting.material-affix',
    [CRAFTING_DEFINITION_KINDS.materialAffix],
  );
  const craftQualityRule = narrowedDomainReader<CraftQualityRuleDefinition>(
    registry,
    'reader:crafting.craft-quality-rule',
    [CRAFTING_DEFINITION_KINDS.craftQualityRule],
  );
  const cuisineRecipe = narrowedDomainReader<CuisineRecipeDefinition>(
    registry,
    'reader:crafting.cuisine-recipe',
    [CRAFTING_DEFINITION_KINDS.cuisineRecipe],
  );
  const foodAffix = narrowedDomainReader<FoodAffixDefinition>(registry, 'reader:crafting.food-affix', [
    CRAFTING_DEFINITION_KINDS.foodAffix,
  ]);
  const restaurantMenu = narrowedDomainReader<RestaurantMenuDefinition>(
    registry,
    'reader:crafting.restaurant-menu',
    [CRAFTING_DEFINITION_KINDS.restaurantMenu],
  );
  const npcCuisineDecisionRule = narrowedDomainReader<NpcCuisineDecisionRuleDefinition>(
    registry,
    'reader:crafting.npc-cuisine-decision-rule',
    [CRAFTING_DEFINITION_KINDS.npcCuisineDecisionRule],
  );
  const effect = narrowedDomainReader<RawEffectStatusView>(registry, 'reader:crafting.effect', [
    CRAFTING_DEFINITION_KINDS.effect,
  ]);
  const item = narrowedDomainReader<RawCraftingItemView>(registry, 'reader:crafting.item', [
    CRAFTING_DEFINITION_KINDS.item,
  ]);

  return {
    getCraftingRecipe: (id) => craftingRecipe.get(id),
    listCraftingRecipes: () => craftingRecipe.list(),
    getMaterialAffix: (id) => materialAffix.get(id),
    getCraftQualityRule: (id) => craftQualityRule.get(id),
    getCuisineRecipe: (id) => cuisineRecipe.get(id),
    listCuisineRecipes: () => cuisineRecipe.list(),
    getFoodAffix: (id) => foodAffix.get(id),
    getRestaurantMenu: (id) => restaurantMenu.get(id),
    getNpcCuisineDecisionRule: (id) => npcCuisineDecisionRule.get(id),

    getFoodEffect: (id: EffectDefinitionId): FoodEffectDefinition => {
      const view = effect.get(id);
      const characterStatusId = view.characterStatusId;
      if (characterStatusId === undefined) {
        throw new Error(
          `crafting reader: effect "${String(id)}" 缺 characterStatusId，無法對照成 Character Status`,
        );
      }
      return {
        id,
        schemaVersion: view.schemaVersion,
        packId: view.packId,
        enabled: view.enabled,
        characterStatusId,
      };
    },

    getCraftingItemView: (id: ItemDefinitionId): CraftingItemView => {
      const view = item.get(id);
      const originCultureId = view.originCultureId;
      if (originCultureId === undefined) {
        throw new Error(
          `crafting reader: item "${String(id)}" 缺 originCultureId，無法驗證成品文化一致性`,
        );
      }
      return {
        itemDefinitionId: id,
        originCultureId,
        ...(view.materialTagIds === undefined ? {} : { materialTagIds: view.materialTagIds }),
        ...(view.materialAffixId === undefined ? {} : { materialAffixId: view.materialAffixId }),
      };
    },
  };
}
