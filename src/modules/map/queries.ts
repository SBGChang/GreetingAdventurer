// modules/map/queries.ts
// Map 模組自有 Query Port（MapQuery）在 Slice 上的純函式實作，外加 TeamPresence 佔用查詢輔助。
//
// 註：TeamPresenceQuery 是 Map 的「消費 Port」（由 team 擁有、Composition 注入），不在此實作；
// 本檔實作模組自有讀取投影。listNpcSequence 需要採集點的 gatheringRuleId，故需 MapDefinitionReader
// 取得 Template（採集點 gatheringRuleId 為 Template 固定資料，Runtime 節點狀態不保存）。

import type {
  MapInstanceId,
  ContentInstanceId,
  RoomLinkId,
  FixedTrapId,
  GatheringNodeId,
  WorldDay,
  TeamId,
} from '../../contracts/core';
import type {
  MapState,
  MapQuery,
  MapInstanceView,
  MapSpatialSnapshotView,
  MapContentView,
  DoorRuntimeStateView,
  TrapRuntimeStateView,
  GatheringNodeRuntimeStateView,
  NpcSequenceEntryView,
  MapDefinitionReader,
  TeamPresenceQuery,
} from '../../contracts/map';
import { requireInstance, tryGetContent, listContentsForMap } from './state';

export function createMapQuery(state: MapState, definitions: MapDefinitionReader): MapQuery {
  return {
    getMapInstance(mapId: MapInstanceId): MapInstanceView {
      return requireInstance(state, mapId);
    },

    getMapSpatialSnapshot(mapId: MapInstanceId): MapSpatialSnapshotView {
      return requireInstance(state, mapId).spatialRuntime;
    },

    getContent(contentId: ContentInstanceId): MapContentView | undefined {
      return tryGetContent(state, contentId);
    },

    listAvailableContent(mapId: MapInstanceId): MapContentView[] {
      return listContentsForMap(state, mapId).filter((c) => c.state === 'available');
    },

    listNpcSequence(mapId: MapInstanceId): NpcSequenceEntryView[] {
      const instance = requireInstance(state, mapId);
      const template = definitions.getMapTemplate(instance.templateId);
      const entries: NpcSequenceEntryView[] = [];

      for (const content of listContentsForMap(state, mapId)) {
        if (content.state !== 'available') continue;
        if (
          content.npcOrder === undefined ||
          content.npcPointCost === undefined ||
          content.npcResolverId === undefined
        ) {
          continue;
        }
        entries.push({
          kind: 'mapContent',
          npcOrder: content.npcOrder,
          pointCost: content.npcPointCost,
          resolverId: content.npcResolverId,
          contentId: content.contentId,
        });
      }

      for (const node of Object.values(instance.spatialRuntime.gatheringNodeStates)) {
        if (node.state !== 'available') continue;
        if (
          node.npcOrder === undefined ||
          node.npcPointCost === undefined ||
          node.npcResolverId === undefined
        ) {
          continue;
        }
        const def = template.gatheringNodes.find((n) => n.nodeId === node.nodeId);
        if (def === undefined) continue;
        entries.push({
          kind: 'gatheringNode',
          npcOrder: node.npcOrder,
          pointCost: node.npcPointCost,
          resolverId: node.npcResolverId,
          nodeId: node.nodeId,
          gatheringRuleId: def.gatheringRuleId,
          mapVersion: node.mapVersion,
        });
      }

      return entries.sort((a, b) => a.npcOrder - b.npcOrder);
    },

    getDoorState(mapId: MapInstanceId, linkId: RoomLinkId): DoorRuntimeStateView {
      const door = requireInstance(state, mapId).spatialRuntime.doorStates[linkId];
      if (door === undefined) {
        throw new Error(`MapQuery: unknown redDoor linkId "${String(linkId)}" on map "${String(mapId)}"`);
      }
      return door;
    },

    getTrapState(mapId: MapInstanceId, trapId: FixedTrapId): TrapRuntimeStateView {
      const trap = requireInstance(state, mapId).spatialRuntime.trapStates[trapId];
      if (trap === undefined) {
        throw new Error(`MapQuery: unknown trapId "${String(trapId)}" on map "${String(mapId)}"`);
      }
      return trap;
    },

    getGatheringNodeState(
      mapId: MapInstanceId,
      nodeId: GatheringNodeId,
    ): GatheringNodeRuntimeStateView {
      const node = requireInstance(state, mapId).spatialRuntime.gatheringNodeStates[nodeId];
      if (node === undefined) {
        throw new Error(`MapQuery: unknown gatheringNodeId "${String(nodeId)}" on map "${String(mapId)}"`);
      }
      return node;
    },

    listAvailableGatheringNodes(mapId: MapInstanceId): GatheringNodeRuntimeStateView[] {
      const instance = requireInstance(state, mapId);
      return Object.values(instance.spatialRuntime.gatheringNodeStates).filter(
        (n) => n.state === 'available',
      );
    },

    isContentAvailable(contentId: ContentInstanceId): boolean {
      return tryGetContent(state, contentId)?.state === 'available';
    },

    isRefreshLocked(mapId: MapInstanceId, onDay: WorldDay): boolean {
      const lock = requireInstance(state, mapId).refresh.refreshLock;
      return lock !== undefined && lock.releaseOnDay > onDay;
    },
  };
}

// TeamPresence 佔用輔助：Map 不擁有隊伍位置，僅以注入的 TeamPresenceQuery 唯讀判斷（doc §1.1）。
export function isMapOccupied(presence: TeamPresenceQuery, mapId: MapInstanceId): boolean {
  return presence.countTeamsInside(mapId) > 0;
}

export function isTeamOnMap(
  presence: TeamPresenceQuery,
  mapId: MapInstanceId,
  teamId: TeamId,
): boolean {
  return presence.isTeamInside(mapId, teamId);
}
