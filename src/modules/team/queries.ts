// modules/team/queries.ts
// Team 模組自有 Query Port 在 Slice 上的純函式實作：
//   * TeamQuery（contracts/team）——本模組對外的完整讀取投影。
//   * TeamPresenceQuery（contracts/map）——供 Map 判斷地圖占用的窄化投影；
//     Map 只能問 count/isInside，不得讀 travel/成員/自由行動內部資料（doc §4）。
//
// 所有 Runtime 實體在結構上都是對應 View 的超集合，故此處直接投影回傳。

import type {
  TeamId,
  CharacterId,
  MapInstanceId,
  CityId,
  WorldDay,
} from '../../contracts/core';
import type {
  TeamQuery,
  TeamView,
  TeamLocation,
  TeamPlanView,
  MemberFreeActionView,
  TeamCombatFormationView,
  RecentAdventurerActivityView,
  PendingPlayerTravelInteractionView,
  PendingSuccessionView,
} from '../../contracts/team';
import type { TeamPresenceQuery } from '../../contracts/map';
import type { TeamState } from './state';
import { requireTeam, tryGetPlan } from './state';

function teamsInside(state: TeamState, mapId: MapInstanceId): TeamId[] {
  const out: TeamId[] = [];
  for (const t of Object.values(state.teams)) {
    if (t.location.kind === 'adventureMap' && t.location.mapId === mapId) out.push(t.teamId);
  }
  return out;
}

export function createTeamQuery(state: TeamState): TeamQuery {
  return {
    getTeam(teamId: TeamId): TeamView {
      return requireTeam(state, teamId);
    },

    getPlayerTeamId(): TeamId {
      return state.playerTeamId;
    },

    // 玩家控制角色的唯一真相 = 玩家隊 leaderId（不另存 Avatar State）。
    getPlayerControlledCharacterId(): CharacterId {
      return requireTeam(state, state.playerTeamId).leaderId;
    },

    getLocation(teamId: TeamId): TeamLocation {
      return requireTeam(state, teamId).location;
    },

    listTeamsAtCity(cityId: CityId): TeamId[] {
      const out: TeamId[] = [];
      for (const t of Object.values(state.teams)) {
        if (t.location.kind === 'city' && t.location.cityId === cityId) out.push(t.teamId);
      }
      return out;
    },

    countTeamsInside(mapId: MapInstanceId): number {
      return teamsInside(state, mapId).length;
    },

    isTeamInside(mapId: MapInstanceId, teamId: TeamId): boolean {
      const t = state.teams[teamId];
      return t !== undefined && t.location.kind === 'adventureMap' && t.location.mapId === mapId;
    },

    getActivePlan(teamId: TeamId): TeamPlanView | undefined {
      const team = state.teams[teamId];
      if (team === undefined || team.activePlanId === undefined) return undefined;
      return tryGetPlan(state, team.activePlanId);
    },

    listFreeActions(teamId: TeamId): MemberFreeActionView[] {
      return Object.values(state.freeActions).filter((f) => f.teamId === teamId);
    },

    listFormalMembers(teamId: TeamId): CharacterId[] {
      return [...requireTeam(state, teamId).memberIds];
    },

    getFormalMemberJoinedOnDay(teamId: TeamId, characterId: CharacterId): WorldDay | undefined {
      const team = state.teams[teamId];
      if (team === undefined || !team.memberIds.includes(characterId)) return undefined;
      return state.memberRetention[teamId]?.memberJoinedOnDay[characterId];
    },

    getCombatFormation(teamId: TeamId): TeamCombatFormationView {
      const formation = state.combatFormations[teamId];
      if (formation !== undefined) return formation;
      // 尚未建立配置：回傳空投影（revision 0）。
      return { teamId, placements: {}, revision: 0 };
    },

    listTavernVisitorIds(cityId: CityId): CharacterId[] {
      // 同城隊伍中，正式成員的 active/resting 自由行動為 tavernVisit 者。
      const teamsAtCity = new Set<string>();
      for (const t of Object.values(state.teams)) {
        if (t.location.kind === 'city' && t.location.cityId === cityId) {
          teamsAtCity.add(t.teamId as unknown as string);
        }
      }
      const out: CharacterId[] = [];
      for (const f of Object.values(state.freeActions)) {
        if (f.payload.kind !== 'tavernVisit') continue;
        if (f.status !== 'active' && f.status !== 'resting') continue;
        if (!teamsAtCity.has(f.teamId as unknown as string)) continue;
        const team = state.teams[f.teamId];
        if (team !== undefined && team.memberIds.includes(f.memberId)) out.push(f.memberId);
      }
      return out;
    },

    getRecentAdventurerActivity(characterId: CharacterId): RecentAdventurerActivityView[] {
      return [...(state.recentActivities[characterId] ?? [])];
    },

    getPendingPlayerTravelInteraction(
      teamId: TeamId,
    ): PendingPlayerTravelInteractionView | undefined {
      for (const p of Object.values(state.pendingTravelInteractions)) {
        if (p.teamId === teamId) return p;
      }
      return undefined;
    },

    getPendingSuccession(): PendingSuccessionView | undefined {
      return state.pendingSuccession;
    },
  };
}

// Map 專用的窄化占用 Query（doc §4：不得讀 travel/成員/自由行動內部資料）。
export function createTeamPresenceQuery(state: TeamState): TeamPresenceQuery {
  return {
    countTeamsInside(mapId: MapInstanceId): number {
      return teamsInside(state, mapId).length;
    },
    isTeamInside(mapId: MapInstanceId, teamId: TeamId): boolean {
      const t = state.teams[teamId];
      return t !== undefined && t.location.kind === 'adventureMap' && t.location.mapId === mapId;
    },
  };
}
