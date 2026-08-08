// contracts/core/ids.ts
// 全遊戲共用的 branded ID。對應 00_shared_contracts.md §2（硬化後家族版）。

import type { Brand, DefinitionId, RuntimeId, EphemeralId, TemplateLocalId } from './primitives';

// ── Registry / 基礎 brand ───────────────────────────────────────────────
export type ModuleId<K extends string = string> = Brand<string, `module:${K}`>;
export type WorkflowId<K extends string = string> = Brand<string, `workflow:${K}`>;
export type ResolverId = Brand<string, 'resolver'>;
export type SchemaId = Brand<string, 'schema'>;
export type ContentPackId = Brand<string, 'content-pack'>;
export type RngStreamId = Brand<string, 'rng-stream'>;
export type EventSubscriptionId = Brand<string, 'event-subscription'>;
export type DefinitionReaderId = Brand<string, 'definition-reader'>;
export type ReaderPortId = Brand<string, 'reader-port'>;
export type InvariantId = Brand<string, 'invariant'>;
export type ProjectionId = Brand<string, 'projection'>;
export type StateSliceName = Brand<string, 'state-slice-name'>;
export type MessageSourceId = ModuleId | WorkflowId;
export type RuntimeEntityKind = string; // Runtime ID 產生器的種類鍵（不是 ID 本身）
export type ClientRequestId = EphemeralId<'client-request'>;

// ── 世界結構（第一版固定內容定義）───────────────────────────────────────
export type NationId = DefinitionId<'nation'>;
export type CultureId = DefinitionId<'culture'>;
export type RegionId = DefinitionId<'region'>;
export type CityId = DefinitionId<'city'>;
export type RouteId = DefinitionId<'route'>;

// ── 內容定義（DefinitionId<K>）─────────────────────────────────────────
export type MapTemplateId = DefinitionId<'map-template'>;
export type TrapDefinitionId = DefinitionId<'trap'>;
export type ItemDefinitionId = DefinitionId<'item'>;
export type SkillDefinitionId = DefinitionId<'skill'>;
export type MasteryId = DefinitionId<'mastery'>;
export type EquipmentDefinitionId = ItemDefinitionId; // Item Registry 的 kind='equipment' 窄化別名
export type BookDefinitionId = ItemDefinitionId; // Item Registry 的 kind='book' 窄化別名
export type ContentEventDefinitionId = DefinitionId<'content-event'>;
export type PlayerTravelEventDefinitionId = ContentEventDefinitionId;
export type ConditionDefinitionId = DefinitionId<'condition'>;
export type EffectDefinitionId = DefinitionId<'effect'>;
export type MonsterDefinitionId = DefinitionId<'monster'>;
export type EncounterGroupDefinitionId = DefinitionId<'encounter-group'>;
export type EncounterPoolId = DefinitionId<'encounter-pool'>;
export type CombatRuleId = DefinitionId<'combat-rule'>;
export type CombatDamageRuleId = DefinitionId<'combat-damage-rule'>;
export type CombatHealRuleId = DefinitionId<'combat-heal-rule'>;
export type CombatCtbAdjustmentRuleId = DefinitionId<'combat-ctb-adjustment-rule'>;
export type CombatInterruptionRuleId = DefinitionId<'combat-interruption-rule'>;
export type CombatStatusDefinitionId = DefinitionId<'combat-status'>;
export type CombatEffectDefinitionId = DefinitionId<'combat-effect'>;
export type CombatAiPolicyId = DefinitionId<'combat-ai-policy'>;
export type CombatControlResistanceProfileId = DefinitionId<'combat-control-resistance-profile'>;
export type MonsterNaturalAttackProfileId = DefinitionId<'monster-natural-attack-profile'>;
export type MonsterExperienceProfileId = DefinitionId<'monster-experience-profile'>;
export type EncounterExperienceBudgetId = DefinitionId<'encounter-experience-budget'>;
export type OpeningCtbRuleId = DefinitionId<'opening-ctb-rule'>;
export type ActionDelayRuleId = DefinitionId<'action-delay-rule'>;
export type UseDelayRuleId = DefinitionId<'use-delay-rule'>;
export type TechniqueId = DefinitionId<'technique'>;
export type WeaponRequirementId = DefinitionId<'weapon-requirement'>;
export type EquipmentEffectDefinitionId = DefinitionId<'equipment-effect'>;
export type CraftingRecipeId = DefinitionId<'crafting-recipe'>;
export type CuisineRecipeId = DefinitionId<'cuisine-recipe'>;
export type MaterialAffixId = DefinitionId<'material-affix'>;
export type MaterialTagId = DefinitionId<'material-tag'>;
export type ItemTagId = DefinitionId<'item-tag'>;
export type SkillTagId = DefinitionId<'skill-tag'>;
export type FoodAffixId = DefinitionId<'food-affix'>;
export type CraftQualityRuleId = DefinitionId<'craft-quality-rule'>;
export type RestaurantMenuId = DefinitionId<'restaurant-menu'>;
export type RestaurantMealVariantId = DefinitionId<'restaurant-meal-variant'>;
export type NpcCuisineDecisionRuleId = DefinitionId<'npc-cuisine-decision-rule'>;
export type GatheringRuleId = DefinitionId<'gathering-rule'>;
export type GatheringDestinationPolicyId = DefinitionId<'gathering-destination-policy'>;
export type MapSpawnRuleId = DefinitionId<'map-spawn-rule'>;
export type NpcSequenceRuleId = DefinitionId<'npc-sequence-rule'>;
export type NpcExplorationRuleId = DefinitionId<'npc-exploration-rule'>;
export type InteractionRuleId = DefinitionId<'interaction-rule'>;
export type ChestPoolId = DefinitionId<'chest-pool'>;
export type MapEventPoolId = DefinitionId<'map-event-pool'>;
export type CultureContentRuleId = DefinitionId<'culture-content-rule'>;
export type AdventureSiteId = DefinitionId<'adventure-site'>;
export type ExperienceAwardRuleId = DefinitionId<'experience-award-rule'>;
export type AttackMasteryAwardRuleId = DefinitionId<'attack-mastery-award-rule'>;
export type SupportMasteryAwardRuleId = DefinitionId<'support-mastery-award-rule'>;
export type MasteryCurveId = DefinitionId<'mastery-curve'>;
export type CarryCapacityRuleId = DefinitionId<'carry-capacity-rule'>;
export type StatisticsRuleId = DefinitionId<'statistics-rule'>;
export type GripRuleId = DefinitionId<'grip-rule'>;
export type SecondaryAttributeId = DefinitionId<'secondary-attribute'>;
export type AgeModifierRuleId = DefinitionId<'age-modifier-rule'>;
export type AgeExperienceRuleId = DefinitionId<'age-experience-rule'>;
export type LifecycleRuleId = DefinitionId<'lifecycle-rule'>;
export type BirthRuleId = DefinitionId<'birth-rule'>;
export type CharacterArchetypeId = DefinitionId<'character-archetype'>;
export type CharacterTraitDefinitionId = DefinitionId<'character-trait'>;
export type CharacterTraitPoolId = DefinitionId<'character-trait-pool'>;
export type CharacterStatusDefinitionId = DefinitionId<'character-status'>;
export type ChildEducationRuleId = DefinitionId<'child-education-rule'>;
export type TeachingRuleId = DefinitionId<'teaching-rule'>;
export type FacilityDefinitionId = DefinitionId<'facility'>;
export type CityActionRuleId = DefinitionId<'city-action-rule'>;
export type ShopRuleId = DefinitionId<'shop-rule'>;
export type PriceRuleId = DefinitionId<'price-rule'>;
export type PriceModifierRuleId = DefinitionId<'price-modifier-rule'>;
export type IntelRuleId = DefinitionId<'intel-rule'>;
export type EscortGenerationRuleId = DefinitionId<'escort-generation-rule'>;
export type HomeRuleId = DefinitionId<'home-rule'>;
export type HomeUpgradeDefinitionId = DefinitionId<'home-upgrade'>;
export type CurrencyId = DefinitionId<'currency'>;
export type QuestObjectiveRuleId = DefinitionId<'quest-objective-rule'>;
export type QuestReactionRuleId = DefinitionId<'quest-reaction-rule'>;
export type QuestRewardRuleId = DefinitionId<'quest-reward-rule'>;
export type QuestDeadlineRuleId = DefinitionId<'quest-deadline-rule'>;
export type RecruitmentRuleId = DefinitionId<'recruitment-rule'>;
export type TeamFormationRuleId = DefinitionId<'team-formation-rule'>;
export type MemberRetentionRuleId = DefinitionId<'member-retention-rule'>;
export type NpcTravelRuleId = DefinitionId<'npc-travel-rule'>;
export type NpcMarketPolicyId = DefinitionId<'npc-market-policy'>;
export type AdventurerDecisionPolicyId = DefinitionId<'adventurer-decision-policy'>;
export type ActionChainTemplateId = DefinitionId<'action-chain-template'>;
export type TeamPlanRuleId = DefinitionId<'team-plan-rule'>;
export type TravelModeId = DefinitionId<'travel-mode'>;
export type PopulationSupplyRuleId = DefinitionId<'population-supply-rule'>;
export type WorldAdventurerGenerationRuleId = DefinitionId<'world-adventurer-generation-rule'>;
export type PlayerConversationRuleId = DefinitionId<'player-conversation-rule'>;
export type PlayerAffinityRuleId = DefinitionId<'player-affinity-rule'>;
export type NpcMarriageRuleId = DefinitionId<'npc-marriage-rule'>;
export type PlayerCommerceDailyLimitId = DefinitionId<'player-commerce-daily-limit'>;
export type PlayerCommercePracticeRuleId = DefinitionId<'player-commerce-practice-rule'>;
export type NonPlayerMemberDailySocialPracticeRuleId = DefinitionId<'nonplayer-social-practice-rule'>;
export type SocialSystemDefinitionId = DefinitionId<'social-system'>;
export type StartingScenarioId = DefinitionId<'starting-scenario'>;
export type AchievementDefinitionId = DefinitionId<'achievement'>;
export type AudioCueId = DefinitionId<'audio-cue'>;
export type WorldFactId = DefinitionId<'world-fact'>;
export type WorldEventWeightModifierId = DefinitionId<'world-event-weight-modifier'>;

// ── 模板本地 ID（TemplateLocalId<K>）──────────────────────────────────
export type RoomId = TemplateLocalId<'room'>;
export type RoomLinkId = TemplateLocalId<'room-link'>;
export type FixedTrapId = TemplateLocalId<'fixed-trap'>;
export type GatheringNodeId = TemplateLocalId<'gathering-node'>;
export type CraftingIngredientSlotId = TemplateLocalId<'crafting-ingredient-slot'>;
export type ContentEventOptionId = TemplateLocalId<'content-event-option'>;

// ── 執行期實例（RuntimeId<K>）──────────────────────────────────────────
export type MapInstanceId = RuntimeId<'map-instance'>;
export type ContentInstanceId = RuntimeId<'content-instance'>;
export type PlayerMapKnowledgeId = RuntimeId<'player-map-knowledge'>;
export type TeamId = RuntimeId<'team'>;
export type CharacterId = RuntimeId<'character'>;
export type QuestId = RuntimeId<'quest'>;
export type PlayerTravelEventInstanceId = RuntimeId<'travel-event-instance'>;
export type ContentEventInstanceId = RuntimeId<'content-event-instance'>;
export type ItemInstanceId = RuntimeId<'item-instance'>;
export type AssetDistributionId = RuntimeId<'asset-distribution'>;
export type ActivityRecordId = RuntimeId<'activity-record'>;
export type EconomyAccountId = RuntimeId<'economy-account'>;
export type EconomyTransferId = RuntimeId<'economy-transfer'>;
export type ShopOfferId = RuntimeId<'shop-offer'>;
export type ShopId = RuntimeId<'shop'>;
export type PriceQuoteId = RuntimeId<'price-quote'>;
export type PlayerConversationUsageId = RuntimeId<'player-conversation-usage'>;
export type PlayerCommerceUsageId = RuntimeId<'player-commerce-usage'>;
export type EncounterId = RuntimeId<'encounter'>;
export type CombatantId = RuntimeId<'combatant'>;
export type RuntimeEnemyId = RuntimeId<'enemy'>;
export type CombatStatusInstanceId = RuntimeId<'combat-status-instance'>;
export type CharacterStatusInstanceId = RuntimeId<'character-status-instance'>;
export type CraftingAttemptId = RuntimeId<'crafting-attempt'>;
export type EncumbranceResolutionId = RuntimeId<'encumbrance-resolution'>;
export type ChildStudySessionId = RuntimeId<'child-study-session'>;
export type HomeTeachingPostId = RuntimeId<'home-teaching-post'>;
export type TeachingSessionId = RuntimeId<'teaching-session'>;
export type ActionChainId = RuntimeId<'action-chain'>;
export type ActionChainNodeId = RuntimeId<'action-chain-node'>;
export type NpcDungeonRunId = RuntimeId<'npc-dungeon-run'>;
export type NpcMarketIntentId = RuntimeId<'npc-market-intent'>;
export type TeamPlanId = RuntimeId<'team-plan'>;
export type FreeActionId = RuntimeId<'free-action'>;
export type WeaponSetId = RuntimeId<'weapon-set'>;
export type GatheringResolutionId = RuntimeId<'gathering-resolution'>;
export type HomeId = RuntimeId<'home'>;
export type IntelLeadId = RuntimeId<'intel-lead'>;
export type MarketPressureId = RuntimeId<'market-pressure'>;
export type MapRefreshLockId = RuntimeId<'map-refresh-lock'>;
export type RelationshipFactId = RuntimeId<'relationship-fact'>;
export type FamilyLinkId = RuntimeId<'family-link'>;
export type EscortCandidateId = RuntimeId<'escort-candidate'>;
export type FacilityId = RuntimeId<'facility'>;
export type JobId = RuntimeId<'job'>;
export type EventId = RuntimeId<'event'>;
export type CommandId = RuntimeId<'command'>;
export type InteractionId = RuntimeId<'interaction'>;
export type NotificationId = RuntimeId<'notification'>;
export type TransactionId = RuntimeId<'transaction'>;
export type CorrelationId = RuntimeId<'correlation'>;

// ── Cursor（number brand）─────────────────────────────────────────────
export type RuntimeIdCursor = Brand<number, 'RuntimeIdCursor'>;

// 「某筆記錄／效果的來源實體」的明確 Union（取代已移除的 GameId）。
export type EntitySourceRef =
  | CharacterId
  | TeamId
  | QuestId
  | CityId
  | MapInstanceId
  | ContentEventInstanceId
  | ItemInstanceId
  | EncounterId;
