// app/composition/new-game-bootstrap.test.ts
// 證明 NewGameBootstrapper 能從**磁碟上的真實 Content Pack**（core + yunhua）開出一個新遊戲，
// 且缺內容時明確失敗（不靜默給預設）。這是 F3「讓引擎在真實內容上跑起來」的第一個端到端證據。

import { resolve } from 'node:path';

import type { CharacterArchetypeId, CityId } from '../../contracts/core';
import { loadContentFromDisk } from '../../platform/content-repository';
import { createNewGame, type NewGameConfig } from './new-game-bootstrap';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const CONTENT_ROOT = resolve(import.meta.dirname, '../../../content');

// 這些 ID 出現在**測試**裡是斷言內容、以及扮演「開新遊戲畫面的選擇」——不是正式路徑在決定內容。
const PLAYER_LINEAGE = 'character-archetype.core.player-lineage' as CharacterArchetypeId;
const CAPITAL = 'city-node.yunhua.yunjing' as CityId;

// 成年天數 5475（見 lifecycle-rule.core.standard）；startDay 取更大值確保開局成年。
const BASE_CONFIG: NewGameConfig = {
  worldSeed: 'f3-newgame-test',
  startDay: 8000,
  startingArchetypeId: PLAYER_LINEAGE,
  startCityId: CAPITAL,
  leaderSex: 'female',
  leaderBirthDay: 0,
};

type Case = Readonly<{ name: string; run: () => void }>;

const CASES: readonly Case[] = [
  {
    name: '開新遊戲：真實 core + yunhua pack 開得出一個結構良好的 GameState',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error(`內容載入失敗：${JSON.stringify(loaded.diagnostics).slice(0, 300)}`);

      const result = createNewGame(BASE_CONFIG, loaded.registry);
      assert(result.success, `開新遊戲應成功，實得 ${result.success ? '' : JSON.stringify(result.diagnostics)}`);
      if (!result.success) return;

      const { state, playerTeamId, leaderId } = result;
      // 世界日取自 config。
      assert(state.core.worldDay === 8000, `worldDay 應為 8000，實得 ${state.core.worldDay}`);
      // 玩家隊存在且在指定城市。
      const team = state.team.teams[playerTeamId];
      assert(team !== undefined, '玩家隊應存在');
      assert(team!.location.kind === 'city', '玩家隊應在城市');
      assert(
        team!.location.kind === 'city' && String(team!.location.cityId) === String(CAPITAL),
        '玩家隊應在雲京',
      );
      // 隊長存在、掛在正確 archetype、是正式成員、有站位。
      const leader = state.character.characters[leaderId as never];
      assert(leader !== undefined, '隊長角色應存在');
      assert(
        String(leader!.archetypeId) === String(PLAYER_LINEAGE),
        `隊長 archetype 應為 player-lineage，實得 ${String(leader!.archetypeId)}`,
      );
      assert(team!.memberIds.includes(leaderId as never), '隊長應是正式成員');
      const formation = state.team.combatFormations[playerTeamId];
      assert(formation !== undefined && formation!.placements[leaderId as never] !== undefined, '隊長應有站位');
      // 成長檔已播種（查詢有記錄可讀，不為 undefined）。
      assert(state.progression.characterProgress[leaderId as never] !== undefined, '隊長成長檔應已播種');
      // nextRuntimeSequence 已由 bootstrap cursor 推進（鑄了 2 個 ID：leader + team）。
      assert(state.core.nextRuntimeSequence >= 2, `nextRuntimeSequence 應 ≥ 2，實得 ${state.core.nextRuntimeSequence}`);
    },
  },
  {
    name: '缺內容：起始 archetype 不存在 → 明確失敗，不靜默給預設',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error('內容載入失敗');
      const result = createNewGame(
        { ...BASE_CONFIG, startingArchetypeId: 'character-archetype.core.does-not-exist' as CharacterArchetypeId },
        loaded.registry,
      );
      assert(!result.success, '不存在的 archetype 應導致開新遊戲失敗');
      if (result.success) return;
      assert(
        result.diagnostics.some((d) => d.code === 'newGame/archetype-missing'),
        `應回 archetype-missing，實得 ${result.diagnostics.map((d) => d.code).join(', ')}`,
      );
    },
  },
  {
    name: '所有權守門：用非 city-node 的 id 當起始城市 → 明確失敗',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error('內容載入失敗');
      // 拿一個真的存在、但 kind 不是 city-node 的 id（archetype）當城市。
      const result = createNewGame(
        { ...BASE_CONFIG, startCityId: PLAYER_LINEAGE as unknown as CityId },
        loaded.registry,
      );
      assert(!result.success, '非 city-node 的起始城市應失敗');
      if (result.success) return;
      assert(
        result.diagnostics.some((d) => d.code === 'newGame/start-city-not-city-node'),
        `應回 start-city-not-city-node，實得 ${result.diagnostics.map((d) => d.code).join(', ')}`,
      );
    },
  },
  {
    name: '開新遊戲是決定性的：同 config + 同 pack → 同 leaderId 與 worldDay',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error('內容載入失敗');
      const a = createNewGame(BASE_CONFIG, loaded.registry);
      const b = createNewGame(BASE_CONFIG, loaded.registry);
      assert(a.success && b.success, '兩次都應成功');
      if (!a.success || !b.success) return;
      assert(a.leaderId === b.leaderId, `leaderId 應決定性相同，實得 ${a.leaderId} vs ${b.leaderId}`);
      assert(a.state.core.worldDay === b.state.core.worldDay, 'worldDay 應相同');
    },
  },
];

export type NewGameBootstrapResult = Readonly<{ name: string; pass: boolean; error?: string }>;

export function runTestResults(): readonly NewGameBootstrapResult[] {
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
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? 'unknown'}`).join('\n');
    throw new Error(`new-game-bootstrap tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
