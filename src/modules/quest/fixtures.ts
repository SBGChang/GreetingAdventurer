// modules/quest/fixtures.ts
// 測試 fixture 與決定性 stub Port。**正式路徑不得引用本檔**（門禁：scripts/verify-runtime-discipline.ts）。

import type {
  ActionChainId,
  CharacterArchetypeId,
  CharacterId,
  CityId,
  ContentInstanceId,
  ContentPackId,
  DefinitionId,
  EffectDefinitionId,
  EscortCandidateId,
  ExperienceAwardRuleId,
  FacilityDefinitionId,
  ItemInstanceId,
  JobId,
  MapInstanceId,
  QuestDeadlineRuleId,
  QuestObjectiveRuleId,
  QuestReactionRuleId,
  QuestRewardRuleId,
  QuestId,
  ResolverId,
  Revision,
  RoomId,
  ShopOfferId,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type {
  QuestDefinitionReader,
  QuestDeadlineJob,
  QuestDeadlineJobKind,
  QuestDeadlineRuleDefinition,
  QuestObjective,
  QuestObjectiveRuleDefinition,
  QuestReactionRuleDefinition,
  QuestRewardRuleDefinition,
  QuestStatus,
} from '../../contracts/quest';
import type { MapContentView } from '../../contracts/map';
import type { TeamLocation } from '../../contracts/team';
import type { TemporaryCharacterOrigin } from '../../contracts/character';

import { QUEST_MODULE_ID, type QuestHandlerContext, type QuestMapContentPort, type QuestTeamPort, type QuestTemporaryCharacterPort } from './system';
import {
  createInitialQuestState,
  emptyObjectiveProgress,
  type NpcQuestClaim,
  type QuestInstance,
  type QuestObjectiveProgress,
  type QuestState,
} from './state';

// ── 固定 ID ───────────────────────────────────────────────────────────────────
export const PACK_ID = 'pack:quest-bringup' as ContentPackId;

export const CITY_GUILD = 'city-guild' as CityId;
export const CITY_DESTINATION = 'city-destination' as CityId;
export const MAP_ID = 'map-1' as MapInstanceId;
export const TEAM_ID = 'team-1' as TeamId;
export const OTHER_TEAM_ID = 'team-2' as TeamId;
export const MEMBER_A = 'char-a' as CharacterId;
export const MEMBER_B = 'char-b' as CharacterId;
export const ESCORTEE_ID = 'char-escortee' as CharacterId;
export const CAPTIVE_ID = 'char-captive' as CharacterId;
export const CHAIN_ID = 'chain-1' as ActionChainId;
export const OTHER_CHAIN_ID = 'chain-2' as ActionChainId;

export const CONTENT_MOB_A = 'content-mob-a' as ContentInstanceId;
export const CONTENT_MOB_B = 'content-mob-b' as ContentInstanceId;
export const CONTENT_BOSS = 'content-boss' as ContentInstanceId;
export const CONTENT_KIDNAP = 'content-kidnap' as ContentInstanceId;

export const REACTION_RULE_ID = 'definition:quest-reaction-rule:local-suppression' as QuestReactionRuleId;
export const DEADLINE_RULE_ID = 'definition:quest-deadline-rule:suppression' as QuestDeadlineRuleId;
export const OBJECTIVE_RULE_ID = 'definition:quest-objective-rule:suppression' as QuestObjectiveRuleId;
export const REWARD_RULE_ID = 'definition:quest-reward-rule:standard' as QuestRewardRuleId;
export const MISSING_REWARD_RULE_ID = 'definition:quest-reward-rule:absent' as QuestRewardRuleId;
export const GUILD_RESOLVER_ID = 'resolver:quest-guild-local' as ResolverId;
export const ACTUAL_END_RESOLVER_ID = 'resolver:quest-actual-end' as ResolverId;
export const MASTERY_EXPERIENCE_RULE_ID = 'definition:experience-award-rule:quest' as ExperienceAwardRuleId;
export const REPUTATION_EFFECT_ID = 'definition:effect:quest-reputation' as EffectDefinitionId;
export const CAPTIVE_ARCHETYPE_ID = 'definition:character-archetype:merchant' as CharacterArchetypeId;

export const ITEM_ID = 'item-1' as ItemInstanceId;
export const SHOP_OFFER_ID = 'offer-1' as ShopOfferId;
export const FACILITY_ID = 'definition:facility:warehouse' as FacilityDefinitionId;
export const ESCORT_CANDIDATE_ID = 'escort-candidate-1' as EscortCandidateId;

// ── Definition Reader stub（記憶體，不讀檔）─────────────────────────────────────

export function stubReactionRule(): QuestReactionRuleDefinition {
  return {
    id: REACTION_RULE_ID,
    schemaVersion: 1,
    packId: PACK_ID,
    enabled: true,
    sourceKind: 'monsterGroup',
    questKind: 'suppression',
    creationChance: 1,
    guildResolverId: GUILD_RESOLVER_ID,
    deadlineRuleId: DEADLINE_RULE_ID,
    objectiveRuleId: OBJECTIVE_RULE_ID,
    rewardRuleId: REWARD_RULE_ID,
  };
}

export function stubDeadlineRule(): QuestDeadlineRuleDefinition {
  return {
    id: DEADLINE_RULE_ID,
    schemaVersion: 1,
    packId: PACK_ID,
    enabled: true,
    acceptDurationDays: 14,
    actualEndResolverId: ACTUAL_END_RESOLVER_ID,
    maxCityGapCount: 2,
  };
}

export function stubObjectiveRule(): QuestObjectiveRuleDefinition {
  return {
    id: OBJECTIVE_RULE_ID,
    schemaVersion: 1,
    packId: PACK_ID,
    enabled: true,
    questKind: 'suppression',
  };
}

export function stubRewardRule(): QuestRewardRuleDefinition {
  return {
    id: REWARD_RULE_ID,
    schemaVersion: 1,
    packId: PACK_ID,
    enabled: true,
    masteryExperienceRuleId: MASTERY_EXPERIENCE_RULE_ID,
    reputationEffectIds: [REPUTATION_EFFECT_ID],
  };
}

// 未知 id 一律拋錯（與真實 narrowedDomainReader 行為一致：不靜默回 undefined）。
export function stubDefinitionReader(): QuestDefinitionReader {
  return {
    getQuestReactionRule: (id) => {
      if (id !== REACTION_RULE_ID) throw new Error(`quest fixture: unknown reaction rule ${String(id)}`);
      return stubReactionRule();
    },
    getQuestDeadlineRule: (id) => {
      if (id !== DEADLINE_RULE_ID) throw new Error(`quest fixture: unknown deadline rule ${String(id)}`);
      return stubDeadlineRule();
    },
    getQuestRewardRule: (id) => {
      if (id !== REWARD_RULE_ID) throw new Error(`quest fixture: unknown reward rule ${String(id)}`);
      return stubRewardRule();
    },
    getQuestObjectiveRule: (id) => {
      if (id !== OBJECTIVE_RULE_ID) throw new Error(`quest fixture: unknown objective rule ${String(id)}`);
      return stubObjectiveRule();
    },
  };
}

// ── 跨模組 Port stub ─────────────────────────────────────────────────────────

export function stubTeamPort(
  input: Readonly<{ location?: TeamLocation; members?: readonly CharacterId[] }> = {},
): QuestTeamPort {
  const location: TeamLocation = input.location ?? { kind: 'city', cityId: CITY_GUILD };
  const members = input.members ?? [MEMBER_A, MEMBER_B];
  return {
    getLocation: () => location,
    listFormalMembers: () => members,
  };
}

export function kidnapContent(contentId: ContentInstanceId = CONTENT_KIDNAP): MapContentView {
  return {
    contentId,
    mapId: MAP_ID,
    mapVersion: 1,
    kind: 'kidnap',
    definitionId: 'definition:map-content:kidnap' as DefinitionId,
    position: { roomId: 'template-local:room:r1' as RoomId },
    payload: {
      kind: 'kidnap',
      captiveArchetypeId: CAPTIVE_ARCHETYPE_ID,
      controllerContentIds: [],
    },
    state: 'resolved',
    protectedByQuestIds: [],
    revision: 0 as Revision,
  };
}

export function stubMapContentPort(
  contents: readonly MapContentView[] = [kidnapContent()],
): QuestMapContentPort {
  const byId = new Map<string, MapContentView>(contents.map((c) => [String(c.contentId), c]));
  return { getContent: (contentId) => byId.get(String(contentId)) };
}

export function stubTemporaryCharacterPort(
  origins: Readonly<Record<string, TemporaryCharacterOrigin>> = {},
): QuestTemporaryCharacterPort {
  return { getTemporaryOrigin: (characterId) => origins[String(characterId)] };
}

export function makeContext(
  input: Readonly<{
    worldDay?: WorldDay;
    teams?: QuestTeamPort;
    mapContents?: QuestMapContentPort;
    characters?: QuestTemporaryCharacterPort;
    definitions?: QuestDefinitionReader;
  }> = {},
): QuestHandlerContext {
  return {
    worldDay: input.worldDay ?? (100 as WorldDay),
    definitions: input.definitions ?? stubDefinitionReader(),
    teams: input.teams ?? stubTeamPort(),
    mapContents: input.mapContents ?? stubMapContentPort(),
    characters: input.characters ?? stubTemporaryCharacterPort(),
  };
}

// ── Quest fixture ────────────────────────────────────────────────────────────

// 逐 kind 窄化型別：測試常以 `{ ...OBJECTIVE_ESCORT, characterId }` 補上綁定角色，
// 若宣告成整個 QuestObjective 聯集，展開後編譯器會認不出那是哪一支。
type ObjectiveOf<K extends QuestObjective['kind']> = Extract<QuestObjective, { kind: K }>;

export const OBJECTIVE_SUPPRESSION: ObjectiveOf<'suppression'> = {
  kind: 'suppression',
  mapId: MAP_ID,
  targetContentIds: [CONTENT_MOB_A, CONTENT_MOB_B],
};

export const OBJECTIVE_HUNT: ObjectiveOf<'hunt'> = {
  kind: 'hunt',
  mapId: MAP_ID,
  bossContentIds: [CONTENT_BOSS],
};

export const OBJECTIVE_RESCUE: ObjectiveOf<'rescue'> = {
  kind: 'rescue',
  contentId: CONTENT_KIDNAP,
  mapId: MAP_ID,
};

export const OBJECTIVE_ESCORT: ObjectiveOf<'escort'> = {
  kind: 'escort',
  candidateId: ESCORT_CANDIDATE_ID,
  destinationCityId: CITY_DESTINATION,
};

export const OBJECTIVE_DELIVERY: ObjectiveOf<'delivery'> = {
  kind: 'delivery',
  itemId: ITEM_ID,
  destinationCityId: CITY_DESTINATION,
  facilityId: FACILITY_ID,
};

export const OBJECTIVE_PURCHASE: ObjectiveOf<'purchase'> = {
  kind: 'purchase',
  itemId: ITEM_ID,
  shopOfferId: SHOP_OFFER_ID,
};

export function makeQuest(
  input: Readonly<{
    questId: string;
    objective: QuestObjective;
    status?: QuestStatus;
    acceptedByTeamId?: TeamId;
    acceptedOnDay?: WorldDay;
    participantCharacterIds?: readonly CharacterId[];
    completedOnDay?: WorldDay;
    createdOnDay?: WorldDay;
    acceptDeadline?: WorldDay;
    actualEndDeadline?: WorldDay;
    postingGuildCityId?: CityId;
    rewardRuleId?: QuestRewardRuleId;
    progress?: QuestObjectiveProgress;
    settlement?: QuestInstance['settlement'];
  }>,
): QuestInstance {
  const questId = input.questId as QuestId;
  return {
    questId,
    kind: input.objective.kind,
    sourceRuleId: REACTION_RULE_ID,
    sourceId: MAP_ID,
    postingGuildCityId: input.postingGuildCityId ?? CITY_GUILD,
    createdOnDay: input.createdOnDay ?? (90 as WorldDay),
    acceptDeadline: input.acceptDeadline ?? (104 as WorldDay),
    actualEndDeadline: input.actualEndDeadline ?? (131 as WorldDay),
    deadlineRolls: [11, 12],
    status: input.status ?? 'unaccepted',
    ...(input.acceptedByTeamId === undefined ? {} : { acceptedByTeamId: input.acceptedByTeamId }),
    ...(input.acceptedOnDay === undefined ? {} : { acceptedOnDay: input.acceptedOnDay }),
    participantCharacterIds: input.participantCharacterIds ?? [],
    ...(input.completedOnDay === undefined ? {} : { completedOnDay: input.completedOnDay }),
    ...(input.settlement === undefined ? {} : { settlement: input.settlement }),
    objective: input.objective,
    progress: input.progress ?? emptyObjectiveProgress,
    rewardRuleId: input.rewardRuleId ?? REWARD_RULE_ID,
    revision: 0 as Revision,
  };
}

export function makeClaim(
  input: Readonly<{
    questId: string;
    teamId?: TeamId;
    chainId?: ActionChainId;
    claimedOnDay?: WorldDay;
  }>,
): NpcQuestClaim {
  return {
    questId: input.questId as QuestId,
    teamId: input.teamId ?? OTHER_TEAM_ID,
    chainId: input.chainId ?? CHAIN_ID,
    claimedOnDay: input.claimedOnDay ?? (95 as WorldDay),
    revision: 0 as Revision,
  };
}

export function questStateWith(
  quests: readonly QuestInstance[],
  claims: readonly NpcQuestClaim[] = [],
): QuestState {
  return createInitialQuestState({ quests, npcClaims: claims });
}

export function deadlineJob(
  questId: string,
  kind: QuestDeadlineJobKind,
  dueDay: number,
): QuestDeadlineJob {
  return {
    jobId: `job-${questId}-${kind}` as JobId,
    type: 'questDeadline',
    dueDay: dueDay as WorldDay,
    ownerModule: QUEST_MODULE_ID,
    targetId: questId as QuestId,
    payload: { kind },
  };
}
