// app/content/social-reader.ts
// SocialDefinitionReader 的真實實作：由 data-runtime 的 DefinitionRegistry 組出來
// （樣板見 dungeon-reader.ts —— 一個 kind 家族一個窄化 Reader，領域 getter 委派到對應的 `.get(id)`）。

import type {
  SocialDefinitionReader,
  SocialSystemDefinition,
  PlayerAffinityRuleDefinition,
  PlayerConversationRuleDefinition,
  NpcMarriageRuleDefinition,
} from '../../contracts/social';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名（本專案定義；內容作者以此標注每筆 definition 的 kind 欄位）。
// 與 contracts/core/ids.ts 的 brand tag 逐字對齊：
//   SocialSystemDefinitionId   = DefinitionId<'social-system'>
//   PlayerAffinityRuleId       = DefinitionId<'player-affinity-rule'>
//   PlayerConversationRuleId   = DefinitionId<'player-conversation-rule'>
//   NpcMarriageRuleId          = DefinitionId<'npc-marriage-rule'>
export const SOCIAL_DEFINITION_KINDS = {
  socialSystem: 'social-system',
  playerAffinityRule: 'player-affinity-rule',
  playerConversationRule: 'player-conversation-rule',
  npcMarriageRule: 'npc-marriage-rule',
} as const;

export function createSocialDefinitionReader(registry: DefinitionRegistry): SocialDefinitionReader {
  const system = narrowedDomainReader<SocialSystemDefinition>(
    registry,
    'reader:social.social-system',
    [SOCIAL_DEFINITION_KINDS.socialSystem],
  );
  const affinityRule = narrowedDomainReader<PlayerAffinityRuleDefinition>(
    registry,
    'reader:social.player-affinity-rule',
    [SOCIAL_DEFINITION_KINDS.playerAffinityRule],
  );
  const conversationRule = narrowedDomainReader<PlayerConversationRuleDefinition>(
    registry,
    'reader:social.player-conversation-rule',
    [SOCIAL_DEFINITION_KINDS.playerConversationRule],
  );
  const npcMarriageRule = narrowedDomainReader<NpcMarriageRuleDefinition>(
    registry,
    'reader:social.npc-marriage-rule',
    [SOCIAL_DEFINITION_KINDS.npcMarriageRule],
  );

  return {
    getSocialSystem: (id) => system.get(id),
    getPlayerAffinityRule: (id) => affinityRule.get(id),
    getPlayerConversationRule: (id) => conversationRule.get(id),
    getNpcMarriageRule: (id) => npcMarriageRule.get(id),
  };
}
