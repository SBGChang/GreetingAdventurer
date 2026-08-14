// modules/character/system.ts
// Character 模組的純函式 Handler / Subscriber。
//
// 設計原則（對應 docs/00_core/architecture/04_character_module.md）：
//   * 全部為決定性純函式：不做 I/O、不呼叫 Math.random / Date.now。
//   * 需要「當前世界日」「靜態資料」「跨模組 Stats」「新 ID」「RNG 結果」時，
//     一律經由注入的 CharacterHandlerContext 取得；RNG 只藏在 Resolver Port 內。
//   * 每個 Handler 簽章為 (command|event, state, ctx) → ModuleResult<CharacterState>：
//     只含自己 Slice 的 nextSlice 與外送訊息（DomainEvent draft）、排程 Job draft、取消 Job。
//   * Handler 不 mutate 傳入 state；一律回傳新物件。

import type {
  CharacterId,
  FamilyLinkId,
  RelationshipFactId,
  CharacterStatusInstanceId,
  CharacterTraitDefinitionId,
  CharacterArchetypeId,
  EffectDefinitionId,
  ModuleId,
  JobId,
  WorldDay,
  Revision,
  RngContext,
  ModuleResult,
  ScheduledJobDraft,
  AnyScheduledJob,
  TransactionMessageDraft,
} from '../../contracts/core';
import type {
  Character,
  CharacterState,
  CharacterCondition,
  CharacterStatusInstance,
  CharacterStatusChange,
  FamilyLink,
  CharacterRelationshipFact,
  Sex,
  CharacterOrigin,
  CharacterDefinitionReader,
  CharacterStatsQuery,
  StatusDefinition,
  TemporaryCharacterOrigin,
  // Internal Command payloads
  CreateQuestTemporaryCharacter,
  CreateWorldAdventurerBatch,
  ApplyCharacterReputationEffect,
  CreatePartnerFamilyLink,
  ApplyContentEventStatus,
  OpenCharacterRelationshipFact,
  ResolveCharacterRelationshipFact,
  ApplyCombatCondition,
  ApplyFoodStatusEffects,
  // Job payload
  CharacterLifecycleJob,
  CharacterLifecycleJobPayload,
  // Output events
  CharacterCreatedEvent,
  CharacterAvailabilityChangedEvent,
  CharacterConditionChangedEvent,
  CharacterDiedEvent,
  CharacterBornEvent,
  CharacterBecameAdultEvent,
  CharacterRetiredEvent,
  TemporaryCharacterRecoveredEvent,
  CharacterReputationChangedEvent,
  CharacterRelationshipChangedEvent,
  FamilyLinkChangedEvent,
} from '../../contracts/character';

// 其他模組擁有的入站事件型別（僅型別 import）。
import type { FacilityRestCompleted } from '../../contracts/city';
import type { HomeYearRestCompletedEvent } from '../../contracts/team';
import type { QuestStateChangedPayload } from '../../contracts/quest';
import type { ProgressionCapacityChangedEvent } from '../../contracts/progression';
import type { EquipmentChanged } from '../../contracts/inventory';

import {
  tryGetCharacter,
  upsertCharacter,
  upsertFamilyLink,
  upsertRelationshipFact,
  ageDaysOf,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組常數
// ──────────────────────────────────────────────────────────────────────────

export const CHARACTER_MODULE_ID = 'character' as ModuleId;

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port：讓 Handler 保持純函式。真實組合由 Composition 注入；測試注入決定性 stub。
// ──────────────────────────────────────────────────────────────────────────

// 交易私有的 ID 配發器（背後由 Kernel RuntimeIdGenerator + cursor 提供；此處只看決定性介面）。
export interface CharacterIdAllocator {
  nextCharacterId(): CharacterId;
  nextFamilyLinkId(): FamilyLinkId;
  nextRelationshipFactId(): RelationshipFactId;
  nextStatusInstanceId(): CharacterStatusInstanceId;
}

// 生命週期（退休／自然死亡）Resolver 決策。RNG 於 Resolver 內以顯式 cursor 串接。
export type LifecycleDecision =
  | Readonly<{ outcome: 'trigger' }> // 現在退休／死亡
  | Readonly<{ outcome: 'reschedule'; nextCheckInDays: number }>; // 排下一次明確檢查

export type BirthDecision =
  | Readonly<{ born: false }>
  | Readonly<{
      born: true;
      archetypeId: CharacterArchetypeId;
      sex: Sex;
      innateTraitIds: readonly CharacterTraitDefinitionId[];
    }>;

export type WorldAdventurerDraft = Readonly<{
  archetypeId: CharacterArchetypeId;
  sex: Sex;
  birthDay: WorldDay;
  innateTraitIds: readonly CharacterTraitDefinitionId[];
}>;

// 由資料 Resolver 決定的規則結果。Handler 不含公式，只消費結果。
export interface CharacterResolverPort {
  resolveNaturalDeath(
    input: Readonly<{ character: Character; onDay: WorldDay }>,
  ): LifecycleDecision;
  resolveRetirement(
    input: Readonly<{ character: Character; onDay: WorldDay }>,
  ): LifecycleDecision;
  resolveBirth(
    input: Readonly<{
      parents: readonly Character[];
      onDay: WorldDay;
      rngContext?: RngContext;
    }>,
  ): BirthDecision;
  resolveWorldAdventurer(
    input: Readonly<{ index: number; command: CreateWorldAdventurerBatch; onDay: WorldDay }>,
  ): WorldAdventurerDraft;
  // 已驗證 Effect → 聲望增量。
  resolveReputationDelta(
    input: Readonly<{ character: Character; effectId: EffectDefinitionId }>,
  ): number;
}

export type CharacterHandlerContext = Readonly<{
  worldDay: WorldDay;
  definitions: CharacterDefinitionReader;
  stats: CharacterStatsQuery; // 消費 Port：最大 HP/MP（由 Composition Adapter 提供）
  ids: CharacterIdAllocator;
  resolvers: CharacterResolverPort;
}>;

// ──────────────────────────────────────────────────────────────────────────
// 輸出 DomainEvent（帶 type 判別；對齊 city/quest 的事件封裝慣例）。
// ──────────────────────────────────────────────────────────────────────────

export type CharacterDomainEvent =
  | ({ type: 'CharacterCreated' } & CharacterCreatedEvent)
  | ({ type: 'CharacterAvailabilityChanged' } & CharacterAvailabilityChangedEvent)
  | ({ type: 'CharacterConditionChanged' } & CharacterConditionChangedEvent)
  | ({ type: 'CharacterDied' } & CharacterDiedEvent)
  | ({ type: 'CharacterBorn' } & CharacterBornEvent)
  | ({ type: 'CharacterBecameAdult' } & CharacterBecameAdultEvent)
  | ({ type: 'CharacterRetired' } & CharacterRetiredEvent)
  | ({ type: 'TemporaryCharacterRecovered' } & TemporaryCharacterRecoveredEvent)
  | ({ type: 'CharacterReputationChanged' } & CharacterReputationChangedEvent)
  | ({ type: 'CharacterRelationshipChanged' } & CharacterRelationshipChangedEvent)
  | ({ type: 'FamilyLinkChanged' } & FamilyLinkChangedEvent);

// ──────────────────────────────────────────────────────────────────────────
// 小工具
// ──────────────────────────────────────────────────────────────────────────

function bumpRevision(r: Revision): Revision {
  return (r + 1) as Revision;
}

function emit(event: CharacterDomainEvent): TransactionMessageDraft {
  return { event };
}

function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

function clampUpper(n: number, max: number): number {
  return n > max ? max : n;
}

function makeResult(
  nextSlice: CharacterState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[] = [],
  cancelledJobIds?: readonly JobId[],
): ModuleResult<CharacterState> {
  return {
    nextSlice,
    outgoingMessages,
    scheduledJobs,
    ...(cancelledJobIds ? { cancelledJobIds } : {}),
  };
}

// 生命週期 Job draft（不含 jobId；由 Runner 配發）。
function lifecycleJobDraft(
  targetId: CharacterId,
  dueDay: WorldDay,
  payload: CharacterLifecycleJobPayload,
  expectedRevision: Revision,
): ScheduledJobDraft<CharacterLifecycleJob> {
  return {
    type: 'characterLifecycleDue',
    dueDay,
    ownerModule: CHARACTER_MODULE_ID,
    targetId,
    expectedRevision,
    payload,
  };
}

// ── Condition / Status 純函式核心 ──────────────────────────────────────────

// 依 StatusDefinition.stackPolicy 套用一筆狀態；回傳 [新 statuses, 變更描述]。
function applyStatus(
  statuses: readonly CharacterStatusInstance[],
  def: StatusDefinition,
  instance: CharacterStatusInstance,
): readonly [readonly CharacterStatusInstance[], CharacterStatusChange] {
  const existingIndex = statuses.findIndex((s) => s.statusId === def.id);
  const existing = existingIndex >= 0 ? statuses[existingIndex] : undefined;
  if (existing === undefined) {
    return [
      [...statuses, instance],
      { statusId: def.id, change: 'applied', stacks: instance.stacks },
    ];
  }
  const next = [...statuses];
  switch (def.stackPolicy) {
    case 'replace':
      next[existingIndex] = instance;
      return [next, { statusId: def.id, change: 'refreshed', stacks: instance.stacks }];
    case 'refresh':
      next[existingIndex] = { ...existing, expiresOnDay: instance.expiresOnDay };
      return [next, { statusId: def.id, change: 'refreshed', stacks: existing.stacks }];
    case 'stack': {
      const stacks = existing.stacks + instance.stacks;
      next[existingIndex] = { ...existing, stacks, expiresOnDay: instance.expiresOnDay };
      return [next, { statusId: def.id, change: 'refreshed', stacks }];
    }
    default:
      // TODO: 未知 stackPolicy —— 保守略過（資料驗證層應已擋下）。
      return [statuses, { statusId: def.id, change: 'refreshed', stacks: existing.stacks }];
  }
}

// 依上限夾住當前 HP/MP。回傳 [新 condition, 是否有變化]。
function clampConditionToMax(
  condition: CharacterCondition,
  max: Readonly<{ maxHealth: number; maxMana: number }>,
): readonly [CharacterCondition, boolean] {
  const health = clampUpper(clampNonNegative(condition.health), max.maxHealth);
  const mana = clampUpper(clampNonNegative(condition.mana), max.maxMana);
  if (health === condition.health && mana === condition.mana) return [condition, false];
  return [{ ...condition, health, mana }, true];
}

// 死亡狀態轉換：dead + unavailable（不變量 3）。
function toDead(character: Character): Character {
  return {
    ...character,
    lifeState: 'dead',
    availability: 'unavailable',
    revision: bumpRevision(character.revision),
    // lifeState 轉換使所有已排程的生命週期 Job 失效。
    lifecycleRevision: bumpRevision(character.lifecycleRevision),
  };
}

function newCharacter(
  input: Readonly<{
    characterId: CharacterId;
    archetypeId: CharacterArchetypeId;
    origin: CharacterOrigin;
    sex: Sex;
    birthDay: WorldDay;
    availability: Character['availability'];
    innateTraitIds: readonly CharacterTraitDefinitionId[];
    condition: CharacterCondition;
    temporaryOrigin?: TemporaryCharacterOrigin;
  }>,
): Character {
  return {
    characterId: input.characterId,
    archetypeId: input.archetypeId,
    origin: input.origin,
    sex: input.sex,
    birthDay: input.birthDay,
    lifeState: 'alive',
    availability: input.availability,
    parentIds: [],
    childIds: [],
    innateTraitIds: input.innateTraitIds,
    reputation: 0,
    condition: input.condition,
    ...(input.temporaryOrigin ? { temporaryOrigin: input.temporaryOrigin } : {}),
    revision: 0 as Revision,
    lifecycleRevision: 0 as Revision,
  };
}

// 依 stats 產生「滿血滿魔、無狀態」的初始 condition。
function fullCondition(
  ctx: CharacterHandlerContext,
  characterId: CharacterId,
): CharacterCondition {
  const max = ctx.stats.getStats(characterId);
  return { health: max.maxHealth, mana: max.maxMana, statuses: [] };
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 Internal Command Handlers
// ──────────────────────────────────────────────────────────────────────────

// ApplyCombatCondition：套用 HP/MP/狀態變化；HP 歸零時處理死亡與不可行動。（真實）
export function handleApplyCombatCondition(
  command: ApplyCombatCondition,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const character = tryGetCharacter(state, command.characterId);
  if (character === undefined || character.lifeState === 'dead') {
    // 對不存在或已死亡角色為 no-op（冪等）。
    return makeResult(state);
  }
  const max = ctx.stats.getStats(command.characterId);

  let health = clampUpper(
    clampNonNegative(character.condition.health + (command.healthDelta ?? 0)),
    max.maxHealth,
  );
  const mana = clampUpper(
    clampNonNegative(character.condition.mana + (command.manaDelta ?? 0)),
    max.maxMana,
  );

  let statuses = character.condition.statuses;
  const statusChanges: CharacterStatusChange[] = [];
  for (const change of command.statusChanges ?? []) {
    if (change.change === 'removed') {
      statuses = statuses.filter((s) => s.statusId !== change.statusId);
      statusChanges.push({ statusId: change.statusId, change: 'removed' });
      continue;
    }
    const def = ctx.definitions.getStatusDefinition(change.statusId);
    const instance: CharacterStatusInstance = {
      statusInstanceId: ctx.ids.nextStatusInstanceId(),
      statusId: change.statusId,
      appliedOnDay: ctx.worldDay,
      stacks: change.stacks ?? 1,
    };
    const [nextStatuses, applied] = applyStatus(statuses, def, instance);
    statuses = nextStatuses;
    statusChanges.push(applied);
  }

  const dies = health <= 0;
  if (dies) health = 0;

  const nextCondition: CharacterCondition = { health, mana, statuses };
  let nextCharacter: Character = {
    ...character,
    condition: nextCondition,
    revision: bumpRevision(character.revision),
  };

  const messages: TransactionMessageDraft[] = [
    emit({
      type: 'CharacterConditionChanged',
      characterId: character.characterId,
      health,
      mana,
      statusChanges,
    }),
  ];

  if (dies) {
    const oldAvailability = nextCharacter.availability;
    nextCharacter = toDead(nextCharacter);
    messages.push(
      emit({
        type: 'CharacterDied',
        characterId: character.characterId,
        deathDay: ctx.worldDay,
        reason: 'combatCondition',
      }),
      emit({
        type: 'CharacterAvailabilityChanged',
        characterId: character.characterId,
        oldAvailability,
        newAvailability: 'unavailable',
        reason: 'death',
      }),
    );
  }

  return makeResult(upsertCharacter(state, nextCharacter), messages);
}

// ApplyCharacterReputationEffect：依已驗證 Effect 調整聲望並發事件。（真實）
export function handleApplyCharacterReputationEffect(
  command: ApplyCharacterReputationEffect,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const character = tryGetCharacter(state, command.characterId);
  if (character === undefined) return makeResult(state);

  const delta = ctx.resolvers.resolveReputationDelta({
    character,
    effectId: command.effectId,
  });
  if (delta === 0) return makeResult(state); // 無變化不發事件

  const oldValue = character.reputation;
  const newValue = oldValue + delta;
  const next: Character = {
    ...character,
    reputation: newValue,
    revision: bumpRevision(character.revision),
  };
  return makeResult(upsertCharacter(state, next), [
    emit({
      type: 'CharacterReputationChanged',
      characterId: character.characterId,
      oldValue,
      newValue,
    }),
  ]);
}

// CreatePartnerFamilyLink：Marriage Workflow 專用；重驗硬條件並原子建立唯一伴侶連結。（真實）
export function handleCreatePartnerFamilyLink(
  command: CreatePartnerFamilyLink,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const [aId, bId] = command.characterIds;

  // 冪等：同一來源已建立過 active partner link → no-op。
  for (const link of Object.values(state.familyLinks)) {
    if (
      link.kind === 'partner' &&
      link.activeToDay === undefined &&
      link.characterIds.includes(aId) &&
      link.characterIds.includes(bId)
    ) {
      return makeResult(state);
    }
  }

  // 拒絕：自我求婚。
  if (aId === bId) return makeResult(state);

  const a = tryGetCharacter(state, aId);
  const b = tryGetCharacter(state, bId);
  if (a === undefined || b === undefined) return makeResult(state);

  // 硬條件（不變量 11）：成年、存活、異性、雙方皆無 active partner。
  if (a.lifeState !== 'alive' || b.lifeState !== 'alive') return makeResult(state);
  if (a.sex === b.sex) return makeResult(state);
  if (!isAdult(a, ctx) || !isAdult(b, ctx)) return makeResult(state);
  if (hasActivePartner(state, aId) || hasActivePartner(state, bId)) return makeResult(state);

  const link: FamilyLink = {
    familyLinkId: ctx.ids.nextFamilyLinkId(),
    kind: 'partner',
    characterIds: [aId, bId],
    activeFromDay: ctx.worldDay,
    revision: 0 as Revision,
  };
  return makeResult(upsertFamilyLink(state, link), [
    emit({
      type: 'FamilyLinkChanged',
      familyLinkId: link.familyLinkId,
      kind: 'partner',
      characterIds: link.characterIds,
      change: 'created',
      worldDay: ctx.worldDay,
    }),
  ]);
}

// OpenCharacterRelationshipFact：建立一筆未了結關係（不變量 10：同來源/主體/對象/kind 至多一筆未解決）。（真實）
export function handleOpenCharacterRelationshipFact(
  command: OpenCharacterRelationshipFact,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const duplicate = Object.values(state.relationshipFacts).some(
    (f) =>
      f.state === 'unresolved' &&
      f.subjectCharacterId === command.subjectCharacterId &&
      f.kind === command.kind &&
      f.sourceId === command.sourceId &&
      sameCounterpart(f.counterpart, command.counterpart),
  );
  if (duplicate) return makeResult(state); // 冪等

  const fact: CharacterRelationshipFact = {
    relationshipFactId: ctx.ids.nextRelationshipFactId(),
    subjectCharacterId: command.subjectCharacterId,
    counterpart: command.counterpart,
    kind: command.kind,
    sourceId: command.sourceId,
    state: 'unresolved',
    openedOnDay: ctx.worldDay,
    revision: 0 as Revision,
  };
  return makeResult(upsertRelationshipFact(state, fact), [
    emit({
      type: 'CharacterRelationshipChanged',
      relationshipFactId: fact.relationshipFactId,
      subjectCharacterId: fact.subjectCharacterId,
      state: 'unresolved',
    }),
  ]);
}

// ResolveCharacterRelationshipFact：標記已解決；重複冪等。（真實）
export function handleResolveCharacterRelationshipFact(
  command: ResolveCharacterRelationshipFact,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const fact = state.relationshipFacts[command.relationshipFactId];
  if (fact === undefined || fact.state === 'resolved') return makeResult(state); // 冪等

  const next: CharacterRelationshipFact = {
    ...fact,
    state: 'resolved',
    resolvedOnDay: ctx.worldDay,
    revision: bumpRevision(fact.revision),
  };
  return makeResult(upsertRelationshipFact(state, next), [
    emit({
      type: 'CharacterRelationshipChanged',
      relationshipFactId: next.relationshipFactId,
      subjectCharacterId: next.subjectCharacterId,
      state: 'resolved',
    }),
  ]);
}

// CreateQuestTemporaryCharacter：建立護衛／救援暫時角色。（真實）
export function handleCreateQuestTemporaryCharacter(
  command: CreateQuestTemporaryCharacter,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const characterId = ctx.ids.nextCharacterId();
  const archetype = ctx.definitions.getArchetype(command.archetypeId);
  const temporaryOrigin: TemporaryCharacterOrigin =
    command.kind === 'escort'
      ? { kind: 'escort', sourceQuestId: command.sourceQuestId, recoveryPolicy: 'escortQuestLifecycle' }
      : { kind: 'rescue', sourceQuestId: command.sourceQuestId, recoveryPolicy: 'rescueQuestLifecycle' };

  const character = newCharacter({
    characterId,
    archetypeId: command.archetypeId,
    origin: 'questTemporary',
    // 暫時角色 sex 由 archetype/cultureId 決定；來源文件未給 → 先固定 'female' 佔位。
    // TODO: 由 archetype 或 generation rule 決定性地決定 sex。
    sex: 'female',
    birthDay: ctx.worldDay,
    availability: 'temporary',
    innateTraitIds: [],
    condition: fullCondition(ctx, characterId),
    temporaryOrigin,
  });
  void archetype;

  return makeResult(upsertCharacter(state, character), [
    emit({
      type: 'CharacterCreated',
      characterId,
      origin: 'questTemporary',
      archetypeId: command.archetypeId,
    }),
  ]);
}

// CreateWorldAdventurerBatch：依同一生成規則建立真實世界冒險者。（主路真實；細節 RNG 由 Resolver 提供）
export function handleCreateWorldAdventurerBatch(
  command: CreateWorldAdventurerBatch,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  let nextState = state;
  const messages: TransactionMessageDraft[] = [];
  const jobs: ScheduledJobDraft<AnyScheduledJob>[] = [];

  for (let i = 0; i < command.count; i += 1) {
    const draft = ctx.resolvers.resolveWorldAdventurer({ index: i, command, onDay: ctx.worldDay });
    const characterId = ctx.ids.nextCharacterId();
    const character = newCharacter({
      characterId,
      archetypeId: draft.archetypeId,
      origin: 'worldAdventurer',
      sex: draft.sex,
      birthDay: draft.birthDay,
      // 生成規則輸出已成年起始年齡 → 直接 available。
      availability: 'available',
      innateTraitIds: draft.innateTraitIds,
      condition: fullCondition(ctx, characterId),
    });
    nextState = upsertCharacter(nextState, character);
    messages.push(
      emit({
        type: 'CharacterCreated',
        characterId,
        origin: 'worldAdventurer',
        archetypeId: draft.archetypeId,
      }),
    );
    // 生命週期 Job：僅排資料門檻所需的明確到期檢查（§5.3）。
    for (const job of scheduleLifecycleJobs(character, draft.archetypeId, ctx)) jobs.push(job);
  }

  return makeResult(nextState, messages, jobs);
}

// ApplyContentEventStatus：Content Event Workflow 專用；套用暫時狀態，同一來源不重複。（真實主路）
export function handleApplyContentEventStatus(
  command: ApplyContentEventStatus,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const character = tryGetCharacter(state, command.characterId);
  if (character === undefined || character.lifeState === 'dead') return makeResult(state);

  const def = ctx.definitions.getStatusDefinition(command.statusId);
  const instance: CharacterStatusInstance = {
    statusInstanceId: ctx.ids.nextStatusInstanceId(),
    statusId: command.statusId,
    sourceId: command.characterId, // TODO: 以 ContentEventInstanceId 作 sourceId 需擴充 EntitySourceRef。
    appliedOnDay: ctx.worldDay,
    stacks: 1,
  };
  const [statuses, change] = applyStatus(character.condition.statuses, def, instance);
  const next: Character = {
    ...character,
    condition: { ...character.condition, statuses },
    revision: bumpRevision(character.revision),
  };
  return makeResult(upsertCharacter(state, next), [
    emit({
      type: 'CharacterConditionChanged',
      characterId: character.characterId,
      health: next.condition.health,
      mana: next.condition.mana,
      statusChanges: [change],
    }),
  ]);
}

// ApplyFoodStatusEffects：Crafting Workflow 專用；apply/remove FoodStatus 已解析效果。（apply 主路真實；remove 為主路）
export function handleApplyFoodStatusEffects(
  command: ApplyFoodStatusEffects,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const character = tryGetCharacter(state, command.characterId);
  if (character === undefined || character.lifeState === 'dead') return makeResult(state);

  // 第一版：effectId 已被 Crafting 解析為 statusId 對照；此處以 EffectDefinitionId 當作 statusId 對照鍵。
  // TODO: 導入 Effect→Status 對照表；目前僅示範 apply/remove 的 Slice 寫入路徑。
  let statuses = character.condition.statuses;
  const statusChanges: CharacterStatusChange[] = [];
  for (const effectId of command.effectIds) {
    const statusId = effectId as unknown as CharacterStatusInstance['statusId'];
    if (command.operation === 'remove') {
      statuses = statuses.filter((s) => s.statusId !== statusId);
      statusChanges.push({ statusId, change: 'removed' });
      continue;
    }
    const def = ctx.definitions.getStatusDefinition(statusId);
    const instance: CharacterStatusInstance = {
      statusInstanceId: ctx.ids.nextStatusInstanceId(),
      statusId,
      appliedOnDay: ctx.worldDay,
      stacks: 1,
    };
    const [nextStatuses, change] = applyStatus(statuses, def, instance);
    statuses = nextStatuses;
    statusChanges.push(change);
  }
  if (statusChanges.length === 0) return makeResult(state);

  const next: Character = {
    ...character,
    condition: { ...character.condition, statuses },
    revision: bumpRevision(character.revision),
  };
  return makeResult(upsertCharacter(state, next), [
    emit({
      type: 'CharacterConditionChanged',
      characterId: character.characterId,
      health: next.condition.health,
      mana: next.condition.mana,
      statusChanges,
    }),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.3 Job Handler：characterLifecycleDue
// ──────────────────────────────────────────────────────────────────────────

export function handleCharacterLifecycleJob(
  job: CharacterLifecycleJob,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const character = tryGetCharacter(state, job.targetId);
  // 角色不存在或已死亡 → 過期 Job，安靜丟棄。
  if (character === undefined || character.lifeState === 'dead') return makeResult(state);
  // expectedRevision 原本完全沒驗（只在註解裡宣稱）。比對 lifecycleRevision 而非 revision：只有
  // lifeState 轉換會讓它跳，所以受傷／狀態變更不會誤殺成年或自然死亡 Job（見契約 Character 註解）。
  if (job.expectedRevision !== undefined && job.expectedRevision !== character.lifecycleRevision) {
    return makeResult(state);
  }

  switch (job.payload.kind) {
    case 'adulthood':
      return runAdulthood(character, state, ctx);
    case 'retirementCheck':
      return runRetirementCheck(character, state, ctx);
    case 'naturalDeathCheck':
      return runNaturalDeathCheck(character, state, ctx);
    default:
      return makeResult(state);
  }
}

function runAdulthood(
  character: Character,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const rule = ctx.definitions.getArchetype(character.archetypeId);
  const lifecycle = ctx.definitions.getLifecycleRule(rule.lifecycleRuleId);
  const ageDays = ageDaysOf(character, ctx.worldDay);
  if (ageDays < lifecycle.adulthoodAgeDays) {
    // 尚未成年（Job 早到或 revision 對不上）：不改狀態。
    return makeResult(state);
  }
  const oldAvailability = character.availability;
  const next: Character = {
    ...character,
    availability: 'available',
    revision: bumpRevision(character.revision),
  };
  const messages: TransactionMessageDraft[] = [
    emit({ type: 'CharacterBecameAdult', characterId: character.characterId, ageDays }),
  ];
  if (oldAvailability !== 'available') {
    messages.push(
      emit({
        type: 'CharacterAvailabilityChanged',
        characterId: character.characterId,
        oldAvailability,
        newAvailability: 'available',
        reason: 'adulthood',
      }),
    );
  }
  return makeResult(upsertCharacter(state, next), messages);
}

function runRetirementCheck(
  character: Character,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const decision = ctx.resolvers.resolveRetirement({ character, onDay: ctx.worldDay });
  if (decision.outcome === 'reschedule') {
    return makeResult(state, [], [
      lifecycleJobDraft(
        character.characterId,
        (ctx.worldDay + decision.nextCheckInDays) as WorldDay,
        { kind: 'retirementCheck' },
        character.lifecycleRevision,
      ),
    ]);
  }
  const oldAvailability = character.availability;
  const next: Character = {
    ...character,
    lifeState: 'retired',
    availability: 'unavailable',
    revision: bumpRevision(character.revision),
    // 同 toDead：退休使剩餘的生命週期 Job（自然死亡檢查等）失效。
    lifecycleRevision: bumpRevision(character.lifecycleRevision),
  };
  return makeResult(upsertCharacter(state, next), [
    emit({ type: 'CharacterRetired', characterId: character.characterId, retiredOnDay: ctx.worldDay }),
    emit({
      type: 'CharacterAvailabilityChanged',
      characterId: character.characterId,
      oldAvailability,
      newAvailability: 'unavailable',
      reason: 'retirement',
    }),
  ]);
}

function runNaturalDeathCheck(
  character: Character,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const decision = ctx.resolvers.resolveNaturalDeath({ character, onDay: ctx.worldDay });
  if (decision.outcome === 'reschedule') {
    return makeResult(state, [], [
      lifecycleJobDraft(
        character.characterId,
        (ctx.worldDay + decision.nextCheckInDays) as WorldDay,
        { kind: 'naturalDeathCheck' },
        character.lifecycleRevision,
      ),
    ]);
  }
  const oldAvailability = character.availability;
  const next = toDead(character);
  return makeResult(upsertCharacter(state, next), [
    emit({
      type: 'CharacterDied',
      characterId: character.characterId,
      deathDay: ctx.worldDay,
      reason: 'naturalDeath',
    }),
    emit({
      type: 'CharacterAvailabilityChanged',
      characterId: character.characterId,
      oldAvailability,
      newAvailability: 'unavailable',
      reason: 'death',
    }),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 DomainEvent Subscribers
// ──────────────────────────────────────────────────────────────────────────

// FacilityRestCompleted：恢復 HP/MP，並依 StatusDefinition 移除 clearByRest 狀態。（真實）
export function onFacilityRestCompleted(
  event: FacilityRestCompleted,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  let nextState = state;
  const messages: TransactionMessageDraft[] = [];
  for (const characterId of event.characterIds) {
    const character = tryGetCharacter(nextState, characterId);
    if (character === undefined || character.lifeState !== 'alive') continue;
    const max = ctx.stats.getStats(characterId);
    const statuses = character.condition.statuses.filter(
      (s) => !ctx.definitions.getStatusDefinition(s.statusId).clearByRest,
    );
    const removed = character.condition.statuses.filter(
      (s) => ctx.definitions.getStatusDefinition(s.statusId).clearByRest,
    );
    const condition: CharacterCondition = {
      health: max.maxHealth,
      mana: max.maxMana,
      statuses,
    };
    const next: Character = { ...character, condition, revision: bumpRevision(character.revision) };
    nextState = upsertCharacter(nextState, next);
    messages.push(
      emit({
        type: 'CharacterConditionChanged',
        characterId,
        health: condition.health,
        mana: condition.mana,
        statusChanges: removed.map((s) => ({ statusId: s.statusId, change: 'removed' })),
      }),
    );
  }
  return makeResult(nextState, messages);
}

// HomeYearRestCompleted：依 Birth Rule 對符合資格的家族關係執行生育判定。（真實主路，決定性 seed）
export function onHomeYearRestCompleted(
  event: HomeYearRestCompletedEvent,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  // 找出成員中的 active partner 對（不變量 11：一人至多一條 active partner link）。
  const memberSet = new Set<CharacterId>(event.memberIds);
  const couples: Array<readonly [Character, Character]> = [];
  const seen = new Set<CharacterId>();
  for (const link of Object.values(state.familyLinks)) {
    if (link.kind !== 'partner' || link.activeToDay !== undefined) continue;
    const [aId, bId] = link.characterIds as readonly [CharacterId, CharacterId];
    if (!memberSet.has(aId) || !memberSet.has(bId)) continue;
    if (seen.has(aId) || seen.has(bId)) continue;
    const a = tryGetCharacter(state, aId);
    const b = tryGetCharacter(state, bId);
    if (a === undefined || b === undefined) continue;
    if (a.lifeState !== 'alive' || b.lifeState !== 'alive') continue;
    seen.add(aId);
    seen.add(bId);
    couples.push([a, b]);
  }

  let nextState = state;
  const messages: TransactionMessageDraft[] = [];
  const jobs: ScheduledJobDraft<AnyScheduledJob>[] = [];

  for (const [a, b] of couples) {
    const decision = ctx.resolvers.resolveBirth({ parents: [a, b], onDay: ctx.worldDay });
    if (!decision.born) continue;

    const childId = ctx.ids.nextCharacterId();
    const child: Character = {
      ...newCharacter({
        characterId: childId,
        archetypeId: decision.archetypeId,
        origin: 'playerLineage',
        sex: decision.sex,
        birthDay: ctx.worldDay,
        // 未成年不可入隊（不變量 8）：出生即 unavailable，成年 Job 後才轉 available。
        availability: 'unavailable',
        innateTraitIds: decision.innateTraitIds,
        condition: fullCondition(ctx, childId),
      }),
      parentIds: [a.characterId, b.characterId],
    };
    nextState = upsertCharacter(nextState, child);

    // 親子雙向對稱（不變量 2）：更新父母 childIds。
    for (const parent of [a, b]) {
      const cur = tryGetCharacter(nextState, parent.characterId);
      if (cur === undefined) continue;
      nextState = upsertCharacter(nextState, {
        ...cur,
        childIds: [...cur.childIds, childId],
        revision: bumpRevision(cur.revision),
      });
    }

    // 監護 FamilyLink（親→子）。
    const guardianLink: FamilyLink = {
      familyLinkId: ctx.ids.nextFamilyLinkId(),
      kind: 'guardian',
      characterIds: [a.characterId, b.characterId, childId],
      activeFromDay: ctx.worldDay,
      revision: 0 as Revision,
    };
    nextState = upsertFamilyLink(nextState, guardianLink);

    messages.push(
      emit({
        type: 'CharacterBorn',
        characterId: childId,
        parentIds: [a.characterId, b.characterId],
        birthDay: ctx.worldDay,
      }),
      emit({
        type: 'CharacterCreated',
        characterId: childId,
        origin: 'playerLineage',
        archetypeId: decision.archetypeId,
      }),
      emit({
        type: 'FamilyLinkChanged',
        familyLinkId: guardianLink.familyLinkId,
        kind: 'guardian',
        characterIds: guardianLink.characterIds,
        change: 'created',
        worldDay: ctx.worldDay,
      }),
    );
    for (const job of scheduleLifecycleJobs(child, decision.archetypeId, ctx)) jobs.push(job);
  }

  return makeResult(nextState, messages, jobs);
}

// QuestStateChanged：於任務終結狀態回收對應暫時角色。（真實回收路）
export function onQuestStateChanged(
  event: QuestStateChangedPayload,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  // 只在任務進入終結狀態（completed/expired）時回收。
  if (event.newStatus !== 'completed' && event.newStatus !== 'expired') {
    return makeResult(state);
  }
  let nextState = state;
  const messages: TransactionMessageDraft[] = [];
  for (const character of Object.values(state.characters)) {
    if (character.origin !== 'questTemporary') continue;
    if (character.temporaryOrigin?.sourceQuestId !== event.questId) continue;
    if (character.lifeState === 'dead') continue;

    const oldAvailability = character.availability;
    const recovered: Character = {
      ...character,
      availability: 'unavailable',
      revision: bumpRevision(character.revision),
    };
    nextState = upsertCharacter(nextState, recovered);
    messages.push(
      emit({
        type: 'TemporaryCharacterRecovered',
        characterId: character.characterId,
        sourceQuestId: event.questId,
        reason: event.reason,
      }),
    );
    if (oldAvailability !== 'unavailable') {
      messages.push(
        emit({
          type: 'CharacterAvailabilityChanged',
          characterId: character.characterId,
          oldAvailability,
          newAvailability: 'unavailable',
          reason: 'temporaryRecovered',
        }),
      );
    }
  }
  return makeResult(nextState, messages);
}

// ProgressionCapacityChanged / EquipmentChanged：重查 Stats 並夾住當前 Condition 上限。（真實）
export function onStatsCapacityChanged(
  event: ProgressionCapacityChangedEvent | EquipmentChanged,
  state: CharacterState,
  ctx: CharacterHandlerContext,
): ModuleResult<CharacterState> {
  const character = tryGetCharacter(state, event.characterId);
  if (character === undefined || character.lifeState === 'dead') return makeResult(state);
  const max = ctx.stats.getStats(event.characterId);
  const [condition, changed] = clampConditionToMax(character.condition, max);
  if (!changed) return makeResult(state);
  const next: Character = { ...character, condition, revision: bumpRevision(character.revision) };
  return makeResult(upsertCharacter(state, next), [
    emit({
      type: 'CharacterConditionChanged',
      characterId: character.characterId,
      health: condition.health,
      mana: condition.mana,
      statusChanges: [],
    }),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// 內部小工具
// ──────────────────────────────────────────────────────────────────────────

function isAdult(character: Character, ctx: CharacterHandlerContext): boolean {
  const archetype = ctx.definitions.getArchetype(character.archetypeId);
  const lifecycle = ctx.definitions.getLifecycleRule(archetype.lifecycleRuleId);
  return ageDaysOf(character, ctx.worldDay) >= lifecycle.adulthoodAgeDays;
}

function hasActivePartner(state: CharacterState, id: CharacterId): boolean {
  return Object.values(state.familyLinks).some(
    (l) => l.kind === 'partner' && l.activeToDay === undefined && l.characterIds.includes(id),
  );
}

function sameCounterpart(
  a: CharacterRelationshipFact['counterpart'],
  b: OpenCharacterRelationshipFact['counterpart'],
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'character' && b.kind === 'character') return a.characterId === b.characterId;
  if (a.kind === 'organization' && b.kind === 'organization') {
    return a.organizationId === b.organizationId;
  }
  return false;
}

// 依 Lifecycle 門檻排出成年／退休／自然死亡到期 Job（不逐日掃描）。
function scheduleLifecycleJobs(
  character: Character,
  archetypeId: CharacterArchetypeId,
  ctx: CharacterHandlerContext,
): readonly ScheduledJobDraft<AnyScheduledJob>[] {
  const archetype = ctx.definitions.getArchetype(archetypeId);
  const lifecycle = ctx.definitions.getLifecycleRule(archetype.lifecycleRuleId);
  const jobs: ScheduledJobDraft<AnyScheduledJob>[] = [];
  const ageDays = ageDaysOf(character, ctx.worldDay);

  if (ageDays < lifecycle.adulthoodAgeDays) {
    jobs.push(
      lifecycleJobDraft(
        character.characterId,
        (character.birthDay + lifecycle.adulthoodAgeDays) as WorldDay,
        { kind: 'adulthood' },
        character.lifecycleRevision,
      ),
    );
  }
  // 首次自然死亡檢查排在資料定義的自然壽命終點。
  jobs.push(
    lifecycleJobDraft(
      character.characterId,
      (character.birthDay + lifecycle.naturalLifeEndAgeDays) as WorldDay,
      { kind: 'naturalDeathCheck' },
      character.lifecycleRevision,
    ),
  );
  // 有退休 Resolver 才排退休檢查（排在可玩年齡終點）。
  if (lifecycle.retirementResolverId !== undefined) {
    jobs.push(
      lifecycleJobDraft(
        character.characterId,
        (character.birthDay + lifecycle.playableAgeEndDays) as WorldDay,
        { kind: 'retirementCheck' },
        character.lifecycleRevision,
      ),
    );
  }
  return jobs;
}
