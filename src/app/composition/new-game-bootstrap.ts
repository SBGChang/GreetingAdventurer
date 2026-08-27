// app/composition/new-game-bootstrap.ts
// NewGameBootstrapper（12_engine_runtime.md §1.1）：從**真實 Content Pack** 開一個新遊戲。
//
// 與 `src/testing/composition/bring-up-bootstrap.ts` 的差別（後者刻意住在 testing/ 且不受依賴圖檢查）：
//   * bring-up 用假 archetype（`definition:character-archetype:founder`）、固定 HP/MP、不驗內容。
//   * 這一支是**正式路徑**：起始 archetype 與城市必須真的存在於 Content Pack，否則**不開新遊戲**
//     （規範五個合法出口的第 2 項：Content Pack 驗證失敗），而不是靜默給預設。
//
// 設計要點：
//   * **不硬編碼「玩家從哪個 archetype／哪座城開始」**——那是 new-game 設定，屬呼叫端（F4 的開新遊戲
//     畫面，或未來的 starting-scenario 定義）的選擇。本函式收 `NewGameConfig` 參數，只負責驗證 +
//     組裝。因此本檔沒有任何內容 ID 字面值。
//   * 初始主屬性**不由 archetype 帶值**：主屬性是 mastery 的推導值（progression.derivePrimaryAttributes），
//     新角色 masteries 為空 → 全 0。這與 GDD「主屬性是推導值」一致，不是缺資料。
//   * archetype 的 `lifecycleRuleId` 決定成年／退休／自然死亡的規則；lifecycle Job 的排程在
//     下一個增量補（需接上 scheduler；bring-up 也還沒排，引擎仍能跑）。

import type {
  CharacterArchetypeId,
  CityId,
  Revision,
  RuntimeIdCursor,
  Seed,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type { DefinitionRegistry } from '../../data-runtime';
import type { Character, Sex } from '../../modules/character/public';
import { createCharacterState } from '../../modules/character/public';
import { createCharacterProgression } from '../../modules/progression/public';
import type { Team, TeamCombatFormation } from '../../modules/team/public';
import { createTeamState } from '../../modules/team/public';
import { createCharacterDefinitionReader } from '../content/character-reader';
import { createWorldDefinitionReader } from '../content/world-reader';

import { createIdPortsForBootstrap } from './session';
import { createEmptyGameState, type GameState } from './state';

// 開新遊戲的設定：**由呼叫端提供**（開新遊戲畫面／scenario 定義），不是 Bootstrapper 自己決定。
export type NewGameConfig = Readonly<{
  worldSeed: string;
  // 世界從第幾天開始（曆法起點是內容，見 state.ts 的說明）。要讓隊長開局成年，startDay 需 ≥ 成年天數。
  startDay: number;
  // 玩家主角的起始 archetype 與所在城市——必須存在於 Content Pack。
  startingArchetypeId: CharacterArchetypeId;
  startCityId: CityId;
  leaderSex: Sex;
  // 隊長出生日。**必填**——隊長的起始年齡是開新遊戲的選擇，Bootstrapper 不替它發明預設
  // （原本寫 `?? 0`，被紀律門禁擋下：0 在這裡是猜的玩法值，不是結構不變量）。
  leaderBirthDay: number;
}>;

export type NewGameDiagnostic = Readonly<{ code: string; detail: string }>;

export type NewGameResult =
  | Readonly<{ success: true; state: GameState; playerTeamId: TeamId; leaderId: string }>
  | Readonly<{ success: false; diagnostics: readonly NewGameDiagnostic[] }>;

function fail(diagnostics: readonly NewGameDiagnostic[]): NewGameResult {
  return { success: false, diagnostics };
}

export function createNewGame(config: NewGameConfig, registry: DefinitionRegistry): NewGameResult {
  const diagnostics: NewGameDiagnostic[] = [];

  // ── 輸入結構驗證（非內容問題，是呼叫端傳錯）───────────────────────────────
  if (config.worldSeed.trim() === '') {
    diagnostics.push({ code: 'newGame/empty-seed', detail: 'worldSeed 不可為空' });
  }
  const birthDay = config.leaderBirthDay;
  if (!Number.isInteger(config.startDay) || config.startDay < 0) {
    diagnostics.push({ code: 'newGame/invalid-start-day', detail: `startDay 需為非負整數（實得 ${config.startDay}）` });
  }
  if (!Number.isInteger(birthDay) || birthDay < 0 || birthDay > config.startDay) {
    diagnostics.push({
      code: 'newGame/invalid-birth-day',
      detail: `leaderBirthDay(${birthDay}) 需為非負整數且不晚於 startDay(${config.startDay})`,
    });
  }
  if (diagnostics.length > 0) return fail(diagnostics);

  // ── 內容存在性驗證（缺 → 不開新遊戲，§出口 2）─────────────────────────────
  const characters = createCharacterDefinitionReader(registry);
  const world = createWorldDefinitionReader(registry);

  // archetype 必須存在、可成為冒險者、且非「僅限臨時角色」。窄化 Reader 對未註冊 id 會拋，
  // 所以先問 registry 是否有，再取型別化 View——不吞例外、也不假設它存在。
  if (!registry.has(config.startingArchetypeId)) {
    diagnostics.push({
      code: 'newGame/archetype-missing',
      detail: `起始 archetype "${String(config.startingArchetypeId)}" 不存在於 Content Pack`,
    });
  }
  if (!registry.has(config.startCityId)) {
    diagnostics.push({
      code: 'newGame/start-city-missing',
      detail: `起始城市 "${String(config.startCityId)}" 不存在於 Content Pack`,
    });
  }
  if (diagnostics.length > 0) return fail(diagnostics);

  const archetype = characters.getArchetype(config.startingArchetypeId);
  if (!archetype.canBecomeAdventurer) {
    diagnostics.push({
      code: 'newGame/archetype-not-playable',
      detail: `archetype "${String(config.startingArchetypeId)}" 的 canBecomeAdventurer 為 false，不能當玩家主角`,
    });
  }
  if (archetype.temporaryOnly) {
    diagnostics.push({
      code: 'newGame/archetype-temporary-only',
      detail: `archetype "${String(config.startingArchetypeId)}" 是 temporaryOnly，不能當玩家主角`,
    });
  }
  // archetype 指名的 lifecycle 規則也必須存在——它決定成年／退休／自然死亡，缺了開局就不完整。
  if (!registry.has(archetype.lifecycleRuleId)) {
    diagnostics.push({
      code: 'newGame/lifecycle-rule-missing',
      detail: `archetype 指名的 lifecycle 規則 "${String(archetype.lifecycleRuleId)}" 不存在`,
    });
  }
  // startCity 必須真的是一座城市節點（不是別的 kind 的 id 剛好同名）。
  if (registry.kindOf(config.startCityId) !== 'city-node') {
    diagnostics.push({
      code: 'newGame/start-city-not-city-node',
      detail: `"${String(config.startCityId)}" 不是 city-node（實得 kind ${String(registry.kindOf(config.startCityId))}）`,
    });
  }
  if (diagnostics.length > 0) return fail(diagnostics);

  // 用一次以確認 city-node 讀得出來（壞內容會在此拋，而不是留到執行期）。
  world.getCityNode(config.startCityId);

  // ── 組裝 State ──────────────────────────────────────────────────────────
  const worldSeed = config.worldSeed as Seed;
  const { ids, currentCursor } = createIdPortsForBootstrap(worldSeed, 0 as RuntimeIdCursor);
  const leaderId = ids.character.nextCharacterId();
  const playerTeamId = ids.team.nextTeamId();

  const leader: Character = {
    characterId: leaderId,
    archetypeId: config.startingArchetypeId,
    origin: 'playerLineage',
    sex: config.leaderSex,
    birthDay: birthDay as WorldDay,
    lifeState: 'alive',
    availability: 'available',
    parentIds: [],
    childIds: [],
    innateTraitIds: [],
    reputation: 0,
    // HP/MP 上限最終由 progression capacity 決定；開局先給非零起手值，capacity 事件會夾正。
    condition: { health: 100, mana: 50, statuses: [] },
    revision: 0 as Revision,
    lifecycleRevisions: {
      adulthood: 0 as Revision,
      retirementCheck: 0 as Revision,
      naturalDeathCheck: 0 as Revision,
    },
  };

  const playerTeam: Team = {
    teamId: playerTeamId,
    control: 'player',
    memberIds: [leaderId],
    temporaryMemberIds: [],
    leaderId,
    location: { kind: 'city', cityId: config.startCityId },
    revision: 0 as Revision,
  };

  const formation: TeamCombatFormation = {
    teamId: playerTeamId,
    placements: { [leaderId]: { floor: 0, row: 1, col: 1 } },
    revision: 0 as Revision,
  };

  const teamState = createTeamState({
    playerTeamId,
    teams: [playerTeam],
    combatFormations: [formation],
  });

  const base = createEmptyGameState({ worldSeed: config.worldSeed, startDay: config.startDay, team: teamState });
  const state: GameState = {
    ...base,
    character: createCharacterState({ characters: [leader] }),
    progression: {
      ...base.progression,
      characterProgress: {
        ...base.progression.characterProgress,
        [leaderId]: createCharacterProgression(leaderId),
      },
    },
    core: { ...base.core, nextRuntimeSequence: currentCursor() },
  };

  return { success: true, state, playerTeamId, leaderId: String(leaderId) };
}
