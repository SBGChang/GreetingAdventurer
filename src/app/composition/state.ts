// app/composition/state.ts
// GameState、GameScheduledJob 與 Slice 註冊表（對應 12_engine_runtime.md §1、§3）。
//
// 這是「唯一知道全部模組」的層：領域模組只依賴 contracts/，彼此不互相 import 實作；
// 由此處把各模組的 Slice 組成單一 GameState，並提供 kernel TransactionRunner 需要的
// applyMutation（保證 Handler 只能寫自己宣告擁有的 Slice）。

import type { CoreState, JobId, ModuleId, StateSliceName } from '../../contracts/core';

import type { CharacterLifecycleJob } from '../../contracts/character';
import type { MapRefreshCheckJob } from '../../contracts/map';
import type { NpcDungeonDayJob } from '../../contracts/dungeon';
import type {
  TeamPlanDueJob,
  FreeActionDueJob,
  NonPlayerMemberCityFreeDayTickJob,
} from '../../contracts/team';

import type { CharacterState } from '../../modules/character/public';
import type { InventoryState } from '../../modules/inventory/public';
import type { ProgressionModuleState } from '../../modules/progression/public';
import type { MapState } from '../../modules/map/public';
import type { DungeonModuleState } from '../../modules/dungeon/public';
import type { CombatState } from '../../modules/combat/public';
import type { TeamState } from '../../modules/team/public';

import { emptyCharacterState } from '../../modules/character/public';
import { createInitialInventoryState } from '../../modules/inventory/public';
import { createInitialProgressionState } from '../../modules/progression/public';
import { emptyMapState } from '../../modules/map/public';
import { createInitialDungeonState } from '../../modules/dungeon/public';
import { createInitialCombatState } from '../../modules/combat/public';

// ──────────────────────────────────────────────────────────────────────────
// ScheduledJob
// ──────────────────────────────────────────────────────────────────────────

// 全遊戲 Job 聯集。未實作模組（city/quest/world/npc-behavior）的 Job 於其 Wave 補入。
export type GameScheduledJob =
  | CharacterLifecycleJob
  | MapRefreshCheckJob
  | NpcDungeonDayJob
  | TeamPlanDueJob
  | FreeActionDueJob
  | NonPlayerMemberCityFreeDayTickJob;

export type GameJobType = GameScheduledJob['type'];

// ──────────────────────────────────────────────────────────────────────────
// GameState
// ──────────────────────────────────────────────────────────────────────────

// core 由 Kernel 獨占寫入（worldDay / nextRuntimeSequence / scheduler），模組不得觸碰。
export type GameState = Readonly<{
  core: CoreState<GameScheduledJob>;

  character: CharacterState;
  inventory: InventoryState;
  progression: ProgressionModuleState;
  map: MapState;
  dungeon: DungeonModuleState;
  combat: CombatState;
  team: TeamState;
}>;

// 已實作模組的 Slice 名稱；同時是 applyMutation 的白名單。
export const IMPLEMENTED_SLICES = [
  'character',
  'inventory',
  'progression',
  'map',
  'dungeon',
  'combat',
  'team',
] as const;

export type GameSliceName = (typeof IMPLEMENTED_SLICES)[number];

// Slice 名稱 → 擁有它的模組。ModuleRegistry 於啟動時驗證「一個 Slice 恰好一個 owner」。
export const SLICE_OWNER: Readonly<Record<GameSliceName, ModuleId>> = {
  character: 'character' as ModuleId,
  inventory: 'inventory' as ModuleId,
  progression: 'progression' as ModuleId,
  map: 'map' as ModuleId,
  dungeon: 'dungeon' as ModuleId,
  combat: 'combat' as ModuleId,
  team: 'team' as ModuleId,
};

export function isGameSliceName(name: string): name is GameSliceName {
  return (IMPLEMENTED_SLICES as readonly string[]).includes(name);
}

// ──────────────────────────────────────────────────────────────────────────
// 空白 State（Bootstrap 的起點；不含任何內容，由 NewGameBootstrapper 逐步填入）
// ──────────────────────────────────────────────────────────────────────────

export type CreateEmptyGameStateInput = Readonly<{
  worldSeed: string;
  startDay?: number;
  team: TeamState;
}>;

export function createEmptyGameState(input: CreateEmptyGameStateInput): GameState {
  return {
    core: {
      worldDay: input.startDay ?? 0,
      worldSeed: input.worldSeed,
      nextRuntimeSequence: 0 as CoreState<GameScheduledJob>['nextRuntimeSequence'],
      scheduler: { jobsById: {} as Readonly<Record<JobId, GameScheduledJob>>, revision: 0 },
    },
    character: emptyCharacterState,
    inventory: createInitialInventoryState(),
    progression: createInitialProgressionState(),
    map: emptyMapState,
    dungeon: createInitialDungeonState(),
    combat: createInitialCombatState(),
    // team 沒有「空」狀態：它必須知道玩家隊伍，故由呼叫者建好傳入。
    team: input.team,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// applyMutation（注入 kernel TransactionRunner）
// ──────────────────────────────────────────────────────────────────────────

// Handler 只回傳自己那片 Slice。此處是唯一的合併點，並強制：
//   1. sliceName 必須是已註冊的 Slice（打錯字或跨界寫入 = 啟動／執行期錯誤，不靜默忽略）。
//   2. 不允許寫入 `core`——core 由 Kernel 獨占（00_shared_contracts.md §6.2）。
export function applyMutation(
  state: GameState,
  mutation: Readonly<{ sliceName: string; nextSlice: unknown }>,
): GameState {
  const name = mutation.sliceName;
  if (name === 'core') {
    throw new Error('applyMutation: core Slice 由 Kernel 獨占寫入，模組不得回傳 core mutation');
  }
  if (!isGameSliceName(name)) {
    throw new Error(`applyMutation: 未註冊的 Slice "${name}"`);
  }
  // nextSlice 的具體型別由該模組的 Handler 保證；此處只做結構性合併。
  return { ...state, [name]: mutation.nextSlice } as GameState;
}

// 供 ModuleRegistry 驗證使用：宣告的 owns 是否與 SLICE_OWNER 一致。
// StateSliceName 是 branded string，先去 brand 再比對（brand 只是宣告用途標記）。
export function sliceOwnerOf(name: StateSliceName): ModuleId | undefined {
  const plain = name as string;
  return isGameSliceName(plain) ? SLICE_OWNER[plain] : undefined;
}
