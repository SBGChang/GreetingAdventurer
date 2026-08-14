// contracts/inventory — public contract transcribed from docs/00_core/architecture/05_inventory_module.md
// Pure types only. Internal mutable InventoryState / ItemInstance /
// CharacterEquipmentLoadout / EncumbranceResolution records are not transcribed;
// query-returned Views are derived as Readonly projections.

import type { DefinitionId, Revision, WorldDay } from '../core';
import type { DefinitionHeader, LocalizedTextRef } from '../core';
import type {
  ItemInstanceId,
  ItemDefinitionId,
  EquipmentDefinitionId,
  BookDefinitionId,
  UseDelayRuleId,
  CraftingRecipeId,
  CraftingAttemptId,
  CharacterId,
  CityId,
  HomeId,
  ShopId,
  ContentInstanceId,
  WeaponSetId,
  QuestId,
  TeamId,
  AssetDistributionId,
  EncumbranceResolutionId,
  ResolverId,
  MaterialAffixId,
  MaterialTagId,
  ItemTagId,
  CurrencyId,
  EffectDefinitionId,
  EquipmentEffectDefinitionId,
  SkillDefinitionId,
  MasteryId,
  CultureId,
  EntitySourceRef,
} from '../core';
// Cross-module (owned by peer modules in this batch):
import type { MoneyValue } from '../economy';
import type { CraftQuality } from '../crafting';

// ── Invented placeholder IDs (absent from core) ─────────────────────────────
export type GeneralItemCategoryId = DefinitionId<'general-item-category'>; // PLACEHOLDER (invented)
export type NonCombatUseRuleId = DefinitionId<'non-combat-use-rule'>; // PLACEHOLDER (invented)
export type ItemUseContextId = DefinitionId<'item-use-context'>; // PLACEHOLDER (invented)
export type EquipmentSlotId = DefinitionId<'equipment-slot'>; // PLACEHOLDER (invented)
export type EquipmentCoefficientChannelId = DefinitionId<'equipment-coefficient-channel'>; // PLACEHOLDER (invented, per brief)

// ── Foreign placeholder IDs (owned by other modules, absent from core) ──────
// PrimaryAttributeId 由 progression 擁有，且是 5 個字面值的聯集（不是 branded ID）。
// 原本此處宣告成 DefinitionId，會讓 PrimaryAttributeCoefficients 變成任意鍵的 Record。
import type { PrimaryAttributeId } from '../progression';
export type { PrimaryAttributeId };
export type CharacterKnowledgeId = DefinitionId<'character-knowledge'>; // PLACEHOLDER (invented): owned by progression
// combat-sequence 擁有這兩個 ID，且它們是 RuntimeId（每場戰鬥串是執行期實例），
// 不是 DefinitionId。原本此處各自宣告成 DefinitionId，跨模組傳遞時型別家族就錯了。
import type { CombatSequenceId, CombatSequenceChallengeId } from '../combat-sequence';
export type { CombatSequenceId, CombatSequenceChallengeId };

// ── Invented structural placeholders (shape not specified in doc) ───────────
export type TradePolicy = Readonly<{ tradable: boolean }>; // PLACEHOLDER (invented)
export type ItemDisplayDefinition = Readonly<{ nameRef: LocalizedTextRef }>; // PLACEHOLDER (invented)
export type EquipmentKind = 'weapon' | 'armor' | 'shield' | 'accessory'; // PLACEHOLDER (invented)
export type PrimaryAttributeCoefficients = Readonly<Record<PrimaryAttributeId, number>>; // PLACEHOLDER (invented)
export type SecondaryAttributeCoefficients = Readonly<{
  channelId: EquipmentCoefficientChannelId;
  coefficient: number;
}>; // PLACEHOLDER (invented)
export type EquipmentSkillEffectRef = Readonly<{ effectId: EquipmentEffectDefinitionId }>; // PLACEHOLDER (invented)
export type ItemRemovalReason =
  | 'consumed'
  | 'questCleanup'
  | 'refreshCleanup'
  | 'abandoned'
  | 'transferredOut'
  | 'other'; // PLACEHOLDER (invented)
export type BookLearningTarget =
  | Readonly<{ kind: 'skill'; skillId: SkillDefinitionId }>
  | Readonly<{ kind: 'recipe'; recipeId: CraftingRecipeId }>
  | Readonly<{ kind: 'mastery'; masteryId: MasteryId }>; // PLACEHOLDER (invented)

// ── Static data contract ────────────────────────────────────────────────────
export type ItemKind =
  | 'equipment'
  | 'combatConsumable'
  | 'nonCombatConsumable'
  | 'generalItem'
  | 'book'
  | 'material';

export type ItemDefinition = DefinitionHeader & Readonly<{
  originCultureId: CultureId;
  itemTagIds: readonly ItemTagId[];
  kind: ItemKind;
  stackPolicy: 'single' | 'stackable';
  maxStack?: number;
  unitWeight: number;
  tradePolicy: TradePolicy;
  display: ItemDisplayDefinition;
  intrinsicValue: Readonly<{ currencyId: CurrencyId; amount: number }>;
  generalItemCategoryId?: GeneralItemCategoryId;
  combatUseDelayRuleId?: UseDelayRuleId;
  nonCombatUseRuleId?: NonCombatUseRuleId;
  useEffectIds?: readonly EffectDefinitionId[];
  materialTagIds?: readonly MaterialTagId[];
  materialAffixId?: MaterialAffixId;
  unresolvedMapDisposition: 'toCityPermanentStock' | 'removeOnRefresh';
}>;

// 手部位置是**配置**決定的，不是定義決定的：同一把單手武器放主手或副手都合法（GDD §511 雙持——
// 同組內可混搭兩種武器；§250 傷害倍率左手 ×0.5、右手 ×0.35）。`occupiedSlots` 只能說「占哪幾個 slot」，
// 表達不出「這把單手武器現在在副手」，所以需要獨立的手別契約。
export type EquipmentHand = 'mainHand' | 'offHand';

// 可放置手別 → 放在該手時要寫進 ItemLocation.slotId 的 slot。
//   單手武器：兩手皆列出（可雙持），各自對應自己那手的 slot。
//   盾：只列 offHand。
//   雙手武器：兩手皆列出，且 occupiedSlots.length > 1 表示必須**同時**占滿兩手（非二選一）。
//   鎧甲／飾品：空物件——不可放任何一手。
export type EquipmentHandSlots = Readonly<Partial<Record<EquipmentHand, EquipmentSlotId>>>;

export type EquipmentDefinition = ItemDefinition & Readonly<{
  kind: 'equipment';
  equipmentKind: EquipmentKind;
  rarity: 'common' | 'fine' | 'epic' | 'legendary' | 'mythic';
  relatedMasteryIds: readonly MasteryId[];
  occupiedSlots: readonly EquipmentSlotId[];
  handSlots: EquipmentHandSlots;
  primaryAttributeCoefficients: PrimaryAttributeCoefficients;
  secondaryAttributeCoefficients: readonly SecondaryAttributeCoefficients[];
  skillEffectRefs: readonly EquipmentSkillEffectRef[];
}>;

export type UseDelayAttributeReductionRule = Readonly<{
  primaryAttribute: PrimaryAttributeId;
  reductionPerPoint: number;
}>;

export type UseDelayRuleDefinition = DefinitionHeader & Readonly<{
  baseDelay: number;
  reductions: readonly UseDelayAttributeReductionRule[];
  minimumDelay: number;
}>;

// Book tier ladder (doc §2.5). Exported for progression's learning-gate logic.
export type BookTier = 'basic' | 'advanced' | 'supreme';

export type BookDefinition = ItemDefinition & Readonly<{
  kind: 'book';
  tier: BookTier;
  teaches: readonly BookLearningTarget[];
  learningPolicy: 'retainAfterLearning' | 'consumeOnLearning';
}>;

export type NonCombatUseRuleDefinition = DefinitionHeader & Readonly<{
  timing:
    | Readonly<{ kind: 'zeroTime' }>
    | Readonly<{ kind: 'dungeonMinutes'; minutes: number }>
    | Readonly<{ kind: 'teamPlanDays'; durationDays: number }>;
  allowedContextIds: readonly ItemUseContextId[];
}>;

export interface ItemDefinitionReader {
  getItem(id: ItemDefinitionId): ItemDefinition;
  getEquipment(id: EquipmentDefinitionId): EquipmentDefinition;
  getUseDelayRule(id: UseDelayRuleId): UseDelayRuleDefinition;
  getNonCombatUseRule(id: NonCombatUseRuleId): NonCombatUseRuleDefinition;
  getBook(id: BookDefinitionId): BookDefinition;
}

// ── Value / projection types ────────────────────────────────────────────────
export type ItemInstanceState = 'active' | 'consumed' | 'removed';

export type ItemInstanceData =
  | Readonly<{
      kind: 'craftedEquipment';
      craftingAttemptId: CraftingAttemptId;
      quality: CraftQuality;
      inheritedMaterialAffixIds: readonly MaterialAffixId[];
    }>
  | Readonly<{
      kind: 'craftedTradeGood';
      craftingAttemptId: CraftingAttemptId;
      quality: CraftQuality;
      saleMultiplierResolverId: ResolverId;
    }>;

export type ItemLocation =
  | Readonly<{ kind: 'characterBag'; characterId: CharacterId }>
  | Readonly<{ kind: 'homeStorage'; homeId: HomeId; characterId: CharacterId }>
  | Readonly<{ kind: 'cityPermanentStock'; cityId: CityId }>
  | Readonly<{ kind: 'shopShelf'; cityId: CityId; shopId: ShopId }>
  | Readonly<{ kind: 'mapContent'; contentId: ContentInstanceId }>
  | Readonly<{
      kind: 'equipped';
      characterId: CharacterId;
      slotId: EquipmentSlotId;
      weaponSetId?: WeaponSetId;
    }>
  | Readonly<{ kind: 'questEscrow'; questId: QuestId }>
  | Readonly<{
      kind: 'teamQuestCargo';
      teamId: TeamId;
      questId: QuestId;
      carrierCharacterId: CharacterId;
    }>
  | Readonly<{ kind: 'assetDistributionEscrow'; distributionId: AssetDistributionId }>
  | Readonly<{ kind: 'removed'; reason: ItemRemovalReason }>;

// 判別聯集而非 `kind` 欄位聯集：craftingInput 必須帶 craftingAttemptId，由編譯器強制。
// 原本三種保留共用同一個扁平結構，ReserveCraftingInputs 收到的 craftingAttemptId 無處可放而被丟掉，
// 素材保留給哪一次製作事後無從確認（也就無法在消耗時驗證是不是同一次）。
export type ItemReservation =
  | Readonly<{
      kind: 'questTarget';
      ownerId: CharacterId | AssetDistributionId | TeamId;
      reservedQuantity: number;
    }>
  | Readonly<{
      kind: 'craftingInput';
      ownerId: CharacterId | AssetDistributionId | TeamId;
      reservedQuantity: number;
      craftingAttemptId: CraftingAttemptId;
    }>
  | Readonly<{
      kind: 'pendingTransfer';
      ownerId: CharacterId | AssetDistributionId | TeamId;
      reservedQuantity: number;
    }>;

export type EncumbranceResolutionState = 'deferredDuringTravel' | 'awaitingPlayer';

// Produced by Derived Statistics Query (doc §4); transcribed as-defined.
export type CarryCapacitySnapshot = Readonly<{
  characterId: CharacterId;
  maximumWeight: number;
  sourceRevisionKey: string;
}>;

// ── Public Query + View DTOs (Views derived) ────────────────────────────────
export type ItemInstanceView = Readonly<{
  itemId: ItemInstanceId;
  definitionId: ItemDefinitionId;
  quantity: number;
  ownerCharacterId?: CharacterId;
  location: ItemLocation;
  reservation?: ItemReservation;
  state: ItemInstanceState;
  instanceData?: ItemInstanceData;
  revision: Revision;
}>;

export type WeaponSetLoadoutView = Readonly<{
  weaponSetId: WeaponSetId;
  mainHandItemId?: ItemInstanceId;
  offHandItemId?: ItemInstanceId;
  selectedSkillIds: readonly [SkillDefinitionId?, SkillDefinitionId?, SkillDefinitionId?];
}>;

// Inventory owns this View; other modules import it from here.
export type CharacterEquipmentLoadoutView = Readonly<{
  characterId: CharacterId;
  armorSlots: Readonly<Record<EquipmentSlotId, ItemInstanceId | undefined>>;
  weaponSets: readonly [WeaponSetLoadoutView, WeaponSetLoadoutView, WeaponSetLoadoutView];
  revision: Revision;
}>;

export type EncumbranceResolutionView = Readonly<{
  resolutionId: EncumbranceResolutionId;
  teamId: TeamId;
  overweightCharacterIds: readonly CharacterId[];
  state: EncumbranceResolutionState;
  triggerSourceId: EntitySourceRef;
  openedOnDay?: WorldDay;
  revision: Revision;
}>;

// Selector for listAtLocation; doc names but does not specify. Mirrors ItemLocation.
export type ItemLocationSelector = ItemLocation; // PLACEHOLDER (derived)

export interface InventoryQuery {
  getItem(itemId: ItemInstanceId): ItemInstanceView | undefined;
  getLocation(itemId: ItemInstanceId): ItemLocation | undefined;
  getOwningCharacter(itemId: ItemInstanceId): CharacterId | undefined;
  getIntrinsicValue(itemId: ItemInstanceId): MoneyValue;
  getItemWeight(itemId: ItemInstanceId): number;
  getCarriedWeight(characterId: CharacterId): number;
  listAtLocation(location: ItemLocationSelector): readonly ItemInstanceView[];
  characterOwnsItem(characterId: CharacterId, itemId: ItemInstanceId): boolean;
  characterHasBook(characterId: CharacterId, bookId: ItemInstanceId): boolean;
  isReserved(itemId: ItemInstanceId): boolean;
  getEquippedItem(
    characterId: CharacterId,
    slotId: EquipmentSlotId,
    weaponSetId?: WeaponSetId,
  ): ItemInstanceView | undefined;
  getEquipmentLoadout(characterId: CharacterId): CharacterEquipmentLoadoutView;
  getEncumbranceResolution(teamId: TeamId): EncumbranceResolutionView | undefined;
}

// ── Player Game Command payloads ────────────────────────────────────────────
export type EquipItem = Readonly<{
  type: 'equipItem';
  characterId: CharacterId;
  itemId: ItemInstanceId;
  slotId: EquipmentSlotId;
  weaponSetId?: WeaponSetId;
}>;

export type UnequipItem = Readonly<{
  type: 'unequipItem';
  characterId: CharacterId;
  slotId: EquipmentSlotId;
  weaponSetId?: WeaponSetId;
}>;

export type ConfigureWeaponSet = Readonly<{
  type: 'configureWeaponSet';
  characterId: CharacterId;
  weaponSetId: WeaponSetId;
  mainHandItemId?: ItemInstanceId;
  offHandItemId?: ItemInstanceId;
  selectedSkillIds: readonly [SkillDefinitionId?, SkillDefinitionId?, SkillDefinitionId?];
}>;

export type UseItem = Readonly<{
  type: 'useItem';
  characterId: CharacterId;
  itemId: ItemInstanceId;
}>;

export type SplitStack = Readonly<{
  type: 'splitStack';
  itemId: ItemInstanceId;
  quantity: number;
}>;

export type TransferItemForEncumbrance = Readonly<{
  type: 'transferItemForEncumbrance';
  resolutionId: EncumbranceResolutionId;
  itemId: ItemInstanceId;
  fromCharacterId: CharacterId;
  toCharacterId: CharacterId;
}>;

export type StoreItemForEncumbrance = Readonly<{
  type: 'storeItemForEncumbrance';
  resolutionId: EncumbranceResolutionId;
  itemId: ItemInstanceId;
  characterId: CharacterId;
  homeId: HomeId;
}>;

export type AbandonItemForEncumbrance = Readonly<{
  type: 'abandonItemForEncumbrance';
  resolutionId: EncumbranceResolutionId;
  itemId: ItemInstanceId;
}>;

export type ReassignQuestCargoCarrierForEncumbrance = Readonly<{
  type: 'reassignQuestCargoCarrierForEncumbrance';
  resolutionId: EncumbranceResolutionId;
  itemId: ItemInstanceId;
  newCarrierCharacterId: CharacterId;
}>;

export type InventoryGameCommand =
  | EquipItem
  | UnequipItem
  | ConfigureWeaponSet
  | UseItem
  | SplitStack
  | TransferItemForEncumbrance
  | StoreItemForEncumbrance
  | AbandonItemForEncumbrance
  | ReassignQuestCargoCarrierForEncumbrance;

// ── Internal Command payloads (handled by inventory) ────────────────────────
export type CreateItemInstance = Readonly<{
  type: 'CreateItemInstance';
  definitionId: ItemDefinitionId;
  quantity: number;
  location: ItemLocation;
  ownerCharacterId?: CharacterId;
  reason: string;
}>;

export type RemoveItemInstance = Readonly<{
  type: 'RemoveItemInstance';
  itemId: ItemInstanceId;
  reason: ItemRemovalReason;
}>;

export type TransferItem = Readonly<{
  type: 'TransferItem';
  itemId: ItemInstanceId;
  to: ItemLocation;
  newOwnerCharacterId?: CharacterId;
  reason: string;
}>;

export type ReserveQuestItem = Readonly<{
  type: 'ReserveQuestItem';
  itemId: ItemInstanceId;
  questId: QuestId;
}>;

export type ReserveCraftingInputs = Readonly<{
  type: 'ReserveCraftingInputs';
  craftingAttemptId: CraftingAttemptId;
  itemIds: readonly ItemInstanceId[];
}>;

export type ApplyQuestItemLifecycle = Readonly<{
  type: 'ApplyQuestItemLifecycle';
  itemId: ItemInstanceId;
  questId: QuestId;
  action: 'remove' | 'releaseAndKeep' | 'reclaim';
}>;

export type MoveItemToTeamQuestCargo = Readonly<{
  type: 'MoveItemToTeamQuestCargo';
  itemId: ItemInstanceId;
  questId: QuestId;
  teamId: TeamId;
  carrierCharacterId: CharacterId;
}>;

export type ReleaseExpiredQuestCargo = Readonly<{
  type: 'ReleaseExpiredQuestCargo';
  questId: QuestId;
  distributionId: AssetDistributionId;
}>;

export type ConsumeBookForLearning = Readonly<{
  type: 'ConsumeBookForLearning';
  bookItemId: ItemInstanceId;
  characterId: CharacterId;
}>;

export type TransformCraftingItems = Readonly<{
  type: 'TransformCraftingItems';
  craftingAttemptId: CraftingAttemptId;
  consumedIngredientItemIds: readonly ItemInstanceId[];
  returnedIngredientItemIds: readonly ItemInstanceId[];
  outputs: readonly Readonly<{
    definitionId: ItemDefinitionId;
    quantity: number;
    location: ItemLocation;
  }>[];
}>;

export type ConsumeCuisineIngredients = Readonly<{
  type: 'ConsumeCuisineIngredients';
  characterId: CharacterId;
  ingredientItemIds: readonly ItemInstanceId[];
}>;

export type CommitCombatItemUse = Readonly<{
  type: 'CommitCombatItemUse';
  itemId: ItemInstanceId;
  userId: CharacterId;
}>;

export type ConsumeCombatSequenceRetrySupply = Readonly<{
  type: 'ConsumeCombatSequenceRetrySupply';
  sequenceId: CombatSequenceId;
  challengeId: CombatSequenceChallengeId;
  participantCharacterId: CharacterId;
  itemTagId?: ItemTagId;
}>;

export type EvaluateTeamEncumbrance = Readonly<{
  type: 'EvaluateTeamEncumbrance';
  teamId: TeamId;
}>;

export type InventoryInternalCommand =
  | CreateItemInstance
  | RemoveItemInstance
  | TransferItem
  | ReserveQuestItem
  | ReserveCraftingInputs
  | ApplyQuestItemLifecycle
  | MoveItemToTeamQuestCargo
  | ReleaseExpiredQuestCargo
  | ConsumeBookForLearning
  | TransformCraftingItems
  | ConsumeCuisineIngredients
  | CommitCombatItemUse
  | ConsumeCombatSequenceRetrySupply
  | EvaluateTeamEncumbrance;

// ── Domain Event payloads (emitted by inventory) ────────────────────────────
export type ItemInstanceCreated = Readonly<{
  type: 'ItemInstanceCreated';
  itemId: ItemInstanceId;
  definitionId: ItemDefinitionId;
  ownerCharacterId?: CharacterId;
  location: ItemLocation;
}>;

export type InventoryTransferred = Readonly<{
  type: 'InventoryTransferred';
  itemId: ItemInstanceId;
  from: ItemLocation;
  to: ItemLocation;
  oldOwner?: CharacterId;
  newOwner?: CharacterId;
  reason: string;
}>;

export type ItemReservationChanged = Readonly<{
  type: 'ItemReservationChanged';
  itemId: ItemInstanceId;
  reservation?: ItemReservation;
}>;

export type ItemConsumed = Readonly<{
  type: 'ItemConsumed';
  itemId: ItemInstanceId;
  quantity: number;
  reason: string;
}>;

export type ItemRemoved = Readonly<{
  type: 'ItemRemoved';
  itemId: ItemInstanceId;
  previousLocation: ItemLocation;
  reason: ItemRemovalReason;
}>;

export type EquipmentChanged = Readonly<{
  type: 'EquipmentChanged';
  characterId: CharacterId;
  slotId: EquipmentSlotId;
  weaponSetId?: WeaponSetId;
  itemId?: ItemInstanceId;
}>;

export type WeaponSetConfigured = Readonly<{
  type: 'WeaponSetConfigured';
  characterId: CharacterId;
  weaponSetId: WeaponSetId;
  itemIds: readonly ItemInstanceId[];
  skillIds: readonly SkillDefinitionId[];
}>;

export type CombatItemUseCommitted = Readonly<{
  type: 'CombatItemUseCommitted';
  itemId: ItemInstanceId;
  userId: CharacterId;
  useDelayRuleId?: UseDelayRuleId;
  effectRefs: readonly EffectDefinitionId[];
}>;

export type CombatSequenceRetrySupplyConsumed = Readonly<{
  type: 'CombatSequenceRetrySupplyConsumed';
  sequenceId: CombatSequenceId;
  challengeId: CombatSequenceChallengeId;
  itemId: ItemInstanceId;
  ownerCharacterId: CharacterId;
  quantity: 1;
}>;

export type BookUseCommittedForLearning = Readonly<{
  type: 'BookUseCommittedForLearning';
  itemId: ItemInstanceId;
  characterId: CharacterId;
  knowledgeId: CharacterKnowledgeId;
  policy: 'retainAfterLearning' | 'consumeOnLearning';
}>;

export type CraftingItemsTransformed = Readonly<{
  type: 'CraftingItemsTransformed';
  inputItemIds: readonly ItemInstanceId[];
  outputItemIds: readonly ItemInstanceId[];
  recipeId: CraftingRecipeId;
}>;

export type EncumbranceResolutionOpened = Readonly<{
  type: 'EncumbranceResolutionOpened';
  resolutionId: EncumbranceResolutionId;
  teamId: TeamId;
  overweightCharacterIds: readonly CharacterId[];
  state: EncumbranceResolutionState;
}>;

export type EncumbranceResolutionClosed = Readonly<{
  type: 'EncumbranceResolutionClosed';
  resolutionId: EncumbranceResolutionId;
  teamId: TeamId;
}>;

export type InventoryDomainEvent =
  | ItemInstanceCreated
  | InventoryTransferred
  | ItemReservationChanged
  | ItemConsumed
  | ItemRemoved
  | EquipmentChanged
  | WeaponSetConfigured
  | CombatItemUseCommitted
  | CombatSequenceRetrySupplyConsumed
  | BookUseCommittedForLearning
  | CraftingItemsTransformed
  | EncumbranceResolutionOpened
  | EncumbranceResolutionClosed;
