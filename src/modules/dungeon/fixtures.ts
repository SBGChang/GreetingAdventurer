// modules/dungeon/fixtures.ts
// 最小測試 Fixture（對應 docs/00_core/architecture/03_dungeon_module.md §9）：
// 一張小地圖（入口 R1 → R2 → 出口 R3、一道紅門、若干採集點與 NPC 序列）、一個已在探索的玩家
// Session，加上 DungeonDefinitionReader / Map / Team 讀 Port 的 stub 與可注入的 DungeonContext。
// 純資料／純函式，無外部依賴。

import type {
  ContentPackId,
  MapInstanceId,
  RoomId,
  RoomLinkId,
  GatheringNodeId,
  GatheringRuleId,
  ContentInstanceId,
  TeamId,
  CharacterId,
  TeamPlanId,
  InteractionId,
  PlayerMapKnowledgeId,
  NpcDungeonRunId,
  AssetDistributionId,
  ResolverId,
  InteractionRuleId,
  NpcExplorationRuleId,
  ExperienceAwardRuleId,
  WorldDay,
  Revision,
  DungeonMinute,
  RngContext,
  Seed,
  RngStreamId,
  RngCursor,
} from '../../contracts/core';
import type {
  DungeonDefinitionReader,
  DungeonInteractionRuleDefinition,
  NpcExplorationRuleDefinition,
  NpcDungeonTargetResolverDefinition,
  PlayerExplorationSession,
} from '../../contracts/dungeon';
import type { GridCell, MapContentKind, NpcSequenceEntryView } from '../../contracts/map';
import type { AssetDistributionRuleId } from '../../contracts/distribution';

import type { DungeonModuleState } from './state';
import { createInitialDungeonState, withPlayerSession, createKnowledge, withKnowledge } from './state';
import type { DungeonContext, DungeonMapPort, DungeonTeamPort } from './system';

const PACK = 'pack:dungeon-fixture' as ContentPackId;

// ── 固定 ID ────────────────────────────────────────────────────────────────
export const FIXTURE = {
  teamId: 'runtime:team:player' as TeamId,
  mapId: 'runtime:map-instance:cave' as MapInstanceId,
  mapVersion: 1,
  memberA: 'runtime:character:hero' as CharacterId,
  memberB: 'runtime:character:ally' as CharacterId,
  planId: 'runtime:team-plan:cave-run' as TeamPlanId,

  roomEntrance: 'template-local:room:r1' as RoomId,
  roomMiddle: 'template-local:room:r2' as RoomId,
  roomExit: 'template-local:room:r3' as RoomId,
  redDoorLink: 'template-local:room-link:red-2-3' as RoomLinkId,

  gatherNodePlayer: 'template-local:gathering-node:herb' as GatheringNodeId,
  npcNode0: 'template-local:gathering-node:npc0' as GatheringNodeId,
  npcNode1: 'template-local:gathering-node:npc1' as GatheringNodeId,
  npcNode2: 'template-local:gathering-node:npc2' as GatheringNodeId,

  eventContentId: 'runtime:content-instance:event-1' as ContentInstanceId,

  gatheringRulePlayer: 'definition:gathering-rule:herb' as GatheringRuleId,
  gatheringRuleNpc: 'definition:gathering-rule:npc' as GatheringRuleId,
  interactionRuleId: 'definition:interaction-rule:base' as InteractionRuleId,
  lootDistributionRuleId:
    'definition:asset-distribution-rule:dungeon-loot' as AssetDistributionRuleId,
  npcExplorationRuleId: 'definition:npc-exploration-rule:base' as NpcExplorationRuleId,
  resolverId: 'resolver:dungeon-target' as ResolverId,
  trapResolverId: 'resolver:trap' as ResolverId,
  explorationExperienceRuleId: 'definition:experience-award-rule:explore' as ExperienceAwardRuleId,
} as const;

const cell = (floor: number, row: number, col: number): GridCell => ({ floor, row, col });

const ENTRANCE_CELL = cell(0, 0, 0);
const MIDDLE_CELL = cell(0, 0, 2);
const EXIT_CELL = cell(0, 0, 4);

// ── DungeonDefinitionReader stub ────────────────────────────────────────────
const interactionRule: DungeonInteractionRuleDefinition = {
  id: FIXTURE.interactionRuleId,
  schemaVersion: 1,
  packId: PACK,
  enabled: true,
  traversalMinutesPerCell: 30, // 第一版為 30。
  redDoorOpenMinutes: 20,
  trapResolverId: FIXTURE.trapResolverId,
};

const npcExplorationRule: NpcExplorationRuleDefinition = {
  id: FIXTURE.npcExplorationRuleId,
  schemaVersion: 1,
  packId: PACK,
  enabled: true,
  dailyPointBudget: 10, // 第一版基礎資料為 10。
  stopPolicyId: 'definition:npc-stop-policy:first-failure' as never,
};

const npcResolver: NpcDungeonTargetResolverDefinition = {
  id: FIXTURE.resolverId as unknown as NpcDungeonTargetResolverDefinition['id'],
  schemaVersion: 1,
  packId: PACK,
  enabled: true,
  supportedTargetKinds: [{ kind: 'gatheringNode' }],
  outcomeRuleId: 'definition:outcome-rule:always-success' as never,
  successBehavior: 'continue',
};

export function createFixtureReader(): DungeonDefinitionReader {
  return {
    getNpcExplorationRule: (id) => {
      if (id === FIXTURE.npcExplorationRuleId) return npcExplorationRule;
      throw new Error(`fixture reader: unknown npc exploration rule ${String(id)}`);
    },
    getNpcResolver: (_id) => npcResolver,
    getDungeonInteractionRule: (id) => {
      if (id === FIXTURE.interactionRuleId) return interactionRule;
      throw new Error(`fixture reader: unknown interaction rule ${String(id)}`);
    },
    getGatheringInteractionView: (id) => {
      // 玩家採集 15 分鐘；其餘 10 分鐘（示例資料）。
      const minutes = id === FIXTURE.gatheringRulePlayer ? 15 : 10;
      return { ruleId: id, dungeonInteractionMinutes: minutes };
    },
  };
}

// ── Map 讀 Port stub ─────────────────────────────────────────────────────────
type Adjacency = Readonly<{ cells: number; entryCell: GridCell }>;

const adjacency: Record<string, Adjacency> = {
  [`${FIXTURE.roomEntrance}->${FIXTURE.roomMiddle}`]: { cells: 2, entryCell: MIDDLE_CELL },
  [`${FIXTURE.roomMiddle}->${FIXTURE.roomEntrance}`]: { cells: 2, entryCell: ENTRANCE_CELL },
  [`${FIXTURE.roomMiddle}->${FIXTURE.roomExit}`]: { cells: 2, entryCell: EXIT_CELL },
  [`${FIXTURE.roomExit}->${FIXTURE.roomMiddle}`]: { cells: 2, entryCell: MIDDLE_CELL },
};

const npcSequence: readonly NpcSequenceEntryView[] = [
  {
    kind: 'gatheringNode',
    npcOrder: 0,
    pointCost: 3,
    resolverId: FIXTURE.resolverId,
    nodeId: FIXTURE.npcNode0,
    gatheringRuleId: FIXTURE.gatheringRuleNpc,
    mapVersion: FIXTURE.mapVersion,
  },
  {
    kind: 'gatheringNode',
    npcOrder: 1,
    pointCost: 3,
    resolverId: FIXTURE.resolverId,
    nodeId: FIXTURE.npcNode1,
    gatheringRuleId: FIXTURE.gatheringRuleNpc,
    mapVersion: FIXTURE.mapVersion,
  },
  {
    kind: 'gatheringNode',
    npcOrder: 2,
    pointCost: 4,
    resolverId: FIXTURE.resolverId,
    nodeId: FIXTURE.npcNode2,
    gatheringRuleId: FIXTURE.gatheringRuleNpc,
    mapVersion: FIXTURE.mapVersion,
  },
];

export function createFixtureMapPort(overrides?: Partial<DungeonMapPort>): DungeonMapPort {
  const base: DungeonMapPort = {
    getMapVersion: () => FIXTURE.mapVersion,
    getEntranceRoom: () => ({ roomId: FIXTURE.roomEntrance, entryCell: ENTRANCE_CELL }),
    isExitRoom: (_mapId, roomId) => roomId === FIXTURE.roomExit,
    getRoomTraversal: (_mapId, fromRoomId, _fromEntryCell, toRoomId) =>
      adjacency[`${fromRoomId}->${toRoomId}`],
    getDoorLink: (_mapId, linkId) =>
      linkId === FIXTURE.redDoorLink
        ? { fromRoomId: FIXTURE.roomMiddle, toRoomId: FIXTURE.roomExit, kind: 'redDoor', state: 'closed' }
        : undefined,
    getGatheringNodeRuleId: (_mapId, nodeId) =>
      nodeId === FIXTURE.gatherNodePlayer ? FIXTURE.gatheringRulePlayer : FIXTURE.gatheringRuleNpc,
    isGatheringNodeAvailable: () => true,
    getContentKind: (_mapId, contentId): MapContentKind | undefined =>
      contentId === FIXTURE.eventContentId ? 'mapEvent' : 'chest',
    isContentAvailable: () => true,
    // fixture 內容都放在中間房 R2（互動前置：玩家須人在該房）。
    getContentRoomId: (_mapId, contentId) =>
      contentId === FIXTURE.eventContentId ? FIXTURE.roomMiddle : undefined,
    getEncounterGroupId: () => undefined,
    getContentEventInstance: (_mapId, _contentId) => ({
      instanceId: 'runtime:content-event-instance:evt-1' as never,
      definitionId: 'definition:content-event:cave-shrine' as never,
      rngStreamId: 'rng-stream:evt-1' as RngStreamId,
    }),
    listNpcSequence: () => npcSequence,
    getExplorationCompletion: () => ({
      explorationKey: `${FIXTURE.mapId}:v${FIXTURE.mapVersion}`,
      experienceRuleId: FIXTURE.explorationExperienceRuleId,
    }),
  };
  return { ...base, ...overrides };
}

// ── Team 讀 Port stub ─────────────────────────────────────────────────────────
export function createFixtureTeamPort(overrides?: Partial<DungeonTeamPort>): DungeonTeamPort {
  const base: DungeonTeamPort = {
    getAdventureMap: (teamId) => (teamId === FIXTURE.teamId ? FIXTURE.mapId : undefined),
    isTeamInMap: (_teamId, mapId) => mapId === FIXTURE.mapId,
    getMembers: () => [FIXTURE.memberA, FIXTURE.memberB],
  };
  return { ...base, ...overrides };
}

// ── DungeonContext（可注入的 ID 產生器 + 世界時鐘 + RNG）─────────────────────
export function createFixtureContext(overrides?: Partial<DungeonContext>): DungeonContext {
  let interactionCounter = 0;
  let knowledgeCounter = 0;
  let runCounter = 0;
  let distributionCounter = 0;

  const rng: RngContext = {
    worldSeed: 'seed:fixture' as Seed,
    streamId: 'rng-stream:dungeon-fixture' as RngStreamId,
    cursor: 0 as RngCursor,
  };

  const base: DungeonContext = {
    reader: createFixtureReader(),
    map: createFixtureMapPort(),
    team: createFixtureTeamPort(),
    worldDay: 1 as WorldDay,
    minutesPerDungeonDay: 100, // 小刻度，便於測試跨午夜。
    interactionRuleId: FIXTURE.interactionRuleId,
    lootDistributionRuleId: FIXTURE.lootDistributionRuleId,
    npcExplorationRuleId: FIXTURE.npcExplorationRuleId,
    rng,
    nextInteractionId: () =>
      `runtime:interaction:gen-${(interactionCounter += 1)}` as InteractionId,
    nextKnowledgeId: () =>
      `runtime:player-map-knowledge:gen-${(knowledgeCounter += 1)}` as PlayerMapKnowledgeId,
    nextRunId: () => `runtime:npc-dungeon-run:gen-${(runCounter += 1)}` as NpcDungeonRunId,
    nextDistributionId: () =>
      `runtime:asset-distribution:gen-${(distributionCounter += 1)}` as AssetDistributionId,
  };
  return { ...base, ...overrides };
}

// ── Seeded state：一名玩家隊伍在入口房間探索中（已揭露入口）───────────────────
export function createFixtureState(): DungeonModuleState {
  const session: PlayerExplorationSession = {
    teamId: FIXTURE.teamId,
    mapId: FIXTURE.mapId,
    mapVersion: FIXTURE.mapVersion,
    distributionId: 'runtime:asset-distribution:player-cave' as AssetDistributionId,
    currentRoomId: FIXTURE.roomEntrance,
    entryCell: ENTRANCE_CELL,
    elapsedDungeonMinutes: 0 as DungeonMinute,
    status: 'exploring',
    revision: 0 as Revision,
  };
  const knowledge = createKnowledge(
    'runtime:player-map-knowledge:cave' as PlayerMapKnowledgeId,
    FIXTURE.teamId,
    FIXTURE.mapId,
    FIXTURE.roomEntrance,
  );
  return withKnowledge(withPlayerSession(createInitialDungeonState(), session), knowledge);
}
