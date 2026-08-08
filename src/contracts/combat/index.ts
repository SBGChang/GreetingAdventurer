// contracts/combat — public contract transcribed from docs/00_core/architecture/11_combat_module.md

import type {
  DefinitionHeader,
  ResolverId,
  CultureId,
  CombatRuleId,
  EncounterGroupDefinitionId,
  MonsterDefinitionId,
  SkillDefinitionId,
  OpeningCtbRuleId,
  ActionDelayRuleId,
  CombatStatusDefinitionId,
  CombatEffectDefinitionId,
  CombatDamageRuleId,
  CombatHealRuleId,
  CombatCtbAdjustmentRuleId,
  CombatInterruptionRuleId,
  EquipmentEffectDefinitionId,
  CombatAiPolicyId,
  CombatControlResistanceProfileId,
  MonsterNaturalAttackProfileId,
  MonsterExperienceProfileId,
  EncounterExperienceBudgetId,
  ExperienceAwardRuleId,
  AttackMasteryAwardRuleId,
  SupportMasteryAwardRuleId,
  TechniqueId,
  WeaponRequirementId,
  CombatStatusInstanceId,
  EncounterId,
  CombatantId,
  RuntimeEnemyId,
  WeaponSetId,
  ItemInstanceId,
  CharacterId,
  TeamId,
  MapInstanceId,
  ContentInstanceId,
  InteractionId,
  PlayerTravelEventInstanceId,
  RngContext,
  Revision,
  JsonValue,
} from '../core';
// Cross-module: map owns GridCell (src/contracts/map).
import type { GridCell } from '../map';
// Cross-module: progression owns PrimaryAttributeId + DefenseMasteryRoutingRuleId (src/contracts/progression).
import type { PrimaryAttributeId, DefenseMasteryRoutingRuleId } from '../progression';
// Shared growth-event contract lives in combat-sequence; detailed combat reuses it (doc §8.7, §7).
import type {
  CombatMasterySource,
  MasteryExperienceAmount,
} from '../combat-sequence';

// ── 敵人定義（§2.2）──────────────────────────────────────────────────
export type MonsterSpeciesKind = 'nonHuman' | 'human';
export type MonsterThreatRank = 'normal' | 'elite' | 'boss';
export type MonsterBodySize = 'small' | 'medium' | 'large';

export type MonsterDefinition = DefinitionHeader & {
  cultureId: CultureId;
  speciesKind: MonsterSpeciesKind;
  threatRank: MonsterThreatRank;
  bodySize: MonsterBodySize;
  attributes: {
    health: number;
    muscle: number;
    intelligence: number;
    reaction: number;
    coordination: number;
    charisma: number;
  };
  skillIds: SkillDefinitionId[];
  naturalAttackProfileId: MonsterNaturalAttackProfileId;
  controlResistanceProfileId: CombatControlResistanceProfileId;
  aiPolicyId: CombatAiPolicyId;
  experienceProfileId: MonsterExperienceProfileId;
};

export type MonsterNaturalAttackProfileDefinition = DefinitionHeader & {
  physicalPowerResolverId: ResolverId;
  magicPowerResolverId: ResolverId;
  hitScoreResolverId: ResolverId;
};

export type CombatControlResistanceProfileDefinition = DefinitionHeader & {
  ctbIncreaseMultiplier: number;
  maxExternalCtbIncreaseBeforeOwnAction?: number;
  interruptionImmunityUntilOwnActionAfterSuccess: boolean;
};

// Derived: doc references getAiPolicy(id): CombatAiPolicyDefinition but never
// specifies its body (see report note).
export type CombatAiPolicyDefinition = DefinitionHeader & {
  behaviorResolverId: ResolverId;
};

// Derived: doc references getEquipmentEffect(id): EquipmentEffectDefinition but
// never specifies its body here; likely inventory-owned (see report note).
export type EquipmentEffectDefinition = DefinitionHeader & {
  triggerResolverId: ResolverId;
  effectIds: CombatEffectDefinitionId[];
};

// ── 遭遇編組（§2.3）──────────────────────────────────────────────────
// Derived: initialPlacements element type is referenced but never defined (see report note).
export type EnemyPlacementDefinition = {
  monsterDefinitionId: MonsterDefinitionId;
  anchorCell: GridCell;
};

export type EncounterGroupDefinition = DefinitionHeader & {
  memberDefinitionIds: MonsterDefinitionId[];
  initialPlacements: EnemyPlacementDefinition[];
  experienceBudgetId: EncounterExperienceBudgetId;
  rewardResolverId: ResolverId;
};

export type EncounterExperienceBudgetDefinition = DefinitionHeader & {
  aggregation: 'sumMemberProfiles';
  groupModifier: number;
  minimumAwardRuleId?: ExperienceAwardRuleId;
};

export type MonsterExperienceProfileDefinition = DefinitionHeader & {
  attackExperience: number;
  defenseExperience: number;
  attackAwardRuleId: ExperienceAwardRuleId;
  defenseAwardRuleId: ExperienceAwardRuleId;
};

// ── 技能戰鬥 View（§2.4）─────────────────────────────────────────────
export type CombatActivationHand = 'mainHand' | 'offHand' | 'bothHands' | 'handless';
export type CombatActionKind = 'attack' | 'guard' | 'cast' | 'perform' | 'support';
export type CombatMasteryExperienceMode = 'damage' | 'fixedSupport';

// Derived: doc references these but never defines their bodies (see report note).
export type TargetingDefinition = {
  targetResolverId: ResolverId;
};
export type CounterStanceDefinition = {
  conditionResolverId: ResolverId;
  counterDelayRuleId: ActionDelayRuleId;
};
export type ResourceCostDefinition = {
  resource: 'health' | 'mana';
  amount: number;
};

export type CombatSkillDefinitionView = {
  skillId: SkillDefinitionId;
  activationHand: CombatActivationHand;
  weaponRequirementIds: WeaponRequirementId[];
  actionKind: CombatActionKind;
  masteryExperienceMode: CombatMasteryExperienceMode;
  attackMasteryAwardRuleId?: AttackMasteryAwardRuleId;
  supportMasteryAwardRuleId?: SupportMasteryAwardRuleId;
  techniqueIds: TechniqueId[];
  targeting: TargetingDefinition;
  actionDelayRuleId: ActionDelayRuleId;
  effectIds: CombatEffectDefinitionId[];
  counterStance?: CounterStanceDefinition;
  resourceCosts: ResourceCostDefinition[];
};

// ── 戰鬥效果與狀態語彙（§2.5）─────────────────────────────────────────
export type CombatStatusStackPolicy = 'replace' | 'refresh' | 'strongest';

export type CombatEffectDefinition = DefinitionHeader & {
  operation:
    | { kind: 'dealDamage'; damageRuleId: CombatDamageRuleId }
    | { kind: 'heal'; healRuleId: CombatHealRuleId }
    | { kind: 'adjustCtb'; adjustmentRuleId: CombatCtbAdjustmentRuleId }
    | { kind: 'interruptCasting'; interruptionRuleId: CombatInterruptionRuleId }
    | {
        kind: 'applyStatus';
        statusId: CombatStatusDefinitionId;
        durationTargetActions: number;
        stackPolicy: CombatStatusStackPolicy;
      }
    | { kind: 'removeStatus'; statusId: CombatStatusDefinitionId };
};

export type CombatDamageChannel = 'physical' | 'magic' | 'instrument';

export type CombatDamageRuleDefinition = DefinitionHeader & {
  damageChannel: CombatDamageChannel;
  powerResolverId: ResolverId;
  canBeBlocked: boolean;
};

export type CombatHealRuleDefinition = DefinitionHeader & {
  powerResolverId: ResolverId;
};

export type CombatCtbAdjustmentRuleDefinition = DefinitionHeader & {
  amountResolverId: ResolverId;
};

export type CombatInterruptionRuleDefinition = DefinitionHeader & {
  appliesToActionKinds: Array<'cast' | 'perform'>;
  interruptionDelayRuleId: ActionDelayRuleId;
};

export type CombatStatusPolarity = 'positive' | 'negative';

export type CombatStatusDefinition = DefinitionHeader & {
  polarity: CombatStatusPolarity;
  modifierResolverId: ResolverId;
  displayPriority: number;
};

export type CombatStatusInstance = {
  statusInstanceId: CombatStatusInstanceId;
  statusId: CombatStatusDefinitionId;
  remainingTargetActions: number;
  appliedByCombatantId: CombatantId;
  revision: Revision;
};

// ── 開場 CTB 與行動延遲（§2.7）───────────────────────────────────────
// Derived: AttributeReductionRule referenced by OpeningCtbRuleDefinition but never
// defined (mirrors the defined ActionDelayAttributeReductionRule; see report note).
export type AttributeReductionRule = {
  primaryAttribute: PrimaryAttributeId;
  reductionPerPoint: number;
};

export type ActionDelayAttributeReductionRule = {
  primaryAttribute: PrimaryAttributeId;
  reductionPerPoint: number;
};

export type CombatRuleDefinition = DefinitionHeader & {
  openingCtbRuleId: OpeningCtbRuleId;
  combatRestDelayRuleId: ActionDelayRuleId;
  defenseMasteryRoutingRuleId: DefenseMasteryRoutingRuleId;
};

export type OpeningCtbRuleDefinition = DefinitionHeader & {
  baseCtb: number;
  reductions: AttributeReductionRule[];
  minimumCtb: number;
};

export type ActionDelayRuleDefinition = DefinitionHeader & {
  baseDelay: number;
  reductions: ActionDelayAttributeReductionRule[];
  minimumDelay: number;
};

export interface CombatDefinitionReader {
  getCombatRule(id: CombatRuleId): CombatRuleDefinition;
  getEncounterGroup(id: EncounterGroupDefinitionId): EncounterGroupDefinition;
  getMonster(id: MonsterDefinitionId): MonsterDefinition;
  getSkillView(id: SkillDefinitionId): CombatSkillDefinitionView;
  getOpeningCtbRule(id: OpeningCtbRuleId): OpeningCtbRuleDefinition;
  getActionDelayRule(id: ActionDelayRuleId): ActionDelayRuleDefinition;
  getCombatStatus(id: CombatStatusDefinitionId): CombatStatusDefinition;
  getCombatEffect(id: CombatEffectDefinitionId): CombatEffectDefinition;
  getDamageRule(id: CombatDamageRuleId): CombatDamageRuleDefinition;
  getHealRule(id: CombatHealRuleId): CombatHealRuleDefinition;
  getCtbAdjustmentRule(id: CombatCtbAdjustmentRuleId): CombatCtbAdjustmentRuleDefinition;
  getCombatInterruptionRule(id: CombatInterruptionRuleId): CombatInterruptionRuleDefinition;
  getEquipmentEffect(id: EquipmentEffectDefinitionId): EquipmentEffectDefinition;
  getAiPolicy(id: CombatAiPolicyId): CombatAiPolicyDefinition;
  getExperienceBudget(id: EncounterExperienceBudgetId): EncounterExperienceBudgetDefinition;
  getMonsterExperienceProfile(
    id: MonsterExperienceProfileId,
  ): MonsterExperienceProfileDefinition;
}

// ── Encounter Source 與 Detailed 請求（§3.1）─────────────────────────
export type CombatEncounterSource =
  | {
      kind: 'mapContent';
      mapId: MapInstanceId;
      contentId: ContentInstanceId;
      encounterGroupId: EncounterGroupDefinitionId;
    }
  | {
      kind: 'playerTravelEvent';
      interactionId: InteractionId;
      eventInstanceId: PlayerTravelEventInstanceId;
      encounterGroupId: EncounterGroupDefinitionId;
    };

export type DetailedCombatRequest = {
  teamId: TeamId;
  source: CombatEncounterSource;
  participantSnapshotRevision: Revision;
  rngContext: RngContext;
};

// ── 公開 Query（§4）───────────────────────────────────────────────────
export type CombatFootprint = { width: 1 | 2 | 3; height: 1 | 2 | 3 };
export type CombatEncounterPhase =
  | 'initializing'
  | 'active'
  | 'awaitingPlayerCommand'
  | 'resolved';
export type CombatantLifecycle = 'ready' | 'acting' | 'incapacitated' | 'dead';
export type CombatSide = 'player' | 'enemy';

export type CombatantSourceRef =
  | { kind: 'character'; characterId: CharacterId }
  | {
      kind: 'monster';
      monsterDefinitionId: MonsterDefinitionId;
      runtimeEnemyId: RuntimeEnemyId;
    };

// Derived read model; doc names CombatantView but never defines it (see report note).
export type CombatantView = Readonly<{
  combatantId: CombatantId;
  source: CombatantSourceRef;
  side: CombatSide;
  footprint: CombatFootprint;
  anchorCell: GridCell;
  health: number;
  mana: number;
  currentCtb: number;
  activeWeaponSetId?: WeaponSetId;
  activeStatuses: readonly CombatStatusInstance[];
  state: CombatantLifecycle;
  revision: Revision;
}>;

// Derived read model; doc names CombatEncounterView but never defines it (see report note).
export type CombatEncounterView = Readonly<{
  encounterId: EncounterId;
  source: CombatEncounterSource;
  playerTeamId: TeamId;
  playerFormationRevision: Revision;
  state: CombatEncounterPhase;
  currentActorId?: CombatantId;
  readyQueue: readonly CombatantId[];
  combatants: readonly CombatantView[];
  revision: Revision;
}>;

// Derived: doc names CombatActionOption[] as getAvailableActions return but never
// defines it (see report note).
export type CombatActionOption = Readonly<{
  skillId: SkillDefinitionId;
  actionKind: CombatActionKind;
  activationHand: CombatActivationHand;
  requiresWeaponSetId?: WeaponSetId;
  available: boolean;
}>;

export interface CombatQuery {
  getEncounter(id: EncounterId): CombatEncounterView;
  getAvailableActions(encounterId: EncounterId, actorId: CombatantId): CombatActionOption[];
  getCtbOrder(encounterId: EncounterId): CombatantId[];
  getCombatant(id: CombatantId): CombatantView;
}

export interface DetailedCombatResolver {
  begin(input: DetailedCombatRequest): EncounterId;
}

// ── 輸入 Internal Command（§5.1）─────────────────────────────────────
// Derived payload: doc describes StartCombatEncounter inputs in prose (see report note).
export type StartCombatEncounterCommand = Readonly<{
  type: 'StartCombatEncounter';
  teamId: TeamId;
  source: CombatEncounterSource;
  participantSnapshotRevision: Revision;
  rngContext: RngContext;
}>;

// ── 輸入 玩家 Game Command（§5.2）────────────────────────────────────
export type UseCombatSkillCommand = Readonly<{
  type: 'useCombatSkill';
  encounterId: EncounterId;
  actorId: CombatantId;
  skillId: SkillDefinitionId;
  weaponSetId?: WeaponSetId;
  targetCombatantIds: readonly CombatantId[];
}>;
export type UseCombatItemCommand = Readonly<{
  type: 'useCombatItem';
  encounterId: EncounterId;
  actorId: CombatantId;
  itemInstanceId: ItemInstanceId;
}>;
export type CommandAllyCommand = Readonly<{
  type: 'commandAlly';
  encounterId: EncounterId;
  allyId: CombatantId;
  directive: Readonly<Record<string, JsonValue>>;
}>;
export type CombatRestCommand = Readonly<{
  type: 'combatRest';
  encounterId: EncounterId;
  actorId: CombatantId;
}>;
export type CombatGameCommand =
  | UseCombatSkillCommand
  | UseCombatItemCommand
  | CommandAllyCommand
  | CombatRestCommand;

// ── 輸出事件（§7）─────────────────────────────────────────────────────
export type CombatEncounterOutcome = 'victory' | 'defeat';
// Derived: contentResolution shape is not specified in the doc (see report note).
export type CombatContentResolution = Readonly<Record<string, JsonValue>>;
// Derived: CombatActionResolved.results shape is not specified in the doc (see report note).
export type CombatActionResult = Readonly<Record<string, JsonValue>>;

export type CombatEncounterStartedPayload = Readonly<{
  encounterId: EncounterId;
  teamId: TeamId;
  source: CombatEncounterSource;
}>;
export type CombatActionResolvedPayload = Readonly<{
  encounterId: EncounterId;
  actorId: CombatantId;
  skillId?: SkillDefinitionId;
  results: readonly CombatActionResult[];
}>;
export type CombatEncounterResolvedPayload = Readonly<{
  encounterId: EncounterId;
  teamId: TeamId;
  participantCharacterIds: readonly CharacterId[];
  source: CombatEncounterSource;
  outcome: CombatEncounterOutcome;
  contentResolution?: CombatContentResolution;
}>;
export type CombatTeamOutcomePayload = Readonly<{
  teamId: TeamId;
  canContinue: boolean;
  reason: string;
}>;
export type CombatAttackMasteryEarnedPayload = Readonly<{
  source: CombatMasterySource;
  characterAwards: readonly MasteryExperienceAmount[];
}>;
export type CombatDefenseMasteryEarnedPayload = Readonly<{
  source: CombatMasterySource;
  characterAwards: readonly MasteryExperienceAmount[];
}>;
export type CombatSupportMasteryEarnedPayload = Readonly<{
  source: CombatMasterySource;
  characterId: CharacterId;
  skillId: SkillDefinitionId;
  supportMasteryAwardRuleId: SupportMasteryAwardRuleId;
  creditedUseCount: number;
}>;

export type CombatDomainEvent =
  | ({ type: 'CombatEncounterStarted' } & CombatEncounterStartedPayload)
  | ({ type: 'CombatActionResolved' } & CombatActionResolvedPayload)
  | ({ type: 'CombatEncounterResolved' } & CombatEncounterResolvedPayload)
  | ({ type: 'CombatTeamOutcome' } & CombatTeamOutcomePayload)
  | ({ type: 'CombatAttackMasteryEarned' } & CombatAttackMasteryEarnedPayload)
  | ({ type: 'CombatDefenseMasteryEarned' } & CombatDefenseMasteryEarnedPayload)
  | ({ type: 'CombatSupportMasteryEarned' } & CombatSupportMasteryEarnedPayload);
