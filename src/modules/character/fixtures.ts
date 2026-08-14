// modules/character/fixtures.ts
// 最小 Fixture：一名玩家角色 + 一名 NPC；另附測試用的決定性 stub Port 與建構器。
// 這些 stub 皆為決定性（無 RNG/時間），RNG 只在 Resolver Port 內以注入結果模擬。

import type {
  CharacterId,
  FamilyLinkId,
  RelationshipFactId,
  CharacterStatusInstanceId,
  CharacterArchetypeId,
  LifecycleRuleId,
  AgeModifierRuleId,
  ResolverId,
  ContentPackId,
  CharacterStatusDefinitionId,
  BirthRuleId,
  WorldAdventurerGenerationRuleId,
  CharacterTraitDefinitionId,
  QuestId,
  WorldDay,
  Revision,
} from '../../contracts/core';
import type {
  Character,
  CharacterState,
  CharacterCondition,
  CharacterArchetypeDefinition,
  LifecycleRuleDefinition,
  StatusDefinition,
  BirthRuleDefinition,
  WorldAdventurerGenerationRuleDefinition,
  TemporaryCharacterRuleDefinition,
  TemporaryCharacterRuleId,
  CharacterDefinitionReader,
  CharacterStatsQuery,
  Sex,
  CharacterOrigin,
  TemporaryCharacterOrigin,
  CharacterLifecycleTokens,
} from '../../contracts/character';
import type {
  CharacterHandlerContext,
  CharacterIdAllocator,
  CharacterResolverPort,
} from './system';
import { createCharacterState } from './state';

// ── 常數（第一版 15/55/80 歲，皆換算為天）──────────────────────────────────
const DAYS_PER_YEAR = 365;
export const ADULTHOOD_AGE_DAYS = 15 * DAYS_PER_YEAR; // 5475
export const PLAYABLE_END_AGE_DAYS = 55 * DAYS_PER_YEAR; // 20075
export const NATURAL_LIFE_END_AGE_DAYS = 80 * DAYS_PER_YEAR; // 29200

const PACK_ID = 'pack-test' as ContentPackId;
export const PLAYER_ARCHETYPE_ID = 'arch-player' as CharacterArchetypeId;
export const NPC_ARCHETYPE_ID = 'arch-npc-adventurer' as CharacterArchetypeId;
const LIFECYCLE_RULE_ID = 'lifecycle-standard' as LifecycleRuleId;

export const POISON_STATUS_ID = 'status-poison' as CharacterStatusDefinitionId;
export const WELLFED_STATUS_ID = 'status-wellfed' as CharacterStatusDefinitionId;

export const PLAYER_ID = 'char-player' as CharacterId;
export const NPC_ID = 'char-npc' as CharacterId;

// ── Fixture 角色 ────────────────────────────────────────────────────────────

function conditionOf(health: number, mana: number): CharacterCondition {
  return { health, mana, statuses: [] };
}

export function makeCharacter(
  input: Readonly<{
    characterId: CharacterId;
    archetypeId?: CharacterArchetypeId;
    origin?: CharacterOrigin;
    sex?: Sex;
    birthDay?: WorldDay;
    lifeState?: Character['lifeState'];
    availability?: Character['availability'];
    reputation?: number;
    condition?: CharacterCondition;
    parentIds?: readonly CharacterId[];
    childIds?: readonly CharacterId[];
    innateTraitIds?: readonly CharacterTraitDefinitionId[];
    temporaryOrigin?: TemporaryCharacterOrigin;
    lifecycleRevisions?: CharacterLifecycleTokens; // 供 characterLifecycleDue 的 expectedRevision 測試。
  }>,
): Character {
  return {
    characterId: input.characterId,
    archetypeId: input.archetypeId ?? PLAYER_ARCHETYPE_ID,
    origin: input.origin ?? 'playerLineage',
    sex: input.sex ?? 'female',
    birthDay: input.birthDay ?? (0 as WorldDay),
    lifeState: input.lifeState ?? 'alive',
    availability: input.availability ?? 'available',
    parentIds: input.parentIds ?? [],
    childIds: input.childIds ?? [],
    innateTraitIds: input.innateTraitIds ?? [],
    reputation: input.reputation ?? 0,
    condition: input.condition ?? conditionOf(100, 50),
    ...(input.temporaryOrigin ? { temporaryOrigin: input.temporaryOrigin } : {}),
    revision: 0 as Revision,
    lifecycleRevisions: input.lifecycleRevisions ?? { adulthood: 0 as Revision, retirementCheck: 0 as Revision, naturalDeathCheck: 0 as Revision },
  };
}

export function makeEscort(
  characterId: CharacterId,
  sourceQuestId: QuestId,
  birthDay: WorldDay = 0 as WorldDay,
): Character {
  return makeCharacter({
    characterId,
    origin: 'questTemporary',
    availability: 'temporary',
    birthDay,
    temporaryOrigin: { kind: 'escort', sourceQuestId, recoveryPolicy: 'escortQuestLifecycle' },
  });
}

export function makeRescue(
  characterId: CharacterId,
  sourceQuestId: QuestId,
  birthDay: WorldDay = 0 as WorldDay,
): Character {
  return makeCharacter({
    characterId,
    origin: 'questTemporary',
    availability: 'temporary',
    birthDay,
    temporaryOrigin: { kind: 'rescue', sourceQuestId, recoveryPolicy: 'rescueQuestLifecycle' },
  });
}

// 最小 Fixture Slice：一名玩家（成年、可用）+ 一名 NPC 冒險者（成年、可用）。
export function fixtureCharacterState(worldDay: WorldDay = 20000 as WorldDay): CharacterState {
  const adultBirthDay = (worldDay - ADULTHOOD_AGE_DAYS - 1) as WorldDay;
  const player = makeCharacter({
    characterId: PLAYER_ID,
    archetypeId: PLAYER_ARCHETYPE_ID,
    origin: 'playerLineage',
    sex: 'female',
    birthDay: adultBirthDay,
  });
  const npc = makeCharacter({
    characterId: NPC_ID,
    archetypeId: NPC_ARCHETYPE_ID,
    origin: 'worldAdventurer',
    sex: 'male',
    birthDay: adultBirthDay,
  });
  return createCharacterState({ characters: [player, npc] });
}

// ── Stub Port ───────────────────────────────────────────────────────────────

// 決定性 ID 配發器：以前綴 + 遞增計數；模擬交易私有 cursor。
export function makeIdAllocator(prefix = 'gen'): CharacterIdAllocator {
  let n = 0;
  const next = (kind: string): string => {
    n += 1;
    return `${prefix}-${kind}-${n}`;
  };
  return {
    nextCharacterId: () => next('char') as CharacterId,
    nextFamilyLinkId: () => next('link') as FamilyLinkId,
    nextRelationshipFactId: () => next('fact') as RelationshipFactId,
    nextStatusInstanceId: () => next('status') as CharacterStatusInstanceId,
  };
}

export function stubStatsQuery(maxHealth = 100, maxMana = 50): CharacterStatsQuery {
  return { getStats: () => ({ maxHealth, maxMana }) };
}

function header(id: string, packId: ContentPackId) {
  return { id: id as never, schemaVersion: 1, packId, enabled: true };
}

const STANDARD_LIFECYCLE: LifecycleRuleDefinition = {
  ...header(LIFECYCLE_RULE_ID, PACK_ID),
  id: LIFECYCLE_RULE_ID,
  adulthoodAgeDays: ADULTHOOD_AGE_DAYS,
  naturalLifeEndAgeDays: NATURAL_LIFE_END_AGE_DAYS,
  playableAgeStartDays: ADULTHOOD_AGE_DAYS,
  playableAgeEndDays: PLAYABLE_END_AGE_DAYS,
  ageModifierRuleId: 'age-mod-standard' as AgeModifierRuleId,
  retirementResolverId: 'resolver-retire' as ResolverId,
  naturalDeathResolverId: 'resolver-death' as ResolverId,
};

function archetype(id: CharacterArchetypeId): CharacterArchetypeDefinition {
  return {
    ...header(id, PACK_ID),
    id,
    roleTags: [],
    lifecycleRuleId: LIFECYCLE_RULE_ID,
    canBecomeAdventurer: true,
    temporaryOnly: false,
  };
}

function status(
  id: CharacterStatusDefinitionId,
  clearByRest: boolean,
  stackPolicy: StatusDefinition['stackPolicy'],
): StatusDefinition {
  return {
    ...header(id, PACK_ID),
    id,
    category: 'temporaryCondition',
    clearByRest,
    stackPolicy,
    effects: [],
  };
}

const KNOWN_STATUSES: Readonly<Record<string, StatusDefinition>> = {
  [POISON_STATUS_ID]: status(POISON_STATUS_ID, false, 'stack'),
  [WELLFED_STATUS_ID]: status(WELLFED_STATUS_ID, true, 'replace'),
};

// 窄化 Definition Reader stub：只回傳 Character 擁有的 kind。
export function stubDefinitionReader(): CharacterDefinitionReader {
  return {
    getArchetype: (id) => archetype(id),
    getLifecycleRule: () => STANDARD_LIFECYCLE,
    getStatusDefinition: (id) =>
      KNOWN_STATUSES[id] ?? status(id, true, 'replace'),
    getBirthRule: (id): BirthRuleDefinition => ({
      ...header(id, PACK_ID),
      id,
      requiredRestDays: 365,
      eligibilityResolverId: 'resolver-birth-eligible' as ResolverId,
      birthResolverId: 'resolver-birth' as ResolverId,
    }),
    getTemporaryCharacterRule: (id: TemporaryCharacterRuleId): TemporaryCharacterRuleDefinition => ({
      ...header(id, PACK_ID),
      id,
    }),
    getWorldAdventurerGenerationRule: (
      id,
    ): WorldAdventurerGenerationRuleDefinition => ({
      ...header(id, PACK_ID),
      id,
      allowedArchetypeIds: [NPC_ARCHETYPE_ID],
      archetypeWeightResolverId: 'resolver-arch-weight' as ResolverId,
      sexWeightResolverId: 'resolver-sex-weight' as ResolverId,
      startingAgeResolverId: 'resolver-start-age' as ResolverId,
      innateTraitResolverId: 'resolver-innate' as ResolverId,
    }),
  };
}

// 可設定行為的 Resolver Port stub。預設：不死、不退休、不生育、聲望 +0。
export function stubResolverPort(
  overrides: Partial<CharacterResolverPort> = {},
): CharacterResolverPort {
  const base: CharacterResolverPort = {
    resolveNaturalDeath: () => ({ outcome: 'reschedule', nextCheckInDays: 365 }),
    resolveRetirement: () => ({ outcome: 'reschedule', nextCheckInDays: 365 }),
    resolveBirth: () => ({ born: false }),
    resolveWorldAdventurer: ({ index }) => ({
      archetypeId: NPC_ARCHETYPE_ID,
      sex: index % 2 === 0 ? 'female' : 'male',
      birthDay: 0 as WorldDay,
      innateTraitIds: [],
    }),
    resolveReputationDelta: () => 0,
  };
  return { ...base, ...overrides };
}

// 一站式 Handler Context（測試預設）。
export function makeContext(
  overrides: Partial<CharacterHandlerContext> = {},
): CharacterHandlerContext {
  return {
    worldDay: (overrides.worldDay ?? (20000 as WorldDay)) as WorldDay,
    definitions: overrides.definitions ?? stubDefinitionReader(),
    stats: overrides.stats ?? stubStatsQuery(),
    ids: overrides.ids ?? makeIdAllocator(),
    resolvers: overrides.resolvers ?? stubResolverPort(),
  };
}
