// app/content/dungeon-reader.ts
// DungeonDefinitionReader 的真實實作：由 data-runtime 的 DefinitionRegistry 組出來（取代 dungeon
// fixtures 手刻的 createFixtureReader）。這是 data-runtime 的第一個真實消費者，也是其餘模組 reader
// 的樣板：一個 kind 家族一個窄化 Reader，領域 getter 委派到對應的 `.get(id)`。

import type {
  ContentEventOptionId,
  DefinitionId,
  GatheringRuleId,
} from '../../contracts/core';
import type {
  ContentEventDefinition,
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
  contentEvent: 'content-event',
} as const;

// getGatheringInteractionView 只投影 gathering 定義的 dungeonInteractionMinutes（非完整定義）。
type GatheringRuleDungeonView = Readonly<{ dungeonInteractionMinutes: number }>;

// 內容事件定義：直接用 contracts/core 的真型別，不再自己宣告一份投影。
//
// 這裡原本是 `{ options: { id: ContentEventOptionId }[] }`，而文件 §6.1 與契約用的欄位名是
// **optionId**。內容作者照文件寫，`option.id` 就是 undefined，`listContentEventOptionIds` 會回
// 一串 undefined——於是玩家送來的每一個 optionId 都被判為非法，事件永遠解不掉。兩邊各自「正確」
// 且各自綠燈，只有真資料進來才會發現。改成引用擁有者的型別，欄位名不可能再對不上。

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
  const contentEvent = narrowedDomainReader<ContentEventDefinition>(
    registry,
    'reader:dungeon.content-event',
    [DUNGEON_DEFINITION_KINDS.contentEvent],
  );

  return {
    getDungeonInteractionRule: (id) => interaction.get(id),
    getNpcExplorationRule: (id) => npcExploration.get(id),
    getNpcResolver: (id) => npcResolver.get(id),
    getGatheringInteractionView: (id: GatheringRuleId) => {
      const view = gathering.get(id);
      return { ruleId: id, dungeonInteractionMinutes: view.dungeonInteractionMinutes };
    },
    listContentEventOptionIds: (definitionId) =>
      contentEvent.get(definitionId).options.map((option) => option.optionId),
    getContentEventOption: (definitionId, optionId) =>
      contentEvent.get(definitionId).options.find((option) => option.optionId === optionId),
  };
}
