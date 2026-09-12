// app/content/dungeon-map-port.ts
// `DungeonMapPort` 的正式實作（docs/00_core/technical_architecture.md）。
//
// Dungeon 不擁有地形，也不擁有內容——它只問 map。這一層把兩個真相來源接起來：
//   * `MapDefinitionReader`（Template）：房間、連線、入口／出口、固定陷阱、採集點。
//   * `MapQuery`（Runtime State）：門開了沒、陷阱拆了沒、內容還在不在、目前版本。
//
// 有演算法的只有 `getRoomTraversal`；其餘都是查表。
//
// ── 為什麼距離要走房內 BFS 而不是曼哈頓距離 ────────────────────────────────
//
// 一個房間是**一個移動節點**，但可以由多格構成 L／T／凹形（contracts/map 的 RoomDefinition：
// 「cells 必須彼此相連」）。凹形房間裡，起點到出口格的曼哈頓距離會**穿過不屬於該房的格子**，
// 於是移動時間比實際短。BFS 限制在該房的 cells 集合內，走出來的才是真的步數。
//
// 這個距離會乘上 `traversalMinutesPerCell` 變成迷宮分鐘，再累積成世界日——所以它不是顯示用的
// 近似值，它會改變玩家一天能探多少路。

import type {
  AdventureSiteId,
  ContentInstanceId,
  EncounterGroupDefinitionId,
  ExperienceAwardRuleId,
  FixedTrapId,
  GatheringRuleId,
  MapInstanceId,
  ResolverId,
  Revision,
  RoomId,
} from '../../contracts/core';
import type { ContentEventInstance } from '../../contracts/core';
import type {
  GridCell,
  MapContentKind,
  MapDefinitionReader,
  MapQuery,
  MapTemplateDefinition,
  NpcSequenceEntryView,
  RoomDefinition,
  RoomLinkDefinition,
} from '../../contracts/map';
import type { DungeonMapPort } from '../../modules/dungeon/public';

// ── 房內 BFS ────────────────────────────────────────────────────────────────

function cellKey(cell: GridCell): string {
  return `${cell.floor}:${cell.row}:${cell.col}`;
}

function sameCell(a: GridCell, b: GridCell): boolean {
  return a.floor === b.floor && a.row === b.row && a.col === b.col;
}

// 在單一房間的 cells 集合內，從 `from` 走到 `to` 的最短步數（4 向相鄰）。
// 走不到回 undefined——那代表房間資料本身不連通（Template 驗證應擋下），不是「距離很遠」。
function stepsWithinRoom(room: RoomDefinition, from: GridCell, to: GridCell): number | undefined {
  if (sameCell(from, to)) return 0;
  const inRoom = new Set(room.cells.map(cellKey));
  if (!inRoom.has(cellKey(from)) || !inRoom.has(cellKey(to))) return undefined;

  const seen = new Set<string>([cellKey(from)]);
  let frontier: GridCell[] = [from];
  let distance = 0;
  while (frontier.length > 0) {
    distance += 1;
    const nextFrontier: GridCell[] = [];
    for (const cell of frontier) {
      const neighbours: readonly GridCell[] = [
        { floor: cell.floor, row: cell.row - 1, col: cell.col },
        { floor: cell.floor, row: cell.row + 1, col: cell.col },
        { floor: cell.floor, row: cell.row, col: cell.col - 1 },
        { floor: cell.floor, row: cell.row, col: cell.col + 1 },
      ];
      for (const n of neighbours) {
        const key = cellKey(n);
        if (!inRoom.has(key) || seen.has(key)) continue;
        if (sameCell(n, to)) return distance;
        seen.add(key);
        nextFrontier.push(n);
      }
    }
    frontier = nextFrontier;
  }
  return undefined;
}

// ── Port ────────────────────────────────────────────────────────────────────

export type DungeonMapPortDeps = Readonly<{
  query: MapQuery;
  definitions: MapDefinitionReader;
}>;

export function createDungeonMapPort(deps: DungeonMapPortDeps): DungeonMapPort {
  const { query, definitions } = deps;

  const templateOf = (mapId: MapInstanceId): MapTemplateDefinition =>
    definitions.getMapTemplate(query.getMapInstance(mapId).templateId);

  const roomOf = (template: MapTemplateDefinition, roomId: RoomId): RoomDefinition | undefined =>
    template.rooms.find((r) => r.roomId === roomId);

  // 連接兩個房間的連線（任一方向）。同一對房間可能有多條（例如通道 + 樓梯），
  // 全部回傳讓呼叫端挑最短的一條——挑第一條會讓「有捷徑但走遠路」變成隱性行為。
  const linksBetween = (
    template: MapTemplateDefinition,
    a: RoomId,
    b: RoomId,
  ): readonly RoomLinkDefinition[] =>
    template.links.filter(
      (l) => (l.fromRoomId === a && l.toRoomId === b) || (l.fromRoomId === b && l.toRoomId === a),
    );

  return {
    getMapVersion: (mapId) => query.getMapInstance(mapId).currentVersion,

    getContentResolverId: (_mapId, contentId): ResolverId | undefined =>
      query.getContent(contentId)?.playerResolverId,

    getEntranceRoom: (mapId) => {
      const template = templateOf(mapId);
      const roomId = template.entranceRoomIds[0];
      if (roomId === undefined) {
        throw new Error(`dungeon-map-port：地圖模板 "${String(template.id)}" 沒有入口房間`);
      }
      const room = roomOf(template, roomId);
      const entryCell = room?.cells[0];
      if (entryCell === undefined) {
        throw new Error(`dungeon-map-port：入口房間 "${String(roomId)}" 沒有任何格子`);
      }
      return { roomId, entryCell };
    },

    isExitRoom: (mapId, roomId) => templateOf(mapId).exitRoomIds.includes(roomId),

    getRoomTraversal: (mapId, fromRoomId, fromEntryCell, toRoomId) => {
      const template = templateOf(mapId);
      const fromRoom = roomOf(template, fromRoomId);
      if (fromRoom === undefined) return undefined;

      let best: Readonly<{ cells: number; entryCell: GridCell }> | undefined;
      for (const link of linksBetween(template, fromRoomId, toRoomId)) {
        // 紅門必須已經開啟才算可通行；關著的門要先 openDungeonDoor。
        if (link.kind === 'redDoor' && query.getDoorState(mapId, link.linkId).state !== 'open') {
          continue;
        }
        // 連線的兩端各屬一個房間；取出「我這側」與「對側」的格子。
        const nearCell = link.fromRoomId === fromRoomId ? link.fromCell : link.toCell;
        const farCell = link.fromRoomId === fromRoomId ? link.toCell : link.fromCell;

        const within = stepsWithinRoom(fromRoom, fromEntryCell, nearCell);
        if (within === undefined) continue;
        // +1：跨過連線本身也是一步（樓梯亦同——上下樓共用列行座標，仍是一次移動）。
        const cells = within + 1;
        if (best === undefined || cells < best.cells) best = { cells, entryCell: farCell };
      }
      return best;
    },

    getDoorLink: (mapId, linkId) => {
      const link = templateOf(mapId).links.find((l) => l.linkId === linkId);
      if (link === undefined) return undefined;
      // 通道沒有 Door State（buildSpatialRuntime 只為 redDoor 建），永遠視為開啟。
      const state =
        link.kind === 'redDoor' ? query.getDoorState(mapId, linkId).state : ('open' as const);
      return { fromRoomId: link.fromRoomId, toRoomId: link.toRoomId, kind: link.kind, state };
    },

    getGatheringNodeRuleId: (mapId, nodeId): GatheringRuleId | undefined =>
      templateOf(mapId).gatheringNodes.find((n) => n.nodeId === nodeId)?.gatheringRuleId,

    isGatheringNodeAvailable: (mapId, nodeId) =>
      query.getGatheringNodeState(mapId, nodeId).state === 'available',

    getContentKind: (_mapId, contentId): MapContentKind | undefined =>
      query.getContent(contentId)?.kind,

    isContentAvailable: (_mapId, contentId) => query.isContentAvailable(contentId),

    getContentRevision: (_mapId, contentId): Revision | undefined =>
      query.getContent(contentId)?.revision,

    getGatheringNodeRevision: (mapId, nodeId): Revision | undefined =>
      query.getGatheringNodeState(mapId, nodeId).revision,

    listControllerContentIds: (_mapId, contentId): readonly ContentInstanceId[] | undefined => {
      const payload = query.getContent(contentId)?.payload;
      if (payload === undefined) return undefined;
      // 只有 kidnap／control 兩種 payload 帶守衛清單；其餘種類**沒有這個欄位**，
      // 回 undefined 讓呼叫端明確拒絕（回空陣列會被讀成「沒有守衛」＝可以直接互動）。
      return payload.kind === 'kidnap' || payload.kind === 'control'
        ? payload.controllerContentIds
        : undefined;
    },

    getContentRoomId: (_mapId, contentId): RoomId | undefined =>
      query.getContent(contentId)?.position.roomId,

    getEncounterGroupId: (_mapId, contentId): EncounterGroupDefinitionId | undefined => {
      const payload = query.getContent(contentId)?.payload;
      if (payload === undefined) return undefined;
      return payload.kind === 'monsterGroup' || payload.kind === 'boss'
        ? payload.encounterGroupId
        : undefined;
    },

    getContentEventInstance: (_mapId, contentId): ContentEventInstance | undefined => {
      const content = query.getContent(contentId);
      if (content === undefined || content.payload.kind !== 'mapEvent') return undefined;
      // 內容事件實例的身分＝「哪一筆事件定義、由哪一個實體承載」。兩者都來自 map 的內容實例，
      // 不是這裡合成的。
      return {
        instanceId: content.payload.eventInstanceId,
        definitionId: content.payload.contentEventDefinitionId,
        rngStreamId: content.payload.rngStreamId,
      };
    },

    listArmedTrapsInRoom: (mapId, roomId): readonly FixedTrapId[] => {
      const template = templateOf(mapId);
      const snapshot = query.getMapSpatialSnapshot(mapId);
      return template.fixedTraps
        .filter((trap) => trap.roomId === roomId)
        .filter((trap) => snapshot.trapStates[trap.trapId]?.state === 'armed')
        .map((trap) => trap.trapId);
    },

    listNpcSequence: (mapId): readonly NpcSequenceEntryView[] => query.listNpcSequence(mapId),

    getExplorationCompletion: (mapId) => {
      const instance = query.getMapInstance(mapId);
      const template = definitions.getMapTemplate(instance.templateId);
      // explorationKey 必須把「同一張圖的不同刷新版本」分開：全清 v1 與全清 v2 是兩件事，
      // 經驗不該只發一次。版本是 map 的事實，所以用它組鍵，而不是另外發明一個計數。
      return {
        explorationKey: `${String(instance.mapId)}#${instance.currentVersion}`,
        experienceRuleId: template.explorationExperienceRuleId as ExperienceAwardRuleId,
      };
    },
  };
}

// 由據點解析它的 MapInstance／出口城市。map Slice 是唯一真相（Bootstrap 建立實例時寫入
// `adventureSiteId`），所以這裡是一個純投影，不含任何「找不到就補一個」的分支。
export type SiteMapIndex = Readonly<{
  findMapIdBySite: (siteId: AdventureSiteId) => MapInstanceId | undefined;
  findSiteByMapId: (mapId: MapInstanceId) => AdventureSiteId | undefined;
}>;
