// modules/social/fixtures.ts
// 最小 Fixture：一組 Social 靜態定義（system / affinity rule / conversation rule / npc marriage rule）
// + 決定性 stub Port（SocialDefinitionReader / SocialTeamQuery / SocialResolverPort / SocialIdAllocator）
// + 一站式 SocialHandlerContext。
//
// 所有 stub 皆為決定性（無真 RNG、無時間、無 I/O）：需要「機率」的 Resolver 以顯式 cursor 的
// 純算術模擬，並回傳 nextCursor = cursor + 1，讓測試能同時驗「同 cursor 同結果」與「cursor 前進」。
//
// 本檔只供測試使用；正式路徑不得引用（門禁：scripts/verify-runtime-discipline.ts）。

import type {
  CharacterId,
  CityId,
  ContentPackId,
  ExperienceAwardRuleId,
  InteractionId,
  NpcMarriageRuleId,
  PlayerAffinityRuleId,
  PlayerConversationRuleId,
  PlayerConversationUsageId,
  ResolverId,
  RngContext,
  RngCursor,
  RngStreamId,
  Revision,
  Seed,
  SocialSystemDefinitionId,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type {
  SocialDefinitionReader,
  SocialSystemDefinition,
  PlayerAffinityRuleDefinition,
  PlayerConversationRuleDefinition,
  NpcMarriageRuleDefinition,
} from '../../contracts/social';
import type { TeamLocation } from '../../contracts/team';

import type { SocialState, PlayerConversationDailyUsage } from './state';
import { createSocialState } from './state';
import type {
  SocialHandlerContext,
  SocialIdAllocator,
  SocialResolverPort,
  SocialTeamQuery,
} from './system';

// ── ID 常數 ──────────────────────────────────────────────────────────────────

export const PACK_ID = 'pack-test' as ContentPackId;

export const SOCIAL_SYSTEM_ID = 'social-system-1' as SocialSystemDefinitionId;
export const AFFINITY_RULE_ID = 'affinity-rule-1' as PlayerAffinityRuleId;
export const AFFINITY_RULE_ALT_ID = 'affinity-rule-2' as PlayerAffinityRuleId;
export const CONVERSATION_RULE_ID = 'conversation-rule-1' as PlayerConversationRuleId;
export const NPC_MARRIAGE_RULE_ID = 'npc-marriage-rule-1' as NpcMarriageRuleId;
export const EXPERIENCE_AWARD_RULE_ID = 'exp-rule-social-1' as ExperienceAwardRuleId;

export const INITIAL_RESOLVER_ID = 'resolver:social.initial-affinity' as ResolverId;
export const DELTA_RESOLVER_ID = 'resolver:social.conversation-delta' as ResolverId;
export const PROPOSAL_RESOLVER_ID = 'resolver:social.proposal-acceptance' as ResolverId;
export const TUTOR_RESOLVER_ID = 'resolver:social.home-tutor-price' as ResolverId;
export const NPC_MARRIAGE_RESOLVER_ID = 'resolver:social.npc-marriage-chance' as ResolverId;

export const PLAYER_ID = 'char-player' as CharacterId;
export const MEMBER_ID = 'char-member' as CharacterId; // 玩家隊正式成員
export const TAVERN_ID = 'char-tavern' as CharacterId; // 同城酒館可見冒險者
export const STRANGER_ID = 'char-stranger' as CharacterId; // 既非隊友也不在酒館
export const UNPROVISIONED_ID = 'char-unprovisioned' as CharacterId;

export const TEAM_ID = 'team-player' as TeamId;
export const CITY_ID = 'city-1' as CityId;

export const WORLD_DAY = 10 as WorldDay;

// ── 靜態定義（fixture 值；正式內容由 Content Pack 供給）──────────────────────

const AFFINITY_MIN = -50;
const AFFINITY_MAX = 100;
const INITIAL_AFFINITY_BASE = 20;
const DELTA_PARTY_CHAT = 3;
const DELTA_TAVERN_CHAT = 1;
const PROPOSAL_THRESHOLD = 80;
const TUTOR_MODIFIER_BASE = 100;

export const SOCIAL_SYSTEM: SocialSystemDefinition = {
  id: SOCIAL_SYSTEM_ID,
  schemaVersion: 1,
  packId: PACK_ID,
  enabled: true,
  playerAffinityRuleId: AFFINITY_RULE_ID,
  playerConversationRuleId: CONVERSATION_RULE_ID,
};

export const AFFINITY_RULE: PlayerAffinityRuleDefinition = {
  id: AFFINITY_RULE_ID,
  schemaVersion: 1,
  packId: PACK_ID,
  enabled: true,
  minValue: AFFINITY_MIN,
  maxValue: AFFINITY_MAX,
  initialValueResolverId: INITIAL_RESOLVER_ID,
  conversationDeltaResolverId: DELTA_RESOLVER_ID,
  playerProposalAcceptanceResolverId: PROPOSAL_RESOLVER_ID,
  homeTutorPriceModifierResolverId: TUTOR_RESOLVER_ID,
};

export const CONVERSATION_RULE: PlayerConversationRuleDefinition = {
  id: CONVERSATION_RULE_ID,
  schemaVersion: 1,
  packId: PACK_ID,
  enabled: true,
  maxCompletedPerDay: 6,
  experienceAwardRuleId: EXPERIENCE_AWARD_RULE_ID,
};

export const NPC_MARRIAGE_RULE: NpcMarriageRuleDefinition = {
  id: NPC_MARRIAGE_RULE_ID,
  schemaVersion: 1,
  packId: PACK_ID,
  enabled: true,
  acceptanceChanceResolverId: NPC_MARRIAGE_RESOLVER_ID,
};

// ── stub Definition Reader（未知 id 明確拋錯，不靜默回預設定義）───────────────

export function stubDefinitionReader(
  overrides: Partial<SocialDefinitionReader> = {},
): SocialDefinitionReader {
  const base: SocialDefinitionReader = {
    getSocialSystem: (id) => {
      if (id !== SOCIAL_SYSTEM_ID) throw new Error(`fixture: unknown social system "${String(id)}"`);
      return SOCIAL_SYSTEM;
    },
    getPlayerAffinityRule: (id) => {
      if (id === AFFINITY_RULE_ID) return AFFINITY_RULE;
      if (id === AFFINITY_RULE_ALT_ID) return { ...AFFINITY_RULE, id: AFFINITY_RULE_ALT_ID };
      throw new Error(`fixture: unknown player affinity rule "${String(id)}"`);
    },
    getPlayerConversationRule: (id) => {
      if (id !== CONVERSATION_RULE_ID) {
        throw new Error(`fixture: unknown player conversation rule "${String(id)}"`);
      }
      return CONVERSATION_RULE;
    },
    getNpcMarriageRule: (id) => {
      if (id !== NPC_MARRIAGE_RULE_ID) {
        throw new Error(`fixture: unknown npc marriage rule "${String(id)}"`);
      }
      return NPC_MARRIAGE_RULE;
    },
  };
  return { ...base, ...overrides };
}

// ── stub Team Query（窄化消費 Port）──────────────────────────────────────────

export function stubTeamQuery(
  overrides: Readonly<{
    playerCharacterId?: CharacterId;
    playerTeamId?: TeamId;
    location?: TeamLocation;
    formalMembers?: readonly CharacterId[];
    tavernVisitors?: readonly CharacterId[];
  }> = {},
): SocialTeamQuery {
  const playerCharacterId = overrides.playerCharacterId ?? PLAYER_ID;
  const playerTeamId = overrides.playerTeamId ?? TEAM_ID;
  const location: TeamLocation = overrides.location ?? { kind: 'city', cityId: CITY_ID };
  const formalMembers = overrides.formalMembers ?? [PLAYER_ID, MEMBER_ID];
  const tavernVisitors = overrides.tavernVisitors ?? [TAVERN_ID];
  return {
    getPlayerTeamId: () => playerTeamId,
    getPlayerControlledCharacterId: () => playerCharacterId,
    getLocation: () => location,
    listFormalMembers: () => [...formalMembers],
    listTavernVisitorIds: (cityId) =>
      location.kind === 'city' && location.cityId === cityId ? [...tavernVisitors] : [],
  };
}

// ── stub Resolver Port（決定性；「機率」以顯式 cursor 的純算術模擬）──────────

function cursorOf(rngContext: RngContext | undefined): number {
  return rngContext === undefined ? 0 : rngContext.cursor;
}

function advance(rngContext: RngContext | undefined): RngCursor {
  return (cursorOf(rngContext) + 1) as RngCursor;
}

export function stubResolvers(
  overrides: Partial<SocialResolverPort> = {},
): SocialResolverPort {
  const base: SocialResolverPort = {
    // 初始好感度：基礎值 + cursor 的奇偶。同 cursor 同結果；不同 cursor 不同結果。
    resolveInitialAffinity: (input) => ({
      value: INITIAL_AFFINITY_BASE + (cursorOf(input.rngContext) % 2),
      nextCursor: advance(input.rngContext),
    }),
    // 交流變化量：依對話種類的基礎量 + cursor 的奇偶。
    resolveConversationDelta: (input) => ({
      value:
        (input.kind === 'partyChat' ? DELTA_PARTY_CHAT : DELTA_TAVERN_CHAT) +
        (cursorOf(input.rngContext) % 2),
      nextCursor: advance(input.rngContext),
    }),
    // 求婚判定：deterministic 門檻比較，完全不看 cursor。
    resolvePlayerProposalAcceptance: (input) => input.affinityValue >= PROPOSAL_THRESHOLD,
    // 家教價格修正：好感度越高越便宜。deterministic。
    resolveHomeTutorPriceModifier: (input) =>
      (TUTOR_MODIFIER_BASE - input.affinityValue) / TUTOR_MODIFIER_BASE,
  };
  return { ...base, ...overrides };
}

// ── stub ID 配發器（決定性遞增序號）─────────────────────────────────────────

export function stubIdAllocator(): SocialIdAllocator {
  let usageSeq = 0;
  let interactionSeq = 0;
  return {
    nextPlayerConversationUsageId: () => {
      usageSeq += 1;
      return `usage-${usageSeq}` as PlayerConversationUsageId;
    },
    nextInteractionId: () => {
      interactionSeq += 1;
      return `interaction-${interactionSeq}` as InteractionId;
    },
  };
}

export function fixtureRngContext(cursor: number): RngContext {
  return {
    worldSeed: 'seed-social' as Seed,
    streamId: 'stream:social' as RngStreamId,
    cursor: cursor as RngCursor,
  };
}

// ── State fixture ───────────────────────────────────────────────────────────

// 隊友與酒館冒險者各一筆已 provisioned 的好感度；玩家主角與 UNPROVISIONED_ID 沒有記錄。
export function fixtureSocialState(
  input: Readonly<{
    memberValue?: number;
    tavernValue?: number;
    strangerValue?: number;
    conversationUsage?: PlayerConversationDailyUsage;
  }> = {},
): SocialState {
  return createSocialState({
    affinities: [
      {
        adventurerId: MEMBER_ID,
        ruleId: AFFINITY_RULE_ID,
        value: input.memberValue ?? INITIAL_AFFINITY_BASE,
        revision: 0 as Revision,
      },
      {
        adventurerId: TAVERN_ID,
        ruleId: AFFINITY_RULE_ID,
        value: input.tavernValue ?? INITIAL_AFFINITY_BASE,
        revision: 0 as Revision,
      },
      {
        adventurerId: STRANGER_ID,
        ruleId: AFFINITY_RULE_ID,
        value: input.strangerValue ?? INITIAL_AFFINITY_BASE,
        revision: 0 as Revision,
      },
    ],
    ...(input.conversationUsage === undefined ? {} : { conversationUsage: input.conversationUsage }),
  });
}

export function fixtureUsage(
  input: Readonly<{
    playerCharacterId?: CharacterId;
    worldDay?: WorldDay;
    completedCount?: number;
    appliedInteractionIds?: readonly InteractionId[];
  }> = {},
): PlayerConversationDailyUsage {
  return {
    usageId: 'usage-fixture' as PlayerConversationUsageId,
    playerCharacterId: input.playerCharacterId ?? PLAYER_ID,
    worldDay: input.worldDay ?? WORLD_DAY,
    ruleId: CONVERSATION_RULE_ID,
    completedCount: input.completedCount ?? 0,
    appliedInteractionIds: input.appliedInteractionIds ?? [],
    revision: 0 as Revision,
  };
}

// ── 一站式 Handler Context ───────────────────────────────────────────────────

export function makeContext(
  overrides: Partial<SocialHandlerContext> = {},
): SocialHandlerContext {
  const base: SocialHandlerContext = {
    worldDay: WORLD_DAY,
    definitions: stubDefinitionReader(),
    socialSystemDefinitionId: SOCIAL_SYSTEM_ID,
    team: stubTeamQuery(),
    ids: stubIdAllocator(),
    resolvers: stubResolvers(),
  };
  return { ...base, ...overrides };
}

// fixture 常數的對外別名，供測試斷言用（避免測試重複寫死同一組數字）。
export const FIXTURE = {
  affinityMin: AFFINITY_MIN,
  affinityMax: AFFINITY_MAX,
  initialAffinityBase: INITIAL_AFFINITY_BASE,
  deltaPartyChat: DELTA_PARTY_CHAT,
  deltaTavernChat: DELTA_TAVERN_CHAT,
  proposalThreshold: PROPOSAL_THRESHOLD,
  tutorModifierBase: TUTOR_MODIFIER_BASE,
  maxCompletedPerDay: CONVERSATION_RULE.maxCompletedPerDay,
} as const;
