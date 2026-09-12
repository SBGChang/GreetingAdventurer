// app/content/combat-ai-resolvers.ts
// 敵方 AI 與反擊條件的 Resolver shape（docs/00_core/technical_architecture.md）。
//
// 現況（工作單已核實）：`combat-resolver-bridge.ts` 的 `chooseEnemyAction` 早就正確地走
// `monster.aiPolicyId → CombatAiPolicyDefinition.behaviorResolverId → registry`，但 registry 裡
// 一個 AI shape 都沒有，所以敵方回合會在查表時明確拋錯。`evaluateCounterStance` 同理。
//
// ── 兩個 shape，五個 Resolver ID ──────────────────────────────────────────
//
// 三個 AI Policy 共用 `combat-ai:policy-driven`；兩個反擊條件共用 `combat-counter:incoming-action`。
// 差異**全部**落在 params（`CombatAiParamsDefinition` / `CombatCounterConditionParamsDefinition`），
// 這正是工作單要求的切法：「若你發現需要三份不同程式，先回報，那代表 shape 切錯了」。
//
// ── 這一層不含任何平衡量 ──────────────────────────────────────────────────
//
// 選招策略與目標偏好都是**封閉 tagged 值**，程式只實作有限幾種策略；「哪個怪用哪一種」寫在內容。
// 射程過濾一律重用 `filterByReach`（工作單的陷阱第一條：不要自己寫距離）。
// 沒有合法行動回 `undefined`（Handler 視為休息），**不回假招式**（陷阱第二條）。

import type {
  CombatActionKind,
  CombatAiParamsDefinition,
  CombatCounterConditionParamsDefinition,
} from '../../contracts/combat';
import type { CombatantId, DefinitionId, ResolverBinding, SchemaId } from '../../contracts/core';
import type { AnyResolverRegistration, ResolverRegistration } from '../../data-runtime';
import type { CombatEncounter, CombatantState } from '../../modules/combat/state';
import { combatDistance } from '../../modules/combat/state';
import { filterByReach } from '../../modules/combat/target-shapes';

// 占位 Schema ID（binding 驗證用；正式 schema 軌另立，與既有 shape 同層級）。
const AI_INPUT_SCHEMA = 'schema:combat-ai-input' as SchemaId;
const AI_RESULT_SCHEMA = 'schema:enemy-action-choice' as SchemaId;
const COUNTER_INPUT_SCHEMA = 'schema:combat-counter-input' as SchemaId;
const BOOLEAN_RESULT_SCHEMA = 'schema:boolean' as SchemaId;

// Resolver 執行期需要的窄化 Definition 面。由 `combat-resolver-bridge` 在呼叫時提供。
export type CombatAiDefinitions = Readonly<{
  getAiParams(id: DefinitionId): CombatAiParamsDefinition;
  getCounterParams(id: DefinitionId): CombatCounterConditionParamsDefinition;
  // 怪物的技能清單與天生射程；招式的額外射程與資源花費。
  getMonsterSkills(actor: CombatantState): readonly MonsterSkillView[];
}>;

// AI 選招需要看的每一招的最小面。由 bridge 從 combat Reader 投影出來——
// 讓這一層不必認識 MonsterDefinition／SkillView 的完整形狀。
export type MonsterSkillView = Readonly<{
  skillId: import('../../contracts/core').SkillDefinitionId;
  // 有效射程 ＝ 怪物天生攻擊格數 ＋ 招式額外距離（§2.4）。
  reachCells: number;
  // 這一招的資源花費是否付得起（由 bridge 依 actor 當前 HP/MP 判定）。
  affordable: boolean;
}>;

export type CombatAiInput = Readonly<{
  encounter: CombatEncounter;
  actorId: CombatantId;
}>;

export type EnemyActionChoiceValue =
  | Readonly<{
      skillId: import('../../contracts/core').SkillDefinitionId;
      targetCombatantIds: readonly CombatantId[];
    }>
  | undefined;

export type CombatCounterInput = Readonly<{
  encounter: CombatEncounter;
  defenderId: CombatantId;
  attackerId: CombatantId;
  incomingActionKind: CombatActionKind;
}>;

// ── 選招 ────────────────────────────────────────────────────────────────────

function chooseSkill(
  params: CombatAiParamsDefinition,
  skills: readonly MonsterSkillView[],
  encounter: CombatEncounter,
): MonsterSkillView | undefined {
  const affordable = skills.filter((s) => s.affordable);
  if (affordable.length === 0) return undefined;

  switch (params.skillSelection) {
    case 'onlySkill': {
      // §7.5「一般敵人剛好一招」。多於一招代表怪物資料與它掛的 AI Policy 不一致——
      // 明確失敗，不要靜默挑第一招（那會讓「資料配錯」永遠不被發現）。
      if (skills.length !== 1) {
        throw new Error(
          `combat-ai:policy-driven（onlySkill）：這隻怪有 ${skills.length} 招，` +
            `但它的 AI Policy 宣告只會一招——怪物資料與 Policy 不一致。`,
        );
      }
      return affordable[0];
    }
    case 'rotateByEncounterRevision':
      // 以 encounter.revision 取模輪替。revision 每筆交易遞增，所以首領連續行動會換招，
      // 且同一場重播得到同一序列。（真正的「第 N 次自己的行動」需要每單位行動計數，
      // CombatantState 目前沒有這個欄位——用 revision 是現有事實裡最接近的決定性序。）
      return affordable[encounter.revision % affordable.length];
    case 'randomAffordable':
      // 隨機在下面統一處理（需要 RNG，見 registration）。
      return undefined;
  }
}

// ── 選目標 ──────────────────────────────────────────────────────────────────

function livingHostiles(encounter: CombatEncounter, actor: CombatantState): CombatantState[] {
  const hostileSide = actor.side === 'player' ? 'enemy' : 'player';
  return Object.values(encounter.combatants)
    .filter((c) => c.side === hostileSide && c.state !== 'dead')
    // 決定性排序：先列後欄再 ID，讓「同分時挑誰」在重播中固定。
    .sort(
      (a, b) =>
        a.anchorCell.row - b.anchorCell.row ||
        a.anchorCell.col - b.anchorCell.col ||
        String(a.combatantId).localeCompare(String(b.combatantId)),
    );
}

// ── Registration ────────────────────────────────────────────────────────────

function aiRegistration(
  binding: ResolverBinding,
): ResolverRegistration<CombatAiInput, EnemyActionChoiceValue> {
  const paramsDefId = binding.paramsDefId;
  if (paramsDefId === undefined) {
    throw new Error(
      `combat-ai:policy-driven 綁定缺 paramsDefId（Resolver ${String(binding.resolverId)}）——` +
        `選招策略與目標偏好住在一筆 combat-ai-params，binding 必須指向它。`,
    );
  }
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: AI_INPUT_SCHEMA,
    resultSchemaId: AI_RESULT_SCHEMA,
    resolve: (input, ctx) => {
      const defs = ctx.definitions as CombatAiDefinitions;
      const params = defs.getAiParams(paramsDefId);
      const actor = input.encounter.combatants[input.actorId];
      if (actor === undefined || actor.state === 'dead') return { value: undefined };

      const skills = defs.getMonsterSkills(actor);
      if (skills.length === 0) return { value: undefined };

      let cursor = ctx.rngContext?.cursor;
      const rng = ctx.rng;

      // 1) 選招。
      let picked = chooseSkill(params, skills, input.encounter);
      if (picked === undefined && params.skillSelection === 'randomAffordable') {
        const affordable = skills.filter((s) => s.affordable);
        if (affordable.length === 0) return { value: undefined };
        if (rng === undefined || ctx.rngContext === undefined || cursor === undefined) {
          throw new Error('combat-ai:policy-driven（randomAffordable）需要 RNG，但 ResolverContext 沒有提供。');
        }
        const draw = rng.nextInt({
          worldSeed: ctx.rngContext.worldSeed,
          streamId: ctx.rngContext.streamId,
          cursor,
          minInclusive: 0,
          maxInclusive: affordable.length - 1,
        });
        cursor = draw.nextCursor;
        picked = affordable[draw.value];
      }
      if (picked === undefined) return { value: undefined };

      // 2) 選目標：先取敵對存活者，再用**共用的** filterByReach 過濾射程（工作單陷阱 1）。
      const hostiles = livingHostiles(input.encounter, actor);
      const inReach = filterByReach(
        input.encounter,
        input.actorId,
        picked.reachCells,
        hostiles.map((c) => c.combatantId),
      );
      if (inReach.length === 0) return { value: undefined }; // 沒有合法目標＝沒有合法行動。

      const byId = (id: CombatantId): CombatantState => input.encounter.combatants[id]!;

      let targetId: CombatantId;
      switch (params.targetPreference) {
        case 'lowestHealthInReach':
          targetId = [...inReach].sort((a, b) => byId(a).health - byId(b).health)[0]!;
          break;
        case 'highestHealthInReach':
          targetId = [...inReach].sort((a, b) => byId(b).health - byId(a).health)[0]!;
          break;
        case 'randomInReach': {
          if (rng === undefined || ctx.rngContext === undefined || cursor === undefined) {
            throw new Error('combat-ai:policy-driven（randomInReach）需要 RNG，但 ResolverContext 沒有提供。');
          }
          const draw = rng.nextInt({
            worldSeed: ctx.rngContext.worldSeed,
            streamId: ctx.rngContext.streamId,
            cursor,
            minInclusive: 0,
            maxInclusive: inReach.length - 1,
          });
          cursor = draw.nextCursor;
          targetId = inReach[draw.value]!;
          break;
        }
      }

      const value = { skillId: picked.skillId, targetCombatantIds: [targetId] as readonly CombatantId[] };
      return cursor === undefined ? { value } : { value, nextRngCursor: cursor };
    },
  };
}

function counterRegistration(binding: ResolverBinding): ResolverRegistration<CombatCounterInput, boolean> {
  const paramsDefId = binding.paramsDefId;
  if (paramsDefId === undefined) {
    throw new Error(
      `combat-counter:incoming-action 綁定缺 paramsDefId（Resolver ${String(binding.resolverId)}）——` +
        `觸發種類與距離上限住在一筆 combat-counter-condition-params。`,
    );
  }
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: COUNTER_INPUT_SCHEMA,
    resultSchemaId: BOOLEAN_RESULT_SCHEMA,
    resolve: (input, ctx) => {
      const defs = ctx.definitions as CombatAiDefinitions;
      const params = defs.getCounterParams(paramsDefId);
      if (!params.triggeringActionKinds.includes(input.incomingActionKind)) return { value: false };

      const limit = params.maxAttackerDistanceCells;
      if (limit === undefined) return { value: true }; // 缺席＝不限距離。

      const defender = input.encounter.combatants[input.defenderId];
      const attacker = input.encounter.combatants[input.attackerId];
      // 任一方不在遭遇中：這是結構被破壞，不是「條件不成立」。
      if (defender === undefined || attacker === undefined) {
        throw new Error(
          `combat-counter:incoming-action：攻守方不在遭遇中` +
            `（defender=${String(input.defenderId)} attacker=${String(input.attackerId)}）。`,
        );
      }
      return { value: combatDistance(attacker.anchorCell.row, defender.anchorCell.row) <= limit };
    },
  };
}

export const COMBAT_AI_SHAPE_BUILDERS: Readonly<
  Record<string, (binding: ResolverBinding) => AnyResolverRegistration>
> = {
  'combat-ai:policy-driven': aiRegistration,
  'combat-counter:incoming-action': counterRegistration,
};
