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

// Reader 引用但來源文件未給 schema 的暫時角色規則。
export type TemporaryCharacterRuleId = DefinitionId<'temporary-character-rule'>;
export type TemporaryCharacterRuleDefinition = DefinitionHeader<TemporaryCharacterRuleId> &
  Readonly<Record<string, unknown>>;

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
  // 生命週期專用版本。characterLifecycleDue Job 以此當 expectedRevision，而**不是** `revision`：
  // `revision` 每次受傷、狀態變更、可用性調整都會跳，拿它驗會讓成年／退休／自然死亡 Job 全部過期
  // 而永遠不觸發。只有「使已排程的生命週期 Job 失效」的轉換才跳這個值——即 lifeState 轉換
  // （alive → retired / dead）。
  lifecycleRevision: Revision;
}>;

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

export type ApplyFoodStatusEffects = Readonly<{
  type: 'ApplyFoodStatusEffects';
  characterId: CharacterId;
  foodStatusRevision: Revision;
  operation: 'apply' | 'remove';
  effectIds: readonly EffectDefinitionId[];
}>;

// 狀態變更描述（事件與命令共用；來源文件未給精確 schema）(AMBIGUITY)。
export type CharacterStatusChange = Readonly<{
  statusId: CharacterStatusDefinitionId;
  change: 'applied' | 'removed' | 'refreshed';
  stacks?: number;
}>;

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
