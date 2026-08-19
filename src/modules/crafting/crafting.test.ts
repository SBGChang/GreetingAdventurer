// modules/crafting/crafting.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。

import type {
  CharacterId,
  FreeActionId,
  ItemInstanceId,
  Revision,
  TeamId,
  TransactionMessageDraft,
  WorldDay,
} from '../../contracts/core';
import type {
  CookCuisineCommand,
  CraftingDomainEvent,
  CraftingRecipeDefinition,
  CuisineRecipeDefinition,
  FoodStatusExpiryJob,
} from '../../contracts/crafting';
import type { ApplyFoodStatusEffects } from '../../contracts/character';
import type { ConsumeCuisineIngredients } from '../../contracts/inventory';
import type { FreeActionCompletedEvent, FreeActionRuleId } from '../../contracts/team';

import type { CraftingHandlerResult } from './system';
import {
  CRAFTING_MODULE_ID,
  applyCraftingResolution,
  decideNpcCuisine,
  findCraftAttemptForFreeAction,
  handleCookCuisine,
  handleFoodStatusExpiry,
  resolveCraftingAttempt,
} from './system';
import { createCraftingQuery } from './queries';
import {
  CRAFT_QUALITY_LADDER,
  hasActiveFoodStatus,
  isFoodAffixTier,
  lowestFoodAffixTier,
  qualityAffixCapacity,
  removeFoodStatus,
  tryGetFoodStatus,
  findScheduledAttemptByFreeAction,
} from './state';
import {
  AFFIX_PLAIN_ORE,
  ATTEMPT_ID,
  CHARACTER_ID,
  CITY_ID,
  COOK_MASTERY,
  CRAFT_EXP_RULE,
  COOK_EXP_RULE,
  CULTURE_ID,
  EFFECT_BASE,
  EFFECT_TIER_1,
  EFFECT_TIER_2,
  FOOD_AFFIX_ID,
  FREE_ACTION_ID,
  ITEM_DEF_MEAT,
  ITEM_MEAT_1,
  ITEM_MEAT_2,
  ITEM_ORE_1,
  ITEM_ORE_2,
  ITEM_ORE_3,
  ITEM_SCROLL_1,
  OTHER_CHARACTER_ID,
  NPC_CUISINE_RULE_ID,
  RECIPE_FOREIGN_SWORD,
  RECIPE_POTION,
  RECIPE_POTION_DEF,
  RECIPE_STEW,
  RECIPE_STEW_DEF,
  RECIPE_SWORD,
  RECIPE_VASE,
  RECIPE_VASE_DEF,
  SLOT_FOOD,
  STATUS_BASE,
  STATUS_TIER_1,
  STATUS_TIER_2,
  TAG_MEAT,
  emptyResolverLog,
  fixtureAttempt,
  fixtureCraftingState,
  fixtureFoodStatus,
  itemView,
  makeContext,
  reservedOreItems,
  stubCity,
  stubDefinitionReader,
  stubInventory,
  stubProgression,
  stubResolvers,
  stubRngContext,
  ITEM_DEF_ORE,
} from './fixtures';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────────

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function expectOk(r: CraftingHandlerResult, label: string) {
  if (!r.ok) throw new Error(`${label}: expected accept, got reject ${r.rejection.code}`);
  return r.result;
}

function expectReject(r: CraftingHandlerResult, code: string, label: string): void {
  if (r.ok) throw new Error(`${label}: expected reject '${code}', got accept`);
  assert(
    r.rejection.code === code,
    `${label}: expected code '${code}', got '${r.rejection.code}'`,
  );
  assert(r.rejection.source === CRAFTING_MODULE_ID, `${label}: rejection.source 應為 crafting`);
}

function eventsOf(messages: readonly TransactionMessageDraft[]): CraftingDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as CraftingDomainEvent);
}

function commandsOf(messages: readonly TransactionMessageDraft[]): { targetModule: string; command: { type: string } }[] {
  return messages
    .filter((m): m is { targetModule: never; command: unknown } => 'command' in m)
    .map((m) => ({ targetModule: String(m.targetModule), command: m.command as { type: string } }));
}

function findEvent<K extends CraftingDomainEvent['type']>(
  events: readonly CraftingDomainEvent[],
  type: K,
): Extract<CraftingDomainEvent, { type: K }> | undefined {
  return events.find((e) => e.type === type) as Extract<CraftingDomainEvent, { type: K }> | undefined;
}

function findCommand(
  messages: readonly TransactionMessageDraft[],
  type: string,
): { targetModule: string; command: { type: string } } | undefined {
  return commandsOf(messages).find((c) => c.command.type === type);
}

// ── 共用建構子 ───────────────────────────────────────────────────────────────

const TEAM_ID = 'team-1' as TeamId;
const CRAFT_RULE_ID = 'free-action-rule-craft' as FreeActionRuleId;

function cook(ingredientItemIds: readonly ItemInstanceId[] = [ITEM_MEAT_1]): CookCuisineCommand {
  return { type: 'cookCuisine', characterId: CHARACTER_ID, recipeId: RECIPE_STEW, ingredientItemIds: [...ingredientItemIds] };
}

function expiryJob(
  overrides: Partial<FoodStatusExpiryJob> = {},
): FoodStatusExpiryJob {
  return {
    jobId: (overrides.jobId ?? 'job-1') as FoodStatusExpiryJob['jobId'],
    type: 'foodStatusExpiry',
    dueDay: overrides.dueDay ?? (103 as WorldDay),
    ownerModule: CRAFTING_MODULE_ID,
    targetId: overrides.targetId ?? CHARACTER_ID,
    ...(overrides.expectedRevision === undefined ? {} : { expectedRevision: overrides.expectedRevision }),
    payload: {},
  };
}

function freeActionCompleted(
  memberId: CharacterId = CHARACTER_ID,
): FreeActionCompletedEvent {
  return {
    type: 'FreeActionCompleted',
    teamId: TEAM_ID,
    memberId,
    ruleId: CRAFT_RULE_ID,
    payload: { kind: 'craft', recipeId: RECIPE_SWORD },
  };
}

// 兩格食材（各 1 份）的料理食譜：用來釘住「逐條詞條各前進一次 cursor」。
const RECIPE_STEW_TWO_SLOTS: CuisineRecipeDefinition = {
  ...RECIPE_STEW_DEF,
  ingredientSlots: [{ slotId: SLOT_FOOD, acceptedMaterialTagIds: [TAG_MEAT], quantity: 2 }],
};

// ── 案例 ─────────────────────────────────────────────────────────────────────

const cases: readonly Readonly<{ name: string; run: () => void }>[] = [
  // ── Job：foodStatusExpiry（唯一已閉合的登記能力）─────────────────────────
  {
    name: 'foodStatusExpiry：移除 FoodStatus、送 ApplyFoodStatusEffects(remove) 帶已對照的 statusIds、公告 expired',
    run: () => {
      const status = fixtureFoodStatus();
      const state = fixtureCraftingState({ foodStatuses: [status] });
      const r = expectOk(
        handleFoodStatusExpiry(expiryJob({ expectedRevision: 0 as Revision }), state, makeContext({ worldDay: 103 as WorldDay })),
        'expiry',
      );
      assert(tryGetFoodStatus(r.nextSlice, CHARACTER_ID) === undefined, 'FoodStatus 應被移除');

      const cmd = findCommand(r.outgoingMessages, 'ApplyFoodStatusEffects');
      assert(cmd !== undefined, '應送出 ApplyFoodStatusEffects');
      assert(cmd!.targetModule === 'character', `應送給 character（實得 ${cmd!.targetModule}）`);
      const apply = cmd!.command as ApplyFoodStatusEffects;
      assert(apply.operation === 'remove', `operation 應為 remove（實得 ${apply.operation}）`);
      // A1：送出端已把 EffectDefinitionId 對照成 CharacterStatusDefinitionId。
      assert(
        apply.statusIds.length === 2 &&
          String(apply.statusIds[0]) === String(STATUS_BASE) &&
          String(apply.statusIds[1]) === String(STATUS_TIER_2),
        `statusIds 應為 [${String(STATUS_BASE)}, ${String(STATUS_TIER_2)}]，實得 ${apply.statusIds.map(String).join(',')}`,
      );
      assert(apply.foodStatusRevision === status.revision, 'foodStatusRevision 應為該 FoodStatus 的 revision');

      const expired = findEvent(eventsOf(r.outgoingMessages), 'FoodStatusChanged');
      assert(expired !== undefined && expired.state === 'expired', '應 emit FoodStatusChanged(expired)');
      assert(expired!.expiresOnDay === undefined, 'expired 事件不需帶 expiresOnDay');
    },
  },
  {
    name: 'foodStatusExpiry：無 FoodStatus 時冪等成功（同一輸入重複執行結果相同、不再送命令）',
    run: () => {
      const state = fixtureCraftingState();
      const first = expectOk(handleFoodStatusExpiry(expiryJob(), state, makeContext({ worldDay: 103 as WorldDay })), 'first');
      assert(first.nextSlice === state, '冪等時應原樣回傳同一份 Slice');
      assert(first.outgoingMessages.length === 0, '冪等時不得送出任何訊息');
      const second = expectOk(
        handleFoodStatusExpiry(expiryJob(), first.nextSlice, makeContext({ worldDay: 103 as WorldDay })),
        'second',
      );
      assert(second.nextSlice === state, '第二次仍應冪等');
      assert(second.outgoingMessages.length === 0, '第二次仍不得送出訊息');
    },
  },
  {
    name: 'foodStatusExpiry：expectedRevision 對不上 → 舊到期單作廢，不誤刪之後那筆 FoodStatus',
    run: () => {
      const status = fixtureFoodStatus({ revision: 3 as Revision });
      const state = fixtureCraftingState({ foodStatuses: [status] });
      const r = expectOk(
        handleFoodStatusExpiry(expiryJob({ expectedRevision: 0 as Revision }), state, makeContext({ worldDay: 103 as WorldDay })),
        'stale',
      );
      assert(tryGetFoodStatus(r.nextSlice, CHARACTER_ID) !== undefined, '不得移除較新的 FoodStatus');
      assert(r.outgoingMessages.length === 0, '作廢的 Job 不得送出命令');
    },
  },
  {
    name: 'foodStatusExpiry：未到期就執行 → typed rejection（crafting/food-status-not-expired）',
    run: () => {
      const state = fixtureCraftingState({ foodStatuses: [fixtureFoodStatus()] });
      // expiresOnDay = 102；doc §3「當日仍有效」，因此第 102 天不得移除。
      expectReject(
        handleFoodStatusExpiry(expiryJob({ dueDay: 102 as WorldDay }), state, makeContext({ worldDay: 102 as WorldDay })),
        'crafting/food-status-not-expired',
        'not-expired',
      );
    },
  },

  // ── Game Command：cookCuisine ────────────────────────────────────────────
  {
    name: 'cookCuisine：建立 FoodStatus（含期限、詞條、效果）、送 ConsumeCuisineIngredients 與 ApplyFoodStatusEffects(apply)、排 expiry、發 CuisineConsumed(x1)',
    run: () => {
      const ctx = makeContext({ worldDay: 200 as WorldDay });
      const r = expectOk(handleCookCuisine(cook(), fixtureCraftingState(), ctx), 'cook');

      const status = tryGetFoodStatus(r.nextSlice, CHARACTER_ID);
      assert(status !== undefined, '應建立 FoodStatus');
      assert(status!.startedOnDay === 200, 'startedOnDay 應為當前世界日');
      // foodStatusDurationDays = 3，區間含端點 → 200..202。
      assert(status!.expiresOnDay === 202, `expiresOnDay 應為 202（實得 ${status!.expiresOnDay}）`);
      assert(String(status!.originCultureId) === String(CULTURE_ID), '料理文化固定為食譜 originCultureId');
      assert(status!.source.kind === 'selfCooked', 'source 應為 selfCooked');
      assert(status!.foodAffixes.length === 1, `應有 1 條料理詞條（實得 ${status!.foodAffixes.length}）`);
      assert(String(status!.foodAffixes[0]!.foodAffixId) === String(FOOD_AFFIX_ID), '詞條方向由食材決定');
      // cursor 0 → tier (0 % 5) + 1 = 1
      assert(status!.foodAffixes[0]!.tier === 1, `tier 應為 1（實得 ${status!.foodAffixes[0]!.tier}）`);
      assert(
        status!.appliedEffectIds.length === 2 &&
          String(status!.appliedEffectIds[0]) === String(EFFECT_BASE) &&
          String(status!.appliedEffectIds[1]) === String(EFFECT_TIER_1),
        '效果 = 基礎效果 + 該階級的詞條效果',
      );

      const consume = findCommand(r.outgoingMessages, 'ConsumeCuisineIngredients');
      assert(consume !== undefined && consume.targetModule === 'inventory', '應向 inventory 送 ConsumeCuisineIngredients');
      const consumePayload = consume!.command as ConsumeCuisineIngredients;
      assert(
        consumePayload.ingredientItemIds.length === 1 &&
          String(consumePayload.ingredientItemIds[0]) === String(ITEM_MEAT_1),
        '素材消耗清單應原樣轉給 inventory（本模組不寫 inventory Slice）',
      );

      const apply = findCommand(r.outgoingMessages, 'ApplyFoodStatusEffects');
      assert(apply !== undefined && apply.targetModule === 'character', '應向 character 送 ApplyFoodStatusEffects');
      const applyPayload = apply!.command as ApplyFoodStatusEffects;
      assert(applyPayload.operation === 'apply', 'operation 應為 apply');
      assert(
        applyPayload.statusIds.map(String).join(',') === [STATUS_BASE, STATUS_TIER_1].map(String).join(','),
        `statusIds 應為對照後的角色狀態（實得 ${applyPayload.statusIds.map(String).join(',')}）`,
      );

      const applied = findEvent(eventsOf(r.outgoingMessages), 'FoodStatusChanged');
      assert(applied !== undefined && applied.state === 'applied' && applied.expiresOnDay === 202, '應 emit FoodStatusChanged(applied)');

      const consumed = findEvent(eventsOf(r.outgoingMessages), 'CuisineConsumed');
      assert(consumed !== undefined, '應 emit CuisineConsumed');
      assert(consumed!.source === 'selfCooked', 'source 應為 selfCooked');
      assert(String(consumed!.experienceRuleId) === String(COOK_EXP_RULE), 'MXP 規則取自食譜');
      assert(consumed!.experienceMultiplier === 1, '自製料理倍率為 1（乘法單位元）');

      assert(r.scheduledJobs.length === 1, '應排一筆 foodStatusExpiry');
      const job = r.scheduledJobs[0]!;
      assert(job.type === 'foodStatusExpiry', `Job 型別應為 foodStatusExpiry（實得 ${job.type}）`);
      assert(job.dueDay === 203, `expiry 應排在 expiresOnDay + 1 = 203（實得 ${job.dueDay}）`);
      assert(job.expectedRevision === status!.revision, 'Job 應帶 FoodStatus 的 revision 作為過期 token');
    },
  },
  {
    name: 'cookCuisine：已有未到期 FoodStatus → 拒絕且不覆蓋（不變量 1）',
    run: () => {
      const existing = fixtureFoodStatus({ expiresOnDay: 205 as WorldDay });
      const state = fixtureCraftingState({ foodStatuses: [existing] });
      const r = handleCookCuisine(cook(), state, makeContext({ worldDay: 200 as WorldDay }));
      expectReject(r, 'crafting/food-status-active', 'active');
      assert(tryGetFoodStatus(state, CHARACTER_ID) === existing, '舊狀態必須原封不動');
    },
  },
  {
    name: 'cookCuisine：expiresOnDay 當日仍有效（邊界）；隔日才可再自製',
    run: () => {
      const state = fixtureCraftingState({ foodStatuses: [fixtureFoodStatus({ expiresOnDay: 202 as WorldDay })] });
      expectReject(
        handleCookCuisine(cook(), state, makeContext({ worldDay: 202 as WorldDay })),
        'crafting/food-status-active',
        'boundary-same-day',
      );
      // 第 203 天：舊狀態已過期（尚未被 expiry Job 清掉也不該擋住）。
      expectOk(handleCookCuisine(cook(), state, makeContext({ worldDay: 203 as WorldDay })), 'boundary-next-day');
    },
  },
  {
    name: 'cookCuisine：未學食譜 → crafting/cuisine-recipe-not-learned',
    run: () => {
      expectReject(
        handleCookCuisine(
          cook(),
          fixtureCraftingState(),
          makeContext({ progression: stubProgression({ learnedRecipeIds: [] }) }),
        ),
        'crafting/cuisine-recipe-not-learned',
        'not-learned',
      );
    },
  },
  {
    name: 'cookCuisine：Mastery 未達標 → crafting/mastery-requirement-unmet',
    run: () => {
      expectReject(
        handleCookCuisine(
          cook(),
          fixtureCraftingState(),
          makeContext({ progression: stubProgression({ meetsRequirements: false }) }),
        ),
        'crafting/mastery-requirement-unmet',
        'mastery',
      );
    },
  },
  {
    name: 'cookCuisine：食譜 disabled → crafting/cuisine-recipe-disabled',
    run: () => {
      expectReject(
        handleCookCuisine(
          cook(),
          fixtureCraftingState(),
          makeContext({
            definitions: stubDefinitionReader({ cuisineRecipes: [{ ...RECIPE_STEW_DEF, enabled: false }] }),
          }),
        ),
        'crafting/cuisine-recipe-disabled',
        'disabled',
      );
    },
  },
  {
    name: 'cookCuisine：foodStatusDurationDays < 1 → crafting/cuisine-duration-invalid（不給預設天數）',
    run: () => {
      expectReject(
        handleCookCuisine(
          cook(),
          fixtureCraftingState(),
          makeContext({
            definitions: stubDefinitionReader({
              cuisineRecipes: [{ ...RECIPE_STEW_DEF, foodStatusDurationDays: 0 }],
            }),
          }),
        ),
        'crafting/cuisine-duration-invalid',
        'duration',
      );
    },
  },
  {
    name: 'cookCuisine：食材合法性的六種拒絕（不存在／非 active／已保留／非本人持有／重複／非素材）',
    run: () => {
      const ghost = 'item-ghost' as ItemInstanceId;
      expectReject(handleCookCuisine(cook([ghost]), fixtureCraftingState(), makeContext()), 'crafting/ingredient-not-found', 'not-found');

      expectReject(
        handleCookCuisine(
          cook(),
          fixtureCraftingState(),
          makeContext({
            inventory: stubInventory([itemView({ itemId: ITEM_MEAT_1, definitionId: ITEM_DEF_MEAT, state: 'consumed' })]),
          }),
        ),
        'crafting/ingredient-not-active',
        'not-active',
      );

      expectReject(
        handleCookCuisine(
          cook(),
          fixtureCraftingState(),
          makeContext({
            inventory: stubInventory([
              itemView({
                itemId: ITEM_MEAT_1,
                definitionId: ITEM_DEF_MEAT,
                reservation: { kind: 'pendingTransfer', ownerId: CHARACTER_ID, reservedQuantity: 1 },
              }),
            ]),
          }),
        ),
        'crafting/ingredient-reserved',
        'reserved',
      );

      expectReject(
        handleCookCuisine(
          cook(),
          fixtureCraftingState(),
          makeContext({
            inventory: stubInventory([
              itemView({ itemId: ITEM_MEAT_1, definitionId: ITEM_DEF_MEAT, ownerCharacterId: OTHER_CHARACTER_ID }),
            ]),
          }),
        ),
        'crafting/ingredient-not-held',
        'not-held',
      );

      expectReject(
        handleCookCuisine(cook([ITEM_MEAT_1, ITEM_MEAT_1]), fixtureCraftingState(), makeContext()),
        'crafting/ingredient-duplicated',
        'duplicated',
      );

      expectReject(
        handleCookCuisine(cook([ITEM_SCROLL_1]), fixtureCraftingState(), makeContext()),
        'crafting/ingredient-not-material',
        'not-material',
      );
    },
  },
  {
    name: 'cookCuisine：素材槽必須恰好填滿（填不滿 → slot-unfilled；有剩餘 → ingredient-unused）',
    run: () => {
      expectReject(
        handleCookCuisine(cook([ITEM_ORE_2]), fixtureCraftingState(), makeContext()),
        'crafting/slot-unfilled',
        'unfilled',
      );
      expectReject(
        handleCookCuisine(cook([ITEM_MEAT_1, ITEM_MEAT_2]), fixtureCraftingState(), makeContext()),
        'crafting/ingredient-unused',
        'unused',
      );
    },
  },
  {
    name: 'cookCuisine：素材詞條宣稱可用於 cuisine 卻沒有 foodAffixId → 壞內容明確拒絕',
    run: () => {
      expectReject(
        handleCookCuisine(
          cook(),
          fixtureCraftingState(),
          makeContext({
            definitions: stubDefinitionReader({
              itemViews: [
                { itemDefinitionId: ITEM_DEF_MEAT, originCultureId: CULTURE_ID, materialTagIds: [TAG_MEAT], materialAffixId: AFFIX_PLAIN_ORE },
              ],
            }),
          }),
        ),
        'crafting/material-affix-missing-food-affix',
        'broken-affix',
      );
    },
  },
  {
    name: 'cookCuisine：Resolver 給出階級域外的 tier → crafting/food-affix-tier-out-of-range（不夾限、不預設）',
    run: () => {
      expectReject(
        handleCookCuisine(
          cook(),
          fixtureCraftingState(),
          makeContext({ resolvers: stubResolvers({ tier: () => 9 }) }),
        ),
        'crafting/food-affix-tier-out-of-range',
        'tier-range',
      );
    },
  },
  {
    name: 'cookCuisine：RNG 決定性（同 cursor 同結果）且 cursor 逐條前進（不重用 cursor 0）',
    run: () => {
      const definitions = stubDefinitionReader({ cuisineRecipes: [RECIPE_STEW_TWO_SLOTS] });
      const log = emptyResolverLog();
      const r = expectOk(
        handleCookCuisine(
          cook([ITEM_MEAT_1, ITEM_MEAT_2]),
          fixtureCraftingState(),
          makeContext({ definitions, resolvers: stubResolvers({ log }), rngContext: stubRngContext(0) }),
        ),
        'two-affix',
      );
      assert(log.tierCursors.length === 2, `應擲兩次階級（實得 ${log.tierCursors.length}）`);
      assert(
        log.tierCursors[0] === 0 && log.tierCursors[1] === 1,
        `cursor 應逐次前進 0 → 1（實得 ${log.tierCursors.join(',')}）`,
      );
      const tiers = tryGetFoodStatus(r.nextSlice, CHARACTER_ID)!.foodAffixes.map((a) => a.tier);
      assert(tiers.join(',') === '1,2', `不同 cursor 應得不同階級（實得 ${tiers.join(',')}）`);

      // 同 cursor 同結果。
      const again = expectOk(
        handleCookCuisine(
          cook([ITEM_MEAT_1, ITEM_MEAT_2]),
          fixtureCraftingState(),
          makeContext({ definitions, resolvers: stubResolvers(), rngContext: stubRngContext(0) }),
        ),
        'two-affix-repeat',
      );
      assert(
        tryGetFoodStatus(again.nextSlice, CHARACTER_ID)!.foodAffixes.map((a) => a.tier).join(',') === '1,2',
        '同 cursor 應得完全相同的階級序列',
      );

      // 換起始 cursor → 不同結果（證明真的在用注入的 cursor）。
      const shifted = expectOk(
        handleCookCuisine(
          cook([ITEM_MEAT_1, ITEM_MEAT_2]),
          fixtureCraftingState(),
          makeContext({ definitions, resolvers: stubResolvers(), rngContext: stubRngContext(2) }),
        ),
        'two-affix-shifted',
      );
      assert(
        tryGetFoodStatus(shifted.nextSlice, CHARACTER_ID)!.foodAffixes.map((a) => a.tier).join(',') === '3,4',
        '起始 cursor 改變時結果必須跟著改變',
      );
    },
  },

  // ── 製作結算的領域規則 ───────────────────────────────────────────────────
  {
    name: 'resolveCraftingAttempt(equipment)：品質由 Resolver 決定，帶入詞條數 = min(品質序位, 候選數)，且只算 contributesEquipmentAffix 的槽',
    run: () => {
      const ctx = makeContext({ inventory: stubInventory(reservedOreItems()), rngContext: stubRngContext(0) });
      const out = resolveCraftingAttempt(fixtureAttempt(), ctx);
      assert(out.ok, `應成功解析（實得 ${out.ok ? 'ok' : out.code}）`);
      if (!out.ok) return;
      // cursor 0 → outcome；cursor 1 → quality → ladder[1] = 'fine'（序位 1）。
      assert(out.draft.quality === 'fine', `品質應為 fine（實得 ${out.draft.quality}）`);
      assert(out.draft.outcome === 'succeeded', 'outcome 應為 succeeded');
      assert(out.draft.outputs.length === 1, '成功應產出一件裝備');
      const data = out.draft.outputs[0]!.instanceData;
      assert(data !== undefined && data.kind === 'craftedEquipment', 'instanceData 應為 craftedEquipment');
      if (data === undefined || data.kind !== 'craftedEquipment') return;
      // SLOT_MAIN 兩份礦石（contributes）→ 候選 2；fine 的序位 1 → 帶入 1。SLOT_TRIM 不貢獻。
      assert(
        data.inheritedMaterialAffixIds.length === 1,
        `應帶入 1 條詞條（實得 ${data.inheritedMaterialAffixIds.length}）`,
      );
      assert(data.quality === 'fine', 'instanceData 應帶同一個品質');
      assert(String(out.draft.experienceRuleId) === String(CRAFT_EXP_RULE), 'MXP 規則取自配方');
    },
  },
  {
    name: 'resolveCraftingAttempt：demonGod 時帶入數受候選數上限（min 的另一側）',
    run: () => {
      const ctx = makeContext({
        inventory: stubInventory(reservedOreItems()),
        resolvers: stubResolvers({ quality: () => 'demonGod' }),
      });
      const out = resolveCraftingAttempt(fixtureAttempt(), ctx);
      assert(out.ok, 'should resolve');
      if (!out.ok) return;
      const data = out.draft.outputs[0]!.instanceData;
      if (data === undefined || data.kind !== 'craftedEquipment') throw new Error('expected craftedEquipment');
      assert(
        data.inheritedMaterialAffixIds.length === 2,
        `demonGod 序位 5 但候選只有 2 → 應帶入 2（實得 ${data.inheritedMaterialAffixIds.length}）`,
      );
    },
  },
  {
    name: 'resolveCraftingAttempt(consumable)：無前綴詞條，品質只轉成產量（不變量 4）',
    run: () => {
      const attempt = fixtureAttempt({ recipeId: RECIPE_POTION, ingredientItemIds: [ITEM_ORE_1] });
      const out = resolveCraftingAttempt(attempt, makeContext({ inventory: stubInventory(reservedOreItems()) }));
      assert(out.ok, 'should resolve');
      if (!out.ok) return;
      assert(out.draft.outputs.length === 1, '應有一筆產出');
      assert(out.draft.outputs[0]!.instanceData === undefined, '消耗品不得帶 instanceData（無品質前綴／無詞條）');
      // stub 產量 = 1 + Σ mastery level（SMITH=5）= 6
      assert(out.draft.outputs[0]!.quantity === 6, `產量應由 Yield Resolver 決定（實得 ${out.draft.outputs[0]!.quantity}）`);
    },
  },
  {
    name: 'resolveCraftingAttempt(consumable)：缺 Yield Resolver 或產量非法 → 明確拒絕',
    run: () => {
      const noResolver: CraftingRecipeDefinition = { ...RECIPE_POTION_DEF, consumableYieldResolverId: undefined };
      const attempt = fixtureAttempt({ recipeId: RECIPE_POTION, ingredientItemIds: [ITEM_ORE_1] });
      const a = resolveCraftingAttempt(
        attempt,
        makeContext({ definitions: stubDefinitionReader({ craftingRecipes: [noResolver] }) }),
      );
      assert(!a.ok && a.code === 'crafting/consumable-yield-resolver-missing', `實得 ${a.ok ? 'ok' : a.code}`);

      const b = resolveCraftingAttempt(
        attempt,
        makeContext({ resolvers: stubResolvers({ consumableYield: () => 0 }) }),
      );
      assert(!b.ok && b.code === 'crafting/consumable-yield-invalid', `實得 ${b.ok ? 'ok' : b.code}`);
    },
  },
  {
    name: 'resolveCraftingAttempt(tradeGood)：帶品質與出售倍率 Resolver，絕不帶素材詞條（不變量 5）',
    run: () => {
      const attempt = fixtureAttempt({ recipeId: RECIPE_VASE, ingredientItemIds: [ITEM_ORE_1] });
      const out = resolveCraftingAttempt(attempt, makeContext({ inventory: stubInventory(reservedOreItems()) }));
      assert(out.ok, 'should resolve');
      if (!out.ok) return;
      const data = out.draft.outputs[0]!.instanceData;
      assert(data !== undefined && data.kind === 'craftedTradeGood', 'instanceData 應為 craftedTradeGood');
      if (data === undefined || data.kind !== 'craftedTradeGood') return;
      assert(data.quality === out.draft.quality, '工藝品仍有製作品質');
      assert('inheritedMaterialAffixIds' in data === false, '工藝品不得有素材詞條欄位');

      const missing = resolveCraftingAttempt(
        attempt,
        makeContext({
          definitions: stubDefinitionReader({
            craftingRecipes: [{ ...RECIPE_VASE_DEF, tradeGoodSaleMultiplierResolverId: undefined }],
          }),
        }),
      );
      assert(
        !missing.ok && missing.code === 'crafting/trade-good-sale-resolver-missing',
        `實得 ${missing.ok ? 'ok' : missing.code}`,
      );
    },
  },
  {
    name: 'resolveCraftingAttempt：失敗不建立產物，但用同一條 craftingExperienceRuleId（不變量 9）',
    run: () => {
      const out = resolveCraftingAttempt(
        fixtureAttempt(),
        makeContext({
          inventory: stubInventory(reservedOreItems()),
          resolvers: stubResolvers({
            outcome: () => ({
              outcome: 'failed',
              consumedIngredientItemIds: [ITEM_ORE_1],
              returnedIngredientItemIds: [ITEM_ORE_2, ITEM_ORE_3],
            }),
          }),
        }),
      );
      assert(out.ok, 'should resolve');
      if (!out.ok) return;
      assert(out.draft.outcome === 'failed', 'outcome 應為 failed');
      assert(out.draft.outputs.length === 0, '失敗不得建立產物');
      assert(String(out.draft.experienceRuleId) === String(CRAFT_EXP_RULE), '失敗仍用同一條 MXP 規則');
      assert(out.draft.returnedIngredientItemIds.length === 2, '返還素材必須完全照 Resolver 結果');
    },
  },
  {
    name: 'resolveCraftingAttempt：Outcome Resolver 的消耗／返還必須恰好切分保留快照（三種違規都擋）',
    run: () => {
      const base = { inventory: stubInventory(reservedOreItems()) };

      // 1) 數量不符（漏掉素材）
      const short = resolveCraftingAttempt(
        fixtureAttempt(),
        makeContext({
          ...base,
          resolvers: stubResolvers({
            outcome: () => ({ outcome: 'succeeded', consumedIngredientItemIds: [ITEM_ORE_1], returnedIngredientItemIds: [] }),
          }),
        }),
      );
      assert(!short.ok && short.code === 'crafting/outcome-partition-invalid', `short：實得 ${short.ok ? 'ok' : short.code}`);

      // 2) 出現快照外的素材
      const stray = resolveCraftingAttempt(
        fixtureAttempt(),
        makeContext({
          ...base,
          resolvers: stubResolvers({
            outcome: () => ({
              outcome: 'succeeded',
              consumedIngredientItemIds: [ITEM_ORE_1, ITEM_ORE_2, ITEM_MEAT_1],
              returnedIngredientItemIds: [],
            }),
          }),
        }),
      );
      assert(!stray.ok && stray.code === 'crafting/outcome-partition-invalid', `stray：實得 ${stray.ok ? 'ok' : stray.code}`);

      // 3) 成功卻有返還（CraftingAttemptResult 的 succeeded 沒有欄位可存）
      const returnedOnSuccess = resolveCraftingAttempt(
        fixtureAttempt(),
        makeContext({
          ...base,
          resolvers: stubResolvers({
            outcome: () => ({
              outcome: 'succeeded',
              consumedIngredientItemIds: [ITEM_ORE_1, ITEM_ORE_2],
              returnedIngredientItemIds: [ITEM_ORE_3],
            }),
          }),
        }),
      );
      assert(
        !returnedOnSuccess.ok && returnedOnSuccess.code === 'crafting/outcome-partition-invalid',
        `returnedOnSuccess：實得 ${returnedOnSuccess.ok ? 'ok' : returnedOnSuccess.code}`,
      );
    },
  },
  {
    name: 'resolveCraftingAttempt：Resolver 給出品質域外的值 → crafting/quality-out-of-domain',
    run: () => {
      const out = resolveCraftingAttempt(
        fixtureAttempt(),
        makeContext({
          inventory: stubInventory(reservedOreItems()),
          resolvers: stubResolvers({ quality: () => 'legendary' }),
        }),
      );
      assert(!out.ok && out.code === 'crafting/quality-out-of-domain', `實得 ${out.ok ? 'ok' : out.code}`);
    },
  },
  {
    name: 'resolveCraftingAttempt：成品文化必須與輸出 Item Definition 一致（§2.1）',
    run: () => {
      const out = resolveCraftingAttempt(
        fixtureAttempt({ recipeId: RECIPE_FOREIGN_SWORD }),
        makeContext({ inventory: stubInventory(reservedOreItems()) }),
      );
      assert(!out.ok && out.code === 'crafting/output-culture-mismatch', `實得 ${out.ok ? 'ok' : out.code}`);
    },
  },
  {
    name: 'resolveCraftingAttempt：已結算的 Attempt 不得再結算（不變量 9「只結算一次」）',
    run: () => {
      const out = resolveCraftingAttempt(
        fixtureAttempt({ status: 'resolved' }),
        makeContext({ inventory: stubInventory(reservedOreItems()) }),
      );
      assert(!out.ok && out.code === 'crafting/attempt-already-resolved', `實得 ${out.ok ? 'ok' : out.code}`);
    },
  },
  {
    name: 'resolveCraftingAttempt：RNG 決定性 + cursor 逐次前進（outcome → quality），並回傳最終 cursor',
    run: () => {
      const log = emptyResolverLog();
      const out = resolveCraftingAttempt(
        fixtureAttempt(),
        makeContext({
          inventory: stubInventory(reservedOreItems()),
          resolvers: stubResolvers({ log }),
          rngContext: stubRngContext(7),
        }),
      );
      assert(out.ok, 'should resolve');
      if (!out.ok) return;
      assert(log.outcomeCursors.join(',') === '7', `outcome 應用起始 cursor 7（實得 ${log.outcomeCursors.join(',')}）`);
      assert(log.qualityCursors.join(',') === '8', `quality 應用前進後的 cursor 8（實得 ${log.qualityCursors.join(',')}）`);
      assert((out.draft.nextRngCursor as unknown as number) === 9, `nextRngCursor 應為 9（實得 ${String(out.draft.nextRngCursor)}）`);

      const again = resolveCraftingAttempt(
        fixtureAttempt(),
        makeContext({ inventory: stubInventory(reservedOreItems()), rngContext: stubRngContext(7) }),
      );
      assert(again.ok && again.draft.quality === out.draft.quality, '同 cursor 應得同品質');
    },
  },
  {
    name: 'applyCraftingResolution：寫回結果、標記 resolved 並前進 revision',
    run: () => {
      const attempt = fixtureAttempt();
      const state = fixtureCraftingState({ craftingAttempts: [attempt] });
      const out = resolveCraftingAttempt(attempt, makeContext({ inventory: stubInventory(reservedOreItems()) }));
      assert(out.ok, 'should resolve');
      if (!out.ok) return;
      const madeItem = 'item-sword-1' as ItemInstanceId;
      const next = applyCraftingResolution(state, attempt, out.draft, [madeItem]);
      const stored = next.craftingAttempts[ATTEMPT_ID]!;
      assert(stored.status === 'resolved', 'status 應為 resolved');
      assert(stored.revision === attempt.revision + 1, 'revision 應前進');
      assert(stored.result !== undefined && stored.result.outcome === 'succeeded', 'result 應為 succeeded');
      assert(
        stored.result!.outputItemIds.length === 1 && String(stored.result!.outputItemIds[0]) === String(madeItem),
        'outputItemIds 由 inventory 建立後回填',
      );
      assert(state.craftingAttempts[ATTEMPT_ID]!.status === 'scheduled', '原 Slice 不得被 mutate');
    },
  },
  {
    name: 'findCraftAttemptForFreeAction：非 craft 不認領、唯一相符則回傳、相符多筆則明確拋錯',
    run: () => {
      const attempt = fixtureAttempt();
      const state = fixtureCraftingState({ craftingAttempts: [attempt] });
      assert(
        findCraftAttemptForFreeAction(state, freeActionCompleted())?.craftingAttemptId === ATTEMPT_ID,
        '應相關到唯一一筆 scheduled Attempt',
      );
      assert(
        findCraftAttemptForFreeAction(state, { ...freeActionCompleted(), payload: { kind: 'rest' } }) === undefined,
        '非 craft 的 FreeActionCompleted 不屬本模組',
      );
      assert(
        findCraftAttemptForFreeAction(state, freeActionCompleted(OTHER_CHARACTER_ID)) === undefined,
        '別人的 FreeAction 不得認領',
      );

      const ambiguous = fixtureCraftingState({
        craftingAttempts: [attempt, fixtureAttempt({ craftingAttemptId: 'attempt-2' as typeof ATTEMPT_ID })],
      });
      let threw = false;
      try {
        findCraftAttemptForFreeAction(ambiguous, freeActionCompleted());
      } catch {
        threw = true;
      }
      assert(threw, '同角色同配方兩筆 scheduled 應明確拋錯（不得任選一筆）');

      assert(
        findScheduledAttemptByFreeAction(state, FREE_ACTION_ID)?.craftingAttemptId === ATTEMPT_ID,
        'freeActionId 定址亦應命中',
      );
      assert(
        findScheduledAttemptByFreeAction(state, 'free-action-none' as FreeActionId) === undefined,
        '不存在的 freeActionId 應回 undefined',
      );
    },
  },

  // ── NPC 料理決策 ─────────────────────────────────────────────────────────
  {
    name: 'decideNpcCuisine：有未到期 FoodStatus 的日結算不決定料理（不變量 6）',
    run: () => {
      const state = fixtureCraftingState({ foodStatuses: [fixtureFoodStatus({ expiresOnDay: 102 as WorldDay })] });
      const d = decideNpcCuisine(
        { characterId: CHARACTER_ID, cityId: CITY_ID, ruleId: NPC_CUISINE_RULE_ID },
        state,
        makeContext({ worldDay: 101 as WorldDay }),
      );
      assert(d.kind === 'skip' && d.reason === 'foodStatusActive', '應跳過');
    },
  },
  {
    name: 'decideNpcCuisine：無 FoodStatus 時以資料化 Resolver 抽選；Inn 未開放則餐館不可用',
    run: () => {
      const state = fixtureCraftingState();
      const even = decideNpcCuisine(
        { characterId: CHARACTER_ID, cityId: CITY_ID, ruleId: NPC_CUISINE_RULE_ID },
        state,
        makeContext({ rngContext: stubRngContext(0) }),
      );
      assert(even.kind === 'decided' && even.choice === 'selfCooked', 'cursor 0 → selfCooked');
      assert(even.kind === 'decided' && (even.nextRngCursor as unknown as number) === 1, 'cursor 應前進');

      const odd = decideNpcCuisine(
        { characterId: CHARACTER_ID, cityId: CITY_ID, ruleId: NPC_CUISINE_RULE_ID },
        state,
        makeContext({ rngContext: stubRngContext(1) }),
      );
      assert(odd.kind === 'decided' && odd.choice === 'restaurant', 'cursor 1 → restaurant');

      const noInn = decideNpcCuisine(
        { characterId: CHARACTER_ID, cityId: CITY_ID, ruleId: NPC_CUISINE_RULE_ID },
        state,
        makeContext({ rngContext: stubRngContext(1), city: stubCity({ restaurantAvailable: false }) }),
      );
      assert(noInn.kind === 'decided' && noInn.choice === 'selfCooked', 'Inn 未開放時餐館不得成為候選');
    },
  },

  // ── Query ────────────────────────────────────────────────────────────────
  {
    name: 'CraftingQuery：getFoodStatus / canPrepareFood（expiresOnDay 當日仍有效）',
    run: () => {
      const state = fixtureCraftingState({ foodStatuses: [fixtureFoodStatus({ expiresOnDay: 102 as WorldDay })] });
      const q = createCraftingQuery(state, stubDefinitionReader(), stubProgression(), stubCity());
      assert(q.getFoodStatus(CHARACTER_ID) !== undefined, 'getFoodStatus 應取到');
      assert(q.getFoodStatus(OTHER_CHARACTER_ID) === undefined, '其他角色應無 FoodStatus');
      assert(!q.canPrepareFood(CHARACTER_ID, 102 as WorldDay), 'expiresOnDay 當日不可備餐');
      assert(q.canPrepareFood(CHARACTER_ID, 103 as WorldDay), '隔日可備餐');
      assert(q.canPrepareFood(OTHER_CHARACTER_ID, 102 as WorldDay), '無狀態者可備餐');
    },
  },
  {
    name: 'CraftingQuery：listCraftableRecipes 依啟用／已學／Mastery／設施過濾；listCookableCuisine 同理',
    run: () => {
      const state = fixtureCraftingState();
      const all = createCraftingQuery(state, stubDefinitionReader(), stubProgression(), stubCity());
      const craftable = all.listCraftableRecipes(CHARACTER_ID, CITY_ID).map((v) => String(v.recipeId));
      assert(craftable.length === 3, `應有 3 張可做配方（實得 ${craftable.length}: ${craftable.join(',')}）`);
      assert(!craftable.includes(String(RECIPE_FOREIGN_SWORD)), '未學的配方不得出現');

      const noFacility = createCraftingQuery(
        state,
        stubDefinitionReader(),
        stubProgression(),
        stubCity({ facilityAvailable: false }),
      );
      assert(noFacility.listCraftableRecipes(CHARACTER_ID, CITY_ID).length === 0, '沒有設施時配方池為空');

      const noMastery = createCraftingQuery(
        state,
        stubDefinitionReader(),
        stubProgression({ meetsRequirements: false }),
        stubCity(),
      );
      assert(noMastery.listCraftableRecipes(CHARACTER_ID, CITY_ID).length === 0, 'Mastery 未達標時配方池為空');

      const cookable = all.listCookableCuisine(CHARACTER_ID).map((v) => String(v.recipeId));
      assert(cookable.length === 1 && cookable[0] === String(RECIPE_STEW), `應只有一張食譜（實得 ${cookable.join(',')}）`);
      const notLearned = createCraftingQuery(
        state,
        stubDefinitionReader(),
        stubProgression({ learnedRecipeIds: [] }),
        stubCity(),
      );
      assert(notLearned.listCookableCuisine(CHARACTER_ID).length === 0, '未學食譜不得出現');
    },
  },

  // ── State 結構 ───────────────────────────────────────────────────────────
  {
    name: 'State：品質階梯序位＝可繼承詞條數（plain=0 … demonGod=5）、料理階級域下界為 1',
    run: () => {
      const expected = [0, 1, 2, 3, 4, 5];
      CRAFT_QUALITY_LADDER.forEach((quality, index) => {
        assert(
          qualityAffixCapacity(quality) === expected[index],
          `${quality} 的詞條數應為 ${expected[index]}（實得 ${qualityAffixCapacity(quality)}）`,
        );
      });
      assert(lowestFoodAffixTier() === 1, '餐館用的最低階級應為階級域下界 1');
      assert(isFoodAffixTier(1) && isFoodAffixTier(5), '1 與 5 應在階級域內');
      assert(!isFoodAffixTier(0) && !isFoodAffixTier(6), '0 與 6 應在階級域外');
    },
  },
  {
    name: 'State：removeFoodStatus 刪鍵而非留 undefined；hasActiveFoodStatus 只看未到期',
    run: () => {
      const state = fixtureCraftingState({ foodStatuses: [fixtureFoodStatus({ expiresOnDay: 102 as WorldDay })] });
      assert(hasActiveFoodStatus(state, CHARACTER_ID, 102 as WorldDay), '第 102 天仍有效');
      assert(!hasActiveFoodStatus(state, CHARACTER_ID, 103 as WorldDay), '第 103 天已失效');
      const removed = removeFoodStatus(state, CHARACTER_ID);
      assert(
        Object.keys(removed.foodStatuses).length === 0,
        `移除後不應留下任何鍵（實得 ${Object.keys(removed.foodStatuses).join(',')}）`,
      );
      assert(Object.keys(state.foodStatuses).length === 1, '原 Slice 不得被 mutate');
      assert(removeFoodStatus(removed, CHARACTER_ID) === removed, '重複移除應冪等回傳同一份');
    },
  },
  {
    name: '不變量：同一角色的 FoodStatus 鍵唯一——第二次自製在到期後才成立，且覆蓋的是同一個鍵',
    run: () => {
      const first = expectOk(handleCookCuisine(cook(), fixtureCraftingState(), makeContext({ worldDay: 200 as WorldDay })), 'first');
      assert(Object.keys(first.nextSlice.foodStatuses).length === 1, '應只有一筆');
      const second = expectOk(
        handleCookCuisine(cook(), first.nextSlice, makeContext({ worldDay: 203 as WorldDay })),
        'second',
      );
      assert(Object.keys(second.nextSlice.foodStatuses).length === 1, '到期後再自製仍只有一筆（同一個角色鍵）');
      assert(tryGetFoodStatus(second.nextSlice, CHARACTER_ID)!.startedOnDay === 203, '應為新的一筆');
    },
  },
];

export type CraftingTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestsVerbose(): readonly CraftingTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return { name: c.name, passed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function runTests(): void {
  const results = runTestsVerbose();
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const detail = failed.map((f) => `  - ${f.name}: ${f.error ?? 'failed'}`).join('\n');
    throw new Error(`crafting module: ${failed.length}/${results.length} tests failed\n${detail}`);
  }
}
