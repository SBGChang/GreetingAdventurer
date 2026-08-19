// modules/crafting/state.ts
// Crafting 唯一可寫 Slice 的初始工廠與純函式讀寫／結構小工具。
// Slice 型別權威在 contracts/crafting；此處不重新定義，只 re-export + 提供 immutable helper。
//
// 設計原則：
//   * 全部為決定性純函式；不 mutate 傳入 Slice，一律回傳新物件。
//   * 本檔只放「結構」——品質階梯與詞條階級域是 doc §2.1／§2.3 明訂的列舉語意，
//     換一份 Content Pack 也不會變（會變的是機率與階級門檻，那些在 Resolver params 裡）。

import type { CharacterId, CraftingAttemptId, FreeActionId, WorldDay } from '../../contracts/core';
import type {
  CraftingState,
  CraftingAttempt,
  CraftQuality,
  FoodStatus,
} from '../../contracts/crafting';

export type { CraftingState };

// ── 空 Slice ─────────────────────────────────────────────────────────────────

export const emptyCraftingState: CraftingState = Object.freeze({
  foodStatuses: Object.freeze({}),
  craftingAttempts: Object.freeze({}),
}) as CraftingState;

export function createCraftingState(
  input: Readonly<{
    foodStatuses?: readonly FoodStatus[];
    craftingAttempts?: readonly CraftingAttempt[];
  }> = {},
): CraftingState {
  const foodStatuses: Record<CharacterId, FoodStatus | undefined> = {};
  for (const s of input.foodStatuses ?? []) foodStatuses[s.characterId] = s;

  const craftingAttempts: Record<CraftingAttemptId, CraftingAttempt> = {};
  for (const a of input.craftingAttempts ?? []) craftingAttempts[a.craftingAttemptId] = a;

  return { foodStatuses, craftingAttempts };
}

export function createInitialCraftingState(): CraftingState {
  return createCraftingState();
}

// ── FoodStatus 純函式讀寫 ────────────────────────────────────────────────────

export function tryGetFoodStatus(state: CraftingState, id: CharacterId): FoodStatus | undefined {
  return state.foodStatuses[id];
}

export function upsertFoodStatus(state: CraftingState, next: FoodStatus): CraftingState {
  return {
    ...state,
    foodStatuses: { ...state.foodStatuses, [next.characterId]: next },
  };
}

// 刪除鍵而非寫 undefined：`Record<CharacterId, FoodStatus | undefined>` 兩者讀起來一樣，
// 但存檔序列化與 `Object.keys` 走訪會看得出差別（留一個 undefined 值等於留一筆空記錄）。
export function removeFoodStatus(state: CraftingState, id: CharacterId): CraftingState {
  if (state.foodStatuses[id] === undefined) return state;
  const foodStatuses: Record<CharacterId, FoodStatus | undefined> = { ...state.foodStatuses };
  delete foodStatuses[id];
  return { ...state, foodStatuses };
}

// doc §3：「expiresOnDay 當日仍有效」。不變量 1 的判定點：有未到期 FoodStatus 即不可製作／購餐。
export function isFoodStatusActive(status: FoodStatus, onDay: WorldDay): boolean {
  return status.expiresOnDay >= onDay;
}

export function hasActiveFoodStatus(
  state: CraftingState,
  characterId: CharacterId,
  onDay: WorldDay,
): boolean {
  const status = tryGetFoodStatus(state, characterId);
  return status !== undefined && isFoodStatusActive(status, onDay);
}

// ── CraftingAttempt 純函式讀寫 ───────────────────────────────────────────────

export function tryGetAttempt(
  state: CraftingState,
  id: CraftingAttemptId,
): CraftingAttempt | undefined {
  return state.craftingAttempts[id];
}

export function requireAttempt(state: CraftingState, id: CraftingAttemptId): CraftingAttempt {
  const found = state.craftingAttempts[id];
  if (found === undefined) {
    throw new Error(`CraftingState: unknown craftingAttemptId "${String(id)}"`);
  }
  return found;
}

export function upsertAttempt(state: CraftingState, next: CraftingAttempt): CraftingState {
  return {
    ...state,
    craftingAttempts: { ...state.craftingAttempts, [next.craftingAttemptId]: next },
  };
}

export function listAttempts(state: CraftingState): readonly CraftingAttempt[] {
  return Object.values(state.craftingAttempts);
}

// doc §174：製作時間由 Team 的 MemberFreeAction 管理，結算由該筆 FreeActionCompleted 觸發。
// Attempt 以 freeActionId 回連，所以結算入口用它定址。
export function findScheduledAttemptByFreeAction(
  state: CraftingState,
  freeActionId: FreeActionId,
): CraftingAttempt | undefined {
  return listAttempts(state).find(
    (a) => a.freeActionId === freeActionId && a.status === 'scheduled',
  );
}

// 同一角色至多一筆進行中的耗時製作（doc §191 前置條件「沒有未完成的耗時自由行動」）。
// FreeActionCompleted 不帶 freeActionId／craftingAttemptId，因此結算端需要這條 (角色, 配方) 相關性。
export function listScheduledAttemptsForCharacter(
  state: CraftingState,
  characterId: CharacterId,
): readonly CraftingAttempt[] {
  return listAttempts(state).filter(
    (a) => a.characterId === characterId && a.status === 'scheduled',
  );
}

// ── 結構列舉：品質階梯與料理詞條階級域 ──────────────────────────────────────

// doc §2.1 把「品質 → 成功繼承詞條數」寫成固定對照：plain=0、fine=1、excellent=2、perfect=3、
// peerless=4、demonGod=5。它就是 CraftQuality 這個階梯的**序位**，不是另一張可調表——
// 所以這裡以有序元組表達，詞條數＝序位。要改的是「骰到哪一級」的機率（在 CraftQualityRule 的
// Resolver params），不是「fine 帶幾條」。
export const CRAFT_QUALITY_LADDER = [
  'plain',
  'fine',
  'excellent',
  'perfect',
  'peerless',
  'demonGod',
] as const satisfies readonly CraftQuality[];

export function isCraftQuality(value: string): value is CraftQuality {
  return (CRAFT_QUALITY_LADDER as readonly string[]).includes(value);
}

// 品質可繼承的詞條數＝品質在階梯上的序位。實際帶入數另受候選詞條數限制（doc §2.1
// 「實際帶入數為 min(品質詞條數, 候選詞條數)」），由呼叫端取 min。
export function qualityAffixCapacity(quality: CraftQuality): number {
  return CRAFT_QUALITY_LADDER.indexOf(quality);
}

// FoodAffixDefinition.effectByTier 的鍵域（contracts/crafting 的 `1 | 2 | 3 | 4 | 5`）。
export type FoodAffixTier = FoodStatus['foodAffixes'][number]['tier'];

export const FOOD_AFFIX_TIERS = [1, 2, 3, 4, 5] as const satisfies readonly FoodAffixTier[];

export function isFoodAffixTier(value: number): value is FoodAffixTier {
  return (FOOD_AFFIX_TIERS as readonly number[]).includes(value);
}

// doc §2.3：「Restaurant 只提供基礎變體：同一組 FoodStatus 效果一律取最低詞條階級」。
// 「最低」＝階級域的下界，不是一個可調數字。
export function lowestFoodAffixTier(): FoodAffixTier {
  return FOOD_AFFIX_TIERS[0];
}
