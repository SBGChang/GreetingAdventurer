// app/content/dungeon-reader.ts
// DungeonDefinitionReader 的真實實作：由 data-runtime 的 DefinitionRegistry 組出來（取代 dungeon
// fixtures 手刻的 createFixtureReader）。這是 data-runtime 的第一個真實消費者，也是其餘模組 reader
// 的樣板：一個 kind 家族一個窄化 Reader，領域 getter 委派到對應的 `.get(id)`。

import type { DefinitionId, GatheringRuleId } from '../../contracts/core';
import type {
  DungeonDefinitionReader,
  DungeonInteractionRuleDefinition,
  NpcDungeonTargetResolverDefinition,
  NpcExplorationRuleDefinition,
} from '../../contracts/dungeon';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名（本專案定義；內容作者以此標注每筆 definition 的 kind 欄位）。
export const DUNGEON_DEFINITION_KINDS = {
  interactionRule: 'dungeon-interaction-rule',
  npcExplorationRule: 'npc-exploration-rule',
  npcTargetResolver: 'npc-dungeon-target-resolver',
  gatheringRule: 'gathering-rule',
} as const;

// getGatheringInteractionView 只投影 gathering 定義的 dungeonInteractionMinutes（非完整定義）。
type GatheringRuleDungeonView = Readonly<{ dungeonInteractionMinutes: number }>;

export function createDungeonDefinitionReader(registry: DefinitionRegistry): DungeonDefinitionReader {
  const interaction = narrowedDomainReader<DungeonInteractionRuleDefinition>(
    registry,
    'reader:dungeon.interaction-rule',
    [DUNGEON_DEFINITION_KINDS.interactionRule],
  );
  const npcExploration = narrowedDomainReader<NpcExplorationRuleDefinition>(
    registry,
    'reader:dungeon.npc-exploration-rule',
    [DUNGEON_DEFINITION_KINDS.npcExplorationRule],
  );
  const npcResolver = narrowedDomainReader<NpcDungeonTargetResolverDefinition>(
    registry,
    'reader:dungeon.npc-target-resolver',
    [DUNGEON_DEFINITION_KINDS.npcTargetResolver],
  );
  const gathering = narrowedDomainReader<GatheringRuleDungeonView>(
    registry,
    'reader:dungeon.gathering-rule',
    [DUNGEON_DEFINITION_KINDS.gatheringRule],
  );

  return {
    getDungeonInteractionRule: (id) => interaction.get(id as unknown as DefinitionId),
    getNpcExplorationRule: (id) => npcExploration.get(id as unknown as DefinitionId),
    getNpcResolver: (id) => npcResolver.get(id as unknown as DefinitionId),
    getGatheringInteractionView: (id: GatheringRuleId) => {
      const view = gathering.get(id as unknown as DefinitionId);
      return { ruleId: id, dungeonInteractionMinutes: view.dungeonInteractionMinutes };
    },
  };
}
