// modules/social/queries.ts
// SocialQuery 在 Slice 快照上的純函式實作（對應 docs/00_core/architecture/23_social_module.md §3）。
//
// SocialQuery 只回答**玩家中心**的數值：它不宣稱兩名 NPC 彼此有多少好感，也不判斷 Team
// Membership、性別、年齡、婚姻或家教 Post 是否可建立——那些硬條件由對應 Workflow 查
// Team／Character／City。
//
// 兩件事在此明確表達：
//   1. 玩家主角自己沒有可用好感度。角色日後成為玩家主角時原值可保留作歷史，但所有 Query 必須
//      忽略它，不得把它解讀成自我好感（doc §1）。因此工廠需要「目前玩家主角是誰」。
//   2. Query 不推進世界狀態，因此只能用 deterministic Resolver（求婚判定與家教價格修正在
//      doc §2 本來就必須是 deterministic）。型別上以 SocialDeterministicResolverPort 表達。

import type { CharacterId, SocialSystemDefinitionId, WorldDay } from '../../contracts/core';
import type {
  SocialQuery,
  SocialDefinitionReader,
  PlayerProposalAffinityResult,
  PlayerConversationUsageView,
} from '../../contracts/social';

import type { SocialState } from './state';
import { completedCountForDay, tryGetAffinity } from './state';
import type { SocialDeterministicResolverPort } from './system';

export type SocialQueryDeps = Readonly<{
  definitions: SocialDefinitionReader;
  socialSystemDefinitionId: SocialSystemDefinitionId;
  resolvers: SocialDeterministicResolverPort;
  // 目前玩家主角。由 Composition 從 team Slice 的 TeamQuery.getPlayerControlledCharacterId() 取得；
  // Query 工廠吃快照，不自己再持有 team 查詢物件。
  playerCharacterId: CharacterId;
}>;

export function createSocialQuery(state: SocialState, deps: SocialQueryDeps): SocialQuery {
  // 玩家主角的殘留好感度記錄一律視為不存在（doc §1）。
  const usableAffinity = (adventurerId: CharacterId) =>
    adventurerId === deps.playerCharacterId ? undefined : tryGetAffinity(state, adventurerId);

  return {
    getPlayerAffinity(adventurerId: CharacterId): number | undefined {
      return usableAffinity(adventurerId)?.value;
    },

    getPlayerConversationUsage(
      playerCharacterId: CharacterId,
      worldDay: WorldDay,
    ): PlayerConversationUsageView {
      const system = deps.definitions.getSocialSystem(deps.socialSystemDefinitionId);
      const rule = deps.definitions.getPlayerConversationRule(system.playerConversationRuleId);
      const completedCount = completedCountForDay(state, playerCharacterId, worldDay);
      // 上限由 Rule 給定；剩餘數不得為負（例如 Rule 調小後讀到舊存檔的當日計數）。
      const remainingCount = Math.max(0, rule.maxCompletedPerDay - completedCount);
      return { playerCharacterId, worldDay, completedCount, remainingCount };
    },

    getPlayerProposalAffinityResult(
      adventurerId: CharacterId,
    ): PlayerProposalAffinityResult | undefined {
      const affinity = usableAffinity(adventurerId);
      if (affinity === undefined) return undefined;
      const rule = deps.definitions.getPlayerAffinityRule(affinity.ruleId);
      return {
        acceptedByAffinity: deps.resolvers.resolvePlayerProposalAcceptance({
          resolverId: rule.playerProposalAcceptanceResolverId,
          ruleId: affinity.ruleId,
          adventurerId,
          affinityValue: affinity.value,
        }),
        ruleId: affinity.ruleId,
      };
    },

    getHomeTutorPriceModifier(adventurerId: CharacterId): number | undefined {
      const affinity = usableAffinity(adventurerId);
      if (affinity === undefined) return undefined;
      const rule = deps.definitions.getPlayerAffinityRule(affinity.ruleId);
      return deps.resolvers.resolveHomeTutorPriceModifier({
        resolverId: rule.homeTutorPriceModifierResolverId,
        ruleId: affinity.ruleId,
        adventurerId,
        affinityValue: affinity.value,
      });
    },
  };
}
