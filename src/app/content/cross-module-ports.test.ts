// app/content/cross-module-ports.test.ts
// 真實跨模組 Query Port adapter 的證明：轉接後**讀的是真實 sibling Slice**（非 fixture stub）。

import type { CharacterId, CityId, MapInstanceId, Revision, TeamId } from '../../contracts/core';
import { createTeamState, type Team } from '../../modules/team/public';
import { createFixtureState as inventoryFixtureState, createFixtureReader as inventoryReader } from '../../modules/inventory/fixtures';

import { createDungeonTeamPort, createCombatLoadoutQuery } from './cross-module-ports';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PLAYER = 'runtime:team:player' as TeamId;
const LEADER = 'runtime:character:leader' as CharacterId;
const MEMBER = 'runtime:character:member' as CharacterId;
const CAVE = 'runtime:map-instance:cave' as MapInstanceId;
const OTHER_MAP = 'runtime:map-instance:other' as MapInstanceId;
const CITY = 'runtime:city:home' as unknown as CityId;

function teamAt(location: Team['location']): ReturnType<typeof createTeamState> {
  const team: Team = {
    teamId: PLAYER,
    control: 'player',
    memberIds: [LEADER, MEMBER],
    temporaryMemberIds: [],
    leaderId: LEADER,
    location,
    revision: 0 as Revision,
  };
  return createTeamState({ playerTeamId: PLAYER, teams: [team] });
}

export type CrossModulePortTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'DungeonTeamPort：隊伍在冒險地 → getAdventureMap / isTeamInMap / getMembers 讀真實 team Slice',
    run: () => {
      const port = createDungeonTeamPort(teamAt({ kind: 'adventureMap', mapId: CAVE }));
      assert(port.getAdventureMap(PLAYER) === CAVE, 'getAdventureMap 應回目前冒險地 mapId');
      assert(port.isTeamInMap(PLAYER, CAVE) === true, 'isTeamInMap 對所在圖應為 true');
      assert(port.isTeamInMap(PLAYER, OTHER_MAP) === false, 'isTeamInMap 對別的圖應為 false');
      const members = port.getMembers(PLAYER);
      assert(members.length === 2 && members[0] === LEADER && members[1] === MEMBER, 'getMembers 應回正式成員');
    },
  },
  {
    name: 'DungeonTeamPort：隊伍在城市 → getAdventureMap 為 undefined',
    run: () => {
      const port = createDungeonTeamPort(teamAt({ kind: 'city', cityId: CITY }));
      assert(port.getAdventureMap(PLAYER) === undefined, '不在冒險地時 getAdventureMap 應為 undefined');
      assert(port.isTeamInMap(PLAYER, CAVE) === false, '不在冒險地時 isTeamInMap 應為 false');
    },
  },
  {
    name: 'CombatLoadoutQuery：窄化 InventoryQuery.getEquipmentLoadout，讀真實 inventory Slice',
    run: () => {
      const query = createCombatLoadoutQuery(inventoryFixtureState(), inventoryReader());
      const loadout = query.getEquipmentLoadout('runtime:character:hero' as CharacterId);
      assert(
        String(loadout.characterId) === 'runtime:character:hero',
        `loadout 應對應查詢的角色（實得 ${String(loadout.characterId)}）`,
      );
    },
  },
];

export function runTestResults(): readonly CrossModulePortTestResult[] {
  return CASES.map((c) => {
    try {
      c.run();
      return { name: c.name, pass: true };
    } catch (e) {
      return { name: c.name, pass: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? ''}`).join('\n');
    throw new Error(`cross-module-ports tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
