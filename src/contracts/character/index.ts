// contracts/character — Character 模組公開契約。
// 對應 docs/00_core/architecture/04_character_module.md（純型別；不含實作）。
// 規則：共用型別一律 import 自 '../core'；不重新定義 core 型別。

import type {
  DefinitionId,
  DefinitionHeader,
  ResolverId,
  CharacterId,
  FamilyLinkId,
  RelationshipFactId,
  CharacterArchetypeId,
  LifecycleRuleId,
  CharacterStatusDefinitionId,
  CharacterStatusInstanceId,
  BirthRuleId,
  WorldAdventurerGenerationRuleId,
  CharacterTraitPoolId,
  CharacterTraitDefinitionId,
  AgeModifierRuleId,
  CultureId,
  CityId,
  HomeId,
  QuestId,
  EffectDefinitionId,
  ContentEventInstanceId,
  EntitySourceRef,
  ModuleId,
  WorldDay,
  Revision,
  RngContext,
  ScheduledJobBase,
} from '../core';

// ──────────────────────────────────────────────────────────────────────────
// 外部／尚未落地型別的占位（AMBIGUITY：詳見交付說明）。
// 這些名稱在來源文件被引用但未在 core 或本模組定義；先以最小占位保證可編譯。
// ──────────────────────────────────────────────────────────────────────────

// 由 organization/social 模組擁有（core 尚無此 ID）。
export type OrganizationId = DefinitionId<'organization'>;

// 由效果／定義子系統擁有的效果定義結構（本文件僅引用，未提供 schema）。
export type EffectDefinition = Readonly<{ id: EffectDefinitionId }>;

// 本模組擁有但來源文件未列舉的分類鍵。
export type CharacterRoleTag = string;
export type RelationshipFactKind = string;

export type TemporaryCharacterRuleId = DefinitionId<'temporary-character-rule'>;

// 任務暫時角色（護衛／救援）的生成規則。
//
// 原本是 `DefinitionHeader & Readonly<Record<string, unknown>>`——規範 §7 明文禁止的
// 「用 Record<string, unknown> 繞過 Schema」。後果不只是型別鬆：Handler 因此無處可讀性別，
// 於是它自己寫死了 `sex: 'female'`，而 04_character_module.md §「Character 不得自行假設
// 50／50 性別、固定年齡或跨文化共用原型」正是在禁止這件事。
//
// 形狀比照姊妹規則 `WorldAdventurerGenerationRuleDefinition`：規則本身只**指名**每一項可變
// 決定由哪個 Resolver 負責，係數與權重由各 Resolver 自己的 params 定義帶（§7.1「形狀＝程式、
// 調校＝資料」）。這裡不放 params 袋子，否則又是一個繞過 Schema 的洞。
//
// 原型不在此列：設計 §7.1「護衛資料在任務生成時只有身分原型」——archetypeId 由 Quest 於
// CreateQuestTemporaryCharacter 指定，不由本規則挑選。
export type TemporaryCharacterRuleDefinition = DefinitionHeader<TemporaryCharacterRuleId> &
  Readonly<{
    kind: 'escort' | 'rescue';
    sexWeightResolverId: ResolverId;
    innateTraitResolverId: ResolverId;
  }>;

// ──────────────────────────────────────────────────────────────────────────
// 共用列舉（來源文件為 inline union，抽名以利事件／查詢重用）。
// ──────────────────────────────────────────────────────────────────────────

export type Sex = 'male' | 'female';
export type CharacterOrigin =
  | 'playerLineage'
  | 'worldAdventurer'
  | 'worldResident'
  | 'questTemporary';
export type CharacterLifeState = 'alive' | 'dead' | 'retired';
export type CharacterAvailability =
  | 'available'
  | 'incapacitated'
  | 'temporary'
  | 'unavailable';
export type RelationshipFactState = 'unresolved' | 'resolved';
export type FamilyLinkKind = 'partner' | 'guardian' | 'adoption';

// ──────────────────────────────────────────────────────────────────────────
// §2 靜態資料契約
// ──────────────────────────────────────────────────────────────────────────

export interface CharacterDefinitionReader {
  getArchetype(id: CharacterArchetypeId): CharacterArchetypeDefinition;
  getLifecycleRule(id: LifecycleRuleId): LifecycleRuleDefinition;
  getStatusDefinition(id: CharacterStatusDefinitionId): StatusDefinition;
  getBirthRule(id: BirthRuleId): BirthRuleDefinition;
  getTemporaryCharacterRule(id: TemporaryCharacterRuleId): TemporaryCharacterRuleDefinition;
  getWorldAdventurerGenerationRule(
    id: WorldAdventurerGenerationRuleId,
  ): WorldAdventurerGenerationRuleDefinition;
}

export type CharacterCreationDraft = Readonly<{
  archetypeId: CharacterArchetypeId;
  sex: Sex;
  birthDay: WorldDay;
}>;

export type CharacterArchetypeDefinition = DefinitionHeader<CharacterArchetypeId> &
  Readonly<{
    roleTags: readonly CharacterRoleTag[];
    cultureId?: CultureId;
    lifecycleRuleId: LifecycleRuleId;
    innateTraitPoolId?: CharacterTraitPoolId;
    canBecomeAdventurer: boolean;
    temporaryOnly: boolean;
  }>;

export type LifecycleRuleDefinition = DefinitionHeader<LifecycleRuleId> &
  Readonly<{
    adulthoodAgeDays: number;
    naturalLifeEndAgeDays: number;
    playableAgeStartDays: number;
    playableAgeEndDays: number;
    ageModifierRuleId: AgeModifierRuleId;
    retirementResolverId?: ResolverId;
    naturalDeathResolverId: ResolverId;
  }>;

export type WorldAdventurerGenerationRuleDefinition =
  DefinitionHeader<WorldAdventurerGenerationRuleId> &
    Readonly<{
      allowedArchetypeIds: readonly CharacterArchetypeId[];
      archetypeWeightResolverId: ResolverId;
      sexWeightResolverId: ResolverId;
      startingAgeResolverId: ResolverId;
      innateTraitResolverId: ResolverId;
    }>;

export type StatusDefinition = DefinitionHeader<CharacterStatusDefinitionId> &
  Readonly<{
    category: 'temporaryCondition';
    clearByRest: boolean;
    stackPolicy: 'replace' | 'refresh' | 'stack';
    effects: readonly EffectDefinition[];
  }>;

export type BirthRuleDefinition = DefinitionHeader<BirthRuleId> &
  Readonly<{
    requiredRestDays: number; // 第一版為 365
    eligibilityResolverId: ResolverId;
    birthResolverId: ResolverId;
  }>;

// ──────────────────────────────────────────────────────────────────────────
// §1.1 / §3 Runtime State
// ──────────────────────────────────────────────────────────────────────────

export type CharacterState = Readonly<{
  characters: Readonly<Record<CharacterId, Character>>;
  familyLinks: Readonly<Record<FamilyLinkId, FamilyLink>>;
  relationshipFacts: Readonly<Record<RelationshipFactId, CharacterRelationshipFact>>;
}>;

export type Character = Readonly<{
  characterId: CharacterId;
  archetypeId: CharacterArchetypeId;
  origin: CharacterOrigin;
  sex: Sex;

  birthDay: WorldDay;
  lifeState: CharacterLifeState;
  availability: CharacterAvailability;

  parentIds: readonly CharacterId[]; // 0..2；出生後不可修改
  childIds: readonly CharacterId[];
  innateTraitIds: readonly CharacterTraitDefinitionId[];
  homeId?: HomeId;
  reputation: number;

  condition: CharacterCondition;
  temporaryOrigin?: TemporaryCharacterOrigin;
  revision: Revision;
  // 生命週期排程 token，**逐種類分開**。characterLifecycleDue Job 以對應種類的值當 expectedRevision。
  //
  // 為什麼不是 `revision`：它每次受傷、狀態變更、可用性調整都會跳，拿它驗會讓成年／退休／自然死亡
  // Job 在到期前就全部「過期」而永不觸發（R8 #6）。
  // 為什麼不是單一個 lifecycleRevision：退休會跳它，連帶讓角色出生時就排好的**自然死亡** Job 一起
  // 失效，退休角色從此不會自然老死（R9 #3）。三種 Job 的失效條件本來就不同，所以 token 也要分開。
  lifecycleRevisions: CharacterLifecycleTokens;
}>;

export type CharacterLifecycleKind = 'adulthood' | 'retirementCheck' | 'naturalDeathCheck';

// 各自的失效條件：
//   adulthood        —— 死亡。
//   retirementCheck  —— 死亡、或已經退休（不再需要退休檢查）。
//   naturalDeathCheck—— 只有死亡。**退休不算**：退休角色仍會自然老死。
export type CharacterLifecycleTokens = Readonly<Record<CharacterLifecycleKind, Revision>>;

export type CharacterCondition = Readonly<{
  health: number;
  mana: number;
  statuses: readonly CharacterStatusInstance[];
}>;

export type CharacterStatusInstance = Readonly<{
  statusInstanceId: CharacterStatusInstanceId;
  statusId: CharacterStatusDefinitionId;
  sourceId?: EntitySourceRef;
  appliedOnDay: WorldDay;
  expiresOnDay?: WorldDay;
  stacks: number;
}>;

export type TemporaryCharacterOrigin =
  | Readonly<{
      kind: 'escort';
      sourceQuestId: QuestId;
      recoveryPolicy: 'escortQuestLifecycle';
    }>
  | Readonly<{
      kind: 'rescue';
      sourceQuestId: QuestId;
      recoveryPolicy: 'rescueQuestLifecycle';
    }>;

export type FamilyLink = Readonly<{
  familyLinkId: FamilyLinkId;
  kind: FamilyLinkKind;
  characterIds: readonly CharacterId[];
  activeFromDay: WorldDay;
  activeToDay?: WorldDay;
  revision: Revision;
}>;

export type CharacterRelationshipFact = Readonly<{
  relationshipFactId: RelationshipFactId;
  subjectCharacterId: CharacterId;
  counterpart:
    | Readonly<{ kind: 'character'; characterId: CharacterId }>
    | Readonly<{ kind: 'organization'; organizationId: OrganizationId }>;
  kind: RelationshipFactKind;
  sourceId: EntitySourceRef;
  state: RelationshipFactState;
  openedOnDay: WorldDay;
  resolvedOnDay?: WorldDay;
  revision: Revision;
}>;

// ──────────────────────────────────────────────────────────────────────────
// §4 公開 Query 與 Reader Port
// View DTO 的精確 schema 未於來源文件給出；先以最小投影占位（AMBIGUITY）。
// ──────────────────────────────────────────────────────────────────────────

export type CharacterView = Character;
export type CharacterConditionView = CharacterCondition;
export type CharacterRelationshipFactView = CharacterRelationshipFact;

export interface CharacterQuery {
  getCharacter(id: CharacterId): CharacterView;
  isAvailable(id: CharacterId): boolean;
  getCondition(id: CharacterId): CharacterConditionView;
  getAgeDays(id: CharacterId, onDay: WorldDay): number;
  getSex(id: CharacterId): Sex;
  getActivePartner(id: CharacterId): CharacterId | undefined;
  listChildren(id: CharacterId): readonly CharacterId[];
  getInnateTraits(id: CharacterId): readonly CharacterTraitDefinitionId[];
  listUnresolvedRelationships(id: CharacterId): readonly CharacterRelationshipFactView[];
  getTemporaryOrigin(id: CharacterId): TemporaryCharacterOrigin | undefined;
}

// Character 需要的 consumer Port，由 Composition Adapter（Derived Statistics）實作。
export interface CharacterStatsQuery {
  getStats(id: CharacterId): Readonly<{
    maxHealth: number;
    maxMana: number;
  }>;
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 Internal Command（payload 依表格與流程推導；未明列處以最小欄位占位）
// ──────────────────────────────────────────────────────────────────────────

export type CreateQuestTemporaryCharacter = Readonly<{
  type: 'CreateQuestTemporaryCharacter';
  kind: 'escort' | 'rescue';
  archetypeId: CharacterArchetypeId;
  sourceQuestId: QuestId;
}>;

export type CreateWorldAdventurerBatch = Readonly<{
  type: 'CreateWorldAdventurerBatch';
  cityId: CityId;
  cultureId: CultureId;
  count: number;
  generationRuleId: WorldAdventurerGenerationRuleId;
  rngContext: RngContext;
}>;

export type ApplyCharacterReputationEffect = Readonly<{
  type: 'ApplyCharacterReputationEffect';
  characterId: CharacterId;
  effectId: EffectDefinitionId;
  sourceId: EntitySourceRef;
}>;

export type CreatePartnerFamilyLink = Readonly<{
  type: 'CreatePartnerFamilyLink';
  characterIds: readonly [CharacterId, CharacterId];
  sourceId: EntitySourceRef;
}>;

export type ApplyContentEventStatus = Readonly<{
  type: 'ApplyContentEventStatus';
  contentEventInstanceId: ContentEventInstanceId;
  effectId: EffectDefinitionId;
  characterId: CharacterId;
  statusId: CharacterStatusDefinitionId;
}>;

export type OpenCharacterRelationshipFact = Readonly<{
  type: 'OpenCharacterRelationshipFact';
  subjectCharacterId: CharacterId;
  counterpart:
    | Readonly<{ kind: 'character'; characterId: CharacterId }>
    | Readonly<{ kind: 'organization'; organizationId: OrganizationId }>;
  kind: RelationshipFactKind;
  sourceId: EntitySourceRef;
}>;

export type ResolveCharacterRelationshipFact = Readonly<{
  type: 'ResolveCharacterRelationshipFact';
  relationshipFactId: RelationshipFactId;
  sourceId: EntitySourceRef;
}>;

// B.5：本契約原本缺 Internal Command 與 DomainEvent 的聯集宣告，Router 無從得知
// 「character 這個模組到底收送哪些訊息」。此處補齊；判別欄由各 payload 自帶。
export type CharacterInternalCommand =
  | CreateQuestTemporaryCharacter
  | CreateWorldAdventurerBatch
  | ApplyCharacterReputationEffect
  | CreatePartnerFamilyLink
  | ApplyContentEventStatus
  | OpenCharacterRelationshipFact
  | ResolveCharacterRelationshipFact
  | ApplyCombatCondition
  | ApplyFoodStatusEffects;

export type ApplyCombatCondition = Readonly<{
  type: 'ApplyCombatCondition';
  characterId: CharacterId;
  healthDelta?: number;
  manaDelta?: number;
  statusChanges?: readonly CharacterStatusChange[];
}>;

// 帶的是**已解析的 StatusId**，不是 EffectId。原本宣告成 `effectIds: EffectDefinitionId[]`，
// Handler 再 `as unknown as` 當成 statusId 用——但 Character 沒有能力做那層對照：它的 Reader 只有
// getStatusDefinition，Effect 定義的擁有者是 Crafting／Combat 而不是 Character。§12：不擁有這個事實
// 的地方不得決定它。對照因此留在送出端（Crafting Workflow，尚未實作），契約在此陳述它收到的是什麼。
// 兩個 ID 家族若剛好同名，原本的轉型會在執行期查不到 Status 而靜默失效——那正是這裡要擋掉的。
export type ApplyFoodStatusEffects = Readonly<{
  type: 'ApplyFoodStatusEffects';
  characterId: CharacterId;
  foodStatusRevision: Revision;
  operation: 'apply' | 'remove';
  statusIds: readonly CharacterStatusDefinitionId[];
}>;

// 狀態變更描述（事件與命令共用；來源文件未給精確 schema）(AMBIGUITY)。
//
// 以 `change` 判別：層數只有在套用／刷新時才有意義，移除時沒有。原本 `stacks?: number` 對三種變更
// 一視同仁，Handler 於是寫 `change.stacks ?? 1`——那個 1 是**玩法值**（要疊幾層是內容決定的），
// 不是結構預設。改成聯集後，該講層數的地方必須講，不該講的地方講不出來。
export type CharacterStatusChange = Readonly<{ statusId: CharacterStatusDefinitionId }> &
  (
    | Readonly<{ change: 'applied' | 'refreshed'; stacks: number }>
    | Readonly<{ change: 'removed' }>
  );

// ──────────────────────────────────────────────────────────────────────────
// §5.3 Character 自己處理的 Job（characterLifecycleDue）
// ──────────────────────────────────────────────────────────────────────────

export type CharacterLifecycleJobPayload =
  | Readonly<{ kind: 'adulthood' }>
  | Readonly<{ kind: 'retirementCheck' }>
  | Readonly<{ kind: 'naturalDeathCheck' }>;

export type CharacterLifecycleJob = ScheduledJobBase<
  'characterLifecycleDue',
  ModuleId,
  CharacterId,
  CharacterLifecycleJobPayload
>;

// ──────────────────────────────────────────────────────────────────────────
// §6 輸出事件（最少 payload）
// ──────────────────────────────────────────────────────────────────────────

export type CharacterCreatedEvent = Readonly<{
  type: 'CharacterCreated';
  characterId: CharacterId;
  origin: CharacterOrigin;
  archetypeId: CharacterArchetypeId;
}>;

export type CharacterAvailabilityChangedEvent = Readonly<{
  type: 'CharacterAvailabilityChanged';
  characterId: CharacterId;
  oldAvailability: CharacterAvailability;
  newAvailability: CharacterAvailability;
  reason: string;
}>;

export type CharacterConditionChangedEvent = Readonly<{
  type: 'CharacterConditionChanged';
  characterId: CharacterId;
  health: number;
  mana: number;
  statusChanges: readonly CharacterStatusChange[];
}>;

export type CharacterDiedEvent = Readonly<{
  type: 'CharacterDied';
  characterId: CharacterId;
  deathDay: WorldDay;
  reason: string;
}>;

export type CharacterBornEvent = Readonly<{
  type: 'CharacterBorn';
  characterId: CharacterId;
  parentIds: readonly CharacterId[];
  birthDay: WorldDay;
}>;

export type CharacterBecameAdultEvent = Readonly<{
  type: 'CharacterBecameAdult';
  characterId: CharacterId;
  ageDays: number;
}>;

export type CharacterRetiredEvent = Readonly<{
  type: 'CharacterRetired';
  characterId: CharacterId;
  retiredOnDay: WorldDay;
}>;

export type TemporaryCharacterRecoveredEvent = Readonly<{
  type: 'TemporaryCharacterRecovered';
  characterId: CharacterId;
  sourceQuestId: QuestId;
  reason: string;
}>;

export type CharacterReputationChangedEvent = Readonly<{
  type: 'CharacterReputationChanged';
  characterId: CharacterId;
  oldValue: number;
  newValue: number;
}>;

export type CharacterRelationshipChangedEvent = Readonly<{
  type: 'CharacterRelationshipChanged';
  relationshipFactId: RelationshipFactId;
  subjectCharacterId: CharacterId;
  state: RelationshipFactState;
}>;

export type FamilyLinkChangedEvent = Readonly<{
  type: 'FamilyLinkChanged';
  familyLinkId: FamilyLinkId;
  kind: FamilyLinkKind;
  characterIds: readonly CharacterId[];
  change: 'created' | 'ended';
  worldDay: WorldDay;
}>;

export type CharacterDomainEvent =
  | CharacterCreatedEvent
  | CharacterAvailabilityChangedEvent
  | CharacterConditionChangedEvent
  | CharacterDiedEvent
  | CharacterBornEvent
  | CharacterBecameAdultEvent
  | CharacterRetiredEvent
  | TemporaryCharacterRecoveredEvent
  | CharacterReputationChangedEvent
  | CharacterRelationshipChangedEvent
  | FamilyLinkChangedEvent;
