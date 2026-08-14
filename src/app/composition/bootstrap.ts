// app/composition/bootstrap.ts
// createBringUpFixture：組出一個**足以驅動引擎的最小 GameState**——玩家隊 + 隊長角色 + 站位 +
// 隊長的（空）成長檔——供引擎 Session 與測試起手。ID 走交易外的 bootstrap cursor（seed 自 worldSeed，
// 從 0 起），產完把終值寫入 core.nextRuntimeSequence（§7.2：交易外鑄 ID 也要推進序號）。
//
// 這**不是** 12_engine_runtime.md §1.1 的正式 NewGameBootstrapper。刻意誠實命名為「bring-up fixture」，
// 因為正式開局 Gate 尚缺（多數卡在內容）：
//   - 隊長屬性未由 archetype 定義派生（此處只給空 masteries + bring-up HP/MP）。
//   - 未排角色生命週期 Job（characterLifecycleDue：成年/退休/自然死亡檢查需 lifecycle 規則＝內容）。
//   - 無 archetype / 起始城 / 內容存在性驗證（需 content pack）。
//   - 不回傳 diagnostics / initialRoute / session phase。
// 換上真雲華內容後，另立 createNewGame 補齊上述 Gate；本函式續作為測試/bring-up 用。

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
import { createCharacterProgression } from '../../modules/progression/public';
import type { Team, TeamCombatFormation } from '../../modules/team/public';
import { createTeamState } from '../../modules/team/public';

import { createIdPortsForBootstrap } from './session';
import { createEmptyGameState, type GameState } from './state';

export type BringUpFixtureInput = Readonly<{
  worldSeed: string;
  startCityId: CityId;
  // 世界日曆為非負整數；起始日給正值，讓隊長（birthDay 預設 0）於開局即成年。
  startDay?: number;
  leaderArchetypeId?: CharacterArchetypeId;
  leaderSex?: Sex;
  leaderBirthDay?: number;
}>;

export type BringUpFixture = Readonly<{
  state: GameState;
  playerTeamId: TeamId;
  leaderId: CharacterId;
}>;

const DEFAULT_START_DAY = 8000; // ≈22 年；隊長 birthDay 0 → 開局成年，且世界日非負

// bring-up 預設 archetype（真內容軌會以雲華 archetype 取代）。
const DEFAULT_ARCHETYPE = 'definition:character-archetype:founder' as CharacterArchetypeId;

// 最小輸入驗證：seed 非空、日曆非負、birthDay 不晚於 startDay（隊長不能還沒出生）。
function validateInput(input: BringUpFixtureInput, startDay: number, birthDay: number): void {
  if (input.worldSeed.trim() === '') throw new Error('createBringUpFixture: worldSeed 不可為空');
  if (String(input.startCityId).trim() === '') throw new Error('createBringUpFixture: startCityId 不可為空');
  if (!Number.isInteger(startDay) || startDay < 0)
    throw new Error(`createBringUpFixture: startDay 需為非負整數（實得 ${startDay}）`);
  if (!Number.isInteger(birthDay) || birthDay < 0)
    throw new Error(`createBringUpFixture: leaderBirthDay 需為非負整數（實得 ${birthDay}）`);
  if (birthDay > startDay)
    throw new Error(`createBringUpFixture: leaderBirthDay(${birthDay}) 不可晚於 startDay(${startDay})`);
}

export function createBringUpFixture(input: BringUpFixtureInput): BringUpFixture {
  const startDay = input.startDay ?? DEFAULT_START_DAY;
  const birthDay = input.leaderBirthDay ?? 0;
  validateInput(input, startDay, birthDay);

  const worldSeed = input.worldSeed as Seed;
  // 交易外的 ID cursor（§7.2）：seed 自 worldSeed，從 0 起；產完寫回 core.nextRuntimeSequence。
  const { ids, currentCursor } = createIdPortsForBootstrap(worldSeed, 0 as RuntimeIdCursor);
  const leaderId = ids.character.nextCharacterId();
  const playerTeamId = ids.team.nextTeamId();

  const leader: Character = {
    characterId: leaderId,
    archetypeId: input.leaderArchetypeId ?? DEFAULT_ARCHETYPE,
    origin: 'playerLineage',
    sex: input.leaderSex ?? 'female',
    birthDay: birthDay as WorldDay,
    lifeState: 'alive',
    availability: 'available',
    parentIds: [],
    childIds: [],
    innateTraitIds: [],
    reputation: 0,
    // bring-up：HP/MP 以固定值起手（正式開局由 progression capacity 決定上限）。
    condition: { health: 100, mana: 50, statuses: [] },
    revision: 0 as Revision,
    lifecycleRevisions: { adulthood: 0 as Revision, retirementCheck: 0 as Revision, naturalDeathCheck: 0 as Revision },
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

  const base = createEmptyGameState({ worldSeed: input.worldSeed, startDay, team: teamState });
  const state: GameState = {
    ...base,
    character: createCharacterState({ characters: [leader] }),
    // 隊長的成長檔（空 masteries）——正式開局會由 archetype 播種，此處先確保查詢有記錄可讀、不為 undefined。
    progression: {
      ...base.progression,
      characterProgress: {
        ...base.progression.characterProgress,
        [leaderId]: createCharacterProgression(leaderId),
      },
    },
    core: { ...base.core, nextRuntimeSequence: currentCursor() },
  };

  return { state, playerTeamId, leaderId };
}
