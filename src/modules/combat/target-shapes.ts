// modules/combat/target-shapes.ts
// §2.4 技能目標解析——純格陣邏輯的目標形狀（「一個 local 一個形狀」）。
//
// TargetingDefinition 只有一個 targetResolverId，「哪些格位是合法目標」整件事都在 resolver 後面
// （見 combat/system.ts handleUseCombatSkill 的 resolveSkillTargets 呼叫）。本檔實作其中**只靠
// encounter 的 side / anchorCell / casting 就能決定**的那一組形狀：純函式、無 I/O、無 RNG、
// 不讀任何 Definition，可離線逐案驗證。
//
// 需要額外佐料的形狀**不在**本檔（它們的實作要等對應佐料進到 ResolverContext 才誠實）：
//   * 目標數上限（可調）：up-to-three-hostiles-{melee,ranged} —— 上限是資料（binding params）。
//
// **已解除的一項**：single-hostile-{melee,mid,ranged} 與 single-hostile-casting-ranged 原本列在
// 「需要武器 reach」而未實作。但射程過濾本來就由呼叫端統一施加（見下方 PURE_TARGET_SHAPES 的
// 說明），所以這四個 local 與不分距離的版本是同一個形狀，不需要額外佐料。
//   * 目標守備語意（格擋中／破綻）：single-hostile-{guarding,with-guard-down} —— 需要 guard 狀態表達。
//   * 戰鬥狀態正負判定：single-hostile-with-negative-status —— 需要 combat-status 定義的 valence。
//   * 反擊流程當下才知道攻擊者：blocked-melee-attacker、self-after-block —— 由 §8.4 反擊解析直接指定
//     目標，不走一般 resolveSkillTargets 路徑。
//   * 目標數上限（可調）：two-allies、up-to-three-allies、up-to-three-hostiles —— 上限是資料（binding
//     params），要等 resolver binding 的 params 通道就緒，才不必把 2/3 硬寫進程式（規範 §6）。
// 完整盤點與後續機制見 docs/CURRENT_STATUS.md。
//
// 每個形狀都是 (input) => CombatantId[]：
//   * requestedTargetIds 是玩家／AI 指定的**錨點**，不是最終集合；錨點型形狀據此過濾／展開。
//   * 全隊／前排型形狀忽略錨點，直接由 encounter 計算。
//   * 回空陣列＝此規則下這次請求沒有合法目標（Handler 以 typed rejection 回覆，不空耗行動）。
// 輸出去重且決定性（錨點型保留請求順序；計算型以 (row,col,combatantId) 排序），確保重播穩定。

import type { CombatantId } from '../../contracts/core';
import type { CombatEncounter, CombatantState } from './state';
import { combatDistance } from './state';

// resolveSkillTargets 的輸入去掉 resolverId（那一段由 registry 查表用；形狀本身不需要）。
// 刻意在此結構性重宣告，而不 import system.ts 的 CombatSkillTargetInput：system.ts 依賴面很大，
// 且日後會反過來經 registry 使用本檔，就地宣告可讓本檔保持葉節點、無循環相依。
export type TargetShapeInput = Readonly<{
  encounter: CombatEncounter;
  actorId: CombatantId;
  requestedTargetIds: readonly CombatantId[];
}>;

export type TargetShapeFn = (input: TargetShapeInput) => readonly CombatantId[];

// ── 純工具 ──────────────────────────────────────────────────────────────────

// 行動者必然存在（Handler 在呼叫前已驗 currentActorId 且該單位存活）。查無＝結構不變量被破壞，
// 明確拋錯而非回空集合——回空會把「程式錯」偽裝成「這次沒有合法目標」。
function actorOf(input: TargetShapeInput): CombatantState {
  const actor = input.encounter.combatants[input.actorId];
  if (actor === undefined) {
    throw new Error(`target-shape: 行動者 ${String(input.actorId)} 不在遭遇中`);
  }
  return actor;
}

function isAlive(c: CombatantState): boolean {
  return c.state !== 'dead';
}

// 某單位 footprint 覆蓋的欄（col 向右延伸 width 格）。
function coveredCols(c: CombatantState): number[] {
  const cols: number[] = [];
  for (let i = 0; i < c.footprint.width; i += 1) cols.push(c.anchorCell.col + i);
  return cols;
}

// 決定性排序：前排先（row 小）、同排左先（col 小）、再以 id 破平手。
function byCell(a: CombatantState, b: CombatantState): number {
  if (a.anchorCell.row !== b.anchorCell.row) return a.anchorCell.row - b.anchorCell.row;
  if (a.anchorCell.col !== b.anchorCell.col) return a.anchorCell.col - b.anchorCell.col;
  const ai = a.combatantId as string;
  const bi = b.combatantId as string;
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

// encounter 內某一側的存活單位（決定性排序）。
function livingOnSide(encounter: CombatEncounter, side: CombatantState['side']): CombatantState[] {
  return (Object.keys(encounter.combatants) as CombatantId[])
    .map((id) => encounter.combatants[id])
    .filter((c): c is CombatantState => c !== undefined && c.side === side && isAlive(c))
    .sort(byCell);
}

// 錨點型「單一目標」的共用件：依請求順序取第一個通過 pred 的存活單位；無則空集合。
function firstRequested(
  input: TargetShapeInput,
  pred: (c: CombatantState, actor: CombatantState) => boolean,
): readonly CombatantId[] {
  const actor = actorOf(input);
  for (const id of input.requestedTargetIds) {
    const c = input.encounter.combatants[id];
    if (c !== undefined && isAlive(c) && pred(c, actor)) return [id];
  }
  return [];
}

// ── 形狀 ────────────────────────────────────────────────────────────────────

// '自身。' —— 目標永遠是行動者本人（自我增益／立架勢）。
const self: TargetShapeFn = (input) => [input.actorId];

// '一名隊友。' —— 一名己方單位，排除自己（自身向另有 self / self-or-single-ally）。
const singleAlly: TargetShapeFn = (input) =>
  firstRequested(input, (c, actor) => c.side === actor.side && c.combatantId !== actor.combatantId);

// '自身或一名隊友。' —— 一名己方單位，允許自己。
const selfOrSingleAlly: TargetShapeFn = (input) =>
  firstRequested(input, (c, actor) => c.side === actor.side);

// '全隊。' —— 全體己方存活單位（含行動者本人）；忽略錨點。
const wholeParty: TargetShapeFn = (input) => {
  const actor = actorOf(input);
  return livingOnSide(input.encounter, actor.side).map((c) => c.combatantId);
};

// '己方前排。' —— 己方最前（row 最小）那一排的存活單位；忽略錨點。
const ownFrontRow: TargetShapeFn = (input) => {
  const actor = actorOf(input);
  const mates = livingOnSide(input.encounter, actor.side);
  if (mates.length === 0) return [];
  const frontRow = Math.min(...mates.map((c) => c.anchorCell.row));
  return mates.filter((c) => c.anchorCell.row === frontRow).map((c) => c.combatantId);
};

// '單體。' / '敵方單體。' —— 一名敵方單位（不限距離）。
const singleHostile: TargetShapeFn = (input) =>
  firstRequested(input, (c, actor) => c.side !== actor.side);

// '正在讀條的敵方單體。' —— 一名正在讀條（casting）的敵方單位。
const singleHostileCasting: TargetShapeFn = (input) =>
  firstRequested(input, (c, actor) => c.side !== actor.side && c.casting !== undefined);

// '同欄合法目標。' —— 以請求的敵方錨點決定欄位，回傳該欄所有存活敵方（含錨點自身）。
const sameColumnHostiles: TargetShapeFn = (input) => {
  const actor = actorOf(input);
  const targetCols = new Set<number>();
  for (const id of input.requestedTargetIds) {
    const c = input.encounter.combatants[id];
    if (c !== undefined && isAlive(c) && c.side !== actor.side) {
      for (const col of coveredCols(c)) targetCols.add(col);
    }
  }
  if (targetCols.size === 0) return [];
  return livingOnSide(input.encounter, actor.side === 'player' ? 'enemy' : 'player')
    .filter((c) => coveredCols(c).some((col) => targetCols.has(col)))
    .map((c) => c.combatantId);
};

// ── §2.4 射程過濾（通用；套在任何目標形狀的結果之上）────────────────────────────
// 從候選中剔除**超出攻方有效射程**的敵方目標。同側目標（自身／隊友）不受射程限制——治療／支援招式
// 靠 extraReachCells +6 覆蓋全場，實務上同側永遠在射程內，故此處直接放行，不需同側排距概念。
// actorReachCells ＝ 武器（或怪物天生攻擊）格數 ＋ 招式額外距離，由 Handler 在呼叫前算好帶入。
// 行動者必存在（Handler 前置已驗）；缺＝結構被破壞，拋錯（不靜默放行全部）。
export function filterByReach(
  encounter: CombatEncounter,
  actorId: CombatantId,
  actorReachCells: number,
  targets: readonly CombatantId[],
): readonly CombatantId[] {
  const actor = encounter.combatants[actorId];
  if (actor === undefined) {
    throw new Error(`filterByReach: 行動者 ${String(actorId)} 不在遭遇中`);
  }
  return targets.filter((id) => {
    const target = encounter.combatants[id];
    if (target === undefined) return false;
    if (target.side === actor.side) return true; // 同側不受射程限制
    return combatDistance(actor.anchorCell.row, target.anchorCell.row) <= actorReachCells;
  });
}

// ── 已實作形狀表（此檔涵蓋的 local；非全部 25 種，見檔頭清單）──────────────────
export type PureTargetLocal =
  | 'self'
  | 'single-ally'
  | 'self-or-single-ally'
  | 'whole-party'
  | 'own-front-row'
  | 'single-hostile'
  | 'single-hostile-melee'
  | 'single-hostile-mid'
  | 'single-hostile-ranged'
  | 'single-hostile-casting'
  | 'single-hostile-casting-ranged'
  | 'same-column-hostiles';

// 非 Partial：新增一個 PureTargetLocal 而忘了給實作，就是編譯錯誤（規範「非 Partial dispatch table」）。
export const PURE_TARGET_SHAPES: Readonly<Record<PureTargetLocal, TargetShapeFn>> = {
  self,
  'single-ally': singleAlly,
  'self-or-single-ally': selfOrSingleAlly,
  'whole-party': wholeParty,
  'own-front-row': ownFrontRow,
  'single-hostile': singleHostile,
  // 近／中／遠三個距離帶與不分距離的單體**是同一個形狀**：可及範圍由**行動者的武器射程**
  // 決定，而射程過濾已經由 `resolveSkillTargets` 的呼叫端統一施加
  //（combat-resolver-bridge：`filterByReach(..., input.actorReachCells, candidates)`，
  //  其中 actorReachCells ＝ 武器射程 ＋ 招式 extraReachCells）。
  //
  // 也就是說「近距離單體」不是一個獨立的幾何規則，而是「拿短兵器時單體打得到的範圍」。
  // 為它們各寫一個會把同一件事寫三遍，而且三份都得自己重算一次距離——那正是本檔開頭
  // 「不要自己寫距離」要避免的。這裡讓三個 local 指向同一個形狀，語意由射程資料承載。
  'single-hostile-melee': singleHostile,
  'single-hostile-mid': singleHostile,
  'single-hostile-ranged': singleHostile,
  'single-hostile-casting': singleHostileCasting,
  'single-hostile-casting-ranged': singleHostileCasting,
  'same-column-hostiles': sameColumnHostiles,
};
