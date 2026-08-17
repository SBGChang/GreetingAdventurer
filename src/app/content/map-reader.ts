// app/content/map-reader.ts
// MapDefinitionReader 的真實實作（由 data-runtime Registry 組出）。
// 4 個單純委派 + getGatheringMapView（投影：只取 gathering 定義的 npcPolicy，回傳 { ruleId, npcPolicy }）。

import type { DefinitionId } from '../../contracts/core';
import type {
  MapContentDefinition,
  MapDefinitionReader,
  MapSpawnRuleDefinition,
  MapTemplateDefinition,
  NpcSequenceRuleDefinition,
} from '../../contracts/map';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

export const MAP_DEFINITION_KINDS = {
  template: 'map-template',
  spawnRule: 'map-spawn-rule',
  npcSequenceRule: 'npc-sequence-rule',
  content: 'map-content',
  gatheringRule: 'map-gathering-rule',
} as const;

// getGatheringMapView 的回傳型別（含 npcPolicy 聯集）直接取自介面，避免重寫。
type GatheringMapView = ReturnType<MapDefinitionReader['getGatheringMapView']>;
type GatheringMapData = Pick<GatheringMapView, 'npcPolicy'>;

export function createMapDefinitionReader(registry: DefinitionRegistry): MapDefinitionReader {
  const template = narrowedDomainReader<MapTemplateDefinition>(registry, 'reader:map.template', [
    MAP_DEFINITION_KINDS.template,
  ]);
  const spawn = narrowedDomainReader<MapSpawnRuleDefinition>(registry, 'reader:map.spawn-rule', [
    MAP_DEFINITION_KINDS.spawnRule,
  ]);
  const npcSequence = narrowedDomainReader<NpcSequenceRuleDefinition>(registry, 'reader:map.npc-sequence-rule', [
    MAP_DEFINITION_KINDS.npcSequenceRule,
  ]);
  const content = narrowedDomainReader<MapContentDefinition>(registry, 'reader:map.content', [
    MAP_DEFINITION_KINDS.content,
  ]);
  const gathering = narrowedDomainReader<GatheringMapData>(registry, 'reader:map.gathering-rule', [
    MAP_DEFINITION_KINDS.gatheringRule,
  ]);

  return {
    getMapTemplate: (id) => template.get(id),
    getMapSpawnRule: (id) => spawn.get(id),
    getNpcSequenceRule: (id) => npcSequence.get(id),
    getContentDefinition: (id) => content.get(id),
    getGatheringMapView: (id) => ({
      ruleId: id,
      npcPolicy: gathering.get(id).npcPolicy,
    }),
  };
}
