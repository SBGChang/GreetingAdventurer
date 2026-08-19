// modules/npc-behavior/fixtures.ts
// 最小測試 Fixture：兩份**不同內容的 Definition 集**（模擬兩份 Content Pack）、決定性 RNG、
// 以及 Team / World / Condition / Resolver / IdAllocator 的可注入 stub。
//
// 兩份定義集的存在是本模組驗收的核心：同一份 Runtime 程式碼配上不同的候選、條件與權重，
// 必須產生不同的 NPC 決策。fixture 因此刻意讓 pack A 與 pack B 只在**資料**上不同。
// 純資料／純函式，無外部依賴；正式路徑不得引用本檔。

import type {
  ActionChainId,
  ActionChainNodeId,
  ActionChainTemplateId,
  AdventurerDecisionPolicyId,
  CharacterId,
  CityId,
  ConditionDefinitionId,
  ContentPackId,
  DeterministicRng,
  NpcMarketPolicyId,
  NpcTravelRuleId,
  ResolverId,
  Revision,
  RngContext,
  RngCursor,
  RngStreamId,
  RouteId,
  Seed,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type {
  ActionChainTemplateDefinition,
  AdventurerDecisionPolicyDefinition,
  NpcBehaviorDefinitionReader,
  NpcMarketPolicyDefinition,
  NpcStopPolicyId,
} from '../../contracts/npc-behavior';
import type {
  FreeActionRuleDefinition,
  FreeActionRuleId,
  NpcTravelRuleDefinition,
} from '../../contracts/team';

import type { NpcBehaviorState } from './state';
import { createController, createNpcBehaviorState } from './state';
import type {
  NpcBehaviorConditionPort,
  NpcBehaviorContext,
  NpcBehaviorIdAllocator,
  NpcBehaviorResolverPort,
  NpcBehaviorTeamPort,
  NpcBehaviorWorldPort,
} from './system';

const PACK_A = 'pack:npc-behavior-fixture-a' as ContentPackId;
const PACK_B = 'pack:npc-behavior-fixture-b' as ContentPackId;

// ── 固定 ID ────────────────────────────────────────────────────────────────
export const FIXTURE = {
  npcTeamId: 'runtime:team:npc-wanderers' as TeamId,
  playerTeamId: 'runtime:team:player' as TeamId,
  memberA: 'runtime:character:npc-leader' as CharacterId,
  memberB: 'runtime:character:npc-ally' as CharacterId,

  cityHome: 'definition:city:home' as CityId,
  cityNorth: 'definition:city:north' as CityId,
  citySouth: 'definition:city:south' as CityId,
  cityFar: 'definition:city:far' as CityId,
  routeNorth: 'definition:route:home-north' as RouteId,
  routeSouth: 'definition:route:home-south' as RouteId,
  routeFarLeg1: 'definition:route:home-mid' as RouteId,
  routeFarLeg2: 'definition:route:mid-far' as RouteId,

  policyA: 'definition:adventurer-decision-policy:wanderer' as AdventurerDecisionPolicyId,
  policyB: 'definition:adventurer-decision-policy:delver' as AdventurerDecisionPolicyId,
  templateTravelNorth: 'definition:action-chain-template:travel-north' as ActionChainTemplateId,
  templateTravelSouth: 'definition:action-chain-template:travel-south' as ActionChainTemplateId,
  templateAdventure: 'definition:action-chain-template:local-adventure' as ActionChainTemplateId,
  templateFree: 'definition:action-chain-template:city-free' as ActionChainTemplateId,
  templateFreeThenTravel:
    'definition:action-chain-template:free-then-travel' as ActionChainTemplateId,

  travelRule: 'definition:npc-travel-rule:npc-direct' as NpcTravelRuleId,
  marketPolicy: 'definition:npc-market-policy:frugal' as NpcMarketPolicyId,
  restRule: 'definition:free-action-rule:rest' as FreeActionRuleId,
  stopPolicy: 'definition:npc-stop-policy:first-failure' as NpcStopPolicyId,

  condAlways: 'definition:condition:always' as ConditionDefinitionId,
  condNever: 'definition:condition:never' as ConditionDefinitionId,

  weightTravelHigh: 'resolver:npc-weight-travel-high' as ResolverId,
  weightTravelLow: 'resolver:npc-weight-travel-low' as ResolverId,
  weightAdventureHigh: 'resolver:npc-weight-adventure-high' as ResolverId,
  weightAdventureLow: 'resolver:npc-weight-adventure-low' as ResolverId,
  destNorth: 'resolver:npc-destination-north' as ResolverId,
  destSouth: 'resolver:npc-destination-south' as ResolverId,
  destFar: 'resolver:npc-destination-far' as ResolverId,
  destNone: 'resolver:npc-destination-none' as ResolverId,
  mapTarget: 'resolver:npc-adventure-map' as ResolverId,
} as const;

// ── Definition 集（兩份「Content Pack」）──────────────────────────────────

function header(id: string, packId: ContentPackId): Readonly<{
  id: never;
  schemaVersion: number;
  packId: ContentPackId;
  enabled: boolean;
}> {
  return { id: id as never, schemaVersion: 1, packId, enabled: true };
}

export type FixtureDefinitions = Readonly<{
  policies: Readonly<Record<string, AdventurerDecisionPolicyDefinition>>;
  templates: Readonly<Record<string, ActionChainTemplateDefinition>>;
  travelRules: Readonly<Record<string, NpcTravelRuleDefinition>>;
  marketPolicies: Readonly<Record<string, NpcMarketPolicyDefinition>>;
  freeActionRules: Readonly<Record<string, FreeActionRuleDefinition>>;
}>;

function templates(packId: ContentPackId): FixtureDefinitions['templates'] {
  return {
    [FIXTURE.templateTravelNorth]: {
      ...header(FIXTURE.templateTravelNorth, packId),
      purpose: 'travel',
      nodes: [
        { kind: 'travelToCity', destinationResolverId: FIXTURE.destNorth },
        { kind: 'complete' },
      ],
    },
    [FIXTURE.templateTravelSouth]: {
      ...header(FIXTURE.templateTravelSouth, packId),
      purpose: 'travel',
      nodes: [{ kind: 'travelToCity', destinationResolverId: FIXTURE.destSouth }],
    },
    [FIXTURE.templateAdventure]: {
      ...header(FIXTURE.templateAdventure, packId),
      purpose: 'localAdventure',
      nodes: [
        {
          kind: 'executeNearbyAdventure',
          mapResolverId: FIXTURE.mapTarget,
          stopPolicyId: FIXTURE.stopPolicy,
        },
      ],
    },
    [FIXTURE.templateFree]: {
      ...header(FIXTURE.templateFree, packId),
      purpose: 'free',
      nodes: [{ kind: 'cityFree' }],
    },
    [FIXTURE.templateFreeThenTravel]: {
      ...header(FIXTURE.templateFreeThenTravel, packId),
      purpose: 'travel',
      nodes: [
        { kind: 'cityFree' },
        { kind: 'travelToCity', destinationResolverId: FIXTURE.destSouth },
        { kind: 'complete' },
      ],
    },
  } as FixtureDefinitions['templates'];
}

// Pack A：偏好旅行（travel 權重高、冒險地權重低），旅行模板指向北城。
// Pack B：偏好下冒險地（權重相反），且旅行模板改指向南城。
function policy(
  packId: ContentPackId,
  id: AdventurerDecisionPolicyId,
  input: Readonly<{
    travelTemplateId: ActionChainTemplateId;
    travelWeightResolverId: ResolverId;
    adventureWeightResolverId: ResolverId;
    reviewIntervalDays: number;
    forcedFreeDurationDays: Readonly<{ min: number; max: number }>;
    fallbackChainTemplateId: ActionChainTemplateId;
  }>,
): AdventurerDecisionPolicyDefinition {
  return {
    ...header(id, packId),
    reviewIntervalDays: input.reviewIntervalDays,
    candidates: [
      {
        intentKind: 'travelToCity',
        chainTemplateId: input.travelTemplateId,
        conditionId: FIXTURE.condAlways,
        weightResolverId: input.travelWeightResolverId,
      },
      {
        intentKind: 'enterNearbyAdventureMap',
        chainTemplateId: FIXTURE.templateAdventure,
        conditionId: FIXTURE.condAlways,
        weightResolverId: input.adventureWeightResolverId,
      },
    ],
    memberFreeActionCandidates: [
      {
        actionKind: 'rest',
        freeActionRuleId: FIXTURE.restRule,
        conditionId: FIXTURE.condAlways,
        weightResolverId: input.travelWeightResolverId,
      },
    ],
    fallbackChainTemplateId: input.fallbackChainTemplateId,
    forcedFreeDurationDays: input.forcedFreeDurationDays,
    npcTravelRuleId: FIXTURE.travelRule,
    marketPolicyId: FIXTURE.marketPolicy,
  };
}

function sharedDefinitions(packId: ContentPackId): Omit<FixtureDefinitions, 'policies'> {
  return {
    templates: templates(packId),
    travelRules: {
      [FIXTURE.travelRule]: {
        ...header(FIXTURE.travelRule, packId),
        durationDays: 6,
        travelExperienceRuleId: 'definition:experience-award-rule:travel' as never,
        travelExperienceMultiplier: 1,
        eventPolicy: 'none',
      },
    } as FixtureDefinitions['travelRules'],
    marketPolicies: {
      [FIXTURE.marketPolicy]: {
        ...header(FIXTURE.marketPolicy, packId),
        budgetReserveRuleId: 'resolver:npc-budget-reserve' as ResolverId,
        purchaseNeedRules: [
          {
            target: 'combatConsumable',
            needResolverId: 'resolver:npc-need-potion' as ResolverId,
            offerSelectorId: 'resolver:npc-offer-potion' as ResolverId,
          },
        ],
        sellRules: [
          {
            itemSelectorId: 'resolver:npc-sell-select' as ResolverId,
            sellWhenResolverId: 'resolver:npc-sell-when' as ResolverId,
          },
        ],
        maxTransactionsPerFreeCycle: 2,
      },
    } as FixtureDefinitions['marketPolicies'],
    freeActionRules: {
      [FIXTURE.restRule]: {
        ...header(FIXTURE.restRule, packId),
        kind: 'rest',
      },
    } as FixtureDefinitions['freeActionRules'],
  };
}

// pack A 的定義集。
export function definitionsPackA(): FixtureDefinitions {
  return {
    ...sharedDefinitions(PACK_A),
    policies: {
      [FIXTURE.policyA]: policy(PACK_A, FIXTURE.policyA, {
        travelTemplateId: FIXTURE.templateTravelNorth,
        travelWeightResolverId: FIXTURE.weightTravelHigh,
        adventureWeightResolverId: FIXTURE.weightAdventureLow,
        reviewIntervalDays: 30,
        forcedFreeDurationDays: { min: 2, max: 7 },
        fallbackChainTemplateId: FIXTURE.templateTravelNorth,
      }),
    } as FixtureDefinitions['policies'],
  };
}

// pack B 的定義集：同樣兩個候選、同樣的條件，但權重相反、旅行模板換成南城、
// 強制自由期與複審週期也不同——換 Pack 必須換行為。
export function definitionsPackB(): FixtureDefinitions {
  return {
    ...sharedDefinitions(PACK_B),
    policies: {
      [FIXTURE.policyB]: policy(PACK_B, FIXTURE.policyB, {
        travelTemplateId: FIXTURE.templateTravelSouth,
        travelWeightResolverId: FIXTURE.weightTravelLow,
        adventureWeightResolverId: FIXTURE.weightAdventureHigh,
        reviewIntervalDays: 10,
        forcedFreeDurationDays: { min: 3, max: 3 },
        fallbackChainTemplateId: FIXTURE.templateTravelSouth,
      }),
    } as FixtureDefinitions['policies'],
  };
}

// 局部改寫某筆 Decision Policy（測「同一份程式 + 不同資料」用）。
export function overridePolicy(
  defs: FixtureDefinitions,
  policyId: AdventurerDecisionPolicyId,
  patch: Partial<AdventurerDecisionPolicyDefinition>,
): FixtureDefinitions {
  const base = defs.policies[policyId];
  if (base === undefined) throw new Error(`fixture: unknown policy "${policyId}"`);
  return {
    ...defs,
    policies: { ...defs.policies, [policyId]: { ...base, ...patch } } as FixtureDefinitions['policies'],
  };
}

// 改寫北城旅行模板的目的地 Resolver（測目的地不合法的各種拒絕碼用）。
export function withTravelDestinationResolver(
  defs: FixtureDefinitions,
  resolverId: ResolverId,
): FixtureDefinitions {
  const base = defs.templates[FIXTURE.templateTravelNorth];
  if (base === undefined) throw new Error('fixture: missing travel template');
  return {
    ...defs,
    templates: {
      ...defs.templates,
      [FIXTURE.templateTravelNorth]: {
        ...base,
        nodes: [{ kind: 'travelToCity', destinationResolverId: resolverId }, { kind: 'complete' }],
      },
    } as FixtureDefinitions['templates'],
  };
}

// 以定義集組出 Reader；未知 id 明確拋錯（比照 data-runtime 窄化 Reader 的行為）。
export function stubDefinitionReader(defs: FixtureDefinitions): NpcBehaviorDefinitionReader {
  const require = <T>(table: Readonly<Record<string, T>>, id: string, family: string): T => {
    const found = table[id];
    if (found === undefined) {
      throw new Error(`fixture reader: unknown ${family} definition "${id}"`);
    }
    return found;
  };
  return {
    getDecisionPolicy: (id) => require(defs.policies, id, 'adventurer-decision-policy'),
    getActionChainTemplate: (id) => require(defs.templates, id, 'action-chain-template'),
    getMarketPolicy: (id) => require(defs.marketPolicies, id, 'npc-market-policy'),
    getFreeActionRule: (id) => require(defs.freeActionRules, id, 'free-action-rule'),
    getNpcTravelRule: (id) => require(defs.travelRules, id, 'npc-travel-rule'),
  };
}

// ── 決定性 RNG ─────────────────────────────────────────────────────────────
// 以 cursor 雜湊產生 [0,1) 值；nextInt 夾入 [min,max]。cursor 每次前進 1。
export function stubRng(): DeterministicRng {
  const hash = (n: number): number => {
    let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 0x100000000;
  };
  return {
    nextFloat: ({ cursor }) => ({
      value: hash(cursor),
      nextCursor: (cursor + 1) as RngCursor,
    }),
    nextInt: ({ cursor, minInclusive, maxInclusive }) => {
      const span = maxInclusive - minInclusive + 1;
      return {
        value: minInclusive + Math.floor(hash(cursor) * span),
        nextCursor: (cursor + 1) as RngCursor,
      };
    },
  };
}

export function stubRngContext(cursor = 0): RngContext {
  return {
    worldSeed: 'seed-npc-behavior' as Seed,
    streamId: 'rng-stream:npc-behavior' as RngStreamId,
    cursor: cursor as RngCursor,
  };
}

// ── Port stub ──────────────────────────────────────────────────────────────

export function stubTeamPort(
  overrides: Partial<{
    cityByTeam: Readonly<Record<string, CityId | undefined>>;
    membersByTeam: Readonly<Record<string, readonly CharacterId[]>>;
    npcTeamIds: readonly TeamId[];
  }> = {},
): NpcBehaviorTeamPort {
  const cityByTeam = overrides.cityByTeam ?? { [FIXTURE.npcTeamId]: FIXTURE.cityHome };
  const membersByTeam =
    overrides.membersByTeam ?? { [FIXTURE.npcTeamId]: [FIXTURE.memberA, FIXTURE.memberB] };
  const npcTeamIds = overrides.npcTeamIds ?? [FIXTURE.npcTeamId];
  return {
    getCityLocation: (teamId) => cityByTeam[teamId],
    listFormalMembers: (teamId) => membersByTeam[teamId] ?? [],
    isNpcControlled: (teamId) => npcTeamIds.includes(teamId),
  };
}

// 城市圖：home 與 north／south 相鄰（單一 Route 直達）；far 需兩段。
export function stubWorldPort(): NpcBehaviorWorldPort {
  const neighbours: Readonly<Record<string, readonly CityId[]>> = {
    [FIXTURE.cityHome]: [FIXTURE.cityHome, FIXTURE.cityNorth, FIXTURE.citySouth],
    [FIXTURE.cityNorth]: [FIXTURE.cityNorth, FIXTURE.cityHome],
    [FIXTURE.citySouth]: [FIXTURE.citySouth, FIXTURE.cityHome],
    [FIXTURE.cityFar]: [FIXTURE.cityFar],
  };
  const routes: Readonly<Record<string, readonly RouteId[]>> = {
    [`${FIXTURE.cityHome}->${FIXTURE.cityNorth}`]: [FIXTURE.routeNorth],
    [`${FIXTURE.cityHome}->${FIXTURE.citySouth}`]: [FIXTURE.routeSouth],
    [`${FIXTURE.cityHome}->${FIXTURE.cityFar}`]: [FIXTURE.routeFarLeg1, FIXTURE.routeFarLeg2],
  };
  return {
    listCitiesWithinHops: (originCityId) => neighbours[originCityId] ?? [],
    getShortestRoute: (from, to) => routes[`${from}->${to}`],
  };
}

export function stubConditionPort(
  satisfiedIds: readonly ConditionDefinitionId[] = [FIXTURE.condAlways],
): NpcBehaviorConditionPort {
  return { isSatisfied: (conditionId) => satisfiedIds.includes(conditionId) };
}

// Resolver stub：權重與目的城市都以 resolverId 查表（模擬「Resolver + params 定義」的結果）。
// usesRng 為真者回傳前進後的 cursor，用來證明呼叫端確實顯式續接。
export function stubResolverPort(
  overrides: Partial<{
    weights: Readonly<Record<string, number>>;
    destinations: Readonly<Record<string, CityId | undefined>>;
    weightUsesRng: boolean;
  }> = {},
): NpcBehaviorResolverPort {
  const weights =
    overrides.weights ??
    ({
      [FIXTURE.weightTravelHigh]: 9,
      [FIXTURE.weightTravelLow]: 1,
      [FIXTURE.weightAdventureHigh]: 9,
      [FIXTURE.weightAdventureLow]: 1,
    } as Readonly<Record<string, number>>);
  const destinations =
    overrides.destinations ??
    ({
      [FIXTURE.destNorth]: FIXTURE.cityNorth,
      [FIXTURE.destSouth]: FIXTURE.citySouth,
      [FIXTURE.destFar]: FIXTURE.cityFar,
      [FIXTURE.destNone]: undefined,
    } as Readonly<Record<string, CityId | undefined>>);
  const weightUsesRng = overrides.weightUsesRng ?? false;

  return {
    resolveIntentWeight: ({ resolverId, rngContext }) => {
      const value = weights[resolverId];
      if (value === undefined) {
        throw new Error(`fixture resolver: unregistered weight resolver "${resolverId}"`);
      }
      return weightUsesRng
        ? { value, nextRngCursor: (rngContext.cursor + 1) as RngCursor }
        : { value };
    },
    resolveDestinationCity: ({ resolverId }) => {
      if (!(resolverId in destinations)) {
        throw new Error(`fixture resolver: unregistered destination resolver "${resolverId}"`);
      }
      return { value: destinations[resolverId] };
    },
  };
}

export function stubIdAllocator(prefix = 'fixture'): NpcBehaviorIdAllocator {
  let chains = 0;
  let nodes = 0;
  return {
    nextActionChainId: () => {
      chains += 1;
      return `runtime:action-chain:${prefix}-${chains}` as ActionChainId;
    },
    nextActionChainNodeId: () => {
      nodes += 1;
      return `runtime:action-chain-node:${prefix}-${nodes}` as ActionChainNodeId;
    },
  };
}

// ── Context / State ────────────────────────────────────────────────────────

export function makeContext(
  overrides: Partial<{
    worldDay: WorldDay;
    definitions: NpcBehaviorDefinitionReader;
    team: NpcBehaviorTeamPort;
    world: NpcBehaviorWorldPort;
    conditions: NpcBehaviorConditionPort;
    resolvers: NpcBehaviorResolverPort;
    ids: NpcBehaviorIdAllocator;
    rng: DeterministicRng;
    rngContext: RngContext;
  }> = {},
): NpcBehaviorContext {
  return {
    worldDay: overrides.worldDay ?? (100 as WorldDay),
    definitions: overrides.definitions ?? stubDefinitionReader(definitionsPackA()),
    team: overrides.team ?? stubTeamPort(),
    world: overrides.world ?? stubWorldPort(),
    conditions: overrides.conditions ?? stubConditionPort(),
    resolvers: overrides.resolvers ?? stubResolverPort(),
    ids: overrides.ids ?? stubIdAllocator(),
    rng: overrides.rng ?? stubRng(),
    rngContext: overrides.rngContext ?? stubRngContext(),
  };
}

// 一支已登記、可立刻抽選的 NPC 隊伍。
export function fixtureState(
  input: Partial<{
    policyId: AdventurerDecisionPolicyId;
    nextDecisionOnDay: WorldDay;
    teamId: TeamId;
  }> = {},
): NpcBehaviorState {
  return createNpcBehaviorState({
    controllers: [
      createController({
        teamId: input.teamId ?? FIXTURE.npcTeamId,
        policyId: input.policyId ?? FIXTURE.policyA,
        nextDecisionOnDay: input.nextDecisionOnDay ?? (100 as WorldDay),
      }),
    ],
  });
}

export const FIXTURE_ZERO_REVISION = 0 as Revision;
