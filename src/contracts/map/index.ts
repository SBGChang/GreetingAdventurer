// contracts/map — Map 模組公開契約（純型別）。
// 來源：docs/00_core/architecture/01_map_module.md（硬化後版）。
// 只包含對外契約：owned Definition、Runtime State/View、Query Port、ScheduledJob、
// Internal Command 與 DomainEvent payload。不含 Handler、Reducer 或任何邏輯。

import type {
  DefinitionHeader,
  DefinitionId,
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
  CultureId,
  ItemInstanceId,
  ContentEventDefinitionId,
  ContentEventInstanceId,
  RngStreamId,
  CharacterArchetypeId,
  AssetDistributionId,
  NpcDungeonRunId,
  NpcDungeonTargetResolverId,
  EncounterId,
} from '../core';

// 跨模組引用：NPC 地牢結算命令需引用 Dungeon 的暫存結果。
import type { PendingDungeonResult } from '../dungeon';
// 文化內容池的候選分類直接引用 combat 擁有的怪物分級型別（不另行複寫字面聯集）。
import type { MonsterSpeciesKind, MonsterThreatRank } from '../combat';

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

// 格座標（01_map_module.md §2.1）。樓層是座標的一部分，所以「上下樓梯使用相同的列、行座標」
// 可直接以兩個 GridCell 的 row/col 相等驗證。
export type GridCell = Readonly<{ floor: number; row: number; col: number }>;

// 內容位置（01_map_module.md §2.1）。`cell` 選填且只負責圖示與小地圖對齊，不建立房內移動節點
// ——移動節點的粒度是房間。
export type MapPosition = Readonly<{
  roomId: RoomId;
  cell?: GridCell;
}>;

// ──────────────────────────────────────────────────────────────────────────
// 2. 靜態資料契約（owned Definition）
// ──────────────────────────────────────────────────────────────────────────

// 樓層尺寸（01_map_module.md §2.1）。實際值由地圖種類決定，驗證器依 kind／nationalDungeonForm 比對。
export type FloorDefinition = Readonly<{
  floor: number;
  rows: number;
  cols: number;
}>;

// 房間（01_map_module.md §2.1）。一個房間是**一個移動節點**，可由多格構成（L／T／凹形）；
// cells 必須彼此相連，否則兩塊不相連的空間會變成同一個零成本節點。
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

// 領域變體放 `templateKind` 而非 `kind`：`kind` 是 Content Pack 的**家族宣告**，窄化 Reader 以它
// 判斷所有權（本型別的 registry kind 是 `'map-template'`）。一筆 JSON 只有一個 `kind`，不可能同時是
// `'map-template'` 與 `'outdoor'`——內容一接上就一筆也讀不到。正確樣式見 EquipmentDefinition
// （`kind: 'equipment'` + `equipmentKind`）。由 verify:discipline 的檢查 7 自動把關。
export type MapTemplateDefinition = DefinitionHeader &
  Readonly<{
    templateKind: 'outdoor' | 'interior';
    nationalDungeonForm?: 'outdoor' | 'subterranean' | 'building';
    refreshCadenceDays: number;
    refreshOffsetDays: number;
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

// 生成數量區間（01_map_module.md §2.2）。只決定「幾個」，候選池由 culture／chest／event Rule 決定。
export type SpawnBudgetDefinition = Readonly<{
  contentKind: MapContentKind;
  minCount: number;
  maxCount: number;
}>;

// 內容分級。`yunhua_content.md` §7.2 用「Tier I／Tier II」分組怪物、§7.4 給每張圖一個 Tier，
// 並明文「地圖只限制 Tier、威脅、體型與槽位」。先前契約沒有這個欄位，於是分級只能靠
// `experienceProfileId` 的 local 名（`tier1-normal`…）間接表達——那是從 ID 字串反推內容分類，
// 規範明文禁止。這裡把它補成正式欄位（§7 的 Schema 補齊）。
export type ContentTier = 1 | 2;

// 文化內容池（`yunhua_content.md` §7.2／§7.3）。
//
// 它是**地圖挑遭遇時的候選目錄**：地圖不擁有怪種名單（§4「不建立地圖專屬怪種 Pool」），
// 只宣告槽位與 Tier；實際可選的怪由文化池提供，而人類池會在該地區被他國佔領時整池替換
//（§7.3），所以人類與非人類是兩筆獨立的池。
//
// 每一筆候選自帶 `tier` 與 `threatRank`：這張表就是「挑選用的索引」，自帶分類才能讓 Resolver
// 只讀這一個 Reader 就選得出來，不必回頭去讀每隻怪的定義（跨模組讀取）。兩者與 encounter group
// 成員的實際分級是否一致，由內容驗證器交叉比對，不由 Resolver 執行期推論。
export type CultureContentCandidate = Readonly<{
  encounterGroupId: EncounterGroupDefinitionId;
  tier: ContentTier;
  threatRank: MonsterThreatRank;
}>;

export type CultureContentRuleDefinition = DefinitionHeader<CultureContentRuleId> &
  Readonly<{
    cultureId: CultureId;
    speciesKind: MonsterSpeciesKind;
    candidates: readonly CultureContentCandidate[];
  }>;

export type MapSpawnRuleDefinition = DefinitionHeader &
  Readonly<{
    // 這張圖允許出現的最高內容分級（§7.4 逐圖給定）。Resolver 只從 tier ≤ 此值的候選裡挑。
    contentTier: ContentTier;
    localCultureContentRuleId: CultureContentRuleId;
    humanCultureContentRuleId: CultureContentRuleId;
    chestPoolId: ChestPoolId;
    mapEventPoolId: MapEventPoolId;
    spawnBudgets: readonly SpawnBudgetDefinition[];
    npcSequenceRuleId: NpcSequenceRuleId;
  }>;

// ── NPC 探索序列規則（01_map_module.md §2.2／§2.3；本輪【裁定 B】定形）───────────
//
// NPC 序列的「目標家族」鍵。動態 Map Content 依 `contentKind` 分家族，固定採集點自成一族——
// 兩者共用**同一條** `npcOrder` 序列（doc §2.2 末條、§3.3 不變量 4），所以排序權重必須住在
// 同一張表裡，否則「誰先誰後」根本無處表達。
export type NpcSequenceGroupKey = MapContentKind | 'gatheringNode';

// 【裁定 B】`NpcSequenceRuleDefinition` 原本是 `DefinitionHeader & { npcSequenceRuleId }`
// ——唯一的欄位還與 `DefinitionHeader.id` 重複，等於一張空表。後果是：`getNpcSequenceRule`
// 全 repo 沒有任何消費者，而 `npcOrder` 的真正決定寫在 `modules/map/system.ts` 裡（動態內容
// 一律排在採集點之前、內容之間依 `spawnBudgets` 的宣告順序）。doc §2.2 明文
// 「NPC 序列規則必須由資料指定，**不能由地圖檔案名稱或程式特例推論**」——那正是被禁止的程式特例。
//
// 逐欄位來源：
//   * `groupPriority` —— 來自文件 §2.2 末條（序列由資料指定）＋ §3.3 不變量 4（兩種目標共用
//     一條序列）。這是序列規則唯一還沒有擁有者的事實：**順序**。
//     權重小者先；`Record` 是**非 Partial** 的（13_data_runtime.md §6.0 規矩五），所以未來新增一種
//     `MapContentKind` 而內容沒給權重時，作者層（`content-source/**` 以真實型別標註）會直接編譯
//     失敗，不會安靜地掉出序列。
//
// 刻意**不**放在這裡的事實（三個來源都指向別的擁有者）：
//   * 「哪些目標可進序列」與「一筆目標值幾點」—— 由各自的 Definition 決定：
//     `MapContentDefinition.npcPolicy`／`GatheringRuleDefinition.npcPolicy`（doc §2.3、
//     19_gathering_service.md §2）。放在序列規則裡會讓同一份成本出現兩個擁有者。
//   * `npcOrder` 的起點與步進 —— 1 起、步進 1 的序數是結構（改了不是換內容，是換編號制度）。
//   * NPC 每日點數預算 —— 屬 dungeon 的 `NpcExplorationRuleDefinition.dailyPointBudget`
//     （03_dungeon_module.md §2.2）。
export type NpcSequenceRuleDefinition = DefinitionHeader<NpcSequenceRuleId> &
  Readonly<{
    groupPriority: Readonly<Record<NpcSequenceGroupKey, number>>;
  }>;

// ── Map Content 定義（01_map_module.md §2.3；本輪【裁定 C】定形）─────────────────
//
// Map Content 的 NPC 可處理政策。形狀刻意與 §2.3 `getGatheringMapView().npcPolicy` 對稱：
// 同一條 NPC 序列的兩種目標，「可不可以被 NPC 處理／要幾點／由哪個 Resolver 處理」必須用
// 同一種說法表達，否則 Map 在組序列時要為兩邊各寫一套判斷。
export type MapContentNpcPolicy =
  | Readonly<{ eligible: false }>
  | Readonly<{ eligible: true; pointCost: number; resolverId: NpcDungeonTargetResolverId }>;

// 【裁定 C】`MapContentDefinition` 原本只帶 `contentKind`，於是 `MapContentInstance` 的
// `npcOrder`／`npcPointCost`／`npcResolverId` 只能由本地 port `MapContentResolver` 的
// `SpawnDraft` 供給——而那三個值在 fixture 裡是**手打的玩法數值**（`kind === 'boss' ? 4 : 1`）。
// 換一份 Content Pack 不會改變它們：那正是規範 §6 點名的「把內容搬進程式」。
//
// 逐欄位來源：
//   * `contentKind` —— 來自消費者：`MapContentInstance.kind`（doc §3.2）與
//     `ApplyNpcDungeonSettlement` 的「目標類型是否仍可被該 Resolver 處理」（doc §7.3 步驟 2，
//     對照 03_dungeon_module.md §2.2 的 `NpcDungeonTargetKind.contentKind`）。
//   * `npcPolicy` —— 來自消費者（`generateMapContent` 目前讀 SpawnDraft 的三個 NPC 欄位）
//     ＋ 文件 doc §3.3 不變量 5「`npcPointCost` 必須大於 0；小怪／寶箱通常為 1、菁英為 2、
//     大怪為 4，**事件由 Definition 明確指定**」＋ 03_dungeon_module.md §2.2「NPC 的每日點數與
//     小怪／菁英／大怪／寶箱／事件成本**由資料決定**」。
//
// 一張表夠不夠？夠——六種 `contentKind` 需要的欄位**完全相同且全部必填**，符合 13_data_runtime.md
// §6.0 規矩二對共用表的唯一要求。逐 kind 不同的資料本來就不在這裡：
//   * 怪群／Boss 的遭遇組 → 本局 `MapContentPayload.encounterGroupId`（已是判別聯集）。
//   * 寶箱掉落表 → `MapSpawnRuleDefinition.chestPoolId`（一張圖一份；設計來源是
//     `firstMapConfigs[].materialPools.treasure` 的加權池），實際物品是本局
//     `MapContentPayload.chest.itemIds`。
//   * 事件定義引用 → `MapSpawnRuleDefinition.mapEventPoolId` 抽出後寫進
//     `MapContentPayload.mapEvent.contentEventDefinitionId`。
//   * 大型體型敵人的**體型需求** → 房間側，不是內容側（doc §2.1「大型敵人偏好房間至少 2×2」、
//     `RoomLinkDefinition.guardedPreferenceKinds`）。`RoomDefinition` 目前沒有偏好欄位，
//     這是另一個未閉合缺口，不在本裁定範圍。
//
// 注意 `contentKind` 與 registry 的家族 `kind: 'map-content'` 是兩個欄位（Wave D 教訓 1：
// 不要再用 `kind` 裝領域變體）。
export type MapContentDefinition = DefinitionHeader &
  Readonly<{
    contentKind: MapContentKind;
    npcPolicy: MapContentNpcPolicy;
    // 怪物類內容的威脅等級。**只有怪物類才有**——寶箱與事件沒有威脅等級，缺席即代表「不適用」，
    // 不是「忘了填」（同 `FacilityDefinition.teacherMasteryLevel` 的慣例）。
    //
    // 為什麼需要它：一般群與菁英群的 `contentKind` **都是** `monsterGroup`
    //（`MapContentKind` 沒有 elite 這一值），沒有這一欄就沒有任何欄位分得開兩者，於是
    // 「文化池挑到一隻菁英」對不到「菁英群」那筆內容定義。
    // `content-source/yunhua/maps.ts` 的 spawnBudgets 註解早就記載了這個缺口。
    threatRank?: MonsterThreatRank;
  }>;

export interface MapDefinitionReader {
  getMapTemplate(id: MapTemplateId): MapTemplateDefinition;
  getMapSpawnRule(id: MapSpawnRuleId): MapSpawnRuleDefinition;
  getCultureContentRule(id: CultureContentRuleId): CultureContentRuleDefinition;
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
  // 事件內容必須帶**實例身分**，不只是定義 ID：`ContentEventInstance`（contracts/core）要求
  // `instanceId` 與 `rngStreamId`——同一個事件定義出現在兩個房間時，兩者必須是不同的實例，
  // 才能各自重播出不同結果。少了這兩欄，dungeon 想取得事件實例就只能拿 ContentInstanceId
  // 硬轉成 ContentEventInstanceId（跨語意轉型，規範 §7 點名的反樣式），而 rngStreamId 更是
  // 無中生有。兩者都由 map 在生成內容時鑄造。
  | Readonly<{
      kind: 'mapEvent';
      contentEventDefinitionId: ContentEventDefinitionId;
      eventInstanceId: ContentEventInstanceId;
      rngStreamId: RngStreamId;
    }>
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

// 內容處理結果（01_map_module.md §3.2 只以 `resolution`／`resolver` 描述、未給結構）。
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
//
// 【裁定 A】原本兩個 resolution 型別各帶一個 `details?: Record<string, JsonValue>` 袋子。
// 規範 §7 與「一個 Func 一張表」（13_data_runtime.md §6.0）都點名 `details` / `payload` 這類
// 名字本身就在說「這裡什麼都能放」的欄位是反樣式：它讓「資料填錯」與「內容本來就是這樣」
// 分不開，而且驗證器寫不出來。全 repo grep 的結果是**零消費者**——沒有任何 Handler、Query、
// Subscriber 或測試讀過它。因此直接刪除，不是搬家。
// 真的需要額外資訊時，正確作法是在**該 variant 自己**加一個具名欄位，並在同一輪把消費者接上；
// 不得再開袋子。
export type MapContentResolution = Readonly<{
  outcome: 'success' | 'failure';
}> &
  (
    | Readonly<{ kind: 'contentResolver'; resolverId: ResolverId }>
    | Readonly<{ kind: 'npcTargetResolver'; resolverId: NpcDungeonTargetResolverId }>
    | Readonly<{ kind: 'combatEncounter'; encounterId: EncounterId }>
  );

// 固定陷阱處理結果（01_map_module.md §5.2 `ResolveMapTrap`／§6 `MapTrapResolved`）。
// `outcome` 就是 doc §3.1 的陷阱終態（triggered／disarmed），Handler 直接寫進 TrapRuntimeState.state。
// 同【裁定 A】：原有的 `details` 袋子已刪除（零生產者、零消費者）。
export type MapTrapResolution = Readonly<{
  outcome: 'triggered' | 'disarmed';
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

// 欄位取自 01_map_module.md §5.2 的命令語意與 §3.1 的 RefreshLock：set 需要 reason 與到期日，
// release 只需要指名是哪一張委託在解鎖。sourceQuestId 兩種模式都必填——解鎖必須由下鎖的同一張
// 委託執行，set 也一樣（別張委託不得覆蓋現有鎖，否則原委託連自己的鎖都解不掉）。
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
