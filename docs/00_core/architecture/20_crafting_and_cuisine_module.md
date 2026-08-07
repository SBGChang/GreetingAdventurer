# Crafting & Cuisine 模組契約

> **模組 ID：** `crafting`
>
> **依賴：** 共用核心契約、Progression／Inventory／City／Team／Character 的公開 Query；不直接寫入任何相依模組 State。
>
> **責任：** 擁有配方的實際製作規則、素材詞條轉化、製作品質、料理 FoodStatus、餐館基礎料理與 NPC 料理決策。Progression 只判定角色是否學會配方與持有對應 Mastery；Inventory 只擁有素材與成品實體。

---

## 1. 邊界與唯一真相

```ts
type CraftingState = {
  foodStatuses: Record<CharacterId, FoodStatus | undefined>;
  craftingAttempts: Record<CraftingAttemptId, CraftingAttempt>;
};
```

| 事實 | 唯一所有者 | Crafting 的角色 |
|---|---|---|
| 食材、素材、成品與裝備實體 | inventory | 取得候選素材快照，要求原子消耗／產出。 |
| 已學配方與各生活 Mastery | progression | 查詢資格；接收已結算的製作／料理 MXP。 |
| 設施可用性、餐館基礎菜單與價格 | city | 查詢；不自己保存第二份餐館或設施 State。 |
| 個人自由活動與耗時 | team | 裝備／工藝製作完成時以 FreeActionCompleted 呼叫；料理不建立 FreeAction。 |
| 角色生命與暫時效果 | character | 以 FoodStatus 變更事件要求效果 Workflow 套用／移除。 |
| NPC 是否進行料理 | crafting | 只在無 FoodStatus 的日結算骰「自製／餐館」，不屬於 NPC FreeAction 池。 |

## 2. 靜態資料契約

```ts
interface CraftingDefinitionReader {
  getCraftingRecipe(id: CraftingRecipeId): CraftingRecipeDefinition;
  getMaterialAffix(id: MaterialAffixId): MaterialAffixDefinition;
  getCraftQualityRule(id: CraftQualityRuleId): CraftQualityRuleDefinition;
  getCuisineRecipe(id: CuisineRecipeId): CuisineRecipeDefinition;
  getFoodAffix(id: FoodAffixId): FoodAffixDefinition;
  getRestaurantMenu(id: RestaurantMenuId): RestaurantMenuDefinition;
  getNpcCuisineDecisionRule(id: NpcCuisineDecisionRuleId): NpcCuisineDecisionRuleDefinition;
}

type EquipmentRarity = 'common' | 'fine' | 'epic' | 'legendary' | 'mythic';

type CraftingRecipeDefinition = DefinitionHeader & {
  originCultureId: CultureId;
  outputKind: 'equipment' | 'consumable' | 'tradeGood';
  outputDefinitionId: ItemDefinitionId;
  outputRarity?: EquipmentRarity; // 僅 equipment，基礎係數預算的唯一來源
  requiredMasteries: MasteryRequirement[];
  requiredFacilityKind: FacilityKind;
  craftingDurationDays: number; // 製作占用的自由活動日數；equipment／consumable／tradeGood 均至少 1 日
  ingredientSlots: CraftingIngredientSlotDefinition[];
  craftingExperienceRuleId: ExperienceAwardRuleId;
  outcomeResolverId: ResolverId; // 成功／失敗與失敗時素材去向；精確公式待定
  qualityRuleId: CraftQualityRuleId;
};

type CraftingIngredientSlotDefinition = {
  slotId: string;
  acceptedMaterialTagIds: MaterialTagId[];
  quantity: number;
  contributesEquipmentAffix: boolean;
};

type MaterialAffixDefinition = DefinitionHeader & {
  compatibleOutputKinds: Array<'equipment' | 'cuisine'>;
  equipmentEffectRefs?: EquipmentSkillEffectRef[];
  foodAffixId?: FoodAffixId;
  tier: 1 | 2 | 3 | 4 | 5;
};

type CraftQualityRuleDefinition = DefinitionHeader & {
  resolverId: ResolverId; // 只讀製作者 Mastery、配方、設施與投入素材快照
};
```

### 2.1 裝備詞條與製作品質

- 裝備本身仍有一般／精品／史詩／傳說／神話品級；該品級決定白板基礎係數預算，**不是**詞條數量。
- 製作成品的文化來源固定為配方 `originCultureId`，且必須與其輸出 Item Definition 的 `originCultureId` 相同；投入異文化素材只影響其可提供的詞條，不改變成品文化。
- 每個可用素材實體最多提供一條 `MaterialAffixId` 候選詞條。
- 製作品質的可見前綴與成功繼承詞條數固定如下：無前綴 `plain=0`、精良 `fine=1`、卓越 `excellent=2`、完美 `perfect=3`、無雙 `peerless=4`、鬼神 `demonGod=5`。
- 一般／精品／史詩／傳說／神話裝備配方分別使用 1／2／3／4／5 份素材，因此可成功帶入的詞條硬上限分別也是 1／2／3／4／5；實際帶入數為 `min(品質詞條數, 候選詞條數)`。
- 成品戰力、NPC 換裝、任務可行性與 Combat Sequence 皆只讀最終 Equipment Statistics／Combat Power；不得以品級、前綴或詞條數建立另一套比較順序。

### 2.2 消耗品與工藝品

- `consumable` 不會有前綴、詞條或單件品質；Quality Rule 的結果只由 Consumable Yield Resolver 轉為同批材料的固定道具產量。
- 熟練度越高可用相同材料產出越多，是消耗品製作的成本優勢；高階消耗品不進商店基礎貨架，只能由寶箱或已學配方製作取得。
- `tradeGood` 不繼承素材詞條；它可擁有無前綴～鬼神的製作品質，品質只套用出售倍率。低階工藝品亦可骰到鬼神品質。

### 2.3 料理

```ts
type CuisineRecipeDefinition = DefinitionHeader & {
  originCultureId: CultureId;
  requiredMasteries: MasteryRequirement[];
  ingredientSlots: CuisineIngredientSlotDefinition[];
  baseFoodEffectIds: EffectDefinitionId[];
  foodStatusDurationDays: number;   // 料理效果維持天數；料理本身仍為零日行為
  cookingExperienceRuleId: ExperienceAwardRuleId;
  foodAffixTierResolverId: ResolverId; // 食材方向固定；廚藝決定各詞條階級
  restaurantBaseVariantId?: RestaurantMealVariantId;
};

type FoodAffixDefinition = DefinitionHeader & {
  effectByTier: Record<1 | 2 | 3 | 4 | 5, EffectDefinitionId>;
};

type RestaurantMenuDefinition = DefinitionHeader & {
  cityId: CityId;
  entries: Array<{
    mealVariantId: RestaurantMealVariantId;
    cuisineRecipeId: CuisineRecipeId;
    priceRuleId: PriceRuleId;
  }>;
};

type NpcCuisineDecisionRuleDefinition = DefinitionHeader & {
  selfCookWeightResolverId: ResolverId;
  restaurantWeightResolverId: ResolverId;
};
```

- 料理不是可囤積 Item。成功料理後立即食用，直接建立角色個別 FoodStatus；自製料理可在任何合法情境零日進行，餐館用餐則必須位於有開放 Inn 的城市。
- 料理的文化來源固定為食譜 `originCultureId`；異文化食材可以形成異文化詞條組合，但不改寫料理本身的食譜文化。
- 食譜決定基礎效果、維持日數與料理 MXP；指定食材決定**全部**料理詞條方向。每個食材詞條是固定效果類型；不抽詞條數、不使用裝備的精良～鬼神前綴。
- 廚藝只決定每條料理詞條最後使用的階級。高階料理有更長持續時間、更佳基礎效果與更高料理 MXP；高階料理不進商店貨架。
- Restaurant 只提供基礎變體：同一組 FoodStatus 效果一律取最低詞條階級，並發放同級自製料理 MXP 的 `1/3`；餐館不要求食材、也不看廚藝。

## 3. Runtime State

```ts
type FoodStatus = {
  characterId: CharacterId;
  source: { kind: 'selfCooked'; recipeId: CuisineRecipeId } | { kind: 'restaurant'; mealVariantId: RestaurantMealVariantId };
  originCultureId: CultureId;
  foodAffixes: Array<{ foodAffixId: FoodAffixId; tier: 1 | 2 | 3 | 4 | 5 }>;
  appliedEffectIds: EffectDefinitionId[];
  startedOnDay: WorldDay;
  expiresOnDay: WorldDay; // 最後有效的世界日
  revision: Revision;
};

type CraftingAttempt = {
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

type CraftingAttemptResult =
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
```

製作存在成功與失敗，但成功率、品質聯動與失敗時消耗／返還哪些素材仍屬待定公式，必須由 `outcomeResolverId` 對開始時已保留的素材快照解析。無論結果為成功或失敗，都以同一食譜 `craftingExperienceRuleId` 發放表定 MXP；Handler 不得因失敗改用零經驗或另一條隱藏曲線。

製作所需時間只由 Team 的 `MemberFreeAction.requiredFreeDays／accumulatedFreeDays` 管理。離開 `cityFree` 時，Crafting Attempt 與素材保留都維持原狀；後續自由期繼續扣同一行動的剩餘日數。只有 Team 正式發出該筆 `FreeActionCompleted` 後才解析成功／失敗，不存在「本次自由期不夠長」或一般行程中斷造成的取消。

FoodStatus 存在時，該角色不可自製料理、不可餐館用餐；新狀態不得覆蓋舊狀態。`expiresOnDay` 當日仍有效；`foodStatusExpiry` 排在 `expiresOnDay + 1`，且必須早於當日 `npcCuisineDecisionDue`。因此 NPC 在效果仍有效的日結算不決定料理，失效後才於下一個可結算日重新骰。

## 4. 公開 Query 與輸入

```ts
interface CraftingQuery {
  getFoodStatus(characterId: CharacterId): FoodStatusView | undefined;
  canPrepareFood(characterId: CharacterId, onDay: WorldDay): boolean;
  listCraftableRecipes(characterId: CharacterId, cityId: CityId): CraftingRecipeView[];
  listCookableCuisine(characterId: CharacterId): CuisineRecipeView[];
}
```

| Game Command | 前置條件 | 結果 |
|---|---|---|
| `startCrafting` | 已學配方、Mastery／設施／材料合法，角色位於 City Free，且沒有未完成的耗時自由行動。 | 同一交易依序送出 required `ReserveCraftingInputs`、建立 Crafting Attempt，並以 required `StartTimedCityAction` 要求 Team 建立以 `freeActionId` 回連該 Attempt 的耗時 craft FreeAction；任一步拒絕則全部回滾。 |
| `cookCuisine` | 無 FoodStatus、已學食譜且持有合法食材。 | required `ConsumeCuisineIngredients` 成功後，零日建立 FoodStatus、套用效果並發放料理 MXP；任一步拒絕則全部回滾。 |
| `eatRestaurantMeal` | 無 FoodStatus、位於有開放 Inn 的城市且可付款。 | 零日付款、建立最低階 FoodStatus、發放 1/3 料理 MXP。 |

`npcCuisineDecisionDue` 是 Crafting 的每日 Job：對每名無 FoodStatus 的非玩家主角角色，資料化抽取自製料理或餐館；餐館候選只在角色所在城市的 Inn 開放時可用，有 FoodStatus 的角色不建立決策。此 Job 不依賴、也不改變 NPC 的 FreeAction。

非玩家角色在 `cityFree` 已抽到 `craft` 時，NPC Behavior 只向 `CraftingQuery.listCraftableRecipes` 取得目前合法的配方池，以固定 RNG 直接抽一筆；不評估市場需求、預期利潤或材料最佳化。完成後若成品是裝備，Workflow 僅以最終 Combat Power 與同裝備位置的目前物品比較：較高則自動換裝，否則保留在個人背包，等後續 `trade` 自由行動出售。這不是另一套品級或詞條比較器。

## 5. 事件與跨模組流程

| 事件／輸出 | 最少 payload | 訂閱者 |
|---|---|---|
| `CraftingCompleted` | `characterId`、`recipeId`、`outcome`、`outputItemIds`、`quality?`、`experienceRuleId` | progression、ui/app。 |
| `FoodStatusChanged` | `characterId`、`state: applied \| expired`、`source`、`expiresOnDay?` | character、ui/app。 |
| `CuisineConsumed` | `characterId`、`source: selfCooked \| restaurant`、`recipeId`、`experienceRuleId`、`experienceMultiplier` | progression、ui/app。 |

```text
FreeActionCompleted(craft)
  → Crafting 驗證預留快照與配方
  → resolve 成功／失敗與素材去向
  → 成功時 resolve 品質／候選素材詞條／產量或出售倍率
  → TransformCraftingItems(inventory；依正式結果消耗／返還素材並建立成功產物)
  → CraftingCompleted
  → Progression 不分成功／失敗，發放同一食譜的生活技藝 MXP

cookCuisine / eatRestaurantMeal
  → 驗證無 FoodStatus
  → 自製：ConsumeCuisineIngredients；餐館：TransferCurrency
  → 建立 FoodStatus + ApplyFoodStatusEffects(character workflow)
  → CuisineConsumed
  → Progression 發放料理 MXP（餐館 x1/3）

foodStatusExpiry
  → 移除 FoodStatus + ApplyFoodStatusEffects(remove)
  → FoodStatusChanged(expired)
  → 下個 NPC 日結算才可再次骰料理
```

## 6. 不變量與測試

1. 任一角色至多一筆未到期 FoodStatus；存在時不可製作或購買餐點。
2. 料理不可建立為 Inventory Item，餐館與自製都必須立即套用 FoodStatus。
3. 裝備候選詞條一份素材最多一條；品質前綴絕不改變裝備基礎品級。
4. 消耗品絕不帶精良～鬼神前綴或素材詞條；其品質結果只改變產量。
5. 工藝品絕不帶素材詞條；任何品級都可有任一出售品質，且只影響出售倍率。
6. NPC 料理決策僅在無 FoodStatus 的日結算發生，不進 FreeAction 池。
7. 餐館 FoodStatus 的每條料理詞條均為 Tier 1，且 MXP 恰為相同食譜自製值的 1/3。
8. Crafting Attempt 在跨越多段 `cityFree` 時保持同一 ID、素材保留與累積進度；一般旅行／冒險只凍結，不取消或重抽。
9. 製作成功與失敗都只結算一次，並使用同一 `craftingExperienceRuleId`；失敗不得建立產物，但其素材消耗／返還必須完全符合 Outcome Resolver 結果。
