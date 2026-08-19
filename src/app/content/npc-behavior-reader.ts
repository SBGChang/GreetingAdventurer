// app/content/npc-behavior-reader.ts
// NpcBehaviorDefinitionReader 的真實實作：由 data-runtime 的 DefinitionRegistry 組出來。
// 樣板同 dungeon-reader.ts —— 一個 kind 家族一個窄化 Reader，領域 getter 委派到對應的 `.get(id)`。
//
// 這個 Reader 是「換一份 Content Pack 就換一套 NPC 行為」的入口：候選意圖、條件、權重 Resolver
// 的指向、動作串節點序列、市場規則、強制自由期長度、複審週期，全部從這裡讀出來。
// 未知 id 與跨 kind 存取一律由窄化 Reader 明確拋錯（不靜默回 undefined、不代填預設定義）。

import type {
  FreeActionRuleDefinition,
  NpcTravelRuleDefinition,
} from '../../contracts/team';
import type {
  ActionChainTemplateDefinition,
  AdventurerDecisionPolicyDefinition,
  NpcBehaviorDefinitionReader,
  NpcMarketPolicyDefinition,
} from '../../contracts/npc-behavior';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';
// free-action-rule / npc-travel-rule 的 kind 家族由 team 擁有；引用同一份常數，
// 避免兩個 Reader 對同一家族寫出兩個會漂移的字串。
import { TEAM_DEFINITION_KINDS } from './team-reader';

// Definition `kind` 命名（本專案定義；內容作者以此標注每筆 definition 的 kind 欄位）。
export const NPC_BEHAVIOR_DEFINITION_KINDS = {
  decisionPolicy: 'adventurer-decision-policy',
  actionChainTemplate: 'action-chain-template',
  marketPolicy: 'npc-market-policy',
  // 跨模組家族（team 擁有）。
  freeActionRule: TEAM_DEFINITION_KINDS.freeActionRule,
  npcTravelRule: TEAM_DEFINITION_KINDS.npcTravelRule,
} as const;

export function createNpcBehaviorDefinitionReader(
  registry: DefinitionRegistry,
): NpcBehaviorDefinitionReader {
  const decisionPolicy = narrowedDomainReader<AdventurerDecisionPolicyDefinition>(
    registry,
    'reader:npc-behavior.adventurer-decision-policy',
    [NPC_BEHAVIOR_DEFINITION_KINDS.decisionPolicy],
  );
  const chainTemplate = narrowedDomainReader<ActionChainTemplateDefinition>(
    registry,
    'reader:npc-behavior.action-chain-template',
    [NPC_BEHAVIOR_DEFINITION_KINDS.actionChainTemplate],
  );
  const marketPolicy = narrowedDomainReader<NpcMarketPolicyDefinition>(
    registry,
    'reader:npc-behavior.npc-market-policy',
    [NPC_BEHAVIOR_DEFINITION_KINDS.marketPolicy],
  );
  const freeActionRule = narrowedDomainReader<FreeActionRuleDefinition>(
    registry,
    'reader:npc-behavior.free-action-rule',
    [NPC_BEHAVIOR_DEFINITION_KINDS.freeActionRule],
  );
  const npcTravelRule = narrowedDomainReader<NpcTravelRuleDefinition>(
    registry,
    'reader:npc-behavior.npc-travel-rule',
    [NPC_BEHAVIOR_DEFINITION_KINDS.npcTravelRule],
  );

  return {
    getDecisionPolicy: (id) => decisionPolicy.get(id),
    getActionChainTemplate: (id) => chainTemplate.get(id),
    getMarketPolicy: (id) => marketPolicy.get(id),
    getFreeActionRule: (id) => freeActionRule.get(id),
    getNpcTravelRule: (id) => npcTravelRule.get(id),
  };
}
