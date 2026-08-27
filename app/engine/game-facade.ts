// app/engine/game-facade.ts
// UI 與引擎之間的窄門面。UI 只認這裡的三個東西：開新遊戲、下指令、把 GameState 投影成畫面用的
// ViewModel。引擎的型別細節不外洩到 React 元件。
//
// 這一層跑在 renderer（瀏覽器），所以只用**純函式**引擎面（loadBundledContent / createNewGame /
// runGameCommand / createProductionContextAssembler）——不碰 node:fs。

import { createResolverRegistry, type DefinitionRegistry } from '../../src/data-runtime';
import { createProductionContextAssembler } from '../../src/app/content/context-assembler';
import { createNewGame, type NewGameConfig } from '../../src/app/composition/new-game-bootstrap';
import { runGameCommand, runDueJob, type ContextAssembler } from '../../src/app/composition/session';
import type { GameState } from '../../src/app/composition/state';
import type { GameCommand } from '../../src/app/composition/messages';
import type { GameCommandRequest } from '../../src/contracts/core';
import { loadBundledContent } from './content-browser';

// ── 畫面用 ViewModel（把 GameState 投影成 UI 要的最小資訊）───────────────────
export type LeaderView = Readonly<{
  id: string;
  archetypeId: string;
  sex: string;
  health: number;
  mana: number;
}>;

export type GameView = Readonly<{
  worldDay: number;
  cityId: string;
  leader: LeaderView | undefined;
  memberCount: number;
  scheduledJobs: number;
  // 已接線、目前能下的指令（隨 F3 逐模組接上而變多）。
  availableCommands: readonly string[];
}>;

export function projectView(state: GameState): GameView {
  const playerTeamId = state.team.playerTeamId;
  const team = state.team.teams[playerTeamId];
  const leaderId = team?.leaderId;
  const leaderChar = leaderId === undefined ? undefined : state.character.characters[leaderId];
  const leader: LeaderView | undefined =
    leaderChar === undefined
      ? undefined
      : {
          id: String(leaderChar.characterId),
          archetypeId: String(leaderChar.archetypeId),
          sex: leaderChar.sex,
          health: leaderChar.condition.health,
          mana: leaderChar.condition.mana,
        };
  const cityId = team !== undefined && team.location.kind === 'city' ? String(team.location.cityId) : '（不在城市）';
  return {
    worldDay: state.core.worldDay,
    cityId,
    leader,
    memberCount: team?.memberIds.length ?? 0,
    scheduledJobs: Object.keys(state.core.scheduler.jobsById).length,
    // F3 目前接線範圍：team 的 rest / startCityTravel。之後接上更多模組就在這裡加。
    availableCommands: ['rest', 'startCityTravel'],
  };
}

// ── 遊戲控制代 ──────────────────────────────────────────────────────────────
export type CommandOutcome =
  | Readonly<{ accepted: true; view: GameView }>
  | Readonly<{ accepted: false; rejectionCode: string; view: GameView }>;

export type AdvanceOutcome =
  | Readonly<{ advanced: true; toDay: number; jobType: string; view: GameView }>
  | Readonly<{ advanced: false; reason: string; view: GameView }>;

export type GameHandle = Readonly<{
  view: GameView;
  runCommand: (command: GameCommand) => CommandOutcome;
  // 推進時間到「下一筆到期 Job」並執行它（真實引擎的快轉：見 travel-integration 的自驅迴圈）。
  advanceTime: () => AdvanceOutcome;
}>;

// 載入內容一次，之後開新遊戲／下指令都重用。載入失敗時 throw（缺內容不啟動，§出口 2）——
// UI 端 catch 後顯示診斷。
export function createGame(config: NewGameConfig): GameHandle {
  const loaded = loadBundledContent();
  if (!loaded.success) {
    throw new Error(`內容載入失敗：${loaded.diagnostics.map((d) => d.code).join(', ')}`);
  }
  const registry: DefinitionRegistry = loaded.registry;
  const assembler: ContextAssembler = createProductionContextAssembler(registry, createResolverRegistry());

  const started = createNewGame(config, registry);
  if (!started.success) {
    throw new Error(`開新遊戲失敗：${started.diagnostics.map((d) => d.code).join(', ')}`);
  }

  // GameState 在這個 closure 裡演進（單機、單一存檔的最小模型）。
  let state: GameState = started.state;
  const playerTeamId = started.playerTeamId;

  const runCommand = (command: GameCommand): CommandOutcome => {
    const request: GameCommandRequest<GameCommand> = { actorTeamId: playerTeamId, command };
    const result = runGameCommand(state, request, assembler);
    if (result.accepted) {
      state = result.state;
      return { accepted: true, view: projectView(state) };
    }
    return { accepted: false, rejectionCode: result.rejection.code, view: projectView(state) };
  };

  // 推進時間：挑最早到期的 Job，把世界日設到它的到期日，執行它。這就是引擎的「快轉」——
  // worldDay 由 kernel 擁有，呼叫端負責把時鐘撥到到期日再 runDueJob（travel-integration.test 同法）。
  const advanceTime = (): AdvanceOutcome => {
    const jobs = Object.values(state.core.scheduler.jobsById);
    if (jobs.length === 0) {
      return { advanced: false, reason: '沒有排定中的事件可推進', view: projectView(state) };
    }
    const earliest = jobs.reduce((a, b) => (b.dueDay < a.dueDay ? b : a));
    const atDueDay: GameState = { ...state, core: { ...state.core, worldDay: earliest.dueDay } };
    const result = runDueJob(atDueDay, earliest, assembler);
    if (result.accepted) {
      state = result.state;
      return { advanced: true, toDay: Number(earliest.dueDay), jobType: earliest.type, view: projectView(state) };
    }
    // 被拒：不撥動時鐘（Job 留在佇列），把原因交給 UI。
    return { advanced: false, reason: result.rejection.code, view: projectView(state) };
  };

  return { view: projectView(state), runCommand, advanceTime };
}
