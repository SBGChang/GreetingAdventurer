// modules/combat/state.ts
// Combat 模組唯一可寫 State slice + 執行期實體 + 初始工廠。
// 對應 docs/00_core/architecture/11_combat_module.md §1.1、§3。
//
// 契約 combat/index.ts 只轉寫「對外可見」型別（View / Command / Event / Definition）。
// CombatEncounter / CombatantState / CombatGridState 是模組「具體擁有」的 Runtime State，
// 文件 §3 以 prose 描述、契約檔未輸出，因此在此完整定義。
//
// 模組私有擴充（超出文件 §3.1 欄位，用來讓「結束時一次結算」成為可重播事實）：
//   - participantCharacterIds：開場正式成員（不變量 14 的 payload 來源）。
//   - defenseFormationRows   ：開戰初始站位的「角色→有人排」快照（§8.6 防禦 3/2/1 權重）。
//   - attackDamageByCharacter：本場每位角色造成的有效傷害（§8.6 攻擊 MXP 依比例分配）。
// 這三份都在 §9 結束交易時讀取一次，不逐招寫回其他模組。

import type {
  EncounterId,
  CombatantId,
  CharacterId,
  RuntimeEnemyId,
  MonsterDefinitionId,
  WeaponSetId,
  SkillDefinitionId,
  CombatEffectDefinitionId,
  MasteryId,
  ActionDelayRuleId,
  TeamId,
  Revision,
  RngContext,
  ResolverId,
} from '../../contracts/core';
import type {
  CombatEncounterSource,
  CombatStatusInstance,
  CombatFootprint,
} from '../../contracts/combat';
import type { GridCell } from '../../contracts/map';

// ── 唯一可寫 State（文件 §1.1）────────────────────────────────────────────
export type CombatState = Readonly<{
  encounters: Readonly<Record<EncounterId, CombatEncounter>>;
}>;

// ── 反擊架勢 / 讀條（文件 §3.2 引用但契約未輸出；此處為 Runtime 實體）─────────
export type CounterStanceInstance = Readonly<{
  skillId: SkillDefinitionId;
  conditionResolverId: ResolverId;
  counterDelayRuleId: ActionDelayRuleId;
  // 條件成功時解析的效果（來自建立架勢那招 Skill 的 effectIds）。
  counterEffectIds: readonly CombatEffectDefinitionId[];
}>;

export type CastingInstance = Readonly<{
  skillId: SkillDefinitionId;
  actionKind: 'cast' | 'perform';
  targetCombatantIds: readonly CombatantId[];
  // 讀條剩餘的實際 CTB；interruptCasting 以資料延遲結束此讀條。
  remainingDelay: number;
}>;

export type CombatantSource =
  | Readonly<{ kind: 'character'; characterId: CharacterId }>
  | Readonly<{
      kind: 'monster';
      monsterDefinitionId: MonsterDefinitionId;
      runtimeEnemyId: RuntimeEnemyId;
    }>;

export type CombatantLifecycle = 'ready' | 'acting' | 'incapacitated' | 'dead';
export type CombatSide = 'player' | 'enemy';

// ── Combatant Runtime State（文件 §3.2）──────────────────────────────────
export type CombatantState = Readonly<{
  combatantId: CombatantId;
  source: CombatantSource;
  side: CombatSide;
  footprint: CombatFootprint;
  anchorCell: GridCell;

  health: number;
  maxHealth: number; // 快照上限（heal 夾住用）；文件 §3.2 未列，但恢復需上限，故隨快照保存。
  mana: number;
  currentCtb: number; // 可超過 100，不做 UI clamp（不變量 5）
  externalCtbIncreaseSinceOwnAction: number;
  interruptionImmuneUntilOwnAction: boolean;
  activeWeaponSetId?: WeaponSetId;
  activeStatuses: readonly CombatStatusInstance[];
  counterStance?: CounterStanceInstance;
  casting?: CastingInstance;
  state: CombatantLifecycle;
  revision: Revision;
}>;

// ── 九宮格（文件 §3.3）──────────────────────────────────────────────────
export type CombatGridState = Readonly<{
  width: 3;
  height: 3;
  // key = cellKey(cell)；dead 單位移出 occupancy，ready/acting/incapacitated 仍占格。
  occupancy: Readonly<Record<string, CombatantId>>;
}>;

// ── 開戰初始站位快照（§8.6 防禦權重用；補位不改本快照）────────────────────
export type DefenseFormationEntry = Readonly<{ characterId: CharacterId; row: number }>;

// ── Encounter Runtime State（文件 §3.1 + 模組私有結算快照）──────────────────
export type CombatEncounter = Readonly<{
  encounterId: EncounterId;
  source: CombatEncounterSource;
  playerTeamId: TeamId;
  playerFormationRevision: Revision;
  combatants: Readonly<Record<CombatantId, CombatantState>>;
  playerGrid: CombatGridState;
  enemyGrid: CombatGridState;
  state: 'initializing' | 'active' | 'awaitingPlayerCommand' | 'resolved';
  currentActorId?: CombatantId;
  readyQueue: readonly CombatantId[];
  supportMasteryUseCounts: Readonly<Record<CharacterId, Readonly<Record<SkillDefinitionId, number>>>>;
  rngContext: RngContext;
  revision: Revision;

  // 模組私有結算快照（見檔頭）。
  participantCharacterIds: readonly CharacterId[];
  defenseFormationRows: readonly DefenseFormationEntry[];
  attackDamageByCharacter: Readonly<Record<CharacterId, Readonly<Record<MasteryId, number>>>>;
}>;

// ── 工廠 ────────────────────────────────────────────────────────────────
export function createInitialCombatState(): CombatState {
  return { encounters: {} };
}

// ── 格座標工具 ──────────────────────────────────────────────────────────
// 局部九宮格：floor 固定 0，row 1..3（第 1 排=前排），col 1..3。
export function cellKey(cell: GridCell): string {
  return `${cell.floor}:${cell.row}:${cell.col}`;
}

export function localCell(row: number, col: number): GridCell {
  return { floor: 0, row, col };
}

export function emptyGrid(): CombatGridState {
  return { width: 3, height: 3, occupancy: {} };
}

// footprint 覆蓋的所有格（anchor 為左上；row 向後、col 向右延伸）。
export function coveredCells(anchor: GridCell, footprint: CombatFootprint): GridCell[] {
  const cells: GridCell[] = [];
  for (let r = 0; r < footprint.height; r += 1) {
    for (let c = 0; c < footprint.width; c += 1) {
      cells.push({ floor: anchor.floor, row: anchor.row + r, col: anchor.col + c });
    }
  }
  return cells;
}

// 由某側目前存活單位（非 dead）重建 occupancy（dead 移出 occupancy，其餘仍占格）。
export function rebuildGrid(
  combatants: Readonly<Record<CombatantId, CombatantState>>,
  side: CombatSide,
): CombatGridState {
  const occupancy: Record<string, CombatantId> = {};
  for (const id of Object.keys(combatants) as CombatantId[]) {
    const c = combatants[id];
    if (c === undefined || c.side !== side || c.state === 'dead') continue;
    for (const cell of coveredCells(c.anchorCell, c.footprint)) {
      occupancy[cellKey(cell)] = c.combatantId;
    }
  }
  return { width: 3, height: 3, occupancy };
}

// ── slice 讀寫小工具 ────────────────────────────────────────────────────
export function tryGetEncounter(
  state: CombatState,
  id: EncounterId,
): CombatEncounter | undefined {
  return state.encounters[id];
}

export function requireEncounter(state: CombatState, id: EncounterId): CombatEncounter {
  const e = state.encounters[id];
  if (e === undefined) throw new Error(`missing encounter ${String(id)}`);
  return e;
}

export function upsertEncounter(state: CombatState, encounter: CombatEncounter): CombatState {
  return {
    ...state,
    encounters: { ...state.encounters, [encounter.encounterId]: encounter },
  };
}

export function bumpRevision(r: Revision): Revision {
  return (r + 1) as Revision;
}
