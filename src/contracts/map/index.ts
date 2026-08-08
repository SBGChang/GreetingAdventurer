// contracts/map — Map 模組公開契約（純型別）。
// 來源：docs/00_core/architecture/01_map_module.md（硬化後版）。
// 只包含對外契約：owned Definition、Runtime State/View、Query Port、ScheduledJob、
// Internal Command 與 DomainEvent payload。不含 Handler、Reducer 或任何邏輯。

import type {
  DefinitionHeader,
  DefinitionId,
  JsonValue,
  ModuleId,
  Revision,
  ScheduledJobBase,
  WorldDay,
  DungeonMinute,
  // ID 家族（全部來自 core）
  MapInstanceId,
  ContentInstanceId,
  MapTemplateId,
  MapSpawnRuleId,
  NpcSequenceRuleId,
  GatheringRuleId,
  ResolverId,
  RoomId,
  RoomLinkId,
  FixedTrapId,
  GatheringNodeId,
  TrapDefinitionId,
  ExperienceAwardRuleId,
  CultureContentRuleId,
  ChestPoolId,
  MapEventPoolId,
  AdventureSiteId,
  QuestId,
  TeamId,
  MapRefreshLockId,
  GatheringResolutionId,
  EncounterGroupDefinitionId,
  ItemInstanceId,
  ContentEventDefinitionId,
  CharacterArchetypeId,
  AssetDistributionId,
  NpcDungeonRunId,
} from '../core';

// 跨模組引用：NPC 地牢結算命令需引用 Dungeon 的暫存結果。
import type { PendingDungeonResult } from '../dungeon';

// ──────────────────────────────────────────────────────────────────────────
// 共用列舉／位置基元
// ──────────────────────────────────────────────────────────────────────────

// Map Content 的種類鍵；Dungeon 的 NPC 目標解析會跨模組引用此型別。
export type MapContentKind =
  | 'monsterGroup'
  | 'chest'
  | 'mapEvent'
  | 'kidnap'
  | 'control'
  | 'boss';

// [INVENTED] 文件以 GridCell 表示模板格座標但未給出結構；此處採 floor/row/col。
export type GridCell = Readonly<{ floor: number; row: number; col: number }>;

// [INVENTED] MapContentInstance.position 的結構；文件僅稱 MapPosition。
export type MapPosition = Readonly<{
  roomId: RoomId;
  cell?: GridCell;
}>;

// ──────────────────────────────────────────────────────────────────────────
// 2. 靜態資料契約（owned Definition）
// ──────────────────────────────────────────────────────────────────────────

// [INVENTED] MapTemplateDefinition.floors 元素；文件未給出 FloorDefinition 結構。
export type FloorDefinition = Readonly<{
  floor: number;
  rows: number;
  cols: number;
}>;

// [INVENTED] MapTemplateDefinition.rooms 元素；文件未給出 RoomDefinition 結構。
export type RoomDefinition = Readonly<{
  roomId: RoomId;
  floor: number;
  cells: readonly GridCell[];
}>;

export type RoomLinkDefinition = Readonly<{
  linkId: RoomLinkId;
  fromRoomId: RoomId;
  toRoomId: RoomId;
  fromCell: GridCell;
  toCell: GridCell;
  kind: 'passage' | 'redDoor';
  guardedPreferenceKinds?: ReadonlyArray<'chest' | 'event' | 'largeEnemy'>;
}>;

export type FixedTrapDefinition = Readonly<{
  trapId: FixedTrapId;
  roomId: RoomId;
  cell: GridCell;
  trapDefinitionId: TrapDefinitionId;
}>;

export type GatheringNodeDefinition = Readonly<{
  nodeId: GatheringNodeId;
  roomId: RoomId;
  cell: GridCell;
  gatheringRuleId: GatheringRuleId;
}>;

export type MapTemplateDefinition = DefinitionHeader &
  Readonly<{
    kind: 'outdoor' | 'interior';
    nationalDungeonForm?: 'outdoor' | 'subterranean' | 'building';
    refreshOffsetDays: number; // 0..13
    floors: readonly FloorDefinition[];
    rooms: readonly RoomDefinition[];
    links: readonly RoomLinkDefinition[];
    fixedTraps: readonly FixedTrapDefinition[];
    gatheringNodes: readonly GatheringNodeDefinition[];
    entranceRoomIds: readonly RoomId[];
    exitRoomIds: readonly RoomId[]; // 合計 1..3
    spawnRuleId: MapSpawnRuleId;
    explorationExperienceRuleId: ExperienceAwardRuleId;
  }>;

// [INVENTED] MapSpawnRuleDefinition.spawnBudgets 元素；文件未給出 SpawnBudgetDefinition 結構。
export type SpawnBudgetDefinition = Readonly<{
  contentKind: MapContentKind;
  minCount: number;
  maxCount: number;
}>;

export type MapSpawnRuleDefinition = DefinitionHeader &
  Readonly<{
    localCultureContentRuleId: CultureContentRuleId;
    humanCultureContentRuleId: CultureContentRuleId;
    chestPoolId: ChestPoolId;
    mapEventPoolId: MapEventPoolId;
    spawnBudgets: readonly SpawnBudgetDefinition[];
    npcSequenceRuleId: NpcSequenceRuleId;
  }>;

// [INVENTED] MapDefinitionReader.getNpcSequenceRule 的回傳型別；文件未給出結構。
export type NpcSequenceRuleDefinition = DefinitionHeader &
  Readonly<{
    npcSequenceRuleId: NpcSequenceRuleId;
  }>;

// [INVENTED] MapDefinitionReader.getContentDefinition 的回傳型別；文件僅以標頭描述。
export type MapContentDefinition = DefinitionHeader &
  Readonly<{
    contentKind: MapContentKind;
  }>;

export interface MapDefinitionReader {
  getMapTemplate(id: MapTemplateId): MapTemplateDefinition;
  getMapSpawnRule(id: MapSpawnRuleId): MapSpawnRuleDefinition;
  getNpcSequenceRule(id: NpcSequenceRuleId): NpcSequenceRuleDefinition;
  getContentDefinition(id: DefinitionId): MapContentDefinition;
  getGatheringMapView(id: GatheringRuleId): Readonly<{
    ruleId: GatheringRuleId;
    npcPolicy?:
      | Readonly<{ eligible: false }>
      | Readonly<{ eligible: true; pointCost: number; resolverId: ResolverId }>;
  }>;
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Runtime State（Map 唯一可寫）
// ──────────────────────────────────────────────────────────────────────────

export type RefreshLock = Readonly<{
  lockId: MapRefreshLockId;
  reason: 'suppression' | 'hunt';
  releaseOnDay: WorldDay;
  sourceQuestId: QuestId;
}>;

export type DoorRuntimeState = Readonly<{
  linkId: RoomLinkId;
  mapVersion: number;
  state: 'closed' | 'open';
  openedOnDungeonMinute?: DungeonMinute;
  revision: Revision;
}>;

export type TrapRuntimeState = Readonly<{
  trapId: FixedTrapId;
  mapVersion: number;
  state: 'armed' | 'triggered' | 'disarmed';
  resolvedOnDungeonMinute?: DungeonMinute;
  revision: Revision;
}>;

export type GatheringNodeRuntimeState = Readonly<{
  nodeId: GatheringNodeId;
  mapVersion: number;
  state: 'available' | 'harvested';
  npcOrder?: number;
  npcPointCost?: number;
  npcResolverId?: ResolverId;
  harvestResolutionId?: GatheringResolutionId;
  harvestedByTeamId?: TeamId;
  harvestedOnDay?: WorldDay;
  harvestedOnDungeonMinute?: DungeonMinute;
  revision: Revision;
}>;

export type MapSpatialRuntime = Readonly<{
  mapVersion: number;
  doorStates: Readonly<Record<RoomLinkId, DoorRuntimeState>>;
  trapStates: Readonly<Record<FixedTrapId, TrapRuntimeState>>;
  gatheringNodeStates: Readonly<Record<GatheringNodeId, GatheringNodeRuntimeState>>;
}>;

export type MapInstance = Readonly<{
  mapId: MapInstanceId;
  adventureSiteId: AdventureSiteId;
  templateId: MapTemplateId;
  currentVersion: number;
  refresh: Readonly<{
    offsetDays: number;
    pendingSinceDay?: WorldDay;
    pendingCheckScheduledFor?: WorldDay;
    refreshLock?: RefreshLock;
    lastRefreshedOnDay?: WorldDay;
  }>;
  spatialRuntime: MapSpatialRuntime;
  revision: Revision;
}>;

export type MapContentPayload =
  | Readonly<{ kind: 'monsterGroup' | 'boss'; encounterGroupId: EncounterGroupDefinitionId }>
  | Readonly<{ kind: 'chest'; itemIds: readonly ItemInstanceId[] }>
  | Readonly<{ kind: 'mapEvent'; contentEventDefinitionId: ContentEventDefinitionId }>
  | Readonly<{
      kind: 'kidnap';
      captiveArchetypeId: CharacterArchetypeId;
      controllerContentIds: readonly ContentInstanceId[];
    }>
  | Readonly<{ kind: 'control'; controllerContentIds: readonly ContentInstanceId[] }>;

export type MapContentInstance = Readonly<{
  contentId: ContentInstanceId;
  mapId: MapInstanceId;
  mapVersion: number;
  kind: MapContentKind;
  definitionId: DefinitionId;
  position: MapPosition;
  payload: MapContentPayload;
  npcOrder?: number;
  npcPointCost?: number;
  npcResolverId?: ResolverId;
  state: 'available' | 'resolved' | 'removedByRefresh';
  protectedByQuestIds: readonly QuestId[];
  resolvedOnDay?: WorldDay;
  revision: Revision;
}>;

export type MapState = Readonly<{
  instances: Readonly<Record<MapInstanceId, MapInstance>>;
  contents: Readonly<Record<ContentInstanceId, MapContentInstance>>;
  contentIdsByMap: Readonly<Record<MapInstanceId, readonly ContentInstanceId[]>>;
}>;

// ──────────────────────────────────────────────────────────────────────────
// 內容處理 Resolution（Command/Event 共用）
// ──────────────────────────────────────────────────────────────────────────

// [INVENTED] 文件以 `resolution`/`resolver` 描述內容處理結果但未給出結構。
export type MapContentResolution = Readonly<{
  resolverId: ResolverId;
  outcome: 'success' | 'failure';
  details?: Readonly<Record<string, JsonValue>>;
}>;

// [INVENTED] 固定陷阱處理結果的結構；文件僅稱 `resolution`。
export type MapTrapResolution = Readonly<{
  outcome: 'triggered' | 'disarmed';
  details?: Readonly<Record<string, JsonValue>>;
}>;

// ──────────────────────────────────────────────────────────────────────────
// 4. 公開 Query
// ──────────────────────────────────────────────────────────────────────────

// View 為 Runtime State 的唯讀對外投影；第一版與底層 State 同構。
export type MapInstanceView = MapInstance;
export type MapSpatialSnapshotView = MapSpatialRuntime;
export type MapContentView = MapContentInstance;
export type DoorRuntimeStateView = DoorRuntimeState;
export type TrapRuntimeStateView = TrapRuntimeState;
export type GatheringNodeRuntimeStateView = GatheringNodeRuntimeState;

export type NpcSequenceEntryView =
  | Readonly<{
      kind: 'mapContent';
      npcOrder: number;
      pointCost: number;
      resolverId: ResolverId;
      contentId: ContentInstanceId;
    }>
  | Readonly<{
      kind: 'gatheringNode';
      npcOrder: number;
      pointCost: number;
      resolverId: ResolverId;
      nodeId: GatheringNodeId;
      gatheringRuleId: GatheringRuleId;
      mapVersion: number;
    }>;

export interface MapQuery {
  getMapInstance(mapId: MapInstanceId): MapInstanceView;
  getMapSpatialSnapshot(mapId: MapInstanceId): MapSpatialSnapshotView;
  getContent(contentId: ContentInstanceId): MapContentView | undefined;
  listAvailableContent(mapId: MapInstanceId): MapContentView[];
  listNpcSequence(mapId: MapInstanceId): NpcSequenceEntryView[];
  getDoorState(mapId: MapInstanceId, linkId: RoomLinkId): DoorRuntimeStateView;
  getTrapState(mapId: MapInstanceId, trapId: FixedTrapId): TrapRuntimeStateView;
  getGatheringNodeState(mapId: MapInstanceId, nodeId: GatheringNodeId): GatheringNodeRuntimeStateView;
  listAvailableGatheringNodes(mapId: MapInstanceId): GatheringNodeRuntimeStateView[];
  isContentAvailable(contentId: ContentInstanceId): boolean;
  isRefreshLocked(mapId: MapInstanceId, onDay: WorldDay): boolean;
}

export interface TeamPresenceQuery {
  countTeamsInside(mapId: MapInstanceId): number;
  isTeamInside(mapId: MapInstanceId, teamId: TeamId): boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// 5.1 ScheduledJob
// ──────────────────────────────────────────────────────────────────────────

export type MapRefreshCheckJob = ScheduledJobBase<
  'mapRefreshCheck',
  ModuleId<'map'>,
  MapInstanceId,
  Readonly<{ reason: 'regular' | 'pending' }>
>;

export type MapScheduledJob = MapRefreshCheckJob;

// ──────────────────────────────────────────────────────────────────────────
// 5.2 Internal Command（Map 為唯一 Handler）
// ──────────────────────────────────────────────────────────────────────────

// [INFERRED] 欄位由 §5.2 與 §3.1 RefreshLock 推導。
export type SetMapRefreshLock = Readonly<{
  kind: 'SetMapRefreshLock';
  mapId: MapInstanceId;
  mode: 'set' | 'release';
  reason?: RefreshLock['reason'];
  releaseOnDay?: WorldDay;
  sourceQuestId: QuestId;
}>;

export type ProtectMapContent = Readonly<{
  kind: 'ProtectMapContent';
  contentId: ContentInstanceId;
  mode: 'protect' | 'release';
  questId: QuestId;
}>;

export type ResolvePlayerMapContent = Readonly<{
  kind: 'ResolvePlayerMapContent';
  teamId: TeamId;
  mapId: MapInstanceId;
  contentId: ContentInstanceId;
  distributionId: AssetDistributionId;
  resolution: MapContentResolution;
}>;

export type ApplyNpcDungeonSettlement = Readonly<{
  kind: 'ApplyNpcDungeonSettlement';
  runId: NpcDungeonRunId;
  mapId: MapInstanceId;
  mapVersion: number;
  distributionId: AssetDistributionId;
  pendingResults: readonly PendingDungeonResult[];
}>;

export type OpenMapDoor = Readonly<{
  kind: 'OpenMapDoor';
  teamId: TeamId;
  mapId: MapInstanceId;
  mapVersion: number;
  linkId: RoomLinkId;
  openedOnDungeonMinute: DungeonMinute;
}>;

export type ResolveMapTrap = Readonly<{
  kind: 'ResolveMapTrap';
  teamId: TeamId;
  mapId: MapInstanceId;
  mapVersion: number;
  trapId: FixedTrapId;
  resolution: MapTrapResolution;
  resolvedOnDungeonMinute: DungeonMinute;
}>;

export type HarvestMapGatheringNode = Readonly<{
  kind: 'HarvestMapGatheringNode';
  teamId: TeamId;
  mapId: MapInstanceId;
  mapVersion: number;
  nodeId: GatheringNodeId;
  resolutionId: GatheringResolutionId;
  harvestedOnDungeonMinute?: DungeonMinute;
}>;

export type MapInternalCommand =
  | SetMapRefreshLock
  | ProtectMapContent
  | ResolvePlayerMapContent
  | ApplyNpcDungeonSettlement
  | OpenMapDoor
  | ResolveMapTrap
  | HarvestMapGatheringNode;

// ──────────────────────────────────────────────────────────────────────────
// 6. 輸出 DomainEvent（最少 payload）
// ──────────────────────────────────────────────────────────────────────────

export type MapRefreshed = Readonly<{
  kind: 'MapRefreshed';
  mapId: MapInstanceId;
  oldVersion: number;
  newVersion: number;
}>;

export type MapContentGenerated = Readonly<{
  kind: 'MapContentGenerated';
  mapId: MapInstanceId;
  mapVersion: number;
  contentIds: readonly ContentInstanceId[];
}>;

export type MapContentResolved = Readonly<{
  kind: 'MapContentResolved';
  mapId: MapInstanceId;
  contentId: ContentInstanceId;
  distributionId?: AssetDistributionId;
  resolver: ResolverId;
  resolution: MapContentResolution;
}>;

export type MapRefreshPendingRegistered = Readonly<{
  kind: 'MapRefreshPendingRegistered';
  mapId: MapInstanceId;
  checkDay: WorldDay;
}>;

export type NpcDungeonSettlementApplied = Readonly<{
  kind: 'NpcDungeonSettlementApplied';
  runId: NpcDungeonRunId;
  distributionId: AssetDistributionId;
  appliedResults: readonly PendingDungeonResult[];
  skippedResults: readonly PendingDungeonResult[];
}>;

export type MapRefreshLockChanged = Readonly<{
  kind: 'MapRefreshLockChanged';
  mapId: MapInstanceId;
  lock?: RefreshLock;
}>;

export type MapDoorOpened = Readonly<{
  kind: 'MapDoorOpened';
  mapId: MapInstanceId;
  mapVersion: number;
  linkId: RoomLinkId;
}>;

export type MapTrapResolved = Readonly<{
  kind: 'MapTrapResolved';
  mapId: MapInstanceId;
  mapVersion: number;
  trapId: FixedTrapId;
  resolution: MapTrapResolution;
}>;

export type MapGatheringNodeHarvested = Readonly<{
  kind: 'MapGatheringNodeHarvested';
  mapId: MapInstanceId;
  mapVersion: number;
  nodeId: GatheringNodeId;
  teamId: TeamId;
  resolutionId: GatheringResolutionId;
}>;

export type MapDomainEvent =
  | MapRefreshed
  | MapContentGenerated
  | MapContentResolved
  | MapRefreshPendingRegistered
  | NpcDungeonSettlementApplied
  | MapRefreshLockChanged
  | MapDoorOpened
  | MapTrapResolved
  | MapGatheringNodeHarvested;
