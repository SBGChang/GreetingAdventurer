import type { CharacterName } from './names';
export * from './names';
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

// EffectDefinition 住在 contracts/core（沒有模組擁有它——character 的 StatusDefinition、內容事件
// 選項、crafting 都只是消費者）。這裡原本是 `Readonly<{ id: EffectDefinitionId }>` 的空殼，只有
// 一個 ID。空殼的後果不是型別鬆而是**功能缺失**：拿到一筆 Effect 也不知道要做什麼，所以事件選項
// 只能一律回報成功。真正的形狀是 13_data_runtime.md §6.1 的封閉 tagged variant。
import type { EffectDefinition } from '../core';
export type { EffectDefinition };

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
// 領域變體放 `temporaryKind` 而非 `kind`：`kind` 是 Content Pack 的**家族宣告**，窄化 Reader 以它
// 判斷所有權（本型別的 registry kind 是 `'temporary-character-rule'`）。一筆 JSON 只有一個 `kind`，不可能同時是
// `'temporary-character-rule'` 與 `'escort'`——內容一接上就一筆也讀不到。正確樣式見 EquipmentDefinition
// （`kind: 'equipment'` + `equipmentKind`）。由 verify:discipline 的檢查 7 自動把關。
export type TemporaryCharacterRuleDefinition = DefinitionHeader<TemporaryCharacterRuleId> &
  Readonly<{
    temporaryKind: 'escort' | 'rescue';
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
  name: CharacterName;
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
  // 角色**還沒進 Slice** 時的上限查詢（世界冒險者生成、出生）。
  //
  // 為什麼需要第二個入口：新角色的初始 HP/MP 就是它的上限，而上限要算就得先有角色的
  // revision／年齡／聲望——用 id 去查一個還沒插進去的角色必然查不到。原本的寫法是在插入前
  // 呼叫 `getStats(id)`，只有在 stub 回固定值時才看不出來；接上正式的派生統計 Port 就會以
  // 「unknown characterId」拋。傳入草稿本身是唯一不必說謊也不必調換插入順序的形狀。
  getStatsForCharacter(character: Character): Readonly<{
    maxHealth: number;
    maxMana: number;
  }>;
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 Internal Command（payload 依表格與流程推導；未明列處以最小欄位占位）
// ──────────────────────────────────────────────────────────────────────────

export type CreateQuestTemporaryCharacter = Readonly<{
  type: 'CreateQuestTemporaryCharacter';
  originCityId: CityId;
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
  // 選填＝本命令不動狀態（結算只回寫 HP/MP 的呼叫就是這樣）。與 healthDelta／manaDelta 的
  // 選填語意一致：「沒帶」是「不碰這一項」，不是「帶了一個空的請求」。
  statusChanges?: readonly CharacterStatusChangeRequest[];
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

// ──────────────────────────────────────────────────────────────────────────
// 狀態變更描述：**請求**與**結果**是兩張表（04_character_module.md §5.1、§6）。
//
// 原本這裡只有一個 `CharacterStatusChange`，被 `ApplyCombatCondition`（命令）與
// `CharacterConditionChanged`（事件）**共用**，並標著 (AMBIGUITY)。共用是錯的，而且不是命名問題：
//
//   * 命令是「請 Character 做這件事」。送出端**不知道**目標身上有沒有那個狀態，也**不擁有**
//     `StatusDefinition.stackPolicy`（doc §2.3 說疊加完全由該定義決定）。所以它說不出、也無權說
//     這次會是「新套用」還是「刷新」。
//   * 事件是「Character 實際做了什麼」。applied／refreshed 的分野正是 stackPolicy 算出來的結果。
//
// 共用一張表的實際後果，在 handleApplyCombatCondition 裡看得見：命令若填 `change: 'refreshed'`，
// Handler 走的仍是套用路徑、事件仍照 stackPolicy 回報——**送出端寫的那個字從頭到尾沒有人讀**。
// 那不是多餘欄位，是一個看起來能表達其實不能表達的欄位（skill §6.0「功能不同的東西不共用一張表」）。
// 拆開後，值集本身就在說話：命令用祈使（apply／remove），事件用完成式（applied／refreshed／removed）。
// ──────────────────────────────────────────────────────────────────────────

// 【命令側】`ApplyCombatCondition.statusChanges` 的元素。
//
// 逐欄位來源：
//   statusId —— 消費者 handleApplyCombatCondition（`ctx.definitions.getStatusDefinition(...)` 與
//               移除時的比對鍵）；doc §5.1「套用生命、魔力與暫時狀態改變」。
//   change   —— 判讀：Handler 實際只分辨兩條路徑（套用／移除），`applied` 與 `refreshed` 對它是
//               同一條。可表達的只有這兩個意圖，所以就只給這兩個。
//   stacks   —— 消費者 handleApplyCombatCondition（寫進 CharacterStatusInstance.stacks；`stack`
//               政策下再與既有層數相加）。必填：要疊幾層是送出端解析效果時就已決定的內容值，
//               缺了它 Handler 只能寫 `?? 1`，而那個 1 是玩法值不是結構預設。
//               移除沒有層數可談，所以那個 variant 裡講不出來。
export type CharacterStatusChangeRequest = Readonly<{ statusId: CharacterStatusDefinitionId }> &
  (Readonly<{ change: 'apply'; stacks: number }> | Readonly<{ change: 'remove' }>);

// 【事件側】`CharacterConditionChanged.statusChanges` 的元素（doc §6 只列出欄位名，形狀在此定案）。
//
// 逐欄位來源：
//   statusId —— 生產者 character/system.ts 的五個發送點；doc §6 payload 欄位 `statusChanges`。
//   change   —— 生產者 applyStatus()：新套用回 `applied`，既有狀態依 replace／refresh／stack 三種
//               政策回 `refreshed`；移除路徑回 `removed`。
//   stacks   —— 生產者 applyStatus()：**套用後的實際層數**（`stack` 政策下是累加後的值，不是這次
//               加了幾層）。applied 與 refreshed 共用同一個 variant，因為兩者都必填且語意相同
//               （skill §6.0 規矩二）；`removed` 沒有層數。
//
// `removed` 是**真的移除掉了**才會出現一筆——請求移除一個身上沒有的狀態不會產生任何一筆。事件描述
// 已發生的事實，不是把請求覆述一遍。
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
