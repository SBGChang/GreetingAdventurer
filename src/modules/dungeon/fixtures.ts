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
  ContentEventDefinitionId,
  ContentEventOptionId,
  EffectDefinitionId,
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
  NpcDungeonTargetResolverId,
  EncounterGroupDefinitionId,
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
import type {
  CombatSequenceId,
  CombatSequenceChallengeId,
  CombatSequenceSourceCommitId,
  CombatSequenceSourceId,
  CombatSequenceRuleId,
} from '../../contracts/combat-sequence';
import type { CombatPowerRuleId } from '../../contracts/combat-power';

import type { DungeonModuleState } from './state';
import { createInitialDungeonState, withPlayerSession, createKnowledge, withKnowledge } from './state';
import type {
  DungeonContext,
  DungeonMapPort,
  DungeonTeamPort,
  DungeonCombatSequencePort,
} from './system';

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
  eventDefinitionId: 'definition:content-event:cave-shrine' as ContentEventDefinitionId,
  eventOptionId: 'template-local:content-event-option:pray' as ContentEventOptionId,
  eventEffectId: 'definition:effect:shrine-blessing' as EffectDefinitionId,

  // 控制／綁架內容與它們的守衛（01_map_module.md §3.2 的 controllerContentIds）。
  controlContentId: 'runtime:content-instance:control-1' as ContentInstanceId,
  kidnapContentId: 'runtime:content-instance:kidnap-1' as ContentInstanceId,
  guardContentId: 'runtime:content-instance:guard-1' as ContentInstanceId,

  // NPC 序列用的怪物內容（dungeonSweep Combat Sequence 的來源）。
  monsterContentA: 'runtime:content-instance:monster-a' as ContentInstanceId,
  monsterContentB: 'runtime:content-instance:monster-b' as ContentInstanceId,
  chestContentId: 'runtime:content-instance:chest-1' as ContentInstanceId,
  encounterGroupId: 'definition:encounter-group:cave-bats' as EncounterGroupDefinitionId,

  gatheringRulePlayer: 'definition:gathering-rule:herb' as GatheringRuleId,
  gatheringRuleNpc: 'definition:gathering-rule:npc' as GatheringRuleId,
  interactionRuleId: 'definition:interaction-rule:base' as InteractionRuleId,
  lootDistributionRuleId:
    'definition:asset-distribution-rule:dungeon-loot' as AssetDistributionRuleId,
  npcExplorationRuleId: 'definition:npc-exploration-rule:base' as NpcExplorationRuleId,
  resolverId: 'definition:npc-dungeon-target-resolver:dungeon' as NpcDungeonTargetResolverId,
  trapResolverId: 'resolver:trap' as ResolverId,
  // 玩家內容解析 Resolver。正式路徑由 MapContentInstance.playerResolverId 供給；
  // fixture 一律回這一筆，好讓「有資料」與「缺資料」兩種情形都測得到。
  contentResolverId: 'resolver:map-content' as ResolverId,
  explorationExperienceRuleId: 'definition:experience-award-rule:explore' as ExperienceAwardRuleId,

  combatSequenceRuleId: 'definition:combat-sequence-rule:base' as CombatSequenceRuleId,
  combatPowerRuleId: 'definition:combat-power-rule:base' as CombatPowerRuleId,
  combatSequenceSourceId: 'runtime:combat-sequence-source:cave' as CombatSequenceSourceId,
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
  // 小刻度，便於測試跨午夜（原本是 DungeonContext 上的 minutesPerDungeonDay）。
  minutesPerDungeonDay: 100,
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
  id: FIXTURE.resolverId,
  schemaVersion: 1,
  packId: PACK,
  enabled: true,
  // 預設同時支援兩種目標：怪物序列與採集序列都用得上同一個 fixture Resolver。
  // 要測「Resolver 不支援該目標種類」的案例自行覆寫成單一種類。
  supportedTargetKinds: [
    { kind: 'gatheringNode' },
    { kind: 'mapContent', contentKind: 'monsterGroup' },
  ],
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
    listContentEventOptionIds: (definitionId) => {
      if (definitionId === FIXTURE.eventDefinitionId) return [FIXTURE.eventOptionId];
      throw new Error(`fixture reader: unknown content event ${String(definitionId)}`);
    },
    getContentEventOption: (definitionId, optionId) => {
      if (definitionId !== FIXTURE.eventDefinitionId) {
        throw new Error(`fixture reader: unknown content event ${String(definitionId)}`);
      }
      if (optionId !== FIXTURE.eventOptionId) return undefined;
      // 預設一個帶效果的選項，讓「效果真的被派發」測得出來。
      return {
        optionId: FIXTURE.eventOptionId,
        visibilityConditionIds: [],
        eligibilityConditionIds: [],
        effectIds: [FIXTURE.eventEffectId],
      };
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

// fixture 的內容種類表（互動分支與「怪物才進戰鬥串」的判定都讀它）。
const contentKinds: Readonly<Record<string, MapContentKind>> = {
  [FIXTURE.eventContentId]: 'mapEvent',
  [FIXTURE.controlContentId]: 'control',
  [FIXTURE.kidnapContentId]: 'kidnap',
  [FIXTURE.guardContentId]: 'monsterGroup',
  [FIXTURE.monsterContentA]: 'monsterGroup',
  [FIXTURE.monsterContentB]: 'boss',
  [FIXTURE.chestContentId]: 'chest',
};

// fixture 內容都放在中間房 R2（互動前置：玩家須人在該房）。
const contentRooms: Readonly<Record<string, RoomId>> = Object.fromEntries(
  Object.keys(contentKinds).map((contentId) => [contentId, FIXTURE.roomMiddle]),
);

export function createFixtureMapPort(overrides?: Partial<DungeonMapPort>): DungeonMapPort {
  const base: DungeonMapPort = {
    getMapVersion: () => FIXTURE.mapVersion,
    getContentResolverId: () => FIXTURE.contentResolverId,
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
      contentKinds[contentId] ?? 'chest',
    isContentAvailable: () => true,
    getContentRoomId: (_mapId, contentId) => contentRooms[contentId],
    getContentRevision: () => 0 as Revision,
    getGatheringNodeRevision: () => 0 as Revision,
    // 控制／綁架各有一名守衛；其餘內容種類沒有守衛欄位（回 undefined，呼叫端必須拒絕）。
    listControllerContentIds: (_mapId, contentId) =>
      contentId === FIXTURE.controlContentId || contentId === FIXTURE.kidnapContentId
        ? [FIXTURE.guardContentId]
        : undefined,
    getEncounterGroupId: (_mapId, contentId) =>
      contentKinds[contentId] === 'monsterGroup' || contentKinds[contentId] === 'boss'
        ? FIXTURE.encounterGroupId
        : undefined,
    getContentEventInstance: (_mapId, _contentId) => ({
      instanceId: 'runtime:content-event-instance:evt-1' as never,
      // 必須與 createFixtureReader 的合法選項表同一筆定義，否則 resolveDungeonInteraction 會誤拒。
      definitionId: FIXTURE.eventDefinitionId,
      rngStreamId: 'rng-stream:evt-1' as RngStreamId,
    }),
    // 預設沒有陷阱房；測陷阱的案例自行覆寫這個 Port。
    listArmedTrapsInRoom: () => [],
    listNpcSequence: () => npcSequence,
    getExplorationCompletion: () => ({
      explorationKey: `${FIXTURE.mapId}:v${FIXTURE.mapVersion}`,
      experienceRuleId: FIXTURE.explorationExperienceRuleId,
    }),
  };
  return { ...base, ...overrides };
}

// ── NPC 怪物序列與 Combat Sequence 開始快照 stub ─────────────────────────────
// 含怪物內容的 NPC 序列（怪物 1 點、寶箱 1 點、Boss 4 點；doc §9.3 的成本樣式）。
// 預設序列刻意只有採集點，好讓「無怪物 → 不建立空 Sequence」是預設路徑；要測戰鬥串的案例
// 以 `listNpcSequence: () => monsterNpcSequence` 覆寫 Map Port。
export const monsterNpcSequence: readonly NpcSequenceEntryView[] = [
  {
    kind: 'mapContent',
    npcOrder: 0,
    pointCost: 1,
    resolverId: FIXTURE.resolverId,
    contentId: FIXTURE.monsterContentA,
  },
  {
    kind: 'mapContent',
    npcOrder: 1,
    pointCost: 1,
    resolverId: FIXTURE.resolverId,
    contentId: FIXTURE.chestContentId,
  },
  {
    kind: 'mapContent',
    npcOrder: 2,
    pointCost: 4,
    resolverId: FIXTURE.resolverId,
    contentId: FIXTURE.monsterContentB,
  },
];

// Combat Sequence 開始快照 Port 的 stub。正式路徑由 app/composition 的
// CombatSequenceSnapshotAssembler 供給（21_combat_sequence_module.md §3.2）。
export function createFixtureCombatSequencePort(
  overrides?: Partial<DungeonCombatSequencePort>,
): DungeonCombatSequencePort {
  const base: DungeonCombatSequencePort = {
    planDungeonSweep: (input) => ({
      source: {
        kind: 'dungeonSweep',
        sourceId: FIXTURE.combatSequenceSourceId,
        mapId: input.mapId,
        mapVersion: input.mapVersion,
      },
      ruleId: FIXTURE.combatSequenceRuleId,
      allocationSnapshot: {
        capturedOnDay: input.capturedOnDay,
        teamFormationRevision: 0 as Revision,
        teamPowerRevisionKey: 'fixture:team-power:v1',
        members: [],
      },
      teamPowerSnapshot: {
        teamId: input.teamId,
        participantCharacterIds: [...input.participantCharacterIds],
        combatPowerRuleId: FIXTURE.combatPowerRuleId,
        memberPowers: [],
        formationModifier: 1,
        totalPower: 120,
        sourceRevisionKey: 'fixture:team-power:v1',
      },
      challenges: input.monsters.map((monster, index) => ({
        challengeId: challengeIdFor(monster.contentId),
        order: index,
        encounterGroupId: monster.encounterGroupId,
        sourceRef: {
          kind: 'mapContent',
          mapId: input.mapId,
          mapVersion: input.mapVersion,
          contentId: monster.contentId,
          contentRevision: monster.contentRevision,
        },
        enemyPower: 60,
        enemyPowerRevisionKey: 'fixture:enemy-power:v1',
        attackExperienceBudget: 12,
        defenseExperienceBudget: 8,
      })),
    }),
  };
  return { ...base, ...overrides };
}

// 對照用的穩定 Challenge ID：測試要能由 contentId 推回 challengeId。
export function challengeIdFor(contentId: ContentInstanceId): CombatSequenceChallengeId {
  return `runtime:combat-sequence-challenge:${String(contentId)}` as CombatSequenceChallengeId;
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
  let sequenceCounter = 0;
  let commitCounter = 0;

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
    interactionRuleId: FIXTURE.interactionRuleId,
    lootDistributionRuleId: FIXTURE.lootDistributionRuleId,
    npcExplorationRuleId: FIXTURE.npcExplorationRuleId,
    // 預設全部成功、繼續探索——與先前寫死的 outcome:'success' 行為一致，讓既有測試不變；
    // 想測失敗路徑的測試自行覆寫這個 Port。
    resolvers: {
      resolveNpcTargetOutcome: () => ({ outcome: 'success' }),
      resolveTrap: () => ({ outcome: 'triggered' as const }),
    },
    combatSequence: createFixtureCombatSequencePort(),
    rng,
    nextInteractionId: () =>
      `runtime:interaction:gen-${(interactionCounter += 1)}` as InteractionId,
    nextKnowledgeId: () =>
      `runtime:player-map-knowledge:gen-${(knowledgeCounter += 1)}` as PlayerMapKnowledgeId,
    nextRunId: () => `runtime:npc-dungeon-run:gen-${(runCounter += 1)}` as NpcDungeonRunId,
    nextDistributionId: () =>
      `runtime:asset-distribution:gen-${(distributionCounter += 1)}` as AssetDistributionId,
    nextCombatSequenceId: () =>
      `runtime:combat-sequence:gen-${(sequenceCounter += 1)}` as CombatSequenceId,
    nextCombatSequenceSourceCommitId: () =>
      `runtime:combat-sequence-source-commit:gen-${(commitCounter += 1)}` as CombatSequenceSourceCommitId,
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
