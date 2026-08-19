// modules/crafting/public.ts
// Crafting 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。
// Composition 只從這裡取得工廠、Handler、Query 與 ModuleContract；不得深入 import 內部檔案。

import type {
  ModuleContract,
  ModuleId,
  StateSliceName,
  ReaderPortId,
  InvariantId,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/crafting';

// ── State ─────────────────────────────────────────────────────────────────––
export {
  emptyCraftingState,
  createCraftingState,
  createInitialCraftingState,
  tryGetFoodStatus,
  upsertFoodStatus,
  removeFoodStatus,
  isFoodStatusActive,
  hasActiveFoodStatus,
  tryGetAttempt,
  requireAttempt,
  upsertAttempt,
  listAttempts,
  findScheduledAttemptByFreeAction,
  listScheduledAttemptsForCharacter,
  CRAFT_QUALITY_LADDER,
  isCraftQuality,
  qualityAffixCapacity,
  FOOD_AFFIX_TIERS,
  isFoodAffixTier,
  lowestFoodAffixTier,
} from './state';
export type { CraftingState, FoodAffixTier } from './state';

// ── Query ─────────────────────────────────────────────────────────────────––
export { createCraftingQuery } from './queries';

// ── System（Handler + Job + 領域解析 + Port 宣告）────────────────────────────
export {
  CRAFTING_MODULE_ID,
  // Job handler（已閉合，登記於下方 ModuleContract）
  handleFoodStatusExpiry,
  // Game Command handler（依賴 inventory 的 ConsumeCuisineIngredients Handler；見交接報告）
  handleCookCuisine,
  // 製作結算的領域規則與相關性查找（跨模組編排屬 Workflow；見交接報告）
  resolveCraftingAttempt,
  applyCraftingResolution,
  findCraftAttemptForFreeAction,
  // NPC 料理決策規則
  decideNpcCuisine,
} from './system';
export type {
  CraftingHandlerContext,
  CraftingHandlerResult,
  CraftingProgressionPort,
  CraftingInventoryPort,
  CraftingCityPort,
  CraftingResolverPort,
  CraftOutcomeDraft,
  CraftingResolutionDraft,
  CraftingResolutionOutcome,
  CraftingOutputDraft,
  MasteryLevelSnapshot,
  IngredientSlotLike,
  IngredientAssignment,
  NpcCuisineDecision,
} from './system';

// ── ModuleContract 宣告 ──────────────────────────────────────────────────────
//
// **只登記已閉合的能力。** 本模組的四項對外能力裡只有 `foodStatusExpiry` 的宣告依賴全部到位
// （自己的 Reader + character 的 ApplyFoodStatusEffects Handler）。其餘三項的接收端或編排點
// 還不存在，因此不出現在這裡、不進 Manifest、Router 不會有入口——交接報告逐項列出卡在哪個缺口。
export const craftingModuleContract: ModuleContract = {
  id: 'crafting' as ModuleId<'crafting'>,
  owns: 'crafting' as StateSliceName,
  reads: [
    'reader:crafting-definition' as ReaderPortId,
    'reader:progression-query' as ReaderPortId,
    'reader:inventory-query' as ReaderPortId,
    'reader:city-query' as ReaderPortId,
  ],
  handlesGameCommands: [],
  handlesInternalCommands: [],
  handlesJobs: ['foodStatusExpiry'],
  sendsInternalCommands: ['ApplyFoodStatusEffects'],
  subscriptionHandlerIds: [],
  emits: ['FoodStatusChanged'],
  invariants: [
    'crafting.atMostOneFoodStatusPerCharacter' as InvariantId,
    'crafting.foodStatusNotOverwrittenWhileActive' as InvariantId,
    'crafting.foodStatusExpiryIsInclusive' as InvariantId,
    'crafting.equipmentAffixAtMostOnePerMaterial' as InvariantId,
    'crafting.consumableCarriesNoAffixOnlyYield' as InvariantId,
    'crafting.tradeGoodCarriesNoAffix' as InvariantId,
    'crafting.outcomePartitionsReservedIngredients' as InvariantId,
    'crafting.failureCreatesNoOutputAndKeepsSameExperienceRule' as InvariantId,
  ],
};

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是模組的**正式對外面**；從這裡再匯出 fixtures 會讓正式依賴圖走到測試資料
// （規範 §13 的判準是「只要正式程式**可以**引用就算違反」）。
// 測試請直接 import './fixtures' 與 './crafting.test'。
