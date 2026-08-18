// contracts/progression — Progression 模組公開契約。
// 對應 docs/00_core/architecture/06_progression_module.md（純型別；不含實作）。
// 規則：共用型別 import 自 '../core'；跨模組型別經該模組 contracts path。

import type {
  DefinitionId,
  DefinitionHeader,
  ResolverId,
  CharacterId,
  MasteryId,
  MasteryCurveId,
  SkillDefinitionId,
  TeachingRuleId,
  ExperienceAwardRuleId,
  AttackMasteryAwardRuleId,
  SupportMasteryAwardRuleId,
  AgeExperienceRuleId,
  ChildEducationRuleId,
  TeachingSessionId,
  ChildStudySessionId,
  HomeTeachingPostId,
  ItemInstanceId,
  TeamId,
  CityId,
  FacilityId,
  ContentEventInstanceId,
  EffectDefinitionId,
  WorldDay,
  Revision,
} from '../core';

// 跨模組（sibling）：書籍分級由 Inventory 擁有；學書輸出命令由 Inventory 處理。
import type { BookTier, ConsumeBookForLearning } from '../inventory';
export type { ConsumeBookForLearning };

// ──────────────────────────────────────────────────────────────────────────
// 外部／尚未落地型別的占位（AMBIGUITY：詳見交付說明）。
// ──────────────────────────────────────────────────────────────────────────

// 尚未進 core 的 ID（本模組擁有語意）。
export type DefenseMasteryRoutingRuleId = DefinitionId<'defense-mastery-routing-rule'>;

// 本模組擁有但來源文件未給精確 schema 的結構。
export type MasteryRequirement = Readonly<{ masteryId: MasteryId; minLevel: number }>;
export type PrimaryAttributeGains = Readonly<Partial<Record<PrimaryAttributeId, number>>>;
export type AutomaticKnowledgeUnlock = Readonly<{ atLevel: number; knowledgeId: DefinitionId }>;
export type ExplorationRewardKey = string;

// MXP 來源標記（事件 payload 使用；來源文件未給精確 schema）。
export type MasterySource = string;
export type KnowledgeSource = string;

// ──────────────────────────────────────────────────────────────────────────
// §2 靜態資料契約
// ──────────────────────────────────────────────────────────────────────────

export interface ProgressionDefinitionReader {
  getMastery(id: MasteryId): MasteryDefinition;
  getMasteryCurve(id: MasteryCurveId): MasteryCurveDefinition;
  getSkill(id: SkillDefinitionId): SkillDefinition;
  getTeachingRule(id: TeachingRuleId): TeachingRuleDefinition;
  getExperienceAwardRule(id: ExperienceAwardRuleId): ExperienceAwardRuleDefinition;
  listSocialMasteryBenefits(): readonly SocialMasteryBenefitDefinition[];
  getAttackMasteryAwardRule(id: AttackMasteryAwardRuleId): AttackMasteryAwardRuleDefinition;
  getDefenseMasteryRoutingRule(
    id: DefenseMasteryRoutingRuleId,
  ): DefenseMasteryRoutingRuleDefinition;
  getSupportMasteryAwardRule(id: SupportMasteryAwardRuleId): SupportMasteryAwardRuleDefinition;
  getAgeExperienceRule(id: AgeExperienceRuleId): AgeExperienceRuleDefinition;
  getChildEducationRule(id: ChildEducationRuleId): ChildEducationRuleDefinition;
}

export type MasteryDefinition = DefinitionHeader<MasteryId> &
  Readonly<{
    curveId: MasteryCurveId;
    primaryAttributeGainsByLevel: readonly PrimaryAttributeGains[];
    automaticKnowledgeUnlocks: readonly AutomaticKnowledgeUnlock[];
  }>;

export type MasteryCurveDefinition = DefinitionHeader<MasteryCurveId> &
  Readonly<{
    maxLevel: 10;
    cumulativeExperienceThresholds: readonly number[]; // Lv.0..Lv.10
  }>;

export type SocialMasteryBenefitDefinition = DefinitionHeader &
  Readonly<{
    masteryId: MasteryId;
    personalTradeBonusGainsByLevel: [0.5, 0.5, 1, 1, 1.5, 1.5, 2, 3, 4, 5];
    inviteSuccessBonusGainsByLevel: [0.5, 0.5, 1, 1, 1.5, 1.5, 2, 2, 3, 3];
    memberDepartureResistanceGainsByLevel: [0.5, 0.5, 1, 1, 1.5, 1.5, 2, 2, 3, 3];
  }>;

export type SocialMasteryBenefitsView = Readonly<{
  personalTradeBonus: number;
  inviteSuccessBonus: number;
  memberDepartureResistance: number;
}>;

export type SkillDefinition = DefinitionHeader<SkillDefinitionId> &
  Readonly<{
    requiredMasteries: readonly MasteryRequirement[];
    acquisition:
      | Readonly<{ kind: 'automatic' }>
      | Readonly<{ kind: 'book'; acceptedTiers: readonly BookTier[] }>;
    combatMetadata?: SkillCombatMetadata;
  }>;

export type SkillCombatMetadata = Readonly<{
  masteryExperienceMode: 'damage' | 'fixedSupport';
  attackMasteryAwardRuleId?: AttackMasteryAwardRuleId;
  supportMasteryAwardRuleId?: SupportMasteryAwardRuleId;
}>;

export type ExperienceAwardRuleDefinition = DefinitionHeader<ExperienceAwardRuleId> &
  Readonly<{
    masteryId: MasteryId;
    baseExperience: number;
    ageExperienceRuleId?: AgeExperienceRuleId;
  }>;

export type MasterySplit = Readonly<{
  masteryId: MasteryId;
  ratio: number;
}>;

export type SupportMasteryAwardRuleDefinition = DefinitionHeader<SupportMasteryAwardRuleId> &
  Readonly<{
    fixedExperiencePerUse: number;
    masterySplits: readonly MasterySplit[];
  }>;

export type AttackMasteryAwardRuleDefinition = DefinitionHeader<AttackMasteryAwardRuleId> &
  Readonly<{
    masterySplits: readonly MasterySplit[];
  }>;

export type DefenseMasteryRoutingRuleDefinition =
  DefinitionHeader<DefenseMasteryRoutingRuleId> &
    Readonly<{
      resolverId: ResolverId;
    }>;

export type DefenseMasteryRoutingInput = Readonly<{
  characterId: CharacterId;
  equippedDefenseMasteryIds: readonly MasteryId[];
}>;

export type DefenseMasteryRoutingResult = Readonly<{
  masterySplits: readonly MasterySplit[];
}>;

export type AgeExperienceRuleDefinition = DefinitionHeader<AgeExperienceRuleId> &
  Readonly<{
    stages: readonly Readonly<{
      minAgeDays: number;
      maxAgeDays?: number;
      experienceMultiplier: number;
    }>[];
  }>;

// ──────────────────────────────────────────────────────────────────────────
// §3 Runtime State
// ──────────────────────────────────────────────────────────────────────────

export type ProgressionState = Readonly<{
  characterProgress: Readonly<Record<CharacterId, CharacterProgression>>;
  teachingSessions: Readonly<Record<TeachingSessionId, TeachingSession>>;
  childStudySessions: Readonly<Record<ChildStudySessionId, ChildStudySession>>;
}>;

export type CharacterProgression = Readonly<{
  characterId: CharacterId;
  masteries: Readonly<Record<MasteryId, MasteryProgress>>;
  learnedKnowledgeIds: readonly DefinitionId[];
  claimedExplorationRewards: readonly ExplorationRewardKey[];
  revision: Revision;
}>;

export type MasteryProgress = Readonly<{
  masteryId: MasteryId;
  experience: number;
  level: number; // 快取；必須可由 curve + experience 驗證
  revision: Revision;
}>;

export type PrimaryAttributeId =
  | 'muscle'
  | 'intelligence'
  | 'reaction'
  | 'coordination'
  | 'charisma';

export type PrimaryAttributes = Record<PrimaryAttributeId, number>;

export type TeachingSession = Readonly<{
  teachingSessionId: TeachingSessionId;
  learnerId: CharacterId;
  teacher: TeachingSource;
  masteryId: MasteryId;
  ruleId: TeachingRuleId;
  startedOnDay: WorldDay;
  learnerEntryExperience: number;
  learnerEntryLevel: number;
  status: TeachingSessionStatus;
  revision: Revision;
}>;

export type TeachingSessionStatus = 'active' | 'completed' | 'cancelled';

export type TeachingSource =
  | Readonly<{ kind: 'character'; characterId: CharacterId }>
  | Readonly<{
      kind: 'cityTeacher';
      cityId: CityId;
      facilityId: FacilityId;
      teacherMasteryLevel: number;
    }>;

export type ChildEducationRuleDefinition = DefinitionHeader<ChildEducationRuleId> &
  Readonly<{
    teacherMinimumPostDays: 28;
    childStudyCycleDays: 14;
    selfStudyParentMasteryRate: number; // 數值待試算，必須遠低於 1
    npcChildParentMasteryShare: 0.2;
  }>;

export type ChildStudySession = Readonly<{
  childStudySessionId: ChildStudySessionId;
  childTeamId: TeamId;
  learnerId: CharacterId;
  source:
    | Readonly<{
        kind: 'homeTeacherPost';
        postId: HomeTeachingPostId;
        teacherId: CharacterId;
        masteryId: MasteryId;
      }>
    | Readonly<{ kind: 'selfStudy' }>;
  startedOnDay: WorldDay;
  scheduledEndOnDay: WorldDay;
  status: 'active' | 'settled' | 'interrupted';
  revision: Revision;
}>;

// ──────────────────────────────────────────────────────────────────────────
// §4 公開 Query
// View DTO 的精確 schema 未於來源文件給出；先以最小投影占位（AMBIGUITY）。
// ──────────────────────────────────────────────────────────────────────────

export type MasteryProgressView = MasteryProgress;
export type TeachingSessionView = TeachingSession;

export interface ProgressionQuery {
  getMastery(characterId: CharacterId, masteryId: MasteryId): MasteryProgressView;
  getPrimaryAttributes(characterId: CharacterId): PrimaryAttributes;
  getSocialMasteryBenefits(characterId: CharacterId): SocialMasteryBenefitsView;
  knows(characterId: CharacterId, knowledgeId: DefinitionId): boolean;
  meetsRequirements(
    characterId: CharacterId,
    requirements: readonly MasteryRequirement[],
  ): boolean;
  getTeachingSession(characterId: CharacterId): TeachingSessionView | undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 Internal Command（輸入）
// ──────────────────────────────────────────────────────────────────────────

export type GrantContentEventMasteryExperience = Readonly<{
  contentEventInstanceId: ContentEventInstanceId;
  effectId: EffectDefinitionId;
  characterId: CharacterId;
  experienceAwardRuleId: ExperienceAwardRuleId;
}>;

// ──────────────────────────────────────────────────────────────────────────
// §5.3 玩家 Command
// ──────────────────────────────────────────────────────────────────────────

export type LearnFromBookCommand = Readonly<{
  type: 'learnFromBook';
  characterId: CharacterId;
  bookItemId: ItemInstanceId;
  knowledgeId: DefinitionId;
}>;

export type StartTeachingCommand = Readonly<{
  type: 'startTeaching';
  learnerId: CharacterId;
  teacher: TeachingSource;
  masteryId: MasteryId;
  ruleId: TeachingRuleId;
}>;

// B.5：補齊原本缺席的訊息聯集宣告（判別欄由各 payload 自帶）。
// Progression 目前**沒有**已實作的 Game Command。learnFromBook / startTeaching 的 Handler 尚未撰寫，
// 因此不宣告 union——沒有能力就不該有註冊表面（設計見 06_progression_module.md）。

// ──────────────────────────────────────────────────────────────────────────
// §6 傳授規則
// ──────────────────────────────────────────────────────────────────────────

export type TeachingRuleDefinition = DefinitionHeader<TeachingRuleId> &
  Readonly<{
    durationDays: number; // 第一版為 28
    adultDifferenceRate: number; // 第一版為 0.0015
    childDifferenceRate: number; // 第一版為 0.00225
    cityTeacherMasteryLevel: number; // 第一版為 5
    maxLevelGainPerSession: number; // 第一版為 1
  }>;

// ──────────────────────────────────────────────────────────────────────────
// §8 輸出事件（最少 payload）
// ──────────────────────────────────────────────────────────────────────────

export type MasteryExperienceGrantedEvent = Readonly<{
  type: 'MasteryExperienceGranted';
  characterId: CharacterId;
  masteryId: MasteryId;
  amount: number;
  source: MasterySource;
}>;

export type MasteryLevelChangedEvent = Readonly<{
  type: 'MasteryLevelChanged';
  characterId: CharacterId;
  masteryId: MasteryId;
  oldLevel: number;
  newLevel: number;
}>;

export type PrimaryAttributesChangedEvent = Readonly<{
  type: 'PrimaryAttributesChanged';
  characterId: CharacterId;
  attributes: PrimaryAttributes;
}>;

export type ProgressionCapacityChangedEvent = Readonly<{
  type: 'ProgressionCapacityChanged';
  characterId: CharacterId;
}>;

export type AutomaticKnowledgeUnlockedEvent = Readonly<{
  type: 'AutomaticKnowledgeUnlocked';
  characterId: CharacterId;
  knowledgeId: DefinitionId;
}>;

export type KnowledgeLearnedEvent = Readonly<{
  type: 'KnowledgeLearned';
  characterId: CharacterId;
  knowledgeId: DefinitionId;
  source: KnowledgeSource;
}>;

export type TeachingSessionChangedEvent = Readonly<{
  type: 'TeachingSessionChanged';
  sessionId: TeachingSessionId;
  status: TeachingSessionStatus;
  gainedExperience: number;
}>;

export type ProgressionDomainEvent =
  | MasteryExperienceGrantedEvent
  | MasteryLevelChangedEvent
  | PrimaryAttributesChangedEvent
  | ProgressionCapacityChangedEvent
  | AutomaticKnowledgeUnlockedEvent
  | KnowledgeLearnedEvent
  | TeachingSessionChangedEvent;
