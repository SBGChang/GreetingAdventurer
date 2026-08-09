// contracts/crafting — public contract transcribed from docs/00_core/architecture/20_crafting_and_cuisine_module.md
// 模組 ID：crafting。純型別；無實作。

import type {
  CharacterId,
  CraftingAttemptId,
  CraftingRecipeId,
  MaterialAffixId,
  MaterialTagId,
  CraftQualityRuleId,
  CuisineRecipeId,
  FoodAffixId,
  RestaurantMenuId,
  RestaurantMealVariantId,
  NpcCuisineDecisionRuleId,
  CraftingIngredientSlotId,
  CultureId,
  CityId,
  ItemDefinitionId,
  ItemInstanceId,
  EffectDefinitionId,
  ExperienceAwardRuleId,
  PriceRuleId,
  ResolverId,
  FreeActionId,
  WorldDay,
  Revision,
  DefinitionHeader,
} from '../core';
import type { MasteryRequirement } from '../progression';

// ── core 未列出的共用型別（於此定義；見交接報告）────────────────────────
// CraftQuality 屬共用核心契約（00_shared_contracts.md §2），core .ts 尚未匯出。
export type CraftQuality = 'plain' | 'fine' | 'excellent' | 'perfect' | 'peerless' | 'demonGod';

// ── 跨模組占位型別（owning module 契約尚未建立；見交接報告）──────────────
// FacilityKind 由 city 擁有（09_city_module.md）。
export type FacilityKind =
  | 'inn'
  | 'tavern'
  | 'adventurerGuild'
  | 'itemShop'
  | 'equipmentShop'
  | 'trainingGround'
  | 'bookstore'
  | 'adventureCheckpoint'
  | 'cityGate'
  | 'home';
// EquipmentSkillEffectRef 由 inventory 擁有（05_inventory_module.md §2.3）。
export type EquipmentSkillEffectRef = Readonly<Record<string, unknown>>;

// ── §1 State ────────────────────────────────────────────────────────────
export type CraftingState = {
  foodStatuses: Record<CharacterId, FoodStatus | undefined>;
  craftingAttempts: Record<CraftingAttemptId, CraftingAttempt>;
};

// ── §2 靜態資料契約 ─────────────────────────────────────────────────────
export interface CraftingDefinitionReader {
  getCraftingRecipe(id: CraftingRecipeId): CraftingRecipeDefinition;
  getMaterialAffix(id: MaterialAffixId): MaterialAffixDefinition;
  getCraftQualityRule(id: CraftQualityRuleId): CraftQualityRuleDefinition;
  getCuisineRecipe(id: CuisineRecipeId): CuisineRecipeDefinition;
  getFoodAffix(id: FoodAffixId): FoodAffixDefinition;
  getRestaurantMenu(id: RestaurantMenuId): RestaurantMenuDefinition;
  getNpcCuisineDecisionRule(id: NpcCuisineDecisionRuleId): NpcCuisineDecisionRuleDefinition;
}

export type EquipmentRarity = 'common' | 'fine' | 'epic' | 'legendary' | 'mythic';

export type CraftingRecipeDefinition = DefinitionHeader & {
  originCultureId: CultureId;
  outputKind: 'equipment' | 'consumable' | 'tradeGood';
  outputDefinitionId: ItemDefinitionId;
  outputRarity?: EquipmentRarity; // 僅 equipment，基礎係數預算的唯一來源
  requiredMasteries: MasteryRequirement[];
  requiredFacilityKind: FacilityKind;
  craftingDurationDays: number;
  ingredientSlots: CraftingIngredientSlotDefinition[];
  craftingExperienceRuleId: ExperienceAwardRuleId;
  outcomeResolverId: ResolverId;
  qualityRuleId: CraftQualityRuleId;
};

export type CraftingIngredientSlotDefinition = {
  slotId: CraftingIngredientSlotId; // 只需在所屬 CraftingRecipeDefinition 內唯一
  acceptedMaterialTagIds: MaterialTagId[];
  quantity: number;
  contributesEquipmentAffix: boolean;
};

export type MaterialAffixDefinition = DefinitionHeader & {
  compatibleOutputKinds: Array<'equipment' | 'cuisine'>;
  equipmentEffectRefs?: EquipmentSkillEffectRef[];
  foodAffixId?: FoodAffixId;
  tier: 1 | 2 | 3 | 4 | 5;
};

export type CraftQualityRuleDefinition = DefinitionHeader & {
  resolverId: ResolverId;
};

// §2.3 料理
export type CuisineRecipeDefinition = DefinitionHeader & {
  originCultureId: CultureId;
  requiredMasteries: MasteryRequirement[];
  ingredientSlots: CuisineIngredientSlotDefinition[];
  baseFoodEffectIds: EffectDefinitionId[];
  foodStatusDurationDays: number;
  cookingExperienceRuleId: ExperienceAwardRuleId;
  foodAffixTierResolverId: ResolverId;
  restaurantBaseVariantId?: RestaurantMealVariantId;
};

// CuisineIngredientSlotDefinition：doc 於 CuisineRecipeDefinition 引用但未給 Schema；
// 依 crafting 素材槽結構推導（見交接報告）。
export type CuisineIngredientSlotDefinition = {
  slotId: CraftingIngredientSlotId;
  acceptedMaterialTagIds: MaterialTagId[];
  quantity: number;
};

export type FoodAffixDefinition = DefinitionHeader & {
  effectByTier: Record<1 | 2 | 3 | 4 | 5, EffectDefinitionId>;
};

export type RestaurantMenuDefinition = DefinitionHeader & {
  cityId: CityId;
  entries: Array<{
    mealVariantId: RestaurantMealVariantId;
    cuisineRecipeId: CuisineRecipeId;
    priceRuleId: PriceRuleId;
  }>;
};

export type NpcCuisineDecisionRuleDefinition = DefinitionHeader & {
  selfCookWeightResolverId: ResolverId;
  restaurantWeightResolverId: ResolverId;
};

// ── §3 Runtime State ────────────────────────────────────────────────────
export type FoodStatusSource =
  | { kind: 'selfCooked'; recipeId: CuisineRecipeId }
  | { kind: 'restaurant'; mealVariantId: RestaurantMealVariantId };

export type FoodStatus = {
  characterId: CharacterId;
  source: FoodStatusSource;
  originCultureId: CultureId;
  foodAffixes: Array<{ foodAffixId: FoodAffixId; tier: 1 | 2 | 3 | 4 | 5 }>;
  appliedEffectIds: EffectDefinitionId[];
  startedOnDay: WorldDay;
  expiresOnDay: WorldDay; // 最後有效的世界日
  revision: Revision;
};

export type CraftingAttempt = {
  craftingAttemptId: CraftingAttemptId;
  freeActionId: FreeActionId;
  characterId: CharacterId;
  recipeId: CraftingRecipeId;
  ingredientItemIds: ItemInstanceId[];
  startedOnDay: WorldDay;
  status: 'scheduled' | 'resolved';
  result?: CraftingAttemptResult;
  revision: Revision;
};

export type CraftingAttemptResult =
  | {
      outcome: 'succeeded';
      quality: CraftQuality;
      outputItemIds: ItemInstanceId[];
      consumedIngredientItemIds: ItemInstanceId[];
    }
  | {
      outcome: 'failed';
      outputItemIds: [];
      consumedIngredientItemIds: ItemInstanceId[];
      returnedIngredientItemIds: ItemInstanceId[];
    };

// ── §4 公開 Query ───────────────────────────────────────────────────────
// View 型別 doc 具名但未定義；以唯讀投影推導（見交接報告）。
export type FoodStatusView = Readonly<FoodStatus>;
export type CraftingRecipeView = Readonly<{ recipeId: CraftingRecipeId }>;
export type CuisineRecipeView = Readonly<{ recipeId: CuisineRecipeId }>;

export interface CraftingQuery {
  getFoodStatus(characterId: CharacterId): FoodStatusView | undefined;
  canPrepareFood(characterId: CharacterId, onDay: WorldDay): boolean;
  listCraftableRecipes(characterId: CharacterId, cityId: CityId): CraftingRecipeView[];
  listCookableCuisine(characterId: CharacterId): CuisineRecipeView[];
}

// ── §4 玩家 Game Command payload ────────────────────────────────────────
// doc 以表格描述；欄位依前置條件/結果語意推導（見交接報告）。
export type StartCraftingCommand = Readonly<{
  type: 'startCrafting';
  characterId: CharacterId;
  recipeId: CraftingRecipeId;
  ingredientItemIds: ItemInstanceId[];
}>;

export type CookCuisineCommand = Readonly<{
  type: 'cookCuisine';
  characterId: CharacterId;
  recipeId: CuisineRecipeId;
  ingredientItemIds: ItemInstanceId[];
}>;

export type EatRestaurantMealCommand = Readonly<{
  type: 'eatRestaurantMeal';
  characterId: CharacterId;
  cityId: CityId;
  mealVariantId: RestaurantMealVariantId;
}>;

export type CraftingGameCommand =
  | StartCraftingCommand
  | CookCuisineCommand
  | EatRestaurantMealCommand;

// npcCuisineDecisionDue：Crafting 的每日 Job（無專屬 payload；由 Scheduler 信封承載 dueDay）。
export type NpcCuisineDecisionDueJobPayload = Readonly<Record<string, never>>;

// ── §5 輸出事件 payload ─────────────────────────────────────────────────
export type CraftingCompletedEvent = Readonly<{
  type: 'CraftingCompleted';
  characterId: CharacterId;
  recipeId: CraftingRecipeId;
  outcome: 'succeeded' | 'failed';
  outputItemIds: ItemInstanceId[];
  quality?: CraftQuality;
  experienceRuleId: ExperienceAwardRuleId;
}>;

export type FoodStatusChangedEvent = Readonly<{
  type: 'FoodStatusChanged';
  characterId: CharacterId;
  state: 'applied' | 'expired';
  source: FoodStatusSource;
  expiresOnDay?: WorldDay;
}>;

export type CuisineConsumedEvent = Readonly<{
  type: 'CuisineConsumed';
  characterId: CharacterId;
  source: 'selfCooked' | 'restaurant';
  recipeId: CuisineRecipeId;
  experienceRuleId: ExperienceAwardRuleId;
  experienceMultiplier: number;
}>;

export type CraftingDomainEvent =
  | CraftingCompletedEvent
  | FoodStatusChangedEvent
  | CuisineConsumedEvent;
