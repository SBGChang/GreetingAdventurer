// app/composition/bootstrap.ts
// NewGameBootstrapper（12_engine_runtime.md §1.1）：組出一個**合法的初始 GameState**——玩家隊 + 隊長
// 角色 + 站位——供引擎 Session 驅動。ID 走交易外的 bootstrap cursor（seed 自 worldSeed，從 0 起），
// 產完把終值寫入 core.nextRuntimeSequence（§7.2：交易外鑄 ID 也要推進序號）。
//
// 內容輕（bring-up）：隊長屬性等內容相依值以參數帶入預設，不讀 content pack；換上真 Yunhua 內容時
// 由呼叫者提供對應的 archetype / 起始城 / 屬性即可。

import type {
  CharacterArchetypeId,
  CharacterId,
  CityId,
  Revision,
  RuntimeIdCursor,
  Seed,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type { Character, Sex } from '../../modules/character/public';
import { createCharacterState } from '../../modules/character/public';
import type { Team, TeamCombatFormation } from '../../modules/team/public';
import { createTeamState } from '../../modules/team/public';

import { createIdPortsForBootstrap } from './session';
import { createEmptyGameState, type GameState } from './state';

export type NewGameInput = Readonly<{
  worldSeed: string;
  startCityId: CityId;
  // 世界日曆為非負整數；起始日給正值，讓隊長（birthDay 0）於開局即成年。
  startDay?: number;
  leaderArchetypeId?: CharacterArchetypeId;
  leaderSex?: Sex;
  leaderBirthDay?: number;
}>;

export type NewGame = Readonly<{
  state: GameState;
  playerTeamId: TeamId;
  leaderId: CharacterId;
}>;

const DEFAULT_START_DAY = 8000; // ≈22 年；隊長 birthDay 0 → 開局成年，且世界日非負

// bring-up 預設 archetype（真內容軌會以雲華 archetype 取代）。
const DEFAULT_ARCHETYPE = 'definition:character-archetype:founder' as CharacterArchetypeId;

export function createNewGame(input: NewGameInput): NewGame {
  const worldSeed = input.worldSeed as Seed;
  // 交易外的 ID cursor（§7.2）：seed 自 worldSeed，從 0 起；產完寫回 core.nextRuntimeSequence。
  const { ids, currentCursor } = createIdPortsForBootstrap(worldSeed, 0 as RuntimeIdCursor);
  const leaderId = ids.character.nextCharacterId();
  const playerTeamId = ids.team.nextTeamId();

  const startDay = (input.startDay ?? DEFAULT_START_DAY) as WorldDay;

  const leader: Character = {
    characterId: leaderId,
    archetypeId: input.leaderArchetypeId ?? DEFAULT_ARCHETYPE,
    origin: 'playerLineage',
    sex: input.leaderSex ?? 'female',
    birthDay: (input.leaderBirthDay ?? 0) as WorldDay,
    lifeState: 'alive',
    availability: 'available',
    parentIds: [],
    childIds: [],
    innateTraitIds: [],
    reputation: 0,
    // bring-up：HP/MP 以固定值起手（真內容會由 progression capacity 決定上限）。
    condition: { health: 100, mana: 50, statuses: [] },
    revision: 0 as Revision,
  };

  const playerTeam: Team = {
    teamId: playerTeamId,
    control: 'player',
    memberIds: [leaderId],
    temporaryMemberIds: [],
    leaderId,
    location: { kind: 'city', cityId: input.startCityId },
    revision: 0 as Revision,
  };

  // 不變量 team.formationCoversAllFormalMembers：站位須涵蓋全部正式成員（此處只有隊長）。
  const formation: TeamCombatFormation = {
    teamId: playerTeamId,
    placements: { [leaderId]: { floor: 0, row: 1, col: 1 } }, // 前排中央
    revision: 0 as Revision,
  };

  const teamState = createTeamState({
    playerTeamId,
    teams: [playerTeam],
    combatFormations: [formation],
  });

  const base = createEmptyGameState({
    worldSeed: input.worldSeed,
    startDay,
    team: teamState,
  });
  const state: GameState = {
    ...base,
    character: createCharacterState({ characters: [leader] }),
    core: { ...base.core, nextRuntimeSequence: currentCursor() },
  };

  return { state, playerTeamId, leaderId };
}
