// modules/crafting/fixtures.ts
// 最小 Fixture：三張製作配方（equipment／consumable／tradeGood）＋一張料理食譜，
// 加上決定性 stub Port（CraftingDefinitionReader / Progression / Inventory / City / Resolver）
// 與一站式 CraftingHandlerContext。
//
// 所有 stub 皆為決定性：沒有真 RNG、沒有時間來源。Resolver stub 的「擲骰」一律由顯式 cursor 推導，
// 並回傳 nextCursor = cursor + 1，好讓測試能同時斷言「同 cursor 同結果」與「cursor 逐次前進」。
// 正式路徑不得引用本檔（門禁：scripts/verify-runtime-discipline.ts）。

import type {
  CharacterId,
  CharacterStatusDefinitionId,
  CityId,
  ContentPackId,
  CraftQualityRuleId,
  CraftingAttemptId,
  CraftingIngredientSlotId,
  CraftingRecipeId,
  CuisineRecipeId,
  CultureId,
  EffectDefinitionId,
  ExperienceAwardRuleId,
  FoodAffixId,
  FreeActionId,
  ItemDefinitionId,
  ItemInstanceId,
  MasteryId,
  MaterialAffixId,
  MaterialTagId,
  NpcCuisineDecisionRuleId,
  ResolverId,
  RestaurantMealVariantId,
  RestaurantMenuId,
  Revision,
  RngCursor,
  RngStreamId,
  Seed,
  WorldDay,
} from '../../contracts/core';
import type {
  CraftQualityRuleDefinition,
  CraftingAttempt,
  CraftingDefinitionReader,
  CraftingItemView,
  CraftingRecipeDefinition,
  CraftingState,
  CuisineRecipeDefinition,
  FoodAffixDefinition,
  FoodEffectDefinition,
  FoodStatus,
  MaterialAffixDefinition,
  NpcCuisineDecisionRuleDefinition,
  RestaurantMenuDefinition,
} from '../../contracts/crafting';
import type { ItemInstanceView } from '../../contracts/inventory';
import type { MasteryRequirement } from '../../contracts/progression';

import type {
  CraftOutcomeDraft,
  CraftingCityPort,
  CraftingHandlerContext,
  CraftingInventoryPort,
  CraftingProgressionPort,
  CraftingResolverPort,
  MasteryLevelSnapshot,
} from './system';
import { CRAFT_QUALITY_LADDER, createCraftingState } from './state';

// ── ID 常數 ──────────────────────────────────────────────────────────────────

const PACK_ID = 'pack-test' as ContentPackId;

export const CULTURE_ID = 'culture-yunhua' as CultureId;
export const OTHER_CULTURE_ID = 'culture-other' as CultureId;
export const CITY_ID = 'city-1' as CityId;
export const CHARACTER_ID = 'char-1' as CharacterId;
export const OTHER_CHARACTER_ID = 'char-2' as CharacterId;

export const SMITH_MASTERY = 'mastery-smith' as MasteryId;
export const COOK_MASTERY = 'mastery-cook' as MasteryId;

export const CRAFT_EXP_RULE = 'exp-craft' as ExperienceAwardRuleId;
export const COOK_EXP_RULE = 'exp-cook' as ExperienceAwardRuleId;

export const OUTCOME_RESOLVER = 'resolver-craft-outcome' as ResolverId;
export const QUALITY_RESOLVER = 'resolver-craft-quality' as ResolverId;
export const YIELD_RESOLVER = 'resolver-consumable-yield' as ResolverId;
export const SALE_RESOLVER = 'resolver-trade-good-sale' as ResolverId;
export const TIER_RESOLVER = 'resolver-food-affix-tier' as ResolverId;
export const SELF_COOK_WEIGHT_RESOLVER = 'resolver-self-cook-weight' as ResolverId;
export const RESTAURANT_WEIGHT_RESOLVER = 'resolver-restaurant-weight' as ResolverId;

export const QUALITY_RULE_ID = 'quality-rule-1' as CraftQualityRuleId;
export const NPC_CUISINE_RULE_ID = 'npc-cuisine-rule-1' as NpcCuisineDecisionRuleId;
export const RESTAURANT_MENU_ID = 'restaurant-menu-1' as RestaurantMenuId;
export const MEAL_VARIANT_ID = 'meal-variant-1' as RestaurantMealVariantId;

export const TAG_ORE = 'tag-ore' as MaterialTagId;
export const TAG_MEAT = 'tag-meat' as MaterialTagId;

export const AFFIX_ORE = 'affix-ore' as MaterialAffixId;
export const AFFIX_MEAT = 'affix-meat' as MaterialAffixId;
export const AFFIX_PLAIN_ORE = 'affix-plain-ore' as MaterialAffixId;

export const FOOD_AFFIX_ID = 'food-affix-savory' as FoodAffixId;

export const EFFECT_BASE = 'effect-base-nutrition' as EffectDefinitionId;
export const EFFECT_TIER_1 = 'effect-savory-1' as EffectDefinitionId;
export const EFFECT_TIER_2 = 'effect-savory-2' as EffectDefinitionId;
export const EFFECT_TIER_3 = 'effect-savory-3' as EffectDefinitionId;
export const EFFECT_TIER_4 = 'effect-savory-4' as EffectDefinitionId;
export const EFFECT_TIER_5 = 'effect-savory-5' as EffectDefinitionId;

export const STATUS_BASE = 'status-well-fed' as CharacterStatusDefinitionId;
export const STATUS_TIER_1 = 'status-savory-1' as CharacterStatusDefinitionId;
export const STATUS_TIER_2 = 'status-savory-2' as CharacterStatusDefinitionId;
export const STATUS_TIER_3 = 'status-savory-3' as CharacterStatusDefinitionId;
export const STATUS_TIER_4 = 'status-savory-4' as CharacterStatusDefinitionId;
export const STATUS_TIER_5 = 'status-savory-5' as CharacterStatusDefinitionId;

export const ITEM_DEF_ORE = 'itemdef-ore' as ItemDefinitionId;
export const ITEM_DEF_MEAT = 'itemdef-meat' as ItemDefinitionId;
export const ITEM_DEF_NON_MATERIAL = 'itemdef-scroll' as ItemDefinitionId;
export const ITEM_DEF_SWORD = 'itemdef-sword' as ItemDefinitionId;
export const ITEM_DEF_POTION = 'itemdef-potion' as ItemDefinitionId;
export const ITEM_DEF_VASE = 'itemdef-vase' as ItemDefinitionId;
export const ITEM_DEF_FOREIGN_SWORD = 'itemdef-foreign-sword' as ItemDefinitionId;

export const ITEM_ORE_1 = 'item-ore-1' as ItemInstanceId;
export const ITEM_ORE_2 = 'item-ore-2' as ItemInstanceId;
export const ITEM_ORE_3 = 'item-ore-3' as ItemInstanceId;
export const ITEM_MEAT_1 = 'item-meat-1' as ItemInstanceId;
export const ITEM_MEAT_2 = 'item-meat-2' as ItemInstanceId;
export const ITEM_SCROLL_1 = 'item-scroll-1' as ItemInstanceId;

export const SLOT_MAIN = 'slot-main' as CraftingIngredientSlotId;
export const SLOT_TRIM = 'slot-trim' as CraftingIngredientSlotId;
export const SLOT_FOOD = 'slot-food' as CraftingIngredientSlotId;

export const RECIPE_SWORD = 'recipe-sword' as CraftingRecipeId;
export const RECIPE_POTION = 'recipe-potion' as CraftingRecipeId;
export const RECIPE_VASE = 'recipe-vase' as CraftingRecipeId;
export const RECIPE_FOREIGN_SWORD = 'recipe-foreign-sword' as CraftingRecipeId;
export const RECIPE_STEW = 'cuisine-stew' as CuisineRecipeId;

export const ATTEMPT_ID = 'attempt-1' as CraftingAttemptId;
export const FREE_ACTION_ID = 'free-action-1' as FreeActionId;

// ── Definition ───────────────────────────────────────────────────────────────

function header<TId>(id: TId) {
  return { id, schemaVersion: 1, packId: PACK_ID, enabled: true } as const;
}

const SMITH_REQUIREMENT: MasteryRequirement[] = [{ masteryId: SMITH_MASTERY, minLevel: 3 }];
const COOK_REQUIREMENT: MasteryRequirement[] = [{ masteryId: COOK_MASTERY, minLevel: 2 }];

export const RECIPE_SWORD_DEF: CraftingRecipeDefinition = {
  ...header(RECIPE_SWORD),
  originCultureId: CULTURE_ID,
  outputKind: 'equipment',
  outputDefinitionId: ITEM_DEF_SWORD,
  outputRarity: 'fine',
  requiredMasteries: SMITH_REQUIREMENT,
  requiredFacilityKind: 'equipmentShop',
  craftingDurationDays: 2,
  ingredientSlots: [
    { slotId: SLOT_MAIN, acceptedMaterialTagIds: [TAG_ORE], quantity: 2, contributesEquipmentAffix: true },
    { slotId: SLOT_TRIM, acceptedMaterialTagIds: [TAG_ORE], quantity: 1, contributesEquipmentAffix: false },
  ],
  craftingExperienceRuleId: CRAFT_EXP_RULE,
  outcomeResolverId: OUTCOME_RESOLVER,
  qualityRuleId: QUALITY_RULE_ID,
};

export const RECIPE_POTION_DEF: CraftingRecipeDefinition = {
  ...header(RECIPE_POTION),
  originCultureId: CULTURE_ID,
  outputKind: 'consumable',
  outputDefinitionId: ITEM_DEF_POTION,
  requiredMasteries: SMITH_REQUIREMENT,
  requiredFacilityKind: 'itemShop',
  craftingDurationDays: 1,
  ingredientSlots: [
    { slotId: SLOT_MAIN, acceptedMaterialTagIds: [TAG_ORE], quantity: 1, contributesEquipmentAffix: true },
  ],
  craftingExperienceRuleId: CRAFT_EXP_RULE,
  outcomeResolverId: OUTCOME_RESOLVER,
  qualityRuleId: QUALITY_RULE_ID,
  consumableYieldResolverId: YIELD_RESOLVER,
};

export const RECIPE_VASE_DEF: CraftingRecipeDefinition = {
  ...header(RECIPE_VASE),
  originCultureId: CULTURE_ID,
  outputKind: 'tradeGood',
  outputDefinitionId: ITEM_DEF_VASE,
  requiredMasteries: SMITH_REQUIREMENT,
  requiredFacilityKind: 'itemShop',
  craftingDurationDays: 1,
  ingredientSlots: [
    { slotId: SLOT_MAIN, acceptedMaterialTagIds: [TAG_ORE], quantity: 1, contributesEquipmentAffix: true },
  ],
  craftingExperienceRuleId: CRAFT_EXP_RULE,
  outcomeResolverId: OUTCOME_RESOLVER,
  qualityRuleId: QUALITY_RULE_ID,
  tradeGoodSaleMultiplierResolverId: SALE_RESOLVER,
};

// 輸出 Item Definition 的文化與配方文化不一致（§2.1 應被擋下）。
export const RECIPE_FOREIGN_SWORD_DEF: CraftingRecipeDefinition = {
  ...RECIPE_SWORD_DEF,
  ...header(RECIPE_FOREIGN_SWORD),
  outputDefinitionId: ITEM_DEF_FOREIGN_SWORD,
};

export const RECIPE_STEW_DEF: CuisineRecipeDefinition = {
  ...header(RECIPE_STEW),
  originCultureId: CULTURE_ID,
  requiredMasteries: COOK_REQUIREMENT,
  ingredientSlots: [{ slotId: SLOT_FOOD, acceptedMaterialTagIds: [TAG_MEAT], quantity: 1 }],
  baseFoodEffectIds: [EFFECT_BASE],
  foodStatusDurationDays: 3,
  cookingExperienceRuleId: COOK_EXP_RULE,
  foodAffixTierResolverId: TIER_RESOLVER,
  restaurantBaseVariantId: MEAL_VARIANT_ID,
  restaurantExperienceMultiplier: 1 / 3,
};

export const QUALITY_RULE_DEF: CraftQualityRuleDefinition = {
  ...header(QUALITY_RULE_ID),
  resolverId: QUALITY_RESOLVER,
};

export const AFFIX_ORE_DEF: MaterialAffixDefinition = {
  ...header(AFFIX_ORE),
  compatibleOutputKinds: ['equipment'],
  tier: 2,
};

export const AFFIX_MEAT_DEF: MaterialAffixDefinition = {
  ...header(AFFIX_MEAT),
  compatibleOutputKinds: ['cuisine'],
  foodAffixId: FOOD_AFFIX_ID,
  tier: 2,
};

// 宣稱可用於 cuisine 卻沒有 foodAffixId：壞內容，應被 Handler 拒絕。
export const AFFIX_BROKEN_CUISINE_DEF: MaterialAffixDefinition = {
  ...header(AFFIX_PLAIN_ORE),
  compatibleOutputKinds: ['cuisine'],
  tier: 1,
};

export const FOOD_AFFIX_DEF: FoodAffixDefinition = {
  ...header(FOOD_AFFIX_ID),
  effectByTier: {
    1: EFFECT_TIER_1,
    2: EFFECT_TIER_2,
    3: EFFECT_TIER_3,
    4: EFFECT_TIER_4,
    5: EFFECT_TIER_5,
  },
};

export const RESTAURANT_MENU_DEF: RestaurantMenuDefinition = {
  ...header(RESTAURANT_MENU_ID),
  cityId: CITY_ID,
  entries: [],
};

export const NPC_CUISINE_RULE_DEF: NpcCuisineDecisionRuleDefinition = {
  ...header(NPC_CUISINE_RULE_ID),
  selfCookWeightResolverId: SELF_COOK_WEIGHT_RESOLVER,
  restaurantWeightResolverId: RESTAURANT_WEIGHT_RESOLVER,
};

export const EFFECT_TO_STATUS: ReadonlyArray<readonly [EffectDefinitionId, CharacterStatusDefinitionId]> = [
  [EFFECT_BASE, STATUS_BASE],
  [EFFECT_TIER_1, STATUS_TIER_1],
  [EFFECT_TIER_2, STATUS_TIER_2],
  [EFFECT_TIER_3, STATUS_TIER_3],
  [EFFECT_TIER_4, STATUS_TIER_4],
  [EFFECT_TIER_5, STATUS_TIER_5],
];

export const ITEM_VIEWS: ReadonlyArray<CraftingItemView> = [
  { itemDefinitionId: ITEM_DEF_ORE, originCultureId: CULTURE_ID, materialTagIds: [TAG_ORE], materialAffixId: AFFIX_ORE },
  { itemDefinitionId: ITEM_DEF_MEAT, originCultureId: CULTURE_ID, materialTagIds: [TAG_MEAT], materialAffixId: AFFIX_MEAT },
  { itemDefinitionId: ITEM_DEF_NON_MATERIAL, originCultureId: CULTURE_ID },
  { itemDefinitionId: ITEM_DEF_SWORD, originCultureId: CULTURE_ID },
  { itemDefinitionId: ITEM_DEF_POTION, originCultureId: CULTURE_ID },
  { itemDefinitionId: ITEM_DEF_VASE, originCultureId: CULTURE_ID },
  { itemDefinitionId: ITEM_DEF_FOREIGN_SWORD, originCultureId: OTHER_CULTURE_ID },
];

// ── Stub：CraftingDefinitionReader ───────────────────────────────────────────

export function stubDefinitionReader(
  overrides: Readonly<{
    craftingRecipes?: readonly CraftingRecipeDefinition[];
    cuisineRecipes?: readonly CuisineRecipeDefinition[];
    materialAffixes?: readonly MaterialAffixDefinition[];
    itemViews?: readonly CraftingItemView[];
  }> = {},
): CraftingDefinitionReader {
  const craftingRecipes = overrides.craftingRecipes ?? [
    RECIPE_SWORD_DEF,
    RECIPE_POTION_DEF,
    RECIPE_VASE_DEF,
    RECIPE_FOREIGN_SWORD_DEF,
  ];
  const cuisineRecipes = overrides.cuisineRecipes ?? [RECIPE_STEW_DEF];
  const materialAffixes = overrides.materialAffixes ?? [
    AFFIX_ORE_DEF,
    AFFIX_MEAT_DEF,
    AFFIX_BROKEN_CUISINE_DEF,
  ];
  const itemViews = overrides.itemViews ?? ITEM_VIEWS;

  const find = <T>(items: readonly T[], match: (x: T) => boolean, label: string, id: unknown): T => {
    const found = items.find(match);
    if (found === undefined) throw new Error(`stub reader: unknown ${label} "${String(id)}"`);
    return found;
  };

  return {
    getCraftingRecipe: (id) => find(craftingRecipes, (r) => r.id === id, 'crafting-recipe', id),
    listCraftingRecipes: () => craftingRecipes,
    getMaterialAffix: (id) => find(materialAffixes, (a) => a.id === id, 'material-affix', id),
    getCraftQualityRule: (id) => {
      if (id !== QUALITY_RULE_ID) throw new Error(`stub reader: unknown craft-quality-rule "${String(id)}"`);
      return QUALITY_RULE_DEF;
    },
    getCuisineRecipe: (id) => find(cuisineRecipes, (r) => r.id === id, 'cuisine-recipe', id),
    listCuisineRecipes: () => cuisineRecipes,
    getFoodAffix: (id) => {
      if (id !== FOOD_AFFIX_ID) throw new Error(`stub reader: unknown food-affix "${String(id)}"`);
      return FOOD_AFFIX_DEF;
    },
    getRestaurantMenu: (id) => {
      if (id !== RESTAURANT_MENU_ID) throw new Error(`stub reader: unknown restaurant-menu "${String(id)}"`);
      return RESTAURANT_MENU_DEF;
    },
    getNpcCuisineDecisionRule: (id) => {
      if (id !== NPC_CUISINE_RULE_ID) {
        throw new Error(`stub reader: unknown npc-cuisine-decision-rule "${String(id)}"`);
      }
      return NPC_CUISINE_RULE_DEF;
    },
    getFoodEffect: (id): FoodEffectDefinition => {
      const pair = EFFECT_TO_STATUS.find(([effectId]) => effectId === id);
      if (pair === undefined) throw new Error(`stub reader: unknown effect "${String(id)}"`);
      return { ...header(id), characterStatusId: pair[1] };
    },
    getCraftingItemView: (id) => find(itemViews, (v) => v.itemDefinitionId === id, 'item', id),
  };
}

// ── Stub：消費 Port ─────────────────────────────────────────────────────────

export function stubProgression(
  opts: Readonly<{
    learnedRecipeIds?: readonly string[];
    meetsRequirements?: boolean;
    masteryLevels?: Readonly<Record<string, number>>;
  }> = {},
): CraftingProgressionPort {
  const learned = new Set(
    (opts.learnedRecipeIds ?? [RECIPE_SWORD, RECIPE_POTION, RECIPE_VASE, RECIPE_STEW]).map(String),
  );
  const meets = opts.meetsRequirements !== false;
  const levels = opts.masteryLevels ?? { [String(SMITH_MASTERY)]: 5, [String(COOK_MASTERY)]: 4 };
  return {
    hasLearnedRecipe: (_characterId, recipeId) => learned.has(String(recipeId)),
    meetsMasteryRequirements: () => meets,
    getMasteryLevel: (_characterId, masteryId) => {
      const level = levels[String(masteryId)];
      if (level === undefined) throw new Error(`stub progression: no level for "${String(masteryId)}"`);
      return level;
    },
  };
}

export function itemView(
  input: Readonly<{
    itemId: ItemInstanceId;
    definitionId: ItemDefinitionId;
    quantity?: number;
    ownerCharacterId?: CharacterId;
    reservation?: ItemInstanceView['reservation'];
    state?: ItemInstanceView['state'];
    location?: ItemInstanceView['location'];
  }>,
): ItemInstanceView {
  const owner = input.ownerCharacterId ?? CHARACTER_ID;
  return {
    itemId: input.itemId,
    definitionId: input.definitionId,
    quantity: input.quantity ?? 1,
    ownerCharacterId: owner,
    location: input.location ?? { kind: 'characterBag', characterId: owner },
    ...(input.reservation === undefined ? {} : { reservation: input.reservation }),
    state: input.state ?? 'active',
    revision: 0 as Revision,
  };
}

export function defaultItems(): readonly ItemInstanceView[] {
  return [
    itemView({ itemId: ITEM_ORE_1, definitionId: ITEM_DEF_ORE, quantity: 2 }),
    itemView({ itemId: ITEM_ORE_2, definitionId: ITEM_DEF_ORE }),
    itemView({ itemId: ITEM_ORE_3, definitionId: ITEM_DEF_ORE }),
    itemView({ itemId: ITEM_MEAT_1, definitionId: ITEM_DEF_MEAT }),
    itemView({ itemId: ITEM_MEAT_2, definitionId: ITEM_DEF_MEAT }),
    itemView({ itemId: ITEM_SCROLL_1, definitionId: ITEM_DEF_NON_MATERIAL }),
  ];
}

export function stubInventory(items: readonly ItemInstanceView[] = defaultItems()): CraftingInventoryPort {
  return { getItem: (itemId) => items.find((i) => i.itemId === itemId) };
}

export function stubCity(
  opts: Readonly<{ facilityAvailable?: boolean; restaurantAvailable?: boolean }> = {},
): CraftingCityPort {
  return {
    isFacilityAvailable: () => opts.facilityAvailable !== false,
    canUseRestaurant: () => opts.restaurantAvailable !== false,
  };
}

// ── Stub：Resolver（決定性；以顯式 cursor 推導結果並前進 1）─────────────────

export type ResolverCallLog = Readonly<{
  outcomeCursors: number[];
  qualityCursors: number[];
  tierCursors: number[];
  npcCursors: number[];
}>;

export function stubResolvers(
  opts: Readonly<{
    log?: ResolverCallLog;
    outcome?: (input: Readonly<{ reservedIngredientItemIds: readonly ItemInstanceId[] }>) => CraftOutcomeDraft;
    quality?: (cursor: number) => string;
    tier?: (cursor: number) => number;
    consumableYield?: (input: Readonly<{ masteryLevels: readonly MasteryLevelSnapshot[] }>) => number;
    npcChoice?: (cursor: number) => 'selfCooked' | 'restaurant';
  }> = {},
): CraftingResolverPort {
  const bump = (cursor: RngCursor): RngCursor => ((cursor as unknown as number) + 1) as RngCursor;
  const asNumber = (cursor: RngCursor): number => cursor as unknown as number;

  return {
    resolveCraftOutcome: (input) => {
      opts.log?.outcomeCursors.push(asNumber(input.rngContext.cursor));
      const value =
        opts.outcome === undefined
          ? {
              outcome: 'succeeded' as const,
              consumedIngredientItemIds: input.reservedIngredientItemIds,
              returnedIngredientItemIds: [],
            }
          : opts.outcome(input);
      return { value, nextCursor: bump(input.rngContext.cursor) };
    },
    resolveCraftQuality: (input) => {
      const cursor = asNumber(input.rngContext.cursor);
      opts.log?.qualityCursors.push(cursor);
      const value =
        opts.quality === undefined
          ? CRAFT_QUALITY_LADDER[cursor % CRAFT_QUALITY_LADDER.length]!
          : opts.quality(cursor);
      return { value, nextCursor: bump(input.rngContext.cursor) };
    },
    resolveConsumableYield: (input) =>
      opts.consumableYield === undefined
        ? input.masteryLevels.reduce((acc, m) => acc + m.level, 1)
        : opts.consumableYield(input),
    resolveFoodAffixTier: (input) => {
      const cursor = asNumber(input.rngContext.cursor);
      opts.log?.tierCursors.push(cursor);
      const value = opts.tier === undefined ? (cursor % 5) + 1 : opts.tier(cursor);
      return { value, nextCursor: bump(input.rngContext.cursor) };
    },
    resolveNpcCuisineChoice: (input) => {
      const cursor = asNumber(input.rngContext.cursor);
      opts.log?.npcCursors.push(cursor);
      const value =
        opts.npcChoice === undefined
          ? !input.restaurantAvailable || cursor % 2 === 0
            ? ('selfCooked' as const)
            : ('restaurant' as const)
          : opts.npcChoice(cursor);
      return { value, nextCursor: bump(input.rngContext.cursor) };
    },
  };
}

export function emptyResolverLog(): ResolverCallLog {
  return { outcomeCursors: [], qualityCursors: [], tierCursors: [], npcCursors: [] };
}

// ── Context / State ─────────────────────────────────────────────────────────

export function stubRngContext(cursor = 0): Readonly<{ worldSeed: Seed; streamId: RngStreamId; cursor: RngCursor }> {
  return {
    worldSeed: 'seed-test' as Seed,
    streamId: 'rng-crafting' as RngStreamId,
    cursor: cursor as RngCursor,
  };
}

export function makeContext(overrides: Partial<CraftingHandlerContext> = {}): CraftingHandlerContext {
  return {
    worldDay: overrides.worldDay ?? (100 as WorldDay),
    definitions: overrides.definitions ?? stubDefinitionReader(),
    progression: overrides.progression ?? stubProgression(),
    inventory: overrides.inventory ?? stubInventory(),
    city: overrides.city ?? stubCity(),
    resolvers: overrides.resolvers ?? stubResolvers(),
    rngContext: overrides.rngContext ?? stubRngContext(),
  };
}

export function fixtureFoodStatus(
  overrides: Partial<FoodStatus> = {},
): FoodStatus {
  return {
    characterId: overrides.characterId ?? CHARACTER_ID,
    source: overrides.source ?? { kind: 'selfCooked', recipeId: RECIPE_STEW },
    originCultureId: overrides.originCultureId ?? CULTURE_ID,
    foodAffixes: overrides.foodAffixes ?? [{ foodAffixId: FOOD_AFFIX_ID, tier: 2 }],
    appliedEffectIds: overrides.appliedEffectIds ?? [EFFECT_BASE, EFFECT_TIER_2],
    startedOnDay: overrides.startedOnDay ?? (100 as WorldDay),
    expiresOnDay: overrides.expiresOnDay ?? (102 as WorldDay),
    revision: overrides.revision ?? (0 as Revision),
  };
}

export function fixtureAttempt(overrides: Partial<CraftingAttempt> = {}): CraftingAttempt {
  return {
    craftingAttemptId: overrides.craftingAttemptId ?? ATTEMPT_ID,
    freeActionId: overrides.freeActionId ?? FREE_ACTION_ID,
    characterId: overrides.characterId ?? CHARACTER_ID,
    recipeId: overrides.recipeId ?? RECIPE_SWORD,
    ingredientItemIds: overrides.ingredientItemIds ?? [ITEM_ORE_1, ITEM_ORE_2, ITEM_ORE_3],
    startedOnDay: overrides.startedOnDay ?? (98 as WorldDay),
    status: overrides.status ?? 'scheduled',
    ...(overrides.result === undefined ? {} : { result: overrides.result }),
    revision: overrides.revision ?? (0 as Revision),
  };
}

export function fixtureCraftingState(
  input: Readonly<{
    foodStatuses?: readonly FoodStatus[];
    craftingAttempts?: readonly CraftingAttempt[];
  }> = {},
): CraftingState {
  return createCraftingState(input);
}

// 已保留給某次 Attempt 的素材（結算時 selectInheritedAffixes 以 reservation 判定歸屬）。
export function reservedOreItems(
  attemptId: CraftingAttemptId = ATTEMPT_ID,
  recipeId: CraftingRecipeId = RECIPE_SWORD,
): readonly ItemInstanceView[] {
  const reserve = (slotId: CraftingIngredientSlotId, quantity: number): ItemInstanceView['reservation'] => ({
    kind: 'craftingInput',
    ownerId: CHARACTER_ID,
    reservedQuantity: quantity,
    craftingAttemptId: attemptId,
    recipeId,
    slotId,
  });
  return [
    itemView({ itemId: ITEM_ORE_1, definitionId: ITEM_DEF_ORE, reservation: reserve(SLOT_MAIN, 1) }),
    itemView({ itemId: ITEM_ORE_2, definitionId: ITEM_DEF_ORE, reservation: reserve(SLOT_MAIN, 1) }),
    itemView({ itemId: ITEM_ORE_3, definitionId: ITEM_DEF_ORE, reservation: reserve(SLOT_TRIM, 1) }),
  ];
}
