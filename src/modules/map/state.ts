// modules/map/state.ts
// Map 唯一可寫 Slice 的初始工廠與純函式讀寫／空間小工具。
// Slice 型別權威在 contracts/map；此處不重新定義，只 re-export + 提供 immutable helper。
//
// 設計原則：
//   * 全部為決定性純函式；不 mutate 傳入 Slice，一律回傳新物件。
//   * 空間狀態（門／陷阱／採集點）依 Template 重建，符合 doc §3.1 的空間不變量 1–4。

import type {
  MapInstanceId,
  ContentInstanceId,
  RoomId,
  RoomLinkId,
  FixedTrapId,
  GatheringNodeId,
  Revision,
} from '../../contracts/core';
import type {
  MapState,
  MapInstance,
  MapContentInstance,
  MapSpatialRuntime,
  MapTemplateDefinition,
  DoorRuntimeState,
  TrapRuntimeState,
  GatheringNodeRuntimeState,
} from '../../contracts/map';

export type { MapState };

// 空 Slice（新世界或測試起點）。
export const emptyMapState: MapState = Object.freeze({
  instances: Object.freeze({}),
  contents: Object.freeze({}),
  contentIdsByMap: Object.freeze({}),
}) as MapState;

// 由既有實體集合建構 Slice（fixture／存檔載入）。
export function createMapState(
  input: Readonly<{
    instances?: readonly MapInstance[];
    contents?: readonly MapContentInstance[];
  }> = {},
): MapState {
  const instances: Record<MapInstanceId, MapInstance> = {};
  for (const i of input.instances ?? []) instances[i.mapId] = i;

  const contents: Record<ContentInstanceId, MapContentInstance> = {};
  const contentIdsByMap: Record<MapInstanceId, ContentInstanceId[]> = {};
  for (const c of input.contents ?? []) {
    contents[c.contentId] = c;
    (contentIdsByMap[c.mapId] ??= []).push(c.contentId);
  }

  return { instances, contents, contentIdsByMap };
}

// ── Instance 純函式讀寫 ──────────────────────────────────────────────────────

export function tryGetInstance(state: MapState, id: MapInstanceId): MapInstance | undefined {
  return state.instances[id];
}

export function requireInstance(state: MapState, id: MapInstanceId): MapInstance {
  const found = state.instances[id];
  if (found === undefined) {
    throw new Error(`MapState: unknown mapId "${String(id)}"`);
  }
  return found;
}

export function upsertInstance(state: MapState, next: MapInstance): MapState {
  return {
    ...state,
    instances: { ...state.instances, [next.mapId]: next },
  };
}

// ── Content 純函式讀寫 ───────────────────────────────────────────────────────

export function tryGetContent(
  state: MapState,
  id: ContentInstanceId,
): MapContentInstance | undefined {
  return state.contents[id];
}

export function upsertContent(state: MapState, next: MapContentInstance): MapState {
  const existingIds = state.contentIdsByMap[next.mapId] ?? [];
  const contentIdsByMap = existingIds.includes(next.contentId)
    ? state.contentIdsByMap
    : { ...state.contentIdsByMap, [next.mapId]: [...existingIds, next.contentId] };
  return {
    ...state,
    contents: { ...state.contents, [next.contentId]: next },
    contentIdsByMap,
  };
}

export function listContentIdsForMap(
  state: MapState,
  mapId: MapInstanceId,
): readonly ContentInstanceId[] {
  return state.contentIdsByMap[mapId] ?? [];
}

export function listContentsForMap(
  state: MapState,
  mapId: MapInstanceId,
): readonly MapContentInstance[] {
  const out: MapContentInstance[] = [];
  for (const id of listContentIdsForMap(state, mapId)) {
    const c = state.contents[id];
    if (c !== undefined) out.push(c);
  }
  return out;
}

// ── 純空間小工具 ─────────────────────────────────────────────────────────────

export function isRedDoorLink(template: MapTemplateDefinition, linkId: RoomLinkId): boolean {
  const link = template.links.find((l) => l.linkId === linkId);
  return link !== undefined && link.kind === 'redDoor';
}

// 依 Template 重建本版本的空間狀態：門全關、陷阱全 armed、採集點全 available（doc §3.1）。
// 只對 kind: redDoor 的連線建立 Door State（不變量 2）。NPC Policy 由呼叫端另行套用。
export function buildSpatialRuntime(
  template: MapTemplateDefinition,
  mapVersion: number,
): MapSpatialRuntime {
  const doorStates: Record<RoomLinkId, DoorRuntimeState> = {};
  for (const link of template.links) {
    if (link.kind !== 'redDoor') continue;
    doorStates[link.linkId] = {
      linkId: link.linkId,
      mapVersion,
      state: 'closed',
      revision: 0 as Revision,
    };
  }

  const trapStates: Record<FixedTrapId, TrapRuntimeState> = {};
  for (const trap of template.fixedTraps) {
    trapStates[trap.trapId] = {
      trapId: trap.trapId,
      mapVersion,
      state: 'armed',
      revision: 0 as Revision,
    };
  }

  const gatheringNodeStates: Record<GatheringNodeId, GatheringNodeRuntimeState> = {};
  for (const node of template.gatheringNodes) {
    gatheringNodeStates[node.nodeId] = {
      nodeId: node.nodeId,
      mapVersion,
      state: 'available',
      revision: 0 as Revision,
    };
  }

  return { mapVersion, doorStates, trapStates, gatheringNodeStates };
}

// 互斥功能房間（入口／出口／固定陷阱／採集點）不得成為內容生成位置（doc §2.1）。
export function functionalRoomIds(template: MapTemplateDefinition): ReadonlySet<RoomId> {
  const set = new Set<RoomId>();
  for (const roomId of template.entranceRoomIds) set.add(roomId);
  for (const roomId of template.exitRoomIds) set.add(roomId);
  for (const trap of template.fixedTraps) set.add(trap.roomId);
  for (const node of template.gatheringNodes) set.add(node.roomId);
  return set;
}

// 可承載動態內容的房間（每房至多一內容槽，不變量 3；順序即 Template 房間順序，決定性）。
export function eligibleContentRoomIds(template: MapTemplateDefinition): readonly RoomId[] {
  const excluded = functionalRoomIds(template);
  return template.rooms.filter((r) => !excluded.has(r.roomId)).map((r) => r.roomId);
}
