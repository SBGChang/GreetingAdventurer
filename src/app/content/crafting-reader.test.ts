// app/content/crafting-reader.test.ts
// 證明 data-runtime → CraftingDefinitionReader 的 adapter 路徑：由記憶體內 content pack 建
// DefinitionRegistry → createCraftingDefinitionReader，各 getter 回傳正確投影；未知 id 與跨 kind
// 存取明確拋錯；壞內容（缺 characterStatusId / 缺 originCultureId）不被靜默補值。
//
// 這裡刻意沒有端到端案例：crafting 目前只有 foodStatusExpiry 一項能力閉合，Session 的 assembler
// 還沒有 crafting Slice 可接（Composition 是整合者的檔）。單元層已能證明 adapter 型別與投影正確。

import type { ContentPackId, DefinitionId } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import {
  AFFIX_MEAT,
  AFFIX_ORE,
  CULTURE_ID,
  CITY_ID,
  EFFECT_BASE,
  EFFECT_TIER_1,
  FOOD_AFFIX_ID,
  ITEM_DEF_ORE,
  ITEM_DEF_SWORD,
  NPC_CUISINE_RULE_ID,
  QUALITY_RESOLVER,
  QUALITY_RULE_ID,
  RECIPE_POTION,
  RECIPE_STEW,
  RECIPE_SWORD,
  RESTAURANT_MENU_ID,
  STATUS_BASE,
  TAG_ORE,
} from '../../modules/crafting/fixtures';

import { CRAFTING_DEFINITION_KINDS, createCraftingDefinitionReader } from './crafting-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PACK = 'pack:crafting-bringup' as ContentPackId;

// 壞內容用的 id（只在本檔存在，不進 fixtures）。
const EFFECT_WITHOUT_STATUS = 'effect-no-status';
const ITEM_WITHOUT_CULTURE = 'itemdef-no-culture';

function def(id: string, kind: string, data: Record<string, unknown>): ContentDefinition {
  return {
    id: id as DefinitionId,
    kind,
    schemaVersion: 1,
    packId: PACK,
    enabled: true,
    sourcePath: `mem://${kind}/${id}`,
    data: data as ContentDefinition['data'],
  };
}

function craftingDefinitions(): readonly ContentDefinition[] {
  return [
    def(String(RECIPE_SWORD), CRAFTING_DEFINITION_KINDS.craftingRecipe, {
      originCultureId: String(CULTURE_ID),
      outputKind: 'equipment',
      outputDefinitionId: String(ITEM_DEF_SWORD),
      outputRarity: 'fine',
      requiredMasteries: [{ masteryId: 'mastery-smith', minLevel: 3 }],
      requiredFacilityKind: 'equipmentShop',
      craftingDurationDays: 2,
      ingredientSlots: [
        { slotId: 'slot-main', acceptedMaterialTagIds: [String(TAG_ORE)], quantity: 2, contributesEquipmentAffix: true },
      ],
      craftingExperienceRuleId: 'exp-craft',
      outcomeResolverId: 'resolver-craft-outcome',
      qualityRuleId: String(QUALITY_RULE_ID),
    }),
    def(String(RECIPE_POTION), CRAFTING_DEFINITION_KINDS.craftingRecipe, {
      originCultureId: String(CULTURE_ID),
      outputKind: 'consumable',
      outputDefinitionId: 'itemdef-potion',
      requiredMasteries: [],
      requiredFacilityKind: 'itemShop',
      craftingDurationDays: 1,
      ingredientSlots: [],
      craftingExperienceRuleId: 'exp-craft',
      outcomeResolverId: 'resolver-craft-outcome',
      qualityRuleId: String(QUALITY_RULE_ID),
      consumableYieldResolverId: 'resolver-consumable-yield',
    }),
    def(String(QUALITY_RULE_ID), CRAFTING_DEFINITION_KINDS.craftQualityRule, {
      resolverId: String(QUALITY_RESOLVER),
    }),
    def(String(AFFIX_ORE), CRAFTING_DEFINITION_KINDS.materialAffix, {
      compatibleOutputKinds: ['equipment'],
      tier: 2,
    }),
    def(String(AFFIX_MEAT), CRAFTING_DEFINITION_KINDS.materialAffix, {
      compatibleOutputKinds: ['cuisine'],
      foodAffixId: String(FOOD_AFFIX_ID),
      tier: 3,
    }),
    def(String(RECIPE_STEW), CRAFTING_DEFINITION_KINDS.cuisineRecipe, {
      originCultureId: String(CULTURE_ID),
      requiredMasteries: [{ masteryId: 'mastery-cook', minLevel: 2 }],
      ingredientSlots: [{ slotId: 'slot-food', acceptedMaterialTagIds: ['tag-meat'], quantity: 1 }],
      baseFoodEffectIds: [String(EFFECT_BASE)],
      foodStatusDurationDays: 3,
      cookingExperienceRuleId: 'exp-cook',
      foodAffixTierResolverId: 'resolver-food-affix-tier',
      restaurantBaseVariantId: 'meal-variant-1',
      restaurantExperienceMultiplier: 1 / 3,
    }),
    def(String(FOOD_AFFIX_ID), CRAFTING_DEFINITION_KINDS.foodAffix, {
      effectByTier: {
        1: String(EFFECT_TIER_1),
        2: 'effect-savory-2',
        3: 'effect-savory-3',
        4: 'effect-savory-4',
        5: 'effect-savory-5',
      },
    }),
    def(String(RESTAURANT_MENU_ID), CRAFTING_DEFINITION_KINDS.restaurantMenu, {
      cityId: String(CITY_ID),
      entries: [{ mealVariantId: 'meal-variant-1', cuisineRecipeId: String(RECIPE_STEW), priceRuleId: 'price-meal' }],
    }),
    def(String(NPC_CUISINE_RULE_ID), CRAFTING_DEFINITION_KINDS.npcCuisineDecisionRule, {
      selfCookWeightResolverId: 'resolver-self-cook-weight',
      restaurantWeightResolverId: 'resolver-restaurant-weight',
    }),
    def(String(EFFECT_BASE), CRAFTING_DEFINITION_KINDS.effect, {
      characterStatusId: String(STATUS_BASE),
    }),
    def(EFFECT_WITHOUT_STATUS, CRAFTING_DEFINITION_KINDS.effect, {}),
    def(String(ITEM_DEF_ORE), CRAFTING_DEFINITION_KINDS.item, {
      originCultureId: String(CULTURE_ID),
      materialTagIds: [String(TAG_ORE)],
      materialAffixId: String(AFFIX_ORE),
    }),
    def(String(ITEM_DEF_SWORD), CRAFTING_DEFINITION_KINDS.item, {
      originCultureId: String(CULTURE_ID),
    }),
    def(ITEM_WITHOUT_CULTURE, CRAFTING_DEFINITION_KINDS.item, {}),
  ];
}

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-bringup',
  manifestHash: 'bringup',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'bringup' }],
};

function registry(): DefinitionRegistry {
  return createDefinitionRegistry(craftingDefinitions(), IDENTITY);
}

function throws(run: () => unknown): boolean {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'getCraftingRecipe：由 registry 投影出領域定義（header 取 registry 權威值 + 領域欄位取 data）',
    run: () => {
      const reader = createCraftingDefinitionReader(registry());
      const recipe = reader.getCraftingRecipe(RECIPE_SWORD);
      assert(String(recipe.id) === String(RECIPE_SWORD), 'id 應為 registry 權威值');
      assert(recipe.packId === PACK, 'packId 應取自 registry header');
      assert(recipe.enabled === true, 'enabled 應取自 registry header');
      assert(recipe.outputKind === 'equipment', `outputKind（實得 ${recipe.outputKind}）`);
      assert(recipe.craftingDurationDays === 2, `craftingDurationDays（實得 ${recipe.craftingDurationDays}）`);
      assert(recipe.ingredientSlots.length === 1, '素材槽內嵌於配方定義，不是獨立 kind');
      assert(recipe.ingredientSlots[0]!.contributesEquipmentAffix === true, '槽的貢獻旗標應原樣帶出');
      assert(String(recipe.qualityRuleId) === String(QUALITY_RULE_ID), 'qualityRuleId 應取自 data');
    },
  },
  {
    name: 'listCraftingRecipes / listCuisineRecipes：各自只列自己的 kind（Query 的配方池來源）',
    run: () => {
      const reader = createCraftingDefinitionReader(registry());
      const crafting = reader.listCraftingRecipes().map((r) => String(r.id)).sort();
      assert(
        crafting.join(',') === [String(RECIPE_POTION), String(RECIPE_SWORD)].sort().join(','),
        `listCraftingRecipes 應只有兩張製作配方（實得 ${crafting.join(',')}）`,
      );
      const cuisine = reader.listCuisineRecipes().map((r) => String(r.id));
      assert(cuisine.join(',') === String(RECIPE_STEW), `listCuisineRecipes 應只有食譜（實得 ${cuisine.join(',')}）`);
    },
  },
  {
    name: 'getCuisineRecipe：投影出餐館倍率與維持天數（倍率是資料，不是 Handler 常數）',
    run: () => {
      const reader = createCraftingDefinitionReader(registry());
      const recipe = reader.getCuisineRecipe(RECIPE_STEW);
      assert(recipe.foodStatusDurationDays === 3, `foodStatusDurationDays（實得 ${recipe.foodStatusDurationDays}）`);
      assert(
        Math.abs(recipe.restaurantExperienceMultiplier - 1 / 3) < 1e-12,
        `restaurantExperienceMultiplier（實得 ${recipe.restaurantExperienceMultiplier}）`,
      );
      assert(recipe.baseFoodEffectIds.length === 1, 'baseFoodEffectIds 應原樣帶出');
    },
  },
  {
    name: 'getMaterialAffix / getCraftQualityRule / getFoodAffix / getRestaurantMenu / getNpcCuisineDecisionRule',
    run: () => {
      const reader = createCraftingDefinitionReader(registry());
      const ore = reader.getMaterialAffix(AFFIX_ORE);
      assert(ore.compatibleOutputKinds.join(',') === 'equipment', `compatibleOutputKinds（實得 ${ore.compatibleOutputKinds.join(',')}）`);
      assert(ore.foodAffixId === undefined, 'equipment 專用素材詞條不應有 foodAffixId');
      const meat = reader.getMaterialAffix(AFFIX_MEAT);
      assert(String(meat.foodAffixId) === String(FOOD_AFFIX_ID), 'cuisine 素材詞條應指向 foodAffixId');

      assert(
        String(reader.getCraftQualityRule(QUALITY_RULE_ID).resolverId) === String(QUALITY_RESOLVER),
        '品質規則只帶 resolverId',
      );
      assert(
        String(reader.getFoodAffix(FOOD_AFFIX_ID).effectByTier[1]) === String(EFFECT_TIER_1),
        'effectByTier 的鍵域為 1..5',
      );
      assert(reader.getRestaurantMenu(RESTAURANT_MENU_ID).entries.length === 1, '餐館菜單條目應原樣帶出');
      assert(
        String(reader.getNpcCuisineDecisionRule(NPC_CUISINE_RULE_ID).selfCookWeightResolverId) ===
          'resolver-self-cook-weight',
        'NPC 決策規則的兩個 Resolver 應原樣帶出',
      );
    },
  },
  {
    name: 'getFoodEffect：Effect → CharacterStatus 的對照從內容讀出（清理清單 A1 的送出端對照）',
    run: () => {
      const reader = createCraftingDefinitionReader(registry());
      const effect = reader.getFoodEffect(EFFECT_BASE);
      assert(String(effect.id) === String(EFFECT_BASE), 'id 應為 registry 權威值');
      assert(
        String(effect.characterStatusId) === String(STATUS_BASE),
        `characterStatusId 應對照到角色狀態（實得 ${String(effect.characterStatusId)}）`,
      );
    },
  },
  {
    name: 'getFoodEffect：缺 characterStatusId 明確拋錯（不以 effectId 當 statusId 用）',
    run: () => {
      const reader = createCraftingDefinitionReader(registry());
      assert(
        throws(() => reader.getFoodEffect(EFFECT_WITHOUT_STATUS as never)),
        '缺對照欄位應拋錯，而不是回一個看起來合法的 statusId',
      );
    },
  },
  {
    name: 'getCraftingItemView：投影素材標籤／候選詞條／文化；沒有詞條的素材維持 undefined（零或一條）',
    run: () => {
      const reader = createCraftingDefinitionReader(registry());
      const ore = reader.getCraftingItemView(ITEM_DEF_ORE);
      assert(String(ore.itemDefinitionId) === String(ITEM_DEF_ORE), 'itemDefinitionId 應原樣帶回');
      assert(String(ore.originCultureId) === String(CULTURE_ID), 'originCultureId 應取自 data');
      assert(ore.materialTagIds !== undefined && ore.materialTagIds.length === 1, 'materialTagIds 應原樣帶出');
      assert(String(ore.materialAffixId) === String(AFFIX_ORE), 'materialAffixId 應原樣帶出');

      const sword = reader.getCraftingItemView(ITEM_DEF_SWORD);
      assert(sword.materialTagIds === undefined, '非素材不得被補上空標籤集合');
      assert(sword.materialAffixId === undefined, '沒有詞條的定義維持 undefined');
    },
  },
  {
    name: 'getCraftingItemView：缺 originCultureId 明確拋錯（成品文化一致性驗不了就不能繼續）',
    run: () => {
      const reader = createCraftingDefinitionReader(registry());
      assert(throws(() => reader.getCraftingItemView(ITEM_WITHOUT_CULTURE as never)), '缺文化應拋錯');
    },
  },
  {
    name: '未知 id 明確拋錯（不靜默回 undefined）',
    run: () => {
      const reader = createCraftingDefinitionReader(registry());
      assert(throws(() => reader.getCraftingRecipe('recipe-absent' as never)), '未知配方應拋錯');
      assert(throws(() => reader.getCuisineRecipe('cuisine-absent' as never)), '未知食譜應拋錯');
    },
  },
  {
    name: '跨 kind 存取明確拋錯（製作配方 reader 不得取到料理食譜）',
    run: () => {
      const reader = createCraftingDefinitionReader(registry());
      assert(throws(() => reader.getCraftingRecipe(RECIPE_STEW as never)), '跨 kind 存取應拋錯');
      assert(throws(() => reader.getCuisineRecipe(RECIPE_SWORD as never)), '反向亦應拋錯');
      assert(throws(() => reader.getFoodEffect(ITEM_DEF_ORE as never)), 'effect reader 不得取到 item 定義');
    },
  },
];

export function runTestResults(): readonly ReaderTestResult[] {
  return CASES.map((c) => {
    try {
      c.run();
      return { name: c.name, pass: true };
    } catch (e) {
      return { name: c.name, pass: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? ''}`).join('\n');
    throw new Error(`crafting-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
