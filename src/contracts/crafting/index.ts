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
  CharacterStatusDefinitionId,
  ModuleId,
  ScheduledJobBase,
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

  // 以下四筆是 doc §2 表格未列、但 §4 Query 與 §5 流程實作不下去而補的（見交接報告）。

  // `CraftingQuery.listCraftableRecipes` / `listCookableCuisine` 必須枚舉配方池：doc §197 明訂 NPC
  // Behavior「只向 CraftingQuery.listCraftableRecipes 取得目前合法的配方池」。只有 `get(id)` 的
  // Reader 無法回答「有哪些配方」，Query 就只能由呼叫端傳入 ID 清單——那等於把配方池搬出內容軌。
  listCraftingRecipes(): readonly CraftingRecipeDefinition[];
  listCuisineRecipes(): readonly CuisineRecipeDefinition[];

  // Effect → Character Status 的對照。清理清單 A1 把 `ApplyFoodStatusEffects` 的 payload 從
  // `effectIds` 改成 `statusIds`，理由是 Character 沒有能力做這層對照、Effect 定義的擁有者是 Crafting；
  // 對照因此必須由**送出端**（本模組）從資料讀出。少了這個 getter，送出端唯一能做的就是
  // `effectId as unknown as statusId`——那正是 A1 要移除的東西。
  getFoodEffect(id: EffectDefinitionId): FoodEffectDefinition;

  // 素材／成品的 Item Definition 窄化投影（Item Definition 由 inventory 擁有；此處只投影製作需要的
  // 三個事實）。用途：§2.1「成品文化必須與輸出 Item Definition 的 originCultureId 相同」的驗證、
  // 投入素材是否符合 `acceptedMaterialTagIds`、以及該素材提供哪一條候選 `materialAffixId`。
  getCraftingItemView(id: ItemDefinitionId): CraftingItemView;
}

// Effect 定義中「這個效果對應哪一個角色狀態」的那一面。
export type FoodEffectDefinition = DefinitionHeader<EffectDefinitionId> & {
  characterStatusId: CharacterStatusDefinitionId;
};

// yunhua_content.md §5：「每個素材恰有零或一條 materialAffixId。素材自身的文化不被投入配方後改寫；
// 成品文化由配方與輸出 Item Definition 固定。」因此 `materialAffixId` 缺席是合法內容（該素材不提供
// 詞條），不是壞資料；而 `originCultureId` 只用來驗證輸出定義，從不寫進成品。
export type CraftingItemView = Readonly<{
  itemDefinitionId: ItemDefinitionId;
  originCultureId: CultureId;
  materialTagIds?: readonly MaterialTagId[];
  materialAffixId?: MaterialAffixId;
}>;

export type EquipmentRarity = 'common' | 'fine' | 'epic' | 'legendary' | 'mythic';

export type CraftingRecipeDefinition = DefinitionHeader<CraftingRecipeId> & {
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
  // doc §2.2 具名了兩個 Resolver 但 §2 的 Schema 沒有欄位承載它們（見交接報告）：
  //   * 「Quality Rule 的結果只由 Consumable Yield Resolver 轉為同批材料的固定道具產量」
  //     → outputKind === 'consumable' 時必填；其餘 outputKind 不得出現。
  //   * 「tradeGood ... 品質只套用出售倍率」，而成品實體要帶
  //     ItemInstanceData.craftedTradeGood.saleMultiplierResolverId
  //     → outputKind === 'tradeGood' 時必填；其餘 outputKind 不得出現。
  consumableYieldResolverId?: ResolverId;
  tradeGoodSaleMultiplierResolverId?: ResolverId;
};

export type CraftingIngredientSlotDefinition = {
  slotId: CraftingIngredientSlotId; // 只需在所屬 CraftingRecipeDefinition 內唯一
  acceptedMaterialTagIds: MaterialTagId[];
  quantity: number;
  contributesEquipmentAffix: boolean;
};

export type MaterialAffixDefinition = DefinitionHeader<MaterialAffixId> & {
  compatibleOutputKinds: Array<'equipment' | 'cuisine'>;
  equipmentEffectRefs?: EquipmentSkillEffectRef[];
  foodAffixId?: FoodAffixId;
  tier: 1 | 2 | 3 | 4 | 5;
};

export type CraftQualityRuleDefinition = DefinitionHeader<CraftQualityRuleId> & {
  resolverId: ResolverId;
};

// §2.3 料理
export type CuisineRecipeDefinition = DefinitionHeader<CuisineRecipeId> & {
  originCultureId: CultureId;
  requiredMasteries: MasteryRequirement[];
  ingredientSlots: CuisineIngredientSlotDefinition[];
  baseFoodEffectIds: EffectDefinitionId[];
  foodStatusDurationDays: number;
  cookingExperienceRuleId: ExperienceAwardRuleId;
  foodAffixTierResolverId: ResolverId;
  restaurantBaseVariantId?: RestaurantMealVariantId;
  // 餐館基礎料理相對於同食譜自製料理的 MXP 倍率。doc §2.3／不變量 7 與
  // mastery_experience_economy_v1.md 都把目標值寫成 1/3——但倍率是**平衡量**（1/3 換成 1/4 只改平衡、
  // 不改結構），依 SKILL 一句話判準它是資料。Handler 只讀本欄位並原樣放進 CuisineConsumed；
  // 「恰為 1/3」由內容驗證器守，不由 Handler 寫死。
  restaurantExperienceMultiplier: number;
};

// CuisineIngredientSlotDefinition：doc 於 CuisineRecipeDefinition 引用但未給 Schema；
// 依 crafting 素材槽結構推導（見交接報告）。
export type CuisineIngredientSlotDefinition = {
  slotId: CraftingIngredientSlotId;
  acceptedMaterialTagIds: MaterialTagId[];
  quantity: number;
};

export type FoodAffixDefinition = DefinitionHeader<FoodAffixId> & {
  effectByTier: Record<1 | 2 | 3 | 4 | 5, EffectDefinitionId>;
};

export type RestaurantMenuDefinition = DefinitionHeader<RestaurantMenuId> & {
  cityId: CityId;
  entries: Array<{
    mealVariantId: RestaurantMealVariantId;
    cuisineRecipeId: CuisineRecipeId;
    priceRuleId: PriceRuleId;
  }>;
};

export type NpcCuisineDecisionRuleDefinition = DefinitionHeader<NpcCuisineDecisionRuleId> & {
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

// ── §3／§5 Scheduled Job ────────────────────────────────────────────────
// npcCuisineDecisionDue：Crafting 的每日 Job（無專屬 payload；由 Scheduler 信封承載 dueDay）。
export type NpcCuisineDecisionDueJobPayload = Readonly<Record<string, never>>;

export type NpcCuisineDecisionDueJob = ScheduledJobBase<
  'npcCuisineDecisionDue',
  ModuleId<'crafting'>,
  CharacterId,
  NpcCuisineDecisionDueJobPayload
>;

// foodStatusExpiry：doc §3 與 §5 的收斂流程都要求它（「排在 expiresOnDay + 1，且必須早於當日
// npcCuisineDecisionDue」→「移除 FoodStatus + ApplyFoodStatusEffects(remove) → FoodStatusChanged(expired)」），
// 但 §4 的表格只列了 npcCuisineDecisionDue，契約因此漏了這一筆。沒有它，FoodStatus 建立後永不失效，
// 不變量 1（至多一筆未到期 FoodStatus）就沒有解除點。
export type FoodStatusExpiryJobPayload = Readonly<Record<string, never>>;

// 過期判定用信封的 `expectedRevision`（＝建立當下的 FoodStatus.revision），不放進 payload：
// 舊 Job 對不上 revision 即為過期，不得誤刪之後建立的另一筆 FoodStatus。
export type FoodStatusExpiryJob = ScheduledJobBase<
  'foodStatusExpiry',
  ModuleId<'crafting'>,
  CharacterId,
  FoodStatusExpiryJobPayload
>;

export type CraftingScheduledJob = FoodStatusExpiryJob | NpcCuisineDecisionDueJob;

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
