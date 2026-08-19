// modules/crafting/queries.ts
// CraftingQuery（doc §4）在 Slice 上的純函式實作。
//
// 註：progression（已學配方／Mastery）與 city（設施可用性）是 Crafting 的**消費 Port**，
// 由擁有模組實作、Composition 注入；本檔只把它們與自己的 Slice 組成唯讀投影。
//
// 壞內容的處理：Query 不吞例外。Reader 對未知 id／跨 kind 存取一律拋錯，讓呼叫端看得見缺口——
// 在這裡 catch 住再繼續，等於把「內容壞了」變成「這個角色剛好沒有可做的配方」。

import type { CharacterId, CityId, WorldDay } from '../../contracts/core';
import type {
  CraftingDefinitionReader,
  CraftingQuery,
  CraftingRecipeView,
  CuisineRecipeView,
  FoodStatusView,
  CraftingState,
} from '../../contracts/crafting';
import type { CraftingCityPort, CraftingProgressionPort } from './system';
import { hasActiveFoodStatus, tryGetFoodStatus } from './state';

export function createCraftingQuery(
  state: CraftingState,
  definitions: CraftingDefinitionReader,
  progression: CraftingProgressionPort,
  city: CraftingCityPort,
): CraftingQuery {
  return {
    getFoodStatus(characterId: CharacterId): FoodStatusView | undefined {
      return tryGetFoodStatus(state, characterId);
    },

    // 不變量 1：有未到期 FoodStatus 時不可自製料理、不可餐館用餐（doc §3）。
    canPrepareFood(characterId: CharacterId, onDay: WorldDay): boolean {
      return !hasActiveFoodStatus(state, characterId, onDay);
    },

    // doc §197：NPC Behavior 只向這裡取得「目前合法的配方池」，再以固定 RNG 抽一筆。
    // 合法＝配方啟用、已學、Mastery 達標、且所在城市有該配方要求的設施。
    listCraftableRecipes(characterId: CharacterId, cityId: CityId): CraftingRecipeView[] {
      return definitions
        .listCraftingRecipes()
        .filter(
          (recipe) =>
            recipe.enabled &&
            progression.hasLearnedRecipe(characterId, recipe.id) &&
            progression.meetsMasteryRequirements(characterId, recipe.requiredMasteries) &&
            city.isFacilityAvailable(cityId, recipe.requiredFacilityKind),
        )
        .map((recipe) => ({ recipeId: recipe.id }));
    },

    // 契約簽章沒有 onDay，所以這裡只回答「食譜側是否可做」（啟用／已學／Mastery）。
    // 「此刻是否還有 FoodStatus 擋著」是 canPrepareFood 的責任——把它塞進來會需要一個
    // 本 Query 拿不到的世界日，而由本檔自行決定「今天」就是在偽造時間來源。
    listCookableCuisine(characterId: CharacterId): CuisineRecipeView[] {
      return definitions
        .listCuisineRecipes()
        .filter(
          (recipe) =>
            recipe.enabled &&
            progression.hasLearnedRecipe(characterId, recipe.id) &&
            progression.meetsMasteryRequirements(characterId, recipe.requiredMasteries),
        )
        .map((recipe) => ({ recipeId: recipe.id }));
    },
  };
}
