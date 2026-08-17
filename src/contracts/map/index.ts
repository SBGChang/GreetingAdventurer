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
  NpcDungeonTargetResolverId,
  EncounterId,
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
      | Readonly<{ eligible: true; pointCost: number; resolverId: NpcDungeonTargetResolverId }>;
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
  npcResolverId?: NpcDungeonTargetResolverId;
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
  npcResolverId?: NpcDungeonTargetResolverId;
  // 玩家路徑的內容解析 Resolver。與 npcResolverId 對稱：NPC 側早就有，玩家側一直沒有，
  // 於是 dungeon 無資料可讀、只能填固定值。選填是因為資料尚未存在（正式 Content Pack 未建立，
  // 見 F4）——缺的時候 Handler 一律 typed rejection，**不得**代它挑一個預設 Resolver。
  playerResolverId?: ResolverId;
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
//
// 判別鍵是「**這筆結果由什麼產生**」，因為那決定了要附哪一種身分：
//   * contentResolver：玩家路徑。內容自己的解析 Resolver（MapContentInstance.playerResolverId）。
//   * npcTargetResolver：NPC 路徑。該筆結果由哪個 NPC 目標 Resolver Definition 產生。
//   * combatEncounter：內容由一場戰鬥解決（怪物組／Boss）。**沒有任何內容 Resolver 跑過**，
//     能指認的身分是那場遭遇本身。
//
// 原本是單一形狀 `{ resolverId: ResolverId | NpcDungeonTargetResolverId }`，於是第三種情形無從表達，
// dungeon 在戰鬥收斂時只好填一個寫死的 'resolver:dungeon-default'（規範 §5）。那不是隨手寫死：
// 型別逼著它交出一個它沒有的東西。聯集化之後三條路徑都能說實話，寫死的那個常數也就沒有存在理由。
export type MapContentResolution = Readonly<{
  outcome: 'success' | 'failure';
  details?: Readonly<Record<string, JsonValue>>;
}> &
  (
    | Readonly<{ kind: 'contentResolver'; resolverId: ResolverId }>
    | Readonly<{ kind: 'npcTargetResolver'; resolverId: NpcDungeonTargetResolverId }>
    | Readonly<{ kind: 'combatEncounter'; encounterId: EncounterId }>
  );

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
      resolverId: NpcDungeonTargetResolverId;
      contentId: ContentInstanceId;
    }>
  | Readonly<{
      kind: 'gatheringNode';
      npcOrder: number;
      pointCost: number;
      resolverId: NpcDungeonTargetResolverId;
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
  type: 'SetMapRefreshLock';
  mapId: MapInstanceId;
  mode: 'set' | 'release';
  reason?: RefreshLock['reason'];
  releaseOnDay?: WorldDay;
  sourceQuestId: QuestId;
}>;

export type ProtectMapContent = Readonly<{
  type: 'ProtectMapContent';
  contentId: ContentInstanceId;
  mode: 'protect' | 'release';
  questId: QuestId;
}>;

export type ResolvePlayerMapContent = Readonly<{
  type: 'ResolvePlayerMapContent';
  teamId: TeamId;
  mapId: MapInstanceId;
  contentId: ContentInstanceId;
  distributionId: AssetDistributionId;
  resolution: MapContentResolution;
}>;

export type ApplyNpcDungeonSettlement = Readonly<{
  type: 'ApplyNpcDungeonSettlement';
  runId: NpcDungeonRunId;
  mapId: MapInstanceId;
  mapVersion: number;
  distributionId: AssetDistributionId;
  pendingResults: readonly PendingDungeonResult[];
}>;

export type OpenMapDoor = Readonly<{
  type: 'OpenMapDoor';
  teamId: TeamId;
  mapId: MapInstanceId;
  mapVersion: number;
  linkId: RoomLinkId;
  openedOnDungeonMinute: DungeonMinute;
}>;

export type ResolveMapTrap = Readonly<{
  type: 'ResolveMapTrap';
  teamId: TeamId;
  mapId: MapInstanceId;
  mapVersion: number;
  trapId: FixedTrapId;
  resolution: MapTrapResolution;
  resolvedOnDungeonMinute: DungeonMinute;
}>;

export type HarvestMapGatheringNode = Readonly<{
  type: 'HarvestMapGatheringNode';
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
  type: 'MapRefreshed';
  mapId: MapInstanceId;
  oldVersion: number;
  newVersion: number;
}>;

export type MapContentGenerated = Readonly<{
  type: 'MapContentGenerated';
  mapId: MapInstanceId;
  mapVersion: number;
  contentIds: readonly ContentInstanceId[];
}>;

// `resolver` 欄位已移除：它是 `resolution` 的其中一個欄位的複本，而聯集化之後
// combatEncounter 那一支根本沒有 resolver 可複製。訂閱者請直接判別 `resolution.kind`。
export type MapContentResolved = Readonly<{
  type: 'MapContentResolved';
  mapId: MapInstanceId;
  contentId: ContentInstanceId;
  distributionId?: AssetDistributionId;
  resolution: MapContentResolution;
}>;

export type MapRefreshPendingRegistered = Readonly<{
  type: 'MapRefreshPendingRegistered';
  mapId: MapInstanceId;
  checkDay: WorldDay;
}>;

export type NpcDungeonSettlementApplied = Readonly<{
  type: 'NpcDungeonSettlementApplied';
  runId: NpcDungeonRunId;
  distributionId: AssetDistributionId;
  appliedResults: readonly PendingDungeonResult[];
  skippedResults: readonly PendingDungeonResult[];
}>;

export type MapRefreshLockChanged = Readonly<{
  type: 'MapRefreshLockChanged';
  mapId: MapInstanceId;
  lock?: RefreshLock;
}>;

export type MapDoorOpened = Readonly<{
  type: 'MapDoorOpened';
  mapId: MapInstanceId;
  mapVersion: number;
  linkId: RoomLinkId;
}>;

export type MapTrapResolved = Readonly<{
  type: 'MapTrapResolved';
  mapId: MapInstanceId;
  mapVersion: number;
  trapId: FixedTrapId;
  resolution: MapTrapResolution;
}>;

export type MapGatheringNodeHarvested = Readonly<{
  type: 'MapGatheringNodeHarvested';
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
