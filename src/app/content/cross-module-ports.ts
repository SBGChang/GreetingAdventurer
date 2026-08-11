// app/content/cross-module-ports.ts
// 真實跨模組 Query Port adapter（HANDOFF「跨模組 Query ← 各模組 createXxxQuery」）。
//
// 各模組 Handler 吃的是**窄化的消費者 Port**（DungeonTeamPort、CombatLoadoutQuery…），不是別的模組
// 的完整 Query。這層把「擁有模組的公開 Query（讀真實 sibling Slice）」轉接成消費者要的窄形狀——
// 取代 session ContextAssembler 目前用的 fixture stub。內容無關：只讀 sibling Slice，不碰 content。
//
// 已可乾淨轉接的（本檔）：
//   - DungeonTeamPort ← TeamQuery（team Slice）
//   - CombatLoadoutQuery ← InventoryQuery（inventory Slice）
// 尚需更多來源、暫緩（見檔尾註）：DungeonMapPort（需 map 空間內部：getRoomTraversal/getEntranceRoom…）、
//   CombatFormationQuery（需合成 team formation + character HP/MP + inventory 武器組）、CharacterStatsQuery。

import type { DungeonTeamPort } from '../../modules/dungeon/public';
import { createTeamQuery, type TeamState } from '../../modules/team/public';
import type { CombatLoadoutQuery } from '../../modules/combat/public';
import { createInventoryQuery, type InventoryState } from '../../modules/inventory/public';
import type { ItemDefinitionReader } from '../../contracts/inventory';

// Dungeon 讀 team 的窄化 Port：以 TeamQuery（讀真實 team Slice）實作。
export function createDungeonTeamPort(teamState: TeamState): DungeonTeamPort {
  const query = createTeamQuery(teamState);
  return {
    getAdventureMap: (teamId) => {
      const location = query.getLocation(teamId);
      return location.kind === 'adventureMap' ? location.mapId : undefined;
    },
    isTeamInMap: (teamId, mapId) => {
      const location = query.getLocation(teamId);
      return location.kind === 'adventureMap' && location.mapId === mapId;
    },
    getMembers: (teamId) => query.listFormalMembers(teamId),
  };
}

// Combat 開場讀武器組配置的窄化 Port：窄化 InventoryQuery.getEquipmentLoadout（讀真實 inventory Slice）。
export function createCombatLoadoutQuery(
  inventoryState: InventoryState,
  itemReader: ItemDefinitionReader,
): CombatLoadoutQuery {
  const query = createInventoryQuery(inventoryState, itemReader);
  return {
    getEquipmentLoadout: (characterId) => query.getEquipmentLoadout(characterId),
  };
}
