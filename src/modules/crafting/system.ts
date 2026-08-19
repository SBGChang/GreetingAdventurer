// modules/crafting/system.ts
// Crafting & Cuisine 模組的純函式 Handler / Job / 領域解析
// （對應 docs/00_core/architecture/20_crafting_and_cuisine_module.md §3–§6）。
//
// 設計原則：
//   * 全部為決定性純函式：不做 I/O、不呼叫 Math.random / Date.now。
//   * 需要「當前世界日」「靜態資料」「別的模組的事實」「RNG 結果」時，一律經注入的
//     CraftingHandlerContext 取得；RNG 只以顯式 cursor 的 DeterministicRng 使用，且逐次前進。
//   * Game Command / Job root → ModuleOutcome<CraftingState>（accept | typed rejection）。
//   * 品質、成功／失敗、素材去向、詞條階級、消耗品產量**一律**由 Resolver + Definition 決定；
//     本檔不含任何機率表或倍率——只含 doc 明訂為結構的列舉語意（見 state.ts 的品質階梯）。

import type {
  CharacterId,
  CityId,
  CraftQualityRuleId,
  CraftingRecipeId,
  CuisineRecipeId,
  DomainEventDraft,
  EffectDefinitionId,
  ExperienceAwardRuleId,
  FoodAffixId,
  InternalCommandDraft,
  ItemInstanceId,
  MasteryId,
  MaterialAffixId,
  ModuleId,
  ModuleOutcome,
  ModuleResult,
  NpcCuisineDecisionRuleId,
  ResolverId,
  Revision,
  RngContext,
  RngStep,
  ScheduledJobDraft,
  AnyScheduledJob,
  TransactionMessageDraft,
  WorldDay,
  CraftingIngredientSlotId,
} from '../../contracts/core';
import type {
  CraftQuality,
  CraftingAttempt,
  CraftingDefinitionReader,
  CraftingIngredientSlotDefinition,
  CraftingRecipeDefinition,
  CraftingState,
  CuisineIngredientSlotDefinition,
  FacilityKind,
  FoodStatus,
  FoodStatusExpiryJob,
  CraftingDomainEvent,
  CookCuisineCommand,
} from '../../contracts/crafting';

// 跨模組引用（僅型別 import）：外送命令一律使用**接收模組契約的真實型別**，
// 讓編譯器在送出端就攔下 payload 漂移（00_shared_contracts.md §5 / B.5 收斂）。
import type { ConsumeCuisineIngredients, ItemInstanceView } from '../../contracts/inventory';
import type { ApplyFoodStatusEffects } from '../../contracts/character';
import type { MasteryRequirement } from '../../contracts/progression';
import type { FreeActionCompletedEvent } from '../../contracts/team';

import {
  hasActiveFoodStatus,
  isCraftQuality,
  isFoodAffixTier,
  listScheduledAttemptsForCharacter,
  qualityAffixCapacity,
  removeFoodStatus,
  tryGetFoodStatus,
  upsertFoodStatus,
  type FoodAffixTier,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組常數
// ──────────────────────────────────────────────────────────────────────────

export const CRAFTING_MODULE_ID = 'crafting' as ModuleId<'crafting'>;

const INVENTORY_MODULE_ID = 'inventory' as ModuleId<'inventory'>;
const CHARACTER_MODULE_ID = 'character' as ModuleId<'character'>;

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port（§7.1 慣例：本地宣告窄化型別，實作由 Composition 注入）
// ──────────────────────────────────────────────────────────────────────────

export type MasteryLevelSnapshot = Readonly<{ masteryId: MasteryId; level: number }>;

// progression 擁有「已學配方」與各生活 Mastery（doc §1 表格）。Crafting 只查詢，不保存第二份。
export interface CraftingProgressionPort {
  hasLearnedRecipe(characterId: CharacterId, recipeId: CraftingRecipeId | CuisineRecipeId): boolean;
  meetsMasteryRequirements(
    characterId: CharacterId,
    requirements: readonly MasteryRequirement[],
  ): boolean;
  getMasteryLevel(characterId: CharacterId, masteryId: MasteryId): number;
}

// inventory 擁有素材／成品實體（doc §1 表格）。Crafting 只取候選素材快照。
export interface CraftingInventoryPort {
  getItem(itemId: ItemInstanceId): ItemInstanceView | undefined;
}

// city 擁有設施可用性與餐館基礎菜單（doc §1 表格）。
export interface CraftingCityPort {
  isFacilityAvailable(cityId: CityId, kind: FacilityKind): boolean;
  canUseRestaurant(cityId: CityId, characterId: CharacterId): boolean;
}

// 成功／失敗與失敗時素材去向：doc §172 要求「由 outcomeResolverId 對開始時已保留的素材快照解析」。
export type CraftOutcomeDraft = Readonly<{
  outcome: 'succeeded' | 'failed';
  consumedIngredientItemIds: readonly ItemInstanceId[];
  returnedIngredientItemIds: readonly ItemInstanceId[];
}>;

// 資料調校 Resolver（RNG 藏於其內；Handler 不含機率／公式，只消費結果並串接 cursor）。
// 擲骰型方法回傳 RngStep：呼叫端必須把 nextCursor 顯式接到下一次抽取，否則同一次調用內的連續抽取
// 全部落在同一 cursor → 相同結果（12_engine_runtime.md §7.1）。
export interface CraftingResolverPort {
  resolveCraftOutcome(
    input: Readonly<{
      resolverId: ResolverId;
      recipeId: CraftingRecipeId;
      characterId: CharacterId;
      reservedIngredientItemIds: readonly ItemInstanceId[];
      masteryLevels: readonly MasteryLevelSnapshot[];
      rngContext: RngContext;
    }>,
  ): RngStep<CraftOutcomeDraft>;

  // 回傳 string 而非 CraftQuality：Resolver 的行為由內容決定，輸出必須被驗證才能寫進 State
  // （呼叫端以 state.ts 的 isCraftQuality 驗）。宣告成 CraftQuality 只會讓壞內容看起來合法。
  resolveCraftQuality(
    input: Readonly<{
      resolverId: ResolverId;
      qualityRuleId: CraftQualityRuleId;
      recipeId: CraftingRecipeId;
      characterId: CharacterId;
      requiredFacilityKind: FacilityKind;
      reservedIngredientItemIds: readonly ItemInstanceId[];
      masteryLevels: readonly MasteryLevelSnapshot[];
      rngContext: RngContext;
    }>,
  ): RngStep<string>;

  // doc §2.2：消耗品的高熟練優勢以**同材料產量**表現，不給前綴或詞條。產量是資料，形狀是「品質 → 件數」。
  resolveConsumableYield(
    input: Readonly<{
      resolverId: ResolverId;
      recipeId: CraftingRecipeId;
      quality: CraftQuality;
      masteryLevels: readonly MasteryLevelSnapshot[];
    }>,
  ): number;

  // doc §2.3：食材決定詞條方向，廚藝只決定每條詞條最後使用的階級。
  resolveFoodAffixTier(
    input: Readonly<{
      resolverId: ResolverId;
      recipeId: CuisineRecipeId;
      characterId: CharacterId;
      foodAffixId: FoodAffixId;
      masteryLevels: readonly MasteryLevelSnapshot[];
      rngContext: RngContext;
    }>,
  ): RngStep<number>;

  // doc §195：對無 FoodStatus 的非玩家主角角色「資料化抽取自製料理或餐館」。
  resolveNpcCuisineChoice(
    input: Readonly<{
      ruleId: NpcCuisineDecisionRuleId;
      selfCookWeightResolverId: ResolverId;
      restaurantWeightResolverId: ResolverId;
      characterId: CharacterId;
      cityId: CityId;
      restaurantAvailable: boolean;
      rngContext: RngContext;
    }>,
  ): RngStep<'selfCooked' | 'restaurant'>;
}

export type CraftingHandlerContext = Readonly<{
  worldDay: WorldDay;
  definitions: CraftingDefinitionReader;
  progression: CraftingProgressionPort;
  inventory: CraftingInventoryPort;
  city: CraftingCityPort;
  // RNG 只存在於 Resolver 內部（見 CraftingResolverPort）；本模組只持有起始 cursor 並負責串接，
  // 因此 context 刻意不帶 DeterministicRng——Handler 沒有自行擲骰的能力。
  resolvers: CraftingResolverPort;
  rngContext: RngContext;
}>;

export type CraftingHandlerResult = ModuleOutcome<CraftingState>;

// ──────────────────────────────────────────────────────────────────────────
// 小工具
// ──────────────────────────────────────────────────────────────────────────

function bump(r: Revision): Revision {
  return (r + 1) as Revision;
}

function emit(event: CraftingDomainEvent): DomainEventDraft<unknown> {
  return { event };
}

function internal(
  targetModule: ModuleId,
  command: ConsumeCuisineIngredients | ApplyFoodStatusEffects,
): InternalCommandDraft<unknown> {
  return { targetModule, command };
}

function makeResult(
  nextSlice: CraftingState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[] = [],
): ModuleResult<CraftingState> {
  return { nextSlice, outgoingMessages, scheduledJobs };
}

function accept(
  nextSlice: CraftingState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[] = [],
): CraftingHandlerResult {
  return { ok: true, result: makeResult(nextSlice, outgoingMessages, scheduledJobs) };
}

function reject(
  code: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): CraftingHandlerResult {
  return { ok: false, rejection: { code, source: CRAFTING_MODULE_ID, details } };
}

function masterySnapshot(
  characterId: CharacterId,
  requirements: readonly MasteryRequirement[],
  ctx: CraftingHandlerContext,
): readonly MasteryLevelSnapshot[] {
  return requirements.map((r) => ({
    masteryId: r.masteryId,
    level: ctx.progression.getMasteryLevel(characterId, r.masteryId),
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// 素材 → 配方槽的決定性配置
// ──────────────────────────────────────────────────────────────────────────
//
// 玩家送來的是一串扁平 itemId；配方要的是「哪一格幾份」。配置順序固定為
// 「槽依 Definition 順序、素材依 Command 順序」——決定性，且不引入任何機率。
// 必須**恰好**填滿：填不滿與有剩餘都是非法輸入（多投素材不是「多的忽略」，那會讓 UI 的
// 選擇與實際消耗不一致）。

export type IngredientSlotLike = Readonly<{
  slotId: CraftingIngredientSlotId;
  acceptedMaterialTagIds: readonly ItemTagLikeId[];
  quantity: number;
}>;

// acceptedMaterialTagIds 的成員型別（MaterialTagId）；以別名避免在兩種槽定義間重複宣告。
type ItemTagLikeId = CraftingIngredientSlotDefinition['acceptedMaterialTagIds'][number];

export type IngredientAssignment = Readonly<{
  slotId: CraftingIngredientSlotId;
  itemId: ItemInstanceId;
  quantity: number;
  materialAffixId?: MaterialAffixId;
}>;

type AssignmentOutcome =
  | Readonly<{ ok: true; assignments: readonly IngredientAssignment[] }>
  | Readonly<{ ok: false; code: string; details: Readonly<Record<string, string | number>> }>;

function assignIngredients(
  slots: readonly IngredientSlotLike[],
  itemIds: readonly ItemInstanceId[],
  characterId: CharacterId,
  ctx: CraftingHandlerContext,
): AssignmentOutcome {
  // 先解析每一筆素材實體的合法性與素材身分（一次，避免逐槽重複讀）。
  type Candidate = Readonly<{
    itemId: ItemInstanceId;
    available: number;
    materialTagIds: readonly ItemTagLikeId[];
    materialAffixId?: MaterialAffixId;
  }>;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const itemId of itemIds) {
    if (seen.has(String(itemId))) {
      return { ok: false, code: 'crafting/ingredient-duplicated', details: { itemId: String(itemId) } };
    }
    seen.add(String(itemId));

    const view = ctx.inventory.getItem(itemId);
    if (view === undefined) {
      return { ok: false, code: 'crafting/ingredient-not-found', details: { itemId: String(itemId) } };
    }
    if (view.state !== 'active') {
      return { ok: false, code: 'crafting/ingredient-not-active', details: { itemId: String(itemId), state: view.state } };
    }
    if (view.reservation !== undefined) {
      return { ok: false, code: 'crafting/ingredient-reserved', details: { itemId: String(itemId), reservation: view.reservation.kind } };
    }
    if (view.location.kind !== 'characterBag' || view.location.characterId !== characterId) {
      return { ok: false, code: 'crafting/ingredient-not-held', details: { itemId: String(itemId), location: view.location.kind } };
    }

    const itemView = ctx.definitions.getCraftingItemView(view.definitionId);
    const materialTagIds = itemView.materialTagIds;
    if (materialTagIds === undefined) {
      // 沒有 materialTagIds 的 Item Definition 不是素材——這是輸入錯誤，不是「沒有標籤」。
      return { ok: false, code: 'crafting/ingredient-not-material', details: { itemId: String(itemId), definitionId: String(view.definitionId) } };
    }
    candidates.push({
      itemId,
      available: view.quantity,
      materialTagIds,
      ...(itemView.materialAffixId === undefined ? {} : { materialAffixId: itemView.materialAffixId }),
    });
  }

  const remaining = candidates.map((c) => ({ ...c, left: c.available }));
  const assignments: IngredientAssignment[] = [];

  for (const slot of slots) {
    if (slot.quantity <= 0) {
      return { ok: false, code: 'crafting/slot-quantity-invalid', details: { slotId: String(slot.slotId), quantity: slot.quantity } };
    }
    let need = slot.quantity;
    const accepted = new Set<string>(slot.acceptedMaterialTagIds.map((t) => String(t)));
    for (const entry of remaining) {
      if (need === 0) break;
      if (entry.left === 0) continue;
      if (!entry.materialTagIds.some((t) => accepted.has(String(t)))) continue;
      const take = Math.min(need, entry.left);
      entry.left -= take;
      need -= take;
      assignments.push({
        slotId: slot.slotId,
        itemId: entry.itemId,
        quantity: take,
        ...(entry.materialAffixId === undefined ? {} : { materialAffixId: entry.materialAffixId }),
      });
    }
    if (need > 0) {
      return { ok: false, code: 'crafting/slot-unfilled', details: { slotId: String(slot.slotId), missing: need } };
    }
  }

  const leftover = remaining.find((e) => e.left > 0);
  if (leftover !== undefined) {
    return { ok: false, code: 'crafting/ingredient-unused', details: { itemId: String(leftover.itemId), left: leftover.left } };
  }

  return { ok: true, assignments };
}

// ──────────────────────────────────────────────────────────────────────────
// §4 Game Command：cookCuisine（零日；成功即建立 FoodStatus）
// ──────────────────────────────────────────────────────────────────────────

export function handleCookCuisine(
  command: CookCuisineCommand,
  state: CraftingState,
  ctx: CraftingHandlerContext,
): CraftingHandlerResult {
  // 不變量 1：任一角色至多一筆未到期 FoodStatus；存在時不可製作或購買餐點，且新狀態不得覆蓋舊狀態。
  if (hasActiveFoodStatus(state, command.characterId, ctx.worldDay)) {
    const current = tryGetFoodStatus(state, command.characterId);
    return reject('crafting/food-status-active', {
      characterId: String(command.characterId),
      expiresOnDay: current === undefined ? -1 : current.expiresOnDay,
    });
  }

  const recipe = ctx.definitions.getCuisineRecipe(command.recipeId);
  if (!recipe.enabled) {
    return reject('crafting/cuisine-recipe-disabled', { recipeId: String(command.recipeId) });
  }
  if (!ctx.progression.hasLearnedRecipe(command.characterId, command.recipeId)) {
    return reject('crafting/cuisine-recipe-not-learned', {
      characterId: String(command.characterId),
      recipeId: String(command.recipeId),
    });
  }
  if (!ctx.progression.meetsMasteryRequirements(command.characterId, recipe.requiredMasteries)) {
    return reject('crafting/mastery-requirement-unmet', { recipeId: String(command.recipeId) });
  }
  // doc §2.3：料理效果維持天數由食譜給定。0 天的 FoodStatus 沒有「當日仍有效」可言（§3），
  // 那是壞內容而不是「立即失效的料理」。
  if (recipe.foodStatusDurationDays < 1) {
    return reject('crafting/cuisine-duration-invalid', {
      recipeId: String(command.recipeId),
      foodStatusDurationDays: recipe.foodStatusDurationDays,
    });
  }

  const slots: readonly IngredientSlotLike[] = recipe.ingredientSlots.map(
    (s: CuisineIngredientSlotDefinition) => ({
      slotId: s.slotId,
      acceptedMaterialTagIds: s.acceptedMaterialTagIds,
      quantity: s.quantity,
    }),
  );
  const assigned = assignIngredients(slots, command.ingredientItemIds, command.characterId, ctx);
  if (!assigned.ok) return reject(assigned.code, assigned.details);

  const masteryLevels = masterySnapshot(command.characterId, recipe.requiredMasteries, ctx);

  // doc §2.3：「指定食材決定**全部**料理詞條方向」——每份食材至多一條（yunhua §5），廚藝只決定階級。
  const foodAffixes: Array<Readonly<{ foodAffixId: FoodAffixId; tier: FoodAffixTier }>> = [];
  let cursor = ctx.rngContext.cursor;

  for (const assignment of assigned.assignments) {
    const affixId = assignment.materialAffixId;
    if (affixId === undefined) continue; // 該素材本來就不提供詞條（yunhua §5「零或一條」）
    const affix = ctx.definitions.getMaterialAffix(affixId);
    if (!affix.enabled) continue;
    if (!affix.compatibleOutputKinds.includes('cuisine')) continue;
    if (affix.foodAffixId === undefined) {
      return reject('crafting/material-affix-missing-food-affix', {
        materialAffixId: String(affixId),
      });
    }
    const step = ctx.resolvers.resolveFoodAffixTier({
      resolverId: recipe.foodAffixTierResolverId,
      recipeId: command.recipeId,
      characterId: command.characterId,
      foodAffixId: affix.foodAffixId,
      masteryLevels,
      rngContext: { ...ctx.rngContext, cursor },
    });
    cursor = step.nextCursor;
    if (!isFoodAffixTier(step.value)) {
      return reject('crafting/food-affix-tier-out-of-range', {
        foodAffixId: String(affix.foodAffixId),
        tier: step.value,
      });
    }
    foodAffixes.push({ foodAffixId: affix.foodAffixId, tier: step.value });
  }

  const status = buildFoodStatus({
    characterId: command.characterId,
    source: { kind: 'selfCooked', recipeId: command.recipeId },
    originCultureId: recipe.originCultureId,
    baseFoodEffectIds: recipe.baseFoodEffectIds,
    foodAffixes,
    startedOnDay: ctx.worldDay,
    durationDays: recipe.foodStatusDurationDays,
    ctx,
  });

  return accept(
    upsertFoodStatus(state, status),
    [
      // doc §191：「required ConsumeCuisineIngredients 成功後 ... 任一步拒絕則全部回滾」。
      // 材料消耗由 inventory 執行——本模組不寫別人的 Slice。
      internal(INVENTORY_MODULE_ID, {
        type: 'ConsumeCuisineIngredients',
        characterId: command.characterId,
        ingredientItemIds: command.ingredientItemIds,
      }),
      // Effect → Status 的對照在**送出端**完成（清理清單 A1）；Character 收到的已是 StatusId。
      internal(CHARACTER_MODULE_ID, applyFoodStatusEffects(status, 'apply', ctx)),
      emit({
        type: 'FoodStatusChanged',
        characterId: status.characterId,
        state: 'applied',
        source: status.source,
        expiresOnDay: status.expiresOnDay,
      }),
      emit({
        type: 'CuisineConsumed',
        characterId: status.characterId,
        source: 'selfCooked',
        recipeId: command.recipeId,
        experienceRuleId: recipe.cookingExperienceRuleId,
        // 自製料理拿表定值本身；1 是乘法單位元（結構），不是可調倍率。
        // 餐館的折算倍率是資料，見 CuisineRecipeDefinition.restaurantExperienceMultiplier。
        experienceMultiplier: 1,
      }),
    ],
    [foodStatusExpiryJobDraft(status)],
  );
}

// FoodStatus 的建構與效果集合：基礎效果 + 各詞條依階級解析出的效果（doc §2.3）。
function buildFoodStatus(
  input: Readonly<{
    characterId: CharacterId;
    source: FoodStatus['source'];
    originCultureId: FoodStatus['originCultureId'];
    baseFoodEffectIds: readonly EffectDefinitionId[];
    foodAffixes: readonly Readonly<{ foodAffixId: FoodAffixId; tier: FoodAffixTier }>[];
    startedOnDay: WorldDay;
    durationDays: number;
    ctx: CraftingHandlerContext;
  }>,
): FoodStatus {
  const affixEffectIds = input.foodAffixes.map(
    (a) => input.ctx.definitions.getFoodAffix(a.foodAffixId).effectByTier[a.tier],
  );
  return {
    characterId: input.characterId,
    source: input.source,
    originCultureId: input.originCultureId,
    foodAffixes: [...input.foodAffixes],
    appliedEffectIds: [...input.baseFoodEffectIds, ...affixEffectIds],
    startedOnDay: input.startedOnDay,
    // doc §3：「expiresOnDay 當日仍有效」→ N 天的區間是 [start, start + N - 1]（含端點）。
    expiresOnDay: (input.startedOnDay + input.durationDays - 1) as WorldDay,
    revision: 0 as Revision,
  };
}

// 清理清單 A1 的對照層：把 FoodStatus 已套用的 EffectDefinitionId 逐筆讀成 CharacterStatusDefinitionId。
// Reader 對未知 id／跨 kind 存取明確拋錯——缺引用是壞內容，不在此處補預設。
function applyFoodStatusEffects(
  status: FoodStatus,
  operation: ApplyFoodStatusEffects['operation'],
  ctx: CraftingHandlerContext,
): ApplyFoodStatusEffects {
  return {
    type: 'ApplyFoodStatusEffects',
    characterId: status.characterId,
    foodStatusRevision: status.revision,
    operation,
    statusIds: status.appliedEffectIds.map(
      (effectId) => ctx.definitions.getFoodEffect(effectId).characterStatusId,
    ),
  };
}

// doc §3：`foodStatusExpiry` 排在 `expiresOnDay + 1`。過期判定用 expectedRevision（見契約註解）。
function foodStatusExpiryJobDraft(status: FoodStatus): ScheduledJobDraft<FoodStatusExpiryJob> {
  return {
    type: 'foodStatusExpiry',
    dueDay: (status.expiresOnDay + 1) as WorldDay,
    ownerModule: CRAFTING_MODULE_ID,
    targetId: status.characterId,
    expectedRevision: status.revision,
    payload: {},
  };
}

// ──────────────────────────────────────────────────────────────────────────
// §5 Job：foodStatusExpiry（移除 FoodStatus → 要求移除效果 → 公告 expired）
// ──────────────────────────────────────────────────────────────────────────

export function handleFoodStatusExpiry(
  job: FoodStatusExpiryJob,
  state: CraftingState,
  ctx: CraftingHandlerContext,
): CraftingHandlerResult {
  const status = tryGetFoodStatus(state, job.targetId);
  // 已無 FoodStatus：這件事已經發生過了（同一天的另一條路徑已移除，或角色已不存在）。
  // 資料齊全時這裡依然會 no-op，因此是合法的冪等，不是蓋住缺口。
  if (status === undefined) return accept(state);

  // 舊 Job 對不上 revision → 該 FoodStatus 已被換成另一筆，這張到期單作廢。
  if (job.expectedRevision !== undefined && job.expectedRevision !== status.revision) {
    return accept(state);
  }

  // 尚未到期就不該移除（例如 Job 被提前執行）：這是排程錯誤，明確拒絕而不是靜默丟棄。
  if (ctx.worldDay <= status.expiresOnDay) {
    return reject('crafting/food-status-not-expired', {
      characterId: String(job.targetId),
      expiresOnDay: status.expiresOnDay,
      worldDay: ctx.worldDay,
    });
  }

  return accept(removeFoodStatus(state, job.targetId), [
    internal(CHARACTER_MODULE_ID, applyFoodStatusEffects(status, 'remove', ctx)),
    emit({
      type: 'FoodStatusChanged',
      characterId: status.characterId,
      state: 'expired',
      source: status.source,
    }),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5 製作結算的領域規則（純解析，不寫 State、不送命令）
// ──────────────────────────────────────────────────────────────────────────
//
// doc §208 的流程是 FreeActionCompleted(craft) → 驗證 → 解析成功／失敗與素材去向 → 解析品質／詞條／
// 產量 → TransformCraftingItems → CraftingCompleted。中段的「解析」全部屬於 Crafting 的規則，
// 而後段必須先由 inventory 建立成品實體才知道 outputItemIds（CraftingAttemptResult 要存它）。
// 因此本模組提供的是**完整的解析結果**；把它交給 inventory 再回填 Attempt 是一條跨模組編排，
// 由 Composition 的 Workflow 擁有（見交接報告）。

export type CraftingResolutionDraft = Readonly<{
  craftingAttemptId: CraftingAttempt['craftingAttemptId'];
  characterId: CharacterId;
  recipeId: CraftingRecipeId;
  outcome: 'succeeded' | 'failed';
  quality: CraftQuality;
  consumedIngredientItemIds: readonly ItemInstanceId[];
  returnedIngredientItemIds: readonly ItemInstanceId[];
  // 成功時要建立的成品：定義、件數與實體資料（品質／繼承詞條／出售倍率 Resolver）。
  outputs: readonly CraftingOutputDraft[];
  // 成功與失敗都用同一條規則發放 MXP（doc §172、不變量 9）。
  experienceRuleId: ExperienceAwardRuleId;
  nextRngCursor: RngContext['cursor'];
}>;

export type CraftingOutputDraft = Readonly<{
  definitionId: CraftingRecipeDefinition['outputDefinitionId'];
  quantity: number;
  instanceData:
    | Readonly<{
        kind: 'craftedEquipment';
        quality: CraftQuality;
        inheritedMaterialAffixIds: readonly MaterialAffixId[];
      }>
    | Readonly<{ kind: 'craftedTradeGood'; quality: CraftQuality; saleMultiplierResolverId: ResolverId }>
    | undefined;
}>;

export type CraftingResolutionOutcome =
  | Readonly<{ ok: true; draft: CraftingResolutionDraft }>
  | Readonly<{ ok: false; code: string; details: Readonly<Record<string, string | number>> }>;

export function resolveCraftingAttempt(
  attempt: CraftingAttempt,
  ctx: CraftingHandlerContext,
): CraftingResolutionOutcome {
  if (attempt.status !== 'scheduled') {
    return {
      ok: false,
      code: 'crafting/attempt-already-resolved',
      details: { craftingAttemptId: String(attempt.craftingAttemptId) },
    };
  }
  const recipe = ctx.definitions.getCraftingRecipe(attempt.recipeId);

  // §2.1：成品文化固定為配方 originCultureId，且必須與輸出 Item Definition 的 originCultureId 相同。
  const outputItem = ctx.definitions.getCraftingItemView(recipe.outputDefinitionId);
  if (outputItem.originCultureId !== recipe.originCultureId) {
    return {
      ok: false,
      code: 'crafting/output-culture-mismatch',
      details: {
        recipeCultureId: String(recipe.originCultureId),
        outputCultureId: String(outputItem.originCultureId),
      },
    };
  }

  const masteryLevels = masterySnapshot(attempt.characterId, recipe.requiredMasteries, ctx);
  let cursor = ctx.rngContext.cursor;

  const outcomeStep = ctx.resolvers.resolveCraftOutcome({
    resolverId: recipe.outcomeResolverId,
    recipeId: attempt.recipeId,
    characterId: attempt.characterId,
    reservedIngredientItemIds: attempt.ingredientItemIds,
    masteryLevels,
    rngContext: { ...ctx.rngContext, cursor },
  });
  cursor = outcomeStep.nextCursor;

  // 不變量 9：素材消耗／返還必須完全符合 Outcome Resolver 結果——也就是必須恰好切分開始時的快照。
  // Resolver 是資料，因此它的輸出要被驗證：本模組的不變量不交給內容守。
  const partition = validateIngredientPartition(attempt.ingredientItemIds, outcomeStep.value);
  if (partition !== undefined) return partition;

  const qualityStep = ctx.resolvers.resolveCraftQuality({
    resolverId: ctx.definitions.getCraftQualityRule(recipe.qualityRuleId).resolverId,
    qualityRuleId: recipe.qualityRuleId,
    recipeId: attempt.recipeId,
    characterId: attempt.characterId,
    requiredFacilityKind: recipe.requiredFacilityKind,
    reservedIngredientItemIds: attempt.ingredientItemIds,
    masteryLevels,
    rngContext: { ...ctx.rngContext, cursor },
  });
  cursor = qualityStep.nextCursor;
  if (!isCraftQuality(qualityStep.value)) {
    return {
      ok: false,
      code: 'crafting/quality-out-of-domain',
      details: { quality: qualityStep.value, qualityRuleId: String(recipe.qualityRuleId) },
    };
  }
  const quality: CraftQuality = qualityStep.value;

  const outputs =
    outcomeStep.value.outcome === 'failed'
      ? [] // 不變量 9：失敗不得建立產物。
      : buildOutputs(recipe, attempt, quality, masteryLevels, ctx);
  if (!Array.isArray(outputs)) return outputs;

  return {
    ok: true,
    draft: {
      craftingAttemptId: attempt.craftingAttemptId,
      characterId: attempt.characterId,
      recipeId: attempt.recipeId,
      outcome: outcomeStep.value.outcome,
      quality,
      consumedIngredientItemIds: outcomeStep.value.consumedIngredientItemIds,
      returnedIngredientItemIds: outcomeStep.value.returnedIngredientItemIds,
      outputs,
      experienceRuleId: recipe.craftingExperienceRuleId,
      nextRngCursor: cursor,
    },
  };
}

function validateIngredientPartition(
  snapshot: readonly ItemInstanceId[],
  outcome: CraftOutcomeDraft,
):
  | Readonly<{ ok: false; code: string; details: Readonly<Record<string, string | number>> }>
  | undefined {
  const expected = new Set(snapshot.map((id) => String(id)));
  const got = [
    ...outcome.consumedIngredientItemIds.map((id) => String(id)),
    ...outcome.returnedIngredientItemIds.map((id) => String(id)),
  ];
  if (got.length !== expected.size || new Set(got).size !== got.length) {
    return {
      ok: false,
      code: 'crafting/outcome-partition-invalid',
      details: { expected: expected.size, got: got.length },
    };
  }
  const stray = got.find((id) => !expected.has(id));
  if (stray !== undefined) {
    return {
      ok: false,
      code: 'crafting/outcome-partition-invalid',
      details: { expected: expected.size, strayItemId: stray },
    };
  }
  // 成功時 CraftingAttemptResult 沒有 returnedIngredientItemIds 欄位可存（contracts §3），
  // 所以「成功且有返還」無處記錄——那不是可接受的結果，是 Resolver 輸出與狀態形狀矛盾。
  if (outcome.outcome === 'succeeded' && outcome.returnedIngredientItemIds.length > 0) {
    return {
      ok: false,
      code: 'crafting/outcome-partition-invalid',
      details: { returnedOnSuccess: outcome.returnedIngredientItemIds.length },
    };
  }
  return undefined;
}

function buildOutputs(
  recipe: CraftingRecipeDefinition,
  attempt: CraftingAttempt,
  quality: CraftQuality,
  masteryLevels: readonly MasteryLevelSnapshot[],
  ctx: CraftingHandlerContext,
):
  | CraftingOutputDraft[]
  | Readonly<{ ok: false; code: string; details: Readonly<Record<string, string | number>> }> {
  if (recipe.outputKind === 'consumable') {
    // 不變量 4：消耗品絕不帶前綴或素材詞條；品質結果只改變產量。
    const resolverId = recipe.consumableYieldResolverId;
    if (resolverId === undefined) {
      return {
        ok: false,
        code: 'crafting/consumable-yield-resolver-missing',
        details: { recipeId: String(recipe.id) },
      };
    }
    const yieldCount = ctx.resolvers.resolveConsumableYield({
      resolverId,
      recipeId: attempt.recipeId,
      quality,
      masteryLevels,
    });
    if (!Number.isInteger(yieldCount) || yieldCount < 1) {
      return {
        ok: false,
        code: 'crafting/consumable-yield-invalid',
        details: { recipeId: String(recipe.id), yieldCount },
      };
    }
    return [{ definitionId: recipe.outputDefinitionId, quantity: yieldCount, instanceData: undefined }];
  }

  if (recipe.outputKind === 'tradeGood') {
    // 不變量 5：工藝品絕不帶素材詞條；任何品級都可有任一出售品質，且只影響出售倍率。
    const saleMultiplierResolverId = recipe.tradeGoodSaleMultiplierResolverId;
    if (saleMultiplierResolverId === undefined) {
      return {
        ok: false,
        code: 'crafting/trade-good-sale-resolver-missing',
        details: { recipeId: String(recipe.id) },
      };
    }
    return [
      {
        definitionId: recipe.outputDefinitionId,
        quantity: 1,
        instanceData: { kind: 'craftedTradeGood', quality, saleMultiplierResolverId },
      },
    ];
  }

  // equipment：候選詞條一份素材最多一條（不變量 3），實際帶入數為 min(品質詞條數, 候選詞條數)。
  const inheritedMaterialAffixIds = selectInheritedAffixes(recipe, attempt, quality, ctx);
  return [
    {
      definitionId: recipe.outputDefinitionId,
      quantity: 1,
      instanceData: { kind: 'craftedEquipment', quality, inheritedMaterialAffixIds },
    },
  ];
}

// 候選詞條的來源：`contributesEquipmentAffix` 的槽所配到的素材，每份素材至多一條（不變量 3）。
// 挑選順序＝槽的 Definition 順序 → 該槽內素材的投入順序：決定性，且不引入 doc 未定義的第二次擲骰。
function selectInheritedAffixes(
  recipe: CraftingRecipeDefinition,
  attempt: CraftingAttempt,
  quality: CraftQuality,
  ctx: CraftingHandlerContext,
): readonly MaterialAffixId[] {
  const contributing = new Set(
    recipe.ingredientSlots
      .filter((s: CraftingIngredientSlotDefinition) => s.contributesEquipmentAffix)
      .map((s) => String(s.slotId)),
  );
  if (contributing.size === 0) return [];

  const candidates: MaterialAffixId[] = [];
  for (const itemId of attempt.ingredientItemIds) {
    const view = ctx.inventory.getItem(itemId);
    if (view === undefined) continue; // 保留期間被移除的素材不提供候選；消耗／返還由 Outcome Resolver 決定
    const reservation = view.reservation;
    if (reservation === undefined || reservation.kind !== 'craftingInput') continue;
    if (reservation.craftingAttemptId !== attempt.craftingAttemptId) continue;
    if (!contributing.has(String(reservation.slotId))) continue;
    const affixId = ctx.definitions.getCraftingItemView(view.definitionId).materialAffixId;
    if (affixId === undefined) continue; // yunhua §5：零或一條
    const affix = ctx.definitions.getMaterialAffix(affixId);
    if (!affix.enabled) continue;
    if (!affix.compatibleOutputKinds.includes('equipment')) continue;
    candidates.push(affixId);
  }
  return candidates.slice(0, Math.min(qualityAffixCapacity(quality), candidates.length));
}

// FreeActionCompleted 不帶 freeActionId／craftingAttemptId，因此結算入口只能以
// (成員, 配方) 相關到唯一一筆 scheduled Attempt（doc §191 前置條件保證同一角色至多一筆耗時行動）。
export function findCraftAttemptForFreeAction(
  state: CraftingState,
  event: FreeActionCompletedEvent,
): CraftingAttempt | undefined {
  const payload = event.payload;
  if (payload.kind !== 'craft') return undefined;
  const matches = listScheduledAttemptsForCharacter(state, event.memberId).filter(
    (a) => a.recipeId === payload.recipeId,
  );
  if (matches.length > 1) {
    throw new Error(
      `crafting: 角色 "${String(event.memberId)}" 同時有 ${matches.length} 筆 scheduled Attempt 指向同一配方，無法相關到唯一結算對象`,
    );
  }
  return matches[0];
}

// 已解析的結果寫回 Attempt（由擁有 Slice 的本模組執行；outputItemIds 由 inventory 建立後回填）。
export function applyCraftingResolution(
  state: CraftingState,
  attempt: CraftingAttempt,
  draft: CraftingResolutionDraft,
  outputItemIds: readonly ItemInstanceId[],
): CraftingState {
  const result: CraftingAttempt['result'] =
    draft.outcome === 'succeeded'
      ? {
          outcome: 'succeeded',
          quality: draft.quality,
          outputItemIds: [...outputItemIds],
          consumedIngredientItemIds: [...draft.consumedIngredientItemIds],
        }
      : {
          outcome: 'failed',
          outputItemIds: [],
          consumedIngredientItemIds: [...draft.consumedIngredientItemIds],
          returnedIngredientItemIds: [...draft.returnedIngredientItemIds],
        };
  return {
    ...state,
    craftingAttempts: {
      ...state.craftingAttempts,
      [attempt.craftingAttemptId]: {
        ...attempt,
        status: 'resolved',
        result,
        revision: bump(attempt.revision),
      },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// §4 NPC 料理決策的規則（純解析）
// ──────────────────────────────────────────────────────────────────────────
//
// doc §195：只對無 FoodStatus 的角色決策；餐館候選只在角色所在城市的 Inn 開放時可用。
// 「哪些角色是非玩家主角」不屬 Crafting，也沒有任何模組的 Query 能枚舉它，因此每日 Job 本體
// 不在本模組閉合（見交接報告）；規則本身在此，決定性且可測。

export type NpcCuisineDecision =
  | Readonly<{ kind: 'skip'; reason: 'foodStatusActive' }>
  | Readonly<{ kind: 'decided'; choice: 'selfCooked' | 'restaurant'; nextRngCursor: RngContext['cursor'] }>;

export function decideNpcCuisine(
  input: Readonly<{
    characterId: CharacterId;
    cityId: CityId;
    ruleId: NpcCuisineDecisionRuleId;
  }>,
  state: CraftingState,
  ctx: CraftingHandlerContext,
): NpcCuisineDecision {
  if (hasActiveFoodStatus(state, input.characterId, ctx.worldDay)) {
    return { kind: 'skip', reason: 'foodStatusActive' };
  }
  const rule = ctx.definitions.getNpcCuisineDecisionRule(input.ruleId);
  const step = ctx.resolvers.resolveNpcCuisineChoice({
    ruleId: input.ruleId,
    selfCookWeightResolverId: rule.selfCookWeightResolverId,
    restaurantWeightResolverId: rule.restaurantWeightResolverId,
    characterId: input.characterId,
    cityId: input.cityId,
    restaurantAvailable: ctx.city.canUseRestaurant(input.cityId, input.characterId),
    rngContext: ctx.rngContext,
  });
  return { kind: 'decided', choice: step.value, nextRngCursor: step.nextCursor };
}
