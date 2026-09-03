// app/content/live-combat-wiring.test.ts
// F3 整合塊·live 戰鬥接線端到端：真實 Content Pack（core + yunhua）＋ NewGameBootstrapper 的真實
// 開局狀態 → 正式 ContextAssembler 組出 combat context → 兩項證據：
//   1. CombatFormationQuery ← CharacterStatsQuery ← 派生統計引擎：隊長的上限 HP/MP 由引擎依「空熟練 +
//      無裝備 + 主屬全 0」算出 BM 值（生命 200 = 200 + 0×20、魔力 120 = 120 + 0×14），起手 HP/MP 取自
//      character 條件。這證明 statistics 引擎 → CharacterStatsQuery → CombatFormationQuery 一路在真實內容上通。
//   2. 完整 StartCombatEncounter：以真實遭遇組建出一場遭遇，玩家戰鬥員帶著引擎算出的上限 HP，敵方戰鬥員
//      由遭遇組的怪物產生。這是「開場主路能在真實內容上跑起來」的端到端證據（傷害數值已由
//      combat-resolver-bridge 測試單獨證過 = 25）。
//   3. inventory context：負重上限由派生統計 calculateCarryCapacity 算出（BM 30），team 成員/旅行狀態
//      轉接真實 team Slice——equipItem／configureWeaponSet 的 context bag 已在真實狀態上組得出來。
//
// 為什麼用 bootstrap 狀態而非手搭 fixture：這條路徑要證的正是「跨模組 Query adapter 讀真實 sibling
// Slice」——character/progression/inventory/team 都必須是真的開局 Slice，手搭 stub 會把要證的接線繞過去。

import { resolve } from 'node:path';

import type {
  CharacterArchetypeId,
  CityId,
  CombatantId,
  ContentInstanceId,
  EncounterGroupDefinitionId,
  MapInstanceId,
  Revision,
  RngContext,
  RngCursor,
  RngStreamId,
  Seed,
} from '../../contracts/core';
import { loadContentFromDisk } from '../../platform/content-repository';
import { deterministicRng } from '../../kernel/rng';
import { handleStartCombatEncounter, type StartCombatEncounterCommand } from '../../modules/combat/public';
import { createNewGame, type NewGameConfig } from '../composition/new-game-bootstrap';
import { createIdPortsForBootstrap, type EngineRuntime } from '../composition/session';
import { createProductionContextAssembler } from './context-assembler';
import { createProductionResolverRegistry } from './resolver-registrations';

const CONTENT_ROOT = resolve(import.meta.dirname, '../../../content');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// 開新遊戲設定：真實 core archetype + 真實 yunhua 城市（見 new-game-bootstrap.test.ts）。
const CONFIG: NewGameConfig = {
  worldSeed: 'f3-live-combat',
  startDay: 14600,
  startingArchetypeId: 'character-archetype.core.player-lineage' as CharacterArchetypeId,
  startCityId: 'city-node.yunhua.yunjing' as CityId,
  leaderSex: 'female',
  leaderBirthDay: 5475,
  startingMoney: 500,
};

// 真實 yunhua 遭遇組（見 content/yunhua/monsters.json）。
const ENCOUNTER_GROUP = 'encounter-group.yunhua.mistwing-moth-swarm' as EncounterGroupDefinitionId;

export function runTests(): void {
  const loaded = loadContentFromDisk(CONTENT_ROOT);
  if (!loaded.success) throw new Error('內容載入失敗');
  const resolvers = createProductionResolverRegistry(loaded.resolverBindings);

  const game = createNewGame(CONFIG, loaded.registry, resolvers);
  assert(game.success, `開新遊戲應成功：${game.success ? '' : JSON.stringify(game.diagnostics)}`);
  if (!game.success) return;
  const { state, playerTeamId, leaderId } = game;

  // 組正式 ContextAssembler，並以 bootstrap 之後的 cursor 續號建一個 runtime（與 session 的注入形狀相同）。
  const assembler = createProductionContextAssembler(loaded.registry, resolvers);
  const worldSeed = CONFIG.worldSeed as Seed;
  const { ids } = createIdPortsForBootstrap(worldSeed, state.core.nextRuntimeSequence);
  const rngContextFor = (tag: string): RngContext => ({
    worldSeed,
    streamId: `rng:live-combat:${tag}` as RngStreamId,
    cursor: 0 as RngCursor,
  });
  const runtime: EngineRuntime = {
    worldSeed,
    worldDay: state.core.worldDay,
        transactionId: 'test-transaction' as never,
    ids,
    rng: deterministicRng,
    rngContextFor,
  };

  const ctx = assembler(runtime, state);

  // ── 證據 1：CombatFormationQuery ← CharacterStatsQuery ← 派生統計引擎（真實內容 + 真實開局狀態）──
  const formation = ctx.combat.formation.getPlayerFormation(playerTeamId);
  assert(formation.members.length === 1, `應恰一名成員，實得 ${formation.members.length}`);
  const member = formation.members[0]!;
  assert(String(member.characterId) === leaderId, `成員應為隊長 ${leaderId}，實得 ${String(member.characterId)}`);
  // 空熟練（主屬全 0）＋無裝備 → safeRaw 0 → BM：生命 200 + 0×20 = 200、魔力 120 + 0×14 = 120。
  assert(member.maxHealth === 200, `隊長 maxHealth 應 200（引擎算），實得 ${member.maxHealth}`);
  assert(member.maxMana === 120, `隊長 maxMana 應 120（引擎算），實得 ${member.maxMana}`);
  // 起手 HP/MP 取自 character 條件。開局角色是滿的，而「滿」由同一支派生統計引擎算出來
  // （原本 bootstrap 寫死 100/50，那是程式裡的玩法數字，已改為引擎值）。
  assert(
    member.startHealth === member.maxHealth,
    `隊長開局應滿血（${member.maxHealth}），實得 ${member.startHealth}`,
  );
  assert(
    member.startMana === member.maxMana,
    `隊長開局應滿魔（${member.maxMana}），實得 ${member.startMana}`,
  );
  // 站位取自 team 的 combatFormation（bootstrap 置於 row 1 前排）。
  assert(member.cell.row === 1, `隊長站位 row 應 1，實得 ${member.cell.row}`);

  // ── 證據 2：完整 StartCombatEncounter 以真實遭遇組建出一場遭遇 ────────────────────────────
  const cmd: StartCombatEncounterCommand = {
    type: 'StartCombatEncounter',
    teamId: playerTeamId,
    source: {
      kind: 'mapContent',
      mapId: 'runtime:map-instance:live-combat' as MapInstanceId,
      contentId: 'runtime:content-instance:live-combat' as ContentInstanceId,
      encounterGroupId: ENCOUNTER_GROUP,
    },
    participantSnapshotRevision: 0 as Revision,
    rngContext: rngContextFor('combat.start'),
  };
  const outcome = handleStartCombatEncounter(state.combat, cmd, ctx.combat);
  assert(outcome.ok, `StartCombatEncounter 應成功，實得拒絕 ${outcome.ok ? '' : outcome.rejection.code}`);
  if (!outcome.ok) return;

  const encounters = Object.values(outcome.result.nextSlice.encounters);
  assert(encounters.length === 1, `應建出恰一場遭遇，實得 ${encounters.length}`);
  const encounter = encounters[0]!;
  const combatants = Object.values(encounter.combatants);

  // 玩家戰鬥員：隊長，帶引擎算出的上限 HP（200）；開局是滿的。
  const playerCombatant = combatants.find(
    (c) => c.source.kind === 'character' && String(c.source.characterId) === leaderId,
  );
  assert(playerCombatant !== undefined, '遭遇中應有隊長的玩家戰鬥員');
  assert(playerCombatant!.maxHealth === 200, `玩家戰鬥員 maxHealth 應 200（引擎算），實得 ${playerCombatant!.maxHealth}`);
  assert(
    playerCombatant!.health === playerCombatant!.maxHealth,
    `玩家戰鬥員開局應滿血（${playerCombatant!.maxHealth}），實得 ${playerCombatant!.health}`,
  );

  // 敵方戰鬥員：由遭遇組的怪物產生，至少一名，帶怪物定義的生命值。
  const enemyCombatants = combatants.filter((c) => c.side === 'enemy');
  assert(enemyCombatants.length >= 1, `應由遭遇組產生至少一名敵方戰鬥員，實得 ${enemyCombatants.length}`);
  assert(
    enemyCombatants.every((c) => c.maxHealth > 0 && c.health === c.maxHealth),
    '敵方戰鬥員應帶正的怪物生命值且滿血開場',
  );

  // 開場 CTB 已套用（每個戰鬥員都有非負 currentCtb；主路已跑到 applyOpeningCtb）。
  assert(
    combatants.every((c) => c.currentCtb >= 0),
    '所有戰鬥員應已套開場 CTB（currentCtb ≥ 0）',
  );

  // ── 證據 3：inventory context（equipItem／configureWeaponSet 的 bag）——負重上限由派生統計算，
  //    team 成員/旅行狀態轉接真實 team Slice ────────────────────────────────────────────────
  const teamMembers = ctx.inventory.getTeamMembers(playerTeamId);
  assert(teamMembers.some((c) => String(c) === leaderId), `inventory.getTeamMembers 應含隊長，實得 ${teamMembers.map(String).join(',')}`);
  assert(ctx.inventory.isTeamTravelling(playerTeamId) === false, '開局在城市 → isTeamTravelling 應為 false');
  const capacity = ctx.inventory.getCarryCapacity(member.characterId);
  // 負重上限 = 30 + 肌力(0)×1.5 = 30（BM carry-capacity-rule；空熟練 → 肌力 0）。
  assert(capacity.maximumWeight === 30, `隊長負重上限應 30（引擎算），實得 ${capacity.maximumWeight}`);

  // ── 證據 4：quest context（acceptQuest 的 bag）——三個唯讀 Port 轉接真實 team/map/character Slice ──
  assert(ctx.quest.teams.getLocation(playerTeamId).kind === 'city', 'quest.teams.getLocation 應回城市（開局在城市）');
  assert(
    ctx.quest.teams.listFormalMembers(playerTeamId).some((c) => String(c) === leaderId),
    'quest.teams.listFormalMembers 應含隊長',
  );
  assert(
    ctx.quest.characters.getTemporaryOrigin(member.characterId) === undefined,
    'quest.characters.getTemporaryOrigin(隊長) 應為 undefined（隊長非臨時角色）',
  );
}
