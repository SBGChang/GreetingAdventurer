// domain-services/gathering/fixtures.ts
// 測試用 fixture。**正式路徑不得引用本檔**（門禁以檔名判定為測試專用）。
//
// 這裡的數值與素材 ID 是「假內容」：它們扮演未來 Content Pack 的角色，好讓純函式 Resolver
// 有東西可算。它們不得出現在 gathering.ts／gathering-reader.ts 裡。

import type {
  AssetDistributionId,
  CharacterId,
  ContentEventInstanceId,
  ContentPackId,
  EncounterId,
  ExperienceAwardRuleId,
  GatheringDestinationPolicyId,
  GatheringNodeId,
  GatheringResolutionId,
  GatheringRuleId,
  ItemDefinitionId,
  MapInstanceId,
  MasteryId,
  ResolverId,
  RngCursor,
  RngStreamId,
  Seed,
  TeamId,
} from '../../contracts/core';
import type {
  GatheringDestinationPolicyDefinition,
  GatheringResolutionRequest,
  GatheringResolverInput,
  GatheringRuleDefinition,
  GatheringSourceRef,
  MasteryLevel,
  RewardSourceId,
} from '../../contracts/gathering';

export const PACK_ID = 'content-pack:gathering-test' as ContentPackId;

export const FIXTURE = {
  packId: PACK_ID,
  worldSeed: 'seed:gathering-test' as Seed,
  teamId: 'runtime:team:alpha' as TeamId,
  resolutionId: 'runtime:gathering-resolution:1' as GatheringResolutionId,
  otherResolutionId: 'runtime:gathering-resolution:2' as GatheringResolutionId,
  mapId: 'runtime:map-instance:mist-valley' as MapInstanceId,
  nodeId: 'template-local:gathering-node:herb' as GatheringNodeId,
  contentEventInstanceId: 'runtime:content-event-instance:travel-1' as ContentEventInstanceId,
  encounterId: 'runtime:encounter:boar-1' as EncounterId,
  rewardSourceId: 'definition:reward-source:boar-drop' as RewardSourceId,

  ruleId: 'definition:gathering-rule:mist-herb' as GatheringRuleId,
  otherRuleId: 'definition:gathering-rule:bamboo-grove' as GatheringRuleId,
  masteryId: 'definition:mastery:gathering' as MasteryId,
  experienceAwardRuleId: 'definition:experience-award-rule:gathering-tier-1' as ExperienceAwardRuleId,
  yieldResolverId: 'gathering.weighted-pool' as ResolverId,
  npcResolverId: 'npc-dungeon.gathering-node' as ResolverId,

  sharedPolicyId: 'definition:gathering-destination-policy:shared' as GatheringDestinationPolicyId,
  perParticipantPolicyId:
    'definition:gathering-destination-policy:participant-bags' as GatheringDestinationPolicyId,
  distributionId: 'runtime:asset-distribution:dungeon-1' as AssetDistributionId,

  // 三名參與者，CharacterId 刻意讓「等級最高者」與「字典序最小者」不是同一人。
  charA: 'runtime:character:a-yun' as CharacterId,
  charB: 'runtime:character:b-shen' as CharacterId,
  charC: 'runtime:character:c-mo' as CharacterId,

  itemHerb: 'definition:item:common-herb' as ItemDefinitionId,
  itemBamboo: 'definition:item:mist-bamboo' as ItemDefinitionId,
  itemReed: 'definition:item:water-reed' as ItemDefinitionId,
  itemRoot: 'definition:item:red-ginseng' as ItemDefinitionId,
} as const;

export const BASE_STREAM_ID = `gathering:${String(FIXTURE.resolutionId)}` as RngStreamId;

export function baseRngContext(cursor = 0): Readonly<{
  worldSeed: Seed;
  streamId: RngStreamId;
  cursor: RngCursor;
}> {
  return {
    worldSeed: FIXTURE.worldSeed,
    streamId: BASE_STREAM_ID,
    cursor: cursor as RngCursor,
  };
}

// Lv.0～3 抽 1 種、Lv.4～7 抽 2 種、Lv.8 以上抽 3 種；數量 Lv.0～5 為 1，之後為 2。
export function gatheringRule(
  overrides: Partial<GatheringRuleDefinition> = {},
): GatheringRuleDefinition {
  return {
    id: FIXTURE.ruleId,
    schemaVersion: 1,
    packId: FIXTURE.packId,
    enabled: true,
    masteryId: FIXTURE.masteryId,
    sourceTier: 'I',
    yieldResolverId: FIXTURE.yieldResolverId,
    yieldParams: {
      distinctEntryCount: {
        entries: [
          { maxMasteryLevel: 3, value: 1 },
          { maxMasteryLevel: 7, value: 2 },
        ],
        aboveMaxValue: 3,
      },
      quantityPerEntry: {
        entries: [{ maxMasteryLevel: 5, value: 1 }],
        aboveMaxValue: 2,
      },
      pool: [
        { itemDefinitionId: FIXTURE.itemHerb, weight: 40 },
        { itemDefinitionId: FIXTURE.itemBamboo, weight: 30 },
        { itemDefinitionId: FIXTURE.itemReed, weight: 20 },
        { itemDefinitionId: FIXTURE.itemRoot, weight: 10 },
      ],
    },
    experienceAwardRuleId: FIXTURE.experienceAwardRuleId,
    dungeonInteractionMinutes: 15,
    npcPolicy: { eligible: true, pointCost: 1, resolverId: FIXTURE.npcResolverId },
    ...overrides,
  };
}

export function sharedResultPolicy(
  overrides: Partial<GatheringDestinationPolicyDefinition> = {},
): GatheringDestinationPolicyDefinition {
  return {
    id: FIXTURE.sharedPolicyId,
    schemaVersion: 1,
    packId: FIXTURE.packId,
    enabled: true,
    yieldScope: 'sharedResult',
    destinationKind: 'assetDistribution',
    ...overrides,
  };
}

export function perParticipantPolicy(
  overrides: Partial<GatheringDestinationPolicyDefinition> = {},
): GatheringDestinationPolicyDefinition {
  return {
    id: FIXTURE.perParticipantPolicyId,
    schemaVersion: 1,
    packId: FIXTURE.packId,
    enabled: true,
    yieldScope: 'perParticipant',
    destinationKind: 'participantCharacterBags',
    ...overrides,
  };
}

export function mapNodeSource(): GatheringSourceRef {
  return {
    kind: 'mapNode',
    mapId: FIXTURE.mapId,
    mapVersion: 1,
    nodeId: FIXTURE.nodeId,
  };
}

export function travelResourceSource(ruleId: GatheringRuleId = FIXTURE.ruleId): GatheringSourceRef {
  return {
    kind: 'travelResource',
    contentEventInstanceId: FIXTURE.contentEventInstanceId,
    gatheringRuleId: ruleId,
  };
}

export function enemyDropSource(ruleId: GatheringRuleId = FIXTURE.ruleId): GatheringSourceRef {
  return {
    kind: 'enemyDrop',
    encounterId: FIXTURE.encounterId,
    rewardSourceId: FIXTURE.rewardSourceId,
    gatheringRuleId: ruleId,
  };
}

// Host Workflow 的本地 DTO：預設地圖節點 → 共同成果收集。
export function resolutionRequest(
  overrides: Partial<GatheringResolutionRequest> = {},
): GatheringResolutionRequest {
  return {
    resolutionId: FIXTURE.resolutionId,
    source: mapNodeSource(),
    teamId: FIXTURE.teamId,
    participantCharacterIds: [FIXTURE.charC, FIXTURE.charA, FIXTURE.charB],
    destinationPolicyId: FIXTURE.sharedPolicyId,
    destination: { kind: 'assetDistribution', distributionId: FIXTURE.distributionId },
    ...overrides,
  };
}

// 預設：地圖節點來源 + 共同成果 + 三名參與者（B 最高級，A 與 C 同級用來釘穩定 tie-break）。
export function resolverInput(
  overrides: Partial<GatheringResolverInput> = {},
): GatheringResolverInput {
  const masteryLevels: Record<CharacterId, MasteryLevel> = {
    [FIXTURE.charA]: 4,
    [FIXTURE.charB]: 9,
    [FIXTURE.charC]: 4,
  };
  return {
    resolutionId: FIXTURE.resolutionId,
    source: mapNodeSource(),
    teamId: FIXTURE.teamId,
    participantCharacterIds: [FIXTURE.charC, FIXTURE.charA, FIXTURE.charB],
    rule: gatheringRule(),
    destinationPolicy: sharedResultPolicy(),
    masteryLevels,
    rngContext: baseRngContext(),
    ...overrides,
  };
}
